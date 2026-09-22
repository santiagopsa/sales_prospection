// Motor de resultados contra Postgres real. Misma variable que db.test.js; borra el schema sdr.
const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('motor de resultados', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { consultarCola } = require('../cola');
  const { registrarToque, registrarEjecutiva, siguienteEtapa } = require('../resultados');
  const L = require('../leads');
  const base = require('../config');
  const tiempo = require('../tiempo');
  const db = conectar(url);
  const silencio = { log() {}, error: console.error };

  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, silencio);
  // Una copia mínima de public.deals para probar la entrega al Sandler.
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, segment TEXT, has_ats BOOLEAN,
    data JSONB NOT NULL, linea_negocio TEXT, canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);

  const lunes = new Date('2026-09-21T14:00:00Z'); // 09:00 Bogotá
  const csv = 'empresa,contacto,telefono,email\nACME,Ana,3001234567,ana@acme.co\nBeta,Luis,3002222222,\nGama,Eva,3003333333,\nDelta,Juan,3004444444,';
  await importar(db, base, { archivo: 'x.csv', contenido: csv, simular: false, ahora: lunes });
  const id = async empresa => (await db.query(`SELECT id FROM sdr.leads WHERE empresa=$1`, [empresa])).rows[0].id;
  const lead = async empresa => (await db.query(`SELECT * FROM sdr.leads WHERE empresa=$1`, [empresa])).rows[0];
  const pendientes = async empresa => (await db.query(`SELECT paso, canal, estado FROM sdr.tasks WHERE lead_id=$1 AND estado='pendiente' ORDER BY paso`, [await id(empresa)])).rows;

  await t.test('siguienteEtapa solo avanza', () => {
    assert.strictEqual(siguienteEtapa(base, 'nuevo', 'gatekeeper'), 'contactado');
    assert.strictEqual(siguienteEtapa(base, 'conversacion', 'gatekeeper'), null);
    assert.strictEqual(siguienteEtapa(base, 'nuevo', 'no_contesto'), null);
    assert.strictEqual(siguienteEtapa(base, 'conversacion', 'descartado'), 'descartado');
  });

  await t.test('validaciones', async () => {
    await assert.rejects(registrarToque(db, base, { leadId: await id('ACME'), canal: 'llamada' }), /obligatorio/);
    await assert.rejects(registrarToque(db, base, { leadId: await id('ACME'), canal: 'llamada', resultado: 'descartado' }), /razón/);
    await assert.rejects(registrarToque(db, base, { leadId: 99999, canal: 'whatsapp' }), /no encontrado/);
    assert.strictEqual((await db.query('SELECT COUNT(*)::int AS n FROM sdr.touches')).rows[0].n, 0);
  });

  await t.test('no contestó: cumple la tarea de llamada, la secuencia sigue, cuenta como marcación', async () => {
    const r = await registrarToque(db, base, { leadId: await id('ACME'), canal: 'llamada', resultado: 'no_contesto', ahora: lunes });
    assert.strictEqual(r.etapa, 'nuevo');
    assert.strictEqual(r.proxima.paso, 2);
    assert.strictEqual(r.proxima.canal, 'whatsapp');
    const p = await pendientes('ACME');
    assert.strictEqual(p.length, base.SECUENCIA_POR_DEFECTO.length - 1);
    const c = await consultarCola(db, base, { ahora: lunes });
    assert.strictEqual(c.indicadores.marcaciones, 1);
    assert.strictEqual(c.indicadores.conversaciones, 0);
    const call = (await db.query('SELECT origen, touch_id FROM sdr.calls')).rows[0];
    assert.strictEqual(call.origen, 'manual');
    assert.ok(call.touch_id);
  });

  await t.test('WhatsApp de un clic: cumple su tarea y pasa a contactado', async () => {
    const r = await registrarToque(db, base, { leadId: await id('ACME'), canal: 'whatsapp', ahora: lunes });
    assert.strictEqual(r.etapa, 'contactado');
    assert.strictEqual(r.proxima.paso, 3);
    // Un correo sin tarea de correo próxima se registra igual, sin cumplir ninguna tarea
    const r2 = await registrarToque(db, base, { leadId: await id('ACME'), canal: 'correo', ahora: lunes });
    assert.strictEqual(r2.proxima.paso, 3);
    const hechas = (await db.query(`SELECT paso FROM sdr.tasks WHERE lead_id=$1 AND estado='hecha' ORDER BY paso`, [await id('ACME')])).rows.map(x => x.paso);
    assert.deepStrictEqual(hechas, [1, 2, 4]);   // el correo cumplió el paso 4 (primer correo pendiente)
  });

  await t.test('conversación: omite la secuencia y programa según TRAS_CONVERSACION', async () => {
    const r = await registrarToque(db, base, { leadId: await id('ACME'), canal: 'llamada', resultado: 'conversacion', nota: 'Interesada en EOR', ahora: lunes });
    assert.strictEqual(r.etapa, 'conversacion');
    const p = await pendientes('ACME');
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].canal, base.TRAS_CONVERSACION.canal);
    assert.strictEqual(tiempo.fechaBogota(new Date(r.proxima.due_at)), tiempo.avanzar('2026-09-21', base.TRAS_CONVERSACION.dias, true));
    const c = await consultarCola(db, base, { ahora: lunes });
    assert.strictEqual(c.indicadores.conversaciones, 1);
    assert.strictEqual(c.indicadores.marcaciones, 2);
  });

  await t.test('reunión agendada: deal en el Sandler, recordatorio y etapa', async () => {
    const r = await registrarToque(db, base, {
      leadId: await id('ACME'), canal: 'llamada', resultado: 'reunion_agendada', ahora: lunes,
      detalle: { reunion_at: '2026-09-24T15:00:00-05:00', ficha_cargos: '2 devs backend', ficha_costo: '$8M/mes', ficha_herramientas: 'LinkedIn', ejecutiva: 'Luisa', linea_negocio: 'Headhunting' },
    });
    assert.strictEqual(r.etapa, 'reunion_agendada');
    assert.ok(r.deal_id);
    assert.deepStrictEqual(r.avisos, []);
    const deal = (await db.query('SELECT * FROM public.deals WHERE id=$1', [r.deal_id])).rows[0];
    assert.strictEqual(deal.company, 'ACME');
    assert.strictEqual(deal.canal_adquisicion, 'sdr_interno');
    assert.strictEqual(deal.data.fichaCargos, '2 devs backend');
    assert.match(deal.data.fichaAdicional, /Ana/);
    const p = await pendientes('ACME');
    assert.strictEqual(p.length, 1);
    assert.strictEqual(p[0].canal, 'whatsapp');   // recordatorio un día antes
    const l = await lead('ACME');
    assert.strictEqual(l.deal_id, r.deal_id);
    // Ya no aparece en la cola de Angie
    const c = await consultarCola(db, base, { ahora: lunes });
    assert.ok(!c.tareas.some(x => x.empresa === 'ACME'));
    // Angie ya no puede registrar toques normales
    await assert.rejects(registrarToque(db, base, { leadId: await id('ACME'), canal: 'whatsapp' }), /ejecutiva/);
  });

  await t.test('ejecutiva: no-show vuelve a conversación; realizada y calificado avanzan', async () => {
    const ns = await registrarEjecutiva(db, base, { leadId: await id('ACME'), accion: 'no_show', ahora: lunes });
    assert.strictEqual(ns.etapa, 'conversacion');
    assert.strictEqual(ns.proxima.canal, base.TRAS_NO_SHOW.canal);
    await assert.rejects(registrarEjecutiva(db, base, { leadId: await id('ACME'), accion: 'calificado' }), /reunión/);
    await registrarToque(db, base, { leadId: await id('ACME'), canal: 'llamada', resultado: 'reunion_agendada', ahora: lunes });
    const rr = await registrarEjecutiva(db, base, { leadId: await id('ACME'), accion: 'reunion_realizada', ahora: lunes });
    assert.strictEqual(rr.etapa, 'reunion_realizada');
    const q = await registrarEjecutiva(db, base, { leadId: await id('ACME'), accion: 'calificado', nota: 'Firma piloto', ahora: lunes });
    assert.strictEqual(q.etapa, 'calificado');
    const d = await L.detalleLead(db, await id('ACME'));
    assert.strictEqual(d.toques[0].canal, 'ejecutiva');
    assert.strictEqual(d.toques[0].resultado, 'calificado');
    assert.strictEqual((await lead('ACME')).deal_id > 0, true);
  });

  await t.test('si public.deals falla, la reunión queda registrada con aviso', async () => {
    await db.query('ALTER TABLE public.deals RENAME TO deals_x');
    try {
      const r = await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'reunion_agendada', ahora: lunes });
      assert.strictEqual(r.etapa, 'reunion_agendada');
      assert.strictEqual(r.deal_id, null);
      assert.match(r.avisos[0], /Sandler/);
    } finally { await db.query('ALTER TABLE public.deals_x RENAME TO deals'); }
    await registrarEjecutiva(db, base, { leadId: await id('Beta'), accion: 'no_show', ahora: lunes });
  });

  await t.test('usuario: se guarda la etiqueta y solo los sdr cuentan en las metas', async () => {
    const before = (await consultarCola(db, base, { ahora: lunes })).indicadores.marcaciones;
    await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'no_contesto', usuario: 'santiago', ahora: lunes });
    await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'no_contesto', usuario: 'Angie', ahora: lunes });
    await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'no_contesto', usuario: 'nadie', ahora: lunes });
    const u = (await db.query(`SELECT usuario FROM sdr.touches ORDER BY id DESC LIMIT 3`)).rows.map(x => x.usuario);
    assert.deepStrictEqual(u, [null, 'Angie', 'Santiago']);   // 'nadie' no existe → null; 'santiago' se normaliza
    const after = (await consultarCola(db, base, { ahora: lunes })).indicadores.marcaciones;
    assert.strictEqual(after - before, 2);                     // Angie + sin usuario cuentan; Santiago no
    // Cada quien ve su propio histórico
    assert.strictEqual((await consultarCola(db, base, { ahora: lunes, usuario: 'Santiago' })).indicadores.marcaciones, 1);
    assert.strictEqual((await consultarCola(db, base, { ahora: lunes, usuario: 'Angie' })).indicadores.marcaciones, 1);
    assert.strictEqual((await consultarCola(db, base, { ahora: lunes, usuario: 'Luisa' })).indicadores.marcaciones, 0);
    const { resumenSemana } = require('../ritmo');
    assert.strictEqual((await resumenSemana(db, base, { fecha: '2026-09-21', usuario: 'Santiago', ahora: lunes })).totales.marcaciones, 1);
  });

  await t.test('descartar sin llamar (decisión) exige razón', async () => {
    await assert.rejects(registrarEjecutiva(db, base, { leadId: await id('Beta'), accion: 'descartado' }), /razón/);
  });

  await t.test('descartado con razón', async () => {
    const r = await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'descartado', razon: 'ya_tiene_proveedor', ahora: lunes });
    assert.strictEqual(r.etapa, 'descartado');
    assert.deepStrictEqual(await pendientes('Beta'), []);
    assert.strictEqual((await lead('Beta')).razon_descarte, 'ya_tiene_proveedor');
  });

  await t.test('secuencia agotada: huérfano o descarte según AL_AGOTAR_SECUENCIA', async () => {
    const n = base.SECUENCIA_POR_DEFECTO.length;
    for (let i = 0; i < n - 1; i++) await registrarToque(db, base, { leadId: await id('Gama'), canal: base.SECUENCIA_POR_DEFECTO[i].canal, resultado: 'no_contesto', ahora: lunes });
    const ultimo = await registrarToque(db, base, { leadId: await id('Gama'), canal: base.SECUENCIA_POR_DEFECTO[n - 1].canal, resultado: 'no_contesto', ahora: lunes });
    assert.strictEqual(ultimo.proxima, null);
    assert.match(ultimo.avisos[0], /sin próximo toque/);
    assert.strictEqual((await consultarCola(db, base, { ahora: lunes })).indicadores.huerfanos, 1);

    const cfg = { ...base, AL_AGOTAR_SECUENCIA: 'descartar' };
    for (let i = 0; i < n; i++) await registrarToque(db, cfg, { leadId: await id('Delta'), canal: base.SECUENCIA_POR_DEFECTO[i].canal, resultado: 'no_contesto', ahora: lunes });
    const d = await lead('Delta');
    assert.strictEqual(d.etapa, 'descartado');
    assert.strictEqual(d.razon_descarte, 'sin_respuesta');
  });

  await t.test('llamada desde el navegador: el uuid une resultado y webhook', async () => {
    // El webhook llegó primero (fase 3) y creó la fila
    await db.query(`INSERT INTO sdr.calls (uuid, lead_id, origen, duracion_s, record_url) VALUES ('u-1', $1, 'voximplant', 95, 'https://rec/u-1.mp3')`, [await id('Gama')]);
    const r = await registrarToque(db, base, { leadId: await id('Gama'), canal: 'llamada', resultado: 'gatekeeper', callUuid: 'u-1', ahora: lunes });
    const rows = (await db.query(`SELECT COUNT(*)::int AS n FROM sdr.calls WHERE uuid='u-1'`)).rows[0].n;
    assert.strictEqual(rows, 1);
    const d = await L.detalleLead(db, await id('Gama'));
    assert.strictEqual(d.toques[0].duracion_s, 95);
    assert.strictEqual(d.toques[0].call_id, r.call_id);
  });

  db.end();
});

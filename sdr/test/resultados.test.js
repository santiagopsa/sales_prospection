// Motor de resultados contra Postgres real. Misma variable que db.test.js; borra el schema sdr.
const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('motor de resultados', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { consultarCola } = require('../cola');
  const { registrarToque, registrarEjecutiva, siguienteEtapa, agregarAListaNegra } = require('../resultados');
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
  const pendientes = async empresa => (await db.query(`SELECT paso, canal, estado FROM sdr.tasks WHERE lead_id=$1 AND estado='pendiente' AND tipo='secuencia' ORDER BY paso`, [await id(empresa)])).rows;

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
    assert.deepStrictEqual(r.avisos, ['Reunión anotada como compromiso de Luisa.']);
    assert.ok(r.compromiso_id);
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

  await t.test('descartado con razón (sin reintento)', async () => {
    const r = await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'descartado', razon: 'ya_tiene_proveedor', reintentoMeses: null, ahora: lunes });
    assert.strictEqual(r.etapa, 'descartado');
    assert.deepStrictEqual(await pendientes('Beta'), []);
    assert.strictEqual((await lead('Beta')).razon_descarte, 'ya_tiene_proveedor');
  });

  await t.test('sacar de la cola con reintento: pausa, no descarta, y vuelve solo', async () => {
    const csv2 = 'empresa,contacto,telefono,email\nPausa SA,Pep,3005555555,pep@pausa.co\nNegra SA,Nan,3006666666,nan@negra.co\nManual SA,Man,3007777777,man@manual.co';
    await importar(db, base, { archivo: 'y.csv', contenido: csv2, simular: false, ahora: lunes });
    // Por defecto "sin presupuesto" propone 3 meses.
    const r = await registrarToque(db, base, { leadId: await id('Pausa SA'), canal: 'llamada', resultado: 'descartado', razon: 'sin_presupuesto', ahora: lunes });
    assert.strictEqual(r.etapa, 'nuevo');
    assert.ok(r.pausado_hasta);
    assert.strictEqual(tiempo.fechaBogota(new Date(r.pausado_hasta)), '2026-12-21');
    assert.strictEqual(r.proxima.canal, 'llamada');
    assert.match(r.avisos[0], /En pausa hasta el 2026-12-21/);
    const p = await pendientes('Pausa SA');
    assert.strictEqual(p.length, base.SECUENCIA_REINTENTO.length);
    assert.strictEqual(p[0].paso, base.SECUENCIA_POR_DEFECTO.length + 1);
    // No está en la cola hoy, ni es huérfano, y el pipeline lo cuenta en pausa.
    const c = await consultarCola(db, base, { ahora: lunes });
    assert.ok(!c.tareas.some(x => x.empresa === 'Pausa SA'));
    assert.strictEqual((await L.pipeline(db)).pausados, 1);
    assert.strictEqual((await L.listarLeads(db, { pausados: true })).length, 1);
    const toque = (await db.query(`SELECT resultado, razon_descarte, detalle FROM sdr.touches WHERE lead_id=$1`, [await id('Pausa SA')])).rows[0];
    assert.strictEqual(toque.resultado, 'pausado');
    assert.strictEqual(toque.detalle.meses, 3);
    // El día que llega, aparece en la cola y un toque real le quita la pausa.
    const diciembre = new Date('2026-12-21T14:00:00Z');
    const c2 = await consultarCola(db, base, { ahora: diciembre });
    assert.ok(c2.tareas.some(x => x.empresa === 'Pausa SA'));
    await registrarToque(db, base, { leadId: await id('Pausa SA'), canal: 'llamada', resultado: 'no_contesto', ahora: diciembre });
    const l = await lead('Pausa SA');
    assert.strictEqual(l.pausado_hasta, null);
    assert.strictEqual(l.razon_descarte, null);
    // Meses explícitos y validación.
    await assert.rejects(registrarEjecutiva(db, base, { leadId: await id('Pausa SA'), accion: 'descartado', razon: 'otro', reintentoMeses: 2 }), /1, 3, 6/);
    const e = await registrarEjecutiva(db, base, { leadId: await id('Pausa SA'), accion: 'descartado', razon: 'otro', reintentoMeses: 1, ahora: diciembre });
    assert.strictEqual(tiempo.fechaBogota(new Date(e.pausado_hasta)), '2027-01-21');
    // "otro" sin meses = descartar de verdad; reintento 0 también.
    const d = await registrarEjecutiva(db, base, { leadId: await id('Pausa SA'), accion: 'descartado', razon: 'otro', reintentoMeses: 0, ahora: diciembre });
    assert.strictEqual(d.etapa, 'descartado');
    assert.deepStrictEqual(await pendientes('Pausa SA'), []);
  });

  await t.test('reactivar: vuelve a la cola con la secuencia de reintento', async () => {
    await assert.rejects(registrarEjecutiva(db, base, { leadId: await id('ACME'), accion: 'reactivar' }), /no está descartado/);
    const r = await registrarEjecutiva(db, base, { leadId: await id('Pausa SA'), accion: 'reactivar', ahora: lunes });
    assert.strictEqual(r.etapa, 'contactado');
    assert.strictEqual(r.proxima.canal, 'llamada');
    assert.strictEqual((await pendientes('Pausa SA')).length, base.SECUENCIA_REINTENTO.length);
    assert.strictEqual((await lead('Pausa SA')).razon_descarte, null);
  });

  await t.test('lista negra: "pidió que no lo contacten" la llena; bloquea cargas, marcación y reactivación', async () => {
    const LN = require('../listanegra');
    const { agregarAListaNegra } = require('../resultados');
    // Nunca ofrece reintento aunque se pidan meses.
    const r = await registrarToque(db, base, { leadId: await id('Negra SA'), canal: 'llamada', resultado: 'descartado', razon: 'no_contactar', reintentoMeses: 6, ahora: lunes });
    assert.strictEqual(r.etapa, 'descartado');
    assert.strictEqual(r.pausado_hasta, null);
    assert.match(r.avisos[0], /lista negra/);
    const ln = await LN.listar(db);
    assert.strictEqual(ln.length, 1);
    assert.strictEqual(ln[0].telefono, '+573006666666');
    assert.strictEqual(ln[0].email, 'nan@negra.co');
    // La carga la deja fuera (por teléfono o por correo) y lo dice.
    const inf = await importar(db, base, { archivo: 'z.csv', contenido: 'empresa,telefono,email\nOtra,3006666666,\nOtra2,,NAN@negra.co\nLimpia,3008888888,', simular: true, ahora: lunes });
    assert.strictEqual(inf.aCrear, 1);
    assert.strictEqual(inf.listaNegra.length, 2);
    assert.match(inf.listaNegra[0].motivo, /teléfono en la lista negra/);
    assert.match(inf.listaNegra[1].motivo, /correo en la lista negra/);
    // Marcación directa rechazada; reactivar rechazado.
    await assert.rejects(L.leadParaMarcar(db, base, { telefono: '300 666 6666' }), /lista negra/);
    await assert.rejects(registrarEjecutiva(db, base, { leadId: await id('Negra SA'), accion: 'reactivar' }), /lista negra/);
    assert.strictEqual((await L.detalleLead(db, await id('Negra SA'))).en_lista_negra, true);
    // A mano: descarta el lead que coincide y no duplica.
    const m = await agregarAListaNegra(db, base, { telefono: '3007777777', nota: 'llamó a quejarse', usuario: 'Santiago' });
    assert.strictEqual(m.leads_descartados, 1);
    assert.strictEqual((await lead('Manual SA')).etapa, 'descartado');
    assert.strictEqual((await lead('Manual SA')).razon_descarte, 'no_contactar');
    const otra = await agregarAListaNegra(db, base, { telefono: '3007777777' });
    assert.strictEqual(otra.existente, true);
    assert.strictEqual((await LN.listar(db)).length, 2);
    await assert.rejects(agregarAListaNegra(db, base, { nota: 'x' }), /teléfono, un correo, una empresa o un dominio/);
    // Quitar.
    await LN.quitar(db, m.id);
    assert.strictEqual((await LN.listar(db)).length, 1);
    await assert.rejects(LN.quitar(db, m.id), /No está/);
  });

  await t.test('lista negra por empresa y dominio: carga masiva, bloquea cargas y reactivación', async () => {
    const LN = require('../listanegra');
    assert.strictEqual(LN.normalizarEmpresa('Grupo Éxito S.A.S.'), 'grupo exito');
    assert.strictEqual(LN.dominioDe('Ana@Acme.COM'), 'acme.com');
    await db.query(`INSERT INTO sdr.leads (empresa, contacto, telefono, email) VALUES ('Éxito S.A.S.', 'Pat', '+573009990001', 'pat@exito.com'), ('Vetada Ltda', 'Vic', '+573009990002', NULL), ('Dominio Corp', 'Dom', '+573009990003', 'dom@vetado.co')`);
    const csv = 'Empresa,Correo,Sitio web,Motivo\nGrupo Exito SAS,,https://www.exito.com,Cliente actual\nVETADA LTDA.,,,Competidor\n,,vetado.co,Dominio vetado\nMala fila,,,\nExito,,,repetida';
    const sim = await LN.importarLista(db, base, { archivo: 'ln.csv', contenido: csv, simular: true, usuario: 'Santiago' });
    assert.strictEqual(sim.simulado, true);
    assert.strictEqual(sim.nuevos.length, 5);     // grupo exito, vetada, vetado.co, "mala fila" (empresa sola es válida), exito
    assert.strictEqual(sim.repetidos.length, 0);
    assert.strictEqual((await db.query('SELECT COUNT(*)::int AS n FROM sdr.lista_negra')).rows[0].n, 1); // simular no escribe
    const real = await LN.importarLista(db, base, { archivo: 'ln.csv', contenido: csv, simular: false, usuario: 'Santiago' });
    assert.strictEqual(real.leads_descartados, 3);
    for (const e of ['Éxito S.A.S.', 'Vetada Ltda', 'Dominio Corp']) { const l = await lead(e); assert.strictEqual(l.etapa, 'descartado'); assert.strictEqual(l.razon_descarte, 'lista_negra'); }
    // La carga de leads deja fuera la empresa (con otro sufijo), el dominio, y deja entrar el resto
    const inf = await importar(db, base, { archivo: 'z.csv', contenido: 'empresa,telefono,email\nGrupo Éxito S.A.,3009990011,\nOtra,3009990012,x@vetado.co\nLibre,3009990013,', simular: true, ahora: lunes });
    assert.strictEqual(inf.aCrear, 1);
    assert.deepStrictEqual(inf.listaNegra.map(x => x.motivo), ['empresa en la lista negra', 'dominio vetado.co en la lista negra']);
    // Reactivar rechazado por empresa
    await assert.rejects(registrarEjecutiva(db, base, { leadId: await id('Éxito S.A.S.'), accion: 'reactivar' }), /(empresa|dominio exito.com) en la lista negra/);
    // Segunda carga: todo repetido
    const otra = await LN.importarLista(db, base, { archivo: 'ln.csv', contenido: csv, simular: true });
    assert.strictEqual(otra.nuevos.length, 0);
    // A mano con "toda la empresa" y quitar
    const m = await agregarAListaNegra(db, base, { empresa: 'Rappi S.A.S', todaEmpresa: true, nota: 'cliente' });
    assert.strictEqual(m.empresa_norm, 'rappi');
    await LN.quitar(db, m.id);
    await assert.rejects(LN.importarLista(db, base, { archivo: 'x.csv', contenido: 'nada,que,ver\n1,2,3', simular: true }), /No encontré columnas/);
  });

  await t.test('editar datos: normaliza teléfonos, rechaza choques, deja rastro', async () => {
    const r = await L.editarLead(db, base, await id('ACME'), { contacto: 'Ana María', telefono_alt: '301 222 3344', cargo: '' }, 'Santiago');
    assert.deepStrictEqual(Object.keys(r.cambios).sort(), ['contacto', 'telefono_alt']);
    const l = await lead('ACME');
    assert.strictEqual(l.telefono_alt, '+573012223344');
    assert.strictEqual(l.contacto, 'Ana María');
    assert.strictEqual((await db.query(`SELECT resultado, usuario FROM sdr.touches WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [l.id])).rows[0].resultado, 'editado');
    assert.strictEqual((await L.editarLead(db, base, l.id, { contacto: 'Ana María' })).sin_cambios, true);
    await assert.rejects(L.editarLead(db, base, l.id, { telefono: '3002222222' }), /ya es del lead/);      // el de Beta
    await assert.rejects(L.editarLead(db, base, l.id, { telefono: '12' }), /Teléfono/);
    await assert.rejects(L.editarLead(db, base, l.id, { email: 'malo' }), /Correo inválido/);
    await assert.rejects(L.editarLead(db, base, l.id, { empresa: ' ' }), /empresa/);
    const r2 = await L.editarLead(db, base, l.id, { telefono: '3019998877', telefono_alt: '3019998877' });
    assert.strictEqual((await lead('ACME')).telefono, '+573019998877');
    assert.strictEqual((await lead('ACME')).telefono_alt, null);
    assert.ok(r2.cambios.telefono);
    assert.strictEqual((await L.detalleLead(db, l.id)).telefono_alt, null);
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

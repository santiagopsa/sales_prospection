// Reciclaje: que los leads se acaben (sdr/reciclaje.js + RECICLAJE.conversaciones_max en registrarToque).
const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('reciclaje', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { registrarToque } = require('../resultados');
  const C = require('../compromisos');
  const Rc = require('../reciclaje');
  const base = require('../config');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  const lunes = new Date('2026-10-19T14:00:00Z');
  await importar(db, base, { archivo: 'r.csv', contenido: 'empresa,contacto,telefono,email\nUno,Ana,3007770001,\nDos,Bea,3007770002,\nTres,Cai,3007770003,\nSinTel,Dan,,dan@sintel.co\nPozo,Eva,3007770005,', simular: false, ahora: lunes });
  const id = async e => (await db.query(`SELECT id FROM sdr.leads WHERE empresa=$1`, [e])).rows[0].id;
  const lead = async e => (await db.query(`SELECT etapa, razon_descarte, pausado_hasta FROM sdr.leads WHERE empresa=$1`, [e])).rows[0];
  const pendientes = async e => (await db.query(`SELECT tipo, canal, estado FROM sdr.tasks WHERE lead_id=$1 AND estado='pendiente' ORDER BY due_at`, [await id(e)])).rows;

  await t.test('segunda conversación sin reunión ni compromiso: el lead sale de la cola en pausa', async () => {
    const uno = await id('Uno');
    const r1 = await registrarToque(db, base, { leadId: uno, canal: 'llamada', resultado: 'conversacion', ahora: lunes });
    assert.strictEqual(r1.proxima.canal, base.TRAS_CONVERSACION.canal, 'la primera conversación sigue programando el seguimiento');
    assert.strictEqual((await lead('Uno')).pausado_hasta, null);
    const r2 = await registrarToque(db, base, { leadId: uno, canal: 'llamada', resultado: 'conversacion', nota: 'otra vez mándame info', ahora: new Date('2026-10-22T14:00:00Z') });
    const l = await lead('Uno');
    assert.strictEqual(l.etapa, 'conversacion');
    assert.strictEqual(l.razon_descarte, 'sin_avance');
    assert.ok(l.pausado_hasta, 'en pausa');
    assert.strictEqual(new Date(r2.pausado_hasta).toISOString().slice(0, 7), '2027-01');
    assert.ok(r2.avisos.some(a => /2\.ª conversación/.test(a)));
    assert.strictEqual(r2.proxima.canal, 'llamada');   // el reintento, en 3 meses
    const tq = (await db.query(`SELECT detalle FROM sdr.touches WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [uno])).rows[0];
    assert.strictEqual(tq.detalle.conversaciones, 2);
  });

  await t.test('con compromiso con fecha no se pausa; sin tope (null) tampoco', async () => {
    const dos = await id('Dos');
    await registrarToque(db, base, { leadId: dos, canal: 'llamada', resultado: 'conversacion', ahora: lunes });
    await C.insertar(db, base, { leadId: dos, tipo: 'seguimiento', titulo: 'Llamar el viernes', canal: 'llamada', fecha: '2026-10-30', hora: '10:00', usuario: 'Angie' });
    const r = await registrarToque(db, base, { leadId: dos, canal: 'llamada', resultado: 'conversacion', ahora: new Date('2026-10-22T14:00:00Z') });
    assert.strictEqual((await lead('Dos')).pausado_hasta, null);
    assert.ok(!r.avisos.some(a => /conversación sin reunión/.test(a)));
    const tres = await id('Tres');
    const sinTope = { ...base, RECICLAJE: { ...base.RECICLAJE, conversaciones_max: null } };
    await registrarToque(db, sinTope, { leadId: tres, canal: 'llamada', resultado: 'conversacion', ahora: lunes });
    await registrarToque(db, sinTope, { leadId: tres, canal: 'llamada', resultado: 'conversacion', ahora: new Date('2026-10-22T14:00:00Z') });
    await registrarToque(db, sinTope, { leadId: tres, canal: 'llamada', resultado: 'conversacion', ahora: new Date('2026-10-23T14:00:00Z') });
    assert.strictEqual((await lead('Tres')).pausado_hasta, null);
  });

  await t.test('pasada diaria: secuencias vencidas, huérfanos con historia y sin teléfono; el pozo no se toca', async () => {
    // Tres: en conversación con seguimiento programado para el 2026-10-28 (3 días hábiles después del 23).
    // Pozo: nunca tocado, con la secuencia del 19-oct vencida: no se toca.
    const ahora = new Date('2026-11-20T14:00:00Z');   // un mes después: todo vencido
    // Un lead sin nada para trabajarlo (sin teléfono, correo ni LinkedIn) sí sale; SinTel tiene correo: se queda.
    await db.query(`INSERT INTO sdr.leads (empresa, contacto, fuente) VALUES ('Nada', 'Ñu', 'prueba')`);
    const sim = await Rc.correr(db, base, { ahora, simular: true });
    assert.strictEqual(sim.sin_contacto, 1, 'solo Nada');
    assert.ok(sim.secuencias_omitidas >= 1, 'el seguimiento vencido de Tres (y los de Dos)');
    assert.strictEqual(sim.huerfanos_pausados, 1, 'Tres queda sin nada → pausa (simulación cuenta igual)');
    assert.strictEqual((await lead('SinTel')).etapa, 'nuevo', 'simular no cambia nada');
    const r = await Rc.correr(db, base, { ahora });
    assert.strictEqual(r.sin_contacto, 1);
    assert.deepStrictEqual([(await lead('Nada')).etapa, (await lead('Nada')).razon_descarte], ['descartado', 'sin_contacto']);
    assert.strictEqual((await lead('SinTel')).etapa, 'nuevo', 'sin teléfono pero con correo: se queda en la cola');
    assert.ok((await pendientes('SinTel')).length > 0);
    const tres = await lead('Tres');
    assert.strictEqual(tres.etapa, 'conversacion'); assert.strictEqual(tres.razon_descarte, 'sin_avance'); assert.ok(tres.pausado_hasta);
    assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.touches WHERE lead_id=$1 AND canal='ejecutiva' AND resultado='pausado'`, [await id('Tres')])).rows[0].n, 1, 'rastro en el historial');
    const pozo = await lead('Pozo');
    assert.strictEqual(pozo.etapa, 'nuevo'); assert.ok((await pendientes('Pozo')).length > 0, 'al pozo no se le omite nada');
    // Dos tenía compromiso (vencido también): el compromiso no se omite, solo la secuencia.
    assert.ok((await pendientes('Dos')).some(x => x.tipo === 'seguimiento'));
    // Idempotente y una vez al día.
    const r2 = await Rc.correr(db, base, { ahora });
    assert.deepStrictEqual([r2.secuencias_omitidas, r2.huerfanos_pausados, r2.sin_contacto], [0, 0, 0]);
    Rc._reiniciar();
    assert.ok(await Rc.jobDiario(db, base, { ahora, log: { log() {}, error() {} } }));
    assert.strictEqual(await Rc.jobDiario(db, base, { ahora, log: { log() {}, error() {} } }), null);
  });

  await t.test('secuencia agotada sin conversación: descartado sin_respuesta (AL_AGOTAR_SECUENCIA)', async () => {
    assert.strictEqual(base.AL_AGOTAR_SECUENCIA, 'descartar');
    const pozo = await id('Pozo');
    const n = base.SECUENCIA_POR_DEFECTO.length;
    let r;
    for (let i = 0; i < n; i++) r = await registrarToque(db, base, { leadId: pozo, canal: base.SECUENCIA_POR_DEFECTO[i].canal, resultado: 'no_contesto', ahora: lunes });
    const l = await lead('Pozo');
    assert.strictEqual(l.etapa, 'descartado'); assert.strictEqual(l.razon_descarte, 'sin_respuesta');
  });

  await t.test('rescate: los que la regla vieja descartó por no tener teléfono vuelven a la cola', async () => {
    const ahora = new Date('2026-11-10T14:00:00Z');
    await db.query(`INSERT INTO sdr.leads (empresa, contacto, email, etapa, razon_descarte, fuente, created_at) VALUES
      ('Oxo', 'Javier', 'j@oxo.co', 'descartado', 'datos_malos', 'prueba', '2026-11-05T14:00:00Z'),
      ('Vieja Base', 'Ana', 'a@vieja.co', 'descartado', 'datos_malos', 'prueba', '2026-09-01T14:00:00Z'),
      ('Tocada', 'Bea', 'b@tocada.co', 'descartado', 'datos_malos', 'prueba', '2026-11-05T14:00:00Z')`);
    await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, created_at) SELECT id, 'correo', 'correo', '2026-11-06T14:00:00Z' FROM sdr.leads WHERE empresa = 'Tocada'`);
    const corto = { ...base, RECICLAJE: { ...base.RECICLAJE, rescatar_dias: 30 } }; // la ventana fija: la prueba no depende del hueco de config
    const sim = await Rc.correr(db, corto, { ahora, simular: true });
    assert.strictEqual(sim.rescatados, 1, 'solo Oxo: Vieja Base está fuera de rescatar_dias y Tocada ya tuvo un toque');
    assert.strictEqual((await lead('Oxo')).etapa, 'descartado', 'simular no cambia nada');
    const r = await Rc.correr(db, corto, { ahora });
    assert.strictEqual(r.rescatados, 1);
    const oxo = await lead('Oxo');
    assert.deepStrictEqual([oxo.etapa, oxo.razon_descarte], ['nuevo', null]);
    const p = await pendientes('Oxo');
    assert.strictEqual(p.length, base.SECUENCIA_POR_DEFECTO.length, 'secuencia completa desde hoy');
    assert.strictEqual((await Rc.correr(db, corto, { ahora })).rescatados, 0, 'idempotente');
    // El hueco: con una ventana grande entra también la base vieja.
    const amplio = { ...base, RECICLAJE: { ...base.RECICLAJE, rescatar_dias: 365 } };
    assert.strictEqual((await Rc.correr(db, amplio, { ahora, simular: true })).rescatados, 1);
    assert.strictEqual((await Rc.correr(db, { ...base, RECICLAJE: { ...base.RECICLAJE, rescatar_dias: null } }, { ahora, simular: true })).rescatados, 0);
  });

  await t.test('quien ya conversó no se descarta por no contestar: reintentos y luego pausa', async () => {
    await importar(db, base, { archivo: 'c.csv', contenido: 'empresa,contacto,telefono\nHablo,Lu,3007770099', simular: false, ahora: lunes });
    const hablo = await id('Hablo');
    // Conversa ("estoy en reunión, llámame a la 1") y a la 1 no contesta: antes quedaba descartado.
    await registrarToque(db, base, { leadId: hablo, canal: 'llamada', resultado: 'conversacion', ahora: new Date('2026-11-03T16:00:00Z') });
    let r = await registrarToque(db, base, { leadId: hablo, canal: 'llamada', resultado: 'no_contesto', ahora: new Date('2026-11-03T18:00:00Z') });
    assert.notStrictEqual((await lead('Hablo')).etapa, 'descartado');
    assert.ok(r.proxima, 'tiene próximo toque');
    assert.ok(r.avisos.some(a => /Ya habían conversado: no se descarta/.test(a)), JSON.stringify(r.avisos));
    r = await registrarToque(db, base, { leadId: hablo, canal: 'llamada', resultado: 'no_contesto', ahora: new Date('2026-11-04T14:00:00Z') });
    assert.ok(r.avisos.some(a => /intento 2 de 3/.test(a)), JSON.stringify(r.avisos));
    r = await registrarToque(db, base, { leadId: hablo, canal: 'llamada', resultado: 'no_contesto', ahora: new Date('2026-11-05T14:00:00Z') });
    const l = await lead('Hablo');
    assert.strictEqual(l.razon_descarte, 'sin_avance'); assert.ok(l.pausado_hasta, 'en pausa, no descartado');
    assert.notStrictEqual(l.etapa, 'descartado');
    assert.ok(r.avisos.some(a => /3 intentos sin respuesta después de la conversación/.test(a)));
    // El hueco: 1 intento → a la primera falta sale en pausa.
    await importar(db, base, { archivo: 'd.csv', contenido: 'empresa,contacto,telefono\nHablo2,Mo,3007770098', simular: false, ahora: lunes });
    const h2 = await id('Hablo2');
    const uno = { ...base, TRAS_CONVERSACION: { ...base.TRAS_CONVERSACION, intentos_sin_respuesta: 1 } };
    await registrarToque(db, uno, { leadId: h2, canal: 'llamada', resultado: 'conversacion', ahora: new Date('2026-11-03T16:00:00Z') });
    await registrarToque(db, uno, { leadId: h2, canal: 'llamada', resultado: 'no_contesto', ahora: new Date('2026-11-03T18:00:00Z') });
    assert.strictEqual((await lead('Hablo2')).razon_descarte, 'sin_avance');
  });

  await db.end();
});

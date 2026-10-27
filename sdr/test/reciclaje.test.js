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
    const sim = await Rc.correr(db, base, { ahora, simular: true });
    assert.strictEqual(sim.sin_telefono, 1, 'SinTel');
    assert.ok(sim.secuencias_omitidas >= 1, 'el seguimiento vencido de Tres (y los de Dos)');
    assert.strictEqual(sim.huerfanos_pausados, 1, 'Tres queda sin nada → pausa (simulación cuenta igual)');
    assert.strictEqual((await lead('SinTel')).etapa, 'nuevo', 'simular no cambia nada');
    const r = await Rc.correr(db, base, { ahora });
    assert.strictEqual(r.sin_telefono, 1);
    assert.deepStrictEqual([(await lead('SinTel')).etapa, (await lead('SinTel')).razon_descarte], ['descartado', 'datos_malos']);
    assert.deepStrictEqual(await pendientes('SinTel'), []);
    const tres = await lead('Tres');
    assert.strictEqual(tres.etapa, 'conversacion'); assert.strictEqual(tres.razon_descarte, 'sin_avance'); assert.ok(tres.pausado_hasta);
    assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.touches WHERE lead_id=$1 AND canal='ejecutiva' AND resultado='pausado'`, [await id('Tres')])).rows[0].n, 1, 'rastro en el historial');
    const pozo = await lead('Pozo');
    assert.strictEqual(pozo.etapa, 'nuevo'); assert.ok((await pendientes('Pozo')).length > 0, 'al pozo no se le omite nada');
    // Dos tenía compromiso (vencido también): el compromiso no se omite, solo la secuencia.
    assert.ok((await pendientes('Dos')).some(x => x.tipo === 'seguimiento'));
    // Idempotente y una vez al día.
    const r2 = await Rc.correr(db, base, { ahora });
    assert.deepStrictEqual([r2.secuencias_omitidas, r2.huerfanos_pausados, r2.sin_telefono], [0, 0, 0]);
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

  await db.end();
});

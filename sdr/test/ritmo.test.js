const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('ritmo: bloques, racha y semana', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const ritmo = require('../ritmo');
  const base = require('../config');
  const tiempo = require('../tiempo');
  const db = conectar(url);
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  const lead = (await db.query(`INSERT INTO sdr.leads (empresa, telefono) VALUES ('ACME', '+573001234567') RETURNING id`)).rows[0];
  const config = { ...base, META_MARCACIONES_DIA: 3, META_CONVERSACIONES_DIA: 1 };
  const toque = (fecha, hora, canal, resultado) => db.query(
    `INSERT INTO sdr.touches (lead_id, canal, resultado, created_at) VALUES ($1, $2, $3, $4)`,
    [lead.id, canal, resultado, tiempo.instante(fecha, hora).toISOString()]);

  // Jue 17: 3 llamadas (cumple). Vie 18: 1 (no). Lun 21: 3 (cumple). Mar 22 (hoy): 2 en el bloque de la mañana.
  for (const h of [8, 9, 11]) await toque('2026-09-17', h, 'llamada', 'no_contesto');
  await toque('2026-09-18', 9, 'llamada', 'conversacion');
  for (const h of [8, 8, 9]) await toque('2026-09-21', h, 'llamada', 'buzon');
  await toque('2026-09-21', 9, 'llamada', 'reunion_agendada');
  await toque('2026-09-22', 8, 'llamada', 'no_contesto');
  await toque('2026-09-22', 9, 'llamada', 'conversacion');
  await toque('2026-09-22', 9, 'whatsapp', 'whatsapp');

  const martes930 = tiempo.instante('2026-09-22', 9); martes930.setMinutes(30);

  await t.test('bloque en curso y fuera de bloque', async () => {
    const b = await ritmo.bloqueActual(db, config, martes930);
    assert.strictEqual(b.enCurso.nombre, 'Bloque de la mañana');
    assert.strictEqual(b.enCurso.marcaciones, 2);
    assert.strictEqual(b.enCurso.conversaciones, 1);
    assert.strictEqual(b.enCurso.minutosRestantes, 30);
    assert.strictEqual(b.siguiente.nombre, 'Bloque de la tarde');
    const fuera = await ritmo.bloqueActual(db, config, tiempo.instante('2026-09-22', 12));
    assert.strictEqual(fuera.enCurso, null);
    assert.strictEqual(fuera.siguiente.inicio, '14:00');
    const sinBloques = await ritmo.bloqueActual(db, { ...config, BLOQUES_PROSPECCION: [] }, martes930);
    assert.deepStrictEqual(sinBloques, { enCurso: null, siguiente: null });
  });

  await t.test('racha: días hábiles seguidos, el viernes la corta', async () => {
    // Lunes cumplió; martes (hoy) aún no → racha 1. Viernes no cumplió, así que el jueves no cuenta.
    const r = await ritmo.racha(db, config, martes930);
    assert.deepStrictEqual(r, { dias: 1, hoyCumple: false });
    await toque('2026-09-22', 9, 'llamada', 'no_contesto');
    assert.strictEqual((await ritmo.racha(db, config, martes930)).dias, 2);
    // Con "cualquiera", el viernes cumple por la conversación → jue, vie, lun, mar = 4
    assert.strictEqual((await ritmo.racha(db, { ...config, RACHA_CUMPLE_CON: 'cualquiera' }, martes930)).dias, 4);
  });

  await t.test('historial de un día: toques con lead, resumen y compromisos hechos sin toque', async () => {
    // Un compromiso marcado hecho el 22 sin toque (como pasaba antes) y uno que sí dejó toque.
    const c1 = (await db.query(`INSERT INTO sdr.tasks (lead_id, paso, canal, due_at, tipo, titulo, estado, done_at, usuario) VALUES ($1, 1, 'llamada', $2, 'seguimiento', 'Llamar a Ana', 'hecha', $2, 'Angie') RETURNING id`, [lead.id, tiempo.instante('2026-09-22', 10).toISOString()])).rows[0];
    const c2 = (await db.query(`INSERT INTO sdr.tasks (lead_id, paso, canal, due_at, tipo, titulo, estado, done_at, usuario) VALUES ($1, 2, 'correo', $2, 'enviar', 'Propuesta', 'hecha', $2, 'Angie') RETURNING id`, [lead.id, tiempo.instante('2026-09-22', 11).toISOString()])).rows[0];
    await db.query(`INSERT INTO sdr.touches (lead_id, task_id, canal, resultado, nota, created_at) VALUES ($1, $2, 'correo', 'correo', 'enviada la propuesta', $3)`, [lead.id, c2.id, tiempo.instante('2026-09-22', 11).toISOString()]);
    const h = await ritmo.historialDia(db, config, { fecha: '2026-09-22' });
    assert.strictEqual(h.fecha, '2026-09-22');
    assert.deepStrictEqual(h.toques.map(x => [x.canal, x.resultado]), [['llamada', 'no_contesto'], ['llamada', 'conversacion'], ['whatsapp', 'whatsapp'], ['llamada', 'no_contesto'], ['correo', 'correo']]); // el 4.º lo metió el test de racha
    assert.strictEqual(h.toques[0].empresa, 'ACME');
    assert.strictEqual(h.toques[4].tarea_titulo, 'Propuesta');
    assert.deepStrictEqual({ ...h.resumen }, { marcaciones: 3, conversaciones: 1, reuniones: 0, whatsapp: 1, correo: 1, linkedin: 0, toques: 5, leads: 1, compromisosSinToque: 1 });
    assert.strictEqual(h.compromisosHechos[0].id, c1.id);
    assert.strictEqual(h.ayer, '2026-09-21'); assert.strictEqual(h.manana, '2026-09-23');
    // Fecha inválida → hoy; usuario que no tocó nada → vacío.
    assert.strictEqual((await ritmo.historialDia(db, config, { fecha: 'ayer' })).fecha, tiempo.fechaBogota(new Date()));
    assert.strictEqual((await ritmo.historialDia(db, config, { fecha: '2026-09-22', usuario: 'Luisa' })).toques.length, 0);
    await db.query(`DELETE FROM sdr.touches WHERE task_id = $1`, [c2.id]);
  });

  await t.test('resumen semanal', async () => {
    const s = await ritmo.resumenSemana(db, config, { fecha: '2026-09-22', ahora: martes930 });
    assert.strictEqual(s.lunes, '2026-09-21');
    assert.strictEqual(s.domingo, '2026-09-27');
    assert.strictEqual(s.dias.length, 7);
    assert.strictEqual(s.dias[0].marcaciones, 4);
    assert.strictEqual(s.dias[0].reuniones, 1);
    assert.strictEqual(s.dias[1].whatsapp, 1);
    assert.strictEqual(s.totales.marcaciones, 7);
    assert.strictEqual(s.metas.diasHabilesTranscurridos, 2);
    assert.strictEqual(s.metas.diasCumplidos, 2);
    assert.strictEqual(s.mostrarRatios, false);
    assert.strictEqual(s.ratios.tasaContacto, Math.round(3 / 11 * 100));   // 3 conversaciones / 11 marcaciones en 14 días
    assert.strictEqual(s.ratios.conversacionAReunion, Math.round(1 / 3 * 100));
    assert.strictEqual(s.ratios.reunionRealizada, null);
    assert.strictEqual(s.mejora.llamadas_evaluadas, 0); assert.strictEqual(s.mejora.foco, null);
    const anterior = await ritmo.resumenSemana(db, config, { fecha: '2026-09-18', ahora: martes930 });
    assert.strictEqual(anterior.lunes, '2026-09-14');
    assert.strictEqual(anterior.totales.marcaciones, 4);
  });

  db.end();
});

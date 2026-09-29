// Embudo de la ejecutiva contra Postgres: etapa deducida, calificar con las variables y mover.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const url = process.env.SDR_TEST_DATABASE_URL;

test('embudo de la ejecutiva', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const Em = require('../embudo');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT,
    canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, calificacion_sandler TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  Em._reiniciar();
  const ahora = new Date('2026-09-29T15:00:00Z');
  const deal = async (company, extra = {}) => (await db.query(
    `INSERT INTO public.deals (company, calificacion_sandler, outcome, canal_adquisicion, data, created_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [company, extra.cal || null, extra.outcome || 'open', extra.canal || 'referido', JSON.stringify(extra.data || {}), extra.creado || '2026-09-20T15:00:00Z'])).rows[0].id;
  const nuevo = await deal('Nuevo SA');
  const completa = await deal('Completa SA', { cal: 'Completa' });
  const ganado = await deal('Ganado SA', { cal: 'Completa', outcome: 'won' });
  // Deal de Angie con reunión que no se hizo (el lead volvió a la SDR): no ocupa el embudo.
  const noVino = await deal('No vino', { canal: 'sdr_interno' });
  await db.query(`INSERT INTO sdr.leads (empresa, etapa, deal_id) VALUES ('No vino', 'conversacion', $1)`, [noVino]);
  // Deal de Angie con reunión ya pasada.
  const angie = await deal('De Angie', { canal: 'sdr_interno' });
  const leadAngie = (await db.query(`INSERT INTO sdr.leads (empresa, contacto, etapa, reunion_at, deal_id) VALUES ('De Angie', 'Rosa', 'reunion_agendada', '2026-09-27T15:00:00Z', $1) RETURNING id`, [angie])).rows[0].id;

  let t = await Em.tablero(db, base, { ahora });   // crea las columnas del embudo en public.deals
  await db.query(`UPDATE public.deals SET closed_at = '2026-09-25T15:00:00Z' WHERE id = $1`, [ganado]);
  const en = id => Object.keys(t.columnas).find(k => t.columnas[k].some(x => x.deal_id === id));
  assert.strictEqual(en(nuevo), 'sin_calificar');
  assert.strictEqual(en(completa), 'calificado');           // deducida: la calificación alcanza
  assert.strictEqual(en(ganado), 'ganado');
  assert.strictEqual(en(noVino), undefined);
  assert.strictEqual(en(angie), 'sin_calificar');
  assert.strictEqual(t.columnas.sin_calificar.find(x => x.deal_id === angie).contacto, 'Rosa');

  // No se puede pasar a calificado ni avanzar sin las variables.
  await assert.rejects(Em.mover(db, base, { dealId: nuevo, etapa: 'calificado', usuario: 'Luisa', ahora }), /marca primero las variables/);
  await assert.rejects(Em.mover(db, base, { dealId: nuevo, etapa: 'propuesta', tipo: 'prueba', usuario: 'Luisa', ahora }), /no está calificado/);
  // Tres variables: Parcial, se queda en sin calificar con aviso.
  let r = await Em.calificar(db, base, { dealId: nuevo, items: { dolor: true, presupuesto: true, decision: true }, usuario: 'Luisa', ahora });
  assert.deepStrictEqual([r.calificacion, r.etapa], ['Parcial', 'sin_calificar']);
  assert.ok(r.avisos.some(a => /4 variables/.test(a)));
  // Las cuatro: pasa sola a calificado.
  r = await Em.calificar(db, base, { dealId: nuevo, items: { dolor: true, presupuesto: true, decision: true, fecha: true }, usuario: 'Luisa', ahora });
  assert.deepStrictEqual([r.calificacion, r.etapa], ['Completa', 'calificado']);
  // Los chulos quedan guardados (cambiar de etapa no pisa la calificación).
  let guardado = (await db.query(`SELECT data FROM public.deals WHERE id = $1`, [nuevo])).rows[0].data;
  assert.deepStrictEqual(guardado.calificacionManual.items, { dolor: true, presupuesto: true, decision: true, fecha: true });
  // Deal de Angie: la calificación marca la reunión realizada y el lead calificado.
  r = await Em.calificar(db, base, { dealId: angie, items: { dolor: true, presupuesto: true, decision: true, fecha: true }, usuario: 'Luisa', ahora });
  assert.strictEqual(r.etapa, 'calificado');
  assert.strictEqual((await db.query(`SELECT etapa FROM sdr.leads WHERE id = $1`, [leadAngie])).rows[0].etapa, 'calificado');

  // Propuesta: pide tipo; cotización deja fecha de cotización.
  await assert.rejects(Em.mover(db, base, { dealId: nuevo, etapa: 'propuesta', usuario: 'Luisa', ahora }), /prueba gratis o cotización/);
  await Em.mover(db, base, { dealId: nuevo, etapa: 'propuesta', tipo: 'cotizacion', usuario: 'Luisa', ahora });
  let fila = (await db.query(`SELECT * FROM public.deals WHERE id = $1`, [nuevo])).rows[0];
  assert.deepStrictEqual([fila.etapa_embudo, fila.propuesta_tipo, !!fila.quoted_at], ['propuesta', 'cotizacion', true]);
  await Em.mover(db, base, { dealId: nuevo, etapa: 'interesado', usuario: 'Luisa', ahora });
  // Ganado pide motivo y cierra el deal; volver atrás lo reabre.
  await assert.rejects(Em.mover(db, base, { dealId: nuevo, etapa: 'ganado', usuario: 'Luisa', ahora }), /motivo/);
  await Em.mover(db, base, { dealId: nuevo, etapa: 'ganado', motivo: 'Piloto validó la solución', usuario: 'Luisa', ahora });
  fila = (await db.query(`SELECT * FROM public.deals WHERE id = $1`, [nuevo])).rows[0];
  assert.deepStrictEqual([fila.outcome, fila.outcome_reason, !!fila.closed_at], ['won', 'Piloto validó la solución', true]);
  await Em.mover(db, base, { dealId: nuevo, etapa: 'interesado', usuario: 'Luisa', ahora });
  fila = (await db.query(`SELECT * FROM public.deals WHERE id = $1`, [nuevo])).rows[0];
  assert.deepStrictEqual([fila.outcome, fila.closed_at, fila.etapa_embudo], ['open', null, 'interesado']);
  assert.deepStrictEqual(fila.data.embudoHistorial.map(h => h.a), ['calificado', 'propuesta', 'interesado', 'ganado', 'interesado']);
  assert.strictEqual(fila.data.calificacionManual.items.fecha, true);
  // Un deal cotizado sin etapa guardada se deduce en "propuesta".
  const cotizado = await deal('Cotizado SA', { cal: 'Completa' });
  await db.query(`UPDATE public.deals SET quoted_at = NOW() WHERE id = $1`, [cotizado]);
  assert.ok((await Em.tablero(db, base, { ahora })).columnas.propuesta.some(x => x.deal_id === cotizado));
  await db.query(`DELETE FROM public.deals WHERE id = $1`, [cotizado]);
  // Perdido desde cualquier etapa (con motivo), aunque no esté calificado.
  await Em.mover(db, base, { dealId: completa, etapa: 'perdido', motivo: 'Lead sin valor (no calificaba)', usuario: 'Luisa', ahora });
  // Con minimo Parcial, 2 variables alcanzan.
  const parcialOk = { ...base, EMBUDO: { ...base.EMBUDO, minimo_calificado: 'Parcial' } };
  const otro = await deal('Otro SA');
  r = await Em.calificar(db, parcialOk, { dealId: otro, items: { dolor: true, fecha: true }, usuario: 'Luisa', ahora });
  assert.deepStrictEqual([r.calificacion, r.etapa], ['Parcial', 'calificado']);

  t = await Em.tablero(db, base, { ahora });
  assert.deepStrictEqual(t.conteo, { sin_calificar: 0, calificado: 2, propuesta: 0, interesado: 1, ganado: 1, perdido: 1 });
  // Con la regla por defecto, "Otro SA" (Parcial, movido a calificado con la otra regla) se queda donde quedó.
  assert.deepStrictEqual(t.columnas.calificado.map(x => x.empresa).sort(), ['De Angie', 'Otro SA']);
  // Un deal cerrado hace más de dias_cerrados ya no se ve.
  await db.query(`UPDATE public.deals SET closed_at = '2026-06-01T15:00:00Z' WHERE id = $1`, [ganado]);
  assert.strictEqual((await Em.tablero(db, base, { ahora })).conteo.ganado, 0);
  await db.end();
});

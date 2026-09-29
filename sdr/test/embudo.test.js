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
  // Ganado exige qué se vendió (y solo acepta los productos de la lista).
  await assert.rejects(Em.mover(db, base, { dealId: nuevo, etapa: 'ganado', motivo: 'x', usuario: 'Luisa', ahora }), /qué se vendió/);
  await assert.rejects(Em.mover(db, base, { dealId: nuevo, etapa: 'ganado', motivo: 'x', productos: ['Consultoría'], usuario: 'Luisa', ahora }), /qué se vendió/);
  const g = await Em.mover(db, base, { dealId: nuevo, etapa: 'ganado', motivo: 'Piloto validó la solución', productos: ['SaaS', 'Evaluaciones', 'Otro'], usuario: 'Luisa', ahora });
  assert.deepStrictEqual(g.productos, ['SaaS', 'Evaluaciones']);
  fila = (await db.query(`SELECT * FROM public.deals WHERE id = $1`, [nuevo])).rows[0];
  assert.deepStrictEqual([fila.outcome, fila.outcome_reason, !!fila.closed_at, fila.productos], ['won', 'Piloto validó la solución', true, 'SaaS, Evaluaciones']);
  assert.deepStrictEqual((await Em.tablero(db, base, { ahora })).columnas.ganado.find(x => x.deal_id === nuevo).productos, ['SaaS', 'Evaluaciones']);
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

  // Cotización: se guarda como texto, lleva el deal a propuesta y el análisis compara con el demo.
  const cot = await deal('Cotizar SA', { cal: 'Completa', data: { dolor: 'Vacante de desarrollador abierta hace 4 meses', presupuesto: '3 millones al mes', idealRequests: [{ text: 'candidatos en 48 horas', weHave: true }] } });
  await assert.rejects(Em.guardarCotizacion(db, base, { dealId: cot, archivo: 'p.txt', texto: 'corta', usuario: 'Luisa', ahora }), /casi vacío/);
  const texto = 'Propuesta comercial Peaku\r\n\r\n\r\nPlan SaaS mensual: 2.5 millones. Incluye publicación ilimitada y terna en 48 horas. Sin cláusula de permanencia.';
  const gc = await Em.guardarCotizacion(db, base, { dealId: cot, archivo: 'propuesta.txt', base64: Buffer.from(texto).toString('base64'), usuario: 'Luisa', ahora });
  assert.strictEqual(gc.archivo, 'propuesta.txt');
  let c = await Em.cotizacion(db, cot);
  assert.ok(c.cotizacion.texto.startsWith('Propuesta comercial Peaku\n\nPlan'));
  assert.ok(/Dolor principal: Vacante/.test(c.pedido) && /candidatos en 48 horas/.test(c.pedido));
  fila = (await db.query(`SELECT etapa_embudo, propuesta_tipo, quoted_at FROM public.deals WHERE id = $1`, [cot])).rows[0];
  assert.deepStrictEqual([fila.etapa_embudo, fila.propuesta_tipo, !!fila.quoted_at], ['propuesta', 'cotizacion', true]);
  assert.ok((await Em.tablero(db, base, { ahora })).columnas.propuesta.find(x => x.deal_id === cot).cotizacion.archivo === 'propuesta.txt');
  // Análisis con una IA falsa.
  const ia = { messages: { create: async ({ messages }) => { assert.ok(/Plan SaaS mensual/.test(messages[0].content) && /Vacante de desarrollador/.test(messages[0].content)); return { model: 'falso', content: [{ text: '```json\n{"cubre":["terna en 48 horas"],"falta":["no habla del dolor de 4 meses"],"sobra":[],"precio":"2.5M dentro de los 3M","riesgos":[],"ajustes":["anclar el precio al costo de la vacante"],"alineacion":72,"resumen":"Alineada; falta el ancla."}\n```' }] }; } } };
  await assert.rejects(Em.analizarCotizacion(db, base, null, { dealId: cot, usuario: 'Luisa', ahora }), /ANTHROPIC_API_KEY/);
  const an = await Em.analizarCotizacion(db, base, ia, { dealId: cot, usuario: 'Luisa', ahora });
  assert.deepStrictEqual([an.alineacion, an.cubre[0], an.por], [72, 'terna en 48 horas', 'Luisa']);
  c = await Em.cotizacion(db, cot);
  assert.strictEqual(c.analisis.alineacion, 72);
  // Subir otra cotización borra el análisis viejo.
  await Em.guardarCotizacion(db, base, { dealId: cot, archivo: 'v2.txt', texto: texto + ' Versión 2 con ancla de precio contra la vacante abierta.', usuario: 'Luisa', ahora });
  assert.strictEqual((await Em.cotizacion(db, cot)).analisis, null);
  // Sin demo ni ficha no hay contra qué comparar.
  const vacio = await deal('Vacío SA', { cal: 'Completa' });
  await Em.guardarCotizacion(db, base, { dealId: vacio, archivo: 'x.txt', texto: texto, usuario: 'Luisa', ahora });
  await assert.rejects(Em.analizarCotizacion(db, base, ia, { dealId: vacio, usuario: 'Luisa', ahora }), /no tiene el demo/);
  await db.end();
});

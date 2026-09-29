// Tablero de la ejecutiva: regla de calificación con chulos manuales y el guardado contra Postgres.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const CAL = require('../calificacion');
const url = process.env.SDR_TEST_DATABASE_URL;

test('calificación: formulario del Sandler, chulos manuales y fusión al completar el demo', () => {
  assert.strictEqual(CAL.calificacionSandler({}).label, 'No califica');
  const form = { dolorCuantificar: 'x', dolorHistoria: 'y', presupuesto: '10M', decisor: 'Gerente', procesoDecision: 'Comité', fechaLimiteDecision: '2026-10-30' };
  assert.strictEqual(CAL.calificacionSandler(form).label, 'Completa');
  assert.deepStrictEqual(CAL.calificacionSandler(form).fuente, { dolor: 'sandler', presupuesto: 'sandler', decision: 'sandler', fecha: 'sandler' });
  // Solo un punto del embudo del dolor no alcanza.
  assert.strictEqual(CAL.calificacionSandler({ dolorImpacto: 'z', presupuesto: 'x' }).items.dolor, false);
  // Manual manda: 4 chulos sin formulario = Completa; un "no" manual baja una del formulario.
  const man = items => ({ calificacionManual: { items, por: 'Luisa' } });
  assert.strictEqual(CAL.calificacionSandler(man({ dolor: true, presupuesto: true, decision: true, fecha: true })).label, 'Completa');
  const mixto = CAL.calificacionSandler({ ...form, ...man({ presupuesto: false }) });
  assert.strictEqual(mixto.label, 'Parcial');
  assert.strictEqual(mixto.fuente.presupuesto, 'manual');
  assert.strictEqual(mixto.fuente.dolor, 'sandler');
  // Compatibilidad con server.js.
  assert.ok('dolorOk' in mixto && 'budget' in mixto && 'decision' in mixto && 'fecha' in mixto);
  // Al completar el demo: la marca guardada se conserva si el formulario no trae el criterio;
  // si lo trae, la evidencia escrita gana.
  const guardado = man({ dolor: true, presupuesto: false, decision: true, fecha: false });
  const f = CAL.fusionarAlCompletar({ presupuesto: '5M', decisor: 'a' }, guardado);
  assert.deepStrictEqual(f.calificacionManual.items, { dolor: true, decision: true, fecha: false });
  assert.strictEqual(CAL.calificacionSandler(f).label, 'Parcial');   // dolor (manual) + presupuesto (form) + decisión (manual)
  assert.strictEqual(CAL.fusionarAlCompletar(form, man({ dolor: true, presupuesto: true, decision: true, fecha: true })).calificacionManual, undefined);
  assert.deepStrictEqual(CAL.fusionarAlCompletar({ a: 1 }, {}), { a: 1 });
});

test('tablero de la ejecutiva y chulos contra la base', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const E = require('../ejecutiva');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT, canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, outcome_reason TEXT, quoted_at TIMESTAMPTZ, calificacion_sandler TEXT)`);
  const ahora = new Date('2026-09-24T15:00:00Z');
  const lead = async (empresa, reunion, { etapa = 'reunion_agendada', deal = true, cal = null, noShow = false, outcome = 'open', agendada = '2026-09-05T15:00:00Z' } = {}) => {
    const d = deal ? (await db.query(`INSERT INTO public.deals (company, calificacion_sandler, outcome, data) VALUES ($1, $2, $3, '{}') RETURNING id`, [empresa, cal, outcome])).rows[0].id : null;
    const l = (await db.query(`INSERT INTO sdr.leads (empresa, contacto, cargo, etapa, reunion_at, deal_id) VALUES ($1, 'Ana', 'Gerente RRHH', $2, $3, $4) RETURNING id`, [empresa, etapa, reunion, d])).rows[0].id;
    await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'llamada', 'reunion_agendada', 'Angie', $2)`, [l, agendada]);
    if (noShow) await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'ejecutiva', 'no_show', 'Luisa', '2026-09-08T15:00:00Z')`, [l]);
    return l;
  };
  const pasada = await lead('Pasada', '2026-09-20T15:00:00Z');
  const futura = await lead('Futura', '2026-09-29T15:00:00Z');
  const sinDeal = await lead('Sin deal', '2026-09-21T15:00:00Z', { deal: false });
  await lead('Ganada', '2026-09-10T15:00:00Z', { etapa: 'calificado', cal: 'Completa', outcome: 'won' });
  await lead('No vino', '2026-09-12T15:00:00Z', { etapa: 'conversacion', noShow: true });
  await lead('Agosto', '2026-08-20T15:00:00Z', { agendada: '2026-08-10T15:00:00Z' });

  let t = await E.tablero(db, base, { mes: '2026-09', ahora });
  const de = e => t.reuniones.find(x => x.empresa === e);
  assert.strictEqual(t.kpis.reuniones, 5);
  assert.deepStrictEqual([t.kpis.por_calificar, t.kpis.programadas, t.kpis.no_asistio, t.kpis.completas, t.kpis.ganadas], [2, 1, 1, 1, 1]);
  assert.strictEqual(t.kpis.dias_pendiente_mas_vieja, 4);        // la del 20
  assert.deepStrictEqual(t.pendientes_anteriores, [{ mes: '2026-08', n: 1 }]);
  assert.strictEqual(t.reuniones[0].estado, 'por_calificar');    // lo pendiente primero
  assert.strictEqual(de('Pasada').puede_calificar, true);
  assert.strictEqual(de('Futura').puede_calificar, false);
  assert.strictEqual(de('No vino').puede_calificar, false);
  assert.strictEqual(de('Pasada').cargo, 'Gerente RRHH');
  assert.strictEqual(t.comision.calificadas, 1);

  // Futura y no-show: no se califican.
  await assert.rejects(E.calificar(db, base, { leadId: futura, items: { dolor: true }, usuario: 'Luisa', ahora }), /todavía no ha pasado/);
  await assert.rejects(E.calificar(db, base, { leadId: de('No vino').lead_id, items: {}, usuario: 'Luisa', ahora }), /no se hizo/);

  // Dos chulos: Parcial, y la reunión queda realizada.
  let r = await E.calificar(db, base, { leadId: pasada, items: { dolor: true, decision: true }, usuario: 'Luisa', ahora });
  assert.strictEqual(r.calificacion, 'Parcial');
  assert.strictEqual(r.etapa, 'reunion_realizada');
  assert.ok(r.avisos.some(a => /realizada/.test(a)));
  const deal = (await db.query(`SELECT d.* FROM public.deals d JOIN sdr.leads l ON l.deal_id = d.id WHERE l.id = $1`, [pasada])).rows[0];
  assert.strictEqual(deal.calificacion_sandler, 'Parcial');
  assert.deepStrictEqual(deal.data.calificacionManual.items, { dolor: true, presupuesto: false, decision: true, fecha: false });
  assert.strictEqual(deal.data.calificacionManual.por, 'Luisa');
  assert.strictEqual(deal.executive, 'Luisa');
  // Los 4: Completa → lead calificado y cuenta para la comisión.
  r = await E.calificar(db, base, { leadId: pasada, items: { dolor: true, presupuesto: true, decision: true, fecha: true }, usuario: 'Luisa', ahora });
  assert.deepStrictEqual([r.calificacion, r.etapa], ['Completa', 'calificado']);
  t = await E.tablero(db, base, { mes: '2026-09', ahora });
  assert.strictEqual(t.comision.calificadas, 2);
  assert.strictEqual(de('Pasada').estado, 'calificada');
  assert.strictEqual(de('Pasada').fuente.presupuesto, 'manual');
  // Quita uno: vuelve a realizada (sin calificar como Completa).
  r = await E.calificar(db, base, { leadId: pasada, items: { dolor: true, presupuesto: true, decision: true }, usuario: 'Luisa', ahora });
  assert.deepStrictEqual([r.calificacion, r.etapa], ['Parcial', 'reunion_realizada']);
  // Quitar la calificación: vuelve a "por calificar".
  r = await E.calificar(db, base, { leadId: pasada, limpiar: true, usuario: 'Luisa', ahora });
  assert.strictEqual(r.calificacion, null);
  t = await E.tablero(db, base, { mes: '2026-09', ahora });
  assert.strictEqual(de('Pasada').estado, 'por_calificar');
  assert.strictEqual(de('Pasada').realizada, true);

  // Sin deal: se crea en el Sandler al calificar.
  r = await E.calificar(db, base, { leadId: sinDeal, items: { dolor: true, presupuesto: true, decision: true, fecha: true }, usuario: 'Luisa', ahora });
  assert.ok(r.deal_id);
  assert.ok(r.avisos.some(a => /deal/.test(a)));
  assert.strictEqual((await db.query(`SELECT deal_id FROM sdr.leads WHERE id = $1`, [sinDeal])).rows[0].deal_id, r.deal_id);
  await db.end();
});

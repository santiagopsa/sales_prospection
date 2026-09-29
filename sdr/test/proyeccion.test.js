// Proyección de la silla: el plan por mes (rampa, llamadas del modelo, costo) y lo real contra la base.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const P = require('../proyeccion');
const url = process.env.SDR_TEST_DATABASE_URL;

const cfg = { ...base, PROYECCION: { ...base.PROYECCION, inicio: '2026-09' } };

test('plan de la silla por mes', () => {
  assert.strictEqual(P.plan(cfg, '2026-08'), null);
  const m1 = P.plan(cfg, '2026-09'), m4 = P.plan(cfg, '2026-12');
  assert.deepStrictEqual([m1.numero, m1.rampa, m1.calificadas, m1.llamadas, m1.costo], [1, 0.25, 3.75, 3780, 1805]);
  assert.deepStrictEqual([m4.numero, m4.rampa, m4.calificadas, m4.costo], [4, 1, 15, 2312]);
  assert.strictEqual(P.plan(cfg, '2027-03').costo, 2312);              // a régimen se repite el último
  assert.strictEqual(m4.clientes, 1.5);
  assert.strictEqual(m4.ingreso_contratado, 1.5 * 200 * 12);
  assert.strictEqual(m4.comision, 345);                                // 15 calificadas × 23 (escalón hasta 15)
  assert.strictEqual(P.diasHabiles('2026-09'), 22);
  assert.strictEqual(P.diasHabiles('2026-09', '2026-09-29'), 21);
});

test('seguimiento contra la base', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', calificacion_sandler TEXT, outcome TEXT, canal_adquisicion TEXT, closed_at TIMESTAMPTZ)`);
  const ahora = new Date('2026-09-29T20:00:00Z');   // martes 29 · 21 de 22 días hábiles
  // Septiembre: 40 llamadas repartidas en 2 días, 3 reuniones agendadas (2 Completa, 1 sin calificar), 1 cliente ganado.
  const lead = async (empresa, cal, reunion) => {
    const deal = (await db.query(`INSERT INTO public.deals (company, calificacion_sandler, outcome, canal_adquisicion, closed_at) VALUES ($1, $2, $3, 'sdr_interno', $4) RETURNING id`,
      [empresa, cal, cal === 'Completa' && empresa === 'Ganada' ? 'won' : 'open', empresa === 'Ganada' ? '2026-09-28T15:00:00Z' : null])).rows[0].id;
    const l = (await db.query(`INSERT INTO sdr.leads (empresa, etapa, reunion_at, deal_id) VALUES ($1, 'reunion_agendada', $2, $3) RETURNING id`, [empresa, reunion, deal])).rows[0].id;
    await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'llamada', 'reunion_agendada', 'Angie', '2026-09-22T15:00:00Z')`, [l]);
    return l;
  };
  await lead('Ganada', 'Completa', '2026-09-24T15:00:00Z');
  await lead('Completa 2', 'Completa', '2026-09-25T15:00:00Z');
  await lead('Pendiente', null, '2026-09-26T15:00:00Z');
  const otro = (await db.query(`INSERT INTO sdr.leads (empresa, etapa) VALUES ('Relleno', 'contactado') RETURNING id`)).rows[0].id;
  for (let i = 0; i < 37; i++) await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'llamada', 'no_contesto', 'Angie', $2)`, [otro, i < 20 ? '2026-09-22T16:00:00Z' : '2026-09-23T16:00:00Z']);
  // Toques de otra persona no cuentan.
  await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'llamada', 'no_contesto', 'Luisa', '2026-09-23T16:00:00Z')`, [otro]);

  const r = await P.seguimiento(db, cfg, { ahora });
  assert.strictEqual(r.usuario, 'Angie');
  assert.strictEqual(r.meses.length, 1);
  const m = r.meses[0];
  assert.strictEqual(m.en_curso, true);
  assert.deepStrictEqual([m.real.llamadas, m.real.agendadas, m.real.calificadas, m.real.por_calificar, m.real.ganados, m.real.dias_activos], [40, 3, 2, 1, 1, 2]);
  assert.strictEqual(m.real.comision, 46);
  assert.strictEqual(m.real.ingreso_contratado, 2400);
  assert.deepStrictEqual([m.real.habiles_mes, m.real.habiles_transcurridos], [22, 21]);
  assert.strictEqual(m.ritmo.llamadas, Math.round(40 * 22 / 21));
  assert.strictEqual(m.cumplimiento, Math.round(2 / 3.75 * 100));
  assert.deepStrictEqual([r.acumulado.plan_calificadas, r.acumulado.real_calificadas, r.acumulado.real_clientes], [3.75, 2, 1]);
  // Pidiendo hasta octubre aparece el mes 2 con plan y real en cero.
  const r2 = await P.seguimiento(db, cfg, { ahora, hasta: '2026-10' });
  assert.strictEqual(r2.meses.length, 2);
  assert.deepStrictEqual([r2.meses[1].plan.rampa, r2.meses[1].real.llamadas, r2.meses[1].ritmo], [0.5, 0, null]);
  await db.end();
});

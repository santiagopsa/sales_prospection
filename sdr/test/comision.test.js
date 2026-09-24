// Comisión por reuniones calificadas: cálculo por escalón y por tramos, y el resumen del mes contra
// Postgres con la calificación del Sandler Coach (public.deals).
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const C = require('../comision');
const url = process.env.SDR_TEST_DATABASE_URL;

test('comisión: escalón (todo el mes al tramo alcanzado) y por tramos', () => {
  const tramos = { ...base, COMISION: { ...base.COMISION, modo: 'tramos' } };
  // 0-14 a 23, 15-29 a 30, 30+ a 40
  const casos = [[0, 0, 0], [7, 161, 161], [14, 322, 322], [15, 450, 352], [20, 600, 502], [29, 870, 772], [30, 1200, 812], [35, 1400, 1012]];
  for (const [n, esc, tr] of casos) {
    assert.strictEqual(C.calcular(base, n).total, esc, `escalón con ${n}`);
    assert.strictEqual(C.calcular(tramos, n).total, tr, `tramos con ${n}`);
  }
  const k = C.calcular(base, 14);
  assert.strictEqual(k.tramo.valor, 23);
  assert.deepStrictEqual([k.siguiente.valor, k.siguiente.faltan, k.siguiente.total_al_llegar], [30, 1, 450]);
  assert.strictEqual(k.proxima_vale, 128);               // la 15.ª sube las 14 anteriores
  assert.strictEqual(C.calcular(base, 30).siguiente, null);
  assert.throws(() => C.calcular({ ...base, COMISION: { tramos: [{ desde: 5, valor: 1 }] } }, 1), /desde 0/);
  assert.deepStrictEqual(C.limitesMes('2026-12'), { mes: '2026-12', inicio: '2026-12-01', siguiente: '2027-01-01', anterior: '2026-11', posterior: '2027-01' });
});

test('comisión del mes contra la base', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', calificacion_sandler TEXT, outcome TEXT)`);
  const ahora = new Date('2026-09-24T15:00:00Z');
  // lead, reunión, quién agendó, calificación en el Sandler, no-show
  const casos = [
    ['Completa SA', '2026-09-10T15:00:00Z', 'Angie', 'Completa'],
    ['Completa 2', '2026-09-12T15:00:00Z', 'Angie', 'completa'],
    ['Parcial SA', '2026-09-15T15:00:00Z', 'Angie', 'Parcial'],
    ['Pasada sin calificar', '2026-09-20T15:00:00Z', 'Angie', null],
    ['Futura', '2026-09-29T15:00:00Z', 'Angie', null],
    ['No vino', null, 'Angie', null, true],
    ['Octubre', '2026-10-02T15:00:00Z', 'Angie', 'Completa'],
    ['De Luisa', '2026-09-11T15:00:00Z', 'Luisa', 'Completa'],
  ];
  for (const [empresa, reunion, quien, cal, noShow] of casos) {
    const deal = (await db.query(`INSERT INTO public.deals (executive, company, calificacion_sandler) VALUES ('Luisa', $1, $2) RETURNING id`, [empresa, cal])).rows[0].id;
    const l = (await db.query(`INSERT INTO sdr.leads (empresa, etapa, reunion_at, deal_id) VALUES ($1, 'reunion_agendada', $2, $3) RETURNING id`, [empresa, reunion, deal])).rows[0].id;
    await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'llamada', 'reunion_agendada', $2, '2026-09-05T15:00:00Z')`, [l, quien]);
    if (noShow) await db.query(`INSERT INTO sdr.touches (lead_id, canal, resultado, usuario, created_at) VALUES ($1, 'ejecutiva', 'no_show', 'Luisa', '2026-09-08T15:00:00Z')`, [l]);
  }
  const r = await C.resumenMes(db, base, { mes: '2026-09', usuario: 'Angie', ahora });
  const estado = e => r.reuniones.find(x => x.empresa === e).estado;
  assert.strictEqual(r.usuario, 'Angie');
  assert.deepStrictEqual(r.reuniones.map(x => x.empresa).sort(), ['Completa 2', 'Completa SA', 'Futura', 'No vino', 'Parcial SA', 'Pasada sin calificar']);
  assert.strictEqual(estado('Completa SA'), 'calificada');
  assert.strictEqual(estado('Completa 2'), 'calificada');       // sin importar mayúsculas
  assert.strictEqual(estado('Parcial SA'), 'no_califica');      // califica_con = ['Completa']
  assert.strictEqual(estado('Pasada sin calificar'), 'por_calificar');
  assert.strictEqual(estado('Futura'), 'programada');
  assert.strictEqual(estado('No vino'), 'no_asistio');           // sin fecha: cuenta por el día en que se agendó
  assert.deepStrictEqual(r.conteo, { reuniones: 6, calificadas: 2, no_califica: 1, no_asistio: 1, canceladas: 0, programadas: 1, por_calificar: 1 });
  assert.strictEqual(r.comision.total, 46);
  assert.strictEqual(r.potencial.total, 92);                    // + la futura y la pendiente
  // Con Parcial también: 3 calificadas.
  const conParcial = await C.resumenMes(db, { ...base, COMISION: { ...base.COMISION, califica_con: ['Completa', 'Parcial'] } }, { mes: '2026-09', usuario: 'Angie', ahora });
  assert.strictEqual(conParcial.conteo.calificadas, 3);
  // Por mes de agenda: la de octubre cuenta en septiembre (se agendó el 5).
  const porAgenda = await C.resumenMes(db, { ...base, COMISION: { ...base.COMISION, mes_por: 'agendada' } }, { mes: '2026-09', usuario: 'Angie', ahora });
  assert.strictEqual(porAgenda.conteo.calificadas, 3);
  // Quien no es SDR ve al equipo SDR (Angie), no lo de Luisa.
  const equipo = await C.resumenMes(db, base, { mes: '2026-09', usuario: 'Santiago', ahora });
  assert.strictEqual(equipo.usuario, null);
  assert.strictEqual(equipo.conteo.reuniones, 6);
  // Octubre
  assert.strictEqual((await C.resumenMes(db, base, { mes: '2026-10', usuario: 'Angie', ahora })).conteo.calificadas, 1);
  // Sin la tabla del Sandler: nada calificado, no revienta.
  await db.query('DROP TABLE public.deals');
  const sinSandler = await C.resumenMes(db, base, { mes: '2026-09', usuario: 'Angie', ahora });
  assert.strictEqual(sinSandler.conteo.calificadas, 0);
  await db.end();
});

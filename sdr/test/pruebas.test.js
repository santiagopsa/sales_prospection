// Pruebas gratis contra Postgres: de la bandera de Wei (verificacion.ops_*) al embudo de Luisa.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const P = require('../pruebas');
const url = process.env.SDR_TEST_DATABASE_URL;

test('mismaEmpresa cruza nombres de Wei y de Luisa', () => {
  assert.ok(P.mismaEmpresa('alpina', 'alpina'));
  assert.ok(P.mismaEmpresa('alpina productos', 'alpina'));
  assert.ok(!P.mismaEmpresa('alpinista', 'alpina'));
  assert.ok(!P.mismaEmpresa(null, 'alpina'));
});

test('los hitos salen de las columnas o, en los de antes, del historial', () => {
  const h = P.hitos({ prueba_ms: null, quoted_ms: null, created_ms: 1, historial: [
    { a: 'calificado', at: '2026-09-01T00:00:00Z' },
    { a: 'propuesta', tipo: 'prueba', at: '2026-09-02T00:00:00Z' },
    { a: 'propuesta', tipo: 'cotizacion', at: '2026-09-12T00:00:00Z' }] });
  assert.strictEqual(new Date(h.inicio).toISOString().slice(0, 10), '2026-09-02');
  assert.strictEqual(new Date(h.cotizada).toISOString().slice(0, 10), '2026-09-12');
  // Una cotización de ANTES de la prueba no cuenta como paso a cotización.
  const h2 = P.hitos({ prueba_ms: Date.parse('2026-09-10'), quoted_ms: Date.parse('2026-09-05'), historial: [] });
  assert.strictEqual(h2.cotizada, null);
});

test('pruebas: cuáles se convierten, y lo que Wei tiene en prueba', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const Em = require('../embudo');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  process.env.VERIF_SCHEMA = 'verif_pruebas';
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await db.query('DROP SCHEMA IF EXISTS verif_pruebas CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT,
    canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, calificacion_sandler TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  Em._reiniciar();
  const deal = async (company, extra = {}) => (await db.query(
    `INSERT INTO public.deals (company, calificacion_sandler, outcome, canal_adquisicion, data, created_at) VALUES ($1,'Completa','open','referido',$2,'2026-09-01T15:00:00Z') RETURNING id`,
    [company, JSON.stringify(extra.data || {})])).rows[0].id;

  // Sin las tablas de Wei, el embudo y el resumen funcionan igual.
  let t = await Em.tablero(db, base, { ahora: new Date('2026-09-02T15:00:00Z') });
  assert.ok(t.pruebas && t.pruebas.total === 0 && t.pruebas.sin_deal.length === 0);

  const alpina = await deal('Alpina S.A.S.');
  const nutresa = await deal('Nutresa');
  const rappi = await deal('Rappi');
  const quieta = await deal('Quieta Ltda');
  const vieja = await deal('Vieja', { data: { embudoHistorial: [{ a: 'propuesta', tipo: 'prueba', at: '2026-08-01T15:00:00Z' }] } });
  const mover = (id, etapa, at, extra = {}) => Em.mover(db, base, { dealId: id, etapa, usuario: 'Luisa', ahora: new Date(at), ...extra });

  await mover(alpina, 'propuesta', '2026-09-03T15:00:00Z', { tipo: 'prueba' });
  await mover(alpina, 'propuesta', '2026-09-10T15:00:00Z', { tipo: 'cotizacion' });
  await mover(alpina, 'ganado', '2026-09-20T15:00:00Z', { motivo: 'Piloto validó la solución', productos: ['Headhunting'] });
  await mover(nutresa, 'propuesta', '2026-09-05T15:00:00Z', { tipo: 'prueba' });
  await mover(nutresa, 'perdido', '2026-09-15T15:00:00Z', { motivo: 'Precio / presupuesto' });
  await mover(rappi, 'propuesta', '2026-09-25T15:00:00Z', { tipo: 'prueba' });
  await mover(quieta, 'propuesta', '2026-09-01T15:00:00Z', { tipo: 'prueba' });
  await db.query(`UPDATE public.deals SET outcome = 'won', closed_at = '2026-08-20T15:00:00Z', etapa_embudo = 'ganado' WHERE id = $1`, [vieja]);
  // prueba_at no se borra al pasar a cotización ni al ganar.
  assert.ok((await db.query(`SELECT prueba_at FROM public.deals WHERE id = $1`, [alpina])).rows[0].prueba_at);

  // Lo de Wei: una tabla de Operaciones con la bandera, como la crea /verificacion.
  await db.query('CREATE SCHEMA verif_pruebas');
  await db.query(`CREATE TABLE verif_pruebas.ops_procesos (id SERIAL PRIMARY KEY, empresa TEXT, cargo TEXT, etapa TEXT, activado DATE,
    primer_envio DATE, ultimo_envio DATE, fecha_cierre DATE, prueba BOOLEAN DEFAULT FALSE)`);
  await db.query(`INSERT INTO verif_pruebas.ops_procesos (empresa, cargo, etapa, activado, primer_envio, prueba) VALUES
    ('Rappi', 'Data Engineer', 'Terna enviada', '2026-09-24', '2026-09-25', TRUE),
    ('Rappi', 'Backend', 'Reclutamiento', '2026-09-24', NULL, FALSE),
    ('Movizzon', 'QA', 'Reclutamiento', '2026-09-26', NULL, TRUE)`);
  const movizzon = await deal('Movizzon');   // calificado, sin prueba: Luisa no la está siguiendo

  t = await Em.tablero(db, base, { ahora: new Date('2026-09-30T15:00:00Z') });
  const r = t.pruebas;
  assert.strictEqual(r.total, 5);
  const de = id => r.pruebas.find(p => p.deal_id === id);
  assert.strictEqual(de(alpina).estado, 'ganado');
  assert.strictEqual(de(alpina).dias_a_cotizacion, 7);
  assert.strictEqual(de(alpina).dias_a_cliente, 17);
  assert.strictEqual(de(nutresa).estado, 'perdido');
  assert.strictEqual(de(nutresa).llego_a_cotizacion, false);
  assert.strictEqual(de(rappi).estado, 'prueba');
  assert.strictEqual(de(rappi).dias_en_prueba, 5);
  assert.strictEqual(de(rappi).operacion.length, 1, 'solo lo que Wei marcó en prueba');
  assert.strictEqual(de(rappi).operacion[0].estado, 'Terna enviada');
  assert.strictEqual(de(quieta).quieta, true, `${base.EMBUDO.prueba_alerta_dias}+ días sin moverse`);
  assert.strictEqual(de(vieja).estado, 'ganado', 'las de antes de prueba_at salen del historial');
  assert.strictEqual(r.en_prueba, 2);
  assert.strictEqual(r.quietas, 1);
  assert.deepStrictEqual(r.conversion_cerradas, { n: 2, de: 3, pct: 67 });
  assert.strictEqual(r.a_cotizacion.n, 2);   // alpina y vieja (ganada)
  assert.strictEqual(r.pruebas[0].estado, 'prueba', 'las que van, arriba');
  // Wei tiene a Movizzon en prueba y Luisa no: sale aparte, con su deal para pasarlo a prueba.
  assert.strictEqual(r.sin_deal.length, 1);
  assert.strictEqual(r.sin_deal[0].empresa, 'Movizzon');
  assert.strictEqual(r.sin_deal[0].deal.deal_id, movizzon);
  assert.strictEqual(r.sin_deal[0].deal.etapa, 'calificado');
  // La tarjeta del embudo trae lo de Wei y si fue prueba.
  const card = Object.values(t.columnas).flat().find(x => x.deal_id === rappi);
  assert.strictEqual(card.fue_prueba, true);
  assert.strictEqual(card.operacion[0].cargo, 'Data Engineer');
  await db.query('DROP SCHEMA IF EXISTS verif_pruebas CASCADE');
  delete process.env.VERIF_SCHEMA;
  await db.end();
});

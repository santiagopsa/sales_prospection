// El SQL de operaciones contra un Postgres de verdad (local y desechable). Se salta si no hay
// uno: PG_PRUEBA="host=/tmp/pgt port=5499 user=postgres" node test/ops_pg.test.js
const assert = require('assert');
const { crearPool } = require('./pg_psql');
const OPS = require('../ops');
const CX = process.env.PG_PRUEBA;
if (!CX) { console.log('ops_pg: sin PG_PRUEBA, se salta'); process.exit(0); }
let n = 0;
const t = async (nombre, fn) => { await fn(); n++; console.log('  ✓', nombre); };
(async () => {
  const pool = crearPool(CX);
  const schema = 'prueba_ops_' + Date.now();
  console.log('operaciones sobre Postgres');
  const ops = OPS.crearOps({ pool, schema });
  await t('crea las tablas e importa la semilla una sola vez', async () => {
    await ops.init();
    assert.strictEqual(await ops.contar('procesos'), 87);
    assert.strictEqual(await ops.contar('saas'), 212);
    assert.strictEqual(await ops.contar('evaluaciones'), 39);
    await ops.init();                                    // un reinicio no duplica
    assert.strictEqual(await ops.contar('procesos'), 87);
  });
  await t('las fechas salen como AAAA-MM-DD y los cálculos funcionan con lo importado', async () => {
    const ps = await ops.listar('procesos');
    const p = ps.find(x => x.activado);
    assert.match(p.activado, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(ps.every(x => typeof x.dias_sin_movimiento === 'number'));
    const ss = await ops.listar('saas');
    assert.ok(ss.some(s => s.meta_at && /^\d{4}-\d{2}-\d{2}$/.test(s.meta_at)));
  });
  await t('crear, editar con reglas, tier por empresa y borrar', async () => {
    const a = (await ops.crear('procesos', { empresa: 'Prueba SA', cargo: 'Uno', etapa: 'Reclutamiento', tier: 'Mediano' })).fila;
    const b = (await ops.crear('procesos', { empresa: 'prueba sa', cargo: 'Dos', etapa: 'Reclutamiento' })).fila;
    assert.strictEqual(b.tier, 'Mediano');
    const r = await ops.actualizar('procesos', a.id, { tier: 'Alto', etapa: 'Cancelado', notas: "con 'comillas' y $1" });
    assert.deepStrictEqual(r.tambien, [b.id]);
    assert.ok(r.fila.fecha_cierre); assert.strictEqual(r.fila.notas, "con 'comillas' y $1");
    const e = (await ops.crear('evaluaciones', { empresa: 'X', cargo: 'Y', estado: 'En evaluación', evaluados: 4 })).fila;
    assert.strictEqual((await ops.actualizar('evaluaciones', e.id, { aprobados: 5 })).error, 'Aprobados no puede ser mayor que evaluados.');
    assert.strictEqual((await ops.actualizar('evaluaciones', e.id, { aprobados: 2 })).fila.pct_aprobacion, 50);
    const s = (await ops.crear('saas', { cliente: 'C', peaku_id: '1', estado: 'Activa', meta: 2, destacados: 1 })).fila;
    const s2 = (await ops.actualizar('saas', s.id, { destacados: 2 })).fila;
    assert.ok(s2.meta_at); assert.strictEqual(s2.salud, 'verde');
    assert.strictEqual(await ops.borrar('procesos', b.id), true);
  });
  await pool.query(`DROP SCHEMA ${schema} CASCADE`);
  console.log(`\n${n} pruebas · todo en verde`);
})().catch(e => { console.error(e); process.exit(1); });

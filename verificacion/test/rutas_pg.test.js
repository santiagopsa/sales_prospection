// Las rutas REALES contra un Postgres local y desechable: migraciones, descartar/recuperar, listas,
// tablero, vacante, indicadores y operaciones. Se salta sin PG_PRUEBA.
if (!process.env.PG_PRUEBA) { console.log('rutas_pg: sin PG_PRUEBA, se salta'); process.exit(0); }
const assert = require('assert');
const Module = require('module');
const rutas = {};
const fx = () => ({}); fx.Router = () => { const r = {}; for (const m of ['get','post','patch','delete','use','all']) r[m] = (p, ...f) => { if (typeof p === 'string') rutas[`${m.toUpperCase()} ${p}`] = f[f.length-1]; return r; }; return r; };
fx.json = () => (q,s,n)=>n(); fx.static = () => (q,s,n)=>n();
const orig = Module._load; Module._load = function (r, ...x) { if (r === 'express') return fx; return orig.call(this, r, ...x); };
process.env.VERIF_SCHEMA = 'pv_' + Date.now();
const { crearPool } = require('./pg_psql');
const pool = crearPool(process.env.PG_PRUEBA);
const { router, initSchema } = require('../app');
const llamar = (k, params, body, query={}) => new Promise(ok => { const res = { statusCode:200, status(c){this.statusCode=c;return this;}, json(j){ok({status:this.statusCode, body:j});}, end(){ok({status:this.statusCode});} }; Promise.resolve(rutas[k]({params, body: body||{}, query}, res)).catch(e => ok({status:500, body:{error:e.message}})); });
(async () => {
  await initSchema(pool);
  router({ pool, anthropic: null, model: 'x' });
  const c = await llamar('POST /api/vacancies', {}, { empresa:{nombre:'Movizzon'}, vacante:{titulo:'Data'}, excluyentes:[{requisito:'Pipelines'}] });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  const s = await llamar('POST /api/sessions', {}, { vacancy_id: c.body.id, candidate:'Carla', evaluator:'W', kind:'sondeo', mode:'B' });
  assert.strictEqual(s.status, 200, JSON.stringify(s.body));
  const d = await llamar('POST /api/sessions/:id/descartar', {id:String(s.body.id)}, {motivo:'Otro', nota:"con 'comilla'"});
  assert.strictEqual(d.status, 200, JSON.stringify(d.body));
  const l = await llamar('GET /api/sessions', {}, {});
  assert.strictEqual(l.status, 200, JSON.stringify(l.body));
  assert.strictEqual(l.body[0].estado_tablero, 'descartado');
  const t = await llamar('GET /api/tablero', {}, {});
  assert.strictEqual(t.status, 200, JSON.stringify(t.body).slice(0,300));
  assert.strictEqual(t.body.pulso.vacantes[0].descartados, 1);
  const v = await llamar('GET /api/vacancies/:id', {id:String(c.body.id)});
  assert.strictEqual(v.status, 200); assert.strictEqual(v.body.candidatos[0].estado_tablero, 'descartado');
  // Qué dijo el cliente: solo en un emitido (este no lo está).
  assert.strictEqual((await llamar('POST /api/sessions/:id/cliente', {id:String(s.body.id)}, {resultado:'Lo entrevistó'})).status, 409);
  await pool.query(`UPDATE ${process.env.VERIF_SCHEMA}.sessions SET status='issued', issued_at=NOW() WHERE id=$1`, [s.body.id]);
  const cr = await llamar('POST /api/sessions/:id/cliente', {id:String(s.body.id)}, {resultado:'Lo entrevistó'});
  assert.strictEqual(cr.status, 200, JSON.stringify(cr.body)); assert.strictEqual(cr.body.cliente_resultado, 'Lo entrevistó');
  const cb = await llamar('POST /api/sessions/:id/cliente', {id:String(s.body.id)}, {resultado:''});
  assert.strictEqual(cb.status, 200, JSON.stringify(cb.body)); assert.strictEqual(cb.body.cliente_resultado, null);
  await llamar('POST /api/sessions/:id/cliente', {id:String(s.body.id)}, {resultado:'Lo contrató'});
  const i = await llamar('GET /api/indicadores', {}, {});
  assert.strictEqual(i.status, 200, JSON.stringify(i.body).slice(0,300));
  assert.ok(i.body.ops && i.body.ops.headhunting && i.body.ops.saas, 'faltan los indicadores de operación');
  assert.strictEqual(i.body.ops.saas.cliente.recurrencia.den, 51);
  assert.strictEqual(i.body.ops.headhunting.calidad.contratados_informe, 1);
  assert.strictEqual((await llamar('POST /api/sessions/:id/recuperar', {id:String(s.body.id)}, {})).status, 200);
  const o = await llamar('GET /api/ops/:tipo', {tipo:'saas'});
  assert.strictEqual(o.status, 200); assert.strictEqual(o.body.filas.length, 212);
  await pool.query(`DROP SCHEMA ${process.env.VERIF_SCHEMA} CASCADE`);
  console.log('OK SQL real: descartar, listas, tablero, vacante, indicadores, recuperar, ops');
})().catch(e => { console.error('FALLA', e.message); process.exit(1); });

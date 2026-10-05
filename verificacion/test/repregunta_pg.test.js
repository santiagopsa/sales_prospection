// La repregunta con las rutas REALES contra un Postgres local y desechable, y un Claude falso que
// devuelve lo que la prueba necesita. Se salta sin PG_PRUEBA.
//   PG_PRUEBA="host=/tmp/pgt port=5499 user=postgres" node test/repregunta_pg.test.js
if (!process.env.PG_PRUEBA) { console.log('repregunta_pg: sin PG_PRUEBA, se salta'); process.exit(0); }
const assert = require('assert');
const Module = require('module');
const rutas = {};
const fx = () => ({}); fx.Router = () => { const r = {}; for (const m of ['get','post','patch','delete','use','all']) r[m] = (p, ...f) => { if (typeof p === 'string') rutas[`${m.toUpperCase()} ${p}`] = f[f.length-1]; return r; }; return r; };
fx.json = () => (q,s,n)=>n(); fx.static = () => (q,s,n)=>n();
const orig = Module._load; Module._load = function (r, ...x) { if (r === 'express') return fx; return orig.call(this, r, ...x); };
process.env.VERIF_SCHEMA = 'pr_' + Date.now();
const { crearPool } = require('./pg_psql');
const pool = crearPool(process.env.PG_PRUEBA);
const { router, initSchema } = require('../app');
const llamar = (k, params, body, query={}) => new Promise(ok => { const res = { statusCode:200, headersSent:false, status(c){this.statusCode=c;return this;}, json(j){this.headersSent=true; ok({status:this.statusCode, body:j});}, end(){ok({status:this.statusCode});} }; Promise.resolve(rutas[k]({params, body: body||{}, query}, res)).catch(e => ok({status:500, body:{error:e.message}})); });
const dormir = ms => new Promise(r => setTimeout(r, ms));

// Claude falso: la primera llamada deja el requisito 1 sin indagar; la repregunta lo sube a 4 y
// devuelve el 2 "mal" a propósito, para probar que lo no repreguntado no se toca.
const prompts = [];
const req = (indice, nivel, falta, demostro) => ({ indice, nivel, cubierto: true, demostro, brecha: '', evidencia: 'cita ' + indice,
  criterios: [], detalles: [], senales: [], indagar: { falta, punto: falta ? 'no se le pidió el caso' : '', preguntas: falta ? ['¿Qué hiciste tú?'] : [] } });
const anthropic = { messages: { create: async ({ messages }) => {
  const p = messages[0].content; prompts.push(p);
  const rep = /ESTO ES UNA REPREGUNTA/.test(p);
  const datos = rep
    ? { por_requisito: [req(1, 4, false, 'con caso propio'), req(2, 1, false, 'NO TOCAR')], perfil: [], impacto: [], experiencia_reciente: {}, declara: {}, advertencias: ['corta'], resumen: 'completó el caso' }
    : { por_requisito: [req(1, 3, true, 'corto'), req(2, 4, false, 'dos')], perfil: [], impacto: [{ titulo: 'x' }], experiencia_reciente: { estado: 'no_verificada' }, declara: { pretension: '10' }, advertencias: [], resumen: 'primera' };
  return { content: [{ type: 'text', text: JSON.stringify(datos) }], stop_reason: 'end_turn' };
} } };

(async () => {
  await initSchema(pool);
  router({ pool, anthropic, model: 'x' });
  const SC = process.env.VERIF_SCHEMA;
  const c = await llamar('POST /api/vacancies', {}, { empresa:{nombre:'Alpina'}, vacante:{titulo:'SAP PP'}, excluyentes:[{requisito:'Rollouts'}, {requisito:'Listas de materiales'}] });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  const s = await llamar('POST /api/sessions', {}, { vacancy_id: c.body.id, candidate:'Carla', evaluator:'W', kind:'sondeo', mode:'B' });
  const id = String(s.body.id);
  const estado = async () => (await llamar('GET /api/sessions', {}, {})).body.find(x => String(x.id) === id).estado_tablero;
  const esperarLista = async () => { for (let k = 0; k < 50; k++) { const g = await llamar('GET /api/sessions/:id', {id}); if (g.body.transcript_status !== 'procesando') return g.body; await dormir(100); } throw new Error('el análisis no terminó'); };

  // Sin primera llamada analizada no hay sobre qué repreguntar.
  assert.strictEqual((await llamar('POST /api/sessions/:id/repregunta', {id}, {requisitos:[{indice:1}]})).status, 409);

  const t1 = await llamar('POST /api/sessions/:id/transcript', {id}, { transcript: 'x'.repeat(500) });
  assert.strictEqual(t1.status, 202, JSON.stringify(t1.body));
  let g = await esperarLista();
  assert.strictEqual(g.transcript_analisis.por_requisito[0].indagar.falta, true);
  assert.strictEqual(await estado(), 'calificar');

  // Pedirla: índices fuera de la vacante se ignoran; sin ninguno válido, 400.
  assert.strictEqual((await llamar('POST /api/sessions/:id/repregunta', {id}, {requisitos:[{indice:7}]})).status, 400);
  const p = await llamar('POST /api/sessions/:id/repregunta', {id}, {requisitos:[{indice:1, requisito:'Rollouts', preguntas:['¿Qué hiciste tú?']}, {indice:9}]});
  assert.strictEqual(p.status, 200, JSON.stringify(p.body));
  assert.strictEqual(p.body.repregunta.ronda, 1);
  assert.deepStrictEqual(p.body.repregunta.requisitos.map(x => x.indice), [1]);
  assert.strictEqual(await estado(), 'repreguntar');

  // La transcripción de la repregunta es corta, pero no vacía.
  assert.strictEqual((await llamar('POST /api/sessions/:id/transcript', {id}, { transcript: 'y'.repeat(100), repregunta: true })).status, 400);
  const t2 = await llamar('POST /api/sessions/:id/transcript', {id}, { transcript: 'y'.repeat(200), repregunta: true });
  assert.strictEqual(t2.status, 202, JSON.stringify(t2.body));
  g = await esperarLista();
  const ult = prompts[prompts.length - 1];
  assert.ok(/ESTO ES UNA REPREGUNTA/.test(ult) && /\[1\] SE REPREGUNTA/.test(ult) && /\[2\] NO se repregunta/.test(ult), 'el prompt no lleva la primera llamada');
  const pr = g.transcript_analisis.por_requisito;
  assert.strictEqual(pr[0].nivel, 4); assert.strictEqual(pr[0].nivel_primera, 3); assert.strictEqual(pr[0].repreguntado, 1);
  assert.strictEqual(pr[1].demostro, 'dos', 'se tocó un requisito que no se repreguntó');
  assert.strictEqual(g.transcript_analisis.impacto[0].titulo, 'x', 'se perdió el impacto de la primera llamada');
  assert.deepStrictEqual(g.transcript_analisis.advertencias, ['Repregunta: corta']);
  assert.ok(g.repregunta.hecha_at && !g.repregunta.aplicada_at);
  assert.strictEqual(await estado(), 'calificar');

  // Ya hecha: no se vuelve a analizar sobre la misma.
  assert.strictEqual((await llamar('POST /api/sessions/:id/transcript', {id}, { transcript: 'y'.repeat(200), repregunta: true })).status, 409);
  const a = await llamar('POST /api/sessions/:id/repregunta', {id}, {aplicada:true});
  assert.strictEqual(a.status, 200); assert.ok(a.body.repregunta.aplicada_at);

  // Otra ronda, y cancelarla.
  const p2 = await llamar('POST /api/sessions/:id/repregunta', {id}, {requisitos:[{indice:2}]});
  assert.strictEqual(p2.body.repregunta.ronda, 2);
  assert.strictEqual((await llamar('POST /api/sessions/:id/repregunta', {id}, {cancelar:true})).body.repregunta, null);
  assert.strictEqual(await estado(), 'calificar');

  // Un informe emitido no se repregunta.
  await pool.query(`UPDATE ${SC}.sessions SET status='issued', issued_at=NOW() WHERE id=$1`, [Number(id)]);
  assert.strictEqual((await llamar('POST /api/sessions/:id/repregunta', {id}, {requisitos:[{indice:1}]})).status, 409);
  await pool.query(`DROP SCHEMA ${SC} CASCADE`);
  console.log('OK SQL real: repregunta pedida, analizada, combinada, aplicada, otra ronda, cancelada, bloqueada tras emitir');
})().catch(e => { console.error('FALLA', e.stack || e.message); process.exit(1); });

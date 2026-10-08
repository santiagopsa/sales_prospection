// Lo que dice el cliente, con las rutas REALES contra un Postgres local y un Claude falso.
//   PG_PRUEBA="host=/tmp/pgt port=5499 user=postgres" node test/feedback_pg.test.js
if (!process.env.PG_PRUEBA) { console.log('feedback_pg: sin PG_PRUEBA, se salta'); process.exit(0); }
const assert = require('assert');
const Module = require('module');
const rutas = {};
const fx = () => ({}); fx.Router = () => { const r = {}; for (const m of ['get','post','patch','delete','use','all']) r[m] = (p, ...f) => { if (typeof p === 'string') rutas[`${m.toUpperCase()} ${p}`] = f[f.length-1]; return r; }; return r; };
fx.json = () => (q,s,n)=>n(); fx.static = () => (q,s,n)=>n();
const orig = Module._load; Module._load = function (r, ...x) { if (r === 'express') return fx; return orig.call(this, r, ...x); };
process.env.VERIF_SCHEMA = 'pf_' + Date.now();
const { crearPool } = require('./pg_psql');
const pool = crearPool(process.env.PG_PRUEBA);
const { router, initSchema } = require('../app');
const llamar = (k, params, body, query={}) => new Promise(ok => { const res = { statusCode:200, headersSent:false, status(c){this.statusCode=c;return this;}, json(j){this.headersSent=true; ok({status:this.statusCode, body:j});}, end(){ok({status:this.statusCode});} }; Promise.resolve(rutas[k]({params, body: body||{}, query}, res)).catch(e => ok({status:500, body:{error:e.message}})); });
const dormir = ms => new Promise(r => setTimeout(r, ms));

// Claude falso: lo que diga el mensaje decide la respuesta.
const prompts = [];
let fallar = false;
const anthropic = { messages: { create: async ({ messages }) => {
  const p = messages[0].content; prompts.push(p);
  if (fallar) { const e = new Error('caído'); e.status = 529; throw e; }
  const t = p.split('"""')[1] || '';
  const d = /salario/i.test(t) ? { motivo: 'salario', requisito_indice: null, cita: 'pedía mucho', resumen: 'Salario', pregunta: '', propuesta: null }
    : /SAP BW/.test(t) ? { motivo: 'requisito', requisito_indice: null, cita: 'no sabía SAP BW', resumen: 'Le faltó BW', pregunta: '¿Qué reportes armaste en BW?',
        propuesta: { tipo: 'requisito', texto: 'Reportes en SAP BW', criterio: 'Narra un reporte propio', pregunta_escena: '¿Qué reporte armaste?', criterio_escena: 'Nombra el reporte' } }
    : { motivo: 'requisito', requisito_indice: 1, cita: 'no conocía las hojas de ruta', resumen: 'Flojo en hojas de ruta', pregunta: '¿Cómo armaste la última hoja de ruta?',
        propuesta: { tipo: 'endurecer', criterio: 'Narra un rollout y cómo armó las hojas de ruta', detalle: { detalle: '¿Transacción de hojas de ruta?', respuesta_esperada: 'CA01' }, senal: '' } };
  return { content: [{ type: 'text', text: JSON.stringify(d) }], stop_reason: 'end_turn' };
} } };

(async () => {
  await initSchema(pool);
  router({ pool, anthropic, model: 'x' });
  const SC = process.env.VERIF_SCHEMA;
  const c = await llamar('POST /api/vacancies', {}, { empresa:{nombre:'Alpina'}, vacante:{titulo:'SAP PP'}, excluyentes:[{requisito:'Rollouts', criterio_cumple:'Narra un rollout'}, {requisito:'Listas'}],
                                                      aiRaw: { descartes_previos: 'Rechazamos a dos que sabían la teoría' } });
  const vid = c.body.id;
  const s = await llamar('POST /api/sessions', {}, { vacancy_id: vid, candidate:'Carla', evaluator:'W', kind:'sondeo', mode:'B' });
  const sid = s.body.id;
  const reqs = (await llamar('GET /api/vacancies/:id', {id:String(vid)})).body.requirements;
  await pool.query(`INSERT INTO ${SC}.ratings (session_id, requirement_id, req_text, level, ord) VALUES ($1,$2,'Rollouts',5,0)`, [sid, reqs[0].id]);
  await pool.query(`UPDATE ${SC}.sessions SET status='issued', issued_at=NOW() WHERE id=$1`, [sid]);
  assert.strictEqual((await llamar('POST /api/sessions/:id/cliente', {id:String(sid)}, {resultado:'No avanzó'})).status, 200);

  const esperar = async id => { for (let k = 0; k < 50; k++) { const l = (await llamar('GET /api/feedback', {}, {}, {vacancy_id:String(vid)})).body; const f = l.find(x => x.id === id); if (f.analisis_estado !== 'procesando') return f; await dormir(100); } throw new Error('no terminó'); };

  // 1. Wei pega y se va: 202 enseguida; el análisis corre solo.
  assert.strictEqual((await llamar('POST /api/feedback', {}, { vacancy_id: vid, session_id: sid, texto: 'corto' })).status, 400);
  const p1 = await llamar('POST /api/feedback', {}, { vacancy_id: vid, session_id: sid, texto: 'Hola, no siguió: no conocía las hojas de ruta.' });
  assert.strictEqual(p1.status, 202, JSON.stringify(p1.body));
  let f1 = await esperar(p1.body.id);
  assert.strictEqual(f1.analisis_estado, 'lista');
  assert.strictEqual(f1.lectura, 'desacuerdo');            // la verificación le dio 5
  assert.strictEqual(f1.nivel_wei, 5);
  assert.strictEqual(f1.propuesta.tipo, 'endurecer');
  assert.strictEqual(f1.propuesta.requirement_id, reqs[0].id);
  assert.ok(/no conocía las hojas de ruta/.test(f1.texto), 'el texto pegado no quedó guardado');
  assert.ok(/LO QUE DIJO LA VERIFICACIÓN DE ESTE CANDIDATO: nivel 5/.test(prompts[0]), 'el prompt no lleva el nivel de la verificación');

  // 2. Va al tablero como ajuste pendiente, sin el texto entero.
  let t = (await llamar('GET /api/tablero', {}, {})).body;
  assert.strictEqual(t.ajustes.length, 1); assert.ok(!('texto' in t.ajustes[0]));

  // 3. Aplicarlo endurece el requisito.
  const a = await llamar('POST /api/feedback/:id/propuesta', {id:String(f1.id)}, {accion:'aceptar'});
  assert.strictEqual(a.status, 200, JSON.stringify(a.body));
  const r0 = (await pool.query(`SELECT criterio, detalles FROM ${SC}.requirements WHERE id=$1`, [reqs[0].id])).rows[0];
  assert.strictEqual(r0.criterio, 'Narra un rollout y cómo armó las hojas de ruta');
  assert.strictEqual(r0.detalles.slice(-1)[0].respuesta_esperada, 'CA01');
  assert.strictEqual((await llamar('POST /api/feedback/:id/propuesta', {id:String(f1.id)}, {accion:'aceptar'})).status, 409);

  // 4. Un requisito oculto, sobre la vacante: se agrega como requisito nuevo.
  const p2 = await llamar('POST /api/feedback', {}, { vacancy_id: vid, texto: 'Ninguno sabía SAP BW, eso es clave para ellos.' });
  const f2 = await esperar(p2.body.id);
  assert.strictEqual(f2.lectura, 'oculto'); assert.strictEqual(f2.propuesta.tipo, 'requisito');
  assert.strictEqual((await llamar('POST /api/feedback/:id/propuesta', {id:String(f2.id)}, {accion:'aceptar'})).status, 200);
  assert.strictEqual((await pool.query(`SELECT COUNT(*)::int n FROM ${SC}.requirements WHERE vacancy_id=$1`, [vid])).rows[0].n, 3);

  // 5. Salario: no es calidad, no propone nada.
  const f3 = await esperar((await llamar('POST /api/feedback', {}, { vacancy_id: vid, session_id: sid, texto: 'El salario que pidió estaba fuera de rango.' })).body.id);
  assert.strictEqual(f3.lectura, 'no_calidad'); assert.strictEqual(f3.propuesta, null);

  // 6. Si Claude falla, el texto queda y se reintenta desde el tablero.
  fallar = true;
  const f4 = await esperar((await llamar('POST /api/feedback', {}, { vacancy_id: vid, session_id: sid, texto: 'No avanzó, no conocía las hojas de ruta tampoco.' })).body.id);
  assert.strictEqual(f4.analisis_estado, 'error');
  t = (await llamar('GET /api/tablero', {}, {})).body;
  assert.ok(t.ajustes.some(x => x.id === f4.id && x.analisis_estado === 'error'));
  fallar = false;
  assert.strictEqual((await llamar('POST /api/feedback/:id/reanalizar', {id:String(f4.id)}, {})).status, 202);
  assert.strictEqual((await esperar(f4.id)).analisis_estado, 'lista');

  // 7. Vuelve a la guía: la vacante y la sesión traen los rechazos, levantamiento incluido.
  const v = (await llamar('GET /api/vacancies/:id', {id:String(vid)})).body;
  assert.strictEqual(v.rechazos[0].origen, 'levantamiento');
  assert.ok(v.rechazos.some(x => x.requisito_indice === 1));
  const ses = (await llamar('GET /api/sessions/:id', {id:String(sid)})).body;
  assert.ok(ses.rechazos.length >= 4);

  // 8. Indicadores: un entrevistado, rechazado por algo que dimos por cumplido.
  const ind = (await llamar('GET /api/indicadores', {}, {})).body.feedback;
  assert.strictEqual(ind.entrevistados, 1); assert.strictEqual(ind.no_avanzaron, 1);
  assert.strictEqual(ind.falsos_positivos.num, 1); assert.strictEqual(ind.acierto.pct, 0);
  assert.strictEqual(ind.lecturas.oculto, 1);

  await pool.query(`DROP SCHEMA ${SC} CASCADE`);
  console.log('OK SQL real: pegar y seguir, análisis en segundo plano, lectura contra el nivel, ajustes en el tablero, aplicar, reintentar, guía, indicadores');
})().catch(e => { console.error('FALLA', e.stack || e.message); process.exit(1); });

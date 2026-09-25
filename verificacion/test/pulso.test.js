// El pulso de las vacantes en las rutas REALES: /api/tablero trae las vacantes en movimiento con
// sus validados, y /api/vacancies/:id trae la lista de candidatos con el mismo pulso.
const assert = require('assert');
const Module = require('module');
const rutas = {};
const fakeExpress = () => ({});
fakeExpress.Router = () => { const r = {}; for (const m of ['get','post','patch','delete','use','all']) r[m] = (path, ...fns) => { if (typeof path === 'string') rutas[`${m.toUpperCase()} ${path}`] = fns[fns.length - 1]; return r; }; return r; };
fakeExpress.json = () => (req, res, next) => next();
fakeExpress.static = () => (req, res, next) => next();
const cargaOriginal = Module._load;
Module._load = function (req, ...resto) { if (req === 'express') return fakeExpress; return cargaOriginal.call(this, req, ...resto); };
const { router } = require('../app');
router({ pool: null, anthropic: null, model: 'falso' });
const llamar = (clave, params, body) => new Promise((ok) => {
  const res = { statusCode: 200, headersSent: false, status(c) { this.statusCode = c; return this; }, json(j) { ok({ status: this.statusCode, body: j }); }, end() { ok({ status: this.statusCode, body: null }); } };
  Promise.resolve(rutas[clave]({ params, body: body || {}, query: {} }, res)).catch(e => ok({ status: 500, body: { error: e.message } }));
});
let n = 0;
const t = async (nombre, fn) => { await fn(); n++; console.log('  ✓', nombre); };

(async () => {
  console.log('pulso de las vacantes (rutas reales)');
  const c = await llamar('POST /api/vacancies', {}, { empresa: { nombre: 'Movizzon' }, vacante: { titulo: 'Data Engineer' }, excluyentes: [{ requisito: 'Pipelines en producción' }] });
  const vid = c.body.id;
  const emitir = async (nombre, nivel) => {
    const ses = await llamar('POST /api/sessions', {}, { vacancy_id: vid, candidate: nombre, evaluator: 'Weimar', kind: 'sondeo', mode: 'B' });
    const rt = [{ requirement_id: null, req_text: 'Pipelines en producción', level: nivel, evidence: 'x', analisis: 'Narró un pipeline propio con fechas y alcance concretos.' }];
    await llamar('PATCH /api/sessions/:id', { id: String(ses.body.id) }, { ratings: rt });
    const r = await llamar('POST /api/sessions/:id/issue', { id: String(ses.body.id) }, {
      candidate: nombre, identity: { grab: true, cam: true }, signals: {}, data: { mode: 'B' },
      ratings: [{ requirement_id: null, req_text: 'Pipelines en producción', level: nivel, evidence: 'x', analisis: 'Narró un pipeline propio con fechas y alcance concretos.' }],
    });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    return ses.body.id;
  };
  await emitir('Ana Apta', 5);
  await emitir('Beto Parcial', 3);
  await llamar('POST /api/sessions', {}, { vacancy_id: vid, candidate: 'Carla Proceso', evaluator: 'Laura', kind: 'sondeo', mode: 'B' });

  await t('/api/tablero trae el pulso con la vacante en movimiento y sus números', async () => {
    const r = await llamar('GET /api/tablero', {}, {});
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const p = r.body.pulso.vacantes.find(x => Number(x.id) === Number(vid));
    assert.ok(p, 'la vacante no está en el pulso');
    assert.strictEqual(p.reciente, true);
    assert.strictEqual(p.validaciones, 3); assert.strictEqual(p.validados, 2);
    assert.strictEqual(p.aptos, 1, JSON.stringify(p)); assert.strictEqual(p.no_cumplen, 1); assert.strictEqual(p.en_proceso, 1);
    assert.strictEqual(p.probabilidad, 'media');
    assert.strictEqual(r.body.pulso.resumen.recientes, 1);
    assert.ok(r.body.esta_semana, 'se perdieron las estadísticas de gestión');
  });

  await t('/api/vacancies/:id trae los candidatos y el mismo pulso', async () => {
    const r = await llamar('GET /api/vacancies/:id', { id: String(vid) });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.deepStrictEqual(r.body.candidatos.map(s => s.candidate).sort(), ['Ana Apta', 'Beto Parcial', 'Carla Proceso']);
    const ana = r.body.candidatos.find(s => s.candidate === 'Ana Apta');
    assert.strictEqual(ana.req_total, 1); assert.strictEqual(ana.req_cumple, 1); assert.strictEqual(ana.estado_tablero, 'emitido');
    assert.ok(ana.report_code, 'sin código de informe');
    assert.strictEqual(r.body.pulso.probabilidad, 'media'); assert.strictEqual(r.body.pulso.aptos, 1);
  });

  await t('cerrada: sale del movimiento y no tiene probabilidad', async () => {
    await llamar('PATCH /api/vacancies/:id', { id: String(vid) }, { status: 'cerrada' });
    const r = await llamar('GET /api/tablero', {}, {});
    const p = r.body.pulso.vacantes.find(x => Number(x.id) === Number(vid));
    assert.strictEqual(p.reciente, false); assert.strictEqual(p.probabilidad, null);
  });

  console.log(`\n${n} pruebas · todo en verde`);
})().catch(e => { console.error(e); process.exit(1); });

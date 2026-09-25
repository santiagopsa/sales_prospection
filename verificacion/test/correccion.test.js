// Corregir el nombre del candidato en la ruta REAL: en borrador solo cambia el nombre; en un
// acta emitida vuelve a firmar el documento corregido y anota la corrección en el snapshot.
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
  console.log('corregir el nombre del candidato');
  const c = await llamar('POST /api/vacancies', {}, { empresa: { nombre: 'Movizzon' }, vacante: { titulo: 'Data Engineer' }, excluyentes: [{ requisito: 'Pipelines en producción' }] });
  const ses = await llamar('POST /api/sessions', {}, { vacancy_id: c.body.id, candidate: 'Miguel', evaluator: 'Weimar', kind: 'sondeo', mode: 'B' });
  const sid = String(ses.body.id);

  await t('en borrador solo cambia el nombre, sin firma ni corrección anotada', async () => {
    const r = await llamar('POST /api/sessions/:id/candidato', { id: sid }, { candidate: 'Juan Galindo' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.candidate, 'Juan Galindo');
    assert.strictEqual(r.body.correccion, null);
    const s = await llamar('GET /api/sessions/:id', { id: sid });
    assert.strictEqual(s.body.candidate, 'Juan Galindo');
  });

  await t('un nombre vacío se rechaza', async () => {
    const r = await llamar('POST /api/sessions/:id/candidato', { id: sid }, { candidate: '  ' });
    assert.strictEqual(r.status, 400);
  });

  // Se emite con el nombre equivocado y se corrige después.
  await llamar('POST /api/sessions/:id/candidato', { id: sid }, { candidate: 'Miguel' });
  const em = await llamar('POST /api/sessions/:id/issue', { id: sid }, {
    candidate: 'Miguel', identity: { grab: true, cam: true }, signals: {}, data: { mode: 'B' },
    ratings: [{ requirement_id: null, req_text: 'Pipelines en producción', level: 4, evidence: 'x', analisis: 'Narró un pipeline propio con fechas y alcance.' }],
  });
  assert.strictEqual(em.status, 200, JSON.stringify(em.body));
  const firmaAntes = em.body.integrity_hash;

  await t('en un acta emitida: nombre nuevo en el snapshot, firma nueva y corrección anotada', async () => {
    const r = await llamar('POST /api/sessions/:id/candidato', { id: sid }, { candidate: 'Juan Galindo' });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.ok(r.body.integrity_hash && r.body.integrity_hash !== firmaAntes, 'la firma no cambió');
    assert.strictEqual(r.body.correccion.campo, 'candidato');
    assert.strictEqual(r.body.correccion.antes, 'Miguel');
    assert.strictEqual(r.body.correccion.despues, 'Juan Galindo');
    const s = await llamar('GET /api/sessions/:id', { id: sid });
    assert.strictEqual(s.body.candidate, 'Juan Galindo');
    assert.strictEqual(s.body.snapshot.candidato, 'Juan Galindo');
    assert.strictEqual(s.body.snapshot.integrity_hash, r.body.integrity_hash);
    assert.strictEqual(s.body.integrity_hash, r.body.integrity_hash);
    assert.strictEqual(s.body.snapshot.correcciones.length, 1);
    // lo demás del documento congelado no se toca
    assert.strictEqual(s.body.snapshot.ratings[0].analisis, 'Narró un pipeline propio con fechas y alcance.');
  });

  await t('la página pública sigue mostrando la firma vigente', async () => {
    const s = await llamar('GET /api/sessions/:id', { id: sid });
    const v = await llamar('GET /api/v/:code', { code: s.body.report_code });
    assert.strictEqual(v.status, 200);
    assert.strictEqual(v.body.firma, s.body.integrity_hash);
  });

  console.log(`\n${n} pruebas · el nombre se corrige sin esconderlo`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });

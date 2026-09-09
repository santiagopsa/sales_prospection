// La ruta de traducción de verdad, con un modelo de mentira.
//
// Existe por un error que las e2e no podían ver: el stub reimplementa la ruta, así que el
// flujo pasaba en verde mientras el servidor real leía la respuesta del modelo en el sitio
// equivocado (pedirJson devuelve {datos}, no el JSON pelado). El informe salía con los
// rótulos en inglés y todo el contenido en español, sin ningún error. Aquí se monta el
// router real —express reemplazado por un doble mínimo— y se llama a la ruta con un
// `anthropic` falso que contesta lo que cada caso necesita.
const assert = require('assert');
const Module = require('module');

// ---- doble de express: solo lo que app.js usa al montar el router ----
const rutas = {};
const fakeExpress = () => ({});
fakeExpress.Router = () => {
  const r = {};
  for (const m of ['get', 'post', 'patch', 'delete', 'use', 'all']) {
    r[m] = (path, ...fns) => { if (typeof path === 'string') rutas[`${m.toUpperCase()} ${path}`] = fns[fns.length - 1]; return r; };
  }
  return r;
};
fakeExpress.json = () => (req, res, next) => next();
fakeExpress.static = () => (req, res, next) => next();
const cargaOriginal = Module._load;
Module._load = function (req, ...resto) {
  if (req === 'express') return fakeExpress;
  return cargaOriginal.call(this, req, ...resto);
};

const { router } = require('../app');

// ---- modelo de mentira: devuelve el texto que le diga el caso ----
let respuesta = '';
const anthropic = { messages: { create: async () => ({ content: [{ type: 'text', text: respuesta }], usage: {} }) } };
router({ pool: null, anthropic, model: 'falso' });

const llamar = async (clave, params, body) => new Promise((ok) => {
  const res = {
    statusCode: 200,
    status(c) { this.statusCode = c; return this; },
    json(j) { ok({ status: this.statusCode, body: j }); },
    end() { ok({ status: this.statusCode, body: null }); },
    headersSent: false,
  };
  Promise.resolve(rutas[clave]({ params, body: body || {}, query: {} }, res)).catch(e => ok({ status: 500, body: { error: e.message } }));
});

let n = 0;
const t = async (nombre, fn) => { await fn(); n++; console.log('  ✓', nombre); };

(async () => {
  console.log('la traducción del informe pasa por el servidor real');

  // Una sesión en memoria para colgarle traducciones.
  const c = await llamar('POST /api/vacancies', {}, { empresa: { nombre: 'IDOM' }, vacante: { titulo: 'Consultor SAP PP' },
    excluyentes: [{ requisito: 'Rollout de PP en producción' }] });
  assert.strictEqual(c.status, 200, JSON.stringify(c.body));
  const nueva = (candidate) => llamar('POST /api/sessions', {}, { vacancy_id: c.body.id, candidate, evaluator: 'Weimar', kind: 'sondeo', mode: 'B' });
  const ses = await nueva('Yesid');
  assert.strictEqual(ses.status, 200, JSON.stringify(ses.body));
  const sid = String(ses.body.id);
  const textos = { 'cargo': 'Consultor SAP PP', 'req.0.n': 'Rollout de PP en producción', 'req.0.cuerpo': 'Narró el rollout con fechas.', 'rec.texto': 'Sostiene el núcleo del cargo.' };

  await t('la forma pedida (lista con id/en) se lee y se guarda', async () => {
    respuesta = JSON.stringify({ traducciones: [
      { id: 'cargo', en: 'SAP PP Consultant' }, { id: 'req.0.n', en: 'PP rollout in production' },
      { id: 'req.0.cuerpo', en: 'Narrated the rollout with dates.' }, { id: 'rec.texto', en: 'Holds the core of the role.' }] });
    const r = await llamar('POST /api/sessions/:id/traduccion', { id: sid }, { idioma: 'en', textos });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.textos['req.0.cuerpo'], 'Narrated the rollout with dates.');
    assert.strictEqual(r.body.textos.cargo, 'SAP PP Consultant');
    assert.ok(!r.body.reutilizada);
  });

  await t('la segunda vez no vuelve al modelo: reutiliza la guardada', async () => {
    respuesta = 'BASURA QUE NO ES JSON';
    const r = await llamar('POST /api/sessions/:id/traduccion', { id: sid }, { idioma: 'en', textos });
    assert.strictEqual(r.status, 200);
    assert.ok(r.body.reutilizada);
    assert.strictEqual(r.body.textos.cargo, 'SAP PP Consultant');
  });

  await t('sin textos, "en" devuelve la guardada y "es" solo cambia el idioma', async () => {
    let r = await llamar('POST /api/sessions/:id/traduccion', { id: sid }, { idioma: 'en' });
    assert.strictEqual(r.body.textos['req.0.n'], 'PP rollout in production');
    r = await llamar('POST /api/sessions/:id/traduccion', { id: sid }, { idioma: 'es' });
    assert.strictEqual(r.body.idioma, 'es');
    const s = await llamar('GET /api/sessions/:id', { id: sid });
    assert.strictEqual(s.body.idioma, 'es');
    assert.ok(s.body.traducciones && s.body.traducciones.en);
  });

  // Otra sesión para los casos en que el modelo contesta con otra forma.
  const ses2 = await nueva('Dayana');
  const sid2 = String(ses2.body.id);

  await t('si el modelo anida las claves por los puntos, igual se lee', async () => {
    respuesta = JSON.stringify({ cargo: 'SAP PP Consultant', req: { 0: { n: 'PP rollout in production', cuerpo: 'Narrated it.' } }, rec: { texto: 'Holds the core.' } });
    const r = await llamar('POST /api/sessions/:id/traduccion', { id: sid2 }, { idioma: 'en', textos });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.textos['req.0.cuerpo'], 'Narrated it.');
    assert.strictEqual(r.body.textos['rec.texto'], 'Holds the core.');
  });

  const ses3 = await nueva('Carla');
  const sid3 = String(ses3.body.id);

  await t('si el modelo devuelve casi nada, es un error 502 y no un informe a medias', async () => {
    respuesta = JSON.stringify({ traducciones: [{ id: 'cargo', en: 'SAP PP Consultant' }] });
    const r = await llamar('POST /api/sessions/:id/traduccion', { id: sid3 }, { idioma: 'en', textos });
    assert.strictEqual(r.status, 502, JSON.stringify(r.body));
    assert.ok(/1 de 4/.test(r.body.error), r.body.error);
    const s = await llamar('GET /api/sessions/:id', { id: sid3 });
    assert.ok(!(s.body.traducciones && s.body.traducciones.en), 'guardó una traducción a medias');
  });

  await t('un texto que falte puntualmente se queda en español, no en blanco', async () => {
    respuesta = JSON.stringify({ traducciones: [
      { id: 'cargo', en: 'SAP PP Consultant' }, { id: 'req.0.n', en: 'PP rollout in production' }, { id: 'req.0.cuerpo', en: 'Narrated the rollout.' }] });
    const r = await llamar('POST /api/sessions/:id/traduccion', { id: sid3 }, { idioma: 'en', textos });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    assert.strictEqual(r.body.textos['rec.texto'], 'Sostiene el núcleo del cargo.');
  });

  console.log(`\n${n} pruebas · la traducción llega al informe`);
})().catch(e => { console.error('✗', e.message); process.exit(1); });

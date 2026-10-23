// La ruta real del levantamiento con las dos fuentes (sin base: memoria) y un Claude falso.
const assert = require('assert');
const Module = require('module');
const rutas = {};
const fx = () => ({}); fx.Router = () => { const r = {}; for (const m of ['get','post','patch','delete','use','all']) r[m] = (p, ...f) => { if (typeof p === 'string') rutas[`${m.toUpperCase()} ${p}`] = f[f.length-1]; return r; }; return r; };
fx.json = () => (q,s,n)=>n(); fx.static = () => (q,s,n)=>n();
const orig = Module._load; Module._load = function (r, ...x) { if (r === 'express') return fx; return orig.call(this, r, ...x); };
const { router } = require('../app');
const llamar = (k, body) => new Promise(ok => { const res = { statusCode: 200, status(c){ this.statusCode = c; return this; }, json(j){ ok({ status: this.statusCode, body: j }); } }; Promise.resolve(rutas[k]({ params: {}, body, query: {} }, res)).catch(e => ok({ status: 500, body: { error: e.message } })); });
let prompt = '';
const anthropic = { messages: { create: async ({ messages }) => { prompt = messages[0].content;
  return { content: [{ type: 'text', text: JSON.stringify({ empresa: { nombre: 'Neduga' }, vacante: { titulo: 'SAP PP' }, excluyentes: [], perfil_conducta: [] }) }], stop_reason: 'end_turn' }; } } };
router({ pool: null, anthropic, model: 'x' });
(async () => {
  const JD = 'Requisitos obligatorios: 5 años en SAP PP y un rollout completo en producción. '.repeat(3);
  const R = 'Marcela: lo técnico ya está en el JD; nos importa que aguante la presión del cierre.';
  const a = await llamar('POST /api/intake/analyze', { sourceType: 'mixto', sourceText: R, jdText: JD });
  assert.strictEqual(a.status, 200, JSON.stringify(a.body));
  assert.ok(prompt.includes('<<<INICIO_DEL_JD') && prompt.includes('<<<INICIO_DE_LA_REUNION'), 'el prompt no separa las fuentes');
  assert.ok(prompt.indexOf(JD.trim()) < prompt.indexOf(R), 'el JD y la reunión no van cada uno en su bloque');
  assert.strictEqual(a.body._fuente.tipo, 'mixto');
  assert.ok(a.body._fuente.texto.startsWith('=== JOB DESCRIPTION ==='));
  const b = await llamar('POST /api/intake/analyze', { sourceType: 'mixto', sourceText: '', jdText: '' });
  assert.strictEqual(b.status, 400);
  const c = await llamar('POST /api/intake/analyze', { sourceType: 'jd', sourceText: JD });
  assert.strictEqual(c.status, 200); assert.strictEqual(c.body._fuente.tipo, 'jd');
  assert.ok(prompt.includes('<<<INICIO_DEL_TEXTO') && !prompt.includes('INICIO_DEL_JD'));
  console.log('OK levantamiento: transcripción, JD o los dos, por la ruta real');
})().catch(e => { console.error('FALLA', e.message); process.exit(1); });

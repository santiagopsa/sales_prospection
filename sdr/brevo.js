// Brevo (el CRM de Luisa): cruce de los deals del Sandler con los deals de Brevo, solo lectura.
//
// La llave va en Render como BREVO_API_KEY (nunca en el repo). Reglas del cruce en config.BREVO.
// Ver el efecto: node sdr/cli.js brevo
//
// Cómo se emparejan (en este orden):
//   1. por correo: el lead de Angie enlazado al deal (leads.deal_id) tiene el mismo correo que un
//      contacto enlazado al deal de Brevo;
//   2. por empresa: el nombre normalizado (sin S.A.S., acentos…) del deal del Sandler coincide con el
//      de la empresa enlazada al deal de Brevo o con el nombre del deal de Brevo.
// Lo que sale: pares (con sus diferencias de etapa según BREVO.etapas), solo_sandler y solo_brevo.
const { T } = require('./schema');
const { normalizarEmpresa } = require('./listanegra');
const EMB = require('./embudo');

const API = 'https://api.brevo.com/v3';
const ETAPA_LABEL = Object.fromEntries(EMB.ETAPAS.map(e => [e.id, e.label]));
function error(status, message) { return Object.assign(new Error(message), { status }); }

const llave = (env = process.env) => (env.BREVO_API_KEY || '').trim() || null;
const activo = (env = process.env) => !!llave(env);

// Cliente mínimo: GET con la llave y paginación de /crm/deals. `fetchFn` se cambia en las pruebas.
function cliente(env = process.env, { fetchFn = fetch } = {}) {
  const k = llave(env);
  if (!k) throw error(400, 'Falta BREVO_API_KEY (en Render → Environment)');
  async function get(path, query = {}) {
    const u = new URL(API + path);
    for (const [a, b] of Object.entries(query)) if (b != null) u.searchParams.set(a, b);
    const r = await fetchFn(u.toString(), { headers: { 'api-key': k, accept: 'application/json' } });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw error(502, `Brevo ${r.status} en ${path}: ${j.message || j.code || 'error'}`);
    return j;
  }
  return {
    get,
    // [{ pipeline, pipeline_name, stages: [{ id, name }] }]
    pipelines: async () => { const p = await get('/crm/pipeline/details/all'); return Array.isArray(p) ? p : (p.items || []); },
    // Todos los deals, de 100 en 100 (Brevo no manda total: se sigue hasta una página corta).
    deals: async () => {
      const todos = [];
      for (let offset = 0; ; offset += 100) {
        const p = await get('/crm/deals', { limit: 100, offset });
        const items = p.items || [];
        todos.push(...items);
        if (items.length < 100) break;
        if (todos.length > 5000) break;
      }
      return todos;
    },
    contacto: id => get('/contacts/' + encodeURIComponent(id)),
    empresa: id => get('/crm/companies/' + encodeURIComponent(id)),
  };
}

// Caché en memoria de lo leído de Brevo (deals + empresas + contactos): BREVO.cache_min.
let cache = { at: 0, datos: null };
async function leerBrevo(config, env, { ahora = new Date(), forzar = false, fetchFn } = {}) {
  const min = (config.BREVO || {}).cache_min || 10;
  if (!forzar && cache.datos && ahora.getTime() - cache.at < min * 60000) return cache.datos;
  const c = cliente(env, fetchFn ? { fetchFn } : {});
  const pipes = await c.pipelines();
  const etapasPorId = {};
  for (const p of pipes) for (const s of (p.stages || [])) etapasPorId[s.id] = { nombre: s.name, pipeline: p.pipeline_name || p.pipeline };
  const quiero = (config.BREVO || {}).pipeline;
  const crudos = (await c.deals()).filter(d => !quiero || (pipes.find(p => p.pipeline === (d.attributes || {}).pipeline) || {}).pipeline_name === quiero);
  // Empresas y contactos enlazados, cada uno una sola vez, de a pocos a la vez.
  const idsEmp = new Set(), idsCon = new Set();
  for (const d of crudos) { (d.linkedCompaniesIds || []).forEach(i => idsEmp.add(i)); (d.linkedContactsIds || []).forEach(i => idsCon.add(i)); }
  const empresas = {}, contactos = {};
  const lote = async (ids, fn, guardar) => {
    const lista = [...ids];
    for (let i = 0; i < lista.length; i += 5) await Promise.all(lista.slice(i, i + 5).map(async id => { try { guardar(id, await fn(id)); } catch (e) { guardar(id, null); } }));
  };
  await lote(idsEmp, c.empresa, (id, e) => { empresas[id] = e ? { nombre: (e.attributes || {}).name || '', dominio: (e.attributes || {}).domain || '' } : null; });
  await lote(idsCon, c.contacto, (id, x) => { contactos[id] = x ? { email: (x.email || '').toLowerCase(), nombre: [(x.attributes || {}).FIRSTNAME, (x.attributes || {}).LASTNAME].filter(Boolean).join(' ') } : null; });
  const deals = crudos.map(d => {
    const a = d.attributes || {};
    const et = etapasPorId[a.deal_stage] || { nombre: a.deal_stage || '', pipeline: null };
    return {
      id: d.id, nombre: a.deal_name || '', etapa: et.nombre, pipeline: et.pipeline, monto: a.amount != null ? Number(a.amount) : null,
      cierre: a.close_date || null, creado: a.created_at || null, actualizado: a.updated_at || null, propietario: a.deal_owner || null,
      empresas: (d.linkedCompaniesIds || []).map(i => empresas[i]).filter(Boolean),
      contactos: (d.linkedContactsIds || []).map(i => contactos[i]).filter(Boolean),
      url: ((config.BREVO || {}).url_deal || 'https://app.brevo.com/crm/deals/{id}').replace('{id}', d.id),
    };
  });
  cache = { at: ahora.getTime(), datos: { pipelines: pipes.map(p => ({ nombre: p.pipeline_name || p.pipeline, etapas: (p.stages || []).map(s => s.name) })), deals, leido_at: ahora.toISOString() } };
  return cache.datos;
}

// Reglas del cruce: etapa de Brevo (por nombre, sin mayúsculas) → etapa del embudo.
function etapaEquivalente(config, nombreBrevo) {
  const m = (config.BREVO || {}).etapas || {};
  const k = Object.keys(m).find(x => x.toLowerCase() === String(nombreBrevo || '').toLowerCase());
  return k ? m[k] : null;
}
const cerradaEnBrevo = (config, d) => ['ganado', 'perdido'].includes(etapaEquivalente(config, d.etapa));

// Los deals del Sandler con su etapa del embudo y el correo del lead de Angie (si lo hay).
async function dealsSandler(db, config) {
  const r = await db.query(
    `SELECT d.id, d.company, d.executive, d.outcome, d.etapa_embudo, d.quoted_at, d.calificacion_sandler, d.created_at, d.closed_at,
            l.id AS lead_id, l.email AS lead_email, l.contacto AS lead_contacto
     FROM public.deals d LEFT JOIN ${T.leads} l ON l.deal_id = d.id
     ORDER BY d.id`);
  // Un deal con varios leads (fusiones a medias): se queda el primero con correo.
  const porId = new Map();
  for (const x of r.rows) {
    const d = porId.get(x.id) || { id: x.id, empresa: x.company || '', ejecutiva: x.executive, etapa: EMB.etapaDe(config, x), calificacion: x.calificacion_sandler, creado: x.created_at, cerrado: x.closed_at, lead_id: null, email: null, contacto: null };
    if (!d.email && x.lead_email) { d.lead_id = x.lead_id; d.email = String(x.lead_email).toLowerCase(); d.contacto = x.lead_contacto; }
    if (!d.lead_id && x.lead_id) d.lead_id = x.lead_id;
    porId.set(x.id, d);
  }
  return [...porId.values()];
}

// Empareja y compara. Puro: recibe las dos listas (para probarlo sin Brevo ni base).
function cruzar(config, sandler, brevo) {
  const clave = s => normalizarEmpresa(s);
  const usados = new Set();
  const pares = [], solo_sandler = [];
  const encontrar = d => {
    if (d.email) {
      const b = brevo.find(x => !usados.has(x.id) && x.contactos.some(c => c.email === d.email));
      if (b) return { b, por: 'correo' };
    }
    const k = clave(d.empresa);
    if (k) {
      const b = brevo.find(x => !usados.has(x.id) && (x.empresas.some(e => clave(e.nombre) === k) || clave(x.nombre) === k));
      if (b) return { b, por: 'empresa' };
    }
    return null;
  };
  for (const d of sandler) {
    const m = encontrar(d);
    if (!m) { if (!['ganado', 'perdido'].includes(d.etapa)) solo_sandler.push(d); continue; }
    usados.add(m.b.id);
    const eq = etapaEquivalente(config, m.b.etapa);
    const diferencias = [];
    if (eq && eq !== d.etapa) {
      const cerradoB = ['ganado', 'perdido'].includes(eq), cerradoS = ['ganado', 'perdido'].includes(d.etapa);
      const cerrado = e => e === 'ganado' ? 'ganado' : 'perdido';
      diferencias.push(cerradoB && !cerradoS ? `En Brevo está ${cerrado(eq)} y en el Sandler sigue abierto (${ETAPA_LABEL[d.etapa]})`
        : cerradoS && !cerradoB ? `En el Sandler está ${cerrado(d.etapa)} y en Brevo sigue abierto (${m.b.etapa})`
        : `Etapa distinta: Sandler "${ETAPA_LABEL[d.etapa]}", Brevo "${m.b.etapa}" (equivale a ${ETAPA_LABEL[eq]})`);
    }
    pares.push({ sandler: d, brevo: m.b, por: m.por, etapa_equivalente: eq, diferencias });
  }
  const solo_brevo = brevo.filter(b => !usados.has(b.id) && !cerradaEnBrevo(config, b));
  return { pares, solo_sandler, solo_brevo };
}

async function chequeo(db, config, env = process.env, opts = {}) {
  const datos = await leerBrevo(config, env, opts);
  const sandler = await dealsSandler(db, config);
  const x = cruzar(config, sandler, datos.deals);
  const sinRegla = [...new Set(datos.deals.map(d => d.etapa).filter(e => e && !etapaEquivalente(config, e)))];
  return {
    leido_at: datos.leido_at, pipelines: datos.pipelines, etapas_sin_regla: sinRegla,
    resumen: { sandler: sandler.length, brevo: datos.deals.length, pares: x.pares.length, con_diferencias: x.pares.filter(p => p.diferencias.length).length, solo_sandler: x.solo_sandler.length, solo_brevo: x.solo_brevo.length },
    ...x,
  };
}

// Lo de Brevo para un lead o un deal (la ficha de Angie y el detalle del deal): el deal emparejado.
async function dealDe(db, config, env, { email, empresa, dealId } = {}, opts = {}) {
  if (!activo(env)) return null;
  const datos = await leerBrevo(config, env, opts);
  const d = { id: dealId || 0, empresa: empresa || '', email: email ? String(email).toLowerCase() : null, etapa: 'sin_calificar' };
  const x = cruzar(config, [d], datos.deals);
  const p = x.pares[0];
  return p ? { ...p.brevo, por: p.por, etapa_equivalente: p.etapa_equivalente } : null;
}

module.exports = { activo, cliente, leerBrevo, cruzar, chequeo, dealDe, etapaEquivalente, dealsSandler, _reiniciar: () => { cache = { at: 0, datos: null }; } };

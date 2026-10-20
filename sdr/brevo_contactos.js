// Los contactos de Angie en Brevo: cada lead de la app se crea o actualiza como contacto en Brevo,
// en segundo plano, para que Angie arme automatizaciones allá sin volver a crearlos.
//
//   lead nuevo o cambiado (updated_at > brevo_at)  →  POST /v3/contacts (updateEnabled)  →  brevo_id
//
// Reglas en config.BREVO.contactos. La lista y los atributos se crean en Brevo si no existen (una vez
// por proceso). Un lead sin correo ni teléfono no se puede crear (Brevo exige un identificador) y
// queda con brevo_error. Los que pidieron no ser contactados o están en lista negra se mandan
// bloqueados para correo y SMS y fuera de la lista.
//
// Ver el efecto: node sdr/cli.js brevo-contactos [--sincronizar N]
const { T } = require('./schema');
const D = require('./dominio');
const llaveBrevo = (env = process.env) => (env.BREVO_API_KEY || '').trim() || null;

const API = 'https://api.brevo.com/v3';
function error(status, message) { return Object.assign(new Error(message), { status }); }

function reglas(config) {
  const c = ((config.BREVO || {}).contactos) || {};
  return {
    activo: c.activo !== false,
    lista: c.lista || 'Prospección PeakU AI', carpeta: c.carpeta || 'PeakU AI', listaId: c.lista_id || null,
    atributos: c.atributos || { EMPRESA: 'text', CARGO: 'text', CIUDAD: 'text', ETAPA_PEAKU: 'text', FUENTE_PEAKU: 'text', LEAD_PEAKU: 'text', SDR_PEAKU: 'text', LISTA_PEAKU: 'text' },
    porTanda: Number(c.por_tanda) || 40, reintentoMin: Number(c.reintento_min) || 60,
    telefonoConMas: c.telefono_con_mas !== false,
    urlContacto: c.url_contacto || 'https://app.brevo.com/contact/index/{id}',
  };
}
const activo = (config, env = process.env) => reglas(config).activo && !!llaveBrevo(env);

// Cliente mínimo con GET/POST/PUT. `fetchFn` se cambia en las pruebas.
function cliente(env = process.env, { fetchFn = fetch } = {}) {
  const k = llaveBrevo(env);
  if (!k) throw error(400, 'Falta BREVO_API_KEY (en Render → Environment)');
  async function pedir(metodo, path, body, query) {
    const u = new URL(API + path);
    for (const [a, b] of Object.entries(query || {})) if (b != null) u.searchParams.set(a, b);
    const r = await fetchFn(u.toString(), { method: metodo, headers: { 'api-key': k, accept: 'application/json', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const texto = await r.text().catch(() => '');
    let j = {}; try { j = texto ? JSON.parse(texto) : {}; } catch (_) { j = {}; }
    if (!r.ok) throw error(r.status === 429 ? 429 : 502, `Brevo ${r.status} en ${metodo} ${path}: ${j.message || j.code || texto.slice(0, 120) || 'error'}`);
    return { status: r.status, json: j };
  }
  return {
    get: (p, q) => pedir('GET', p, null, q).then(x => x.json),
    post: (p, b) => pedir('POST', p, b),
    put: (p, b) => pedir('PUT', p, b),
  };
}

// ---- Lista y atributos (se aseguran una vez por proceso) ------------------------------------

let listaCache = { clave: null, id: null };
let atributosListos = false;

async function asegurarLista(c, config) {
  const r = reglas(config);
  if (r.listaId) return r.listaId;
  const clave = r.carpeta + '/' + r.lista;
  if (listaCache.clave === clave && listaCache.id) return listaCache.id;
  // ¿Ya existe una lista con ese nombre?
  for (let offset = 0; offset < 1000; offset += 50) {
    const p = await c.get('/contacts/lists', { limit: 50, offset });
    const l = (p.lists || []).find(x => String(x.name).trim().toLowerCase() === r.lista.toLowerCase());
    if (l) { listaCache = { clave, id: l.id }; return l.id; }
    if ((p.lists || []).length < 50) break;
  }
  // No: la carpeta (existente o nueva) y la lista.
  let folderId = null;
  for (let offset = 0; offset < 1000; offset += 50) {
    const p = await c.get('/contacts/folders', { limit: 50, offset });
    const f = (p.folders || []).find(x => String(x.name).trim().toLowerCase() === r.carpeta.toLowerCase());
    if (f) { folderId = f.id; break; }
    if ((p.folders || []).length < 50) break;
  }
  if (!folderId) folderId = (await c.post('/contacts/folders', { name: r.carpeta })).json.id;
  const id = (await c.post('/contacts/lists', { name: r.lista, folderId })).json.id;
  listaCache = { clave, id };
  return id;
}

async function asegurarAtributos(c, config) {
  if (atributosListos) return;
  const r = reglas(config);
  const existentes = new Set(((await c.get('/contacts/attributes')).attributes || []).map(a => String(a.name).toUpperCase()));
  for (const [nombre, tipo] of Object.entries(r.atributos)) {
    if (existentes.has(nombre.toUpperCase())) continue;
    await c.post(`/contacts/attributes/normal/${encodeURIComponent(nombre)}`, { type: tipo || 'text' });
  }
  atributosListos = true;
}

// ---- Un lead → un contacto -------------------------------------------------------------------

const BLOQUEADOS = ['no_contactar', 'lista_negra'];
const partirNombre = s => { const p = String(s || '').trim().split(/\s+/).filter(Boolean); return { nombre: p[0] || '', apellido: p.slice(1).join(' ') }; };

function cuerpoContacto(config, env, lead, listaId) {
  const r = reglas(config);
  const { nombre, apellido } = partirNombre(lead.contacto);
  const sdr = ((config.USUARIOS || []).find(u => u.rol === 'sdr') || {}).nombre || '';
  const base = env.PUBLIC_URL || config.PUBLIC_URL_POR_DEFECTO || '';
  const bloqueado = lead.etapa === 'descartado' && BLOQUEADOS.includes(lead.razon_descarte);
  const attrs = {
    FIRSTNAME: nombre, LASTNAME: apellido,
    EMPRESA: lead.empresa || '', CARGO: lead.cargo || '', CIUDAD: lead.ciudad || '',
    ETAPA_PEAKU: D.ETAPA_LABEL[lead.etapa] || lead.etapa || '', FUENTE_PEAKU: lead.fuente || '',
    LEAD_PEAKU: base ? `${base.replace(/\/$/, '')}/sdr/#/lead/${lead.id}` : String(lead.id), SDR_PEAKU: sdr, LISTA_PEAKU: lead.lista_nombre || '',
  };
  if (lead.telefono) attrs.SMS = r.telefonoConMas ? lead.telefono : String(lead.telefono).replace(/^\+/, '');
  // Solo los atributos configurados (más los de Brevo: FIRSTNAME, LASTNAME, SMS).
  const permitidos = new Set(['FIRSTNAME', 'LASTNAME', 'SMS', ...Object.keys(r.atributos).map(k => k.toUpperCase())]);
  for (const k of Object.keys(attrs)) if (!permitidos.has(k)) delete attrs[k];
  const body = { attributes: attrs, updateEnabled: true, emailBlacklisted: bloqueado, smsBlacklisted: bloqueado };
  if (lead.email) body.email = String(lead.email).toLowerCase();
  if (bloqueado) body.unlinkListIds = [listaId]; else body.listIds = [listaId];
  return { body, bloqueado };
}

// Crea o actualiza el contacto y devuelve su id en Brevo.
async function subirContacto(c, config, env, lead, listaId) {
  if (!lead.email && !lead.telefono) throw error(400, 'Sin correo ni teléfono: Brevo necesita al menos uno');
  const { body } = cuerpoContacto(config, env, lead, listaId);
  const r = await c.post('/contacts', body);
  if (r.status === 201 && r.json && r.json.id) return { id: Number(r.json.id), creado: true };
  // 204: ya existía y se actualizó. Se busca el id por correo o por teléfono.
  if (lead.brevo_id) return { id: Number(lead.brevo_id), creado: false };
  const ident = lead.email ? { id: String(lead.email).toLowerCase(), tipo: 'email_id' } : { id: body.attributes.SMS, tipo: 'phone_id' };
  const x = await c.get('/contacts/' + encodeURIComponent(ident.id), { identifierType: ident.tipo });
  if (!x || !x.id) throw error(502, 'Brevo actualizó el contacto pero no devolvió su id');
  return { id: Number(x.id), creado: false };
}

async function sincronizarLead(db, config, env, leadId, { fetchFn } = {}) {
  const r = reglas(config);
  const lead = (await db.query(
    `SELECT l.*, i.nombre AS lista_nombre FROM ${T.leads} l LEFT JOIN ${T.imports} i ON i.id = l.import_id WHERE l.id = $1`, [Number(leadId)])).rows[0];
  if (!lead) throw error(404, 'Lead no encontrado');
  const c = cliente(env, fetchFn ? { fetchFn } : {});
  const ahora = new Date().toISOString();
  try {
    await asegurarAtributos(c, config);
    const listaId = await asegurarLista(c, config);
    const s = await subirContacto(c, config, env, lead, listaId);
    await db.query(`UPDATE ${T.leads} SET brevo_id = $2, brevo_at = GREATEST(updated_at, NOW()), brevo_error = NULL, brevo_intento_at = $3 WHERE id = $1`, [lead.id, s.id, ahora]);
    return { lead_id: lead.id, brevo_id: s.id, creado: s.creado, url: r.urlContacto.replace('{id}', s.id), bloqueado: cuerpoContacto(config, env, lead, listaId).bloqueado };
  } catch (e) {
    await db.query(`UPDATE ${T.leads} SET brevo_error = $2, brevo_intento_at = $3 WHERE id = $1`, [lead.id, String(e.message).slice(0, 300), ahora]);
    throw e;
  }
}

// ---- El job: lo que falta o cambió ------------------------------------------------------------

async function pendientes(db, config, { limite = 40 } = {}) {
  const r = reglas(config);
  const q = await db.query(
    `SELECT id FROM ${T.leads}
     WHERE (brevo_id IS NULL OR brevo_at IS NULL OR brevo_at < updated_at)
       AND (brevo_intento_at IS NULL OR brevo_intento_at < NOW() - ($2::int * INTERVAL '1 minute') OR brevo_intento_at < updated_at)
     ORDER BY updated_at DESC LIMIT $1`, [limite, r.reintentoMin]);
  return q.rows.map(x => x.id);
}

async function correrPendientes(db, config, env = process.env, { limite, fetchFn, log = null } = {}) {
  if (!activo(config, env)) return { hechos: 0, errores: 0, omitido: 'sin BREVO_API_KEY o contactos.activo = false' };
  const r = reglas(config);
  const ids = await pendientes(db, config, { limite: limite || r.porTanda });
  let hechos = 0, errores = 0; const detalle = [];
  for (const id of ids) {
    try { const s = await sincronizarLead(db, config, env, id, { fetchFn }); hechos++; detalle.push({ lead_id: id, ok: true, brevo_id: s.brevo_id, creado: s.creado }); }
    catch (e) {
      errores++; detalle.push({ lead_id: id, ok: false, error: e.message });
      if (log) log.error(`[sdr/brevo] lead ${id}: ${e.message}`);
      if (e.status === 429 || /BREVO_API_KEY|401|403/.test(e.message)) break;   // sin llave o con límite: no insistir en esta pasada
    }
  }
  return { hechos, errores, pendientes: ids.length, detalle };
}

async function estado(db, config, env = process.env) {
  const r = reglas(config);
  const t = (await db.query(
    `SELECT COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE brevo_id IS NOT NULL AND brevo_at >= updated_at)::int AS sincronizados,
            COUNT(*) FILTER (WHERE brevo_id IS NOT NULL AND brevo_at < updated_at)::int AS por_actualizar,
            COUNT(*) FILTER (WHERE brevo_id IS NULL AND brevo_error IS NULL)::int AS por_crear,
            COUNT(*) FILTER (WHERE brevo_id IS NULL AND brevo_error IS NOT NULL)::int AS con_error,
            MAX(brevo_at) AS ultimo
     FROM ${T.leads}`)).rows[0];
  const errores = (await db.query(
    `SELECT id, empresa, contacto, brevo_error, brevo_intento_at FROM ${T.leads} WHERE brevo_id IS NULL AND brevo_error IS NOT NULL ORDER BY brevo_intento_at DESC LIMIT 20`)).rows;
  return { activo: activo(config, env), con_llave: !!llaveBrevo(env), lista: r.lista, lista_id: listaCache.id || r.listaId || null, por_tanda: r.porTanda, ...t, errores, url_contacto: r.urlContacto };
}

function _reiniciar() { listaCache = { clave: null, id: null }; atributosListos = false; }

module.exports = { reglas, activo, cliente, asegurarLista, asegurarAtributos, cuerpoContacto, sincronizarLead, correrPendientes, pendientes, estado, _reiniciar };

// Calendly de la ejecutiva. Dos caminos para saber que una reunión quedó agendada de verdad:
//   1. Desde la app: el Calendly va embebido en el diálogo y la reserva se registra cuando Calendly
//      avisa `calendly.event_scheduled` (postMessage), no cuando se hace clic.
//   2. Con CALENDLY_TOKEN: cada CALENDLY.sincronizar_min se leen las reservas de la ejecutiva en la
//      API. Las que traen utm_content=lead-<id> (el link que la SDR mandó por WhatsApp/correo) o el
//      correo de un lead quedan como reunión de ese lead; las canceladas lo devuelven a la SDR.
// La tabla sdr.calendly_eventos guarda cada reserva vista una sola vez.
const { T } = require('./schema');
const D = require('./dominio');

const API = 'https://api.calendly.com';
function error(status, message) { return Object.assign(new Error(message), { status }); }

const activo = config => !!(config.CALENDLY && config.CALENDLY.url);
const token = env => (env && env.CALENDLY_TOKEN) || null;

// Link de reserva con el lead y el canal marcados (UTM), para embeber o para enviar.
function enlace(config, { lead = {}, canal, usuario, embebido = false, dominio } = {}) {
  if (!activo(config)) return null;
  const u = new URL(config.CALENDLY.url);
  if (lead.contacto) u.searchParams.set('name', lead.contacto);
  if (lead.email) u.searchParams.set('email', lead.email);
  u.searchParams.set('utm_source', 'peaku-sdr');
  if (canal) u.searchParams.set('utm_medium', canal);
  if (lead.id) u.searchParams.set('utm_content', `lead-${lead.id}`);
  if (usuario) u.searchParams.set('utm_term', usuario);
  if (embebido) {
    u.searchParams.set('embed_type', 'Inline');
    if (dominio) u.searchParams.set('embed_domain', dominio);
    u.searchParams.set('hide_gdpr_banner', '1');
  }
  return u.toString();
}

function leadDeTracking(tracking) {
  const m = /^lead-(\d+)$/.exec(String((tracking || {}).utm_content || '').trim());
  return m ? Number(m[1]) : null;
}

async function api(env, url, { fetchFn = fetch } = {}) {
  const t = token(env);
  if (!t) throw error(400, 'Falta CALENDLY_TOKEN');
  const r = await fetchFn(url.startsWith('http') ? url : API + url, { headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' } });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    // En un 403 por permisos Calendly dice qué scopes faltan: se muestran para saber qué marcar en el token.
    const faltan = j.required_scopes || (j.details && [].concat(...j.details.map(d => d.required_scopes || []))) || [];
    const ruta = String(url).replace(API, '').split('?')[0];
    throw error(502, `Calendly ${r.status} en ${ruta}: ${j.message || j.title || 'error'}${faltan.length ? ` Faltan permisos en el token: ${faltan.join(', ')}.` : ''}`);
  }
  return j;
}

// Hora, estado e invitado de una reserva a partir de sus URIs (las que manda el embebido).
async function resolver(env, { event_uri, invitee_uri }, opts = {}) {
  if (!/^https:\/\/api\.calendly\.com\/scheduled_events\//.test(event_uri || '')) throw error(400, 'URI de Calendly inválida');
  const ev = (await api(env, event_uri, opts)).resource || {};
  // Todos los invitados de la reserva (normalmente uno), con lo que respondieron en el formulario
  // ("Vacantes activas: 3", teléfono…) y los acompañantes que agregó (event_guests).
  const l = await api(env, `${event_uri}/invitees?count=20`, opts);
  const todos = l.collection || [];
  let inv = invitee_uri ? todos.find(i => i.uri === invitee_uri) : null;
  if (!inv && invitee_uri) inv = (await api(env, invitee_uri, opts)).resource || null;
  if (!inv) inv = todos.find(i => i.status === 'active') || todos[0] || null;
  const invitados = todos.map(i => ({
    email: i.email || null, nombre: i.name || null, estado: i.status === 'canceled' ? 'cancelado' : 'activo',
    telefono: i.text_reminder_number || null, no_show: !!i.no_show,
    respuestas: (i.questions_and_answers || []).filter(x => x.answer).map(x => ({ pregunta: x.question, respuesta: x.answer })),
  }));
  const acompanantes = (ev.event_guests || []).map(g => g.email).filter(Boolean);
  return {
    uri: event_uri, invitee_uri: inv ? inv.uri : invitee_uri || null,
    inicio: ev.start_time || null, fin: ev.end_time || null, estado: ev.status || null, nombre_evento: ev.name || null,
    enlace_reunion: ev.location && (ev.location.join_url || ev.location.location) || null,
    email: inv ? inv.email : null, nombre: inv ? inv.name : null, tracking: inv ? inv.tracking || null : null,
    motivo_cancelacion: ev.cancellation ? ev.cancellation.reason || null : null,
    invitados, acompanantes,
    respuestas: inv ? (inv.questions_and_answers || []).filter(x => x.answer).map(x => ({ pregunta: x.question, respuesta: x.answer })) : [],
  };
}

// Lo que Calendly sabe de la reserva aparte de la hora: respuestas del formulario y acompañantes.
function respuestasDe(e) {
  if (!e || (!e.respuestas && !e.acompanantes && !e.invitados)) return null;
  return { respuestas: e.respuestas || [], acompanantes: e.acompanantes || [], invitados: e.invitados || [], enlace_reunion: e.enlace_reunion || null, nombre_evento: e.nombre_evento || null };
}

async function registrarEvento(db, e) {
  const resp = respuestasDe(e);
  await db.query(
    `INSERT INTO ${T.calendly} (uri, invitee_uri, lead_id, inicio, email, nombre, tracking, origen, estado, respuestas)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (uri) DO UPDATE SET invitee_uri = COALESCE(EXCLUDED.invitee_uri, ${T.calendly}.invitee_uri),
       lead_id = COALESCE(EXCLUDED.lead_id, ${T.calendly}.lead_id), inicio = COALESCE(EXCLUDED.inicio, ${T.calendly}.inicio),
       respuestas = COALESCE(EXCLUDED.respuestas, ${T.calendly}.respuestas),
       estado = EXCLUDED.estado, updated_at = NOW()`,
    [e.uri, e.invitee_uri || null, e.lead_id || null, e.inicio || null, e.email || null, e.nombre || null,
      e.tracking ? JSON.stringify(e.tracking) : null, e.origen, e.estado || 'registrado', resp ? JSON.stringify(resp) : null]);
}

// Quién está invitado a la reunión y si aceptó. Calendly no lo sabe (solo sabe quién reservó); lo
// sabe Google Calendar, donde Calendly creó el evento en el calendario de la ejecutiva. Se busca ese
// evento por la hora y el correo del invitado (CALENDLY.calendarios_invitados dice en qué
// calendarios buscar, en orden) y se guarda la lista con la respuesta de cada uno.
async function refrescarInvitados(db, config, env, { uri, leadId, ahora = new Date(), fetchFn, forzar = false } = {}) {
  const cal = require('./calendario');
  if (!cal.activo(env)) return { omitido: 'sin llave de Google Calendar' };
  const opts = fetchFn ? { fetchFn } : {};
  const calendarios = (config.CALENDLY || {}).calendarios_invitados || [config.CALENDLY && config.CALENDLY.ejecutiva].filter(Boolean);
  const cond = uri ? 'uri = $1' : leadId ? 'lead_id = $1' : 'inicio > $1';
  const arg = uri || leadId || new Date(ahora.getTime() - 86400000).toISOString();
  // Sin uri ni lead: las reuniones vigentes (desde ayer) que no se han mirado en la última hora.
  const filas = (await db.query(
    `SELECT uri, lead_id, inicio, email, nombre, respuestas, invitados, invitados_at FROM ${T.calendly}
     WHERE ${cond} AND estado <> 'cancelado' AND inicio IS NOT NULL ${uri || leadId || forzar ? '' : 'AND (invitados_at IS NULL OR invitados_at < $2::timestamptz - INTERVAL \'55 minutes\')'}
     ORDER BY inicio DESC LIMIT ${uri || leadId ? 1 : 40}`, uri || leadId || forzar ? [arg] : [arg, ahora.toISOString()])).rows;
  const res = { revisadas: 0, encontradas: 0, errores: [] };
  for (const f of filas) {
    res.revisadas++;
    // Reservas de antes de guardar respuestas: se completan desde Calendly una vez.
    if (!f.respuestas && token(env)) {
      try {
        const e = await resolver(env, { event_uri: f.uri }, opts);
        f.respuestas = respuestasDe(e);
        await db.query(`UPDATE ${T.calendly} SET respuestas = $2 WHERE uri = $1`, [f.uri, JSON.stringify(f.respuestas)]);
      } catch (e) { res.errores.push(`${f.uri}: ${e.message}`); }
    }
    const r = f.respuestas || {};
    const emails = [...(r.acompanantes || []), ...((r.invitados || []).map(i => i.email))];
    let hallado = null, error = null, dueno = null;
    for (const quien of calendarios) {
      try {
        hallado = await cal.buscarEvento(env, config, quien, { inicio: f.inicio, email: f.email, nombre: f.nombre, emails }, opts);
        if (hallado) { dueno = quien; break; }
      } catch (e) { error = e.message; }
    }
    if (hallado) res.encontradas++; else if (error) res.errores.push(`${f.uri}: ${error}`);
    // La SDR (CALENDLY.invitar_al_evento) entra como invitada al evento si no está: así le aparece en su
    // calendario con los demás invitados. Solo funciona desde el calendario del organizador; si no, se deja.
    if (hallado && (config.CALENDLY.invitar_al_evento || []).length) {
      const correos = config.CALENDLY.invitar_al_evento.map(n => cal.emailDe(config, n)).filter(Boolean);
      const faltan = correos.filter(c => !hallado.invitados.some(i => i.email.toLowerCase() === c.toLowerCase()));
      if (faltan.length && hallado.organizador && hallado.organizador.toLowerCase() === String(cal.emailDe(config, dueno) || '').toLowerCase()) {
        try {
          const ev = await cal.agregarInvitados(env, config, dueno, hallado.id, faltan, opts);
          if (ev) { hallado.invitados = cal.invitadosDe(ev); res.agregados = (res.agregados || 0) + faltan.length; }
        } catch (e) { res.errores.push(`${f.uri}: no pude agregar ${faltan.join(', ')} al evento: ${e.message}`); }
      }
    }
    const inv = hallado
      ? { fuente: 'google', calendario: hallado.calendario, evento_id: hallado.id, enlace: hallado.htmlLink, titulo: hallado.titulo, enlace_reunion: hallado.enlace_reunion, organizador: hallado.organizador, lista: hallado.invitados, at: ahora.toISOString() }
      : { fuente: 'ninguna', motivo: error || 'No encontré el evento en Google Calendar', lista: [], at: ahora.toISOString() };
    await db.query(`UPDATE ${T.calendly} SET invitados = $2, invitados_at = $3, updated_at = NOW() WHERE uri = $1`, [f.uri, JSON.stringify(inv), ahora.toISOString()]);
  }
  return res;
}

// La reunión vigente de un lead con lo que se sabe de ella: hora, respuestas del formulario de
// Calendly, invitados y si aceptaron (de Google). null si el lead no tiene reserva registrada.
async function reunionDe(db, leadId) {
  const f = (await db.query(
    `SELECT uri, inicio, email, nombre, estado, respuestas, invitados, invitados_at, ${'(EXTRACT(EPOCH FROM inicio) * 1000)::float8'} AS inicio_ms
     FROM ${T.calendly} WHERE lead_id = $1 AND estado = 'registrado' ORDER BY created_at DESC LIMIT 1`, [Number(leadId)])).rows[0];
  if (!f) return null;
  const r = f.respuestas || {};
  const inv = f.invitados || null;
  return {
    uri: f.uri, inicio: f.inicio, inicio_ms: f.inicio_ms, reservo: { email: f.email, nombre: f.nombre },
    respuestas: r.respuestas || [], acompanantes: r.acompanantes || [], enlace_reunion: (inv && inv.enlace_reunion) || r.enlace_reunion || null,
    invitados: inv ? inv.lista : null, invitados_fuente: inv ? inv.fuente : null, invitados_motivo: inv ? inv.motivo || null : null,
    invitados_at: f.invitados_at, evento: inv && inv.enlace ? inv.enlace : null, calendario: inv ? inv.calendario || null : null,
  };
}

// Antes de registrar "Reunión agendada" desde la app: si vino de Calendly y hay token, la hora es la
// de Calendly (no la que se escriba a mano). Sin token, la fecha la pone la SDR.
async function prepararDetalle(env, detalle, opts = {}) {
  const cal = detalle && detalle.calendly;
  if (!cal || !cal.event_uri) return { detalle, evento: null };
  if (!token(env)) {
    if (!detalle.reunion_at) throw error(400, 'Pon el día y la hora que quedó en Calendly');
    return { detalle, evento: { uri: cal.event_uri, invitee_uri: cal.invitee_uri || null, inicio: detalle.reunion_at } };
  }
  const e = await resolver(env, cal, opts);
  return { detalle: { ...detalle, reunion_at: e.inicio || detalle.reunion_at, calendly: { ...cal, enlace_reunion: e.enlace_reunion } }, evento: e };
}

// Lista paginada de reservas de la cuenta dueña del token.
async function reservas(env, usuarioUri, { status, desde, opts }) {
  const out = [];
  let url = `/scheduled_events?user=${encodeURIComponent(usuarioUri)}&status=${status}&min_start_time=${encodeURIComponent(desde)}&count=100&sort=start_time:asc`;
  for (let i = 0; i < 5 && url; i++) {
    const r = await api(env, url, opts);
    out.push(...(r.collection || []));
    url = r.pagination && r.pagination.next_page;
  }
  return out;
}

async function sincronizar(db, config, env, { ahora = new Date(), fetchFn, log = console } = {}) {
  if (!activo(config) || !token(env)) return { omitido: !activo(config) ? 'sin CALENDLY.url' : 'sin CALENDLY_TOKEN' };
  const opts = fetchFn ? { fetchFn } : {};
  const { registrarToque, registrarEjecutiva, usuarioValido } = require('./resultados');
  const me = (await api(env, '/users/me', opts)).resource;
  const desde = new Date(ahora.getTime() - 2 * 86400000).toISOString();
  const res = { nuevas: 0, sin_lead: 0, movidas: 0, canceladas: 0, errores: [] };
  const conocidas = new Map((await db.query(`SELECT uri, estado, lead_id FROM ${T.calendly} WHERE inicio IS NULL OR inicio > $1`, [desde])).rows.map(x => [x.uri, x]));
  const sdrs = (config.USUARIOS || []).filter(u => u.rol === 'sdr').map(u => u.nombre);

  for (const ev of await reservas(env, me.uri, { status: 'active', desde, opts })) {
    const k = conocidas.get(ev.uri);
    if (k && k.estado === 'registrado') {
      // Ya la conocemos: si es la reunión vigente del lead y la hora de la app no coincide con la de
      // Calendly (se escribió mal a mano, o la movieron en Calendly), se corrige.
      if (k.lead_id && ev.start_time) {
        const l = (await db.query(`SELECT etapa, reunion_at FROM ${T.leads} WHERE id = $1`, [k.lead_id])).rows[0];
        const ultima = (await db.query(`SELECT uri FROM ${T.calendly} WHERE lead_id = $1 AND estado = 'registrado' ORDER BY created_at DESC LIMIT 1`, [k.lead_id])).rows[0];
        if (l && l.etapa === 'reunion_agendada' && ultima && ultima.uri === ev.uri && (!l.reunion_at || new Date(l.reunion_at).getTime() !== new Date(ev.start_time).getTime())) {
          await db.query(`UPDATE ${T.leads} SET reunion_at = $2 WHERE id = $1`, [k.lead_id, ev.start_time]);
          await db.query(`UPDATE ${T.calendly} SET inicio = $2, updated_at = NOW() WHERE uri = $1`, [ev.uri, ev.start_time]);
          res.movidas++;
        }
      }
      continue;
    }
    if (k && k.estado === 'cancelado') continue;
    try {
      // Nueva, o una sin lead que se vuelve a intentar (pudo cargarse el lead o su correo después).
      const e = await resolver(env, { event_uri: ev.uri }, opts);
      let leadId = leadDeTracking(e.tracking);
      if (!leadId && e.email) {
        const l = await db.query(`SELECT id FROM ${T.leads} WHERE LOWER(email) = LOWER($1) OR LOWER(extra->>'email_alt') = LOWER($1) ORDER BY id DESC LIMIT 1`, [e.email]);
        leadId = l.rows[0] ? l.rows[0].id : null;
      }
      let lead = leadId ? (await db.query(`SELECT id, etapa FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0] : null;
      // Coincidencia aproximada (dominio del correo de la empresa o nombre de la empresa en la reserva):
      // solo para ubicar la hora de una reunión que el lead YA tiene; nunca crea una reunión nueva.
      let aproximada = false;
      if (!lead) { lead = await reunionPorEmpresa(db, e); aproximada = !!lead; }
      if (!lead) { await registrarEvento(db, { ...e, origen: 'sincronizacion', estado: 'sin_lead' }); if (!k) res.sin_lead++; continue; }
      if (aproximada) {
        await db.query(`UPDATE ${T.leads} SET reunion_at = $2 WHERE id = $1`, [lead.id, e.inicio]);
        await registrarEvento(db, { ...e, lead_id: lead.id, origen: 'sincronizacion', estado: 'registrado' });
        res.movidas++;
        continue;
      }
      const t = e.tracking || {};
      if (lead.etapa === 'reunion_agendada') {
        // Ya tenía reunión (reagendó, o la registró a mano): se toma la hora de Calendly.
        await db.query(`UPDATE ${T.leads} SET reunion_at = $2 WHERE id = $1`, [lead.id, e.inicio]);
        res.movidas++;
      } else if (D.ETAPAS_DE_ANGIE.includes(lead.etapa)) {
        const canal = D.CANALES.includes(t.utm_medium) ? t.utm_medium : (config.CALENDLY.canal_por_defecto || 'whatsapp');
        await registrarToque(db, config, {
          leadId: lead.id, canal, resultado: 'reunion_agendada', usuario: usuarioValido(config, t.utm_term) || sdrs[0] || null,
          nota: `Reservó en Calendly desde el link${t.utm_medium ? ` (${D.CANAL_LABEL[t.utm_medium] || t.utm_medium})` : ''}.`,
          detalle: { reunion_at: e.inicio, ejecutiva: config.CALENDLY.ejecutiva, calendly: { event_uri: e.uri, invitee_uri: e.invitee_uri, enlace_reunion: e.enlace_reunion }, origen: 'calendly' },
          ahora, env,
        });
        res.nuevas++;
      }
      await registrarEvento(db, { ...e, lead_id: lead.id, origen: 'sincronizacion', estado: 'registrado' });
    } catch (err) { res.errores.push(`${ev.uri}: ${err.message}`); log.error('[sdr/calendly]', err.message); }
  }

  // Cancelaciones de reuniones que tenemos registradas.
  for (const ev of await reservas(env, me.uri, { status: 'canceled', desde, opts })) {
    const k = conocidas.get(ev.uri) || (await db.query(`SELECT uri, estado, lead_id FROM ${T.calendly} WHERE uri = $1`, [ev.uri])).rows[0];
    if (!k || k.estado === 'cancelado') continue;
    try {
      // Solo si esa es la reunión vigente del lead (no una vieja que ya se reagendó).
      const ultima = k.lead_id ? (await db.query(`SELECT uri FROM ${T.calendly} WHERE lead_id = $1 AND estado = 'registrado' ORDER BY created_at DESC LIMIT 1`, [k.lead_id])).rows[0] : null;
      const lead = k.lead_id ? (await db.query(`SELECT etapa FROM ${T.leads} WHERE id = $1`, [k.lead_id])).rows[0] : null;
      if (lead && lead.etapa === 'reunion_agendada' && ultima && ultima.uri === ev.uri) {
        const motivo = ev.cancellation && ev.cancellation.reason;
        await registrarEjecutiva(db, config, { leadId: k.lead_id, accion: 'reunion_cancelada', usuario: config.CALENDLY.ejecutiva, nota: `Cancelada en Calendly${motivo ? ': ' + motivo : ''}`, ahora, env });
      }
      await db.query(`UPDATE ${T.calendly} SET estado = 'cancelado', updated_at = NOW() WHERE uri = $1`, [ev.uri]);
      res.canceladas++;
    } catch (err) { res.errores.push(`${ev.uri}: ${err.message}`); log.error('[sdr/calendly]', err.message); }
  }
  // Invitados y respuestas de las reuniones vigentes (mejor esfuerzo: si Google falla, la sincronización sigue valiendo).
  try { res.invitados = await refrescarInvitados(db, config, env, { ahora, fetchFn }); }
  catch (err) { res.invitados = { error: err.message }; log.error('[sdr/calendly] invitados:', err.message); }
  return res;
}

const CORREO_PERSONAL = ['gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com', 'yahoo.es', 'live.com', 'icloud.com', 'hotmail.es', 'outlook.es', 'msn.com'];
// Lead con reunión agendada de la misma empresa que la reserva: por el dominio del correo (si no es
// uno personal) o porque el nombre de la empresa aparece en el nombre de la reserva ("Conoce Peaku! -
// Clinicos"). Solo devuelve un lead si hay exactamente uno que coincide.
async function reunionPorEmpresa(db, e) {
  const LN = require('./listanegra');
  const cand = (await db.query(`SELECT id, etapa, empresa, email FROM ${T.leads} WHERE etapa = 'reunion_agendada'`)).rows;
  const dom = String(e.email || '').toLowerCase().split('@')[1] || '';
  let hits = [];
  if (dom && !CORREO_PERSONAL.includes(dom)) hits = cand.filter(l => String(l.email || '').toLowerCase().endsWith('@' + dom));
  if (!hits.length && e.nombre) {
    const texto = ' ' + (LN.normalizarEmpresa(e.nombre) || '') + ' ';
    hits = cand.filter(l => { const n = LN.normalizarEmpresa(l.empresa); return n && n.length >= 4 && n !== 'sin empresa' && texto.includes(' ' + n + ' '); });
  }
  return hits.length === 1 ? hits[0] : null;
}

async function estado(db, config, env) {
  const r = await db.query(`SELECT estado, origen, COUNT(*)::int AS n FROM ${T.calendly} GROUP BY 1, 2`);
  const sinLead = await db.query(`SELECT uri, inicio, email, nombre, tracking FROM ${T.calendly} WHERE estado = 'sin_lead' ORDER BY inicio DESC NULLS LAST LIMIT 20`);
  return { activo: activo(config), token: !!token(env), url: activo(config) ? config.CALENDLY.url : null, conteo: r.rows, sin_lead: sinLead.rows };
}

module.exports = { activo, token, enlace, leadDeTracking, resolver, prepararDetalle, registrarEvento, sincronizar, estado, refrescarInvitados, reunionDe, respuestasDe };

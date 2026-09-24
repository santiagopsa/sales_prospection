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
  if (!r.ok) throw error(502, `Calendly ${r.status}: ${j.message || j.title || 'error'}`);
  return j;
}

// Hora, estado e invitado de una reserva a partir de sus URIs (las que manda el embebido).
async function resolver(env, { event_uri, invitee_uri }, opts = {}) {
  if (!/^https:\/\/api\.calendly\.com\/scheduled_events\//.test(event_uri || '')) throw error(400, 'URI de Calendly inválida');
  const ev = (await api(env, event_uri, opts)).resource || {};
  let inv = null;
  if (invitee_uri) inv = (await api(env, invitee_uri, opts)).resource || null;
  else {
    const l = await api(env, `${event_uri}/invitees?count=5`, opts);
    inv = (l.collection || []).find(i => i.status === 'active') || (l.collection || [])[0] || null;
  }
  return {
    uri: event_uri, invitee_uri: inv ? inv.uri : invitee_uri || null,
    inicio: ev.start_time || null, fin: ev.end_time || null, estado: ev.status || null, nombre_evento: ev.name || null,
    enlace_reunion: ev.location && (ev.location.join_url || ev.location.location) || null,
    email: inv ? inv.email : null, nombre: inv ? inv.name : null, tracking: inv ? inv.tracking || null : null,
    motivo_cancelacion: ev.cancellation ? ev.cancellation.reason || null : null,
  };
}

async function registrarEvento(db, e) {
  await db.query(
    `INSERT INTO ${T.calendly} (uri, invitee_uri, lead_id, inicio, email, nombre, tracking, origen, estado)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (uri) DO UPDATE SET invitee_uri = COALESCE(EXCLUDED.invitee_uri, ${T.calendly}.invitee_uri),
       lead_id = COALESCE(EXCLUDED.lead_id, ${T.calendly}.lead_id), inicio = COALESCE(EXCLUDED.inicio, ${T.calendly}.inicio),
       estado = EXCLUDED.estado, updated_at = NOW()`,
    [e.uri, e.invitee_uri || null, e.lead_id || null, e.inicio || null, e.email || null, e.nombre || null,
      e.tracking ? JSON.stringify(e.tracking) : null, e.origen, e.estado || 'registrado']);
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
    if (conocidas.has(ev.uri)) continue;
    try {
      const e = await resolver(env, { event_uri: ev.uri }, opts);
      let leadId = leadDeTracking(e.tracking);
      if (!leadId && e.email) {
        const l = await db.query(`SELECT id FROM ${T.leads} WHERE LOWER(email) = LOWER($1) ORDER BY id DESC LIMIT 1`, [e.email]);
        leadId = l.rows[0] ? l.rows[0].id : null;
      }
      const lead = leadId ? (await db.query(`SELECT id, etapa FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0] : null;
      if (!lead) { await registrarEvento(db, { ...e, origen: 'sincronizacion', estado: 'sin_lead' }); res.sin_lead++; continue; }
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
  return res;
}

async function estado(db, config, env) {
  const r = await db.query(`SELECT estado, origen, COUNT(*)::int AS n FROM ${T.calendly} GROUP BY 1, 2`);
  const sinLead = await db.query(`SELECT uri, inicio, email, nombre, tracking FROM ${T.calendly} WHERE estado = 'sin_lead' ORDER BY inicio DESC NULLS LAST LIMIT 20`);
  return { activo: activo(config), token: !!token(env), url: activo(config) ? config.CALENDLY.url : null, conteo: r.rows, sin_lead: sinLead.rows };
}

module.exports = { activo, token, enlace, leadDeTracking, resolver, prepararDetalle, registrarEvento, sincronizar, estado };

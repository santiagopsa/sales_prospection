// Google Calendar con cuenta de servicio y delegación de todo el dominio (Workspace de Peaku).
//
// Sin dependencias: JWT RS256 firmado con la llave del service account, con `sub` = el correo del
// usuario cuyo calendario se toca (angie@peaku.co…). El token se guarda en memoria hasta que
// vence. Todo es "mejor esfuerzo": si Google falla, el compromiso queda igual en la app y el
// error se guarda en la tarea (gcal_error) para verlo, nunca se rompe la operación.
//
// Llave: GOOGLE_CALENDAR_KEY_FILE (ruta a un JSON, en Render un Secret File) o
// GOOGLE_CALENDAR_KEY (el JSON entero en una variable).
const crypto = require('crypto');
const fs = require('fs');
const tiempo = require('./tiempo');

const SCOPE = 'https://www.googleapis.com/auth/calendar';
const API = 'https://www.googleapis.com/calendar/v3';
const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function error(status, message) { return Object.assign(new Error(message), { status }); }

function leerLlave(env = process.env) {
  let raw = null;
  if (env.GOOGLE_CALENDAR_KEY_FILE) {
    try { raw = fs.readFileSync(env.GOOGLE_CALENDAR_KEY_FILE, 'utf8'); }
    catch (e) { throw error(503, `No pude leer GOOGLE_CALENDAR_KEY_FILE (${env.GOOGLE_CALENDAR_KEY_FILE}): ${e.message}`); }
  } else if (env.GOOGLE_CALENDAR_KEY) raw = env.GOOGLE_CALENDAR_KEY;
  if (!raw) return null;
  let k;
  try { k = JSON.parse(raw); } catch (e) { throw error(503, 'La llave de Google Calendar no es JSON válido'); }
  for (const campo of ['client_email', 'private_key']) if (!k[campo]) throw error(503, `La llave de Google Calendar no trae "${campo}"`);
  return k;
}

const activo = (env = process.env) => !!(env.GOOGLE_CALENDAR_KEY_FILE || env.GOOGLE_CALENDAR_KEY);

// Correo del calendario de un usuario de la app (USUARIOS[].email).
function emailDe(config, usuario) {
  const u = (config.USUARIOS || []).find(x => x.nombre.toLowerCase() === String(usuario || '').toLowerCase());
  return u && u.email ? u.email : null;
}

// JWT de cuenta de servicio actuando como `sub`.
function jwt(llave, sub, ahora = Math.floor(Date.now() / 1000)) {
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const cuerpo = b64url(JSON.stringify({ iss: llave.client_email, sub, scope: SCOPE, aud: llave.token_uri || 'https://oauth2.googleapis.com/token', iat: ahora, exp: ahora + 3600 }));
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cab}.${cuerpo}`), llave.private_key);
  return `${cab}.${cuerpo}.${b64url(firma)}`;
}

const tokens = new Map(); // sub → { token, vence }
async function token(env, sub, { fetchFn = fetch } = {}) {
  const c = tokens.get(sub);
  if (c && c.vence > Date.now() + 60000) return c.token;
  const llave = leerLlave(env);
  if (!llave) throw error(503, 'Google Calendar no está configurado (GOOGLE_CALENDAR_KEY_FILE)');
  const r = await fetchFn(llave.token_uri || 'https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt(llave, sub) }).toString(),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    const d = j.error_description || j.error || r.status;
    throw error(502, /unauthorized_client|invalid_grant|unauthorized/i.test(String(j.error) + ' ' + String(d))
      ? `Google no autoriza a la cuenta de servicio a actuar como ${sub}: revisa la delegación de dominio (ID de cliente y scope ${SCOPE}) o que el correo exista. (${d})`
      : `Google no dio token: ${d}`);
  }
  tokens.set(sub, { token: j.access_token, vence: Date.now() + (Number(j.expires_in) || 3600) * 1000 });
  return j.access_token;
}

async function llamar(env, sub, metodo, ruta, body, { fetchFn = fetch } = {}) {
  const t = await token(env, sub, { fetchFn });
  const r = await fetchFn(`${API}${ruta}`, {
    method: metodo, headers: { Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (r.status === 204) return {};
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw error(r.status === 404 ? 404 : 502, `Google Calendar ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  return j;
}

// Evento a partir de un compromiso (fila de tasks) y su lead.
function eventoDe(config, tarea, lead, { publicUrl } = {}) {
  const tipo = (config.TIPOS_COMPROMISO || {})[tarea.tipo] || { label: tarea.tipo };
  const titulo = tarea.titulo || tipo.label;
  const quien = lead ? ` · ${lead.empresa}${lead.contacto ? ' (' + lead.contacto + ')' : ''}` : '';
  const desc = [
    tarea.nota,
    lead && lead.telefono && `Teléfono: ${lead.telefono}`,
    lead && lead.email && `Correo: ${lead.email}`,
    lead && publicUrl && `${publicUrl}/sdr/#/lead/${lead.id}`,
    `Compromiso SDR #${tarea.id}`,
  ].filter(Boolean).join('\n');
  const due = new Date(tarea.due_at);
  let start, end;
  if (tarea.con_hora) {
    const min = (config.CALENDARIO_DURACION_MIN || {})[tarea.tipo] || 30;
    start = { dateTime: due.toISOString(), timeZone: 'America/Bogota' };
    end = { dateTime: new Date(due.getTime() + min * 60000).toISOString(), timeZone: 'America/Bogota' };
  } else {
    const fecha = tiempo.fechaBogota(due);
    start = { date: fecha }; end = { date: tiempo.sumarDias(fecha, 1) };
  }
  const ev = {
    summary: `${config.CALENDARIO_PREFIJO || ''}${titulo}${quien}`,
    description: desc,
    start, end,
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: Number(config.CALENDARIO_AVISO_MIN) || 10 }] },
    extendedProperties: { private: { sdr_task: String(tarea.id) } },
  };
  if (Array.isArray(tarea.invitados) && tarea.invitados.length) ev.attendees = tarea.invitados.map(e => ({ email: e }));
  return ev;
}

async function crearEvento(env, config, usuario, tarea, lead, opts = {}) {
  const sub = emailDe(config, usuario);
  if (!sub) throw error(400, `${usuario || 'ese usuario'} no tiene correo en USUARIOS`);
  const ev = eventoDe(config, tarea, lead, opts);
  const r = await llamar(env, sub, 'POST', `/calendars/primary/events${ev.attendees ? '?sendUpdates=all' : ''}`, ev, opts);
  return { id: r.id, htmlLink: r.htmlLink, usuario: sub };
}

async function actualizarEvento(env, config, usuario, eventId, tarea, lead, opts = {}) {
  const sub = emailDe(config, usuario);
  if (!sub) throw error(400, `${usuario || 'ese usuario'} no tiene correo en USUARIOS`);
  const ev = eventoDe(config, tarea, lead, opts);
  const r = await llamar(env, sub, 'PATCH', `/calendars/primary/events/${encodeURIComponent(eventId)}${ev.attendees ? '?sendUpdates=all' : ''}`, ev, opts);
  return { id: r.id, htmlLink: r.htmlLink, usuario: sub };
}

async function borrarEvento(env, config, usuario, eventId, opts = {}) {
  const sub = emailDe(config, usuario);
  if (!sub) throw error(400, `${usuario || 'ese usuario'} no tiene correo en USUARIOS`);
  try { await llamar(env, sub, 'DELETE', `/calendars/primary/events/${encodeURIComponent(eventId)}`, null, opts); }
  catch (e) { if (e.status !== 404) throw e; }
  return { ok: true };
}

// Crea y borra un evento de prueba: dice en un minuto si la delegación quedó bien.
async function probar(env, config, usuario, opts = {}) {
  const sub = emailDe(config, usuario);
  if (!sub) throw error(400, `${usuario} no tiene correo en USUARIOS (config.js)`);
  if (!activo(env)) throw error(503, 'Falta GOOGLE_CALENDAR_KEY_FILE (o GOOGLE_CALENDAR_KEY)');
  const due = new Date(Date.now() + 3600 * 1000);
  const tarea = { id: 0, tipo: 'otro', titulo: 'Prueba de SDR Coach (se borra sola)', nota: 'Si ves esto, la delegación funciona.', due_at: due.toISOString(), con_hora: true };
  const ev = await crearEvento(env, config, usuario, tarea, null, opts);
  await borrarEvento(env, config, usuario, ev.id, opts);
  return { ok: true, calendario: sub, evento: ev.htmlLink || ev.id };
}

module.exports = { leerLlave, activo, emailDe, jwt, token, eventoDe, crearEvento, actualizarEvento, borrarEvento, probar, SCOPE, _tokens: tokens };

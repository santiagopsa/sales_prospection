// Lado servidor de las llamadas: qué necesita el navegador para entrar a Voximplant, la firma
// del login de un solo uso (la contraseña de Angie no sale de Render) y el webhook que manda
// el escenario al terminar cada llamada.
const crypto = require('crypto');
const { T } = require('./../schema');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

function leerEnv(env = process.env) {
  const v = {
    account: env.VOX_ACCOUNT, app: env.VOX_APP, user: env.VOX_USER, password: env.VOX_USER_PASSWORD,
    callerId: env.VOX_CALLER_ID, secreto: env.VOX_WEBHOOK_SECRET,
    // Nodo de la cuenta (1–13). Está en el dashboard de Voximplant, sección
    // "Credentials for working with API, SDK, SIP". El SDK no conecta sin él.
    node: /^\d{1,2}$/.test(String(env.VOX_NODE || '').trim()) ? Number(env.VOX_NODE) : null,
  };
  v.configurado = !!(v.account && v.app && v.user && v.password && v.callerId && v.secreto && v.node);
  v.faltan = Object.entries({ VOX_ACCOUNT: v.account, VOX_APP: v.app, VOX_USER: v.user, VOX_USER_PASSWORD: v.password, VOX_CALLER_ID: v.callerId, VOX_WEBHOOK_SECRET: v.secreto, VOX_NODE: v.node })
    .filter(([, x]) => !x).map(([k]) => k);
  return v;
}

// Lo que el navegador necesita (sin secretos).
function configPublica(env) {
  const v = leerEnv(env);
  return {
    configurado: v.configurado,
    faltan: v.faltan,
    usuario: v.configurado ? `${v.user}@${v.app}.${v.account}.voximplant.com` : null,
    callerId: v.callerId || null,
    node: v.node,
  };
}

// Login de un solo uso del Web SDK: el navegador pide una "key" a Voximplant y el servidor
// devuelve md5(key + '|' + md5(user + ':voximplant.com:' + password)). La clave nunca viaja.
function firmarLogin(env, key) {
  const v = leerEnv(env);
  if (!v.configurado) throw error(503, 'La telefonía no está configurada: faltan ' + v.faltan.join(', '));
  if (!key || typeof key !== 'string' || key.length > 200) throw error(400, 'Falta la key');
  return { hash: md5(key + '|' + md5(`${v.user}:voximplant.com:${v.password}`)) };
}

// Webhook del escenario. Se compara el secreto en tiempo constante.
async function recibirWebhook(db, env, headers, body, config = require('../config')) {
  const v = leerEnv(env);
  const recibido = String(headers['x-sdr-secret'] || '');
  const esperado = String(v.secreto || '');
  if (!esperado || recibido.length !== esperado.length || !crypto.timingSafeEqual(Buffer.from(recibido), Buffer.from(esperado))) {
    throw error(401, 'Secreto inválido');
  }
  const b = body || {};
  if (!b.uuid) throw error(400, 'Falta uuid');
  const leadId = Number(b.lead_id);
  if (!Number.isInteger(leadId)) throw error(400, 'Falta lead_id');
  const fecha = x => (x && !isNaN(Date.parse(x))) ? new Date(x).toISOString() : null;
  const duracion = Number.isFinite(Number(b.duracion_s)) ? Math.max(0, Math.round(Number(b.duracion_s))) : null;
  const r = await db.query(
    `INSERT INTO ${T.calls} (uuid, lead_id, origen, telefono, started_at, answered_at, ended_at, duracion_s, vox_call_id, vox_estado, record_url, pipeline_status, vox_codigo, vox_motivo, vox_intentos)
     VALUES ($1, $2, 'voximplant', $3, $4, $5, $6, $7, $8, $9, $10, 'pendiente_resultado', $11, $12, $13)
     ON CONFLICT (uuid) DO UPDATE SET
       vox_codigo = COALESCE(EXCLUDED.vox_codigo, ${T.calls}.vox_codigo),
       vox_motivo = COALESCE(EXCLUDED.vox_motivo, ${T.calls}.vox_motivo),
       vox_intentos = COALESCE(EXCLUDED.vox_intentos, ${T.calls}.vox_intentos),
       telefono = COALESCE(EXCLUDED.telefono, ${T.calls}.telefono),
       started_at = COALESCE(EXCLUDED.started_at, ${T.calls}.started_at),
       answered_at = COALESCE(EXCLUDED.answered_at, ${T.calls}.answered_at),
       ended_at = COALESCE(EXCLUDED.ended_at, ${T.calls}.ended_at),
       duracion_s = COALESCE(EXCLUDED.duracion_s, ${T.calls}.duracion_s),
       vox_call_id = COALESCE(EXCLUDED.vox_call_id, ${T.calls}.vox_call_id),
       vox_estado = COALESCE(EXCLUDED.vox_estado, ${T.calls}.vox_estado),
       record_url = COALESCE(EXCLUDED.record_url, ${T.calls}.record_url),
       updated_at = NOW()
     RETURNING id, touch_id`,
    [String(b.uuid), leadId, b.telefono || null, fecha(b.started_at), fecha(b.answered_at), fecha(b.ended_at), duracion, b.vox_call_id || null, b.estado || null, b.record_url || null,
     b.codigo != null ? String(b.codigo) : null, b.motivo || null, Number.isInteger(Number(b.intentos)) && b.intentos != null ? Number(b.intentos) : null]);
  const estado = await require('../pipeline').revisarLlamada(db, config, r.rows[0].id);
  return { ok: true, call_id: r.rows[0].id, pipeline: estado };
}

module.exports = { leerEnv, configPublica, firmarLogin, recibirWebhook };

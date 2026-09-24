// Compromisos: tareas con fecha (y hora, si se pactó) que nacen de una conversación, distintas
// de los toques de la secuencia. Viven en la misma tabla tasks con tipo <> 'secuencia'.
//
//   seguimiento  "me dijo que lo llamara el jueves a las 3"
//   enviar       propuesta, presentación, caso
//   reunion      la reunión agendada, para la ejecutiva (se crea sola al agendar)
//   otro         cualquier pendiente del día, con o sin lead
//
// Cada compromiso tiene dueño (usuario) y, si el dueño tiene correo en USUARIOS y hay llave de
// Google, un evento en su calendario que se crea, se mueve y se borra con la tarea. El calendario
// es "mejor esfuerzo": si Google falla, la tarea queda igual y el error se guarda en gcal_error.
const { T } = require('./schema');
const D = require('./dominio');
const tiempo = require('./tiempo');
const cal = require('./calendario');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;

function validarTipo(config, tipo) {
  const tipos = config.TIPOS_COMPROMISO || {};
  if (!tipos[tipo]) throw error(400, `Tipo de compromiso desconocido: ${tipo}. Válidos: ${Object.keys(tipos).join(', ')}`);
  return tipos[tipo];
}

// Instante de vencimiento: fecha (YYYY-MM-DD) + hora opcional (HH:MM), Bogotá.
function vencimiento(config, fecha, hora) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fecha || ''))) throw error(400, 'La fecha debe ser YYYY-MM-DD');
  if (hora) {
    const d = tiempo.instanteHM(fecha, hora);
    if (!d) throw error(400, 'La hora debe ser HH:MM');
    return { due: d, conHora: true };
  }
  return { due: tiempo.instante(fecha, config.HORA_INICIO_JORNADA), conHora: false };
}

// Inserta el compromiso (sin tocar Google). `c` puede ser un cliente en transacción.
async function insertar(c, config, { leadId, tipo, titulo, canal, fecha, hora, nota, usuario, creadoPor, invitados }) {
  const def = validarTipo(config, tipo);
  canal = canal || def.canal;
  if (!D.CANALES.includes(canal)) throw error(400, `canal inválido: ${canal}`);
  titulo = String(titulo || '').trim() || def.label;
  const { due, conHora } = vencimiento(config, fecha, hora);
  leadId = leadId == null || leadId === '' ? null : Number(leadId);
  if (leadId != null && !Number.isInteger(leadId)) throw error(400, 'lead_id inválido');
  if (leadId != null && !(await c.query(`SELECT 1 FROM ${T.leads} WHERE id = $1`, [leadId])).rows.length) throw error(404, 'Lead no encontrado');
  const paso = leadId != null ? (await c.query(`SELECT COALESCE(MAX(paso), 0)::int + 1 AS n FROM ${T.tasks} WHERE lead_id = $1`, [leadId])).rows[0].n : 0;
  const r = await c.query(
    `INSERT INTO ${T.tasks} (lead_id, paso, canal, due_at, tipo, titulo, nota, con_hora, usuario, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, lead_id, tipo, titulo, canal, due_at, con_hora, usuario`,
    [leadId, paso, canal, due.toISOString(), tipo, titulo, nota || null, conHora, usuario || null, creadoPor || usuario || null]);
  const t = r.rows[0];
  if (Array.isArray(invitados) && invitados.length) t.invitados = invitados;
  return t;
}

async function leer(db, id) {
  const r = await db.query(
    `SELECT t.*, l.empresa, l.contacto, l.telefono, l.email FROM ${T.tasks} t LEFT JOIN ${T.leads} l ON l.id = t.lead_id WHERE t.id = $1 AND t.tipo <> 'secuencia'`, [Number(id)]);
  if (!r.rows.length) throw error(404, 'Compromiso no encontrado');
  return r.rows[0];
}

// Marca en gcal_event_id de un compromiso cuyo evento ya existe porque lo creó Calendly.
const EN_CALENDLY = 'calendly';

// Sincroniza con Google Calendar. accion: 'crear' | 'mover' | 'borrar'. Nunca lanza: devuelve
// { ok, error } y deja el resultado en la fila.
async function sincronizar(db, config, env, taskId, accion, { fetchFn, invitados } = {}) {
  let t;
  try { t = await leer(db, taskId); } catch (e) { return { ok: false, error: e.message }; }
  // La reunión la creó Calendly en el calendario de la ejecutiva: no se duplica en Google.
  if (t.gcal_event_id === EN_CALENDLY) return { ok: true, omitido: 'el evento lo creó Calendly' };
  if (!cal.activo(env)) return { ok: false, error: null, omitido: 'sin llave' };
  if (!(config.CALENDARIO_TIPOS || []).includes(t.tipo)) return { ok: false, error: null, omitido: 'tipo no sincronizado' };
  const usuario = t.gcal_usuario ? (config.USUARIOS || []).find(u => u.email === t.gcal_usuario) : null;
  const dueno = usuario ? usuario.nombre : t.usuario;
  if (!cal.emailDe(config, dueno)) return { ok: false, error: null, omitido: 'dueño sin correo' };
  const lead = t.lead_id ? { id: t.lead_id, empresa: t.empresa, contacto: t.contacto, telefono: t.telefono, email: t.email } : null;
  const opts = { fetchFn, publicUrl: env.PUBLIC_URL || config.PUBLIC_URL_POR_DEFECTO };
  if (invitados) t.invitados = invitados;
  try {
    if (accion === 'borrar') {
      if (t.gcal_event_id) await cal.borrarEvento(env, config, dueno, t.gcal_event_id, opts);
      await db.query(`UPDATE ${T.tasks} SET gcal_event_id = NULL, gcal_error = NULL WHERE id = $1`, [t.id]);
      return { ok: true };
    }
    const ev = t.gcal_event_id && accion !== 'crear'
      ? await cal.actualizarEvento(env, config, dueno, t.gcal_event_id, t, lead, opts)
      : await cal.crearEvento(env, config, dueno, t, lead, opts);
    await db.query(`UPDATE ${T.tasks} SET gcal_event_id = $2, gcal_usuario = $3, gcal_error = NULL WHERE id = $1`, [t.id, ev.id, ev.usuario]);
    return { ok: true, evento: ev.id };
  } catch (e) {
    await db.query(`UPDATE ${T.tasks} SET gcal_error = $2 WHERE id = $1`, [t.id, String(e.message).slice(0, 400)]).catch(() => {});
    console.error('[sdr/calendario]', accion, 'tarea', t.id, e.message);
    return { ok: false, error: e.message };
  }
}

async function crear(db, config, env, datos, opts = {}) {
  const t = await insertar(db, config, datos);
  const g = await sincronizar(db, config, env, t.id, 'crear', { ...opts, invitados: datos.invitados });
  return { ...t, calendario: g };
}

async function hecha(db, config, env, taskId, { usuario, deshacer = false } = {}, opts = {}) {
  const t = await leer(db, taskId);
  await db.query(`UPDATE ${T.tasks} SET estado = $2, done_at = $3 WHERE id = $1`, [t.id, deshacer ? 'pendiente' : 'hecha', deshacer ? null : new Date().toISOString()]);
  const g = deshacer ? await sincronizar(db, config, env, t.id, 'crear', opts) : await sincronizar(db, config, env, t.id, 'borrar', opts);
  return { id: t.id, estado: deshacer ? 'pendiente' : 'hecha', calendario: g };
}

async function eliminar(db, config, env, taskId, opts = {}) {
  const t = await leer(db, taskId);
  await db.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = NOW() WHERE id = $1`, [t.id]);
  const g = await sincronizar(db, config, env, t.id, 'borrar', opts);
  return { id: t.id, estado: 'omitida', calendario: g };
}

// Mover: a una fecha/hora concreta, o `dias` días hábiles adelante (conserva la hora si la tenía).
async function mover(db, config, env, taskId, { fecha, hora, dias, titulo, nota } = {}, opts = {}) {
  const t = await leer(db, taskId);
  if (t.estado !== 'pendiente') throw error(409, 'El compromiso ya no está pendiente');
  let due = new Date(t.due_at), conHora = t.con_hora;
  if (fecha) {
    const v = vencimiento(config, fecha, hora !== undefined ? hora : (t.con_hora ? tiempo.horaBogota(due) : null));
    due = v.due; conHora = v.conHora;
  } else if (dias) {
    dias = Number(dias);
    if (!Number.isInteger(dias) || dias < 1 || dias > 90) throw error(400, 'Los días deben estar entre 1 y 90');
    const f = tiempo.avanzar(tiempo.fechaBogota(new Date()), dias, !!config.SALTAR_FINES_DE_SEMANA);
    due = t.con_hora ? tiempo.instanteHM(f, tiempo.horaBogota(due)) : tiempo.instante(f, config.HORA_INICIO_JORNADA);
  }
  await db.query(`UPDATE ${T.tasks} SET due_at = $2, con_hora = $3, titulo = COALESCE($4, titulo), nota = COALESCE($5, nota) WHERE id = $1`,
    [t.id, due.toISOString(), conHora, titulo != null ? String(titulo).trim() || null : null, nota != null ? String(nota) : null]);
  const g = await sincronizar(db, config, env, t.id, 'mover', opts);
  return { id: t.id, due_at: due.toISOString(), con_hora: conHora, fecha: tiempo.fechaBogota(due), calendario: g };
}

// Compromisos para la cola: los de hoy (y vencidos) y los próximos `dias` días, del usuario dado
// (o de todos si no hay usuario).
async function listar(db, config, { usuario = null, ahora = new Date(), dias = 7 } = {}) {
  const hoy = tiempo.fechaBogota(ahora);
  const finHoy = tiempo.instante(tiempo.sumarDias(hoy, 1), 0);
  const hasta = tiempo.instante(tiempo.sumarDias(hoy, dias + 1), 0);
  const r = await db.query(
    `SELECT t.id, t.lead_id, t.tipo, t.titulo, t.nota, t.canal, t.con_hora, t.usuario, t.gcal_event_id, t.gcal_error,
            ${ms('t.due_at')} AS due_ms, l.empresa, l.contacto, l.telefono, l.email, l.etapa
     FROM ${T.tasks} t LEFT JOIN ${T.leads} l ON l.id = t.lead_id
     WHERE t.estado = 'pendiente' AND t.tipo <> 'secuencia' AND t.due_at < $1
       AND ($2::text IS NULL OR LOWER(t.usuario) = LOWER($2))
     ORDER BY t.due_at`, [hasta.toISOString(), usuario]);
  const marcar = t => ({
    ...t,
    hora: t.con_hora ? tiempo.horaBogota(new Date(t.due_ms)) : null,
    fecha: tiempo.fechaBogota(new Date(t.due_ms)),
    vencido: t.con_hora ? t.due_ms < ahora.getTime() : t.due_ms < tiempo.instante(hoy, 0).getTime(),
  });
  const todos = r.rows.map(marcar);
  return {
    hoy: todos.filter(t => t.due_ms < finHoy.getTime()),
    proximos: todos.filter(t => t.due_ms >= finHoy.getTime()),
  };
}

// Vuelve a intentar los compromisos pendientes que no tienen evento (falló Google o no había llave).
// Lo llama el servidor cada tanto y la API /calendario/reintentar.
async function reintentarPendientes(db, config, env, { limite = 50, fetchFn } = {}) {
  if (!cal.activo(env)) return { intentados: 0, ok: 0, omitido: 'sin llave' };
  const r = await db.query(
    `SELECT id FROM ${T.tasks} WHERE estado = 'pendiente' AND tipo <> 'secuencia' AND gcal_event_id IS NULL AND due_at > NOW() - INTERVAL '1 day' ORDER BY due_at LIMIT $1`, [limite]);
  let ok = 0; const errores = [];
  for (const { id } of r.rows) {
    const g = await sincronizar(db, config, env, id, 'crear', { fetchFn });
    if (g.ok) ok++; else if (g.error) errores.push({ id, error: g.error });
  }
  return { intentados: r.rows.length, ok, errores };
}

// Usuario con rol ejecutiva para la reunión: la que anotó Angie si existe, si no la primera.
function ejecutivaPara(config, nombre) {
  const us = config.USUARIOS || [];
  const pedida = nombre && us.find(u => u.nombre.toLowerCase() === String(nombre).toLowerCase());
  return (pedida && pedida.rol === 'ejecutiva' ? pedida : us.find(u => u.rol === 'ejecutiva')) || null;
}

module.exports = { insertar, crear, hecha, eliminar, mover, listar, leer, sincronizar, reintentarPendientes, ejecutivaPara, vencimiento, EN_CALENDLY };

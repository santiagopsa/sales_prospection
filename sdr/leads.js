// Lecturas de leads: pipeline (vista secundaria), listado con filtros, ficha y cargas.
const { T } = require('./schema');
const { ETAPAS, ETAPAS_DE_ANGIE } = require('./dominio');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;

async function pipeline(db) {
  const r = await db.query(`SELECT etapa, COUNT(*)::int AS n FROM ${T.leads} GROUP BY etapa`);
  const n = Object.fromEntries(r.rows.map(x => [x.etapa, x.n]));
  const h = await db.query(
    `SELECT COUNT(*)::int AS n FROM ${T.leads} l
     WHERE l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb))
       AND NOT EXISTS (SELECT 1 FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente')`,
    [JSON.stringify(ETAPAS_DE_ANGIE)]);
  return { etapas: ETAPAS.map(etapa => ({ etapa, n: n[etapa] || 0 })), huerfanos: h.rows[0].n };
}

async function listarLeads(db, { etapa, huerfanos, q, limite = 200 } = {}) {
  const cond = [], params = [];
  if (etapa) {
    if (!ETAPAS.includes(etapa)) throw error(400, `etapa desconocida: ${etapa}`);
    params.push(etapa); cond.push(`l.etapa = $${params.length}`);
  }
  if (huerfanos) {
    params.push(JSON.stringify(ETAPAS_DE_ANGIE));
    cond.push(`l.etapa IN (SELECT jsonb_array_elements_text($${params.length}::jsonb))
               AND NOT EXISTS (SELECT 1 FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente')`);
  }
  if (q) {
    params.push(`%${String(q).trim()}%`);
    const i = params.length;
    cond.push(`(l.empresa ILIKE $${i} OR l.contacto ILIKE $${i} OR l.email ILIKE $${i} OR l.telefono ILIKE $${i})`);
  }
  params.push(Math.min(Number(limite) || 200, 1000));
  const r = await db.query(
    `SELECT l.id, l.empresa, l.contacto, l.cargo, l.telefono, l.email, l.ciudad, l.etapa,
            ${ms('l.created_at')} AS created_ms,
            (SELECT ${ms('MIN(t.due_at)')} FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente') AS proximo_ms
     FROM ${T.leads} l
     ${cond.length ? 'WHERE ' + cond.join(' AND ') : ''}
     ORDER BY l.created_at DESC, l.id DESC
     LIMIT $${params.length}`,
    params,
  );
  return r.rows;
}

async function detalleLead(db, id) {
  id = Number(id);
  if (!Number.isInteger(id)) throw error(400, 'id inválido');
  const l = await db.query(
    `SELECT id, empresa, contacto, cargo, telefono, telefono_original, email, ciudad, fuente, etapa,
            razon_descarte, deal_id, import_id, ${ms('created_at')} AS created_ms, ${ms('etapa_at')} AS etapa_ms,
            ${ms('reunion_at')} AS reunion_ms
     FROM ${T.leads} WHERE id = $1`, [id]);
  if (!l.rows.length) throw error(404, 'Lead no encontrado');
  const tareas = await db.query(
    `SELECT id, paso, canal, estado, ${ms('due_at')} AS due_ms, ${ms('done_at')} AS done_ms
     FROM ${T.tasks} WHERE lead_id = $1 ORDER BY paso`, [id]);
  const toques = await db.query(
    `SELECT t.id, t.task_id, t.canal, t.resultado, t.razon_descarte, t.nota, t.detalle, t.call_id, t.usuario,
            ${ms('t.created_at')} AS created_ms, c.duracion_s, c.record_url, c.origen AS call_origen
     FROM ${T.touches} t LEFT JOIN ${T.calls} c ON c.id = t.call_id
     WHERE t.lead_id = $1 ORDER BY t.created_at DESC, t.id DESC`, [id]);
  return { ...l.rows[0], tareas: tareas.rows, toques: toques.rows };
}

async function cargas(db, { limite = 20 } = {}) {
  const r = await db.query(
    `SELECT id, archivo, filas, creados, duplicados, con_error, ${ms('created_at')} AS created_ms
     FROM ${T.imports} ORDER BY created_at DESC LIMIT $1`, [Math.min(Number(limite) || 20, 100)]);
  return r.rows;
}

async function detalleCarga(db, id) {
  const r = await db.query(
    `SELECT id, archivo, filas, creados, duplicados, con_error, detalle, ${ms('created_at')} AS created_ms
     FROM ${T.imports} WHERE id = $1`, [Number(id)]);
  if (!r.rows.length) throw error(404, 'Carga no encontrada');
  return r.rows[0];
}

module.exports = { pipeline, listarLeads, detalleLead, cargas, detalleCarga };

// Marcación directa: un teléfono escrito a mano. Si ya es de un lead, devuelve ese lead; si no,
// crea uno nuevo con la secuencia por defecto (la llamada que sigue cumple su paso 1).
async function leadParaMarcar(db, config, { telefono, empresa, contacto, ahora = new Date() }) {
  const { normalizarTelefono } = require('./normalizar');
  const { planificar } = require('./secuencia');
  const tiempo = require('./tiempo');
  const tel = normalizarTelefono(telefono);
  if (!tel.e164) throw error(400, tel.error || 'Escribe un teléfono');
  const existe = await db.query(`SELECT id, empresa, etapa FROM ${T.leads} WHERE telefono = $1`, [tel.e164]);
  if (existe.rows.length) return { lead_id: existe.rows[0].id, existente: true, empresa: existe.rows[0].empresa, etapa: existe.rows[0].etapa };
  const plan = planificar(config, tiempo.fechaBogota(ahora));
  const r = await db.query(
    `WITH nuevo AS (
       INSERT INTO ${T.leads} (empresa, contacto, telefono, telefono_original, fuente)
       VALUES ($1, $2, $3, $4, 'marcacion directa') RETURNING id
     ), tareas AS (
       INSERT INTO ${T.tasks} (lead_id, paso, canal, due_at)
       SELECT nuevo.id, t.paso, t.canal, t.due_at FROM nuevo CROSS JOIN jsonb_to_recordset($5::jsonb) AS t(paso INT, canal TEXT, due_at TIMESTAMPTZ)
     )
     SELECT id FROM nuevo`,
    [String(empresa || '').trim() || 'Sin empresa', String(contacto || '').trim() || null, tel.e164, String(telefono).trim(),
     JSON.stringify(plan.map(p => ({ paso: p.paso, canal: p.canal, due_at: p.due_at.toISOString() })))]);
  return { lead_id: r.rows[0].id, existente: false, telefono: tel.e164 };
}

module.exports.leadParaMarcar = leadParaMarcar;

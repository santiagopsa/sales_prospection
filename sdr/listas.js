// Listas: cada archivo cargado (lead_imports) con los leads que trae (lista_leads). Sirven para
// priorizar las que están frescas (las que manda la ejecutiva: necesidad viva) y para trabajar una
// lista completa en orden desde Marcar.
const { T } = require('./schema');
const tiempo = require('./tiempo');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;
const DIA = 86400000;

function corte(config, ahora) {
  return new Date(ahora.getTime() - ((config.LISTAS || {}).dias_caliente || 14) * DIA);
}

// ¿Suma prioridad en la cola? Alta, abierta y con menos de dias_caliente días.
function caliente(config, lista, ahora = new Date()) {
  if (!lista || lista.prioridad !== 'alta' || lista.cerrada_ms) return false;
  return lista.created_ms >= corte(config, ahora).getTime();
}

function decorar(config, x, ahora) {
  const dias = (config.LISTAS || {}).dias_caliente || 14;
  const hot = caliente(config, x, ahora);
  return {
    ...x,
    nombre: x.nombre || x.archivo || `Carga #${x.id}`,
    caliente: hot,
    dias_restantes: hot ? Math.min(dias, Math.max(0, dias - Math.floor((ahora.getTime() - x.created_ms) / DIA))) : null,
  };
}

// Estado de cada lead dentro de la lista (desde que llegó la lista).
const ESTADO_SQL = `CASE
    WHEN l.etapa IN ('reunion_agendada', 'reunion_realizada', 'calificado') THEN 'reunion'
    WHEN l.etapa = 'descartado' THEN 'descartado'
    WHEN l.pausado_hasta > NOW() THEN 'pausa'
    WHEN u.created_at IS NULL THEN 'por_tocar'
    ELSE 'en_curso' END`;
const ULTIMO_TOQUE = `LEFT JOIN LATERAL (SELECT x.created_at, x.canal, x.resultado FROM ${T.touches} x
    WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva' AND x.created_at >= i.created_at ORDER BY x.created_at DESC, x.id DESC LIMIT 1) u ON true`;

// Listas activas: las de los últimos 60 días y las de prioridad alta abiertas. Calientes primero.
async function listar(db, config, { ahora = new Date() } = {}) {
  const hoy = tiempo.instante(tiempo.fechaBogota(ahora), 0);
  const r = await db.query(
    `SELECT i.id, i.nombre, i.archivo, i.origen, i.prioridad, i.usuario, ${ms('i.created_at')} AS created_ms, ${ms('i.cerrada_at')} AS cerrada_ms,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE e.estado = 'por_tocar')::int AS por_tocar,
            COUNT(*) FILTER (WHERE e.estado = 'en_curso')::int AS en_curso,
            COUNT(*) FILTER (WHERE e.estado = 'reunion')::int AS reuniones,
            COUNT(*) FILTER (WHERE e.estado = 'descartado')::int AS descartados,
            COUNT(*) FILTER (WHERE e.estado = 'pausa')::int AS en_pausa,
            COUNT(*) FILTER (WHERE e.ultimo >= $2)::int AS tocados_hoy
     FROM ${T.imports} i
     JOIN ${T.lista_leads} ll ON ll.import_id = i.id
     JOIN ${T.leads} l ON l.id = ll.lead_id
     ${ULTIMO_TOQUE}
     CROSS JOIN LATERAL (SELECT ${ESTADO_SQL} AS estado, u.created_at AS ultimo) e
     WHERE i.created_at >= $1 OR (i.prioridad = 'alta' AND i.cerrada_at IS NULL)
     GROUP BY i.id
     ORDER BY i.created_at DESC
     LIMIT 40`,
    [new Date(ahora.getTime() - 60 * DIA).toISOString(), hoy.toISOString()]);
  const listas = r.rows.map(x => decorar(config, x, ahora));
  return listas.sort((a, b) => (b.caliente - a.caliente) || (!!a.cerrada_ms - !!b.cerrada_ms) || b.created_ms - a.created_ms);
}

// Una lista con sus leads en el orden de trabajo: por tocar (en el orden del archivo), luego en
// curso (el que lleva más tiempo sin toque primero), y al final reuniones, pausas y descartados.
async function detalle(db, config, id, { ahora = new Date() } = {}) {
  id = Number(id);
  if (!Number.isInteger(id)) throw error(400, 'Lista inválida');
  const i = (await db.query(
    `SELECT id, nombre, archivo, origen, prioridad, usuario, ${ms('created_at')} AS created_ms, ${ms('cerrada_at')} AS cerrada_ms FROM ${T.imports} WHERE id = $1`, [id])).rows[0];
  if (!i) throw error(404, 'Lista no encontrada');
  const hoy = tiempo.instante(tiempo.fechaBogota(ahora), 0).getTime();
  const r = await db.query(
    `SELECT l.id, l.empresa, l.contacto, l.cargo, l.telefono, l.email, l.etapa, ll.fila,
            ${ESTADO_SQL} AS estado, ${ms('u.created_at')} AS ultimo_ms, u.canal AS ultimo_canal, u.resultado AS ultimo_resultado,
            (SELECT ${ms('MIN(t.due_at)')} FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente' AND t.tipo = 'secuencia') AS proximo_ms
     FROM ${T.imports} i
     JOIN ${T.lista_leads} ll ON ll.import_id = i.id
     JOIN ${T.leads} l ON l.id = ll.lead_id
     ${ULTIMO_TOQUE}
     WHERE i.id = $1`, [id]);
  const orden = { por_tocar: 0, en_curso: 1, reunion: 2, pausa: 3, descartado: 4 };
  const leads = r.rows.map(x => ({ ...x, tocado_hoy: x.ultimo_ms != null && x.ultimo_ms >= hoy }))
    .sort((a, b) => orden[a.estado] - orden[b.estado]
      || (a.estado === 'en_curso' ? (a.ultimo_ms || 0) - (b.ultimo_ms || 0) : 0)
      || (a.fila || 1e9) - (b.fila || 1e9) || a.id - b.id);
  const cuenta = e => leads.filter(x => x.estado === e).length;
  return {
    ...decorar(config, i, ahora),
    total: leads.length, por_tocar: cuenta('por_tocar'), en_curso: cuenta('en_curso'), reuniones: cuenta('reunion'),
    descartados: cuenta('descartado'), en_pausa: cuenta('pausa'), tocados_hoy: leads.filter(x => x.tocado_hoy).length,
    leads,
  };
}

// El siguiente lead de la lista para trabajar (sin tocar hoy, que no sea `excluir`).
function siguienteDe(lista, excluir = null) {
  const vivos = lista.leads.filter(x => ['por_tocar', 'en_curso'].includes(x.estado) && !x.tocado_hoy && String(x.id) !== String(excluir));
  return vivos[0] || null;
}

// Cambiar nombre, origen o prioridad; cerrar (deja de sumar en la cola) o reabrir.
async function actualizar(db, config, id, { nombre, origen, prioridad, cerrar, reabrir } = {}) {
  id = Number(id);
  const sets = [], params = [id];
  if (nombre !== undefined) { params.push(String(nombre || '').trim().slice(0, 120) || null); sets.push(`nombre = $${params.length}`); }
  if (origen !== undefined) { params.push(String(origen || '').trim().slice(0, 60) || null); sets.push(`origen = $${params.length}`); }
  if (prioridad !== undefined) {
    if (!['alta', 'normal'].includes(prioridad)) throw error(400, 'Prioridad: alta o normal');
    params.push(prioridad); sets.push(`prioridad = $${params.length}`);
  }
  if (cerrar) sets.push('cerrada_at = NOW()');
  if (reabrir) sets.push('cerrada_at = NULL');
  if (!sets.length) throw error(400, 'Nada que cambiar');
  const r = await db.query(`UPDATE ${T.imports} SET ${sets.join(', ')} WHERE id = $1 RETURNING id`, params);
  if (!r.rows.length) throw error(404, 'Lista no encontrada');
  return detalle(db, config, id);
}

// Para la cola: la lista caliente más reciente de cada lead (id → { id, nombre, origen }).
async function calientesPorLead(db, config, leadIds, { ahora = new Date() } = {}) {
  const out = new Map();
  if (!leadIds.length || !((config.LISTAS || {}).puntos)) return out;
  const r = await db.query(
    `SELECT DISTINCT ON (ll.lead_id) ll.lead_id, i.id, COALESCE(i.nombre, i.archivo) AS nombre, i.origen
     FROM ${T.lista_leads} ll JOIN ${T.imports} i ON i.id = ll.import_id
     WHERE ll.lead_id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)
       AND i.prioridad = 'alta' AND i.cerrada_at IS NULL AND i.created_at >= $2
     ORDER BY ll.lead_id, i.created_at DESC`,
    [JSON.stringify(leadIds), corte(config, ahora).toISOString()]);
  for (const x of r.rows) out.set(x.lead_id, { id: x.id, nombre: x.nombre, origen: x.origen });
  return out;
}

module.exports = { listar, detalle, actualizar, siguienteDe, calientesPorLead, caliente };

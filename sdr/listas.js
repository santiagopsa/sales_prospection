// Listas: cada archivo cargado (lead_imports) con los leads que trae (lista_leads). Sirven para
// priorizar las que están frescas (las que manda la ejecutiva: necesidad viva) y para trabajar una
// lista completa en orden desde Marcar.
const { T } = require('./schema');
const tiempo = require('./tiempo');
const D = require('./dominio');
const Calidad = require('./calidad_lista');

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
// Lo que pasó con el lead desde que llegó la lista: ¿conversó? ¿agendó? ($conv = JSON con los
// resultados que cuentan como conversación). Reunión = toque de reunión agendada o etapa de reunión.
// Y qué dicen los números: ¿se llamó? ¿contestó alguien (persona, recepción, buzón, o la central
// marcó answered)? ¿el operador dijo que el número no existe?
const HISTORIA = conv => `LEFT JOIN LATERAL (SELECT
      BOOL_OR(x.resultado IN (SELECT jsonb_array_elements_text(${conv}::jsonb))) AS conversacion,
      BOOL_OR(x.resultado = 'reunion_agendada') AS reunion,
      BOOL_OR(x.canal = 'llamada') AS llamado,
      BOOL_OR(x.canal = 'llamada' AND x.resultado IN ('gatekeeper', 'buzon', 'conversacion', 'pide_info', 'reunion_agendada')) AS vivo
    FROM ${T.touches} x WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva' AND x.created_at >= i.created_at) h ON true
  LEFT JOIN LATERAL (SELECT
      BOOL_OR(k.answered_at IS NOT NULL) AS contesto,
      BOOL_OR(k.vox_estado = 'numero_invalido') AS invalido
    FROM ${T.calls} k WHERE k.lead_id = l.id AND k.created_at >= i.created_at) kk ON true`;
const FILA_CALIDAD = `l.cargo, l.telefono, l.extra->>'empleados' AS empleados, l.razon_descarte,
            (u.created_at IS NOT NULL) AS tocado, COALESCE(h.conversacion, false) AS conversacion,
            (COALESCE(h.reunion, false) OR l.etapa IN ('reunion_agendada', 'reunion_realizada', 'calificado')) AS reunion,
            COALESCE(h.llamado, false) AS llamado,
            (COALESCE(h.vivo, false) OR COALESCE(kk.contesto, false)) AS numero_vivo,
            COALESCE(kk.invalido, false) AS numero_invalido`;
const CONV = JSON.stringify(D.RESULTADOS_CON_CONVERSACION);

// Resultados y calificación de una lista a partir de sus filas (ver sdr/calidad_lista.js).
function calificarFilas(config, filas, promedio) {
  const perfil = Calidad.perfilar(filas, config);
  const calidad = Calidad.calificar(perfil, config, { promedio });
  return { tocados: perfil.tocados, conversaciones: perfil.conversaciones, reuniones: perfil.reuniones, calidad, perfil: { cargo: perfil.cargo, telefono: perfil.telefono, tamano: perfil.tamano, numeros: perfil.numeros, descartes: perfil.descartes } };
}

// Listas activas: las de los últimos 60 días y las de prioridad alta abiertas. Calientes primero.
async function listar(db, config, { ahora = new Date() } = {}) {
  const hoy = tiempo.instante(tiempo.fechaBogota(ahora), 0);
  const r = await db.query(
    `SELECT i.id, i.nombre, i.archivo, i.origen, i.prioridad, i.usuario, ${ms('i.created_at')} AS created_ms, ${ms('i.cerrada_at')} AS cerrada_ms,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE e.estado = 'por_tocar')::int AS por_tocar,
            COUNT(*) FILTER (WHERE e.estado = 'en_curso')::int AS en_curso,
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
  if (!r.rows.length) return [];
  // Filas mínimas de cada lead de esas listas para la calificación (cargo, teléfono, tamaño, qué pasó).
  const f = await db.query(
    `SELECT ll.import_id, ${FILA_CALIDAD}
     FROM ${T.imports} i
     JOIN ${T.lista_leads} ll ON ll.import_id = i.id
     JOIN ${T.leads} l ON l.id = ll.lead_id
     ${ULTIMO_TOQUE}
     ${HISTORIA('$2')}
     WHERE i.id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`,
    [JSON.stringify(r.rows.map(x => x.id)), CONV]);
  const porLista = new Map();
  for (const x of f.rows) { if (!porLista.has(x.import_id)) porLista.set(x.import_id, []); porLista.get(x.import_id).push(x); }
  const perfiles = r.rows.map(x => Calidad.perfilar(porLista.get(x.id) || [], config));
  const promedio = Calidad.promedioDe(perfiles);
  const listas = r.rows.map(x => ({ ...decorar(config, x, ahora), ...calificarFilas(config, porLista.get(x.id) || [], promedio) }));
  return Object.assign(listas.sort((a, b) => (b.caliente - a.caliente) || (!!a.cerrada_ms - !!b.cerrada_ms) || b.created_ms - a.created_ms), { promedio });
}

// Tasas de todas las listas activas (ancla para el detalle de una).
async function promedioListas(db, config, { ahora = new Date() } = {}) {
  const ls = await listar(db, config, { ahora });
  return ls.promedio || null;
}

// Una lista con sus leads en el orden de trabajo: por tocar (en el orden del archivo), luego en
// curso (el que lleva más tiempo sin toque primero), y al final reuniones, pausas y descartados.
async function detalle(db, config, id, { ahora = new Date(), conPromedio = true } = {}) {
  id = Number(id);
  if (!Number.isInteger(id)) throw error(400, 'Lista inválida');
  const i = (await db.query(
    `SELECT id, nombre, archivo, origen, prioridad, usuario, ${ms('created_at')} AS created_ms, ${ms('cerrada_at')} AS cerrada_ms FROM ${T.imports} WHERE id = $1`, [id])).rows[0];
  if (!i) throw error(404, 'Lista no encontrada');
  const hoy = tiempo.instante(tiempo.fechaBogota(ahora), 0).getTime();
  const r = await db.query(
    `SELECT l.id, l.empresa, l.contacto, l.email, l.etapa, ll.fila, ${FILA_CALIDAD},
            ${ESTADO_SQL} AS estado, ${ms('u.created_at')} AS ultimo_ms, u.canal AS ultimo_canal, u.resultado AS ultimo_resultado,
            (SELECT ${ms('MIN(t.due_at)')} FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente' AND t.tipo = 'secuencia') AS proximo_ms
     FROM ${T.imports} i
     JOIN ${T.lista_leads} ll ON ll.import_id = i.id
     JOIN ${T.leads} l ON l.id = ll.lead_id
     ${ULTIMO_TOQUE}
     ${HISTORIA('$2')}
     WHERE i.id = $1`, [id, CONV]);
  const orden = { por_tocar: 0, en_curso: 1, reunion: 2, pausa: 3, descartado: 4 };
  const leads = r.rows.map(x => ({ ...x, tocado_hoy: x.ultimo_ms != null && x.ultimo_ms >= hoy }))
    .sort((a, b) => orden[a.estado] - orden[b.estado]
      || (a.estado === 'en_curso' ? (a.ultimo_ms || 0) - (b.ultimo_ms || 0) : 0)
      || (a.fila || 1e9) - (b.fila || 1e9) || a.id - b.id);
  const cuenta = e => leads.filter(x => x.estado === e).length;
  const promedio = conPromedio ? await promedioListas(db, config, { ahora }) : null;
  return {
    ...decorar(config, i, ahora),
    total: leads.length, por_tocar: cuenta('por_tocar'), en_curso: cuenta('en_curso'),
    descartados: cuenta('descartado'), en_pausa: cuenta('pausa'), tocados_hoy: leads.filter(x => x.tocado_hoy).length,
    ...calificarFilas(config, leads, promedio),
    leads: leads.map(({ empleados, razon_descarte, tocado, conversacion, reunion, llamado, numero_vivo, numero_invalido, ...x }) => ({ ...x, razon_descarte, conversacion, reunion, numero_vivo, numero_invalido })),
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

module.exports = { listar, detalle, actualizar, siguienteDe, calientesPorLead, caliente, promedioListas };

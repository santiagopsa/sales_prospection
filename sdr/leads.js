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
  const p = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.leads} WHERE pausado_hasta IS NOT NULL AND pausado_hasta > NOW() AND etapa <> 'descartado'`);
  const ln = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.lista_negra}`);
  const f = await db.query(`SELECT COUNT(*)::int AS n FROM ${T.calls} WHERE (vox_estado IN ('numero_invalido','fallo_central') OR reportado_at IS NOT NULL) AND revisado_at IS NULL`);
  return { etapas: ETAPAS.map(etapa => ({ etapa, n: n[etapa] || 0 })), huerfanos: h.rows[0].n, pausados: p.rows[0].n, listaNegra: ln.rows[0].n, fallos: f.rows[0].n };
}

async function listarLeads(db, { etapa, huerfanos, pausados, q, limite = 200 } = {}) {
  const cond = [], params = [];
  if (pausados) cond.push(`l.pausado_hasta IS NOT NULL AND l.pausado_hasta > NOW() AND l.etapa <> 'descartado'`);
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
    `SELECT l.id, l.empresa, l.contacto, l.cargo, l.telefono, l.email, l.ciudad, l.etapa, l.razon_descarte,
            ${ms('l.created_at')} AS created_ms,
            CASE WHEN l.pausado_hasta > NOW() THEN ${ms('l.pausado_hasta')} END AS pausado_ms,
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
    `SELECT id, empresa, contacto, cargo, telefono, telefono_original, telefono_alt, email, ciudad, fuente, etapa, extra,
            razon_descarte, deal_id, import_id, ${ms('created_at')} AS created_ms, ${ms('etapa_at')} AS etapa_ms,
            ${ms('reunion_at')} AS reunion_ms, CASE WHEN pausado_hasta > NOW() THEN ${ms('pausado_hasta')} END AS pausado_ms,
            EXISTS (SELECT 1 FROM ${T.lista_negra} n WHERE (n.telefono IS NOT NULL AND n.telefono = l.telefono) OR (n.email IS NOT NULL AND n.email = l.email)) AS en_lista_negra
     FROM ${T.leads} l WHERE id = $1`, [id]);
  if (!l.rows.length) throw error(404, 'Lead no encontrado');
  const tareas = await db.query(
    `SELECT id, paso, canal, estado, tipo, titulo, con_hora, usuario, gcal_event_id, gcal_error, ${ms('due_at')} AS due_ms, ${ms('done_at')} AS done_ms
     FROM ${T.tasks} WHERE lead_id = $1 ORDER BY due_at, paso`, [id]);
  const toques = await db.query(
    `SELECT t.id, t.task_id, t.canal, t.resultado, t.razon_descarte, t.nota, t.detalle, t.call_id, t.usuario,
            ${ms('t.created_at')} AS created_ms, c.duracion_s, c.record_url, c.origen AS call_origen, c.pipeline_status, c.vox_estado, c.vox_codigo, c.vox_intentos
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
  const tel = normalizarTelefono(telefono, null, config);
  if (!tel.e164) throw error(400, tel.error || 'Escribe un teléfono');
  const ln = await require('./listanegra').enLista(db, [tel.e164], []);
  if (ln.telefonos.size) throw error(409, 'Ese número está en la lista negra: pidió que no lo contacten.');
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

// Editar los datos de contacto de un lead. Los teléfonos se normalizan; el principal sigue siendo
// llave de deduplicación (si ya es de otro lead, 409 con quién). Queda un rastro en el historial.
async function editarLead(db, config, id, campos, usuario = null) {
  const { normalizarTelefono } = require('./normalizar');
  id = Number(id);
  if (!Number.isInteger(id)) throw error(400, 'id inválido');
  const actual = (await db.query(`SELECT * FROM ${T.leads} WHERE id = $1`, [id])).rows[0];
  if (!actual) throw error(404, 'Lead no encontrado');
  const limpiar = v => (v == null ? null : String(v).trim() || null);
  const nuevo = {};
  const c = campos || {};
  if ('empresa' in c) { nuevo.empresa = limpiar(c.empresa); if (!nuevo.empresa) throw error(400, 'La empresa no puede quedar vacía'); }
  for (const k of ['contacto', 'cargo', 'ciudad']) if (k in c) nuevo[k] = limpiar(c[k]);
  if ('email' in c) {
    nuevo.email = limpiar(c.email) ? String(c.email).trim().toLowerCase() : null;
    if (nuevo.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nuevo.email)) throw error(400, 'Correo inválido');
  }
  for (const k of ['telefono', 'telefono_alt']) {
    if (!(k in c)) continue;
    const v = limpiar(c[k]);
    if (!v) { nuevo[k] = null; continue; }
    const n = normalizarTelefono(v, nuevo.ciudad !== undefined ? nuevo.ciudad : actual.ciudad, config);
    if (!n.e164) throw error(400, `${k === 'telefono' ? 'Teléfono' : 'Segundo teléfono'}: ${n.error || 'inválido'}`);
    nuevo[k] = n.e164;
  }
  if (nuevo.telefono && nuevo.telefono_alt && nuevo.telefono === nuevo.telefono_alt) nuevo.telefono_alt = null;
  // Choques con otros leads (teléfono principal o correo).
  const tel = 'telefono' in nuevo ? nuevo.telefono : actual.telefono;
  const mail = 'email' in nuevo ? nuevo.email : actual.email;
  const choque = (await db.query(
    `SELECT id, empresa FROM ${T.leads} WHERE id <> $1 AND (($2::text IS NOT NULL AND telefono = $2) OR ($3::text IS NOT NULL AND email = $3)) LIMIT 1`, [id, tel, mail])).rows[0];
  if (choque) throw error(409, `Ese ${tel && choque.id ? 'teléfono o correo' : 'dato'} ya es del lead #${choque.id} (${choque.empresa})`);
  const cambios = {};
  for (const [k, v] of Object.entries(nuevo)) if ((actual[k] || null) !== (v || null)) cambios[k] = { antes: actual[k] || null, ahora: v || null };
  if (!Object.keys(cambios).length) return { id, cambios: {}, sin_cambios: true };
  const sets = [], params = [id];
  for (const k of Object.keys(cambios)) { params.push(nuevo[k]); sets.push(`${k} = $${params.length}`); }
  await db.query(`UPDATE ${T.leads} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $1`, params);
  // El deal del Sandler, si existe y la ejecutiva no lo ha trabajado aún, hereda el nombre nuevo.
  if (cambios.empresa && actual.deal_id) {
    try { await db.query(`UPDATE public.deals SET company = $2 WHERE id = $1 AND COALESCE(data->>'transcript', '') = ''`, [actual.deal_id, nuevo.empresa]); }
    catch (e) { console.error('[sdr] no se actualizó el nombre en el deal:', e.message); }
  }
  await db.query(
    `INSERT INTO ${T.touches} (lead_id, canal, resultado, nota, detalle, usuario) VALUES ($1, 'ejecutiva', 'editado', $2, $3::jsonb, $4)`,
    [id, Object.keys(cambios).map(k => `${k}: ${cambios[k].antes || '—'} → ${cambios[k].ahora || '—'}`).join('; '), JSON.stringify({ cambios }), usuario]);
  return { id, cambios };
}

// Fallos de marcación: llamadas que el operador no pudo cursar, con el reporte de Angie si lo hay.
async function fallosDeMarcacion(db, { limite = 200 } = {}) {
  const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;
  const r = await db.query(
    `SELECT k.id, k.uuid, k.lead_id, k.telefono, k.vox_estado, k.vox_codigo, k.vox_motivo, k.vox_intentos, k.vox_call_id, k.reporte,
            ${ms('k.reportado_at')} AS reportado_ms, ${ms('k.revisado_at')} AS revisado_ms, ${ms('COALESCE(k.started_at, k.created_at)')} AS started_ms,
            l.empresa, l.contacto,
            (SELECT COUNT(*)::int FROM ${T.calls} k2 WHERE COALESCE(k2.telefono, 'lead:' || k2.lead_id) = COALESCE(k.telefono, 'lead:' || k.lead_id) AND k2.vox_estado IN ('numero_invalido','fallo_central')) AS fallos_del_numero,
            (SELECT COUNT(*)::int FROM ${T.calls} k3 WHERE COALESCE(k3.telefono, 'lead:' || k3.lead_id) = COALESCE(k.telefono, 'lead:' || k.lead_id) AND k3.answered_at IS NOT NULL) AS contestadas_del_numero
     FROM ${T.calls} k JOIN ${T.leads} l ON l.id = k.lead_id
     WHERE k.vox_estado IN ('numero_invalido', 'fallo_central') OR k.reportado_at IS NOT NULL
     ORDER BY k.revisado_at NULLS FIRST, k.created_at DESC LIMIT $1`, [Math.min(Number(limite) || 200, 1000)]);
  return r.rows;
}

// Reporte de Angie sobre un intento fallido ("desde el celular sí entra"). Llega por uuid porque el
// webhook puede no haber creado la fila todavía.
async function reportarLlamada(db, { uuid, leadId, telefono, codigo, estado, nota, usuario }) {
  if (!uuid) throw error(400, 'Falta el uuid de la llamada');
  const r = await db.query(
    `INSERT INTO ${T.calls} (uuid, lead_id, origen, telefono, vox_estado, vox_codigo, reporte, reportado_at, started_at, ended_at)
     VALUES ($1, $2, 'voximplant', $3, $4, $5, $6, NOW(), NOW(), NOW())
     ON CONFLICT (uuid) DO UPDATE SET reporte = EXCLUDED.reporte, reportado_at = NOW(),
       vox_estado = COALESCE(${T.calls}.vox_estado, EXCLUDED.vox_estado), vox_codigo = COALESCE(${T.calls}.vox_codigo, EXCLUDED.vox_codigo), updated_at = NOW()
     RETURNING id`,
    [String(uuid), Number(leadId), telefono || null, estado || null, codigo != null ? String(codigo) : null, `${usuario ? usuario + ': ' : ''}${nota || 'desde el celular sí entra'}`]);
  return { call_id: r.rows[0].id, ok: true };
}

async function revisarFallo(db, id, revisado = true) {
  const r = await db.query(`UPDATE ${T.calls} SET revisado_at = ${revisado ? 'NOW()' : 'NULL'}, updated_at = NOW() WHERE id = $1 RETURNING id`, [Number(id)]);
  if (!r.rows.length) throw error(404, 'Llamada no encontrada');
  return { ok: true };
}

Object.assign(module.exports, { editarLead, fallosDeMarcacion, reportarLlamada, revisarFallo });

// Buscador: empresa, contacto, cargo, correo o teléfono, sin acentos ni mayúsculas. Un teléfono se
// busca por sus dígitos ("313 470" encuentra +573134705454, también en el segundo teléfono). Con varias
// palabras, todas tienen que aparecer (en cualquier campo). Trae el último toque para dar contexto.
// Es para cuando alguien escribe por WhatsApp o correo y hay que encontrar su ficha rápido.
const SIN_ACENTO = col => `translate(lower(${col}), 'áéíóúüñàèìòùâêîôû', 'aeiouunaeiouaeiou')`;
function limpiarBusqueda(q) {
  return String(q || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
async function buscarLeads(db, q, { limite = 20 } = {}) {
  const texto = limpiarBusqueda(q);
  if (texto.length < 2) return [];
  const digitos = texto.replace(/\D/g, '');
  const cond = [], params = [];
  if (digitos.length >= 5 && digitos.length >= texto.replace(/[\s+\-().]/g, '').length) {
    // Parece un teléfono: por dígitos, en el principal y el alterno.
    params.push(`%${digitos}%`);
    cond.push(`(regexp_replace(COALESCE(l.telefono, ''), '\\D', '', 'g') LIKE $1 OR regexp_replace(COALESCE(l.telefono_alt, ''), '\\D', '', 'g') LIKE $1)`);
  } else {
    for (const palabra of texto.split(/\s+/).filter(Boolean)) {
      params.push(`%${palabra}%`);
      const i = params.length;
      cond.push(`(${SIN_ACENTO('COALESCE(l.empresa, \'\')')} LIKE $${i} OR ${SIN_ACENTO('COALESCE(l.contacto, \'\')')} LIKE $${i}
                  OR ${SIN_ACENTO('COALESCE(l.cargo, \'\')')} LIKE $${i} OR lower(COALESCE(l.email, '')) LIKE $${i})`);
    }
  }
  params.push(`${texto}%`);
  const iPrefijo = params.length;
  params.push(Math.min(Number(limite) || 20, 100));
  const r = await db.query(
    `SELECT l.id, l.empresa, l.contacto, l.cargo, l.telefono, l.telefono_alt, l.email, l.ciudad, l.etapa, l.razon_descarte,
            CASE WHEN l.pausado_hasta > NOW() THEN ${ms('l.pausado_hasta')} END AS pausado_ms,
            u.canal AS ultimo_canal, u.resultado AS ultimo_resultado, u.created_ms AS ultimo_ms, u.usuario AS ultimo_usuario,
            (SELECT ${ms('MIN(t.due_at)')} FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente') AS proximo_ms
     FROM ${T.leads} l
     LEFT JOIN LATERAL (
       SELECT canal, resultado, usuario, ${ms('created_at')} AS created_ms FROM ${T.touches} WHERE lead_id = l.id ORDER BY created_at DESC LIMIT 1
     ) u ON TRUE
     WHERE ${cond.join(' AND ')}
     ORDER BY (${SIN_ACENTO('COALESCE(l.empresa, \'\')')} LIKE $${iPrefijo} OR ${SIN_ACENTO('COALESCE(l.contacto, \'\')')} LIKE $${iPrefijo}) DESC,
              u.created_ms DESC NULLS LAST, l.id DESC
     LIMIT $${params.length}`,
    params);
  return r.rows;
}
module.exports.buscarLeads = buscarLeads;
module.exports.limpiarBusqueda = limpiarBusqueda;

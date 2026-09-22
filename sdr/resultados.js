// Motor de resultados: un toque entra, el lead cambia de etapa y la secuencia se reacomoda.
//
// Toda la lógica de "qué pasa después" vive aquí y lee de config.js. Las rutas solo validan
// la entrada y llaman a registrarToque / registrarEjecutiva.
const { T } = require('./schema');
const D = require('./dominio');
const tiempo = require('./tiempo');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const orden = etapa => D.ETAPAS.indexOf(etapa);

// Corre `fn(cliente)` dentro de una transacción. Con un Pool de `pg` toma una conexión; con el
// cliente mínimo de pruebas (una sola conexión) usa el mismo objeto.
async function enTransaccion(db, fn) {
  const c = db.connect ? await db.connect() : db;
  try {
    await c.query('BEGIN');
    const r = await fn(c);
    await c.query('COMMIT');
    return r;
  } catch (e) {
    try { await c.query('ROLLBACK'); } catch (_) { /* nada */ }
    throw e;
  } finally {
    if (c.release) c.release();
  }
}

async function leerLead(c, id) {
  const r = await c.query(`SELECT * FROM ${T.leads} WHERE id = $1 FOR UPDATE`, [id]);
  if (!r.rows.length) throw error(404, 'Lead no encontrado');
  return r.rows[0];
}

async function tareasPendientes(c, leadId) {
  return (await c.query(
    `SELECT id, paso, canal, due_at FROM ${T.tasks} WHERE lead_id = $1 AND estado = 'pendiente' ORDER BY paso`, [leadId])).rows;
}

async function omitirPendientes(c, leadId) {
  await c.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = NOW() WHERE lead_id = $1 AND estado = 'pendiente'`, [leadId]);
}

// Nueva tarea al final de la secuencia del lead, `dias` días (hábiles según config) después de hoy.
async function programar(c, config, leadId, canal, dias, ahora, fechaFija) {
  const fecha = fechaFija || tiempo.avanzar(tiempo.fechaBogota(ahora), dias, !!config.SALTAR_FINES_DE_SEMANA);
  const due = tiempo.instante(fecha, config.HORA_INICIO_JORNADA);
  const r = await c.query(
    `INSERT INTO ${T.tasks} (lead_id, paso, canal, due_at)
     SELECT $1, COALESCE(MAX(paso), 0) + 1, $2, $3 FROM ${T.tasks} WHERE lead_id = $1
     RETURNING id, paso, canal, due_at`, [leadId, canal, due.toISOString()]);
  return r.rows[0];
}

async function cambiarEtapa(c, leadId, etapa, extra = {}) {
  const sets = ['etapa = $2', 'etapa_at = NOW()', 'updated_at = NOW()'];
  const params = [leadId, etapa];
  for (const [k, v] of Object.entries(extra)) { params.push(v); sets.push(`${k} = $${params.length}`); }
  await c.query(`UPDATE ${T.leads} SET ${sets.join(', ')} WHERE id = $1`, params);
}

// Etapa resultante según config, solo hacia adelante. Devuelve null si no cambia.
function siguienteEtapa(config, etapaActual, resultado) {
  const destino = config.ETAPA_POR_RESULTADO[resultado];
  if (!destino) return null;
  if (destino === 'descartado') return 'descartado';
  return orden(destino) > orden(etapaActual) ? destino : null;
}

// ---------------------------------------------------------------------------------------------

// Registra un toque de Angie. `canal` llamada exige un `resultado` de RESULTADOS_LLAMADA; los
// otros canales usan el nombre del canal como resultado.
function usuarioValido(config, u) {
  if (!u) return null;
  const x = (config.USUARIOS || []).find(x => x.nombre.toLowerCase() === String(u).toLowerCase());
  return x ? x.nombre : null;
}
const usuariosSdr = config => (config.USUARIOS || []).filter(u => u.rol === 'sdr').map(u => u.nombre);

async function registrarToque(db, config, {
  leadId, canal, resultado, razon, nota, detalle, taskId, callUuid, usuario, ahora = new Date(),
}) {
  usuario = usuarioValido(config, usuario);
  leadId = Number(leadId);
  if (!Number.isInteger(leadId)) throw error(400, 'lead_id inválido');
  if (!D.CANALES.includes(canal)) throw error(400, `canal inválido: ${canal}`);
  if (canal === 'llamada') {
    if (!D.RESULTADOS_LLAMADA.includes(resultado)) throw error(400, 'El resultado de la llamada es obligatorio');
  } else resultado = canal;
  if (resultado === 'descartado') {
    if (!D.RAZONES_DESCARTE.includes(razon)) throw error(400, 'Elige la razón del descarte');
  } else razon = null;
  detalle = detalle && typeof detalle === 'object' ? detalle : null;
  let reunionAt = null;
  if (resultado === 'reunion_agendada' && detalle && detalle.reunion_at) {
    reunionAt = new Date(detalle.reunion_at);
    if (isNaN(reunionAt)) throw error(400, 'La fecha de la reunión no es válida');
  }

  return enTransaccion(db, async c => {
    const lead = await leerLead(c, leadId);
    if (!D.ETAPAS_DE_ANGIE.includes(lead.etapa) && resultado !== 'descartado') {
      throw error(409, `El lead está en "${D.ETAPA_LABEL[lead.etapa]}"; desde ahí los toques los registra la ejecutiva.`);
    }

    // 1 · La tarea que este toque cumple: la indicada, o la primera pendiente del mismo canal.
    let pendientes = await tareasPendientes(c, leadId);
    let tarea = taskId ? pendientes.find(t => t.id === Number(taskId)) : pendientes.find(t => t.canal === canal);
    if (tarea) {
      await c.query(`UPDATE ${T.tasks} SET estado = 'hecha', done_at = $2 WHERE id = $1`, [tarea.id, ahora.toISOString()]);
      pendientes = pendientes.filter(t => t.id !== tarea.id);
    }

    // 2 · Llamada: fila en calls (la del navegador ya puede existir por el webhook).
    let callId = null;
    if (canal === 'llamada') {
      const r = await c.query(
        `INSERT INTO ${T.calls} (uuid, lead_id, origen, telefono, started_at, ended_at)
         VALUES ($1, $2, $3, $4, $5, $5)
         ON CONFLICT (uuid) DO UPDATE SET updated_at = NOW()
         RETURNING id`,
        [callUuid || null, leadId, callUuid ? 'voximplant' : 'manual', lead.telefono, ahora.toISOString()]);
      callId = r.rows[0].id;
    }

    // 3 · El toque.
    const toque = (await c.query(
      `INSERT INTO ${T.touches} (lead_id, task_id, canal, resultado, razon_descarte, nota, detalle, call_id, usuario, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [leadId, tarea ? tarea.id : null, canal, resultado, razon, nota || null, detalle ? JSON.stringify(detalle) : null, callId, usuario, ahora.toISOString()])).rows[0];
    if (callId) await c.query(`UPDATE ${T.calls} SET touch_id = $2 WHERE id = $1`, [callId, toque.id]);

    // 4 · Etapa y reprogramación.
    const nueva = siguienteEtapa(config, lead.etapa, resultado);
    let proxima = null, dealId = null, avisos = [];

    if (resultado === 'descartado') {
      await omitirPendientes(c, leadId);
      await cambiarEtapa(c, leadId, 'descartado', { razon_descarte: razon });
    } else if (resultado === 'conversacion') {
      await omitirPendientes(c, leadId);
      const tc = config.TRAS_CONVERSACION;
      proxima = await programar(c, config, leadId, tc.canal, tc.dias, ahora);
      if (nueva) await cambiarEtapa(c, leadId, nueva);
    } else if (resultado === 'reunion_agendada') {
      await omitirPendientes(c, leadId);
      const n = config.RECORDATORIO_REUNION_DIAS_ANTES;
      if (reunionAt && n != null) {
        const fecha = tiempo.sumarDias(tiempo.fechaBogota(reunionAt), -n);
        if (tiempo.instante(fecha, config.HORA_INICIO_JORNADA) > ahora) proxima = await programar(c, config, leadId, 'whatsapp', 0, ahora, fecha);
      }
      // Con savepoint: si public.deals falla, la reunión de Angie se guarda igual.
      await c.query('SAVEPOINT deal');
      try {
        dealId = await crearDeal(c, lead, detalle || {}, reunionAt);
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT deal');
        console.error('[sdr] no se pudo crear el deal en el Sandler:', e.message);
        avisos.push('La reunión quedó registrada, pero no se pudo crear el deal en el Sandler: ' + e.message);
      }
      await cambiarEtapa(c, leadId, 'reunion_agendada', { reunion_at: reunionAt ? reunionAt.toISOString() : null, ...(dealId ? { deal_id: dealId } : {}) });
    } else {
      // no contestó, buzón, gatekeeper y toques por otros canales: la secuencia sigue.
      if (nueva) await cambiarEtapa(c, leadId, nueva);
      proxima = pendientes[0] || null;
      if (!proxima && config.AL_AGOTAR_SECUENCIA === 'descartar') {
        await cambiarEtapa(c, leadId, 'descartado', { razon_descarte: 'sin_respuesta' });
        avisos.push('Se agotó la secuencia sin conversación: el lead pasó a descartado (sin respuesta).');
      } else if (!proxima) {
        avisos.push('Se agotó la secuencia. El lead queda sin próximo toque hasta que decidas qué hacer con él.');
      }
    }

    const final = (await c.query(`SELECT etapa, deal_id, reunion_at FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0];
    return { toque_id: toque.id, call_id: callId, etapa: final.etapa, etapa_anterior: lead.etapa, deal_id: final.deal_id, proxima, avisos };
  });
}

// Acciones de la ejecutiva comercial sobre un lead con reunión: realizada, no-show, calificado.
// 'descartado' también entra por aquí: es una decisión sobre el lead, no un toque, y sirve
// tanto para Angie (descartar sin llamar) como para la ejecutiva.
async function registrarEjecutiva(db, config, { leadId, accion, razon, nota, usuario, ahora = new Date() }) {
  leadId = Number(leadId);
  usuario = usuarioValido(config, usuario);
  if (!['reunion_realizada', 'no_show', 'calificado', 'descartado'].includes(accion)) throw error(400, 'Acción desconocida');
  if (accion === 'descartado' && !D.RAZONES_DESCARTE.includes(razon)) throw error(400, 'Elige la razón del descarte');
  return enTransaccion(db, async c => {
    const lead = await leerLead(c, leadId);
    let proxima = null;
    if (accion === 'descartado') {
      if (lead.etapa === 'descartado') throw error(409, 'El lead ya está descartado');
      await omitirPendientes(c, leadId);
      await cambiarEtapa(c, leadId, 'descartado', { razon_descarte: razon });
    } else if (accion === 'reunion_realizada') {
      if (lead.etapa !== 'reunion_agendada') throw error(409, 'Solo aplica a un lead con reunión agendada');
      await omitirPendientes(c, leadId);
      await cambiarEtapa(c, leadId, 'reunion_realizada');
    } else if (accion === 'no_show') {
      if (lead.etapa !== 'reunion_agendada') throw error(409, 'Solo aplica a un lead con reunión agendada');
      await omitirPendientes(c, leadId);
      const t = config.TRAS_NO_SHOW;
      proxima = await programar(c, config, leadId, t.canal, t.dias, ahora);
      await cambiarEtapa(c, leadId, 'conversacion', { reunion_at: null });
    } else if (accion === 'calificado') {
      if (!['reunion_agendada', 'reunion_realizada'].includes(lead.etapa)) throw error(409, 'Solo aplica después de una reunión');
      await omitirPendientes(c, leadId);
      await cambiarEtapa(c, leadId, 'calificado');
    }
    await c.query(
      `INSERT INTO ${T.touches} (lead_id, canal, resultado, razon_descarte, nota, usuario, created_at) VALUES ($1, 'ejecutiva', $2, $3, $4, $5, $6)`,
      [leadId, accion, accion === 'descartado' ? razon : null, nota || null, usuario, ahora.toISOString()]);
    return { etapa: (await c.query(`SELECT etapa FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0].etapa, proxima };
  });
}

// Deal en public.deals con la ficha de Angie prellenada, para que la ejecutiva abra el demo en el
// Sandler con contexto. `data` sigue la forma del borrador del Sandler (public/app.js · newDraft).
async function crearDeal(c, lead, detalle, reunionAt) {
  const contacto = [lead.contacto, lead.cargo].filter(Boolean).join(' · ');
  const notas = [
    contacto && `Contacto: ${contacto}`,
    lead.telefono && `Teléfono: ${lead.telefono}`,
    lead.email && `Correo: ${lead.email}`,
    lead.ciudad && `Ciudad: ${lead.ciudad}`,
    reunionAt && `Reunión: ${reunionAt.toLocaleString('es-CO', { timeZone: 'America/Bogota', dateStyle: 'full', timeStyle: 'short' })}`,
    detalle.ficha_adicional,
    `Lead SDR #${lead.id}`,
  ].filter(Boolean).join('\n');
  const data = {
    company: lead.empresa,
    executive: detalle.ejecutiva || '',
    lineaNegocio: detalle.linea_negocio || '',
    canalAdquisicion: 'sdr_interno',
    freelancerNombre: 'Angie (SDR)',
    prospActitud: detalle.actitud || '',
    prospUrgencia: detalle.urgencia || '',
    fichaCargos: detalle.ficha_cargos || '',
    fichaCosto: detalle.ficha_costo || '',
    fichaHerramientas: detalle.ficha_herramientas || '',
    fichaAdicional: notas,
    idealRequests: [],
    qualif: {},
  };
  const r = await c.query(
    `INSERT INTO public.deals (executive, company, data, linea_negocio, canal_adquisicion, freelancer_nombre, outcome)
     VALUES ($1, $2, $3::jsonb, $4, 'sdr_interno', 'Angie (SDR)', 'open') RETURNING id`,
    [data.executive || null, lead.empresa, JSON.stringify(data), data.lineaNegocio || null]);
  return r.rows[0].id;
}

// Marcaciones y conversaciones de un día (Bogotá).
// Solo cuenta a los usuarios con rol sdr (y toques sin usuario, de antes de la etiqueta).
async function actividadDelDia(db, fecha, config = {}) {
  const desde = tiempo.instante(fecha, 0).toISOString();
  const hasta = tiempo.instante(tiempo.sumarDias(fecha, 1), 0).toISOString();
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE canal = 'llamada')::int AS marcaciones,
            COUNT(*) FILTER (WHERE resultado IN (SELECT jsonb_array_elements_text($3::jsonb)))::int AS conversaciones,
            COUNT(*)::int AS toques
     FROM ${T.touches} WHERE created_at >= $1 AND created_at < $2 ${filtroSdr(config, 4)}`,
    [desde, hasta, JSON.stringify(D.RESULTADOS_CON_CONVERSACION), JSON.stringify(usuariosSdr(config))]);
  return r.rows[0];
}

// Fragmento SQL: toques de usuarios sdr o sin usuario. `n` es la posición del parámetro con la lista.
function filtroSdr(config, n) {
  return (config.USUARIOS || []).length ? `AND (usuario IS NULL OR usuario IN (SELECT jsonb_array_elements_text($${n}::jsonb)))` : '';
}

module.exports = { registrarToque, registrarEjecutiva, actividadDelDia, siguienteEtapa, enTransaccion, usuarioValido, usuariosSdr, filtroSdr };

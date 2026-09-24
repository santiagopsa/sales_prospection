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

// Solo los toques de la secuencia: los compromisos (con hora pactada) los maneja compromisos.js.
async function tareasPendientes(c, leadId) {
  return (await c.query(
    `SELECT id, paso, canal, due_at FROM ${T.tasks} WHERE lead_id = $1 AND estado = 'pendiente' AND tipo = 'secuencia' ORDER BY paso`, [leadId])).rows;
}

// Omite la secuencia pendiente. Con `todo` también los compromisos (descartar / pausar) y
// devuelve sus ids para borrar los eventos del calendario después de la transacción.
async function omitirPendientes(c, leadId, todo = false) {
  const r = await c.query(
    `UPDATE ${T.tasks} SET estado = 'omitida', done_at = NOW() WHERE lead_id = $1 AND estado = 'pendiente' ${todo ? '' : "AND tipo = 'secuencia'"} RETURNING id, tipo`,
    [leadId]);
  return r.rows.filter(t => t.tipo !== 'secuencia').map(t => t.id);
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

// Cierra el compromiso "reunión" del lead (realizada → hecha, no-show → omitida) y devuelve los ids.
async function cerrarReunion(c, leadId, estado) {
  const r = await c.query(`UPDATE ${T.tasks} SET estado = $2, done_at = NOW() WHERE lead_id = $1 AND tipo = 'reunion' AND estado = 'pendiente' RETURNING id`, [leadId, estado]);
  return r.rows.map(x => x.id);
}

// Etapa resultante según config, solo hacia adelante. Devuelve null si no cambia.
function siguienteEtapa(config, etapaActual, resultado) {
  const destino = config.ETAPA_POR_RESULTADO[resultado];
  if (!destino) return null;
  if (destino === 'descartado') return 'descartado';
  return orden(destino) > orden(etapaActual) ? destino : null;
}

// Meses de reintento válidos para una razón: null (descartar) o uno de OPCIONES_REINTENTO_MESES.
// Las razones definitivas nunca reintentan. `undefined` = usar el valor por defecto de la razón.
function mesesReintento(config, razon, meses) {
  if (D.RAZONES_DEFINITIVAS.includes(razon)) return null;
  if (meses === undefined) return (config.REINTENTO_POR_RAZON || {})[razon] || null;
  if (meses === null || meses === '' || Number(meses) === 0) return null;
  const n = Number(meses);
  const opciones = config.OPCIONES_REINTENTO_MESES || [1, 3, 6];
  if (!opciones.includes(n)) throw error(400, `Los meses de reintento deben ser uno de: ${opciones.join(', ')}`);
  return n;
}

// Tareas de SECUENCIA_REINTENTO a partir de una fecha, numeradas después de las que ya tiene el lead.
async function programarReintento(c, config, leadId, fecha) {
  const { planificar } = require('./secuencia');
  const plan = planificar({ ...config, SECUENCIA_POR_DEFECTO: config.SECUENCIA_REINTENTO || [{ canal: 'llamada', dias: 0 }] }, fecha);
  const base = (await c.query(`SELECT COALESCE(MAX(paso), 0)::int AS n FROM ${T.tasks} WHERE lead_id = $1`, [leadId])).rows[0].n;
  let primera = null;
  for (const p of plan) {
    const r = await c.query(`INSERT INTO ${T.tasks} (lead_id, paso, canal, due_at) VALUES ($1,$2,$3,$4) RETURNING id, paso, canal, due_at`,
      [leadId, base + p.paso, p.canal, p.due_at.toISOString()]);
    primera = primera || r.rows[0];
  }
  return primera;
}

// Sacar un lead de la cola. Con `meses` = null se descarta (definitivo); con meses se PAUSA: se
// omite lo pendiente, queda pausado_hasta y la secuencia de reintento programada desde esa fecha,
// así el lead vuelve solo a la cola ese día. Si venía de después de una reunión, vuelve a
// "conversación" (ya hablaron) para que Angie pueda registrarle toques.
// "Pidió que no lo contacten" además mete el teléfono y el correo a la lista negra.
async function sacarDeCola(c, config, lead, { razon, meses, nota, usuario, ahora }) {
  const compromisosOmitidos = await omitirPendientes(c, lead.id, true);
  if (!meses) {
    await cambiarEtapa(c, lead.id, 'descartado', { razon_descarte: razon, pausado_hasta: null });
    if (razon === 'no_contactar' && (lead.telefono || lead.email)) {
      await require('./listanegra').agregar(c, config, { telefono: lead.telefono, email: lead.email, empresa: lead.empresa, razon, nota, leadId: lead.id, usuario });
    }
    return { resultado: 'descartado', proxima: null, pausado_hasta: null, compromisosOmitidos, avisos: razon === 'no_contactar' ? ['Teléfono y correo quedaron en la lista negra.'] : [] };
  }
  const fecha = tiempo.sumarMeses(tiempo.fechaBogota(ahora), meses);
  const proxima = await programarReintento(c, config, lead.id, fecha);
  const hasta = new Date(proxima.due_at);
  const extra = { razon_descarte: razon, pausado_hasta: hasta.toISOString(), reunion_at: null };
  await cambiarEtapa(c, lead.id, D.ETAPAS_DE_ANGIE.includes(lead.etapa) ? lead.etapa : 'conversacion', extra);
  return { resultado: 'pausado', proxima, pausado_hasta: hasta.toISOString(), compromisosOmitidos, avisos: [`En pausa hasta el ${fecha}: ese día vuelve a la cola con ${proxima.canal}.`] };
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
  leadId, canal, resultado, razon, nota, detalle, taskId, compromisoId, callUuid, usuario, reintentoMeses, ahora = new Date(), env = process.env,
}) {
  usuario = usuarioValido(config, usuario);
  leadId = Number(leadId);
  if (!Number.isInteger(leadId)) throw error(400, 'lead_id inválido');
  if (!D.CANALES.includes(canal)) throw error(400, `canal inválido: ${canal}`);
  if (canal === 'llamada') {
    if (!D.RESULTADOS_LLAMADA.includes(resultado)) throw error(400, 'El resultado de la llamada es obligatorio');
  } else if (!D.RESPUESTAS_OTRO_CANAL.includes(resultado)) resultado = canal; // envío normal; solo una respuesta lleva resultado
  let meses = null;
  if (resultado === 'descartado') {
    if (!D.RAZONES_DESCARTE.includes(razon)) throw error(400, 'Elige la razón del descarte');
    meses = mesesReintento(config, razon, reintentoMeses);
  } else razon = null;
  detalle = detalle && typeof detalle === 'object' ? detalle : null;
  let reunionAt = null;
  if (resultado === 'reunion_agendada' && detalle && detalle.reunion_at) {
    reunionAt = new Date(detalle.reunion_at);
    if (isNaN(reunionAt)) throw error(400, 'La fecha de la reunión no es válida');
  }

  const r = await enTransaccion(db, async c => {
    const lead = await leerLead(c, leadId);
    if (!D.ETAPAS_DE_ANGIE.includes(lead.etapa) && resultado !== 'descartado') {
      throw error(409, `El lead está en "${D.ETAPA_LABEL[lead.etapa]}"; desde ahí los toques los registra la ejecutiva.`);
    }

    // 1 · La tarea que este toque cumple: la indicada, o la primera pendiente del mismo canal.
    //     Con `compromisoId` el toque cumple un compromiso (seguimiento, enviar algo…) y no
    //     consume la secuencia: el compromiso es un extra que Angie pactó, la secuencia sigue igual.
    let pendientes = await tareasPendientes(c, leadId);
    let tarea = null, compromisoHecho = null;
    if (compromisoId) {
      compromisoHecho = (await c.query(
        `SELECT id, canal FROM ${T.tasks} WHERE id = $1 AND lead_id = $2 AND tipo <> 'secuencia' AND estado = 'pendiente'`, [Number(compromisoId), leadId])).rows[0];
      if (!compromisoHecho) throw error(404, 'Ese compromiso ya no está pendiente');
      await c.query(`UPDATE ${T.tasks} SET estado = 'hecha', done_at = $2 WHERE id = $1`, [compromisoHecho.id, ahora.toISOString()]);
      tarea = compromisoHecho;
    } else {
      tarea = taskId ? pendientes.find(t => t.id === Number(taskId)) : pendientes.find(t => t.canal === canal);
      if (tarea) {
        await c.query(`UPDATE ${T.tasks} SET estado = 'hecha', done_at = $2 WHERE id = $1`, [tarea.id, ahora.toISOString()]);
        pendientes = pendientes.filter(t => t.id !== tarea.id);
      }
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

    // 3 · El toque. Un "descartado" con reintento queda como "pausado" en el historial.
    const toque = (await c.query(
      `INSERT INTO ${T.touches} (lead_id, task_id, canal, resultado, razon_descarte, nota, detalle, call_id, usuario, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [leadId, tarea ? tarea.id : null, canal, resultado === 'descartado' && meses ? 'pausado' : resultado, razon, nota || null, detalle ? JSON.stringify(detalle) : null, callId, usuario, ahora.toISOString()])).rows[0];
    if (callId) {
      await c.query(`UPDATE ${T.calls} SET touch_id = $2 WHERE id = $1`, [callId, toque.id]);
      // Con el resultado ya se sabe si la llamada va al pipeline de audio (si la grabación ya llegó).
      await require('./pipeline').revisarLlamada(c, config, callId);
    }

    // 4 · Etapa y reprogramación.
    const nueva = siguienteEtapa(config, lead.etapa, resultado);
    let proxima = null, dealId = null, avisos = [], pausadoHasta = null, compromisoCreado = null, compromisosOmitidos = [];
    // Cualquier toque real le quita la pausa (llegó la fecha, o Angie lo retomó antes).
    if (resultado !== 'descartado' && lead.pausado_hasta) await c.query(`UPDATE ${T.leads} SET pausado_hasta = NULL, razon_descarte = NULL WHERE id = $1`, [leadId]);

    if (resultado === 'descartado') {
      const s = await sacarDeCola(c, config, lead, { razon, meses, nota, usuario, ahora });
      proxima = s.proxima; pausadoHasta = s.pausado_hasta; avisos.push(...s.avisos); compromisosOmitidos = s.compromisosOmitidos || [];
      if (s.resultado === 'pausado') await c.query(`UPDATE ${T.touches} SET detalle = COALESCE(detalle, '{}'::jsonb) || $2::jsonb WHERE id = $1`, [toque.id, JSON.stringify({ pausado_hasta: pausadoHasta, meses })]);
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
      // La reunión, como compromiso de la ejecutiva (con Angie invitada), para que caiga en su calendario.
      if (reunionAt && config.REUNION_CREA_COMPROMISO) {
        const C = require('./compromisos');
        const eje = C.ejecutivaPara(config, detalle && detalle.ejecutiva);
        if (eje) {
          const emailAngie = require('./calendario').emailDe(config, usuario);
          const t = await C.insertar(c, config, {
            leadId, tipo: 'reunion', titulo: `Reunión con ${lead.empresa}`, canal: 'llamada',
            fecha: tiempo.fechaBogota(reunionAt), hora: tiempo.horaBogota(reunionAt),
            nota: [detalle && detalle.ficha_cargos && `Cargos: ${detalle.ficha_cargos}`, detalle && detalle.actitud && `Actitud: ${detalle.actitud}`, detalle && detalle.urgencia && `Urgencia: ${detalle.urgencia}`, nota].filter(Boolean).join('\n'),
            usuario: eje.nombre, creadoPor: usuario, invitados: emailAngie ? [emailAngie] : [],
          });
          compromisoCreado = t.id; proxima = proxima || null;
          // Si vino de Calendly, el evento ya está en el calendario de la ejecutiva (con el invitado).
          if (detalle && detalle.calendly && !(config.CALENDLY || {}).duplicar_en_google) {
            await c.query(`UPDATE ${T.tasks} SET gcal_event_id = $2 WHERE id = $1`, [t.id, C.EN_CALENDLY]);
          }
          avisos.push(detalle && detalle.calendly && !(config.CALENDLY || {}).duplicar_en_google
            ? `Reunión anotada como compromiso de ${eje.nombre}; el evento y la invitación los manda Calendly.`
            : `Reunión anotada como compromiso de ${eje.nombre}${emailAngie ? ' (te llega la invitación al calendario)' : ''}.`);
        }
      }
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
    return { toque_id: toque.id, call_id: callId, etapa: final.etapa, etapa_anterior: lead.etapa, deal_id: final.deal_id, proxima, pausado_hasta: pausadoHasta, avisos, compromiso_id: compromisoCreado, compromisosOmitidos, compromiso_hecho: compromisoHecho ? compromisoHecho.id : null };
  });
  // Calendario fuera de la transacción (red): mejor esfuerzo.
  await sincronizarCompromisos(db, config, env, r, usuario);
  return r;
}

async function sincronizarCompromisos(db, config, env, r, usuario) {
  const C = require('./compromisos');
  if (r.compromiso_id) {
    const emailAngie = require('./calendario').emailDe(config, usuario);
    r.calendario = await C.sincronizar(db, config, env, r.compromiso_id, 'crear', { invitados: emailAngie ? [emailAngie] : [] });
  }
  for (const id of r.compromisosOmitidos || []) await C.sincronizar(db, config, env, id, 'borrar');
  if (r.compromiso_hecho) await C.sincronizar(db, config, env, r.compromiso_hecho, 'borrar');
  delete r.compromisosOmitidos;
}

// Acciones de la ejecutiva comercial sobre un lead con reunión: realizada, no-show, calificado.
// 'descartado' también entra por aquí: es una decisión sobre el lead, no un toque, y sirve
// tanto para Angie (descartar sin llamar) como para la ejecutiva.
// 'reactivar' devuelve a la cola un lead descartado o en pausa, con la secuencia de reintento desde hoy.
async function registrarEjecutiva(db, config, { leadId, accion, razon, nota, usuario, reintentoMeses, ahora = new Date(), env = process.env }) {
  leadId = Number(leadId);
  usuario = usuarioValido(config, usuario);
  if (!['reunion_realizada', 'no_show', 'reunion_cancelada', 'calificado', 'descartado', 'reactivar'].includes(accion)) throw error(400, 'Acción desconocida');
  if (accion === 'descartado' && !D.RAZONES_DESCARTE.includes(razon)) throw error(400, 'Elige la razón del descarte');
  const meses = accion === 'descartado' ? mesesReintento(config, razon, reintentoMeses) : null;
  const r = await enTransaccion(db, async c => {
    const lead = await leerLead(c, leadId);
    let proxima = null, resultado = accion, detalle = null, avisos = [], pausadoHasta = null, compromisosOmitidos = [];
    if (accion === 'descartado') {
      if (lead.etapa === 'descartado') throw error(409, 'El lead ya está descartado');
      const s = await sacarDeCola(c, config, lead, { razon, meses, nota, usuario, ahora });
      proxima = s.proxima; resultado = s.resultado; pausadoHasta = s.pausado_hasta; avisos = s.avisos; compromisosOmitidos = s.compromisosOmitidos || [];
      if (resultado === 'pausado') detalle = { pausado_hasta: pausadoHasta, meses };
    } else if (accion === 'reactivar') {
      if (lead.etapa !== 'descartado' && !lead.pausado_hasta) throw error(409, 'El lead no está descartado ni en pausa');
      const LN = require('./listanegra');
      const ln = await LN.enLista(c, [lead.telefono], [lead.email], [lead.empresa], []);
      if (LN.motivoDe(ln, lead)) throw error(409, `Está en la lista negra (${LN.motivoDe(ln, lead)}). Quítalo de ahí primero si de verdad hay que volver a llamarlo.`);
      await omitirPendientes(c, leadId);
      proxima = await programarReintento(c, config, leadId, tiempo.fechaBogota(ahora));
      // Vuelve a la etapa que tenía antes de descartarlo si es de Angie; si no se sabe, "contactado".
      const previa = lead.etapa === 'descartado' ? 'contactado' : lead.etapa;
      await cambiarEtapa(c, leadId, D.ETAPAS_DE_ANGIE.includes(previa) ? previa : 'conversacion', { razon_descarte: null, pausado_hasta: null });
      resultado = 'reactivado';
      razon = null;
    } else if (accion === 'reunion_realizada') {
      if (lead.etapa !== 'reunion_agendada') throw error(409, 'Solo aplica a un lead con reunión agendada');
      await omitirPendientes(c, leadId);
      compromisosOmitidos = await cerrarReunion(c, leadId, 'hecha');
      await cambiarEtapa(c, leadId, 'reunion_realizada');
    } else if (accion === 'no_show') {
      if (lead.etapa !== 'reunion_agendada') throw error(409, 'Solo aplica a un lead con reunión agendada');
      await omitirPendientes(c, leadId);
      compromisosOmitidos = await cerrarReunion(c, leadId, 'omitida');
      const t = config.TRAS_NO_SHOW;
      proxima = await programar(c, config, leadId, t.canal, t.dias, ahora);
      await cambiarEtapa(c, leadId, 'conversacion', { reunion_at: null });
    } else if (accion === 'reunion_cancelada') {
      // El prospecto canceló (Calendly lo avisa): vuelve a la SDR para recuperarla.
      if (lead.etapa !== 'reunion_agendada') throw error(409, 'Solo aplica a un lead con reunión agendada');
      await omitirPendientes(c, leadId);
      compromisosOmitidos = await cerrarReunion(c, leadId, 'omitida');
      const t = (config.CALENDLY || {}).tras_cancelacion;
      if (t) proxima = await programar(c, config, leadId, t.canal, t.dias, ahora);
      await cambiarEtapa(c, leadId, 'conversacion', { reunion_at: null });
      if (!t) avisos.push('Sin próximo toque programado (CALENDLY.tras_cancelacion es null).');
    } else if (accion === 'calificado') {
      if (!['reunion_agendada', 'reunion_realizada'].includes(lead.etapa)) throw error(409, 'Solo aplica después de una reunión');
      await omitirPendientes(c, leadId);
      await cambiarEtapa(c, leadId, 'calificado');
    }
    await c.query(
      `INSERT INTO ${T.touches} (lead_id, canal, resultado, razon_descarte, nota, detalle, usuario, created_at) VALUES ($1, 'ejecutiva', $2, $3, $4, $5, $6, $7)`,
      [leadId, resultado, accion === 'descartado' ? razon : null, nota || null, detalle ? JSON.stringify(detalle) : null, usuario, ahora.toISOString()]);
    return { etapa: (await c.query(`SELECT etapa FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0].etapa, proxima, pausado_hasta: pausadoHasta, avisos, compromisosOmitidos };
  });
  await sincronizarCompromisos(db, config, env, r, usuario);
  return r;
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
  const empresa = (!lead.empresa || lead.empresa === 'Sin empresa') && lead.contacto ? lead.contacto : lead.empresa;
  const data = {
    company: empresa,
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
    [data.executive || null, empresa, JSON.stringify(data), data.lineaNegocio || null]);
  return r.rows[0].id;
}

// Marcaciones y conversaciones de un día (Bogotá).
// Actividad del día de UN usuario (el elegido en la barra). Cada quien ve su propio histórico.
// Sin usuario: cuenta a los de rol sdr (y toques sin etiqueta, de antes).
async function actividadDelDia(db, fecha, config = {}, usuario = null) {
  const desde = tiempo.instante(fecha, 0).toISOString();
  const hasta = tiempo.instante(tiempo.sumarDias(fecha, 1), 0).toISOString();
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE canal = 'llamada')::int AS marcaciones,
            COUNT(*) FILTER (WHERE resultado IN (SELECT jsonb_array_elements_text($3::jsonb)))::int AS conversaciones,
            COUNT(*) FILTER (WHERE resultado = 'reunion_agendada')::int AS reuniones,
            COUNT(*)::int AS toques
     FROM ${T.touches} WHERE created_at >= $1 AND created_at < $2 ${filtroUsuario(config, 4, usuario)}`,
    [desde, hasta, JSON.stringify(D.RESULTADOS_CON_CONVERSACION), paramUsuario(config, usuario)]);
  return r.rows[0];
}

// Fragmento SQL para filtrar toques por quién los hizo. `n` es la posición del parámetro que
// devuelve paramUsuario(). Con usuario: solo los suyos. Sin usuario: los de rol sdr o sin etiqueta.
function filtroUsuario(config, n, usuario) {
  if (usuario) return `AND usuario = $${n}`;
  return (config.USUARIOS || []).length ? `AND (usuario IS NULL OR usuario IN (SELECT jsonb_array_elements_text($${n}::jsonb)))` : `AND $${n}::text IS NOT NULL`;
}
function paramUsuario(config, usuario) {
  return usuario ? usuarioValido(config, usuario) || usuario : JSON.stringify(usuariosSdr(config));
}

// Entrada a mano en la lista negra: guarda la entrada y descarta los leads que coincidan.
async function agregarAListaNegra(db, config, { telefono, email, empresa, dominio, todaEmpresa, nota, usuario, ahora = new Date() }) {
  usuario = usuarioValido(config, usuario);
  const LN = require('./listanegra');
  // Una persona que pidió no contacto es "no_contactar"; una empresa o dominio vetados, "lista_negra".
  const razon = todaEmpresa || (!telefono && !email) ? 'lista_negra' : 'no_contactar';
  return enTransaccion(db, async c => {
    const entrada = await LN.agregar(c, config, { telefono, email, empresa, dominio, todaEmpresa, razon, nota, usuario });
    const leads = await LN.leadsQueCoinciden(c, entrada);
    let descartados = 0;
    for (const l of leads) {
      if (l.etapa === 'descartado') continue;
      const lead = await leerLead(c, l.id);
      await omitirPendientes(c, l.id);
      await cambiarEtapa(c, l.id, 'descartado', { razon_descarte: razon, pausado_hasta: null });
      await c.query(
        `INSERT INTO ${T.touches} (lead_id, canal, resultado, razon_descarte, nota, usuario, created_at) VALUES ($1, 'ejecutiva', 'descartado', $5, $2, $3, $4)`,
        [lead.id, nota || 'Metido a la lista negra', usuario, ahora.toISOString(), razon]);
      descartados++;
    }
    if (!entrada.existente && leads.length && !entrada.lead_id) await c.query(`UPDATE ${T.lista_negra} SET lead_id = $2 WHERE id = $1`, [entrada.id, leads[0].id]);
    return { ...entrada, leads_descartados: descartados };
  });
}

module.exports = { registrarToque, registrarEjecutiva, agregarAListaNegra, sacarDeCola, mesesReintento, actividadDelDia, siguienteEtapa, enTransaccion, usuarioValido, usuariosSdr, filtroUsuario, paramUsuario };

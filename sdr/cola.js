// La cola del día: qué toca hacer ahora y en qué orden.
//
// Por cada lead se muestra solo su SIGUIENTE tarea pendiente. Si Angie va atrasada, un lead
// no ocupa tres renglones con los toques acumulados: primero se hace el que sigue, y la
// secuencia se reacomoda al registrar el resultado (fase 2).
const { T } = require('./schema');
const { ETAPAS_DE_ANGIE } = require('./dominio');
const tiempo = require('./tiempo');
const { actividadDelDia } = require('./resultados');
const ritmo = require('./ritmo');

function prioridad(tarea, config, ahora) {
  const P = config.PRIORIDAD;
  const diasVencida = Math.max(0, tiempo.diasEntre(new Date(tarea.due_ms), ahora));
  const desglose = {
    etapa: P.porEtapa[tarea.etapa] || 0,
    canal: P.porCanal[tarea.canal] || 0,
    atraso: Math.min(diasVencida, P.topeDiasVencido) * P.porDiaVencido,
  };
  return { puntaje: desglose.etapa + desglose.canal + desglose.atraso, desglose, diasVencida };
}

const etapasDeAngie = JSON.stringify(ETAPAS_DE_ANGIE);

async function consultarCola(db, config, { ahora = new Date(), usuario = null } = {}) {
  const hoy = tiempo.fechaBogota(ahora);
  const inicioHoy = tiempo.instante(hoy, 0);
  const finHoy = tiempo.instante(tiempo.sumarDias(hoy, 1), 0);

  const r = await db.query(
    `SELECT * FROM (
       SELECT DISTINCT ON (t.lead_id)
              t.id, t.lead_id, t.paso, t.canal,
              (EXTRACT(EPOCH FROM t.due_at) * 1000)::float8 AS due_ms,
              l.empresa, l.contacto, l.cargo, l.telefono, l.email, l.ciudad, l.etapa,
              (SELECT COUNT(*) FROM ${T.tasks} x WHERE x.lead_id = t.lead_id AND x.tipo = 'secuencia')::int AS pasos_total,
              u.canal AS ultimo_canal, u.resultado AS ultimo_resultado, u.nota AS ultimo_nota, u.usuario AS ultimo_usuario,
              (EXTRACT(EPOCH FROM u.created_at) * 1000)::float8 AS ultimo_ms
       FROM ${T.tasks} t JOIN ${T.leads} l ON l.id = t.lead_id
       LEFT JOIN LATERAL (SELECT x.canal, x.resultado, x.nota, x.usuario, x.created_at FROM ${T.touches} x
                          WHERE x.lead_id = t.lead_id AND x.canal <> 'ejecutiva' ORDER BY x.created_at DESC, x.id DESC LIMIT 1) u ON true
       WHERE t.estado = 'pendiente' AND t.tipo = 'secuencia'
         AND l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb))
       ORDER BY t.lead_id, t.paso
     ) s
     WHERE s.due_ms < $2`,
    [etapasDeAngie, finHoy.getTime()],
  );

  // Un lead ya tocado hoy (llamó y no contestó, mandó el WhatsApp…) no compite con los que faltan
  // por contactar: va en su propia sección, con el siguiente paso claro.
  const tareas = r.rows.map(t => {
    const p = prioridad(t, config, ahora);
    return { ...t, ...p, vencida: t.due_ms < inicioHoy.getTime(), tocado_hoy: t.ultimo_ms != null && t.ultimo_ms >= inicioHoy.getTime() };
  }).sort((a, b) => (a.tocado_hoy - b.tocado_hoy) || b.puntaje - a.puntaje || a.due_ms - b.due_ms || a.lead_id - b.lead_id);

  const huerfanos = (await db.query(
    `SELECT COUNT(*)::int AS n FROM ${T.leads} l
     WHERE l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb))
       AND NOT EXISTS (SELECT 1 FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente')`,
    [etapasDeAngie],
  )).rows[0].n;

  const act = await actividadDelDia(db, hoy, config, usuario);
  const [bloque, racha, compromisos] = await Promise.all([ritmo.bloqueActual(db, config, ahora, usuario), ritmo.racha(db, config, ahora, usuario), require('./compromisos').listar(db, config, { usuario, ahora })]);
  return {
    fecha: hoy,
    tareas,
    compromisos,
    usuario: usuario || null,
    bloque,
    racha,
    indicadores: {
      vencidas: tareas.filter(t => t.vencida).length,
      porContactar: tareas.filter(t => !t.tocado_hoy).length,
      tocadosHoy: tareas.filter(t => t.tocado_hoy).length,
      compromisosHoy: compromisos.hoy.length,
      compromisosVencidos: compromisos.hoy.filter(t => t.vencido).length,
      deHoy: tareas.filter(t => !t.vencida).length,
      huerfanos,
      marcaciones: act.marcaciones,
      conversaciones: act.conversaciones,
      reuniones: act.reuniones,
      toques: act.toques,
      metaMarcaciones: config.META_MARCACIONES_DIA,
      metaConversaciones: config.META_CONVERSACIONES_DIA,
      metaReuniones: config.META_REUNIONES_DIA,
    },
  };
}

// Posponer una tarea pendiente: la mueve `dias` días (hábiles según config) desde hoy, a la hora
// de inicio de jornada. No toca el resto de la secuencia.
async function posponerTarea(db, config, { taskId, dias, ahora = new Date() }) {
  taskId = Number(taskId); dias = Number(dias);
  if (!Number.isInteger(taskId)) throw Object.assign(new Error('tarea inválida'), { status: 400 });
  if (!Number.isInteger(dias) || dias < 1 || dias > 60) throw Object.assign(new Error('Los días deben estar entre 1 y 60'), { status: 400 });
  const fecha = tiempo.avanzar(tiempo.fechaBogota(ahora), dias, !!config.SALTAR_FINES_DE_SEMANA);
  const due = tiempo.instante(fecha, config.HORA_INICIO_JORNADA);
  const r = await db.query(
    `UPDATE ${T.tasks} SET due_at = $2 WHERE id = $1 AND estado = 'pendiente' AND tipo = 'secuencia' RETURNING id, lead_id, canal, due_at`,
    [taskId, due.toISOString()]);
  if (!r.rows.length) throw Object.assign(new Error('La tarea no existe o ya no está pendiente'), { status: 404 });
  return { ...r.rows[0], fecha };
}

module.exports = { consultarCola, prioridad, posponerTarea };

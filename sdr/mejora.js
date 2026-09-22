// Mejora semanal (fase 5): de las evaluaciones de la semana salen los hábitos (lo que falla en
// varias llamadas, no en una), UN foco para las próximas FOCO_SEMANAS semanas que Angie confirma
// desde la app, el mejor momento de la semana, y el seguimiento del foco anterior.
//
// Regla de oro (del alcance): una llamada mala no es un hábito. Un criterio solo se señala como
// hábito si falla en HABITO_MIN_LLAMADAS o más llamadas y en HABITO_MIN_TASA de las que aplicaba.
const { T } = require('./schema');
const tiempo = require('./tiempo');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;

function semanaDe(fecha) { return require('./ritmo').semanaDe(fecha); }

// Evaluaciones (última por llamada, rúbrica activa) de las llamadas de un usuario en [desde, hasta].
async function evaluacionesEntre(db, config, { desde, hasta, usuario }) {
  const v = config.RUBRICA_ACTIVA;
  const r = await db.query(
    `SELECT DISTINCT ON (e.call_id) e.call_id, e.resultado, e.rubrica_version, k.lead_id, l.empresa, l.contacto, x.resultado AS resultado_llamada, x.usuario,
            ${ms('COALESCE(k.started_at, k.created_at)')} AS started_ms, tr.metricas
     FROM ${T.evaluations} e
     JOIN ${T.calls} k ON k.id = e.call_id
     JOIN ${T.leads} l ON l.id = k.lead_id
     LEFT JOIN ${T.touches} x ON x.id = k.touch_id
     LEFT JOIN ${T.transcripts} tr ON tr.call_id = k.id
     WHERE COALESCE(k.started_at, k.created_at) >= $1 AND COALESCE(k.started_at, k.created_at) < $2
       ${v ? 'AND e.rubrica_version = $4' : ''}
       AND ($3::text IS NULL OR LOWER(x.usuario) = LOWER($3))
     ORDER BY e.call_id, e.created_at DESC`,
    v ? [tiempo.instante(desde, 0).toISOString(), tiempo.instante(tiempo.sumarDias(hasta, 1), 0).toISOString(), usuario || null, v]
      : [tiempo.instante(desde, 0).toISOString(), tiempo.instante(tiempo.sumarDias(hasta, 1), 0).toISOString(), usuario || null]);
  return r.rows;
}

async function criteriosDe(db, config) {
  const v = config.RUBRICA_ACTIVA;
  const r = await db.query(`SELECT version, criterios FROM ${T.rubricas} WHERE ${v ? 'version = $1' : 'activa'} LIMIT 1`, v ? [v] : []);
  return r.rows[0] || { version: v || null, criterios: [] };
}

// Tasa de "no cumple" por criterio en un conjunto de evaluaciones.
function tasas(criterios, evaluaciones, config) {
  const pesos = config.PESOS_CRITERIOS || {};
  return criterios.map(def => {
    let aplican = 0, noCumple = 0; const ejemplos = [];
    for (const ev of evaluaciones) {
      const c = (ev.resultado.criterios || []).find(x => x.id === def.id);
      if (!c || c.estado === 'no_aplica') continue;
      aplican++;
      if (c.estado === 'no_cumple') { noCumple++; if (ejemplos.length < 3) ejemplos.push({ call_id: ev.call_id, empresa: ev.empresa, cita: c.cita, nota: c.nota, confianza: c.confianza }); }
    }
    return { id: def.id, nombre: def.nombre, descripcion: def.descripcion, peso: pesos[def.id] || 1, aplican, no_cumple: noCumple, tasa: aplican ? Number((noCumple / aplican).toFixed(2)) : null, ejemplos };
  });
}

async function focoActivo(db, usuario, hoy) {
  const r = await db.query(
    `SELECT id, usuario, criterio, rubrica_version, desde::text, hasta::text, tasa_inicial, llamadas_inicial, ${ms('propuesto_at')} AS propuesto_ms, ${ms('confirmado_at')} AS confirmado_ms, nota
     FROM ${T.focos} WHERE LOWER(usuario) = LOWER($1) AND cerrado_at IS NULL AND hasta >= $2 ORDER BY desde DESC LIMIT 1`, [usuario, hoy]);
  return r.rows[0] || null;
}

async function focoAnterior(db, usuario, hoy) {
  const r = await db.query(
    `SELECT id, criterio, rubrica_version, desde::text, hasta::text, tasa_inicial, llamadas_inicial, nota
     FROM ${T.focos} WHERE LOWER(usuario) = LOWER($1) AND (cerrado_at IS NOT NULL OR hasta < $2) ORDER BY hasta DESC LIMIT 1`, [usuario, hoy]);
  return r.rows[0] || null;
}

// Análisis de una semana para un usuario (sdr). `fecha` cualquier día de la semana.
async function analizarSemana(db, config, { fecha, usuario, ahora = new Date() }) {
  const hoy = tiempo.fechaBogota(ahora);
  const { lunes, domingo } = semanaDe(fecha || hoy);
  const rubrica = await criteriosDe(db, config);
  const criterios = rubrica.criterios || [];
  const evs = await evaluacionesEntre(db, config, { desde: lunes, hasta: domingo, usuario });
  const porCriterio = tasas(criterios, evs, config);
  const minLl = Number(config.HABITO_MIN_LLAMADAS) || 3, minTasa = Number(config.HABITO_MIN_TASA) || 0;
  const habitos = porCriterio
    .filter(c => c.no_cumple >= minLl && (c.tasa || 0) >= minTasa)
    .sort((a, b) => (b.peso * b.tasa) - (a.peso * a.tasa) || b.no_cumple - a.no_cumple);

  // Foco: el activo (con seguimiento) o la propuesta (el hábito que más pesa).
  const activo = usuario ? await focoActivo(db, usuario, hoy) : null;
  let foco = null;
  if (activo) {
    const c = porCriterio.find(x => x.id === activo.criterio);
    const diasRestantes = Math.max(0, tiempo.diasEntre(new Date(hoy + 'T12:00:00-05:00'), new Date(activo.hasta + 'T12:00:00-05:00')));
    foco = {
      estado: activo.confirmado_ms ? 'activo' : 'propuesto', criterio: activo.criterio, nombre: (c || {}).nombre || activo.criterio, descripcion: (c || {}).descripcion,
      desde: activo.desde, hasta: activo.hasta, dias_restantes: diasRestantes, confirmado: !!activo.confirmado_ms,
      tasa_inicial: activo.tasa_inicial, llamadas_inicial: activo.llamadas_inicial,
      tasa_actual: c ? c.tasa : null, aplican_actual: c ? c.aplican : 0, no_cumple_actual: c ? c.no_cumple : 0,
      ejemplos: c ? c.ejemplos : [],
      tendencia: c && c.tasa != null && activo.tasa_inicial != null ? Number((c.tasa - activo.tasa_inicial).toFixed(2)) : null,
    };
  } else if (habitos.length) {
    const h = habitos[0];
    foco = { estado: 'propuesto', criterio: h.id, nombre: h.nombre, descripcion: h.descripcion, tasa_inicial: h.tasa, llamadas_inicial: h.aplican, no_cumple_actual: h.no_cumple, aplican_actual: h.aplican, ejemplos: h.ejemplos, semanas: Number(config.FOCO_SEMANAS) || 2, confirmado: false };
  }

  // Seguimiento del foco anterior (ya cerrado o vencido): cómo le fue en esta semana.
  const anterior = usuario ? await focoAnterior(db, usuario, hoy) : null;
  let seguimiento = null;
  if (anterior) {
    const c = porCriterio.find(x => x.id === anterior.criterio);
    seguimiento = { criterio: anterior.criterio, nombre: (c || {}).nombre || anterior.criterio, desde: anterior.desde, hasta: anterior.hasta, tasa_inicial: anterior.tasa_inicial, tasa_actual: c ? c.tasa : null, aplican_actual: c ? c.aplican : 0, mejoro: c && c.tasa != null && anterior.tasa_inicial != null ? c.tasa < anterior.tasa_inicial : null };
  }

  // Mejor momento: de la llamada con más criterios cumplidos (ponderados) que tenga cita.
  let mejor = null, mejorPuntaje = -1;
  for (const ev of evs) {
    const mm = ev.resultado.mejor_momento;
    if (!mm || !mm.cita) continue;
    const puntaje = (ev.resultado.criterios || []).reduce((s, c) => s + (c.estado === 'cumple' ? ((config.PESOS_CRITERIOS || {})[c.id] || 1) * c.confianza : 0), 0);
    if (puntaje > mejorPuntaje) { mejorPuntaje = puntaje; mejor = { call_id: ev.call_id, empresa: ev.empresa, contacto: ev.contacto, cita: mm.cita, por_que: mm.por_que, resultado: ev.resultado_llamada }; }
  }

  const fortalezas = porCriterio.filter(c => c.aplican >= minLl && c.no_cumple === 0).map(c => ({ id: c.id, nombre: c.nombre, aplican: c.aplican }));
  return {
    lunes, domingo, usuario: usuario || null, rubrica: rubrica.version,
    llamadas_evaluadas: evs.length,
    suficiente: evs.length >= minLl,
    minimo_llamadas: minLl,
    criterios: porCriterio,
    habitos, foco, seguimiento, mejor_momento: mejor, fortalezas,
    grabacion_mencionada: evs.length ? evs.filter(e => e.resultado.menciono_grabacion).length : null,
  };
}

// Angie confirma el foco propuesto (o elige otro criterio): FOCO_SEMANAS semanas desde hoy.
async function confirmarFoco(db, config, { usuario, criterio, nota, ahora = new Date() }) {
  if (!usuario) throw error(400, 'Falta el usuario');
  const rubrica = await criteriosDe(db, config);
  const def = (rubrica.criterios || []).find(c => c.id === criterio);
  if (!def) throw error(400, `Criterio desconocido: ${criterio}`);
  const hoy = tiempo.fechaBogota(ahora);
  const a = await analizarSemana(db, config, { fecha: hoy, usuario, ahora });
  const c = a.criterios.find(x => x.id === criterio) || {};
  await db.query(`UPDATE ${T.focos} SET cerrado_at = NOW() WHERE LOWER(usuario) = LOWER($1) AND cerrado_at IS NULL`, [usuario]);
  const semanas = Number(config.FOCO_SEMANAS) || 2;
  const hasta = tiempo.sumarDias(hoy, semanas * 7 - 1);
  const r = await db.query(
    `INSERT INTO ${T.focos} (usuario, criterio, rubrica_version, desde, hasta, tasa_inicial, llamadas_inicial, confirmado_at, nota)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), $8) RETURNING id, desde::text, hasta::text`,
    [usuario, criterio, rubrica.version, hoy, hasta, c.tasa != null ? c.tasa : null, c.aplican || 0, nota || null]);
  return { id: r.rows[0].id, criterio, nombre: def.nombre, desde: r.rows[0].desde, hasta: r.rows[0].hasta, tasa_inicial: c.tasa != null ? c.tasa : null };
}

// Foto del informe: el día/hora configurados, una vez por semana y usuario de rol sdr.
async function jobInforme(db, config, ahora = new Date()) {
  const hoy = tiempo.fechaBogota(ahora);
  const dia = tiempo.diaSemana(hoy);
  const horaBogota = Number(tiempo.horaBogota(ahora).slice(0, 2));
  if (dia !== (Number(config.INFORME_DIA_SEMANA) || 5) || horaBogota < (Number(config.INFORME_HORA) || 16)) return { hecho: 0 };
  const { lunes } = semanaDe(hoy);
  let hecho = 0;
  for (const u of (config.USUARIOS || []).filter(x => x.rol === 'sdr')) {
    const existe = (await db.query(`SELECT 1 FROM ${T.informes} WHERE semana = $1 AND LOWER(usuario) = LOWER($2)`, [lunes, u.nombre])).rows.length;
    if (existe) continue;
    const datos = await analizarSemana(db, config, { fecha: hoy, usuario: u.nombre, ahora });
    await db.query(`INSERT INTO ${T.informes} (semana, usuario, datos) VALUES ($1, $2, $3::jsonb) ON CONFLICT (semana, usuario) DO NOTHING`, [lunes, u.nombre, JSON.stringify(datos)]);
    hecho++;
  }
  return { hecho };
}

async function informesGuardados(db, usuario, { limite = 12 } = {}) {
  const r = await db.query(`SELECT semana::text, usuario, datos, ${ms('created_at')} AS created_ms FROM ${T.informes} WHERE ($1::text IS NULL OR LOWER(usuario) = LOWER($1)) ORDER BY semana DESC LIMIT $2`, [usuario || null, limite]);
  return r.rows;
}

module.exports = { analizarSemana, confirmarFoco, jobInforme, informesGuardados, evaluacionesEntre, tasas };

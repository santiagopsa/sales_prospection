// Ritmo de prospección: bloque en curso, actividad por día y racha. Todo sale de sdr.touches.
const { T } = require('./schema');
const D = require('./dominio');
const tiempo = require('./tiempo');
const { filtroUsuario, paramUsuario } = require('./resultados');

const minutos = hhmm => { const [h, m] = String(hhmm).split(':').map(Number); return h * 60 + (m || 0); };
const conv = JSON.stringify(D.RESULTADOS_CON_CONVERSACION);

// Actividad por día (Bogotá) entre dos fechas inclusive: marcaciones, conversaciones, reuniones, toques.
async function actividadPorDia(db, desde, hasta, config = {}, usuario = null) {
  const r = await db.query(
    `SELECT to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD') AS fecha,
            COUNT(*) FILTER (WHERE canal = 'llamada')::int AS marcaciones,
            COUNT(*) FILTER (WHERE resultado IN (SELECT jsonb_array_elements_text($3::jsonb)))::int AS conversaciones,
            COUNT(*) FILTER (WHERE resultado = 'reunion_agendada')::int AS reuniones,
            COUNT(*) FILTER (WHERE canal = 'whatsapp')::int AS whatsapp,
            COUNT(*) FILTER (WHERE canal = 'correo')::int AS correo,
            COUNT(*) FILTER (WHERE canal = 'linkedin')::int AS linkedin,
            COUNT(*) FILTER (WHERE canal <> 'ejecutiva')::int AS toques
     FROM ${T.touches}
     WHERE created_at >= $1 AND created_at < $2 ${filtroUsuario(config, 4, usuario)}
     GROUP BY 1 ORDER BY 1`,
    [tiempo.instante(desde, 0).toISOString(), tiempo.instante(tiempo.sumarDias(hasta, 1), 0).toISOString(), conv, paramUsuario(config, usuario)]);
  const porFecha = Object.fromEntries(r.rows.map(x => [x.fecha, x]));
  const dias = [];
  for (let f = desde; f <= hasta; f = tiempo.sumarDias(f, 1)) {
    dias.push({ fecha: f, marcaciones: 0, conversaciones: 0, reuniones: 0, whatsapp: 0, correo: 0, linkedin: 0, toques: 0, ...(porFecha[f] || {}) });
  }
  return dias;
}

function diaCumplido(config, d) {
  const m = d.marcaciones >= config.META_MARCACIONES_DIA, c = d.conversaciones >= config.META_CONVERSACIONES_DIA;
  return config.RACHA_CUMPLE_CON === 'conversaciones' ? c : config.RACHA_CUMPLE_CON === 'cualquiera' ? (m || c) : m;
}

// Días hábiles seguidos cumpliendo la meta, contando hacia atrás desde ayer (hoy suma si ya cumplió).
async function racha(db, config, ahora = new Date(), usuario = null) {
  const hoy = tiempo.fechaBogota(ahora);
  const dias = await actividadPorDia(db, tiempo.sumarDias(hoy, -60), hoy, config, usuario);
  const porFecha = Object.fromEntries(dias.map(d => [d.fecha, d]));
  let n = 0;
  const hoyCumple = diaCumplido(config, porFecha[hoy]);
  let f = tiempo.sumarDias(hoy, -1);
  for (let i = 0; i < 60; i++, f = tiempo.sumarDias(f, -1)) {
    if (tiempo.esFinDeSemana(f)) continue;
    if (diaCumplido(config, porFecha[f] || {})) n++; else break;
  }
  return { dias: n + (hoyCumple ? 1 : 0), hoyCumple };
}

// Bloque de prospección en curso (o null) con lo marcado dentro de él.
async function bloqueActual(db, config, ahora = new Date(), usuario = null) {
  const hoy = tiempo.fechaBogota(ahora);
  const minAhora = Math.floor((ahora - tiempo.instante(hoy, 0)) / 60000);
  const bloques = config.BLOQUES_PROSPECCION || [];
  const idx = bloques.findIndex(b => minAhora >= minutos(b.inicio) && minAhora < minutos(b.fin));
  const siguiente = bloques.find(b => minutos(b.inicio) > minAhora) || null;
  if (idx < 0) return { enCurso: null, siguiente: siguiente ? { nombre: siguiente.nombre, inicio: siguiente.inicio } : null };
  const b = bloques[idx];
  const desde = new Date(tiempo.instante(hoy, 0).getTime() + minutos(b.inicio) * 60000);
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE canal = 'llamada')::int AS marcaciones,
            COUNT(*) FILTER (WHERE resultado IN (SELECT jsonb_array_elements_text($3::jsonb)))::int AS conversaciones
     FROM ${T.touches} WHERE created_at >= $1 AND created_at < $2 ${filtroUsuario(config, 4, usuario)}`,
    [desde.toISOString(), ahora.toISOString(), conv, paramUsuario(config, usuario)]);
  return {
    enCurso: {
      nombre: b.nombre || `Bloque ${idx + 1}`, inicio: b.inicio, fin: b.fin,
      metaMarcaciones: b.metaMarcaciones, marcaciones: r.rows[0].marcaciones, conversaciones: r.rows[0].conversaciones,
      minutosRestantes: minutos(b.fin) - minAhora,
    },
    siguiente: siguiente ? { nombre: siguiente.nombre, inicio: siguiente.inicio } : null,
  };
}

// Tasas sobre una ventana móvil. Se calculan siempre; la vista decide si las muestra (MOSTRAR_RATIOS).
async function ratios(db, config, ahora = new Date(), usuario = null) {
  const hasta = tiempo.fechaBogota(ahora);
  const desde = tiempo.sumarDias(hasta, -(config.VENTANA_RATIOS_DIAS - 1));
  const r = await db.query(
    `SELECT COUNT(*) FILTER (WHERE canal = 'llamada')::int AS marcaciones,
            COUNT(*) FILTER (WHERE resultado IN (SELECT jsonb_array_elements_text($3::jsonb)))::int AS conversaciones,
            COUNT(*) FILTER (WHERE resultado = 'reunion_agendada')::int AS agendadas,
            COUNT(*) FILTER (WHERE resultado = 'reunion_realizada')::int AS realizadas,
            COUNT(*) FILTER (WHERE resultado = 'no_show')::int AS no_show,
            COUNT(*) FILTER (WHERE resultado = 'calificado')::int AS calificados
     FROM ${T.touches} WHERE created_at >= $1 AND created_at < $2
       AND (canal = 'ejecutiva' OR (TRUE ${filtroUsuario(config, 4, usuario)}))`,
    [tiempo.instante(desde, 0).toISOString(), tiempo.instante(tiempo.sumarDias(hasta, 1), 0).toISOString(), conv, paramUsuario(config, usuario)]);
  const x = r.rows[0];
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  return {
    desde, hasta, ...x,
    tasaContacto: pct(x.conversaciones, x.marcaciones),
    conversacionAReunion: pct(x.agendadas, x.conversaciones),
    reunionRealizada: pct(x.realizadas, x.realizadas + x.no_show),
    realizadaACalificado: pct(x.calificados, x.realizadas),
  };
}

// Semana (lunes a domingo, Bogotá) que contiene `fecha`.
function semanaDe(fecha) {
  const d = tiempo.diaSemana(fecha); // 0 dom
  const lunes = tiempo.sumarDias(fecha, d === 0 ? -6 : 1 - d);
  return { lunes, domingo: tiempo.sumarDias(lunes, 6) };
}

async function resumenSemana(db, config, { fecha, usuario = null, ahora = new Date() } = {}) {
  const hoy = tiempo.fechaBogota(ahora);
  const { lunes, domingo } = semanaDe(fecha || hoy);
  const dias = await actividadPorDia(db, lunes, domingo, config, usuario);
  const habiles = dias.filter(d => !tiempo.esFinDeSemana(d.fecha) && d.fecha <= hoy);
  const suma = k => dias.reduce((s, d) => s + d[k], 0);
  const totales = { marcaciones: suma('marcaciones'), conversaciones: suma('conversaciones'), reuniones: suma('reuniones'), whatsapp: suma('whatsapp'), correo: suma('correo'), linkedin: suma('linkedin'), toques: suma('toques') };
  return {
    lunes, domingo, hoy,
    dias: dias.map(d => ({ ...d, habil: !tiempo.esFinDeSemana(d.fecha), cumplida: diaCumplido(config, d) })),
    totales,
    metas: {
      marcaciones: config.META_MARCACIONES_DIA * Math.max(habiles.length, 1),
      conversaciones: config.META_CONVERSACIONES_DIA * Math.max(habiles.length, 1),
      diasHabilesTranscurridos: habiles.length,
      diasCumplidos: habiles.filter(d => diaCumplido(config, d)).length,
    },
    usuario: usuario || null,
    racha: await racha(db, config, ahora, usuario),
    ratios: await ratios(db, config, ahora, usuario),
    mostrarRatios: !!config.MOSTRAR_RATIOS,
    // Mejora de la semana (fase 5): hábitos, foco, mejor momento. Solo tiene sentido para un sdr.
    mejora: await require('./mejora').analizarSemana(db, config, { fecha: lunes, usuario: usuario || (require('./resultados').usuariosSdr(config)[0] || null), ahora }),
  };
}

module.exports = { actividadPorDia, racha, bloqueActual, ratios, resumenSemana, semanaDe, diaCumplido };

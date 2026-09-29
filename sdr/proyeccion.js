// Proyección de la silla comercial contra lo real, mes a mes (config.PROYECCION).
//
// Plan: lo que dice el modelo financiero para cada mes de la silla (rampa 25/50/75/100 % del nivel).
// Real: toques de la SDR (llamadas, conversaciones, reuniones agendadas), reuniones calificadas y
// comisión (comision.resumenMes, misma regla que la comisión), clientes ganados en el Sandler
// (public.deals con canal sdr_interno y outcome won, por mes de cierre).
// Ritmo: en el mes en curso, lo real proyectado a fin de mes por días hábiles (lineal).
const { T } = require('./schema');
const C = require('./comision');
const D = require('./dominio');
const R = require('./resultados');
const tiempo = require('./tiempo');

function mesIndice(mes) { const [a, m] = mes.split('-').map(Number); return a * 12 + (m - 1); }
function mesDeIndice(i) { return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, '0')}`; }

// Días hábiles (lunes a viernes) del mes; `hasta` corta el conteo (inclusive) para el mes en curso.
function diasHabiles(mes, hasta = null) {
  const lim = C.limitesMes(mes);
  let n = 0;
  for (let f = lim.inicio; f < lim.siguiente; f = tiempo.sumarDias(f, 1)) {
    if (hasta && f > hasta) break;
    if (!tiempo.esFinDeSemana(f)) n++;
  }
  return n;
}

// El plan de un mes de la silla (1 = inicio). Devuelve null si el mes es anterior al inicio.
function plan(config, mes) {
  const P = config.PROYECCION || {};
  const k = mesIndice(mes) - mesIndice(P.inicio) + 1;
  if (k < 1) return null;
  const rampa = P.rampa || [0.25, 0.5, 0.75];
  const frac = k <= rampa.length ? rampa[k - 1] : 1;
  const llamadas = Math.round((P.llamadas_hora || 0) * (P.horas_semana || 0) * (P.semanas_mes || 0));
  const calificadas = (P.nivel || 0) * frac;
  const costos = P.costo_silla_usd || [];
  const costo = costos.length ? costos[Math.min(k, costos.length) - 1] : null;
  const clientes = calificadas * (P.conversion_cliente || 0);
  const com = C.calcular(config, Math.round(calificadas));
  return {
    mes, numero: k, rampa: frac, llamadas, calificadas, tasa_exito: P.tasa_exito || null,
    clientes, ingreso_contratado: clientes * (P.ingreso_cliente_usd || 0) * (P.ltv_meses || 0),
    comision: com.total, costo,
  };
}

async function realDelMes(db, config, mes, { usuario, ahora }) {
  const lim = C.limitesMes(mes);
  const hoy = tiempo.fechaBogota(ahora);
  const hastaDia = lim.siguiente > hoy ? hoy : tiempo.sumarDias(lim.siguiente, -1);
  const desde = tiempo.instante(lim.inicio, 0).toISOString();
  const hasta = tiempo.instante(lim.siguiente, 0).toISOString();
  const t = (await db.query(
    `SELECT COUNT(*) FILTER (WHERE canal = 'llamada')::int AS llamadas,
            COUNT(*) FILTER (WHERE resultado IN (SELECT jsonb_array_elements_text($3::jsonb)))::int AS conversaciones,
            COUNT(*) FILTER (WHERE resultado = 'reunion_agendada')::int AS agendadas,
            COUNT(*) FILTER (WHERE canal <> 'ejecutiva')::int AS toques,
            COUNT(DISTINCT to_char(created_at AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD')) FILTER (WHERE canal <> 'ejecutiva')::int AS dias_activos
     FROM ${T.touches} WHERE created_at >= $1 AND created_at < $2 ${R.filtroUsuario(config, 4, usuario)}`,
    [desde, hasta, JSON.stringify(D.RESULTADOS_CON_CONVERSACION), R.paramUsuario(config, usuario)])).rows[0];
  const com = await C.resumenMes(db, config, { mes, usuario, ahora });
  let ganados = 0, perdidos = 0;
  if ((await db.query(`SELECT to_regclass('public.deals') IS NOT NULL AS ok`)).rows[0].ok) {
    const g = (await db.query(
      `SELECT COUNT(*) FILTER (WHERE outcome = 'won')::int AS ganados, COUNT(*) FILTER (WHERE outcome = 'lost')::int AS perdidos
       FROM public.deals WHERE canal_adquisicion = 'sdr_interno' AND closed_at >= $1 AND closed_at < $2`, [desde, hasta])).rows[0];
    ganados = g.ganados; perdidos = g.perdidos;
  }
  const P = config.PROYECCION || {};
  return {
    llamadas: t.llamadas, conversaciones: t.conversaciones, agendadas: t.agendadas, toques: t.toques, dias_activos: t.dias_activos,
    reuniones_mes: com.conteo.reuniones, calificadas: com.conteo.calificadas, por_calificar: com.conteo.por_calificar, programadas: com.conteo.programadas,
    no_califica: com.conteo.no_califica, no_asistio: com.conteo.no_asistio,
    comision: com.comision.total, ganados, perdidos,
    ingreso_contratado: ganados * (P.ingreso_cliente_usd || 0) * (P.ltv_meses || 0),
    tasa_exito: t.llamadas ? com.conteo.calificadas / t.llamadas : null,
    habiles_mes: diasHabiles(mes), habiles_transcurridos: diasHabiles(mes, hastaDia),
  };
}

async function seguimiento(db, config, { hasta = null, ahora = new Date() } = {}) {
  const P = config.PROYECCION || {};
  if (!P.inicio) throw Object.assign(new Error('Falta PROYECCION.inicio en config.js'), { status: 500 });
  const usuario = ((config.USUARIOS || []).find(u => u.rol === 'sdr') || {}).nombre || null;
  const hoyMes = tiempo.fechaBogota(ahora).slice(0, 7);
  const fin = hasta && /^\d{4}-\d{2}$/.test(hasta) ? hasta : hoyMes;
  const meses = [];
  for (let i = mesIndice(P.inicio); i <= Math.max(mesIndice(fin), mesIndice(P.inicio)); i++) {
    const mes = mesDeIndice(i);
    const p = plan(config, mes);
    const r = await realDelMes(db, config, mes, { usuario, ahora });
    const enCurso = mes === hoyMes;
    // Ritmo: lo real del mes en curso llevado a fin de mes por días hábiles.
    const factor = enCurso && r.habiles_transcurridos ? r.habiles_mes / r.habiles_transcurridos : 1;
    const ritmo = enCurso ? { llamadas: Math.round(r.llamadas * factor), agendadas: Math.round(r.agendadas * factor), calificadas: Math.round(r.calificadas * factor * 10) / 10 } : null;
    meses.push({ mes, en_curso: enCurso, plan: p, real: r, ritmo,
      cumplimiento: p && p.calificadas ? Math.round((r.calificadas / p.calificadas) * 100) : null });
  }
  const acum = f => meses.reduce((s, m) => s + (f(m) || 0), 0);
  const cerrados = meses.filter(m => !m.en_curso);
  return {
    inicio: P.inicio, hoy: tiempo.fechaBogota(ahora), usuario, moneda: P.moneda || 'US$',
    supuestos: { ...P, llamadas_mes: Math.round((P.llamadas_hora || 0) * (P.horas_semana || 0) * (P.semanas_mes || 0)) },
    meses,
    acumulado: {
      plan_calificadas: acum(m => m.plan && m.plan.calificadas), real_calificadas: acum(m => m.real.calificadas),
      plan_clientes: acum(m => m.plan && m.plan.clientes), real_clientes: acum(m => m.real.ganados),
      plan_costo: acum(m => m.plan && m.plan.costo), real_comision: acum(m => m.real.comision),
      plan_ingreso: acum(m => m.plan && m.plan.ingreso_contratado), real_ingreso: acum(m => m.real.ingreso_contratado),
      llamadas: acum(m => m.real.llamadas), agendadas: acum(m => m.real.agendadas), por_calificar: acum(m => m.real.por_calificar), programadas: acum(m => m.real.programadas),
      meses_cerrados: cerrados.length,
    },
  };
}

module.exports = { seguimiento, plan, diasHabiles };

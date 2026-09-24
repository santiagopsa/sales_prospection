// Comisión de la SDR por reuniones calificadas. No guarda nada: se calcula con las reuniones que la
// SDR agendó (toques "reunion_agendada") y la calificación que la ejecutiva dejó en el Sandler Coach
// (public.deals.calificacion_sandler, enlazado por leads.deal_id). Reglas en config.COMISION.
const { T } = require('./schema');
const tiempo = require('./tiempo');

function error(status, message) { return Object.assign(new Error(message), { status }); }

// Tramos ordenados y validados.
function tramos(config) {
  const t = ((config.COMISION || {}).tramos || []).slice().sort((a, b) => a.desde - b.desde);
  if (!t.length || t[0].desde !== 0) throw error(500, 'COMISION.tramos debe empezar con un tramo desde 0');
  return t;
}

// Cuánto se lleva con `n` calificadas. Devuelve el total, el tramo alcanzado, el siguiente y
// cuánto sería al llegar a él (para mostrar "te faltan X para ...").
function calcular(config, n) {
  const ts = tramos(config);
  const modo = (config.COMISION || {}).modo === 'tramos' ? 'tramos' : 'escalon';
  const idx = ts.reduce((k, t, i) => (n >= t.desde ? i : k), 0);
  const totalCon = m => {
    if (modo === 'escalon') {
      const j = ts.reduce((k, t, i) => (m >= t.desde ? i : k), 0);
      return m * ts[j].valor;
    }
    // Reunión número k (1, 2, …) se paga al tramo con el mayor `desde` <= k.
    let total = 0;
    for (let i = 0; i < ts.length; i++) {
      const primera = Math.max(ts[i].desde, 1), ultima = i + 1 < ts.length ? ts[i + 1].desde - 1 : Infinity;
      total += Math.max(0, Math.min(m, ultima) - primera + 1) * ts[i].valor;
    }
    return total;
  };
  const sig = ts[idx + 1] || null;
  return {
    modo, n, total: totalCon(n),
    tramo: { indice: idx, ...ts[idx] },
    siguiente: sig ? { indice: idx + 1, ...sig, faltan: sig.desde - n, total_al_llegar: totalCon(sig.desde) } : null,
    // Lo que vale la próxima reunión calificada (en escalón, llegar al umbral sube todas las anteriores).
    proxima_vale: totalCon(n + 1) - totalCon(n),
    tramos: ts,
  };
}

function limitesMes(mes) {
  if (!/^\d{4}-\d{2}$/.test(mes || '')) mes = tiempo.fechaBogota(new Date()).slice(0, 7);
  const inicio = `${mes}-01`;
  const siguiente = tiempo.sumarMeses(inicio, 1);
  return { mes, inicio, siguiente, anterior: tiempo.sumarMeses(inicio, -1).slice(0, 7), posterior: siguiente.slice(0, 7) };
}

// Reuniones de un mes y su estado:
//   calificada   la ejecutiva la calificó con un valor de COMISION.califica_con en el Sandler
//   no_califica  calificada con otro valor (Parcial, No califica…)
//   no_asistio   la ejecutiva marcó no-show
//   cancelada    el prospecto la canceló (Calendly)
//   programada   la reunión todavía no ha pasado
//   por_calificar ya pasó y no hay calificación en el Sandler
async function resumenMes(db, config, { mes, usuario = null, ahora = new Date() } = {}) {
  const cfg = config.COMISION || {};
  const lim = limitesMes(mes);
  const desde = tiempo.instante(lim.inicio, 0).toISOString();
  const hasta = tiempo.instante(lim.siguiente, 0).toISOString();
  const porAgendada = cfg.mes_por === 'agendada';
  const sdrs = (config.USUARIOS || []).filter(u => u.rol === 'sdr').map(u => u.nombre);
  // Si quien mira es una SDR, solo lo suyo; si no (ejecutiva, admin), el de todas las SDR.
  const esSdr = usuario && sdrs.some(n => n.toLowerCase() === String(usuario).toLowerCase());
  const r = await db.query(
    `SELECT l.id AS lead_id, l.empresa, l.contacto, l.etapa, l.deal_id,
            (EXTRACT(EPOCH FROM l.reunion_at) * 1000)::float8 AS reunion_ms,
            (EXTRACT(EPOCH FROM a.created_at) * 1000)::float8 AS agendada_ms, a.usuario AS agendo,
            EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.resultado = 'no_show' AND x.created_at >= a.created_at) AS no_show,
            EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.resultado = 'reunion_cancelada' AND x.created_at >= a.created_at) AS cancelada
     FROM ${T.leads} l
     JOIN LATERAL (
       SELECT usuario, created_at FROM ${T.touches}
       WHERE lead_id = l.id AND resultado = 'reunion_agendada' ORDER BY created_at DESC LIMIT 1
     ) a ON TRUE
     WHERE ${porAgendada ? 'a.created_at' : 'COALESCE(l.reunion_at, a.created_at)'} >= $1
       AND ${porAgendada ? 'a.created_at' : 'COALESCE(l.reunion_at, a.created_at)'} < $2
       AND ($3::text IS NULL AND (a.usuario IS NULL OR a.usuario IN (SELECT jsonb_array_elements_text($4::jsonb)))
            OR LOWER(a.usuario) = LOWER($3))
     ORDER BY COALESCE(l.reunion_at, a.created_at)`,
    [desde, hasta, esSdr ? usuario : null, JSON.stringify(sdrs)]);

  // Calificación en el Sandler Coach (si la tabla existe: en desarrollo sin el Sandler no está).
  const ids = r.rows.map(x => x.deal_id).filter(Boolean);
  const deals = {};
  const hayDeals = (await db.query(`SELECT to_regclass('public.deals') IS NOT NULL AS ok`)).rows[0].ok;
  if (ids.length && hayDeals) {
    const d = await db.query(
      `SELECT id, calificacion_sandler, executive, outcome FROM public.deals WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [JSON.stringify(ids)]);
    for (const x of d.rows) deals[x.id] = x;
  }
  const califica = (cfg.califica_con || ['Completa']).map(s => s.toLowerCase());
  const reuniones = r.rows.map(x => {
    const deal = x.deal_id ? deals[x.deal_id] || null : null;
    const cal = deal && deal.calificacion_sandler ? deal.calificacion_sandler : null;
    let estado;
    if (cal && califica.includes(cal.toLowerCase())) estado = 'calificada';
    else if (x.no_show) estado = 'no_asistio';
    else if (x.cancelada) estado = 'cancelada';
    else if (cal) estado = 'no_califica';                        // la ejecutiva ya llenó el demo y no llegó
    else if (x.reunion_ms && x.reunion_ms > ahora.getTime()) estado = 'programada';
    else estado = 'por_calificar';
    return { ...x, calificacion: cal, ejecutiva: deal ? deal.executive : null, estado };
  });
  const cuenta = e => reuniones.filter(x => x.estado === e).length;
  const n = cuenta('calificada');
  return {
    ...lim,
    usuario: esSdr ? usuario : null,
    reglas: { modo: cfg.modo === 'tramos' ? 'tramos' : 'escalon', califica_con: cfg.califica_con || ['Completa'], mes_por: porAgendada ? 'agendada' : 'reunion', moneda: cfg.moneda || 'US$' },
    conteo: {
      reuniones: reuniones.length, calificadas: n, no_califica: cuenta('no_califica'), no_asistio: cuenta('no_asistio'), canceladas: cuenta('cancelada'),
      programadas: cuenta('programada'), por_calificar: cuenta('por_calificar'),
    },
    comision: calcular(config, n),
    // Techo del mes si todas las pendientes (programadas + por calificar) calificaran.
    potencial: calcular(config, n + cuenta('programada') + cuenta('por_calificar')),
    reuniones,
    hoy: tiempo.fechaBogota(ahora),
  };
}

module.exports = { calcular, resumenMes, limitesMes, tramos };

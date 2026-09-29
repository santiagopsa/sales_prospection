// Tablero de la ejecutiva comercial (Luisa): las reuniones que agendó la SDR en el mes, sus
// indicadores y la calificación Sandler con 4 "chulos" que se llenan a mano.
//
// Los chulos se guardan en el deal del Sandler Coach (public.deals, enlazado por leads.deal_id):
// data.calificacionManual = { items: { dolor, presupuesto, decision, fecha }, por, at } y se recalcula
// calificacion_sandler con la regla de calificacion.js. Así la comisión de la SDR, el historial del
// Sandler y este tablero leen lo mismo.
const { T } = require('./schema');
const D = require('./dominio');
const C = require('./comision');
const CAL = require('./calificacion');
const R = require('./resultados');
const tiempo = require('./tiempo');

function error(status, message) { return Object.assign(new Error(message), { status }); }

async function hayDeals(db) {
  return (await db.query(`SELECT to_regclass('public.deals') IS NOT NULL AS ok`)).rows[0].ok;
}

async function dealsPorId(db, ids) {
  const out = {};
  if (!ids.length || !(await hayDeals(db))) return out;
  // to_jsonb(d.*): la tabla del Sandler ha crecido por migraciones; se leen las columnas que haya.
  const r = await db.query(`SELECT d.id, to_jsonb(d.*) AS fila FROM public.deals d WHERE d.id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [JSON.stringify(ids)]);
  for (const x of r.rows) out[x.id] = x.fila;
  return out;
}

function ms(v) { return v ? new Date(v).getTime() : null; }

// Un lead de la SDR puede quedar apuntando a un deal que ya no sirve: la ejecutiva borró el deal que
// creó la SDR y llenó el demo en un deal nuevo ("Nuevo deal" en vez de "Tomar"), o el deal de la SDR
// sigue vacío mientras el demo quedó en otro. Aquí se re-enlaza el lead al deal de la misma empresa
// (nombre normalizado: "Air products" = "Air Products S.A.S.") que tenga el demo o la calificación.
// Si no hay otro, se deja como está (al calificar se crea uno nuevo si el suyo ya no existe).
// Devuelve [{ lead_id, antes, ahora }] con los cambios.
async function reconciliarDeals(db, { leadIds = null } = {}) {
  if (!(await hayDeals(db))) return [];
  const LN = require('./listanegra');
  const leads = (await db.query(
    `SELECT l.id, l.empresa, l.deal_id, d.id AS existe,
            (SELECT MAX(x.created_at) FROM ${T.touches} x WHERE x.lead_id = l.id AND x.resultado = 'reunion_agendada') AS agendada_at,
            (d.calificacion_sandler IS NOT NULL OR COALESCE(d.data->>'transcript', '') <> '' OR d.data ? 'calificacionManual') AS con_datos
     FROM ${T.leads} l LEFT JOIN public.deals d ON d.id = l.deal_id
     WHERE (l.deal_id IS NOT NULL OR l.etapa IN ('reunion_agendada', 'reunion_realizada', 'calificado'))
       AND ($1::jsonb IS NULL OR l.id IN (SELECT jsonb_array_elements_text($1::jsonb)::int))`,
    [leadIds ? JSON.stringify(leadIds) : null])).rows.filter(l => !l.existe || !l.con_datos);
  if (!leads.length) return [];
  const deals = (await db.query(
    `SELECT id, company, (to_jsonb(deals.*)->>'created_at')::timestamptz AS creado, (calificacion_sandler IS NOT NULL OR COALESCE(data->>'transcript', '') <> '' OR data ? 'calificacionManual') AS con_datos
     FROM public.deals ORDER BY id DESC`)).rows;   // el más reciente primero
  const porEmpresa = new Map();
  for (const d of deals) {
    const k = LN.normalizarEmpresa(d.company);
    if (!k) continue;
    if (!porEmpresa.has(k)) porEmpresa.set(k, []);
    porEmpresa.get(k).push(d);
  }
  const cambios = [];
  for (const l of leads) {
    const k = LN.normalizarEmpresa(l.empresa);
    const cands = (k && porEmpresa.get(k)) || [];
    // Solo deals de esta vuelta: creados desde 3 días antes de que la SDR agendara (no un deal viejo
    // de la misma empresa, de otra negociación).
    const desde = l.agendada_at ? new Date(l.agendada_at).getTime() - 3 * 86400000 : null;
    const mejor = cands.find(d => d.con_datos && d.id !== l.deal_id && (!desde || !d.creado || new Date(d.creado).getTime() >= desde));
    if (!mejor) continue;
    await db.query(`UPDATE ${T.leads} SET deal_id = $2 WHERE id = $1`, [l.id, mejor.id]);
    // El deal pasa a contar como traído por la SDR (canal), sin tocar lo que la ejecutiva llenó.
    await db.query(`UPDATE public.deals SET canal_adquisicion = COALESCE(canal_adquisicion, 'sdr_interno'), freelancer_nombre = COALESCE(freelancer_nombre, 'Angie (SDR)') WHERE id = $1`, [mejor.id]);
    cambios.push({ lead_id: l.id, antes: l.deal_id, ahora: mejor.id });
  }
  if (cambios.length) console.log('[sdr] deals re-enlazados:', cambios.map(c => `lead ${c.lead_id}: #${c.antes || '—'} → #${c.ahora}`).join(', '));
  return cambios;
}

// Resultado comercial del deal (lo que sigue después de calificar).
function comercial(fila) {
  if (!fila) return null;
  if (fila.outcome === 'won') return 'ganada';
  if (fila.outcome === 'lost') return 'perdida';
  if (fila.quoted_at) return 'cotizada';
  return 'abierta';
}

const REALIZADA = ['reunion_realizada', 'calificado'];

function fila(x, lead, deal, ahora) {
  const data = (deal && deal.data) || {};
  const cal = CAL.calificacionSandler(data);
  const calificacion = deal ? deal.calificacion_sandler || null : null;
  const cerrada = x.estado === 'no_asistio' || x.estado === 'cancelada';
  const paso = x.reunion_ms && x.reunion_ms <= ahora.getTime();
  const realizada = !cerrada && (REALIZADA.includes(x.etapa) || !!calificacion);
  const man = data.calificacionManual || null;
  return {
    lead_id: x.lead_id, empresa: x.empresa, contacto: x.contacto,
    cargo: lead ? lead.cargo : null, telefono: lead ? lead.telefono : null, email: lead ? lead.email : null,
    etapa: x.etapa, estado: x.estado, reunion_ms: x.reunion_ms, agendada_ms: x.agendada_ms, agendo: x.agendo,
    realizada, deal_id: x.deal_id || null, ejecutiva: deal ? deal.executive || null : null,
    calificacion, items: cal.items, fuente: cal.fuente,
    formulario_sandler: !!(data.transcript && String(data.transcript).trim()),
    manual: man ? { por: man.por || null, ms: ms(man.at) } : null,
    comercial: comercial(deal), motivo: deal ? deal.outcome_reason || null : null,
    // Se califica cuando la reunión ya pasó (o se marcó realizada) y no fue no-show ni cancelada.
    puede_calificar: !cerrada && !D.ETAPAS_DE_ANGIE.includes(x.etapa) && (realizada || !!paso),
  };
}

async function tablero(db, config, { mes, ahora = new Date() } = {}) {
  try { await reconciliarDeals(db); } catch (e) { console.error('[sdr] reconciliar deals:', e.message); }
  const res = await C.resumenMes(db, config, { mes, ahora });
  const ids = res.reuniones.map(x => x.lead_id);
  const leads = {};
  if (ids.length) {
    const r = await db.query(`SELECT id, cargo, telefono, email FROM ${T.leads} WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [JSON.stringify(ids)]);
    for (const l of r.rows) leads[l.id] = l;
  }
  const deals = await dealsPorId(db, res.reuniones.map(x => x.deal_id).filter(Boolean));
  const reuniones = res.reuniones.map(x => fila(x, leads[x.lead_id], x.deal_id ? deals[x.deal_id] : null, ahora));

  const n = f => reuniones.filter(f).length;
  const evaluadas = reuniones.filter(x => x.calificacion);
  const porLabel = l => evaluadas.filter(x => x.calificacion.toLowerCase() === l.toLowerCase()).length;
  const realizadas = n(x => x.realizada);
  const noAsistio = n(x => x.estado === 'no_asistio');
  const porCalificar = reuniones.filter(x => x.estado === 'por_calificar');
  const masVieja = porCalificar.reduce((m, x) => (x.reunion_ms && (!m || x.reunion_ms < m) ? x.reunion_ms : m), null);
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : null);
  const kpis = {
    reuniones: reuniones.length,
    programadas: n(x => x.estado === 'programada'),
    por_calificar: porCalificar.length,
    dias_pendiente_mas_vieja: masVieja ? tiempo.diasEntre(new Date(masVieja), ahora) : null,
    realizadas, no_asistio: noAsistio, canceladas: n(x => x.estado === 'cancelada'),
    asistencia_pct: pct(realizadas, realizadas + noAsistio),
    completas: porLabel('Completa'), parciales: porLabel('Parcial'), no_califica: porLabel('No califica'),
    evaluadas: evaluadas.length,
    completa_pct: pct(porLabel('Completa'), evaluadas.length),
    // Qué criterio falta más en las reuniones calificadas: dónde tiene que apretar la SDR.
    criterios: CAL.CRITERIOS.map(c => ({ clave: c.clave, label: c.label, si: evaluadas.filter(x => x.items[c.clave]).length, de: evaluadas.length })),
    cotizadas: n(x => x.comercial === 'cotizada'), ganadas: n(x => x.comercial === 'ganada'), perdidas: n(x => x.comercial === 'perdida'),
  };

  // Reuniones de los 2 meses anteriores que siguen sin calificar (para que no se queden olvidadas).
  const anteriores = [];
  let m = res.anterior;
  for (let i = 0; i < 2; i++) {
    const a = await C.resumenMes(db, config, { mes: m, ahora });
    if (a.conteo.por_calificar) anteriores.push({ mes: a.mes, n: a.conteo.por_calificar });
    m = a.anterior;
  }

  const orden = { por_calificar: 0, programada: 1 };
  reuniones.sort((a, b) => {
    const oa = a.estado in orden ? orden[a.estado] : 2, ob = b.estado in orden ? orden[b.estado] : 2;
    if (oa !== ob) return oa - ob;
    const ra = a.reunion_ms || a.agendada_ms || 0, rb = b.reunion_ms || b.agendada_ms || 0;
    return oa === 1 ? ra - rb : rb - ra;   // próximas: la más cercana primero; el resto: la más reciente
  });

  return {
    mes: res.mes, anterior: res.anterior, posterior: res.posterior, hoy: res.hoy,
    kpis, reuniones, pendientes_anteriores: anteriores,
    comision: { calificadas: res.conteo.calificadas, total: res.comision.total, moneda: res.reglas.moneda, califica_con: res.reglas.califica_con, potencial: res.potencial.total },
    criterios: CAL.CRITERIOS,
    sandler: await hayDeals(db),
    // Nombres para la pantalla y para dejar registrado quién califica.
    ejecutiva: ((config.USUARIOS || []).find(u => u.rol === 'ejecutiva') || {}).nombre || null,
    sdr: ((config.USUARIOS || []).find(u => u.rol === 'sdr') || {}).nombre || null,
  };
}

// Guarda los 4 chulos de una reunión (o los quita con `limpiar`). Si la reunión seguía como
// "agendada" y ya pasó, primero la marca realizada; con Completa el lead pasa a "calificado".
async function calificar(db, config, { leadId, items, limpiar = false, usuario, ahora = new Date(), env = process.env }) {
  leadId = Number(leadId);
  usuario = R.usuarioValido(config, usuario);
  const lead = (await db.query(`SELECT * FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0];
  if (!lead) throw error(404, 'Lead no encontrado');
  if (!(await hayDeals(db))) throw error(409, 'No está la tabla del Sandler Coach (public.deals): la calificación vive allá.');
  if (D.ETAPAS_DE_ANGIE.includes(lead.etapa)) throw error(409, 'Esta reunión no se hizo (no asistió o se canceló): no hay nada que calificar.');
  if (!limpiar && lead.etapa === 'reunion_agendada' && lead.reunion_at && new Date(lead.reunion_at) > ahora) {
    throw error(409, 'La reunión todavía no ha pasado. Si ya la hiciste, márcala como realizada primero.');
  }
  const avisos = [];
  let dealId = lead.deal_id;
  // Su deal ya no existe o está vacío y el demo quedó en otro deal de la misma empresa: se re-enlaza.
  const re = await reconciliarDeals(db, { leadIds: [leadId] });
  if (re.length) { dealId = re[0].ahora; avisos.push(`Quedó enlazado al deal #${dealId} (el del demo).`); }
  if (dealId && !(await db.query(`SELECT 1 FROM public.deals WHERE id = $1`, [dealId])).rows.length) dealId = null;   // lo borraron
  if (!dealId) {
    dealId = await R.enTransaccion(db, async c => {
      const id = await R.crearDeal(c, lead, {}, lead.reunion_at ? new Date(lead.reunion_at) : null);
      await c.query(`UPDATE ${T.leads} SET deal_id = $2 WHERE id = $1`, [leadId, id]);
      return id;
    });
    avisos.push(`Se creó el deal #${dealId} en el Sandler.`);
  }
  if (!limpiar && lead.etapa === 'reunion_agendada') {
    await R.registrarEjecutiva(db, config, { leadId, accion: 'reunion_realizada', usuario, ahora, env });
    avisos.push('La reunión quedó como realizada.');
  }
  const { label, cal } = await guardarEnDeal(db, dealId, { items, limpiar, usuario, ahora });

  const etapa = (await db.query(`SELECT etapa FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0].etapa;
  if (label === 'Completa' && etapa === 'reunion_realizada') {
    await R.registrarEjecutiva(db, config, { leadId, accion: 'calificado', usuario, ahora, env });
  } else if (label !== 'Completa' && etapa === 'calificado') {
    await R.cambiarEtapa(db, leadId, 'reunion_realizada');
  }
  const final = (await db.query(`SELECT etapa FROM ${T.leads} WHERE id = $1`, [leadId])).rows[0].etapa;
  return { lead_id: leadId, deal_id: dealId, calificacion: label, items: cal.items, fuente: cal.fuente, etapa: final, avisos };
}

// Guarda los chulos en el deal y recalcula calificacion_sandler. Sin marcas y sin demo llenado,
// vuelve a "sin calificar" (null). La usan el tablero (con lead de la SDR) y el embudo (cualquier deal).
async function guardarEnDeal(db, dealId, { items, limpiar = false, usuario = null, ahora = new Date() }) {
  const deal = (await db.query(`SELECT data FROM public.deals WHERE id = $1`, [dealId])).rows[0];
  if (!deal) throw error(404, `El deal #${dealId} ya no existe en el Sandler.`);
  const data = { ...(deal.data || {}) };
  if (limpiar) delete data.calificacionManual;
  else {
    const it = {};
    for (const k of CAL.CLAVES) it[k] = !!(items && items[k]);
    data.calificacionManual = { items: it, por: usuario, at: ahora.toISOString() };
  }
  const cal = CAL.calificacionSandler(data);
  const hayEvidencia = !!data.calificacionManual || !!(data.transcript && String(data.transcript).trim()) || Object.values(cal.formulario).some(Boolean);
  const label = hayEvidencia ? cal.label : null;
  await db.query(
    `UPDATE public.deals SET data = $2::jsonb, calificacion_sandler = $3, executive = COALESCE(NULLIF(executive, ''), $4) WHERE id = $1`,
    [dealId, JSON.stringify(data), label, usuario]);
  return { label, cal };
}

module.exports = { tablero, calificar, guardarEnDeal, hayDeals, reconciliarDeals };

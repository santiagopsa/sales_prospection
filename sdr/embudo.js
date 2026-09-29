// Embudo de la ejecutiva (Sandler Coach → Embudo): los deals por etapa, para moverlos a mano.
//
//   sin_calificar → calificado → propuesta (prueba gratis o cotización) → interesado → ganado
//                                                                        ↘ perdido (con motivo)
//
// La etapa se guarda en public.deals.etapa_embudo. Si un deal no la tiene (los de antes), se deduce:
// ganado/perdido por outcome, propuesta si tiene cotización, calificado si su calificación alcanza
// EMBUDO.minimo_calificado, y si no, sin calificar. Para entrar a "calificado" hay que marcar las 4
// variables Sandler (se guardan igual que en el tablero). Reglas en config.EMBUDO.
const { T } = require('./schema');
const D = require('./dominio');
const CAL = require('./calificacion');
const E = require('./ejecutiva');
const R = require('./resultados');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;

const ETAPAS = [
  { id: 'sin_calificar', label: 'Sin calificar' },
  { id: 'calificado', label: 'Calificados' },
  { id: 'propuesta', label: 'Prueba gratis o cotización' },
  { id: 'interesado', label: 'Interesados' },
  { id: 'ganado', label: 'Ganados' },
  { id: 'perdido', label: 'Perdidos' },
];
const IDS = ETAPAS.map(e => e.id);
const DESPUES_DE_CALIFICAR = ['propuesta', 'interesado', 'ganado'];
const TIPOS_PROPUESTA = { prueba: 'Prueba gratis', cotizacion: 'Cotización' };
const RANGO = { 'no califica': 0, parcial: 1, completa: 2 };

function reglas(config) {
  const e = config.EMBUDO || {};
  return { minimo: e.minimo_calificado || 'Completa', exigir: e.exigir_calificado !== false, diasCerrados: e.dias_cerrados || 60 };
}
function alcanza(config, label) {
  return !!label && (RANGO[String(label).toLowerCase()] ?? -1) >= RANGO[reglas(config).minimo.toLowerCase()];
}

// Las columnas del embudo viven en public.deals (la tabla del Sandler). Se agregan aquí, una vez.
let columnasListas = false;
async function asegurarColumnas(db) {
  if (columnasListas) return true;
  if (!(await E.hayDeals(db))) return false;
  for (const q of [
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS etapa_embudo TEXT`,
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS etapa_embudo_at TIMESTAMPTZ`,
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS propuesta_tipo TEXT`,
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ`,
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS outcome_reason TEXT`,
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`,
    `ALTER TABLE public.deals ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
  ]) await db.query(q);
  columnasListas = true;
  return true;
}

function etapaDe(config, d) {
  if (d.outcome === 'won') return 'ganado';
  if (d.outcome === 'lost') return 'perdido';
  if (d.etapa_embudo && IDS.includes(d.etapa_embudo)) return d.etapa_embudo;
  if (d.quoted_at || d.quoted_ms) return 'propuesta';
  return alcanza(config, d.calificacion_sandler) ? 'calificado' : 'sin_calificar';
}

async function tablero(db, config, { ahora = new Date() } = {}) {
  if (!(await asegurarColumnas(db))) return { etapas: ETAPAS, columnas: {}, conteo: {}, sin_tabla: true };
  const r = reglas(config);
  const desde = new Date(ahora.getTime() - r.diasCerrados * 86400000).toISOString();
  const q = await db.query(
    `SELECT d.id, d.company, d.executive, d.canal_adquisicion, d.freelancer_nombre, d.calificacion_sandler, d.outcome, d.outcome_reason,
            d.etapa_embudo, d.propuesta_tipo,
            -- Solo los campos que usa la calificación (data trae el transcript completo del demo).
            jsonb_build_object('dolor', d.data->'dolor', 'dolorCuantificar', d.data->'dolorCuantificar', 'dolorHistoria', d.data->'dolorHistoria',
              'dolorImpacto', d.data->'dolorImpacto', 'presupuesto', d.data->'presupuesto', 'decisor', d.data->'decisor',
              'procesoDecision', d.data->'procesoDecision', 'fechaLimiteDecision', d.data->'fechaLimiteDecision',
              'calificacionManual', d.data->'calificacionManual') AS data,
            ${ms('d.quoted_at')} AS quoted_ms, ${ms('d.closed_at')} AS closed_ms, ${ms('d.created_at')} AS created_ms,
            ${ms('COALESCE(d.etapa_embudo_at, d.closed_at, d.quoted_at, d.created_at)')} AS etapa_ms,
            l.id AS lead_id, l.contacto, l.cargo, l.telefono, l.email, l.etapa AS lead_etapa, ${ms('l.reunion_at')} AS reunion_ms
     FROM public.deals d
     LEFT JOIN LATERAL (SELECT * FROM ${T.leads} x WHERE x.deal_id = d.id ORDER BY x.id LIMIT 1) l ON true
     WHERE COALESCE(d.outcome, 'open') NOT IN ('won', 'lost') OR d.closed_at >= $1 OR d.closed_at IS NULL
     ORDER BY d.created_at DESC`, [desde]);
  const columnas = Object.fromEntries(IDS.map(id => [id, []]));
  for (const d of q.rows) {
    const etapa = etapaDe(config, d);
    // Deal de la SDR cuya reunión no se hizo (no asistió / canceló): vuelve a ser de la SDR y no
    // ocupa el embudo hasta que se reagende. Si ya tiene calificación o etapa, sí se queda.
    if (d.lead_id && D.ETAPAS_DE_ANGIE.includes(d.lead_etapa) && etapa === 'sin_calificar' && !d.etapa_embudo) continue;
    const cal = CAL.calificacionSandler(d.data || {});
    columnas[etapa].push({
      deal_id: d.id, empresa: d.company, contacto: d.contacto || null, cargo: d.cargo || null, telefono: d.telefono || null,
      ejecutiva: d.executive, canal: d.canal_adquisicion, trajo: d.freelancer_nombre,
      calificacion: d.calificacion_sandler, items: cal.items, n: CAL.CLAVES.filter(k => cal.items[k]).length,
      propuesta_tipo: d.propuesta_tipo || (d.quoted_ms ? 'cotizacion' : null), motivo: d.outcome_reason,
      lead_id: d.lead_id, reunion_ms: d.reunion_ms, reunion_pendiente: !!(d.lead_id && d.lead_etapa === 'reunion_agendada' && d.reunion_ms && d.reunion_ms > ahora.getTime()),
      dias_en_etapa: Math.max(0, Math.floor((ahora.getTime() - d.etapa_ms) / 86400000)), created_ms: d.created_ms,
    });
  }
  // Dentro de cada columna: lo que lleva más tiempo quieto arriba (ganados/perdidos: lo más reciente).
  for (const id of IDS) columnas[id].sort((a, b) => (['ganado', 'perdido'].includes(id) ? a.dias_en_etapa - b.dias_en_etapa : b.dias_en_etapa - a.dias_en_etapa));
  const conteo = Object.fromEntries(IDS.map(id => [id, columnas[id].length]));
  const ejecutiva = ((config.USUARIOS || []).find(u => u.rol === 'ejecutiva') || {}).nombre || null;
  const sdr = ((config.USUARIOS || []).find(u => u.rol === 'sdr') || {}).nombre || null;
  return { etapas: ETAPAS, columnas, conteo, reglas: r, criterios: CAL.CRITERIOS, tipos_propuesta: TIPOS_PROPUESTA, ejecutiva, sdr };
}

async function leerDeal(db, dealId) {
  const d = (await db.query(`SELECT * FROM public.deals WHERE id = $1`, [dealId])).rows[0];
  if (!d) throw error(404, `No existe el deal #${dealId}`);
  return d;
}

// Marcar las 4 variables de un deal. Con lead de la SDR va por el mismo camino del tablero (marca la
// reunión realizada y el lead calificado); sin lead, solo el deal.
async function calificar(db, config, { dealId, items, usuario, ahora = new Date(), env = process.env }) {
  dealId = Number(dealId);
  await asegurarColumnas(db);
  const d = await leerDeal(db, dealId);
  const lead = (await db.query(`SELECT id, etapa FROM ${T.leads} WHERE deal_id = $1 ORDER BY id LIMIT 1`, [dealId])).rows[0];
  let label, avisos = [];
  if (lead && !D.ETAPAS_DE_ANGIE.includes(lead.etapa) && lead.etapa !== 'descartado') {
    const r = await E.calificar(db, config, { leadId: lead.id, items, usuario, ahora, env });
    label = r.calificacion; avisos = r.avisos;
  } else {
    ({ label } = await E.guardarEnDeal(db, dealId, { items, usuario: R.usuarioValido(config, usuario), ahora }));
  }
  // La etapa sigue a la calificación mientras el deal esté al principio del embudo.
  const etapa = etapaDe(config, d);
  let nueva = etapa;
  if (etapa === 'sin_calificar' && alcanza(config, label)) nueva = 'calificado';
  if (etapa === 'calificado' && !alcanza(config, label)) nueva = 'sin_calificar';
  if (nueva !== etapa) await ponerEtapa(db, dealId, d, nueva, usuario, ahora);
  if (!alcanza(config, label)) avisos.push(`Quedó ${label || 'sin calificar'}: para "Calificados" ${reglas(config).minimo === 'Completa' ? 'se necesitan las 4 variables' : 'se necesita al menos Parcial'}.`);
  return { deal_id: dealId, calificacion: label, etapa: nueva, avisos };
}

async function ponerEtapa(db, dealId, d, etapa, usuario, ahora, extra = {}) {
  // El historial se agrega en la base (jsonb) para no pisar lo que otra operación acaba de guardar en data.
  const paso = { de: etapaDeFila(d), a: etapa, por: usuario || null, at: ahora.toISOString(), ...extra };
  await db.query(
    `UPDATE public.deals SET etapa_embudo = $2, etapa_embudo_at = $3,
       data = jsonb_set(COALESCE(data, '{}'::jsonb), '{embudoHistorial}', COALESCE(data->'embudoHistorial', '[]'::jsonb) || $4::jsonb)
     WHERE id = $1`,
    [dealId, etapa, ahora.toISOString(), JSON.stringify([paso])]);
}
const etapaDeFila = d => d.etapa_embudo || (d.outcome === 'won' ? 'ganado' : d.outcome === 'lost' ? 'perdido' : null);

// Mover un deal de etapa. propuesta pide tipo (prueba | cotizacion); ganado y perdido piden motivo.
async function mover(db, config, { dealId, etapa, tipo, motivo, usuario, ahora = new Date() }) {
  dealId = Number(dealId);
  if (!IDS.includes(etapa)) throw error(400, 'Etapa desconocida');
  await asegurarColumnas(db);
  usuario = R.usuarioValido(config, usuario);
  const d = await leerDeal(db, dealId);
  const r = reglas(config);
  if (etapa === 'calificado' && !alcanza(config, d.calificacion_sandler)) {
    throw error(409, `Para pasar a "Calificados" marca primero las variables (${r.minimo === 'Completa' ? 'las 4' : 'al menos 2'}).`);
  }
  if (r.exigir && DESPUES_DE_CALIFICAR.includes(etapa) && !alcanza(config, d.calificacion_sandler)) {
    throw error(409, `Este deal no está calificado (${d.calificacion_sandler || 'sin calificar'}): califícalo antes de avanzarlo.`);
  }
  if (etapa === 'propuesta' && !TIPOS_PROPUESTA[tipo]) throw error(400, 'Elige si es prueba gratis o cotización');
  if ((etapa === 'ganado' || etapa === 'perdido') && !String(motivo || '').trim()) throw error(400, 'Escribe el motivo');

  const sets = [], params = [dealId];
  const set = (col, v) => { params.push(v); sets.push(`${col} = $${params.length}`); };
  if (etapa === 'propuesta') {
    set('propuesta_tipo', tipo);
    if (tipo === 'cotizacion' && !d.quoted_at) set('quoted_at', ahora.toISOString());
  }
  if (etapa === 'ganado' || etapa === 'perdido') {
    set('outcome', etapa === 'ganado' ? 'won' : 'lost'); set('outcome_reason', String(motivo).trim()); set('closed_at', ahora.toISOString());
  } else if (d.outcome === 'won' || d.outcome === 'lost') {
    set('outcome', 'open'); set('outcome_reason', null); set('closed_at', null);   // se reabre
  }
  if (sets.length) await db.query(`UPDATE public.deals SET ${sets.join(', ')} WHERE id = $1`, params);
  await ponerEtapa(db, dealId, d, etapa, usuario, ahora, etapa === 'propuesta' ? { tipo } : motivo ? { motivo: String(motivo).trim() } : {});
  return { deal_id: dealId, etapa };
}

module.exports = { ETAPAS, tablero, calificar, mover, etapaDe, alcanza, _reiniciar: () => { columnasListas = false; } };

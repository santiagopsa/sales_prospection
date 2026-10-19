// Pruebas: de la bandera de Wei al embudo de Luisa.
//
// Algunos clientes empiezan con una prueba. Wei la marca en Operaciones (columna "Prueba" de
// Procesos, SaaS o Evaluaciones, en /verificacion) y Luisa la lleva en su embudo:
//
//   Prueba gratis → Cotización → (Interesados) → Ganado
//                                              ↘ Perdido
//
// Aquí se responde la pregunta de Luisa: ¿cuáles pruebas se van convirtiendo en clientes? Un deal
// "fue prueba" si alguna vez estuvo en "Prueba gratis" (deals.prueba_at, o el historial del embudo
// para los de antes de esa columna). De cada uno se sabe dónde está hoy, cuánto lleva y qué está
// haciendo Wei con esa empresa (lo que marcó en prueba en Operaciones). Las pruebas que Wei tiene
// marcadas y no tienen deal en prueba salen aparte: es lo que Luisa todavía no está siguiendo.
//
// Solo lectura sobre lo de Wei: el esquema de verificación se lee, nunca se escribe desde aquí.
const LN = require('./listanegra');

const DIA = 86400000;
const OPS = {
  procesos:     { producto: 'Headhunting',  empresa: 'empresa', estado: 'etapa' },
  saas:         { producto: 'SaaS',         empresa: 'cliente', estado: 'estado' },
  evaluaciones: { producto: 'Evaluaciones', empresa: 'empresa', estado: 'estado' },
};
const esquemaVerif = () => (process.env.VERIF_SCHEMA || 'verificacion').replace(/[^a-z0-9_]/gi, '');

function reglas(config) {
  const e = config.EMBUDO || {};
  return { alertaDias: e.prueba_alerta_dias || 14 };
}

// Dos nombres son la misma empresa si normalizados coinciden, o uno es el otro con más palabras
// ("Alpina" = "Alpina Productos Alimenticios"). Así se cruza lo de Wei con los deals de Luisa.
function mismaEmpresa(a, b) {
  if (!a || !b) return false;
  return a === b || a.startsWith(b + ' ') || b.startsWith(a + ' ');
}

// Lo que Wei tiene marcado en prueba, de las tres tablas de Operaciones. Si el módulo de
// verificación no está (o todavía no tiene la columna), devuelve [] sin fallar.
async function operacionEnPrueba(db) {
  const out = [];
  const sch = esquemaVerif();
  for (const [tipo, m] of Object.entries(OPS)) {
    const tabla = `${sch}.ops_${tipo}`;
    const existe = (await db.query(`SELECT to_regclass($1) IS NOT NULL AS ok`, [tabla])).rows[0].ok;
    if (!existe) continue;
    // to_jsonb(o.*): si la columna "prueba" aún no existe, la consulta igual corre (y no trae nada).
    const r = await db.query(`SELECT to_jsonb(o.*) AS f FROM ${tabla} o WHERE (to_jsonb(o.*)->>'prueba') = 'true'`);
    for (const { f } of r.rows) {
      const empresa = f[m.empresa] || '';
      out.push({
        tipo, producto: m.producto, id: f.id, empresa, clave: LN.normalizarEmpresa(empresa),
        cargo: f.cargo || '', estado: f[m.estado] || '', activado: f.activado || null,
        primer_envio: f.primer_envio || null, ultimo_envio: f.ultimo_envio || null,
        destacados: f.destacados ?? null, meta: f.meta ?? null, evaluados: f.evaluados ?? null,
        fecha_cierre: f.fecha_cierre || null,
      });
    }
  }
  return out;
}
const deEmpresa = (ops, nombre) => { const k = LN.normalizarEmpresa(nombre); return k ? ops.filter(o => mismaEmpresa(o.clave, k)) : []; };

// Cuándo empezó la prueba y cuándo pasó a cotización, desde las columnas o el historial.
function hitos(d) {
  const hist = Array.isArray(d.historial) ? d.historial : [];
  const t = x => (x && x.at ? new Date(x.at).getTime() : null);
  const pasoPrueba = hist.find(p => p.a === 'propuesta' && p.tipo === 'prueba');
  const inicio = d.prueba_ms || t(pasoPrueba) || (d.propuesta_tipo === 'prueba' ? d.etapa_ms : null) || d.created_ms;
  const pasoCot = hist.find(p => p.a === 'propuesta' && p.tipo === 'cotizacion' && t(p) >= inicio);
  let cotizada = t(pasoCot);
  if (!cotizada && d.quoted_ms && d.quoted_ms >= inicio) cotizada = d.quoted_ms;
  return { inicio, cotizada };
}

const mediana = xs => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : Math.round((a[m - 1] + a[m]) / 2); };
const pct = (a, b) => (b ? Math.round(100 * a / b) : null);

// El resumen que ve Luisa arriba del embudo. `etapaDe` viene del embudo (sin require circular).
async function resumen(db, config, { ahora = new Date(), etapaDe, ops = null } = {}) {
  const r = reglas(config);
  const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;
  const q = await db.query(
    `SELECT d.id, d.company, d.outcome, d.outcome_reason, d.etapa_embudo, d.propuesta_tipo, d.productos, d.calificacion_sandler,
            ${ms('d.prueba_at')} AS prueba_ms, ${ms('d.quoted_at')} AS quoted_ms, ${ms('d.closed_at')} AS closed_ms,
            ${ms('COALESCE(d.etapa_embudo_at, d.closed_at, d.quoted_at, d.created_at)')} AS etapa_ms, ${ms('d.created_at')} AS created_ms,
            d.data->'embudoHistorial' AS historial
     FROM public.deals d
     WHERE d.prueba_at IS NOT NULL OR d.propuesta_tipo = 'prueba'
        OR COALESCE(d.data->'embudoHistorial', '[]'::jsonb) @> '[{"tipo":"prueba"}]'::jsonb
     ORDER BY d.id DESC`);
  if (!ops) { try { ops = await operacionEnPrueba(db); } catch (e) { ops = []; } }
  const hoy = ahora.getTime();
  const pruebas = q.rows.map(d => {
    const etapa = etapaDe(config, d);
    const estado = etapa === 'propuesta' ? (d.propuesta_tipo === 'prueba' ? 'prueba' : 'cotizacion') : etapa;
    const h = hitos(d);
    const dias = (a, b) => (a && b ? Math.max(0, Math.round((b - a) / DIA)) : null);
    return {
      deal_id: d.id, empresa: d.company, estado, motivo: d.outcome_reason || null,
      productos: d.productos ? d.productos.split(',').map(x => x.trim()).filter(Boolean) : [],
      inicio_ms: h.inicio, cotizada_ms: h.cotizada, cerrada_ms: ['ganado', 'perdido'].includes(estado) ? d.closed_ms : null,
      dias_en_prueba: estado === 'prueba' ? dias(h.inicio, hoy) : null,
      dias_quieta: estado === 'prueba' ? dias(d.etapa_ms, hoy) : null,
      quieta: estado === 'prueba' && dias(d.etapa_ms, hoy) >= r.alertaDias,
      dias_a_cotizacion: dias(h.inicio, h.cotizada),
      dias_a_cliente: estado === 'ganado' ? dias(h.inicio, d.closed_ms) : null,
      llego_a_cotizacion: !!h.cotizada || ['cotizacion', 'interesado', 'ganado'].includes(estado),
      operacion: deEmpresa(ops, d.company),
    };
  });
  // Lo que Wei tiene en prueba y Luisa no está siguiendo: empresas sin deal en prueba. Si la
  // empresa tiene un deal abierto en otra etapa, se dice cuál, para pasarlo a prueba de un clic.
  const conDeal = new Set(pruebas.map(p => LN.normalizarEmpresa(p.empresa)).filter(Boolean));
  const sueltas = {};
  for (const o of ops) {
    if (!o.clave || [...conDeal].some(k => mismaEmpresa(k, o.clave))) continue;
    (sueltas[o.clave] = sueltas[o.clave] || { empresa: o.empresa, operacion: [] }).operacion.push(o);
  }
  const sin_deal = Object.entries(sueltas).map(([clave, x]) => ({ clave, ...x, deal: null }));
  if (sin_deal.length) {
    const ds = (await db.query(
      `SELECT d.id, d.company, d.outcome, d.etapa_embudo, d.propuesta_tipo, d.calificacion_sandler,
              ${ms('d.quoted_at')} AS quoted_ms, ${ms('d.created_at')} AS created_ms
       FROM public.deals d WHERE COALESCE(d.outcome, 'open') NOT IN ('won', 'lost') ORDER BY d.id DESC`)).rows;
    for (const s of sin_deal) {
      const d = ds.find(x => mismaEmpresa(LN.normalizarEmpresa(x.company), s.clave));
      if (d) s.deal = { deal_id: d.id, empresa: d.company, etapa: etapaDe(config, d) };
    }
  }
  const ganadas = pruebas.filter(p => p.estado === 'ganado'), perdidas = pruebas.filter(p => p.estado === 'perdido');
  const cotizadas = pruebas.filter(p => p.llego_a_cotizacion);
  const orden = { prueba: 0, cotizacion: 1, interesado: 2, calificado: 3, sin_calificar: 3, ganado: 4, perdido: 5 };
  pruebas.sort((a, b) => (orden[a.estado] ?? 9) - (orden[b.estado] ?? 9) || (b.dias_quieta || 0) - (a.dias_quieta || 0) || (b.inicio_ms || 0) - (a.inicio_ms || 0));
  return {
    total: pruebas.length,
    en_prueba: pruebas.filter(p => p.estado === 'prueba').length,
    quietas: pruebas.filter(p => p.quieta).length,
    a_cotizacion: { n: cotizadas.length, pct: pct(cotizadas.length, pruebas.length) },
    a_cliente: { n: ganadas.length, pct: pct(ganadas.length, pruebas.length) },
    // De las que ya se resolvieron, cuántas terminaron en cliente: la tasa que no castiga las que van.
    conversion_cerradas: { n: ganadas.length, de: ganadas.length + perdidas.length, pct: pct(ganadas.length, ganadas.length + perdidas.length) },
    perdidas: perdidas.length,
    mediana_dias_a_cliente: mediana(ganadas.map(p => p.dias_a_cliente).filter(x => x != null)),
    mediana_dias_a_cotizacion: mediana(cotizadas.map(p => p.dias_a_cotizacion).filter(x => x != null)),
    alerta_dias: r.alertaDias,
    pruebas, sin_deal,
  };
}

module.exports = { operacionEnPrueba, deEmpresa, resumen, hitos, mismaEmpresa, OPS };

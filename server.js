// Peaku Sandler - Server
// (Historial: detalle de deal, eliminación de registros, campos faltantes)
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// El transcript de un demo largo puede ser 40-80 KB. El margen grande es por
// /verificacion: ahí los archivos suben en base64, que engorda un tercio.
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Claude (Anthropic) ---
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
if (!anthropic) console.warn('[llm] ANTHROPIC_API_KEY no está seteada — /api/analyze devolverá error');
// Modelo del análisis. Configurable por env para poder comparar (Opus vs Sonnet).
// Default: Opus (razonamiento más profundo para inferir la objeción/indecisión subyacente).
const ANALYZE_MODEL = process.env.ANALYZE_MODEL || 'claude-opus-4-8';
console.log('[llm] modelo de análisis:', ANALYZE_MODEL);

// --- DB ---
const useDb = !!process.env.DATABASE_URL;
let pool = null;
let dbReady = false; // se pone true cuando initSchema termina OK
let dbLastError = null;

if (useDb) {
  // Render Postgres: interno no requiere SSL, externo sí. Detectamos por hostname.
  const url = process.env.DATABASE_URL || '';
  const isRenderInternal = /\.internal(:\d+)?\//.test(url) || url.includes('.oregon-postgres.') === false && url.includes('render.com') === false && url.includes('.internal');
  // Regla simple: si la URL trae sslmode=require, dejamos que pg lo maneje.
  // Si no, forzamos SSL con rejectUnauthorized:false en producción.
  const forceSsl = process.env.PGSSL === '1' || (process.env.NODE_ENV === 'production' && !isRenderInternal);
  pool = new Pool({
    connectionString: url,
    ssl: forceSsl ? { rejectUnauthorized: false } : false,
    // Timeouts para que las queries no se cuelguen para siempre
    connectionTimeoutMillis: 8000,
    idleTimeoutMillis: 30000,
    max: 5,
  });
  pool.on('error', (err) => {
    dbLastError = err.message;
    console.error('[db] pool error:', err.message);
  });
}

// Fallback en memoria si no hay DB (útil para correr local sin Postgres)
const memory = { deals: [], wishlist: [] };

async function initSchema() {
  if (!pool) return;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS deals (
      id SERIAL PRIMARY KEY,
      executive TEXT,
      company TEXT,
      segment TEXT,
      has_ats BOOLEAN,
      data JSONB NOT NULL,
      score_fundamentals INT,
      score_nice_to_have INT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  // Migraciones incrementales — se ejecutan seguras aunque la columna ya exista.
  const alters = [
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS linea_negocio TEXT`,          // SaaS / Headhunting / EOR
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS calificacion_sandler TEXT`,   // Completa / Parcial / No califica
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS fecha_limite_decision DATE`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS quoted_at TIMESTAMPTZ`,        // cuándo se envió la cotización
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS outcome TEXT`,                 // open / won / lost
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS outcome_reason TEXT`,          // motivo real ganada/perdida
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`,
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS canal_adquisicion TEXT`,   // freelancer / sdr_interno / inbound / referido / evento / outbound / otro
    `ALTER TABLE deals ADD COLUMN IF NOT EXISTS freelancer_nombre TEXT`,   // quién específicamente lo trajo
  ];
  for (const q of alters) {
    try { await pool.query(q); } catch (e) { console.error('[db] migration warn:', e.message); }
  }
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wishlist (
      id SERIAL PRIMARY KEY,
      deal_id INT REFERENCES deals(id) ON DELETE SET NULL,
      segment TEXT,
      item TEXT NOT NULL,
      we_have BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  dbReady = true;
  console.log('[db] schema ready');
}

// --- Helpers ---
function has(s) { return !!(s && String(s).trim()); }
// Embudo del dolor: cuantificar / historia / impacto. Se cuenta como "dolor desarrollado" con >=2 de 3.
function painFunnelOk(d) {
  const c = has(d.dolorCuantificar);
  const h = has(d.dolorHistoria);
  const i = has(d.dolorImpacto);
  const n = [c, h, i].filter(Boolean).length;
  return { c, h, i, count: n, ok: n >= 2 };
}
// Calificación Sandler: Completa requiere dolor desarrollado + presupuesto + decisión + fecha límite.
// La regla vive en sdr/calificacion.js (la usa también el tablero de la ejecutiva en /sdr, donde se
// pueden marcar los criterios a mano: data.calificacionManual manda sobre el formulario).
const CALIFICACION = require('./sdr/calificacion');
function calificacionSandler(d) { return CALIFICACION.calificacionSandler(d); }
function scoreDeal(d) {
  // Fundamentales del nuevo proceso: contrato previo, segmentación, dolor desarrollado (embudo 2/3),
  // presupuesto, decisor, proceso de decisión, fecha límite de decisión.
  const pf = painFunnelOk(d);
  // Con veredicto de la IA por criterio (demos nuevos), dolor / presupuesto / fecha son el veredicto,
  // no "el campo tiene texto" (el texto puede decir "no hay presupuesto, es para 2027").
  const cal = calificacionSandler(d);
  const v = cal.con_ia ? cal.formulario : null;
  const fundamentals = {
    contratoPrevio: has(d.contratoPrevio),
    fichaPrevia: has(d.fichaCargos) || has(d.fichaCosto) || has(d.fichaHerramientas), // contrato previo N°1
    segmentacion: !!(d.segment),
    dolorDesarrollado: v ? v.dolor : pf.ok, // >=2 de 3 del embudo
    presupuesto: v ? v.presupuesto : has(d.presupuesto),
    decisor: has(d.decisor),
    procesoDecision: v ? v.decision : has(d.procesoDecision),
    fechaLimiteDecision: v ? v.fecha : has(d.fechaLimiteDecision),
  };
  // Nice to have: vínculo, consecuencias emocionales, cotización piloto, post-venta, etc.
  // "integraciones" solo es relevante si el cliente es grande (C) o ya tiene ATS.
  const integracionesRelevante = d.segment === 'C' || !!d.hasAts;
  const niceToHave = {
    vinculo: has(d.vinculo),
    consecuenciasEmocionales: has(d.consecuenciasEmocionales),
    medicion: has(d.medicion),
    ...(integracionesRelevante ? { integraciones: has(d.integraciones) } : {}),
    postVenta: has(d.postVenta),
    proximoPaso: has(d.proximoPaso),
    piloto: has(d.pilotoCargo) && has(d.pilotoFechaRevision), // NEW
  };
  const fundOk = Object.values(fundamentals).filter(Boolean).length;
  const nthOk = Object.values(niceToHave).filter(Boolean).length;
  return {
    fundamentals,
    niceToHave,
    fundamentalsPct: Math.round((fundOk / Object.keys(fundamentals).length) * 100),
    niceToHavePct: Math.round((nthOk / Object.keys(niceToHave).length) * 100),
    calificacion: cal, // { label, done, of, pf }
  };
}

// --- API ---
app.post('/api/deals', async (req, res) => {
  try {
    const d = req.body || {};
    const s = scoreDeal(d);
    const fechaLim = (d.fechaLimiteDecision && String(d.fechaLimiteDecision).match(/^\d{4}-\d{2}-\d{2}$/)) ? d.fechaLimiteDecision : null;
    const quotedAt = d.quotedAt || null; // se setea después al cambiar estado
    if (pool) {
      const r = await pool.query(
        `INSERT INTO deals (
           executive, company, segment, has_ats, data,
           score_fundamentals, score_nice_to_have,
           linea_negocio, calificacion_sandler, fecha_limite_decision, quoted_at, outcome
         )
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         RETURNING id, created_at`,
        [
          d.executive || null, d.company || null, d.segment || null, !!d.hasAts, d,
          s.fundamentalsPct, s.niceToHavePct,
          d.lineaNegocio || null, s.calificacion.label, fechaLim, quotedAt, 'open'
        ]
      );
      // Guardar items del wishlist (lo que el cliente pidió en su ideal)
      if (Array.isArray(d.idealRequests)) {
        for (const item of d.idealRequests) {
          if (item && item.text) {
            await pool.query(
              `INSERT INTO wishlist (deal_id, segment, item, we_have) VALUES ($1,$2,$3,$4)`,
              [r.rows[0].id, d.segment || null, item.text, !!item.weHave]
            );
          }
        }
      }
      return res.json({ ok: true, id: r.rows[0].id, score: s });
    } else {
      const id = memory.deals.length + 1;
      memory.deals.push({ id, ...d, createdAt: new Date().toISOString(), score: s });
      if (Array.isArray(d.idealRequests)) {
        for (const item of d.idealRequests) {
          if (item && item.text) {
            memory.wishlist.push({ id: memory.wishlist.length + 1, dealId: id, segment: d.segment, item: item.text, weHave: !!item.weHave });
          }
        }
      }
      return res.json({ ok: true, id, score: s });
    }
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Completar un deal que creó el SDR (/sdr) al agendar la reunión: la ejecutiva lo "toma" en el
// asistente y al terminar se actualiza ESTA fila (misma lógica de score que el POST), sin crear otra.
app.put('/api/deals/:id/completar', async (req, res) => {
  try {
    const id = Number(req.params.id);
    let d = req.body || {};
    delete d.sdrDealId;
    if (!pool) return res.status(503).json({ ok: false, error: 'sin base de datos' });
    // Conserva los criterios que la ejecutiva marcó a mano en el tablero de /sdr.
    const guardado = await pool.query(`SELECT data FROM deals WHERE id=$1`, [id]);
    if (guardado.rows.length) d = CALIFICACION.fusionarAlCompletar(d, guardado.rows[0].data || {});
    const s = scoreDeal(d);
    const fechaLim = (d.fechaLimiteDecision && String(d.fechaLimiteDecision).match(/^\d{4}-\d{2}-\d{2}$/)) ? d.fechaLimiteDecision : null;
    const r = await pool.query(
      `UPDATE deals SET executive=$1, company=$2, segment=$3, has_ats=$4, data=$5,
         score_fundamentals=$6, score_nice_to_have=$7, linea_negocio=$8, calificacion_sandler=$9, fecha_limite_decision=$10,
         canal_adquisicion=COALESCE(canal_adquisicion, $11), freelancer_nombre=COALESCE(freelancer_nombre, $12)
       WHERE id=$13 RETURNING id`,
      [d.executive || null, d.company || null, d.segment || null, !!d.hasAts, d, s.fundamentalsPct, s.niceToHavePct,
       d.lineaNegocio || null, s.calificacion.label, fechaLim, d.canalAdquisicion || null, d.freelancerNombre || null, id]);
    if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
    await pool.query(`DELETE FROM wishlist WHERE deal_id=$1`, [id]);
    if (Array.isArray(d.idealRequests)) {
      for (const item of d.idealRequests) {
        if (item && item.text) await pool.query(`INSERT INTO wishlist (deal_id, segment, item, we_have) VALUES ($1,$2,$3,$4)`, [id, d.segment || null, item.text, !!item.weHave]);
      }
    }
    return res.json({ ok: true, id, score: s });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Un demo que se guardó en el deal equivocado (el asistente tenía otro deal "tomado" y se pegó la
// transcripción de otra empresa). Se saca el demo de este deal y va a un deal nuevo, a otro deal
// existente o se descarta. Lo que es de la ficha del SDR (empresa, contacto, línea, chulos del
// tablero, cotización) se queda; lo del demo (transcripción, extracción, embudo del dolor, wishlist…)
// se mueve.
const CAMPOS_FICHA = ['company', 'executive', 'lineaNegocio', 'canalAdquisicion', 'freelancerNombre', 'prospActitud', 'prospUrgencia', 'prospOrigen',
  'fichaCargos', 'fichaCosto', 'fichaHerramientas', 'fichaAdicional', 'calificacionManual', 'embudoHistorial', 'cotizacion', 'cotizacionAnalisis'];
function partirDemo(data) {
  const ficha = {}, demo = {};
  for (const [k, v] of Object.entries(data || {})) (CAMPOS_FICHA.includes(k) ? ficha : demo)[k] = v;
  return { ficha, demo };
}
app.post('/api/deals/:id/demo/mover', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { destino, company } = req.body || {};
    if (!pool) return res.status(503).json({ ok: false, error: 'sin base de datos' });
    const src = (await pool.query(`SELECT * FROM deals WHERE id=$1`, [id])).rows[0];
    if (!src) return res.status(404).json({ ok: false, error: 'not found' });
    const { ficha, demo } = partirDemo(src.data || {});
    if (!has(demo.transcript) && !demo.iaExtracted) return res.status(400).json({ ok: false, error: 'Este deal no tiene demo que mover' });
    const guardarDeal = async (dealId, data) => {
      const s = scoreDeal(data);
      const fechaLim = (data.fechaLimiteDecision && String(data.fechaLimiteDecision).match(/^\d{4}-\d{2}-\d{2}$/)) ? data.fechaLimiteDecision : null;
      // Sin demo, la calificación que queda es la de los chulos del tablero (si los hay).
      const cal = has(data.transcript) || data.iaExtracted ? s.calificacion.label
        : (data.calificacionManual && Object.values(data.calificacionManual.items || {}).some(Boolean) ? CALIFICACION.calificacionSandler(data).label : null);
      await pool.query(
        `UPDATE deals SET company=$1, segment=$2, has_ats=$3, data=$4, score_fundamentals=$5, score_nice_to_have=$6, linea_negocio=$7,
           calificacion_sandler=$8, fecha_limite_decision=$9 WHERE id=$10`,
        [data.company || null, data.segment || null, !!data.hasAts, data, s.fundamentalsPct, s.niceToHavePct, data.lineaNegocio || null, cal, fechaLim, dealId]);
      await pool.query(`DELETE FROM wishlist WHERE deal_id=$1`, [dealId]);
      for (const item of (Array.isArray(data.idealRequests) ? data.idealRequests : [])) {
        if (item && item.text) await pool.query(`INSERT INTO wishlist (deal_id, segment, item, we_have) VALUES ($1,$2,$3,$4)`, [dealId, data.segment || null, item.text, !!item.weHave]);
      }
      return s;
    };
    let destinoId = null;
    if (destino === 'nuevo') {
      if (!has(company)) return res.status(400).json({ ok: false, error: 'Falta el nombre de la empresa del deal nuevo' });
      const data = { ...demo, company: String(company).trim(), executive: ficha.executive || src.executive || '', lineaNegocio: demo.lineaNegocio || ficha.lineaNegocio || '' };
      const s = scoreDeal(data);
      const r = await pool.query(
        `INSERT INTO deals (executive, company, segment, has_ats, data, score_fundamentals, score_nice_to_have, linea_negocio, calificacion_sandler, outcome)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'open') RETURNING id`,
        [data.executive || null, data.company, data.segment || null, !!data.hasAts, data, s.fundamentalsPct, s.niceToHavePct, data.lineaNegocio || null, s.calificacion.label]);
      destinoId = r.rows[0].id;
      await guardarDeal(destinoId, data);
    } else if (Number.isInteger(Number(destino)) && Number(destino) > 0) {
      destinoId = Number(destino);
      if (destinoId === id) return res.status(400).json({ ok: false, error: 'El destino es el mismo deal' });
      const dst = (await pool.query(`SELECT * FROM deals WHERE id=$1`, [destinoId])).rows[0];
      if (!dst) return res.status(404).json({ ok: false, error: `No existe el deal #${destinoId}` });
      const dd = dst.data || {};
      if (has(dd.transcript)) return res.status(400).json({ ok: false, error: `El deal #${destinoId} ya tiene un demo; sácalo primero` });
      // Los chulos que la ejecutiva marcó a mano en el destino se conservan (misma regla que al completar).
      const data = CALIFICACION.fusionarAlCompletar({ ...dd, ...demo, company: dd.company || dst.company, executive: dd.executive || dst.executive || demo.executive || '' }, dd);
      await guardarDeal(destinoId, data);
    } else if (destino !== 'descartar') {
      return res.status(400).json({ ok: false, error: 'destino debe ser "nuevo", "descartar" o el id de otro deal' });
    }
    // El deal de origen vuelve a ser la ficha del SDR, sin demo.
    await guardarDeal(id, { ...ficha, company: ficha.company || src.company, idealRequests: [], qualif: {} });
    return res.json({ ok: true, origen: id, destino: destinoId });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/deals', async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query(`
        SELECT id, executive, company, segment, has_ats,
               score_fundamentals, score_nice_to_have,
               linea_negocio, calificacion_sandler,
               fecha_limite_decision, quoted_at, outcome, outcome_reason, closed_at,
               canal_adquisicion, freelancer_nombre, created_at,
               (to_jsonb(deals.*)->>'productos') AS productos
        FROM deals ORDER BY created_at DESC LIMIT 500`);
      return res.json(r.rows);
    }
    return res.json(memory.deals.slice().reverse().map(d => ({
      id: d.id, executive: d.executive, company: d.company, segment: d.segment,
      has_ats: d.hasAts, score_fundamentals: d.score.fundamentalsPct,
      score_nice_to_have: d.score.niceToHavePct,
      linea_negocio: d.lineaNegocio || null,
      calificacion_sandler: d.score.calificacion && d.score.calificacion.label,
      fecha_limite_decision: d.fechaLimiteDecision || null,
      quoted_at: d.quotedAt || null,
      outcome: d.outcome || 'open',
      outcome_reason: d.outcomeReason || null,
      closed_at: d.closedAt || null,
      created_at: d.createdAt
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Actualizar outcome (won/lost) o marcar cotización enviada
app.patch('/api/deals/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { outcome, outcome_reason, quoted_at, productos } = req.body || {};
    // Ganado exige la línea (o líneas) que se vendieron: SaaS, Headhunting, EOR, Evaluaciones.
    const PRODUCTOS = (require('./sdr/config').EMBUDO || {}).productos || ['SaaS', 'Headhunting', 'EOR', 'Evaluaciones'];
    const prods = Array.isArray(productos) ? productos.filter(x => PRODUCTOS.includes(x)) : null;
    if (outcome === 'won' && !(prods && prods.length)) return res.status(400).json({ ok: false, error: 'Marca qué se vendió: ' + PRODUCTOS.join(', ') });
    if (pool) {
      const parts = [], vals = [];
      if (outcome) { vals.push(outcome); parts.push(`outcome=$${vals.length}`); }
      if (prods && prods.length) { try { await pool.query(`ALTER TABLE deals ADD COLUMN IF NOT EXISTS productos TEXT`); } catch (_) { /* ya está */ } vals.push(prods.join(', ')); parts.push(`productos=$${vals.length}`); }
      if (outcome_reason !== undefined) { vals.push(outcome_reason); parts.push(`outcome_reason=$${vals.length}`); }
      if (quoted_at !== undefined) { vals.push(quoted_at); parts.push(`quoted_at=$${vals.length}`); }
      if (outcome === 'won' || outcome === 'lost') { parts.push(`closed_at=NOW()`); }
      if (!parts.length) return res.status(400).json({ ok: false, error: 'nothing to update' });
      vals.push(id);
      const r = await pool.query(`UPDATE deals SET ${parts.join(', ')} WHERE id=$${vals.length} RETURNING id, outcome, outcome_reason, closed_at`, vals);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
      return res.json({ ok: true, ...r.rows[0] });
    }
    const d = memory.deals.find(x => x.id === id);
    if (!d) return res.status(404).json({ ok: false, error: 'not found' });
    if (outcome) d.outcome = outcome;
    if (prods && prods.length) d.productos = prods.join(', ');
    if (outcome_reason !== undefined) d.outcomeReason = outcome_reason;
    if (quoted_at !== undefined) d.quotedAt = quoted_at;
    if (outcome === 'won' || outcome === 'lost') d.closedAt = new Date().toISOString();
    return res.json({ ok: true, id, outcome: d.outcome, outcome_reason: d.outcomeReason, closed_at: d.closedAt });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.get('/api/deals/:id', async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query(`SELECT * FROM deals WHERE id=$1`, [req.params.id]);
      if (!r.rows.length) return res.status(404).json({ error: 'not found' });
      return res.json(r.rows[0]);
    }
    const d = memory.deals.find(x => x.id === Number(req.params.id));
    if (!d) return res.status(404).json({ error: 'not found' });
    return res.json({ id: d.id, executive: d.executive, company: d.company, segment: d.segment, has_ats: d.hasAts, created_at: d.createdAt, data: d });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Eliminar un deal (y sus pedidos del wishlist)
app.delete('/api/deals/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(400).json({ ok: false, error: 'id inválido' });
    if (pool) {
      await pool.query(`DELETE FROM wishlist WHERE deal_id=$1`, [id]);
      // Si era el deal de un lead de la SDR, el lead queda sin deal (se re-enlaza al demo que se llene
      // en otro deal de la misma empresa, o se crea uno nuevo al calificar).
      try { await pool.query(`UPDATE sdr.leads SET deal_id = NULL WHERE deal_id = $1`, [id]); } catch (_) { /* sin módulo SDR */ }
      const r = await pool.query(`DELETE FROM deals WHERE id=$1 RETURNING id`, [id]);
      if (!r.rows.length) return res.status(404).json({ ok: false, error: 'not found' });
      return res.json({ ok: true, id });
    }
    const idx = memory.deals.findIndex(x => x.id === id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'not found' });
    memory.deals.splice(idx, 1);
    memory.wishlist = memory.wishlist.filter(w => w.dealId !== id);
    return res.json({ ok: true, id });
  } catch (e) {
    console.error(e);
    res.status(500).json({ ok: false, error: e.message });
  }
});

// Wishlist agregado por segmento
app.get('/api/wishlist', async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query(`
        SELECT segment, LOWER(TRIM(item)) AS item, COUNT(*)::int AS count,
               SUM(CASE WHEN we_have THEN 1 ELSE 0 END)::int AS we_have_count
        FROM wishlist
        WHERE item IS NOT NULL AND item <> ''
        GROUP BY segment, LOWER(TRIM(item))
        ORDER BY count DESC, segment
        LIMIT 500
      `);
      return res.json(r.rows);
    }
    const map = new Map();
    for (const w of memory.wishlist) {
      const key = `${w.segment}::${(w.item || '').toLowerCase().trim()}`;
      if (!map.has(key)) map.set(key, { segment: w.segment, item: w.item.toLowerCase().trim(), count: 0, we_have_count: 0 });
      const o = map.get(key); o.count++; if (w.weHave) o.we_have_count++;
    }
    res.json([...map.values()].sort((a, b) => b.count - a.count));
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Wishlist por temas: los pedidos, uno por línea, no dicen nada; aquí se agrupan por necesidad
// (con Claude) y se cuentan por tamaño de empresa. El resultado se guarda (wishlist_temas) con un
// hash de los pedidos: solo se vuelve a clasificar cuando hay pedidos nuevos o con ?refrescar=1.
const SIN_PEDIDO = /^(no aplica|n\/a|na|ninguno|ninguna|nada|-|—)\.?$/i;
function hashPedidos(filas) {
  return require('crypto').createHash('md5').update(filas.map(f => `${f.id}:${f.segment || ''}:${f.item}`).join('|')).digest('hex');
}
function armarTemas(clasificacion, filas) {
  const porId = new Map(filas.map(f => [f.id, f]));
  const usados = new Set();
  const temas = (clasificacion.temas || []).map(t => {
    const items = (t.items || []).map(Number).filter(id => porId.has(id) && !usados.has(id));
    items.forEach(id => usados.add(id));
    const fs = items.map(id => porId.get(id));
    const seg = { A: 0, B: 0, C: 0, '': 0 };
    for (const f of fs) seg[f.segment && seg[f.segment] !== undefined ? f.segment : '']++;
    const tenemos = fs.filter(f => f.we_have).length;
    return {
      nombre: String(t.nombre || 'Sin nombre').trim(), descripcion: String(t.descripcion || '').trim(), producto: String(t.producto || 'Otro').trim(),
      total: fs.length, por_segmento: seg, tenemos, lo_tenemos: !fs.length ? 'no' : tenemos >= Math.ceil(fs.length / 2) ? 'si' : tenemos ? 'parcial' : 'no',
      empresas: [...new Set(fs.map(f => f.company).filter(Boolean))].length,
      pedidos: fs.map(f => ({ id: f.id, item: f.item, segment: f.segment, we_have: !!f.we_have, company: f.company, deal_id: f.deal_id })),
    };
  }).filter(t => t.total).sort((a, b) => b.total - a.total);
  const sinTema = filas.filter(f => !usados.has(f.id)).map(f => ({ id: f.id, item: f.item, segment: f.segment, we_have: !!f.we_have, company: f.company, deal_id: f.deal_id }));
  return { temas, sin_tema: sinTema };
}
app.get('/api/wishlist/temas', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ error: 'sin base de datos' });
    await pool.query(`CREATE TABLE IF NOT EXISTS wishlist_temas (id SERIAL PRIMARY KEY, hash TEXT NOT NULL, resultado JSONB NOT NULL, modelo TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    const filas = (await pool.query(
      `SELECT w.id, w.segment, TRIM(w.item) AS item, w.we_have, w.deal_id, d.company, d.linea_negocio
       FROM wishlist w LEFT JOIN deals d ON d.id = w.deal_id
       WHERE w.item IS NOT NULL AND TRIM(w.item) <> '' ORDER BY w.id`)).rows.filter(f => !SIN_PEDIDO.test(f.item));
    if (!filas.length) return res.json({ temas: [], sin_tema: [], total: 0, generado_at: null });
    const hash = hashPedidos(filas);
    const cache = (await pool.query(`SELECT resultado, modelo, created_at FROM wishlist_temas WHERE hash = $1 ORDER BY id DESC LIMIT 1`, [hash])).rows[0];
    if (cache && req.query.refrescar !== '1') return res.json({ ...armarTemas(cache.resultado, filas), total: filas.length, generado_at: cache.created_at, modelo: cache.modelo, cache: true });
    if (!anthropic) {
      const viejo = (await pool.query(`SELECT resultado, created_at FROM wishlist_temas ORDER BY id DESC LIMIT 1`)).rows[0];
      if (viejo) return res.json({ ...armarTemas(viejo.resultado, filas), total: filas.length, generado_at: viejo.created_at, desactualizado: true });
      return res.status(503).json({ error: 'Sin ANTHROPIC_API_KEY no se pueden agrupar los pedidos.' });
    }
    const lista = filas.map(f => `${f.id}\t${f.segment || '?'}\t${f.item.replace(/\s+/g, ' ').slice(0, 220)}`).join('\n');
    const prompt = `Eres el analista de producto de Peaku (headhunting tech, SaaS de reclutamiento con IA, EOR, evaluaciones y pruebas, Peaku Verify). Abajo hay pedidos que los clientes dijeron en demos, uno por línea: id, segmento de la empresa (A = micro, B = pyme, C = grande) y el pedido textual.
Agrúpalos en NECESIDADES recurrentes (temas), entendiendo el contexto: dos pedidos distintos en palabras pueden ser la misma necesidad (p. ej. "conexión con buk" y "integración con su ats" = integración con el ATS del cliente; "candidatos ya filtrados" y "evitar que se postule gente sin la experiencia" = filtro previo de candidatos). Reglas:
- Entre 8 y 16 temas. Nombre corto (3-6 palabras), descripción de una frase con qué necesidad de fondo hay detrás.
- Cada pedido va en UN solo tema. Los pedidos que solo son "mándame la propuesta / precios / referencias" van a un tema "Propuesta y precios"; los de modelo de pago (mensual sin permanencia, pago por necesidad, bolsa de créditos) a "Modelo de pago flexible".
- Un pedido que no encaje en ningún tema se deja fuera (no inventes temas de un solo pedido salvo que sea claramente distinto).
- producto: a qué línea de Peaku le toca: SaaS, Headhunting, EOR, Evaluaciones, Verify, Comercial (propuesta/precio) u Otro.
Responde SOLO con JSON válido: {"temas":[{"nombre":"...","descripcion":"...","producto":"...","items":[ids]}]}

PEDIDOS:
${lista}`;
    const msg = await anthropic.messages.create({ model: ANALYZE_MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] });
    const text = (msg.content && msg.content[0] && msg.content[0].text) || '';
    let json = text.trim(); const fenced = json.match(/```(?:json)?\s*([\s\S]*?)```/); if (fenced) json = fenced[1].trim();
    const ini = json.indexOf('{'), fin = json.lastIndexOf('}'); if (ini >= 0 && fin > ini) json = json.slice(ini, fin + 1);
    let parsed; try { parsed = JSON.parse(json); } catch (e) { return res.status(502).json({ error: 'Claude devolvió JSON inválido', raw: text.slice(0, 1500) }); }
    await pool.query(`INSERT INTO wishlist_temas (hash, resultado, modelo) VALUES ($1, $2::jsonb, $3)`, [hash, JSON.stringify(parsed), msg.model || ANALYZE_MODEL]);
    res.json({ ...armarTemas(parsed, filas), total: filas.length, generado_at: new Date().toISOString(), modelo: msg.model || ANALYZE_MODEL, cache: false });
  } catch (e) { console.error('[wishlist/temas]', e.message); res.status(500).json({ error: e.message }); }
});

// Health real: prueba una consulta trivial con timeout
app.get('/api/health', async (_req, res) => {
  const out = { ok: true, poolExists: !!pool, dbReady, lastError: dbLastError };
  if (!pool) return res.json({ ...out, db: false });
  try {
    const q = pool.query('SELECT 1 AS ping');
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout 5s')), 5000));
    const r = await Promise.race([q, timeout]);
    out.db = !!(r && r.rows && r.rows[0] && r.rows[0].ping === 1);
    res.json(out);
  } catch (e) {
    dbLastError = e.message;
    res.status(500).json({ ...out, db: false, error: e.message });
  }
});

// ---------- Análisis IA de transcript ----------
function buildAnalyzePrompt(transcript, ctx) {
  const linea = ctx.lineaNegocio || 'SaaS';
  const lineaContexto = {
    SaaS: 'Peaku vende una plataforma SaaS de reclutamiento (sourcing automático + IA de ranking/scoring + pruebas de candidatos). El cliente usa la plataforma él mismo.',
    Headhunting: 'Peaku ofrece búsqueda y selección (search a la medida). Peaku busca y trae el talento por encargo — el cliente no usa la plataforma directamente.',
    EOR: 'Peaku ofrece Employer of Record: el cliente ya identificó al candidato y Peaku lo contrata legalmente a su nombre en el país que aplique.',
  }[linea] || '';
  const saasFocus = linea === 'SaaS' ? ({
    sourcing: 'El cliente entró por interés en SOURCING (adquisición automatizada de candidatos). Enfoca análisis y acciones en cómo Peaku alimenta el embudo.',
    pruebas: 'El cliente entró por interés en PRUEBAS/ASSESSMENTS (filtrar candidatos que él ya tiene). Enfoca análisis y acciones en el motor de tests y en cuánto tiempo ahorra vs. su proceso actual de screening.',
    ia: 'El cliente entró por interés en IA DE RANKING/SCORING (ordenar candidatos automáticamente). Enfoca análisis en cómo Peaku reduce el tiempo de screening manual.',
    combinado: 'El cliente tiene interés combinado o aún no está claro qué le importa más. Al analizar, identifica qué ángulo (sourcing / pruebas / IA) resuena más en el transcript y recomiéndalo.'
  })[ctx.saasInteres] || 'Interés SaaS sin especificar — deduce del transcript.' : '';

  const canalMap = {
    freelancer: 'Freelancer/SDR externo', sdr_interno: 'SDR interno de Peaku',
    inbound: 'Inbound (correo/web)', referido: 'Referido',
    evento: 'Evento/networking', outbound: 'Outbound del ejecutivo', otro: 'Otro'
  };

  return `Eres un analista senior de ventas experto en DOS marcos y en el proceso comercial de Peaku (empresa colombiana de reclutamiento): (1) el método Sandler y (2) "The JOLT Effect" (Matthew Dixon), sobre cómo vencer la INDECISIÓN del cliente. Analizas el transcript real de un demo comercial.

CONTEXTO DEL DEAL:
- Empresa cliente: ${ctx.company || 'no especificada'}
- Ejecutivo comercial de Peaku: ${ctx.executive || 'no especificado'}
- Línea de negocio: ${linea}. ${lineaContexto}${saasFocus ? '\n- Interés SaaS específico: ' + saasFocus : ''}
- Canal de adquisición: ${canalMap[ctx.canalAdquisicion] || 'no especificado'}${ctx.freelancerNombre ? ' (' + ctx.freelancerNombre + ')' : ''}
- Ficha previa del canal:
  · Cargos/necesidad: ${ctx.fichaCargos || 'sin datos'}
  · Costo del proceso actual: ${ctx.fichaCosto || 'sin datos'}
  · Herramientas actuales: ${ctx.fichaHerramientas || 'sin datos'}
  · Notas: ${ctx.fichaAdicional || 'sin datos'}
- Actitud reportada por canal: ${ctx.prospActitud || 'sin datos'}
- Urgencia reportada: ${ctx.prospUrgencia || 'sin datos'}

═══════════════════════════════════════════════════════════
REGLA DE ORO — ANCLAJE ESTRICTO AL TRANSCRIPT (léela dos veces):
- Lee el transcript COMPLETO, de principio a fin, ANTES de concluir nada. No te quedes con el inicio.
- Toda afirmación que hagas debe poder respaldarse con una cita textual del transcript. Si no hay evidencia, el campo va vacío ("").
- NUNCA marques una pregunta como "no se hizo" sin antes barrer TODO el transcript buscando esa pregunta o una equivalente (aunque esté redactada distinto, con otras palabras o de forma indirecta). Si el tema ya se tocó de cualquier manera, NO es una pregunta faltante. Ante la más mínima duda, NO la reportes como faltante.
- No inventes nombres, cifras, fechas, cargos ni compromisos que no aparezcan literalmente en el texto.
- Las acciones y el diagnóstico deben ser ESPECÍFICOS a ESTA conversación (usa los nombres, cifras y frases reales), nunca genéricos ni "de manual".
═══════════════════════════════════════════════════════════

MÉTODO SANDLER (para calificar el deal):
- Fase 1 · Construcción: contrato previo (tiempo, agenda, permiso para decir "no") + vínculo.
- Fase 2 · Calificación: cuatro criterios, cada uno con SU regla escrita (es la regla de Peaku, aplícala literal, no la versión genérica de Sandler):
${CALIFICACION.reglasTexto()}
  Reglas de juicio: un criterio cumple SOLO si la transcripción lo respalda con una cita. Que el ejecutivo haya preguntado no basta: cuenta la respuesta del cliente. "Presupuesto" NO cumple si la plata es del próximo año o el cliente dijo que no tiene; tampoco cumple si el ejecutivo nunca dijo un precio o rango (sin precio no hay reacción al precio). "Decisión" NO cumple con "lo paso a RRHH / lo reviso con mi jefe" sin saber quién aprueba y cómo. "Fecha" es una fecha para DECIDIR acordada con el cliente, no la fecha de la capacitación, del envío de la propuesta ni de la prueba. Si dudas, NO cumple, y explica qué falta.
- Fase 3 · Cierre: el ejecutivo propone los próximos pasos (no el cliente). Piloto > cotización fría.
- CALIFICACIÓN: Completa = los 4 criterios cumplen. Parcial = 2-3 de 4. No califica = 0-1 de 4. calificacion_sandler DEBE ser coherente con criterios_sandler (cuenta los cumple:true).

═══════════════════════════════════════════════════════════
MARCO JOLT — EL CENTRO DEL ANÁLISIS Y DE LAS ACCIONES:
La mayoría de los deals calificados NO se pierden contra un competidor, sino contra la INDECISIÓN del cliente: se queda en el statu quo por miedo a equivocarse (FOMU, "fear of messing up"). Tu tarea más importante es diagnosticar la objeción/indecisión SUBYACENTE (la razón real detrás de "déjame pensarlo", "lo tengo que consultar", evasivas sobre presupuesto, silencios, "sigo investigando opciones") y proponer acciones según JOLT:
- J · Judge (juzgar el nivel y tipo de indecisión). Tipos:
   · valoracion: no ve claro que valga la pena / no percibe ROI vs. lo que hace hoy (statu quo).
   · falta_informacion: siente que le faltan datos para decidir, quiere "seguir investigando/comparando".
   · miedo_resultado: teme que la solución no funcione y quedar mal por haberla comprado.
   · miedo_interno_statuquo: es usuario/champion que teme llevar la propuesta al tomador de decisión y que lo culpen si sale mal (miedo a "pasar el proveedor" hacia arriba).
   · ninguna_clara: si de verdad no hay señales de indecisión en el transcript.
- O · Offer (recomendar): el ejecutivo debe tomar postura y recomendar UNA ruta concreta, no dejar que el cliente arme el menú.
- L · Limit (limitar): no abrumar con features/planes; acotar a lo que resuelve SU dolor puntual.
- T · Take risk off the table (quitar el riesgo): piloto, prueba acotada, salida sin penalidad, garantía, referencias — para desactivar el miedo específico detectado.
═══════════════════════════════════════════════════════════

TRANSCRIPT DEL DEMO (probablemente de Google Meet / Otter / Fireflies):
\`\`\`
${transcript}
\`\`\`

TAREA:
1. Extrae la información estructurada (campos del JSON), con citas textuales.
1a. idealRequests: SOLO lo que el CLIENTE pidió o dijo necesitar, con la cita textual del cliente (no del ejecutivo). Algo que el ejecutivo mostró y el cliente aceptó ver, dijo "ok" o no se opuso NO es un pedido. Sin cita del cliente, no va. Mejor vacío que inventado: esta lista alimenta el wishlist de la empresa.
1b. criterios_sandler: aplica la regla escrita de cada criterio a la transcripción y da el veredicto con su cita. Para cada criterio que NO cumple, "falta" dice qué le falta según la regla y "accion" es un call to action concreto: la pregunta exacta o el paso (a quién, por qué canal, cuándo) que cierra ese criterio. Esto es lo que la ejecutiva va a leer para saber qué hacer: sé directo y específico a esta conversación.
2. Diagnostica la objeción/indecisión SUBYACENTE (objecion_subyacente) usando SOLO señales del transcript. Cita la frase que la delata.
3. Genera acciones_concretas: 3-7 pasos ESPECÍFICOS a esta conversación (nombre real, fecha, canal). Cada acción atada a: la palanca JOLT que ataca (J/O/L/T) y la cita o señal del transcript que la motiva. Prioriza por impacto en DESBLOQUEAR la indecisión detectada, NO por el orden del proceso.
4. que_mostrar: qué mostrar (y qué NO mostrar) de Peaku en la demo/propuesta de seguimiento, SEGÚN LO QUE ESTE CLIENTE REALMENTE QUIERE Y LE DUELE en el transcript — NO por reglas de segmento. Ejemplo: si el cliente pidió PRUEBAS/ASSESSMENTS para filtrar candidatos que ya tiene, marca "Motor de pruebas" como mostrar:true, y "Sourcing masivo" como mostrar:false (porque no es lo que pidió). Cada ítem debe citar la señal del transcript. Sé concreto y aterrizado a este caso.
5. preguntas_faltantes: aplica la REGLA DE ORO en dos pasos. PASO A (mental, no lo imprimas): recorre el transcript y lista qué temas/preguntas SÍ cubrió el ejecutivo (dolor, cuantificación, presupuesto, decisor, proceso, fecha límite, etc.), reconociendo variantes y formas indirectas. PASO B: incluye SOLO lo que de verdad NO se tocó Y es relevante al dolor de este cliente, cada una con "por_que" (por qué importa para ESTE deal). Si el ejecutivo cubrió lo esencial, devuelve array vacío — mejor vacío que inventado. NUNCA incluyas una pregunta cuyo tema ya apareció en el transcript.
6. momentos_criticos: hasta 3, cada uno con cita textual real.

RESPONDE SOLO CON JSON VÁLIDO, SIN TEXTO ADICIONAL (ni cercas de código ni comentarios). Las citas van dentro de strings JSON: si la cita trae comillas dobles, escápalas (\\") o usa comillas «así»; sin saltos de línea sin escapar. Formato exacto:

{
  "contratoPrevio": "cita o resumen si se hizo, vacío si no",
  "vinculo": "cómo se generó rapport, vacío si no hubo",
  "dolor": "cita textual del dolor principal identificado",
  "dolorCuantificar": "cita si hubo cifra/tiempo, vacío si no se preguntó o no respondió",
  "dolorHistoria": "qué intentaron antes, cita si aparece",
  "dolorImpacto": "impacto emocional/operativo mencionado, cita si aparece",
  "consecuenciasEmocionales": "frustración/miedo/presión mencionados",
  "medicion": "cómo miden el proceso hoy",
  "integraciones": "solo si línea es SaaS y mencionan ATS/API",
  "presupuesto": "info de presupuesto que salió (cifra, comparación, o 'no se preguntó')",
  "decisor": "nombres/roles de decisores mencionados",
  "procesoDecision": "pasos internos, comité, plazos",
  "fechaLimiteDecision": "YYYY-MM-DD si se acordó fecha específica, vacío si no",
  "idealRequests": [
    {"text": "pedido del cliente, en sus palabras", "cita": "cita textual del CLIENTE donde lo pide (obligatoria)", "weHave": true}
  ],
  "proximoPaso": "próximo paso concreto acordado en el demo",
  "postVenta": "si se habló de onboarding/seguimiento",
  "pilotoCargo": "si se ofreció piloto, qué cargo",
  "pilotoFechaRevision": "YYYY-MM-DD si se acordó fecha de revisión",
  "segmento_sugerido": "A (Micro), B (PyME) o C (Grande) según volumen/equipo del cliente",
  "hasAts": true,
  "atsName": "nombre del ATS si lo tienen",
  "criterios_sandler": {
    "dolor": {"cumple": true, "evidencia": "cita textual que lo sustenta (o vacío)", "falta": "si no cumple: qué falta exactamente según la regla (vacío si cumple)", "accion": "si no cumple: la pregunta literal o el paso concreto que el ejecutivo debe hacer en el siguiente contacto para cerrarlo, con nombre y canal (vacío si cumple)"},
    "presupuesto": {"cumple": false, "evidencia": "", "falta": "", "accion": ""},
    "decision": {"cumple": false, "evidencia": "", "falta": "", "accion": ""},
    "fecha": {"cumple": false, "evidencia": "", "falta": "", "accion": ""}
  },
  "calificacion_sandler": "Completa | Parcial | No califica",
  "objecion_subyacente": {
    "tipo": "valoracion | falta_informacion | miedo_resultado | miedo_interno_statuquo | ninguna_clara",
    "descripcion": "en 1-2 frases, cuál es la verdadera razón de indecisión de ESTE cliente y en qué te basas",
    "evidencia": "cita textual del transcript que la delata (vacío si el tipo es ninguna_clara)"
  },
  "acciones_concretas": [
    {"prioridad": "alta | media | baja", "jolt": "J | O | L | T", "accion": "descripción específica con nombre/fecha/canal", "porque": "cita o señal del transcript que motiva esta acción", "cuando": "hoy | mañana | esta semana"}
  ],
  "que_mostrar": [
    {"item": "módulo o ángulo concreto de Peaku", "mostrar": true, "por_que": "cita/señal del transcript de por qué a ESTE cliente le sirve (o por qué NO)"}
  ],
  "preguntas_faltantes": [
    {"pregunta": "pregunta específica que de verdad NO se hizo y es relevante", "por_que": "por qué importa para ESTE deal"}
  ],
  "momentos_criticos": [
    {"cita": "cita textual del cliente/ejecutivo", "que_paso": "qué error se cometió", "que_debio_hacer": "cómo debió corregirse (idealmente en clave JOLT)"}
  ],
  "resumen_ejecutivo": "2-3 oraciones: qué pasó en el demo, calificación, la objeción subyacente detectada y la recomendación clara (cotizar / piloto / nutrir)"
}`;
}

const { parsearJSON, textoDe } = require('./json_ia');
// Tope de salida del análisis. 8000 se quedaba corto en demos largos (las citas por criterio y por acción
// alargan la respuesta) y el JSON llegaba cortado: "JSON inválido".
const MAX_TOKENS_ANALISIS = 16000;

// Análisis de una transcripción con Claude (el JSON del prompt). Lanza con status 502 si el JSON no parsea.
// Si la respuesta no parsea (comillas sin escapar dentro de una cita, coma de más, texto alrededor), se le
// pide a la IA que repare su propio JSON una vez antes de rendirse; si se cortó por larga, lo dice.
async function analizarTranscript(transcript, context) {
  const prompt = buildAnalyzePrompt(transcript, context || {});
  const msg = await anthropic.messages.create({ model: ANALYZE_MODEL, max_tokens: MAX_TOKENS_ANALISIS, messages: [{ role: 'user', content: prompt }] });
  const text = textoDe(msg);
  let parsed = parsearJSON(text);
  if (!parsed && msg.stop_reason === 'max_tokens') {
    console.error('[llm] respuesta cortada por max_tokens; transcript de', transcript.length, 'caracteres');
    throw Object.assign(new Error('La respuesta de la IA se cortó por larga (la transcripción es muy extensa). Recorta la transcripción a la parte del demo y vuelve a intentar.'), { status: 502, raw: text.slice(-1500) });
  }
  if (!parsed) {
    console.error('[llm] JSON parse fallido (stop_reason=' + msg.stop_reason + '); reparando. texto:', text.slice(0, 800));
    const fix = await anthropic.messages.create({ model: ANALYZE_MODEL, max_tokens: MAX_TOKENS_ANALISIS, messages: [{ role: 'user', content:
      'El texto de abajo debía ser UN objeto JSON válido pero no parsea. Devuélvelo corregido: escapa las comillas dobles que haya dentro de los strings, quita comas sobrantes y cualquier texto fuera del objeto. No cambies el contenido. RESPONDE SOLO CON EL JSON.\n\n' + text }] });
    parsed = parsearJSON(textoDe(fix));
    if (!parsed) {
      console.error('[llm] la reparación tampoco parseó. texto:', textoDe(fix).slice(0, 800));
      throw Object.assign(new Error('La IA devolvió una respuesta que no se pudo leer (JSON inválido), ni al pedirle que la corrigiera. Vuelve a intentar; si se repite, avísale a Santiago.'), { status: 502, raw: text.slice(0, 2000) });
    }
  }
  parsed._usage = msg.usage;
  // Pedidos del cliente sin cita del cliente no entran: alimentan el wishlist y no pueden ser inventados.
  if (Array.isArray(parsed.idealRequests)) {
    parsed.idealRequests = parsed.idealRequests.filter(x => x && has(x.text) && has(x.cita)).map(x => ({ text: String(x.text).trim(), cita: String(x.cita).trim(), weHave: !!x.weHave }));
  }
  return parsed;
}

// Quitar un pedido del cliente del deal (y del wishlist): la IA lo registró y el cliente no lo pidió.
app.post('/api/deals/:id/ideal/quitar', async (req, res) => {
  try {
    if (!pool) return res.status(503).json({ ok: false, error: 'sin base de datos' });
    const id = Number(req.params.id);
    const texto = String((req.body || {}).text || '').trim();
    if (!texto) return res.status(400).json({ ok: false, error: 'Falta el pedido' });
    const row = (await pool.query(`SELECT data FROM deals WHERE id=$1`, [id])).rows[0];
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    const d = { ...(row.data || {}) };
    const antes = Array.isArray(d.idealRequests) ? d.idealRequests.length : 0;
    d.idealRequests = (Array.isArray(d.idealRequests) ? d.idealRequests : []).filter(x => !(x && String(x.text || '').trim() === texto));
    await pool.query(`UPDATE deals SET data=$2 WHERE id=$1`, [id, d]);
    await pool.query(`DELETE FROM wishlist WHERE deal_id=$1 AND item=$2`, [id, texto]);
    res.json({ ok: true, quitados: antes - d.idealRequests.length, idealRequests: d.idealRequests });
  } catch (e) { res.status(500).json({ ok: false, error: e.message }); }
});

app.post('/api/analyze', async (req, res) => {
  try {
    if (!anthropic) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });
    const { transcript, context } = req.body || {};
    if (!transcript || transcript.length < 100) {
      return res.status(400).json({ error: 'transcript vacío o muy corto (mín 100 chars)' });
    }
    res.json(await analizarTranscript(transcript, context));
  } catch (e) {
    console.error('[llm] error:', e.message);
    res.status(e.status || 500).json({ error: e.message, raw: e.raw });
  }
});

// Volver a analizar la transcripción guardada de un deal (p. ej. demos de antes de que la IA aplicara
// las reglas por criterio). Se reemplaza iaExtracted y se recalculan calificación y score; los campos
// que la ejecutiva ya tenía escritos no se pisan (solo se llenan los vacíos).
app.post('/api/deals/:id/reanalizar', async (req, res) => {
  try {
    if (!anthropic) return res.status(500).json({ ok: false, error: 'ANTHROPIC_API_KEY no configurada' });
    if (!pool) return res.status(503).json({ ok: false, error: 'sin base de datos' });
    const id = Number(req.params.id);
    const row = (await pool.query(`SELECT * FROM deals WHERE id=$1`, [id])).rows[0];
    if (!row) return res.status(404).json({ ok: false, error: 'not found' });
    const d = { ...(row.data || {}) };
    if (!has(d.transcript) || String(d.transcript).length < 100) return res.status(400).json({ ok: false, error: 'Este deal no tiene transcripción para analizar' });
    const ia = await analizarTranscript(d.transcript, d);
    d.iaExtracted = ia;
    const CAMPOS_IA = ['contratoPrevio', 'vinculo', 'dolor', 'dolorCuantificar', 'dolorHistoria', 'dolorImpacto', 'consecuenciasEmocionales', 'medicion', 'integraciones',
      'presupuesto', 'decisor', 'procesoDecision', 'fechaLimiteDecision', 'proximoPaso', 'postVenta', 'pilotoCargo', 'pilotoFechaRevision', 'atsName'];
    for (const k of CAMPOS_IA) if (!has(d[k]) && has(ia[k])) d[k] = ia[k];
    if (!Array.isArray(d.idealRequests) || !d.idealRequests.length) d.idealRequests = Array.isArray(ia.idealRequests) ? ia.idealRequests : [];
    if (!d.segment && ia.segmento_sugerido) d.segment = String(ia.segmento_sugerido).trim().charAt(0);
    if (typeof d.hasAts !== 'boolean' && typeof ia.hasAts === 'boolean') d.hasAts = ia.hasAts;
    const s = scoreDeal(d);
    const fechaLim = (d.fechaLimiteDecision && String(d.fechaLimiteDecision).match(/^\d{4}-\d{2}-\d{2}$/)) ? d.fechaLimiteDecision : null;
    await pool.query(
      `UPDATE deals SET segment=$1, has_ats=$2, data=$3, score_fundamentals=$4, score_nice_to_have=$5, calificacion_sandler=$6, fecha_limite_decision=$7 WHERE id=$8`,
      [d.segment || null, !!d.hasAts, d, s.fundamentalsPct, s.niceToHavePct, s.calificacion.label, fechaLim, id]);
    res.json({ ok: true, id, calificacion: s.calificacion.label, criterios: ia.criterios_sandler || null });
  } catch (e) {
    console.error('[llm] reanalizar:', e.message);
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

// ---------- PeakU Verificado ----------
// Se monta sobre el mismo pool y la misma base de datos. Sus tablas viven en el schema
// "verificacion", así que no toca deals ni wishlist. Si el módulo falta, el Sandler arranca igual.
try {
  const verificacion = require('./verificacion/app');
  app.use('/verificacion', verificacion.router({
    pool,
    anthropic,
    model: process.env.VERIF_MODEL || ANALYZE_MODEL,
  }));
  verificacion.initSchema(pool).catch(e => console.error('[verificacion] schema:', e.message));
  console.log('[verificacion] montada en /verificacion');
} catch (e) {
  console.error('[verificacion] no se pudo montar:', e.message);
}

// ---------- SDR Coach ----------
// Prospección de Angie: cola del día, leads, llamadas y mejora semanal. Sus tablas viven en el
// schema "sdr". Sin login por decisión de producto: quien tenga el enlace /sdr opera todo.
try {
  const sdr = require('./sdr/app');
  app.use('/sdr', sdr.router({ pool, anthropic }));
  sdr.initSchema(pool).catch(e => console.error('[sdr] schema:', e.message));
  console.log('[sdr] montada en /sdr');
} catch (e) {
  console.error('[sdr] no se pudo montar:', e.message);
}

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initSchema()
  .catch(e => {
    dbLastError = e.message;
    console.error('[db] schema error:', e.message);
    console.error('[db] DATABASE_URL host:', (process.env.DATABASE_URL || '').replace(/:\/\/[^@]*@/, '://***:***@').split('/')[2]);
  })
  .finally(() => {
    app.listen(PORT, () => {
      console.log(`Peaku Sandler escuchando en :${PORT} (poolExists=${!!pool}, dbReady=${dbReady})`);
    });
  });

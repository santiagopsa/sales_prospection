// Peaku Sandler - Server
// (Historial: detalle de deal, eliminación de registros, campos faltantes)
const express = require('express');
const path = require('path');
const { Pool } = require('pg');
const Anthropic = require('@anthropic-ai/sdk');

const app = express();
const PORT = process.env.PORT || 3000;

// El transcript de un demo largo puede ser 40-80 KB; damos margen.
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Claude (Anthropic) ---
const anthropic = process.env.ANTHROPIC_API_KEY
  ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  : null;
if (!anthropic) console.warn('[llm] ANTHROPIC_API_KEY no está seteada — /api/analyze devolverá error');

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
// Calificación Sandler: Completa requiere dolor desarrollado + presupuesto + decisión + fecha límite
function calificacionSandler(d) {
  const pf = painFunnelOk(d);
  const dolorOk = pf.ok || has(d.dolor); // acepta dolor viejo como parcial
  const budget = has(d.presupuesto);
  const decision = has(d.decisor) && has(d.procesoDecision);
  const fecha = has(d.fechaLimiteDecision);
  const items = [dolorOk && pf.ok, budget, decision, fecha];
  const done = items.filter(Boolean).length;
  let label = 'No califica';
  if (done >= 4) label = 'Completa';
  else if (done >= 2) label = 'Parcial';
  return { label, done, of: 4, pf, dolorOk, budget, decision, fecha };
}
function scoreDeal(d) {
  // Fundamentales del nuevo proceso: contrato previo, segmentación, dolor desarrollado (embudo 2/3),
  // presupuesto, decisor, proceso de decisión, fecha límite de decisión.
  const pf = painFunnelOk(d);
  const fundamentals = {
    contratoPrevio: has(d.contratoPrevio),
    fichaPrevia: has(d.fichaCargos) || has(d.fichaCosto) || has(d.fichaHerramientas), // contrato previo N°1
    segmentacion: !!(d.segment),
    dolorDesarrollado: pf.ok, // >=2 de 3 del embudo
    presupuesto: has(d.presupuesto),
    decisor: has(d.decisor),
    procesoDecision: has(d.procesoDecision),
    fechaLimiteDecision: has(d.fechaLimiteDecision),
  };
  // Nice to have: vínculo, consecuencias emocionales, cotización piloto, post-venta, etc.
  const niceToHave = {
    vinculo: has(d.vinculo),
    consecuenciasEmocionales: has(d.consecuenciasEmocionales),
    medicion: has(d.medicion),
    integraciones: has(d.integraciones),
    postVenta: has(d.postVenta),
    proximoPaso: has(d.proximoPaso),
    piloto: has(d.pilotoCargo) && has(d.pilotoFechaRevision), // NEW
  };
  const fundOk = Object.values(fundamentals).filter(Boolean).length;
  const nthOk = Object.values(niceToHave).filter(Boolean).length;
  const cal = calificacionSandler(d);
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

app.get('/api/deals', async (req, res) => {
  try {
    if (pool) {
      const r = await pool.query(`
        SELECT id, executive, company, segment, has_ats,
               score_fundamentals, score_nice_to_have,
               linea_negocio, calificacion_sandler,
               fecha_limite_decision, quoted_at, outcome, outcome_reason, closed_at,
               created_at
        FROM deals ORDER BY created_at DESC LIMIT 200`);
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
    const { outcome, outcome_reason, quoted_at } = req.body || {};
    if (pool) {
      const parts = [], vals = [];
      if (outcome) { vals.push(outcome); parts.push(`outcome=$${vals.length}`); }
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

  return `Eres un analista experto en el método Sandler de ventas y en el proceso comercial de Peaku (empresa colombiana de reclutamiento).

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

PROCESO SANDLER DE PEAKU (para tu análisis):
- Fase 1 · Construcción: contrato previo con el cliente (tiempo, agenda, permiso para decir "no") + vínculo.
- Fase 2 · Calificación:
  · EMBUDO DEL DOLOR (2 de 3): cuantificar ($/tiempo) + historia (qué intentaron) + impacto (a quién le duele). Sin embudo desarrollado, el dolor no ancla el precio.
  · Presupuesto: ¿hay plata? ¿cuánto? ¿comparado con qué?
  · Decisión: quiénes deciden + proceso interno + FECHA LÍMITE acordada con el cliente (máximo 14 días).
- Fase 3 · Cierre: proponer TÚ los próximos pasos (nunca el cliente los dicta). Piloto (publicar cargo esta semana) es preferible a cotización fría.
- CALIFICACIÓN SANDLER: Completa = dolor desarrollado + presupuesto + decisión + fecha límite. Parcial = 2-3 de 4. No califica = 0-1 de 4.

TRANSCRIPT DEL DEMO (probablemente de Google Meet):
\`\`\`
${transcript}
\`\`\`

TAREA: Analiza el transcript y extrae la información estructurada en el JSON de abajo. Usa CITAS TEXTUALES del transcript cuando sea posible (con el segundo/minuto si aparece); si no hay dato, deja el campo como cadena vacía. Sé estricto: NO inventes información que no esté en el transcript.

Además, genera:
- Un array "acciones_concretas" con 3-7 próximos pasos ESPECÍFICOS (nombre, fecha, canal), priorizados. Ej.: "Llamar mañana a las 10am a María para preguntar presupuesto (no salió en el demo)"
- Un array "preguntas_faltantes" con lo que el ejecutivo NO preguntó y debería haber preguntado en este demo, según Sandler.
- Un array "momentos_criticos" con hasta 3 momentos del transcript donde se dejó ir un dolor sin desarrollar, se dio precio antes de tiempo, o el cliente dictó los próximos pasos. Incluye la cita textual y qué debió haber hecho el ejecutivo.

RESPONDE SOLO CON JSON VÁLIDO, SIN TEXTO ADICIONAL. Formato exacto:

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
    {"text": "pedido del cliente en sus palabras", "weHave": true}
  ],
  "proximoPaso": "próximo paso concreto acordado en el demo",
  "postVenta": "si se habló de onboarding/seguimiento",
  "pilotoCargo": "si se ofreció piloto, qué cargo",
  "pilotoFechaRevision": "YYYY-MM-DD si se acordó fecha de revisión",
  "segmento_sugerido": "A (Micro), B (PyME) o C (Grande) según volumen/equipo del cliente",
  "hasAts": true,
  "atsName": "nombre del ATS si lo tienen",
  "calificacion_sandler": "Completa | Parcial | No califica",
  "acciones_concretas": [
    {"prioridad": "alta", "accion": "descripción específica con nombre/fecha/canal", "cuando": "hoy | mañana | esta semana"}
  ],
  "preguntas_faltantes": [
    "pregunta específica que se debió hacer y no se hizo"
  ],
  "momentos_criticos": [
    {"cita": "cita textual del cliente/ejecutivo", "que_paso": "qué error se cometió", "que_debio_hacer": "cómo debió corregirse"}
  ],
  "resumen_ejecutivo": "2-3 oraciones: qué pasó en el demo, calificación, y recomendación clara (cotizar / piloto / nutrir)"
}`;
}

app.post('/api/analyze', async (req, res) => {
  try {
    if (!anthropic) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });
    const { transcript, context } = req.body || {};
    if (!transcript || transcript.length < 100) {
      return res.status(400).json({ error: 'transcript vacío o muy corto (mín 100 chars)' });
    }
    const prompt = buildAnalyzePrompt(transcript, context || {});
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = (msg.content && msg.content[0] && msg.content[0].text) || '';
    // Extraer JSON del texto (Claude puede envolverlo en ```json ... ``` a veces)
    let jsonText = text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    let parsed;
    try { parsed = JSON.parse(jsonText); }
    catch (e) {
      console.error('[llm] JSON parse fallido:', e.message, '\ntexto:', text.slice(0, 500));
      return res.status(502).json({ error: 'Claude devolvió JSON inválido', raw: text.slice(0, 2000) });
    }
    parsed._usage = msg.usage;
    res.json(parsed);
  } catch (e) {
    console.error('[llm] error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

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

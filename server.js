// Peaku Sandler - Server
// (Historial: detalle de deal, eliminación de registros, campos faltantes)
const express = require('express');
const path = require('path');
const { Pool } = require('pg');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- DB ---
const useDb = !!process.env.DATABASE_URL;
let pool = null;
if (useDb) {
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
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
  console.log('[db] schema ready');
}

// --- Helpers ---
function scoreDeal(d) {
  // Fundamentales (peso alto): segmentación, dolor, presupuesto, decisión, contratos previos
  const fundamentals = {
    contratoPrevio: !!(d.contratoPrevio && d.contratoPrevio.trim()),
    segmentacion: !!(d.segment),
    dolor: !!(d.dolor && d.dolor.trim()),
    impactoEconomico: !!(d.impactoEconomico && d.impactoEconomico.trim()),
    presupuesto: !!(d.presupuesto && d.presupuesto.trim()),
    decisor: !!(d.decisor && d.decisor.trim()),
    procesoDecision: !!(d.procesoDecision && d.procesoDecision.trim()),
  };
  // Nice to have: vínculo, consecuencias emocionales, vacantes dificiles, post-venta, etc.
  const niceToHave = {
    vinculo: !!(d.vinculo && d.vinculo.trim()),
    consecuenciasEmocionales: !!(d.consecuenciasEmocionales && d.consecuenciasEmocionales.trim()),
    medicion: !!(d.medicion && d.medicion.trim()),
    integraciones: !!(d.integraciones && d.integraciones.trim()),
    postVenta: !!(d.postVenta && d.postVenta.trim()),
    proximoPaso: !!(d.proximoPaso && d.proximoPaso.trim()),
  };
  const fundOk = Object.values(fundamentals).filter(Boolean).length;
  const nthOk = Object.values(niceToHave).filter(Boolean).length;
  return {
    fundamentals,
    niceToHave,
    fundamentalsPct: Math.round((fundOk / Object.keys(fundamentals).length) * 100),
    niceToHavePct: Math.round((nthOk / Object.keys(niceToHave).length) * 100),
  };
}

// --- API ---
app.post('/api/deals', async (req, res) => {
  try {
    const d = req.body || {};
    const s = scoreDeal(d);
    if (pool) {
      const r = await pool.query(
        `INSERT INTO deals (executive, company, segment, has_ats, data, score_fundamentals, score_nice_to_have)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, created_at`,
        [d.executive || null, d.company || null, d.segment || null, !!d.hasAts, d, s.fundamentalsPct, s.niceToHavePct]
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
      const r = await pool.query(`SELECT id, executive, company, segment, has_ats, score_fundamentals, score_nice_to_have, created_at FROM deals ORDER BY created_at DESC LIMIT 200`);
      return res.json(r.rows);
    }
    return res.json(memory.deals.slice().reverse().map(d => ({
      id: d.id, executive: d.executive, company: d.company, segment: d.segment,
      has_ats: d.hasAts, score_fundamentals: d.score.fundamentalsPct,
      score_nice_to_have: d.score.niceToHavePct, created_at: d.createdAt
    })));
  } catch (e) { res.status(500).json({ error: e.message }); }
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

app.get('/api/health', (_req, res) => res.json({ ok: true, db: !!pool }));

// SPA fallback
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

initSchema().catch(e => console.error('schema error', e)).finally(() => {
  app.listen(PORT, () => {
    console.log(`Peaku Sandler escuchando en :${PORT} (db=${!!pool})`);
  });
});

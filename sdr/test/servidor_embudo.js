// Servidor mínimo para la prueba de navegador del embudo (e2e_pruebas.py): sirve public/ y las
// rutas del embudo con sdr/embudo.js contra el Postgres de pruebas. Siembra los mismos casos que
// pruebas.test.js. SOLO para pruebas locales.
const http = require('http');
const fs = require('fs');
const path = require('path');
const base = require('../config');
const { conectar } = require('../db');
const { initSchema } = require('../schema');
const Em = require('../embudo');
const PUB = path.join(__dirname, '..', '..', 'public');
const db = conectar(process.env.SDR_TEST_DATABASE_URL);
process.env.VERIF_SCHEMA = 'verif_e2e';

async function sembrar() {
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await db.query('DROP SCHEMA IF EXISTS verif_e2e CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT,
    canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, calificacion_sandler TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  Em._reiniciar();
  await Em.asegurarColumnas(db);
  const deal = async c => (await db.query(`INSERT INTO public.deals (company, calificacion_sandler, outcome, canal_adquisicion, data, created_at) VALUES ($1,'Completa','open','referido','{}', NOW() - interval '40 days') RETURNING id`, [c])).rows[0].id;
  const dias = n => new Date(Date.now() - n * 86400000);
  const mover = (id, etapa, n, extra = {}) => Em.mover(db, base, { dealId: id, etapa, usuario: 'Luisa', ahora: dias(n), ...extra });
  const alpina = await deal('Alpina S.A.S.'), nutresa = await deal('Nutresa'), rappi = await deal('Rappi'), quieta = await deal('Quieta Ltda'), vieja = await deal('Bancolombia');
  await mover(alpina, 'propuesta', 30, { tipo: 'prueba' }); await mover(alpina, 'propuesta', 23, { tipo: 'cotizacion' });
  await mover(alpina, 'ganado', 10, { motivo: 'Piloto validó la solución', productos: ['Headhunting'] });
  await mover(nutresa, 'propuesta', 25, { tipo: 'prueba' }); await mover(nutresa, 'perdido', 12, { motivo: 'Precio / presupuesto' });
  await mover(rappi, 'propuesta', 5, { tipo: 'prueba' });
  await mover(quieta, 'propuesta', 20, { tipo: 'prueba' });
  await mover(vieja, 'propuesta', 35, { tipo: 'prueba' }); await mover(vieja, 'propuesta', 30, { tipo: 'cotizacion' });
  await mover(vieja, 'ganado', 20, { motivo: 'Champion interno empujó la decisión', productos: ['SaaS'] });
  await deal('Movizzon');
  await deal('Sin Prueba SA');
  await db.query('CREATE SCHEMA verif_e2e');
  await db.query(`CREATE TABLE verif_e2e.ops_procesos (id SERIAL PRIMARY KEY, empresa TEXT, cargo TEXT, etapa TEXT, activado DATE, primer_envio DATE, ultimo_envio DATE, fecha_cierre DATE, prueba BOOLEAN DEFAULT FALSE)`);
  await db.query(`CREATE TABLE verif_e2e.ops_saas (id SERIAL PRIMARY KEY, cliente TEXT, cargo TEXT, estado TEXT, activado DATE, meta INT, destacados INT, prueba BOOLEAN DEFAULT FALSE)`);
  await db.query(`INSERT INTO verif_e2e.ops_procesos (empresa, cargo, etapa, activado, primer_envio, prueba) VALUES
    ('Rappi', 'Data Engineer', 'Terna enviada', CURRENT_DATE - 6, CURRENT_DATE - 5, TRUE), ('Movizzon', 'QA Automation', 'Reclutamiento', CURRENT_DATE - 3, NULL, TRUE)`);
  await db.query(`INSERT INTO verif_e2e.ops_saas (cliente, cargo, estado, activado, meta, destacados, prueba) VALUES ('Quieta', 'Analista', 'Activa', CURRENT_DATE - 20, 10, 3, TRUE)`);
}

const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };
const leer = req => new Promise(ok => { let b = ''; req.on('data', c => b += c); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (_) { ok({}); } }); });
const json = (res, st, j) => { res.writeHead(st, { 'content-type': 'application/json' }); res.end(JSON.stringify(j)); };

sembrar().then(() => {
  http.createServer(async (req, res) => {
    const u = new URL(req.url, 'http://x');
    try {
      if (u.pathname === '/sdr/api/embudo') return json(res, 200, await Em.tablero(db, base));
      const m = u.pathname.match(/^\/sdr\/api\/embudo\/(\d+)\/mover$/);
      if (m && req.method === 'POST') { const b = await leer(req); return json(res, 200, await Em.mover(db, base, { dealId: m[1], ...b })); }
      if (u.pathname.startsWith('/sdr/api/') || u.pathname.startsWith('/api/')) return json(res, 200, {});
      const f = path.join(PUB, u.pathname === '/' ? 'index.html' : u.pathname);
      if (!f.startsWith(PUB) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TIPOS[path.extname(f)] || 'application/octet-stream' }); fs.createReadStream(f).pipe(res);
    } catch (e) { json(res, e.status || 500, { error: e.message }); }
  }).listen(Number(process.env.PORT || 4300), () => console.log('listo'));
}).catch(e => { console.error(e); process.exit(1); });

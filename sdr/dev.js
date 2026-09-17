// Servidor de desarrollo del módulo, sin Express. Sirve la pantalla y la API en /sdr con la
// misma tabla de rutas que producción.
//
//   DATABASE_URL=postgres://... node sdr/dev.js     → http://localhost:3100/sdr/
const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const { conectar } = require('./db');
const { rutas } = require('./rutas');
const { initSchema } = require('./schema');

const PORT = Number(process.env.SDR_DEV_PORT || 3100);
const PUBLIC = path.join(__dirname, 'public');
const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png' };

function compilar(ruta) {
  const nombres = [];
  const re = new RegExp('^' + ruta.replace(/:(\w+)/g, (_, n) => { nombres.push(n); return '([^/]+)'; }) + '$');
  return p => { const m = re.exec(p); return m && Object.fromEntries(nombres.map((n, i) => [n, decodeURIComponent(m[i + 1])])); };
}

async function main() {
  const db = conectar();
  await initSchema(db);
  const tabla = rutas({ db, config }).map(([m, r, h]) => ({ m: m.toUpperCase(), match: compilar(r), h }));

  http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/img/')) {                 // el logo vive en el public del Sandler
      const img = path.join(__dirname, '..', 'public', path.normalize(url.pathname));
      if (fs.existsSync(img)) { res.writeHead(200, { 'Content-Type': 'image/png' }); return fs.createReadStream(img).pipe(res); }
    }
    if (!url.pathname.startsWith('/sdr/')) { res.writeHead(302, { Location: '/sdr/' }); return res.end(); }
    const p = url.pathname.slice(4) || '/';
    const json = (s, o) => { res.writeHead(s, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };

    if (p.startsWith('/api/')) {
      for (const r of tabla) {
        const params = r.m === req.method && r.match(p);
        if (!params) continue;
        let body = '';
        for await (const c of req) body += c;
        try {
          return json(200, await r.h({ params, query: Object.fromEntries(url.searchParams), body: body ? JSON.parse(body) : {} }));
        } catch (e) {
          if (!e.status) console.error(e);
          return json(e.status || 500, { error: e.message });
        }
      }
      return json(404, { error: 'Ruta no encontrada' });
    }
    const archivo = path.join(PUBLIC, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const destino = fs.existsSync(archivo) && fs.statSync(archivo).isFile() ? archivo : path.join(PUBLIC, 'index.html');
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(destino)] || 'application/octet-stream' });
    fs.createReadStream(destino).pipe(res);
  }).listen(PORT, () => console.log(`[sdr/dev] http://localhost:${PORT}/sdr/`));
}

main().catch(e => { console.error(e); process.exit(1); });

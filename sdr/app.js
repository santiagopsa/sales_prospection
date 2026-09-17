// SDR Coach — módulo montable sobre el servidor del Sandler.
//
// En server.js, antes del SPA fallback:
//
//   const sdr = require('./sdr/app');
//   app.use('/sdr', sdr.router({ pool }));
//   sdr.initSchema(pool).catch(e => console.error('[sdr] schema:', e.message));
//
// Sin login por decisión de producto: quien tenga el enlace /sdr ve y opera todo.
const path = require('path');
const baseConfig = require('./config');
const { rutas } = require('./rutas');
const { initSchema } = require('./schema');

function router({ pool, config = baseConfig }) {
  const express = require('express');
  const r = express.Router();
  // La página usa rutas relativas (sdr.css, api/…): /sdr sin barra final las resolvería contra la raíz.
  r.get('/', (req, res, next) => (req.originalUrl.split('?')[0].endsWith('/') ? next() : res.redirect(301, req.baseUrl + '/')));
  r.use(express.static(path.join(__dirname, 'public')));
  for (const [metodo, ruta, handler] of rutas({ db: pool, config })) {
    r[metodo](ruta, async (req, res) => {
      try {
        res.json(await handler({ params: req.params, query: req.query, body: req.body }));
      } catch (e) {
        if (!e.status) console.error('[sdr]', req.method, req.originalUrl, e);
        res.status(e.status || 500).json({ error: e.status ? e.message : 'Error interno. El detalle quedó en el registro del servidor.' });
      }
    });
  }
  r.all('/api/*', (_req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));
  // La app es de una sola página: cualquier otra ruta bajo /sdr devuelve su index.
  r.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
  return r;
}

module.exports = { router, initSchema };

// Conexión para los comandos (cli.js, dev.js). El servidor NO usa esto: comparte el pool del Sandler.
function conectar(url = process.env.DATABASE_URL) {
  if (!url) throw new Error('Falta DATABASE_URL');
  let Pool;
  try { ({ Pool } = require('pg')); } catch (_) { Pool = null; }
  if (!Pool) {
    // Sin `pg` instalado (pruebas en una máquina sin npm): cliente mínimo, solo local.
    return require('./test/pg_mini').desdeUrl(url);
  }
  const local = /@(localhost|127\.0\.0\.1)|host=\//.test(url);
  const ssl = process.env.PGSSL === '1' || (!local && !/\.internal/.test(url)) ? { rejectUnauthorized: false } : false;
  return new Pool({ connectionString: url, ssl, max: 3, connectionTimeoutMillis: 8000 });
}

module.exports = { conectar };

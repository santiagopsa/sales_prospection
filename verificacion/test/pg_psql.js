// Un "pool" mínimo que habla con un Postgres LOCAL a través de psql, para probar el SQL real
// sin el paquete `pg`. Solo para pruebas: PG_PRUEBA="host=/tmp/pgt port=5499 user=postgres".
const { execFileSync } = require('child_process');
function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'number') return String(v);
  if (v instanceof Date) v = v.toISOString();
  const s = String(v);
  let tag = 'q'; while (s.includes(`$${tag}$`)) tag += 'q';
  return `$${tag}$${s}$${tag}$`;
}
function crearPool(conexion) {
  return {
    async query(texto, params = []) {
      const sql = texto.replace(/\$(\d+)/g, (_, i) => literal(params[Number(i) - 1]));
      const conFilas = /^\s*(SELECT|INSERT|UPDATE|DELETE|WITH)\b/i.test(sql);
      const final = conFilas ? `WITH q AS (${sql}) SELECT coalesce(json_agg(q), '[]'::json) FROM q` : sql;
      const out = execFileSync('psql', [conexion, '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-c', final], { encoding: 'utf8', env: { ...process.env, PGOPTIONS: '-c client_min_messages=warning' } });
      return { rows: conFilas ? JSON.parse(out.trim() || '[]') : [] };
    },
  };
}
module.exports = { crearPool };

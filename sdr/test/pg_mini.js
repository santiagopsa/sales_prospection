// Cliente mínimo de Postgres (protocolo simple, auth "trust") para probar el módulo donde no
// se puede instalar `pg`. Expone la misma forma que usa el módulo: query(sql, params) → { rows }.
// Los parámetros se incrustan como literales escapados; SOLO para pruebas locales.
const net = require('net');

const TIPOS = {
  16: v => v === 't',
  20: v => v, 1700: v => v,                   // int8 y numeric llegan como string, igual que en `pg`
  21: Number, 23: Number, 700: Number, 701: Number,
  114: JSON.parse, 3802: JSON.parse,
  1184: v => new Date(v.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00')),
};

function literal(v) {
  if (v === null || v === undefined) return 'NULL';
  if (typeof v === 'number') return String(v);
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (typeof v === 'object') v = JSON.stringify(v);
  return `'${String(v).replace(/'/g, "''")}'`;
}

function crear({ host = '/tmp', port = 5433, user = 'postgres', database = 'postgres' } = {}) {
  let sock, buf = Buffer.alloc(0), espera = null, cadena = Promise.resolve();
  let campos = [], filas = [], err = null;

  function onData(chunk) {
    buf = Buffer.concat([buf, chunk]);
    while (buf.length >= 5) {
      const tipo = String.fromCharCode(buf[0]);
      const len = buf.readInt32BE(1);
      if (buf.length < len + 1) break;
      const cuerpo = buf.subarray(5, len + 1);
      buf = buf.subarray(len + 1);
      mensaje(tipo, cuerpo);
    }
  }

  function mensaje(tipo, b) {
    if (tipo === 'T') {
      campos = []; filas = [];
      let o = 2;
      for (let i = 0; i < b.readInt16BE(0); i++) {
        const fin = b.indexOf(0, o);
        const nombre = b.toString('utf8', o, fin); o = fin + 1;
        const oid = b.readInt32BE(o + 6); o += 18;
        campos.push({ nombre, oid });
      }
    } else if (tipo === 'D') {
      const fila = {}; let o = 2;
      for (let i = 0; i < b.readInt16BE(0); i++) {
        const n = b.readInt32BE(o); o += 4;
        const c = campos[i];
        if (n === -1) fila[c.nombre] = null;
        else { const s = b.toString('utf8', o, o + n); o += n; fila[c.nombre] = (TIPOS[c.oid] || (x => x))(s); }
      }
      filas.push(fila);
    } else if (tipo === 'E') {
      const partes = {}; let o = 0;
      while (b[o]) { const k = String.fromCharCode(b[o]); const fin = b.indexOf(0, o + 1); partes[k] = b.toString('utf8', o + 1, fin); o = fin + 1; }
      err = Object.assign(new Error(partes.M), { code: partes.C, detail: partes.D });
    } else if (tipo === 'R' && b.readInt32BE(0) !== 0) {
      err = new Error('pg_mini solo soporta auth trust');
    } else if (tipo === 'Z' && espera) {
      const e = espera; espera = null;
      const res = { rows: filas, error: err };
      campos = []; filas = []; err = null;
      e(res);
    }
  }

  const listo = new Promise((ok, no) => {
    const opts = host.startsWith('/') ? { path: `${host}/.s.PGSQL.${port}` } : { host, port };
    sock = net.connect(opts, () => {
      const params = Buffer.from(`user\0${user}\0database\0${database}\0\0`);
      const h = Buffer.alloc(8); h.writeInt32BE(8 + params.length, 0); h.writeInt32BE(196608, 4);
      espera = r => (r.error ? no(r.error) : ok());
      sock.write(Buffer.concat([h, params]));
    });
    sock.on('data', onData);
    sock.on('error', no);
  });

  function query(sql, params = []) {
    const texto = sql.replace(/\$(\d+)/g, (_, i) => literal(params[Number(i) - 1]));
    const p = cadena.then(() => listo).then(() => new Promise((ok, no) => {
      espera = r => (r.error ? no(r.error) : ok({ rows: r.rows }));
      const q = Buffer.from(texto + '\0');
      const h = Buffer.alloc(5); h.write('Q'); h.writeInt32BE(4 + q.length, 1);
      sock.write(Buffer.concat([h, q]));
    }));
    cadena = p.catch(() => {});
    return p;
  }

  return { query, end: () => sock && sock.end() };
}

// DATABASE_URL de prueba: postgres://usuario@localhost:5433/base?host=/tmp
function desdeUrl(url) {
  const u = new URL(url);
  return crear({
    host: u.searchParams.get('host') || u.hostname || '/tmp',
    port: Number(u.searchParams.get('port') || u.port || 5432),
    user: decodeURIComponent(u.username || 'postgres'),
    database: u.pathname.replace(/^\//, '') || 'postgres',
  });
}

module.exports = { crear, desdeUrl };

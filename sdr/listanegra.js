// Lista negra: contactos y empresas que no se vuelven a tocar.
//
// Una entrada puede ser un teléfono, un correo, una EMPRESA (por nombre normalizado) o un
// DOMINIO de correo (acme.com). Entra por tres caminos: la razón "pidió que no lo contacten" al
// sacar un lead de la cola (automático), a mano desde la vista Lista negra, o una carga masiva
// desde la base de lista negra de Peaku (CSV/xlsx con columnas empresa, teléfono, correo, dominio,
// motivo). Se consulta en la carga de leads (esas filas quedan fuera con su motivo), en la
// marcación directa (se rechaza) y al reactivar. Un lead que ya existe y cae en la lista pasa a
// descartado con razón "lista_negra".
const { T } = require('./schema');
const { normalizarTelefono, parsearCsv, leerXlsx, decodificar } = require('./normalizar');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;

// Nombre de empresa normalizado: sin acentos ni mayúsculas, sin sufijos legales (S.A.S., Ltda.,
// Inc…), solo letras y números separados por un espacio. "Grupo Éxito S.A.S." → "grupo exito".
const SUFIJOS = ['sas', 'sa', 'ltda', 'ltd', 'llc', 'inc', 'bic', 'eu', 'cia', 'y cia', 'sc', 'spa', 'srl', 'corp', 'co', 'group', 'grupo', 'holding'];
function normalizarEmpresa(nombre) {
  let s = String(nombre || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' y ').replace(/[^a-z0-9]+/g, ' ').trim();
  if (!s) return null;
  const palabras = s.split(' ');
  // Quita sufijos legales al final (varias veces: "xyz s a s" → "xyz s a" → "xyz").
  let cambio = true;
  while (cambio && palabras.length > 1) {
    cambio = false;
    const ult = palabras[palabras.length - 1];
    if (SUFIJOS.includes(ult) || /^[a-z]$/.test(ult)) { palabras.pop(); cambio = true; }
  }
  return palabras.join(' ') || null;
}

// Dominio de un correo o una URL: "ana@Acme.com" / "https://www.acme.com/x" → "acme.com".
function dominioDe(valor) {
  let s = String(valor || '').trim().toLowerCase();
  if (!s) return null;
  if (s.includes('@')) s = s.split('@').pop();
  s = s.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '').split(/[/?#:]/)[0];
  return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(s) ? s : null;
}

async function listar(db, { limite = 1000 } = {}) {
  return (await db.query(
    `SELECT id, telefono, email, empresa, empresa_norm, dominio, razon, nota, lead_id, usuario, ${ms('created_at')} AS created_ms
     FROM ${T.lista_negra} ORDER BY created_at DESC, id DESC LIMIT $1`, [Math.min(Number(limite) || 1000, 20000)])).rows;
}

// ¿Cuáles de estos están en la lista? Devuelve sets de teléfonos, correos, empresas (normalizadas)
// y dominios que sí están.
async function enLista(db, telefonos = [], emails = [], empresas = [], dominios = []) {
  telefonos = telefonos.filter(Boolean); emails = emails.filter(Boolean);
  const empN = [...new Set(empresas.map(normalizarEmpresa).filter(Boolean))];
  const dom = [...new Set([...dominios, ...emails.map(dominioDe)].filter(Boolean))];
  const vacio = { telefonos: new Set(), emails: new Set(), empresas: new Set(), dominios: new Set() };
  if (!telefonos.length && !emails.length && !empN.length && !dom.length) return vacio;
  const r = await db.query(
    `SELECT telefono, email, empresa_norm, dominio FROM ${T.lista_negra}
     WHERE telefono IN (SELECT jsonb_array_elements_text($1::jsonb))
        OR email IN (SELECT jsonb_array_elements_text($2::jsonb))
        OR empresa_norm IN (SELECT jsonb_array_elements_text($3::jsonb))
        OR dominio IN (SELECT jsonb_array_elements_text($4::jsonb))`,
    [JSON.stringify(telefonos), JSON.stringify(emails), JSON.stringify(empN), JSON.stringify(dom)]);
  return {
    telefonos: new Set(r.rows.map(x => x.telefono).filter(Boolean)),
    emails: new Set(r.rows.map(x => x.email).filter(Boolean)),
    empresas: new Set(r.rows.map(x => x.empresa_norm).filter(Boolean)),
    dominios: new Set(r.rows.map(x => x.dominio).filter(Boolean)),
  };
}

// Por qué una fila de lead está en la lista (o null). Para el informe de la carga.
function motivoDe(ln, { telefono, email, empresa }) {
  if (telefono && ln.telefonos.has(telefono)) return 'teléfono en la lista negra';
  if (email && ln.emails.has(email)) return 'correo en la lista negra';
  const d = dominioDe(email);
  if (d && ln.dominios.has(d)) return `dominio ${d} en la lista negra`;
  const e = normalizarEmpresa(empresa);
  if (e && ln.empresas.has(e)) return 'empresa en la lista negra';
  return null;
}

// Limpia y valida una entrada. `todaEmpresa`: bloquear la empresa entera aunque venga teléfono.
function prepararEntrada(config, { telefono, email, empresa, dominio, todaEmpresa }) {
  let tel = null;
  if (telefono) {
    const n = normalizarTelefono(telefono, null, config);
    if (!n.e164) throw error(400, `Teléfono "${telefono}": ${n.error || 'inválido'}`);
    tel = n.e164;
  }
  email = email ? String(email).trim().toLowerCase() : null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw error(400, `Correo inválido: ${email}`);
  const dom = dominio ? dominioDe(dominio) : null;
  if (dominio && !dom) throw error(400, `Dominio inválido: ${dominio}`);
  const emp = empresa ? String(empresa).trim() || null : null;
  const empN = emp && (todaEmpresa || (!tel && !email)) ? normalizarEmpresa(emp) : null;
  if (!tel && !email && !empN && !dom) throw error(400, 'Escribe un teléfono, un correo, una empresa o un dominio');
  return { telefono: tel, email, empresa: emp, empresa_norm: empN, dominio: dom };
}

// Agrega una entrada. `c` puede ser el pool o un cliente dentro de una transacción. Si ya estaba
// (por cualquiera de sus llaves), no duplica: devuelve la existente.
async function agregar(c, config, { telefono, email, empresa, dominio, todaEmpresa, razon, nota, leadId, usuario }) {
  const e = prepararEntrada(config, { telefono, email, empresa, dominio, todaEmpresa });
  const previa = await c.query(
    `SELECT id, telefono, email, empresa, empresa_norm, dominio FROM ${T.lista_negra}
     WHERE ($1::text IS NOT NULL AND telefono = $1) OR ($2::text IS NOT NULL AND email = $2)
        OR ($3::text IS NOT NULL AND empresa_norm = $3) OR ($4::text IS NOT NULL AND dominio = $4) LIMIT 1`,
    [e.telefono, e.email, e.empresa_norm, e.dominio]);
  if (previa.rows.length) return { ...previa.rows[0], existente: true };
  const r = await c.query(
    `INSERT INTO ${T.lista_negra} (telefono, email, empresa, empresa_norm, dominio, razon, nota, lead_id, usuario)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, telefono, email, empresa, empresa_norm, dominio`,
    [e.telefono, e.email, e.empresa, e.empresa_norm, e.dominio, razon || null, nota || null, leadId || null, usuario || null]);
  return { ...r.rows[0], existente: false };
}

// Leads existentes que coinciden con una entrada (para descartarlos al meterla).
async function leadsQueCoinciden(c, { telefono, email, empresa_norm, dominio }) {
  const r = await c.query(
    `SELECT id, etapa, empresa, email, telefono FROM ${T.leads}
     WHERE ($1::text IS NOT NULL AND telefono = $1) OR ($2::text IS NOT NULL AND email = $2)
        OR ($4::text IS NOT NULL AND email LIKE '%@' || $4)
        OR ($3::text IS NOT NULL AND etapa <> 'descartado')`,
    [telefono || null, email || null, empresa_norm || null, dominio || null]);
  // La empresa se compara normalizada en JS (no hay columna normalizada en leads).
  return r.rows.filter(l => (telefono && l.telefono === telefono) || (email && l.email === email) || (dominio && l.email && dominioDe(l.email) === dominio) || (empresa_norm && normalizarEmpresa(l.empresa) === empresa_norm));
}

async function quitar(db, id) {
  const r = await db.query(`DELETE FROM ${T.lista_negra} WHERE id = $1 RETURNING id`, [Number(id)]);
  if (!r.rows.length) throw error(404, 'No está en la lista');
  return { ok: true };
}

// --- Carga masiva desde la base de lista negra de Peaku ------------------------------------

const clave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const COLS = {
  empresa: ['empresa', 'company', 'companyname', 'compania', 'razonsocial', 'cliente', 'nombre', 'name', 'organizacion', 'cuenta'],
  telefono: ['telefono', 'tel', 'celular', 'movil', 'phone', 'mobile', 'numero', 'whatsapp'],
  email: ['correo', 'email', 'mail', 'correoelectronico'],
  dominio: ['dominio', 'domain', 'sitioweb', 'website', 'web', 'url', 'pagina'],
  nota: ['motivo', 'nota', 'razon', 'reason', 'comentario', 'observacion', 'observaciones', 'tipo', 'categoria'],
};

// Lee el archivo y devuelve las filas listas para agregar, más errores por fila.
function leerArchivoLista(entrada, nombre = '', config = {}) {
  let tabla;
  if (/\.xlsx$/i.test(nombre) || Buffer.isBuffer(entrada) && !/\.csv$/i.test(nombre)) {
    try { tabla = leerXlsx(Buffer.isBuffer(entrada) ? entrada : Buffer.from(String(entrada), 'base64')); }
    catch (e) { return { error: 'No pude leer el .xlsx: ' + e.message }; }
  } else tabla = parsearCsv(Buffer.isBuffer(entrada) ? decodificar(entrada) : String(entrada));
  if (!tabla.length) return { error: 'El archivo está vacío.' };
  const [enc, ...cuerpo] = tabla;
  const col = {};
  enc.forEach((h, i) => { const k = clave(h); for (const [campo, alias] of Object.entries(COLS)) if (col[campo] === undefined && alias.includes(k)) col[campo] = i; });
  if (col.empresa === undefined && col.telefono === undefined && col.email === undefined && col.dominio === undefined) {
    return { error: `No encontré columnas de empresa, teléfono, correo o dominio. Encabezados leídos: ${enc.map(h => `"${h}"`).join(', ')}.` };
  }
  const filas = [], errores = [];
  const limpio = v => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s || null; };
  cuerpo.forEach((celdas, i) => {
    const fila = i + 2;
    const v = campo => (col[campo] === undefined ? null : limpio(celdas[col[campo]]));
    if (!v('empresa') && !v('telefono') && !v('email') && !v('dominio')) return;
    try {
      // Una fila de la base de empresas bloquea la empresa entera (y su dominio si viene).
      const e = prepararEntrada(config, { telefono: v('telefono'), email: v('email'), empresa: v('empresa'), dominio: v('dominio'), todaEmpresa: true });
      filas.push({ fila, ...e, nota: v('nota') });
    } catch (err) { errores.push({ fila, empresa: v('empresa'), motivo: err.message }); }
  });
  return { columnas: Object.fromEntries(Object.entries(col).map(([k, i]) => [k, enc[i]])), filas, errores };
}

// Carga masiva. `simular` = solo el informe. Al cargar, los leads que coincidan pasan a descartado.
async function importarLista(db, config, { archivo, contenido, simular = true, usuario = null, ahora = new Date() }) {
  const leido = leerArchivoLista(contenido, archivo || '', config);
  if (leido.error) throw error(400, leido.error);
  const informe = { archivo: archivo || null, columnas: leido.columnas, filas: leido.filas.length + leido.errores.length, errores: leido.errores, nuevos: [], repetidos: [], leads_descartados: 0, simulado: !!simular };
  // Repetidos contra la base y dentro del archivo.
  const ln = await enLista(db, leido.filas.map(f => f.telefono), leido.filas.map(f => f.email), [], leido.filas.map(f => f.dominio));
  const empN = [...new Set(leido.filas.map(f => f.empresa_norm).filter(Boolean))];
  const enBase = empN.length ? new Set((await db.query(`SELECT empresa_norm FROM ${T.lista_negra} WHERE empresa_norm IN (SELECT jsonb_array_elements_text($1::jsonb))`, [JSON.stringify(empN)])).rows.map(x => x.empresa_norm)) : new Set();
  const vistos = new Set();
  const aCargar = [];
  for (const f of leido.filas) {
    const llaves = [f.telefono && 't:' + f.telefono, f.email && 'e:' + f.email, f.empresa_norm && 'n:' + f.empresa_norm, f.dominio && 'd:' + f.dominio].filter(Boolean);
    const ya = (f.telefono && ln.telefonos.has(f.telefono)) || (f.email && ln.emails.has(f.email)) || (f.dominio && ln.dominios.has(f.dominio)) || (f.empresa_norm && enBase.has(f.empresa_norm));
    const repetidoArchivo = llaves.some(k => vistos.has(k));
    llaves.forEach(k => vistos.add(k));
    if (ya || repetidoArchivo) { informe.repetidos.push({ fila: f.fila, empresa: f.empresa, motivo: ya ? 'ya estaba en la lista' : 'repetido en el archivo' }); continue; }
    aCargar.push(f);
  }
  informe.nuevos = aCargar.map(f => ({ fila: f.fila, empresa: f.empresa, telefono: f.telefono, email: f.email, dominio: f.dominio }));
  if (simular) return informe;
  const { enTransaccion } = require('./resultados');
  await enTransaccion(db, async c => {
    for (const f of aCargar) {
      const e = await agregar(c, config, { ...f, todaEmpresa: true, razon: 'lista_negra', nota: f.nota, usuario });
      if (e.existente) continue;
      for (const l of await leadsQueCoinciden(c, e)) {
        if (l.etapa === 'descartado') continue;
        await c.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = NOW() WHERE lead_id = $1 AND estado = 'pendiente'`, [l.id]);
        await c.query(`UPDATE ${T.leads} SET etapa = 'descartado', etapa_at = NOW(), razon_descarte = 'lista_negra', pausado_hasta = NULL, updated_at = NOW() WHERE id = $1`, [l.id]);
        await c.query(`INSERT INTO ${T.touches} (lead_id, canal, resultado, razon_descarte, nota, usuario, created_at) VALUES ($1, 'ejecutiva', 'descartado', 'lista_negra', $2, $3, $4)`,
          [l.id, `Cargada la lista negra${archivo ? ' (' + archivo + ')' : ''}${f.nota ? ': ' + f.nota : ''}`, usuario, ahora.toISOString()]);
        informe.leads_descartados++;
      }
    }
  });
  return informe;
}

module.exports = { listar, enLista, motivoDe, agregar, leadsQueCoinciden, quitar, normalizarEmpresa, dominioDe, leerArchivoLista, importarLista, prepararEntrada };

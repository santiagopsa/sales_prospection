// Del archivo que sube Angie a filas limpias. Sin dependencias: el CSV que exporta Excel en
// Colombia viene con ";" y a veces en Windows-1252; el navegador resuelve la codificación y
// aquí se resuelve el separador, las comillas y los nombres de columna.

// --- CSV --------------------------------------------------------------------

// Bytes del archivo a texto: UTF-8 si es válido, si no Windows-1252 (lo que guarda Excel en Windows).
// El navegador hace lo mismo del lado de Angie; esta versión la usa el comando de la terminal.
function decodificar(bytes) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (_) { return new TextDecoder('windows-1252').decode(bytes); }
}

function detectarSeparador(texto) {
  const linea = texto.split(/\r?\n/, 1)[0] || '';
  let enComillas = false;
  const cuenta = { ',': 0, ';': 0, '\t': 0 };
  for (const ch of linea) {
    if (ch === '"') enComillas = !enComillas;
    else if (!enComillas && ch in cuenta) cuenta[ch]++;
  }
  const [mejor, n] = Object.entries(cuenta).sort((a, b) => b[1] - a[1])[0];
  return n > 0 ? mejor : ',';
}

// RFC 4180: comillas dobles, comillas escapadas ("") y saltos de línea dentro de un campo.
function parsearCsv(texto, sep = detectarSeparador(texto)) {
  texto = String(texto || '').replace(/^\uFEFF/, '');
  const filas = [];
  let fila = [], campo = '', enComillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (enComillas) {
      if (ch === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else enComillas = false;
      } else campo += ch;
    } else if (ch === '"') enComillas = true;
    else if (ch === sep) { fila.push(campo); campo = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); filas.push(fila); fila = []; campo = '';
    } else campo += ch;
  }
  if (campo !== '' || fila.length) { fila.push(campo); filas.push(fila); }
  return filas.filter(f => f.some(c => c.trim() !== ''));
}

// --- XLSX ---------------------------------------------------------------------
// Lector mínimo de .xlsx (zip + XML) para no depender de librerías: lee la primera hoja,
// resuelve las cadenas compartidas y devuelve una tabla de textos, como parsearCsv.
// Los números salen como los guarda Excel ("3.016572696E9"): normalizarTelefono los entiende.

function zipEntradas(buf) {
  // Directorio central al final del archivo.
  const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (eocd < 0) throw new Error('No es un archivo .xlsx válido');
  const n = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const entradas = {};
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28), extraLen = buf.readUInt16LE(off + 30), comLen = buf.readUInt16LE(off + 32);
    const local = buf.readUInt32LE(off + 42);
    const nombre = buf.toString('utf8', off + 46, off + 46 + nameLen);
    entradas[nombre] = { metodo, compSize, local };
    off += 46 + nameLen + extraLen + comLen;
  }
  const zlib = require('zlib');
  return nombre => {
    const e = entradas[nombre];
    if (!e) return null;
    const nl = buf.readUInt16LE(e.local + 26), xl = buf.readUInt16LE(e.local + 28);
    const datos = buf.subarray(e.local + 30 + nl + xl, e.local + 30 + nl + xl + e.compSize);
    return (e.metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString('utf8');
  };
}

const desXml = t => t
  .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

function leerXlsx(buf) {
  const leer = zipEntradas(Buffer.isBuffer(buf) ? buf : Buffer.from(buf));
  const compartidas = [];
  const sst = leer('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
    compartidas.push(desXml([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join('')));
  }
  // Primera hoja: la que apunta la primera <sheet> del workbook.
  const wb = leer('xl/workbook.xml') || '';
  const rels = leer('xl/_rels/workbook.xml.rels') || '';
  const rid = (wb.match(/<sheet [^>]*r:id="([^"]+)"/) || [])[1];
  const target = rid && (rels.match(new RegExp(`<Relationship [^>]*Id="${rid}"[^>]*Target="([^"]+)"`)) || [])[1];
  const hoja = leer(target ? (target.startsWith('/') ? target.slice(1) : 'xl/' + target) : 'xl/worksheets/sheet1.xml');
  if (!hoja) throw new Error('El .xlsx no tiene hojas');
  const colIdx = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
  const filas = [];
  for (const fila of hoja.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const celdas = [];
    for (const c of fila[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const i = colIdx(c[1]);
      const attrs = c[2] || '', cuerpo = c[3] || '';
      const tipo = (attrs.match(/t="(\w+)"/) || [])[1];
      let v = '';
      if (tipo === 's') v = compartidas[Number((cuerpo.match(/<v>([^<]*)<\/v>/) || [])[1])] || '';
      else if (tipo === 'inlineStr') v = desXml([...cuerpo.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map(x => x[1]).join(''));
      else v = desXml((cuerpo.match(/<v>([^<]*)<\/v>/) || [])[1] || '');
      while (celdas.length < i) celdas.push('');
      celdas[i] = v;
    }
    filas.push(celdas);
  }
  return filas.filter(f => f.some(c => String(c).trim() !== ''));
}

// --- Columnas -----------------------------------------------------------------

const clave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

// Nombres en español y los de una exportación de Apollo. Para teléfono y ciudad hay varias
// columnas candidatas en orden de preferencia: se toma la primera que traiga un valor válido.
const ALIAS = {
  empresa: ['empresa', 'company', 'compania', 'companyname', 'organizacion', 'cuenta', 'razonsocial', 'cliente'],
  contacto: ['contacto', 'nombre', 'name', 'nombrecompleto', 'fullname', 'persona', 'nombres', 'firstname'],
  apellido: ['apellido', 'apellidos', 'lastname'],
  cargo: ['cargo', 'titulo', 'title', 'jobtitle', 'puesto', 'rol', 'position'],
  email: ['correo', 'email', 'mail', 'correoelectronico', 'emailaddress', 'ecorreo'],
  fuente: ['fuente', 'source', 'origen', 'lista', 'lists'],
};
const ALIAS_TELEFONO = ['telefono', 'tel', 'celular', 'movil', 'phone', 'mobile', 'whatsapp', 'numero', 'telefonomovil', 'phonenumber',
  'mobilephone', 'workdirectphone', 'corporatephone', 'companyphone', 'otherphone', 'homephone'];
const ALIAS_CIUDAD = ['ciudad', 'city', 'ubicacion', 'location', 'companycity'];
// Contexto que vale la pena conservar para la ficha (Apollo). Clave normalizada → nombre en el lead.
const ALIAS_EXTRA = {
  industry: 'industria', seniority: 'seniority', departments: 'departamento', employees: 'empleados',
  country: 'pais', companycountry: 'pais_empresa', state: 'region', personlinkedinurl: 'linkedin', website: 'sitio_web',
  companylinkedinurl: 'linkedin_empresa', keywords: 'keywords', technologies: 'tecnologias', annualrevenue: 'ingresos',
  donotcall: 'no_llamar', stage: 'apollo_stage', lastcontacted: 'apollo_ultimo_contacto',
};

function mapearColumnas(encabezados) {
  const mapa = { telefonos: [], ciudades: [], extra: {} };
  encabezados.forEach((h, i) => {
    const k = clave(h);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (mapa[campo] === undefined && alias.includes(k)) { mapa[campo] = i; return; }
    }
    if (ALIAS_TELEFONO.includes(k)) return mapa.telefonos.push({ i, orden: ALIAS_TELEFONO.indexOf(k) });
    if (ALIAS_CIUDAD.includes(k)) return mapa.ciudades.push({ i, orden: ALIAS_CIUDAD.indexOf(k) });
    if (ALIAS_EXTRA[k] && mapa.extra[ALIAS_EXTRA[k]] === undefined) mapa.extra[ALIAS_EXTRA[k]] = i;
  });
  mapa.telefonos.sort((a, b) => a.orden - b.orden);
  mapa.ciudades.sort((a, b) => a.orden - b.orden);
  return mapa;
}

// --- Teléfono -----------------------------------------------------------------

// Indicativos de fijo (formato 2021: 60 + indicativo viejo + 7 dígitos) para cuando el
// archivo trae el fijo de 7 dígitos sin indicativo y la ciudad sí viene.
const INDICATIVO_CIUDAD = {
  bogota: '1', medellin: '4', envigado: '4', itagui: '4', sabaneta: '4', bello: '4', rionegro: '4',
  cali: '2', pasto: '2', popayan: '2',
  barranquilla: '5', cartagena: '5', santamarta: '5', monteria: '5', sincelejo: '5', valledupar: '5',
  pereira: '6', manizales: '6', armenia: '6',
  bucaramanga: '7', cucuta: '7',
  ibague: '8', neiva: '8', villavicencio: '8',
};

// Devuelve { e164 } o { error }. Colombia es el país por defecto: cualquier otro país tiene
// que venir con su indicativo (+52, +56…), porque adivinarlo sería inventar el número.
function normalizarTelefono(valor, ciudad) {
  let bruto = String(valor == null ? '' : valor).trim();
  if (!bruto) return { e164: null };
  // Excel guarda los números como 3.016572696E9 o 3016572696.0: se vuelven enteros.
  if (/^\d+(\.\d+)?E\+?\d+$/i.test(bruto) || /^\d+\.0+$/.test(bruto)) bruto = BigInt(Math.round(Number(bruto))).toString();
  let s = bruto.replace(/(ext|extension|ext\.|x)\s*\d+$/i, '');
  const conMas = /^\s*\+/.test(s) || /^\s*00/.test(s);
  let d = s.replace(/\D/g, '');
  if (/^\s*00/.test(s)) d = d.slice(2);

  const con = r => (r.e164 ? { ...r, texto: bruto } : r);
  if (conMas) {
    if (d.length < 8 || d.length > 15) return { error: 'teléfono con indicativo de longitud inválida' };
    if (d.startsWith('57')) return con(validarColombia(d.slice(2)));
    return { e164: '+' + d, texto: bruto };
  }
  if (d.length === 12 && d.startsWith('57')) return con(validarColombia(d.slice(2)));
  if (d.length === 10) return con(validarColombia(d));
  if (d.length === 8 && /^[1-8]/.test(d)) return { e164: '+5760' + d, texto: bruto };          // fijo viejo con indicativo
  if (d.length === 7) {
    const ind = INDICATIVO_CIUDAD[clave(ciudad)];
    if (ind) return { e164: '+5760' + ind + d, texto: bruto };
    return { error: 'fijo de 7 dígitos sin indicativo y sin ciudad conocida' };
  }
  return { error: 'no parece un número colombiano; si es de otro país, agrega el indicativo (+52, +56…)' };
}

function validarColombia(d) {
  if (d.length === 10 && (d.startsWith('3') || d.startsWith('60'))) return { e164: '+57' + d };
  return { error: 'número colombiano inválido (celular 3xx o fijo 60x, 10 dígitos)' };
}

// --- Correo -------------------------------------------------------------------

function normalizarEmail(valor) {
  const s = String(valor || '').trim().toLowerCase().replace(/^mailto:/, '');
  if (!s) return { email: null };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s)) return { error: 'correo inválido' };
  return { email: s };
}

// --- Filas ----------------------------------------------------------------------

const limpio = v => { const s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim(); return s || null; };

// De un archivo a { columnas, filas:[{ fila, lead, avisos }], errores:[{ fila, motivo }] }.
// `entrada` es el texto de un CSV o un Buffer/base64 de un .xlsx (nombre con esa extensión).
// `fila` es el número de línea como lo ve Angie en Excel (el encabezado es la 1).
function leerArchivo(entrada, nombre = '') {
  let tabla;
  if (/\.xlsx$/i.test(nombre) || Buffer.isBuffer(entrada)) {
    try { tabla = leerXlsx(Buffer.isBuffer(entrada) ? entrada : Buffer.from(String(entrada), 'base64')); }
    catch (e) { return { error: 'No pude leer el .xlsx: ' + e.message }; }
  } else tabla = parsearCsv(entrada);
  if (!tabla.length) return { error: 'El archivo está vacío.' };
  const [enc, ...cuerpo] = tabla;
  const col = mapearColumnas(enc);
  const faltan = [];
  if (col.empresa === undefined && col.contacto === undefined) faltan.push('empresa (o al menos nombre)');
  if (!col.telefonos.length && col.email === undefined) faltan.push('teléfono o correo');
  if (faltan.length) {
    return { error: `No encontré la columna de ${faltan.join(' y ')}. Encabezados leídos: ${enc.map(h => `"${h}"`).join(', ')}.` };
  }

  const filas = [], errores = [];
  cuerpo.forEach((celdas, i) => {
    const fila = i + 2;
    const celda = idx => (idx === undefined ? null : limpio(celdas[idx]));
    const v = campo => celda(col[campo]);
    const avisos = [];
    const contacto = [v('contacto'), v('apellido')].filter(Boolean).join(' ') || null;
    // Sin empresa, el lead se llama como el contacto (un celular suelto de Apollo sigue siendo un lead).
    const empresa = v('empresa') || contacto;
    const ciudad = col.ciudades.map(c => celda(c.i)).find(Boolean) || null;
    // Primer teléfono válido entre las columnas candidatas; los inválidos quedan como aviso.
    let tel = { e164: null }, telOriginal = null;
    for (const c of col.telefonos) {
      const bruto = celda(c.i);
      if (!bruto) continue;
      const t = normalizarTelefono(bruto, ciudad);
      if (t.e164) { tel = t; telOriginal = t.texto || bruto; break; }
      avisos.push(`teléfono "${bruto}": ${t.error}`);
    }
    const mail = normalizarEmail(v('email'));
    if (mail.error) avisos.push(`correo "${v('email')}": ${mail.error}`);
    const extra = {};
    for (const [k, idx] of Object.entries(col.extra)) { const x = celda(idx); if (x) extra[k] = x; }
    if (/^(true|yes|si|sí|1)$/i.test(extra.no_llamar || '')) return errores.push({ fila, empresa, motivo: 'marcado como "Do Not Call" en Apollo' });
    delete extra.no_llamar;
    if (!empresa) return errores.push({ fila, empresa: null, motivo: 'sin empresa ni nombre' });
    if (!tel.e164 && !mail.email) {
      return errores.push({ fila, empresa, motivo: avisos.length ? avisos.join('; ') : 'sin teléfono ni correo' });
    }
    filas.push({
      fila,
      avisos,
      lead: {
        empresa, contacto, cargo: v('cargo'),
        telefono: tel.e164 || null, telefono_original: telOriginal,
        email: mail.email || null, ciudad, fuente: v('fuente'),
        extra: Object.keys(extra).length ? extra : null,
      },
    });
  });
  const columnas = {};
  for (const k of ['empresa', 'contacto', 'apellido', 'cargo', 'email', 'fuente']) if (col[k] !== undefined) columnas[k] = enc[col[k]];
  if (col.telefonos.length) columnas.telefono = col.telefonos.map(c => enc[c.i]).join(' → ');
  if (col.ciudades.length) columnas.ciudad = col.ciudades.map(c => enc[c.i]).join(' → ');
  for (const [k, idx] of Object.entries(col.extra)) columnas[k] = enc[idx];
  return { columnas, filas, errores };
}

module.exports = { decodificar, detectarSeparador, parsearCsv, leerXlsx, mapearColumnas, normalizarTelefono, normalizarEmail, leerArchivo };

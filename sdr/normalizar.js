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

// --- Columnas -----------------------------------------------------------------

const clave = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIAS = {
  empresa: ['empresa', 'company', 'compania', 'companyname', 'organizacion', 'cuenta', 'razonsocial', 'cliente'],
  contacto: ['contacto', 'nombre', 'name', 'nombrecompleto', 'fullname', 'persona', 'nombres', 'firstname'],
  apellido: ['apellido', 'apellidos', 'lastname'],
  cargo: ['cargo', 'titulo', 'title', 'jobtitle', 'puesto', 'rol', 'position'],
  telefono: ['telefono', 'tel', 'celular', 'movil', 'phone', 'mobile', 'whatsapp', 'numero', 'telefonomovil', 'phonenumber'],
  email: ['correo', 'email', 'mail', 'correoelectronico', 'emailaddress', 'ecorreo'],
  ciudad: ['ciudad', 'city', 'ubicacion', 'location'],
  fuente: ['fuente', 'source', 'origen', 'lista'],
};

function mapearColumnas(encabezados) {
  const mapa = {};
  encabezados.forEach((h, i) => {
    const k = clave(h);
    for (const [campo, alias] of Object.entries(ALIAS)) {
      if (mapa[campo] === undefined && alias.includes(k)) { mapa[campo] = i; break; }
    }
  });
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
  const bruto = String(valor || '').trim();
  if (!bruto) return { e164: null };
  let s = bruto.replace(/(ext|extension|ext\.|x)\s*\d+$/i, '');
  const conMas = /^\s*\+/.test(s) || /^\s*00/.test(s);
  let d = s.replace(/\D/g, '');
  if (/^\s*00/.test(s)) d = d.slice(2);

  if (conMas) {
    if (d.length < 8 || d.length > 15) return { error: 'teléfono con indicativo de longitud inválida' };
    if (d.startsWith('57')) return validarColombia(d.slice(2));
    return { e164: '+' + d };
  }
  if (d.length === 12 && d.startsWith('57')) return validarColombia(d.slice(2));
  if (d.length === 10) return validarColombia(d);
  if (d.length === 8 && /^[1-8]/.test(d)) return { e164: '+5760' + d };          // fijo viejo con indicativo
  if (d.length === 7) {
    const ind = INDICATIVO_CIUDAD[clave(ciudad)];
    if (ind) return { e164: '+5760' + ind + d };
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

// Del texto del archivo a { columnas, filas:[{ fila, lead, avisos }], errores:[{ fila, motivo }] }.
// `fila` es el número de línea como lo ve Angie en Excel (el encabezado es la 1).
function leerArchivo(texto) {
  const tabla = parsearCsv(texto);
  if (!tabla.length) return { error: 'El archivo está vacío.' };
  const [enc, ...cuerpo] = tabla;
  const col = mapearColumnas(enc);
  const faltan = [];
  if (col.empresa === undefined) faltan.push('empresa');
  if (col.telefono === undefined && col.email === undefined) faltan.push('teléfono o correo');
  if (faltan.length) {
    return { error: `No encontré la columna de ${faltan.join(' y ')}. Encabezados leídos: ${enc.map(h => `"${h}"`).join(', ')}.` };
  }

  const filas = [], errores = [];
  cuerpo.forEach((celdas, i) => {
    const fila = i + 2;
    const v = campo => (col[campo] === undefined ? null : limpio(celdas[col[campo]]));
    const avisos = [];
    const empresa = v('empresa');
    const ciudad = v('ciudad');
    const tel = normalizarTelefono(v('telefono'), ciudad);
    const mail = normalizarEmail(v('email'));
    if (tel.error) avisos.push(`teléfono "${v('telefono')}": ${tel.error}`);
    if (mail.error) avisos.push(`correo "${v('email')}": ${mail.error}`);
    if (!empresa) return errores.push({ fila, empresa: null, motivo: 'sin empresa' });
    if (!tel.e164 && !mail.email) {
      return errores.push({ fila, empresa, motivo: avisos.length ? avisos.join('; ') : 'sin teléfono ni correo' });
    }
    const contacto = [v('contacto'), v('apellido')].filter(Boolean).join(' ') || null;
    filas.push({
      fila,
      avisos,
      lead: {
        empresa, contacto, cargo: v('cargo'),
        telefono: tel.e164 || null, telefono_original: v('telefono'),
        email: mail.email || null, ciudad, fuente: v('fuente'),
      },
    });
  });
  const columnas = Object.fromEntries(Object.entries(col).map(([k, i]) => [k, enc[i]]));
  return { columnas, filas, errores };
}

module.exports = { decodificar, detectarSeparador, parsearCsv, mapearColumnas, normalizarTelefono, normalizarEmail, leerArchivo };

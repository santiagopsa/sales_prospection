// Cliente mínimo de la Management API de Voximplant, sin dependencias.
// Se autentica con la llave JSON de un service account (RS256 → JWT), como pide la API.
const crypto = require('crypto');
const fs = require('fs');

const BASE = 'https://api.voximplant.com/platform_api/';

const b64url = b => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

function leerLlave(ruta) {
  let k;
  try { k = JSON.parse(fs.readFileSync(ruta, 'utf8')); }
  catch (e) { throw new Error(`No pude leer la llave de Voximplant en ${ruta}: ${e.message}`); }
  for (const campo of ['account_id', 'key_id', 'private_key']) {
    if (!k[campo]) throw new Error(`La llave ${ruta} no trae "${campo}"; descarga el JSON del service account otra vez.`);
  }
  return k;
}

function jwt(llave) {
  const ahora = Math.floor(Date.now() / 1000);
  const cab = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: llave.key_id }));
  const cuerpo = b64url(JSON.stringify({ iss: llave.account_id, iat: ahora, exp: ahora + 3000 }));
  const firma = crypto.sign('RSA-SHA256', Buffer.from(`${cab}.${cuerpo}`), llave.private_key);
  return `${cab}.${cuerpo}.${b64url(firma)}`;
}

function crearCliente(llave) {
  let token = null, tokenHasta = 0;
  return async function llamar(metodo, params = {}) {
    if (!token || Date.now() > tokenHasta) { token = jwt(llave); tokenHasta = Date.now() + 45 * 60 * 1000; }
    const body = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null) body.append(k, String(v));
    const r = await fetch(BASE + metodo + '/', { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body });
    let json;
    try { json = await r.json(); } catch (_) { throw new Error(`${metodo}: respuesta no válida (${r.status})`); }
    if (json.error) throw new Error(`${metodo}: ${json.error.msg || JSON.stringify(json.error)} (código ${json.error.code})`);
    return json;
  };
}

module.exports = { leerLlave, jwt, crearCliente };

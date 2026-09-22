// vox:setup — deja la cuenta de Voximplant lista para SDR Coach. Idempotente: se puede correr
// las veces que haga falta (por ejemplo, para subir el escenario después de cambiar el aviso).
//
//   node sdr/cli.js vox:setup [--key sdr/voximplant-key.json] [--url https://peaku-sandler.onrender.com] [--numero +57...] [--rotar]
//
// Crea o reutiliza: aplicación "sdr", usuario "angie", escenario "sdr-llamada", regla ".*" y
// amarra el número. Imprime las variables para Render. Corre en la máquina de quien tenga la
// llave; el servidor nunca la necesita.
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const { leerLlave, crearCliente } = require('./api');
const { generarEscenario } = require('./escenario');

const APP = 'sdr';
const USUARIO = 'angie';
const ESCENARIO = 'sdr-llamada';
const REGLA = 'sdr-saliente';

function clave(n = 24) { return crypto.randomBytes(n).toString('base64url'); }

function leerEnvPrevio(archivo) {
  try {
    return Object.fromEntries(fs.readFileSync(archivo, 'utf8').split(/\r?\n/).filter(l => l.includes('=')).map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  } catch (_) { return {}; }
}

async function setup({ key, url, numero, rotar = false, config, log = console.log }) {
  const rutaLlave = key || path.join(__dirname, '..', 'voximplant-key.json');
  const llave = leerLlave(rutaLlave);
  const api = crearCliente(llave);
  const publicUrl = (url || process.env.PUBLIC_URL || config.PUBLIC_URL_POR_DEFECTO || '').replace(/\/$/, '');
  if (!/^https:\/\//.test(publicUrl)) throw new Error('Falta la URL pública de Render (--url https://…)');

  const cuenta = (await api('GetAccountInfo')).result;
  log(`Cuenta: ${cuenta.account_name} (id ${cuenta.account_id})`);

  // Aplicación
  let app = (await api('GetApplications', { application_name: APP })).result.find(a => a.application_name === APP || a.application_name === `${APP}.${cuenta.account_name}.voximplant.com`);
  if (!app) { const r = await api('AddApplication', { application_name: APP }); app = { application_id: r.application_id, application_name: APP }; log(`Aplicación "${APP}" creada`); }
  else log(`Aplicación "${APP}" ya existía (id ${app.application_id})`);
  const appId = app.application_id;

  // Contraseña y secreto: si ya corrió antes, se reutilizan los del archivo voximplant-render.env
  // para no invalidar lo que está en Render. Con --rotar se generan nuevos.
  const archivo = path.join(path.dirname(rutaLlave), 'voximplant-render.env');
  const previo = leerEnvPrevio(archivo);
  const password = (!rotar && previo.VOX_USER_PASSWORD) || clave(18);
  const secreto = (!rotar && previo.VOX_WEBHOOK_SECRET) || clave(24);
  const usuarios = (await api('GetUsers', { application_id: appId, user_name: USUARIO })).result;
  if (usuarios.length) {
    await api('SetUserInfo', { user_id: usuarios[0].user_id, user_password: password });
    log(`Usuario "${USUARIO}" ya existía: contraseña ${previo.VOX_USER_PASSWORD && !rotar ? 'conservada' : 'rotada'}`);
  } else { await api('AddUser', { user_name: USUARIO, user_display_name: 'Angie · SDR Peaku', user_password: password, application_id: appId }); log(`Usuario "${USUARIO}" creado`); }

  // Número
  const numeros = (await api('GetPhoneNumbers', { count: 100 })).result;
  const e164 = numero ? '+' + String(numero).replace(/\D/g, '') : null;
  const tel = e164 ? numeros.find(n => '+' + String(n.phone_number).replace(/\D/g, '') === e164) : (numeros.length === 1 ? numeros[0] : null);
  if (!tel) {
    throw new Error(numeros.length
      ? `No encontré el número ${e164 || ''}. Números en la cuenta: ${numeros.map(n => n.phone_number).join(', ')}. Indícalo con --numero.`
      : 'La cuenta no tiene números comprados todavía.');
  }
  const callerId = '+' + String(tel.phone_number).replace(/\D/g, '');

  // Escenario (se crea o se reemplaza)
  const script = generarEscenario({
    callerId, secreto, webhookUrl: `${publicUrl}/sdr/api/vox/webhook`,
    aviso: config.AVISO_GRABACION, voz: config.VOZ_AVISO, avisoATodos: config.AVISO_TAMBIEN_A_ANGIE,
  });
  let esc = (await api('GetScenarios', { scenario_name: ESCENARIO })).result.find(s => s.scenario_name === ESCENARIO);
  if (esc) { await api('SetScenarioInfo', { scenario_id: esc.scenario_id, scenario_script: script }); log(`Escenario "${ESCENARIO}" actualizado`); }
  else { const r = await api('AddScenario', { scenario_name: ESCENARIO, scenario_script: script }); esc = { scenario_id: r.scenario_id }; log(`Escenario "${ESCENARIO}" creado`); }

  // Regla: cualquier destino marcado desde la app pasa por el escenario
  let regla = (await api('GetRules', { application_id: appId, rule_name: REGLA })).result.find(r => r.rule_name === REGLA);
  if (!regla) { const r = await api('AddRule', { application_id: appId, rule_name: REGLA, rule_pattern: '.*' }); regla = { rule_id: r.rule_id }; log(`Regla "${REGLA}" creada`); }
  else log(`Regla "${REGLA}" ya existía`);
  await api('BindScenario', { scenario_id: esc.scenario_id, rule_id: regla.rule_id, application_id: appId, bind: 1 });

  // Número amarrado a la aplicación (para llamadas entrantes futuras y para el caller ID)
  try { await api('BindPhoneNumberToApplication', { phone_number: tel.phone_number, application_id: appId, bind: 1 }); log(`Número ${callerId} amarrado a la aplicación`); }
  catch (e) { log(`Aviso: no se pudo amarrar el número a la aplicación (${e.message}); el caller ID funciona igual.`); }

  const env = {
    VOX_ACCOUNT: cuenta.account_name,
    VOX_APP: APP,
    VOX_USER: USUARIO,
    VOX_USER_PASSWORD: password,
    VOX_CALLER_ID: callerId,
    VOX_WEBHOOK_SECRET: secreto,
    PUBLIC_URL: publicUrl,
  };
  fs.writeFileSync(archivo, Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { mode: 0o600 });
  log('\nVariables para Render (también quedaron en ' + archivo + ', que está en .gitignore):\n');
  for (const [k, v] of Object.entries(env)) log(`  ${k}=${['VOX_USER_PASSWORD', 'VOX_WEBHOOK_SECRET'].includes(k) ? v.slice(0, 4) + '…(completo en el archivo)' : v}`);
  log('\nLogin de Angie en el navegador: ' + `${USUARIO}@${APP}.${cuenta.account_name}.voximplant.com`);
  return env;
}

module.exports = { setup, APP, USUARIO, ESCENARIO, REGLA };

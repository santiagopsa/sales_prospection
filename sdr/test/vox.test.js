const test = require('node:test');
const assert = require('assert');
const crypto = require('crypto');
const vox = require('../vox/servidor');
const { generarEscenario } = require('../vox/escenario');
const { jwt } = require('../vox/api');

const ENV = { VOX_ACCOUNT: 'santiagopeaku', VOX_APP: 'sdr', VOX_USER: 'angie', VOX_USER_PASSWORD: 'p4ss', VOX_CALLER_ID: '+573009138048', VOX_WEBHOOK_SECRET: 's3cr3t', VOX_NODE: '4' };
const md5 = s => crypto.createHash('md5').update(s).digest('hex');

test('config pública: sin secretos y con lo que falta', () => {
  const c = vox.configPublica(ENV);
  assert.deepStrictEqual(c, { configurado: true, faltan: [], usuario: 'angie@sdr.santiagopeaku.voximplant.com', callerId: '+573009138048', node: 4 });
  assert.ok(vox.configPublica({ ...ENV, VOX_NODE: 'x' }).faltan.includes('VOX_NODE'));
  assert.ok(!JSON.stringify(c).includes('p4ss'));
  const f = vox.configPublica({ VOX_ACCOUNT: 'x' });
  assert.strictEqual(f.configurado, false);
  assert.ok(f.faltan.includes('VOX_USER_PASSWORD'));
});

test('firma del login de un solo uso (fórmula de Voximplant)', () => {
  const { hash } = vox.firmarLogin(ENV, 'KEY123');
  assert.strictEqual(hash, md5('KEY123|' + md5('angie:voximplant.com:p4ss')));
  assert.throws(() => vox.firmarLogin({ VOX_ACCOUNT: 'x' }, 'k'), /no está configurada/);
  assert.throws(() => vox.firmarLogin(ENV, ''), /key/);
});

test('escenario: incrusta caller id, aviso y webhook, y es JS válido', () => {
  const s = generarEscenario({ callerId: '+573009138048', webhookUrl: 'https://x/sdr/api/vox/webhook', secreto: 'abc', aviso: 'Hola "Peaku"', voz: 'Google.es_US_Standard_A', avisoATodos: false });
  new (require('vm').Script)(s);
  assert.ok(s.includes('"+573009138048"'));
  assert.ok(s.includes('Hola \\"Peaku\\"'));
  assert.ok(s.includes('X-SDR-Secret: '));
  assert.ok(s.includes('stereo: true'));
  // Reintentos, mensajes y tono real hacia Angie
  const cfg = require('../config');
  const s2 = generarEscenario({ callerId: '+57', webhookUrl: 'u', secreto: 's', aviso: '', voz: cfg.VOZ_AVISO, reintentos: 2, codigosReintento: [404, 503], pausaReintentoS: 2, mensajes: cfg.MENSAJES_LLAMADA });
  new (require('vm').Script)(s2);
  assert.ok(s2.includes('const REINTENTOS = 2'));
  assert.ok(s2.includes('const CODIGOS_REINTENTO = [404,503]'));
  assert.ok(s2.includes('PAUSA_REINTENTO_MS = 2000'));
  assert.ok(s2.includes('angie.answer()'));
  assert.ok(s2.includes('sendMessage'));
  assert.ok(s2.includes(cfg.MENSAJES_LLAMADA.numero_invalido.slice(0, 20)));
});

test('escenario: clasificar códigos SIP del operador', () => {
  const s = generarEscenario({ callerId: '+57', webhookUrl: 'u', secreto: 's', aviso: '', voz: 'x' });
  const fn = new Function(s.slice(s.indexOf('function clasificar'), s.indexOf('VoxEngine.addEventListener')) + '; return clasificar;')();
  assert.strictEqual(fn(404, 'Not Here'), 'numero_invalido');
  assert.strictEqual(fn(480, 'Temporarily not available'), 'no_contesto');
  assert.strictEqual(fn(487, ''), 'no_contesto');
  assert.strictEqual(fn(486, 'Busy Here'), 'ocupado');
  assert.strictEqual(fn(503, 'Service Unavailable'), 'fallo_central');
  assert.strictEqual(fn(603, 'Decline'), 'rechazada');
});

test('jwt del service account: RS256 verificable', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' });
  const t = jwt({ account_id: 7655009, key_id: 'kid-1', private_key: pem });
  const [h, p, f] = t.split('.');
  const dec = x => JSON.parse(Buffer.from(x.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString());
  assert.deepStrictEqual(dec(h), { alg: 'RS256', typ: 'JWT', kid: 'kid-1' });
  assert.strictEqual(dec(p).iss, 7655009);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${p}`), publicKey, Buffer.from(f.replace(/-/g, '+').replace(/_/g, '/'), 'base64')));
});

test('vox:setup: secuencia de llamadas a la API con un fetch falso', async (t) => {
  const os = require('os'), fs = require('fs'), path = require('path');
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vox-'));
  const keyPath = path.join(dir, 'voximplant-key.json');
  fs.writeFileSync(keyPath, JSON.stringify({ account_id: 1, key_id: 'k', private_key: privateKey.export({ type: 'pkcs1', format: 'pem' }) }));
  const llamadas = [];
  const respuestas = {
    GetAccountInfo: { result: { account_name: 'santiagopeaku', account_id: 1 } },
    GetApplications: { result: [] }, AddApplication: { application_id: 10 },
    GetUsers: { result: [] }, AddUser: { user_id: 20 },
    GetPhoneNumbers: { result: [{ phone_id: 30, phone_number: '573009138048' }] },
    GetScenarios: { result: [] }, AddScenario: { scenario_id: 40 },
    GetRules: { result: [] }, AddRule: { rule_id: 50 },
    BindScenario: { result: 1 }, BindPhoneNumberToApplication: { result: 1 },
  };
  const fetchReal = global.fetch;
  global.fetch = async (url, opts) => {
    const metodo = url.replace(/\/$/, '').split('/').pop();
    assert.match(opts.headers.Authorization, /^Bearer /);
    llamadas.push([metodo, Object.fromEntries(new URLSearchParams(opts.body))]);
    return { status: 200, json: async () => respuestas[metodo] || { error: { code: 1, msg: 'sin stub ' + metodo } } };
  };
  try {
    const { setup } = require('../vox/setup');
    const env = await setup({ key: keyPath, url: 'https://peaku-sandler.onrender.com/', config: require('../config'), log() {} });
    assert.strictEqual(env.VOX_ACCOUNT, 'santiagopeaku');
    assert.strictEqual(env.VOX_CALLER_ID, '+573009138048');
    assert.strictEqual(env.PUBLIC_URL, 'https://peaku-sandler.onrender.com');
    assert.ok(env.VOX_USER_PASSWORD.length >= 20);
    const nombres = llamadas.map(x => x[0]);
    assert.deepStrictEqual(nombres, ['GetAccountInfo', 'GetApplications', 'AddApplication', 'GetUsers', 'AddUser', 'GetPhoneNumbers', 'GetScenarios', 'AddScenario', 'GetRules', 'AddRule', 'BindScenario', 'BindPhoneNumberToApplication']);
    const addUser = llamadas.find(x => x[0] === 'AddUser')[1];
    assert.strictEqual(addUser.user_password, env.VOX_USER_PASSWORD);
    assert.strictEqual(addUser.application_id, '10');
    const esc = llamadas.find(x => x[0] === 'AddScenario')[1].scenario_script;
    assert.ok(esc.includes(env.VOX_WEBHOOK_SECRET));
    assert.ok(esc.includes('https://peaku-sandler.onrender.com/sdr/api/vox/webhook'));
    assert.ok(fs.readFileSync(path.join(dir, 'voximplant-render.env'), 'utf8').includes('VOX_USER_PASSWORD='));
    assert.strictEqual(llamadas.find(x => x[0] === 'BindPhoneNumberToApplication')[1].phone_number, '573009138048');
    // Segunda corrida: reutiliza contraseña y secreto (no invalida Render); con --rotar los cambia
    respuestas.GetApplications = { result: [{ application_id: 10, application_name: 'sdr.santiagopeaku.voximplant.com' }] };
    respuestas.GetUsers = { result: [{ user_id: 20 }] }; respuestas.SetUserInfo = { result: 1 };
    respuestas.GetScenarios = { result: [{ scenario_id: 40, scenario_name: 'sdr-llamada' }] }; respuestas.SetScenarioInfo = { result: 1 };
    respuestas.GetRules = { result: [{ rule_id: 50, rule_name: 'sdr-saliente' }] };
    const env2 = await setup({ key: keyPath, url: 'https://peaku-sandler.onrender.com', config: require('../config'), log() {} });
    assert.strictEqual(env2.VOX_USER_PASSWORD, env.VOX_USER_PASSWORD);
    assert.strictEqual(env2.VOX_WEBHOOK_SECRET, env.VOX_WEBHOOK_SECRET);
    assert.ok(!llamadas.slice(12).some(x => x[0].startsWith('Add')));
    const env3 = await setup({ key: keyPath, url: 'https://peaku-sandler.onrender.com', rotar: true, config: require('../config'), log() {} });
    assert.notStrictEqual(env3.VOX_USER_PASSWORD, env.VOX_USER_PASSWORD);
  } finally { global.fetch = fetchReal; }
});

test('webhook contra Postgres', { skip: !process.env.SDR_TEST_DATABASE_URL && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { registrarToque } = require('../resultados');
  const config = require('../config');
  const db = conectar(process.env.SDR_TEST_DATABASE_URL);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  const lead = (await db.query(`INSERT INTO sdr.leads (empresa, telefono) VALUES ('ACME', '+573001234567') RETURNING id`)).rows[0];
  await db.query(`INSERT INTO sdr.tasks (lead_id, paso, canal, due_at) VALUES ($1, 1, 'llamada', NOW())`, [lead.id]);

  await assert.rejects(vox.recibirWebhook(db, ENV, { 'x-sdr-secret': 'nope' }, { uuid: 'u1', lead_id: lead.id }), /Secreto/);
  await assert.rejects(vox.recibirWebhook(db, ENV, {}, { uuid: 'u1', lead_id: lead.id }), /Secreto/);

  // Angie registra el resultado ANTES de que llegue el webhook
  const r = await registrarToque(db, config, { leadId: lead.id, canal: 'llamada', resultado: 'conversacion', callUuid: 'u1' });
  const w = await vox.recibirWebhook(db, ENV, { 'x-sdr-secret': 's3cr3t' }, {
    uuid: 'u1', lead_id: lead.id, estado: 'colgada', started_at: '2026-09-22T14:00:00Z', answered_at: '2026-09-22T14:00:10Z', ended_at: '2026-09-22T14:02:10Z', duracion_s: 120, record_url: 'https://rec/u1.mp3', vox_call_id: 'vc-1',
  });
  assert.strictEqual(w.call_id, r.call_id);
  const c = (await db.query(`SELECT * FROM sdr.calls WHERE uuid='u1'`)).rows[0];
  assert.strictEqual(c.duracion_s, 120);
  assert.strictEqual(c.record_url, 'https://rec/u1.mp3');
  assert.strictEqual(c.touch_id, r.toque_id);
  assert.strictEqual(c.origen, 'voximplant');

  // El webhook llega primero y luego el resultado
  await vox.recibirWebhook(db, ENV, { 'x-sdr-secret': 's3cr3t' }, { uuid: 'u2', lead_id: lead.id, estado: 'no_contesto', duracion_s: null });
  const r2 = await registrarToque(db, config, { leadId: lead.id, canal: 'llamada', resultado: 'no_contesto', callUuid: 'u2' });
  const c2 = (await db.query(`SELECT * FROM sdr.calls WHERE uuid='u2'`)).rows[0];
  assert.strictEqual(c2.id, r2.call_id);
  assert.strictEqual(c2.touch_id, r2.toque_id);
  assert.strictEqual(c2.vox_estado, 'no_contesto');
  assert.strictEqual((await db.query('SELECT COUNT(*)::int AS n FROM sdr.calls')).rows[0].n, 2);

  // Fallo del operador: código, motivo e intentos quedan; el reporte de Angie puede llegar antes que el webhook.
  const L = require('../leads');
  await L.reportarLlamada(db, { uuid: 'u3', leadId: lead.id, telefono: '+573001234567', codigo: 404, estado: 'numero_invalido', nota: 'desde el celular sí entra', usuario: 'Angie' });
  await vox.recibirWebhook(db, ENV, { 'x-sdr-secret': 's3cr3t' }, { uuid: 'u3', lead_id: lead.id, estado: 'numero_invalido', codigo: 404, motivo: 'Not Here', intentos: 3, duracion_s: null });
  const c3 = (await db.query(`SELECT * FROM sdr.calls WHERE uuid='u3'`)).rows[0];
  assert.strictEqual(c3.vox_codigo, '404'); assert.strictEqual(c3.vox_motivo, 'Not Here'); assert.strictEqual(c3.vox_intentos, 3);
  assert.match(c3.reporte, /Angie: desde el celular/);
  assert.ok(c3.reportado_at);
  assert.strictEqual((await db.query('SELECT COUNT(*)::int AS n FROM sdr.calls')).rows[0].n, 3);
  const fallos = await L.fallosDeMarcacion(db);
  assert.strictEqual(fallos.length, 1);
  assert.strictEqual(fallos[0].fallos_del_numero, 1);
  assert.strictEqual(fallos[0].contestadas_del_numero, 1);
  assert.strictEqual((await L.pipeline(db)).fallos, 1);
  await L.revisarFallo(db, c3.id);
  assert.strictEqual((await L.pipeline(db)).fallos, 0);
  assert.ok((await L.fallosDeMarcacion(db))[0].revisado_ms);
  // La llamada fallida no entra al pipeline de audio ni cuenta como resultado.
  assert.strictEqual(c3.pipeline_status, 'no_aplica');
  db.end();
});

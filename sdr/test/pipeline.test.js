// Pipeline de audio: normalización de Deepgram, métricas (puras) y el flujo contra Postgres con
// un transcriptor falso. Misma variable que db.test.js para la parte de base.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const base = require('../config');
const deepgram = require('../pipeline/deepgram');
const M = require('../pipeline/metricas');
const url = process.env.SDR_TEST_DATABASE_URL;
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'deepgram.json'), 'utf8'));

test('deepgram.normalizar: el canal derecho es Angie, turnos ordenados con texto', () => {
  const n = deepgram.normalizar(fixture(), 'derecho');
  assert.strictEqual(n.turnos.length, 7);
  assert.strictEqual(n.turnos[0].quien, 'angie');
  assert.strictEqual(n.turnos[1].quien, 'prospecto');
  assert.strictEqual(n.turnos[0].palabras, 6);
  assert.strictEqual(n.duracion_s, 71.4);
  assert.match(n.texto, /^\[0:00\] Angie: Hola/);
  assert.match(n.modelo, /nova/);
  const inv = deepgram.normalizar(fixture(), 'izquierdo');
  assert.strictEqual(inv.turnos[0].quien, 'prospecto');
});

test('deepgram.normalizar: sin utterances arma frases con las palabras por canal', () => {
  const r = { metadata: { duration: 5 }, results: { channels: [
    { alternatives: [{ words: [{ word: 'hola', punctuated_word: 'Hola,', start: 0, end: 0.4 }, { word: 'dime', punctuated_word: 'dime.', start: 0.5, end: 0.9 }, { word: 'ok', punctuated_word: 'Ok.', start: 4, end: 4.3 }] }] },
    { alternatives: [{ words: [{ word: 'soy', punctuated_word: 'Soy', start: 1.2, end: 1.5 }, { word: 'angie', punctuated_word: 'Angie.', start: 1.5, end: 2 }] }] },
  ] } };
  const n = deepgram.normalizar(r, 'derecho');
  assert.deepStrictEqual(n.turnos.map(t => [t.quien, t.texto]), [['prospecto', 'Hola, dime.'], ['angie', 'Soy Angie.'], ['prospecto', 'Ok.']]);
});

test('deepgram.parametros: multicanal, español, utterances', () => {
  const q = deepgram.parametros(base);
  assert.match(q, /multichannel=true/); assert.match(q, /language=es/); assert.match(q, /utterances=true/); assert.match(q, /model=nova-2/);
});

test('deepgram.transcribir: sin llave falla; con llave manda URL o bytes y traduce errores', async () => {
  await assert.rejects(deepgram.transcribir({ url: 'x' }, {}, base), /DEEPGRAM_API_KEY/);
  const llamadas = [];
  const fetchFn = async (u, o) => { llamadas.push({ u, o }); return { ok: true, status: 200, text: async () => JSON.stringify(fixture()) }; };
  await deepgram.transcribir({ url: 'https://rec/1.mp3' }, { DEEPGRAM_API_KEY: 'k' }, base, { fetchFn });
  assert.strictEqual(llamadas[0].o.headers.Authorization, 'Token k');
  assert.strictEqual(JSON.parse(llamadas[0].o.body).url, 'https://rec/1.mp3');
  await deepgram.transcribir({ audio: Buffer.from('abc'), contentType: 'audio/wav' }, { DEEPGRAM_API_KEY: 'k' }, base, { fetchFn });
  assert.strictEqual(llamadas[1].o.headers['Content-Type'], 'audio/wav');
  const malo = async () => ({ ok: false, status: 400, text: async () => JSON.stringify({ err_code: 'REMOTE_CONTENT_ERROR', err_msg: 'no se pudo bajar' }) });
  await assert.rejects(deepgram.transcribir({ url: 'x' }, { DEEPGRAM_API_KEY: 'k' }, base, { fetchFn: malo }), e => e.status === 400 && /REMOTE_CONTENT_ERROR/.test(e.message));
});

test('metricas.calcular: proporción, preguntas antes del pitch, monólogo, muletillas, interrupciones', () => {
  const n = deepgram.normalizar(fixture(), 'derecho');
  const m = M.calcular(n.turnos, base);
  assert.strictEqual(m.turnos, 7);
  assert.strictEqual(m.habla_prospecto_s, 11.7);
  assert.ok(m.proporcion_angie > 0.8 && m.proporcion_angie < 0.9, m.proporcion_angie);
  assert.strictEqual(m.preguntas_angie, 3);
  assert.strictEqual(m.preguntas_prospecto, 1);
  assert.strictEqual(m.primera_pregunta_s, 0.2);
  assert.strictEqual(m.pitch_en_s, 24.2);           // "te cuento" / "nosotros"
  assert.strictEqual(m.preguntas_antes_del_pitch, 2); // "¿hablo con Ana?" y "¿Tienen vacantes…?"
  assert.strictEqual(m.monologo_mas_largo_s, 35.8);
  assert.strictEqual(m.monologos_largos, 0);
  assert.strictEqual(m.interrupciones, 0);           // la única superposición (59.5) es del prospecto sobre Angie
  assert.strictEqual(M.calcular([{ quien: 'prospecto', inicio: 0, fin: 5, texto: 'a' }, { quien: 'angie', inicio: 4, fin: 6, texto: 'b' }], base).interrupciones, 1);
  assert.deepStrictEqual(m.muletillas_detalle, { eh: 1, este: 1, 'o sea': 1 });
  assert.match(m.apertura, /^Hola/);
  // Mover un hueco cambia el resultado sin volver a transcribir.
  const m2 = M.calcular(n.turnos, { ...base, PALABRAS_PITCH: ['reunión'], MONOLOGO_LARGO_S: 30 });
  assert.strictEqual(m2.pitch_en_s, 66.2);
  assert.strictEqual(m2.preguntas_antes_del_pitch, 3);
  assert.strictEqual(m2.monologos_largos, 1);
  const m3 = M.calcular(n.turnos, { ...base, PALABRAS_PITCH: ['zzz'] });
  assert.strictEqual(m3.pitch_en_s, null);
  assert.strictEqual(m3.preguntas_antes_del_pitch, null);
});

test('metricas: vacío y acentos', () => {
  const m = M.calcular([], base);
  assert.strictEqual(m.proporcion_angie, null);
  assert.strictEqual(m.turnos, 0);
  assert.strictEqual(M.contarMuletillas('Básicamente, eh, ESTE… digamos.', base.PALABRAS_MULETILLA).total, 4);
});

test('pipeline contra la base', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { registrarToque } = require('../resultados');
  const vox = require('../vox/servidor');
  const P = require('../pipeline');
  const db = conectar(url);
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query(`INSERT INTO sdr.leads (empresa, telefono) VALUES ('Pipe SA', '+573001112233'), ('Corta SA', '+573001112234'), ('SinConv SA', '+573001112235')`);
  const id = async e => (await db.query(`SELECT id FROM sdr.leads WHERE empresa=$1`, [e])).rows[0].id;
  const env = { VOX_WEBHOOK_SECRET: 's3', DEEPGRAM_API_KEY: 'k' };
  const estadoDe = async uuid => (await db.query(`SELECT id, pipeline_status FROM sdr.calls WHERE uuid=$1`, [uuid])).rows[0];
  const webhook = (uuid, leadId, extra = {}) => vox.recibirWebhook(db, env, { 'x-sdr-secret': 's3' }, { uuid, lead_id: leadId, duracion_s: 120, record_url: 'https://rec/' + uuid + '.mp3', estado: 'terminada', ...extra }, base);

  await t.test('estados: webhook antes o después del resultado, corta, sin conversación, manual', async () => {
    // Webhook primero → pendiente_resultado → resultado conversación → pendiente
    await webhook('u1', await id('Pipe SA'));
    assert.strictEqual((await estadoDe('u1')).pipeline_status, 'pendiente_resultado');
    await registrarToque(db, base, { leadId: await id('Pipe SA'), canal: 'llamada', resultado: 'conversacion', callUuid: 'u1' });
    assert.strictEqual((await estadoDe('u1')).pipeline_status, 'pendiente');
    // Resultado primero (sin grabación aún) → no_aplica → webhook → pendiente
    await registrarToque(db, base, { leadId: await id('Pipe SA'), canal: 'llamada', resultado: 'reunion_agendada', callUuid: 'u2' });
    assert.strictEqual((await estadoDe('u2')).pipeline_status, 'no_aplica');
    await webhook('u2', await id('Pipe SA'));
    assert.strictEqual((await estadoDe('u2')).pipeline_status, 'pendiente');
    // Corta → omitida
    await webhook('u3', await id('Corta SA'), { duracion_s: 20 });
    await registrarToque(db, base, { leadId: await id('Corta SA'), canal: 'llamada', resultado: 'conversacion', callUuid: 'u3' });
    assert.strictEqual((await estadoDe('u3')).pipeline_status, 'omitida');
    // Sin conversación → omitida
    await webhook('u4', await id('SinConv SA'));
    await registrarToque(db, base, { leadId: await id('SinConv SA'), canal: 'llamada', resultado: 'no_contesto', callUuid: 'u4' });
    assert.strictEqual((await estadoDe('u4')).pipeline_status, 'omitida');
    // Manual → no_aplica
    await registrarToque(db, base, { leadId: await id('SinConv SA'), canal: 'llamada', resultado: 'conversacion' });
    assert.strictEqual((await db.query(`SELECT pipeline_status FROM sdr.calls WHERE origen='manual'`)).rows[0].pipeline_status, 'no_aplica');
  });

  await t.test('procesar: transcriptor falso guarda turnos y métricas; error reintenta y luego marca error', async () => {
    const vistas = [];
    const deps = { transcribir: async (entrada) => { vistas.push(entrada); return fixture(); } };
    const rs = await P.correrPendientes(db, base, env, { deps });
    assert.strictEqual(rs.length, 2);
    assert.ok(rs.every(r => r.estado === 'transcrito'));
    assert.strictEqual(vistas[0].url, 'https://rec/u1.mp3');
    const tr = await P.transcripcionDeLlamada(db, rs[0].call_id);
    assert.strictEqual(tr.turnos.length, 7);
    assert.strictEqual(tr.metricas.preguntas_antes_del_pitch, 2);
    assert.strictEqual(tr.resultado, 'conversacion');
    assert.strictEqual(tr.empresa, 'Pipe SA');
    assert.deepStrictEqual((await P.estado(db)).conteo, { no_aplica: 1, omitida: 2, transcrito: 2 });
    // Segunda pasada: nada pendiente.
    assert.strictEqual((await P.correrPendientes(db, base, env, { deps })).length, 0);
    // Recalcular métricas con otro hueco, sin transcribir.
    const m = await P.recalcularMetricas(db, { ...base, PALABRAS_PITCH: ['reunión'] }, rs[0].call_id);
    assert.strictEqual(m.pitch_en_s, 66.2);
    // Deepgram no puede bajar la URL → se descarga y se manda en bytes.
    await P.reencolar(db, rs[0].call_id);
    let intentos = 0;
    const deps2 = {
      transcribir: async (entrada) => { intentos++; if (entrada.url) throw Object.assign(new Error('Deepgram 400 REMOTE_CONTENT_ERROR'), { status: 400 }); return fixture(); },
      descargar: async () => ({ audio: Buffer.from('x'), contentType: 'audio/mpeg' }),
    };
    const r2 = await P.procesar(db, base, env, rs[0].call_id, { deps: deps2 });
    assert.strictEqual(r2.estado, 'transcrito'); assert.strictEqual(intentos, 2);
    // Fallo persistente: PIPELINE_REINTENTOS veces pendiente, después error.
    await P.reencolar(db, rs[1].call_id);
    const rompe = { transcribir: async () => { throw new Error('se cayó'); } };
    const cfg = { ...base, PIPELINE_REINTENTOS: 2 };
    assert.strictEqual((await P.procesar(db, cfg, env, rs[1].call_id, { deps: rompe })).estado, 'pendiente');
    assert.strictEqual((await P.procesar(db, cfg, env, rs[1].call_id, { deps: rompe })).estado, 'error');
    const e = await P.estado(db);
    assert.strictEqual(e.errores.length, 1); assert.match(e.errores[0].pipeline_error, /se cayó/);
    // Una llamada con error o transcrita no la toca revisarLlamada.
    assert.strictEqual(await P.revisarLlamada(db, base, rs[1].call_id), null);
    // Transcripción vacía cuenta como error.
    await P.reencolar(db, rs[1].call_id);
    const vacio = { transcribir: async () => ({ results: { utterances: [] } }) };
    assert.match((await P.procesar(db, base, env, rs[1].call_id, { deps: vacio })).error, /vacía/);
  });

  await t.test('iniciar: sin llave no arranca', () => {
    const logs = [];
    assert.strictEqual(P.iniciar(db, base, {}, { log: m => logs.push(m), error() {} }), null);
    assert.match(logs[0], /DEEPGRAM_API_KEY/);
    const timer = P.iniciar(db, { ...base, PIPELINE_INTERVALO_S: 15 }, { DEEPGRAM_API_KEY: 'k' }, { log() {}, error() {} });
    assert.ok(timer); clearInterval(timer);
  });

  await db.end();
});

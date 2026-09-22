// Evaluador con rúbrica (Claude falso) y mejora semanal contra Postgres.
const test = require('node:test');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const base = require('../config');
const E = require('../evaluador');
const rubricaV1 = require('../rubrica/v1');
const url = process.env.SDR_TEST_DATABASE_URL;
const fixture = () => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'deepgram.json'), 'utf8'));

// Claude falso: responde según lo que se le pida por llamada (por defecto, todo cumple menos dos).
function claudeFalso(respuestaPor = () => null) {
  const llamadas = [];
  const fetchFn = async (u, o) => {
    const body = JSON.parse(o.body);
    llamadas.push(body);
    const texto = respuestaPor(body) || JSON.stringify({
      criterios: rubricaV1.criterios.map(c => c.id === 'pregunta_antes_pitch'
        ? { id: c.id, estado: 'no_cumple', cita: 'te cuento, nosotros en Peaku hacemos headhunting tech', confianza: 0.9, nota: 'Presenta Peaku antes de preguntar por vacantes.' }
        : c.id === 'cierre_concreto' ? { id: c.id, estado: 'no_cumple', cita: 'Te lo explico en una reunión corta.', confianza: 0.8, nota: 'Propone reunión sin fecha ni hora.' }
        : c.id === 'manejo_objecion' ? { id: c.id, estado: 'no_aplica', cita: null, confianza: 0.9, nota: 'No hubo objeción.' }
        : { id: c.id, estado: 'cumple', cita: null, confianza: 0.7, nota: 'Nada que señalar.' }),
      mejor_momento: { cita: '¿Tienen vacantes de tecnología abiertas ahora mismo?', por_que: 'Pregunta directa antes de contar nada.' },
      menciono_grabacion: false,
      resumen: 'Llamada corta con interés; quedó en reunión sin fecha.',
    });
    return { ok: true, status: 200, json: async () => ({ model: 'claude-falso', usage: { input_tokens: 1200, output_tokens: 400 }, content: [{ type: 'text', text: texto }] }) };
  };
  return { fetchFn, llamadas };
}

test('rúbrica v1: 10 criterios con id único, ejemplos y reglas', () => {
  assert.strictEqual(rubricaV1.criterios.length, 10);
  assert.strictEqual(new Set(rubricaV1.criterios.map(c => c.id)).size, 10);
  for (const c of rubricaV1.criterios) for (const k of ['id', 'nombre', 'descripcion', 'cumple', 'no_cumple']) assert.ok(c[k], `${c.id} sin ${k}`);
  assert.ok(rubricaV1.reglas.some(r => /cita/i.test(r)));
  assert.ok(Object.keys(base.PESOS_CRITERIOS).every(k => rubricaV1.criterios.some(c => c.id === k)));
});

test('prompt: incluye criterios, reglas, métricas y transcripción con hablantes', () => {
  const n = require('../pipeline/deepgram').normalizar(fixture(), 'derecho');
  const m = require('../pipeline/metricas').calcular(n.turnos, base);
  const p = E.construirPrompt(rubricaV1, base, { turnos: n.turnos, metricas: m, lead: { empresa: 'ACME', contacto: 'Ana', cargo: 'CTO' }, resultado: 'conversacion' });
  assert.match(p.system, /evidencia textual/i);
  assert.match(p.system, /"no_aplica"/);
  assert.match(p.user, /id="apertura_permiso"/);
  assert.match(p.user, /preguntas_antes_del_pitch=2/);
  assert.match(p.user, /\[0:00\] ANGIE: Hola/);
  assert.match(p.user, /Empresa: ACME/);
});

test('extraerJson: limpio, con fence y con texto alrededor', () => {
  assert.deepStrictEqual(E.extraerJson('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(E.extraerJson('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepStrictEqual(E.extraerJson('Aquí va: {"a":{"b":2}} fin'), { a: { b: 2 } });
  assert.throws(() => E.extraerJson('nada'), /JSON/);
});

test('validar: sin cita no hay no_cumple; ids faltantes; confianza acotada; cita no literal avisa', () => {
  const turnos = [{ quien: 'angie', texto: 'Hola, te habla Angie de Peaku.' }];
  const crudo = { criterios: [
    { id: 'apertura_permiso', estado: 'no_cumple', cita: null, confianza: 0.9, nota: 'x' },
    { id: 'pregunta_antes_pitch', estado: 'no_cumple', cita: 'te habla Angie de Peaku', confianza: 7, nota: 'y' },
    { id: 'cierre_concreto', estado: 'no_cumple', cita: 'esto no está en la llamada', confianza: -1, nota: 'z' },
    { id: 'inventado', estado: 'no_cumple', cita: 'x', confianza: 1 },
  ], mejor_momento: { cita: 'Hola', por_que: 'saluda' }, menciono_grabacion: 'sí', resumen: 'r' };
  const { resultado, avisos } = E.validar(rubricaV1, crudo, turnos);
  assert.strictEqual(resultado.criterios.length, 10);
  const por = Object.fromEntries(resultado.criterios.map(c => [c.id, c]));
  assert.strictEqual(por.apertura_permiso.estado, 'cumple');
  assert.strictEqual(por.pregunta_antes_pitch.estado, 'no_cumple'); assert.strictEqual(por.pregunta_antes_pitch.confianza, 1);
  assert.strictEqual(por.cierre_concreto.estado, 'no_cumple'); assert.strictEqual(por.cierre_concreto.confianza, 0);
  assert.strictEqual(por.no_monologo.estado, 'cumple'); assert.strictEqual(por.no_monologo.nota, 'Nada que señalar.');
  assert.deepStrictEqual(resultado.no_cumple, ['pregunta_antes_pitch', 'cierre_concreto']);
  assert.ok(avisos.some(a => /sin cita/.test(a)) && avisos.some(a => /no aparece literal/.test(a)) && avisos.some(a => /no evaluó "no_monologo"/.test(a)));
  assert.strictEqual(resultado.menciono_grabacion, true);
});

test('llamarModelo: sin llave falla; manda system + user y lee usage', async () => {
  await assert.rejects(E.llamarModelo({}, base, { system: 's', user: 'u' }), /ANTHROPIC_API_KEY/);
  const g = claudeFalso();
  const r = await E.llamarModelo({ ANTHROPIC_API_KEY: 'k', ANALYZE_MODEL: 'claude-x' }, base, { system: 's', user: 'u' }, { fetchFn: g.fetchFn });
  assert.strictEqual(g.llamadas[0].model, 'claude-x'); assert.strictEqual(g.llamadas[0].temperature, 0); assert.strictEqual(g.llamadas[0].system, 's');
  assert.strictEqual(r.tokens_in, 1200);
  const malo = async () => ({ ok: false, status: 429, json: async () => ({ error: { message: 'rate limited' } }) });
  await assert.rejects(E.llamarModelo({ ANTHROPIC_API_KEY: 'k' }, base, { system: 's', user: 'u' }, { fetchFn: malo }), /Claude 429/);
});

test('evaluación y mejora contra la base', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { registrarToque } = require('../resultados');
  const vox = require('../vox/servidor');
  const P = require('../pipeline');
  const M = require('../mejora');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query(`INSERT INTO sdr.leads (empresa, contacto, telefono) VALUES ('A1', 'Ana', '+573001110001'), ('A2', 'Bea', '+573001110002'), ('A3', 'Cai', '+573001110003'), ('A4', 'Dan', '+573001110004')`);
  const ids = (await db.query('SELECT id FROM sdr.leads ORDER BY id')).rows.map(r => r.id);
  const ENV = { VOX_WEBHOOK_SECRET: 's', DEEPGRAM_API_KEY: 'd', ANTHROPIC_API_KEY: 'k' };
  const lunes = new Date('2026-09-21T14:00:00Z');
  const deepgram = { transcribir: async () => fixture() };

  await t.test('sembrar rúbrica: una vez, inmutable, activa', async () => {
    assert.strictEqual((await E.sembrarRubrica(db, rubricaV1, { activar: true })).nueva, true);
    assert.strictEqual((await E.sembrarRubrica(db, { ...rubricaV1, criterios: [] }, { activar: true })).nueva, false);
    const r = await E.rubricaActiva(db, base);
    assert.strictEqual(r.criterios.length, 10);
    await assert.rejects(E.rubricaActiva(db, { RUBRICA_ACTIVA: 'v9' }), /No hay rúbrica v9/);
  });

  // Cuatro llamadas con conversación, transcritas con el fixture (misma semana, martes).
  const martes = new Date('2026-09-22T15:00:00Z');
  for (let i = 0; i < 4; i++) {
    const uuid = 'e' + i;
    await vox.recibirWebhook(db, ENV, { 'x-sdr-secret': 's' }, { uuid, lead_id: ids[i], duracion_s: 120, record_url: 'https://rec/' + uuid, estado: 'colgada', started_at: martes.toISOString() }, base);
    await registrarToque(db, base, { leadId: ids[i], canal: 'llamada', resultado: 'conversacion', callUuid: uuid, usuario: 'Angie', ahora: martes });
  }
  await P.correrPendientes(db, base, ENV, { deps: deepgram });
  assert.strictEqual((await P.estado(db)).conteo.transcrito, 4);
  const calls = (await db.query('SELECT id FROM sdr.calls ORDER BY id')).rows.map(r => r.id);

  await t.test('evaluar: transcrito → evaluado, guarda resultado validado; sin llave no hace nada', async () => {
    assert.strictEqual((await P.correrEvaluaciones(db, base, { ...ENV, ANTHROPIC_API_KEY: '' })).length, 0);
    const g = claudeFalso();
    const rs = await P.correrEvaluaciones(db, base, ENV, { deps: { fetchFn: g.fetchFn }, limite: 10 });
    assert.strictEqual(rs.length, 4);
    assert.ok(rs.every(r => r.estado === 'evaluado'));
    assert.deepStrictEqual(rs[0].no_cumple, ['pregunta_antes_pitch', 'cierre_concreto']);
    assert.strictEqual((await P.estado(db)).conteo.evaluado, 4);
    assert.ok(g.llamadas[0].messages[0].content.includes('ANGIE:'));
    const t1 = await P.transcripcionDeLlamada(db, calls[0], base);
    assert.strictEqual(t1.evaluacion.rubrica_version, 'v1');
    assert.strictEqual(t1.evaluacion.resultado.criterios.length, 10);
    assert.strictEqual(t1.evaluacion.modelo, 'claude-falso');
    // Reevaluar reemplaza (misma versión), no duplica
    await P.evaluar(db, base, ENV, calls[0], { deps: { fetchFn: g.fetchFn }, forzar: true });
    assert.strictEqual((await db.query('SELECT COUNT(*)::int AS n FROM sdr.evaluations')).rows[0].n, 4);
  });

  await t.test('evaluar: error reintenta y luego error_evaluacion; JSON roto cuenta como error', async () => {
    await db.query(`UPDATE sdr.calls SET pipeline_status = 'transcrito', pipeline_intentos = 0 WHERE id = $1`, [calls[3]]);
    const roto = { fetchFn: async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: 'text', text: 'no soy json' }] }) }) };
    const cfg = { ...base, EVALUADOR_REINTENTOS: 2 };
    assert.strictEqual((await P.evaluar(db, cfg, ENV, calls[3], { deps: roto })).estado, 'transcrito');
    const r2 = await P.evaluar(db, cfg, ENV, calls[3], { deps: roto });
    assert.strictEqual(r2.estado, 'error_evaluacion'); assert.match(r2.error, /JSON/);
    assert.strictEqual((await P.estado(db)).errores.length, 1);
    // Se recupera con una respuesta buena
    const g = claudeFalso();
    assert.strictEqual((await P.evaluar(db, base, ENV, calls[3], { deps: { fetchFn: g.fetchFn }, forzar: true })).estado, 'evaluado');
  });

  await t.test('mejora: hábitos con mínimo de llamadas y peso, foco propuesto, mejor momento, fortalezas', async () => {
    const a = await M.analizarSemana(db, base, { fecha: '2026-09-23', usuario: 'Angie', ahora: new Date('2026-09-25T20:00:00Z') });
    assert.strictEqual(a.llamadas_evaluadas, 4);
    assert.strictEqual(a.suficiente, true);
    assert.deepStrictEqual(a.habitos.map(h => h.id), ['pregunta_antes_pitch', 'cierre_concreto']);   // ambos peso 2; empate por tasa 1.0
    const pa = a.criterios.find(c => c.id === 'pregunta_antes_pitch');
    assert.strictEqual(pa.no_cumple, 4); assert.strictEqual(pa.tasa, 1); assert.strictEqual(pa.ejemplos.length, 3);
    assert.strictEqual(a.criterios.find(c => c.id === 'manejo_objecion').aplican, 0);
    assert.strictEqual(a.foco.estado, 'propuesto'); assert.strictEqual(a.foco.criterio, 'pregunta_antes_pitch');
    assert.match(a.mejor_momento.cita, /vacantes/);
    assert.ok(a.fortalezas.some(f => f.id === 'apertura_permiso'));
    // Con umbral más alto no hay hábitos ni foco
    const b = await M.analizarSemana(db, { ...base, HABITO_MIN_LLAMADAS: 5 }, { fecha: '2026-09-23', usuario: 'Angie' });
    assert.strictEqual(b.habitos.length, 0); assert.strictEqual(b.foco, null); assert.strictEqual(b.suficiente, false);
    // Otra semana: vacío
    assert.strictEqual((await M.analizarSemana(db, base, { fecha: '2026-09-30', usuario: 'Angie' })).llamadas_evaluadas, 0);
    // Pesos: subir no_monologo no cambia nada porque no falla; bajar las palancas invierte el orden
    const c = await M.analizarSemana(db, { ...base, PESOS_CRITERIOS: { cierre_concreto: 3 } }, { fecha: '2026-09-23', usuario: 'Angie' });
    assert.strictEqual(c.foco.criterio, 'cierre_concreto');
  });

  await t.test('foco: confirmar, seguimiento y foco anterior', async () => {
    await assert.rejects(M.confirmarFoco(db, base, { usuario: 'Angie', criterio: 'nada' }), /Criterio desconocido/);
    const f = await M.confirmarFoco(db, base, { usuario: 'Angie', criterio: 'pregunta_antes_pitch', ahora: new Date('2026-09-25T20:00:00Z') });
    assert.strictEqual(f.desde, '2026-09-25'); assert.strictEqual(f.hasta, '2026-10-08'); assert.strictEqual(f.tasa_inicial, 1);
    const a = await M.analizarSemana(db, base, { fecha: '2026-09-23', usuario: 'Angie', ahora: new Date('2026-09-28T20:00:00Z') });
    assert.strictEqual(a.foco.estado, 'activo'); assert.strictEqual(a.foco.confirmado, true); assert.strictEqual(a.foco.dias_restantes, 10);
    // Pasadas las dos semanas: es "foco anterior" y hay seguimiento
    const b = await M.analizarSemana(db, base, { fecha: '2026-10-12', usuario: 'Angie', ahora: new Date('2026-10-12T20:00:00Z') });
    assert.strictEqual(b.foco, null);
    assert.strictEqual(b.seguimiento.criterio, 'pregunta_antes_pitch'); assert.strictEqual(b.seguimiento.tasa_actual, null);
    // Confirmar otro cierra el anterior
    await M.confirmarFoco(db, base, { usuario: 'Angie', criterio: 'cierre_concreto', ahora: new Date('2026-09-29T20:00:00Z') });
    assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.focos WHERE cerrado_at IS NULL`)).rows[0].n, 1);
  });

  await t.test('jobInforme: solo el viernes desde la hora; una foto por semana', async () => {
    assert.strictEqual((await M.jobInforme(db, base, new Date('2026-09-24T22:00:00Z'))).hecho, 0);   // jueves
    assert.strictEqual((await M.jobInforme(db, base, new Date('2026-09-25T15:00:00Z'))).hecho, 0);   // viernes 10:00 Bogotá
    assert.strictEqual((await M.jobInforme(db, base, new Date('2026-09-25T22:00:00Z'))).hecho, 1);   // viernes 17:00
    assert.strictEqual((await M.jobInforme(db, base, new Date('2026-09-25T23:00:00Z'))).hecho, 0);
    const inf = await M.informesGuardados(db, 'Angie');
    assert.strictEqual(inf.length, 1); assert.strictEqual(inf[0].semana, '2026-09-21'); assert.strictEqual(inf[0].datos.llamadas_evaluadas, 4);
  });

  await t.test('resumenSemana trae la mejora', async () => {
    const w = await require('../ritmo').resumenSemana(db, base, { fecha: '2026-09-23', usuario: 'Angie', ahora: new Date('2026-09-25T20:00:00Z') });
    assert.strictEqual(w.mejora.llamadas_evaluadas, 4);
    assert.ok(w.mejora.foco);
  });

  await db.end();
});

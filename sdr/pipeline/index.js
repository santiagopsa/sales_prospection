// Pipeline de audio: decide qué llamadas se transcriben, las procesa en segundo plano y guarda
// turnos + métricas. La evaluación con rúbrica (LLM) se engancha después de "transcrito".
//
// Estados de calls.pipeline_status:
//   no_aplica            llamada manual, o todavía sin resultado ni webhook
//   pendiente_resultado  llegó el webhook (grabación) pero Angie no ha puesto resultado
//   pendiente            lista: hay resultado con conversación, grabación y duración suficiente
//   transcribiendo       en proceso
//   transcrito           turnos y métricas guardados; falta la evaluación con rúbrica
//   evaluando            el evaluador (Claude) está en ello
//   evaluado             transcripción + evaluación listas
//   omitida              corta, sin grabación al final, o resultado sin conversación
//   error                falló PIPELINE_REINTENTOS veces; se ve en `node sdr/cli.js pipeline --estado`
//   error_evaluacion     la transcripción está, la evaluación falló EVALUADOR_REINTENTOS veces
const { T } = require('../schema');
const D = require('../dominio');
const deepgram = require('./deepgram');
const metricas = require('./metricas');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const conConversacion = JSON.stringify(D.RESULTADOS_CON_CONVERSACION);

// Recalcula el estado de una llamada según lo que ya se sabe (resultado, grabación, duración).
// Se llama al registrar el resultado y al llegar el webhook, en cualquier orden. No toca las
// llamadas que ya entraron al pipeline (transcribiendo / transcrito / error).
async function revisarLlamada(c, config, callId) {
  const min = Number(config.DURACION_MINIMA_PIPELINE_S) || 0;
  const r = await c.query(
    `UPDATE ${T.calls} k SET pipeline_status = CASE
        WHEN k.origen <> 'voximplant' THEN 'no_aplica'
        WHEN t.resultado IS NULL THEN CASE WHEN k.record_url IS NOT NULL THEN 'pendiente_resultado' ELSE 'no_aplica' END
        WHEN t.resultado NOT IN (SELECT jsonb_array_elements_text($2::jsonb)) THEN 'omitida'
        WHEN k.record_url IS NULL THEN 'no_aplica'
        WHEN COALESCE(k.duracion_s, 0) < $3 THEN 'omitida'
        ELSE 'pendiente' END,
      updated_at = NOW()
     FROM (SELECT k2.id, x.resultado FROM ${T.calls} k2 LEFT JOIN ${T.touches} x ON x.id = k2.touch_id WHERE k2.id = $1) t
     WHERE k.id = t.id AND k.pipeline_status IN ('no_aplica', 'pendiente_resultado', 'omitida', 'pendiente')
     RETURNING k.pipeline_status`,
    [callId, conConversacion, min]);
  return r.rows.length ? r.rows[0].pipeline_status : null;
}

// Pasa por todas las llamadas que aún no entraron al pipeline y les recalcula el estado (por si
// quedaron de antes de que existiera esta lógica, o si cambió DURACION_MINIMA_PIPELINE_S).
async function revisarTodas(db, config) {
  const r = await db.query(`SELECT id FROM ${T.calls} WHERE pipeline_status IN ('no_aplica', 'pendiente_resultado', 'omitida') ORDER BY id`);
  let n = 0;
  for (const { id } of r.rows) { const e = await revisarLlamada(db, config, id); if (e === 'pendiente') n++; }
  return { revisadas: r.rows.length, pendientes: n };
}

async function leerLlamada(db, callId) {
  const r = await db.query(`SELECT * FROM ${T.calls} WHERE id = $1`, [Number(callId)]);
  if (!r.rows.length) throw error(404, 'Llamada no encontrada');
  return r.rows[0];
}

// Transcribe UNA llamada y guarda turnos + métricas. `deps` permite inyectar el transcriptor en
// pruebas. `forzar` procesa aunque el estado no sea "pendiente" (reprocesar a mano).
async function procesar(db, config, env, callId, { deps = {}, forzar = false } = {}) {
  const transcribir = deps.transcribir || deepgram.transcribir;
  const descargar = deps.descargar || deepgram.descargarAudio;
  const llamada = await leerLlamada(db, callId);
  if (!forzar && llamada.pipeline_status !== 'pendiente') return { call_id: llamada.id, estado: llamada.pipeline_status, saltada: true };
  if (!llamada.record_url) throw error(409, 'La llamada no tiene grabación');
  await db.query(`UPDATE ${T.calls} SET pipeline_status = 'transcribiendo', pipeline_at = NOW(), updated_at = NOW() WHERE id = $1`, [llamada.id]);
  try {
    let respuesta;
    if (config.PIPELINE_DESCARGAR_AUDIO) {
      respuesta = await transcribir(await descargar(llamada.record_url), env, config);
    } else {
      try {
        respuesta = await transcribir({ url: llamada.record_url }, env, config);
      } catch (e) {
        // Deepgram no pudo bajar la URL (grabación privada o aún no lista): la bajamos nosotros.
        if (e.status === 400 || /REMOTE_CONTENT|fetch/i.test(e.message)) respuesta = await transcribir(await descargar(llamada.record_url), env, config);
        else throw e;
      }
    }
    const n = deepgram.normalizar(respuesta, config.CANAL_ANGIE_EN_GRABACION, { palabrasAngie: config.PALABRAS_PITCH });
    if (!n.turnos.length) throw error(422, 'La transcripción salió vacía (¿grabación en silencio?)');
    const m = metricas.calcular(n.turnos, config);
    await db.query(
      `INSERT INTO ${T.transcripts} (call_id, proveedor, modelo, idioma, duracion_s, turnos, texto, metricas, meta)
       VALUES ($1, 'deepgram', $2, $3, $4, $5::jsonb, $6, $7::jsonb, $8::jsonb)
       ON CONFLICT (call_id) DO UPDATE SET modelo = EXCLUDED.modelo, idioma = EXCLUDED.idioma, duracion_s = EXCLUDED.duracion_s,
         turnos = EXCLUDED.turnos, texto = EXCLUDED.texto, metricas = EXCLUDED.metricas, meta = EXCLUDED.meta, updated_at = NOW()`,
      [llamada.id, n.modelo || config.DEEPGRAM_MODELO, config.DEEPGRAM_IDIOMA, n.duracion_s, JSON.stringify(n.turnos), n.texto, JSON.stringify(m), JSON.stringify(n.meta)]);
    await db.query(`UPDATE ${T.calls} SET pipeline_status = 'transcrito', pipeline_error = NULL, pipeline_at = NOW(), updated_at = NOW() WHERE id = $1`, [llamada.id]);
    return { call_id: llamada.id, estado: 'transcrito', turnos: n.turnos.length, metricas: m };
  } catch (e) {
    const intentos = (llamada.pipeline_intentos || 0) + 1;
    const max = Number(config.PIPELINE_REINTENTOS) || 1;
    const estado = intentos >= max ? 'error' : 'pendiente';
    await db.query(`UPDATE ${T.calls} SET pipeline_status = $2, pipeline_error = $3, pipeline_intentos = $4, pipeline_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [llamada.id, estado, String(e.message).slice(0, 500), intentos]);
    return { call_id: llamada.id, estado, error: e.message, intentos };
  }
}

// Procesa las pendientes, una por una (Render tiene poca memoria; no hace falta paralelizar).
async function correrPendientes(db, config, env, { limite = 5, deps } = {}) {
  const r = await db.query(`SELECT id FROM ${T.calls} WHERE pipeline_status = 'pendiente' ORDER BY id LIMIT $1`, [limite]);
  const resultados = [];
  for (const { id } of r.rows) resultados.push(await procesar(db, config, env, id, { deps }));
  return resultados;
}

// Evalúa UNA llamada transcrita con la rúbrica activa. `forzar` reevalúa aunque ya esté evaluada.
async function evaluar(db, config, env, callId, { deps = {}, forzar = false } = {}) {
  const E = require('../evaluador');
  const llamada = await leerLlamada(db, callId);
  if (!forzar && llamada.pipeline_status !== 'transcrito') return { call_id: llamada.id, estado: llamada.pipeline_status, saltada: true };
  if (!env.ANTHROPIC_API_KEY) return { call_id: llamada.id, estado: llamada.pipeline_status, saltada: true, motivo: 'sin ANTHROPIC_API_KEY' };
  await db.query(`UPDATE ${T.calls} SET pipeline_status = 'evaluando', pipeline_at = NOW(), updated_at = NOW() WHERE id = $1`, [llamada.id]);
  try {
    const r = await E.evaluarLlamada(db, config, env, llamada.id, { fetchFn: deps.fetchFn });
    await db.query(`UPDATE ${T.calls} SET pipeline_status = 'evaluado', pipeline_error = NULL, pipeline_intentos = 0, pipeline_at = NOW(), updated_at = NOW() WHERE id = $1`, [llamada.id]);
    return { call_id: llamada.id, estado: 'evaluado', no_cumple: r.resultado.no_cumple, avisos: r.avisos, tokens: r.tokens };
  } catch (e) {
    const intentos = (llamada.pipeline_intentos || 0) + 1;
    const estado = intentos >= (Number(config.EVALUADOR_REINTENTOS) || 1) ? 'error_evaluacion' : 'transcrito';
    await db.query(`UPDATE ${T.calls} SET pipeline_status = $2, pipeline_error = $3, pipeline_intentos = $4, pipeline_at = NOW(), updated_at = NOW() WHERE id = $1`,
      [llamada.id, estado, String(e.message).slice(0, 500), intentos]);
    return { call_id: llamada.id, estado, error: e.message, intentos };
  }
}

async function correrEvaluaciones(db, config, env, { limite = 3, deps } = {}) {
  if (!env.ANTHROPIC_API_KEY) return [];
  const r = await db.query(`SELECT id FROM ${T.calls} WHERE pipeline_status = 'transcrito' ORDER BY id LIMIT $1`, [limite]);
  const out = [];
  for (const { id } of r.rows) out.push(await evaluar(db, config, env, id, { deps }));
  return out;
}

// Vuelve a calcular las métricas de una llamada con la config actual, sin transcribir de nuevo.
async function recalcularMetricas(db, config, callId) {
  const r = await db.query(`SELECT id, turnos FROM ${T.transcripts} WHERE call_id = $1`, [Number(callId)]);
  if (!r.rows.length) throw error(404, 'La llamada no tiene transcripción');
  const m = metricas.calcular(r.rows[0].turnos, config);
  await db.query(`UPDATE ${T.transcripts} SET metricas = $2::jsonb, updated_at = NOW() WHERE id = $1`, [r.rows[0].id, JSON.stringify(m)]);
  return m;
}

// Deja una llamada lista para volver a pasar (o para pasar por primera vez a la fuerza).
async function reencolar(db, callId) {
  const llamada = await leerLlamada(db, callId);
  if (!llamada.record_url) throw error(409, 'La llamada no tiene grabación');
  await db.query(`UPDATE ${T.calls} SET pipeline_status = 'pendiente', pipeline_error = NULL, pipeline_intentos = 0, updated_at = NOW() WHERE id = $1`, [llamada.id]);
  return { call_id: llamada.id, estado: 'pendiente' };
}

async function estado(db) {
  const r = await db.query(`SELECT pipeline_status AS estado, COUNT(*)::int AS n FROM ${T.calls} GROUP BY pipeline_status ORDER BY 1`);
  const errores = await db.query(`SELECT id, lead_id, pipeline_status, pipeline_error, pipeline_intentos, pipeline_at FROM ${T.calls} WHERE pipeline_status IN ('error', 'error_evaluacion') ORDER BY pipeline_at DESC LIMIT 10`);
  return { conteo: Object.fromEntries(r.rows.map(x => [x.estado, x.n])), errores: errores.rows };
}

const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;
async function transcripcionDeLlamada(db, callId, config = require('../config')) {
  const r = await db.query(
    `SELECT k.id, k.lead_id, k.duracion_s, k.record_url, k.pipeline_status, k.pipeline_error, ${ms('COALESCE(k.started_at, k.created_at)')} AS started_ms,
            l.empresa, l.contacto, x.resultado, x.nota, x.usuario,
            tr.turnos, tr.texto, tr.metricas, tr.modelo, tr.meta, tr.duracion_s AS duracion_audio_s, ${ms('tr.created_at')} AS transcrito_ms
     FROM ${T.calls} k JOIN ${T.leads} l ON l.id = k.lead_id
     LEFT JOIN ${T.touches} x ON x.id = k.touch_id
     LEFT JOIN ${T.transcripts} tr ON tr.call_id = k.id
     WHERE k.id = $1`, [Number(callId)]);
  if (!r.rows.length) throw error(404, 'Llamada no encontrada');
  const fila = r.rows[0];
  fila.evaluacion = await require('../evaluador').evaluacionDeLlamada(db, config, fila.id);
  return fila;
}

// Trabajador en el servidor: revisa cada PIPELINE_INTERVALO_S si hay pendientes. Sin
// DEEPGRAM_API_KEY no arranca (y lo dice una vez). Devuelve el temporizador para poder pararlo.
function iniciar(db, config, env = process.env, log = console) {
  if (!env.DEEPGRAM_API_KEY && !env.GOOGLE_CALENDAR_KEY_FILE && !env.GOOGLE_CALENDAR_KEY && !env.ANTHROPIC_API_KEY && !env.CALENDLY_TOKEN) { log.log('[sdr/pipeline] sin DEEPGRAM_API_KEY ni llave de calendario: nada que hacer en segundo plano'); return null; }
  if (!env.DEEPGRAM_API_KEY) log.log('[sdr/pipeline] sin DEEPGRAM_API_KEY: las llamadas quedan en "pendiente" hasta que la pongas');
  let enCurso = false, ultimaCalendly = 0;
  const tick = async () => {
    if (enCurso) return;
    enCurso = true;
    try {
      const rs = await correrPendientes(db, config, env, { limite: 3 });
      for (const r of rs) log.log(`[sdr/pipeline] llamada ${r.call_id}: ${r.estado}${r.error ? ' · ' + r.error : ''}${r.turnos ? ' · ' + r.turnos + ' turnos' : ''}`);
      const ev = await correrEvaluaciones(db, config, env, { limite: 3 });
      for (const r of ev) log.log(`[sdr/evaluador] llamada ${r.call_id}: ${r.estado}${r.error ? ' · ' + r.error : ''}${r.no_cumple ? ' · no cumple: ' + (r.no_cumple.join(', ') || 'nada') : ''}`);
      // Foto del informe semanal (viernes por la tarde), una vez por semana y usuario.
      await require('../mejora').jobInforme(db, config, new Date()).catch(e => log.error('[sdr/mejora]', e.message));
      // Compromisos que se quedaron sin evento en el calendario (Google falló): se reintentan aquí.
      const c = await require('../compromisos').reintentarPendientes(db, config, env, { limite: 10 });
      if (c.ok) log.log(`[sdr/calendario] ${c.ok} compromisos subidos al calendario en el reintento`);
      // Calendly: reservas hechas desde el link y cancelaciones (con CALENDLY_TOKEN).
      const cadaCal = Math.max(1, Number((config.CALENDLY || {}).sincronizar_min) || 10) * 60000;
      if (env.CALENDLY_TOKEN && Date.now() - ultimaCalendly >= cadaCal) {
        ultimaCalendly = Date.now();
        const k = await require('../calendly').sincronizar(db, config, env, { log });
        if (k.nuevas || k.canceladas || k.movidas || k.sin_lead) log.log(`[sdr/calendly] ${k.nuevas} nuevas, ${k.movidas} movidas, ${k.canceladas} canceladas, ${k.sin_lead} sin lead`);
      }
    } catch (e) { log.error('[sdr/pipeline]', e.message); }
    finally { enCurso = false; }
  };
  const cada = Math.max(15, Number(config.PIPELINE_INTERVALO_S) || 60) * 1000;
  const timer = setInterval(tick, cada);
  if (timer.unref) timer.unref();
  const primero = setTimeout(tick, 10000);
  if (primero.unref) primero.unref();
  log.log(`[sdr/pipeline] activo: revisa pendientes cada ${cada / 1000} s`);
  return timer;
}

module.exports = { revisarLlamada, revisarTodas, procesar, evaluar, correrEvaluaciones, correrPendientes, recalcularMetricas, reencolar, estado, transcripcionDeLlamada, iniciar };

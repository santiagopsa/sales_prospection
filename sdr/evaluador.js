// Evaluación de una llamada transcrita contra la rúbrica activa, con Claude (API de mensajes,
// sin SDK: un fetch). El resultado es un JSON estricto por criterio: cumple / no_cumple / no_aplica,
// cita textual (obligatoria para no_cumple), confianza 0–1 y una nota concreta. Se guarda en
// sdr.evaluations atado a la versión de la rúbrica.
//
// Lo que ve Angie de esto NO es la evaluación llamada por llamada (VER_TRANSCRIPCION), sino el
// resumen semanal (mejora.js): hábitos, foco y mejor momento.
const { T } = require('./schema');

const API = 'https://api.anthropic.com/v1/messages';
function error(status, message) { return Object.assign(new Error(message), { status }); }

// ---- Rúbrica: siembra y lectura -------------------------------------------------------------

// Siembra una versión de rúbrica si no existe. Nunca sobreescribe: una versión es inmutable.
async function sembrarRubrica(db, rubrica, { activar = false } = {}) {
  const r = await db.query(
    `INSERT INTO ${T.rubricas} (version, fuentes, criterios, reglas, activa)
     VALUES ($1, $2, $3::jsonb, $4::jsonb, $5) ON CONFLICT (version) DO NOTHING RETURNING id`,
    [rubrica.version, rubrica.fuentes || null, JSON.stringify(rubrica.criterios), JSON.stringify(rubrica.reglas), !!activar]);
  if (activar) await db.query(`UPDATE ${T.rubricas} SET activa = (version = $1)`, [rubrica.version]);
  return { version: rubrica.version, nueva: r.rows.length > 0 };
}

async function rubricaActiva(db, config) {
  const v = config.RUBRICA_ACTIVA;
  const r = await db.query(`SELECT version, fuentes, criterios, reglas FROM ${T.rubricas} WHERE ${v ? 'version = $1' : 'activa'} LIMIT 1`, v ? [v] : []);
  if (!r.rows.length) throw error(503, `No hay rúbrica ${v ? v : 'activa'} en la base (se siembra al arrancar el servidor)`);
  return r.rows[0];
}

// ---- Prompt ---------------------------------------------------------------------------------

function textoTranscripcion(turnos) {
  const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  return turnos.map(t => `[${fmt(t.inicio)}] ${t.quien === 'angie' ? 'ANGIE' : 'PROSPECTO'}: ${t.texto}`).join('\n');
}

function construirPrompt(rubrica, config, { turnos, metricas, lead, resultado, nota }) {
  const criterios = rubrica.criterios.map((c, i) => [
    `${i + 1}. id="${c.id}" · ${c.nombre}`,
    `   Qué se espera: ${c.descripcion}`,
    `   Cumple, por ejemplo: ${c.cumple}`,
    `   No cumple, por ejemplo: ${c.no_cumple}`,
    c.usa_metricas ? `   Métricas que aplican: ${c.usa_metricas}` : null,
  ].filter(Boolean).join('\n')).join('\n\n');
  const m = metricas || {};
  const metricasTxt = [
    `proporcion_angie=${m.proporcion_angie} (fracción del tiempo hablado que habla Angie)`,
    `preguntas_angie=${m.preguntas_angie}, preguntas_antes_del_pitch=${m.preguntas_antes_del_pitch}, pitch_en_s=${m.pitch_en_s}, primera_pregunta_s=${m.primera_pregunta_s}`,
    `monologo_mas_largo_s=${m.monologo_mas_largo_s}, monologos_largos=${m.monologos_largos} (umbral MONOLOGO_LARGO_S=${config.MONOLOGO_LARGO_S})`,
    `ppm_angie=${m.ppm_angie}, va_rapido=${m.va_rapido} (umbral RITMO_RAPIDO_PPM=${config.RITMO_RAPIDO_PPM}), muletillas_por_min=${m.muletillas_por_min}, muletillas=${JSON.stringify(m.muletillas_detalle || {})}`,
    `interrupciones=${m.interrupciones}, turnos_prospecto=${m.turnos_prospecto}`,
  ].join('\n');
  const contexto = [
    lead && lead.empresa && `Empresa: ${lead.empresa}`,
    lead && lead.contacto && `Contacto: ${lead.contacto}${lead.cargo ? ' (' + lead.cargo + ')' : ''}`,
    resultado && `Resultado que registró Angie: ${resultado}`,
    nota && `Nota de Angie: ${nota}`,
  ].filter(Boolean).join('\n');

  const system = `Eres un evaluador de llamadas en frío de un SDR de Peaku (headhunting tech, EOR y SaaS de reclutamiento en Colombia). Tu trabajo es aplicar una rúbrica con rigor: evidencia textual o nada. No eres un coach que da consejos; eres un juez que cita.

REGLAS:
${rubrica.reglas.map(r => '- ' + r).join('\n')}

FORMATO DE RESPUESTA (JSON estricto, nada más):
{
  "criterios": [
    { "id": "<id del criterio>", "estado": "cumple" | "no_cumple" | "no_aplica", "cita": "<fragmento literal de la transcripción o null>", "confianza": <0 a 1>, "nota": "<una frase concreta sobre esta llamada>" }
  ],
  "mejor_momento": { "cita": "<fragmento literal de Angie que valga la pena repetir>", "por_que": "<una frase>" } | null,
  "menciono_grabacion": true | false,
  "resumen": "<dos frases: qué pasó en la llamada y cómo terminó>"
}
Incluye los ${rubrica.criterios.length} criterios, en el mismo orden, con su id exacto.`;

  const user = `RÚBRICA ${rubrica.version}:

${criterios}

CONTEXTO:
${contexto || '(sin contexto)'}

MÉTRICAS CALCULADAS SOBRE LA TRANSCRIPCIÓN:
${metricasTxt}

TRANSCRIPCIÓN (ANGIE es la SDR; PROSPECTO es la persona a la que llamó; entre corchetes el minuto):
${textoTranscripcion(turnos)}

Evalúa según la rúbrica y responde solo con el JSON.`;
  return { system, user };
}

// ---- Llamada al modelo ----------------------------------------------------------------------

async function llamarModelo(env, config, { system, user }, { fetchFn = fetch } = {}) {
  const key = env.ANTHROPIC_API_KEY;
  if (!key) throw error(503, 'Falta ANTHROPIC_API_KEY');
  const modelo = config.EVALUADOR_MODELO || env.ANALYZE_MODEL || 'claude-sonnet-4-5';
  const r = await fetchFn(API, {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: modelo, max_tokens: Number(config.EVALUADOR_MAX_TOKENS) || 2500, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw error(r.status === 429 ? 429 : 502, `Claude ${r.status}: ${(j.error && j.error.message) || JSON.stringify(j).slice(0, 200)}`);
  const texto = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n');
  return { texto, modelo: j.model || modelo, tokens_in: j.usage && j.usage.input_tokens, tokens_out: j.usage && j.usage.output_tokens };
}

// Saca el JSON aunque venga con texto alrededor o en un bloque de código.
function extraerJson(texto) {
  const s = String(texto || '').trim();
  const sinFence = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(sinFence); } catch (_) { /* sigue */ }
  const a = s.indexOf('{'), b = s.lastIndexOf('}');
  if (a >= 0 && b > a) { try { return JSON.parse(s.slice(a, b + 1)); } catch (_) { /* sigue */ } }
  throw error(422, 'El evaluador no devolvió JSON válido');
}

// Hace cumplir las reglas aunque el modelo se salte una: sin cita no hay "no_cumple"; ids
// completos; confianza en [0,1]; estados válidos. Devuelve el resultado limpio + avisos.
function validar(rubrica, crudo, turnos) {
  const texto = (turnos || []).map(t => t.texto).join(' ').toLowerCase();
  const avisos = [];
  const porId = new Map((Array.isArray(crudo.criterios) ? crudo.criterios : []).map(c => [c && c.id, c]));
  const criterios = rubrica.criterios.map(def => {
    const c = porId.get(def.id) || {};
    let estado = ['cumple', 'no_cumple', 'no_aplica'].includes(c.estado) ? c.estado : 'cumple';
    let cita = c.cita && String(c.cita).trim() ? String(c.cita).trim() : null;
    if (!porId.has(def.id)) avisos.push(`el modelo no evaluó "${def.id}"; se toma como cumple`);
    if (estado === 'no_cumple') {
      const enTexto = cita && texto.includes(cita.toLowerCase().slice(0, 40));
      if (!cita) { estado = 'cumple'; avisos.push(`"${def.id}": no_cumple sin cita → se descarta`); }
      else if (!enTexto) avisos.push(`"${def.id}": la cita no aparece literal en la transcripción`);
    }
    let confianza = Number(c.confianza);
    if (!Number.isFinite(confianza)) confianza = 0.5;
    confianza = Math.max(0, Math.min(1, confianza));
    return { id: def.id, estado, cita, confianza: Number(confianza.toFixed(2)), nota: c.nota ? String(c.nota).slice(0, 300) : (estado === 'cumple' ? 'Nada que señalar.' : '') };
  });
  const mm = crudo.mejor_momento && crudo.mejor_momento.cita ? { cita: String(crudo.mejor_momento.cita).slice(0, 400), por_que: String(crudo.mejor_momento.por_que || '').slice(0, 300) } : null;
  return {
    resultado: {
      criterios, mejor_momento: mm,
      menciono_grabacion: !!crudo.menciono_grabacion,
      resumen: String(crudo.resumen || '').slice(0, 600),
      no_cumple: criterios.filter(c => c.estado === 'no_cumple').map(c => c.id),
    },
    avisos,
  };
}

// ---- Evaluar y guardar ----------------------------------------------------------------------

async function evaluarLlamada(db, config, env, callId, { fetchFn } = {}) {
  const r = await db.query(
    `SELECT k.id, k.lead_id, tr.turnos, tr.metricas, l.empresa, l.contacto, l.cargo, x.resultado, x.nota
     FROM ${T.calls} k JOIN ${T.transcripts} tr ON tr.call_id = k.id JOIN ${T.leads} l ON l.id = k.lead_id
     LEFT JOIN ${T.touches} x ON x.id = k.touch_id WHERE k.id = $1`, [Number(callId)]);
  if (!r.rows.length) throw error(404, 'La llamada no tiene transcripción');
  const fila = r.rows[0];
  const rubrica = await rubricaActiva(db, config);
  const prompt = construirPrompt(rubrica, config, { turnos: fila.turnos, metricas: fila.metricas, lead: fila, resultado: fila.resultado, nota: fila.nota });
  const m = await llamarModelo(env, config, prompt, { fetchFn });
  const crudo = extraerJson(m.texto);
  const { resultado, avisos } = validar(rubrica, crudo, fila.turnos);
  const g = await db.query(
    `INSERT INTO ${T.evaluations} (call_id, rubrica_version, modelo, resultado, avisos, tokens_in, tokens_out)
     VALUES ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7)
     ON CONFLICT (call_id, rubrica_version) DO UPDATE SET modelo = EXCLUDED.modelo, resultado = EXCLUDED.resultado, avisos = EXCLUDED.avisos,
       tokens_in = EXCLUDED.tokens_in, tokens_out = EXCLUDED.tokens_out, created_at = NOW()
     RETURNING id`,
    [fila.id, rubrica.version, m.modelo, JSON.stringify(resultado), JSON.stringify(avisos), m.tokens_in || null, m.tokens_out || null]);
  return { evaluation_id: g.rows[0].id, call_id: fila.id, rubrica: rubrica.version, modelo: m.modelo, resultado, avisos, tokens: { in: m.tokens_in, out: m.tokens_out } };
}

async function evaluacionDeLlamada(db, config, callId) {
  const v = config.RUBRICA_ACTIVA;
  const r = await db.query(
    `SELECT e.id, e.rubrica_version, e.modelo, e.resultado, e.avisos, (EXTRACT(EPOCH FROM e.created_at) * 1000)::float8 AS created_ms, rb.criterios
     FROM ${T.evaluations} e JOIN ${T.rubricas} rb ON rb.version = e.rubrica_version
     WHERE e.call_id = $1 ${v ? 'AND e.rubrica_version = $2' : ''} ORDER BY e.created_at DESC LIMIT 1`, v ? [Number(callId), v] : [Number(callId)]);
  return r.rows[0] || null;
}

module.exports = { sembrarRubrica, rubricaActiva, construirPrompt, llamarModelo, extraerJson, validar, evaluarLlamada, evaluacionDeLlamada, textoTranscripcion };

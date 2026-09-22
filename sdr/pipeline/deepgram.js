// Transcripción con Deepgram (API REST pre-grabada). Sin SDK: un POST con fetch.
//
// La grabación es estéreo (prospecto en un canal, Angie en el otro), así que se pide
// multichannel y "quién habló" sale del canal, no de una diarización probabilística. Los
// "utterances" de Deepgram (frases con inicio/fin por canal) se convierten en turnos.
const URL_BASE = 'https://api.deepgram.com/v1/listen';

function error(status, message, extra) { return Object.assign(new Error(message), { status, ...extra }); }

function parametros(config) {
  const q = new URLSearchParams({
    model: config.DEEPGRAM_MODELO || 'nova-2',
    language: config.DEEPGRAM_IDIOMA || 'es',
    multichannel: 'true',
    punctuate: 'true',
    smart_format: 'true',
    utterances: 'true',
    utt_split: '1.2',
  });
  return q.toString();
}

// `entrada`: { url } o { audio: Buffer, contentType }. Devuelve la respuesta cruda de Deepgram.
async function transcribir(entrada, env, config, { fetchFn = fetch } = {}) {
  const key = env.DEEPGRAM_API_KEY;
  if (!key) throw error(503, 'Falta DEEPGRAM_API_KEY');
  const url = `${URL_BASE}?${parametros(config)}`;
  const opciones = { method: 'POST', headers: { Authorization: `Token ${key}` } };
  if (entrada.audio) {
    opciones.headers['Content-Type'] = entrada.contentType || 'audio/mpeg';
    opciones.body = entrada.audio;
  } else {
    opciones.headers['Content-Type'] = 'application/json';
    opciones.body = JSON.stringify({ url: entrada.url });
  }
  const r = await fetchFn(url, opciones);
  const texto = await r.text();
  let json = null;
  try { json = JSON.parse(texto); } catch (_) { /* respuesta no JSON */ }
  if (!r.ok) {
    const codigo = json && (json.err_code || json.error);
    throw error(r.status, `Deepgram ${r.status}${codigo ? ' ' + codigo : ''}: ${(json && (json.err_msg || json.message)) || texto.slice(0, 200)}`, { codigo });
  }
  return json;
}

// Descarga el audio de la grabación (cuando la URL no es pública para Deepgram o por config).
async function descargarAudio(url, { fetchFn = fetch, maxBytes = 200 * 1024 * 1024 } = {}) {
  const r = await fetchFn(url);
  if (!r.ok) throw error(502, `No se pudo descargar la grabación (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > maxBytes) throw error(413, 'La grabación pesa más de 200 MB');
  const ct = r.headers.get('content-type') || (/\.wav(\?|$)/i.test(url) ? 'audio/wav' : 'audio/mpeg');
  return { audio: buf, contentType: ct.split(';')[0] };
}

// Respuesta de Deepgram → { turnos, texto, duracion_s, modelo, meta }.
// `canalAngie` es 'derecho' (canal 1) o 'izquierdo' (canal 0), según CANAL_ANGIE_EN_GRABACION.
function normalizar(respuesta, canalAngie = 'derecho') {
  const res = (respuesta && respuesta.results) || {};
  const meta = (respuesta && respuesta.metadata) || {};
  const idxAngie = canalAngie === 'izquierdo' ? 0 : 1;
  const quien = ch => (ch === idxAngie ? 'angie' : 'prospecto');
  let turnos = [];
  if (Array.isArray(res.utterances) && res.utterances.length) {
    turnos = res.utterances.map(u => ({
      quien: quien(u.channel || 0), inicio: u.start, fin: u.end,
      texto: u.transcript || '', palabras: Array.isArray(u.words) ? u.words.length : undefined,
    }));
  } else if (Array.isArray(res.channels)) {
    // Sin utterances: frases a partir de las palabras de cada canal, cortando en pausas > 1.2 s.
    res.channels.forEach((c, ch) => {
      const words = ((c.alternatives || [])[0] || {}).words || [];
      let actual = null;
      for (const w of words) {
        if (!actual || w.start - actual.fin > 1.2) { actual = { quien: quien(ch), inicio: w.start, fin: w.end, texto: '', palabras: 0 }; turnos.push(actual); }
        actual.texto += (actual.texto ? ' ' : '') + (w.punctuated_word || w.word);
        actual.fin = w.end; actual.palabras++;
      }
    });
  }
  turnos = turnos.filter(t => t.texto && t.texto.trim()).sort((a, b) => a.inicio - b.inicio)
    .map(t => ({ ...t, inicio: Number(t.inicio.toFixed(2)), fin: Number(t.fin.toFixed(2)), palabras: t.palabras || t.texto.split(/\s+/).filter(Boolean).length }));
  const texto = turnos.map(t => `[${fmt(t.inicio)}] ${t.quien === 'angie' ? 'Angie' : 'Prospecto'}: ${t.texto}`).join('\n');
  const modelo = meta.models && meta.model_info ? Object.values(meta.model_info).map(m => `${m.name} ${m.version}`).join(', ') : null;
  return {
    turnos, texto,
    duracion_s: Number.isFinite(meta.duration) ? Number(meta.duration.toFixed(1)) : null,
    modelo,
    meta: { request_id: meta.request_id, canales: meta.channels, duracion: meta.duration, utterances: !!(res.utterances && res.utterances.length) },
  };
}

const fmt = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

module.exports = { transcribir, descargarAudio, normalizar, parametros, URL_BASE };

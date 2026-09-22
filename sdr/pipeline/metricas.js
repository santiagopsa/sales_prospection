// Métricas de una conversación a partir de los turnos de la transcripción.
//
// Entrada: turnos [{ quien: 'angie'|'prospecto', inicio, fin, texto, palabras }] en segundos, en orden.
// Salida: números que no dependen del proveedor y que se pueden recalcular cuando se mueve un
// hueco (PALABRAS_PITCH, MONOLOGO_LARGO_S…) sin volver a transcribir.
//
// Qué mide y por qué (Cold Calling Sucks, Fanatical Prospecting, Sales Development Playbook):
//   proporcion_angie          cuánto habla Angie del total hablado (ideal: menos de la mitad una vez hay conversación)
//   preguntas_antes_del_pitch preguntar antes de contar; el pitch empieza en el primer turno con PALABRAS_PITCH
//   monologo_mas_largo_s      un monólogo largo es el síntoma más común de "contar en vez de conversar"
//   ppm_angie                 velocidad; en frío se tiende a acelerar
//   muletillas_por_min        ruido verbal
//   interrupciones            veces que Angie arranca mientras el prospecto sigue hablando
//   primera_pregunta_s        cuánto tarda en pasar de hablar a preguntar

const sinAcentos = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
const redondear = (x, d = 2) => x == null || !Number.isFinite(x) ? null : Number(x.toFixed(d));

function contarPreguntas(texto) {
  return (String(texto || '').match(/\?/g) || []).length;
}

function contarPalabras(texto) {
  return String(texto || '').split(/\s+/).filter(Boolean).length;
}

// Ocurrencias de cada muletilla como palabra completa (sin acentos).
function contarMuletillas(texto, lista) {
  const t = ' ' + sinAcentos(texto).replace(/[^a-z0-9ñ\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const detalle = {};
  let total = 0;
  for (const m of lista || []) {
    const clave = ' ' + sinAcentos(m).trim() + ' ';
    let n = 0, i = 0;
    while ((i = t.indexOf(clave, i)) !== -1) { n++; i += clave.length - 1; }
    if (n) { detalle[m] = n; total += n; }
  }
  return { total, detalle };
}

// Turnos consecutivos del mismo hablante separados por menos de `pausa` segundos se funden.
function fundir(turnos, pausa) {
  const out = [];
  for (const t of turnos) {
    const u = out[out.length - 1];
    if (u && u.quien === t.quien && t.inicio - u.fin <= pausa) {
      u.fin = Math.max(u.fin, t.fin); u.texto += ' ' + t.texto; u.palabras += t.palabras;
    } else out.push({ ...t });
  }
  return out;
}

function calcular(turnos, config = {}) {
  turnos = (turnos || []).filter(t => t && Number.isFinite(t.inicio) && Number.isFinite(t.fin)).map(t => ({
    quien: t.quien, inicio: t.inicio, fin: t.fin, texto: String(t.texto || ''), palabras: t.palabras || contarPalabras(t.texto),
  })).sort((a, b) => a.inicio - b.inicio);
  const angie = turnos.filter(t => t.quien === 'angie');
  const prospecto = turnos.filter(t => t.quien === 'prospecto');
  const dur = xs => xs.reduce((s, t) => s + Math.max(0, t.fin - t.inicio), 0);
  const hablaAngie = dur(angie), hablaProspecto = dur(prospecto);
  const total = hablaAngie + hablaProspecto;
  const palabrasAngie = angie.reduce((s, t) => s + t.palabras, 0);
  const textoAngie = angie.map(t => t.texto).join(' ');

  // Pitch: primer turno de Angie con una palabra de PALABRAS_PITCH. Las preguntas "antes del
  // pitch" son las de los turnos anteriores más las de ese turno antes de la palabra.
  const pitch = (config.PALABRAS_PITCH || []).map(sinAcentos).filter(Boolean);
  const posPitch = t => { const x = sinAcentos(t.texto); const ps = pitch.map(p => x.indexOf(p)).filter(i => i >= 0); return ps.length ? Math.min(...ps) : -1; };
  const turnoPitch = angie.find(t => posPitch(t) >= 0);
  const preguntasAntesDelPitch = turnoPitch == null ? null
    : angie.filter(t => t.inicio < turnoPitch.inicio).reduce((s, t) => s + contarPreguntas(t.texto), 0)
      + contarPreguntas(sinAcentos(turnoPitch.texto).slice(0, posPitch(turnoPitch)));

  const fundidos = fundir(turnos, config.PAUSA_MISMO_TURNO_S ?? 1.5).filter(t => t.quien === 'angie');
  const monologo = fundidos.reduce((m, t) => Math.max(m, t.fin - t.inicio), 0);
  const primeraPregunta = angie.find(t => contarPreguntas(t.texto) > 0);

  // Interrupciones: Angie arranca antes de que el prospecto termine (con un margen de 0.3 s).
  let interrupciones = 0;
  for (let i = 1; i < turnos.length; i++) {
    const t = turnos[i], u = turnos[i - 1];
    if (t.quien === 'angie' && u.quien === 'prospecto' && t.inicio < u.fin - 0.3) interrupciones++;
  }

  const mul = contarMuletillas(textoAngie, config.PALABRAS_MULETILLA);
  const minAngie = hablaAngie / 60;
  const ppm = minAngie > 0 ? palabrasAngie / minAngie : null;
  return {
    duracion_hablada_s: redondear(total, 1),
    habla_angie_s: redondear(hablaAngie, 1),
    habla_prospecto_s: redondear(hablaProspecto, 1),
    proporcion_angie: total > 0 ? redondear(hablaAngie / total, 3) : null,
    turnos: turnos.length,
    turnos_prospecto: prospecto.length,
    palabras_angie: palabrasAngie,
    palabras_prospecto: prospecto.reduce((s, t) => s + t.palabras, 0),
    ppm_angie: redondear(ppm, 0),
    va_rapido: ppm != null && config.RITMO_RAPIDO_PPM != null ? ppm > config.RITMO_RAPIDO_PPM : null,
    preguntas_angie: contarPreguntas(textoAngie),
    preguntas_prospecto: contarPreguntas(prospecto.map(t => t.texto).join(' ')),
    primera_pregunta_s: primeraPregunta ? redondear(primeraPregunta.inicio, 1) : null,
    pitch_en_s: turnoPitch ? redondear(turnoPitch.inicio, 1) : null,
    preguntas_antes_del_pitch: preguntasAntesDelPitch,
    monologo_mas_largo_s: redondear(monologo, 1),
    monologos_largos: config.MONOLOGO_LARGO_S != null ? fundidos.filter(t => t.fin - t.inicio > config.MONOLOGO_LARGO_S).length : null,
    interrupciones,
    muletillas: mul.total,
    muletillas_por_min: minAngie > 0 ? redondear(mul.total / minAngie, 1) : null,
    muletillas_detalle: mul.detalle,
    apertura: angie.length ? angie[0].texto.slice(0, 300) : null,
  };
}

// Texto corto para mostrar en la app / el CLI.
const ETIQUETAS = {
  proporcion_angie: ['Habla Angie', v => v == null ? '—' : Math.round(v * 100) + ' %'],
  preguntas_antes_del_pitch: ['Preguntas antes del pitch', v => v == null ? 'sin pitch detectado' : String(v)],
  preguntas_angie: ['Preguntas de Angie', v => String(v)],
  primera_pregunta_s: ['Primera pregunta', v => v == null ? 'ninguna' : `seg ${Math.round(v)}`],
  pitch_en_s: ['Pitch empieza', v => v == null ? 'no detectado' : `seg ${Math.round(v)}`],
  monologo_mas_largo_s: ['Monólogo más largo', v => `${Math.round(v)} s`],
  ppm_angie: ['Velocidad', v => v == null ? '—' : `${v} ppm`],
  muletillas_por_min: ['Muletillas / min', v => v == null ? '—' : String(v)],
  interrupciones: ['Interrupciones', v => String(v)],
  turnos_prospecto: ['Turnos del prospecto', v => String(v)],
};

module.exports = { calcular, contarPreguntas, contarMuletillas, fundir, ETIQUETAS };

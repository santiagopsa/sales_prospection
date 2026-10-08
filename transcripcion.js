// ¿La transcripción da para analizar? Google Meet a veces deja de transcribir al minuto ("Transcription
// ended after 00:01:05") y lo que llega es el encabezado, dos frases y el pie: la IA, obligada a aplicar
// las reglas, marca todo como "no cumple" y parece que el demo fue malo. Esto lo detecta antes.
// Umbral en sdr/config.js → SANDLER.transcripcion_minima_palabras.
'use strict';

const PIE = /^(this editable transcript|people can also change the text|transcription ended after|transcript$|.*-\s*transcript$|esta transcripci[oó]n editable|los usuarios tambi[eé]n pueden|la transcripci[oó]n finaliz[oó] despu[eé]s de|transcripci[oó]n$|.*-\s*transcripci[oó]n$)/i;
const HORA = /^\d{1,2}:\d{2}(:\d{2})?$/;

// Palabras de diálogo: quita encabezado, marcas de tiempo, el pie de Meet y el nombre del que habla.
function palabrasDeDialogo(texto) {
  let n = 0;
  for (const linea0 of String(texto || '').split('\n')) {
    const linea = linea0.trim();
    if (!linea || HORA.test(linea) || PIE.test(linea)) continue;
    if (/^[A-Z][a-z]{2}\s\d{1,2},\s\d{4}$/.test(linea)) continue;              // "Oct 7, 2026"
    const sinHablante = linea.replace(/^[^:]{2,60}:\s*/, '');                   // "Angie Oliveros: hola" → "hola"
    n += sinHablante.split(/\s+/).filter(w => /[a-záéíóúñ0-9]/i.test(w)).length;
  }
  return n;
}

// "Transcription ended after 00:01:05" / "La transcripción finalizó después de 00:46:56" → segundos; null si no está.
function duracionDeMeet(texto) {
  const m = /(?:transcription ended after|transcripci[oó]n finaliz[oó] despu[eé]s de)\s+(\d{1,2}):(\d{2}):(\d{2})/i.exec(String(texto || ''));
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
}
// Última marca de tiempo del cuerpo ("00:46:09"): si Meet no puso el pie, dice hasta dónde llegó.
function ultimaMarca(texto) {
  let ult = null;
  for (const l of String(texto || '').split('\n')) { const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(l.trim()); if (m) ult = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]); }
  return ult;
}

// Un demo de verdad dura más de DEMO_MINIMO_MIN; una transcripción que termina antes está cortada.
const DEMO_MINIMO_MIN = 10;
function evaluar(texto, { minimoPalabras = 400 } = {}) {
  const palabras = palabrasDeDialogo(texto);
  const duracion_s = duracionDeMeet(texto) ?? ultimaMarca(texto);
  const cortada = duracion_s != null && duracion_s < DEMO_MINIMO_MIN * 60;
  const suficiente = palabras >= minimoPalabras;
  let motivo = null;
  if (!suficiente) {
    const min = duracion_s != null ? `${Math.floor(duracion_s / 60)} min ${duracion_s % 60} s` : null;
    motivo = cortada
      ? `La transcripción de Meet se cortó a los ${min} (dice "Transcription ended after"): solo trae ${palabras} palabras de conversación. Con eso la IA marcaría todo como "no cumple" y no sería verdad. Vuelve a Google Meet, abre la grabación y pega la transcripción completa (o pide la transcripción de Gemini / Otter).`
      : `La transcripción solo trae ${palabras} palabras de conversación (un demo de 30 min tiene miles). Pega la transcripción completa antes de analizar.`;
  }
  return { palabras, duracion_s, cortada, suficiente, motivo };
}

module.exports = { evaluar, palabrasDeDialogo, duracionDeMeet, ultimaMarca, DEMO_MINIMO_MIN };

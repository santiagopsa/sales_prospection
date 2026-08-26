'use strict';
/**
 * Cómo se decide qué es un archivo subido.
 *
 * Vive aparte porque el stub de pruebas tenía su propia versión —más permisiva— de
 * /api/extract-text: aceptaba cualquier cosa y devolvía el texto crudo. Por eso ninguna
 * prueba de navegador vio que la pantalla de transcripción mandaba el nombre del archivo
 * en el campo equivocado (`name` en vez de `filename`). El servidor real se quedaba sin
 * extensión, un .docx caía al camino de texto plano y el usuario leía
 * "No sé leer archivos ." — un error nuestro disfrazado de culpa del archivo.
 *
 * Con la decisión aquí, el servidor y el stub no pueden volver a discrepar.
 */

// Texto plano: se decodifica directo, sin librería.
const PLANAS = ['txt', 'md', 'vtt', 'srt', 'csv', 'json', 'log'];
// Las que además sabemos abrir con una librería.
const CONOCIDAS = PLANAS.concat(['docx', 'pdf']);

/** El nombre del archivo, venga en `filename` o en `name`. */
function nombreDe(cuerpo) {
  const c = cuerpo || {};
  return String(c.filename || c.name || '');
}

/**
 * La extensión, en minúscula y sin punto. '' si el nombre no la trae.
 * Ojo: 'sin_punto'.split('.').pop() devuelve 'sin_punto', no ''. De ahí el lastIndexOf.
 */
function extensionDelNombre(nombre) {
  const n = String(nombre || '');
  const punto = n.lastIndexOf('.');
  return punto > 0 ? n.slice(punto + 1).toLowerCase() : '';
}

/**
 * Qué es el archivo según sus primeros bytes. Drive a veces entrega la transcripción
 * sin extensión, y la firma es más confiable que el nombre: un .docx es un zip
 * (PK\x03\x04) y un PDF empieza con "%PDF-".
 */
function extensionPorFirma(buf) {
  if (!buf || buf.length < 4) return '';
  if (buf.slice(0, 5).toString('latin1') === '%PDF-') return 'pdf';
  if (buf[0] === 0x50 && buf[1] === 0x4B && buf[2] === 0x03 && buf[3] === 0x04) return 'docx';
  return '';
}

/** La extensión que se va a usar: la del nombre si la reconocemos, si no la de la firma. */
function extensionDe(nombre, buf) {
  const porNombre = extensionDelNombre(nombre);
  if (CONOCIDAS.includes(porNombre)) return porNombre;
  return extensionPorFirma(buf) || porNombre;
}

/** ¿El texto decodificado es basura binaria? (caracteres de reemplazo al inicio) */
function pareceBinario(texto) {
  return /�/.test(String(texto || '').slice(0, 2000));
}

/** El mensaje de error, que debe decir qué pasó sin inventarle una extensión al archivo. */
function mensajeNoLeible(ext) {
  const que = ext ? `archivos .${ext}` : 'este archivo (no trae extensión ni firma que reconozca)';
  return `No sé leer ${que}. Usa .txt, .docx, .pdf, .vtt o pega el texto.`;
}

/** Subtítulos de Meet: fuera las marcas de tiempo y los numeritos de bloque. */
function limpiarSubtitulos(texto) {
  return String(texto || '')
    .replace(/^WEBVTT.*$/gm, '')
    .replace(/^\d+$/gm, '')
    .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, '')
    .replace(/\n{3,}/g, '\n\n');
}

module.exports = {
  PLANAS, CONOCIDAS, nombreDe,
  extensionDelNombre, extensionPorFirma, extensionDe,
  pareceBinario, mensajeNoLeible, limpiarSubtitulos,
};

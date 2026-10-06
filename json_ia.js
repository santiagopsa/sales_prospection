// Leer el JSON que devuelve la IA. Claude casi siempre responde el objeto limpio, pero a veces lo envuelve
// en ```json ... ```, le antepone una frase ("Aquí está el análisis:") o deja una cita con comillas sin
// escapar. Esto saca el objeto; si aun así no parsea, el que llama decide (server.js pide una reparación).
'use strict';

function extraerJSON(text) {
  let t = String(text || '').trim();
  const fenced = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) t = fenced[1].trim();
  const a = t.indexOf('{'), b = t.lastIndexOf('}');
  if (a >= 0 && b > a) t = t.slice(a, b + 1);
  return t;
}

function parsearJSON(text) {
  try { return JSON.parse(extraerJSON(text)); } catch (_) { return null; }
}

// Texto de una respuesta de la API de mensajes (puede traer varios bloques).
const textoDe = msg => ((msg && msg.content) || []).filter(c => c && c.type === 'text').map(c => c.text).join('');

module.exports = { extraerJSON, parsearJSON, textoDe };

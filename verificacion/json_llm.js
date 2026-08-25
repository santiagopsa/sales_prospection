// Leer el JSON que devuelve el modelo sin romperse por la forma en que viene envuelto.
//
// Vive aparte para poder probarlo sin llamar a la API: los modos de falla son conocidos y
// se pueden reproducir con cadenas fijas. "Claude devolvió JSON inválido" tapaba tres cosas
// que se arreglan distinto —la respuesta se cortó, el modelo escribió una frase antes del
// JSON, o el texto vino en un bloque de contenido que no era el primero— así que aquí se
// separan y el error que sube dice cuál fue.

// Todos los bloques de texto de la respuesta, no solo el primero: puede venir precedido
// de un bloque de otro tipo, y quedarse con content[0] devuelve vacío.
function textoDe(msg) {
  return ((msg && msg.content) || [])
    .filter(b => b && b.type === 'text' && typeof b.text === 'string')
    .map(b => b.text).join('').trim();
}

// El objeto JSON que empieza en `desde`, balanceando llaves y respetando las que van
// dentro de una cadena. Devuelve null si se abre y nunca cierra — o sea, viene cortado.
function objetoDesde(t, desde) {
  const ini = t.indexOf('{', desde);
  if (ini === -1) return null;
  let prof = 0, enTexto = false, escapa = false;
  for (let i = ini; i < t.length; i++) {
    const c = t[i];
    if (escapa) { escapa = false; continue; }
    if (c === '\\') { escapa = true; continue; }
    if (c === '"') { enTexto = !enTexto; continue; }
    if (enTexto) continue;
    if (c === '{') prof++;
    else if (c === '}' && --prof === 0) return { texto: t.slice(ini, i + 1), ini };
  }
  return null;
}

// Intenta leer un objeto del texto crudo. Devuelve el objeto o null.
function leerJson(bruto) {
  let t = String(bruto == null ? '' : bruto).trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (cerca) t = cerca[1].trim();

  // Se prueba desde cada llave de apertura, no solo la primera: con prefill el modelo a
  // veces repite el "{" del ejemplo, y `{{"a":1}}` está balanceado pero no es JSON.
  let desde = 0;
  for (let intento = 0; intento < 4; intento++) {
    const cand = objetoDesde(t, desde);
    if (!cand) return null;
    try { return JSON.parse(cand.texto); } catch (e) {}
    // Segunda pasada: comas colgando antes de un cierre, el desliz más común del modelo.
    try { return JSON.parse(cand.texto.replace(/,\s*([}\]])/g, '$1')); } catch (e) {}
    desde = cand.ini + 1;
  }
  return null;
}

// ¿Se quedó a medias? Un objeto que abre y nunca cierra es una respuesta truncada,
// y eso se le dice al usuario tal cual, porque es accionable.
function pareceTruncado(bruto) {
  const t = String(bruto == null ? '' : bruto);
  return t.indexOf('{') !== -1 && objetoDesde(t, 0) === null;
}

module.exports = { textoDe, leerJson, objetoDesde, pareceTruncado };

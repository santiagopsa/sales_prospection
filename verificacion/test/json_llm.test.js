// Leer el JSON del modelo: cada caso de aquí es una forma en que llegó roto de verdad,
// o una que llegaría si se le quita alguna de las defensas.
const assert = require('assert');
const { textoDe, leerJson, pareceTruncado, escaparControles } = require('../json_llm');

let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };

console.log('lectura del JSON del modelo');

t('lee un objeto limpio', () => {
  assert.deepStrictEqual(leerJson('{"a":1,"b":"dos"}'), { a: 1, b: 'dos' });
});

t('lee el JSON aunque el modelo escriba una frase antes', () => {
  const r = leerJson('Claro, aquí tienes el análisis:\n{"empresa":{"nombre":"IDOM"}}');
  assert.strictEqual(r.empresa.nombre, 'IDOM');
});

t('lee el JSON dentro de un bloque de código', () => {
  assert.deepStrictEqual(leerJson('```json\n{"a":[1,2]}\n```'), { a: [1, 2] });
});

t('lee el JSON con texto antes y después', () => {
  const r = leerJson('Analicé el JD.\n{"titulo":"Consultor SAP"}\nEspero que sirva.');
  assert.strictEqual(r.titulo, 'Consultor SAP');
});

t('sobrevive a la llave duplicada del prefill', () => {
  // Con prefill mandamos "{" y el modelo a veces repite el "{" del ejemplo del prompt.
  // El resultado está balanceado pero no es JSON: hay que reintentar desde la segunda.
  assert.deepStrictEqual(leerJson('{{"a":1}}'), { a: 1 });
});

t('perdona una coma colgando antes del cierre', () => {
  assert.deepStrictEqual(leerJson('{"a":1,"b":2,}'), { a: 1, b: 2 });
  assert.deepStrictEqual(leerJson('{"l":[1,2,],}'), { l: [1, 2] });
});

t('no se confunde con llaves dentro de una cadena', () => {
  const r = leerJson('{"nota":"usa {llaves} y \\"comillas\\" en el texto","n":2}');
  assert.strictEqual(r.nota, 'usa {llaves} y "comillas" en el texto');
  assert.strictEqual(r.n, 2);
});

t('no se confunde con una llave escapada al final de una cadena', () => {
  const r = leerJson('{"a":"termina en barra \\\\","b":1}');
  assert.strictEqual(r.b, 1);
});

t('lee un JSON con saltos de línea crudos dentro de una cadena', () => {
  // Lo que pasa con un job description lleno de viñetas: el modelo copia la lista dentro
  // de un valor con saltos de línea de verdad. Se ve impecable y es JSON inválido.
  const bruto = '{"contexto":"El cargo exige:\n- Rollout de PP\n- Integración con MM\n","n":2}';
  const r = leerJson(bruto);
  assert.ok(r, 'debería recuperarse de los saltos crudos');
  assert.strictEqual(r.n, 2);
  assert.ok(r.contexto.includes('Rollout de PP'));
  assert.ok(r.contexto.includes('\n'), 'el salto se conserva como salto, no se pierde');
});

t('lee un JSON con tabulaciones crudas dentro de una cadena', () => {
  const r = leerJson('{"a":"uno\tdos","b":1}');
  assert.strictEqual(r.a, 'uno\tdos');
  assert.strictEqual(r.b, 1);
});

t('la reparación no toca los saltos que están FUERA de las cadenas', () => {
  const r = leerJson('{\n  "a": 1,\n  "b": 2\n}');
  assert.deepStrictEqual(r, { a: 1, b: 2 });
});

t('no daña un texto que ya venía bien escapado', () => {
  const original = '{"a":"linea1\\nlinea2","b":"comilla \\" adentro"}';
  const r = leerJson(original);
  assert.strictEqual(r.a, 'linea1\nlinea2');
  assert.strictEqual(r.b, 'comilla " adentro');
  assert.strictEqual(escaparControles(original), original, 'no debe reescribir lo que ya estaba bien');
});

t('combina reparaciones: saltos crudos y coma colgando a la vez', () => {
  const r = leerJson('{"a":"uno\ndos","b":2,}');
  assert.deepStrictEqual(r, { a: 'uno\ndos', b: 2 });
});

t('devuelve null si no hay ningún objeto', () => {
  assert.strictEqual(leerJson('No pude analizar este texto.'), null);
  assert.strictEqual(leerJson(''), null);
  assert.strictEqual(leerJson(null), null);
});

t('detecta una respuesta cortada a la mitad', () => {
  const cortado = '{"excluyentes":[{"requisito":"Implementación de SAP PP en produc';
  assert.strictEqual(leerJson(cortado), null, 'no debería inventar un objeto');
  assert.ok(pareceTruncado(cortado), 'se debe reconocer como truncada, no como ilegible');
});

t('un objeto completo no se marca como truncado', () => {
  assert.strictEqual(pareceTruncado('{"a":1}'), false);
  assert.strictEqual(pareceTruncado('texto sin json'), false);
});

t('junta todos los bloques de texto, no solo el primero', () => {
  const msg = { content: [
    { type: 'thinking', thinking: 'déjame ver' },
    { type: 'text', text: '{"a":' },
    { type: 'text', text: '1}' },
  ]};
  assert.strictEqual(textoDe(msg), '{"a":1}');
  assert.deepStrictEqual(leerJson(textoDe(msg)), { a: 1 });
});

t('no revienta con una respuesta sin bloques de texto', () => {
  assert.strictEqual(textoDe({ content: [{ type: 'thinking', thinking: 'x' }] }), '');
  assert.strictEqual(textoDe({}), '');
  assert.strictEqual(textoDe(null), '');
});

t('lee un levantamiento real anidado y con acentos', () => {
  const bruto = `Aquí está:
\`\`\`json
{
  "empresa": {"nombre": "Alpina S.A.", "sector": "Manufactura"},
  "vacante": {"titulo": "Consultor SAP PP", "ciudad": "Medellín"},
  "excluyentes": [
    {"requisito": "Rollout de PP en producción",
     "detalles_verificables": [{"detalle": "¿Qué documento conecta PP con MM?",
                                "respuesta_esperada": "la reserva de materiales"}],
     "senales_impostor": ["Habla en plural cuando se le pide su rol"]}
  ]
}
\`\`\``;
  const r = leerJson(bruto);
  assert.strictEqual(r.empresa.nombre, 'Alpina S.A.');
  assert.strictEqual(r.vacante.ciudad, 'Medellín');
  assert.strictEqual(r.excluyentes[0].detalles_verificables[0].respuesta_esperada, 'la reserva de materiales');
});

console.log(`\n${n} pruebas · el JSON del modelo se lee bien`);

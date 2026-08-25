// pedirJson contra un cliente falso. Cada caso es una falla que ocurrió de verdad o que
// ocurriría si se le quita alguna defensa — y ninguna gasta un token.
const assert = require('assert');
const { crearPedirJson, rechazaPrefill, mensajeHumano } = require('../llm');

let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };
const ta = async (nombre, fn) => { await fn(); n++; console.log('  ✓', nombre); };
const callado = () => {};

// Cliente falso: se le da la lista de respuestas (o errores) que debe ir devolviendo,
// y guarda las peticiones que recibió para poder revisarlas.
function clienteFalso(respuestas) {
  const vistas = [];
  return {
    vistas,
    messages: {
      create: async (peticion) => {
        vistas.push(peticion);
        const r = respuestas.shift();
        if (!r) throw new Error('el cliente falso se quedó sin respuestas');
        if (r instanceof Error) throw r;
        return r;
      },
    },
  };
}
const texto = (t, stop = 'end_turn') => ({ content: [{ type: 'text', text: t }], stop_reason: stop, usage: { output_tokens: 1 } });
const errorPrefill = () => Object.assign(new Error(
  '400 {"type":"error","error":{"type":"invalid_request_error","message":"This model does not support assistant message prefill. The conversation must end with a user message."}}'),
  { status: 400 });

(async () => {
  console.log('pedirJson');

  await ta('lee la respuesta normal, con prefill', async () => {
    const c = clienteFalso([texto('"a":1}')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt');
    assert.deepStrictEqual(out.datos, { a: 1 });
    const msgs = c.vistas[0].messages;
    assert.strictEqual(msgs.length, 2, 'debería mandar el prefill');
    assert.strictEqual(msgs[1].role, 'assistant');
  });

  await ta('si el modelo no acepta prefill, reintenta sin él y sale bien', async () => {
    // Esto pasó en producción con claude-opus-4-8: la API responde 400 y antes ese blob
    // crudo terminaba en la pantalla del reclutador.
    const c = clienteFalso([errorPrefill(), texto('{"a":1}')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt');
    assert.deepStrictEqual(out.datos, { a: 1 }, 'debió recuperarse del rechazo');
    assert.strictEqual(c.vistas.length, 2);
    assert.strictEqual(c.vistas[1].messages.length, 1, 'el reintento no debe llevar prefill');
    assert.strictEqual(c.vistas[1].messages[0].role, 'user');
  });

  await ta('no vuelve a pagar el rechazo de prefill en la llamada siguiente', async () => {
    const c = clienteFalso([errorPrefill(), texto('{"a":1}'), texto('{"b":2}')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    await pedir('uno');
    const out = await pedir('dos');
    assert.deepStrictEqual(out.datos, { b: 2 });
    assert.strictEqual(c.vistas.length, 3, 'la segunda llamada no debe reintentar el prefill');
    assert.strictEqual(c.vistas[2].messages.length, 1);
  });

  await ta('rescata el JSON aunque el modelo escriba una frase antes', async () => {
    const c = clienteFalso([errorPrefill(), texto('Claro, aquí tienes:\n{"titulo":"Consultor SAP"}')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt');
    assert.strictEqual(out.datos.titulo, 'Consultor SAP');
  });

  await ta('si se cortó por longitud, reintenta con el doble de espacio', async () => {
    const c = clienteFalso([texto('"a":[1,2', 'max_tokens'), texto('"a":[1,2]}')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt', { maxTokens: 1000 });
    assert.deepStrictEqual(out.datos, { a: [1, 2] });
    assert.strictEqual(c.vistas[0].max_tokens, 1000);
    assert.strictEqual(c.vistas[1].max_tokens, 2000, 'el reintento debe pedir más espacio');
  });

  await ta('si se corta dos veces, lo dice como problema de longitud', async () => {
    const c = clienteFalso([texto('"a":[1,2', 'max_tokens'), texto('"a":[1,2', 'max_tokens')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt', { maxTokens: 1000 });
    assert.strictEqual(out.motivo, 'truncado');
    assert.ok(/más corto/.test(out.error), 'debe decir qué hacer');
    assert.ok(!/JSON/i.test(out.error), 'no se le habla de JSON al usuario');
  });

  await ta('si llega ilegible pero completo, no gasta un segundo intento', async () => {
    const c = clienteFalso([texto('No pude analizar este texto.')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt');
    assert.strictEqual(out.motivo, 'ilegible');
    assert.strictEqual(c.vistas.length, 1, 'reintentar con más espacio no arregla esto');
  });

  await ta('un error de la API no llega crudo a la pantalla', async () => {
    const c = clienteFalso([Object.assign(new Error('{"type":"error","request_id":"req_011"}'), { status: 401 })]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt');
    assert.strictEqual(out.motivo, 'api');
    assert.ok(!/request_id|\{/.test(out.error), `se filtró el cuerpo del error: ${out.error}`);
    assert.ok(/clave/i.test(out.error), 'un 401 debe apuntar a la clave');
  });

  await ta('sin cliente configurado lo dice y no revienta', async () => {
    const pedir = crearPedirJson({ anthropic: null, model: 'm', log: callado, prefill: true });
    const out = await pedir('prompt');
    assert.strictEqual(out.motivo, 'config');
  });

  await ta('por defecto NO manda prefill: el camino normal no depende de un error ajeno', async () => {
    const c = clienteFalso([texto('{"a":1}')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado });
    const out = await pedir('prompt');
    assert.deepStrictEqual(out.datos, { a: 1 });
    assert.strictEqual(c.vistas.length, 1, 'no debe gastar una llamada rechazada');
    assert.strictEqual(c.vistas[0].messages.length, 1);
    assert.strictEqual(c.vistas[0].messages[0].role, 'user');
  });

  await ta('sin prefill rescata igual el JSON envuelto en texto', async () => {
    const c = clienteFalso([texto('Claro, aquí tienes:\n```json\n{"titulo":"Consultor SAP"}\n```')]);
    const pedir = crearPedirJson({ anthropic: c, model: 'm', log: callado });
    const out = await pedir('prompt');
    assert.strictEqual(out.datos.titulo, 'Consultor SAP', 'el rescate no necesita prefill');
  });

  t('reconoce el rechazo de prefill por su texto', () => {
    assert.ok(rechazaPrefill(errorPrefill()));
    assert.ok(rechazaPrefill({ message: 'The conversation must end with a user message.' }));
    assert.ok(!rechazaPrefill(new Error('overloaded_error')));
  });

  t('traduce los códigos de la API a algo accionable', () => {
    assert.ok(/clave/i.test(mensajeHumano({ status: 401 })));
    assert.ok(/modelo/i.test(mensajeHumano({ status: 404 })));
    assert.ok(/peticiones/i.test(mensajeHumano({ status: 429 })));
    assert.ok(/disponible/i.test(mensajeHumano({ status: 529 })));
  });

  console.log(`\n${n} pruebas · pedirJson aguanta lo que devuelve la API`);
})().catch(e => { console.error('\n✗', e.message); process.exit(1); });

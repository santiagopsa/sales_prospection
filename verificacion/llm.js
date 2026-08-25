// Pedirle un JSON a Claude sin que se rompa, y sin que el usuario vea las tripas.
//
// Vive aparte de app.js para poder probarlo con un cliente falso: los modos de falla son
// conocidos —la respuesta se corta, llega envuelta en texto, o la propia API rechaza la
// petición— y no hace falta gastar tokens para cubrirlos.
const { textoDe, leerJson, pareceTruncado } = require('./json_llm');

// El prefill (empezarle la respuesta al modelo con un "{") viene APAGADO por defecto.
//
// Es la forma más barata de que no escriba "Claro, aquí tienes:" antes del JSON, pero no
// todos los modelos lo aceptan: claude-opus-4-8 responde 400 y exige que la conversación
// termine en un turno del usuario. Se puede detectar ese rechazo y reintentar —y se hace—,
// pero apoyar el camino normal en reconocer el texto de un error ajeno es frágil: basta
// que cambien la redacción. El rescate por balanceo de llaves ya resuelve el preámbulo sin
// necesidad de prefill, así que el prefill queda como optimización opcional: VERIF_PREFILL=1.
const rechazaPrefill = e => {
  const t = [e && e.message, e && e.error && JSON.stringify(e.error)].filter(Boolean).join(' ').toLowerCase();
  return t.includes('prefill') || t.includes('must end with a user message');
};

// Lo que ve el usuario nunca es el cuerpo crudo de un error de la API. Ese blob no le dice
// qué hacer y además puede arrastrar detalles de la petición.
function mensajeHumano(e) {
  const s = Number(e && (e.status || e.statusCode));
  if (s === 401 || s === 403) return 'La clave de la API de Claude no es válida o no tiene permiso. Hay que revisarla en las variables de Render.';
  if (s === 404) return 'El modelo configurado no existe o no está disponible para esta cuenta.';
  if (s === 429) return 'Claude está recibiendo demasiadas peticiones ahora mismo. Espera un momento y vuelve a intentarlo.';
  if (s === 529 || (s >= 500 && s < 600)) return 'Claude no está disponible en este momento. Vuelve a intentarlo en un minuto.';
  if (s === 400) return 'La petición a Claude fue rechazada. Revisa el registro del servidor: el detalle quedó ahí.';
  return 'No se pudo hablar con Claude. Vuelve a intentarlo; si se repite, revisa el registro del servidor.';
}

const PREFILL_POR_DEFECTO = process.env.VERIF_PREFILL === '1';

function crearPedirJson({ anthropic, model, log = console.error, prefill = PREFILL_POR_DEFECTO }) {
  // Se recuerda entre llamadas: si el modelo no acepta prefill, no se paga el 400 dos veces.
  let permitePrefill = !!prefill;

  return async function pedirJson(prompt, { etiqueta = 'llm', maxTokens = 8000 } = {}) {
    if (!anthropic) return { error: 'ANTHROPIC_API_KEY no configurada', motivo: 'config' };

    let ultimoBruto = '', cortado = false;

    for (const tope of [maxTokens, maxTokens * 2]) {
      let msg, abrio = '';
      // Un intento con prefill y, si el modelo lo rechaza, otro sin él en la misma vuelta.
      for (let pase = 0; pase < 2; pase++) {
        const usaPrefill = permitePrefill && pase === 0;
        const messages = [{ role: 'user', content: prompt }];
        if (usaPrefill) messages.push({ role: 'assistant', content: '{' });
        try {
          msg = await anthropic.messages.create({ model, max_tokens: tope, messages });
          abrio = usaPrefill ? '{' : '';
          break;
        } catch (e) {
          if (usaPrefill && rechazaPrefill(e)) {
            permitePrefill = false;
            log(`[verificacion/${etiqueta}] el modelo no acepta prefill; se sigue sin él`);
            continue;                       // segundo pase, sin prefill
          }
          log(`[verificacion/${etiqueta}] la API falló:`, (e && e.message) || e);
          return { error: mensajeHumano(e), motivo: 'api' };
        }
      }
      if (!msg) return { error: mensajeHumano({}), motivo: 'api' };

      ultimoBruto = abrio + textoDe(msg);
      const datos = leerJson(ultimoBruto);
      if (datos) return { datos, usage: msg.usage };

      // stop_reason es la señal buena; la heurística solo cuando NO hubo prefill, porque
      // el "{" que inyectamos hace que cualquier respuesta sin JSON parezca cortada
      // —abre y nunca cierra— y mandaría a reintentar en balde.
      cortado = msg.stop_reason === 'max_tokens' || (abrio === '' && pareceTruncado(ultimoBruto));
      log(`[verificacion/${etiqueta}] no se pudo leer el JSON`,
        `· stop_reason=${msg.stop_reason} · tope=${tope} · prefill=${permitePrefill}\n`,
        ultimoBruto.slice(0, 600));
      if (!cortado) break;                  // no fue longitud: reintentar con más espacio no ayuda
    }

    return {
      error: cortado
        ? 'La respuesta de Claude se cortó por longitud. Prueba con un texto más corto, o quitando las partes que no describen el cargo.'
        : 'Claude no devolvió un JSON que se pueda leer. Vuelve a intentarlo; si se repite, revisa que el texto sea el levantamiento o el job description y no otra cosa.',
      motivo: cortado ? 'truncado' : 'ilegible',
      raw: ultimoBruto.slice(0, 2000),
    };
  };
}

module.exports = { crearPedirJson, rechazaPrefill, mensajeHumano };

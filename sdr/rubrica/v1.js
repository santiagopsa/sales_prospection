// Rúbrica v1 · 10 criterios para llamadas en frío, destilados de Cold Calling Sucks (Nardone &
// Cabrera), Fanatical Prospecting (Blount) y The Sales Development Playbook (Bertuzzi).
//
// Es una VERSIÓN: se siembra en sdr.rubricas una sola vez y no se edita. Para cambiar criterios,
// copia este archivo como v2.js, súbele la versión y cambia RUBRICA_ACTIVA en config.js. Así cada
// evaluación queda atada a la rúbrica con la que se hizo y las comparaciones entre semanas son justas.
//
// Cada criterio trae: qué se espera, cómo se ve cuando se cumple y cuando no (para que el evaluador
// cite texto, no opine), y `usa_metricas` si se apoya en los números de la transcripción.

module.exports = {
  version: 'v1',
  fuentes: 'Cold Calling Sucks (Nardone & Cabrera, 2024), Fanatical Prospecting (Blount, 2015), The Sales Development Playbook (Bertuzzi, 2016)',
  // Palancas: los criterios que más mueven el resultado pesan más al elegir el foco (ver PESOS_CRITERIOS).
  criterios: [
    {
      id: 'apertura_permiso',
      nombre: 'Apertura clara y con permiso',
      descripcion: 'En los primeros 15 segundos dice quién es, de dónde y para qué llama, y pide permiso para continuar en vez de arrancar el pitch. (Cold Calling Sucks: el "permission-based opener" duplica la tasa de conversación frente al "¿te cogí en buen momento?" y al pitch directo.)',
      cumple: 'Angie: "Hola Ana, soy Angie de Peaku. Te llamo porque ayudamos a equipos de tecnología a cubrir vacantes. ¿Tienes 30 segundos para contarte por qué y me dices si tiene sentido?"',
      no_cumple: 'Angie: "Hola, ¿cómo estás? Te llamo de Peaku, nosotros somos una empresa de headhunting que…" (sin permiso, pitch inmediato) o "¿Te cogí en buen momento?"',
      fase: 'apertura',
    },
    {
      id: 'pregunta_antes_pitch',
      nombre: 'Pregunta antes de presentar',
      descripcion: 'Hace al menos una pregunta de diagnóstico sobre la situación del prospecto (vacantes abiertas, cómo contratan hoy, qué les cuesta) antes de describir Peaku. (Fanatical Prospecting: primero interés, luego pitch; Cold Calling Sucks: "problem-first".)',
      cumple: 'Angie: "¿Cómo están manejando hoy las vacantes de tecnología, con equipo interno o con proveedor?" antes de cualquier "nosotros ofrecemos".',
      no_cumple: 'Angie describe servicios, base de datos o clientes de Peaku sin haber preguntado nada sobre la empresa del prospecto.',
      fase: 'diagnostico',
      usa_metricas: 'preguntas_antes_del_pitch, pitch_en_s',
    },
    {
      id: 'problema_relevante',
      nombre: 'Habla del problema del prospecto, no de Peaku',
      descripcion: 'El mensaje central es un problema concreto del rol del prospecto (vacantes tech abiertas, tiempo de contratación, costo de la silla vacía, rotación) y no una lista de características de Peaku. (Cold Calling Sucks: "problem proposition", no "value proposition".)',
      cumple: 'Angie: "Lo que veo en empresas como la tuya es que una vacante de backend se demora 2 o 3 meses y mientras tanto el equipo se atrasa."',
      no_cumple: 'Angie: "Tenemos una base de 500 mil perfiles, inteligencia artificial, pruebas técnicas y trabajamos con Toyota y Sony."',
      fase: 'diagnostico',
    },
    {
      id: 'escucha_reflejo',
      nombre: 'Refleja lo que dijo el prospecto',
      descripcion: 'Cuando el prospecto da información, Angie la retoma con sus palabras antes de seguir ("entonces tienen dos de backend abiertas hace un mes…"). Señal de escucha activa; evita el "cuestionario".',
      cumple: 'Prospecto: "Tenemos dos de backend." Angie: "Dos de backend, ¿hace cuánto están abiertas?"',
      no_cumple: 'Prospecto da información relevante y Angie sigue con la siguiente pregunta del guion o con el pitch sin acusar recibo.',
      fase: 'diagnostico',
    },
    {
      id: 'manejo_objecion',
      nombre: 'Objeción: reconoce y pregunta, no discute',
      descripcion: 'Ante "no tenemos vacantes", "ya tenemos proveedor", "mándame la info" o "no tengo tiempo", reconoce sin pelear y responde con una pregunta que abre ("entiendo; ¿y cuando se les abre una, cuánto se demoran en cubrirla?"). No aplica si no hubo objeción.',
      cumple: 'Prospecto: "Ya tenemos proveedor." Angie: "Perfecto, tiene sentido. ¿Qué tan rápido les está entregando ternas para perfiles senior?"',
      no_cumple: 'Angie contraargumenta ("pero nosotros somos mejores porque…"), se rinde de inmediato ("ah bueno, gracias") o promete enviar info sin preguntar nada.',
      fase: 'objecion',
    },
    {
      id: 'no_monologo',
      nombre: 'Sin monólogos; el prospecto habla',
      descripcion: 'Ningún tramo continuo de Angie supera el umbral MONOLOGO_LARGO_S y el prospecto tiene espacio real para hablar. (Cold Calling Sucks: las llamadas que convierten tienen más turnos y monólogos más cortos.) Se apoya en las métricas: monologo_mas_largo_s, proporcion_angie.',
      cumple: 'Turnos cortos alternados; ninguna intervención de Angie pasa del umbral.',
      no_cumple: 'Un tramo de Angie de más del umbral (cita el inicio del tramo), o el prospecto habla menos de un tercio del tiempo con conversación real.',
      fase: 'toda',
      usa_metricas: 'monologo_mas_largo_s, monologos_largos, proporcion_angie',
    },
    {
      id: 'tono_ritmo',
      nombre: 'Ritmo y claridad',
      descripcion: 'No acelera ni se atropella; sin muletillas repetidas ("eh", "este", "o sea"). Solo se señala con evidencia: una frase con muletillas encadenadas o velocidad por encima de RITMO_RAPIDO_PPM.',
      cumple: 'Frases completas, pausas donde el prospecto puede entrar.',
      no_cumple: 'Angie: "Eh, este, o sea, lo que nosotros, eh, hacemos es…" o velocidad muy por encima del umbral.',
      fase: 'toda',
      usa_metricas: 'ppm_angie, va_rapido, muletillas_por_min, muletillas_detalle',
    },
    {
      id: 'cierre_concreto',
      nombre: 'Cierre con siguiente paso concreto',
      descripcion: 'Cuando hay interés, propone un siguiente paso específico con fecha y hora (reunión, llamada de seguimiento) y lo confirma, en vez de "te escribo después" o "cualquier cosa me avisas". (Sales Development Playbook: el SDR vende la reunión, no el producto.)',
      cumple: 'Angie: "¿Te parece si Luisa te muestra dos casos el jueves a las 10 o prefieres el viernes a las 3?"',
      no_cumple: 'Angie: "Te mando la información al correo y cualquier cosa me escribes" o termina sin proponer nada aunque hubo interés.',
      fase: 'cierre',
    },
    {
      id: 'calificacion_basica',
      nombre: 'Califica antes de agendar',
      descripcion: 'Antes de proponer la reunión confirma dos cosas: que la persona decide o influye en contratación de tecnología, y que hay una necesidad actual o próxima (vacante, proyecto, crecimiento). Evita reuniones con quien no decide ni necesita. No aplica si no se llegó a proponer reunión.',
      cumple: 'Angie: "¿Las decisiones de contratar tech pasan por ti?" y "¿Tienen algo abierto ahora o viene algo en el trimestre?"',
      no_cumple: 'Propone reunión sin saber quién decide o sin ninguna señal de necesidad.',
      fase: 'cierre',
    },
    {
      id: 'resumen_confirmacion',
      nombre: 'Resume y confirma datos al despedirse',
      descripcion: 'Al cerrar, resume lo acordado (qué, cuándo, con quién) y confirma correo o WhatsApp para enviar la invitación. No aplica si la llamada no llegó a un acuerdo.',
      cumple: 'Angie: "Entonces jueves 10 a.m. con Luisa; te mando la invitación a ana@acme.co, ¿correcto?"',
      no_cumple: 'Se despide sin repetir fecha ni confirmar por dónde llegará la invitación.',
      fase: 'cierre',
    },
  ],
  // Reglas del evaluador (van tal cual al modelo).
  reglas: [
    'Evalúa SOLO con lo que está en la transcripción. No inventes, no supongas intención.',
    'Marca "no_cumple" únicamente si puedes citar literalmente el fragmento que lo demuestra (campo "cita"). Sin cita textual, no se señala.',
    '"Nada que señalar" es una respuesta válida: si un criterio se cumple, di "cumple" con una nota de una frase y, si quieres, una cita.',
    'Usa "no_aplica" cuando la llamada no llegó a esa fase (por ejemplo, un gatekeeper que no pasó la llamada: no se evalúa el cierre).',
    'Cada nota es UNA frase concreta sobre ESTA llamada. Prohibido el consejo genérico ("debería escuchar más", "hacer mejores preguntas").',
    'La "confianza" (0 a 1) es qué tan seguro estás del veredicto dado el texto; baja si la transcripción es ambigua o está cortada.',
    'Para los criterios que usan métricas, apóyate en los números que se te dan; no los recalcules.',
    'Responde ÚNICAMENTE con el JSON pedido, sin texto antes ni después, sin bloques de código.',
  ],
};

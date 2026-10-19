// Rúbrica v2 · 11 criterios para llamadas EN FRÍO, con la realidad de la llamada en frío metida en
// cada criterio: el prospecto no esperaba la llamada, no sabe quién es Angie y suele estar a la
// defensiva o con prisa. Antes de preguntar hay que ganar confianza; una pregunta ligera después de
// dar contexto vale más que tres seguidas; y hay llamadas en las que el interrogatorio no cabe y lo
// correcto es asegurar la reunión y dejar la calificación para Luisa.
//
// Qué cambia frente a v1:
//   · `contexto`: un párrafo que va al modelo antes de las reglas, con cómo es una llamada en frío de
//     Peaku y cuándo hay espacio para preguntar y cuándo no.
//   · `pregunta_antes_pitch` y `calificacion_basica` dejan de exigir el "cuestionario al inicio".
//   · `manejo_objecion` deja de cubrir "mándame la información": eso ahora es `pide_informacion`,
//     con su propio guion (aceptar, devolver la pregunta, nombrar la objeción, pactar fecha).
//   · Para cada criterio no cumplido el modelo escribe una `alternativa`: qué pudo decir Angie en
//     ESE momento, para ese prospecto, con lo que ya había dicho. Nada de "debió preguntar más".
//
// Es una VERSIÓN: se siembra en sdr.rubricas una sola vez y no se edita. Para cambiar criterios,
// copia este archivo como v3.js, súbele la versión y cambia RUBRICA_ACTIVA en config.js. Las
// evaluaciones hechas con v1 se conservan (cada una guarda su versión).

module.exports = {
  version: 'v2',
  fuentes: 'Cold Calling Sucks (Nardone & Cabrera, 2024), Fanatical Prospecting (Blount, 2015), The Sales Development Playbook (Bertuzzi, 2016), Sandler (up-front contract, permiso para decir no); ajustada con las llamadas reales de Peaku (oct 2026)',

  // Va al modelo antes de las reglas. Es la lente con la que se juzga cada criterio.
  contexto: `Es una llamada EN FRÍO de Peaku (headhunting tech, EOR y SaaS de reclutamiento en Colombia). Angie llama a alguien que no la esperaba, que no sabe quién es ni por qué lo llaman y que, casi siempre, está a la defensiva o en medio de otra cosa. Lo que decide los primeros 20 o 30 segundos no es la calidad de las preguntas sino si el prospecto le da permiso de seguir.

Por eso la literatura de ventas no se aplica al pie de la letra. "Pregunta antes de presentar" no significa abrir con un cuestionario: significa dar primero una frase de contexto (quién soy, por qué llamo, qué vemos en empresas como la suya) y DESPUÉS una sola pregunta ligera que el prospecto pueda contestar sin sentirse interrogado. Tres preguntas seguidas a alguien que no sabe por qué lo llaman es un error, no una virtud.

Hay llamadas donde el interrogatorio cabe y llamadas donde no. Cabe cuando el prospecto responde con frases completas, cuenta algo de su situación, pregunta de vuelta o dice que tiene tiempo. No cabe cuando contesta con monosílabos, dice que tiene prisa, pide que le manden algo o deja claro que quiere colgar: ahí lo correcto es ganar un siguiente paso concreto (reunión con fecha o llamada pactada) y dejar la calificación para la reunión con Luisa. Juzga si Angie leyó bien cuál de las dos llamadas tenía, no si siguió un guion.

Mira la llamada completa antes de juzgar un momento: si al inicio no preguntó pero el prospecto se abrió al minuto dos y ahí sí preguntó y escuchó, eso cumple. Y cada vez que señales algo, di qué frase concreta cabía en ese momento, con lo que ese prospecto ya había dicho, para alguien en frío y a la defensiva.`,

  // Palancas: los criterios que más mueven el resultado pesan más al elegir el foco (ver PESOS_CRITERIOS).
  criterios: [
    {
      id: 'apertura_permiso',
      nombre: 'Apertura clara y con permiso',
      descripcion: 'En los primeros 15 segundos dice quién es, de dónde y para qué llama, y pide permiso para seguir en vez de arrancar el pitch. En frío, el permiso es lo que baja la guardia: el prospecto siente que puede decir que no. (Cold Calling Sucks: el "permission-based opener" duplica la tasa de conversación frente al "¿te cogí en buen momento?" y al pitch directo.)',
      cumple: 'Angie: "Hola Ana, soy Angie de Peaku. Te llamo porque ayudamos a equipos de tecnología a cubrir vacantes. ¿Tienes 30 segundos para contarte por qué y me dices si tiene sentido?"',
      no_cumple: 'Angie: "Hola, ¿cómo estás? Te llamo de Peaku, nosotros somos una empresa de headhunting que…" (sin permiso, pitch inmediato) o "¿Te cogí en buen momento?"',
      fase: 'apertura',
    },
    {
      id: 'pregunta_antes_pitch',
      nombre: 'Contexto primero, una pregunta ligera después',
      descripcion: 'Antes de describir qué hace Peaku (servicios, base de datos, clientes), da una frase de contexto y hace UNA pregunta ligera sobre la situación del prospecto (si tienen vacantes de tecnología, cómo las están cubriendo). No se exige que la pregunta sea en los primeros segundos: se exige que exista antes del pitch y que llegue cuando el prospecto ya sabe por qué lo llaman. Una batería de preguntas de entrada a alguien en frío NO cumple: es interrogatorio, no diagnóstico.',
      cumple: 'Angie: "Te llamo porque trabajamos con empresas de software cubriendo vacantes de desarrollo. ¿Ustedes hoy cómo lo están resolviendo, con equipo interno o con alguien de afuera?" y espera la respuesta antes de contar nada más.',
      no_cumple: 'Angie describe servicios, base de datos o clientes de Peaku sin haber preguntado nada; o abre con tres preguntas seguidas ("¿cuántas vacantes tienen?, ¿quién decide?, ¿qué presupuesto manejan?") a alguien que todavía no sabe quién es ella.',
      fase: 'diagnostico',
      usa_metricas: 'preguntas_antes_del_pitch, pitch_en_s',
    },
    {
      id: 'problema_relevante',
      nombre: 'Habla del problema del prospecto, no de Peaku',
      descripcion: 'El mensaje central es un problema concreto del rol del prospecto (vacantes tech abiertas, tiempo de contratación, costo de la silla vacía, rotación) y no una lista de características de Peaku. En frío, el problema es lo único que le da al prospecto una razón para seguir escuchando. (Cold Calling Sucks: "problem proposition", no "value proposition".)',
      cumple: 'Angie: "Lo que veo en empresas como la tuya es que una vacante de backend se demora 2 o 3 meses y mientras tanto el equipo se atrasa."',
      no_cumple: 'Angie: "Tenemos una base de 500 mil perfiles, inteligencia artificial, pruebas técnicas y trabajamos con Toyota y Sony."',
      fase: 'diagnostico',
    },
    {
      id: 'escucha_reflejo',
      nombre: 'Refleja lo que dijo el prospecto',
      descripcion: 'Cuando el prospecto da información, Angie la retoma con sus palabras antes de seguir ("entonces tienen dos de backend abiertas hace un mes…"). Es la forma más barata de ganar confianza en frío: el prospecto siente que lo oyeron, no que le están leyendo un guion. No aplica si el prospecto no dio información (monosílabos, colgó).',
      cumple: 'Prospecto: "Tenemos dos de backend." Angie: "Dos de backend, ¿hace cuánto están abiertas?"',
      no_cumple: 'Prospecto da información relevante y Angie sigue con la siguiente pregunta del guion o con el pitch sin acusar recibo.',
      fase: 'diagnostico',
    },
    {
      id: 'manejo_objecion',
      nombre: 'Objeción: reconoce, da permiso de decir no y pregunta',
      descripcion: 'Ante "no tenemos vacantes", "ya tenemos proveedor", "no tengo tiempo" o "no me interesa", reconoce sin pelear, deja claro que puede decir que no, y responde con UNA pregunta que abre ("entiendo; ¿y cuando se les abre una, cuánto se demoran en cubrirla?"). En frío la objeción casi siempre es un reflejo de defensa, no una decisión: se baja con calma, no con argumentos. No aplica si no hubo objeción. "Mándame la información" NO se evalúa aquí sino en pide_informacion.',
      cumple: 'Prospecto: "Ya tenemos proveedor." Angie: "Perfecto, tiene sentido, y si están bien con ellos no hay problema. Solo por curiosidad, ¿qué tan rápido les está entregando ternas para perfiles senior?"',
      no_cumple: 'Angie contraargumenta ("pero nosotros somos mejores porque…"), se rinde de inmediato ("ah bueno, gracias") o insiste en el pitch como si no hubiera oído la objeción.',
      fase: 'objecion',
    },
    {
      id: 'pide_informacion',
      nombre: '"Mándame la información": lo trata como objeción, no como interés',
      descripcion: 'Cuando el prospecto dice "mándame la información al correo" (o "envíame una presentación", "escríbeme y lo reviso"), casi siempre es la forma educada de terminar la llamada. Se espera que Angie (1) acepte sin pelear, (2) devuelva una pregunta corta que diga qué le serviría ver o nombre la objeción con permiso de decir no ("te la mando con gusto; dime una cosa, ¿es que de verdad te sirve verla o es que no es el momento? Si no es el momento, me lo dices y listo"), y (3) salga con algo concreto: una reunión con dos horarios, o la fecha y hora en que la vuelve a llamar para saber si va o no va. Solo cumple si hubo (1), (2) y (3). No aplica si el prospecto no pidió información.',
      cumple: 'Prospecto: "Mándame la info al correo." Angie: "Claro, te la mando. Para no mandarte algo genérico, ¿qué te serviría ver: casos de vacantes como las tuyas o los precios? … Perfecto. Te la envío hoy y te llamo el jueves a las 10 para saber si va o no va, ¿te sirve o prefieres el viernes?"',
      no_cumple: 'Prospecto: "Mándame la info." Angie: "Listo, te la mando al correo y cualquier cosa me escribes. Gracias." (acepta, no pregunta nada y cuelga sin fecha).',
      fase: 'objecion',
    },
    {
      id: 'no_monologo',
      nombre: 'Sin monólogos; el prospecto habla',
      descripcion: 'Ningún tramo continuo de Angie supera el umbral MONOLOGO_LARGO_S y el prospecto tiene espacio real para hablar. En frío, un monólogo es la señal más clara de que el prospecto ya se desconectó. (Cold Calling Sucks: las llamadas que convierten tienen más turnos y monólogos más cortos.) Se apoya en las métricas: monologo_mas_largo_s, proporcion_angie.',
      cumple: 'Turnos cortos alternados; ninguna intervención de Angie pasa del umbral.',
      no_cumple: 'Un tramo de Angie de más del umbral (cita el inicio del tramo), o el prospecto habla menos de un tercio del tiempo con conversación real.',
      fase: 'toda',
      usa_metricas: 'monologo_mas_largo_s, monologos_largos, proporcion_angie',
    },
    {
      id: 'tono_ritmo',
      nombre: 'Ritmo y claridad',
      descripcion: 'No acelera ni se atropella; sin muletillas repetidas ("eh", "este", "o sea"). En frío, ir rápido suena a vendedor y sube la guardia. Solo se señala con evidencia: una frase con muletillas encadenadas o velocidad por encima de RITMO_RAPIDO_PPM.',
      cumple: 'Frases completas, pausas donde el prospecto puede entrar.',
      no_cumple: 'Angie: "Eh, este, o sea, lo que nosotros, eh, hacemos es…" o velocidad muy por encima del umbral.',
      fase: 'toda',
      usa_metricas: 'ppm_angie, va_rapido, muletillas_por_min, muletillas_detalle',
    },
    {
      id: 'cierre_concreto',
      nombre: 'Cierre con siguiente paso concreto',
      descripcion: 'Cuando hay interés (o al menos no hay un no), propone un siguiente paso específico con fecha y hora (reunión con dos opciones de horario, o llamada de seguimiento pactada) y lo confirma, en vez de "te escribo después" o "cualquier cosa me avisas". En frío, el siguiente paso con fecha es el único resultado que vale la llamada. (Sales Development Playbook: el SDR vende la reunión, no el producto.) No aplica si el prospecto dijo que no y lo sostuvo.',
      cumple: 'Angie: "¿Te parece si Luisa te muestra dos casos el jueves a las 10 o prefieres el viernes a las 3?"',
      no_cumple: 'Angie: "Te mando la información al correo y cualquier cosa me escribes" o termina sin proponer nada aunque hubo interés.',
      fase: 'cierre',
    },
    {
      id: 'calificacion_basica',
      nombre: 'Califica lo justo, si la llamada dio espacio',
      descripcion: 'Antes de proponer la reunión, cuando el prospecto se abrió (contesta con frases completas, cuenta su situación), confirma de forma ligera dos cosas: que la persona decide o influye en contratación de tecnología, y que hay una necesidad actual o próxima (vacante, proyecto, crecimiento). Son dos preguntas cortas metidas en la conversación, no un cuestionario. Si el prospecto NO dio espacio (prisa, monosílabos, "mándame algo") y Angie priorizó asegurar la reunión o la llamada pactada, marca no_aplica: la calificación completa la hace Luisa en la reunión. No aplica tampoco si no se llegó a proponer reunión.',
      cumple: 'Con un prospecto que ya contó que tienen vacantes, Angie: "¿Y eso de contratar tech pasa por ti o lo lleva alguien más?" y "¿Tienen algo abierto ahora o viene algo en el trimestre?"',
      no_cumple: 'El prospecto habló con calma, contó su situación y dio espacio, y aun así Angie propuso reunión sin saber si decide ni si hay alguna necesidad.',
      fase: 'cierre',
    },
    {
      id: 'resumen_confirmacion',
      nombre: 'Resume y confirma datos al despedirse',
      descripcion: 'Al cerrar, resume lo acordado (qué, cuándo, con quién) y confirma correo o WhatsApp para enviar la invitación o la información. No aplica si la llamada no llegó a ningún acuerdo.',
      cumple: 'Angie: "Entonces jueves 10 a.m. con Luisa; te mando la invitación a ana@acme.co, ¿correcto?"',
      no_cumple: 'Se despide sin repetir fecha ni confirmar por dónde llegará la invitación.',
      fase: 'cierre',
    },
  ],

  // Reglas del evaluador (van tal cual al modelo).
  reglas: [
    'Evalúa SOLO con lo que está en la transcripción. No inventes, no supongas intención.',
    'Es una llamada EN FRÍO: el prospecto no la esperaba y suele estar a la defensiva o con prisa. Juzga cada criterio con esa realidad: ganar confianza va antes que preguntar; una pregunta ligera después de dar contexto vale más que tres seguidas; y pedir al inicio lo que solo cabe cuando el prospecto se abrió es un error de la rúbrica, no de Angie.',
    'Mira la llamada completa antes de juzgar un momento: lo que no pasó al inicio puede haber pasado bien más adelante, cuando el prospecto se abrió. Eso cumple.',
    'Marca "no_cumple" únicamente si puedes citar literalmente el fragmento que lo demuestra (campo "cita"). Sin cita textual, no se señala.',
    '"Nada que señalar" es una respuesta válida: si un criterio se cumple, di "cumple" con una nota de una frase y, si quieres, una cita.',
    'Usa "no_aplica" cuando la llamada no llegó a esa fase (gatekeeper que no pasó la llamada: no se evalúa el cierre) Y TAMBIÉN cuando la llamada no dio espacio para ese criterio (el prospecto cortó, tenía prisa, respondía con monosílabos): no se castiga lo que no cabía.',
    'Para cada criterio "no_cumple", escribe en "alternativa" qué pudo decir Angie en ESE momento: una o dos frases en sus palabras, para un prospecto en frío y a la defensiva, usando lo que ese prospecto ya había dicho. Nada de consejo genérico ("debió preguntar más"): la frase concreta que cabía ahí. Nunca propongas un interrogatorio a quien dijo que tenía dos minutos.',
    'Cada nota es UNA frase concreta sobre ESTA llamada. Prohibido el consejo genérico ("debería escuchar más", "hacer mejores preguntas").',
    'La "confianza" (0 a 1) es qué tan seguro estás del veredicto dado el texto; baja si la transcripción es ambigua o está cortada.',
    'Para los criterios que usan métricas, apóyate en los números que se te dan; no los recalcules.',
    'Responde ÚNICAMENTE con el JSON pedido, sin texto antes ni después, sin bloques de código.',
  ],
};

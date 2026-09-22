// SDR Coach · Huecos de ingeniería
//
// Todos los puntos de decisión del módulo viven aquí. Cada constante dice qué mueve y cómo
// ver el efecto de cambiarla SIN tocar este archivo:
//
//   node sdr/cli.js <comando> --set RUTA=valor [--set OTRA=valor]
//
// `--set` sobreescribe la constante solo para ese comando (ej. --set PRIORIDAD.porCanal.llamada=25).
// Cuando el valor te convenza, lo pasas aquí y despliegas.
//
// Las constantes de fases siguientes (pipeline, rúbrica, semanal) se agregan en su fase.

module.exports = {
  // ---------------------------------------------------------------------------
  // Secuencia de toques por defecto
  // ---------------------------------------------------------------------------
  // Qué mueve: las tareas que se crean al cargar cada lead. `dias` son días (hábiles si
  // SALTAR_FINES_DE_SEMANA) contados desde el toque ANTERIOR, no desde la carga. Dos toques
  // con dias:0 seguidos caen el mismo día (llamar y dejar WhatsApp si no contesta).
  // Canales válidos: llamada, whatsapp, correo, linkedin.
  // Solo afecta leads NUEVOS: los ya cargados conservan las tareas con que nacieron.
  // Ver el efecto: node sdr/cli.js secuencia [--desde 2026-09-21]
  SECUENCIA_POR_DEFECTO: [
    { canal: 'llamada',  dias: 0 },
    { canal: 'whatsapp', dias: 0 },
    { canal: 'llamada',  dias: 2 },
    { canal: 'correo',   dias: 0 },
    { canal: 'linkedin', dias: 2 },
    { canal: 'llamada',  dias: 3 },
    { canal: 'whatsapp', dias: 0 },
    { canal: 'llamada',  dias: 4 },
    { canal: 'correo',   dias: 0 },
  ],

  // Qué mueve: si sábados y domingos cuentan como días de la secuencia. Con true, un toque
  // que caería en fin de semana pasa al lunes. Los festivos colombianos NO se saltan.
  // Ver el efecto: node sdr/cli.js secuencia --set SALTAR_FINES_DE_SEMANA=false
  SALTAR_FINES_DE_SEMANA: true,

  // Qué mueve: la hora (Bogotá) a la que vence cada tarea en su día. Una tarea "vence" desde
  // esa hora; antes de ella aparece como "de hoy", no como vencida.
  HORA_INICIO_JORNADA: 8,

  // ---------------------------------------------------------------------------
  // Prioridad de la cola del día
  // ---------------------------------------------------------------------------
  // Qué mueve: el orden de la cola. Puntaje = porEtapa + porCanal + min(días vencida, tope) × porDiaVencido.
  // A igual puntaje, primero la que venció antes.
  // La idea por defecto: quien ya conversó con Angie va primero (el interés se enfría rápido),
  // las llamadas antes que los toques asíncronos, y lo atrasado sube pero sin tapar todo lo demás.
  // Ver el efecto: node sdr/cli.js cola --set PRIORIDAD.porCanal.llamada=25
  PRIORIDAD: {
    porEtapa: { conversacion: 40, contactado: 20, nuevo: 10 },
    porCanal: { llamada: 10, whatsapp: 4, correo: 2, linkedin: 2 },
    porDiaVencido: 3,
    topeDiasVencido: 7,
  },

  // ---------------------------------------------------------------------------
  // Metas diarias (visibles desde el día uno)
  // ---------------------------------------------------------------------------
  // Qué mueve: la barra de avance de la cola. No cambia ningún dato guardado.
  // Marcación = toque por canal llamada registrado hoy (cualquier resultado).
  // Conversación = resultado "conversación" o "reunión agendada".
  META_MARCACIONES_DIA: 60,
  META_CONVERSACIONES_DIA: 8,

  // ---------------------------------------------------------------------------
  // Qué pasa después de cada resultado (motor de etapas)
  // ---------------------------------------------------------------------------
  // Qué mueve: a qué etapa pasa el lead al registrar un resultado. null = no cambia de etapa
  // (la secuencia sigue). Solo se avanza, nunca se retrocede: un "no contestó" después de una
  // conversación no devuelve el lead a "nuevo".
  // Ver el efecto: node sdr/cli.js resultado no_contesto --etapa nuevo
  ETAPA_POR_RESULTADO: {
    no_contesto: null,
    buzon: null,
    gatekeeper: 'contactado',
    conversacion: 'conversacion',
    reunion_agendada: 'reunion_agendada',
    descartado: 'descartado',
    // toques por otros canales
    whatsapp: 'contactado',
    correo: 'contactado',
    linkedin: 'contactado',
  },

  // Qué mueve: cuántos días (hábiles si SALTAR_FINES_DE_SEMANA) después de una conversación sin
  // reunión se hace el siguiente toque, y por qué canal. Reemplaza lo que dijera la secuencia:
  // después de hablar con alguien, el ritmo lo pone la conversación, no la lista.
  // Ver el efecto: node sdr/cli.js resultado conversacion --etapa contactado
  TRAS_CONVERSACION: { canal: 'llamada', dias: 3 },

  // Qué mueve: al agendar reunión se crea un toque de WhatsApp de recordatorio este número de
  // días antes de la reunión (si Angie anotó la fecha). 0 = el mismo día. null = sin recordatorio.
  RECORDATORIO_REUNION_DIAS_ANTES: 1,

  // Qué mueve: si la reunión no ocurrió (no-show), cuántos días después se vuelve a llamar.
  TRAS_NO_SHOW: { canal: 'llamada', dias: 1 },

  // Qué mueve: qué se hace cuando se acaba la secuencia sin conversación.
  //   'huerfano'  → el lead queda sin próximo toque y aparece en el indicador (Angie decide).
  //   'descartar' → pasa a descartado con razón "sin_respuesta" automáticamente.
  // Ver el efecto: node sdr/cli.js resultado no_contesto --paso 9
  AL_AGOTAR_SECUENCIA: 'huerfano',

  // ---------------------------------------------------------------------------
  // Llamadas (Voximplant). Estos tres se incrustan en el escenario: después de cambiarlos hay
  // que correr `node sdr/cli.js vox:setup` para subir la versión nueva.
  // ---------------------------------------------------------------------------
  // Qué mueve: lo que oye el prospecto al contestar, antes de que se una la voz de Angie.
  // Vacío = sin aviso automático: Angie lo menciona ella misma cuando ya hay conversación (la
  // franja de la llamada se lo recuerda con RECORDATORIO_GRABACION). Un robot antes del saludo
  // mata la llamada en frío; grabar una llamada en la que uno participa es legal en Colombia, y
  // lo que exige la Ley 1581 es informar el uso de los datos, que es lo que Angie dice.
  AVISO_GRABACION: '',
  // Qué mueve: el texto que ve Angie en pantalla mientras la llamada está activa, para que no
  // se le olvide decirlo. Vacío = sin recordatorio.
  RECORDATORIO_GRABACION: 'Cuando haya conversación: "te cuento que estoy grabando la llamada para mejorar mi trabajo, ¿te parece?"',
  // Qué mueve: la voz sintética del aviso, en la forma Proveedor.Nombre de VoiceList de Voximplant.
  // Si el nombre no existe, el escenario cae a la voz estándar en español.
  VOZ_AVISO: 'Google.es_US_Standard_A',
  // Qué mueve: si Angie también oye el aviso (true) o solo silencio mientras suena (false).
  AVISO_TAMBIEN_A_ANGIE: false,
  // Qué mueve: URL pública del servicio, para el webhook del escenario. `vox:setup --url` la sobreescribe.
  PUBLIC_URL_POR_DEFECTO: 'https://peaku-sandler.onrender.com',
  // Qué mueve: qué canal del audio estéreo es Angie, para el pipeline de la fase 4 (proporción
  // de habla y quién dijo qué). Si al escuchar una grabación las voces salen al revés, cámbialo.
  CANAL_ANGIE_EN_GRABACION: 'derecho',
  // Qué mueve: llamadas más cortas que esto (segundos contestados) no pasan por transcripción ni
  // evaluación aunque el resultado sea "conversación". Fase 4.
  DURACION_MINIMA_PIPELINE_S: 45,

  // ---------------------------------------------------------------------------
  // Teléfonos
  // ---------------------------------------------------------------------------
  // Qué mueve: Apollo y otras bases guardan los fijos viejos de Bogotá (+57 1 XXX XXXX) como si
  // fueran de Estados Unidos (+1 571-XXX-XXXX). Con true, un "+1 571" de 11 dígitos se lee como
  // Bogotá y se convierte al formato actual (+57 601 XXX XXXX). Ponlo en false si prospectas en
  // Virginia (EE. UU.), donde 571 es un indicativo real.
  // Ver el efecto: node sdr/cli.js importar archivo.xlsx --set TELEFONO_1_571_ES_BOGOTA=false
  TELEFONO_1_571_ES_BOGOTA: true,

  // ---------------------------------------------------------------------------
  // Usuarios (sin credenciales): la etiqueta de quién hizo cada cosa
  // ---------------------------------------------------------------------------
  // Qué mueve: el desplegable de la barra y qué actividad cuenta para las metas y la racha.
  // Solo los toques de usuarios con rol 'sdr' cuentan como marcaciones/conversaciones; así las
  // pruebas de Santiago o los registros de Luisa no inflan los números de Angie.
  USUARIOS: [
    { nombre: 'Angie',    rol: 'sdr' },
    { nombre: 'Luisa',    rol: 'ejecutiva' },
    { nombre: 'Santiago', rol: 'admin' },
  ],

  // ---------------------------------------------------------------------------
  // Ritmo del día: bloques de prospección y racha
  // ---------------------------------------------------------------------------
  // Qué mueve: la barra grande de la cola. Dentro del horario de un bloque (hora de Bogotá) se
  // muestran las marcaciones de ESE bloque contra su meta y el tiempo que queda; fuera de los
  // bloques se muestra el día completo. Lista vacía = solo el día completo.
  // Ver el efecto: node sdr/cli.js cola --set 'BLOQUES_PROSPECCION=[{"inicio":"08:00","fin":"12:00","metaMarcaciones":40}]'
  BLOQUES_PROSPECCION: [
    { nombre: 'Bloque de la mañana', inicio: '08:00', fin: '10:00', metaMarcaciones: 30 },
    { nombre: 'Bloque de la tarde',  inicio: '14:00', fin: '16:00', metaMarcaciones: 30 },
  ],

  // Qué mueve: qué cuenta como "día cumplido" para la racha: llegar a la meta de marcaciones,
  // a la de conversaciones, o a cualquiera de las dos. Solo cuentan días hábiles.
  RACHA_CUMPLE_CON: 'marcaciones',   // 'marcaciones' | 'conversaciones' | 'cualquiera'

  // ---------------------------------------------------------------------------
  // Vista semanal
  // ---------------------------------------------------------------------------
  // Qué mueve: si la vista semanal muestra las tasas (contacto, conversación→reunión, no-show,
  // realizada→calificado). Con pocas llamadas fluctúan y desmoralizan; se activa cuando haya volumen.
  // Ver el efecto: node sdr/cli.js semana --set MOSTRAR_RATIOS=true
  MOSTRAR_RATIOS: false,
  // Qué mueve: la ventana móvil (días) sobre la que se calculan las tasas.
  VENTANA_RATIOS_DIAS: 14,
};

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
  // Sacar un lead de la cola: descartar o pausar
  // ---------------------------------------------------------------------------
  // Qué mueve: cuando Angie saca un lead de la cola con una razón, cuántos MESES después se vuelve
  // a intentar por defecto. null = descartado definitivo. Angie puede cambiar la propuesta en el
  // diálogo; las razones definitivas (pidió no contacto, datos malos) nunca ofrecen reintento.
  // La idea: "no ahora" no es "nunca". Un "sin presupuesto" en septiembre es un lead tibio en enero,
  // y "ya tiene proveedor" cambia cuando ese contrato vence. Descartar de verdad se reserva para
  // quien no encaja o pidió que no lo llamen.
  // Ver el efecto: node sdr/cli.js cola --set REINTENTO_POR_RAZON.sin_presupuesto=1
  REINTENTO_POR_RAZON: {
    no_interesa: 6,
    sin_necesidad: 6,
    sin_presupuesto: 3,
    ya_tiene_proveedor: 6,
    no_es_decisor: null,
    otro: null,
  },
  // Qué mueve: las opciones de meses que muestra el diálogo (además de "No, descartar").
  OPCIONES_REINTENTO_MESES: [1, 3, 6],
  // Qué mueve: con qué toques vuelve un lead en pausa cuando llega su fecha (mismo formato que
  // SECUENCIA_POR_DEFECTO). Corta a propósito: ya lo conocen, no hace falta la cadencia completa.
  // También es la secuencia con la que vuelve un lead descartado que se reactiva.
  SECUENCIA_REINTENTO: [
    { canal: 'llamada',  dias: 0 },
    { canal: 'whatsapp', dias: 0 },
    { canal: 'llamada',  dias: 3 },
    { canal: 'correo',   dias: 0 },
  ],

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
  // Qué mueve: cuántas veces más se vuelve a marcar cuando el operador devuelve uno de los códigos
  // de LLAMADA_REINTENTAR_CODIGOS antes de rendirse y decirle a Angie qué pasó. 0 = sin reintentos.
  // 404 está en la lista a propósito: con rutas baratas, un número portado (Claro→Tigo…) a veces
  // devuelve 404 aunque exista; el segundo intento a veces entra. No se reintenta un 480/487
  // (timbró y no contestaron) ni un 486 (ocupado): eso es un resultado, no una falla.
  LLAMADA_REINTENTOS: 2,
  LLAMADA_REINTENTAR_CODIGOS: [404, 408, 500, 502, 503, 504],
  // Qué mueve: segundos de pausa entre un intento y el siguiente.
  LLAMADA_PAUSA_REINTENTO_S: 2,
  // Qué mueve: lo que Angie OYE (voz) en cada situación; el navegador además lo muestra en texto.
  MENSAJES_LLAMADA: {
    marcando: 'Marcando',
    reintentando: 'No entró. Reintentando',
    numero_invalido: 'El operador dice que el número no existe o no lo encuentra. Si desde el celular sí entra, repórtalo',
    ocupado: 'Ocupado',
    no_contesto: 'No contestaron',
    fallo_central: 'Falla de la central. No fue posible llamar',
  },
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
  // Pipeline de audio (fase 4): grabación → transcripción → métricas
  // ---------------------------------------------------------------------------
  // Solo pasan las llamadas de Voximplant con resultado "conversación" o "reunión agendada", con
  // grabación y con al menos DURACION_MINIMA_PIPELINE_S segundos contestados. Corre en segundo
  // plano en el servidor (necesita DEEPGRAM_API_KEY) o a mano: node sdr/cli.js pipeline
  // Qué mueve: modelo e idioma de Deepgram. nova-2 con "es" transcribe español colombiano bien;
  // "es-419" es la variante latinoamericana si algún día hace falta.
  DEEPGRAM_MODELO: 'nova-2',
  DEEPGRAM_IDIOMA: 'es',
  // Qué mueve: cada cuántos segundos el servidor revisa si hay llamadas pendientes de transcribir.
  PIPELINE_INTERVALO_S: 60,
  // Qué mueve: cuántas veces se reintenta una llamada que falló (red, grabación aún no lista…)
  // antes de dejarla en "error" para revisarla a mano (node sdr/cli.js pipeline --call N).
  PIPELINE_REINTENTOS: 3,
  // Qué mueve: si el servidor descarga el audio y se lo manda a Deepgram (true) o le pasa la URL
  // de Voximplant para que lo baje Deepgram (false, más barato para Render). Si la URL de la
  // grabación no es pública, el pipeline cae solo a descargarlo.
  PIPELINE_DESCARGAR_AUDIO: false,

  // Métricas de la conversación. Se calculan sobre los turnos guardados, así que cambiar estas
  // constantes NO obliga a transcribir de nuevo: node sdr/cli.js metricas --call N --set PALABRAS_PITCH='["peaku"]'
  // Qué mueve: dónde empieza el pitch. El primer turno de Angie que contiene una de estas
  // palabras marca "pitch_en_s", y las preguntas de Angie antes de ese punto son
  // "preguntas_antes_del_pitch" (Cold Calling Sucks: primero preguntar, después contar).
  PALABRAS_PITCH: ['peaku', 'nosotros', 'ofrecemos', 'headhunting', 'nuestra plataforma', 'nuestro servicio', 'lo que hacemos', 'te cuento'],
  // Qué mueve: qué cuenta como muletilla (se buscan como palabra completa, sin acentos).
  PALABRAS_MULETILLA: ['eh', 'este', 'o sea', 'digamos', 'tipo', 'como que', 'basicamente', 'entonces nada', 'listo'],
  // Qué mueve: un turno continuo de Angie más largo que esto (segundos) cuenta como monólogo.
  MONOLOGO_LARGO_S: 45,
  // Qué mueve: dos turnos de Angie separados por menos de esto (segundos) se consideran el mismo
  // monólogo (el prospecto solo dijo "ajá").
  PAUSA_MISMO_TURNO_S: 1.5,
  // Qué mueve: desde qué velocidad (palabras por minuto de habla propia) se marca "va rápido".
  RITMO_RAPIDO_PPM: 170,
  // Qué mueve: qué roles ven la transcripción y las métricas por llamada. Por diseño Angie (sdr)
  // no las ve llamada por llamada: recibe el resumen semanal (fase 5). Sin login esto es solo la
  // vista, no un control de acceso.
  VER_TRANSCRIPCION: ['admin', 'ejecutiva'],

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

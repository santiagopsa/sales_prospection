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
  // Las marcaciones y conversaciones se empiezan a contar en la fase 2 (resultado de la llamada).
  META_MARCACIONES_DIA: 60,
  META_CONVERSACIONES_DIA: 8,
};

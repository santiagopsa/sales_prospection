// Vocabulario fijo del proceso. No son huecos: vienen del alcance acordado y la base los
// hace cumplir con CHECK. Cambiar uno de estos es una migración, no un ajuste.

const ETAPAS = ['nuevo', 'contactado', 'conversacion', 'reunion_agendada', 'reunion_realizada', 'calificado', 'descartado'];

const ETAPA_LABEL = {
  nuevo: 'Nuevo',
  contactado: 'Contactado',
  conversacion: 'Conversación',
  reunion_agendada: 'Reunión agendada',
  reunion_realizada: 'Reunión realizada',
  calificado: 'Calificado',
  descartado: 'Descartado',
};

// Etapas en las que el lead depende de un toque de Angie. Si no tiene tarea pendiente,
// es un huérfano. Desde "reunión agendada" el siguiente paso es de la ejecutiva comercial.
const ETAPAS_DE_ANGIE = ['nuevo', 'contactado', 'conversacion'];

const CANALES = ['llamada', 'whatsapp', 'correo', 'linkedin'];

const CANAL_LABEL = { llamada: 'Llamada', whatsapp: 'WhatsApp', correo: 'Correo', linkedin: 'LinkedIn' };

// Resultados cerrados de una llamada. Los toques por otro canal usan el nombre del canal
// como resultado ("whatsapp" = WhatsApp enviado).
const RESULTADOS_LLAMADA = ['no_contesto', 'buzon', 'gatekeeper', 'conversacion', 'reunion_agendada', 'descartado'];

const RESULTADO_LABEL = {
  no_contesto: 'No contestó',
  buzon: 'Buzón',
  gatekeeper: 'Gatekeeper',
  conversacion: 'Conversación sin reunión',
  reunion_agendada: 'Reunión agendada',
  descartado: 'Descartado',
  whatsapp: 'WhatsApp enviado',
  correo: 'Correo enviado',
  linkedin: 'LinkedIn enviado',
  // registrados por la ejecutiva comercial
  reunion_realizada: 'Reunión realizada',
  no_show: 'No se presentó',
  calificado: 'Calificado',
};

// Solo estos resultados pasan por el pipeline de audio (fase 4).
const RESULTADOS_CON_CONVERSACION = ['conversacion', 'reunion_agendada'];

const RAZONES_DESCARTE = ['sin_necesidad', 'sin_presupuesto', 'ya_tiene_proveedor', 'no_es_decisor', 'sin_respuesta', 'otro'];

const RAZON_LABEL = {
  sin_necesidad: 'Sin necesidad',
  sin_presupuesto: 'Sin presupuesto',
  ya_tiene_proveedor: 'Ya tiene proveedor',
  no_es_decisor: 'No es el decisor',
  sin_respuesta: 'Nunca respondió',
  otro: 'Otro',
};

module.exports = {
  ETAPAS, ETAPA_LABEL, ETAPAS_DE_ANGIE, CANALES, CANAL_LABEL,
  RESULTADOS_LLAMADA, RESULTADO_LABEL, RESULTADOS_CON_CONVERSACION, RAZONES_DESCARTE, RAZON_LABEL,
};

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

module.exports = { ETAPAS, ETAPA_LABEL, ETAPAS_DE_ANGIE, CANALES, CANAL_LABEL };

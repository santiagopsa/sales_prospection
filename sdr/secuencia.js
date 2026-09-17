// De la secuencia configurada a tareas con fecha.
const { CANALES } = require('./dominio');
const tiempo = require('./tiempo');

function validarSecuencia(secuencia) {
  if (!Array.isArray(secuencia) || !secuencia.length) throw new Error('SECUENCIA_POR_DEFECTO está vacía');
  secuencia.forEach((p, i) => {
    if (!CANALES.includes(p.canal)) throw new Error(`Secuencia paso ${i + 1}: canal "${p.canal}" no existe (${CANALES.join(', ')})`);
    if (!Number.isInteger(p.dias) || p.dias < 0) throw new Error(`Secuencia paso ${i + 1}: "dias" debe ser un entero ≥ 0`);
  });
}

// Tareas para un lead que entra en `fechaInicio` (YYYY-MM-DD, Bogotá).
// Devuelve [{ paso, canal, fecha, due_at: Date }].
function planificar(config, fechaInicio) {
  const sec = config.SECUENCIA_POR_DEFECTO;
  validarSecuencia(sec);
  const saltar = !!config.SALTAR_FINES_DE_SEMANA;
  let fecha = saltar ? tiempo.aDiaHabil(fechaInicio) : fechaInicio;
  return sec.map((p, i) => {
    fecha = tiempo.avanzar(fecha, p.dias, saltar);
    return { paso: i + 1, canal: p.canal, fecha, due_at: tiempo.instante(fecha, config.HORA_INICIO_JORNADA) };
  });
}

module.exports = { planificar, validarSecuencia };

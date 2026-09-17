// Fechas en hora de Bogotá. Colombia no tiene horario de verano desde 1993, así que el
// desfase es fijo (-05:00) y no hace falta una librería de zonas horarias.
const OFFSET = '-05:00';
const OFFSET_MS = -5 * 3600 * 1000;

// 'YYYY-MM-DD' del día en Bogotá para un instante dado.
function fechaBogota(instante = new Date()) {
  return new Date(instante.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

// Instante en que empieza `hora` (entera) del día `fecha` en Bogotá.
function instante(fecha, hora = 0) {
  return new Date(`${fecha}T${String(hora).padStart(2, '0')}:00:00${OFFSET}`);
}

function diaSemana(fecha) { // 0 domingo … 6 sábado
  return new Date(`${fecha}T12:00:00Z`).getUTCDay();
}

function sumarDias(fecha, n) {
  const d = new Date(`${fecha}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const esFinDeSemana = f => { const d = diaSemana(f); return d === 0 || d === 6; };

function aDiaHabil(fecha) {
  let f = fecha;
  while (esFinDeSemana(f)) f = sumarDias(f, 1);
  return f;
}

// Avanza n días; si saltarFinDeSemana, cuenta solo días hábiles.
function avanzar(fecha, n, saltarFinDeSemana) {
  if (!saltarFinDeSemana) return sumarDias(fecha, n);
  let f = aDiaHabil(fecha);
  for (let i = 0; i < n; i++) f = aDiaHabil(sumarDias(f, 1));
  return f;
}

// Días completos entre dos instantes, medidos en fechas de Bogotá (no en horas).
function diasEntre(desde, hasta) {
  const a = new Date(`${fechaBogota(desde)}T12:00:00Z`);
  const b = new Date(`${fechaBogota(hasta)}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

module.exports = { OFFSET, fechaBogota, instante, diaSemana, sumarDias, aDiaHabil, avanzar, diasEntre, esFinDeSemana };

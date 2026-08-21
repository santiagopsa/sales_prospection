// Las reglas del piloto. Viven aparte para poder probarlas sin levantar el servidor.
const crypto = require('crypto');

const LVLTXT = { 5:'CUMPLE', 4:'CUMPLE', 3:'PARCIAL', 2:'NO CUMPLE', 1:'NO CUMPLE' };
const ID_ITEMS = ['grab', 'kyc', 'ced', 'ges', 'nom'];

const clean = s => (s == null ? '' : String(s)).trim();

// El semáforo lo decide el servidor, no el navegador.
// Rojo: identidad incompleta o 3+ señales. Amarillo: 1-2 señales. Verde: cero.
function semaforo({ identity = {}, signals = {} } = {}) {
  const idOk = ID_ITEMS.every(k => !!identity[k]);
  const n = Object.values(signals).filter(Boolean).length;
  if (!idOk || n >= 3) return { color: 'rojo', signals: n, idOk };
  if (n >= 1) return { color: 'amarillo', signals: n, idOk };
  return { color: 'verde', signals: n, idOk };
}

// "Sin carpeta completa no hay acta": la regla que sostiene todo lo demás.
// Devuelve la lista de razones por las que NO se puede emitir. Vacía = se puede.
function bloqueos({ identity = {}, signals = {}, ratings = [] } = {}) {
  const sem = semaforo({ identity, signals });
  const f = [];
  if (!sem.idOk) f.push('La verificación de identidad no está completa.');
  if (!ratings.length) f.push('No hay requisitos calificados.');
  if (ratings.some(r => !r.level)) f.push('Hay requisitos sin calificar.');
  if (ratings.some(r => clean(r.evidence).length <= 10)) f.push('Falta evidencia textual en algún requisito.');
  if (sem.color === 'rojo') f.push('El semáforo está en rojo: no se emite acta, se escala.');
  return { faltas: f, semaforo: sem };
}

function integrityHash(payload) {
  return crypto.createHash('sha256')
    .update(JSON.stringify(payload, Object.keys(payload).sort()))
    .digest('hex');
}

function reportCode(year) {
  const y = year || new Date().getFullYear();
  return `PKV-${y}-${crypto.randomInt(100000, 999999)}`;
}

module.exports = { LVLTXT, ID_ITEMS, clean, semaforo, bloqueos, integrityHash, reportCode };

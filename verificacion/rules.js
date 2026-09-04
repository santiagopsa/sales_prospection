// Las reglas del piloto. Viven aparte para poder probarlas sin levantar el servidor.
const crypto = require('crypto');

const LVLTXT = { 5:'CUMPLE', 4:'CUMPLE', 3:'PARCIAL', 2:'NO CUMPLE', 1:'NO CUMPLE' };

// Cuántos requisitos excluyentes admite una vacante. Es una regla del método, no un detalle
// de pantalla: la sesión dura 30 minutos y lo que se reparte entre los temas no es solo el
// tiempo sino la repregunta, que es donde se cae quien no hizo el trabajo. El inglés NO
// cuenta contra este tope — no se pregunta, se escucha en un tramo aparte.
const MAX_REQ = 3;

// Puntos de integridad que el evaluador marca durante la sesión.
// Ya no incluyen "muéstrame la cédula": el documento lo valida Didit, mejor de lo que puede
// hacerlo una persona mirando una pantalla. Aquí queda solo lo que ocurre en la llamada.
//
// La captura del rostro solo se pide en un cierre, porque solo ahí se va a cotejar
// contra la verificación. Pedirla en un sondeo sería guardar un dato biométrico sin uso.
const ID_ITEMS = ['grab', 'cam', 'shot'];
const itemsDe = kind => (esCierre(kind) ? ['grab', 'cam', 'shot'] : ['grab', 'cam']);

// Dos tipos de sesión, porque la identidad no se pide en la primera entrevista:
//   sondeo → primera entrevista. Cámara y señales, cero documentos. Produce ficha interna.
//   cierre → finalista. Suma la verificación de identidad. Produce el acta que va al cliente.
const KINDS = ['sondeo', 'cierre'];
const esCierre = k => k === 'cierre';

const clean = s => (s == null ? '' : String(s)).trim();

// El semáforo lo decide el servidor, no el navegador.
// Rojo: 3+ señales, o —solo en un cierre— la identidad falló de verdad.
// La distinción importa: que el candidato todavía no haya hecho la verificación NO es rojo.
// Rojo es que la hizo y el rostro no corresponde. Prudencia no es sospecha.
function semaforo({ identity = {}, signals = {}, kind = 'sondeo', faceVerdict = null, diditStatus = null } = {}) {
  const n = Object.values(signals).filter(Boolean).length;
  const sesionOk = itemsDe(kind).every(k => !!identity[k]);
  const idFalla = esCierre(kind) && (faceVerdict === 'no_coincide' || diditStatus === 'Declined');

  if (idFalla || n >= 3) return { color: 'rojo', signals: n, sesionOk, idFalla };
  if (n >= 1 || faceVerdict === 'revisar') return { color: 'amarillo', signals: n, sesionOk, idFalla };
  return { color: 'verde', signals: n, sesionOk, idFalla };
}

// Estado de la capa de identidad de un cierre. Se cuenta aparte del semáforo,
// porque "todavía no llegó" no es un juicio sobre el candidato.
function estadoIdentidad({ kind = 'sondeo', diditStatus = null, faceVerdict = null, idNote = '' } = {}) {
  if (!esCierre(kind)) return { estado: 'no_aplica', texto: 'No aplica en un sondeo' };
  if (clean(idNote) === 'rechazada') return { estado: 'rechazada', texto: 'El candidato no quiso verificar su identidad' };
  if (!diditStatus || diditStatus === 'Not Started') return { estado: 'pendiente', texto: 'Enviada, sin completar' };
  if (diditStatus === 'In Progress') return { estado: 'en_curso', texto: 'El candidato la está haciendo' };
  if (diditStatus === 'Abandoned') return { estado: 'abandonada', texto: 'La empezó y no la terminó' };
  if (diditStatus === 'Declined') return { estado: 'fallida', texto: 'Didit rechazó la verificación' };
  if (diditStatus === 'In Review') return { estado: 'en_revision', texto: 'Didit la dejó en revisión manual' };
  if (diditStatus === 'Approved') {
    if (faceVerdict === 'coincide') return { estado: 'verificada', texto: 'Documento verificado y el rostro coincide con la entrevista' };
    if (faceVerdict === 'revisar') return { estado: 'dudosa', texto: 'Documento verificado, pero el rostro necesita revisión humana' };
    if (faceVerdict === 'no_coincide') return { estado: 'fallida', texto: 'El rostro de la entrevista no corresponde al de la persona verificada' };
    return { estado: 'sin_cotejo', texto: 'Documento verificado; falta cotejar contra la entrevista' };
  }
  return { estado: 'pendiente', texto: 'Sin completar' };
}

// "Sin carpeta completa no hay acta": la regla que sostiene todo lo demás.
// Devuelve la lista de razones por las que NO se puede emitir. Vacía = se puede.
function bloqueos({ identity = {}, signals = {}, ratings = [], kind = 'sondeo',
                    faceVerdict = null, diditStatus = null, idNote = '' } = {}) {
  const sem = semaforo({ identity, signals, kind, faceVerdict, diditStatus });
  const id = estadoIdentidad({ kind, diditStatus, faceVerdict, idNote });
  const f = [];

  if (!sem.sesionOk) {
    f.push(esCierre(kind)
      ? 'Faltan los puntos de integridad de la sesión (grabación, cámara y captura del rostro).'
      : 'Faltan los puntos de integridad de la sesión (grabación y cámara).');
  }
  if (!ratings.length) f.push('No hay requisitos calificados.');
  if (ratings.some(r => !r.level)) f.push('Hay requisitos sin calificar.');
  if (ratings.some(r => clean(r.evidence).length <= 10)) f.push('Falta evidencia textual en algún requisito.');
  if (sem.color === 'rojo') {
    f.push(sem.idFalla
      ? 'El rostro verificado no corresponde al de la entrevista: no se emite, se escala.'
      : 'El semáforo está en rojo: no se emite acta, se escala.');
  }
  // En un cierre el acta certifica identidad, así que hay que esperar el resultado.
  // Si el candidato se negó, sí se emite — pero como acta sin capa de identidad.
  if (esCierre(kind) && ['pendiente', 'en_curso', 'en_revision', 'sin_cotejo'].includes(id.estado)) {
    f.push(`La verificación de identidad todavía no está lista (${id.texto.toLowerCase()}).`);
  }
  return { faltas: f, semaforo: sem, identidad: id };
}

// Qué certifica el documento que sale. No es lo mismo un sondeo que un cierre,
// ni un cierre verificado que uno donde el candidato prefirió no verificarse.
function tipoDocumento({ kind = 'sondeo', diditStatus = null, faceVerdict = null, idNote = '' } = {}) {
  const id = estadoIdentidad({ kind, diditStatus, faceVerdict, idNote });
  if (!esCierre(kind)) {
    return { tipo: 'ficha', titulo: 'Ficha de sondeo',
             alcance: 'Uso interno de PeakU. Registra lo observado sobre los requisitos excluyentes. No certifica identidad.' };
  }
  if (id.estado === 'verificada') {
    return { tipo: 'acta', titulo: 'Informe de verificación',
             alcance: 'Certifica conocimiento sobre los requisitos definidos por el cliente e identidad verificada.' };
  }
  return { tipo: 'acta_sin_id', titulo: 'Informe de verificación de conocimiento',
           alcance: 'Certifica conocimiento sobre los requisitos definidos por el cliente. No certifica identidad.' };
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

module.exports = {
  LVLTXT, MAX_REQ, ID_ITEMS, itemsDe, KINDS, esCierre, clean,
  semaforo, estadoIdentidad, bloqueos, tipoDocumento, integrityHash, reportCode,
};

// LO QUE DICE EL CLIENTE CUANDO UN CANDIDATO NO AVANZA
//
// Es la única medición externa de si la verificación acierta. Antes se perdía por dos lados:
// lo que el cliente contaba en el levantamiento ("rechazamos a dos que sabían la teoría") se
// mostraba una vez y no volvía a aparecer, y en cada informe solo se anotaba si lo entrevistó,
// no por qué no avanzó.
//
// Aquí vive lo que se puede probar sin servidor: los motivos, la LECTURA de cada rechazo
// contra el nivel que dio la verificación, la limpieza de lo que llega del navegador o de
// Claude, la lista que vuelve a la guía de la entrevista y los indicadores.
//
// La lectura es la pieza que más vale. Un rechazo no es un número más: dice algo distinto
// según lo que la verificación había dicho de ese mismo requisito.
//   desacuerdo     la verificación lo dio por cumplido (4-5) y el cliente dijo que no. El
//                  criterio está flojo: se propone endurecerlo.
//   advertido      la verificación ya lo ponía por debajo (≤3). No falló la verificación;
//                  se envió un parcial.
//   sin_medir      ese requisito no se midió en la sesión.
//   oculto         lo que el cliente pidió no estaba en la vacante: se propone agregarlo.
//   no_calidad     salario o disponibilidad: se pregunta antes, no se verifica.
//   cambio_perfil  el cliente cambió lo que busca.
//   general        sobre un requisito, sin candidato con qué comparar.
const clean = s => (s == null ? '' : String(s)).trim();
const corta = (s, n) => clean(s).slice(0, n);

const MOTIVOS_FEEDBACK = [
  { k: 'requisito',      l: 'Un requisito técnico' },
  { k: 'seniority',      l: 'Seniority o alcance' },
  { k: 'comunicacion',   l: 'Comunicación o inglés' },
  { k: 'conducta',       l: 'Conducta o encaje con el equipo' },
  { k: 'salario',        l: 'Salario o expectativas' },
  { k: 'disponibilidad', l: 'Disponibilidad o ubicación' },
  { k: 'cambio_perfil',  l: 'El cliente cambió el perfil' },
  { k: 'otro',           l: 'Otro' },
];
const CLAVES_MOTIVO = MOTIVOS_FEEDBACK.map(m => m.k);
const motivoTxt = k => (MOTIVOS_FEEDBACK.find(m => m.k === k) || { l: k || '' }).l;
const NO_CALIDAD = ['salario', 'disponibilidad'];
const FUENTES = ['mensaje', 'llamada'];

const LECTURAS = {
  desacuerdo:    { l: 'Desacuerdo',        d: 'La verificación lo dio por cumplido y el cliente dijo que no: el criterio de este requisito está flojo.' },
  advertido:     { l: 'Lo advertimos',     d: 'El informe ya lo ponía por debajo de cumple. No falló la verificación: se envió un parcial.' },
  sin_medir:     { l: 'Sin medir',         d: 'Ese requisito no quedó medido en la verificación.' },
  oculto:        { l: 'Requisito oculto',  d: 'Lo que el cliente pidió no estaba en la vacante.' },
  no_calidad:    { l: 'No es calidad',     d: 'Salario o disponibilidad: se pregunta antes de enviar, no se verifica.' },
  cambio_perfil: { l: 'Cambió el perfil',  d: 'El cliente cambió lo que busca: la vacante tiene que reflejarlo.' },
  general:       { l: 'Sobre la vacante',  d: 'Sobre un requisito, sin un candidato con qué comparar.' },
};

function lecturaFeedback({ motivo, requirement_id, nivel, con_sesion }) {
  if (NO_CALIDAD.includes(motivo)) return 'no_calidad';
  if (motivo === 'cambio_perfil') return 'cambio_perfil';
  if (!requirement_id) return 'oculto';
  if (!con_sesion) return 'general';
  const n = Number(nivel);
  if (!n) return 'sin_medir';
  return n >= 4 ? 'desacuerdo' : 'advertido';
}

// Qué tipo de ajuste a la vacante tiene sentido para cada lectura. Lo demás no propone nada:
// "lo advertimos" no es un problema de la vacante, y el salario no se verifica.
const PROPUESTA_PARA = {
  desacuerdo: ['endurecer'], general: ['endurecer'],
  oculto: ['requisito', 'rasgo'], cambio_perfil: ['requisito', 'rasgo', 'endurecer'],
};

function normalizarPropuesta(p, { lectura, requisitos = [] } = {}) {
  if (!p || typeof p !== 'object') return null;
  const tipo = clean(p.tipo);
  if (!(PROPUESTA_PARA[lectura] || []).includes(tipo)) return null;
  if (tipo === 'endurecer') {
    const rid = Number(p.requirement_id);
    if (!requisitos.some(r => Number(r.id) === rid)) return null;
    const criterio = corta(p.criterio, 700);
    const det = p.detalle && typeof p.detalle === 'object' && clean(p.detalle.detalle)
      ? { detalle: corta(p.detalle.detalle, 300), respuesta_esperada: corta(p.detalle.respuesta_esperada, 300) } : null;
    const senal = corta(p.senal, 200) || null;
    if (!criterio && !det && !senal) return null;
    return { tipo, requirement_id: rid, criterio, detalle: det, senal };
  }
  if (tipo === 'requisito') {
    const texto = corta(p.texto, 200);
    if (!texto) return null;
    return { tipo, texto, criterio: corta(p.criterio, 700), pregunta_escena: corta(p.pregunta_escena, 400),
             criterio_escena: corta(p.criterio_escena, 400) };
  }
  if (tipo === 'rasgo') {
    const rasgo = corta(p.rasgo, 120);
    if (!rasgo) return null;
    return { tipo, rasgo, por_que: corta(p.por_que, 400), pregunta: corta(p.pregunta, 400),
             se_ve_asi: corta(p.se_ve_asi, 300), no_se_ve_asi: corta(p.no_se_ve_asi, 300) };
  }
  return null;
}

// Lo que llega del navegador (o de Claude, a través del navegador) se limpia aquí. `nivel` lo
// pone el servidor desde la calificación guardada: no se le cree al navegador.
function normalizarFeedback(b, { requisitos = [], con_sesion = false, nivel = null } = {}) {
  b = b || {};
  const motivo = clean(b.motivo);
  if (!CLAVES_MOTIVO.includes(motivo)) return { error: 'Elige el motivo.' };
  const rid = b.requirement_id == null || b.requirement_id === '' ? null : Number(b.requirement_id);
  const req = rid ? requisitos.find(r => Number(r.id) === rid) : null;
  if (rid && !req) return { error: 'Ese requisito no es de esta vacante.' };
  const cita = corta(b.cita, 800), resumen = corta(b.resumen, 400);
  if (!cita && !resumen) return { error: 'Escribe qué dijo el cliente.' };
  const lectura = lecturaFeedback({ motivo, requirement_id: rid, nivel, con_sesion });
  const propuesta = normalizarPropuesta(b.propuesta, { lectura, requisitos });
  return {
    motivo, requirement_id: rid, requisito_texto: req ? clean(req.text) : null,
    fuente: FUENTES.includes(b.fuente) ? b.fuente : 'mensaje',
    cita, resumen, pregunta: corta(b.pregunta, 500),
    nivel_wei: con_sesion && Number(nivel) ? Number(nivel) : null,
    lectura, propuesta, propuesta_estado: propuesta ? 'pendiente' : null,
    registrado_por: corta(b.registrado_por, 80) || null,
  };
}

// Lo que vuelve a la guía de la entrevista: lo que el cliente ya rechazó en esta vacante,
// empezando por lo que contó en el levantamiento. Lo de salario y disponibilidad también
// vuelve —se pregunta antes de enviar—, pero aparte de lo que se verifica.
function rechazosVacante(v, feedbacks = []) {
  const out = [];
  const previos = v && v.ai_raw && clean(v.ai_raw.descartes_previos);
  if (previos) out.push({ origen: 'levantamiento', motivo: null, motivo_txt: 'Lo que contó en el levantamiento',
                          cita: previos, pregunta: '', requirement_id: null, at: v.created_at || null });
  // Dos clientes (o dos candidatos) pueden fallar por lo mismo: en la guía se dice una vez.
  const vistos = new Set();
  feedbacks.slice().sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
    .filter(f => { const k = `${f.motivo}|${f.requirement_id || ''}|${clean(f.resumen || f.cita).toLowerCase()}`; if (vistos.has(k)) return false; vistos.add(k); return true; })
    .forEach(f => out.push({ origen: 'feedback', id: f.id, motivo: f.motivo, motivo_txt: motivoTxt(f.motivo),
      cita: f.cita || f.resumen, resumen: f.resumen, pregunta: f.pregunta || '', requirement_id: f.requirement_id || null,
      requisito_texto: f.requisito_texto || null, lectura: f.lectura, candidato: f.candidate || null, at: f.created_at }));
  return out;
}

// Indicadores: de lo que el cliente entrevistó, cuánto rechazó por algo que la verificación
// dio por cumplido. Ese es el error que importa —un "cumple" que no cumplía— y es el que el
// cliente cobra con su confianza.
const ENTREVISTADO_FB = ['Lo entrevistó', 'Lo contrató', 'No avanzó'];
function indicadoresFeedback(feedbacks = [], sesiones = [], { ahora = Date.now(), dias = 90, evaluador = '' } = {}) {
  const desde = new Date(new Date(ahora).getTime() - dias * 86400000).toISOString();
  const k = t => clean(t).toLowerCase();
  const delEval = s => !evaluador || k(s.evaluator) === k(evaluador);
  const ent = sesiones.filter(s => s.status === 'issued' && delEval(s) && ENTREVISTADO_FB.includes(s.cliente_resultado)
    && s.cliente_resultado_at && new Date(s.cliente_resultado_at).toISOString() >= desde);
  const idsEnt = new Set(ent.map(s => Number(s.id)));
  const noAv = ent.filter(s => s.cliente_resultado === 'No avanzó');
  // Con un evaluador elegido solo cuenta lo que cae sobre sus candidatos; lo que es sobre la
  // vacante en general no es de nadie en particular.
  const sesPorId = new Map(sesiones.map(s => [Number(s.id), s]));
  const fbVent = feedbacks.filter(f => f.created_at && new Date(f.created_at).toISOString() >= desde
    && (!evaluador || (f.session_id && sesPorId.has(Number(f.session_id)) && delEval(sesPorId.get(Number(f.session_id))))));
  const fbEnt = fbVent.filter(f => f.session_id && idsEnt.has(Number(f.session_id)));
  const sesCon = l => new Set(fbEnt.filter(f => f.lectura === l).map(f => Number(f.session_id))).size;
  const conFb = new Set(fbEnt.map(f => Number(f.session_id)));
  const lecturas = {};
  Object.keys(LECTURAS).forEach(l => { lecturas[l] = fbVent.filter(f => f.lectura === l).length; });
  const motivos = MOTIVOS_FEEDBACK.map(m => ({ k: m.k, l: m.l, n: fbVent.filter(f => f.motivo === m.k).length }))
    .filter(m => m.n).sort((a, b) => b.n - a.n);
  const porEmp = {};
  fbVent.forEach(f => {
    const e = clean(f.company_name) || 'Sin empresa';
    const x = porEmp[e] || (porEmp[e] = { empresa: e, n: 0, desacuerdo: 0, oculto: 0, motivos: {} });
    x.n++; if (f.lectura === 'desacuerdo') x.desacuerdo++; if (f.lectura === 'oculto') x.oculto++;
    x.motivos[f.motivo] = (x.motivos[f.motivo] || 0) + 1;
  });
  const empresas = Object.values(porEmp).map(x => {
    const top = Object.entries(x.motivos).sort((a, b) => b[1] - a[1])[0];
    return { empresa: x.empresa, n: x.n, desacuerdo: x.desacuerdo, oculto: x.oculto, motivo_principal: top ? motivoTxt(top[0]) : '' };
  }).sort((a, b) => b.n - a.n).slice(0, 8);
  const fp = sesCon('desacuerdo');
  const pct = (a, b) => (b ? Math.round(100 * a / b) : null);
  return {
    dias, desde: desde.slice(0, 10),
    entrevistados: ent.length, no_avanzaron: noAv.length,
    sin_feedback: noAv.filter(s => !conFb.has(Number(s.id))).length,
    // El acierto: de lo entrevistado, lo que NO se cayó por algo que dimos por cumplido.
    falsos_positivos: { num: fp, den: ent.length, pct: pct(fp, ent.length) },
    acierto: { num: ent.length - fp, den: ent.length, pct: ent.length ? 100 - pct(fp, ent.length) : null },
    lecturas, motivos, empresas,
    propuestas_pendientes: feedbacks.filter(f => f.propuesta_estado === 'pendiente').length,
    ajustes_aceptados: fbVent.filter(f => f.propuesta_estado === 'aceptada').length,
  };
}

module.exports = {
  MOTIVOS_FEEDBACK, CLAVES_MOTIVO, motivoTxt, NO_CALIDAD, FUENTES, LECTURAS, PROPUESTA_PARA,
  lecturaFeedback, normalizarPropuesta, normalizarFeedback, rechazosVacante, indicadoresFeedback, ENTREVISTADO_FB,
};

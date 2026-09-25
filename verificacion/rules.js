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
  // Lo que se exige es lo que se imprime: el porqué del nivel. El rastro de auditoría
  // (`evidence`) dejó de ser el cuerpo del informe y no puede seguir siendo la condición
  // para emitirlo; cuando el análisis no lo produjo, el evaluador escribe el porqué y eso
  // basta. Se acepta cualquiera de los dos para no bloquear sesiones ya calificadas.
  if (ratings.some(r => clean(r.analisis).length <= 10 && clean(r.evidence).length <= 10)) {
    f.push('Falta explicar por qué cumple o no en algún requisito.');
  }
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

// Estado del análisis de la transcripción, con la lectura de un proceso que murió a mitad.
// Si el servidor se reinició (Render lo hace al desplegar) con un análisis en curso, la
// sesión queda en 'procesando' para siempre y nadie la va a completar: pasados unos minutos
// se reporta como interrumpida y se ofrece reintentar. Seis minutos es holgado: un análisis
// tarda 30-40 segundos.
const TRANSCRIPCION_STALE_MS = 6 * 60 * 1000;
function estadoTranscripcion(s, ahora = Date.now()) {
  const est = s && s.transcript_status;
  if (!est) return { estado: s && s.transcript_analisis ? 'lista' : null, error: null };
  if (est === 'procesando') {
    const t0 = s.transcript_started_at ? new Date(s.transcript_started_at).getTime() : 0;
    if (t0 && ahora - t0 > TRANSCRIPCION_STALE_MS) {
      return { estado: 'error', error: { error: 'El análisis se interrumpió antes de terminar. Vuelve a pegar la transcripción.', motivo: 'interrumpido' } };
    }
    return { estado: 'procesando', error: null };
  }
  return { estado: est, error: s.transcript_error || null };
}

// ---------------------------------------------------------------------------------------
// EL EMPLEO QUE SE VERIFICA
// Se verifica UNO: el más reciente declarado (hoja de vida o lo que anotó el reclutador).
// Pasó en producción que el análisis verificaba un empleo anterior sin relación —porque ahí
// estaba el caso de un requisito— y que dejaba sin verificar el último aunque se hubiera
// narrado. Esto concilia lo que devolvió el modelo con el ancla, y hace cumplir los criterios:
// el estado sale de C1–C4, no de un booleano suelto.
// ---------------------------------------------------------------------------------------
const normEmpresa = t => clean(t).toLowerCase()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  .replace(/\b(s\.?\s?a\.?\s?s\.?|s\.?\s?a\.?|ltda\.?|inc\.?|llc|corp\.?|colombia|group|grupo)\b/g, ' ')
  .replace(/[^a-z0-9]+/g, ' ').trim();
function mismaEmpresa(a, b) {
  const x = normEmpresa(a), y = normEmpresa(b);
  if (!x || !y) return true;               // sin nombre de un lado no hay con qué contradecir
  return x === y || x.includes(y) || y.includes(x);
}
const ESTADOS_EMPLEO = ['verificada', 'no_verificada', 'contradice'];
function conciliarEmpleo(ancla, r) {
  r = (r && typeof r === 'object') ? r : {};
  const a = (ancla && (clean(ancla.empresa) || clean(ancla.cargo))) ? ancla : null;
  const criterios = Array.isArray(r.criterios) ? r.criterios.filter(c => c && c.id)
    .map(c => ({ id: String(c.id).toUpperCase(), cumplido: c.cumplido === true ? true : (c.cumplido === false ? false : null), como: clean(c.como) })) : [];
  const crit = id => criterios.find(c => c.id === id);
  let estado = ESTADOS_EMPLEO.includes(r.estado) ? r.estado : (r.verificada === true ? 'verificada' : 'no_verificada');
  let queFalto = clean(r.que_falto);
  // Los criterios mandan sobre el estado declarado.
  if (crit('C4') && crit('C4').cumplido === false) estado = 'contradice';
  else if (estado === 'verificada' && criterios.length) {
    const faltan = ['C1', 'C2', 'C3'].filter(id => !crit(id) || crit(id).cumplido !== true);
    if (faltan.length) { estado = 'no_verificada'; queFalto = queFalto || `Faltó evidencia de ${faltan.join(', ')}.`; }
  }
  const base = a
    ? { empresa: clean(a.empresa), cargo: clean(a.cargo), periodo: clean(a.periodo), fuente: a.fuente === 'reclutador' ? 'reclutador' : 'cv' }
    : { empresa: clean(r.empresa), cargo: clean(r.cargo), periodo: clean(r.periodo), fuente: 'transcripcion' };
  // El modelo habló de OTRO empleo: no se le cree la verificación, el declarado queda sin verificar.
  if (a && clean(r.empresa) && !mismaEmpresa(a.empresa, r.empresa)) {
    return { ...base, estado: 'no_verificada', verificada: false, criterios: [], por_que_verificada: '',
             que_falto: `El análisis se refirió a otro empleo (${clean(r.empresa)}); el declarado no quedó verificado con la conversación.`,
             otro_mas_reciente: clean(r.otro_mas_reciente), aviso: 'otro_empleo', otro_empleo: clean(r.empresa) };
  }
  // Sin ancla y sin empresa identificada con certeza: no hay nada que verificar.
  if (!a && !base.empresa && !base.cargo) estado = 'no_verificada';
  return { ...base, estado, verificada: estado === 'verificada', criterios,
           por_que_verificada: estado === 'verificada' ? clean(r.por_que_verificada) : '',
           que_falto: estado === 'verificada' ? '' : queFalto,
           otro_mas_reciente: clean(r.otro_mas_reciente), aviso: '' };
}

// ---------------------------------------------------------------------------------------
// EL TABLERO
// Con decenas de verificaciones, lo que el reclutador necesita primero es saber qué le toca
// hacer; después, cómo va. Estas funciones son puras —entran filas, sale un resumen— para que
// el servidor, el stub y las pruebas calculen exactamente lo mismo.
// ---------------------------------------------------------------------------------------

// En qué punto está una verificación, desde la pregunta "¿qué me toca hacer con esta?".
function estadoTablero(s, ahora = Date.now()) {
  if (!s) return 'en_curso';
  if (s.status === 'issued') return 'emitido';
  const tr = estadoTranscripcion(s, ahora).estado;
  if (tr === 'procesando') return 'analizando';
  if (tr === 'error') return 'fallo';
  if (s.transcript_at || tr === 'lista') return 'calificar';
  if (s.status === 'esperando') return 'espera';
  return 'en_curso';
}

// El evaluador es texto libre ("Weimar", "weimar ", "Weimar G."): se agrupa por una clave
// normalizada y se muestra con la forma más frecuente.
const claveEvaluador = t => clean(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim();

// Fecha local de Colombia (UTC-5, sin horario de verano) como 'AAAA-MM-DD'.
const OFFSET_CO_MIN = -300;
const diaLocal = (t, off = OFFSET_CO_MIN) => new Date(new Date(t).getTime() + off * 60000).toISOString().slice(0, 10);
const lunesDe = dia => { const d = new Date(dia + 'T00:00:00Z'); const w = (d.getUTCDay() + 6) % 7; d.setUTCDate(d.getUTCDate() - w); return d.toISOString().slice(0, 10); };
const sumarDias = (dia, n) => { const d = new Date(dia + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const mediana = xs => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function estadisticas(sesiones, { evaluador = '', ahora = Date.now(), semanas = 8 } = {}) {
  const todas = Array.isArray(sesiones) ? sesiones : [];
  // Evaluadores, con su forma más frecuente.
  const porClave = {};
  for (const s of todas) {
    const k = claveEvaluador(s.evaluator); if (!k) continue;
    const e = porClave[k] || (porClave[k] = { clave: k, n: 0, formas: {} });
    e.n++; const f = clean(s.evaluator); e.formas[f] = (e.formas[f] || 0) + 1;
  }
  const evaluadores = Object.values(porClave)
    .map(e => ({ clave: e.clave, n: e.n, nombre: Object.entries(e.formas).sort((a, b) => b[1] - a[1])[0][0] }))
    .sort((a, b) => b.n - a.n);
  const filtro = claveEvaluador(evaluador) || null;
  const mias = filtro ? todas.filter(s => claveEvaluador(s.evaluator) === filtro) : todas;

  const hoy = diaLocal(ahora);
  const lunes = lunesDe(hoy);
  const inicios = []; for (let i = semanas - 1; i >= 0; i--) inicios.push(sumarDias(lunes, -7 * i));
  const semanasArr = inicios.map(ini => ({ inicio: ini, entrevistas: 0, informes: 0 }));
  const idx = {}; inicios.forEach((d, i) => { idx[d] = i; });
  const cuando = s => s.entrevista_at || s.started_at || null;
  for (const s of mias) {
    const e = cuando(s); if (e) { const i = idx[lunesDe(diaLocal(e))]; if (i !== undefined) semanasArr[i].entrevistas++; }
    if (s.status === 'issued' && s.issued_at) { const i = idx[lunesDe(diaLocal(s.issued_at))]; if (i !== undefined) semanasArr[i].informes++; }
  }
  const esta = semanasArr[semanasArr.length - 1], pasada = semanasArr[semanasArr.length - 2] || { entrevistas: 0, informes: 0 };

  // Rapidez: horas de la entrevista al informe, últimos 30 días contra los 30 anteriores.
  const DIA = 86400000, t = new Date(ahora).getTime();
  const horas = (desde, hasta) => mias.filter(s => s.status === 'issued' && s.issued_at && cuando(s))
    .filter(s => { const x = new Date(s.issued_at).getTime(); return x > t - hasta * DIA && x <= t - desde * DIA; })
    .map(s => (new Date(s.issued_at).getTime() - new Date(cuando(s)).getTime()) / 3600000)
    .filter(h => h >= 0);
  const h30 = horas(0, 30), h60 = horas(30, 60);

  // Calidad de lo que llega a informe: de los emitidos en 30 días, cuántos cumplen TODO.
  const emit30 = mias.filter(s => s.status === 'issued' && s.issued_at && new Date(s.issued_at).getTime() > t - 30 * DIA && Number(s.req_total) > 0);
  const cumplen = emit30.filter(s => Number(s.req_cumple) >= Number(s.req_total)).length;

  // Racha: días hábiles seguidos con al menos un informe. Hoy sin informe todavía no la rompe.
  const diasConInforme = new Set(mias.filter(s => s.status === 'issued' && s.issued_at).map(s => diaLocal(s.issued_at)));
  let racha = 0, d = diasConInforme.has(hoy) ? hoy : sumarDias(hoy, -1);
  for (let guard = 0; guard < 400; guard++) {
    const w = new Date(d + 'T00:00:00Z').getUTCDay();
    if (w === 0 || w === 6) { d = sumarDias(d, -1); continue; }
    if (!diasConInforme.has(d)) break;
    racha++; d = sumarDias(d, -1);
  }

  const pendientes = { calificar: 0, fallo: 0, espera: 0, analizando: 0, en_curso: 0 };
  for (const s of mias) { const e = estadoTablero(s, t); if (pendientes[e] !== undefined) pendientes[e]++; }
  const equipoSemana = todas.filter(s => s.status === 'issued' && s.issued_at && lunesDe(diaLocal(s.issued_at)) === lunes).length;

  return {
    evaluadores, filtro, hoy, semanas: semanasArr,
    esta_semana: { entrevistas: esta.entrevistas, informes: esta.informes },
    semana_pasada: { entrevistas: pasada.entrevistas, informes: pasada.informes },
    horas_a_informe: { mediana: mediana(h30), n: h30.length, previa: mediana(h60) },
    cumplen: { informes: emit30.length, cumplen, pct: emit30.length ? Math.round(100 * cumplen / emit30.length) : null },
    racha, pendientes,
    total_informes: mias.filter(s => s.status === 'issued').length,
    total_verificaciones: mias.length,
    equipo_semana: equipoSemana,
  };
}

// ---------------------------------------------------------------------------------------
// PULSO DE LAS VACANTES: qué tan cerca está cada búsqueda de concretarse.
// Una vacante está "en movimiento" si se creó en los últimos 14 días o si alguna de sus
// verificaciones se movió en ese lapso. La señal de cierre sale de cuántos candidatos
// validados (informe emitido) cumplen TODOS los requisitos, contra una terna de 3:
//   alta  → ya hay terna: 3 o más cumplen todo;
//   media → al menos 1 cumple todo, o hay 2+ candidatos en proceso que pueden completarla;
//   baja  → ninguno cumple todo y casi nada en proceso.
// Es una regla que se explica en una línea a propósito: el reclutador tiene que poder
// decirle al cliente por qué una vacante está "alta" sin abrir una fórmula.
// ---------------------------------------------------------------------------------------
const TERNA = 3;
const DIAS_RECIENTE = 14;
const ms = x => { const n = x ? new Date(x).getTime() : NaN; return isNaN(n) ? null : n; };
const actividadSesion = s => Math.max(0, ...[s.updated_at, s.issued_at, s.transcript_at, s.entrevista_at, s.started_at, s.created_at].map(ms).filter(n => n != null)) || null;
function resultadoSesion(s) {
  if (!s || s.status !== 'issued' || !(Number(s.req_total) > 0)) return null;
  const c = Number(s.req_cumple) || 0, t = Number(s.req_total);
  return c >= t ? 'ok' : (c > 0 ? 'par' : 'no');
}
const PROB_ORDEN = { alta: 0, media: 1, baja: 2 };

function pulsoVacante(v, sesiones, { ahora = Date.now(), dias = DIAS_RECIENTE } = {}) {
  const t = new Date(ahora).getTime(), desde = t - dias * 86400000;
  const cs = (Array.isArray(sesiones) ? sesiones : []).filter(s => s.vacancy_id != null && Number(s.vacancy_id) === Number(v.id));
  const validados = cs.filter(s => s.status === 'issued');
  const res = validados.map(resultadoSesion);
  const aptos = res.filter(r => r === 'ok').length;
  const parciales = res.filter(r => r === 'par').length;
  const no_cumplen = res.filter(r => r === 'no').length;
  const en_proceso = cs.length - validados.length;
  const acts = cs.map(actividadSesion).filter(Boolean);
  const ultima = acts.length ? Math.max(...acts) : null;
  const creada = ms(v.created_at);
  const cerrada = (v.status || 'activa') === 'cerrada';
  const nueva = creada != null && creada >= desde;
  const movida = ultima != null && ultima >= desde;
  const reciente = !cerrada && (nueva || movida);
  const validados_recientes = validados.filter(s => (ms(s.issued_at) || 0) >= desde).length;
  let probabilidad = null, razon = '';
  const faltan = Math.max(0, TERNA - aptos);
  const pl = (n, a, b) => (n === 1 ? a : b);
  if (!cerrada) {
    if (aptos >= TERNA) {
      probabilidad = 'alta';
      razon = `Terna lista: ${aptos} candidatos cumplen todos los requisitos.`;
    } else if (aptos >= 1 || en_proceso >= 2) {
      probabilidad = 'media';
      razon = aptos
        ? `${aptos} ${pl(aptos, 'cumple', 'cumplen')} todo; ${pl(faltan, 'falta 1', `faltan ${faltan}`)} para la terna${en_proceso ? ` y hay ${en_proceso} en proceso` : ''}.`
        : `Ninguno cumple todo todavía, pero hay ${en_proceso} en proceso.`;
    } else {
      probabilidad = 'baja';
      razon = validados.length
        ? `Ninguno de ${pl(validados.length, 'el validado', `los ${validados.length} validados`)} cumple todo${en_proceso ? `; ${en_proceso} en proceso` : ''}.`
        : (en_proceso ? 'Sin informes todavía; 1 candidato en proceso.' : 'Sin candidatos verificados todavía.');
    }
  }
  return {
    id: v.id, title: v.title || '', company_name: v.company_name || '', status: v.status || 'activa',
    created_at: v.created_at || null,
    validaciones: cs.length, validados: validados.length, aptos, parciales, no_cumplen, en_proceso,
    validados_recientes, ultima_actividad: ultima ? new Date(ultima).toISOString() : null,
    reciente, motivo: reciente ? (movida ? 'actividad' : 'nueva') : null,
    probabilidad, faltan, terna: TERNA, razon,
  };
}

// Todas las vacantes con su pulso, y un resumen de las que están en movimiento. El orden es el
// de la pregunta "¿cuál se cierra primero?": probabilidad, luego cuántos cumplen todo, luego
// cuántos validados, y al final la actividad más reciente.
function pulsoVacantes(vacantes, sesiones, { ahora = Date.now(), dias = DIAS_RECIENTE } = {}) {
  const lista = (Array.isArray(vacantes) ? vacantes : []).map(v => pulsoVacante(v, sesiones, { ahora, dias }));
  const orden = (a, b) => (a.reciente === b.reciente ? 0 : a.reciente ? -1 : 1)
    || (PROB_ORDEN[a.probabilidad] ?? 9) - (PROB_ORDEN[b.probabilidad] ?? 9)
    || b.aptos - a.aptos || b.validados - a.validados || b.validaciones - a.validaciones
    || (ms(b.ultima_actividad) || ms(b.created_at) || 0) - (ms(a.ultima_actividad) || ms(a.created_at) || 0);
  lista.sort(orden);
  const rec = lista.filter(p => p.reciente);
  const suma = k => rec.reduce((n, p) => n + p[k], 0);
  return {
    dias, terna: TERNA, vacantes: lista,
    resumen: {
      recientes: rec.length,
      validaciones: suma('validaciones'), validados: suma('validados'), aptos: suma('aptos'),
      en_proceso: suma('en_proceso'), validados_recientes: suma('validados_recientes'),
      alta: rec.filter(p => p.probabilidad === 'alta').length,
      media: rec.filter(p => p.probabilidad === 'media').length,
      baja: rec.filter(p => p.probabilidad === 'baja').length,
    },
  };
}

// ---------------------------------------------------------------------------------------
// INDICADORES DE LA SEMANA (el "cuadro" semanal, como el de prospección): lunes a domingo en
// hora de Colombia, con el mismo corte por día. Tres focos:
//   · vacantes verificadas: vacantes con al menos un informe emitido en el periodo;
//   · calidad: de esos informes, cuántos cumplen TODOS los requisitos y cuántos salen en verde;
//   · empresas atendidas: una empresa está atendida si al menos una de sus vacantes se trabajó
//     (entrevista o informe) en el periodo — trabajarle 3 de sus 10 vacantes ya es atenderla.
// Lo que es de la vacante y no de quien entrevista (vacantes nuevas, ternas completadas) se
// cuenta siempre para el equipo, aunque se filtre por evaluador.
// ---------------------------------------------------------------------------------------
const claveEmpresa = v => clean(v && v.company_name).toLowerCase() || (v && v.company_id != null ? 'id:' + v.company_id : 'sin empresa');
const esFecha = f => /^\d{4}-\d{2}-\d{2}$/.test(String(f || ''));
const pct = (a, b) => (b ? Math.round(100 * a / b) : null);

function indicadoresSemana(sesiones, vacantes, { fecha = null, evaluador = '', ahora = Date.now(), semanas = 8, diasTasas = 28 } = {}) {
  const todas = Array.isArray(sesiones) ? sesiones : [];
  const vacs = Array.isArray(vacantes) ? vacantes : [];
  const hoy = diaLocal(ahora);
  const lunes = lunesDe(esFecha(fecha) && fecha <= hoy ? fecha : hoy);
  const domingo = sumarDias(lunes, 6);
  const filtro = claveEvaluador(evaluador) || null;
  const mias = filtro ? todas.filter(s => claveEvaluador(s.evaluator) === filtro) : todas;
  const vacPorId = {}; vacs.forEach(v => { vacPorId[Number(v.id)] = v; });
  const cuando = s => s.entrevista_at || s.started_at || null;
  const dEnt = s => (cuando(s) ? diaLocal(cuando(s)) : null);
  const dInf = s => (s.status === 'issued' && s.issued_at ? diaLocal(s.issued_at) : null);
  const vid = s => (s.vacancy_id == null ? null : Number(s.vacancy_id));

  // Día en que cada vacante completó su terna (el tercer informe que cumple todo). Del equipo.
  const ternaEl = {};
  const aptosPorVac = {};
  todas.filter(s => resultadoSesion(s) === 'ok' && s.issued_at && vid(s) != null)
    .forEach(s => { (aptosPorVac[vid(s)] = aptosPorVac[vid(s)] || []).push(diaLocal(s.issued_at)); });
  Object.entries(aptosPorVac).forEach(([id, ds]) => { ds.sort(); if (ds.length >= TERNA) ternaEl[id] = ds[TERNA - 1]; });

  function resumen(desde, hasta) {
    const en = d => d && d >= desde && d <= hasta;
    const ents = mias.filter(s => en(dEnt(s)));
    const infs = mias.filter(s => en(dInf(s)));
    const conReq = infs.filter(s => Number(s.req_total) > 0);
    const cumplen = conReq.filter(s => resultadoSesion(s) === 'ok').length;
    const verdes = infs.filter(s => s.semaforo === 'verde').length;
    const trab = new Set(ents.concat(infs).map(vid).filter(x => x != null));
    const verif = new Set(infs.map(vid).filter(x => x != null));
    const emp = new Set([...trab].map(id => vacPorId[id]).filter(Boolean).map(claveEmpresa));
    const horas = infs.filter(cuando).map(s => (new Date(s.issued_at) - new Date(cuando(s))) / 3600000).filter(h => h >= 0);
    return {
      entrevistas: ents.length, informes: infs.length,
      cumplen, con_requisitos: conReq.length, pct_cumplen: pct(cumplen, conReq.length),
      verdes, pct_verdes: pct(verdes, infs.length),
      vacantes_trabajadas: trab.size, vacantes_verificadas: verif.size, empresas_atendidas: emp.size,
      nuevas_vacantes: vacs.filter(v => v.created_at && en(diaLocal(v.created_at))).length,
      ternas: Object.values(ternaEl).filter(en).length,
      horas_mediana: mediana(horas),
      _trab: trab, _infs: infs,
    };
  }
  const limpiar = r => { const { _trab, _infs, ...x } = r; return x; };

  const sem = resumen(lunes, domingo);
  const previa = resumen(sumarDias(lunes, -7), sumarDias(lunes, -1));

  const dias = [];
  for (let i = 0; i < 7; i++) {
    const f = sumarDias(lunes, i);
    const r = resumen(f, f);
    dias.push({ fecha: f, habil: i < 5, futuro: f > hoy, ...limpiar(r) });
  }

  // Empresas: las que tienen vacantes activas, más las que se atendieron aunque su vacante ya
  // esté cerrada. "x de y" = vacantes trabajadas en la semana de las que tiene (activas o trabajadas).
  const empresas = {};
  const emp = v => {
    const k = claveEmpresa(v);
    return empresas[k] || (empresas[k] = { empresa: clean(v.company_name) || 'Sin empresa', vacantes: new Set(), activas: 0, trabajadas: new Set(), informes: 0, cumplen: 0 });
  };
  vacs.filter(v => (v.status || 'activa') !== 'cerrada').forEach(v => { const e = emp(v); e.vacantes.add(Number(v.id)); e.activas++; });
  sem._trab.forEach(id => { const v = vacPorId[id]; if (!v) return; const e = emp(v); e.vacantes.add(id); e.trabajadas.add(id); });
  sem._infs.forEach(s => { const v = vacPorId[vid(s)]; if (!v) return; const e = emp(v); e.informes++; if (resultadoSesion(s) === 'ok') e.cumplen++; });
  const listaEmp = Object.values(empresas).map(e => ({
    empresa: e.empresa, vacantes: e.vacantes.size, activas: e.activas, trabajadas: e.trabajadas.size,
    informes: e.informes, cumplen: e.cumplen, atendida: e.trabajadas.size > 0,
  })).sort((a, b) => (b.atendida - a.atendida) || (b.trabajadas - a.trabajadas) || (b.informes - a.informes) || (b.vacantes - a.vacantes) || a.empresa.localeCompare(b.empresa));

  // Tasas de los últimos 28 días hasta el cierre de la semana (o hoy, si la semana está en curso).
  const hasta = domingo < hoy ? domingo : hoy, desde = sumarDias(hasta, -(diasTasas - 1));
  const enT = d => d && d >= desde && d <= hasta;
  const entT = mias.filter(s => enT(dEnt(s)));
  const infT = mias.filter(s => enT(dInf(s)));
  const conReqT = infT.filter(s => Number(s.req_total) > 0);
  const vacT = [...new Set(entT.concat(infT).map(vid).filter(x => x != null))];
  const conApto = vacT.filter(id => (aptosPorVac[id] || []).some(d => d <= hasta)).length;
  const tasa = (num, den) => ({ pct: pct(num, den), num, den });
  const tasas = {
    desde, hasta, dias: diasTasas,
    entrevista_a_informe: tasa(entT.filter(s => s.status === 'issued').length, entT.length),
    cumplen_todo: tasa(conReqT.filter(s => resultadoSesion(s) === 'ok').length, conReqT.length),
    semaforo_verde: tasa(infT.filter(s => s.semaforo === 'verde').length, infT.length),
    vacantes_con_apto: tasa(conApto, vacT.length),
  };

  const tendencia = [];
  for (let i = semanas - 1; i >= 0; i--) {
    const ini = sumarDias(lunes, -7 * i);
    const r = resumen(ini, sumarDias(ini, 6));
    tendencia.push({ inicio: ini, informes: r.informes, vacantes_verificadas: r.vacantes_verificadas, empresas_atendidas: r.empresas_atendidas, pct_cumplen: r.pct_cumplen });
  }

  const est = estadisticas(todas, { evaluador, ahora });
  return {
    lunes, domingo, hoy, filtro, evaluadores: est.evaluadores, racha: est.racha,
    semana: limpiar(sem), previa: limpiar(previa),
    empresas_con_vacantes: listaEmp.length,
    dias, empresas: listaEmp, tasas, tendencia,
  };
}

module.exports = {
  estadoTablero, claveEvaluador, estadisticas, diaLocal,
  pulsoVacante, pulsoVacantes, resultadoSesion, TERNA, DIAS_RECIENTE, indicadoresSemana,
  mismaEmpresa, conciliarEmpleo, ESTADOS_EMPLEO,
  LVLTXT, MAX_REQ, ID_ITEMS, itemsDe, KINDS, esCierre, clean, estadoTranscripcion, TRANSCRIPCION_STALE_MS,
  semaforo, estadoIdentidad, bloqueos, tipoDocumento, integrityHash, reportCode,
};

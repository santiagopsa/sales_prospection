/* PeakU · Consola de Verificación — frontend
   Vistas: tablero → levantamiento → revisión → vacante → setup → sesión → acta */

/* ===================== constantes de dominio ===================== */
const SIGNALS = [
  {id:'lat', t:'Latencia de soplo',      d:'Pausa larga y luego respuesta perfecta, una y otra vez'},
  {id:'lee', t:'Mirada de lectura',      d:'Ojos que barren de lado a lado antes de cada respuesta'},
  {id:'voz', t:'Voz de lectura',         d:'El tono cambia entre charla casual y respuesta técnica'},
  {id:'nav', t:'No navega su archivo',   d:'Se pierde dentro del archivo que él mismo entregó'},
  {id:'pan', t:'Resiste la pantalla',    d:'Demora, excusas o negativa a compartir pantalla'},
  {id:'inc', t:'Incoherencia',           d:'Explica algo distinto de lo que muestra el documento o el CV'},
  {id:'aud', t:'Audio delator',          d:'Teclas, susurros o eco de segunda voz antes de responder'},
  {id:'mod', t:'Modificación imposible', d:'No logra ni intentar los cambios en vivo'}
];

// El inglés no se pregunta, se escucha. Se pasa un tramo de la entrevista a inglés y se mide
// por conducta observable: un certificado no dice si aguanta un daily con el cliente.
const NIVELES_ING = ['C1','B2','B1','A2','A1'];
const ANCLA_ING = {
  C1:'Sostiene una discusión técnica con matices: discrepa, matiza y se autocorrige sin perder el hilo. No busca palabras.',
  B2:'Sostiene la conversación de trabajo sin fricción notable. Pausas ocasionales y errores que no estorban.',
  B1:'Se hace entender en temas conocidos, con frases cortas. Pierde fluidez apenas sale de lo que traía preparado.',
  A2:'Responde lo básico y vuelve al español. No sostiene una conversación de trabajo.',
  A1:'No logra sostener el intercambio.',
};
// El guion para pasar a inglés sin que se sienta un examen sorpresa.
const GUION_ING = [
  {t:'Anúncialo', d:'“Para esta parte vamos a cambiar a inglés unos minutos, porque el cargo lo necesita en el día a día. ¿Te parece?” Avisar no es hacer trampa: reduce el nervio, que no es lo que estamos midiendo.'},
  {t:'Arranca fácil', d:'<em>“Tell me about the project you just described — same story, in English.”</em> Que repita en inglés algo que ya contó: se compara contenido conocido y se ve la fluidez, no la memoria.'},
  {t:'Súbelo al trabajo real', d:'Llévalo a lo que hará en el cargo. Si son reuniones con el cliente, plantéale una: <em>“The client says the deadline moves up two weeks. Walk me through how you would push back.”</em>'},
  {t:'Escucha la fricción', d:'Discrepa con algo que diga y deja que responda. Ahí se ve la diferencia entre quien tiene frases guardadas y quien piensa en inglés.'},
];

const ANCHORS = {
  5:'<b>Nivel 5.</b> Escena específica (empresa, fecha, alcance) + rol individual claro + fricción real narrada con detalle + los 3 detalles verificables correctos + cruce respondido con criterio propio.',
  4:'<b>Nivel 4.</b> Escena y rol claros + fricción real + al menos 2 detalles verificables correctos; el cruce correcto aunque superficial.',
  3:'<b>Nivel 3.</b> Experiencia plausible pero la escena es genérica o la fricción es vaga; detalles parciales; el cruce se responde con generalidades correctas.',
  2:'<b>Nivel 2.</b> Solo definiciones y contexto; no produce escena propia ni fricción; confunde al menos un detalle verificable.',
  1:'<b>Nivel 1.</b> No sostiene el tema: evasivas, incoherencias con su CV, o detalles claramente incorrectos.'
};
const LVLTXT = {5:'CUMPLE',4:'CUMPLE',3:'PARCIAL',2:'NO CUMPLE',1:'NO CUMPLE'};

// Versión corta del ancla, para citar en el acta qué significó ese nivel.
// Sin esto, un "4/5" es un número sin criterio detrás.
/* Lo que el informe dice de un nivel cuando no hay un párrafo de analista detrás —una sesión
   calificada a mano, sin transcripción—. Dice lo mismo que el ancla pero mirando al candidato
   en vez de al método: el cliente no tiene por qué leer con qué lista de chequeo trabajamos. */
const NIVEL_CLIENTE = {
  5:'Demostrado con un caso propio, narrado con su alcance, sus decisiones y su resultado.',
  4:'Demostrado con un caso propio; el alcance quedó claro y el detalle técnico resultó consistente.',
  3:'Experiencia real en el tema, con alcance parcial frente a lo que el cargo exige.',
  2:'Conocimiento del tema que no llegó a sostenerse con un caso propio.',
  1:'No quedó sostenido con evidencia durante la entrevista.'
};

const ANCLA_CORTA = {
  5:'Ancla 5: escena específica + rol individual + fricción real narrada + 3/3 detalles verificables + criterio propio en el cruce.',
  4:'Ancla 4: escena y rol claros + fricción real + 2/3 detalles verificables; cruce correcto aunque superficial.',
  3:'Ancla 3: experiencia plausible pero escena genérica o fricción vaga; detalles parciales.',
  2:'Ancla 2: solo definiciones y contexto; sin escena propia; confunde algún detalle verificable.',
  1:'Ancla 1: no sostiene el tema — evasivas, incoherencias con el CV o detalles incorrectos.'
};

/* Tres requisitos, no cinco. La sesión dura 30 minutos y el tiempo no es lo único que se
   reparte: la atención del reclutador también. Con cinco temas, cada uno recibe una pregunta
   y ninguna repregunta — y la repregunta es lo que separa a quien lo hizo de quien lo leyó.
   El inglés no cuenta contra este tope: no se pregunta, se escucha en un tramo aparte. */
const MAX_REQ = 3;
// Los rasgos de conducta van aparte y tampoco pueden ser muchos: cada uno cuesta una pregunta
// y una repregunta dentro de los mismos 30 minutos.
const MAX_PERFIL = 3;

const SONDA = [
  {t:'Declaración', d:'“El cargo exige <em>[requisito]</em>. Cuéntame tu experiencia con eso.” Deja que hable un minuto sin interrumpir.'},
  {t:'Escena',      d:'Llévalo al último caso concreto: cuándo fue, en qué empresa, y qué hizo <em>él</em> — no el equipo, él. El impostor habla en general; el real aterriza en un día específico.'},
  {t:'Fricción',    d:'Pregunta qué salió mal y qué fue lo más difícil. La experiencia real siempre tiene cicatrices; la inventada es lisa.'},
  {t:'Detalle',     d:'Contrasta contra los detalles verificables de abajo. Son los hechos duros que solo conoce quien lo hizo.'},
  {t:'Cruce',       d:'La pregunta técnica de abajo, y un retrollamado: “espera, hace un momento dijiste <em>[A]</em>, ¿cómo cuadra con esto?” El copiloto de IA no recuerda lo que dijo hace diez minutos.'}
];

const DEFENSA = [
  {t:'Apertura',    d:'“Comparte tu pantalla y abre lo que entregaste en el proceso. Cuéntame cómo lo hiciste, como si me lo explicaras a un colega.” Escucha el <em>tono</em>: el que lo hizo habla con calor y se desvía en anécdotas.'},
  {t:'Preguntas',   d:'Las preguntas de defensa, en cualquier orden. Interrumpe con naturalidad — “espera, ¿y por qué no lo hiciste con…?” — las interrupciones rompen el ritmo del que lee.'},
  {t:'Fricción',    d:'“¿Qué fue lo más difícil de esto? ¿Qué te tocó rehacer?” Si no hay ninguna cicatriz en el relato, es señal.'},
  {t:'Modificación',d:'“Cámbiale esto aquí mismo, yo espero.” No importa si queda perfecto — importa <em>cómo</em> lo intenta: el autor navega su archivo sin buscar.'},
  {t:'Cruce',       d:'Un retrollamado de consistencia sobre algo que dijo antes en la sesión.'}
];

// Integridad de la sesión. Ya no se le pide ningún documento al candidato en la llamada:
// el documento lo valida Didit después, y aquí solo queda lo que ocurre en la entrevista.
const IDCHECKS = [
  {id:'grab', t:'Grabación activa antes de que entre el candidato', d:'Si Meet pide consentimiento, mejor: queda grabado que aceptó', kinds:['sondeo','cierre']},
  {id:'cam',  t:'Cámara encendida y rostro visible',                d:'Sin video no hay señales que observar; es lo normal en cualquier entrevista', kinds:['sondeo','cierre']},
  // OJO: la captura se OFRECE siempre —también en un sondeo— pero solo es EXIGIBLE en un
  // cierre. Son dos cosas distintas y confundirlas bloquea la emisión: un sondeo donde el
  // candidato no encendió la cámara seguiría pudiendo producir su ficha. La caja de captura
  // se dibuja en las dos, esta lista es solo lo que la carpeta exige para emitir.
  {id:'shot', t:'Captura del rostro tomada',                        d:'Se marca sola al subir la imagen; es contra lo que se coteja la verificación', kinds:['cierre']}
];
const idChecksDe = kind => IDCHECKS.filter(c => c.kinds.includes(kind));

/* ===================== ruta base =====================
   La app se monta bajo un prefijo (/verificacion) dentro del servidor del Sandler.
   La base se deduce del propio <script> para no hardcodear el punto de montaje. */
// URL pública de verificación del acta. Se arma con el dominio donde de verdad corre la app:
// una dirección impresa en un documento que va al cliente tiene que existir.
function urlVerificacion(codigo){
  return `${location.host}${BASE}/v/${codigo}`;
}
// La misma dirección, completa, para meterla en un QR: un lector necesita el esquema.
function urlVerificacionAbs(codigo){
  return `${location.origin}${BASE}/v/${codigo}`;
}

// QR generado aquí mismo (public/qr.js), sin pedirle la imagen a nadie.
// Si por lo que sea el codificador no cargó, no se dibuja un cuadro roto: se devuelve vacío
// y queda la URL escrita, que es la que manda. El QR es una comodidad, no la fuente de verdad.
// El tamaño se pide en píxeles POR MÓDULO, no en píxeles totales: así el lado siempre es
// múltiplo entero del número de módulos y la rejilla sale pareja. Con un tamaño total fijo,
// un código de 41 módulos en 108px da módulos de 2.6px que el navegador redondea a 2 y a 3,
// y ningún lector encuentra la rejilla — se ve bien y no escanea.
function qrSvg(texto, modulo, alt){
  try{
    if(!texto || typeof QR === 'undefined') return '';
    // El módulo se ajusta al zoom real de la pantalla. Lo que tiene que ser entero no es el
    // módulo en píxeles CSS, sino en píxeles FÍSICOS: con el navegador al 110%, un módulo de
    // 4px CSS aterriza en 4.4 píxeles físicos, el navegador redondea unos a 4 y otros a 5,
    // y la rejilla deja de ser regular. Esa es exactamente la falla que no se ve a simple vista.
    const dpr = window.devicePixelRatio || 1;
    const obj = modulo || 6;
    const mod = Math.max(1, Math.round(obj * dpr)) / dpr;
    // Siempre negro sobre blanco, incluso en modo oscuro: hay lectores que no leen un QR
    // invertido, y este código tiene que funcionar en una pantalla compartida y en papel.
    return QR.svg(texto, {modulo: mod, fondo: '#fff', color: '#000', alt: alt || 'Código QR'});
  }catch(e){ console.warn('[qr]', e.message); return ''; }
}

// Los QR se pintan en su contenedor después de armar el HTML, y se vuelven a pintar si
// cambia el zoom. Un QR dibujado al 100% y mirado al 125% ya no tiene la rejilla pareja.
function pintarQrs(raiz){
  (raiz || document).querySelectorAll('[data-qr]').forEach(el => {
    const url = el.getAttribute('data-qr');
    if(!url) return;
    el.innerHTML = qrSvg(url, Number(el.getAttribute('data-qr-mod')) || 6, el.getAttribute('data-qr-alt') || '');
  });
}
function huecoQr(url, modulo, alt){
  return `<div data-qr="${esc(url)}" data-qr-mod="${modulo}" data-qr-alt="${esc(alt||'')}"></div>`;
}
let dprAnterior = window.devicePixelRatio || 1;
window.addEventListener('resize', () => {
  const ahora = window.devicePixelRatio || 1;
  if(ahora !== dprAnterior){ dprAnterior = ahora; pintarQrs(); }
});

const BASE = (function(){
  try{
    const s = document.currentScript && document.currentScript.src;
    if(s) return new URL(s).pathname.replace(/\/app\.js.*$/, '');
  }catch(e){}
  return location.pathname.replace(/\/+$/, '');
})();

/* ===================== utilidades ===================== */
const $ = s => document.querySelector(s);
const esc = s => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mmss = ms => { const t=Math.max(0,Math.floor(ms/1000)); return Math.floor(t/60)+':'+String(t%60).padStart(2,'0'); };
function toast(m){ const t=$('#toast'); t.textContent=m; t.classList.add('on'); setTimeout(()=>t.classList.remove('on'),2400); }
function overlay(on, title, sub){
  if(title) $('#ovTitle').textContent = title;
  if(sub) $('#ovSub').textContent = sub;
  $('#overlay').classList.toggle('on', !!on);
}
function fechaLarga(d){
  const M=['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
  return d.getDate()+' de '+M[d.getMonth()]+' de '+d.getFullYear();
}
function masSeis(d){
  const x=new Date(d); x.setMonth(x.getMonth()+6);
  const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return String(x.getDate()).padStart(2,'0')+'-'+M[x.getMonth()]+'-'+x.getFullYear();
}
function fechaCorta(s){
  if(!s) return '—';
  const d=new Date(s); if(isNaN(d)) return '—';
  const M=['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  return d.getDate()+' '+M[d.getMonth()];
}
async function api(path, opts={}){
  const r = await fetch(BASE + path, {
    method: opts.method || 'GET',
    headers: opts.body ? {'Content-Type':'application/json'} : undefined,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch(e){}
  if(!r.ok) throw Object.assign(new Error((j && j.error) || ('HTTP '+r.status)), {payload:j, status:r.status});
  return j;
}

/* ===================== estado ===================== */
const KEY = 'pkv_sesion_v2';
const EV_MIN = 10;   // mínimo de caracteres para que la evidencia cuente; el servidor aplica el mismo
let X = null;      // extracción del levantamiento en revisión
let S = null;      // sesión en curso
let VAC = null;    // vacante cargada para la sesión
let tick = null, saveTimer = null;

function saveLocal(){ if(S && S.soloLectura) return; try{ localStorage.setItem(KEY, JSON.stringify({S, VAC})); }catch(e){} }
function loadLocal(){ try{ const r=localStorage.getItem(KEY); return r?JSON.parse(r):null; }catch(e){ return null; } }
function clearLocal(){ try{ localStorage.removeItem(KEY); }catch(e){} }

/* ===================== router ===================== */
function go(id){
  document.querySelectorAll('.screen').forEach(s => s.classList.toggle('on', s.id===id));
  const live = (id==='vLive');
  const lectura = !!(S && S.soloLectura);
  $('#sigBar').style.display = (live && !lectura) ? 'block' : 'none';
  // En modo lectura no hay cronómetro que correr: la sesión ya pasó.
  $('#clockWrap').style.display = ((live || id==='vActa') && !lectura) ? 'flex' : 'none';
  $('#btnReset').style.display = ((live || id==='vActa')) ? 'block' : 'none';
  $('#btnReset').textContent = lectura ? 'Volver a la lista' : 'Salir de la sesión';
  $('#whoTop').innerHTML = (S && (live || id==='vActa'))
    ? [`<b>${esc(S.cand)}</b>`, S.rol && esc(S.rol)].filter(Boolean).join(' · ') : '';
  window.scrollTo({top:0, behavior:'instant'});
}

/* ===================== tablero ===================== */
async function loadTablero(){
  go('vTablero');
  try{
    const [vs, ss] = await Promise.all([api('/api/vacancies'), api('/api/sessions')]);

    $('#vacCount').textContent = vs.length ? `${vs.length} vacante${vs.length>1?'s':''}` : '';
    $('#vacList').innerHTML = vs.length ? vs.map(v => `
      <button class="row" data-vac="${v.id}" type="button">
        <div class="rowmain">
          <b>${esc(v.title)}</b>
          <span>${esc(v.company_name||'sin empresa')}${v.seniority?' · '+esc(v.seniority):''}${v.city?' · '+esc(v.city):''}</span>
        </div>
        <div class="rowmeta">
          <span class="tag acc">${v.req_count} excluyente${v.req_count===1?'':'s'}</span><br>
          ${v.session_count?`${v.session_count} verificación${v.session_count>1?'es':''} · `:''}${fechaCorta(v.created_at)}
        </div>
      </button>`).join('')
      : `<div class="empty">Todavía no hay vacantes. Empieza cargando el levantamiento de un cliente nuevo.</div>`;
    $('#vacList').querySelectorAll('[data-vac]').forEach(b =>
      b.addEventListener('click', () => verVacante(+b.dataset.vac)));

    $('#sesCount').textContent = ss.length ? (ss.length>1 ? `${ss.length} sesiones` : '1 sesión') : '';
    $('#sesList').innerHTML = ss.length ? ss.map(s => {
      // Una sesión esperando transcripción no está "en curso": está esperando algo de afuera,
      // y si no se distingue en el tablero se pierde entre las demás y nadie la retoma.
      const esperando = s.status === 'esperando' && !s.transcript_at;
      const porConfirmar = s.status !== 'issued' && !!s.transcript_at;
      const semTag = esperando ? 'a'
        : s.semaforo==='verde'?'v':(s.semaforo==='amarillo'?'a':(s.semaforo==='rojo'?'r':'n'));
      const semTx = esperando ? 'ESPERA TRANSCRIPCIÓN'
        : porConfirmar ? 'POR CONFIRMAR'
        : s.semaforo ? s.semaforo.toUpperCase() : 'EN CURSO';
      return `<button class="row" data-ses="${s.id}" type="button">
        <div class="rowmain">
          <b>${esc(s.candidate)}</b>
          <span>${esc(s.vacancy_title||'sin vacante')}${s.company_name?' · '+esc(s.company_name):''} · ${esc(s.evaluator||'sin evaluador')}</span>
        </div>
        <div class="rowmeta">
          <span class="tag ${semTag}">${semTx}</span><br>
          <span class="mono">${esc(s.report_code||'')}</span> · ${fechaCorta(s.issued_at||s.started_at)}
        </div>
      </button>`;
    }).join('') : `<div class="empty">Ninguna verificación todavía.</div>`;
    $('#sesList').querySelectorAll('[data-ses]').forEach(b =>
      b.addEventListener('click', () => verSesion(+b.dataset.ses)));
  }catch(e){
    $('#vacList').innerHTML = `<div class="empty">No se pudo cargar: ${esc(e.message)}</div>`;
    $('#sesList').innerHTML = '';
  }
}

/* ===================== abrir una verificación anterior =====================
   El acta se reconstruye desde la base de datos con el mismo render que la generó,
   así que lo que se ve aquí es exactamente lo que se emitió. */
async function verSesion(id){
  if(S && S.sid && !S.fin && !S.soloLectura){
    if(!confirm('Tienes una sesión en curso sin terminar.\n\nSi abres otra verificación la pierdes de vista, aunque queda guardada en el servidor. ¿Continuar?')) return;
  }
  overlay(true, 'Abriendo la verificación…', '');
  try{
    const s = await api('/api/sessions/' + id);
    // Un documento emitido se dibuja desde lo que se congeló al emitirlo, no desde el estado
    // actual de la base: si no, un acta de hace seis meses cambiaría de contenido sola.
    const snap = s.snapshot || null;
    const fuente = snap || s;
    const reqs = (snap ? snap.ratings : (s.ratings || [])).map(r => ({
      rid: r.requirement_id, n: r.req_text, lvl: r.level, ev: r.evidence || '',
      exp: r.analisis || '', falta: r.falta || '', r: {},
    }));
    S = {
      sid: s.id, id: s.report_code,
      cand: (snap && snap.candidato) || s.candidate,
      rol: (snap && snap.cargo) || s.vacancy_title || '',
      cli: (snap && snap.cliente) || s.company_name || '',
      eval: (snap && snap.evaluador) || s.evaluator || '', mode: s.mode || 'B',
      kind: fuente.kind || 'sondeo', reqs,
      idc: fuente.identity || {}, sig: fuente.signals || {},
      dec: fuente.declara || {}, rec: fuente.recomendacion || {riesgos:[]},
      cv: s.cv_analisis || null, tray: fuente.trayectoria || [],
      pf: (s.vacancy_perfil || []).map(x => ({...x})),
      perfil: fuente.perfil || s.perfil || [],
      impacto: fuente.impacto || s.impacto || [],
      exp: s.experiencia || null,
      // Lo que decidió la SESIÓN manda sobre lo que diga la vacante hoy: el evaluador pudo
      // apagar el inglés para este candidato, y la vacante pudo editarse después.
      ing: (s.ingles && typeof s.ingles.requerido === 'boolean')
        ? (s.ingles.requerido
            ? {requerido:true, nivel:s.ingles.nivel_exigido || s.ingles_nivel, uso:s.ingles.uso || s.ingles_uso, cita:s.ingles_cita}
            : null)
        : (s.ingles_requerido ? {requerido:true, nivel:s.ingles_nivel, uso:s.ingles_uso, cita:s.ingles_cita} : null),
      ingNivel: (s.ingles && s.ingles.confirmado) || null,
      ingNota: (s.ingles && s.ingles.nota) || '',
      ingMin: (s.ingles && s.ingles.minuto) || '',
      snapExp: (snap && snap.experiencia) ? snap.experiencia : null,
      snapPerfil: (snap && Array.isArray(snap.perfil)) ? snap.perfil : null,
      snapImpacto: (snap && Array.isArray(snap.impacto)) ? snap.impacto : null,
      snapIngles: (snap && snap.ingles_nivel) ? {
                    confirmado: snap.ingles_nivel, nivel_exigido: snap.ingles_exigido || null,
                    nota: snap.ingles_nota || '', minuto: snap.ingles_minuto || '',
                    fuente: snap.ingles_fuente || 'evaluador_en_vivo'} : null,
      ident: snap ? {...(snap.identidad || {}), face_score: snap.face_score}
                  : {...(s.identidad || {}), didit_status: s.didit_status,
                     face_verdict: s.face_verdict, face_score: s.face_score},
      doc: (snap && snap.documento) || s.documento || null,
      formato: s.formato || null, sinSnapshot: !!(s.status === 'issued' && !snap),
      hash: s.integrity_hash || null, diditUrl: s.didit_url || null,
      fecha: (snap && snap.emitido) ? new Date(snap.emitido).getTime()
             : s.issued_at ? new Date(s.issued_at).getTime() : Date.now(),
      t0: null, tFase: null, fase: 0,
      // El momento en que quedó: si ya hay transcripción analizada, toca calificar;
      // si la entrevista terminó y no hay transcripción, está esperándola.
      tran: s.transcript_analisis || null,
      modo: s.transcript_analisis ? 'calificacion' : 'entrevista',
      esperando: s.status === 'esperando',
      fin: s.status === 'issued', soloLectura: true,
    };
    if(s.status === 'issued'){ verActa(); }
    else { verBorrador(s); }
  }catch(e){
    toast('No se pudo abrir: ' + e.message);
  }finally{ overlay(false); }
}

// Una sesión sin emitir no tiene acta que mostrar: se muestra en qué quedó y se ofrece retomarla.
function verBorrador(s){
  const cal = S.reqs.filter(r => r.lvl > 0).length;
  const nSig = Object.values(S.sig).filter(Boolean).length;
  const i = S.ident || {};
  // Tres momentos distintos, y el botón tiene que decir cuál es: la entrevista sin hacer,
  // la entrevista hecha esperando la transcripción, o la transcripción ya leída sin confirmar.
  const esperando = S.esperando && !S.tran;
  const calificando = !!S.tran;
  const etiqueta = esperando ? 'ESPERANDO TRANSCRIPCIÓN' : (calificando ? 'SIN CONFIRMAR' : 'SIN EMITIR');
  const accion = esperando ? 'Pegar la transcripción'
               : calificando ? 'Confirmar la calificación' : 'Retomar la sesión';

  $('#actaStage').innerHTML = `
    <button class="back" data-home type="button">← Todas las verificaciones</button>
    <div class="card">
      <div class="cardhd">
        <h2>${esc(S.cand)}</h2>
        <span class="tag ${esperando?'a':'n'}">${etiqueta}</span>
      </div>
      <div class="cs" style="margin-bottom:14px">${[esc(S.rol), S.cli && esc(S.cli), S.kind==='cierre'?'cierre verificado':'sondeo'].filter(Boolean).join(' · ')} · <span class="mono">${esc(S.id)}</span></div>
      <div class="res"><div class="rn">Requisitos calificados</div><span class="rl">${cal} de ${S.reqs.length}</span></div>
      <div class="res"><div class="rn">Señales observadas</div><span class="rl">${nSig}</span></div>
      ${S.kind==='cierre' ? `<div class="res"><div class="rn">Verificación de identidad</div><span class="rl">${esc(i.texto || 'sin enviar')}</span></div>` : ''}
      <p class="hint">${esperando
        ? 'La entrevista ya se hizo. Falta pegar la transcripción de la llamada: de ahí sale la evidencia que va al acta.'
        : calificando
          ? 'La transcripción ya se leyó y hay un nivel propuesto para cada requisito. Falta que los confirmes.'
          : 'Esta sesión quedó a medias. Puedes retomarla donde estaba: lo que ya registraste está guardado en el servidor, no en el navegador.'}</p>
      <div class="tools" style="margin-top:12px">
        <button data-home type="button">Volver</button>
        <button class="pri" id="btnRetomar" type="button">${accion}</button>
      </div>
    </div>`;
  $('#actaStage').querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', loadTablero));
  $('#actaStage').querySelector('#btnRetomar').addEventListener('click', () => {
    S.soloLectura = false;
    S.t0 = S.t0 || Date.now();
    S.tFase = Date.now();
    S.fase = 0;
    saveLocal(); drawSig();
    if(esperando){ pantallaTranscripcion(); return; }
    S.modo = calificando ? 'calificacion' : 'entrevista';
    render(); go('vLive');
    toast('Sesión retomada');
  });
  go('vActa');
}

/* ===================== levantamiento ===================== */
function initIntake(){
  const drop=$('#drop'), file=$('#file'), src=$('#srcText');

  const refresh = () => {
    const n = src.value.trim().length;
    $('#charc').textContent = n.toLocaleString('es-CO') + ' caracteres';
    $('#btnAnalizar').disabled = n < 200;
  };
  src.addEventListener('input', refresh);

  drop.addEventListener('click', () => file.click());
  ['dragenter','dragover'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave','drop'].forEach(ev => drop.addEventListener(ev, e => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', e => { if(e.dataTransfer.files[0]) leerArchivo(e.dataTransfer.files[0]); });
  file.addEventListener('change', e => { if(e.target.files[0]) leerArchivo(e.target.files[0]); });

  async function leerArchivo(f){
    if(f.size > 9*1024*1024) return toast('El archivo pesa más de 9 MB. Pega el texto en su lugar.');
    overlay(true, 'Leyendo el archivo…', f.name);
    try{
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej;
        r.readAsDataURL(f);
      });
      const out = await api('/api/extract-text', {method:'POST', body:{filename:f.name, dataBase64:b64}});
      src.value = out.text;
      refresh();
      drop.classList.add('has');
      $('#dropTitle').textContent = f.name;
      $('#dropSub').textContent = out.chars.toLocaleString('es-CO') + ' caracteres leídos · haz clic para cambiar el archivo';
      toast('Archivo leído');
    }catch(e){
      toast(e.message);
    }finally{ overlay(false); }
  }

  document.querySelectorAll('#srcType .seg').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('#srcType .seg').forEach(x => x.classList.toggle('sel', x===b));
  }));

  $('#btnAnalizar').addEventListener('click', analizar);
  refresh();
}

async function analizar(){
  const sourceText = $('#srcText').value.trim();
  const sourceType = document.querySelector('#srcType .seg.sel').dataset.src;
  overlay(true, 'Leyendo el levantamiento…', 'Claude está identificando los requisitos excluyentes. Esto toma entre 20 y 40 segundos.');
  const caja = $('#intakeErr');
  caja.style.display = 'none';
  try{
    const out = await api('/api/intake/analyze', {method:'POST', body:{
      sourceText, sourceType,
      companyHint: $('#hEmp').value.trim(),
      roleHint: $('#hRol').value.trim(),
      recruiter: $('#hRec').value.trim(),
    }});
    X = out;
    X._sourceText = sourceText;
    X._sourceType = sourceType;
    X._recruiter = $('#hRec').value.trim();
    if(!Array.isArray(X.excluyentes)) X.excluyentes = [];
    X.excluyentes = X.excluyentes.slice(0,5);
    renderRevision();
  }catch(e){
    // Un toast se va solo y este mensaje dice qué hacer, así que se queda en pantalla.
    // El motivo importa: que la respuesta se haya cortado por longitud y que haya llegado
    // ilegible se arreglan distinto, y antes las dos decían lo mismo.
    const motivo = e.payload && e.payload.motivo;
    const bruto = e.payload && e.payload.raw;
    // Lo que devolvió el modelo va detrás de un desplegable. Sin esto, diagnosticar por qué
    // falló un análisis obliga a entrar al registro del servidor — y quien está atascado
    // frente a la pantalla no siempre tiene ese acceso a la mano.
    caja.innerHTML = `<b>${motivo === 'truncado' ? 'El texto es demasiado largo para una sola pasada.' : 'No se pudo extraer los requisitos.'}</b>${esc(e.message)}` +
      (bruto ? `<details class="crudo"><summary>Ver lo que devolvió Claude</summary><pre>${esc(bruto)}</pre></details>` : '');
    caja.style.display = 'block';
    caja.scrollIntoView({behavior:'smooth', block:'center'});
  }finally{ overlay(false); }
}

/* ===================== revisión ===================== */
function renderRevision(){
  const emp = X.empresa || {}, vac = X.vacante || {};
  const gaps = Array.isArray(X.vacios_del_levantamiento) ? X.vacios_del_levantamiento : [];
  const des  = Array.isArray(X.deseables) ? X.deseables : [];
  const docs = Array.isArray(X.verificable_por_documento) ? X.verificable_por_documento : [];

  $('#revStage').innerHTML = `
    <button class="back" data-back type="button">← Volver al levantamiento</button>
    <h1 style="font-family:Archivo,'Helvetica Neue',Arial,sans-serif;font-size:29px;font-weight:800;letter-spacing:-.02em;margin-bottom:6px">Revisa antes de guardar</h1>
    <p class="lede" style="color:var(--ink2);margin-bottom:22px;max-width:62ch">${esc(X.resumen||'')}</p>

    <div class="card">
      <div class="fttl">Empresa y vacante</div>
      <div class="frow">
        <div class="f"><label>Empresa</label><input id="rEmp" value="${esc(emp.nombre||'')}"></div>
        <div class="f"><label>Sector</label><input id="rSec" value="${esc(emp.sector||'')}"></div>
      </div>
      <div class="frow">
        <div class="f"><label>Cargo</label><input id="rTit" value="${esc(vac.titulo||'')}"></div>
        <div class="f"><label>Seniority</label><input id="rSen" value="${esc(vac.seniority||'')}"></div>
      </div>
      <div class="frow">
        <div class="f"><label>Modalidad</label><input id="rMod" value="${esc(vac.modalidad||'')}"></div>
        <div class="f"><label>Ciudad</label><input id="rCiu" value="${esc(vac.ciudad||'')}"></div>
      </div>
      <div class="frow">
        <div class="f"><label>Salario (como se dijo)</label><input id="rSal" value="${esc(vac.salario_texto||'')}"></div>
        <div class="f"><label>Contacto del cliente</label><input id="rCon" value="${esc(emp.contacto||'')}"></div>
      </div>
      <div class="frow one">
        <div class="f"><label>Contexto del cargo</label><textarea id="rCtx">${esc(vac.contexto||'')}</textarea></div>
      </div>
    </div>

    <div class="card">
      <div class="cardhd">
        <h2>Requisitos excluyentes</h2>
        <span class="cs">Estos son los que se van a verificar. Máximo 3.</span>
      </div>
      <div id="exSobra"></div>
      <div id="exList"></div>
      <button class="back" id="btnAddEx" type="button" style="color:var(--acc);margin:8px 0 0">+ Agregar requisito a mano</button>
    </div>

    ${X.descartes_previos ? `<div class="card">
      <div class="fttl">Por qué rechazaron candidatos antes</div>
      <p style="font-size:14px;color:var(--ink2);line-height:1.55">${esc(X.descartes_previos)}</p>
      <p class="hint">Es la mejor pista de lo que de verdad importa en este proceso. Úsala al calificar.</p>
    </div>` : ''}

    ${gaps.length ? `<div class="card">
      <div class="fttl">Lo que falta preguntarle al cliente</div>
      ${gaps.map(g => `<div class="gap"><span class="qm">?</span><div><b>${esc(g.pregunta)}</b><span>${esc(g.por_que||'')}</span></div></div>`).join('')}
      <p class="hint">Resolver esto antes de la sesión hace la verificación mucho más sólida.</p>
    </div>` : ''}

    ${(des.length || docs.length) ? `<div class="card">
      ${des.length ? `<div class="fttl">Deseables — no se verifican en la sesión</div>
        <div class="sflags" style="margin-bottom:14px">${des.map(d => `<span class="sflag" style="background:var(--sunk);color:var(--ink2)">${esc(d.item||d)}</span>`).join('')}</div>` : ''}
      ${docs.length ? `<div class="fttl">Se validan con documento, no en entrevista</div>
        <div class="sflags">${docs.map(d => `<span class="sflag" style="background:var(--acc-soft);color:var(--acc-ink)">${esc(d.item||d)}</span>`).join('')}</div>` : ''}
    </div>` : ''}

    <div class="card">
      <div class="fttl">Modalidad sugerida para la sesión</div>
      <div class="modes" id="revModes">
        <button class="mode ${X.modalidad_sugerida!=='B'?'sel':''}" data-m="A" type="button">
          <b>A · Defensa de entregable</b>
          <span>Hay una prueba o caso que el candidato puede abrir en pantalla y defender.</span>
        </button>
        <button class="mode ${X.modalidad_sugerida==='B'?'sel':''}" data-m="B" type="button">
          <b>B · Sonda por excluyentes</b>
          <span>No hay entregable. Se sondea la experiencia contra los requisitos.</span>
        </button>
      </div>
      ${X.modalidad_por_que ? `<p class="hint">${esc(X.modalidad_por_que)}</p>` : ''}
    </div>

    <div class="card">
      <div class="cardhd">
        <h2>Perfil de conducta</h2>
        <span class="cs">Qué tipo de persona aguanta este cargo · máximo 3</span>
      </div>
      <p class="hint" style="margin:0 0 14px">Dos candidatos pueden cumplir los tres requisitos técnicos
      y uno fracasar. Esto es lo que los separa, y se pregunta en la entrevista igual que lo demás.
      No cuenta contra el tope de requisitos.</p>
      <div id="pfList"></div>
      <button class="back" id="btnAddPf" type="button" style="color:var(--acc);margin:8px 0 0">+ Agregar rasgo a mano</button>
    </div>

    <div class="fset">
      <div class="fttl">Inglés</div>
      <p class="hint" style="margin:0 0 12px">No se verifica preguntando si lo habla: se pasa un tramo
      de la entrevista a inglés y se mide lo que sostiene. Marca esto solo si el cargo lo necesita de verdad.</p>
      <label class="chk2"><input type="checkbox" id="rIngOn" ${(X.ingles||{}).requerido?'checked':''}>
        <span>Este cargo exige inglés</span></label>
      <div class="frow" id="rIngCampos" style="margin-top:12px">
        <div class="f"><label>Nivel que pide el cliente</label>
          <input id="rIngNiv" value="${esc((X.ingles||{}).nivel||'')}" placeholder="Conversacional para reuniones con el cliente"></div>
        <div class="f"><label>Para qué lo necesita</label>
          <input id="rIngUso" value="${esc((X.ingles||{}).uso||'')}" placeholder="Daily con el equipo en EE.UU."></div>
      </div>
      ${(X.ingles||{}).evidencia_cita ? `<p class="hint">Lo dijo así: <i>“${esc(X.ingles.evidencia_cita)}”</i></p>` : ''}
    </div>

    <button class="cta" id="btnGuardarVac">Guardar la vacante</button>
    <p class="hint">Queda en la base de datos con sus requisitos. Después seleccionas esta vacante para verificar a cada finalista.</p>
  `;

  $('#revStage').querySelector('[data-back]').addEventListener('click', () => go('vIntake'));
  $('#revStage').querySelectorAll('#revModes .mode').forEach(b => b.addEventListener('click', () => {
    X.modalidad_sugerida = b.dataset.m;
    $('#revStage').querySelectorAll('#revModes .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
  $('#btnAddEx').addEventListener('click', () => {
    if(X.excluyentes.length >= MAX_REQ) return toast('Tres es el máximo: en 30 minutos no se sondea bien nada si el tiempo se reparte entre más temas.');
    X.excluyentes.push({requisito:'', detalles_verificables:[], senales_impostor:[]});
    drawEx();
  });
  $('#btnAddPf').addEventListener('click', () => {
    if(!Array.isArray(X.perfil_conducta)) X.perfil_conducta = [];
    if(X.perfil_conducta.length >= MAX_PERFIL) return toast('Tres rasgos es el máximo: más no caben en la sesión.');
    X.perfil_conducta.push({rasgo:'', por_que:'', pregunta:'', se_ve_asi:'', no_se_ve_asi:''});
    drawPf();
  });
  $('#btnGuardarVac').addEventListener('click', guardarVacante);
  drawEx();
  drawPf();
  go('vRevision');
}

function drawEx(){
  const L = $('#exList');
  // El tope de tres se avisa, no se aplica en silencio. Un texto puede traer cuatro cosas
  // innegociables de verdad, y quien decide cuál sale es el reclutador que habló con el
  // cliente — no el modelo, y tampoco esta pantalla borrando la cuarta por su cuenta.
  const sobra = $('#exSobra');
  if(sobra){
    const n = X.excluyentes.length;
    sobra.innerHTML = n > MAX_REQ ? `<div class="aviso">
      <b>Hay ${n} requisitos y el máximo son ${MAX_REQ}.</b>
      Quita ${n-MAX_REQ} antes de guardar. Los que saques no se pierden: menciónalos como deseables
      con el cliente. En 30 minutos, tres requisitos alcanzan para escena, fricción y repregunta;
      con más, cada tema recibe una sola pregunta y ninguna repregunta.</div>` : '';
  }
  if(!X.excluyentes.length){
    L.innerHTML = `<div class="empty">No se identificó ningún requisito excluyente. Agrégalos a mano o revisa el texto que cargaste.</div>`;
    return;
  }
  L.innerHTML = X.excluyentes.map((r,i) => {
    const dets = Array.isArray(r.detalles_verificables) ? r.detalles_verificables : [];
    const sen  = Array.isArray(r.senales_impostor) ? r.senales_impostor : [];
    return `
    <div class="exq${i >= MAX_REQ ? ' sobra' : ''}">
      <div class="exqhd">
        <div class="num">${i+1}</div>
        <div class="fx"><input data-ei="${i}" data-k="requisito" value="${esc(r.requisito||'')}" placeholder="Requisito excluyente"></div>
        <button class="del" data-delex="${i}" type="button" aria-label="Quitar requisito">×</button>
      </div>
      <div class="exqbd">
        ${r.evidencia_cita ? `<div class="quote">“${esc(r.evidencia_cita)}”</div>` : ''}
        <div class="mini">Qué debe poder narrar</div>
        <div class="f"><textarea data-ei="${i}" data-k="criterio_cumple">${esc(r.criterio_cumple||'')}</textarea></div>
        ${dets.length ? `<div class="mini">Detalles verificables — los hechos duros que solo sabe quien lo hizo</div>
          <div class="dets">${dets.map(d => `<div class="det"><span class="dq">${esc(d.detalle||'')}</span><span class="da">${esc(d.respuesta_esperada||'')}</span></div>`).join('')}</div>` : ''}
        <div class="mini">Preguntas de la sesión</div>
        <div class="qs">
          <p><b>Escena:</b> ${esc(r.pregunta_escena||'—')}</p>
          <p><b>Fricción:</b> ${esc(r.pregunta_friccion||'—')}</p>
          <p><b>Cruce:</b> ${esc(r.pregunta_cruce||'—')}</p>
        </div>
        ${sen.length ? `<div class="mini">Señales de impostor en este tema</div>
          <div class="sflags">${sen.map(s => `<span class="sflag">${esc(s)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');

  L.querySelectorAll('[data-ei]').forEach(el => el.addEventListener('input', e => {
    X.excluyentes[+e.target.dataset.ei][e.target.dataset.k] = e.target.value;
  }));
  L.querySelectorAll('[data-delex]').forEach(b => b.addEventListener('click', e => {
    X.excluyentes.splice(+e.currentTarget.dataset.delex, 1); drawEx();
  }));
}

/* Los rasgos de conducta que el cargo necesita. Se editan igual que los requisitos porque
   salen del mismo sitio —lo que el cliente dijo— y se equivocan igual de fácil: el modelo
   tiende a proponer "trabajo en equipo", que no distingue a nadie. */
function drawPf(){
  const L = $('#pfList');
  if(!L) return;
  const P = Array.isArray(X.perfil_conducta) ? X.perfil_conducta : (X.perfil_conducta = []);
  if(!P.length){
    L.innerHTML = `<div class="empty">El levantamiento no identificó ningún rasgo de conducta.
      Puedes agregarlos a mano o dejarlo así: la sesión funciona igual, solo que el informe no
      dirá nada sobre cómo se comporta la persona.</div>`;
    return;
  }
  L.innerHTML = P.map((x,i) => `
    <div class="exq${i >= MAX_PERFIL ? ' sobra' : ''}">
      <div class="exqhd">
        <div class="num">${i+1}</div>
        <div class="fx"><input data-pi="${i}" data-k="rasgo" value="${esc(x.rasgo||'')}" placeholder="Tolerancia a la ambigüedad"></div>
        <button class="del" data-delpf="${i}" type="button" aria-label="Quitar rasgo">×</button>
      </div>
      <div class="exqbd">
        ${x.evidencia_cita ? `<div class="quote">“${esc(x.evidencia_cita)}”</div>` : ''}
        <div class="mini">Por qué este cargo lo necesita</div>
        <div class="f"><textarea data-pi="${i}" data-k="por_que" rows="2">${esc(x.por_que||'')}</textarea></div>
        <div class="mini">La pregunta, tal como se va a leer</div>
        <div class="f"><textarea data-pi="${i}" data-k="pregunta" rows="2" placeholder="Cuéntame de la última vez que…">${esc(x.pregunta||'')}</textarea></div>
        <div class="frow">
          <div class="f"><label>Está si…</label><input data-pi="${i}" data-k="se_ve_asi" value="${esc(x.se_ve_asi||'')}"></div>
          <div class="f"><label>No está si…</label><input data-pi="${i}" data-k="no_se_ve_asi" value="${esc(x.no_se_ve_asi||'')}"></div>
        </div>
      </div>
    </div>`).join('');
  L.querySelectorAll('[data-pi]').forEach(el => el.addEventListener('input', e => {
    P[+e.target.dataset.pi][e.target.dataset.k] = e.target.value;
  }));
  L.querySelectorAll('[data-delpf]').forEach(b => b.addEventListener('click', e => {
    P.splice(+e.currentTarget.dataset.delpf, 1); drawPf();
  }));
}

async function guardarVacante(){
  const vivos = X.excluyentes.filter(r => (r.requisito||'').trim());
  if(vivos.length > MAX_REQ){
    toast(`Quita ${vivos.length-MAX_REQ} requisito${vivos.length-MAX_REQ>1?'s':''}: el máximo son ${MAX_REQ}.`);
    return;
  }
  const body = {
    empresa: {nombre:$('#rEmp').value, sector:$('#rSec').value, contacto:$('#rCon').value},
    vacante: {
      titulo:$('#rTit').value, seniority:$('#rSen').value, modalidad:$('#rMod').value,
      ciudad:$('#rCiu').value, salario_texto:$('#rSal').value, contexto:$('#rCtx').value,
      urgencia:(X.vacante||{}).urgencia||'', moneda:(X.vacante||{}).moneda||'',
      salario_min:(X.vacante||{}).salario_min??null, salario_max:(X.vacante||{}).salario_max??null,
    },
    excluyentes: vivos,
    perfil: (X.perfil_conducta || []).filter(x => (x.rasgo||'').trim()).slice(0, MAX_PERFIL),
    ingles: {
      requerido: !!$('#rIngOn').checked,
      nivel: $('#rIngNiv').value,
      uso: $('#rIngUso').value,
      evidencia_cita: (X.ingles || {}).evidencia_cita || '',
    },
    modalidad_sugerida: X.modalidad_sugerida || 'B',
    recruiter: X._recruiter || '',
    sourceType: X._sourceType || '',
    sourceText: X._sourceText || '',
    aiRaw: X,
  };
  overlay(true, 'Guardando la vacante…', 'Empresa, cargo y requisitos quedan en la base de datos.');
  try{
    const out = await api('/api/vacancies', {method:'POST', body});
    toast('Vacante guardada');
    X = null;
    $('#srcText').value=''; $('#drop').classList.remove('has');
    $('#dropTitle').textContent='Arrastra el archivo aquí o haz clic para elegirlo';
    $('#dropSub').textContent='Transcripción de Meet (.txt, .vtt), Word (.docx), PDF o texto plano';
    await verVacante(out.id);
  }catch(e){
    toast('No se pudo guardar: ' + e.message);
  }finally{ overlay(false); }
}

/* ===================== detalle de vacante ===================== */
async function verVacante(id){
  overlay(true, 'Abriendo la vacante…', '');
  try{
    const v = await api('/api/vacancies/'+id);
    VAC = v;
    const reqs = v.requirements || [];
    $('#vacStage').innerHTML = `
      <button class="back" data-home type="button">← Todas las vacantes</button>
      <div class="hero" style="padding-bottom:16px">
        <div class="herohd">
          <h1>${esc(v.title)}</h1>
          <button class="tbtn" id="btnEditarVac" type="button">Editar vacante</button>
        </div>
        <p class="lede" style="margin-bottom:12px">${esc(v.company_name||'')}${v.seniority?' · '+esc(v.seniority):''}${v.modality?' · '+esc(v.modality):''}${v.city?' · '+esc(v.city):''}${v.salary_text?' · '+esc(v.salary_text):''}</p>
        ${v.context ? `<p style="color:var(--ink2);max-width:64ch">${esc(v.context)}</p>` : ''}
      </div>

      <div class="card">
        <div class="cardhd">
          <h2>Lo que se verifica</h2>
          <span class="cs">${reqs.length} requisito${reqs.length===1?'':'s'} excluyente${reqs.length===1?'':'s'}</span>
        </div>
        ${reqs.map((r,i) => {
          const dets = r.detalles || [];
          const sen  = r.senales || [];
          return `<div class="exq">
            <div class="exqhd"><div class="num">${i+1}</div>
              <div class="fx" style="font-family:Archivo,'Helvetica Neue',Arial,sans-serif;font-size:14.5px;font-weight:700;padding-top:5px">${esc(r.text)}</div></div>
            <div class="exqbd">
              ${r.criterio ? `<div class="mini">Qué debe poder narrar</div><p style="font-size:13.5px;color:var(--ink2);line-height:1.5">${esc(r.criterio)}</p>` : ''}
              ${dets.length ? `<div class="mini">Detalles verificables</div><div class="dets">${dets.map(d=>`<div class="det"><span class="dq">${esc(d.detalle||'')}</span><span class="da">${esc(d.respuesta_esperada||'')}</span></div>`).join('')}</div>` : ''}
              ${sen.length ? `<div class="mini">Señales de impostor</div><div class="sflags">${sen.map(s=>`<span class="sflag">${esc(s)}</span>`).join('')}</div>` : ''}
            </div>
          </div>`;
        }).join('')}
      </div>

      ${(v.perfil||[]).length ? `<div class="card">
        <div class="cardhd">
          <h2>Perfil de conducta</h2>
          <span class="cs">${v.perfil.length} rasgo${v.perfil.length===1?'':'s'} · no cuentan como requisitos</span>
        </div>
        ${v.perfil.map((x,i) => `<div class="exq">
          <div class="exqhd"><div class="num">${i+1}</div>
            <div class="fx" style="font-family:Archivo,'Helvetica Neue',Arial,sans-serif;font-size:14.5px;font-weight:700;padding-top:5px">${esc(x.rasgo||'')}</div></div>
          <div class="exqbd">
            ${x.por_que ? `<p style="font-size:13.5px;color:var(--ink2);line-height:1.5">${esc(x.por_que)}</p>` : ''}
            ${x.pregunta ? `<div class="mini">La pregunta</div><div class="qs"><p>“${esc(x.pregunta)}”</p></div>` : ''}
          </div>
        </div>`).join('')}
      </div>` : ''}

      <button class="cta" id="btnNuevaSesion">Verificar a un candidato</button>
      <p class="hint">Se abre una sesión guiada de 30 minutos con estos requisitos ya cargados.</p>
    `;
    $('#vacStage').querySelector('[data-home]').addEventListener('click', loadTablero);
    $('#btnNuevaSesion').addEventListener('click', () => setupSesion(v));
    $('#btnEditarVac').addEventListener('click', () => editarVacante(v));
    go('vVacante');
  }catch(e){
    toast('No se pudo abrir: ' + e.message);
    loadTablero();
  }finally{ overlay(false); }
}


/* ===================== editar una vacante =====================
   Recrear una vacante no era alternativa: las sesiones apuntan a vacancy_id, así que
   borrarla deja huérfanas las verificaciones ya hechas, y además tira un análisis de la
   transcripción que costó tiempo y tokens. Lo que se corrige aquí rige de aquí en adelante;
   las actas ya emitidas están congeladas en su snapshot y no se mueven. */
let EDIT = null;

function editarVacante(v){
  EDIT = {
    id: v.id,
    campos: {
      title: v.title || '', company_name: v.company_name || '', seniority: v.seniority || '',
      modality: v.modality || '', city: v.city || '', salary_text: v.salary_text || '',
      recruiter: v.recruiter || '', context: v.context || '',
    },
    // El inglés vive en la vacante, no en el requisito, y hasta ahora solo se podía definir
    // en el levantamiento. Si el cliente lo pide después —o resulta que no lo necesitaba—
    // había que rehacer la vacante entera.
    ing: {
      requerido: !!v.ingles_requerido,
      nivel: v.ingles_nivel || '',
      uso: v.ingles_uso || '',
      cita: v.ingles_cita || '',
    },
    reqs: (v.requirements || []).map(r => ({
      id: r.id, text: r.text || '', criterio: r.criterio || '',
      q_escena: r.q_escena || '', q_friccion: r.q_friccion || '', q_cruce: r.q_cruce || '',
      detalles: Array.isArray(r.detalles) ? r.detalles.map(d => ({...d})) : [],
      senales: Array.isArray(r.senales) ? r.senales.slice() : [],
      abierto: false,
    })),
    perfil: (v.perfil || []).map(x => ({...x})),
    sesiones: v.session_count || 0,
    emitidas: v.issued_count || 0,
  };
  pintarEdicion();
  go('vEditar');
}

function pintarEdicion(){
  const e = EDIT, c = e.campos;
  const campo = (k, etq, ph) =>
    `<div class="f"><label>${etq}</label><input data-c="${k}" value="${esc(c[k])}" placeholder="${esc(ph||'')}"></div>`;

  $('#editStage').innerHTML = `
    <button class="back" data-volver type="button">← Volver a la vacante</button>
    <div class="setup" style="max-width:820px">
      <h1>Editar la vacante</h1>
      <p class="lede">Corrige lo que haga falta sin perder el historial. Las verificaciones que ya
      emitiste quedan como están: cada acta guarda adentro el texto de sus requisitos.</p>

      ${e.emitidas ? `<div class="aviso">
        <b>Esta vacante ya tiene ${e.emitidas} informe${e.emitidas>1?'s':''} emitido${e.emitidas>1?'s':''}.</b>
        Lo que cambies aquí aplica a las verificaciones de aquí en adelante. Los informes ya
        entregados no cambian — se congelaron al emitirse.
      </div>` : ''}

      <div class="fset">
        <div class="fttl">El cargo</div>
        <div class="frow">${campo('title','Título del cargo')}${campo('company_name','Empresa')}</div>
        <div class="frow">${campo('seniority','Seniority','Senior, semi-senior…')}${campo('modality','Modalidad','Remoto, híbrido…')}</div>
        <div class="frow">${campo('city','Ciudad')}${campo('salary_text','Salario','Como se lo dijiste al cliente')}</div>
        <div class="frow one">${campo('recruiter','Reclutador a cargo')}</div>
        <div class="f"><label>Contexto</label>
          <textarea data-c="context" rows="3" placeholder="Por qué existe el cargo, con qué equipo trabaja, qué lo hace difícil">${esc(c.context)}</textarea></div>
      </div>

      <div class="fset">
        <div class="fttl">Lo que se verifica · ${e.reqs.length} de ${MAX_REQ} requisito${MAX_REQ===1?'':'s'}</div>
        <p class="hint" style="margin:0 0 12px">Estos son los que se miden en la entrevista y los que
        aparecen en el informe. Cámbiales el orden con las flechas — el primero es el que más
        tiempo recibe en la sesión.</p>
        ${e.reqs.length > MAX_REQ ? `<div class="aviso">
          <b>Hay ${e.reqs.length} requisitos y el máximo son ${MAX_REQ}.</b>
          Quita ${e.reqs.length-MAX_REQ} para poder guardar.</div>` : ''}
        <div id="reqEdit">${e.reqs.map((r,i) => filaRequisito(r,i,e.reqs.length)).join('')}</div>
        ${e.reqs.length >= MAX_REQ ? `<p class="hint" style="margin-top:12px">Ya están los ${MAX_REQ}.
          Para cambiar uno, edítalo o quítalo primero.</p>`
        : `<button class="tbtn" id="btnAddReq" type="button" style="margin-top:12px">+ Agregar requisito</button>`}
      </div>

      <div class="fset">
        <div class="fttl">Perfil de conducta · ${e.perfil.length} de ${MAX_PERFIL}</div>
        <p class="hint" style="margin:0 0 12px">Los rasgos que este cargo necesita más allá de lo
        técnico. Se preguntan en la entrevista y salen en el informe del cliente.</p>
        <div id="pfEdit">${e.perfil.map((x,i) => filaRasgo(x,i)).join('')}</div>
        ${e.perfil.length >= MAX_PERFIL ? '' :
          `<button class="tbtn" id="btnAddPf2" type="button" style="margin-top:12px">+ Agregar rasgo</button>`}
      </div>

      <div class="fset">
        <div class="fttl">Inglés</div>
        <p class="hint" style="margin:0 0 12px">No cuenta contra los ${MAX_REQ} requisitos, porque no se
        verifica preguntando: se pasa un tramo de la entrevista a inglés y se mide lo que sostiene.</p>
        <label class="chk2"><input type="checkbox" id="edIngOn" ${e.ing.requerido?'checked':''}>
          <span>Este cargo exige inglés</span></label>
        <div class="frow" style="margin-top:12px">
          <div class="f"><label>Nivel que pide el cliente</label>
            <input id="edIngNiv" value="${esc(e.ing.nivel)}" placeholder="Conversacional para reuniones con el cliente"></div>
          <div class="f"><label>Para qué lo necesita</label>
            <input id="edIngUso" value="${esc(e.ing.uso)}" placeholder="Daily con el equipo en EE.UU."></div>
        </div>
        ${e.ing.cita ? `<p class="hint">Lo dijo así: <i>“${esc(e.ing.cita)}”</i></p>` : ''}
      </div>

      <div class="tools">
        <button data-volver type="button">Cancelar</button>
        <button class="pri" id="btnGuardarEdit" type="button">Guardar cambios</button>
      </div>
      <p class="hint" id="editMsg"></p>
    </div>`;

  const st = $('#editStage');
  st.querySelectorAll('[data-volver]').forEach(b =>
    b.addEventListener('click', () => verVacante(EDIT.id)));
  st.querySelectorAll('[data-c]').forEach(el =>
    el.addEventListener('input', () => { EDIT.campos[el.dataset.c] = el.value; }));
  const bAdd = st.querySelector('#btnAddReq');
  if(bAdd) bAdd.addEventListener('click', () => {
    if(EDIT.reqs.length >= MAX_REQ){ toast(`Tres es el máximo para una sesión de 30 minutos.`); return; }
    EDIT.reqs.push({ id:null, text:'', criterio:'', q_escena:'', q_friccion:'', q_cruce:'',
                     detalles:[], senales:[], abierto:true });
    pintarEdicion();
    const ult = $('#reqEdit').querySelector('.rq:last-child [data-r="text"]');
    if(ult) ult.focus();
  });
  const bAddPf = st.querySelector('#btnAddPf2');
  if(bAddPf) bAddPf.addEventListener('click', () => {
    EDIT.perfil.push({rasgo:'', por_que:'', pregunta:'', se_ve_asi:'', no_se_ve_asi:''});
    pintarEdicion();
  });
  st.querySelectorAll('[data-pf]').forEach(el => el.addEventListener('input', () => {
    EDIT.perfil[+el.dataset.i][el.dataset.pf] = el.value;
  }));
  st.querySelectorAll('[data-delpf]').forEach(b => b.addEventListener('click', () => {
    EDIT.perfil.splice(+b.dataset.delpf, 1); pintarEdicion();
  }));
  st.querySelector('#edIngOn').addEventListener('change', el => { EDIT.ing.requerido = el.target.checked; });
  st.querySelector('#edIngNiv').addEventListener('input', el => { EDIT.ing.nivel = el.target.value; });
  st.querySelector('#edIngUso').addEventListener('input', el => { EDIT.ing.uso = el.target.value; });
  st.querySelector('#btnGuardarEdit').addEventListener('click', guardarEdicion);
  montarRequisitos(st);
}

function filaRequisito(r, i, total){
  const det = r.detalles || [], sen = r.senales || [];
  return `<div class="rq" data-i="${i}">
    <div class="rqhd">
      <div class="num">${i+1}</div>
      <input class="rqt" data-r="text" data-i="${i}" value="${esc(r.text)}" placeholder="Ej: Implementación de SAP PP en producción (5+ años)">
      <div class="rqacc">
        <button class="ib" data-mv="-1" data-i="${i}" type="button" title="Subir" ${i===0?'disabled':''}>↑</button>
        <button class="ib" data-mv="1" data-i="${i}" type="button" title="Bajar" ${i===total-1?'disabled':''}>↓</button>
        <button class="ib" data-open="${i}" type="button" title="Detalle">${r.abierto?'▾':'▸'}</button>
        <button class="ib del" data-del="${i}" type="button" title="Quitar">×</button>
      </div>
    </div>
    ${r.abierto ? `<div class="rqbd">
      <div class="frow one"><div class="f"><label>Qué debe poder narrar</label>
        <textarea data-r="criterio" data-i="${i}" rows="2">${esc(r.criterio)}</textarea></div></div>
      <div class="frow">
        <div class="f"><label>Pregunta de escena</label>
          <textarea data-r="q_escena" data-i="${i}" rows="2">${esc(r.q_escena)}</textarea></div>
        <div class="f"><label>Pregunta de fricción</label>
          <textarea data-r="q_friccion" data-i="${i}" rows="2">${esc(r.q_friccion)}</textarea></div>
      </div>
      <div class="frow one"><div class="f"><label>Pregunta de cruce</label>
        <textarea data-r="q_cruce" data-i="${i}" rows="2">${esc(r.q_cruce)}</textarea></div></div>

      <div class="fttl" style="margin-top:14px">Detalles verificables</div>
      ${det.map((d,j) => `<div class="frow">
        <div class="f"><input data-d="detalle" data-i="${i}" data-j="${j}" value="${esc(d.detalle||'')}" placeholder="Qué se le pregunta"></div>
        <div class="f" style="display:flex;gap:8px;align-items:center">
          <input data-d="respuesta_esperada" data-i="${i}" data-j="${j}" value="${esc(d.respuesta_esperada||'')}" placeholder="Qué debería responder">
          <button class="ib del" data-deld="${i}-${j}" type="button" title="Quitar">×</button>
        </div>
      </div>`).join('')}
      <button class="tbtn" data-addd="${i}" type="button">+ Detalle</button>

      <div class="fttl" style="margin-top:14px">Señales de impostor</div>
      <div class="frow one"><div class="f"><label>Una por línea</label>
        <textarea data-s="senales" data-i="${i}" rows="3" placeholder="Habla en plural cuando se le pide su rol">${esc(sen.join('\n'))}</textarea></div></div>
    </div>` : ''}
  </div>`;
}

function filaRasgo(x, i){
  return `<div class="rq">
    <div class="rqhd">
      <div class="num">${i+1}</div>
      <input class="rqt" data-pf="rasgo" data-i="${i}" value="${esc(x.rasgo||'')}" placeholder="Ej: tolerancia a la ambigüedad">
      <div class="rqacc"><button class="ib del" data-delpf="${i}" type="button" title="Quitar">×</button></div>
    </div>
    <div class="rqbd">
      <div class="frow one"><div class="f"><label>Por qué este cargo lo necesita</label>
        <textarea data-pf="por_que" data-i="${i}" rows="2">${esc(x.por_que||'')}</textarea></div></div>
      <div class="frow one"><div class="f"><label>La pregunta, tal como se lee en voz alta</label>
        <textarea data-pf="pregunta" data-i="${i}" rows="2">${esc(x.pregunta||'')}</textarea></div></div>
      <div class="frow">
        <div class="f"><label>Está si…</label><input data-pf="se_ve_asi" data-i="${i}" value="${esc(x.se_ve_asi||'')}"></div>
        <div class="f"><label>No está si…</label><input data-pf="no_se_ve_asi" data-i="${i}" value="${esc(x.no_se_ve_asi||'')}"></div>
      </div>
    </div>
  </div>`;
}

function montarRequisitos(st){
  const R = EDIT.reqs;
  st.querySelectorAll('[data-r]').forEach(el => el.addEventListener('input', () => {
    R[+el.dataset.i][el.dataset.r] = el.value;
  }));
  st.querySelectorAll('[data-d]').forEach(el => el.addEventListener('input', () => {
    R[+el.dataset.i].detalles[+el.dataset.j][el.dataset.d] = el.value;
  }));
  st.querySelectorAll('[data-s]').forEach(el => el.addEventListener('input', () => {
    R[+el.dataset.i].senales = el.value.split('\n').map(x => x.trim()).filter(Boolean);
  }));
  st.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.open; R[i].abierto = !R[i].abierto; pintarEdicion();
  }));
  st.querySelectorAll('[data-mv]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.i, j = i + (+b.dataset.mv);
    if(j < 0 || j >= R.length) return;
    [R[i], R[j]] = [R[j], R[i]];
    pintarEdicion();
  }));
  st.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', () => {
    const i = +b.dataset.del;
    if(R.length === 1){ toast('La vacante necesita al menos un requisito.'); return; }
    if(!confirm(`¿Quitar "${R[i].text || 'este requisito'}"?\n\nLas verificaciones ya emitidas conservan su texto: no se tocan.`)) return;
    R.splice(i, 1); pintarEdicion();
  }));
  st.querySelectorAll('[data-addd]').forEach(b => b.addEventListener('click', () => {
    R[+b.dataset.addd].detalles.push({detalle:'', respuesta_esperada:''}); pintarEdicion();
  }));
  st.querySelectorAll('[data-deld]').forEach(b => b.addEventListener('click', () => {
    const [i, j] = b.dataset.deld.split('-').map(Number);
    R[i].detalles.splice(j, 1); pintarEdicion();
  }));
}

async function guardarEdicion(){
  const e = EDIT;
  if(!e.campos.title.trim()){ toast('El título del cargo no puede quedar vacío.'); return; }
  const vacios = e.reqs.filter(r => !r.text.trim()).length;
  if(vacios){ toast(`Hay ${vacios} requisito${vacios>1?'s':''} sin texto.`); return; }
  if(e.reqs.length > MAX_REQ){
    toast(`Quita ${e.reqs.length-MAX_REQ} requisito${e.reqs.length-MAX_REQ>1?'s':''}: el máximo son ${MAX_REQ}.`);
    return;
  }

  overlay(true, 'Guardando…', 'Actualizando la vacante y sus requisitos.');
  try{
    await api('/api/vacancies/'+e.id, {method:'PATCH', body:{
      ...e.campos,
      perfil: e.perfil.filter(x => (x.rasgo||'').trim()).slice(0, MAX_PERFIL),
      ingles_requerido: !!e.ing.requerido,
      ingles_nivel: e.ing.nivel,
      ingles_uso: e.ing.uso,
      requirements: e.reqs.map(r => ({
        id: r.id, text: r.text, criterio: r.criterio,
        q_escena: r.q_escena, q_friccion: r.q_friccion, q_cruce: r.q_cruce,
        detalles: r.detalles.filter(d => (d.detalle||'').trim()),
        senales: r.senales,
      })),
    }});
    toast('Vacante actualizada');
    await verVacante(e.id);
  }catch(err){
    toast('No se pudo guardar: ' + err.message);
  }finally{ overlay(false); }
}

/* ===================== setup de sesión ===================== */
function setupSesion(v){
  const modo = v.suggested_mode === 'A' ? 'A' : 'B';
  // El inglés viene marcado según lo que diga la vacante, pero se puede cambiar aquí:
  // el cliente puede exigirlo y este candidato traerlo validado por otra vía, o al revés.
  const vIng = { nivel: v.ingles_nivel, uso: v.ingles_uso };
  const ingPide = !!v.ingles_requerido;
  $('#setupStage').innerHTML = `
    <div class="setup">
      <button class="back" data-back type="button">← Volver a la vacante</button>
      <h1>Preparar la verificación</h1>
      <p class="lede">${esc(v.title)} · ${esc(v.company_name||'')}. Los ${(v.requirements||[]).length} requisitos excluyentes ya están cargados; solo faltan los datos de la sesión.</p>

      <div class="fset">
        <div class="fttl">Quién</div>
        <div class="frow">
          <div class="f"><label for="sCand">Nombre del candidato</label><input id="sCand" placeholder="Nombre y apellido"></div>
          <div class="f"><label for="sEval">Evaluador</label><input id="sEval" placeholder="Tu nombre"></div>
        </div>
        <div class="frow one">
          <div class="f"><label for="sMail">Correo del candidato (opcional)</label><input id="sMail" placeholder="para cruzar con el reporte de identidad"></div>
        </div>
      </div>

      <div class="fset">
        <div class="fttl">CV del candidato <span style="text-transform:none;letter-spacing:0;font-weight:400;color:var(--ink3)">— opcional, pero cambia mucho la entrevista</span></div>
        <div class="drop" id="cvDrop">
          <input type="file" id="cvFile" accept=".txt,.md,.docx,.pdf" hidden>
          <div class="dropin">
            <div class="dropic">↑</div>
            <div>
              <b id="cvTitle">Arrastra el CV aquí o haz clic para elegirlo</b>
              <span id="cvSub">Con el CV, las preguntas citan lo que el candidato escribió en vez de ser genéricas del cargo.</span>
            </div>
          </div>
        </div>
        <div class="charc" id="cvChars"></div>
      </div>

      <div class="fset">
        <div class="fttl">Etapa del proceso</div>
        <div class="modes" id="setKind">
          <button class="mode sel" data-k="sondeo" type="button">
            <b>Sondeo · primera entrevista</b>
            <span>Cámara y señales, sin pedirle ningún documento al candidato. Produce una ficha interna.</span>
          </button>
          <button class="mode" data-k="cierre" type="button">
            <b>Cierre · finalista</b>
            <span>Suma la verificación de identidad, que el candidato hace después por su cuenta. Produce el acta para el cliente.</span>
          </button>
        </div>
        <p class="hint">La identidad no se pide en la primera entrevista: ahí el candidato todavía no ha invertido nada y la petición espanta. En el cierre ya hay una oferta de por medio.</p>
      </div>

      <div class="fset">
        <div class="fttl">Modalidad</div>
        <div class="modes" id="setModes">
          <button class="mode ${modo==='A'?'sel':''}" data-m="A" type="button">
            <b>A · Defensa de entregable</b>
            <span>El candidato entregó una prueba o caso. Se defiende su propio trabajo, con 2 modificaciones en vivo.</span>
          </button>
          <button class="mode ${modo==='B'?'sel':''}" data-m="B" type="button">
            <b>B · Sonda por excluyentes</b>
            <span>No hay entregable. Se sondea la experiencia contra los requisitos innegociables.</span>
          </button>
        </div>
      </div>

      <div class="fset">
        <div class="fttl">Inglés</div>
        <div class="modes" id="setIng">
          <button class="mode ${ingPide?'sel':''}" data-i="1" type="button">
            <b>Sí · se valida en la llamada</b>
            <span>Se agrega un tramo de 4 minutos en inglés y tú marcas el nivel ahí mismo, con la rúbrica de conducta.</span>
          </button>
          <button class="mode ${ingPide?'':'sel'}" data-i="0" type="button">
            <b>No se evalúa</b>
            <span>El acta no menciona el inglés. Ni a favor ni en contra.</span>
          </button>
        </div>
        <p class="hint">${ingPide
          ? `La vacante dice que el cargo lo exige${vIng.nivel ? ` (${esc(vIng.nivel)})` : ''}. Quítalo solo si a este candidato ya se lo validaron por otra vía.`
          : 'La vacante no lo exige. Actívalo si este cargo o este cliente sí lo necesita.'}</p>
      </div>

      <button class="cta" id="btnIniciar" disabled>Iniciar la sesión</button>
      <p class="hint">Antes de darle clic: ten la grabación de Meet activa y el reporte de identidad a la mano.</p>
    </div>`;

  let mode = modo, kind = 'sondeo', ingOn = ingPide;
  $('#setupStage').querySelectorAll('#setIng .mode').forEach(b => b.addEventListener('click', () => {
    ingOn = b.dataset.i === '1';
    $('#setupStage').querySelectorAll('#setIng .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
  $('#setupStage').querySelector('[data-back]').addEventListener('click', () => verVacante(v.id));
  $('#setupStage').querySelectorAll('#setKind .mode').forEach(b => b.addEventListener('click', () => {
    kind = b.dataset.k;
    $('#setupStage').querySelectorAll('#setKind .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
  $('#setupStage').querySelectorAll('#setModes .mode').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $('#setupStage').querySelectorAll('#setModes .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
  let cvTexto = '';
  const cvDrop = $('#cvDrop'), cvFile = $('#cvFile');
  cvDrop.addEventListener('click', () => cvFile.click());
  ['dragenter','dragover'].forEach(ev => cvDrop.addEventListener(ev, e => { e.preventDefault(); cvDrop.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => cvDrop.addEventListener(ev, e => { e.preventDefault(); cvDrop.classList.remove('over'); }));
  cvDrop.addEventListener('drop', e => { if(e.dataTransfer.files[0]) leerCV(e.dataTransfer.files[0]); });
  cvFile.addEventListener('change', e => { if(e.target.files[0]) leerCV(e.target.files[0]); });

  async function leerCV(f){
    overlay(true, 'Leyendo el CV…', f.name);
    try{
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result).split(',')[1]);
        r.onerror = rej; r.readAsDataURL(f);
      });
      const out = await api('/api/extract-text', {method:'POST', body:{filename:f.name, dataBase64:b64}});
      if((out.text||'').trim().length < 150) throw new Error('El archivo tiene muy poco texto. ¿Es un PDF escaneado?');
      cvTexto = out.text;
      cvDrop.classList.add('has');
      $('#cvTitle').textContent = f.name;
      $('#cvSub').textContent = 'Listo. Se analiza contra los requisitos al iniciar la sesión.';
      $('#cvChars').textContent = out.chars.toLocaleString('es-CO') + ' caracteres';
    }catch(e){ toast(e.message); }
    finally{ overlay(false); }
  }

  const chk = () => { $('#btnIniciar').disabled = !$('#sCand').value.trim(); };
  $('#sCand').addEventListener('input', chk);
  $('#btnIniciar').addEventListener('click', async () => {
    overlay(true, 'Abriendo la sesión…', '');
    try{
      const out = await api('/api/sessions', {method:'POST', body:{
        vacancy_id: v.id, candidate: $('#sCand').value.trim(),
        candidate_email: $('#sMail').value.trim(), evaluator: $('#sEval').value.trim(), mode, kind,
      }});
      VAC = v;
      S = {
        sid: out.id, id: out.report_code, cand: $('#sCand').value.trim(), rol: v.title,
        cli: v.company_name || '', eval: $('#sEval').value.trim(), mode, kind,
        mail: $('#sMail').value.trim(), ident: null,
        reqs: (v.requirements||[]).map(r => ({rid:r.id, n:r.text, lvl:0, ev:'', r})),
        // Dos listas distintas: lo que el CARGO pide (viene de la vacante, no cambia) y lo
        // que la SESIÓN observó (lo llena la transcripción y lo confirma el evaluador).
        pf: (v.perfil || []).map(x => ({...x})),
        perfil: [], impacto: [], exp: null,
        // Lo que el cargo exige de inglés viene de la vacante: lo define el cliente.
        ing: ingOn ? {requerido:true, nivel:v.ingles_nivel, uso:v.ingles_uso, cita:v.ingles_cita} : null,
        ingNivel: null, ingNota: '', ingMin: '',
        idc:{}, sig:{}, fase:0, t0:Date.now(), tFase:Date.now(), fin:false, fecha:null, hash:null,
      };
      saveLocal();

      if(cvTexto){
        overlay(true, 'Leyendo el CV contra los requisitos…', 'Claude está preparando las preguntas de este candidato. Toma unos 20 segundos.');
        try{
          const cv = await api(`/api/sessions/${S.sid}/cv`, {method:'POST', body:{cvText: cvTexto}});
          S.cv = cv.analisis || null;
          S.tray = cv.trayectoria || [];
          saveLocal();
        }catch(e){
          toast('El CV no se pudo analizar: ' + e.message + '. La sesión sigue igual, con las preguntas del cargo.');
        }
      }

      drawSig(); render(); go('vLive');
    }catch(e){ toast('No se pudo iniciar: ' + e.message); }
    finally{ overlay(false); }
  });
  go('vSetup');
  chk();
}

/* ===================== sesión en vivo ===================== */
// La entrevista y la calificación dejaron de ser el mismo momento, así que tampoco son la
// misma lista de fases. Durante la llamada el reclutador escucha: la pantalla es guía y nada
// más. La evidencia llega después, con la transcripción — que en Google tarda unos minutos,
// razón por la cual entremedio la sesión tiene que poder cerrarse y retomarse.
function enEntrevista(){ return S.modo !== 'calificacion'; }

function fases(){
  if(enEntrevista()){
    const f = [{k:'id', t:'Apertura', min:4}];
    S.reqs.forEach((r,i) => f.push({k:'guia', i, t:r.n || ('Requisito '+(i+1)), min:6}));
    if(S.ing && S.ing.requerido) f.push({k:'ing', t:'Inglés', min:4});
    if((S.pf || []).length) f.push({k:'perfil', t:'Conducta', min:4});
    // La trayectoria aparece en los dos momentos, y no es lo mismo: durante la llamada son
    // las preguntas que hay que hacer sobre cada tramo; después, marcar si los sostuvo.
    if((S.tray || []).length) f.push({k:'tray', t:'Trayectoria', min:4});
    f.push({k:'fin', t:'Fin de la entrevista', min:2});
    return f;
  }
  const f = [];
  S.reqs.forEach((r,i) => f.push({k:'req', i, t:r.n || ('Requisito '+(i+1)), min:2}));
  if(S.ing && S.ing.requerido) f.push({k:'ing', t:'Inglés', min:2});
  if((S.pf || []).length) f.push({k:'perfil', t:'Conducta', min:3});
  if((S.tray || []).length) f.push({k:'tray', t:'Trayectoria', min:3});
  f.push({k:'ctx', t:'Contexto', min:3});
  f.push({k:'cierre', t:'Cierre', min:3});
  return f;
}
function drawNav(){
  const F = fases();
  $('#phaseNav').innerHTML = F.map((f,i) => {
    const done = f.k==='id' ? idChecksDe(S.kind).every(c=>S.idc[c.id])
      : f.k==='guia' ? i < S.fase
      : f.k==='req' ? S.reqs[f.i].lvl>0
      : f.k==='tray' ? (S.tray||[]).every(t => t.estado && t.estado !== 'sin_confirmar')
      : f.k==='ctx' ? !!(S.rec && S.rec.veredicto)
      : false;
    return `<button class="ph ${i===S.fase?'act':''} ${done?'done':''}" data-f="${i}" type="button"><span class="dot"></span>${esc(f.t.length>26?f.t.slice(0,26)+'…':f.t)}</button>`;
  }).join('');
  $('#phaseNav').querySelectorAll('[data-f]').forEach(b =>
    b.addEventListener('click', e => goFase(+e.currentTarget.dataset.f)));
}
function goFase(i){ S.fase=i; S.tFase=Date.now(); saveLocal(); render();
  if(fases()[i].k === 'cierre' && S.kind === 'cierre') recargarIdentidad(); }

function cuerpoSesion(){
  return {
    identity: S.idc, signals: S.sig, data: {mode:S.mode, fase:S.fase},
    // Un sondeo puede ascender a cierre cuando el candidato avanza y hay que verificar
    // su identidad. Sin mandar esto, el ascenso vivía solo en el navegador y se perdía
    // al recargar la sesión desde el tablero.
    kind: S.kind,
    declara: S.dec || {}, recomendacion: S.rec || {}, trayectoria: S.tray || null,
    perfil: S.perfil || null, impacto: S.impacto || null, experiencia: S.exp || null,
    ratings: S.reqs.map(r => ({requirement_id:r.rid, req_text:r.n, level:r.lvl||null, evidence:r.ev||'',
                               analisis:r.exp||'', falta:r.falta||''})),
    // El inglés se guarda entero en la sesión —si se evalúa, qué se marcó y de dónde salió—
    // y no se recalcula desde la vacante: la vacante puede cambiar después, y el evaluador
    // pudo apagarlo para este candidato. La sesión manda sobre la vacante.
    ingles: S.ing ? {
      requerido: true, nivel_exigido: S.ing.nivel || null, uso: S.ing.uso || null,
      confirmado: S.ingNivel || null, nota: S.ingNota || '', minuto: S.ingMin || '',
      fuente: 'evaluador_en_vivo',
    } : { requerido: false },
  };
}

function sync(){
  if(!S || !S.sid || S.soloLectura) return;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    try{ await api('/api/sessions/'+S.sid, {method:'PATCH', body: cuerpoSesion()}); }
    catch(e){ /* el navegador ya lo tiene guardado local; no interrumpimos la entrevista */ }
  }, 900);
}

// Guarda ya, sin esperar el retardo. Se llama al salir de la sesión: si el reclutador
// escribe y cierra enseguida, ese último medio segundo no se puede perder.
async function flush(){
  if(!S || !S.sid || S.soloLectura) return;
  clearTimeout(saveTimer);
  try{ await api('/api/sessions/'+S.sid, {method:'PATCH', body: cuerpoSesion()}); }catch(e){}
}

// Y si cierra la pestaña de golpe, se manda con sendBeacon, que sí sobrevive al cierre.
window.addEventListener('pagehide', () => {
  if(!S || !S.sid || S.soloLectura) return;
  try{
    navigator.sendBeacon?.(BASE + '/api/sessions/' + S.sid + '/beacon',
      new Blob([JSON.stringify(cuerpoSesion())], {type:'application/json'}));
  }catch(e){}
});
function touch(){ saveLocal(); sync(); }

/* Qué pantalla hay que repintar cuando algo cambia por debajo — subir la captura, crear
   el link de identidad, refrescar el estado del cotejo. Por defecto es la fase en vivo.
   La pantalla de espera lo cambia mientras está abierta: render() dibuja en #stage, así
   que llamarlo desde allá dejaría la pantalla que el reclutador está mirando congelada. */
let REPINTAR = () => render();

function render(){
  REPINTAR = () => render();
  // Simétrico a lo que hace pantallaTranscripcion() con #stage: si estamos dibujando la
  // fase en vivo, la sala de espera ya no está en uso y su marcado tiene que irse. Dos
  // pantallas con los mismos nombres de elemento en el documento hacen que un clic —o un
  // archivo— entre por la que está oculta.
  $('#transStage').innerHTML = '';
  drawNav();
  const F = fases(), f = F[S.fase], st = $('#stage');
  if(!f) return;

  if(f.k === 'id'){
    const cierre = S.kind === 'cierre';
    st.innerHTML = `
      <div class="card">
        <h2>Apertura</h2>
        <div class="cs" style="margin-bottom:16px">Primeros minutos · ${cierre ? 'la identidad se verifica después de la llamada, no aquí' : 'en un sondeo no se pide ninguna identificación'}</div>
        <div class="say"><div class="lb">DILO ASÍ</div><p>“Gracias por conectarte. Esta sesión queda grabada, como todas las nuestras, y voy a tomar una captura de pantalla para dejar registro de con quién hablamos. ${cierre ? 'Al final te voy a enviar un link para confirmar tu identidad — lo haces desde tu celular en un minuto, y no queda ninguna foto de tu documento con nosotros. ' : ''}¿Arrancamos?”</p></div>
        ${idChecksDe(S.kind).map(c => `<button class="chk ${S.idc[c.id]?'on':''}" data-idc="${c.id}" ${c.id==='shot'?'disabled style="opacity:.75;cursor:default"':''} type="button"><span class="box">✓</span><span class="tx">${c.t}<small>${c.d}</small></span></button>`).join('')}

        ${cajaCaptura('apertura')}
        <p class="hint">Si el candidato todavía no se acomoda en cámara, no insistas ahora:
        vuelves a tener el recuadro al final, antes de colgar.</p>
        ${cierre ? '' : `
        <p class="hint">Este es un <b>sondeo</b>: no se le pide identidad al candidato hoy. La captura
        se guarda de todos modos, para que si avanza a finalista se pueda verificar su identidad
        contra esta cara <b>sin repetir la entrevista</b>.</p>`}

        <p class="hint"><b>Si algo se sale de lo normal</b> — se niega a encender la cámara, el video se congela cada vez que responde — no confrontes. Regístralo en las señales y sigue.</p>
        <div class="nav"><button class="pri" data-next type="button">Continuar</button></div>
      </div>`;

    st.querySelectorAll('[data-idc]').forEach(b => b.addEventListener('click', e => {
      const k = e.currentTarget.dataset.idc;
      if(k === 'shot') return;              // este se marca solo al subir la captura
      S.idc[k] = !S.idc[k]; touch(); render();
    }));
    montarCaptura(st);
  }

  // --- GUÍA: lo que se ve DURANTE la llamada. Solo munición, cero campos que llenar. ---
  else if(f.k === 'guia'){
    const r = S.reqs[f.i];
    const meta = r.r || {};
    const dets = Array.isArray(meta.detalles) ? meta.detalles : [];
    const sen  = Array.isArray(meta.senales) ? meta.senales : [];
    const guion = S.mode==='A' ? DEFENSA : SONDA;
    const qs = preguntasDe(r);

    st.innerHTML = `
      <div class="card">
        <h2>${esc(r.n)}</h2>
        <div class="cs" style="margin-bottom:16px">Requisito ${f.i+1} de ${S.reqs.length} · unos 6 minutos · ${S.mode==='A'?'defensa del entregable':'sonda por experiencia'}</div>
        ${meta.criterio ? `<div class="say"><div class="lb">QUÉ BUSCAS OÍR</div><p style="font-style:normal">${esc(meta.criterio)}</p></div>` : ''}

        <div class="preg">
          ${qs.map((x,qi) => `<div class="pq">
            <div class="pn">${qi+1}</div>
            <div class="pb">
              <div class="pt">${esc(x.t)}${x.cv?`<span class="pcv">del CV${x.donde?' · '+esc(x.donde):''}</span>`:''}</div>
              <p class="px">“${esc(x.q)}”</p>
            </div>
          </div>`).join('')}
          ${qs.length ? '' : '<p class="hint" style="margin:0">Esta vacante no trae preguntas cargadas. Sondea con el criterio de arriba: pide una escena concreta, la fricción, y contrasta un detalle.</p>'}
        </div>
        <p class="hint">Léelas tal cual. Repregunta con lo que él conteste — <b>no tienes que construir nada en vivo</b>:
        la evidencia sale de la transcripción cuando cuelgues.</p>

        <details class="guionbox">
          <summary>Cómo conducir el tramo, si lo necesitas</summary>
          <div class="steps">
            ${guion.map((g,gi) => `<div class="step"><div class="sn">${gi+1}</div><div class="sb">
              <div class="st">${g.t}</div><div class="sd">${g.d.replace('[requisito]', esc(r.n))}</div>
            </div></div>`).join('')}
          </div>
        </details>

        ${cvDeRequisito(r.n)}
        ${dets.length ? `<div class="detbox"><div class="dt">Detalles verificables — compara contra lo que responde</div>
          <div class="dets">${dets.map(d => `<div class="det"><span class="dq">${esc(d.detalle||'')}</span><span class="da">${esc(d.respuesta_esperada||'')}</span></div>`).join('')}</div></div>` : ''}
        ${sen.length ? `<div class="detbox"><div class="dt">Señales de impostor en este tema</div>
          <div class="sflags">${sen.map(s => `<span class="sflag">${esc(s)}</span>`).join('')}</div></div>` : ''}

        <p class="hint"><b>No tomes notas de evidencia.</b> Lo único que conviene marcar en el
        momento son las señales de abajo: son cosas que no quedan en el texto de la transcripción.</p>

        <div class="nav">
          <button data-prev type="button">Atrás</button>
          <button class="pri" data-next type="button">${f.i===S.reqs.length-1?'Terminar la entrevista':'Siguiente requisito'}</button>
        </div>
      </div>`;
  }

  // --- CONDUCTA, durante la llamada: una pregunta por rasgo, leída tal cual. ---
  else if(f.k === 'perfil' && enEntrevista()){
    const P = S.pf || [];
    st.innerHTML = `
      <div class="card">
        <h2>Perfil de conducta</h2>
        <div class="cs" style="margin-bottom:16px">${P.length} rasgo${P.length===1?'':'s'} · unos 4 minutos · lo que separa a dos candidatos que cumplen lo mismo</div>

        <div class="preg">
          ${P.map((x,qi) => `<div class="pq">
            <div class="pn">${qi+1}</div>
            <div class="pb">
              <div class="pt">${esc(x.rasgo||'Rasgo '+(qi+1))}</div>
              <p class="px">“${esc(x.pregunta||'')}”</p>
              ${(x.se_ve_asi||x.no_se_ve_asi) ? `<div class="pfver">
                ${x.se_ve_asi ? `<span class="pfsi">Está si: ${esc(x.se_ve_asi)}</span>` : ''}
                ${x.no_se_ve_asi ? `<span class="pfno">No está si: ${esc(x.no_se_ve_asi)}</span>` : ''}
              </div>` : ''}
            </div>
          </div>`).join('')}
        </div>
        <p class="hint">Pide una <b>situación pasada</b>, no una opinión sobre sí mismo. Si contesta
        con lo que haría en general, devuélvelo al caso: “dame la última vez que te pasó”.
        Tampoco tomes notas: la lectura de esto sale de la transcripción, igual que la de los requisitos.</p>

        <div class="nav">
          <button data-prev type="button">Atrás</button>
          <button class="pri" data-next type="button">Continuar</button>
        </div>
      </div>`;
  }

  // --- CONDUCTA, en la calificación: confirmar o corregir lo que leyó la transcripción. ---
  else if(f.k === 'perfil'){
    const P = S.pf || [];
    // Si la transcripción no dejó nada, se arma la lista vacía para poder marcarla a mano.
    if(!(S.perfil||[]).length){
      S.perfil = P.map(x => ({rasgo:x.rasgo, presente:null, observado:'', cita:''}));
    }
    const EST = [[true,'ok','SE EVIDENCIÓ'],[false,'no','NO SE EVIDENCIÓ'],[null,'nv','SIN EVIDENCIA']];
    st.innerHTML = `
      <div class="card">
        <h2>Perfil de conducta</h2>
        <div class="cs" style="margin-bottom:16px">Confirma lo que salió de la transcripción · esto va al informe del cliente</div>
        ${S.perfil.map((o,i) => {
          const pide = P.find(x => (x.rasgo||'').trim().toLowerCase() === (o.rasgo||'').trim().toLowerCase()) || {};
          return `<div class="rq" style="margin-bottom:14px">
            <div class="trayhd" style="padding:0 0 8px">
              <div><b>${esc(o.rasgo||'')}</b>${pide.por_que?`<span>${esc(pide.por_que)}</span>`:''}</div>
              <div class="trayb">
                ${EST.map(([v,c,tx]) => `<button class="tb ${o.presente===v?'sel '+c:''}" data-pfv="${i}" data-v="${v===null?'null':v}" type="button">${tx}</button>`).join('')}
              </div>
            </div>
            ${o.cita ? `<div class="cita" style="margin:6px 0 8px"><div class="dt">Lo que dijo</div><blockquote>${esc(o.cita)}</blockquote></div>` : ''}
            <div class="f"><label>Qué se observó — esto se imprime</label>
              <textarea data-pfo="${i}" rows="3" placeholder="Cómo se comportó respecto a este rasgo durante la conversación.">${esc(o.observado||'')}</textarea></div>
          </div>`;
        }).join('')}
        <p class="hint"><b>Sin evidencia</b> es una respuesta legítima y sale así en el informe, sin
        explicación ni excusa. Rellenarlo con una impresión general es exactamente lo que este
        documento promete no hacer.</p>

        ${(S.impacto||[]).length ? `
        <div class="fttl" style="margin-top:20px">Lo que demostró · tarjetas del informe</div>
        <p class="hint" style="margin:0 0 10px">Salieron de la conversación, no del CV. Corrige o
        borra las que no se sostengan: cada una se imprime como un hecho.</p>
        <div id="impList">${S.impacto.map((x,i) => `<div class="rq" style="margin-bottom:10px">
          <div class="rqhd">
            <div class="num">${i+1}</div>
            <input class="rqt" data-imp="titulo" data-i="${i}" value="${esc(x.titulo||'')}" placeholder="Power BI avanzado">
            <div class="rqacc"><button class="ib del" data-delimp="${i}" type="button" title="Quitar">×</button></div>
          </div>
          <div class="rqbd">
            <div class="frow one"><div class="f"><label>Etiqueta</label>
              <input data-imp="sub" data-i="${i}" value="${esc(x.sub||'')}" placeholder="Análisis de datos"></div></div>
            <div class="frow one"><div class="f"><label>Una frase, anclada en lo que contó</label>
              <textarea data-imp="texto" data-i="${i}" rows="2">${esc(x.texto||'')}</textarea></div></div>
          </div>
        </div>`).join('')}</div>` : ''}

        <div class="nav">
          <button data-prev type="button">Atrás</button>
          <button class="pri" data-next type="button">Continuar</button>
        </div>
      </div>`;

    st.querySelectorAll('[data-pfv]').forEach(b => b.addEventListener('click', e => {
      const i = +e.currentTarget.dataset.pfv, v = e.currentTarget.dataset.v;
      S.perfil[i].presente = v === 'null' ? null : v === 'true';
      touch(); render();
    }));
    st.querySelectorAll('[data-pfo]').forEach(el => el.addEventListener('input', () => {
      S.perfil[+el.dataset.pfo].observado = el.value; touch();
    }));
    st.querySelectorAll('[data-imp]').forEach(el => el.addEventListener('input', () => {
      S.impacto[+el.dataset.i][el.dataset.imp] = el.value; touch();
    }));
    st.querySelectorAll('[data-delimp]').forEach(b => b.addEventListener('click', () => {
      S.impacto.splice(+b.dataset.delimp, 1); touch(); render();
    }));
  }

  // --- CALIFICACIÓN: después, con la transcripción ya analizada. ---
  else if(f.k === 'req'){
    const r = S.reqs[f.i];
    const meta = r.r || {};
    const dets = Array.isArray(meta.detalles) ? meta.detalles : [];
    const prop = propuestaDe(f.i);

    st.innerHTML = `
      <div class="card">
        <h2>${esc(r.n)}</h2>
        <div class="cs" style="margin-bottom:16px">Requisito ${f.i+1} de ${S.reqs.length} · confirma o corrige lo que salió de la transcripción</div>

        ${prop && prop.cubierto === false ? `<div class="aviso malo">
          <b>Este requisito no se tocó en la conversación.</b>
          La transcripción no tiene nada sobre esto, así que no hay nada que calificar todavía.
          Si crees que sí se habló, revisa que la transcripción esté completa. Si de verdad no se
          preguntó, queda sin medir — y eso es un dato, no un hueco que rellenar.
        </div>` : ''}

        ${prop && prop.evidencia ? `<div class="cita">
          <div class="dt">Lo que dijo el candidato — cita de la transcripción</div>
          <blockquote>${esc(prop.evidencia)}</blockquote>
          ${prop.por_que_ese_nivel ? `<p class="pq">Por qué el nivel propuesto: ${esc(prop.por_que_ese_nivel)}</p>` : ''}
          ${prop.nota ? `<p class="pq av">${esc(prop.nota)}</p>` : ''}
        </div>` : ''}

        ${prop && (prop.detalles||[]).length ? `<div class="detbox"><div class="dt">Detalles verificables — lo que contestó</div>
          <div class="dets">${prop.detalles.map(d => `<div class="det ${d.correcto?'ok':'no'}">
            <span class="dq">${esc(d.detalle||'')}</span>
            <span class="da">${esc(d.respondio||'no respondió')} ${d.correcto?'✓':'✗'}</span></div>`).join('')}</div></div>`
          : (dets.length ? `<div class="detbox"><div class="dt">Detalles verificables que se iban a preguntar</div>
          <div class="dets">${dets.map(d => `<div class="det"><span class="dq">${esc(d.detalle||'')}</span><span class="da">${esc(d.respuesta_esperada||'')}</span></div>`).join('')}</div></div>` : '')}

        ${prop && (prop.senales||[]).length ? `<div class="detbox"><div class="dt">Señales observadas en este tema</div>
          <div class="sflags">${prop.senales.map(x => `<span class="sflag">${esc(x)}</span>`).join('')}</div></div>` : ''}

        <div class="lvlttl">Calificación anclada — ${prop && prop.nivel ? 'la transcripción propone ' + prop.nivel + '; confirma o corrige' : 'marca el nivel que corresponde'}</div>
        <div class="lvls">
          ${[1,2,3,4,5].map(v => `<button class="lv ${r.lvl===v?'sel':''}" data-lv="${v}" data-v="${v}" type="button"><div class="n">${v}</div><div class="t">${LVLTXT[v]}</div></button>`).join('')}
        </div>
        <div class="anchor" id="anchorBox">${r.lvl?ANCHORS[r.lvl]:'Pasa el cursor sobre un nivel para ver su ancla, o marca el que corresponda.'}</div>
        <textarea class="notes" data-notes placeholder="La escena que contó, la fricción que narró, los detalles que cuadraron o no. Normalmente queda como rastro interno; si la sesión se califica sin transcripción, esto es lo que lee el cliente.">${esc(r.ev||'')}</textarea>
        <div class="evnote" id="evNote"></div>
        <div class="nav">
          <button data-prev type="button">Atrás</button>
          <button class="pri" data-next type="button">${f.i===S.reqs.length-1?'Ir al cierre':'Siguiente requisito'}</button>
        </div>
      </div>`;

    const reset = () => $('#anchorBox').innerHTML = r.lvl?ANCHORS[r.lvl]:'Pasa el cursor sobre un nivel para ver su ancla, o marca el que corresponda.';
    st.querySelectorAll('[data-lv]').forEach(b => {
      b.addEventListener('click', e => { r.lvl = +e.currentTarget.dataset.lv; touch(); render(); });
      b.addEventListener('mouseenter', e => { $('#anchorBox').innerHTML = ANCHORS[+e.currentTarget.dataset.lv]; });
      b.addEventListener('mouseleave', reset);
    });
    const evNote = () => {
      const n = (r.ev||'').trim().length;
      const el = $('#evNote');
      if(!el) return;
      el.className = 'evnote' + (n > EV_MIN ? ' ok' : (n ? ' warn' : ''));
      el.textContent = n > EV_MIN ? 'Evidencia registrada'
        : (n ? 'Muy corta — sin esto no se puede emitir el acta' : 'Sin evidencia no se puede emitir el acta');
    };
    st.querySelector('[data-notes]').addEventListener('input', e => { r.ev = e.target.value; evNote(); touch(); });
    evNote();
  }

  else if(f.k === 'tray'){
    const T = S.tray || [];
    const pts = (S.cv && S.cv.puntos_a_aclarar) || [];
    st.innerHTML = `
      <div class="card">
        <h2>Trayectoria</h2>
        <div class="cs" style="margin-bottom:16px">${enEntrevista()
          ? 'Lo que el CV declara. Pregúntale por los tramos que importan — marcarlos viene después, con la transcripción.'
          : 'Lo que el CV declara. Marca cada tramo según lo que el candidato sostuvo en la sesión.'}</div>
        ${enEntrevista()
          ? `<div class="say"><div class="lb">QUÉ PEDIR EN CADA TRAMO</div><p style="font-style:normal">Que aterrice el trabajo con escena propia: qué hacía un día normal, con quién, qué salió mal. Mencionar la empresa no es sostenerla.</p></div>`
          : `<div class="say"><div class="lb">CÓMO SE MARCA</div><p style="font-style:normal"><b>Confirmado</b> es que narró ese trabajo con escena y detalle propios, no que lo mencionó. <b>Sin sostener</b> es que no logró aterrizarlo. <b>Contradice</b> es que lo que contó no cuadra con lo que dice el CV.</p></div>`}
        ${T.map((t,i) => `
          <div class="tray">
            <div class="trayhd">
              <div>
                <b>${esc(t.cargo||'—')}</b>
                <span>${esc(t.empresa||'')}${t.periodo?' · '+esc(t.periodo):''}</span>
              </div>
              ${enEntrevista() ? '' : `<div class="trayb">
                ${[['confirmado','Confirmado','ok'],['sin_sostener','Sin sostener','par'],['contradice','Contradice','no']].map(([k,tx,c]) =>
                  `<button class="tb ${t.estado===k?'sel '+c:''}" data-tray="${i}" data-est="${k}" type="button">${tx}</button>`).join('')}
              </div>`}
            </div>
            ${t.resumen ? `<div class="aev">${esc(t.resumen)}</div>` : ''}
          </div>`).join('')}
      </div>

      ${pts.length ? `<div class="card">
        <div class="fttl">Puntos que el CV deja abiertos</div>
        ${pts.map(p => `<div class="gap"><span class="qm">?</span><div>
            <b>${esc(p.punto||'')}</b>
            ${p.evidencia ? `<span>${esc(p.evidencia)}</span>` : ''}
            ${p.pregunta ? `<div class="sq" style="margin-top:6px">“${esc(p.pregunta)}”</div>` : ''}
          </div></div>`).join('')}
        <p class="hint">Casi siempre tienen una explicación normal. La pregunta busca la explicación, no la confesión.</p>
      </div>` : ''}

      <div class="nav">
        <button data-prev type="button">Atrás</button>
        <button class="pri" data-next type="button">Continuar</button>
      </div>`;
    st.querySelectorAll('[data-tray]').forEach(b => b.addEventListener('click', e => {
      const i = +e.currentTarget.dataset.tray;
      S.tray[i].estado = e.currentTarget.dataset.est;
      touch(); render();
    }));
  }

  else if(f.k === 'ctx'){
    S.dec = S.dec || {};
    S.rec = S.rec || {riesgos:[]};
    const d = S.dec, rc = S.rec;
    st.innerHTML = `
      <div class="card">
        <h2>Lo que el candidato declara</h2>
        <div class="cs" style="margin-bottom:16px">Sus palabras, no tu medición. Va en el acta en una sección aparte, marcada como declarada.</div>
        <div class="frow">
          <div class="f"><label>Pretensión</label><input data-d="pretension" value="${esc(d.pretension||'')}" placeholder="3.500.000 COP / mes"></div>
          <div class="f"><label>Disponibilidad</label><input data-d="disponibilidad" value="${esc(d.disponibilidad||'')}" placeholder="2 semanas"></div>
        </div>
        <div class="frow">
          <div class="f"><label>Ubicación</label><input data-d="ubicacion" value="${esc(d.ubicacion||'')}" placeholder="Medellín · remoto"></div>
          <div class="f"><label>Otros procesos activos</label><input data-d="procesos" value="${esc(d.procesos||'')}" placeholder="2, ninguno en oferta"></div>
        </div>
        <div class="frow one">
          <div class="f"><label>Qué busca y por qué se movería</label><textarea data-d="motivacion" placeholder="En sus palabras: qué lo mueve, qué techo encontró donde está.">${esc(d.motivacion||'')}</textarea></div>
        </div>
        <div class="frow one">
          <div class="f"><label>No negociables — uno por línea</label><textarea data-d="nogo" placeholder="Baja autonomía en la gestión&#10;Entornos rígidos">${esc(d.nogo||'')}</textarea></div>
        </div>
      </div>

      <div class="card">
        <h2>Tu recomendación</h2>
        <div class="cs" style="margin-bottom:16px">Lo único del acta que es opinión y no medición. Va firmado por ti.</div>
        <div class="modes" id="recVer" style="grid-template-columns:repeat(3,1fr)">
          ${[['si','Recomendado','El núcleo del cargo está medido y sostenido'],
             ['reserva','Con una reserva','Cumple, pero hay algo que el cliente debe saber'],
             ['no','No recomendado','No sostiene los excluyentes del cargo']].map(([k,t,s2]) =>
            `<button class="mode ${rc.veredicto===k?'sel':''}" data-rec="${k}" type="button"><b>${t}</b><span>${s2}</span></button>`).join('')}
        </div>
        <div class="frow one" style="margin-top:12px">
          <div class="f"><label>En dos o tres frases — se imprime tal cual en el informe del cliente</label><textarea data-r="texto" placeholder="Qué demostró el candidato y con qué caso lo sostuvo. Si hay una reserva, dila mirando hacia adelante: qué conviene confirmar y cómo.">${esc(rc.texto||'')}</textarea></div>
          <p class="hint"><b>Escríbelo como si el cliente y el candidato lo fueran a leer juntos</b>,
          porque puede pasar. El sujeto es el candidato, nunca la entrevista: “conviene confirmar X con
          una prueba corta” dice lo mismo que “no alcanzamos a preguntar X”, y solo una de las dos nos
          deja bien parados.</p>
        </div>
        <div class="fttl" style="margin:16px 0 9px">Riesgos y cómo mitigarlos</div>
        <div id="riesgos"></div>
        <button class="back" id="btnAddRiesgo" type="button" style="color:var(--acc);margin-top:4px">+ Agregar riesgo</button>
      </div>

      <div class="nav">
        <button data-prev type="button">Atrás</button>
        <button class="pri" data-next type="button">Ir al cierre</button>
      </div>`;

    st.querySelectorAll('[data-d]').forEach(el => el.addEventListener('input', e => {
      S.dec[e.target.dataset.d] = e.target.value; touch();
    }));
    st.querySelectorAll('[data-r]').forEach(el => el.addEventListener('input', e => {
      S.rec[e.target.dataset.r] = e.target.value; touch();
    }));
    st.querySelectorAll('[data-rec]').forEach(b => b.addEventListener('click', e => {
      S.rec.veredicto = e.currentTarget.dataset.rec; touch(); render();
    }));
    st.querySelector('#btnAddRiesgo').addEventListener('click', () => {
      S.rec.riesgos = S.rec.riesgos || [];
      S.rec.riesgos.push({r:'', m:''}); touch(); drawRiesgos();
    });
    drawRiesgos();
  }


  // --- INGLÉS: guía durante la llamada, confirmación después. ---
  /* --- INGLÉS: el único juicio que NO sale de la transcripción ---
     Meet transcribe en un solo idioma por archivo y no cambia solo a mitad de llamada
     (la detección automática de idioma corre una vez por reunión y solo sugiere). Un
     tramo en inglés dentro de una transcripción en español sale escrito con fonética
     española: texto inservible del que un modelo igual propondría un nivel. Eso sería
     un nivel inventado dentro de un documento que promete cita literal.
     Así que aquí el evaluador marca EN VIVO, con su criterio, y el acta dice de dónde
     salió. Es evidencia más débil que el resto del acta, y se declara como tal. */
  else if(f.k === 'ing'){
    const ing = S.ing || {};
    const enVivo = enEntrevista();
    st.innerHTML = `
      <div class="card">
        <h2>Inglés</h2>
        <div class="cs" style="margin-bottom:16px">${enVivo
          ? 'Unos 4 minutos en inglés. No es un examen aparte: es el mismo tema del cargo, en el otro idioma.'
          : 'Lo que marcaste durante la llamada. Puedes corregirlo aquí.'}</div>

        <div class="say"><div class="lb">QUÉ PIDE EL CARGO</div><p style="font-style:normal">
          ${esc(ing.nivel || 'Nivel no especificado por el cliente')}${ing.uso ? ` · <b>${esc(ing.uso)}</b>` : ''}</p></div>

        ${enVivo ? `
          <div class="steps">
            ${GUION_ING.map((g,gi) => `<div class="step"><div class="sn">${gi+1}</div><div class="sb">
              <div class="st">${g.t}</div><div class="sd">${g.d}</div></div></div>`).join('')}
          </div>
          <div class="aviso">
            <b>Este es el único tramo que calificas en vivo.</b>
            La transcripción de Meet queda en el idioma con el que arrancó y el inglés sale
            escrito con fonética española: no sirve como evidencia. Marca el nivel apenas
            termine el tramo, mientras lo tienes fresco.
          </div>
        ` : ''}

        <div class="lvlttl">Nivel observado</div>
        <div class="lvls ing">
          ${NIVELES_ING.map(v => `<button class="lv ${S.ingNivel===v?'sel':''}" data-ing="${v}" type="button">
            <div class="n">${v}</div></button>`).join('')}
        </div>
        <div class="anchor" id="ingBox">${S.ingNivel ? esc(ANCLA_ING[S.ingNivel]) : 'Marca el nivel que corresponde a lo que se oyó.'}</div>

        <div class="fttl" style="margin-top:16px">Qué te hizo marcar ese nivel</div>
        <textarea data-ingnota rows="3" placeholder="Qué sostuvo y qué no: si buscó palabras, si se autocorrigió, si aguantó el tema técnico o se replegó a frases hechas.">${esc(S.ingNota||'')}</textarea>
        <div class="minuto">
          <label for="ingMin">Minuto de la grabación donde ocurrió</label>
          <input id="ingMin" data-ingmin value="${esc(S.ingMin||'')}" placeholder="p. ej. 18:40" inputmode="numeric">
        </div>
        <p class="hint">El minuto no es burocracia: es lo que le permite a quien revisa ir
        directo a ese tramo y comprobarlo. Sin él, tu criterio no es verificable por nadie más.</p>

        <p class="hint">Se mide por conducta, no por certificados. Un candidato que responde en
        inglés con frases que suenan escritas —sin titubeos, con vocabulario más pulido que su
        español— es una señal, no un C1.</p>

        ${!enVivo && !S.ingNivel ? `<div class="aviso malo">
          <b>No quedó marcado durante la llamada.</b>
          Puedes marcarlo ahora si lo recuerdas con precisión, o dejarlo sin marcar: el acta
          dirá que el inglés no se evaluó, que es mejor que reportar un nivel que no observaste.
        </div>` : ''}

        <div class="nav">
          <button data-prev type="button">Atrás</button>
          <button class="pri" data-next type="button">Continuar</button>
        </div>
      </div>`;

    st.querySelectorAll('[data-ing]').forEach(b => {
      b.addEventListener('click', e => { S.ingNivel = e.currentTarget.dataset.ing; touch(); render(); });
      b.addEventListener('mouseenter', e => { $('#ingBox').textContent = ANCLA_ING[e.currentTarget.dataset.ing]; });
      b.addEventListener('mouseleave', () => {
        $('#ingBox').textContent = S.ingNivel ? ANCLA_ING[S.ingNivel] : 'Marca el nivel que corresponde a lo que se oyó.';
      });
    });
    const nota = st.querySelector('[data-ingnota]');
    if(nota) nota.addEventListener('input', e => { S.ingNota = e.target.value; touch(); });
    const min = st.querySelector('[data-ingmin]');
    if(min) min.addEventListener('input', e => { S.ingMin = e.target.value; touch(); });
  }

  // --- FIN DE LA ENTREVISTA: se cuelga, y la transcripción llega después. ---
  else if(f.k === 'fin'){
    const nSig = Object.values(S.sig).filter(Boolean).length;
    const cierre = S.kind === 'cierre';
    st.innerHTML = `
      <div class="card">
        <h2>Terminaste la entrevista</h2>
        <p class="lede" style="margin-bottom:16px">Ahora despídete y cuelga. La evidencia sale de la
        transcripción, no de lo que alcanzaste a escribir.</p>

        ${!S.idc.shot ? `<div class="aviso malo">
          <b>Falta la captura del rostro, y solo se puede tomar con la llamada abierta.</b>
          Es la imagen contra la que se coteja la verificación de identidad: sin ella, Didit
          certifica a quien haya hecho el trámite, no a quien entrevistaste. Tómala
          <b>antes de colgar</b> — aquí mismo, sin salir de esta pantalla.
        </div>` : ''}
        ${cajaCaptura('fin')}

        <div class="pasos">
          <div class="paso"><div class="pn">1</div><div>
            <b>Cierra la llamada con normalidad.</b>
            <span>Agradécele el tiempo y dile cuándo tendrá noticias. Nada de esto cambia por lo que hayas visto.</span></div></div>
          ${cierre ? `<div class="paso"><div class="pn">2</div><div>
            <b>Mándale el link de verificación de identidad.</b>
            <span>Aquí abajo. Ahora, antes de colgar o apenas cuelgues: si se enfría la conversación,
            la gente no lo hace.</span></div></div>` : ''}
          <div class="paso"><div class="pn">${cierre?3:2}</div><div>
            <b>Espera la transcripción de Google.</b>
            <span>Tarda unos minutos en aparecer en el Drive de la reunión. No tienes que quedarte
            aquí: esta sesión queda guardada y la retomas cuando esté lista, hoy o mañana.</span></div></div>
        </div>

        <div class="resum">
          <div class="ri"><span>Requisitos recorridos</span><b>${S.reqs.length}</b></div>
          <div class="ri"><span>Señales marcadas</span><b>${nSig}</b></div>
          <div class="ri"><span>Duración</span><b>${mmss(Date.now()-(S.t0||Date.now()))}</b></div>
        </div>

        <div class="nav">
          <button data-prev type="button">Atrás</button>
          <button class="pri" id="btnATranscripcion" type="button">Continuar</button>
        </div>
        <button class="back" id="btnEsperarTrans" type="button" style="color:var(--acc);margin-top:10px">
          Guardar y salir — la retomo desde el tablero</button>
      </div>
      ${cierre ? bloqueIdentidad() : ''}`;

    // La verificación de identidad vive también aquí, y no por comodidad: el momento de
    // mandarla es al colgar. Tenerla solo en el cierre —que ahora llega después de la
    // transcripción, o sea horas más tarde— es tenerla cuando ya no sirve.
    montarCaptura(st);
    if(cierre){
      montarIdentidad(st);
      const bc = st.querySelector('#btnCopiarLink');
      if(bc) bc.addEventListener('click', () => {
        navigator.clipboard?.writeText(S.diditUrl).then(() => toast('Link copiado')).catch(() => toast('No se pudo copiar'));
      });
    }

    st.querySelector('#btnATranscripcion').addEventListener('click', async () => {
      await marcarFinEntrevista();
      pantallaTranscripcion();
    });
    st.querySelector('#btnEsperarTrans').addEventListener('click', async () => {
      await marcarFinEntrevista();
      toast('Guardada. La retomas desde el tablero cuando llegue la transcripción.');
      loadTablero();
    });
  }

  else {
    const nSig = Object.values(S.sig).filter(Boolean).length;
    const idOk = idChecksDe(S.kind).every(c => S.idc[c.id]);
    const allLvl = S.reqs.every(r => r.lvl>0);
    const evOk = S.reqs.every(r => (r.ev||'').trim().length > EV_MIN);
    const idn = S.ident || {};
    const idFalla = S.kind==='cierre' && (idn.face_verdict==='no_coincide' || idn.didit_status==='Declined');
    const idEspera = S.kind==='cierre' && ['pendiente','en_curso','en_revision','sin_cotejo'].includes(idn.estado||'pendiente') && idn.estado!=='rechazada';
    let sem, semT, semX;
    if(idFalla || nSig>=3){
      sem='r'; semT='ROJO';
      semX = idFalla
        ? 'El rostro verificado no corresponde al de la entrevista. No se emite nada; escala hoy mismo con la grabación.'
        : 'No se emite acta. Cierra la sesión con amabilidad, escala hoy mismo con la grabación. Tú no acusas: registras.';
    }
    else if(nSig>=1 || idn.face_verdict==='revisar'){
      sem='a'; semT='AMARILLO';
      semX = idn.face_verdict==='revisar'
        ? 'El cotejo de rostro quedó en zona dudosa — puede ser la calidad de la captura. Santiago revisa antes de emitir.'
        : 'Se emite solo después de que Santiago revise la grabación. En duda, siempre amarillo — el amarillo no cuesta nada.';
    }
    else { sem='v'; semT='VERDE'; semX='Cero señales. Pasa a revisión de cuatro ojos y se emite.'; }
    const puede = sem!=='r' && idOk && allLvl && evOk && !idEspera;

    // Qué falta exactamente, para poder decirlo en vez de solo marcar el renglón en rojo.
    const faltaId = idChecksDe(S.kind).filter(c => !S.idc[c.id]);
    const sinLvl = S.reqs.map((r,i) => ({r,i})).filter(x => !x.r.lvl);
    const sinEv  = S.reqs.map((r,i) => ({r,i})).filter(x => (x.r.ev||'').trim().length <= EV_MIN);
    // El índice de cada fase se BUSCA en la lista viva. Antes estaba escrito a mano
    // ("fase 0 = identidad, fase i+1 = requisito i"), que era cierto cuando había una
    // sola lista de fases. Con la lista partida en dos momentos —entrevista y
    // calificación— esos números apuntaban a otra cosa: "Ir y completar" mandaba al
    // requisito equivocado, y la identidad ni siquiera existe en esta lista.
    const FC = fases();
    const idxDe = pred => { const i = FC.findIndex(pred); return i < 0 ? null : i; };
    const irAReq = i => idxDe(f => f.k === 'req' && f.i === i);

    // Lo que falta de identidad se resuelve AQUÍ, no mandando al reclutador a otra
    // pantalla: la Apertura pertenece al momento de la entrevista y ya no está en esta
    // lista. Los checks se marcan y la captura se sube sin moverse del cierre.
    const panelFaltaId = () => {
      if(!faltaId.length) return '';
      const marcables = faltaId.filter(c => c.id !== 'shot');
      const faltaShot = faltaId.some(c => c.id === 'shot');
      return `<div class="gatefix">
        ${marcables.map(c => `<button class="chk" data-idc="${c.id}" type="button">
          <span class="box">✓</span><span class="tx">${esc(c.t)}<small>${esc(c.d)}</small></span></button>`).join('')}
        ${faltaShot ? cajaCaptura('cierre') : ''}
      </div>`;
    };

    const gate = (ok, titulo, detalle, irA) => `
      <div class="gate ${ok?'ok':'no'}">
        <span class="ic">${ok?'✓':'!'}</span>
        <div class="gt">${titulo}${detalle?`<small>${detalle}</small>`:''}</div>
        ${(!ok && irA!==null) ? `<button class="ir" data-ir="${irA}" type="button">Ir y completar</button>` : ''}
      </div>`;

    st.innerHTML = `
      <div class="card">
        <h2>Cierre de la sesión</h2>
        <div class="cs" style="margin-bottom:14px">Los veredictos se calculan solos desde los niveles que marcaste</div>
        ${S.reqs.map((r, i) => {
          const v = r.lvl ? (r.lvl>=4?'ok':(r.lvl===3?'par':'no')) : 'nv';
          const tx = r.lvl ? LVLTXT[r.lvl] : 'SIN CALIFICAR';
          const p = porQue(r, i);
          return `<div class="res"><div class="rn">${esc(r.n)}<small>${esc(p.texto)}</small>${
                    p.aviso ? `<small class="ajus">${esc(p.aviso)}</small>` : ''}</div>
                  <div class="rl">${r.lvl||'–'} / 5</div><span class="vd ${v}">${tx}</span></div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="sem ${sem}"><div class="lamp"></div><div><div class="st">${semT}</div><div class="sx">${semX}</div></div></div>
        ${nSig ? `<p class="hint" style="margin-top:12px"><b>Señales marcadas:</b> ${SIGNALS.filter(s=>S.sig[s.id]).map(s=>s.t).join(' · ')}</p>` : ''}
      </div>

      ${S.kind === 'cierre' ? bloqueIdentidad() : (S.idc.shot ? `
      <div class="card">
        <div class="cardhd" style="margin-bottom:10px">
          <h2 style="font-size:17px">¿Avanzó en el proceso?</h2>
          <span class="tag n">CAPTURA GUARDADA</span>
        </div>
        <p class="hint" style="margin-top:0">Este sondeo no pidió identidad, pero la captura del
        rostro quedó guardada. Si el candidato pasa a finalista, puedes verificar su identidad
        contra esa cara <b>sin volver a entrevistarlo</b>.</p>
        <div class="tools" style="margin-top:12px">
          <button class="pri" id="btnVerifDespues" type="button">Verificar identidad ahora</button>
        </div>
      </div>` : '')}

      ${(S.exp && !S.exp.verificada) ? `
      <div class="card">
        <div class="aviso">
          <b>La experiencia más reciente quedó sin verificar.</b>
          ${esc([S.exp.cargo, S.exp.empresa].filter(Boolean).join(' en ') || 'El último empleo del candidato')}${S.exp.periodo ? ' (' + esc(S.exp.periodo) + ')' : ''}
          no quedó narrado con alcance y resultado propios en la conversación.
          Si emites así, en el informe aparece como <b>no verificada</b> — que es una lectura
          válida y honesta, pero conviene que sea tu decisión y no una sorpresa.
        </div>
        <div class="tools" style="margin-top:12px">
          <button class="pri" id="btnMarcarExp" type="button">Sí quedó verificada, márcala</button>
        </div>
        <p class="hint">Márcala solo si el candidato de verdad narró ese trabajo con su propio
        alcance y su propio resultado. En 30 minutos se verifica un empleo, y es este.</p>
      </div>` : ''}

      <div class="card">
        <div class="fttl" style="margin-bottom:11px">Sin carpeta completa no hay acta</div>
        ${gate(idOk, 'Identidad verificada y grabación activa',
               faltaId.length ? `Falta${faltaId.length>1?'n':''}: ${faltaId.map(c=>esc(c.t.toLowerCase())).join(' · ')}` : '',
               null)}
        ${panelFaltaId()}
        ${gate(allLvl, 'Todos los requisitos calificados',
               sinLvl.length ? `Sin nivel: ${sinLvl.map(x=>esc(x.r.n)).join(' · ')}` : '',
               sinLvl.length ? irAReq(sinLvl[0].i) : null)}
        ${gate(evOk, 'Evidencia textual registrada en cada requisito',
               sinEv.length ? `Muy corta o vacía en: ${sinEv.map(x=>esc(x.r.n)).join(' · ')}` : '',
               sinEv.length ? irAReq(sinEv[0].i) : null)}
        ${S.kind==='cierre' ? gate(!idEspera, 'Verificación de identidad resuelta',
               idEspera ? (idn.texto || 'Enviada, sin completar') : '', null) : ''}
        ${gate(sem!=='r', 'Semáforo permite emisión',
               sem==='r' ? (idOk ? 'Tres o más señales observadas: se escala, no se emite.'
                                 : 'La identidad incompleta pone el semáforo en rojo.') : '', null)}
        <div class="tools" style="margin-top:14px">
          <button data-prev type="button">Volver</button>
          <button class="pri" id="btnActa" ${puede?'':'disabled'} type="button">Generar acta</button>
          <button id="btnJson" type="button">Copiar JSON del archivo</button>
        </div>
        <p class="hint">${puede
          ? 'El JSON va a la carpeta de la sesión en Drive, junto con la grabación y la bitácora.'
          : '<b>El acta no se puede generar todavía.</b> Arriba está señalado en rojo lo que falta; toca la línea para ir directo a esa pantalla.'}</p>
      </div>`;
    st.querySelectorAll('[data-ir]').forEach(b => b.addEventListener('click', e => goFase(+e.currentTarget.dataset.ir)));
    st.querySelectorAll('[data-idc]').forEach(b => b.addEventListener('click', e => {
      const k = e.currentTarget.dataset.idc;
      if(k === 'shot') return;             // este se marca solo al subir la imagen
      S.idc[k] = !S.idc[k]; touch(); render();
    }));
    const bvd = st.querySelector('#btnVerifDespues');
    if(bvd) bvd.addEventListener('click', () => {
      // No se repite la entrevista: la sesión pasa a exigir identidad y el cotejo se hace
      // contra la captura que ya está guardada del día de la llamada.
      S.kind = 'cierre'; S.idc = {...S.idc}; touch(); render();
      toast('Ahora puedes generar el link — se cotejará contra la captura de la entrevista');
    });
    const bme = st.querySelector('#btnMarcarExp');
    if(bme) bme.addEventListener('click', () => {
      S.exp = {...S.exp, verificada:true};
      touch(); render();
      toast('Marcada como verificada — va así al informe');
    });
    st.querySelector('#btnActa').addEventListener('click', emitirActa);
    st.querySelector('#btnJson').addEventListener('click', copiarJSON);
    if(S.kind === 'cierre'){
      montarIdentidad(st);
      montarCaptura(st);
      const bc = st.querySelector('#btnCopiarLink');
      if(bc) bc.addEventListener('click', () => {
        navigator.clipboard?.writeText(S.diditUrl).then(() => toast('Link copiado')).catch(() => toast('No se pudo copiar'));
      });
    }
  }

  st.querySelectorAll('[data-next]').forEach(b => b.addEventListener('click', () => goFase(Math.min(S.fase+1, fases().length-1))));
  st.querySelectorAll('[data-prev]').forEach(b => b.addEventListener('click', () => goFase(Math.max(S.fase-1, 0))));
  window.scrollTo({top:0, behavior:'instant'});
}

// Las preguntas que salieron del CV para este requisito. Citan lo que el candidato escribió,
// así que valen mucho más que las genéricas del cargo — y si el CV no lo menciona, eso también se dice.
/* Las preguntas que el reclutador lee EN VOZ ALTA.
   Antes la pantalla mostraba un guion genérico —"llévalo al último caso concreto"— y las
   preguntas reales quedaban escondidas debajo, solo en modo B. Eso obliga a improvisar en
   vivo, que es justo lo que no hay tiempo de hacer mientras se escucha y se observa.
   Ahora son el cuerpo de la pantalla, literales y contadas: tres.
   Si el CV trae una versión personalizada de la escena, esa REEMPLAZA a la genérica —no se
   suma— porque "en tu CV dice que en Alpina lideraste el rollout, llévame ahí" y "cuéntame
   un caso concreto" son la misma pregunta, y la primera es mejor. */
function preguntasDe(r){
  const meta = r.r || {};
  const cv = ((S.cv && S.cv.por_requisito) || []).find(x =>
    (x.requisito||'').trim().toLowerCase() === (r.n||'').trim().toLowerCase());
  const delCv = ((cv && cv.preguntas) || []).filter(Boolean);
  const qs = [];
  if(delCv[0]) qs.push({t:'Escena', q:delCv[0], cv:true, donde:(cv && cv.donde) || ''});
  else if(meta.q_escena) qs.push({t:'Escena', q:meta.q_escena});
  if(meta.q_friccion) qs.push({t:'Fricción', q:meta.q_friccion});
  else if(delCv[1]) qs.push({t:'Fricción', q:delCv[1], cv:true});
  // La tercera NO se rellena. Antes, si la vacante no traía cruce, se metía aquí la segunda
  // pregunta del CV solo para llegar a tres — y tres preguntas leídas de corrido dejan sin
  // tiempo la repregunta, que es donde se cae un impostor. El cruce entra si existe; si no,
  // el tramo son dos preguntas y seis minutos de seguimiento.
  if(meta.q_cruce) qs.push({t:'Cruce', q:meta.q_cruce});
  return qs.slice(0, 3);
}

function cvDeRequisito(nombre){
  const p = ((S.cv && S.cv.por_requisito) || []).find(x =>
    (x.requisito||'').trim().toLowerCase() === (nombre||'').trim().toLowerCase());
  if(!p) return '';
  if(p.cubierto_en_cv === false){
    return `<div class="detbox" style="border-left:3px solid var(--warn)">
      <div class="dt" style="color:var(--warn)">El CV no menciona nada de esto</div>
      <p style="font-size:13.5px;color:var(--ink2);line-height:1.5">${esc(p.nota || 'Vas a tener que sondear sin apoyo del CV: pide la escena desde cero y no des por sentado que la tiene.')}</p>
    </div>`;
  }
  // Las preguntas del CV ya salen arriba, dentro de las tres literales: repetirlas aquí
  // sería darle al reclutador dos sitios donde leer lo mismo en mitad de una llamada.
  return '';
}

/* ===================== identidad (solo en un cierre) ===================== */
const ID_TAG = {
  verificada: ['v','VERIFICADA'], dudosa: ['a','A REVISAR'], fallida: ['r','NO CORRESPONDE'],
  rechazada: ['n','NO QUISO'], abandonada: ['a','SIN TERMINAR'], en_curso: ['a','EN CURSO'],
  en_revision: ['a','EN REVISIÓN'], sin_cotejo: ['a','SIN COTEJAR'], pendiente: ['n','PENDIENTE'],
};

function bloqueIdentidad(){
  const i = S.ident || {estado:'pendiente', texto:'Todavía no se ha enviado'};
  const [tag, txt] = ID_TAG[i.estado] || ['n','PENDIENTE'];
  const enviada = !!(S.diditUrl || i.didit_status);
  const score = i.face_score != null ? Number(i.face_score).toFixed(1) : null;

  return `
    <div class="card">
      <div class="cardhd" style="margin-bottom:12px">
        <h2 style="font-size:17px">Verificación de identidad</h2>
        <span class="tag ${tag}">${txt}</span>
      </div>
      <p class="hint" style="margin-top:0">${esc(i.texto || 'El candidato la hace por su cuenta desde el celular, después de la llamada.')}${
        score ? ` · Coincidencia de rostro: <b>${score}/100</b>` : ''}</p>

      ${S.diditUrl ? `
        <div class="linkbox">
          <div class="lk">${esc(S.diditUrl)}</div>
          <button class="ir" id="btnCopiarLink" type="button">Copiar</button>
        </div>
        <p class="hint">Mándaselo por donde ya vienen hablando. Cuando lo complete, esta pantalla se actualiza sola.</p>
        <div class="qrid">
          <div class="qrbox">${huecoQr(S.diditUrl, 7, 'Verificación de identidad')}</div>
          <div class="qrtx">
            <b>O compártele la pantalla con este código.</b>
            <p>Lo escanea con el celular y hace la verificación ahí mismo, antes de colgar. El documento y la
            prueba de vida salen mejor con la cámara del celular que con la del computador, y no hay que
            esperar a que revise el correo.</p>
            <button class="qrmas" id="btnQrGrande" type="button">Ampliar para compartir pantalla</button>
          </div>
        </div>
      ` : ''}

      <div class="tools" style="margin-top:12px">
        ${!enviada ? `<button class="pri" id="btnEnviarId" type="button">Generar link de verificación</button>` : ''}
        ${enviada ? `<button id="btnRefrescarId" type="button">Revisar si ya la hizo</button>` : ''}
        ${i.estado!=='verificada' && i.estado!=='rechazada' ? `<button id="btnRechazoId" type="button">El candidato no quiso</button>` : ''}
      </div>
    </div>`;
}

// El QR a pantalla completa. Compartir pantalla en una videollamada comprime la imagen,
// y lo primero que se pierde en una compresión es justo el detalle fino de un QR.
// Grande sobrevive a eso; pequeño no.
function qrGrande(url, texto){
  // El módulo se calcula contra la pantalla, no se deja que el CSS encoja el SVG:
  // escalar por CSS devuelve módulos fraccionarios y arruina justo lo que se quería mejorar.
  let modulo = 11;
  try{
    const total = QR.matriz(url).size + 8;                       // módulos + zona tranquila
    const cabe = Math.min(innerWidth * 0.78, innerHeight * 0.62);
    modulo = Math.max(4, Math.floor(cabe / total));
  }catch(e){}
  const capa = document.createElement('div');
  capa.className = 'qrfull';
  capa.innerHTML = `<div class="qrfin">
      <div class="qrbig">${qrSvg(url, modulo, texto || 'Código QR')}</div>
      <p>${esc(texto || 'Escanea este código con tu celular.')}</p>
      <span>Toca en cualquier parte para cerrar</span>
    </div>`;
  capa.addEventListener('click', () => capa.remove());
  // Ojo con el nombre: 'esc' ya existe como escapador de HTML. Declararlo aquí lo tapaba
  // dentro de toda la función y reventaba el template de arriba antes de crear la capa.
  const alEscape = e => { if(e.key === 'Escape'){ capa.remove(); document.removeEventListener('keydown', alEscape); } };
  document.addEventListener('keydown', alEscape);
  document.body.appendChild(capa);
}

function montarIdentidad(st){
  pintarQrs(st);
  const bq = st.querySelector('#btnQrGrande');
  if(bq) bq.addEventListener('click', () => qrGrande(S.diditUrl, 'Escanea este código con tu celular para verificar tu identidad.'));
  const b1 = st.querySelector('#btnEnviarId');
  if(b1) b1.addEventListener('click', async () => {
    overlay(true, 'Creando la verificación…', 'Pidiéndole a Didit un link para este candidato.');
    try{
      const out = await api(`/api/sessions/${S.sid}/identidad`, {method:'POST', body:{
        email: S.mail || '', avisarPorCorreo: !!S.mail, publicUrl: location.origin,
      }});
      S.diditUrl = out.url;
      S.ident = {estado:'pendiente', texto:'Enviada, sin completar', didit_status: out.status};
      saveLocal(); REPINTAR();
      toast('Link listo — cópialo y mándaselo');
    }catch(e){
      toast(e.message.includes('no está configurada')
        ? 'Falta configurar DIDIT_API_KEY y DIDIT_WORKFLOW_ID en el servidor'
        : e.message);
    }finally{ overlay(false); }
  });

  const b2 = st.querySelector('#btnRefrescarId');
  if(b2) b2.addEventListener('click', async () => {
    overlay(true, 'Consultando…', '');
    try{
      const out = await api(`/api/sessions/${S.sid}/identidad/refrescar`, {method:'POST'});
      await recargarIdentidad();
      toast(out.veredicto ? `Cotejo: ${out.veredicto}` : `Estado: ${out.diditStatus || 'sin cambios'}`);
    }catch(e){ toast(e.message); }
    finally{ overlay(false); }
  });

  const b3 = st.querySelector('#btnRechazoId');
  if(b3) b3.addEventListener('click', async () => {
    if(!confirm('¿El candidato prefirió no verificar su identidad?\n\nEl acta se emite igual, pero dirá que certifica conocimiento y no identidad.')) return;
    try{
      await api(`/api/sessions/${S.sid}/identidad/rechazada`, {method:'POST', body:{}});
      S.ident = {estado:'rechazada', texto:'El candidato no quiso verificar su identidad'};
      saveLocal(); render();
    }catch(e){ toast(e.message); }
  });
}

async function recargarIdentidad(){
  if(!S || !S.sid || S.kind !== 'cierre') return;
  try{
    const s = await api('/api/sessions/' + S.sid);
    S.ident = {...(s.identidad || {}), didit_status: s.didit_status,
               face_verdict: s.face_verdict, face_score: s.face_score};
    if(s.didit_url) S.diditUrl = s.didit_url;
    saveLocal();
    // Antes solo repintaba estando en la fase de cierre; ahora también en la sala de espera.
    const enEspera = !!document.querySelector('#vTrans.on');
    if(enEspera || fases()[S.fase].k === 'cierre') REPINTAR();
  }catch(e){}
}

/* ===================== captura del rostro =====================
   El pantallazo se reduce en el navegador antes de subirlo: no hace falta mandar
   una imagen de 3 MB para comparar dos caras, y así el dato biométrico viaja lo mínimo. */
/* El recuadro de la captura aparece en tres momentos, porque TOMARLA y SUBIRLA no son
   lo mismo. Tomarla exige la llamada abierta (Apertura y Fin de la entrevista). Subirla
   se puede después, desde el archivo que quedó en el disco — y por eso también está en
   el Cierre: antes, si el reclutador la había tomado pero no subido, no tenía dónde
   ponerla, y el botón "Ir y completar" lo mandaba a un requisito. */
function cajaCaptura(momento){
  const hay = !!S.idc.shot;
  // Con la llamada abierta se TOMA; después solo se SUBE la que ya se tomó.
  const enLlamada = momento === 'apertura' || momento === 'fin';
  const titulo = hay ? 'Captura guardada'
    : enLlamada ? 'Captura el rostro del candidato'
    : 'Sube la captura del rostro';
  const sub = hay
    ? 'Se comparará con su verificación de identidad. Puedes reemplazarla si quedó borrosa.'
    : enLlamada
      ? 'Toma un pantallazo del video con la cara de frente y visible, y suéltalo aquí. También puedes pegarlo con Ctrl+V.'
      : 'Suelta aquí el pantallazo que tomaste durante la llamada, o pégalo con Ctrl+V. Si no alcanzaste a tomarlo, ya no hay manera: el acta saldrá sin cotejo de rostro y hay que decirlo.';
  return `
    <div class="shotbox ${hay?'has':''}" id="shotBox">
      <input type="file" id="shotFile" accept="image/*" hidden>
      <div class="shotin">
        <div class="shotic">${hay?'✓':'⌗'}</div>
        <div class="shottx">
          <b id="shotTitle">${titulo}</b>
          <span id="shotSub">${sub}</span>
        </div>
      </div>
    </div>
    <p class="hint">Se borra sola en cuanto se hace el cotejo de identidad: de ahí en adelante lo
    que queda guardado es el puntaje, no la imagen. Si la verificación no llega a hacerse, la
    captura se conserva mientras el proceso siga vivo y se elimina al cerrar la vacante.</p>`;
}

function montarCaptura(donde){
  // Acotado a su contenedor a propósito: el recuadro de la captura vive en varias
  // pantallas y, si dos están en el DOM a la vez, buscarlo global engancha el de la
  // pantalla equivocada — la oculta. Ya pasó entre la fase en vivo y la sala de espera.
  const raiz = donde || document;
  const box = raiz.querySelector('#shotBox'), file = raiz.querySelector('#shotFile');
  if(!box) return;

  box.addEventListener('click', () => file.click());
  file.addEventListener('change', e => { if(e.target.files[0]) subirCaptura(e.target.files[0]); });
  ['dragenter','dragover'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.add('over'); }));
  ['dragleave','drop'].forEach(ev => box.addEventListener(ev, e => { e.preventDefault(); box.classList.remove('over'); }));
  box.addEventListener('drop', e => { const f = e.dataTransfer.files[0]; if(f) subirCaptura(f); });

  // Pegar directo con Ctrl+V: es como sale de la tecla de captura de pantalla.
  if(!window._pegaCaptura){
    window._pegaCaptura = true;
    document.addEventListener('paste', e => {
      // Solo pega en el recuadro que el usuario está viendo.
      const visible = [...document.querySelectorAll('.screen.on #shotBox')][0];
      if(!visible) return;
      const it = [...(e.clipboardData?.items || [])].find(x => x.type.startsWith('image/'));
      if(it) subirCaptura(it.getAsFile());
    });
  }
}

// Reduce a 900px de lado mayor y comprime a JPEG. Suficiente para un face match.
function reducirImagen(file, max = 900, calidad = 0.85){
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => {
      // 'escala', no 'esc': esc es el escapador de HTML global y sombrearlo aquí ya
      // costó un error de TDZ una vez en qrGrande.
      const escala = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * escala);
      c.height = Math.round(img.height * escala);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(img.src);
      res(c.toDataURL('image/jpeg', calidad).split(',')[1]);
    };
    img.onerror = () => rej(new Error('no se pudo leer la imagen'));
    img.src = URL.createObjectURL(file);
  });
}

async function subirCaptura(file){
  if(!file || !file.type.startsWith('image/')) return toast('Eso no es una imagen');
  overlay(true, 'Guardando la captura…', '');
  try{
    const b64 = await reducirImagen(file);
    await api(`/api/sessions/${S.sid}/shot`, {method:'POST', body:{dataBase64:b64, mime:'image/jpeg'}});
    S.idc.shot = true; touch(); REPINTAR();
    toast('Captura guardada');
  }catch(e){
    toast('No se pudo guardar: ' + e.message);
  }finally{ overlay(false); }
}

function drawRiesgos(){
  const L = $('#riesgos');
  if(!L) return;
  const rs = (S.rec && S.rec.riesgos) || [];
  L.innerHTML = rs.length ? rs.map((x,i) => `
    <div class="reqline">
      <div class="num">!</div>
      <div class="fields">
        <div class="f"><input data-ri="${i}" data-k="r" value="${esc(x.r||'')}" placeholder="El riesgo, en una línea"></div>
        <div class="f"><input data-ri="${i}" data-k="m" value="${esc(x.m||'')}" placeholder="Cómo mitigarlo"></div>
      </div>
      <button class="del" data-delr="${i}" type="button" aria-label="Quitar">×</button>
    </div>`).join('')
    : '<p class="hint" style="margin:0">Sin riesgos anotados. Si el candidato cumple sin reservas, está bien dejarlo vacío.</p>';
  L.querySelectorAll('[data-ri]').forEach(el => el.addEventListener('input', e => {
    S.rec.riesgos[+e.target.dataset.ri][e.target.dataset.k] = e.target.value; touch();
  }));
  L.querySelectorAll('[data-delr]').forEach(b => b.addEventListener('click', e => {
    S.rec.riesgos.splice(+e.currentTarget.dataset.delr, 1); touch(); drawRiesgos();
  }));
}

/* ===================== señales ===================== */
function drawSig(){
  $('#sigChips').innerHTML = SIGNALS.map(s =>
    `<button class="sg ${S && S.sig[s.id]?'on':''}" data-sg="${s.id}" title="${esc(s.d)}" type="button">${s.t}</button>`).join('');
  $('#sigChips').querySelectorAll('[data-sg]').forEach(b => b.addEventListener('click', e => {
    const k = e.currentTarget.dataset.sg; S.sig[k] = !S.sig[k]; touch(); drawSig();
    if(fases()[S.fase].k === 'cierre') render();
  }));
  const n = S ? Object.values(S.sig).filter(Boolean).length : 0;
  const c = $('#sigCount'); c.textContent = n; c.className = 'cnt' + (n>=3?' c':(n>=1?' w':''));
}


/* ===================== la transcripción de la entrevista =====================
   El reclutador entrevista sin escribir: mientras toma notas deja de escuchar, y lo que se
   pierde es la repregunta que desarma a un impostor. La evidencia sale de la transcripción.
   Google tarda unos minutos en generarla, así que este paso vive fuera de la llamada y la
   sesión se puede cerrar y retomar sin perder nada. */

/* Por qué cumple o no cumple.
   Antes este renglón mostraba la cita textual recortada a 110 caracteres, que es la
   evidencia, no el juicio: el lector tenía que deducir solo por qué un "4/5" era CUMPLE.
   Ahora dice el razonamiento y deja la cita para el acta, que es donde importa el
   literal. El orden de las fuentes no es capricho:
     1. lo que la transcripción sostiene ("por_que_ese_nivel");
     2. si no hubo transcripción, el ancla de la rúbrica — que ES la definición del nivel;
     3. si no hay nivel, se dice que no se midió, no se rellena.
   Y si el evaluador movió el nivel respecto a lo que propuso la transcripción, se avisa:
   la justificación de arriba explica OTRO nivel, y callarlo sería presentar como
   sostenido algo que la conversación no sostiene. */
function porQue(r, i){
  const p = propuestaDe(i) || {};
  // r.exp sobrevive a recargar la sesión; la propuesta en memoria solo existe en la
  // sesión donde se analizó la transcripción.
  const propio = String(r.exp || p.por_que_ese_nivel || '').trim();
  const nivelProp = Number(r.nivelProp != null ? r.nivelProp : p.nivel) || null;

  if(!r.lvl) return { texto: p.cubierto === false
    ? 'No se tocó en la conversación: queda sin medir, ni a favor ni en contra.'
    : 'Sin calificar todavía.' };

  const texto = propio || ANCLA_CORTA[r.lvl] || '';
  const esAncla = !propio;   // no hubo explicación: lo que sale es la definición del nivel
  let aviso = '';
  if(propio && nivelProp && nivelProp !== r.lvl){
    aviso = `El evaluador ${r.lvl > nivelProp ? 'subió' : 'bajó'} el nivel de ${nivelProp} a ${r.lvl}: ` +
            `la explicación de arriba es la del ${nivelProp}. Justifícalo en la evidencia.`;
  }
  return { texto, aviso, esAncla };
}

function propuestaDe(i){
  const t = S.tran;
  if(!t || !Array.isArray(t.por_requisito)) return null;
  return t.por_requisito.find(x => Number(x.indice) === i + 1)
      || t.por_requisito[i] || null;
}

async function marcarFinEntrevista(){
  if(!S.sid) return;
  try{ await api(`/api/sessions/${S.sid}/entrevista-fin`, {method:'POST', body:{}}); }
  catch(e){ console.warn('[fin-entrevista]', e.message); }
  await flush();
}

function pantallaTranscripcion(err){
  go('vTrans');
  // Esta pantalla es la SALA DE ESPERA, no un formulario que exige la transcripción para
  // entrar. Google se demora minutos en entregarla, y en esos minutos hay algo que sí
  // corre contra el reloj: la identidad. Mientras más se enfría la conversación, menos
  // probable es que el candidato haga el trámite. Antes esos minutos no tenían dónde
  // ocurrir y el reclutador quedaba mirando un cuadro vacío.
  REPINTAR = () => pantallaTranscripcion(err);
  // La fase en vivo se vacía mientras estamos aquí. Comparten nombres de elemento
  // (#shotBox, #btnEnviarId) y tenerlas ambas en el documento hace que un clic caiga
  // en la pantalla oculta. render() la vuelve a dibujar al regresar.
  $('#stage').innerHTML = '';
  const cierre = S.kind === 'cierre';
  const idn = S.ident || {};
  const idResuelta = ['verificada','rechazada'].includes(idn.estado);
  // La captura falta en cualquier sesión; la identidad solo se cierra en un cierre.
  const faltaCaptura = !S.idc.shot;
  const faltaIdentidad = cierre && !idResuelta;
  const hayPendiente = faltaCaptura || faltaIdentidad;

  $('#transStage').innerHTML = `
    <button class="back" data-salir type="button">← Guardar y salir</button>
    <div class="setup" style="max-width:760px">
      <h1>Colgaste. Ahora hay dos cosas</h1>
      <p class="lede">La identidad se cierra <b>ya</b>, mientras la conversación está tibia.
      La transcripción llega cuando Google la entregue — y para eso no tienes que quedarte aquí.</p>

      ${hayPendiente ? `
      <div class="fset">
        <div class="fttl">1 · ${faltaIdentidad
          ? 'Ciérrale la identidad a ' + esc((S.cand || 'el candidato').split(' ')[0])
          : 'Guarda la captura de la llamada'}</div>
        <p class="hint" style="margin-top:0">${faltaIdentidad
          ? 'Esto no depende de la transcripción y sí depende del tiempo: el trámite lo hace el candidato desde su celular, y lo hace mucho menos si se lo mandas mañana.'
          : 'Aunque hoy sea un sondeo, la captura se guarda: si el candidato avanza, la identidad se verifica contra esta cara sin repetir la entrevista.'}</p>
        ${faltaCaptura ? cajaCaptura('espera') : ''}
        ${faltaIdentidad ? bloqueIdentidad() : ''}
      </div>` : ''}

      <div class="fset">
        <div class="fttl">${hayPendiente ? '2 · ' : ''}Dónde encontrar la transcripción</div>
        <p class="hint" style="margin-top:0">Google la deja en el Drive de la reunión, en la carpeta
        <b>Meet Recordings</b>, unos minutos después de colgar. Si todavía no aparece, no pasa nada:
        guarda y vuelve más tarde — esta verificación queda esperándote en el tablero.</p>
      </div>

      <div class="fset">
        <div class="fttl">Pégala aquí cuando la tengas</div>
        <div class="drop" id="transDrop">
          <div class="dropin">
            <div class="dropic">↑</div>
            <div class="droptx"><b id="transDropT">Arrastra el archivo o haz clic para elegirlo</b>
              <span id="transDropS">Transcripción de Meet (.txt, .vtt), Word (.docx), PDF o texto plano</span></div>
          </div>
        </div>
        <input type="file" id="transFile" accept=".txt,.vtt,.srt,.docx,.pdf,text/plain" style="display:none">
        <div class="osep">O PEGA EL TEXTO</div>
        <div class="f"><textarea id="transText" class="big" placeholder="Pega aquí la transcripción completa de la llamada."></textarea></div>
        <div class="cnt"><span id="transCnt">0 caracteres</span></div>
      </div>

      ${err ? `<div class="aviso malo"><b>${esc(err.titulo)}</b>${esc(err.msg)}
        ${err.raw ? `<details class="crudo"><summary>Ver lo que devolvió Claude</summary><pre>${esc(err.raw)}</pre></details>` : ''}</div>` : ''}

      <button class="cta" id="btnAnalizarTrans" disabled>Sacar la evidencia</button>
      <p class="hint">Se analiza contra los ${S.reqs.length} requisitos de esta vacante. Tarda entre 20 y 40 segundos.
      <b>La transcripción no se guarda</b>: se leen las citas que sostienen cada requisito y el texto se descarta.</p>
    </div>`;

  const ta = $('#transText'), btn = $('#btnAnalizarTrans'), cnt = $('#transCnt');
  const revisar = () => {
    const n = ta.value.trim().length;
    cnt.textContent = n.toLocaleString('es-CO') + ' caracteres';
    btn.disabled = n < 400;
  };
  ta.addEventListener('input', revisar);
  revisar();

  if(hayPendiente){
    montarCaptura($('#transStage'));
    if(faltaIdentidad) montarIdentidad($('#transStage'));
    const bc = $('#transStage').querySelector('#btnCopiarLink');
    if(bc) bc.addEventListener('click', () => {
      navigator.clipboard?.writeText(S.diditUrl).then(() => toast('Link copiado')).catch(() => toast('No se pudo copiar'));
    });
  }

  $('#transStage').querySelector('[data-salir]').addEventListener('click', async () => {
    await marcarFinEntrevista(); loadTablero();
  });

  const file = $('#transFile'), drop = $('#transDrop');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
  drop.addEventListener('dragleave', () => drop.classList.remove('over'));
  drop.addEventListener('drop', e => {
    e.preventDefault(); drop.classList.remove('over');
    if(e.dataTransfer.files && e.dataTransfer.files[0]) leerArchivoTrans(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', e => { if(e.target.files[0]) leerArchivoTrans(e.target.files[0]); });

  btn.addEventListener('click', analizarTranscripcion);
}

async function leerArchivoTrans(f){
  overlay(true, 'Leyendo el archivo…', f.name);
  try{
    const b64 = await new Promise((ok, no) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result).split(',')[1]);
      r.onerror = () => no(new Error('no se pudo leer el archivo'));
      r.readAsDataURL(f);
    });
    // El campo se llama `filename` — mandarlo como `name` dejaba al servidor sin
    // extensión y un .docx respondía "No sé leer archivos .".
    const out = await api('/api/extract-text', {method:'POST', body:{filename:f.name, dataBase64:b64}});
    $('#transText').value = out.text || '';
    $('#transText').dispatchEvent(new Event('input'));
    $('#transDropT').textContent = f.name;
    $('#transDropS').textContent = (out.chars||0).toLocaleString('es-CO') + ' caracteres leídos';
    $('#transDrop').classList.add('has');
  }catch(e){
    toast('No se pudo leer: ' + e.message);
  }finally{ overlay(false); }
}

async function analizarTranscripcion(){
  const texto = $('#transText').value.trim();
  overlay(true, 'Leyendo la entrevista…', 'Claude está buscando la evidencia de cada requisito. Esto toma entre 20 y 40 segundos.');
  try{
    const out = await api(`/api/sessions/${S.sid}/transcript`, {method:'POST', body:{transcript: texto}});
    aplicarTranscripcion(out.analisis);
    toast('Evidencia lista — revisa y confirma cada nivel');
  }catch(e){
    pantallaTranscripcion({
      titulo: (e.payload && e.payload.motivo) === 'truncado'
        ? 'La transcripción es demasiado larga para una sola pasada.'
        : 'No se pudo sacar la evidencia.',
      msg: e.message,
      raw: e.payload && e.payload.raw,
    });
  }finally{ overlay(false); }
}

// Lo que vuelve son PROPUESTAS. Se precargan para que el evaluador confirme o corrija —
// nunca se dan por calificadas solas: el acta promete escalas ancladas, y quien responde
// por ese número tiene que haberlo mirado.
function aplicarTranscripcion(an){
  S.tran = an || {};
  S.modo = 'calificacion';
  (S.tran.por_requisito || []).forEach((prop, k) => {
    const i = Number(prop.indice) ? Number(prop.indice) - 1 : k;
    const r = S.reqs[i];
    if(!r) return;
    if(prop.cubierto !== false && prop.nivel) r.lvl = Number(prop.nivel) || null;
    if(prop.evidencia) r.ev = String(prop.evidencia);
    // Lo que de verdad se lee en el informe: la explicación del analista y lo que quedó
    // sin comprobar. La cita se queda como rastro, no como cuerpo del documento.
    if(prop.por_que_ese_nivel) r.exp = String(prop.por_que_ese_nivel);
    if(prop.por_confirmar || prop.falta_por_verificar)
      r.falta = String(prop.por_confirmar || prop.falta_por_verificar);
    r.nivelProp = Number(prop.nivel) || null;
  });
  // Conducta e impacto: propuestas también, como los niveles. Se precargan para que el
  // evaluador las lea y las corrija; nada de esto se imprime sin que alguien lo haya mirado.
  // Se cruzan contra los rasgos que pidió el cargo, no contra lo que el modelo quiera nombrar:
  // si devuelve un rasgo que nadie pidió, se ignora.
  if(Array.isArray(S.tran.perfil) && (S.pf||[]).length){
    S.perfil = S.pf.map(rasgo => {
      const p = S.tran.perfil.find(x =>
        (x.rasgo||'').trim().toLowerCase() === (rasgo.rasgo||'').trim().toLowerCase()) || {};
      return {rasgo: rasgo.rasgo, presente: p.presente ?? null,
              observado: p.observado || '', cita: p.cita || ''};
    });
  }
  // La experiencia más reciente, tal como la narró en la conversación. Si no la narró, queda
  // marcada como no verificada y el reclutador lo ve en el cierre antes de emitir.
  const ex = S.tran.experiencia_reciente;
  if(ex && (ex.empresa || ex.cargo)){
    S.exp = {empresa:ex.empresa||'', cargo:ex.cargo||'', periodo:ex.periodo||'',
             resumen:ex.resumen||'', verificada: ex.verificada === true};
  } else if((S.tray||[]).length){
    const t0 = S.tray[0];
    S.exp = {empresa:t0.empresa||'', cargo:t0.cargo||'', periodo:t0.periodo||'',
             resumen:'', verificada:false};
  }
  if(Array.isArray(S.tran.impacto)){
    S.impacto = S.tran.impacto
      .filter(x => x && (x.titulo||'').trim())
      .slice(0, 6)
      .map(x => ({titulo:x.titulo||'', sub:x.sub||'', texto:x.texto||''}));
  }
  // El inglés NO se toca aquí. La transcripción viene en un solo idioma y el tramo en
  // inglés sale escrito con fonética española: proponer un nivel desde ahí sería inventarlo.
  // Lo marca el evaluador en vivo, en la fase de inglés.
  const d = S.tran.declara || {};
  S.dec = S.dec || {};
  ['pretension','disponibilidad','motivacion','nogo'].forEach(k => {
    if(!String(S.dec[k]||'').trim() && String(d[k]||'').trim()) S.dec[k] = d[k];
  });
  S.fase = 0; S.tFase = Date.now();
  saveLocal(); touch();
  go('vLive'); render();
}


// Llena el membrete y el pie que se repiten en cada página impresa. Se hace al momento de
// imprimir y no al dibujar el acta, porque también aplica cuando el usuario imprime con
// Ctrl+P sin tocar el botón.
function prepararImpresion(){
  const doc = S && S.doc ? S.doc : null;
  /* Si el reclutador deja activada la casilla "Encabezados y pies de página" del diálogo de
     Chrome, lo que se imprime arriba de cada hoja es el <title> del documento. Sin esto sale
     "Consola de Verificación" en el PDF que recibe el cliente. No se puede numerar las
     páginas desde CSS —Chrome no implementa las cajas de margen de @page, y un elemento
     fijo no reserva espacio y se monta sobre el texto—, así que esto es lo que hay. */
  if(S && S.id){
    try{ document.title = `${(doc && doc.titulo) || 'Informe de verificación'} ${S.id}` +
      (S.cand ? ` · ${S.cand}` : '') + ' · PeakU'; }catch(e){}
  }
  $('#phLeft').innerHTML = `<b>${esc((doc && doc.titulo) || 'Informe de verificación')}</b> · PeakU Verificado`;
  $('#phRight').textContent = S ? (S.id || '') : '';
  $('#pfLeft').textContent = S ? [S.cand, S.rol, S.cli].filter(Boolean).join(' · ') : '';
  $('#pfRight').textContent = S && S.id ? `${S.id} · ${urlVerificacion(S.id)}` : '';
}
// Ctrl+P y el menú del navegador no pasan por el botón: se engancha el evento del sistema.
window.addEventListener('beforeprint', () => { try{ prepararImpresion(); }catch(e){} });
const TITULO_CONSOLA = document.title;
window.addEventListener('afterprint', () => { try{ document.title = TITULO_CONSOLA; }catch(e){} });

/* ===================== acta ===================== */
async function emitirActa(){
  overlay(true, 'Emitiendo el acta…', 'El servidor vuelve a revisar la regla antes de firmar.');
  try{
    const out = await api('/api/sessions/'+S.sid+'/issue', {method:'POST', body:{
      candidate: S.cand, identity: S.idc, signals: S.sig, data:{mode:S.mode},
      declara: S.dec || {}, recomendacion: S.rec || {}, trayectoria: S.tray || null,
      perfil: S.perfil || null, impacto: S.impacto || null, experiencia: S.exp || null,
      ingles: S.ing ? {requerido:true, nivel_exigido:S.ing.nivel || null, uso:S.ing.uso || null,
                       confirmado:S.ingNivel||null, nota:S.ingNota||'', minuto:S.ingMin||'',
                       fuente:'evaluador_en_vivo'} : null,
      ratings: S.reqs.map(r => ({requirement_id:r.rid, req_text:r.n, level:r.lvl||null, evidence:r.ev||'',
                                 analisis:r.exp||'', falta:r.falta||''})),
    }});
    S.fin = true; S.fecha = Date.now(); S.hash = out.integrity_hash;
    S.doc = out.documento || null;
    if(out.identidad) S.ident = {...(S.ident||{}), ...out.identidad};
    saveLocal();
    verActa();
  }catch(e){
    const f = e.payload && e.payload.faltas;
    toast(f ? f.join(' ') : ('No se pudo emitir: ' + e.message));
  }finally{ overlay(false); }
}

function firmaCorta(){
  const h = S.hash || '';
  return h ? h.slice(0,16).match(/.{1,4}/g).join('-') : '—';
}

function verActa(){
  const d = new Date(S.fecha || Date.now());
  const nSig = Object.values(S.sig).filter(Boolean).length;
  const dec = S.dec || {}, rec = S.rec || {};
  const doc = S.sinSnapshot
    ? {titulo:'Informe de verificación', alcance:'', tipo:'antiguo'}
    : (S.doc || {titulo:'Informe de verificación', alcance:'', tipo:'acta'});
  const idn = S.ident || {};
  const cierre = S.kind === 'cierre';
  const idOk = cierre && idn.estado === 'verificada';
  const nogo = (dec.nogo||'').split('\n').map(x=>x.trim()).filter(Boolean);
  // El inglés solo aparece en el acta si el cargo lo exigía: si no, es ruido.
  const ingA = (() => {
    if(S.sinSnapshot) return null;
    const snap = S.snapIngles;                 // congelado al emitir
    if(snap) return snap;
    if(!S.ing) return null;
    return {confirmado: S.ingNivel || null, nivel_exigido: S.ing.nivel || null,
            nota: S.ingNota || '', minuto: S.ingMin || '', fuente: 'evaluador_en_vivo'};
  })();
  // La experiencia que se verifica es UNA: la más reciente. Puede venir del análisis de la
  // transcripción (que es quien la narra), del snapshot de un informe ya emitido, o —para las
  // sesiones anteriores a este cambio— del primer tramo de la trayectoria del CV.
  const tray = (S.tray || []).filter(t => t.empresa || t.cargo);
  const ultima = (() => {
    const x = S.snapExp || S.exp;
    if(x && (x.empresa || x.cargo)) return {...x, ok: !!x.verificada};
    const t0 = tray[0];
    if(!t0) return null;
    return {empresa:t0.empresa, cargo:t0.cargo, periodo:t0.periodo, resumen:'',
            ok: t0.estado === 'confirmado'};
  })();
  const riesgos = (rec.riesgos||[]).filter(x => (x.r||'').trim());
  const VER = {si:['ok','Recomendado'], reserva:['par','Recomendado con una reserva'], no:['no','No recomendado']}[rec.veredicto] || null;

  // Conducta e impacto salieron de la entrevista, así que se congelan con el resto. Un acta
  // vieja no los tiene y el documento se dibuja igual: los bloques simplemente no aparecen.
  const perfil = (S.snapPerfil || S.perfil || []).filter(o => o && (o.rasgo||'').trim());
  const impacto = (S.snapImpacto || S.impacto || []).filter(x => x && (x.titulo||'').trim());

  // La cinta de datos. Solo lo que de verdad se recogió: un chip con la etiqueta y nada
  // detrás le dice al cliente que no preguntamos, que es peor que no mostrar el chip.
  const chips = [
    dec.ubicacion && ['Ubicación', dec.ubicacion],
    dec.disponibilidad && ['Disponibilidad', dec.disponibilidad],
    dec.pretension && ['Pretensión', dec.pretension],
    (ingA && ingA.confirmado) && ['Inglés', ingA.confirmado],
    dec.procesos && ['Otros procesos', dec.procesos],
  ].filter(Boolean);

  // La bajada del encabezado. No es una frase de venta: es el conteo. Cuántos de los
  // requisitos que el cliente definió quedaron sostenidos con evidencia, dicho en una línea
  // para que se lea antes de entrar al detalle.
  const cumple = S.reqs.filter(r => r.lvl >= 4).length;
  const parcial = S.reqs.filter(r => r.lvl === 3).length;
  const nReq = S.reqs.length;
  const quien = S.cli ? esc(S.cli) : 'el cliente';
  const resumenReq = !nReq ? ''
    : nReq === 1
      ? `El único requisito que definió ${quien} <b>${cumple ? 'quedó sostenido' : (parcial ? 'quedó sostenido parcialmente' : 'no quedó sostenido')}</b>` +
        (cumple || parcial ? ' con evidencia de la sesión.' : ' con evidencia de la sesión.')
      : `De los ${nReq} requisitos que definió ${quien}, ` +
        `<b>${cumple} quedó${cumple===1?'':'ron'} sostenido${cumple===1?'':'s'}</b> con evidencia de la sesión` +
        (parcial ? `, ${parcial} parcialmente` : '') + '.';

  // Sellos: solo lo que de verdad se midió en esta sesión.
  const sellos = [
    cierre ? [idOk, idOk ? 'Identidad verificada' : 'Identidad no certificada'] : null,
    [true, 'Sesión supervisada en vivo'],
    [nSig === 0, nSig === 0 ? 'Sin señales de asistencia' : `${nSig} señal${nSig>1?'es':''} registrada${nSig>1?'s':''}`],
    [true, `${S.reqs.length} requisito${S.reqs.length>1?'s':''} medido${S.reqs.length>1?'s':''}`],
    ultima ? [ultima.ok, ultima.ok ? 'Experiencia reciente verificada'
                                   : 'Experiencia reciente no verificada'] : null,
  ].filter(Boolean);

  $('#actaStage').innerHTML = `
    ${S.sinSnapshot ? `<div class="aviso">
      <b>Este informe se emitió con una versión anterior del formato.</b>
      Lo que ves está reconstruido con los datos que quedaron guardados, así que puede no
      coincidir exactamente con la copia que se entregó — esa copia es la referencia.
      Los informes emitidos de ahora en adelante se congelan al emitirse y se ven siempre igual.
    </div>` : ''}
    <div class="acta">
      <div class="ahd">
        <div>
          <svg class="iso actaiso" viewBox="0 0 174.8 90.4" role="img" aria-label="PeakU" focusable="false"><path class="b" d="M 126.84 54.14 C 131.82 58.32 139.23 57.67 143.40 52.70 L 125.39 37.59 C 121.22 42.56 121.87 49.97 126.84 54.14"/><path class="b" d="M 167.13 6.13 C 162.16 1.96 154.75 2.61 150.58 7.58 L 168.58 22.69 C 172.75 17.71 172.11 10.30 167.13 6.13"/><path class="b" d="M 152.02 24.14 C 147.05 19.96 146.40 12.55 150.58 7.58 L 125.39 37.59 C 129.57 32.62 136.98 31.97 141.95 36.14 C 146.93 40.31 147.57 47.73 143.40 52.70 L 168.58 22.69 C 164.41 27.66 157.00 28.31 152.02 24.14"/><path class="b" d="M 141.95 36.14 C 136.98 31.97 129.57 32.62 125.39 37.59 L 143.40 52.70 C 147.57 47.73 146.93 40.31 141.95 36.14"/><path class="b" d="M 152.02 24.14 C 157.00 28.31 164.41 27.66 168.58 22.69 L 150.58 7.58 C 146.40 12.55 147.05 19.96 152.02 24.14"/><path class="a" d="M 73.12 6.13 C 68.14 1.96 60.73 2.61 56.56 7.58 L 44.90 21.48 L 62.62 36.92 L 74.56 22.69 C 78.73 17.71 78.09 10.30 73.12 6.13"/><path class="a" d="M 120.12 6.13 C 115.15 1.96 107.74 2.61 103.57 7.58 L 121.57 22.69 C 125.75 17.71 125.10 10.30 120.12 6.13"/><path class="a" d="M 105.02 24.14 C 109.99 28.31 117.40 27.66 121.57 22.69 L 103.57 7.58 C 99.39 12.55 100.04 19.96 105.02 24.14"/><path class="a" d="M 53.21 67.60 L 62.98 55.95 C 60.76 58.59 56.82 58.94 54.17 56.72 C 51.53 54.50 51.18 50.55 53.40 47.91 L 24.20 82.71 C 23.55 83.49 22.80 84.15 22.00 84.72 L 21.99 84.75 C 21.99 84.75 33.67 76.08 34.11 75.75 C 36.51 74.02 39.46 72.99 42.66 72.99 C 42.65 72.99 42.65 72.99 42.64 72.99 L 42.68 72.99 C 42.67 72.99 42.66 72.99 42.66 72.99 C 46.39 73.00 50.01 74.67 50.94 78.48 L 50.94 78.48 C 49.87 74.83 50.58 70.73 53.21 67.60"/><path class="a" d="M 58.01 24.14 C 53.04 19.96 52.39 12.55 56.56 7.58 L 6.20 67.60 C 10.37 62.62 17.78 61.98 22.75 66.15 C 25.79 68.70 27.20 72.45 26.90 76.12 C 26.71 78.46 25.83 80.77 24.20 82.71 L 53.40 47.91 L 74.56 22.69 C 70.39 27.66 62.98 28.31 58.01 24.14"/><path class="a" d="M 22.75 66.15 C 17.78 61.98 10.37 62.62 6.20 67.60 C 2.02 72.57 2.67 79.98 7.64 84.16 C 11.84 87.67 17.75 87.75 22.01 84.72 C 22.80 84.15 23.55 83.49 24.20 82.71 C 25.83 80.77 26.71 78.46 26.90 76.12 C 27.20 72.45 25.79 68.70 22.75 66.15"/><path class="a" d="M 121.57 22.69 C 117.40 27.66 109.99 28.31 105.02 24.14 C 100.04 19.96 99.39 12.55 103.57 7.58 L 62.98 55.95 L 53.21 67.60 C 54.60 65.94 56.35 64.77 58.25 64.10 C 62.05 62.74 66.45 63.37 69.76 66.15 C 74.73 70.32 75.38 77.73 71.21 82.71 Z M 121.57 22.69"/><path class="a" d="M 69.76 66.15 C 66.45 63.37 62.05 62.74 58.25 64.10 C 56.35 64.77 54.60 65.94 53.21 67.60 C 50.58 70.73 49.87 74.83 50.94 78.48 C 51.57 80.62 52.82 82.61 54.66 84.16 C 59.62 88.33 67.04 87.68 71.21 82.71 C 75.38 77.73 74.73 70.32 69.76 66.15"/></svg>
          <h2>${esc(S.cand)}</h2>
          <div class="cert">${esc(doc.titulo)} · PeakU Verificado</div>
          <div class="rl2">${[esc(S.rol), S.cli && '<b>'+esc(S.cli)+'</b>'].filter(Boolean).join(' · ')}</div>
          ${resumenReq ? `<p class="bajada">${resumenReq}</p>` : ''}
        </div>
        <div class="mt">
          Informe <b class="mono">${esc(S.id)}</b><br>
          Verificado el <b>${fechaLarga(d)}</b><br>
          Vigente hasta <b>${masSeis(d)}</b><br>
          Sesión supervisada · grabada
        </div>
      </div>

      <div class="sellos">
        ${sellos.map(([ok,t]) => `<span class="sello ${ok?'ok':'nv'}">${ok?'✓':'○'} ${esc(t)}</span>`).join('')}
      </div>

      <!-- La cinta de datos: lo que el cliente mira antes de decidir si sigue leyendo.
           Solo aparece lo que de verdad se recogió; un chip vacío es peor que ninguno. -->
      ${chips.length ? `<div class="chips">
        ${chips.map(c => `<span class="chip"><b>${esc(c[0])}</b> ${esc(c[1])}</span>`).join('')}
      </div>` : ''}

      ${rec.texto ? `<div class="posic">
        <div class="mini">Posicionamiento</div>
        <p>${esc(rec.texto)}</p>
      </div>` : ''}

      <!-- BANDA 1 · dos columnas: el ajuste a los requisitos, que es la razón de ser del
           documento, con lo que demostró al lado para que se lea de un vistazo. Las bandas
           que siguen van a ancho completo: una columna angosta de media página estrangula el
           texto y deja las dos columnas terminando a alturas muy distintas, que en papel se
           lee como un hueco. -->
      <div class="${impacto.length ? 'inf' : ''}">
        <div class="infcol">
          <div class="zona"><span class="zn">Ajuste al rol</span><h3>Requisito por requisito</h3>
            <span class="zs">Escala anclada 1-5 · evidencia de la sesión</span></div>
          <div class="zbox">
            ${S.reqs.map((r, i) => {
              const v = r.lvl>=4?'ok':(r.lvl===3?'par':'no');
              // Antes aquí se pegaba r.ev — la cita cruda de la transcripción, a veces un
              // párrafo entero. Eso es el rastro de auditoría, no el informe: quien lo lee no
              // estuvo en la llamada y no tiene por qué interpretar un fragmento de diálogo.
              // Ahora se imprime el juicio (por qué cumple o no) y lo que quedó sin comprobar.
              const p = porQue(r, i);
              // Cascada: explicación → cita archivada → ancla. La cita sigue siendo el cuerpo
              // de las actas emitidas ANTES de este cambio: su snapshot guarda `evidence` y no
              // `analisis`, y un documento ya entregado no se reescribe porque el software
              // haya evolucionado. También cubre la sesión calificada a mano, donde lo único
              // que hay es lo que el evaluador escribió.
              // Explicación del analista → lo que escribió el evaluador → la frase del nivel.
              // El ancla de la rúbrica ya no entra en esta cascada: es criterio interno.
              const cuerpo = (!p.esAncla && p.texto) ? p.texto
                           : ((r.ev || '').trim() || NIVEL_CLIENTE[r.lvl] || '');
              return `<div class="req">
                <div class="reqhd">
                  <div class="reqn">${esc(r.n)}</div>
                  <div class="reqv"><span class="rl">${r.lvl} / 5</span><span class="vd ${v}">${LVLTXT[r.lvl]}</span></div>
                </div>
                <div class="barra"><span class="fill ${v}" style="width:${r.lvl*20}%"></span></div>
                ${cuerpo?`<div class="aex">${esc(cuerpo)}</div>`:''}
                ${r.falta?`<div class="afalta"><b>Por confirmar:</b> ${esc(r.falta)}</div>`:''}
              </div>`;
            }).join('')}
          </div>
          <!-- El ancla dejó de imprimirse debajo de cada requisito. "Ancla 4: escena y rol
               claros + 2/3 detalles verificables + cruce correcto" es el criterio con el que
               trabajamos por dentro; al cliente no le dice nada y delata el guion. La escala
               se explica una vez, en su idioma, para que el número siga teniendo respaldo. -->
          <p class="hint">Escala de 1 a 5 sobre evidencia de la sesión: <b>4 y 5</b> exigen un caso
          propio narrado con alcance y resultado; <b>3</b> es experiencia real con alcance parcial;
          <b>1 y 2</b>, conocimiento que no llega a sostenerse con un caso propio.</p>
        </div>
        <div class="infcol dos"${impacto.length ? '' : ' hidden'}>
          ${impacto.length ? `
          <div class="zona"><span class="zn">Lo que demostró</span><h3>En la conversación</h3></div>
          <div class="imps">
            ${impacto.map(x => `<div class="imp">
              <b>${esc(x.titulo||'')}</b>
              ${x.sub?`<span class="isub">${esc(x.sub)}</span>`:''}
              ${x.texto?`<p>${esc(x.texto)}</p>`:''}
            </div>`).join('')}
          </div>
          <p class="hint">Sale de lo que sostuvo en la entrevista, no de lo que escribió en su
          hoja de vida.</p>` : ''}
        </div>
      </div>

      <!-- BANDA 2 · conducta, a ancho completo: son párrafos, y un párrafo en media columna
           se parte en renglones de cuatro palabras. -->
        ${perfil.length ? `
        <div class="zona"><span class="zn">Conducta</span><h3>Cómo se comportó en la sesión</h3>
          <span class="zs">Evidenciado en la entrevista</span></div>
        <div class="zbox">
          ${perfil.map(o => {
            const e = o.presente === true ? ['ok','SE EVIDENCIÓ']
                    : o.presente === false ? ['no','NO SE EVIDENCIÓ'] : ['nv','SIN EVIDENCIA'];
            return `<div class="req">
              <div class="reqhd">
                <div class="reqn">${esc(o.rasgo||'')}</div>
                <div class="reqv"><span class="vd ${e[0]}">${e[1]}</span></div>
              </div>
              ${o.observado ? `<div class="aex">${esc(o.observado)}</div>` : ''}
            </div>`;
          }).join('')}
          <p class="hint">Conducta evidenciada durante la sesión grabada. No es un perfil psicométrico
          ni describe a la persona fuera de ese contexto.</p>
        </div>` : ''}

      <!-- BANDA 3 · dos bloques cortos que se acompañan bien: cómo se midió el idioma y
           cómo se sostuvo la sesión. -->
      <div class="${ingA ? 'inf par' : ''}">
        <div class="infcol">
          ${ingA ? `
          <div class="zona"><span class="zn">Inglés</span><h3>Lo que se oyó</h3></div>
          <div class="zbox">
            ${!ingA.confirmado ? `
              <p class="dtx"><b>No evaluado en esta sesión.</b> No se midió el inglés en la
              conversación, así que este informe no dice nada sobre su inglés — ni a favor ni en contra.</p>
            ` : `
              <div class="ingfila">
                <div class="ingniv">${esc(ingA.confirmado)}</div>
                <div class="ingtx">
                  ${ingA.nivel_exigido ? `<span class="ingpide">El cargo pide: ${esc(ingA.nivel_exigido)}</span>` : ''}
                  <b>${esc(ANCLA_ING[ingA.confirmado] || '')}</b>
                  ${ingA.nota ? `<p class="dtx" style="margin-top:6px">${esc(ingA.nota)}</p>` : ''}
                </div>
              </div>
              <!-- El resto del acta se sostiene en cita textual de la transcripción. Esto no, y
                   callarlo sería darle al lector una confianza que este dato no tiene. Meet
                   transcribe en un solo idioma por archivo, así que el tramo en inglés no queda
                   en texto utilizable: lo califica el evaluador escuchando, en vivo. -->
              <div class="aev" style="margin-top:10px"><b>Cómo se midió:</b> un tramo de la entrevista
                se condujo en inglés y ${esc(S.eval || 'el evaluador')} calificó el desempeño en vivo
                contra la escala de conducta${ingA.minuto ? `, dejando anotado el minuto <b>${esc(ingA.minuto)}</b> de la grabación para su comprobación` : ''}.
                Es una valoración de desempeño conversacional; una certificación estandarizada mide
                otras dimensiones del idioma.</div>
            `}
          </div>` : ''}
        </div>
        <div class="infcol">
          <div class="zona"><span class="zn">Integridad</span><h3>Cómo se sostuvo la sesión</h3></div>
          <div class="zbox">
            ${cierre ? actaIdentidad() : ''}
            <div class="res"><div class="rn">Señales de asistencia por IA o fuente externa<small>Observadas en vivo durante la sesión</small></div><span class="vd ${nSig?'par':'ok'}">${nSig?nSig+' REGISTRADA'+(nSig>1?'S':''):'NINGUNA'}</span></div>
            <div class="res"><div class="rn">Bitácora de la sesión<small>La transcripción de la entrevista queda archivada</small></div><span class="vd ok">DISPONIBLE</span></div>
            ${nSig?`<div class="aev">Señales: ${SIGNALS.filter(s=>S.sig[s.id]).map(s=>esc(s.t)).join(' · ')}. Se reportan como observación factual; no constituyen un juicio sobre el candidato.</div>`:''}
          </div>
        </div>
      </div>

      <!-- UNA experiencia, la más reciente. La sesión dura 30 minutos y se verifica el empleo
           que de verdad predice cómo va a trabajar mañana; listar los anteriores con un sello
           de "no se abordó" al lado convierte una decisión de método en una lista de faltantes,
           y además es el tramo que el candidato peor recuerda. -->
      ${ultima ? `
      <div class="zona"><span class="zn">Experiencia</span><h3>${ultima.ok ? 'Verificada en la sesión' : 'Experiencia más reciente'}</h3>
        <span class="zs">Declarada en la hoja de vida · contrastada en la entrevista</span></div>
      <div class="zbox">
        <div class="res"><div class="rn">${esc(ultima.cargo||'—')}<small>${esc(ultima.empresa||'')}${ultima.periodo?' · '+esc(ultima.periodo):''}</small></div>
          <span class="vd ${ultima.ok?'ok':'nv'}">${ultima.ok?'VERIFICADA':'NO VERIFICADA'}</span></div>
        ${ultima.resumen ? `<p class="dtx" style="margin-top:10px">${esc(ultima.resumen)}</p>` : ''}
        <p class="hint">${ultima.ok
          ? 'Verificada significa que el candidato narró este trabajo con alcance y resultado propios durante la entrevista, no que aparezca en su hoja de vida.'
          : 'La verificación se concentra en la experiencia más reciente. Esta quedó declarada en la hoja de vida y no verificada en esta sesión.'}</p>
      </div>` : ''}

      <!-- Factores de cierre: lo que el cliente necesita para mover la oferta. Va al final
           porque es lo último que se decide, y en dos columnas porque son dos lecturas
           distintas — lo que lo atrae y lo que puede salir mal. -->
      ${(dec.motivacion || nogo.length || dec.procesos || VER || rec.texto || riesgos.length) ? `
      <div class="zona"><span class="zn">Factores de cierre</span><h3>Qué mueve a ${esc((S.cand||'').split(' ')[0])} y qué puede fallar</h3>
        <span class="zs">Sus palabras · nuestra lectura</span></div>
      <div class="zbox dos">
        <div>
          ${dec.motivacion ? `<div class="mini">Por qué está buscando</div>
            <p class="dtx">${esc(dec.motivacion)}</p>` : ''}
          ${nogo.length ? `<div class="mini" style="margin-top:12px">No negociables</div>
            <ul class="lst">${nogo.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          ${(dec.pretension||dec.disponibilidad||dec.procesos) ? `<div class="mini" style="margin-top:12px">Condiciones declaradas</div>
            ${dec.pretension ? `<div class="res"><div class="rn">Pretensión</div><span class="rl">${esc(dec.pretension)}</span></div>` : ''}
            ${dec.disponibilidad ? `<div class="res"><div class="rn">Disponibilidad</div><span class="rl">${esc(dec.disponibilidad)}</span></div>` : ''}
            ${dec.procesos ? `<div class="res"><div class="rn">Otros procesos activos</div><span class="rl">${esc(dec.procesos)}</span></div>` : ''}
            <p class="hint">No verificado contra desprendibles ni contra terceros.</p>` : ''}
        </div>
        <div>
          ${VER ? `<div class="mini">Nuestra recomendación</div>
            <div class="recver"><span class="vd ${VER[0]}">${esc(VER[1].toUpperCase())}</span></div>` : ''}
          ${riesgos.length ? `<div class="mini" style="margin-top:${VER?'14px':'0'}">Riesgos y mitigación</div>
            ${riesgos.map(x=>`<div class="riesgo"><b>${esc(x.r)}</b>${x.m?`<span>Mitigación: ${esc(x.m)}</span>`:''}</div>`).join('')}` : ''}
          ${(!VER && !riesgos.length) ? '<p class="hint" style="margin-top:0">Sin recomendación registrada.</p>' : ''}
          <p class="hint">La recomendación es opinión del evaluador — lo único de este informe que
          no es medición.</p>
        </div>
      </div>` : ''}

      <div class="cierrepie">
      <div class="aback">
        <div class="abtx">
          <h4>PeakU responde por este informe.</h4>
          <p>${(doc.tipo === 'acta')
            ? `Si la persona no es quien este informe dice que es, o su desempeño no corresponde a lo aquí certificado dentro de los primeros 90 días, PeakU repone la búsqueda sin costo.`
            : `Si el desempeño no corresponde a lo aquí certificado dentro de los primeros 90 días, PeakU repone la búsqueda sin costo. <b>Este informe no certifica la identidad de la persona</b>: certifica lo observado sobre los requisitos del cargo.`} Verifique la autenticidad en <b>${esc(urlVerificacion(S.id))}</b>.</p>
          <span class="sig">Firma de integridad: ${esc(firmaCorta())} · Evaluó: ${esc(S.eval||'—')} · Revisión de calidad: pendiente de cuatro ojos · Rúbrica anclada 1-5</span>
        </div>
        ${S.id ? `<button class="abqr" type="button" title="${esc(urlVerificacionAbs(S.id))}">
          ${huecoQr(urlVerificacionAbs(S.id), 6, 'Verificar la autenticidad de este informe')}
          <span>Escanee para verificar</span>
        </button>` : ''}
      </div>
        <p class="hint alcance">${esc(doc.alcance || '')} Metodología: entrevista estructurada con escalas ancladas (1-5) sobre los requisitos definidos por el cliente${
          (doc.tipo === 'acta') ? '; identidad verificada por proveedor externo y cotejada contra el rostro de la sesión' : ''}; sesión grabada y archivada.</p>
      </div>
    </div>
    <div class="tools" style="margin-top:14px">
      <button data-back type="button">${S.soloLectura ? 'Volver a la lista' : 'Volver al cierre'}</button>
      <button class="pri" id="btnPrint" type="button">Imprimir o guardar en PDF</button>
      <button id="btnJson2" type="button">Copiar JSON del archivo</button>
    </div>`;
  pintarQrs($('#actaStage'));
  const qa = $('#actaStage').querySelector('.abqr');
  if(qa) qa.addEventListener('click', () => qrGrande(urlVerificacionAbs(S.id),
    'Escanea este código para verificar la autenticidad de este informe.'));
  $('#actaStage').querySelector('[data-back]').addEventListener('click', () => {
    if(S.soloLectura){ loadTablero(); return; }
    go('vLive'); render();
  });
  $('#actaStage').querySelector('#btnPrint').addEventListener('click', () => { prepararImpresion(); window.print(); });
  $('#actaStage').querySelector('#btnJson2').addEventListener('click', copiarJSON);
  go('vActa');
}

// Fila de identidad del acta: distingue verificada, dudosa, rechazada y no superada.
// Que el candidato no haya querido verificarse no se cuenta igual que una verificación fallida.
function actaIdentidad(){
  const i = S.ident || {};
  const est = i.estado || 'pendiente';
  const score = i.face_score != null ? Number(i.face_score).toFixed(1) : null;
  const cuadro = {
    verificada:  ['ok',  'VERIFICADA',    'Documento validado por proveedor externo con prueba de vida, y rostro cotejado contra la sesión' + (score?` (coincidencia ${score}/100)`:'') + '.'],
    dudosa:      ['par', 'PARCIAL',       'Documento validado, pero el cotejo del rostro quedó en zona dudosa' + (score?` (${score}/100)`:'') + ' y fue revisado manualmente.'],
    rechazada:   ['nv',  'NO REALIZADA',  'El candidato optó por no verificar su identidad. Este informe no la certifica.'],
    abandonada:  ['nv',  'SIN COMPLETAR', 'La verificación se envió y no se completó. Este informe no certifica identidad.'],
    fallida:     ['no',  'NO SUPERADA',   'La verificación de identidad no fue superada.'],
  }[est] || ['nv', 'NO REALIZADA', 'Este informe no certifica identidad.'];
  return `<div class="res"><div class="rn">Identidad — documento, prueba de vida y cotejo con la sesión</div>
            <span class="vd ${cuadro[0]}">${cuadro[1]}</span></div>
          <div class="aev">${esc(cuadro[2])}</div>`;
}

function copiarJSON(){
  const out = {
    informe: S.id, sesion_id: S.sid, fecha: new Date(S.fecha||Date.now()).toISOString(),
    candidato: S.cand, cargo: S.rol, cliente: S.cli, evaluador: S.eval, modalidad: S.mode,
    requisitos: S.reqs.map(r => ({requisito:r.n, nivel:r.lvl, veredicto:r.lvl?LVLTXT[r.lvl]:null, evidencia:r.ev||''})),
    tipo_sesion: S.kind,
    integridad: idChecksDe(S.kind).map(c => ({item:c.t, ok:!!S.idc[c.id]})),
    identidad: S.ident || null,
    senales: SIGNALS.filter(s => S.sig[s.id]).map(s => s.t),
    firma_integridad: S.hash || null,
  };
  const txt = JSON.stringify(out, null, 2);
  const fallback = () => {
    const t=document.createElement('textarea'); t.value=txt; document.body.appendChild(t); t.select();
    try{ document.execCommand('copy'); toast('JSON copiado'); }catch(e){ toast('No se pudo copiar'); }
    t.remove();
  };
  if(navigator.clipboard) navigator.clipboard.writeText(txt).then(()=>toast('JSON copiado al portapapeles')).catch(fallback);
  else fallback();
}

/* ===================== reloj ===================== */
function reloj(){
  if(!S || !S.t0) return;
  $('#tTotal').textContent = mmss(Date.now()-S.t0);
  const f = fases()[S.fase], el = Date.now()-(S.tFase||S.t0);
  const t = $('#tPhase'); t.textContent = mmss(el);
  t.classList.toggle('over', !!(f && el > f.min*60000));
}

/* ===================== arranque ===================== */
async function salud(){
  const p = $('#dbPill');
  try{
    const h = await api('/api/health');
    if(h.db){ p.textContent='BD'; p.className='pill ok'; p.title='Postgres compartido con Sandler · schema verificacion'; }
    else { p.textContent='MEMORIA'; p.className='pill mem'; p.title='Sin Postgres: los datos se pierden al reiniciar el servidor'; }
    if(!h.llm){ p.textContent='SIN IA'; p.className='pill bad'; p.title='Falta ANTHROPIC_API_KEY'; }
  }catch(e){ p.textContent='OFFLINE'; p.className='pill bad'; }
}

function init(){
  initIntake();
  $('#btnHome').addEventListener('click', async () => {
    if(S && !S.fin && !S.soloLectura && !confirm('Hay una sesión en curso. ¿Salir de todos modos? Queda guardada.')) return;
    await flush();
    loadTablero();
  });
  $('#btnNuevoIntake').addEventListener('click', () => go('vIntake'));
  // Ojo: esto era solo un scrollIntoView, y en un tablero corto la página no tiene scroll,
  // así que el botón no hacía absolutamente nada visible. Un botón que no da señal de haber
  // funcionado es, para quien lo usa, un botón roto. Ahora además resalta la tarjeta.
  $('#btnVerSesiones').addEventListener('click', () => {
    const c = document.getElementById('sesCard');
    if(!c) return;
    c.scrollIntoView({behavior:'smooth', block:'center'});
    c.classList.remove('destacar');
    void c.offsetWidth;              // reinicia la animación si se hace clic dos veces seguidas
    c.classList.add('destacar');
    setTimeout(() => c.classList.remove('destacar'), 1400);
  });
  document.querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', loadTablero));
  $('#btnReset').addEventListener('click', () => {
    if(S && S.soloLectura){ S = null; loadTablero(); return; }
    if(confirm('¿Salir de esta sesión? Queda guardada en la base de datos y puedes seguir después.')){
      flush().then(() => { S = null; VAC = null; clearLocal(); loadTablero(); });
    }
  });

  const prev = loadLocal();
  if(prev && prev.S && prev.S.sid && !prev.S.fin){
    S = prev.S; VAC = prev.VAC;
    drawSig(); render(); go('vLive');
    toast('Retomando la sesión de ' + S.cand);
  } else {
    loadTablero();
  }
  salud();
  tick = setInterval(reloj, 1000);
  reloj();
}
init();

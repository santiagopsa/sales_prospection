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
const ANCLA_CORTA = {
  5:'Ancla 5: escena específica + rol individual + fricción real narrada + 3/3 detalles verificables + criterio propio en el cruce.',
  4:'Ancla 4: escena y rol claros + fricción real + 2/3 detalles verificables; cruce correcto aunque superficial.',
  3:'Ancla 3: experiencia plausible pero escena genérica o fricción vaga; detalles parciales.',
  2:'Ancla 2: solo definiciones y contexto; sin escena propia; confunde algún detalle verificable.',
  1:'Ancla 1: no sostiene el tema — evasivas, incoherencias con el CV o detalles incorrectos.'
};

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
      const semTag = s.semaforo==='verde'?'v':(s.semaforo==='amarillo'?'a':(s.semaforo==='rojo'?'r':'n'));
      const semTx = s.semaforo ? s.semaforo.toUpperCase() : 'EN CURSO';
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
    const reqs = (s.ratings || []).map(r => ({
      rid: r.requirement_id, n: r.req_text, lvl: r.level, ev: r.evidence || '', r: {},
    }));
    S = {
      sid: s.id, id: s.report_code, cand: s.candidate, rol: s.vacancy_title || '',
      cli: s.company_name || '', eval: s.evaluator || '', mode: s.mode || 'B',
      kind: s.kind || 'sondeo', reqs,
      idc: s.identity || {}, sig: s.signals || {},
      dec: s.declara || {}, rec: s.recomendacion || {riesgos:[]},
      ident: {...(s.identidad || {}), didit_status: s.didit_status,
              face_verdict: s.face_verdict, face_score: s.face_score},
      doc: s.documento || null, hash: s.integrity_hash || null, diditUrl: s.didit_url || null,
      fecha: s.issued_at ? new Date(s.issued_at).getTime() : Date.now(),
      t0: null, tFase: null, fase: 0,
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
  $('#actaStage').innerHTML = `
    <button class="back" data-home type="button">← Todas las verificaciones</button>
    <div class="card">
      <div class="cardhd">
        <h2>${esc(S.cand)}</h2>
        <span class="tag n">SIN EMITIR</span>
      </div>
      <div class="cs" style="margin-bottom:14px">${[esc(S.rol), S.cli && esc(S.cli), S.kind==='cierre'?'cierre verificado':'sondeo'].filter(Boolean).join(' · ')} · <span class="mono">${esc(S.id)}</span></div>
      <div class="res"><div class="rn">Requisitos calificados</div><span class="rl">${cal} de ${S.reqs.length}</span></div>
      <div class="res"><div class="rn">Señales observadas</div><span class="rl">${nSig}</span></div>
      ${S.kind==='cierre' ? `<div class="res"><div class="rn">Verificación de identidad</div><span class="rl">${esc(i.texto || 'sin enviar')}</span></div>` : ''}
      <p class="hint">Esta sesión quedó a medias. Puedes retomarla donde estaba: lo que ya registraste está guardado en el servidor, no en el navegador.</p>
      <div class="tools" style="margin-top:12px">
        <button data-home type="button">Volver</button>
        <button class="pri" id="btnRetomar" type="button">Retomar la sesión</button>
      </div>
    </div>`;
  $('#actaStage').querySelectorAll('[data-home]').forEach(b => b.addEventListener('click', loadTablero));
  $('#actaStage').querySelector('#btnRetomar').addEventListener('click', () => {
    S.soloLectura = false;
    S.t0 = S.t0 || Date.now();
    S.tFase = Date.now();
    S.fase = 0;
    saveLocal(); drawSig(); render(); go('vLive');
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
    toast('No se pudo analizar: ' + e.message);
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
        <span class="cs">Estos son los que se van a verificar. Máximo 5.</span>
      </div>
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

    <button class="cta" id="btnGuardarVac">Guardar la vacante</button>
    <p class="hint">Queda en la base de datos con sus requisitos. Después seleccionas esta vacante para verificar a cada finalista.</p>
  `;

  $('#revStage').querySelector('[data-back]').addEventListener('click', () => go('vIntake'));
  $('#revStage').querySelectorAll('#revModes .mode').forEach(b => b.addEventListener('click', () => {
    X.modalidad_sugerida = b.dataset.m;
    $('#revStage').querySelectorAll('#revModes .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
  $('#btnAddEx').addEventListener('click', () => {
    if(X.excluyentes.length >= 5) return toast('Cinco es el máximo para una sesión de 25 minutos.');
    X.excluyentes.push({requisito:'', detalles_verificables:[], senales_impostor:[]});
    drawEx();
  });
  $('#btnGuardarVac').addEventListener('click', guardarVacante);
  drawEx();
  go('vRevision');
}

function drawEx(){
  const L = $('#exList');
  if(!X.excluyentes.length){
    L.innerHTML = `<div class="empty">No se identificó ningún requisito excluyente. Agrégalos a mano o revisa el texto que cargaste.</div>`;
    return;
  }
  L.innerHTML = X.excluyentes.map((r,i) => {
    const dets = Array.isArray(r.detalles_verificables) ? r.detalles_verificables : [];
    const sen  = Array.isArray(r.senales_impostor) ? r.senales_impostor : [];
    return `
    <div class="exq">
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

async function guardarVacante(){
  const body = {
    empresa: {nombre:$('#rEmp').value, sector:$('#rSec').value, contacto:$('#rCon').value},
    vacante: {
      titulo:$('#rTit').value, seniority:$('#rSen').value, modalidad:$('#rMod').value,
      ciudad:$('#rCiu').value, salario_texto:$('#rSal').value, contexto:$('#rCtx').value,
      urgencia:(X.vacante||{}).urgencia||'', moneda:(X.vacante||{}).moneda||'',
      salario_min:(X.vacante||{}).salario_min??null, salario_max:(X.vacante||{}).salario_max??null,
    },
    excluyentes: X.excluyentes.filter(r => (r.requisito||'').trim()),
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
        <h1>${esc(v.title)}</h1>
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

      <button class="cta" id="btnNuevaSesion">Verificar a un candidato</button>
      <p class="hint">Se abre una sesión guiada de 25 minutos con estos requisitos ya cargados.</p>
    `;
    $('#vacStage').querySelector('[data-home]').addEventListener('click', loadTablero);
    $('#btnNuevaSesion').addEventListener('click', () => setupSesion(v));
    go('vVacante');
  }catch(e){
    toast('No se pudo abrir: ' + e.message);
    loadTablero();
  }finally{ overlay(false); }
}

/* ===================== setup de sesión ===================== */
function setupSesion(v){
  const modo = v.suggested_mode === 'A' ? 'A' : 'B';
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

      <button class="cta" id="btnIniciar" disabled>Iniciar la sesión</button>
      <p class="hint">Antes de darle clic: ten la grabación de Meet activa y el reporte de identidad a la mano.</p>
    </div>`;

  let mode = modo, kind = 'sondeo';
  $('#setupStage').querySelector('[data-back]').addEventListener('click', () => verVacante(v.id));
  $('#setupStage').querySelectorAll('#setKind .mode').forEach(b => b.addEventListener('click', () => {
    kind = b.dataset.k;
    $('#setupStage').querySelectorAll('#setKind .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
  $('#setupStage').querySelectorAll('#setModes .mode').forEach(b => b.addEventListener('click', () => {
    mode = b.dataset.m;
    $('#setupStage').querySelectorAll('#setModes .mode').forEach(m => m.classList.toggle('sel', m===b));
  }));
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
        idc:{}, sig:{}, fase:0, t0:Date.now(), tFase:Date.now(), fin:false, fecha:null, hash:null,
      };
      saveLocal(); drawSig(); render(); go('vLive');
    }catch(e){ toast('No se pudo iniciar: ' + e.message); }
    finally{ overlay(false); }
  });
  go('vSetup');
  chk();
}

/* ===================== sesión en vivo ===================== */
function fases(){
  const f = [{k:'id', t:'Apertura', min:4}];
  S.reqs.forEach((r,i) => f.push({k:'req', i, t:r.n || ('Requisito '+(i+1)), min:6}));
  f.push({k:'ctx', t:'Contexto', min:4});
  f.push({k:'cierre', t:'Cierre', min:3});
  return f;
}
function drawNav(){
  const F = fases();
  $('#phaseNav').innerHTML = F.map((f,i) => {
    const done = f.k==='id' ? idChecksDe(S.kind).every(c=>S.idc[c.id])
      : f.k==='req' ? S.reqs[f.i].lvl>0
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
    declara: S.dec || {}, recomendacion: S.rec || {},
    ratings: S.reqs.map(r => ({requirement_id:r.rid, req_text:r.n, level:r.lvl||null, evidence:r.ev||''})),
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

function render(){
  drawNav();
  const F = fases(), f = F[S.fase], st = $('#stage');
  if(!f) return;

  if(f.k === 'id'){
    const cierre = S.kind === 'cierre';
    st.innerHTML = `
      <div class="card">
        <h2>Apertura</h2>
        <div class="cs" style="margin-bottom:16px">Primeros minutos · ${cierre ? 'la identidad se verifica después de la llamada, no aquí' : 'en un sondeo no se pide ninguna identificación'}</div>
        <div class="say"><div class="lb">DILO ASÍ</div><p>“Gracias por conectarte. Esta sesión queda grabada, como todas las nuestras. ${cierre ? 'Al final te voy a enviar un link para confirmar tu identidad — lo haces desde tu celular en un minuto, y no queda ninguna foto de tu documento con nosotros. ' : ''}¿Arrancamos?”</p></div>
        ${idChecksDe(S.kind).map(c => `<button class="chk ${S.idc[c.id]?'on':''}" data-idc="${c.id}" ${c.id==='shot'?'disabled style="opacity:.75;cursor:default"':''} type="button"><span class="box">✓</span><span class="tx">${c.t}<small>${c.d}</small></span></button>`).join('')}

        ${cierre ? `
        <div class="shotbox ${S.idc.shot?'has':''}" id="shotBox">
          <input type="file" id="shotFile" accept="image/*" hidden>
          <div class="shotin">
            <div class="shotic">${S.idc.shot?'✓':'⌗'}</div>
            <div class="shottx">
              <b id="shotTitle">${S.idc.shot?'Captura guardada':'Captura el rostro del candidato'}</b>
              <span id="shotSub">${S.idc.shot
                ? 'Se comparará con su verificación de identidad. Puedes reemplazarla si quedó borrosa.'
                : 'Toma un pantallazo del video con la cara de frente y visible, y suéltalo aquí. También puedes pegarlo con Ctrl+V.'}</span>
            </div>
          </div>
        </div>
        <p class="hint">La captura se borra sola en cuanto el cotejo termina. Lo que queda guardado es el puntaje, no la imagen.</p>
        ` : `
        <p class="hint" style="margin-top:14px">Este es un <b>sondeo</b>: no se pide identidad ni se guarda ninguna imagen. Si el candidato avanza a finalista, ahí se hace el cierre verificado.</p>
        `}

        <p class="hint"><b>Si algo se sale de lo normal</b> — se niega a encender la cámara, el video se congela cada vez que responde — no confrontes. Regístralo en las señales y sigue.</p>
        <div class="nav"><button class="pri" data-next type="button">Continuar</button></div>
      </div>`;

    st.querySelectorAll('[data-idc]').forEach(b => b.addEventListener('click', e => {
      const k = e.currentTarget.dataset.idc;
      if(k === 'shot') return;              // este se marca solo al subir la captura
      S.idc[k] = !S.idc[k]; touch(); render();
    }));
    if(cierre) montarCaptura();
  }

  else if(f.k === 'req'){
    const r = S.reqs[f.i];
    const meta = r.r || {};
    const dets = Array.isArray(meta.detalles) ? meta.detalles : [];
    const sen  = Array.isArray(meta.senales) ? meta.senales : [];
    const guion = S.mode==='A' ? DEFENSA : SONDA;
    const qMap = {1:null, 2:meta.q_escena, 3:meta.q_friccion, 5:meta.q_cruce};

    st.innerHTML = `
      <div class="card">
        <h2>${esc(r.n)}</h2>
        <div class="cs" style="margin-bottom:16px">Requisito ${f.i+1} de ${S.reqs.length} · unos 6 minutos · ${S.mode==='A'?'defensa del entregable':'sonda por experiencia'}</div>
        ${meta.criterio ? `<div class="say"><div class="lb">QUÉ BUSCAS OÍR</div><p style="font-style:normal">${esc(meta.criterio)}</p></div>` : ''}
        <div class="steps">
          ${guion.map((g,gi) => {
            const q = S.mode==='B' ? qMap[gi+1] : null;
            return `<div class="step"><div class="sn">${gi+1}</div><div class="sb">
              <div class="st">${g.t}</div>
              <div class="sd">${g.d.replace('[requisito]', esc(r.n))}</div>
              ${q ? `<div class="sq">“${esc(q)}”</div>` : ''}
            </div></div>`;
          }).join('')}
        </div>
        ${dets.length ? `<div class="detbox"><div class="dt">Detalles verificables — compara contra lo que responde</div>
          <div class="dets">${dets.map(d => `<div class="det"><span class="dq">${esc(d.detalle||'')}</span><span class="da">${esc(d.respuesta_esperada||'')}</span></div>`).join('')}</div></div>` : ''}
        ${sen.length ? `<div class="detbox"><div class="dt">Señales de impostor en este tema</div>
          <div class="sflags">${sen.map(s => `<span class="sflag">${esc(s)}</span>`).join('')}</div></div>` : ''}

        <div class="lvlttl">Calificación anclada — marca el nivel que corresponde a lo que viste</div>
        <div class="lvls">
          ${[1,2,3,4,5].map(v => `<button class="lv ${r.lvl===v?'sel':''}" data-lv="${v}" data-v="${v}" type="button"><div class="n">${v}</div><div class="t">${LVLTXT[v]}</div></button>`).join('')}
        </div>
        <div class="anchor" id="anchorBox">${r.lvl?ANCHORS[r.lvl]:'Pasa el cursor sobre un nivel para ver su ancla, o marca el que corresponda.'}</div>
        <textarea class="notes" data-notes placeholder="Evidencia textual: la escena que contó, la fricción que narró, los detalles que cuadraron o no. Esto va al acta.">${esc(r.ev||'')}</textarea>
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
          <div class="f"><label>En dos o tres frases</label><textarea data-r="texto" placeholder="Qué quedó medido y sostenido con evidencia, y cuál es la reserva si la hay.">${esc(rc.texto||'')}</textarea></div>
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
    // fase 0 = identidad, fase i+1 = requisito i
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
        ${S.reqs.map(r => {
          const v = r.lvl ? (r.lvl>=4?'ok':(r.lvl===3?'par':'no')) : 'nv';
          const tx = r.lvl ? LVLTXT[r.lvl] : 'SIN CALIFICAR';
          return `<div class="res"><div class="rn">${esc(r.n)}<small>${esc((r.ev||'').trim().slice(0,110)||'sin evidencia registrada')}${(r.ev||'').length>110?'…':''}</small></div>
                  <div class="rl">${r.lvl||'–'} / 5</div><span class="vd ${v}">${tx}</span></div>`;
        }).join('')}
      </div>

      <div class="card">
        <div class="sem ${sem}"><div class="lamp"></div><div><div class="st">${semT}</div><div class="sx">${semX}</div></div></div>
        ${nSig ? `<p class="hint" style="margin-top:12px"><b>Señales marcadas:</b> ${SIGNALS.filter(s=>S.sig[s.id]).map(s=>s.t).join(' · ')}</p>` : ''}
      </div>

      ${S.kind === 'cierre' ? bloqueIdentidad() : ''}

      <div class="card">
        <div class="fttl" style="margin-bottom:11px">Sin carpeta completa no hay acta</div>
        ${gate(idOk, 'Identidad verificada y grabación activa',
               faltaId.length ? `Falta${faltaId.length>1?'n':''}: ${faltaId.map(c=>esc(c.t.toLowerCase())).join(' · ')}` : '',
               faltaId.length ? 0 : null)}
        ${gate(allLvl, 'Todos los requisitos calificados',
               sinLvl.length ? `Sin nivel: ${sinLvl.map(x=>esc(x.r.n)).join(' · ')}` : '',
               sinLvl.length ? sinLvl[0].i+1 : null)}
        ${gate(evOk, 'Evidencia textual registrada en cada requisito',
               sinEv.length ? `Muy corta o vacía en: ${sinEv.map(x=>esc(x.r.n)).join(' · ')}` : '',
               sinEv.length ? sinEv[0].i+1 : null)}
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
    st.querySelector('#btnActa').addEventListener('click', emitirActa);
    st.querySelector('#btnJson').addEventListener('click', copiarJSON);
    if(S.kind === 'cierre'){
      montarIdentidad(st);
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
      ` : ''}

      <div class="tools" style="margin-top:12px">
        ${!enviada ? `<button class="pri" id="btnEnviarId" type="button">Generar link de verificación</button>` : ''}
        ${enviada ? `<button id="btnRefrescarId" type="button">Revisar si ya la hizo</button>` : ''}
        ${i.estado!=='verificada' && i.estado!=='rechazada' ? `<button id="btnRechazoId" type="button">El candidato no quiso</button>` : ''}
      </div>
    </div>`;
}

function montarIdentidad(st){
  const b1 = st.querySelector('#btnEnviarId');
  if(b1) b1.addEventListener('click', async () => {
    overlay(true, 'Creando la verificación…', 'Pidiéndole a Didit un link para este candidato.');
    try{
      const out = await api(`/api/sessions/${S.sid}/identidad`, {method:'POST', body:{
        email: S.mail || '', avisarPorCorreo: !!S.mail, publicUrl: location.origin,
      }});
      S.diditUrl = out.url;
      S.ident = {estado:'pendiente', texto:'Enviada, sin completar', didit_status: out.status};
      saveLocal(); render();
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
    if(fases()[S.fase].k === 'cierre') render();
  }catch(e){}
}

/* ===================== captura del rostro =====================
   El pantallazo se reduce en el navegador antes de subirlo: no hace falta mandar
   una imagen de 3 MB para comparar dos caras, y así el dato biométrico viaja lo mínimo. */
function montarCaptura(){
  const box = $('#shotBox'), file = $('#shotFile');
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
      if(!$('#shotBox')) return;
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
      const esc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * esc);
      c.height = Math.round(img.height * esc);
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
    S.idc.shot = true; touch(); render();
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

/* ===================== acta ===================== */
async function emitirActa(){
  overlay(true, 'Emitiendo el acta…', 'El servidor vuelve a revisar la regla antes de firmar.');
  try{
    const out = await api('/api/sessions/'+S.sid+'/issue', {method:'POST', body:{
      candidate: S.cand, identity: S.idc, signals: S.sig, data:{mode:S.mode},
      declara: S.dec || {}, recomendacion: S.rec || {},
      ratings: S.reqs.map(r => ({requirement_id:r.rid, req_text:r.n, level:r.lvl||null, evidence:r.ev||''})),
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
  const doc = S.doc || {titulo:'Informe de verificación', alcance:'', tipo:'acta'};
  const idn = S.ident || {};
  const cierre = S.kind === 'cierre';
  const idOk = cierre && idn.estado === 'verificada';
  const nogo = (dec.nogo||'').split('\n').map(x=>x.trim()).filter(Boolean);
  const riesgos = (rec.riesgos||[]).filter(x => (x.r||'').trim());
  const VER = {si:['ok','Recomendado'], reserva:['par','Recomendado con una reserva'], no:['no','No recomendado']}[rec.veredicto] || null;

  // Sellos: solo lo que de verdad se midió en esta sesión.
  const sellos = [
    cierre ? [idOk, idOk ? 'Identidad verificada' : 'Identidad no certificada'] : null,
    [true, 'Sesión supervisada en vivo'],
    [nSig === 0, nSig === 0 ? 'Sin señales de asistencia' : `${nSig} señal${nSig>1?'es':''} registrada${nSig>1?'s':''}`],
    [true, `${S.reqs.length} requisito${S.reqs.length>1?'s':''} medido${S.reqs.length>1?'s':''}`],
  ].filter(Boolean);

  $('#actaStage').innerHTML = `
    <div class="acta">
      <div class="ahd">
        <div>
          <svg class="iso actaiso" viewBox="0 0 174.8 90.4" role="img" aria-label="PeakU" focusable="false"><path class="b" d="M 126.84 54.14 C 131.82 58.32 139.23 57.67 143.40 52.70 L 125.39 37.59 C 121.22 42.56 121.87 49.97 126.84 54.14"/><path class="b" d="M 167.13 6.13 C 162.16 1.96 154.75 2.61 150.58 7.58 L 168.58 22.69 C 172.75 17.71 172.11 10.30 167.13 6.13"/><path class="b" d="M 152.02 24.14 C 147.05 19.96 146.40 12.55 150.58 7.58 L 125.39 37.59 C 129.57 32.62 136.98 31.97 141.95 36.14 C 146.93 40.31 147.57 47.73 143.40 52.70 L 168.58 22.69 C 164.41 27.66 157.00 28.31 152.02 24.14"/><path class="b" d="M 141.95 36.14 C 136.98 31.97 129.57 32.62 125.39 37.59 L 143.40 52.70 C 147.57 47.73 146.93 40.31 141.95 36.14"/><path class="b" d="M 152.02 24.14 C 157.00 28.31 164.41 27.66 168.58 22.69 L 150.58 7.58 C 146.40 12.55 147.05 19.96 152.02 24.14"/><path class="a" d="M 73.12 6.13 C 68.14 1.96 60.73 2.61 56.56 7.58 L 44.90 21.48 L 62.62 36.92 L 74.56 22.69 C 78.73 17.71 78.09 10.30 73.12 6.13"/><path class="a" d="M 120.12 6.13 C 115.15 1.96 107.74 2.61 103.57 7.58 L 121.57 22.69 C 125.75 17.71 125.10 10.30 120.12 6.13"/><path class="a" d="M 105.02 24.14 C 109.99 28.31 117.40 27.66 121.57 22.69 L 103.57 7.58 C 99.39 12.55 100.04 19.96 105.02 24.14"/><path class="a" d="M 53.21 67.60 L 62.98 55.95 C 60.76 58.59 56.82 58.94 54.17 56.72 C 51.53 54.50 51.18 50.55 53.40 47.91 L 24.20 82.71 C 23.55 83.49 22.80 84.15 22.00 84.72 L 21.99 84.75 C 21.99 84.75 33.67 76.08 34.11 75.75 C 36.51 74.02 39.46 72.99 42.66 72.99 C 42.65 72.99 42.65 72.99 42.64 72.99 L 42.68 72.99 C 42.67 72.99 42.66 72.99 42.66 72.99 C 46.39 73.00 50.01 74.67 50.94 78.48 L 50.94 78.48 C 49.87 74.83 50.58 70.73 53.21 67.60"/><path class="a" d="M 58.01 24.14 C 53.04 19.96 52.39 12.55 56.56 7.58 L 6.20 67.60 C 10.37 62.62 17.78 61.98 22.75 66.15 C 25.79 68.70 27.20 72.45 26.90 76.12 C 26.71 78.46 25.83 80.77 24.20 82.71 L 53.40 47.91 L 74.56 22.69 C 70.39 27.66 62.98 28.31 58.01 24.14"/><path class="a" d="M 22.75 66.15 C 17.78 61.98 10.37 62.62 6.20 67.60 C 2.02 72.57 2.67 79.98 7.64 84.16 C 11.84 87.67 17.75 87.75 22.01 84.72 C 22.80 84.15 23.55 83.49 24.20 82.71 C 25.83 80.77 26.71 78.46 26.90 76.12 C 27.20 72.45 25.79 68.70 22.75 66.15"/><path class="a" d="M 121.57 22.69 C 117.40 27.66 109.99 28.31 105.02 24.14 C 100.04 19.96 99.39 12.55 103.57 7.58 L 62.98 55.95 L 53.21 67.60 C 54.60 65.94 56.35 64.77 58.25 64.10 C 62.05 62.74 66.45 63.37 69.76 66.15 C 74.73 70.32 75.38 77.73 71.21 82.71 Z M 121.57 22.69"/><path class="a" d="M 69.76 66.15 C 66.45 63.37 62.05 62.74 58.25 64.10 C 56.35 64.77 54.60 65.94 53.21 67.60 C 50.58 70.73 49.87 74.83 50.94 78.48 C 51.57 80.62 52.82 82.61 54.66 84.16 C 59.62 88.33 67.04 87.68 71.21 82.71 C 75.38 77.73 74.73 70.32 69.76 66.15"/></svg>
          <h2>${esc(S.cand)}</h2>
          <div class="cert">${esc(doc.titulo)} · PeakU Verificado</div>
          <div class="rl2">${[esc(S.rol), S.cli && '<b>'+esc(S.cli)+'</b>'].filter(Boolean).join(' · ')}</div>
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

      ${(dec.ubicacion||dec.disponibilidad||dec.pretension) ? `<div class="datos">
        ${dec.ubicacion ? `<div class="dato"><b>Ubicación</b> · ${esc(dec.ubicacion)}</div>` : ''}
        ${dec.disponibilidad ? `<div class="dato"><b>Disponibilidad</b> · ${esc(dec.disponibilidad)}</div>` : ''}
        ${dec.pretension ? `<div class="dato"><b>Pretensión</b> · ${esc(dec.pretension)}</div>` : ''}
      </div>` : ''}

      <div class="zona"><span class="zn">Zona 1</span><h3>Lo que medimos</h3>
        <span class="zs">Evidencia de la sesión · escala anclada 1-5</span></div>
      <div class="zbox">
        ${S.reqs.map(r => {
          const v = r.lvl>=4?'ok':(r.lvl===3?'par':'no');
          return `<div class="req">
            <div class="reqhd">
              <div class="reqn">${esc(r.n)}</div>
              <div class="reqv"><span class="rl">${r.lvl} / 5</span><span class="vd ${v}">${LVLTXT[r.lvl]}</span></div>
            </div>
            <div class="barra"><span class="fill ${v}" style="width:${r.lvl*20}%"></span></div>
            ${r.ev?`<div class="aev">${esc(r.ev)}</div>`:''}
            <div class="ancla">${ANCLA_CORTA[r.lvl]||''}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="zona"><span class="zn">Integridad</span><h3>Cómo se sostuvo la sesión</h3></div>
      <div class="zbox">
        ${cierre ? actaIdentidad() : ''}
        <div class="res"><div class="rn">Señales de asistencia durante la sesión</div><span class="vd ${nSig?'par':'ok'}">${nSig?nSig+' REGISTRADA'+(nSig>1?'S':''):'NINGUNA'}</span></div>
        <div class="res"><div class="rn">Grabación y bitácora</div><span class="vd ok">DISPONIBLES</span></div>
        <div class="res"><div class="rn">Evidencia textual en cada requisito</div><span class="vd ok">REGISTRADA</span></div>
        ${nSig?`<div class="aev">Señales: ${SIGNALS.filter(s=>S.sig[s.id]).map(s=>esc(s.t)).join(' · ')}. Se reportan como observación factual; no constituyen un juicio sobre el candidato.</div>`:''}
      </div>

      ${(dec.motivacion || nogo.length || dec.procesos) ? `
      <div class="zona"><span class="zn">Zona 2</span><h3>Lo que ${esc(S.cand.split(' ')[0])} declara</h3>
        <span class="zs">Sus palabras, no nuestra medición</span></div>
      <div class="zbox dos">
        ${dec.motivacion ? `<div><div class="mini">Qué busca</div><p class="dtx">${esc(dec.motivacion)}</p>
          ${nogo.length ? `<div class="mini" style="margin-top:12px">No negociables</div>
            <ul class="lst">${nogo.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>` : ''}</div>` : '<div></div>'}
        <div>
          <div class="mini">Condiciones declaradas</div>
          ${dec.pretension ? `<div class="res"><div class="rn">Pretensión</div><span class="rl">${esc(dec.pretension)}</span></div>` : ''}
          ${dec.disponibilidad ? `<div class="res"><div class="rn">Disponibilidad</div><span class="rl">${esc(dec.disponibilidad)}</span></div>` : ''}
          ${dec.procesos ? `<div class="res"><div class="rn">Otros procesos activos</div><span class="rl">${esc(dec.procesos)}</span></div>` : ''}
          <p class="hint" style="margin-top:8px">No verificado contra desprendibles ni contra terceros.</p>
        </div>
      </div>` : ''}

      ${(VER || rec.texto || riesgos.length) ? `
      <div class="zona"><span class="zn">Zona 3</span><h3>Nuestra recomendación</h3>
        <span class="zs">Opinión del evaluador · lo único que no es medición</span></div>
      <div class="zbox rec">
        ${VER ? `<div class="recver"><span class="vd ${VER[0]}">${esc(VER[1].toUpperCase())}</span></div>` : ''}
        ${rec.texto ? `<p class="dtx" style="margin-top:${VER?'10px':'0'}">${esc(rec.texto)}</p>` : ''}
        ${riesgos.length ? `<div class="mini" style="margin-top:14px">Riesgos</div>
          ${riesgos.map(x=>`<div class="riesgo"><b>${esc(x.r)}</b>${x.m?`<span>Mitigación: ${esc(x.m)}</span>`:''}</div>`).join('')}` : ''}
      </div>` : ''}

      <div class="aback">
        <h4>PeakU responde por este informe.</h4>
        <p>${(doc.tipo === 'acta')
          ? `Si la persona no es quien este informe dice que es, o su desempeño no corresponde a lo aquí certificado dentro de los primeros 90 días, PeakU repone la búsqueda sin costo.`
          : `Si el desempeño no corresponde a lo aquí certificado dentro de los primeros 90 días, PeakU repone la búsqueda sin costo. <b>Este informe no certifica la identidad de la persona</b>: certifica lo observado sobre los requisitos del cargo.`} Verifique la autenticidad en <b>${esc(urlVerificacion(S.id))}</b>.</p>
        <span class="sig">Firma de integridad: ${esc(firmaCorta())} · Evaluó: ${esc(S.eval||'—')} · Revisión de calidad: pendiente de cuatro ojos · Rúbrica anclada 1-5</span>
      </div>
      <p class="hint" style="margin-top:14px">${esc(doc.alcance || '')} Metodología: entrevista estructurada con escalas ancladas (1-5) sobre los requisitos definidos por el cliente${
        (doc.tipo === 'acta') ? '; identidad verificada por proveedor externo y cotejada contra el rostro de la sesión' : ''}; sesión grabada y archivada.</p>
    </div>
    <div class="tools" style="margin-top:14px">
      <button data-back type="button">${S.soloLectura ? 'Volver a la lista' : 'Volver al cierre'}</button>
      <button class="pri" id="btnPrint" type="button">Imprimir o guardar en PDF</button>
      <button id="btnJson2" type="button">Copiar JSON del archivo</button>
    </div>`;
  $('#actaStage').querySelector('[data-back]').addEventListener('click', () => {
    if(S.soloLectura){ loadTablero(); return; }
    go('vLive'); render();
  });
  $('#actaStage').querySelector('#btnPrint').addEventListener('click', () => window.print());
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
  $('#btnVerSesiones').addEventListener('click', () => { document.getElementById('sesCard').scrollIntoView({behavior:'smooth'}); });
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

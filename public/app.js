// Peaku Sandler Coach — SPA
// Estado del deal en construcción (persistido en localStorage por si recargan)
const LS_KEY = 'peaku.sandler.draft.v1';

const SEGMENTS = {
  A: { code: 'A', label: 'Micro / Persona natural', short: 'Micro' },
  B: { code: 'B', label: 'Pequeña / Mediana (sweet spot)', short: 'PyME' },
  C: { code: 'C', label: 'Empresa grande', short: 'Grande' },
};

// Catálogo de módulos / features que Peaku tiene
const PEAKU_FEATURES = [
  { key: 'sourcing', label: 'Sourcing automático de candidatos' },
  { key: 'ia_ranking', label: 'Motor de selección IA (scoring/ranking)' },
  { key: 'pipeline', label: 'Gestión de vacante / pipeline' },
  { key: 'integracion_ats', label: 'Integración con ATS (SAP SF, Workday, etc.)' },
  { key: 'analitica', label: 'Analítica de fuentes y calidad' },
  { key: 'rapidez', label: 'Plug-and-play / primer candidato en minutos' },
  { key: 'roi_view', label: 'Comparativo ROI vs bolsas/agencias' },
];

// Recomendación de qué mostrar por segmento (extraído de la guía)
const SHOW_BY_SEGMENT = {
  A: ['sourcing', 'ia_ranking', 'rapidez'],
  B: ['sourcing', 'ia_ranking', 'pipeline', 'roi_view'],
  C: ['sourcing', 'ia_ranking', 'integracion_ats', 'analitica'],
};
const DONT_SHOW_BY_SEGMENT = {
  A: ['integracion_ats', 'pipeline', 'analitica'],
  B: [],
  C: ['pipeline'], // si ya tiene ATS no le muestres pipeline puro
};

// Defaults
function newDraft() {
  return {
    executive: '',
    company: '',
    lineaNegocio: '',      // SaaS / Headhunting / EOR
    // Ficha previa SDR (contrato previo Nº 1) — obligatoria para agendar demo
    fichaCargos: '',        // cargos requeridos por el cliente
    fichaCosto: '',         // costo estimado de la vacante abierta
    fichaHerramientas: '',  // herramientas actuales
    // Fase 1 - Construcción
    contratoPrevio: '',
    vinculo: '',
    // Calificación rápida
    qualif: {
      volumen: '',
      equipoRrhh: '',
      perfiles: '',
      herramienta: '',
      decisor_quien: '',
    },
    hasAts: false,
    atsName: '',
    segment: '',           // A | B | C
    // Fase 2 - Dolor + EMBUDO DEL DOLOR
    dolor: '',                    // dolor principal identificado
    dolorCuantificar: '',         // ¿cuánto cuesta al mes?
    dolorHistoria: '',            // ¿qué han intentado y por qué no funcionó?
    dolorImpacto: '',             // ¿qué pasa con el cliente/equipo?
    impactoEconomico: '',
    consecuenciasEmocionales: '',
    medicion: '',
    integraciones: '',
    // Presupuesto / Decisión
    presupuesto: '',
    decisor: '',
    procesoDecision: '',
    fechaLimiteDecision: '',      // YYYY-MM-DD (contrato previo Nº 2)
    // Lo que el cliente pidió en su ideal
    idealRequests: [],
    // Cierre
    proximoPasoTipo: '',          // 'piloto' | 'cotizacion' | 'nutricion'
    pilotoCargo: '',              // vacante que se publicará esta semana
    pilotoFechaRevision: '',      // fecha de revisión de resultados
    postVenta: '',
    proximoPaso: '',
  };
}

let state = loadDraft() || newDraft();
let stepIdx = 0;
const STEPS = [
  { key: 'ficha',     label: '0 · Ficha previa (SDR)' },
  { key: 'intro',     label: '1 · Construcción' },
  { key: 'qualif',    label: '2 · Calificación' },
  { key: 'segment',   label: '3 · Segmento' },
  { key: 'discovery', label: '4 · Embudo del dolor' },
  { key: 'budget',    label: '5 · Presupuesto / Decisión' },
  { key: 'ideal',     label: '6 · Pedidos del cliente' },
  { key: 'close',     label: '7 · Cierre + Piloto' },
  { key: 'result',    label: '8 · Calificación Sandler' },
];

// ---------- Helpers de calificación ----------
function has(s) { return !!(s && String(s).trim()); }
function painFunnel(d) {
  const c = has(d.dolorCuantificar);
  const h = has(d.dolorHistoria);
  const i = has(d.dolorImpacto);
  const n = [c, h, i].filter(Boolean).length;
  return { c, h, i, count: n, ok: n >= 2 };
}
function calificacion(d) {
  const pf = painFunnel(d);
  const items = {
    dolor: pf.ok,
    presupuesto: has(d.presupuesto),
    decision: has(d.decisor) && has(d.procesoDecision),
    fecha: has(d.fechaLimiteDecision),
  };
  const done = Object.values(items).filter(Boolean).length;
  let label = 'No califica';
  if (done >= 4) label = 'Completa';
  else if (done >= 2) label = 'Parcial';
  return { label, done, of: 4, pf, items };
}
function daysBetween(a, b) { return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }

// ---------- Router ----------
function router() {
  const hash = location.hash || '#/';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
  if (hash.startsWith('#/deal/')) return renderDealDetail(hash.split('/')[2]);
  if (hash === '#/deals') return renderDeals();
  if (hash === '#/wishlist') return renderWishlist();
  return renderWizard();
}
window.addEventListener('hashchange', router);

// ---------- Persistence ----------
function saveDraft() { try { localStorage.setItem(LS_KEY, JSON.stringify({ state, stepIdx })); } catch {} }
function loadDraft() {
  try {
    const raw = localStorage.getItem(LS_KEY); if (!raw) return null;
    const o = JSON.parse(raw); stepIdx = o.stepIdx || 0; return o.state;
  } catch { return null; }
}
function clearDraft() { localStorage.removeItem(LS_KEY); state = newDraft(); stepIdx = 0; }

// ---------- Segmentación automática ----------
function autoSegment(q) {
  const vol = (q.volumen || '').toLowerCase();
  const eq = (q.equipoRrhh || '').toLowerCase();
  const tool = (q.herramienta || '').toLowerCase();
  let score = { A: 0, B: 0, C: 0 };
  // volumen
  if (/(0|esporadi|al año|pocas|1-2|2-5)/.test(vol)) score.A += 2;
  if (/(varias al mes|5-20|10|20|pyme|creciente|mediana)/.test(vol)) score.B += 2;
  if (/(alto|100|cientos|miles|continuo)/.test(vol)) score.C += 2;
  // equipo
  if (/(0|1|dueñ|yo|solo)/.test(eq)) score.A += 2;
  if (/(2|3|4|5|pequeño)/.test(eq)) score.B += 2;
  if (/(estructur|área|area|ta|equipo grande|\+5|10\+)/.test(eq)) score.C += 2;
  // herramienta
  if (/(excel|whatsapp|nada|linkedin manual)/.test(tool)) score.A += 1;
  if (/(bolsa|computrabajo|linkedin|hoja)/.test(tool)) score.B += 1;
  if (/(success|workday|greenhouse|sap|bamboo|ats|kenexa|recluit|lever)/.test(tool)) score.C += 2;
  let best = 'B', max = -1;
  for (const k of ['A','B','C']) { if (score[k] > max) { max = score[k]; best = k; } }
  // detectar ATS
  const hasAts = /(success|workday|greenhouse|sap|bamboo|ats|lever|kenexa|recluit)/.test(tool);
  return { segment: best, hasAts, atsGuess: hasAts ? tool : '' };
}

// ---------- Render helpers ----------
const el = document.getElementById('app');
function h(html) { el.innerHTML = html; }

function stepHeader() {
  return `<div class="steps">
    ${STEPS.map((s,i) => `<span class="step ${i===stepIdx?'active':''} ${i<stepIdx?'done':''}">${s.label}</span>`).join('')}
  </div>`;
}
function navButtons({ prevHidden=false, nextLabel='Siguiente', onNext='next' } = {}) {
  return `<div class="btn-row">
    ${prevHidden ? '<div></div>' : '<button class="btn ghost" data-act="prev">← Atrás</button>'}
    <div style="display:flex;gap:10px;">
      <button class="btn secondary" data-act="save">Guardar borrador</button>
      <button class="btn" data-act="${onNext}">${nextLabel} →</button>
    </div>
  </div>`;
}
function bindForm() {
  el.querySelectorAll('[data-field]').forEach(inp => {
    inp.addEventListener('input', e => {
      const path = inp.getAttribute('data-field').split('.');
      let cur = state;
      for (let i=0;i<path.length-1;i++) { cur[path[i]] = cur[path[i]] || {}; cur = cur[path[i]]; }
      const v = inp.type === 'checkbox' ? inp.checked : inp.value;
      cur[path[path.length-1]] = v;
      saveDraft();
    });
  });
  el.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => {
    const a = b.getAttribute('data-act');
    if (a === 'prev') { stepIdx = Math.max(0, stepIdx - 1); saveDraft(); renderWizard(); }
    else if (a === 'next') { stepIdx = Math.min(STEPS.length - 1, stepIdx + 1); saveDraft(); renderWizard(); }
    else if (a === 'save') { saveDraft(); flashSaved(b); }
    else if (a === 'segment_confirm') {
      const seg = el.querySelector('[data-pick-segment].selected');
      if (seg) state.segment = seg.getAttribute('data-pick-segment');
      stepIdx++; saveDraft(); renderWizard();
    }
    else if (a === 'finish') { submitDeal(); }
    else if (a === 'new') { clearDraft(); renderWizard(); }
  }));
  el.querySelectorAll('[data-pick-segment]').forEach(c => c.addEventListener('click', () => {
    el.querySelectorAll('[data-pick-segment]').forEach(x => x.classList.remove('selected'));
    c.classList.add('selected');
  }));
}
function flashSaved(btn) {
  const t = btn.textContent; btn.textContent = '✓ Guardado'; setTimeout(()=> btn.textContent = t, 1200);
}

// ---------- Steps ----------
function renderWizard() {
  const s = STEPS[stepIdx].key;
  if (s === 'ficha')     return stepFicha();
  if (s === 'intro')     return stepIntro();
  if (s === 'qualif')    return stepQualif();
  if (s === 'segment')   return stepSegment();
  if (s === 'discovery') return stepDiscovery();
  if (s === 'budget')    return stepBudget();
  if (s === 'ideal')     return stepIdeal();
  if (s === 'close')     return stepClose();
  if (s === 'result')    return stepResult();
}

// ---------- 0 · Ficha previa (SDR) ----------
function stepFicha() {
  const fichaOk = has(state.fichaCargos) && has(state.fichaCosto) && has(state.fichaHerramientas) && has(state.lineaNegocio);
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Ficha previa · Contrato previo Nº 1</h1>
      <p class="muted"><strong>Regla del proceso:</strong> el demo solo se agenda con esta ficha llena por prospección. Sin ficha, no hay demo.</p>

      <div class="row">
        <div>
          <label>Tu nombre ${tip('Ejecutivo comercial que llevará el demo.')}</label>
          <input type="text" data-field="executive" value="${esc(state.executive)}" placeholder="Ej. Santiago Pérez" />
        </div>
        <div>
          <label>Empresa / Cliente ${tip('Razón social del cliente prospecto.\n\nEj.: "Lean Solutions S.A."')}</label>
          <input type="text" data-field="company" value="${esc(state.company)}" placeholder="Ej. Lean Solutions" />
        </div>
      </div>

      <label>Línea de negocio ${tip('Determina qué se le va a mostrar y qué comparativos usar.\n\n• SaaS: la plataforma de sourcing + IA.\n• Headhunting: servicio de reclutamiento a la medida.\n• EOR: employer of record.')}</label>
      <div class="chips">
        ${['SaaS', 'Headhunting', 'EOR'].map(k => `
          <div class="chip ${state.lineaNegocio === k ? 'selected' : ''}" data-pick-linea="${k}">${k}</div>
        `).join('')}
      </div>

      <h3 style="margin-top: 22px;">Datos que dio prospección</h3>
      <label>Cargos requeridos que el cliente necesita cubrir ${tip('Vacantes reales del cliente hoy. Sin esto no calificamos el demo.\n\nEj.: "3 devs full-stack senior, 1 líder de operaciones, 5 SDRs bilingües."')}</label>
      <textarea data-field="fichaCargos" placeholder="Ej. 3 devs senior full-stack, 1 líder de ops, 5 SDRs bilingües.">${esc(state.fichaCargos)}</textarea>

      <label>Costo estimado de la vacante abierta ${tip('Cuánto le cuesta al mes tener esa vacante abierta (o cuánto valen las agencias que están pagando). Es el ancla del precio en el demo.\n\nEj.: "Perder al dev senior = 3-5M COP/mes en oportunidad. Pagan 8M COP por cabeza a agencias."')}</label>
      <textarea data-field="fichaCosto" placeholder="Ej. Vacante técnica abierta = 4M/mes en oportunidad; agencias les cobran 8M/cabeza.">${esc(state.fichaCosto)}</textarea>

      <label>Herramientas actuales del cliente ${tip('Todo lo que usan hoy para reclutar. Determina si es sourcing manual, con bolsas, con ATS.\n\nEj.: "Computrabajo + LinkedIn Recruiter + Excel"')}</label>
      <textarea data-field="fichaHerramientas" placeholder="Ej. Computrabajo + LinkedIn Recruiter + Excel">${esc(state.fichaHerramientas)}</textarea>

      ${fichaOk ? '<div class="hint" style="margin-top:14px;background:#e8f6f0;border-left-color:var(--peaku-green);">✓ Ficha completa. Puedes agendar el demo.</div>' : '<div class="hint" style="margin-top:14px;background:#fdecec;border-left-color:var(--bad);color:var(--bad);"><strong>Ficha incompleta.</strong> Sin los 4 campos (línea + 3 datos) no debería haber demo agendado.</div>'}
    </div>
    ${navButtons({ prevHidden: true })}
  `);
  bindForm();
  el.querySelectorAll('[data-pick-linea]').forEach(c => c.addEventListener('click', () => {
    state.lineaNegocio = c.getAttribute('data-pick-linea');
    saveDraft(); renderWizard();
  }));
}

function stepIntro() {
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Fase 1 · Construcción de confianza</h1>
      <p class="muted">Antes de meter preguntas, escribe el contrato previo de la reunión y cómo está la relación. <strong>Escucha 70%, habla 30%.</strong></p>

      <p class="muted" style="margin-bottom:14px;font-size:13px;">Ficha previa lista ✓ · Ejecutivo: <strong>${esc(state.executive) || '—'}</strong> · Cliente: <strong>${esc(state.company) || '—'}</strong></p>

      <label>Contrato previo acordado ${tip('FUNDAMENTAL Sandler. Acuerdo explícito al inicio: duración, agenda, qué buscan ambos, y el permiso para que cualquiera diga "no" si no hay ajuste.\n\nEj.: "Acordamos 30 min. Yo entiendo su proceso actual y sus dolores; ellos deciden al final si tiene sentido una segunda reunión. Acordado que pueden decir que no sin problema."')}<span class="opt">(tiempo, agenda, permiso para decir "no")</span></label>
      <textarea data-field="contratoPrevio" placeholder="Ej. 30 min, entiendo su proceso y dolores; al final ellos deciden si avanzamos. Acordado que pueden decir 'no'.">${esc(state.contratoPrevio)}</textarea>

      <label>Vínculo / rapport inicial ${tip('Nice-to-have. Cómo rompiste el hielo y generaste relación par a par. Ayuda a contextualizar el deal.\n\nEj.: "Hablamos 5 min de su expansión a Cali, ambos conocemos al gerente de RRHH del Grupo Éxito. Tono cálido, conversación par a par."')}<span class="opt">(opcional, nice-to-have)</span></label>
      <textarea data-field="vinculo" placeholder="Ej. hablamos de su expansión, conocemos personas en común, tono cálido.">${esc(state.vinculo)}</textarea>
    </div>
    ${navButtons()}
  `);
  bindForm();
}

function stepQualif() {
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Calificación rápida</h1>
      <p class="muted">5 preguntas en menos de 3 minutos para saber en qué segmento está.</p>

      <label>1. ¿Cuántas personas contratan al mes / al año? ${tip('Determina volumen del segmento. Indica si es Micro (pocas al año), PyME (varias al mes) o Grande (alto volumen continuo).\n\nEjemplos:\n• Micro: "2-3 al año, esporádicas"\n• PyME: "10-15 al mes, vacantes varias"\n• Grande: "200+ al mes, continuo"')}</label>
      <input type="text" data-field="qualif.volumen" value="${esc(state.qualif.volumen)}" placeholder="Ej. 10 al mes, 50 al año, esporádicas..." />

      <label>2. ¿Cuántas personas en el equipo se dedican a reclutar / seleccionar? ${tip('Tamaño del equipo de Talent Acquisition.\n\nEjemplos:\n• Micro: "el dueño mismo, no hay equipo"\n• PyME: "2-3 personas en RRHH"\n• Grande: "área de TA estructurada con 8 reclutadores + líder"')}</label>
      <input type="text" data-field="qualif.equipoRrhh" value="${esc(state.qualif.equipoRrhh)}" placeholder="Ej. el dueño, 2 personas, área estructurada..." />

      <label>3. ¿Qué tipo de perfiles contratan más? ${tip('Determina si el dolor está en sourcing masivo o screening de perfiles especializados.\n\nEjemplos:\n• "Mayormente operativos: meseros, despachadores, vendedores"\n• "Técnicos: desarrolladores, data engineers"\n• "Profesionales: gerentes, analistas senior"')}<span class="opt">(operativos/masivos, técnicos, profesionales)</span></label>
      <input type="text" data-field="qualif.perfiles" value="${esc(state.qualif.perfiles)}" placeholder="Ej. mayormente operativos masivos; algunos técnicos" />

      <label>4. ¿Con qué herramienta manejan hoy el reclutamiento? ${tip('🔑 PREGUNTA LLAVE. Define dramáticamente el segmento y si tienen ATS.\n\nEjemplos:\n• Micro: "Excel + WhatsApp + LinkedIn manual"\n• PyME: "Computrabajo + LinkedIn Recruiter + hoja de cálculo"\n• Grande: "SAP SuccessFactors para gestión, sourcing manual con agencias"')}<span class="opt">(define mucho el segmento)</span></label>
      <input type="text" data-field="qualif.herramienta" value="${esc(state.qualif.herramienta)}" placeholder="Excel, LinkedIn, bolsas, SAP SuccessFactors, Workday..." />

      <label>5. ¿Quién decide la compra de una herramienta así? ${tip('Identifica el decisor temprano para no perder tiempo. Diferencia entre dueño, jefe de RRHH solo, o comité con compras.\n\nEjemplos:\n• "El dueño, decide ya"\n• "El jefe de RRHH propone, gerencia general aprueba"\n• "Comité: líder de TA + finanzas + compras. Toma 6-8 semanas"')}</label>
      <input type="text" data-field="qualif.decisor_quien" value="${esc(state.qualif.decisor_quien)}" placeholder="Ej. el jefe de RRHH, comité con compras..." />
    </div>
    ${navButtons({ nextLabel: 'Detectar segmento' })}
  `);
  bindForm();
}

function stepSegment() {
  const auto = autoSegment(state.qualif);
  if (!state.segment) state.segment = auto.segment;
  state.hasAts = auto.hasAts;
  saveDraft();

  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Segmento detectado</h1>
      <p class="muted">Confirma o ajusta. Esto define qué preguntas hacer y qué mostrar del demo.</p>

      <div class="chips">
        ${['A','B','C'].map(k => `
          <div class="chip ${k === state.segment ? 'selected' : ''}" data-pick-segment="${k}">
            <strong>${k}</strong> · ${SEGMENTS[k].label}
          </div>
        `).join('')}
      </div>

      <div class="hint" style="margin-top:18px;">
        <strong>Heurística:</strong> volumen "${esc(state.qualif.volumen || '—')}", equipo "${esc(state.qualif.equipoRrhh || '—')}", herramienta "${esc(state.qualif.herramienta || '—')}".
        ${auto.hasAts ? `<br/><strong>⚠ Tiene ATS detectado.</strong> Posiciónate como capa de sourcing + IA, no como reemplazo.` : ''}
      </div>

      ${auto.hasAts ? `
        <label>¿Cuál ATS y para qué lo usan principalmente? ${tip('Crítico para Segmento C. La mayoría de ATS gestionan pipeline pero NO hacen sourcing ni selección con IA — ahí entra Peaku.\n\nEj.: "SAP SuccessFactors, lo usan solo para gestionar el pipeline y cumplimiento. El sourcing lo hacen aparte con agencias. No tiene IA de ranking."')}</label>
        <input type="text" data-field="atsName" value="${esc(state.atsName || state.qualif.herramienta)}" placeholder="SAP SF para pipeline; sourcing aparte con agencias..." />
      ` : ''}
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-act="prev">← Atrás</button>
      <div style="display:flex;gap:10px;">
        <button class="btn secondary" data-act="save">Guardar borrador</button>
        <button class="btn" data-act="segment_confirm">Continuar →</button>
      </div>
    </div>
  `);
  bindForm();
}

function stepDiscovery() {
  const seg = state.segment || 'B';
  const isC = seg === 'C';
  const isA = seg === 'A';

  // Preguntas específicas por segmento (de la guía)
  const preguntas = isA ? [
    '¿Cada cuánto necesitas contratar y para qué cargos?',
    '¿Cómo buscas candidatos hoy y cuánto tiempo te toma?',
    '¿Qué es lo más frustrante de ese proceso?',
    '¿Qué pasa cuando no se lleva a cabo la contratación en el tiempo estimado?',
  ] : isC ? [
    '¿El ATS les ayuda a CONSEGUIR candidatos o solo a gestionarlos? ← llave',
    '¿Hace ranking/scoring con IA, o lo hacen los reclutadores a mano?',
    '¿Cómo hacen sourcing hoy (manual, agencias, bolsas)?',
    '¿Cuántas horas gastan los reclutadores en screening inicial?',
    '¿Dónde se traba el embudo: volumen, calidad o velocidad?',
    '¿Tienen vacantes difíciles o de alto volumen sin cubrir?',
    '¿El ATS se integra por API? ¿Han integrado herramientas externas?',
  ] : [
    '¿Cuántas vacantes tienen abiertas al mismo tiempo?',
    '¿Cuánto se demoran en promedio en llenar una vacante (time-to-fill)?',
    '¿Qué pasa en el negocio cuando una vacante se queda abierta?',
    '¿Cómo consiguen candidatos hoy (bolsas, LinkedIn, agencias)?',
    '¿Tienen forma de medir su proceso (fuentes, conversión, tiempos)?',
  ];

  const pf = painFunnel(state);
  const badge = pf.ok
    ? `<span class="pill good">Embudo del dolor OK · ${pf.count}/3</span>`
    : `<span class="pill bad">Embudo incompleto · ${pf.count}/3 (mín. 2)</span>`;

  h(`
    ${stepHeader()}
    <div class="card">
      <div class="split"><h1>Embudo del dolor <span class="segment-badge ${seg}">Segmento ${seg}</span></h1>${badge}</div>
      <p class="muted"><strong>Regla del proceso:</strong> cuando el cliente menciona un dolor, la conversación se detiene ahí. <strong>Mínimo 2 de estas 3 preguntas</strong> antes de continuar. Un dolor sin desarrollar no ancla ni demo ni precio ni urgencia.</p>

      <div class="hint">
        <strong>Preguntas guía para este segmento:</strong>
        <ul style="margin:6px 0 0 18px; padding: 0;">
          ${preguntas.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>

      <label>Dolor principal identificado ${tip('El problema concreto y textual que confesó el cliente. NO lo parafrasees — cópialo tal cual, en sus palabras.\n\nMal: "problemas contratando"\nBien (Lean Solutions, MIN 17:29): "Encontrar profesionales bilingües especializados en logística se complica porque somos los más grandes del sector."')}<span class="opt">(cópialo textual)</span></label>
      <textarea data-field="dolor" placeholder="Textual, en las palabras del cliente.">${esc(state.dolor)}</textarea>

      <h3 style="margin-top: 24px;">Embudo del dolor · las 3 preguntas de proceso</h3>

      <label>1. Cuantificar ${tip('🎯 La MÁS importante. La respuesta se convierte en el ancla del precio: "esto les cuesta X al mes; nuestra solución cuesta Y."\n\nPregunta al cliente: "¿Cuánto les cuesta al mes tener abierta una vacante así?" o "¿Cuántas requisiciones como esta se les vencen?"\n\nEj. respuesta: "Cada vacante técnica abierta pierde ~5M COP/mes en proyectos que no arrancan. Este año llevamos 4 vacantes vencidas."')}<span class="opt">(¿cuánto cuesta al mes?)</span></label>
      <textarea data-field="dolorCuantificar" placeholder="Ej. 5M COP/mes en oportunidad por vacante; 4 vacantes vencidas este año = 20M COP.">${esc(state.dolorCuantificar)}</textarea>

      <label>2. Historia ${tip('Qué ya intentaron y por qué no funcionó. Te dice contra qué compites y qué NO volver a proponer.\n\nPregunta al cliente: "¿Qué han intentado para resolverlo y por qué no ha funcionado?"\n\nEj. respuesta: "Probaron 2 agencias, cobran 15% del salario pero traen candidatos mediocres. Contrataron un reclutador in-house pero renunció en 3 meses."')}<span class="opt">(¿qué intentaron y por qué no funcionó?)</span></label>
      <textarea data-field="dolorHistoria" placeholder="Ej. 2 agencias caras y con calidad baja; reclutador in-house que renunció.">${esc(state.dolorHistoria)}</textarea>

      <label>3. Impacto ${tip('Qué pasa con el cliente final, con el equipo o con el negocio cuando el dolor no se resuelve. La consecuencia emocional/humana potencia el cierre.\n\nPregunta al cliente: "¿Qué pasa con el cliente final — o con el equipo — cuando ese cargo no aparece a tiempo?"\n\nEj. respuesta: "Pierdo el contrato con Ecopetrol si no arrancamos en 2 semanas. El equipo actual ya hace horas extra y renunciaron 2 en el último mes por burnout."')}<span class="opt">(¿qué pasa con el cliente / equipo?)</span></label>
      <textarea data-field="dolorImpacto" placeholder="Ej. perdemos contrato Ecopetrol si no arrancamos en 2 sem; equipo quemado, 2 renuncias.">${esc(state.dolorImpacto)}</textarea>

      <h3 style="margin-top: 24px;">Extras (nice-to-have)</h3>

      <label>Consecuencias emocionales adicionales ${tip('Frustración específica del decisor, presión de su jefe, riesgo personal.\n\nEj.: "La gerente de RRHH está bajo revisión de desempeño por esto."')}<span class="opt">(opcional)</span></label>
      <textarea data-field="consecuenciasEmocionales" placeholder="Ej. gerente RRHH bajo revisión de desempeño por los tiempos.">${esc(state.consecuenciasEmocionales)}</textarea>

      <label>¿Cómo miden el proceso hoy? ${tip('Si no miden, es venta de analítica. Si miden, entiendes qué dolores les son visibles.')}<span class="opt">(opcional)</span></label>
      <textarea data-field="medicion" placeholder="Ej. miden time-to-fill manualmente; no miden fuentes ni conversión.">${esc(state.medicion)}</textarea>

      ${isC ? `
        <label>Integraciones / API del ATS ${tip('Solo Segmento C. Define si podemos ser capa sobre el ATS.')}<span class="opt">(solo Segmento C)</span></label>
        <textarea data-field="integraciones" placeholder="Ej. SAP SF con API REST; IT revisa seguridad ~3 semanas.">${esc(state.integraciones)}</textarea>
      ` : ''}
    </div>
    ${navButtons()}
  `);
  bindForm();
}

function stepBudget() {
  const cal = calificacion(state);
  const anclaBase = state.dolorCuantificar || state.fichaCosto || '';
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Presupuesto y decisión</h1>
      <p class="muted"><strong>Regla del proceso:</strong> este bloque es contrato previo Nº 2. Sin fecha límite acordada con el cliente, no hay cotización.</p>

      ${anclaBase ? `<div class="hint"><strong>Ancla del dolor cuantificado:</strong> "${esc(anclaBase)}"<br/>Úsalo aquí para presentar precio: <em>"si esto les cuesta X al mes, la modalidad de Peaku que resuelve esto arranca en Y."</em></div>` : `<div class="hint" style="background:#fef3e2;border-left-color:var(--warn);"><strong>⚠ No tienes ancla cuantificada.</strong> Sin número de dolor, cualquier precio se evalúa como gasto puro. Vuelve al embudo del dolor.</div>`}

      <label>Presupuesto ${tip('¿Tiene presupuesto asignado? ¿Cuánto? ¿Comparado con qué alternativa?\n\nEj.: "50M COP/año en stack RRHH; hoy gastan 30M en agencias. Comparan con Bumeran."')}</label>
      <textarea data-field="presupuesto" placeholder="Ej. 50M COP/año asignados; hoy gastan 30M en agencias.">${esc(state.presupuesto)}</textarea>

      <label>Decisor / decisores ${tip('Nombres y roles. ¿Hay comité? ¿Pasa por compras? ¿Quién firma realmente?\n\nEj.: "María (TA, champion), Carlos (gte RRHH, aprueba), Lucía (compras)."')}</label>
      <textarea data-field="decisor" placeholder="Ej. María (TA, champion), Carlos (gte RRHH, aprueba), Lucía (compras).">${esc(state.decisor)}</textarea>

      <label>Proceso de decisión ${tip('Pasos internos, plazos, criterios. Te dice cuándo cerrará y qué tienes que entregar.')}</label>
      <textarea data-field="procesoDecision" placeholder="Ej. próximo paso con Carlos; si aprueba, compras 2 sem; necesitan propuesta + caso éxito.">${esc(state.procesoDecision)}</textarea>

      <label>Fecha límite de decisión ${tip('🔑 CRÍTICO. Fecha acordada con el cliente en el demo: "¿para cuándo necesitan esto resuelto?"\n\nRegla del proceso:\n• Máximo 14 días desde la cotización.\n• Sin esta fecha NO se envía cotización.\n• Después del día 14 el cierre baja dramáticamente; día 30 va a breakup.')}<span class="opt">(contrato previo Nº 2)</span></label>
      <input type="date" data-field="fechaLimiteDecision" value="${esc(state.fechaLimiteDecision)}" />

      <div style="margin-top:14px;">
        <strong style="font-size:13px;color:var(--peaku-gray);">Estado de calificación Sandler:</strong>
        <span class="pill ${cal.label === 'Completa' ? 'good' : (cal.label === 'Parcial' ? 'warn' : 'bad')}">${cal.label} · ${cal.done}/${cal.of}</span>
      </div>
    </div>
    ${navButtons()}
  `);
  bindForm();
}

function stepIdeal() {
  const items = state.idealRequests.length ? state.idealRequests : [{ text: '', weHave: false }];
  state.idealRequests = items;
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Lo que el cliente pidió en su ideal ${tip('Lista CADA cosa que el cliente mencionó como "me encantaría", "necesitaría", "ojalá tuviera". Una línea por pedido. Marca el toggle si ya lo tenemos en Peaku.\n\nEsto alimenta el wishlist agregado por segmento (ranking de lo más pedido) que después usas para roadmap.\n\nEjemplos de pedidos típicos:\n• "Notificaciones por WhatsApp a candidatos"\n• "Reportes exportables a Power BI"\n• "Filtro por experiencia mínima específica"\n• "Integración con Microsoft Teams"\n• "Multi-empresa en una sola cuenta"')}</h1>
      <p class="muted">Lista cada cosa que dijo que necesitaría/le encantaría. Marca si lo tenemos hoy. Esto alimenta el wishlist por segmento.</p>

      <div id="ideal-list">
        ${items.map((it, i) => `
          <div class="ideal-item">
            <input type="text" data-ideal-text="${i}" value="${esc(it.text)}" placeholder="Ej. integración con WhatsApp para responder candidatos" />
            <label class="toggle"><input type="checkbox" data-ideal-have="${i}" ${it.weHave?'checked':''}/> lo tenemos</label>
            <button class="btn ghost" data-ideal-del="${i}" title="Eliminar">✕</button>
          </div>
        `).join('')}
      </div>
      <button class="btn secondary" id="add-ideal" style="margin-top:10px;">+ Agregar pedido</button>
    </div>
    ${navButtons()}
  `);
  bindForm();
  el.querySelectorAll('[data-ideal-text]').forEach(i => i.addEventListener('input', e => {
    state.idealRequests[+i.dataset.idealText].text = i.value; saveDraft();
  }));
  el.querySelectorAll('[data-ideal-have]').forEach(i => i.addEventListener('change', e => {
    state.idealRequests[+i.dataset.idealHave].weHave = i.checked; saveDraft();
  }));
  el.querySelectorAll('[data-ideal-del]').forEach(i => i.addEventListener('click', e => {
    state.idealRequests.splice(+i.dataset.idealDel, 1); saveDraft(); renderWizard();
  }));
  el.querySelector('#add-ideal').addEventListener('click', () => {
    state.idealRequests.push({ text: '', weHave: false }); saveDraft(); renderWizard();
  });
}

function stepClose() {
  const cal = calificacion(state);
  const califica = cal.label === 'Completa';
  const tipoAct = state.proximoPasoTipo || (califica ? 'piloto' : 'nutricion');
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Fase 3 · Cierre + Piloto</h1>
      <p class="muted"><strong>Regla del proceso:</strong> los próximos pasos los propones tú (nunca el cliente los dicta). La cotización viaja de anexo del piloto, nunca al revés.</p>

      <div style="margin: 8px 0 14px;">
        <strong style="font-size:13px;color:var(--peaku-gray);">Calificación Sandler:</strong>
        <span class="pill ${cal.label === 'Completa' ? 'good' : (cal.label === 'Parcial' ? 'warn' : 'bad')}">${cal.label} · ${cal.done}/${cal.of}</span>
        ${!califica ? '<div style="margin-top:8px;color:var(--bad);font-size:13px;">⚠ Deal no califica completo — la ruta correcta es <strong>Nutrición</strong>, no cotización.</div>' : ''}
      </div>

      <h3>¿Cuál es la ruta del deal?</h3>
      <div class="chips">
        <div class="chip ${tipoAct === 'piloto' ? 'selected' : ''} ${!califica ? 'muted' : ''}" data-pick-tipo="piloto" ${!califica ? 'style="opacity:.5;cursor:not-allowed;"' : ''}>
          <strong>🚀 Piloto esta semana</strong> <span class="opt">(solo si califica completo)</span>
        </div>
        <div class="chip ${tipoAct === 'cotizacion' ? 'selected' : ''} ${!califica ? 'muted' : ''}" data-pick-tipo="cotizacion" ${!califica ? 'style="opacity:.5;cursor:not-allowed;"' : ''}>
          <strong>📄 Cotización</strong> <span class="opt">(si el piloto no aplica)</span>
        </div>
        <div class="chip ${tipoAct === 'nutricion' ? 'selected' : ''}" data-pick-tipo="nutricion">
          <strong>🌱 Nutrición</strong> <span class="opt">(sin cotización, sin follow-up de cierre)</span>
        </div>
      </div>

      ${tipoAct === 'piloto' ? `
        <div class="card compact" style="margin-top:14px;background:var(--panel-2);">
          <h3 style="margin-top:0;">Piloto esta semana</h3>
          <p class="muted" style="font-size:13px;">Ofrécele: "Antes de que evalúen una propuesta en frío, publiquemos esta semana [el cargo del dolor]. El [día pactado] revisamos juntos los resultados y la cotización completa, con esa evidencia sobre la mesa."</p>

          <label>Cargo que vamos a publicar ${tip('Idealmente el cargo que el cliente confesó no poder llenar (el dolor identificado). Cabe en la autoridad de quien asistió al demo — sin comité.')}<span class="opt">(el cargo del dolor)</span></label>
          <input type="text" data-field="pilotoCargo" value="${esc(state.pilotoCargo)}" placeholder="Ej. Dev full-stack senior — el mismo que el cliente confesó no poder cubrir." />

          <label>Fecha de revisión de resultados ${tip('El día que se revisa el piloto Y se presenta la cotización con evidencia real. Máximo 7 días desde hoy.\n\nEj.: viernes 12 de julio 10am con María y Carlos.')}</label>
          <input type="date" data-field="pilotoFechaRevision" value="${esc(state.pilotoFechaRevision)}" />
        </div>
      ` : ''}

      ${tipoAct === 'cotizacion' ? `
        <div class="card compact" style="margin-top:14px;background:var(--panel-2);">
          <h3 style="margin-top:0;">Cotización</h3>
          <p class="muted" style="font-size:13px;">Regla: la cotización se envía el mismo día del demo, y con la próxima reunión en el calendario antes de colgar: "Para revisar el presupuesto con su equipo, abramos agendas de una vez — ¿jueves 9:00 am o viernes 3:00 pm?" <strong>Prohibido despedirse con "le envío la propuesta para que la revise".</strong></p>
        </div>
      ` : ''}

      ${tipoAct === 'nutricion' ? `
        <div class="card compact" style="margin-top:14px;background:#fef3e2;border:1px solid #f8d7a5;">
          <h3 style="margin-top:0;color:var(--warn);">Nutrición</h3>
          <p class="muted" style="font-size:13px;">Sin cotización, sin consultoría gratis, sin follow-ups de cierre. Se le manda material y se revisa en 30 días si el dolor apareció. En Sandler la presentación es el premio que el prospecto gana al calificar.</p>
        </div>
      ` : ''}

      <label>Próximo paso concreto acordado ${tip('Específico: día, hora, entregable, con quién. NUNCA "le envío info".\n\nEj.: "Piloto arranca lunes, publicamos dev senior; revisión viernes 10am con María y Carlos."')}</label>
      <textarea data-field="proximoPaso" placeholder="Ej. piloto lunes; revisión viernes 10am con María + Carlos.">${esc(state.proximoPaso)}</textarea>

      <label>Post-venta / cómo evitamos remordimiento ${tip('Base para que no se eche para atrás y para abrir referidos.')}<span class="opt">(nice-to-have)</span></label>
      <textarea data-field="postVenta" placeholder="Ej. onboarding sem 1, seguimiento 30d, cláusula 60d sin penalidad, referencia a los 90d.">${esc(state.postVenta)}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-act="prev">← Atrás</button>
      <div style="display:flex;gap:10px;">
        <button class="btn secondary" data-act="save">Guardar borrador</button>
        <button class="btn" data-act="next">Ver calificación →</button>
      </div>
    </div>
  `);
  bindForm();
  el.querySelectorAll('[data-pick-tipo]').forEach(c => c.addEventListener('click', () => {
    const val = c.getAttribute('data-pick-tipo');
    if ((val === 'piloto' || val === 'cotizacion') && !califica) return;
    state.proximoPasoTipo = val;
    saveDraft(); renderWizard();
  }));
}

// Calcula score local (mismo cálculo que server, actualizado al nuevo proceso)
function localScore(d) {
  const pf = painFunnel(d);
  const fund = {
    contratoPrevio: has(d.contratoPrevio),
    fichaPrevia: has(d.fichaCargos) || has(d.fichaCosto) || has(d.fichaHerramientas),
    segmentacion: !!d.segment,
    dolorDesarrollado: pf.ok,
    presupuesto: has(d.presupuesto),
    decisor: has(d.decisor),
    procesoDecision: has(d.procesoDecision),
    fechaLimiteDecision: has(d.fechaLimiteDecision),
  };
  const nth = {
    vinculo: has(d.vinculo),
    consecuenciasEmocionales: has(d.consecuenciasEmocionales),
    medicion: has(d.medicion),
    integraciones: has(d.integraciones),
    postVenta: has(d.postVenta),
    proximoPaso: has(d.proximoPaso),
    piloto: has(d.pilotoCargo) && has(d.pilotoFechaRevision),
  };
  const labels = {
    contratoPrevio: 'Contrato previo Nº 1',
    fichaPrevia: 'Ficha previa (SDR)',
    segmentacion: 'Segmentación',
    dolorDesarrollado: 'Dolor desarrollado (embudo 2/3)',
    presupuesto: 'Presupuesto',
    decisor: 'Decisor',
    procesoDecision: 'Proceso de decisión',
    fechaLimiteDecision: 'Fecha límite (contrato Nº 2)',
    vinculo: 'Vínculo / rapport',
    consecuenciasEmocionales: 'Consecuencias emocionales',
    medicion: 'Métricas actuales',
    integraciones: 'Integraciones / API',
    postVenta: 'Plan post-venta',
    proximoPaso: 'Próximo paso acordado',
    piloto: 'Piloto agendado',
  };
  const fundOk = Object.values(fund).filter(Boolean).length;
  const nthOk = Object.values(nth).filter(Boolean).length;
  const cal = calificacion(d);
  return {
    fund, nth, labels, pf, cal,
    fundamentalsPct: Math.round(fundOk / Object.keys(fund).length * 100),
    niceToHavePct: Math.round(nthOk / Object.keys(nth).length * 100),
  };
}

function stepResult() {
  const s = localScore(state);
  const seg = state.segment || 'B';
  const show = SHOW_BY_SEGMENT[seg] || [];
  const dontShow = DONT_SHOW_BY_SEGMENT[seg] || [];

  // Detectar "qué faltó"
  const faltantesFund = Object.entries(s.fund).filter(([_,v]) => !v).map(([k]) => s.labels[k]);
  const faltantesNth = Object.entries(s.nth).filter(([_,v]) => !v).map(([k]) => s.labels[k]);

  const peticionesNoTenemos = (state.idealRequests || []).filter(x => x.text && !x.weHave);
  const peticionesTenemos = (state.idealRequests || []).filter(x => x.text && x.weHave);

  const cal = s.cal;
  const califica = cal.label === 'Completa';
  const gateColor = califica ? 'var(--peaku-green)' : (cal.label === 'Parcial' ? 'var(--warn)' : 'var(--bad)');
  const gateBg = califica ? '#e8f6f0' : (cal.label === 'Parcial' ? '#fef3e2' : '#fdecec');
  const rutaSug = califica ? 'Cotización el mismo día · piloto como próximo paso' : (cal.label === 'Parcial' ? 'Cerrar el gap (fecha límite y/o embudo del dolor) antes de cotizar' : 'Nutrición · sin cotización, sin follow-ups de cierre');

  h(`
    ${stepHeader()}

    <div class="card" style="border-left:6px solid ${gateColor}; background:${gateBg};">
      <div class="split">
        <div>
          <div style="font-size:12px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${gateColor};">Calificación Sandler</div>
          <h1 style="color:${gateColor};font-size:36px;margin:6px 0;">${cal.label}</h1>
          <p class="muted" style="margin:0;">${cal.done} de ${cal.of} check-points cerrados · Ruta sugerida: <strong>${rutaSug}</strong></p>
        </div>
        <span class="segment-badge ${seg}">Segmento ${seg} · ${SEGMENTS[seg].short}</span>
      </div>

      <ul class="list-clean" style="margin-top:14px;">
        <li><span>Dolor desarrollado (embudo 2/3)</span><span class="pill ${cal.items.dolor ? 'good' : 'bad'}">${cal.items.dolor ? '✓' : 'Falta'}</span></li>
        <li><span>Presupuesto</span><span class="pill ${cal.items.presupuesto ? 'good' : 'bad'}">${cal.items.presupuesto ? '✓' : 'Falta'}</span></li>
        <li><span>Decisión (decisor + proceso)</span><span class="pill ${cal.items.decision ? 'good' : 'bad'}">${cal.items.decision ? '✓' : 'Falta'}</span></li>
        <li><span>Fecha límite de decisión (contrato Nº 2)</span><span class="pill ${cal.items.fecha ? 'good' : 'bad'}">${cal.items.fecha ? '✓' : 'Falta'}</span></li>
      </ul>
    </div>

    <div class="card">
      <div class="split"><h1>Detalles del proceso</h1><span class="muted" style="font-size:13px;">Empresa: <strong>${esc(state.company) || '—'}</strong> · ${esc(state.executive) || '—'} · Línea: <strong>${esc(state.lineaNegocio || '—')}</strong></span></div>

      <div class="score-grid" style="margin-top: 14px;">
        <div class="card compact score-card">
          <div class="muted">Fundamentales del proceso</div>
          <div class="num">${s.fundamentalsPct}%</div>
          <div class="progress"><span style="width:${s.fundamentalsPct}%"></span></div>
        </div>
        <div class="card compact score-card">
          <div class="muted">Nice-to-have</div>
          <div class="num">${s.niceToHavePct}%</div>
          <div class="progress"><span style="width:${s.niceToHavePct}%"></span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>1 · Qué mostrar de la plataforma</h2>
      <ul class="list-clean">
        ${show.map(k => {
          const f = PEAKU_FEATURES.find(x => x.key === k);
          return `<li><span>✓ ${f.label}</span><span class="pill good">Mostrar</span></li>`;
        }).join('')}
        ${dontShow.map(k => {
          const f = PEAKU_FEATURES.find(x => x.key === k);
          return `<li><span class="muted">✕ ${f.label}</span><span class="pill bad">NO mostrar</span></li>`;
        }).join('')}
      </ul>
      ${seg === 'C' ? `<div class="hint" style="margin-top:10px;"><strong>Recordatorio Segmento C:</strong> nunca ataques el ATS de frente. Posiciónate como capa de sourcing + IA. ATS detectado: <strong>${esc(state.atsName || '—')}</strong>.</div>` : ''}
    </div>

    <div class="card">
      <h2>2 · Qué faltó del proceso Sandler</h2>
      ${faltantesFund.length ? `
        <h3>Fundamentales pendientes</h3>
        <ul class="list-clean">
          ${faltantesFund.map(x => `<li><span>${x}</span><span class="pill bad">Falta</span></li>`).join('')}
        </ul>
      ` : `<p class="pill good">✓ Todos los fundamentales cubiertos</p>`}

      ${faltantesNth.length ? `
        <h3>Nice-to-have pendientes</h3>
        <ul class="list-clean">
          ${faltantesNth.map(x => `<li><span class="muted">${x}</span><span class="pill warn">Sugerido</span></li>`).join('')}
        </ul>
      ` : ''}
    </div>

    <div class="card">
      <h2>3 · Lo que pidió el cliente en su ideal</h2>
      ${peticionesTenemos.length ? `
        <h3>Lo tenemos hoy (úsalo en el cierre)</h3>
        <ul class="list-clean">
          ${peticionesTenemos.map(p => `<li><span>${esc(p.text)}</span><span class="pill good">Tenemos</span></li>`).join('')}
        </ul>
      ` : ''}
      ${peticionesNoTenemos.length ? `
        <h3>Gaps (alimentan roadmap por segmento)</h3>
        <ul class="list-clean">
          ${peticionesNoTenemos.map(p => `<li><span>${esc(p.text)}</span><span class="pill warn">Construir</span></li>`).join('')}
        </ul>
      ` : ''}
      ${(!peticionesTenemos.length && !peticionesNoTenemos.length) ? `<p class="muted">No registraste pedidos del cliente en este deal.</p>` : ''}
    </div>

    <div class="btn-row">
      <button class="btn ghost" data-act="prev">← Atrás</button>
      <div style="display:flex;gap:10px;">
        <button class="btn secondary" data-act="new">Iniciar nuevo deal</button>
        <button class="btn green" data-act="finish">💾 Guardar deal en servidor</button>
      </div>
    </div>
  `);
  bindForm();
}

async function submitDeal() {
  try {
    const r = await fetch('/api/deals', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    const j = await r.json();
    if (j.ok) {
      alert(`Deal #${j.id} guardado. Fundamentales ${j.score.fundamentalsPct}% · Nice-to-have ${j.score.niceToHavePct}%`);
      clearDraft(); location.hash = '#/deals';
    } else {
      alert('Error al guardar: ' + (j.error || ''));
    }
  } catch (e) { alert('Error: ' + e.message); }
}

// ---------- Historial ----------
function windowCell(d) {
  // ventana 14 días — desde created_at (o quoted_at si existe)
  const start = d.quoted_at || d.created_at;
  if (!start) return '<span class="muted">—</span>';
  const days = daysBetween(start, new Date().toISOString());
  if (d.outcome === 'won') return `<span class="pill good">Ganada · día ${days}</span>`;
  if (d.outcome === 'lost') return `<span class="pill bad">Perdida · día ${days}</span>`;
  if (days <= 2) return `<span class="pill good">48h · llamar</span>`;
  if (days <= 14) return `<span class="pill" style="background:#e6f8ff;border-color:var(--peaku-blue);color:var(--peaku-blue-dark);">Activa · día ${days}/14</span>`;
  if (days <= 19) return `<span class="pill warn">Última llamada · día ${days}</span>`;
  if (days <= 30) return `<span class="pill warn">Zona muerta · día ${days}</span>`;
  return `<span class="pill bad">Breakup · día ${days}</span>`;
}
function calCell(cal) {
  if (!cal) return '<span class="muted">—</span>';
  if (cal === 'Completa') return `<span class="pill good">${cal}</span>`;
  if (cal === 'Parcial') return `<span class="pill warn">${cal}</span>`;
  return `<span class="pill bad">${cal}</span>`;
}

async function renderDeals() {
  h(`<h1>Historial de deals</h1><p class="muted">Cargando...</p>`);
  const r = await fetch('/api/deals').then(r=>r.json()).catch(() => []);
  if (!r.length) { h(`<h1>Historial</h1><p class="muted">Todavía no hay deals guardados.</p>`); return; }

  // Métrica rápida — 41% → &lt;20% "lead sin valor"
  const closed = r.filter(x => x.outcome === 'won' || x.outcome === 'lost');
  const lost = r.filter(x => x.outcome === 'lost');
  const sinValor = lost.filter(x => x.outcome_reason && /lead sin valor|no calific/i.test(x.outcome_reason));
  const pctSinValor = lost.length ? Math.round(sinValor.length / lost.length * 100) : null;
  const cierreRate = closed.length ? Math.round(r.filter(x => x.outcome === 'won').length / closed.length * 100) : null;

  h(`
    <h1>Historial de deals</h1>
    <p class="muted">Haz clic en una fila para ver el detalle. Ventana de 14 días desde la cotización.</p>

    <div class="score-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="card compact score-card"><div class="muted">Total deals</div><div class="num">${r.length}</div></div>
      <div class="card compact score-card"><div class="muted">Cierre</div><div class="num" style="color:${cierreRate>=25?'var(--peaku-green)':'var(--peaku-gray)'};">${cierreRate === null ? '—' : cierreRate + '%'}</div><div class="muted" style="font-size:11px;">${r.filter(x=>x.outcome==='won').length} de ${closed.length}</div></div>
      <div class="card compact score-card"><div class="muted">"Lead sin valor" (meta &lt;20%)</div><div class="num" style="color:${pctSinValor!==null && pctSinValor<20?'var(--peaku-green)':'var(--bad)'};">${pctSinValor === null ? '—' : pctSinValor + '%'}</div><div class="muted" style="font-size:11px;">${sinValor.length} de ${lost.length} perdidas</div></div>
      <div class="card compact score-card"><div class="muted">Abiertos</div><div class="num">${r.filter(x=>!x.outcome || x.outcome==='open').length}</div></div>
    </div>

    <div class="card" style="margin-top:16px;">
      <table>
        <thead><tr>
          <th>#</th><th>Empresa</th><th>Ejecutivo</th><th>Línea</th><th>Seg.</th>
          <th>Calificación</th><th>Fund.</th><th>Ventana 14d</th><th>Fecha</th><th></th>
        </tr></thead>
        <tbody>
          ${r.map(d => `<tr class="clickable" data-open="${d.id}">
            <td>${d.id}</td>
            <td>${esc(d.company||'—')}</td>
            <td>${esc(d.executive||'—')}</td>
            <td>${esc(d.linea_negocio||'—')}</td>
            <td><span class="segment-badge ${d.segment||''}">${d.segment||'—'}</span></td>
            <td>${calCell(d.calificacion_sandler)}</td>
            <td>${barCell(d.score_fundamentals)}</td>
            <td>${windowCell(d)}</td>
            <td>${new Date(d.created_at).toLocaleDateString()}</td>
            <td style="text-align:right;white-space:nowrap;">
              <button class="btn ghost btn-sm" data-view="${d.id}">Ver</button>
              <button class="btn ghost btn-sm danger" data-del="${d.id}" title="Eliminar">🗑</button>
            </td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `);
  el.querySelectorAll('[data-open], [data-view]').forEach(node => node.addEventListener('click', e => {
    const id = node.getAttribute('data-open') || node.getAttribute('data-view');
    if (e.target.closest('[data-del]')) return;
    location.hash = `#/deal/${id}`;
  }));
  el.querySelectorAll('[data-del]').forEach(b => b.addEventListener('click', async e => {
    e.stopPropagation();
    await deleteDeal(b.getAttribute('data-del'), renderDeals);
  }));
}

// ---------- Detalle de un deal ----------
async function renderDealDetail(id) {
  h(`<h1>Detalle del deal</h1><p class="muted">Cargando...</p>`);
  const row = await fetch(`/api/deals/${id}`).then(r => r.ok ? r.json() : null).catch(() => null);
  if (!row) { h(`<h1>Detalle del deal</h1><p class="muted">No se encontró el deal #${esc(id)}.</p><a href="#/deals">← Volver al historial</a>`); return; }

  // El campo data contiene el objeto completo que se registró
  const d = row.data || {};
  const s = localScore(d);
  const seg = d.segment || row.segment || '';
  const faltantesFund = Object.entries(s.fund).filter(([_, v]) => !v).map(([k]) => s.labels[k]);
  const faltantesNth = Object.entries(s.nth).filter(([_, v]) => !v).map(([k]) => s.labels[k]);

  const q = d.qualif || {};
  const ideal = Array.isArray(d.idealRequests) ? d.idealRequests.filter(x => x && x.text) : [];

  // Helper para mostrar un campo (resalta si está vacío)
  const field = (label, val) => {
    const empty = !val || !String(val).trim();
    return `<div class="detail-field ${empty ? 'empty' : ''}">
      <div class="detail-label">${label}</div>
      <div class="detail-value">${empty ? '<span class="pill bad">Sin completar</span>' : esc(val)}</div>
    </div>`;
  };

  h(`
    <div class="split">
      <h1>Deal #${row.id} · ${esc(d.company || row.company || '—')}</h1>
      ${seg ? `<span class="segment-badge ${seg}">Segmento ${seg}</span>` : ''}
    </div>
    <p class="muted">
      Ejecutivo: <strong>${esc(d.executive || row.executive || '—')}</strong> ·
      Guardado: <strong>${new Date(row.created_at).toLocaleString()}</strong>
    </p>

    <div class="card">
      <h2>Resumen de calidad del proceso</h2>
      <div class="score-grid" style="margin-top: 6px;">
        <div class="card compact score-card">
          <div class="muted">Fundamentales</div>
          <div class="num">${s.fundamentalsPct}%</div>
          <div class="progress"><span style="width:${s.fundamentalsPct}%"></span></div>
        </div>
        <div class="card compact score-card">
          <div class="muted">Nice-to-have</div>
          <div class="num">${s.niceToHavePct}%</div>
          <div class="progress"><span style="width:${s.niceToHavePct}%"></span></div>
        </div>
      </div>
    </div>

    <div class="card">
      <h2>⚠ Campos importantes que no se completaron</h2>
      ${faltantesFund.length ? `
        <h3>Fundamentales pendientes</h3>
        <ul class="list-clean">
          ${faltantesFund.map(x => `<li><span>${x}</span><span class="pill bad">Falta</span></li>`).join('')}
        </ul>
      ` : `<p class="pill good">✓ Todos los fundamentales fueron completados</p>`}
      ${faltantesNth.length ? `
        <h3>Nice-to-have pendientes</h3>
        <ul class="list-clean">
          ${faltantesNth.map(x => `<li><span class="muted">${x}</span><span class="pill warn">Sugerido</span></li>`).join('')}
        </ul>
      ` : ''}
    </div>

    <div class="card">
      <h2>Ficha previa (SDR) · Contrato Nº 1</h2>
      ${field('Línea de negocio', d.lineaNegocio || row.linea_negocio)}
      ${field('Cargos requeridos', d.fichaCargos)}
      ${field('Costo estimado de vacante abierta', d.fichaCosto)}
      ${field('Herramientas actuales', d.fichaHerramientas)}
    </div>

    <div class="card">
      <h2>Fase 1 · Construcción</h2>
      ${field('Contrato previo', d.contratoPrevio)}
      ${field('Vínculo / rapport', d.vinculo)}
    </div>

    <div class="card">
      <h2>Calificación rápida</h2>
      ${field('Volumen de contratación', q.volumen)}
      ${field('Equipo de reclutamiento', q.equipoRrhh)}
      ${field('Perfiles que contratan', q.perfiles)}
      ${field('Herramienta actual', q.herramienta)}
      ${field('Quién decide la compra', q.decisor_quien)}
      ${field('¿Tiene ATS?', d.hasAts ? 'Sí' : 'No')}
      ${d.hasAts ? field('ATS / uso', d.atsName) : ''}
    </div>

    <div class="card">
      <h2>Embudo del dolor</h2>
      ${field('Dolor principal (textual)', d.dolor)}
      ${field('1. Cuantificar (ancla del precio)', d.dolorCuantificar)}
      ${field('2. Historia (qué intentaron)', d.dolorHistoria)}
      ${field('3. Impacto (cliente/equipo)', d.dolorImpacto)}
      ${field('Consecuencias emocionales', d.consecuenciasEmocionales)}
      ${field('Cómo miden hoy', d.medicion)}
      ${seg === 'C' ? field('Integraciones / API', d.integraciones) : ''}
    </div>

    <div class="card">
      <h2>Presupuesto y decisión</h2>
      ${field('Presupuesto', d.presupuesto)}
      ${field('Decisor / decisores', d.decisor)}
      ${field('Proceso de decisión', d.procesoDecision)}
      ${field('Fecha límite de decisión (contrato Nº 2)', d.fechaLimiteDecision)}
    </div>

    <div class="card">
      <h2>Lo que pidió el cliente en su ideal</h2>
      ${ideal.length ? `
        <ul class="list-clean">
          ${ideal.map(p => `<li><span>${esc(p.text)}</span>${p.weHave ? '<span class="pill good">Lo tenemos</span>' : '<span class="pill warn">Construir</span>'}</li>`).join('')}
        </ul>
      ` : `<p class="muted">No se registraron pedidos del cliente.</p>`}
    </div>

    <div class="card">
      <h2>Fase 3 · Cierre + Piloto</h2>
      ${field('Ruta del deal', d.proximoPasoTipo || '—')}
      ${field('Cargo para piloto', d.pilotoCargo)}
      ${field('Fecha de revisión piloto', d.pilotoFechaRevision)}
      ${field('Plan post-venta', d.postVenta)}
      ${field('Próximo paso acordado', d.proximoPaso)}
    </div>

    ${renderOutcomeSection(row)}

    <div class="btn-row">
      <a class="btn ghost" href="#/deals">← Volver al historial</a>
      <button class="btn green danger-solid" data-del-detail="${row.id}">🗑 Eliminar este deal</button>
    </div>
  `);
  el.querySelector('[data-del-detail]').addEventListener('click', async () => {
    await deleteDeal(row.id, () => { location.hash = '#/deals'; });
  });
  // Bindings del panel de outcome
  const wonBtn = el.querySelector('[data-outcome="won"]');
  const lostBtn = el.querySelector('[data-outcome="lost"]');
  const reasonSel = el.querySelector('[data-outcome-reason-sel]');
  const reasonTxt = el.querySelector('[data-outcome-reason]');
  const saveBtn = el.querySelector('[data-save-outcome]');
  if (wonBtn) wonBtn.addEventListener('click', () => setOutcomeMode('won'));
  if (lostBtn) lostBtn.addEventListener('click', () => setOutcomeMode('lost'));
  function setOutcomeMode(mode) {
    el.querySelector('#outcome-panel').setAttribute('data-mode', mode);
    el.querySelectorAll('[data-outcome]').forEach(b => b.classList.toggle('selected-outcome', b.getAttribute('data-outcome') === mode));
    // Cambiar opciones según won/lost
    if (mode === 'lost') {
      reasonSel.innerHTML = `
        <option value="">— Selecciona motivo real —</option>
        <option>Lead sin valor (no calificaba)</option>
        <option>Precio / presupuesto</option>
        <option>Se fueron con competidor</option>
        <option>Timing / no era el momento</option>
        <option>Decisión interna quedó frenada</option>
        <option>Cliente no respondió (breakup día 30)</option>
        <option>Otro</option>
      `;
    } else {
      reasonSel.innerHTML = `
        <option value="">— Selecciona motivo de éxito —</option>
        <option>Dolor bien desarrollado y demo enfocada</option>
        <option>Ancla de precio funcionó (ROI vs statu quo)</option>
        <option>Piloto validó la solución</option>
        <option>Champion interno empujó la decisión</option>
        <option>Otro</option>
      `;
    }
    reasonSel.style.display = ''; reasonTxt.style.display = ''; saveBtn.style.display = '';
  }
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const mode = el.querySelector('#outcome-panel').getAttribute('data-mode');
    const motivo = [reasonSel.value, reasonTxt.value.trim()].filter(Boolean).join(' — ');
    if (!mode || !motivo) { alert('Elige motivo y comentario.'); return; }
    const r = await fetch(`/api/deals/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: mode, outcome_reason: motivo })
    });
    const j = await r.json();
    if (j.ok) { alert(`Deal marcado como ${mode.toUpperCase()}.`); location.hash = '#/deals'; }
    else alert('Error: ' + (j.error || ''));
  });
}

// Panel Won/Lost — sección al final del detalle
function renderOutcomeSection(row) {
  const isClosed = row.outcome === 'won' || row.outcome === 'lost';
  if (isClosed) {
    return `
      <div class="card" style="border-left:6px solid ${row.outcome === 'won' ? 'var(--peaku-green)' : 'var(--bad)'};">
        <h2>Resultado del deal</h2>
        <div class="split">
          <div>
            <span class="pill ${row.outcome === 'won' ? 'good' : 'bad'}" style="font-size:14px;padding:6px 14px;">${row.outcome === 'won' ? '🏆 GANADO' : '❌ PERDIDO'}</span>
            <p class="muted" style="margin-top:8px;">Motivo: <strong>${esc(row.outcome_reason || '—')}</strong></p>
          </div>
          <div class="muted" style="font-size:12px;">Cerrado el ${row.closed_at ? new Date(row.closed_at).toLocaleString() : '—'}</div>
        </div>
      </div>
    `;
  }
  return `
    <div class="card" id="outcome-panel" data-mode="">
      <h2>Cerrar deal con motivo real</h2>
      <p class="muted">"Un no limpio vale más que un quizás eterno." Al cerrar, el motivo alimenta la métrica <strong>"Lead sin valor" (meta: bajar de 41% a &lt;20%)</strong>.</p>
      <div class="chips" style="margin-bottom:14px;">
        <div class="chip" data-outcome="won">🏆 Marcar como GANADO</div>
        <div class="chip" data-outcome="lost">❌ Marcar como PERDIDO</div>
      </div>
      <label style="display:block;">Motivo (categoría)</label>
      <select data-outcome-reason-sel style="display:none;"></select>
      <label style="display:block;margin-top:8px;">Detalle adicional (contexto real)</label>
      <textarea data-outcome-reason placeholder="Ej. presentaron cotización a comité sin nosotros; se decidieron por Bumeran por precio." style="display:none;min-height:70px;"></textarea>
      <div style="margin-top:12px;"><button class="btn green" data-save-outcome style="display:none;">Guardar resultado</button></div>
    </div>
  `;
}

// ---------- Eliminar deal ----------
async function deleteDeal(id, onDone) {
  if (!confirm(`¿Eliminar el deal #${id}? Esta acción no se puede deshacer.`)) return;
  try {
    const r = await fetch(`/api/deals/${id}`, { method: 'DELETE' });
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.ok) {
      if (typeof onDone === 'function') onDone();
    } else {
      alert('No se pudo eliminar: ' + (j.error || r.statusText));
    }
  } catch (e) { alert('Error: ' + e.message); }
}
function barCell(pct) {
  const p = pct||0;
  const color = p >= 80 ? 'var(--peaku-green)' : p >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<div style="display:flex;align-items:center;gap:8px;"><div style="width:60px;height:6px;background:var(--panel-2);border-radius:999px;overflow:hidden;"><div style="width:${p}%;height:100%;background:${color};"></div></div><span style="font-size:12px;">${p}%</span></div>`;
}

// ---------- Wishlist agregado ----------
async function renderWishlist() {
  h(`<h1>Wishlist por segmento</h1><p class="muted">Cargando...</p>`);
  const r = await fetch('/api/wishlist').then(r=>r.json()).catch(() => []);
  if (!r.length) { h(`<h1>Wishlist por segmento</h1><p class="muted">Aún no hay pedidos registrados. Llena algunos deals con la sección "Lo que pidió el cliente en su ideal".</p>`); return; }

  const bySeg = { A: [], B: [], C: [], '': [] };
  for (const w of r) (bySeg[w.segment || ''] || bySeg['']).push(w);

  h(`
    <h1>Wishlist por segmento <span class="muted" style="font-size:13px;">— qué piden los clientes que aún no tenemos</span></h1>
    ${['A','B','C'].map(seg => `
      <div class="card">
        <div class="split">
          <h2 style="margin:0;">Segmento ${seg} · ${SEGMENTS[seg].label}</h2>
          <span class="segment-badge ${seg}">${(bySeg[seg]||[]).length} items</span>
        </div>
        ${(bySeg[seg]||[]).length ? `
          <table style="margin-top:10px;">
            <thead><tr><th>Pedido</th><th style="width:90px;">Veces</th><th style="width:120px;">¿Lo tenemos?</th></tr></thead>
            <tbody>
              ${(bySeg[seg]||[]).map(w => `<tr>
                <td>${esc(w.item)}</td>
                <td><strong>${w.count}</strong></td>
                <td>${w.we_have_count >= Math.ceil(w.count/2) ? '<span class="pill good">Sí, mayoría</span>' : (w.we_have_count > 0 ? `<span class="pill warn">Parcial (${w.we_have_count}/${w.count})</span>` : '<span class="pill bad">No</span>')}</td>
              </tr>`).join('')}
            </tbody>
          </table>
        ` : `<p class="muted" style="margin:8px 0 0;">Sin pedidos aún.</p>`}
      </div>
    `).join('')}
  `);
}

// ---------- Utils ----------
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function tip(text) { return `<span class="tip" tabindex="0" data-tip="${esc(text)}">i</span>`; }

// kick off
router();

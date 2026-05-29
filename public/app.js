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
    // Fase 1 - Construcción
    contratoPrevio: '',
    vinculo: '',
    // Calificación rápida
    qualif: {
      volumen: '',         // contrataciones/mes
      equipoRrhh: '',      // tamaño equipo
      perfiles: '',
      herramienta: '',
      decisor_quien: '',
    },
    hasAts: false,
    atsName: '',
    segment: '',           // A | B | C
    // Fase 2 - Calificación / Dolor
    dolor: '',
    impactoEconomico: '',
    consecuenciasEmocionales: '',
    medicion: '',
    integraciones: '',
    // Presupuesto / Decisión
    presupuesto: '',
    decisor: '',
    procesoDecision: '',
    // Lo que el cliente pidió en su ideal
    idealRequests: [],     // [{ text, weHave }]
    // Cierre
    postVenta: '',
    proximoPaso: '',
  };
}

let state = loadDraft() || newDraft();
let stepIdx = 0;
const STEPS = [
  { key: 'intro',     label: '0 · Construcción' },
  { key: 'qualif',    label: '1 · Calificación' },
  { key: 'segment',   label: '2 · Segmento' },
  { key: 'discovery', label: '3 · Dolor' },
  { key: 'budget',    label: '4 · Presupuesto / Decisión' },
  { key: 'ideal',     label: '5 · Pedidos del cliente' },
  { key: 'close',     label: '6 · Cierre' },
  { key: 'result',    label: '7 · Resultado' },
];

// ---------- Router ----------
function router() {
  const hash = location.hash || '#/';
  document.querySelectorAll('nav a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash));
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
  if (s === 'intro')     return stepIntro();
  if (s === 'qualif')    return stepQualif();
  if (s === 'segment')   return stepSegment();
  if (s === 'discovery') return stepDiscovery();
  if (s === 'budget')    return stepBudget();
  if (s === 'ideal')     return stepIdeal();
  if (s === 'close')     return stepClose();
  if (s === 'result')    return stepResult();
}

function stepIntro() {
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Fase 1 · Construcción de confianza</h1>
      <p class="muted">Antes de meter preguntas, escribe el contrato previo de la reunión y cómo está la relación. <strong>Escucha 70%, habla 30%.</strong></p>

      <div class="row">
        <div>
          <label>Tu nombre ${tip('Tu nombre como ejecutivo comercial. Sirve para reportería por persona después.\n\nEj.: "Santiago Pérez"')}</label>
          <input type="text" data-field="executive" value="${esc(state.executive)}" placeholder="Ej. Santiago Pérez" />
        </div>
        <div>
          <label>Empresa / Cliente ${tip('Razón social del cliente prospecto. Si todavía no lo sabes, ponle un alias y lo cambias después.\n\nEj.: "Constructora Bolívar S.A."')}</label>
          <input type="text" data-field="company" value="${esc(state.company)}" placeholder="Ej. Constructora Bolívar S.A." />
        </div>
      </div>

      <label>Contrato previo acordado ${tip('FUNDAMENTAL Sandler. Acuerdo explícito al inicio: duración, agenda, qué buscan ambos, y el permiso para que cualquiera diga "no" si no hay ajuste.\n\nEj.: "Acordamos 30 min. Yo entiendo su proceso actual y sus dolores; ellos deciden al final si tiene sentido una segunda reunión. Acordado que pueden decir que no sin problema."')}<span class="opt">(tiempo, agenda, permiso para decir "no")</span></label>
      <textarea data-field="contratoPrevio" placeholder="Ej. 30 min, entiendo su proceso y dolores; al final ellos deciden si avanzamos. Acordado que pueden decir 'no'.">${esc(state.contratoPrevio)}</textarea>

      <label>Vínculo / rapport inicial ${tip('Nice-to-have. Cómo rompiste el hielo y generaste relación par a par. Ayuda a contextualizar el deal.\n\nEj.: "Hablamos 5 min de su expansión a Cali, ambos conocemos al gerente de RRHH del Grupo Éxito. Tono cálido, conversación par a par."')}<span class="opt">(opcional, nice-to-have)</span></label>
      <textarea data-field="vinculo" placeholder="Ej. hablamos de su expansión, conocemos personas en común, tono cálido.">${esc(state.vinculo)}</textarea>
    </div>
    ${navButtons({ prevHidden: true })}
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

  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Fase 2 · Diagnóstico del dolor <span class="segment-badge ${seg}">Segmento ${seg}</span></h1>
      <p class="muted">Investiga profundo. Documenta lo más textual posible lo que diga el cliente.</p>

      <div class="hint">
        <strong>Preguntas guía para este segmento:</strong>
        <ul style="margin:6px 0 0 18px; padding: 0;">
          ${preguntas.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>

      <label>Dolor principal ${tip('FUNDAMENTAL. El problema concreto y específico que el cliente tiene HOY. No abstracto. Documenta lo más textual posible lo que diga el cliente.\n\nMal: "tienen problemas para contratar"\nBien: "Llevan 6 semanas tratando de cubrir 3 vacantes de devs senior y han perdido el contrato con un cliente porque no pudieron arrancar el proyecto a tiempo."')}<span class="opt">(qué problema concreto tiene)</span></label>
      <textarea data-field="dolor" placeholder="Ej. llevan 45 días con 3 vacantes técnicas abiertas, perdieron un contrato por no poder arrancar a tiempo.">${esc(state.dolor)}</textarea>

      <label>Impacto económico ${tip('FUNDAMENTAL. Cuánto le cuesta NO resolver el dolor. En horas, en plata o en oportunidad perdida. Es lo que justifica nuestra inversión vs. su statu quo.\n\nEj.: "Reclutadora gasta 60 hrs/mes en screening = 1.8M COP/mes. Pagan 8M COP por cada vacante a agencias y este año van 12 vacantes (96M anuales). Perdieron un contrato de 200M por no llenar las vacantes a tiempo."')}<span class="opt">(horas / $ que cuesta no resolverlo)</span></label>
      <textarea data-field="impactoEconomico" placeholder="Ej. 60 hrs/mes en screening (~1.8M COP), 8M COP por agencia x 12 vacantes = 96M anuales.">${esc(state.impactoEconomico)}</textarea>

      <label>Consecuencias emocionales ${tip('Nice-to-have pero MUY potente para el cierre. El dolor humano detrás del número. Frustración, miedo, presión del jefe.\n\nEj.: "La líder de RRHH está quemada, ya pidió un asistente y no se lo dieron. Su jefa la regañó la última junta por los tiempos. Siente que no va a poder con la meta de Q3."')}<span class="opt">(nice-to-have, potente)</span></label>
      <textarea data-field="consecuenciasEmocionales" placeholder="Ej. líder de RRHH quemada, regañada por su jefa, miedo de no cumplir meta de Q3.">${esc(state.consecuenciasEmocionales)}</textarea>

      <label>¿Cómo miden el proceso hoy? ${tip('Si no miden, es una oportunidad para vender analítica. Si miden, te dice qué dolores son visibles para ellos.\n\nEj.: "Solo miden tiempo de llenado de vacante en Excel manual; no miden fuentes ni conversión por etapa. No saben cuál fuente les funciona mejor."')}</label>
      <textarea data-field="medicion" placeholder="Ej. miden time-to-fill manualmente; no miden fuentes ni conversión.">${esc(state.medicion)}</textarea>

      ${isC ? `
        <label>Integraciones / API del ATS ${tip('Crítico para Segmento C. Define si podemos posicionarnos como capa sobre el ATS o si hay fricción técnica.\n\nEj.: "SAP SF tiene API REST documentada. El año pasado integraron Outmatch para assessments. El IT acepta integraciones que pasen su revisión de seguridad (~3 semanas)."')}</label>
        <textarea data-field="integraciones" placeholder="Ej. SAP SF con API REST, ya han integrado Outmatch antes. IT revisa seguridad.">${esc(state.integraciones)}</textarea>
      ` : ''}
    </div>
    ${navButtons()}
  `);
  bindForm();
}

function stepBudget() {
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Presupuesto y decisión</h1>
      <p class="muted">No avances al cierre sin esto.</p>

      <label>Presupuesto ${tip('FUNDAMENTAL. ¿Tiene presupuesto asignado? ¿Cuánto? ¿Comparado con qué alternativa? Si no hay plata, no hay venta.\n\nMal: "creo que tienen plata"\nBien: "Tienen 50M COP/año asignados al stack de RRHH; hoy gastan 30M en agencias. Si les demostramos ROI vs. esa partida actual, pueden aprobarlo en este Q. Comparan precio contra Bumeran."')}</label>
      <textarea data-field="presupuesto" placeholder="Ej. 50M COP/año asignados; hoy gastan 30M en agencias. Comparan con Bumeran.">${esc(state.presupuesto)}</textarea>

      <label>Decisor / decisores ${tip('FUNDAMENTAL. Nombres y roles concretos. ¿Hay comité? ¿Pasa por compras? ¿Quién firma realmente?\n\nEj.: "Decide el comité: María (líder TA, champion nuestra), Carlos (gerente RRHH, aprueba), Lucía (compras, valida proceso). El que firma es Carlos. Compras puede demorar 2 semanas adicionales."')}</label>
      <textarea data-field="decisor" placeholder="Ej. María (TA, champion), Carlos (gte RRHH, aprueba), Lucía (compras valida).">${esc(state.decisor)}</textarea>

      <label>Proceso de decisión ${tip('FUNDAMENTAL. Pasos internos exactos, plazos y criterios. Te dice cuándo cerrará y qué tienes que entregar para que avance.\n\nEj.: "Próxima semana presento a Carlos. Si aprueba, pasa a compras (2 sem). Necesitan: 1) propuesta comercial, 2) caso de éxito sector, 3) plan de implementación a 90 días. Criterios: ROI demostrable y soporte 24/7."')}</label>
      <textarea data-field="procesoDecision" placeholder="Ej. próximo paso con Carlos. Si aprueba, compras 2 sem. Necesitan propuesta + caso éxito + plan 90d.">${esc(state.procesoDecision)}</textarea>
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
  h(`
    ${stepHeader()}
    <div class="card">
      <h1>Fase 3 · Cierre</h1>
      <p class="muted">Recordatorio: la presentación de la plataforma resuelve EXCLUSIVAMENTE los dolores que ya identificaste.</p>

      <label>Post-venta / cómo evitamos remordimiento del comprador ${tip('Sandler dice: hay que sentar las bases para que no se eche para atrás después de firmar. Y para abrir la puerta a referencias.\n\nEj.: "Sesión de onboarding en semana 1. Reunión de seguimiento a los 30 días con métricas. Acordamos que si en 60 días no hay ROI demostrable, podemos parar sin penalidad. Pedir referencia formal a los 90 días si están contentos."')}<span class="opt">(nice-to-have)</span></label>
      <textarea data-field="postVenta" placeholder="Ej. onboarding sem 1, seguimiento 30d con métricas, cláusula 60d sin penalidad.">${esc(state.postVenta)}</textarea>

      <label>Próximo paso concreto acordado ${tip('Crítico para que el deal avance. Tiene que ser específico: día, hora, qué entregable, con quién.\n\nMal: "le envío más información"\nBien: "Demo técnica el martes 4 de junio, 10am, con María (TA) y el CTO. Yo envío la propuesta comercial el lunes antes de mediodía con caso de éxito de constructora similar."')}<span class="opt">(nice-to-have pero crítico)</span></label>
      <textarea data-field="proximoPaso" placeholder="Ej. demo martes 10am con María + CTO. Envío propuesta + caso éxito el lunes 12pm.">${esc(state.proximoPaso)}</textarea>
    </div>
    <div class="btn-row">
      <button class="btn ghost" data-act="prev">← Atrás</button>
      <div style="display:flex;gap:10px;">
        <button class="btn secondary" data-act="save">Guardar borrador</button>
        <button class="btn" data-act="finish">Generar resultado →</button>
      </div>
    </div>
  `);
  bindForm();
}

// Calcula score local (mismo cálculo que server)
function localScore(d) {
  const fund = {
    contratoPrevio: !!(d.contratoPrevio && d.contratoPrevio.trim()),
    segmentacion: !!d.segment,
    dolor: !!(d.dolor && d.dolor.trim()),
    impactoEconomico: !!(d.impactoEconomico && d.impactoEconomico.trim()),
    presupuesto: !!(d.presupuesto && d.presupuesto.trim()),
    decisor: !!(d.decisor && d.decisor.trim()),
    procesoDecision: !!(d.procesoDecision && d.procesoDecision.trim()),
  };
  const nth = {
    vinculo: !!(d.vinculo && d.vinculo.trim()),
    consecuenciasEmocionales: !!(d.consecuenciasEmocionales && d.consecuenciasEmocionales.trim()),
    medicion: !!(d.medicion && d.medicion.trim()),
    integraciones: !!(d.integraciones && d.integraciones.trim()),
    postVenta: !!(d.postVenta && d.postVenta.trim()),
    proximoPaso: !!(d.proximoPaso && d.proximoPaso.trim()),
  };
  const labels = {
    contratoPrevio: 'Contrato previo',
    segmentacion: 'Segmentación',
    dolor: 'Dolor identificado',
    impactoEconomico: 'Impacto económico',
    presupuesto: 'Presupuesto',
    decisor: 'Decisor',
    procesoDecision: 'Proceso de decisión',
    vinculo: 'Vínculo / rapport',
    consecuenciasEmocionales: 'Consecuencias emocionales',
    medicion: 'Métricas actuales',
    integraciones: 'Integraciones / API',
    postVenta: 'Plan post-venta',
    proximoPaso: 'Próximo paso acordado',
  };
  const fundOk = Object.values(fund).filter(Boolean).length;
  const nthOk = Object.values(nth).filter(Boolean).length;
  return {
    fund, nth, labels,
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

  h(`
    ${stepHeader()}
    <div class="card">
      <div class="split">
        <h1>Resultado del proceso</h1>
        <span class="segment-badge ${seg}">Segmento ${seg} · ${SEGMENTS[seg].short}</span>
      </div>
      <p class="muted">Empresa: <strong>${esc(state.company) || '—'}</strong> · Ejecutivo: <strong>${esc(state.executive) || '—'}</strong></p>

      <div class="score-grid" style="margin-top: 14px;">
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
async function renderDeals() {
  h(`<h1>Historial de deals</h1><p class="muted">Cargando...</p>`);
  const r = await fetch('/api/deals').then(r=>r.json()).catch(() => []);
  if (!r.length) { h(`<h1>Historial</h1><p class="muted">Todavía no hay deals guardados.</p>`); return; }
  h(`
    <h1>Historial de deals</h1>
    <div class="card">
      <table>
        <thead><tr>
          <th>#</th><th>Empresa</th><th>Ejecutivo</th><th>Segmento</th><th>ATS</th>
          <th>Fund.</th><th>NTH</th><th>Fecha</th>
        </tr></thead>
        <tbody>
          ${r.map(d => `<tr>
            <td>${d.id}</td>
            <td>${esc(d.company||'—')}</td>
            <td>${esc(d.executive||'—')}</td>
            <td><span class="segment-badge ${d.segment||''}">${d.segment||'—'}</span></td>
            <td>${d.has_ats ? '✓' : '—'}</td>
            <td>${barCell(d.score_fundamentals)}</td>
            <td>${barCell(d.score_nice_to_have)}</td>
            <td>${new Date(d.created_at).toLocaleString()}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>
  `);
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

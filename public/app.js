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
        <div><label>Tu nombre</label><input type="text" data-field="executive" value="${esc(state.executive)}" placeholder="Ej. Santiago" /></div>
        <div><label>Empresa / Cliente</label><input type="text" data-field="company" value="${esc(state.company)}" placeholder="Ej. Acme S.A." /></div>
      </div>

      <label>Contrato previo acordado <span class="muted">(tiempo, agenda, permiso para decir "no")</span></label>
      <textarea data-field="contratoPrevio" placeholder="Ej. 30 min, vamos a entender su proceso actual y decidir si tiene sentido seguir.">${esc(state.contratoPrevio)}</textarea>

      <label>Vínculo / rapport inicial <span class="muted">(opcional, nice-to-have)</span></label>
      <textarea data-field="vinculo" placeholder="Algo personal o contexto que conecte par a par.">${esc(state.vinculo)}</textarea>
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

      <label>1. ¿Cuántas personas contratan al mes / al año, aproximadamente?</label>
      <input type="text" data-field="qualif.volumen" value="${esc(state.qualif.volumen)}" placeholder="Ej. 10 al mes, 50 al año, esporádicas..." />

      <label>2. ¿Cuántas personas se dedican a reclutar / seleccionar en su equipo?</label>
      <input type="text" data-field="qualif.equipoRrhh" value="${esc(state.qualif.equipoRrhh)}" placeholder="Ej. el dueño, 2 personas, área estructurada..." />

      <label>3. ¿Qué tipo de perfiles contratan más? <span class="muted">(operativos/masivos, técnicos, profesionales)</span></label>
      <input type="text" data-field="qualif.perfiles" value="${esc(state.qualif.perfiles)}" placeholder="" />

      <label>4. ¿Con qué herramienta manejan hoy el reclutamiento? <span class="muted">(esto define mucho)</span></label>
      <input type="text" data-field="qualif.herramienta" value="${esc(state.qualif.herramienta)}" placeholder="Excel, LinkedIn, bolsas, SAP SuccessFactors, Workday..." />

      <label>5. ¿Quién decide la compra de una herramienta así?</label>
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
        <label>¿Cuál ATS y para qué lo usan principalmente?</label>
        <input type="text" data-field="atsName" value="${esc(state.atsName || state.qualif.herramienta)}" placeholder="SAP SF, Workday, Greenhouse..." />
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

      <label>Dolor principal (fundamental) <span class="muted">— qué problema concreto tiene</span></label>
      <textarea data-field="dolor" placeholder="Ej. les toma 45 días llenar vacantes técnicas y han perdido 2 proyectos por eso.">${esc(state.dolor)}</textarea>

      <label>Impacto económico (fundamental) <span class="muted">— horas/$ que cuesta no resolverlo</span></label>
      <textarea data-field="impactoEconomico" placeholder="Ej. 60 horas/mes en screening manual; 15M COP/mes en agencias.">${esc(state.impactoEconomico)}</textarea>

      <label>Consecuencias emocionales <span class="muted">— nice-to-have, pero potente</span></label>
      <textarea data-field="consecuenciasEmocionales" placeholder="Ej. el equipo está quemado, gerente regañado por el directorio.">${esc(state.consecuenciasEmocionales)}</textarea>

      <label>¿Cómo miden el proceso hoy?</label>
      <textarea data-field="medicion" placeholder="Fuentes, conversión, tiempos.">${esc(state.medicion)}</textarea>

      ${isC ? `
        <label>Integraciones / API del ATS</label>
        <textarea data-field="integraciones" placeholder="Si integra por API, qué han integrado antes.">${esc(state.integraciones)}</textarea>
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

      <label>Presupuesto (fundamental)</label>
      <textarea data-field="presupuesto" placeholder="¿Tienen presupuesto asignado? ¿Rango? ¿Comparado con qué?">${esc(state.presupuesto)}</textarea>

      <label>Decisor / decisores (fundamental)</label>
      <textarea data-field="decisor" placeholder="Nombres, roles. ¿Hay comité? ¿Pasa por compras?">${esc(state.decisor)}</textarea>

      <label>Proceso de decisión (fundamental)</label>
      <textarea data-field="procesoDecision" placeholder="Pasos internos, plazos, criterios.">${esc(state.procesoDecision)}</textarea>
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
      <h1>Lo que el cliente pidió en su ideal</h1>
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

      <label>Post-venta / cómo evitamos remordimiento del comprador <span class="muted">(nice-to-have)</span></label>
      <textarea data-field="postVenta" placeholder="Próximos pasos para que no se eche para atrás.">${esc(state.postVenta)}</textarea>

      <label>Próximo paso concreto acordado <span class="muted">(nice-to-have pero crítico)</span></label>
      <textarea data-field="proximoPaso" placeholder="Ej. demo técnica el martes con el CTO. Enviar propuesta el lunes.">${esc(state.proximoPaso)}</textarea>
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
        <button class="btn" data-act="finish">💾 Guardar deal en servidor</button>
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
  const color = p >= 80 ? 'var(--good)' : p >= 50 ? 'var(--warn)' : 'var(--bad)';
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

// kick off
rou
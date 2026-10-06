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
    // --- Vista 0: Datos iniciales del deal ---
    executive: '',              // ejecutivo comercial de Peaku
    company: '',                // empresa cliente
    lineaNegocio: '',           // SaaS / Headhunting / EOR
    saasInteres: '',            // solo si SaaS: 'sourcing' | 'pruebas' | 'ia' | 'combinado'
    canalAdquisicion: '',       // Freelancer(SDR) / Inbound (correo/web) / Referido / Evento / Outbound interno / Otro
    freelancerNombre: '',       // si viene de freelancer/SDR, nombre de quien lo trajo
    // --- Vista 1: Prospección (data que debe traer quien adquirió, VARÍA por canal) ---
    prospActitud: '',           // qué expresó / cómo llegó / interés inicial
    prospOrigen: '',            // canal específico (qué correo, qué evento, qué referido)
    prospUrgencia: '',          // ¿por qué ahora?
    // Ficha previa SDR (contrato previo Nº 1) — obligatoria si canal = Freelancer/SDR/Outbound
    fichaCargos: '',            // cargos requeridos por el cliente
    fichaCosto: '',             // costo estimado de la vacante abierta
    fichaHerramientas: '',      // herramientas actuales
    fichaAdicional: '',         // notas extras del SDR
    // --- Vista 2: Transcript del demo ---
    transcript: '',              // texto completo pegado
    // --- Vista 3: Análisis IA (output crudo de Claude) ---
    iaExtracted: null,           // objeto completo devuelto por Claude
    iaError: null,
    // --- Datos del demo (todos AUTO-LLENADOS por la IA, editables en review) ---
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
// Flujo transcript-only (nuevo): el comercial pega el transcript y la IA extrae todo.
const STEPS = [
  {
    key: 'inicio', label: '0 · Datos iniciales',
    goal: 'Registrar quién dentro de Peaku es dueño del deal, empresa cliente, línea de negocio y por qué canal llegó. Es la única data que llena el comercial a mano.',
    rule: 'Sin ejecutivo, línea y canal, no puedes evaluar qué combinaciones convierten mejor. Es lo mínimo.',
  },
  {
    key: 'prosp', label: '1 · Prospección',
    goal: 'Registrar lo que trajo el canal ANTES del demo (ficha del SDR, o lo que escribió el cliente si es inbound). Es contexto pre-demo — no lo que el cliente dijo en el demo.',
    rule: 'La info varía según el canal: freelancer/SDR trae ficha completa; inbound solo trae lo que escribió el cliente. Sin ficha por canal, el demo empieza a ciegas.',
  },
  {
    key: 'recordatorio', label: '2 · Guion del demo',
    goal: 'Antes de entrar al demo: recordatorio de qué preguntar según Sandler, qué mostrar según la línea, y qué NO hacer. Avisa que después del demo se pedirá el transcript.',
    rule: 'Léelo 2 min antes del demo. Grabar y activar transcripción de Google Meet ES OBLIGATORIO — sin transcript, la app no puede analizar.',
  },
  {
    key: 'transcript', label: '3 · Transcript del demo',
    goal: 'Pegar el transcript del demo (Google Meet, Otter, Fireflies). Este es el input principal — la IA extrae de aquí dolor, presupuesto, decisión, fecha, pedidos y momentos críticos.',
    rule: 'Grabar TODO el demo. Sin transcript no hay análisis. La verdad la dice el cliente, no la interpretación del comercial.',
  },
  {
    key: 'analisis', label: '4 · Análisis IA',
    goal: 'Claude lee el transcript y extrae toda la información estructurada + genera acciones concretas + detecta momentos críticos donde se dejó ir el dolor o se dio precio sin ancla.',
    rule: 'El análisis tarda 20-40 segundos. No cierres la pestaña.',
  },
  {
    key: 'review', label: '5 · Revisar y ajustar',
    goal: 'Ver todo lo que la IA extrajo, con la cita textual del transcript al lado. Ajustar lo que esté mal antes de guardar.',
    rule: 'La IA puede equivocarse — el comercial es responsable de validar. Especialmente el segmento, la calificación Sandler y la fecha límite.',
  },
  {
    key: 'result', label: '6 · Resultado + Acciones',
    goal: 'Ver calificación Sandler final, qué mostrar, qué faltó, y la lista priorizada de acciones concretas que el comercial debe ejecutar esta semana.',
    rule: 'Solo se cotiza si Calificación = Completa. Las acciones concretas deben aterrizar en tareas del CRM el mismo día.',
  },
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
// Veredicto de la IA por criterio (iaExtracted.criterios_sandler): { cumple, evidencia, falta, accion }.
function veredictoIA(d) {
  const c = d && d.iaExtracted && d.iaExtracted.criterios_sandler;
  if (!c || typeof c !== 'object') return {};
  const out = {};
  for (const k of ['dolor', 'presupuesto', 'decision', 'fecha']) {
    const v = c[k];
    if (v && typeof v === 'object' && typeof v.cumple === 'boolean') out[k] = { cumple: v.cumple, evidencia: v.evidencia || '', falta: v.falta || '', accion: v.accion || '' };
  }
  return out;
}
// Misma regla que sdr/calificacion.js: con veredicto de la IA manda el veredicto (aplica la regla escrita);
// sin veredicto, se infiere de los campos del formulario. Los chulos manuales del tablero mandan sobre todo.
function calificacion(d) {
  const pf = painFunnel(d);
  const ia = veredictoIA(d);
  const campos = {
    dolor: pf.ok,
    presupuesto: has(d.presupuesto),
    decision: has(d.decisor) && has(d.procesoDecision),
    fecha: has(d.fechaLimiteDecision),
  };
  const items = {}, fuente = {};
  for (const k of Object.keys(campos)) { items[k] = k in ia ? ia[k].cumple : campos[k]; fuente[k] = items[k] ? (k in ia ? 'ia' : 'sandler') : null; }
  const man = (d.calificacionManual && d.calificacionManual.items) || {};
  for (const k of Object.keys(items)) if (!items[k] && typeof man[k] === 'boolean') { items[k] = man[k]; if (man[k]) fuente[k] = 'manual'; }
  const done = Object.values(items).filter(Boolean).length;
  let label = 'No califica';
  if (done >= 4) label = 'Completa';
  else if (done >= 2) label = 'Parcial';
  return { label, done, of: 4, pf, items, fuente, detalle: ia, con_ia: Object.keys(ia).length > 0 };
}
function daysBetween(a, b) { return Math.floor((new Date(b).getTime() - new Date(a).getTime()) / 86400000); }

const PRODUCTOS_PEAKU = ['SaaS', 'Headhunting', 'EOR', 'Evaluaciones'];   // qué se vendió (misma lista que EMBUDO.productos)
// Regla escrita de cada criterio (misma que sdr/calificacion.js, que es la que ve la IA y el tablero).
const CRITERIOS_AYUDA = {
  dolor: 'El cliente cuantificó el problema, contó qué ha intentado o describió el impacto (al menos 2 de las 3).',
  presupuesto: 'Ya gastan en resolver esto (herramienta paga, agencia o alguien dedicado: se infiere, no se pregunta el monto) y nuestro rango de precios no les pareció lejos, con plata de este ciclo (no "para el presupuesto del próximo año").',
  decision: 'Se sabe quién aprueba la compra (nombre o cargo; no necesariamente quien usa la herramienta) y cómo la aprueba (pasos, quién más opina, compras o comité). "Lo reviso con mi jefe" no alcanza.',
  fecha: 'El cliente dijo cuándo se decide: un día, un mes o un hito concreto ("en enero, cuando se aprueba el presupuesto", "después del cierre de diciembre", "en el comité del 15"). Cuenta aunque sea lejos (que la plata sea del otro año pega en Presupuesto, no aquí). "Más adelante" o "yo te aviso", sin mes ni hito, no cuenta.',
};

// ---------- Router ----------
function router() {
  // Sin ruta (la página principal) abre el tablero; #/ es el asistente de un deal nuevo.
  const hash = location.hash || '#/tablero';
  document.body.classList.toggle('pk-en-inicio', hash.startsWith('#/inicio'));
  document.querySelectorAll('.pk-tabs a').forEach(a => a.classList.toggle('active', a.getAttribute('href') === hash.split('?')[0]));
  if (hash.startsWith('#/inicio')) return renderInicio();
  if (hash.startsWith('#/tablero')) return renderTablero(new URLSearchParams(hash.split('?')[1] || ''));
  if (hash.startsWith('#/embudo')) return renderEmbudo();
  if (hash.startsWith('#/deal/')) return renderDealDetail(hash.split('/')[2]);
  if (hash === '#/deals') return renderDeals();
  if (hash.startsWith('#/wishlist')) return renderWishlist(new URLSearchParams(hash.split('?')[1] || ''));
  if (hash.startsWith('#/brevo')) return renderBrevo(new URLSearchParams(hash.split('?')[1] || ''));
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
  // Deal del SDR "tomado": se dice en cada paso en qué deal va a quedar este demo, para no pegar la
  // transcripción de otra empresa en un deal que quedó abierto en la pestaña.
  const tomado = state.sdrDealId ? `<div class="hint deal-tomado"><span>Este demo se va a guardar en el <strong>deal #${esc(String(state.sdrDealId))} · ${esc(state.company || '')}</strong> (agendado por el SDR).</span> <button type="button" class="btn ghost btn-sm" data-act="soltar">No es este deal</button></div>` : '';
  return `${tomado}<div class="steps">
    ${STEPS.map((s,i) => {
      const cls = i === stepIdx ? 'active' : (i < stepIdx ? 'done' : '');
      const tipText = `${s.label.replace(/^\d+ · /, '')}\n\nOBJETIVO: ${s.goal}\n\nREGLA: ${s.rule}`;
      return `<span class="step ${cls}">${s.label} ${tip(tipText)}</span>`;
    }).join('')}
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
    else if (a === 'finish') { submitDeal(b); }
    else if (a === 'soltar') {
      if (!confirm(`Este demo dejará de estar ligado al deal #${state.sdrDealId} (${state.company || ''}). Al guardar se creará un deal nuevo con la empresa que pongas en Datos. ¿Seguir?`)) return;
      delete state.sdrDealId; saveDraft(); renderWizard();
    }
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
  if (s === 'inicio')       return stepInicio();
  if (s === 'prosp')        return stepProsp();
  if (s === 'recordatorio') return stepRecordatorio();
  if (s === 'transcript')   return stepTranscript();
  if (s === 'analisis')   return stepAnalisis();
  if (s === 'review')     return stepReview();
  if (s === 'result')     return stepResult();
}

// Componente reutilizable: bloque de "Objetivo + regla" para cada vista
function viewIntro(idx) {
  const st = STEPS[idx];
  return `
    <div class="hint" style="background:#f0fbff;border-left-color:var(--peaku-blue);">
      <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--peaku-blue-dark);margin-bottom:6px;">Objetivo de esta etapa</div>
      <div style="margin-bottom:8px;">${st.goal}</div>
      <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--peaku-gray);margin-bottom:4px;">Regla del proceso</div>
      <div>${st.rule}</div>
    </div>
  `;
}

// ---------- Definición de líneas de negocio ----------
// SaaS: cliente USA la plataforma para adquisición (sourcing), IA (ranking) o pruebas.
// Headhunting: PEAKU busca y trae el talento para el cliente.
// EOR: cliente YA identificó al candidato; Peaku lo contrata legalmente a su nombre.
const LINEAS = {
  SaaS: {
    label: 'SaaS',
    resumen: 'Cliente usa nuestra plataforma para sourcing, IA de ranking o pruebas de candidatos. Autoservicio.',
    quienBusca: 'el cliente (con nuestra plataforma)',
    dolorEje: 'ineficiencia en su proceso de reclutamiento (tiempo, calidad, costo)',
    ficha: {
      titulo: 'Datos del proceso de reclutamiento del cliente',
      cargosLabel: 'Vacantes abiertas hoy (que resolverá con la plataforma)',
      cargosPh: 'Ej. 3 devs full-stack, 2 SDRs bilingües — llevan semanas leyendo hojas de vida.',
      costoLabel: 'Costo actual del proceso (horas / dinero)',
      costoPh: 'Ej. reclutadora gasta 60 hrs/mes en screening; agencias 8M/vacante; time-to-fill 45 días.',
      herramLabel: 'Herramientas actuales de reclutamiento',
      herramPh: 'Ej. Computrabajo + LinkedIn Recruiter + Excel. Sin ATS.',
    },
    dolorPh: 'Ej. reclutadora gasta 60hrs/mes leyendo CVs; time-to-fill 45 días; perdieron cliente por vacante no cubierta.',
    qualif: {
      volumen: '¿Cuántas vacantes abren al mes / al año?',
      equipo: '¿Cuántas personas en RRHH manejan reclutamiento?',
      perfiles: '¿Qué perfiles buscan más (operativos/técnicos/profesionales)?',
      herramienta: '¿Con qué herramientas manejan reclutamiento hoy?',
      decisor: '¿Quién decide la compra de una plataforma como esta?',
    },
  },
  Headhunting: {
    label: 'Headhunting',
    resumen: 'Peaku busca y trae el talento (search a la medida). El cliente NO usa la plataforma — nos entrega la búsqueda.',
    quienBusca: 'Peaku (por encargo del cliente)',
    dolorEje: 'una o varias posiciones críticas que el cliente no puede llenar solo',
    ficha: {
      titulo: 'Posiciones que el cliente necesita que Peaku busque',
      cargosLabel: 'Perfil/posición a buscar',
      cargosPh: 'Ej. VP de Producto con 10 años en fintech, bilingüe, base Bogotá. Salario 20-25M COP.',
      costoLabel: 'Costo de tener la posición vacía + qué han intentado',
      costoPh: 'Ej. VP vacía = 30M COP/mes en oportunidad; ya probaron 2 firmas de HH sin traer perfil.',
      herramLabel: '¿Cómo lo han buscado hasta ahora?',
      herramPh: 'Ej. 2 firmas de HH externas, LinkedIn Recruiter, referidos internos — sin resultado.',
    },
    dolorPh: 'Ej. llevan 6 meses buscando VP de Producto; 2 firmas de HH sin traer perfil; el CEO está cubriendo el rol y está quemado.',
    qualif: {
      volumen: '¿Cuántas búsquedas de HH tercerizan al año? (o cuántas quisieran)',
      equipo: '¿Tienen equipo interno de TA que ya intentó estas posiciones?',
      perfiles: '¿Qué seniority buscan (C-level, gerencia, especialista senior)?',
      herramienta: '¿Con qué firma o método las están intentando hoy?',
      decisor: '¿Quién decide contratar servicio de HH y quién aprueba al candidato?',
    },
  },
  EOR: {
    label: 'EOR',
    resumen: 'El cliente YA encontró al candidato. Peaku lo contrata legalmente a nuestro nombre (Employer of Record) en el país que aplique.',
    quienBusca: 'el cliente ya encontró — no buscamos',
    dolorEje: 'no pueden contratar directamente al candidato encontrado (por país, entidad legal, régimen fiscal)',
    ficha: {
      titulo: 'Candidatos ya identificados por el cliente',
      cargosLabel: 'Candidato(s) ya identificado(s) y país donde vive',
      cargosPh: 'Ej. Juan Pérez (Argentina) — Senior Backend; María Ríos (México) — Product Manager.',
      costoLabel: 'Salario acordado + fecha de arranque + urgencia',
      costoPh: 'Ej. Juan: USD 6.500/mes, arranca 1 ago; María: USD 7.200, arranca 15 ago. Ambos ya firmaron oferta condicionada.',
      herramLabel: '¿Cómo han contratado talento internacional antes?',
      herramPh: 'Ej. Deel para Argentina; Remote.com para México; en Colombia contratan directo. Buscan consolidar en un solo EOR.',
    },
    dolorPh: 'Ej. tienen a Juan (Argentina) firmado para arrancar en 3 semanas; hoy lo contratarían como freelancer pero quieren payroll formal sin riesgo fiscal.',
    qualif: {
      volumen: '¿Cuántas contrataciones internacionales hacen al año?',
      equipo: '¿Tienen equipo legal/RRHH que maneja compliance internacional?',
      perfiles: '¿Qué países y qué tipo de contrato (indefinido/temporal, remoto/hybrido)?',
      herramienta: '¿Con qué EOR trabajan hoy? (Deel, Remote.com, Papaya, contratación directa)',
      decisor: '¿Quién aprueba una contratación internacional? (RRHH + finanzas + legal)',
    },
  },
};
function linea() { return LINEAS[state.lineaNegocio] || LINEAS.SaaS; }

// ---------- 0 · Datos iniciales del deal ----------
const CANALES = [
  { key: 'freelancer',  label: 'Freelancer / SDR externo', desc: 'Prospector externo que agenda demos a comisión.' },
  { key: 'sdr_interno', label: 'SDR interno', desc: 'Prospección hecha por el equipo interno de Peaku.' },
  { key: 'inbound',     label: 'Inbound (correo / web)',   desc: 'El cliente llegó solo — escribió por la web o mandó un correo pidiendo reunión.' },
  { key: 'referido',    label: 'Referido',                 desc: 'Otro cliente o contacto nos lo pasó explícitamente.' },
  { key: 'evento',      label: 'Evento / networking',      desc: 'Salió de una charla, feria o reunión presencial.' },
  { key: 'outbound',    label: 'Outbound del ejecutivo',   desc: 'El mismo ejecutivo comercial contactó al prospecto.' },
  { key: 'otro',        label: 'Otro',                     desc: 'Otro canal — describe abajo.' },
];

function stepInicio() {
  h(`
    ${stepHeader()}
    <h1>Datos iniciales del deal</h1>
    ${viewIntro(stepIdx)}

    <div class="card">
      <h3>Dueño y cliente</h3>
      <div class="row">
        <div>
          <label>Tu nombre ${tip('Ejecutivo comercial de Peaku que llevará este deal de punta a punta.\n\nSirve para reportería por persona y para asignar tareas de seguimiento.\n\nEj.: "Santiago Pérez"')}</label>
          <input type="text" data-field="executive" value="${esc(state.executive)}" placeholder="Ej. Santiago Pérez" />
        </div>
        <div>
          <label>Empresa / Cliente ${tip('Razón social del cliente prospecto. Si aún no la sabes con exactitud, ponle un alias y la ajustas después.\n\nEj.: "Lean Solutions S.A."')}</label>
          <input type="text" data-field="company" value="${esc(state.company)}" placeholder="Ej. Lean Solutions" />
        </div>
      </div>

      <label>Línea de negocio ${tip('CRÍTICO: define TODO el guion del demo, no solo el precio. Cada línea es un producto distinto con dolor distinto.\n\n• SaaS — cliente usa la plataforma él mismo (sourcing, IA, pruebas).\n• Headhunting — Peaku busca y trae el talento por él.\n• EOR — cliente ya tiene el candidato; Peaku lo contrata legalmente.\n\nSi mezclas líneas, la calificación no aplica y la venta se enreda.')}</label>
      <div class="chips" style="flex-direction:column;align-items:stretch;gap:8px;">
        ${Object.keys(LINEAS).map(k => `
          <div class="chip ${state.lineaNegocio === k ? 'selected' : ''}" data-pick-linea="${k}" style="text-align:left;">
            <strong>${LINEAS[k].label}</strong>
            <div class="opt" style="margin-top:3px;">${esc(LINEAS[k].resumen)}</div>
          </div>
        `).join('')}
      </div>

      ${state.lineaNegocio === 'SaaS' ? `
        <label style="margin-top:14px;">Interés específico en SaaS ${tip('El cliente puede querer distintos ángulos de la plataforma. La propuesta debe encajar con lo que él realmente busca.\n\n• Sourcing: adquisición automatizada de candidatos (alimentar el embudo).\n• Pruebas: assessments/tests para filtrar candidatos que ellos ya tienen.\n• IA de ranking: motor de scoring que ordena candidatos automáticamente.\n• Combinado: quiere varios / no está claro aún.')}</label>
        <div class="chips">
          ${[
            {k:'sourcing', l:'Sourcing (traer candidatos)'},
            {k:'pruebas', l:'Pruebas / assessments'},
            {k:'ia', l:'IA de ranking / scoring'},
            {k:'combinado', l:'Combinado / por definir'}
          ].map(o => `<div class="chip ${state.saasInteres === o.k ? 'selected' : ''}" data-pick-saas="${o.k}">${o.l}</div>`).join('')}
        </div>
      ` : ''}
    </div>

    <div class="card">
      <h3>Canal de adquisición</h3>
      <p class="muted" style="font-size:13px;margin:0 0 10px;">Cómo llegó este deal a Peaku. La info que trae ya prospección cambia según el canal.</p>
      <div class="chips">
        ${CANALES.map(c => `
          <div class="chip ${state.canalAdquisicion === c.key ? 'selected' : ''}" data-pick-canal="${c.key}" title="${esc(c.desc)}">
            ${c.label}
          </div>
        `).join('')}
      </div>

      ${(state.canalAdquisicion === 'freelancer' || state.canalAdquisicion === 'sdr_interno') ? `
        <label style="margin-top:16px;">Nombre del freelancer / SDR ${tip('Quién específicamente hizo la prospección. Sirve para reportería por freelancer y para cerrar el loop cuando cae un deal (o cuando el deal fue basura).')}</label>
        <input type="text" data-field="freelancerNombre" value="${esc(state.freelancerNombre)}" placeholder="Ej. Andrea Ramírez (freelancer)" />
      ` : ''}
      ${state.canalAdquisicion === 'referido' ? `
        <label style="margin-top:16px;">¿Quién refirió? ${tip('Nombre y contexto de quien nos refirió. Un referido calienta el arranque del demo — vale la pena mencionarlo temprano.')}</label>
        <input type="text" data-field="freelancerNombre" value="${esc(state.freelancerNombre)}" placeholder="Ej. Juan Osorio (cliente actual, gerente de RRHH en Alkosto)" />
      ` : ''}
      ${state.canalAdquisicion === 'evento' ? `
        <label style="margin-top:16px;">¿Qué evento y a quién conociste ahí? ${tip('Evento + persona con la que hablaste. Ayuda a retomar el contexto que se dio.')}</label>
        <input type="text" data-field="freelancerNombre" value="${esc(state.freelancerNombre)}" placeholder="Ej. HR Summit Bogotá, hablé con la gerente de TA de Bavaria" />
      ` : ''}
    </div>

    ${navButtons({ prevHidden: true })}
  `);
  bindForm();
  el.querySelectorAll('[data-pick-linea]').forEach(c => c.addEventListener('click', () => {
    state.lineaNegocio = c.getAttribute('data-pick-linea');
    if (state.lineaNegocio !== 'SaaS') state.saasInteres = '';
    saveDraft(); renderWizard();
  }));
  el.querySelectorAll('[data-pick-saas]').forEach(c => c.addEventListener('click', () => {
    state.saasInteres = c.getAttribute('data-pick-saas');
    saveDraft(); renderWizard();
  }));
  el.querySelectorAll('[data-pick-canal]').forEach(c => c.addEventListener('click', () => {
    state.canalAdquisicion = c.getAttribute('data-pick-canal');
    saveDraft(); renderWizard();
  }));
}

// ---------- 1 · Prospección (ficha por canal) ----------
function stepProsp() {
  const canal = state.canalAdquisicion || '';
  const canalLabel = (CANALES.find(c => c.key === canal) || {}).label || 'sin definir';
  const necesitaFicha = ['freelancer', 'sdr_interno', 'outbound'].includes(canal);
  const fichaOk = has(state.fichaCargos) && has(state.fichaCosto) && has(state.fichaHerramientas);

  h(`
    ${stepHeader()}
    <h1>Prospección · lo que trajo <em>${esc(canalLabel)}</em></h1>
    ${viewIntro(stepIdx)}

    ${!canal ? `
      <div class="card" style="background:#fdecec;border-left:6px solid var(--bad);">
        <strong>Falta el canal de adquisición.</strong> Devuélvete al paso 0 y elígelo.
      </div>
    ` : ''}

    <div class="card">
      <h3>Contexto de cómo llegó el cliente</h3>
      <label>¿Cómo llegó específicamente? ${tip('Detalle del canal.\n\n• Freelancer/SDR: qué le dijo el prospector para que aceptara el demo.\n• Inbound: qué escribió el cliente en el correo o formulario.\n• Referido: qué le contó la persona que refirió.\n• Evento: qué hablaron ahí que llevó al demo.\n• Outbound: qué gancho usaste tú.')}</label>
      <textarea data-field="prospOrigen" placeholder="${canal === 'inbound' ? 'Ej. escribió al correo diciendo: nos interesa Peaku porque estamos abriendo operación en Colombia.' : canal === 'referido' ? 'Ej. Juan (Alkosto) me mandó un WhatsApp: hablá con Diana de Bavaria, están buscando lo mismo que ustedes hicieron con nosotros.' : 'Ej. le vendí el demo diciendo que teníamos un caso similar a su empresa.'}">${esc(state.prospOrigen)}</textarea>

      <label>Actitud / interés que expresó ${tip('Qué tan enganchado llegó al demo. Alta / media / baja + una frase que lo capture.\n\nEj.: "Muy interesado — dice que llevan 3 meses buscando esto sin resolver."')}</label>
      <textarea data-field="prospActitud" placeholder="Ej. muy interesado, ya tienen dolor identificado; o tibio, solo quería ver qué hacemos.">${esc(state.prospActitud)}</textarea>

      <label>¿Por qué AHORA? ${tip('El gatillo que hizo que el cliente aceptara reunirse ahora, no en 6 meses. Sin gatillo, la venta suele diluirse.\n\nEj.: "Perdieron a su recruiter senior el mes pasado y tienen 4 vacantes urgentes." o "Van a expandir a Perú en agosto y necesitan un stack de RRHH escalable."')}</label>
      <textarea data-field="prospUrgencia" placeholder="Ej. perdieron reclutadora y tienen 4 vacantes urgentes.">${esc(state.prospUrgencia)}</textarea>
    </div>

    ${necesitaFicha ? `
      <div class="card">
        <h3>${esc(linea().ficha.titulo)} <span class="opt">(obligatoria en freelancer / SDR / outbound)</span></h3>
        <p class="muted" style="font-size:13px;">Línea de negocio: <strong>${esc(linea().label)}</strong> · ${esc(linea().resumen)}<br/>Info que el prospector DEBIÓ preguntar antes de agendar el demo. Si viene incompleta, el demo empieza a ciegas — reporta esto al canal.</p>

        <label>${esc(linea().ficha.cargosLabel)} ${tip('Es el disparador del demo — sin esto no hay caso concreto.\n\nEjemplo para ' + linea().label + ':\n' + linea().ficha.cargosPh)}</label>
        <textarea data-field="fichaCargos" placeholder="${esc(linea().ficha.cargosPh)}">${esc(state.fichaCargos)}</textarea>

        <label>${esc(linea().ficha.costoLabel)} ${tip('Es el ANCLA del precio en el demo. Sin número, el precio se evalúa como gasto puro.\n\nEjemplo para ' + linea().label + ':\n' + linea().ficha.costoPh)}</label>
        <textarea data-field="fichaCosto" placeholder="${esc(linea().ficha.costoPh)}">${esc(state.fichaCosto)}</textarea>

        <label>${esc(linea().ficha.herramLabel)} ${tip('Qué usan hoy. Define contra qué compites y qué guion usar.\n\nEjemplo para ' + linea().label + ':\n' + linea().ficha.herramPh)}</label>
        <textarea data-field="fichaHerramientas" placeholder="${esc(linea().ficha.herramPh)}">${esc(state.fichaHerramientas)}</textarea>

        <label>Notas adicionales del prospector ${tip('Cualquier otra info — tamaño empresa, urgencia, contactos, restricciones ya mencionadas.')}<span class="opt">(opcional)</span></label>
        <textarea data-field="fichaAdicional" placeholder="Ej. empresa 400 empleados en Medellín; contacto directo con la gerente de TA (Diana).">${esc(state.fichaAdicional)}</textarea>

        <div style="margin-top:14px;">${fichaOk ? '<span class="pill good">✓ Ficha completa · demo bien agendado</span>' : '<span class="pill bad">Ficha incompleta · el demo empieza a ciegas — devuelve al canal</span>'}</div>
      </div>
    ` : `
      <div class="card">
        <h3>Ficha previa <span class="opt">(opcional para este canal)</span></h3>
        <p class="muted" style="font-size:13px;">Como este deal vino por <strong>${esc(canalLabel)}</strong>, no exigimos ficha llena — el cliente vino solo. Pero si tienes algún dato adicional que te dio, ponlo aquí.</p>
        <label>Cargos / dolor que mencionó el cliente ${tip('Cualquier vacante o problema específico que el cliente mencionó al escribir/pedir la reunión.')}<span class="opt">(opcional)</span></label>
        <textarea data-field="fichaCargos" placeholder="Ej. mencionaron que necesitan cubrir 2 vacantes técnicas urgentes.">${esc(state.fichaCargos)}</textarea>
        <label>Notas del cliente ${tip('Cualquier otro detalle textual que dio el cliente.')}<span class="opt">(opcional)</span></label>
        <textarea data-field="fichaAdicional" placeholder="Ej. escribió a las 11pm — parece tener urgencia.">${esc(state.fichaAdicional)}</textarea>
      </div>
    `}

    ${navButtons()}
  `);
  bindForm();
}

function stepIntro() {
  h(`
    ${stepHeader()}
    <h1>Construcción de confianza · dentro del demo</h1>
    ${viewIntro(stepIdx)}

    <div class="card">
      <p class="muted" style="margin:0 0 14px;font-size:13px;">Ejecutivo: <strong>${esc(state.executive) || '—'}</strong> · Cliente: <strong>${esc(state.company) || '—'}</strong> · Canal: <strong>${esc((CANALES.find(c => c.key === state.canalAdquisicion) || {}).label || '—')}</strong></p>

      <label>Contrato previo acordado con el cliente ${tip('FUNDAMENTAL Sandler. Antes de meter preguntas, hazlo explícito con el cliente:\n\n1. Duración de la reunión\n2. Qué buscan ambos\n3. Permiso para decir "no" si no hay ajuste\n\nEj.: "Tenemos 30 min. Yo entiendo su proceso actual y sus dolores; al final decidimos juntos si tiene sentido cotizar. Está totalmente bien que ustedes digan que no si esto no es para ustedes."\n\nSin esto, el cliente se pone a la defensiva y no confiesa dolores reales.')}<span class="opt">(tiempo, agenda, permiso para el "no")</span></label>
      <textarea data-field="contratoPrevio" placeholder="Ej. 30 min, entiendo proceso y dolores; al final decidimos juntos. Acordado que pueden decir 'no'.">${esc(state.contratoPrevio)}</textarea>

      <label>Vínculo / rapport inicial ${tip('Cómo rompiste el hielo y generaste relación par a par. Ayuda a contextualizar el deal después.\n\nEj.: "Hablamos 5 min de la expansión que tienen a Cali; conozco al líder de RRHH del Grupo Éxito y le mencioné. Tono cálido, conversación par a par."')}<span class="opt">(nice-to-have)</span></label>
      <textarea data-field="vinculo" placeholder="Ej. hablamos de su expansión, conocemos personas en común, tono cálido.">${esc(state.vinculo)}</textarea>
    </div>
    ${navButtons()}
  `);
  bindForm();
}

// ---------- 2 · Guion del demo (recordatorio pre-demo) ----------
function stepRecordatorio() {
  const l = state.lineaNegocio || 'SaaS';
  const focoSaaS = {
    sourcing: 'Enfoca el demo en cómo Peaku les llena el embudo automáticamente. Muestra 1-2 campañas en vivo. Aterriza en horas ahorradas.',
    pruebas: 'Enfoca el demo en el motor de pruebas / assessments. Muestra cómo filtra candidatos que ellos ya tienen. Aterriza en tiempo de screening ahorrado.',
    ia: 'Enfoca el demo en el ranking automático (scoring IA). Muestra cómo ordena candidatos automáticamente. Aterriza en horas eliminadas de screening manual.',
    combinado: 'Cliente aún no tiene claro qué quiere — usa los primeros minutos para forzar la elección. No muestres todo, muestra 1 ángulo profundo del que confesó dolor.',
  }[state.saasInteres] || '';

  // Recordatorios por línea
  const showRules = {
    SaaS: [
      'Mostrar SOURCING automático solo si su dolor es traer candidatos.',
      'Mostrar IA de ranking solo si gastan horas en screening.',
      'Mostrar PRUEBAS/assessments solo si el dolor es filtrar candidatos que ya tienen.',
      'Nunca muestres los 3 en el mismo demo — abrumas y no ancla el precio.',
    ],
    Headhunting: [
      'Foco en el PROCESO de búsqueda: base de datos + red de investigadores + criterio de filtro.',
      'Preguntar qué han intentado antes con otras firmas — el dolor real está ahí.',
      'Aterrizar en fee % y timeline (garantizado en 4-6 semanas).',
    ],
    EOR: [
      'NO buscamos talento — el cliente ya lo tiene. Muestra proceso de contratación legal + payroll.',
      'Foco en países cubiertos, fees por país, tiempos de setup.',
      'Aterrizar en el candidato específico: "¿podemos hacerte un cálculo para Juan (Argentina) ya?"',
    ],
  }[l] || [];

  h(`
    ${stepHeader()}
    <h1>Guion del demo — repásalo 2 minutos antes de entrar</h1>
    ${viewIntro(stepIdx)}

    <div class="card" style="border-left:6px solid var(--peaku-blue);background:#f0fbff;">
      <h2 style="margin-top:0;">🎥 CRÍTICO antes de arrancar</h2>
      <ul style="padding-left:22px;line-height:2;font-size:14px;">
        <li><strong>Activa "Transcribir reunión"</strong> en Google Meet (menú de 3 puntos). Sin transcript, la app NO puede analizar el demo.</li>
        <li>Empieza el demo con el <strong>contrato previo</strong>: "Tenemos ${l === 'EOR' ? '20' : '30'} min. Entiendo su situación, al final decidimos juntos si tiene sentido cotizar. Está bien que digan que no."</li>
        <li>Regla de oro: <strong>escucha 70%, habla 30%</strong>. No muestres pantalla en los primeros 10 min.</li>
      </ul>
    </div>

    <div class="card">
      <h2>❓ El embudo del dolor — DEBES hacer estas 3 preguntas</h2>
      <p class="muted" style="font-size:13px;">Cuando el cliente mencione un problema, párate ahí. <strong>Mínimo 2 de 3</strong> antes de continuar. Sin esto, el precio no ancla.</p>
      <ol style="padding-left:22px;line-height:2;">
        <li><strong>Cuantificar:</strong> "¿Cuánto les cuesta al mes tener [ese problema]?" — busca $ o horas concretas.</li>
        <li><strong>Historia:</strong> "¿Qué han intentado para resolverlo y por qué no funcionó?"</li>
        <li><strong>Impacto:</strong> "¿Qué pasa con el cliente final / con el equipo cuando eso no se resuelve?"</li>
      </ol>
    </div>

    <div class="card">
      <h2>💰 Presupuesto + Decisión + Fecha (contrato Nº 2)</h2>
      <ul style="padding-left:22px;line-height:2;font-size:14px;">
        <li><strong>Presupuesto:</strong> "¿tienen un presupuesto asignado para esto? ¿comparado contra qué alternativa?"</li>
        <li><strong>Decisión:</strong> "¿quiénes participan en la decisión? ¿pasa por compras? ¿quién firma?"</li>
        <li><strong>Fecha límite (LA MÁS IMPORTANTE):</strong> "¿para cuándo necesitan esto resuelto?" — sin fecha, no hay cotización. Máximo 14 días.</li>
      </ul>
    </div>

    <div class="card">
      <h2>📽 Qué mostrar en este demo — Línea: <strong>${esc(l)}</strong>${state.saasInteres ? ` · foco: <strong>${esc(state.saasInteres)}</strong>` : ''}</h2>
      ${focoSaaS ? `<div class="hint"><strong>Foco SaaS:</strong> ${esc(focoSaaS)}</div>` : ''}
      <ul style="padding-left:22px;line-height:1.9;font-size:14px;">
        ${showRules.map(r => `<li>${esc(r)}</li>`).join('')}
      </ul>
    </div>

    <div class="card">
      <h2>🚫 Lo que NO debes hacer</h2>
      <ul style="padding-left:22px;line-height:1.9;font-size:14px;">
        <li><strong>NO des precio antes del minuto 30.</strong> Si te lo piden: "Déjame entender primero el tamaño del problema para proponerte la modalidad correcta. Llegamos a cifras al final."</li>
        <li><strong>NO dejes que el cliente dicte los próximos pasos.</strong> Tú propones fecha y formato de la siguiente reunión.</li>
        <li><strong>NO te despidas con "le envío la propuesta para que la revise".</strong> Cierra la siguiente reunión antes de colgar.</li>
        <li><strong>NO cotices si el deal no calificó completo</strong> (dolor + presupuesto + decisión + fecha). Va a nutrición.</li>
      </ul>
    </div>

    <div class="card" style="border-left:6px solid var(--peaku-green);background:#e8f6f0;">
      <h2 style="margin-top:0;color:var(--peaku-green-dark);">🚀 Ofrece PILOTO como próximo paso</h2>
      <p style="font-size:14px;">Si el deal califica completo, propón un piloto real esta semana: "Antes de que evalúen una propuesta en frío, publiquemos [el cargo del dolor] esta semana. El [día pactado] revisamos juntos resultados + cotización completa." La cotización va de anexo del piloto, nunca al revés.</p>
    </div>

    <div class="card" style="border-left:6px solid var(--peaku-blue);">
      <h2 style="margin-top:0;">Siguiente paso: después del demo</h2>
      <p style="font-size:14px;margin:0;">Cuando termine la reunión, abre el transcript de Google Meet (Drive → carpeta "Meet Recordings" o el correo que te llegó) y <strong>pégalo en el siguiente paso</strong>. La IA extrae dolor, presupuesto, decisión, momentos críticos y te da la lista de acciones concretas.</p>
    </div>

    ${navButtons({ nextLabel: 'Ya hice el demo · pegar transcript →' })}
  `);
  bindForm();
}

// ---------- 3 · Transcript del demo ----------
function stepTranscript() {
  h(`
    ${stepHeader()}
    <h1>Transcript del demo</h1>
    ${viewIntro(stepIdx)}

    <div class="card">
      <h3>Cómo obtener el transcript de Google Meet</h3>
      <ol style="padding-left:20px;line-height:1.9;font-size:14px;color:var(--peaku-gray);">
        <li>En la reunión: activa <strong>Transcribir reunión</strong> (menú de tres puntos → Grabar / Transcribir).</li>
        <li>Al terminar el demo, Google envía el transcript por correo y lo guarda en el <strong>Google Drive</strong> del organizador (carpeta "Meet Recordings").</li>
        <li>Abre el documento del transcript, selecciona todo (<code>Ctrl/Cmd + A</code>), copia (<code>Ctrl/Cmd + C</code>) y pega aquí abajo.</li>
      </ol>
      <p class="muted" style="font-size:13px;">Tips: si el transcript trae timestamps (12:34), déjalos — la IA los usa para citar momentos. Si vino de Otter/Fireflies, también sirve.</p>
    </div>

    <div class="card">
      <label>Transcript completo del demo ${tip('Pega el transcript literal, con nombres de speaker si aparecen. Cuanto más completo, mejor la extracción.\n\nTamaño típico: 5.000-25.000 palabras para un demo de 30-45 min.')}</label>
      <textarea id="ts-input" data-field="transcript" style="min-height:340px;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12.5px;" placeholder="Pega aquí el transcript completo del demo...&#10;&#10;Ejemplo del formato de Google Meet:&#10;&#10;Santiago (Peaku)  10:04&#10;Hola María, gracias por la disponibilidad. ¿Podemos usar los primeros 5 minutos para entender su proceso?&#10;&#10;María (Cliente)  10:04&#10;Sí claro, adelante...">${esc(state.transcript || '')}</textarea>
      <div id="ts-counter" style="margin-top:8px;font-size:12px;color:var(--muted);"></div>
    </div>

    <div class="btn-row">
      <button class="btn ghost" data-act="prev">← Atrás</button>
      <div style="display:flex;gap:10px;">
        <button class="btn secondary" data-act="save">Guardar borrador</button>
        <button class="btn" id="btn-analyze">🤖 Analizar con IA →</button>
      </div>
    </div>
  `);
  bindForm();

  const input = el.querySelector('#ts-input');
  const counter = el.querySelector('#ts-counter');
  const btn = el.querySelector('#btn-analyze');

  function refresh() {
    const t = input.value || '';
    const chars = t.length;
    const words = t.trim().split(/\s+/).filter(Boolean).length;
    const enough = chars >= 500;
    counter.innerHTML = `${chars.toLocaleString()} caracteres · ${words.toLocaleString()} palabras · ${
      enough ? '<span class="pill good">Suficiente para analizar</span>' : '<span class="pill warn">Muy corto (mín 500 chars) — sigue pegando</span>'
    }`;
    btn.disabled = !enough;
    btn.style.opacity = enough ? '1' : '.5';
    btn.style.cursor = enough ? 'pointer' : 'not-allowed';
  }
  input.addEventListener('input', refresh);
  input.addEventListener('paste', () => setTimeout(refresh, 0));
  refresh();

  btn.addEventListener('click', () => {
    if (btn.disabled) return;
    // Aseguramos que el último valor esté en el state antes de avanzar
    state.transcript = input.value;
    stepIdx++; saveDraft(); renderWizard();
  });
}

// ---------- 3 · Análisis IA ----------
async function stepAnalisis() {
  h(`
    ${stepHeader()}
    <h1>Analizando el demo con Claude...</h1>
    ${viewIntro(stepIdx)}
    <div class="card" style="text-align:center;padding:60px 20px;">
      <div style="font-size:48px;margin-bottom:20px;">🤖</div>
      <h2 style="margin-bottom:8px;">Extrayendo dolor, presupuesto, decisión, momentos críticos...</h2>
      <p class="muted" id="analisis-status">Enviando la transcripción a la IA · suele tardar 1 a 2 minutos.</p>
      <div class="progress" style="max-width:400px;margin:24px auto 0;"><span id="pbar" style="width:20%;"></span></div>
      <p class="muted" id="analisis-error" style="color:var(--bad);margin-top:20px;display:none;"></p>
    </div>
  `);

  // Animar barra progresivamente
  let pct = 20;
  const timer = setInterval(() => {
    pct = Math.min(pct + 3, 90);
    const bar = document.getElementById('pbar');
    if (bar) bar.style.width = pct + '%';
  }, 800);
  const stages = [
    'Enviando transcript a Claude...',
    'Analizando dolor y embudo (cuantificar / historia / impacto)...',
    'Detectando presupuesto y decisor...',
    'Buscando fecha límite acordada...',
    'Extrayendo pedidos del cliente y momentos críticos...',
    'Generando acciones concretas para esta semana...',
  ];
  let si = 0;
  const stageTimer = setInterval(() => {
    si = Math.min(si + 1, stages.length - 1);
    const s = document.getElementById('analisis-status');
    if (s) s.textContent = stages[si];
  }, 5000);

  try {
    const r = await fetch('/api/analyze', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        transcript: state.transcript,
        context: {
          company: state.company, executive: state.executive, lineaNegocio: state.lineaNegocio,
          saasInteres: state.saasInteres,
          canalAdquisicion: state.canalAdquisicion, freelancerNombre: state.freelancerNombre,
          fichaCargos: state.fichaCargos, fichaCosto: state.fichaCosto,
          fichaHerramientas: state.fichaHerramientas, fichaAdicional: state.fichaAdicional,
          prospActitud: state.prospActitud, prospUrgencia: state.prospUrgencia,
          prospOrigen: state.prospOrigen,
        }
      }),
    });
    clearInterval(timer); clearInterval(stageTimer);
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw Object.assign(new Error(err.error || `HTTP ${r.status}`), { raw: err.raw });
    }
    const data = await r.json();
    state.iaExtracted = data;
    state.iaError = null;

    // Aplicar al state — la IA es la fuente de verdad inicial
    const map = ['contratoPrevio','vinculo','dolor','dolorCuantificar','dolorHistoria','dolorImpacto',
      'consecuenciasEmocionales','medicion','integraciones','presupuesto','decisor','procesoDecision',
      'fechaLimiteDecision','proximoPaso','postVenta','pilotoCargo','pilotoFechaRevision','atsName'];
    for (const k of map) if (data[k] !== undefined) state[k] = data[k];
    if (data.segmento_sugerido) state.segment = String(data.segmento_sugerido).charAt(0).toUpperCase();
    if (typeof data.hasAts === 'boolean') state.hasAts = data.hasAts;
    if (Array.isArray(data.idealRequests)) state.idealRequests = data.idealRequests;

    const bar = document.getElementById('pbar');
    if (bar) bar.style.width = '100%';
    stepIdx++; saveDraft();
    setTimeout(() => renderWizard(), 400);
  } catch (e) {
    clearInterval(timer); clearInterval(stageTimer);
    state.iaError = e.message;
    const err = document.getElementById('analisis-error');
    if (err) {
      err.style.display = 'block';
      err.innerHTML = `❌ Error: ${esc(e.message)}<br/>
        <button class="btn ghost" onclick="stepIdx--; renderWizard();" style="margin-top:10px;">← Volver al transcript</button>
        <button class="btn ghost" onclick="renderWizard();" style="margin-top:10px;">↻ Intentar de nuevo</button>
        ${e.raw ? `<details style="margin-top:12px;text-align:left"><summary class="muted" style="cursor:pointer;font-size:12px">Detalle técnico (lo que devolvió la IA)</summary><pre style="white-space:pre-wrap;font-size:11px;max-height:220px;overflow:auto">${esc(String(e.raw).slice(0, 1500))}</pre></details>` : ''}`;
    }
  }
}

// ---------- 4 · Review y ajustar ----------
function stepReview() {
  const ia = state.iaExtracted || {};
  const cal = calificacion(state);

  const field = (label, key, ph, isDate) => {
    const val = state[key] || '';
    const type = isDate ? 'date' : 'text';
    return `
      <div class="detail-field">
        <div class="detail-label">${label}</div>
        <div>
          ${isDate
            ? `<input type="date" data-field="${key}" value="${esc(val)}" />`
            : `<textarea data-field="${key}" placeholder="${esc(ph||'')}" style="min-height:60px;">${esc(val)}</textarea>`}
        </div>
      </div>
    `;
  };

  h(`
    ${stepHeader()}
    <h1>Revisar y ajustar lo que extrajo la IA</h1>
    ${viewIntro(stepIdx)}

    <div class="card" style="background:#f0fbff;border-left:6px solid var(--peaku-blue);">
      <strong>Resumen ejecutivo (IA):</strong>
      <p style="margin:6px 0 0;">${esc(ia.resumen_ejecutivo || 'Sin resumen')}</p>
    </div>

    <div class="card">
      <h2>Segmento y calificación</h2>
      <label>Segmento detectado ${tip('La IA sugirió esto según volumen, equipo y herramientas mencionadas. Ajusta si no encaja.')}</label>
      <div class="chips">
        ${['A','B','C'].map(k => `<div class="chip ${state.segment === k ? 'selected' : ''}" data-pick-segment="${k}"><strong>${k}</strong> · ${SEGMENTS[k].label}</div>`).join('')}
      </div>
      <label style="margin-top:14px;"><input type="checkbox" data-field="hasAts" ${state.hasAts?'checked':''}/> Tiene ATS</label>
      ${state.hasAts ? `<label>Nombre del ATS</label><input type="text" data-field="atsName" value="${esc(state.atsName||'')}" placeholder="SAP SF, Workday, Greenhouse..." />` : ''}
    </div>

    <div class="card">
      <h2>Construcción</h2>
      ${field('Contrato previo', 'contratoPrevio', 'Duración, agenda, permiso para "no"')}
      ${field('Vínculo / rapport', 'vinculo', 'Cómo se rompió el hielo')}
    </div>

    <div class="card">
      <h2>Embudo del dolor</h2>
      ${field('Dolor principal (textual)', 'dolor', 'Cita textual del cliente')}
      ${field('1. Cuantificar (ancla del precio)', 'dolorCuantificar', '$/tiempo mencionado')}
      ${field('2. Historia (qué intentaron)', 'dolorHistoria', 'Qué probaron antes')}
      ${field('3. Impacto (a quién le duele)', 'dolorImpacto', 'Cliente/equipo afectado')}
      ${field('Consecuencias emocionales', 'consecuenciasEmocionales', '')}
      ${field('Cómo miden hoy', 'medicion', '')}
      ${state.segment === 'C' ? field('Integraciones / API del ATS', 'integraciones', '') : ''}
    </div>

    <div class="card">
      <h2>Presupuesto y decisión</h2>
      ${field('Presupuesto', 'presupuesto', '')}
      ${field('Decisor / decisores', 'decisor', '')}
      ${field('Proceso de decisión', 'procesoDecision', '')}
      ${field('Fecha límite de decisión', 'fechaLimiteDecision', 'YYYY-MM-DD', true)}
    </div>

    <div class="card">
      <h2>Pedidos del cliente (ideal)</h2>
      <p class="muted" style="font-size:13px;">La IA extrajo estos pedidos. Puedes editarlos, agregar o quitar.</p>
      <div id="ideal-list-review">
        ${(state.idealRequests || []).map((it, i) => `
          <div class="ideal-item">
            <input type="text" data-ideal-text="${i}" value="${esc(it.text)}" placeholder="Pedido del cliente" title="${esc(it.cita || '')}" />
            <label class="toggle"><input type="checkbox" data-ideal-have="${i}" ${it.weHave?'checked':''}/> lo tenemos</label>
            <button class="btn ghost btn-sm danger" data-ideal-del="${i}" title="Eliminar">✕</button>
            ${it.cita ? `<div class="muted chico" style="grid-column:1 / -1;font-style:italic;margin:-4px 0 6px">“${esc(it.cita)}”</div>` : ''}
          </div>
        `).join('')}
      </div>
      <button class="btn secondary btn-sm" id="add-ideal-review" style="margin-top:8px;">+ Agregar pedido</button>
    </div>

    <div class="card">
      <h2>Cierre y próximos pasos</h2>
      ${field('Próximo paso concreto acordado en el demo', 'proximoPaso', '')}
      ${field('Cargo para piloto (si aplica)', 'pilotoCargo', 'Cargo que se publicaría esta semana')}
      ${field('Fecha revisión piloto', 'pilotoFechaRevision', 'YYYY-MM-DD', true)}
      ${field('Post-venta / anti-remordimiento', 'postVenta', '')}
    </div>

    <div class="card">
      <div class="split">
        <div>
          <strong>Calificación Sandler calculada:</strong>
          <span class="pill ${cal.label === 'Completa' ? 'good' : (cal.label === 'Parcial' ? 'warn' : 'bad')}" style="margin-left:8px;">${cal.label} · ${cal.done}/${cal.of}</span>
        </div>
        <span class="muted" style="font-size:12px;">${ia._usage ? `IA usó ${ia._usage.input_tokens}+${ia._usage.output_tokens} tokens` : ''}</span>
      </div>
    </div>

    <div class="btn-row">
      <button class="btn ghost" data-act="prev">← Volver al transcript</button>
      <div style="display:flex;gap:10px;">
        <button class="btn secondary" data-act="save">Guardar borrador</button>
        <button class="btn" data-act="next">Ver resultado + acciones →</button>
      </div>
    </div>
  `);
  bindForm();
  el.querySelectorAll('[data-ideal-text]').forEach(i => i.addEventListener('input', () => {
    state.idealRequests[+i.dataset.idealText].text = i.value; saveDraft();
  }));
  el.querySelectorAll('[data-ideal-have]').forEach(i => i.addEventListener('change', () => {
    state.idealRequests[+i.dataset.idealHave].weHave = i.checked; saveDraft();
  }));
  el.querySelectorAll('[data-ideal-del]').forEach(i => i.addEventListener('click', () => {
    state.idealRequests.splice(+i.dataset.idealDel, 1); saveDraft(); renderWizard();
  }));
  el.querySelector('#add-ideal-review').addEventListener('click', () => {
    state.idealRequests.push({ text: '', weHave: false }); saveDraft(); renderWizard();
  });
}

function stepQualif() {
  h(`
    ${stepHeader()}
    <h1>Calificación rápida</h1>
    ${viewIntro(stepIdx)}

    <div class="card">
      <p class="muted" style="margin:0 0 6px;">Línea: <strong>${esc(linea().label)}</strong> · Preguntas adaptadas a esta línea. En menos de 3 minutos ubicas segmento (Micro / PyME / Grande) y detectas si tiene ATS.</p>

      <label>1. ${esc(linea().qualif.volumen)} ${tip('Determina volumen del segmento (Micro / PyME / Grande).\n\nPara ' + linea().label + ', ejemplos:\n• Micro: pocas al año\n• PyME: varias al mes\n• Grande: alto volumen continuo')}</label>
      <input type="text" data-field="qualif.volumen" value="${esc(state.qualif.volumen)}" placeholder="Ej. 10 al mes; 50 al año; esporádicas..." />

      <label>2. ${esc(linea().qualif.equipo)} ${tip('Tamaño del equipo que hoy manejaría este proceso.')}</label>
      <input type="text" data-field="qualif.equipoRrhh" value="${esc(state.qualif.equipoRrhh)}" placeholder="Ej. el dueño; 2-3 personas; área estructurada..." />

      <label>3. ${esc(linea().qualif.perfiles)} ${tip('Ubica el TIPO de perfil que buscan. Cambia si es sourcing masivo o especializado.')}</label>
      <input type="text" data-field="qualif.perfiles" value="${esc(state.qualif.perfiles)}" placeholder="Ej. operativos masivos; técnicos; C-level; internacional..." />

      <label>4. ${esc(linea().qualif.herramienta)} ${tip('🔑 PREGUNTA LLAVE. Define contra qué compites y el segmento.')}</label>
      <input type="text" data-field="qualif.herramienta" value="${esc(state.qualif.herramienta)}" placeholder="Ej. Excel; LinkedIn; SAP SF; Deel; agencias externas..." />

      <label>5. ${esc(linea().qualif.decisor)} ${tip('Identifica el decisor temprano para no perder tiempo.')}</label>
      <input type="text" data-field="qualif.decisor_quien" value="${esc(state.qualif.decisor_quien)}" placeholder="Ej. jefe de RRHH; comité con compras; CFO + Legal (para EOR)..." />
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
    <h1>Segmento detectado</h1>
    ${viewIntro(stepIdx)}

    <div class="card">
      <p class="muted" style="margin:0 0 6px;">Confirma o ajusta. Esto define qué preguntas hacer, qué guion usar y qué módulos mostrar del demo.</p>

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
    <div class="split"><h1>Embudo del dolor <span class="segment-badge ${seg}">Segmento ${seg}</span></h1>${badge}</div>
    ${viewIntro(stepIdx)}

    <div class="card">
      <p class="muted" style="margin:0 0 6px;">Un dolor sin desarrollar no ancla ni demo ni precio ni urgencia. Documenta lo más textual posible lo que diga el cliente.</p>

      <div class="hint">
        <strong>Preguntas guía para este segmento:</strong>
        <ul style="margin:6px 0 0 18px; padding: 0;">
          ${preguntas.map(p => `<li>${p}</li>`).join('')}
        </ul>
      </div>

      <p class="muted" style="font-size:13px;">Línea: <strong>${esc(linea().label)}</strong> · Eje del dolor: <em>${esc(linea().dolorEje)}</em></p>

      <label>Dolor principal identificado ${tip('El problema concreto y TEXTUAL que confesó el cliente. NO lo parafrasees — cópialo tal cual.\n\nPara ' + linea().label + ', ejemplo:\n' + linea().dolorPh)}<span class="opt">(cópialo textual)</span></label>
      <textarea data-field="dolor" placeholder="${esc(linea().dolorPh)}">${esc(state.dolor)}</textarea>

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
    <h1>Presupuesto y decisión</h1>
    ${viewIntro(stepIdx)}

    <div class="card">

      ${anclaBase ? `<div class="hint"><strong>Ancla del dolor cuantificado:</strong> "${esc(anclaBase)}"<br/>Úsalo aquí para presentar precio: <em>"si esto les cuesta X al mes, la modalidad de Peaku que resuelve esto arranca en Y."</em></div>` : `<div class="hint" style="background:#fef3e2;border-left-color:var(--warn);"><strong>⚠ No tienes ancla cuantificada.</strong> Sin número de dolor, cualquier precio se evalúa como gasto puro. Vuelve al embudo del dolor.</div>`}

      <label>Presupuesto ${tip('No preguntes cuánto gastan hoy: suena a que el precio depende de esa respuesta.\n\nPon tú el rango: "Nuestros planes van de X a Y según el volumen de vacantes, ¿eso está dentro de lo que manejan o está lejos?" y el momento: "¿Hay de dónde tomarlo este año o sería para el próximo?"\n\nCuenta como presupuesto si ya pagan por resolver esto (herramienta, agencia o alguien dedicado; se infiere de lo que cuentan) y el rango no les pareció lejos, con plata de este ciclo.')}</label>
      <textarea data-field="presupuesto" placeholder="Ej. Pagan Computrabajo y una agencia; el rango de planes no les pareció lejos; sale del presupuesto de talento humano de este año.">${esc(state.presupuesto)}</textarea>

      <label>Decisor / decisores ${tip('Quién APRUEBA la compra, no quién usa la herramienta. Nombres y roles. ¿Hay comité? ¿Pasa por compras?\n\n"Lo reviso con mi jefe" no alcanza: pregunta "¿Quién más participa en la decisión y cómo la toman?"\n\nEj.: "María (TA, usa la herramienta), Carlos (gte RRHH, aprueba), Lucía (compras)."')}</label>
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
    <h1>Lo que el cliente pidió en su ideal</h1>
    ${viewIntro(stepIdx)}

    <div class="card">
      <p class="muted">Lista cada cosa que el cliente mencionó como "me encantaría", "necesitaría", "ojalá tuviera". Una línea por pedido. Marca si lo tenemos hoy. Esto alimenta el wishlist agregado por segmento para roadmap.</p>

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
    <h1>Cierre + Piloto</h1>
    ${viewIntro(stepIdx)}

    <div class="card">

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
  // "integraciones" solo aplica a clientes grandes (C) o con ATS; si no, no cuenta como faltante.
  const integracionesRelevante = d.segment === 'C' || !!d.hasAts;
  const nth = {
    vinculo: has(d.vinculo),
    consecuenciasEmocionales: has(d.consecuenciasEmocionales),
    medicion: has(d.medicion),
    ...(integracionesRelevante ? { integraciones: has(d.integraciones) } : {}),
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

// ---------- Reporte IA reutilizable (resultado + historial) ----------
const JOLT_LABEL = {
  J: 'Juzgar indecisión', O: 'Recomendar ruta', L: 'Limitar opciones', T: 'Quitar el riesgo',
};
const OBJ_LABEL = {
  valoracion: 'No ve el valor / ROI vs. statu quo',
  falta_informacion: 'Falta de información para decidir',
  miedo_resultado: 'Miedo a que no funcione',
  miedo_interno_statuquo: 'Miedo a llevar la propuesta al tomador de decisión',
  ninguna_clara: 'Sin señales claras de indecisión',
};
function iaReportHtml(ia) {
  if (!ia || (!ia.resumen_ejecutivo && !(ia.acciones_concretas||[]).length && !ia.objecion_subyacente && !(ia.que_mostrar||[]).length && !(ia.momentos_criticos||[]).length && !(ia.preguntas_faltantes||[]).length)) {
    return '';
  }
  const obj = ia.objecion_subyacente || null;
  const objTipo = obj && obj.tipo ? obj.tipo : '';
  const objColor = objTipo === 'ninguna_clara' ? 'var(--peaku-green)' : 'var(--bad)';
  return `
    ${ia.resumen_ejecutivo ? `
      <div class="card" style="border-left:6px solid var(--peaku-blue-dark);">
        <h2 style="margin-top:0;">🧠 Resumen ejecutivo (IA)</h2>
        <p style="margin:6px 0 0;">${esc(ia.resumen_ejecutivo)}</p>
      </div>` : ''}

    ${obj && objTipo ? `
      <div class="card" style="border-left:6px solid ${objColor};background:${objTipo==='ninguna_clara'?'#e8f6f0':'#fdecec'};">
        <h2 style="margin-top:0;">🔎 Objeción / indecisión subyacente</h2>
        <div style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${objColor};margin-bottom:6px;">${esc(OBJ_LABEL[objTipo] || objTipo)}</div>
        ${obj.descripcion ? `<p style="margin:0 0 8px;">${esc(obj.descripcion)}</p>` : ''}
        ${obj.evidencia ? `<div style="font-style:italic;color:var(--peaku-gray);font-size:13px;border-left:3px solid ${objColor};padding-left:10px;">"${esc(obj.evidencia)}"</div>` : ''}
      </div>` : ''}

    ${(ia.acciones_concretas && ia.acciones_concretas.length) ? `
      <div class="card" style="border-left:6px solid var(--peaku-blue);">
        <h2 style="margin-top:0;">🎯 Acciones concretas (priorizadas por JOLT)</h2>
        <p class="muted" style="font-size:13px;">Cada acción ataca una palanca JOLT para desbloquear la indecisión. Aterrízalas hoy en tu CRM (Brevo).</p>
        <ol style="padding-left:22px;line-height:1.8;">
          ${ia.acciones_concretas.map(a => {
            const pri = (a.prioridad || '').toLowerCase();
            const priColor = pri === 'alta' ? 'var(--bad)' : pri === 'media' ? 'var(--warn)' : 'var(--peaku-green)';
            const jolt = (a.jolt || '').toUpperCase();
            const joltLbl = JOLT_LABEL[jolt];
            return `<li style="margin-bottom:10px;">
              <span class="pill" style="color:#fff;background:${priColor};border-color:${priColor};margin-right:6px;">${esc(a.prioridad || 'media')}</span>
              ${joltLbl ? `<span class="pill" style="background:#e6f8ff;border-color:var(--peaku-blue);color:var(--peaku-blue-dark);margin-right:6px;">${jolt} · ${esc(joltLbl)}</span>` : ''}
              <strong>${esc(a.accion || '')}</strong>
              ${a.cuando ? `<span class="muted" style="margin-left:6px;font-size:12px;">· ${esc(a.cuando)}</span>` : ''}
              ${a.porque ? `<div class="muted" style="font-size:12px;margin-top:2px;">Por qué: ${esc(a.porque)}</div>` : ''}
            </li>`;
          }).join('')}
        </ol>
      </div>` : ''}

    ${(ia.que_mostrar && ia.que_mostrar.length) ? `
      <div class="card" style="border-left:6px solid var(--peaku-green);">
        <h2 style="margin-top:0;">🖥️ Qué mostrar en la demo/propuesta (según lo que pidió)</h2>
        <p class="muted" style="font-size:13px;">Basado en el interés real del cliente en el transcript, no en reglas de segmento.</p>
        <ul class="list-clean">
          ${ia.que_mostrar.map(m => {
            const show = m.mostrar !== false;
            return `<li>
              <span>${show ? '✓' : '✕'} ${esc(m.item || '')}${m.por_que ? `<div class="muted" style="font-size:12px;margin-top:2px;">${esc(m.por_que)}</div>` : ''}</span>
              <span class="pill ${show ? 'good' : 'bad'}">${show ? 'Mostrar' : 'NO mostrar'}</span>
            </li>`;
          }).join('')}
        </ul>
      </div>` : ''}

    ${(ia.momentos_criticos && ia.momentos_criticos.length) ? `
      <div class="card" style="border-left:6px solid var(--warn);">
        <h2 style="margin-top:0;">⚠ Momentos críticos del demo</h2>
        <p class="muted" style="font-size:13px;">Dónde se dejó ir un dolor, se dio precio antes de tiempo, o el cliente dictó los pasos. Aprendizaje para el próximo demo.</p>
        ${ia.momentos_criticos.map(m => `
          <div style="border-left:3px solid var(--warn);padding:10px 14px;background:#fef3e2;margin:10px 0;border-radius:4px;">
            <div style="font-style:italic;color:var(--peaku-gray);margin-bottom:6px;">"${esc(m.cita || '')}"</div>
            <div style="font-size:13px;"><strong>Qué pasó:</strong> ${esc(m.que_paso || '')}</div>
            <div style="font-size:13px;color:var(--peaku-green-dark);"><strong>Debió:</strong> ${esc(m.que_debio_hacer || '')}</div>
          </div>`).join('')}
      </div>` : ''}

    ${(ia.preguntas_faltantes && ia.preguntas_faltantes.length) ? `
      <div class="card">
        <h2 style="margin-top:0;">❓ Preguntas que faltó hacer (Sandler)</h2>
        <p class="muted" style="font-size:13px;">Solo lo que de verdad no se tocó y es relevante a este dolor. Cierra el hueco con un WhatsApp o llamada corta.</p>
        <ul class="list-clean">
          ${ia.preguntas_faltantes.map(p => {
            const q = typeof p === 'string' ? p : (p.pregunta || '');
            const why = typeof p === 'object' && p.por_que ? p.por_que : '';
            return `<li><span>${esc(q)}${why ? `<div class="muted" style="font-size:12px;margin-top:2px;">${esc(why)}</div>` : ''}</span><span class="pill warn">Falta preguntar</span></li>`;
          }).join('')}
        </ul>
      </div>` : ''}
  `;
}

function stepResult() {
  const ia = state.iaExtracted || {};
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
    ${viewIntro(stepIdx)}

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

    ${iaReportHtml(ia)}

    ${(ia.que_mostrar && ia.que_mostrar.length) ? '' : `
    <div class="card">
      <h2>Qué mostrar de la plataforma <span class="pill warn" style="margin-left:6px;">genérico por segmento</span></h2>
      <p class="muted" style="font-size:13px;">Referencia por segmento (la IA no generó una recomendación específica para este caso).</p>
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
    </div>`}

    <div class="card">
      <h2>2 · Qué faltó del proceso Sandler</h2>
      ${faltantesFund.length ? `
        <h3>Fundamentales pendientes</h3>
        <ul class="list-clean">
          ${faltantesFund.map(x => `<li><span>${x}</span><span class="pill bad">Falta</span></li>`).join('')}
        </ul>
      ` : `<p class="pill good">✓ Todos los fundamentales cubiertos</p>`}
      <p class="muted chico" style="margin:8px 0 0">Qué falta en cada criterio y qué hacer para cerrarlo está en el detalle del deal (veredicto por criterio). Lo de integraciones, piloto o post-venta solo aparece ahí si este cliente lo pidió.</p>
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

// Empresa que aparece en el encabezado de la transcripción de Meet ("Encuentro X - PeakU",
// "Conoce Peaku! - X : PeakU Meeting"). null si no se reconoce.
function empresaDelTranscript(t) {
  const cab = String(t || '').split('\n').slice(0, 4).join('\n');
  const m = /(?:Encuentro|Conoce Peaku!?\s*-|Reunión)\s*(.+?)\s*(?:[-:–]\s*PeakU|: PeakU Meeting)/i.exec(cab);
  return m ? m[1].trim() : null;
}
const nombreSimple = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\b(s\.?a\.?s?|ltda|s\.?a\.?|sas|esp|com|agencia de seguros)\b/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim();
function mismaEmpresa(a, b) {
  const x = nombreSimple(a), y = nombreSimple(b);
  if (!x || !y) return true;   // sin datos no se puede comparar
  const px = x.split(' ').filter(w => w.length >= 4), py = y.split(' ').filter(w => w.length >= 4);
  return x === y || x.includes(y) || y.includes(x) || px.some(w => py.includes(w));
}

let submitting = false;
async function submitDeal(btn) {
  if (submitting) return;              // guard anti doble-click
  // Guardar el demo de una empresa en el deal de otra: pasa cuando quedó "tomado" un deal del SDR en
  // la pestaña. Se compara la empresa del deal con la del encabezado de la transcripción.
  const enTranscript = empresaDelTranscript(state.transcript);
  if (state.sdrDealId && enTranscript && !mismaEmpresa(enTranscript, state.company)) {
    if (!confirm(`Ojo: la transcripción parece ser de "${enTranscript}", pero este demo se va a guardar en el deal #${state.sdrDealId} de "${state.company || ''}".\n\n¿Guardarlo igual en el deal de ${state.company || ''}?\n\n(Cancela y pulsa "No es este deal" arriba para crear un deal nuevo con la empresa correcta.)`)) return;
  }
  submitting = true;
  // Deshabilitar TODOS los botones de guardar y mostrar loader en el que se pulsó
  const saveButtons = el.querySelectorAll('[data-act="finish"]');
  saveButtons.forEach(b => { b.disabled = true; });
  const target = btn || saveButtons[saveButtons.length - 1];
  const prevText = target ? target.innerHTML : '';
  if (target) target.innerHTML = '<span class="spinner"></span> Guardando…';
  try {
    const r = await fetch(state.sdrDealId ? `/api/deals/${state.sdrDealId}/completar` : '/api/deals', {
      method: state.sdrDealId ? 'PUT' : 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify(state),
    });
    const j = await r.json();
    if (j.ok) {
      if (target) target.innerHTML = '✓ Guardado';
      clearDraft(); location.hash = '#/deals';
    } else {
      alert('Error al guardar: ' + (j.error || ''));
      if (target) target.innerHTML = prevText;
      saveButtons.forEach(b => { b.disabled = false; });
    }
  } catch (e) {
    alert('Error: ' + e.message);
    if (target) target.innerHTML = prevText;
    saveButtons.forEach(b => { b.disabled = false; });
  } finally {
    submitting = false;
  }
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
    <p class="muted">Haz clic en una fila para ver el detalle completo y el reporte de la IA.</p>

    <div class="score-grid" style="grid-template-columns:repeat(auto-fit,minmax(180px,1fr));">
      <div class="card compact score-card"><div class="muted">Total deals</div><div class="num">${r.length}</div></div>
      <div class="card compact score-card"><div class="muted">"Lead sin valor" (meta &lt;20%)</div><div class="num" style="color:${pctSinValor!==null && pctSinValor<20?'var(--peaku-green)':'var(--bad)'};">${pctSinValor === null ? '—' : pctSinValor + '%'}</div><div class="muted" style="font-size:11px;">${sinValor.length} de ${lost.length} perdidas</div></div>
      <div class="card compact score-card"><div class="muted">Abiertos</div><div class="num">${r.filter(x=>!x.outcome || x.outcome==='open').length}</div></div>
    </div>

    <div class="card" style="margin-top:16px;">
      <table>
        <thead><tr>
          <th>#</th><th>Empresa</th><th>Ejecutivo</th><th>Línea</th><th>Seg.</th>
          <th>Calificación</th><th>Fund.</th><th>Fecha</th><th></th>
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

  // Deal que agendó el SDR (Angie) desde /sdr: todavía no tiene demo. La ejecutiva lo "toma": el
  // asistente arranca con la ficha de Angie prellenada y, al terminar, actualiza ESTE deal.
  const deSdr = (row.canal_adquisicion === 'sdr_interno' || d.canalAdquisicion === 'sdr_interno') && row.outcome !== 'won' && row.outcome !== 'lost' && !(d.transcript && String(d.transcript).trim());
  const tomarHtml = deSdr ? `
    <div class="card" style="border-left:6px solid var(--peaku-blue, #00C3FF);">
      <h2>Agendado por el SDR · pendiente de demo</h2>
      <p class="muted" style="font-size:13px;">Este deal lo creó ${esc(row.freelancer_nombre || d.freelancerNombre || 'el SDR')} al agendar la reunión. Lo que ves en rojo es lo que se llena en el demo: tómalo y el asistente arranca con la ficha de Angie ya puesta. Al guardar, se actualiza este mismo deal (no se crea otro).</p>
      <button class="btn" data-tomar="${row.id}">▶ Tomar este deal y hacer el demo</button>
    </div>` : '';

  h(`
    ${tomarHtml}
    <div class="split">
      <h1>Deal #${row.id} · ${esc(d.company || row.company || '—')}</h1>
      ${seg ? `<span class="segment-badge ${seg}">Segmento ${seg}</span>` : ''}
    </div>
    <p class="muted">
      Ejecutivo: <strong>${esc(d.executive || row.executive || '—')}</strong> ·
      Guardado: <strong>${new Date(row.created_at).toLocaleString()}</strong>
    </p>
    <p class="muted" id="brevo-deal" data-deal="${row.id}" hidden></p>

    ${(() => {
      // Calificación Sandler: la que cuenta (la del formulario o los chulos del tablero).
      const c = calificacion(d), man = (d.calificacionManual && d.calificacionManual.items) || {};
      const nombres = { dolor: 'Dolor', presupuesto: 'Presupuesto', decision: 'Decisión', fecha: 'Fecha límite' };
      const label = row.calificacion_sandler || (Object.values(c.items).some(Boolean) ? c.label : null);
      const pendientes = Object.keys(c.items).filter(k => !c.items[k]);
      // Por criterio: la cita que lo sustenta y, si no cumple, qué falta y qué hacer (call to action).
      const filas = Object.keys(c.items).map(k => {
        const v = c.items[k], det = c.detalle[k] || null, manual = typeof man[k] === 'boolean';
        const origen = manual ? `marcado en el tablero por ${esc(d.calificacionManual.por || '—')}` : det ? 'veredicto de la IA sobre la transcripción' : 'inferido del formulario del demo';
        return `<div class="crit ${v ? 'si' : 'no'}">
          <div class="crit-cab"><span class="pill ${v ? 'good' : 'bad'}">${v ? '✓' : '✗'} ${nombres[k]}</span> <span class="muted chico">${origen}${manual && det && det.cumple !== v ? ` · la IA dice ${det.cumple ? 'que sí cumple' : 'que no cumple'}` : ''}</span></div>
          ${det && det.evidencia ? `<div class="crit-cita">“${esc(det.evidencia)}”</div>` : ''}
          ${det && !det.cumple && det.falta ? `<div class="crit-falta"><b>${v ? 'Según la IA falta' : 'Falta'}:</b> ${esc(det.falta)}</div>` : ''}
          ${det && !det.cumple && det.accion ? `<div class="crit-accion"><b>Para cerrarlo:</b> ${esc(det.accion)}</div>` : ''}
          ${!v && !det ? `<div class="muted chico">${esc(CRITERIOS_AYUDA[k] || '')}</div>` : ''}
        </div>`;
      }).join('');
      return `<div class="card"><div class="split"><div><strong style="font-size:13px;color:var(--peaku-gray);">Calificación Sandler:</strong> ${calCell(label)} <span class="muted chico">${c.done} de 4</span></div>
        <div class="chips" style="margin:0">${Object.entries(c.items).map(([k, v]) => `<span class="pill ${v ? 'good' : ''}">${v ? '✓' : '✗'} ${nombres[k]}</span>`).join('')}</div></div>
        ${pendientes.length && c.con_ia ? `<p class="muted" style="font-size:13px;margin:10px 0 0">Para que sea <b>Completa</b> faltan ${pendientes.map(k => nombres[k]).join(' y ')}. Abajo está qué falta en cada uno y la pregunta o el paso que lo cierra.</p>` : ''}
        ${!c.con_ia && d.transcript ? `<p class="muted" style="font-size:12px;margin:10px 0 0">Este demo se analizó antes de que la IA aplicara las reglas por criterio: los chulos vienen de los campos del formulario. <button type="button" class="btn secondary btn-sm" data-reanalizar="${row.id}">Analizar con las reglas</button> <span class="muted">(1 minuto; tus chulos del tablero se conservan)</span></p>` : ''}
        <div class="crit-lista">${filas}</div>
        ${d.calificacionManual ? `<p class="muted" style="font-size:12px;margin:8px 0 0">Chulos marcados en el <a href="#/tablero">tablero</a> por ${esc(d.calificacionManual.por || '—')}${d.calificacionManual.at ? ' · ' + new Date(d.calificacionManual.at).toLocaleString('es-CO') : ''}.</p>` : ''}</div>`;
    })()}

    <div id="cotizacion-card"></div>

    ${iaReportHtml(d.iaExtracted)}

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
      <p class="muted chico" style="margin:-4px 0 8px">Solo cuenta lo que el cliente pidió con su boca; cada pedido va con su cita. Lo que la IA se inventó, quítalo: sale también del wishlist.</p>
      ${ideal.length ? `
        <ul class="list-clean ideal-lista">
          ${ideal.map(p => `<li data-ideal="${esc(p.text)}"><span>${esc(p.text)}${p.cita ? `<div class="muted chico" style="font-style:italic">“${esc(p.cita)}”</div>` : '<div class="muted chico">sin cita del cliente (análisis anterior)</div>'}</span>
            <span style="display:flex;gap:6px;align-items:center;white-space:nowrap">${p.weHave ? '<span class="pill good">Lo tenemos</span>' : '<span class="pill warn">Construir</span>'}<button class="btn ghost btn-sm" data-ideal-quitar="${esc(p.text)}" title="No lo pidió: quitar del deal y del wishlist">✕</button></span></li>`).join('')}
        </ul>
      ` : `<p class="muted">No se registraron pedidos del cliente.</p>`}    </div>

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
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${d.transcript && String(d.transcript).trim() ? `<button class="btn secondary" data-mover-demo="${row.id}" title="Si esta transcripción es de otra empresa (quedó otro deal abierto en la pestaña): el demo se pasa a un deal nuevo y este vuelve a ser la ficha del SDR">Este demo es de otra empresa…</button>` : ''}
        <button class="btn green danger-solid" data-del-detail="${row.id}">🗑 Eliminar este deal</button>
      </div>
    </div>
  `);
  el.querySelector('[data-del-detail]').addEventListener('click', async () => {
    await deleteDeal(row.id, () => { location.hash = '#/deals'; });
  });
  el.querySelectorAll('[data-ideal-quitar]').forEach($b => $b.addEventListener('click', async () => {
    const text = $b.dataset.idealQuitar;
    if (!confirm(`¿Quitar "${text}"? Sale del deal y del wishlist.`)) return;
    $b.disabled = true;
    try {
      const r = await fetch(`/api/deals/${row.id}/ideal/quitar`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
      const $li = $b.closest('li'); if ($li) $li.remove();
    } catch (e) { alert('No se pudo quitar: ' + e.message); $b.disabled = false; }
  }));
  const $re = el.querySelector('[data-reanalizar]');
  if ($re) $re.addEventListener('click', async () => {
    $re.disabled = true; $re.textContent = 'Analizando…';
    try {
      const r = await fetch(`/api/deals/${row.id}/reanalizar`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
      renderDealDetail(row.id);
    } catch (e) { alert('No se pudo analizar: ' + e.message); $re.disabled = false; $re.textContent = 'Analizar con las reglas'; }
  });
  pintarBrevoDeal(row.id);
  const $mover = el.querySelector('[data-mover-demo]');
  if ($mover) $mover.addEventListener('click', async () => {
    const sugerida = empresaDelTranscript(d.transcript) || '';
    const empresa = prompt(`¿De qué empresa es este demo? Se crea un deal nuevo con esa empresa y el deal #${row.id} (${d.company || row.company || ''}) queda como lo dejó el SDR, sin demo.\n\nDeja vacío para solo quitar el demo de aquí.`, sugerida);
    if (empresa === null) return;
    const destino = empresa.trim() ? 'nuevo' : 'descartar';
    if (destino === 'descartar' && !confirm(`Se quita el demo del deal #${row.id} y no se guarda en ningún otro. ¿Seguir?`)) return;
    $mover.disabled = true; $mover.textContent = 'Moviendo…';
    try {
      const r = await fetch(`/api/deals/${row.id}/demo/mover`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ destino, company: empresa.trim() }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.ok) throw new Error(j.error || r.statusText);
      location.hash = j.destino ? `#/deal/${j.destino}` : `#/deal/${row.id}`;
      if (!j.destino) renderDealDetail(row.id);
    } catch (e) { alert('No se pudo mover: ' + e.message); $mover.disabled = false; $mover.textContent = 'Este demo es de otra empresa…'; }
  });
  pintarCotizacion(row.id);
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
    const $pr = el.querySelector('[data-productos]'); if ($pr) $pr.style.display = mode === 'won' ? '' : 'none';
  }
  const tomarBtn = el.querySelector('[data-tomar]');
  if (tomarBtn) tomarBtn.addEventListener('click', () => {
    const borrador = loadDraft();
    const hayOtro = borrador && (borrador.company || borrador.transcript) && Number(borrador.sdrDealId) !== row.id;
    if (hayOtro && !confirm(`Tienes un borrador en curso (${borrador.company || 'sin empresa'}). ¿Lo reemplazo con este deal del SDR?`)) return;
    const base = newDraft();
    state = { ...base, ...(d || {}), sdrDealId: row.id };
    if (!state.company) state.company = row.company || '';
    if (!state.canalAdquisicion) state.canalAdquisicion = 'sdr_interno';
    if (!state.freelancerNombre) state.freelancerNombre = row.freelancer_nombre || 'Angie (SDR)';
    state.transcript = state.transcript || ''; state.iaExtracted = null; state.iaError = null;
    stepIdx = 0; saveDraft(); location.hash = '#/';
  });
  if (saveBtn) saveBtn.addEventListener('click', async () => {
    const mode = el.querySelector('#outcome-panel').getAttribute('data-mode');
    const motivo = [reasonSel.value, reasonTxt.value.trim()].filter(Boolean).join(' — ');
    if (!mode || !motivo) { alert('Elige motivo y comentario.'); return; }
    const productos = [...el.querySelectorAll('[data-productos] input:checked')].map(i => i.value);
    if (mode === 'won' && !productos.length) { alert('Marca qué se vendió: ' + PRODUCTOS_PEAKU.join(', ') + '.'); return; }
    const r = await fetch(`/api/deals/${row.id}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ outcome: mode, outcome_reason: motivo, productos })
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
            ${row.outcome === 'won' ? `<p class="muted" style="margin-top:4px;">Se vendió: ${row.productos ? String(row.productos).split(',').map(x => `<span class="pill good">${esc(x.trim())}</span>`).join(' ') : '<span class="pill warn">sin marcar</span>'}</p>` : ''}
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
      <div data-productos style="display:none;margin:10px 0 4px;"><div class="muted" style="font-size:12px;font-weight:600;margin-bottom:6px;">¿Qué se vendió? (una o varias)</div>
        <div class="chips" style="margin:0">${PRODUCTOS_PEAKU.map(pr => `<label class="chip" style="padding:8px 12px;display:inline-flex;gap:6px;align-items:center;"><input type="checkbox" value="${pr}" style="margin:0;"> ${pr}</label>`).join('')}</div></div>
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
async function renderWishlist(params = new URLSearchParams((location.hash.split('?')[1] || ''))) {
  const modo = params.get('ver') === 'lista' ? 'lista' : 'temas';
  h(`<h1>Wishlist</h1><p class="muted">${modo === 'temas' ? 'Agrupando los pedidos por necesidad…' : 'Cargando...'}</p>`);
  const tabs = `<div class="tb-filtros" style="margin:6px 0 14px"><a class="${modo === 'temas' ? 'active' : ''}" href="#/wishlist">Por necesidad</a><a class="${modo === 'lista' ? 'active' : ''}" href="#/wishlist?ver=lista">Lista completa</a></div>`;
  if (modo === 'lista') return renderWishlistLista(tabs);
  let r;
  try { r = await fetch('/api/wishlist/temas' + (params.get('refrescar') ? '?refrescar=1' : '')).then(async x => { const j = await x.json(); if (!x.ok) throw new Error(j.error || x.status); return j; }); }
  catch (e) { h(`<h1>Wishlist</h1>${tabs}<div class="card" style="border-left:4px solid var(--bad)">No se pudo agrupar: ${esc(e.message)}. <a href="#/wishlist?ver=lista">Ver la lista completa</a>.</div>`); return; }
  if (!r.total) { h(`<h1>Wishlist</h1>${tabs}<p class="muted">Aún no hay pedidos registrados. Se llenan en el demo, en "Lo que pidió el cliente en su ideal".</p>`); return; }
  const segs = ['A', 'B', 'C'];
  const totalSeg = Object.fromEntries(segs.map(sg => [sg, r.temas.reduce((n, t) => n + t.por_segmento[sg], 0)]));
  const tenemosPill = t => t.lo_tenemos === 'si' ? '<span class="pill good">Sí</span>' : t.lo_tenemos === 'parcial' ? `<span class="pill warn">Parcial ${t.tenemos}/${t.total}</span>` : '<span class="pill bad">No</span>';
  const max = Math.max(1, ...r.temas.map(t => t.total));
  const topSeg = sg => r.temas.filter(t => t.por_segmento[sg]).sort((a, b) => b.por_segmento[sg] - a.por_segmento[sg] || b.total - a.total).slice(0, 3);
  const noTenemos = r.temas.filter(t => t.lo_tenemos !== 'si').sort((a, b) => (b.total - b.tenemos) - (a.total - a.tenemos)).slice(0, 4);
  h(`
    <div class="split"><div><h1>Wishlist</h1><p class="muted" style="margin:0">${r.total} pedidos de clientes en demos, agrupados en ${r.temas.length} necesidades${r.generado_at ? ` · clasificado ${new Date(r.generado_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : ''}${r.desactualizado ? ' · <span class="pill warn">hay pedidos nuevos sin clasificar</span>' : ''}</p></div>
      <a class="btn ghost btn-sm" href="#/wishlist?refrescar=1" title="Vuelve a agrupar con la IA (se hace solo cuando hay pedidos nuevos)">↻ Volver a clasificar</a></div>
    ${tabs}
    <div class="tb-kpis" style="grid-template-columns:repeat(3,minmax(0,1fr))">${segs.map(sg => `
      <div class="card compact"><div class="muted"><span class="segment-badge ${sg}">${sg}</span> ${esc(SEGMENTS[sg].label)} · ${totalSeg[sg]} pedidos</div>
        ${topSeg(sg).length ? `<ol class="wl-top">${topSeg(sg).map(t => `<li><b>${esc(t.nombre)}</b> <span class="muted">${t.por_segmento[sg]} · ${Math.round(t.por_segmento[sg] / Math.max(totalSeg[sg], 1) * 100)}%</span></li>`).join('')}</ol>` : '<p class="muted chico" style="margin:8px 0 0">Sin pedidos.</p>'}</div>`).join('')}
    </div>
    ${noTenemos.length ? `<div class="card compact wl-gap"><div class="muted">Lo que más piden y <b>no tenemos</b> (o solo a medias)</div>
      <div class="chips" style="margin-top:8px">${noTenemos.map(t => `<span class="chip" style="cursor:default">${esc(t.nombre)} <b>${t.total - t.tenemos}</b></span>`).join('')}</div></div>` : ''}
    <div class="card">
      <table class="wl-tabla">
        <thead><tr><th>Necesidad</th><th>Línea</th>${segs.map(sg => `<th class="num">${sg}</th>`).join('')}<th class="num">Total</th><th>¿Lo tenemos?</th></tr></thead>
        <tbody>${r.temas.map((t, i) => `
          <tr class="clickable wl-fila" data-i="${i}">
            <td><b>${esc(t.nombre)}</b><div class="muted chico">${esc(t.descripcion)}</div><div class="wl-barra"><i style="width:${Math.round(t.total / max * 100)}%"></i></div></td>
            <td><span class="pill">${esc(t.producto)}</span></td>
            ${segs.map(sg => `<td class="num ${t.por_segmento[sg] ? '' : 'muted'}">${t.por_segmento[sg] || '·'}</td>`).join('')}
            <td class="num"><b>${t.total}</b><div class="muted chico">${t.empresas} empresa${t.empresas === 1 ? '' : 's'}</div></td>
            <td>${tenemosPill(t)}</td>
          </tr>
          <tr class="wl-detalle" data-d="${i}" hidden><td colspan="7"><ul class="list-clean wl-pedidos">${t.pedidos.map(p => `<li><span class="segment-badge ${p.segment || ''}">${p.segment || '?'}</span> ${esc(p.item)} <span class="muted chico">${p.company ? '· ' + esc(p.company) : ''}${p.deal_id ? ` · <a href="#/deal/${p.deal_id}">deal</a>` : ''} · ${p.we_have ? 'lo tenemos' : 'no lo tenemos'}</span></li>`).join('')}</ul></td></tr>`).join('')}
        </tbody>
      </table>
      ${r.sin_tema.length ? `<details style="margin-top:12px"><summary class="muted chico" style="cursor:pointer">${r.sin_tema.length} pedidos sueltos que no encajaron en ningún tema</summary><ul class="list-clean wl-pedidos">${r.sin_tema.map(p => `<li><span class="segment-badge ${p.segment || ''}">${p.segment || '?'}</span> ${esc(p.item)} <span class="muted chico">${p.company ? '· ' + esc(p.company) : ''}</span></li>`).join('')}</ul></details>` : ''}
    </div>
    <p class="muted chico">Haz clic en una necesidad para ver los pedidos textuales y de qué empresa son. "¿Lo tenemos?" sale de lo que marcó la ejecutiva en cada pedido (mayoría = sí). La agrupación la hace la IA leyendo el contexto de cada pedido; se rehace sola cuando entran pedidos nuevos.</p>`);
  el.querySelectorAll('.wl-fila').forEach(tr => tr.addEventListener('click', () => { const d = el.querySelector(`.wl-detalle[data-d="${tr.dataset.i}"]`); d.hidden = !d.hidden; }));
}

// ---------- Brevo (el CRM de Luisa) ----------
// Datos y reglas: /sdr/api/brevo/chequeo (sdr/brevo.js, reglas en BREVO de sdr/config.js; la llave
// BREVO_API_KEY vive en Render). Solo lectura: aquí no se toca Brevo ni el Sandler, se ve qué no cuadra.
const BREVO_ETAPA = { sin_calificar: 'Sin calificar', calificado: 'Calificado', propuesta: 'Prueba gratis o cotización', interesado: 'Interesado', ganado: 'Ganado', perdido: 'Perdido' };
function brevoLinea(b) {
  if (!b) return '';
  const monto = b.monto != null && !Number.isNaN(b.monto) ? ` · ${b.monto.toLocaleString('es-CO')}` : '';
  const cierre = b.cierre ? ` · cierre ${new Date(b.cierre).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}` : '';
  return `<a href="${esc(b.url)}" target="_blank" rel="noopener"><b>${esc(b.nombre || 'deal')}</b> ↗</a> · etapa <b>${esc(b.etapa || '—')}</b>${monto}${cierre}${b.por ? ` <span class="chico">(emparejado por ${b.por})</span>` : ''}`;
}
async function pintarBrevoDeal(dealId) {
  const $p = document.getElementById('brevo-deal');
  if (!$p) return;
  try {
    const r = await fetch(`/sdr/api/brevo/deal?deal_id=${encodeURIComponent(dealId)}`).then(x => x.json());
    if (!r.activo) return;
    $p.hidden = false;
    $p.innerHTML = r.deal ? `En Brevo: ${brevoLinea(r.deal)}` : `En Brevo: <span class="pill warn">no está</span> <span class="chico">no hay un deal con este correo ni esta empresa · <a href="#/brevo">ver el cruce</a></span>`;
  } catch (_) { /* Brevo caído o sin llave: la ficha sigue igual */ }
}
async function renderBrevo(params = new URLSearchParams((location.hash.split('?')[1] || ''))) {
  h(`<h1>Brevo</h1><p class="muted">Leyendo los deals de Brevo y del Sandler…</p>`);
  let c;
  try {
    const est = await fetch('/sdr/api/brevo/estado').then(x => x.json());
    if (!est.activo) { h(`<h1>Brevo</h1><div class="card"><p>Falta la llave de Brevo. En Render → Environment agrega <code>BREVO_API_KEY</code> (Brevo → SMTP &amp; API → API keys, una llave de solo lectura basta) y vuelve a desplegar.</p><p class="muted chico">Con la llave, esta pestaña cruza los deals del Sandler con los del CRM de Brevo: cuáles faltan en cada lado y qué etapas no cuadran. La ficha del lead y el detalle del deal muestran el deal de Brevo.</p></div>`); return; }
    c = await fetch('/sdr/api/brevo/chequeo' + (params.get('forzar') ? '?forzar=1' : '')).then(async x => { const j = await x.json(); if (!x.ok) throw new Error(j.error || x.status); return j; });
  } catch (e) { h(`<h1>Brevo</h1><div class="card" style="border-left:4px solid var(--bad)">No se pudo leer Brevo: ${esc(e.message)}</div>`); return; }
  const r = c.resumen;
  const sandlerCol = d => `<a href="#/deal/${d.id}"><b>${esc(d.empresa || '#' + d.id)}</b></a><div class="muted chico">${esc(BREVO_ETAPA[d.etapa] || d.etapa)}${d.calificacion ? ' · ' + esc(d.calificacion) : ''}${d.email ? ' · ' + esc(d.email) : ''}${d.lead_id ? ` · <a href="/sdr/#/lead/${d.lead_id}">lead de Angie</a>` : ''}</div>`;
  const brevoCol = b => `<a href="${esc(b.url)}" target="_blank" rel="noopener"><b>${esc(b.nombre || 'deal')}</b> ↗</a><div class="muted chico">${esc(b.etapa || '—')}${b.etapa_equivalente ? ` (= ${esc(BREVO_ETAPA[b.etapa_equivalente])})` : ''}${b.empresas.length ? ' · ' + b.empresas.map(e => esc(e.nombre)).join(', ') : ''}${b.contactos.length ? ' · ' + b.contactos.map(x => esc(x.email)).join(', ') : ''}${b.monto != null ? ' · ' + b.monto.toLocaleString('es-CO') : ''}${b.cierre ? ' · cierre ' + esc(b.cierre) : ''}</div>`;
  const conDif = c.pares.filter(p => p.diferencias.length), sinDif = c.pares.filter(p => !p.diferencias.length);
  const tabla = (filas, cab) => `<table class="wl-tabla"><thead><tr>${cab.map(x => `<th>${x}</th>`).join('')}</tr></thead><tbody>${filas.join('')}</tbody></table>`;
  h(`
    <div class="split"><div><h1>Brevo</h1><p class="muted" style="margin:0">${r.brevo} deals en Brevo · ${r.sandler} en el Sandler · leído ${new Date(c.leido_at).toLocaleTimeString('es-CO', { hour: 'numeric', minute: '2-digit' })}</p></div>
      <a class="btn ghost btn-sm" href="#/brevo?forzar=1" title="Vuelve a leer Brevo ahora (si no, se guarda unos minutos)">↻ Actualizar</a></div>
    <div class="tb-kpis">
      <div class="card compact"><div class="muted">Emparejados</div><div class="num">${r.pares}</div><div class="muted chico">por correo o por empresa</div></div>
      <div class="card compact ${r.con_diferencias ? 'alerta' : ''}"><div class="muted">Con diferencias</div><div class="num">${r.con_diferencias}</div><div class="muted chico">etapa que no cuadra o cerrado en un solo lado</div></div>
      <div class="card compact ${r.solo_sandler ? 'alerta' : ''}"><div class="muted">Solo en el Sandler</div><div class="num">${r.solo_sandler}</div><div class="muted chico">abiertos aquí, sin deal en Brevo</div></div>
      <div class="card compact ${r.solo_brevo ? 'alerta' : ''}"><div class="muted">Solo en Brevo</div><div class="num">${r.solo_brevo}</div><div class="muted chico">abiertos allá, sin deal aquí</div></div>
    </div>
    ${c.etapas_sin_regla.length ? `<div class="tb-aviso">Etapas de Brevo sin regla (se muestran, no se comparan): <b>${c.etapas_sin_regla.map(esc).join(', ')}</b>. Se mapean en <code>BREVO.etapas</code> de <code>sdr/config.js</code>. Pipelines: ${c.pipelines.map(p => `<b>${esc(p.nombre)}</b> (${p.etapas.map(esc).join(' → ')})`).join(' · ')}</div>` : ''}
    ${conDif.length ? `<div class="card"><h2>No cuadran <span class="muted chico" style="font-weight:400">${conDif.length}</span></h2>${tabla(conDif.map(p => `<tr><td>${sandlerCol(p.sandler)}</td><td>${brevoCol(p.brevo)}</td><td>${p.diferencias.map(esc).join('<br>')}</td></tr>`), ['Sandler', 'Brevo', 'Diferencia'])}</div>` : ''}
    ${c.solo_sandler.length ? `<div class="card"><h2>Solo en el Sandler <span class="muted chico" style="font-weight:400">${c.solo_sandler.length} abiertos · falta crearlos en Brevo o cerrarlos aquí</span></h2>${tabla(c.solo_sandler.map(d => `<tr><td>${sandlerCol(d)}</td><td class="muted chico">${d.creado ? 'creado ' + new Date(d.creado).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' }) : ''}</td></tr>`), ['Deal', ''])}</div>` : ''}
    ${c.solo_brevo.length ? `<div class="card"><div class="split"><h2 style="margin:0">Solo en Brevo <span class="muted chico" style="font-weight:400">${c.solo_brevo.length} abiertos · no tienen demo en el Sandler</span></h2><button class="btn ghost btn-sm" data-brevo-importar-todos title="Crea en el Sandler un deal por cada uno, en la etapa equivalente, sin transcripción (demos de antes de la plataforma)">Crear los ${c.solo_brevo.length} en el Sandler</button></div>${tabla(c.solo_brevo.map(b => `<tr><td>${brevoCol(b)}</td><td style="white-space:nowrap"><button class="btn ghost btn-sm" data-brevo-importar="${esc(b.id)}" title="Crea el deal en el Sandler en la etapa equivalente, con empresa, contacto y correo de Brevo; queda enlazado por id">Crear en el Sandler</button></td></tr>`), ['Deal', ''])}</div>` : ''}
    <details class="card" style="margin-top:12px"><summary class="muted" style="cursor:pointer">Cuadran (${sinDif.length})</summary>${sinDif.length ? tabla(sinDif.map(p => `<tr><td>${sandlerCol(p.sandler)}</td><td>${brevoCol(p.brevo)}</td><td class="muted chico">por ${p.por}</td></tr>`), ['Sandler', 'Brevo', '']) : '<p class="muted chico">Ninguno todavía.</p>'}</details>
    <p class="muted chico">Se emparejan por el id de Brevo (los importados), por el correo del lead de Angie (el contacto del deal en Brevo) y si no, por la empresa (nombre sin S.A.S., tildes ni mayúsculas, o el dominio del correo). Los cerrados en los dos lados no se listan. Nada de esto escribe en Brevo; "Crear en el Sandler" sí crea el deal aquí.</p>`);
  const importar = async ids => {
    const usuario = (() => { try { return localStorage.getItem('sdr_usuario') || ''; } catch (_) { return ''; } })();
    let ok = 0; const errores = [];
    for (const id of ids) {
      try {
        const r = await fetch('/sdr/api/brevo/importar', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ brevo_id: id, usuario }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || r.status);
        ok++;
      } catch (e) { errores.push(`${id}: ${e.message}`); }
    }
    alert(`${ok} ${ok === 1 ? 'deal creado' : 'deals creados'} en el Sandler.${errores.length ? '\nNo se pudo: ' + errores.join('\n') : ''}`);
    location.hash = '#/brevo?forzar=1&t=' + Date.now();
  };
  el.querySelectorAll('[data-brevo-importar]').forEach(b => b.addEventListener('click', () => { b.disabled = true; b.textContent = 'Creando…'; importar([b.dataset.brevoImportar]); }));
  const $todos = el.querySelector('[data-brevo-importar-todos]');
  if ($todos) $todos.addEventListener('click', () => { if (window.confirm(`¿Crear ${c.solo_brevo.length} deals en el Sandler? Quedan en la etapa equivalente, sin transcripción, enlazados a Brevo.`)) { $todos.disabled = true; importar(c.solo_brevo.map(b => b.id)); } });
}

async function renderWishlistLista(tabs) {
  const r = await fetch('/api/wishlist').then(r=>r.json()).catch(() => []);
  if (!r.length) { h(`<h1>Wishlist</h1>${tabs}<p class="muted">Aún no hay pedidos registrados. Llena algunos deals con la sección "Lo que pidió el cliente en su ideal".</p>`); return; }
  const bySeg = { A: [], B: [], C: [], '': [] };
  for (const w of r) (bySeg[w.segment || ''] || bySeg['']).push(w);
  h(`
    <h1>Wishlist <span class="muted" style="font-size:13px;">— cada pedido tal cual se anotó</span></h1>
    ${tabs}
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

// ---------- Tablero de la ejecutiva: reuniones que trae la SDR ----------
// Indicadores del mes y la calificación Sandler de cada reunión en 4 chulos que se llenan a mano.
// Los datos salen del módulo SDR (/sdr/api/ejecutiva) y cada chulo se guarda en el deal (misma regla
// que el formulario del demo: sdr/calificacion.js).
const TB_ESTADO = {
  calificada: ['Calificada', 'good'], por_calificar: ['Por calificar', 'warn'], programada: ['Programada', ''],
  no_califica: ['No calificó', 'bad'], no_asistio: ['No asistió', 'bad'], cancelada: ['Cancelada', 'bad'],
};
const TB_COMERCIAL = { cotizada: ['Cotizada', ''], ganada: ['Ganada', 'good'], perdida: ['Perdida', 'bad'] };
const TB_FILTROS = [
  ['todas', 'Todas', () => true],
  ['pendientes', 'Por calificar', x => x.estado === 'por_calificar'],
  ['programadas', 'Programadas', x => x.estado === 'programada'],
  ['evaluadas', 'Calificadas', x => !!x.calificacion],
  ['no', 'No se hicieron', x => x.estado === 'no_asistio' || x.estado === 'cancelada'],
];
const tbFechaHora = ms => ms == null ? '—' : new Date(ms).toLocaleString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const tbFecha = ms => ms == null ? '—' : new Date(ms).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short' });
const tbMes = (mes, largo) => new Date(mes + '-15T12:00:00-05:00').toLocaleDateString('es-CO', largo ? { month: 'long', year: 'numeric' } : { month: 'long' });
const tbPlural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;
const tbEtiqueta = n => n >= 4 ? 'Completa' : n >= 2 ? 'Parcial' : 'No califica';
const tbEditadas = new Set();   // calificadas en esta visita: siguen a la vista aunque cambien de filtro
let tbToast = null;
function tbAvisar(texto, tipo = 'ok') {
  if (tbToast) tbToast.remove();
  const t = tbToast = document.createElement('div');
  t.className = 'tb-toast ' + tipo; t.textContent = texto; document.body.appendChild(t);
  setTimeout(() => t.remove(), tipo === 'ok' ? 4000 : 8000);
}
async function tbApi(ruta, opciones = {}) {
  const r = await fetch('/sdr/api/' + ruta, {
    method: opciones.method || 'GET',
    headers: opciones.body ? { 'content-type': 'application/json' } : undefined,
    body: opciones.body ? JSON.stringify(opciones.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j;
}

// Indicadores de cierre del mes (fecha de Bogotá) sobre todos los deals del Sandler.
function tbCierre(deals, mes) {
  const mesDe = v => v ? new Date(v).toLocaleDateString('en-CA', { timeZone: 'America/Bogota' }).slice(0, 7) : null;
  const esSdr = d => d.canal_adquisicion === 'sdr_interno';
  const abiertos = deals.filter(d => !d.outcome || d.outcome === 'open');
  const cerradosMes = deals.filter(d => (d.outcome === 'won' || d.outcome === 'lost') && mesDe(d.closed_at) === mes);
  const ganados = cerradosMes.filter(d => d.outcome === 'won').length;
  const perdidas = cerradosMes.filter(d => d.outcome === 'lost');
  const sinValor = perdidas.filter(d => /lead sin valor|no calific/i.test(d.outcome_reason || '')).length;
  const nuevos = deals.filter(d => mesDe(d.created_at) === mes);
  const hoy = Date.now();
  return {
    abiertos: abiertos.length, abiertosCotizados: abiertos.filter(d => d.quoted_at).length, abiertosSdr: abiertos.filter(esSdr).length,
    nuevos: nuevos.length, nuevosSdr: nuevos.filter(esSdr).length,
    cotizados: deals.filter(d => mesDe(d.quoted_at) === mes).length,
    ganados, perdidos: perdidas.length,
    tasa: cerradosMes.length ? Math.round((ganados / cerradosMes.length) * 100) : null,
    sinValorPct: perdidas.length ? Math.round((sinValor / perdidas.length) * 100) : null,
    estancados: abiertos.map(d => ({ ...d, dias: Math.floor((hoy - new Date(d.created_at).getTime()) / 86400000) })).filter(d => d.dias > 30).sort((a, b) => b.dias - a.dias),
  };
}

// Invitados a la reunión y si aceptaron (Google Calendar, vía la sincronización de Calendly del SDR),
// más lo que respondieron en el formulario de Calendly. Solo para reuniones que aún no pasan.
const TB_RSVP = { acepto: ['aceptó', 'ok'], rechazo: ['rechazó', 'bad'], tal_vez: ['tal vez', 'warn'], sin_responder: ['sin responder', ''] };
function tbInvitados(x) {
  const inv = x.invitados;
  if (!inv) return '';
  const partes = [];
  if (inv.lista) {
    const gente = inv.lista.filter(i => !i.yo && !i.organizador);
    if (gente.length) partes.push(gente.map(i => { const [lab, cls] = TB_RSVP[i.estado] || TB_RSVP.sin_responder; return `<span class="rsvp ${cls}" title="${esc(i.email)}">${esc(i.nombre && i.nombre !== i.email ? i.nombre : i.email.split('@')[0])} · ${lab}</span>`; }).join(' '));
    else if (inv.fuente === 'google') partes.push('<span class="muted">sin invitados en el evento</span>');
  }
  if (inv.respuestas && inv.respuestas.length) partes.push(inv.respuestas.map(r => `<span class="muted" title="${esc(r.pregunta)}">${esc(r.pregunta.length > 28 ? r.pregunta.slice(0, 26) + '…' : r.pregunta)}: <b>${esc(r.respuesta)}</b></span>`).join(' · '));
  return partes.length ? `<div class="chico rf-inv">${partes.join(' · ')}</div>` : '';
}

// Fila de un demo que no vino de la SDR: sin estado de reunión, con los chulos guardándose en el deal.
function tbFilaDirecto(x, criterios) {
  const n = criterios.filter(c => x.items[c.clave]).length;
  const det = x.detalle || {};
  const pista = c => { const v = det[c.clave]; return v ? `${c.label}: la IA dice que ${v.cumple ? 'SÍ cumple' : 'NO cumple'}.${v.evidencia ? ` "${v.evidencia}"` : ''}${!v.cumple && v.falta ? `\nFalta: ${v.falta}` : ''}${!v.cumple && v.accion ? `\nPara cerrarlo: ${v.accion}` : ''}` : c.ayuda; };
  const chulos = criterios.map(c => `<label class="chulo ${x.items[c.clave] ? 'si' : ''} ${x.fuente[c.clave] === 'sandler' || x.fuente[c.clave] === 'ia' ? 'de-sandler' : ''}" title="${esc(pista(c))}">
      <input type="checkbox" data-k="${c.clave}" ${x.items[c.clave] ? 'checked' : ''} /><span>${esc(c.label)}</span></label>`).join('');
  const com = TB_COMERCIAL[x.comercial];
  const canal = EMB_CANAL[x.canal] || x.canal || 'Directo';
  const faltan = criterios.filter(c => !x.items[c.clave] && det[c.clave] && det[c.clave].accion);
  return `<div class="reunion-fila directo" data-deal-directo="${x.deal_id}">
    <div class="rf-info">
      <div><span class="pill">${esc(canal)}</span>${x.con_demo ? '' : ' <span class="pill warn">sin demo</span>'}${com ? ` <span class="pill ${com[1]}" title="${esc(x.motivo || '')}">${com[0]}</span>` : ''}</div>
      <a href="#/deal/${x.deal_id}"><b>${esc(x.empresa || 'Sin empresa')}</b></a>
      ${x.contacto ? `<div class="muted">${esc(x.contacto)}</div>` : ''}
      <div class="muted chico">deal #${x.deal_id} · ${tbFecha(x.creado_ms)}${x.ejecutiva ? ' · ' + esc(x.ejecutiva) : ''}</div>
      ${faltan.length ? `<div class="chico rf-cta">${faltan.map(c => `<div><b>${esc(c.label)}:</b> ${esc(det[c.clave].accion)}</div>`).join('')}</div>` : ''}
    </div>
    <div class="rf-cal">
      <div class="chulos">${chulos}</div>
      <div class="rf-res">${x.calificacion ? calCell(x.calificacion) + ` <span class="muted chico">${n}/4</span>` : '<span class="pill">Sin calificar</span>'}
        ${x.manual ? `<span class="muted chico">marcado por ${esc(x.manual.por || '—')} ${tbFechaHora(x.manual.ms)}</span>` : x.con_demo ? '<span class="muted chico">del demo</span>' : ''}</div>
    </div>
    <div class="rf-acc">
      <a class="btn secondary btn-sm" href="#/deal/${x.deal_id}" title="Demo completo, análisis y acciones">Deal →</a>
      <a class="btn ghost btn-sm" href="#/embudo" title="Moverlo de etapa en el embudo">Embudo</a>
    </div>
  </div>`;
}

function tbFila(x, criterios) {
  const est = TB_ESTADO[x.estado] || [x.estado, ''];
  const n = criterios.filter(c => x.items[c.clave]).length;
  const bloqueo = x.puede_calificar ? '' : (x.estado === 'programada' ? 'Se califica después de la reunión (o márcala realizada)' : 'La reunión no se hizo');
  const coincide = x.calificacion && x.calificacion.toLowerCase() === tbEtiqueta(n).toLowerCase();
  const det = x.detalle || {};
  const pista = c => {
    const v = det[c.clave];
    if (bloqueo) return bloqueo;
    if (!v) return c.ayuda + (x.fuente[c.clave] === 'sandler' ? ' · viene del demo llenado en el Sandler' : '');
    return `${c.label}: la IA dice que ${v.cumple ? 'SÍ cumple' : 'NO cumple'}.${v.evidencia ? ` "${v.evidencia}"` : ''}${!v.cumple && v.falta ? `\nFalta: ${v.falta}` : ''}${!v.cumple && v.accion ? `\nPara cerrarlo: ${v.accion}` : ''}`;
  };
  const chulos = criterios.map(c => `<label class="chulo ${x.items[c.clave] ? 'si' : ''} ${x.fuente[c.clave] === 'sandler' || x.fuente[c.clave] === 'ia' ? 'de-sandler' : ''}" title="${esc(pista(c))}">
      <input type="checkbox" data-k="${c.clave}" ${x.items[c.clave] ? 'checked' : ''} ${x.puede_calificar ? '' : 'disabled'} /><span>${esc(c.label)}</span></label>`).join('');
  const com = TB_COMERCIAL[x.comercial];
  return `<div class="reunion-fila ${x.estado}" data-lead="${x.lead_id}">
    <div class="rf-info">
      <div><span class="pill ${est[1]}">${est[0]}</span>${com ? ` <span class="pill ${com[1]}" title="${esc(x.motivo || '')}">${com[0]}</span>` : ''}</div>
      ${x.deal_id ? `<a href="#/deal/${x.deal_id}"><b>${esc(x.empresa || 'Sin empresa')}</b></a>` : `<b>${esc(x.empresa || 'Sin empresa')}</b>`}
      <div class="muted">${esc([x.contacto, x.cargo].filter(Boolean).join(' · ') || '—')}</div>
      <div class="muted chico">${x.reunion_ms ? '📅 ' + tbFechaHora(x.reunion_ms) : 'Sin fecha'} · agendó ${esc(x.agendo || '—')} el ${tbFecha(x.agendada_ms)}</div>
      ${tbInvitados(x)}
    </div>
    <div class="rf-cal">
      <div class="chulos">${chulos}</div>
      <div class="rf-res">${x.calificacion ? calCell(x.calificacion) + (coincide ? ` <span class="muted chico">${n}/4</span>` : '') : `<span class="pill">${x.puede_calificar ? 'Sin calificar' : '—'}</span>`}
        ${x.manual ? `<span class="muted chico">marcado por ${esc(x.manual.por || '—')} ${tbFechaHora(x.manual.ms)}</span>` : x.formulario_sandler ? '<span class="muted chico">del demo en el Sandler</span>' : ''}</div>
    </div>
    <div class="rf-acc">
      ${x.etapa === 'reunion_agendada' && x.estado !== 'cancelada' ? `<button class="btn secondary btn-sm" data-acc="reunion_realizada">✓ Realizada</button><button class="btn secondary btn-sm" data-acc="no_show">No asistió</button>` : ''}
      ${x.deal_id ? `<a class="btn secondary btn-sm" href="#/deal/${x.deal_id}" title="Deal #${x.deal_id}: ficha de Angie, demo completo y cierre">Deal →</a>` : ''}
      <a class="btn ghost btn-sm" href="/sdr/#/lead/${x.lead_id}" target="_blank" rel="noopener" title="Historial de toques de Angie">SDR ↗</a>
      ${x.manual ? `<button class="btn ghost btn-sm" data-acc="limpiar" title="Quita los chulos marcados a mano">Quitar</button>` : ''}
    </div>
  </div>`;
}

async function renderTablero(params, { conservar = false } = {}) {
  if (!conservar) { tbEditadas.clear(); h(`<h1>Tablero</h1><p class="muted">Cargando...</p>`); }
  let r, deals;
  try {
    [r, deals] = await Promise.all([
      tbApi('ejecutiva' + (params.get('mes') ? '?mes=' + encodeURIComponent(params.get('mes')) : '')),
      fetch('/api/deals').then(x => x.json()).catch(() => []),
    ]);
  }
  catch (e) { h(`<h1>Tablero</h1><div class="card" style="border-left:4px solid var(--bad)">No se pudo cargar: ${esc(e.message)}</div>`); return; }
  const k = r.kpis, sdr = r.sdr || 'la SDR';
  const filtro = TB_FILTROS.find(f => f[0] === params.get('f')) || (k.por_calificar ? TB_FILTROS[1] : TB_FILTROS[0]);
  const lista = r.reuniones.filter(x => filtro[2](x) || tbEditadas.has(x.lead_id));
  const enlace = extra => { const p = new URLSearchParams(); p.set('mes', r.mes); for (const [a, b] of Object.entries(extra)) p.set(a, b); return '#/tablero?' + p; };
  const pct = v => (v == null ? '—' : v + '%');
  const debil = k.evaluadas ? k.criterios.slice().sort((a, b) => a.si - b.si)[0] : null;
  const ci = tbCierre(Array.isArray(deals) ? deals : [], r.mes);
  const barra = c => { const p = c.de ? Math.round((c.si / c.de) * 100) : 0; return `<div class="crit"><span>${esc(c.label)}</span><div class="crit-b"><i style="width:${p}%"></i></div><b>${c.de ? `${c.si}/${c.de}` : '—'}</b></div>`; };
  h(`
    <div class="split">
      <div><h1>Tablero de ${esc(r.ejecutiva || 'la ejecutiva')}</h1>
        <p class="muted" style="margin:0">${esc(tbMes(r.mes, true))} · <a href="${enlace({ mes: r.anterior })}">← mes anterior</a>${r.posterior <= r.hoy.slice(0, 7) ? ` · <a href="${enlace({ mes: r.posterior })}">mes siguiente →</a>` : ''}</p></div>
      <div style="display:flex;gap:8px"><a class="btn btn-sm" href="#/embudo">Embudo</a><a class="btn ghost btn-sm" href="#/">+ Nuevo deal</a><a class="btn ghost btn-sm" href="#/deals">Historial</a></div>
    </div>
    ${!r.sandler ? '<div class="card" style="border-left:4px solid var(--bad)">No encuentro la tabla de deals: los chulos no se pueden guardar.</div>' : ''}
    <h2>Cierre de ${esc(tbMes(r.mes))}</h2>
    <div class="tb-kpis">
      <div class="card compact"><div class="muted">Deals abiertos</div><div class="num">${ci.abiertos}</div><div class="muted chico">${ci.abiertosCotizados} ya cotizados · ${ci.abiertosSdr} traídos por ${esc(sdr)}</div></div>
      <div class="card compact"><div class="muted">Nuevos en el mes</div><div class="num">${ci.nuevos}</div><div class="muted chico">${ci.nuevosSdr} de ${esc(sdr)} · ${ci.nuevos - ci.nuevosSdr} de otros canales</div></div>
      <div class="card compact"><div class="muted">Cotizados en el mes</div><div class="num">${ci.cotizados}</div><div class="muted chico">solo se cotiza con calificación Completa</div></div>
      <div class="card compact"><div class="muted">Ganados</div><div class="num" style="color:var(--peaku-green)">${ci.ganados}</div><div class="muted chico">${ci.perdidos} perdidos en el mes</div></div>
      <div class="card compact"><div class="muted">Tasa de cierre</div><div class="num">${pct(ci.tasa)}</div><div class="muted chico">ganados / cerrados del mes</div></div>
      <div class="card compact ${ci.sinValorPct != null && ci.sinValorPct >= 20 ? 'alerta' : ''}"><div class="muted">"Lead sin valor"</div><div class="num">${pct(ci.sinValorPct)}</div><div class="muted chico">de las perdidas del mes · meta &lt;20%</div></div>
    </div>
    ${ci.estancados.length ? `<div class="card"><h3 style="margin-top:0">Abiertos sin cerrar hace más de 30 días</h3>
      <table><tbody>${ci.estancados.slice(0, 8).map(d => `<tr class="clickable" onclick="location.hash='#/deal/${d.id}'"><td><b>${esc(d.company || '—')}</b></td><td>${calCell(d.calificacion_sandler)}</td><td class="muted">${d.quoted_at ? 'cotizado ' + tbFecha(new Date(d.quoted_at).getTime()) : 'sin cotizar'}</td><td class="muted" style="text-align:right">${d.dias} días</td></tr>`).join('')}</tbody></table>
      ${ci.estancados.length > 8 ? `<p class="muted chico" style="margin:8px 0 0">y ${ci.estancados.length - 8} más en el <a href="#/deals">historial</a>. "Un no limpio vale más que un quizás eterno."</p>` : ''}</div>` : ''}

    <h2>Reuniones que trae ${esc(sdr)}</h2>
    ${k.por_calificar ? `<div class="tb-aviso">⏳ <b>${tbPlural(k.por_calificar, 'reunión ya pasó', 'reuniones ya pasaron')} sin calificar</b>${k.dias_pendiente_mas_vieja ? ` (la más vieja hace ${tbPlural(k.dias_pendiente_mas_vieja, 'día', 'días')})` : ''}. Marca los chulos de lo que quedó claro en la reunión: se guarda al hacer clic.</div>` : ''}
    ${r.pendientes_anteriores.length ? `<div class="tb-aviso suave">También quedan sin calificar: ${r.pendientes_anteriores.map(p => `<a href="${enlace({ mes: p.mes, f: 'pendientes' })}">${p.n} de ${esc(tbMes(p.mes))}</a>`).join(' · ')}</div>` : ''}
    <div class="tb-kpis">
      <div class="card compact"><div class="muted">Reuniones agendadas</div><div class="num">${k.reuniones}</div><div class="muted chico">${k.programadas} programadas por venir</div></div>
      <div class="card compact ${k.por_calificar ? 'alerta' : ''}"><div class="muted">Por calificar</div><div class="num">${k.por_calificar}</div><div class="muted chico">ya pasaron sin calificación</div></div>
      <div class="card compact"><div class="muted">Asistencia</div><div class="num">${pct(k.asistencia_pct)}</div><div class="muted chico">${k.realizadas} realizadas · ${k.no_asistio} no asistieron${k.canceladas ? ` · ${k.canceladas} canceladas` : ''}</div></div>
      <div class="card compact"><div class="muted">Calificación completa</div><div class="num">${pct(k.completa_pct)}</div><div class="muted chico">${k.completas} Completa · ${k.parciales} Parcial · ${k.no_califica} No califica</div></div>
      <div class="card compact"><div class="muted">Avanzaron a propuesta</div><div class="num">${k.cotizadas + k.ganadas + k.perdidas}</div><div class="muted chico">${k.cotizadas} cotizadas · ${k.ganadas} ganadas · ${k.perdidas} perdidas</div></div>
      <a class="card compact" href="/sdr/#/comision?mes=${r.mes}" target="_blank" rel="noopener"><div class="muted">Comisión de ${esc(sdr)}</div><div class="num">${esc(r.comision.moneda)} ${Number(r.comision.total).toLocaleString('es-CO')}</div><div class="muted chico">${tbPlural(r.comision.calificadas, 'reunión', 'reuniones')} ${esc(r.comision.califica_con.join(' o '))}</div></a>
    </div>
    <div class="card">
      <h3 style="margin-top:0">Qué se logró en las reuniones calificadas</h3>
      ${k.evaluadas ? `<div class="crits">${k.criterios.map(barra).join('')}</div>
        ${debil && debil.si < debil.de ? `<p class="muted chico" style="margin:10px 0 0">Lo que más falta: <b>${esc(debil.label)}</b> (${debil.de - debil.si} de ${debil.de}). Es lo que ${esc(sdr)} tiene que dejar más claro antes de agendar.</p>` : ''}`
        : '<p class="muted" style="margin:0">Todavía no hay reuniones calificadas este mes.</p>'}
    </div>
    <div class="tb-filtros">${TB_FILTROS.map(f => `<a class="${f === filtro ? 'active' : ''}" href="${enlace({ f: f[0] })}">${f[1]} <span>${r.reuniones.filter(f[2]).length}</span></a>`).join('')}</div>
    <div class="reuniones-lista">
      ${lista.length ? lista.map(x => tbFila(x, r.criterios)).join('') : `<p class="muted" style="text-align:center;padding:30px">${filtro[0] === 'pendientes' ? 'Nada por calificar. ✔' : 'No hay reuniones aquí.'}</p>`}
    </div>
    ${(r.directos || []).length ? `
    <h2 style="margin-top:28px">Demos por otros canales <span class="muted" style="font-weight:400;font-size:14px">· ${r.directos.length} en ${esc(tbMes(r.mes))}</span></h2>
    <p class="muted chico" style="margin:-6px 0 10px">Deals que no vienen de ${esc(sdr)} (referidos, inbound, tu propia prospección). Se califican con los mismos chulos; lo que marques queda en el deal y en el embudo.</p>
    <div class="reuniones-lista">${r.directos.map(x => tbFilaDirecto(x, r.criterios)).join('')}</div>` : ''}
    <div class="card compact tb-criterios"><h3 style="margin-top:0">Cuándo marcar cada chulo</h3>${r.criterios.map(c => `<p><b>${esc(c.label)}:</b> ${esc(c.ayuda)}</p>`).join('')}</div>
    <p class="muted chico" style="margin-top:14px">4 = Completa (cuenta para la comisión de ${esc(sdr)}) · 2-3 = Parcial · 0-1 = No califica. El chulo con borde punteado viene del demo llenado en el asistente; lo marcado aquí manda. Con la reunión en "Realizada" y los 4 chulos, el lead queda calificado.</p>`);

  const recargar = async () => { const y = window.scrollY; await renderTablero(params, { conservar: true }); window.scrollTo(0, y); };
  el.querySelectorAll('.reunion-fila[data-deal-directo]').forEach($f => {
    const dealId = $f.dataset.dealDirecto;
    const x = (r.directos || []).find(z => String(z.deal_id) === dealId);
    $f.querySelectorAll('.chulos input').forEach($c => $c.addEventListener('change', async () => {
      const items = {};
      $f.querySelectorAll('.chulos input').forEach(i => { items[i.dataset.k] = i.checked; i.disabled = true; });
      try {
        const res = await tbApi(`embudo/${dealId}/calificar`, { method: 'POST', body: { items, usuario: r.ejecutiva } });
        tbAvisar(`${x.empresa || 'Deal'}: ${res.calificacion || res.label || 'sin calificar'}`);
      } catch (e) { tbAvisar(e.message, 'error'); }
      await recargar();
    }));
  });
  el.querySelectorAll('.reunion-fila[data-lead]').forEach($f => {
    const id = $f.dataset.lead;
    const x = r.reuniones.find(z => String(z.lead_id) === id);
    $f.querySelectorAll('.chulos input').forEach($c => $c.addEventListener('change', async () => {
      tbEditadas.add(x.lead_id);
      const items = {};
      $f.querySelectorAll('.chulos input').forEach(i => { items[i.dataset.k] = i.checked; i.disabled = true; });
      try {
        const res = await tbApi(`leads/${id}/calificacion`, { method: 'POST', body: { items, usuario: r.ejecutiva } });
        tbAvisar(`${x.empresa || 'Reunión'}: ${res.calificacion || 'sin calificar'}${res.avisos && res.avisos.length ? ' · ' + res.avisos.join(' ') : ''}`);
      } catch (e) { tbAvisar(e.message, 'error'); }
      await recargar();
    }));
    $f.querySelectorAll('[data-acc]').forEach($b => $b.addEventListener('click', async () => {
      const acc = $b.dataset.acc;
      tbEditadas.add(x.lead_id);
      if (acc === 'no_show' && !confirm(`¿${x.empresa || 'El prospecto'} no se presentó? Vuelve a ${sdr} para recuperarla.`)) return;
      if (acc === 'limpiar' && !confirm('¿Quitar los chulos marcados a mano? La reunión vuelve a "por calificar" si no hay demo llenado.')) return;
      $b.disabled = true;
      try {
        if (acc === 'limpiar') await tbApi(`leads/${id}/calificacion`, { method: 'POST', body: { limpiar: true, usuario: r.ejecutiva } });
        else await tbApi(`leads/${id}/ejecutiva`, { method: 'POST', body: { accion: acc, usuario: r.ejecutiva } });
        tbAvisar(acc === 'reunion_realizada' ? 'Reunión realizada: ya puedes marcar los chulos.' : acc === 'no_show' ? 'Marcada como no asistió.' : 'Chulos quitados.');
        await recargar();
      } catch (e) { tbAvisar(e.message, 'error'); $b.disabled = false; }
    }));
  });
}

// ---------- Embudo de la ejecutiva ----------
// Los deals por etapa. Se mueven arrastrando la tarjeta o con "Mover a". Para "Calificados" hay que
// marcar las 4 variables; "Prueba gratis o cotización" pide cuál; Ganado y Perdido piden motivo.
// Datos y reglas: /sdr/api/embudo (sdr/embudo.js, reglas en EMBUDO de sdr/config.js).
const EMB_COLOR = { sin_calificar: '#94a3b8', calificado: '#00C3FF', propuesta: '#6366f1', interesado: '#d97706', ganado: '#1D976C', perdido: '#dc2626' };
const EMB_MOTIVOS = {
  ganado: ['Dolor bien desarrollado y demo enfocada', 'Ancla de precio funcionó (ROI vs statu quo)', 'Piloto validó la solución', 'Champion interno empujó la decisión', 'Otro'],
  perdido: ['Lead sin valor (no calificaba)', 'Precio / presupuesto', 'Se fueron con competidor', 'Timing / no era el momento', 'Decisión interna quedó frenada', 'Cliente no respondió (breakup día 30)', 'Otro'],
};
const EMB_CANAL = { sdr_interno: null, freelancer: 'Freelancer', inbound: 'Inbound', referido: 'Referido', evento: 'Evento', outbound: 'Outbound', otro: 'Otro' };
let embDatos = null;

function embTarjeta(x, etapa) {
  const canal = x.canal === 'sdr_interno' ? (embDatos.sdr || 'SDR') : (EMB_CANAL[x.canal] || x.canal || '');
  const puntos = embDatos.criterios.map(c => `<i class="${x.items[c.clave] ? 'si' : ''}" title="${esc(c.label)}"></i>`).join('');
  const opciones = embDatos.etapas.filter(e => e.id !== etapa).map(e => `<option value="${e.id}">${esc(e.label)}</option>`).join('');
  return `<div class="emb-card" draggable="true" data-deal="${x.deal_id}" data-etapa="${etapa}">
    <a href="#/deal/${x.deal_id}" class="emb-emp">${esc(x.empresa || 'Sin empresa')}</a>
    ${x.contacto || x.cargo ? `<div class="muted chico">${esc([x.contacto, x.cargo].filter(Boolean).join(' · '))}</div>` : ''}
    <div class="emb-chips">
      ${canal ? `<span class="pill">${esc(canal)}</span>` : ''}
      ${x.calificacion ? calCell(x.calificacion) : ''}<span class="emb-puntos" title="${x.n} de 4 variables">${puntos}</span>
      ${etapa === 'propuesta' && x.propuesta_tipo ? `<span class="pill">${esc(embDatos.tipos_propuesta[x.propuesta_tipo] || x.propuesta_tipo)}</span>` : ''}
      ${x.reunion_pendiente ? `<span class="pill warn">Reunión ${tbFecha(x.reunion_ms)}</span>` : ''}
    </div>
    ${etapa === 'ganado' && x.productos && x.productos.length ? `<div class="emb-chips">${x.productos.map(pr => `<span class="pill good">${esc(pr)}</span>`).join('')}</div>` : ''}
    ${x.motivo && (etapa === 'ganado' || etapa === 'perdido') ? `<div class="muted chico">${esc(x.motivo)}</div>` : ''}
    ${['propuesta', 'interesado', 'ganado'].includes(etapa) ? (x.cotizacion ? `<a class="emb-cot" href="#/deal/${x.deal_id}" title="${esc(x.cotizacion.archivo)}">📄 Cotización${x.cotizacion.analizada ? ' · analizada' : ' · sin analizar'}</a>` : `<button type="button" class="emb-cot falta" data-cotizar="${x.deal_id}">📄 Subir la cotización</button>`) : ''}
    <div class="emb-pie">
      <span class="muted chico" title="Días en esta etapa">${x.dias_en_etapa === 0 ? 'hoy' : x.dias_en_etapa + ' d'}</span>
      ${etapa === 'sin_calificar' || etapa === 'calificado' ? `<button class="btn ${etapa === 'sin_calificar' ? '' : 'ghost'} btn-sm" data-calificar="${x.deal_id}">${etapa === 'sin_calificar' ? 'Calificar' : 'Variables'}</button>` : ''}
      <select class="emb-mover" data-mover="${x.deal_id}" title="Mover a otra etapa"><option value="">Mover a…</option>${opciones}</select>
    </div>
  </div>`;
}

async function renderEmbudo() {
  h(`<h1>Embudo</h1><p class="muted">Cargando...</p>`);
  try { embDatos = await tbApi('embudo'); }
  catch (e) { h(`<h1>Embudo</h1><div class="card" style="border-left:4px solid var(--bad)">No se pudo cargar: ${esc(e.message)}</div>`); return; }
  const d = embDatos;
  if (d.sin_tabla) { h(`<h1>Embudo</h1><p class="muted">No hay tabla de deals todavía.</p>`); return; }
  const abiertos = ['sin_calificar', 'calificado', 'propuesta', 'interesado'].reduce((n, k) => n + d.conteo[k], 0);
  h(`
    <div class="split">
      <div><h1>Embudo</h1><p class="muted" style="margin:0">${abiertos} deals abiertos · arrastra la tarjeta a otra etapa o usa "Mover a". Ganados y perdidos de los últimos ${d.reglas.diasCerrados} días.</p></div>
      <div style="display:flex;gap:8px"><a class="btn btn-sm" href="#/">+ Nuevo deal</a><a class="btn ghost btn-sm" href="#/tablero">Tablero</a></div>
    </div>
    <div class="emb-tablero">${d.etapas.map(e => `
      <section class="emb-col" data-col="${e.id}" style="--c:${EMB_COLOR[e.id]}">
        <header><b>${esc(e.label)}</b><span>${d.conteo[e.id]}</span></header>
        <div class="emb-lista">${d.columnas[e.id].map(x => embTarjeta(x, e.id)).join('') || '<p class="muted chico emb-vacio">—</p>'}</div>
      </section>`).join('')}
    </div>
    <p class="muted chico">Para pasar a <b>Calificados</b> se marcan las variables Sandler (${d.reglas.minimo === 'Completa' ? 'las 4' : 'al menos 2'}: Dolor, Presupuesto, Decisión, Fecha límite).${d.reglas.exigir ? ' Sin calificar no se avanza a propuesta, interesados ni ganados.' : ''} Las reglas están en EMBUDO de sdr/config.js.</p>
    <div id="emb-modal"></div>`);

  // Arrastrar y soltar
  let arrastrado = null;
  el.querySelectorAll('.emb-card').forEach(c => {
    c.addEventListener('dragstart', e => { arrastrado = c; c.classList.add('arrastrando'); e.dataTransfer.setData('text/plain', c.dataset.deal); });
    c.addEventListener('dragend', () => { c.classList.remove('arrastrando'); el.querySelectorAll('.emb-col').forEach(k => k.classList.remove('encima')); });
  });
  el.querySelectorAll('.emb-col').forEach(col => {
    col.addEventListener('dragover', e => { if (arrastrado && arrastrado.dataset.etapa !== col.dataset.col) { e.preventDefault(); col.classList.add('encima'); } });
    col.addEventListener('dragleave', () => col.classList.remove('encima'));
    col.addEventListener('drop', e => { e.preventDefault(); col.classList.remove('encima'); if (arrastrado) embMover(Number(arrastrado.dataset.deal), col.dataset.col); });
  });
  el.querySelectorAll('[data-mover]').forEach(s => s.addEventListener('change', () => { if (s.value) embMover(Number(s.dataset.mover), s.value); s.value = ''; }));
  el.querySelectorAll('[data-calificar]').forEach(b => b.addEventListener('click', () => embCalificar(Number(b.dataset.calificar))));
  el.querySelectorAll('[data-cotizar]').forEach(b => b.addEventListener('click', () => embCotizacion(Number(b.dataset.cotizar))));
}

function embCotizacion(id) {
  const x = embBuscar(id); if (!x) return;
  const m = embModal(`<h2 style="margin-top:0">Cotización · ${esc(x.empresa)}</h2>
    <p class="muted chico" style="margin:0 0 10px">Sube lo que se le mandó al cliente. Queda como texto en el deal y después se compara con lo que pidió en el demo.</p>
    ${cotizacionFormHtml()}
    <div class="btn-row"><button class="btn ghost" data-cerrar>Ahora no</button></div>`);
  enlazarCotizacionForm(m.querySelector('.cot-form'), id, async () => { m.innerHTML = ''; await embRecargar(); });
}

const embBuscar = id => { for (const k of Object.keys(embDatos.columnas)) { const x = embDatos.columnas[k].find(z => z.deal_id === id); if (x) return x; } return null; };
async function embRecargar() { const y = window.scrollY, sx = (el.querySelector('.emb-tablero') || {}).scrollLeft || 0; await renderEmbudo(); window.scrollTo(0, y); const t = el.querySelector('.emb-tablero'); if (t) t.scrollLeft = sx; }
function embModal(html) { const m = document.getElementById('emb-modal'); m.innerHTML = `<div class="emb-velo"><div class="emb-dialogo card">${html}</div></div>`; m.querySelector('[data-cerrar]').addEventListener('click', () => { m.innerHTML = ''; }); return m; }

async function embMover(id, etapa) {
  const x = embBuscar(id); if (!x) return;
  const nombre = (embDatos.etapas.find(e => e.id === etapa) || {}).label || etapa;
  if (etapa === 'calificado') return embCalificar(id, true);
  if (etapa === 'propuesta') {
    const m = embModal(`<h2 style="margin-top:0">${esc(x.empresa)} → ${esc(nombre)}</h2><p class="muted">¿Qué se le envió?</p>
      <div class="btn-row" style="justify-content:flex-start;margin-top:8px">${Object.entries(embDatos.tipos_propuesta).map(([k, v]) => `<button class="btn" data-tipo="${k}">${esc(v)}</button>`).join('')}<button class="btn ghost" data-cerrar>Cancelar</button></div>`);
    m.querySelectorAll('[data-tipo]').forEach(b => b.addEventListener('click', async () => { m.innerHTML = ''; await embEnviar(id, { etapa, tipo: b.dataset.tipo }); if (b.dataset.tipo === 'cotizacion') embCotizacion(id); }));
    return;
  }
  if (etapa === 'ganado' || etapa === 'perdido') {
    const m = embModal(`<h2 style="margin-top:0">${esc(x.empresa)} → ${esc(nombre)}</h2>
      ${etapa === 'perdido' ? '<p class="muted chico">"Un no limpio vale más que un quizás eterno." El motivo alimenta la métrica "Lead sin valor".</p>' : ''}
      ${etapa === 'ganado' ? `<label>¿Qué se vendió? <span class="muted">(una o varias)</span></label><div class="chips" style="margin:0 0 4px">${(embDatos.productos || PRODUCTOS_PEAKU).map(pr => `<label class="chip" style="padding:8px 12px;display:inline-flex;gap:6px;align-items:center;"><input type="checkbox" value="${esc(pr)}" data-prod style="margin:0;"> ${esc(pr)}</label>`).join('')}</div>` : ''}
      <label>Motivo</label><select id="emb-motivo" style="width:100%"><option value="">— Selecciona —</option>${EMB_MOTIVOS[etapa].map(o => `<option>${esc(o)}</option>`).join('')}</select>
      <label>Comentario <span class="muted">(opcional)</span></label><input id="emb-coment" style="width:100%" />
      <div class="btn-row"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn ${etapa === 'ganado' ? 'green' : 'danger-solid'}" id="emb-ok">${etapa === 'ganado' ? '🏆 Marcar ganado' : 'Marcar perdido'}</button></div>`);
    m.querySelector('#emb-ok').addEventListener('click', async () => {
      const motivo = [m.querySelector('#emb-motivo').value, m.querySelector('#emb-coment').value.trim()].filter(Boolean).join(' — ');
      if (!motivo) { tbAvisar('Elige el motivo.', 'error'); return; }
      const productos = [...m.querySelectorAll('[data-prod]:checked')].map(i => i.value);
      if (etapa === 'ganado' && !productos.length) { tbAvisar('Marca qué se vendió.', 'error'); return; }
      m.innerHTML = ''; await embEnviar(id, { etapa, motivo, productos });
    });
    return;
  }
  await embEnviar(id, { etapa });
}

async function embEnviar(id, body) {
  try {
    await tbApi(`embudo/${id}/mover`, { method: 'POST', body: { ...body, usuario: embDatos.ejecutiva } });
    tbAvisar(`Movido a ${(embDatos.etapas.find(e => e.id === body.etapa) || {}).label || body.etapa}.`);
  } catch (e) {
    tbAvisar(e.message, 'error');
    if (/calific/i.test(e.message) && body.etapa !== 'perdido') { await embRecargar(); return embCalificar(id, true); }
  }
  await embRecargar();
}

function embCalificar(id, paraAvanzar = false) {
  const x = embBuscar(id); if (!x) return;
  const crit = embDatos.criterios;
  const m = embModal(`<h2 style="margin-top:0">Calificar · ${esc(x.empresa)}</h2>
    <p class="muted chico">${paraAvanzar ? `Para pasar a <b>Calificados</b> marca lo que quedó claro en la reunión (${embDatos.reglas.minimo === 'Completa' ? 'las 4 variables' : 'al menos 2'}). ` : ''}Se guarda en el deal y cuenta para la comisión de ${esc(embDatos.sdr || 'la SDR')} si el lead es suyo.</p>
    <div class="chulos" style="margin:12px 0">${crit.map(c => `<label class="chulo ${x.items[c.clave] ? 'si' : ''}" title="${esc(c.ayuda)}"><input type="checkbox" data-k="${c.clave}" ${x.items[c.clave] ? 'checked' : ''} /><span>${esc(c.label)}</span></label>`).join('')}</div>
    <details class="tb-criterios"><summary class="chico">Cuándo marcar cada uno</summary>${crit.map(c => `<p><b>${esc(c.label)}:</b> ${esc(c.ayuda)}</p>`).join('')}</details>
    <div id="emb-cal-res"></div>
    <div class="btn-row"><button class="btn ghost" data-cerrar>Cancelar</button><button class="btn" id="emb-cal-ok">Guardar</button></div>`);
  const pinta = () => {
    const n = [...m.querySelectorAll('.chulos input')].filter(i => i.checked).length;
    m.querySelectorAll('.chulo').forEach(l => l.classList.toggle('si', l.querySelector('input').checked));
    m.querySelector('#emb-cal-res').innerHTML = `Resultado: ${calCell(tbEtiqueta(n))} <span class="muted chico">${n}/4</span>`;
  };
  m.querySelectorAll('.chulos input').forEach(i => i.addEventListener('change', pinta)); pinta();
  m.querySelector('#emb-cal-ok').addEventListener('click', async () => {
    const items = {}; m.querySelectorAll('.chulos input').forEach(i => { items[i.dataset.k] = i.checked; });
    m.innerHTML = '';
    try {
      const r = await tbApi(`embudo/${id}/calificar`, { method: 'POST', body: { items, usuario: embDatos.ejecutiva } });
      tbAvisar([`${x.empresa}: ${r.calificacion || 'sin calificar'}.`, ...(r.avisos || [])].join(' '), r.etapa === 'calificado' || !paraAvanzar ? 'ok' : 'error');
    } catch (e) { tbAvisar(e.message, 'error'); }
    await embRecargar();
  });
}

// ---------- Cotización enviada: el documento como texto y su análisis contra el demo ----------
// Vive en el deal (data.cotizacion / data.cotizacionAnalisis) a través de /sdr/api/embudo/:id/cotizacion.
function leerBase64(file) {
  return new Promise((ok, no) => { const fr = new FileReader(); fr.onload = () => ok(String(fr.result).split(',')[1] || ''); fr.onerror = () => no(new Error('No se pudo leer el archivo')); fr.readAsDataURL(file); });
}
function cotizacionFormHtml(compacto = false) {
  return `<div class="cot-form">
    <label class="cot-drop"><input type="file" data-cot-file accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" hidden />
      <b>Sube la cotización</b><span class="muted chico">PDF, Word o texto · se guarda como texto para compararla con lo que pidió en el demo</span></label>
    <details ${compacto ? '' : 'open'} style="margin-top:8px"><summary class="muted chico" style="cursor:pointer">O pega el texto</summary>
      <textarea data-cot-texto placeholder="Pega aquí el contenido de la propuesta" style="min-height:90px;margin-top:6px"></textarea>
      <div style="margin-top:6px"><button class="btn secondary btn-sm" data-cot-guardar>Guardar texto</button></div></details>
    <div class="muted chico" data-cot-msg></div>
  </div>`;
}
function enlazarCotizacionForm($c, dealId, alTerminar) {
  const $msg = $c.querySelector('[data-cot-msg]');
  const enviar = async body => {
    $msg.textContent = 'Leyendo el documento…';
    try {
      const r = await tbApi(`embudo/${dealId}/cotizacion`, { method: 'POST', body });
      tbAvisar(`Cotización guardada${r.archivo ? ' (' + r.archivo + ')' : ''}: ${r.chars.toLocaleString('es-CO')} caracteres${r.recortado ? ', recortada' : ''}.`);
      await alTerminar();
    } catch (e) { $msg.textContent = ''; tbAvisar(e.message, 'error'); }
  };
  $c.querySelector('[data-cot-file]').addEventListener('change', async e => { const f = e.target.files[0]; if (!f) return; if (f.size > 8 * 1024 * 1024) return tbAvisar('El archivo pesa más de 8 MB.', 'error'); enviar({ archivo: f.name, base64: await leerBase64(f) }); });
  $c.querySelector('[data-cot-guardar]').addEventListener('click', () => { const t = $c.querySelector('[data-cot-texto]').value.trim(); if (t.length < 40) return tbAvisar('Pega el texto completo de la cotización.', 'error'); enviar({ archivo: 'texto pegado', texto: t }); });
}
function analisisHtml(a) {
  const lista = (t, xs, clase) => xs && xs.length ? `<div class="cot-bloque"><h3>${t}</h3><ul class="list-clean">${xs.map(x => `<li><span class="pill ${clase}">${clase === 'good' ? '✓' : clase === 'bad' ? '✗' : '·'}</span> ${esc(x)}</li>`).join('')}</ul></div>` : '';
  const n = Number(a.alineacion), color = n >= 75 ? 'var(--peaku-green)' : n >= 50 ? 'var(--warn)' : 'var(--bad)';
  return `<div class="cot-analisis">
    <div class="split" style="align-items:flex-start"><div><div class="muted chico">Alineación propuesta ↔ demo</div><div style="font-size:34px;font-weight:700;letter-spacing:-.03em;color:${color}">${Number.isFinite(n) ? n + '%' : '—'}</div></div>
      <p style="margin:0;max-width:60ch;font-size:14px">${esc(a.resumen || '')}</p></div>
    ${lista('Lo que sí cubre', a.cubre, 'good')}${lista('Lo que pidió y falta', a.falta, 'bad')}${lista('Lo que sobra', a.sobra, '')}
    ${a.precio ? `<div class="cot-bloque"><h3>Precio</h3><p style="margin:0;font-size:13.5px">${esc(a.precio)}</p></div>` : ''}
    ${lista('Riesgos de que no cierre', a.riesgos, 'warn')}${lista('Ajustes sugeridos, en orden', a.ajustes, '')}
    <div class="muted chico" style="margin-top:8px">Analizado ${a.at ? new Date(a.at).toLocaleString('es-CO') : ''}${a.por ? ' por ' + esc(a.por) : ''}.</div></div>`;
}
async function pintarCotizacion(dealId) {
  const $c = document.getElementById('cotizacion-card'); if (!$c) return;
  let r; try { r = await tbApi(`embudo/${dealId}/cotizacion`); } catch (e) { $c.innerHTML = ''; return; }
  const c = r.cotizacion, a = r.analisis;
  $c.innerHTML = `<div class="card">
    <div class="split"><h2 style="margin:0">Cotización enviada</h2>${c ? `<span class="muted chico">${esc(c.archivo || 'texto')} · ${new Date(c.at).toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}${c.por ? ' · ' + esc(c.por) : ''} · ${Number(c.chars).toLocaleString('es-CO')} caracteres</span>` : ''}</div>
    ${c ? `<details style="margin-top:10px"><summary class="muted chico" style="cursor:pointer">Ver el texto de la cotización</summary><pre class="cot-texto">${esc(c.texto)}</pre></details>
      ${a ? analisisHtml(a) : `<p class="muted" style="font-size:13px;margin:12px 0 8px">Todavía no se ha comparado con lo que el cliente pidió en el demo.</p>`}
      <div class="btn-row" style="justify-content:flex-start;margin-top:12px">
        <button class="btn" data-cot-analizar ${r.pedido && r.pedido.length >= 40 ? '' : 'disabled title="El deal no tiene el demo lleno: no hay contra qué comparar"'}>${a ? '↻ Volver a analizar' : '✦ Analizar contra el demo'}</button>
        <button class="btn ghost btn-sm" data-cot-otra>Subir otra versión</button></div>
      <div data-cot-otra-form hidden style="margin-top:10px">${cotizacionFormHtml(true)}</div>`
    : `<p class="muted" style="font-size:13px;margin:6px 0 10px">Sube el documento que se le mandó al cliente. Queda guardado como texto y se puede comparar con lo que pidió en el demo.</p>${cotizacionFormHtml()}`}
  </div>`;
  const recargar = () => pintarCotizacion(dealId);
  const $f = $c.querySelector('.cot-form'); if ($f && !c) enlazarCotizacionForm($f, dealId, recargar);
  const $otra = $c.querySelector('[data-cot-otra]'); if ($otra) $otra.addEventListener('click', () => { const w = $c.querySelector('[data-cot-otra-form]'); w.hidden = !w.hidden; if (!w.dataset.listo) { enlazarCotizacionForm(w.querySelector('.cot-form'), dealId, recargar); w.dataset.listo = '1'; } });
  const $an = $c.querySelector('[data-cot-analizar]'); if ($an) $an.addEventListener('click', async () => {
    $an.disabled = true; $an.textContent = 'Analizando…';
    try { await tbApi(`embudo/${dealId}/cotizacion/analizar`, { method: 'POST', body: {} }); tbAvisar('Análisis listo.'); await recargar(); }
    catch (e) { tbAvisar(e.message, 'error'); $an.disabled = false; $an.textContent = '✦ Analizar contra el demo'; }
  });
}

// ---------- Inicio de PeakU AI ----------
// La portada de la plataforma: qué está pasando hoy en los tres módulos, con un número de cada uno.
// Lee las APIs de cada módulo; si una no responde, la tarjeta muestra "—" y sigue siendo el enlace.
async function renderInicio() {
  const hoyBog = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' });
  const hora = Number(new Date().toLocaleTimeString('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', hour12: false }));
  const saludo = hora < 12 ? 'Buenos días' : hora < 19 ? 'Buenas tardes' : 'Buenas noches';
  const fechaTxt = new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
  const n = v => (v == null || Number.isNaN(v) ? '—' : Number(v).toLocaleString('es-CO'));
  const tarjeta = (href, titulo, quien, nums, medio, pie) => `<a class="pk-mod" href="${href}">
    <div class="pk-mod-top"><b>${titulo}</b><small>${esc(quien || '')}</small></div>
    <div class="pk-mod-nums">${nums.map(x => `<div class="${x.tono || ''}"><b>${x.valor}</b><span>${esc(x.label)}</span></div>`).join('')}</div>
    ${medio || ''}
    <div class="pk-mod-foot"><span>${pie[0]}</span><em>${pie[1]} →</em></div>
  </a>`;
  const skel = (href, titulo) => tarjeta(href, titulo, '', [1, 2, 3].map(() => ({ valor: '<span class="pk-skel">00</span>', label: ' ' })), '', ['', 'Abrir']);
  h(`<div class="pk-home">
    <div class="pk-home-hd"><div><h1>${saludo}</h1><p class="muted">${esc(fechaTxt)} · lo que está pasando en ventas, prospección y verificación.</p></div></div>
    <div class="pk-home-grid" id="pk-home-grid">${skel('#/tablero', 'Ventas')}${skel('/sdr/', 'Prospección')}${skel('/verificacion/', 'Verificación')}</div>
    <p class="pk-home-note">Cada tarjeta abre su módulo. Los números son de hoy y de este mes.</p>
  </div>`);

  const j = (url) => fetch(url).then(r => (r.ok ? r.json() : Promise.reject(new Error(r.status)))).catch(() => null);
  const meta = await j('/sdr/api/meta');
  const sdrNombre = ((meta && meta.usuarios || []).find(u => u.rol === 'sdr') || {}).nombre || '';
  const ejeNombre = ((meta && meta.usuarios || []).find(u => u.rol === 'ejecutiva') || {}).nombre || '';
  const [eje, deals, cola, com, ver] = await Promise.all([
    j('/sdr/api/ejecutiva'), j('/api/deals'), j('/sdr/api/cola' + (sdrNombre ? '?usuario=' + encodeURIComponent(sdrNombre) : '')),
    j('/sdr/api/comision' + (sdrNombre ? '?usuario=' + encodeURIComponent(sdrNombre) : '')), j('/verificacion/api/tablero'),
  ]);
  const grid = document.getElementById('pk-home-grid');
  if (!grid) return;

  // Ventas
  let ventas;
  if (eje) {
    const ci = tbCierre(Array.isArray(deals) ? deals : [], hoyBog.slice(0, 7));
    const k = eje.kpis;
    ventas = tarjeta('#/tablero', 'Ventas', ejeNombre, [
      { valor: n(k.por_calificar), label: 'por calificar', tono: k.por_calificar ? 'warn' : '' },
      { valor: n(ci.abiertos), label: 'deals abiertos' },
      { valor: n(ci.ganados), label: 'ganados (mes)', tono: ci.ganados ? 'ok' : '' },
    ], '', [`${k.reuniones} reuniones de ${esc(sdrNombre || 'la SDR')} este mes${ci.tasa == null ? '' : ' · cierre ' + ci.tasa + '%'}`, 'Abrir tablero']);
  } else ventas = tarjeta('#/tablero', 'Ventas', ejeNombre, [{ valor: '—', label: 'sin datos' }], '', ['', 'Abrir tablero']);

  // Prospección
  let sdr;
  if (cola) {
    const i = cola.indicadores, pct = Math.min(100, Math.round((i.marcaciones / Math.max(i.metaMarcaciones, 1)) * 100));
    const cumple = cola.racha && cola.racha.hoyCumple;
    sdr = tarjeta('/sdr/', 'Prospección', sdrNombre, [
      { valor: `${n(i.marcaciones)}<small>/${n(i.metaMarcaciones)}</small>`, label: 'marcaciones hoy', tono: cumple ? 'ok' : '' },
      { valor: `${n(i.reuniones)}<small>/${n(i.metaReuniones)}</small>`, label: 'reuniones hoy', tono: i.reuniones >= i.metaReuniones ? 'ok' : '' },
      { valor: n(cola.racha ? cola.racha.dias : null), label: 'días de racha' },
    ], `<div class="pk-meter" title="Avance de la meta de marcaciones"><i class="${cumple ? 'ok' : ''}" style="width:${pct}%"></i></div>`,
      [com ? `Comisión del mes ${esc(com.reglas.moneda)} ${n(com.comision.total)} · ${n(com.conteo.calificadas)} calificadas` : `${n(i.porContactar)} por contactar`, 'Abrir cola']);
  } else sdr = tarjeta('/sdr/', 'Prospección', sdrNombre, [{ valor: '—', label: 'sin datos' }], '', ['', 'Abrir cola']);

  // Verificación
  let verify;
  if (ver) {
    const quien = (ver.evaluadores || []).slice().sort((a, b) => b.n - a.n)[0];
    const sem = (ver.semanas || []).slice(-8), max = Math.max(1, ...sem.map(x => x.entrevistas));
    verify = tarjeta('/verificacion/', 'Verificación', quien ? quien.nombre.split(' ')[0] : '', [
      { valor: n(ver.esta_semana && ver.esta_semana.entrevistas), label: 'entrevistas (semana)' },
      { valor: n(ver.esta_semana && ver.esta_semana.informes), label: 'informes (semana)' },
      { valor: ver.cumplen && ver.cumplen.informes ? ver.cumplen.pct + '<small>%</small>' : '—', label: 'en 48 h', tono: ver.cumplen && ver.cumplen.pct >= 80 ? 'ok' : '' },
    ], `<div class="pk-spark" title="Entrevistas por semana, últimas 8">${sem.map(x => `<i style="height:${Math.max(8, Math.round((x.entrevistas / max) * 100))}%" title="${x.entrevistas}"></i>`).join('')}</div>`,
      [`${n(ver.pendientes && ver.pendientes.calificar)} por calificar · racha de ${n(ver.racha)} días`, 'Abrir consola']);
  } else verify = tarjeta('/verificacion/', 'Verificación', '', [{ valor: '—', label: 'sin datos' }], '', ['', 'Abrir consola']);
  grid.innerHTML = ventas + sdr + verify;
}

router();

// Calificación Sandler de un deal (una sola regla para el Sandler Coach y la app SDR).
//
// Cuatro criterios: dolor desarrollado (embudo del dolor, 2 de 3: cuantificar / historia / impacto),
// presupuesto, decisión (decisor + proceso de decisión) y fecha límite de decisión.
// Completa = 4 · Parcial = 2 o 3 · No califica = 0 o 1.
//
// Cada criterio sale del formulario del Sandler (lo que la ejecutiva escribió en el demo) salvo que
// la ejecutiva lo haya marcado a mano en el tablero de /sdr: data.calificacionManual.items[criterio]
// = true | false manda sobre el formulario. Al completar el demo en el Sandler, un criterio que el
// formulario sí trae borra la marca manual de ese criterio (la evidencia escrita gana a un "no").
// `ayuda`: la regla para marcar el chulo (se muestra en el tablero, el embudo y el asistente).
const CRITERIOS = [
  { clave: 'dolor', label: 'Dolor',
    ayuda: 'El cliente cuantificó el problema, contó qué ha intentado o describió el impacto (al menos 2 de las 3).' },
  { clave: 'presupuesto', label: 'Presupuesto',
    ayuda: 'Ya gastan en resolver esto (herramienta paga, agencia o alguien dedicado: se infiere, no se pregunta el monto) y nuestro rango de precios no les pareció lejos, con plata de este ciclo (no "para el presupuesto del próximo año").' },
  { clave: 'decision', label: 'Decisión',
    ayuda: 'Se sabe quién aprueba la compra (nombre o cargo; no necesariamente quien usa la herramienta) y cómo la aprueba (pasos, quién más opina, compras o comité). "Lo reviso con mi jefe" no alcanza.' },
  { clave: 'fecha', label: 'Fecha límite',
    ayuda: 'Hay una fecha acordada con el cliente para decidir ("¿para cuándo necesitan esto resuelto?").' },
];
const CLAVES = CRITERIOS.map(c => c.clave);

function has(s) { return !!(s && String(s).trim()); }

function painFunnel(d) {
  const c = has(d.dolorCuantificar), h = has(d.dolorHistoria), i = has(d.dolorImpacto);
  const count = [c, h, i].filter(Boolean).length;
  return { c, h, i, count, ok: count >= 2 };
}

// Veredicto de la IA por criterio (iaExtracted.criterios_sandler), aplicando la regla escrita de cada
// uno a la transcripción: { cumple, evidencia, falta, accion }. null si el demo no lo trae (demos de
// antes de este cambio).
function veredictoIA(d = {}) {
  const c = d && d.iaExtracted && d.iaExtracted.criterios_sandler;
  if (!c || typeof c !== 'object') return null;
  const out = {};
  for (const k of CLAVES) {
    const v = c[k];
    if (v && typeof v === 'object' && typeof v.cumple === 'boolean') {
      out[k] = { cumple: v.cumple, evidencia: String(v.evidencia || '').trim(), falta: String(v.falta || '').trim(), accion: String(v.accion || '').trim() };
    }
  }
  return Object.keys(out).length ? out : null;
}

// Lo que dice el demo, criterio por criterio. Con veredicto de la IA manda el veredicto (aplica la
// regla, no "el campo tiene texto": "presupuesto: no hay, es para 2027" ya no cuenta como chulo).
// Sin veredicto, el criterio se infiere de los campos del formulario, como antes.
function itemsFormulario(d = {}) {
  const ia = veredictoIA(d) || {};
  const campos = {
    dolor: painFunnel(d).ok,
    presupuesto: has(d.presupuesto),
    decision: has(d.decisor) && has(d.procesoDecision),
    fecha: has(d.fechaLimiteDecision),
  };
  const out = {};
  for (const k of CLAVES) out[k] = k in ia ? ia[k].cumple : campos[k];
  return out;
}

// Las reglas escritas, para el prompt del análisis (una línea por criterio).
function reglasTexto() {
  return CRITERIOS.map(c => `- ${c.clave} (${c.label}): ${c.ayuda}`).join('\n');
}

function manual(d = {}) {
  const m = d.calificacionManual && d.calificacionManual.items;
  const out = {};
  if (m && typeof m === 'object') for (const k of CLAVES) if (typeof m[k] === 'boolean') out[k] = m[k];
  return out;
}

function etiqueta(done) {
  return done >= 4 ? 'Completa' : done >= 2 ? 'Parcial' : 'No califica';
}

function calificacionSandler(d = {}) {
  d = d || {};
  const pf = painFunnel(d);
  const form = itemsFormulario(d);
  const man = manual(d);
  const ia = veredictoIA(d) || {};
  const items = {}, fuente = {}, detalle = {};
  for (const k of CLAVES) {
    if (k in man) { items[k] = man[k]; fuente[k] = 'manual'; }
    else { items[k] = form[k]; fuente[k] = form[k] ? (k in ia ? 'ia' : 'sandler') : null; }
    // Evidencia y qué falta (de la IA), se marque como se marque: es el "por qué" del chulo.
    if (k in ia) detalle[k] = ia[k];
  }
  const done = CLAVES.filter(k => items[k]).length;
  return {
    label: etiqueta(done), done, of: 4, pf, items, fuente, formulario: form, detalle, con_ia: Object.keys(ia).length > 0,
    // Compatibilidad con server.js (scoreDeal / pantalla del Sandler).
    dolorOk: items.dolor || has(d.dolor), budget: items.presupuesto, decision: items.decision, fecha: items.fecha,
  };
}

// Al completar el demo en el Sandler: conserva las marcas manuales guardadas en la fila (el
// borrador del Sandler puede no traerlas) y suelta las que el formulario ya respalda.
function fusionarAlCompletar(dNuevo = {}, dGuardado = {}) {
  const previa = (dGuardado && dGuardado.calificacionManual) || dNuevo.calificacionManual;
  if (!previa || !previa.items) return dNuevo;
  const form = itemsFormulario(dNuevo);
  const items = {};
  for (const k of CLAVES) if (typeof previa.items[k] === 'boolean' && !form[k]) items[k] = previa.items[k];
  const out = { ...dNuevo };
  if (Object.keys(items).length) out.calificacionManual = { ...previa, items };
  else delete out.calificacionManual;
  return out;
}

module.exports = { CRITERIOS, CLAVES, calificacionSandler, itemsFormulario, painFunnel, fusionarAlCompletar, etiqueta, veredictoIA, reglasTexto };

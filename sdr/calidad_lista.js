// Calidad de una lista: cuánto rinde (tocados → conversaciones → reuniones) y POR QUÉ, a partir de
// lo que la lista traía (cargos, celulares, tamaño de empresa) y de cómo salieron los descartes.
// La idea es que al ver una lista buena se sepa qué repetir, y al ver una floja qué no volver a cargar.
//
// Reglas en config.LISTAS.calificacion (umbrales de tasa y de composición). Puro: no toca la base.
// Lo usan sdr/listas.js (Marcar → Listas) y node sdr/cli.js listas.
const D = require('./dominio');

const simple = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const pct = (n, d) => (d ? n / d : 0);
const porc = x => `${Math.round(x * 100)} %`;

function reglas(config) {
  const c = ((config || {}).LISTAS || {}).calificacion || {};
  const re = (s, def) => { try { return new RegExp(s || def, 'i'); } catch (_) { return new RegExp(def, 'i'); } };
  return {
    minimoTocados: Number(c.minimo_tocados) || 15,
    reunion: { buena: Number((c.reunion || {}).buena) || 0.08, regular: Number((c.reunion || {}).regular) || 0.04 },
    conversacion: { buena: Number((c.conversacion || {}).buena) || 0.25, regular: Number((c.conversacion || {}).regular) || 0.15 },
    celularesMin: c.celulares_min == null ? 0.5 : Number(c.celulares_min),
    perfilThMin: c.perfil_th_min == null ? 0.7 : Number(c.perfil_th_min),
    sinCargoMax: c.sin_cargo_max == null ? 0.1 : Number(c.sin_cargo_max),
    tamano: Array.isArray(c.tamano) && c.tamano.length === 2 ? c.tamano.map(Number) : [20, 500],
    numerosVivosMin: c.numeros_vivos_min == null ? 0.6 : Number(c.numeros_vivos_min),
    numerosMalosMax: c.numeros_malos_max == null ? 0.15 : Number(c.numeros_malos_max),
    minimoLlamados: Number(c.minimo_llamados) || 10,
    reTh: re(c.cargo_th, 'talent|humano|rrhh|rr\\.?hh|\\bth\\b|\\bgh\\b|recursos|people|\\bhr\\b|human|selecci|reclut|recruit|atracci|sourcing|gestion humana|bienestar|cultura|nomina|personal'),
    reDecisor: re(c.cargo_decisor, 'jefe|gerente|director|head|lider|lead|coordinad|\\bvp\\b|vicepresident|chief|chro|manager|subgerente|responsable'),
    reSeleccion: re(c.cargo_seleccion, 'selecci|reclut|recruit|atracci|sourcing|talent acq'),
  };
}

// Qué es el contacto según su cargo: decisor_th (jefe/gerente/director de TH o selección),
// seleccion (reclutador, analista de selección), otro_th (TH sin mando), fuera (otro cargo:
// tech, comercial, gerencia general…) o sin_cargo.
function perfilCargo(cargo, r) {
  const c = simple(cargo).trim();
  if (!c) return 'sin_cargo';
  const th = r.reTh.test(c);
  if (th && r.reDecisor.test(c)) return 'decisor_th';
  if (r.reSeleccion.test(c)) return 'seleccion';
  if (th) return 'otro_th';
  return 'fuera';
}

// Celular colombiano (+573…), fijo (+5760…), otro país, o sin teléfono.
function tipoTelefono(tel) {
  const t = String(tel || '').replace(/\D/g, '');
  if (!t) return 'sin_telefono';
  if (/^573\d{9}$/.test(t)) return 'celular';
  if (/^5760\d{8}$/.test(t)) return 'fijo';
  if (/^57/.test(t)) return 'fijo';
  return 'otro_pais';
}

function tamanoEmpresa(empleados, [min, max]) {
  const n = Number(String(empleados == null ? '' : empleados).replace(/[^\d]/g, ''));
  if (!n) return 'sin_dato';
  if (n < min) return 'pequena';
  if (n > max) return 'grande';
  return 'rango';
}

// Composición y resultados de una lista a partir de sus filas:
//   { cargo, telefono, empleados, razon_descarte, tocado, conversacion, reunion,
//     llamado, numero_vivo, numero_invalido }
// Calidad de los números: de los leads LLAMADOS, cuántos dieron señal de vida (contestó alguien:
// la persona, recepción o buzón) y cuántos resultaron malos (el operador dice que el número no
// existe, o Angie los descartó por datos malos, sin que nunca contestaran). El resto son mudos:
// timbran y nadie contesta.
function perfilar(filas, config) {
  const r = reglas(config);
  const p = {
    total: filas.length, tocados: 0, conversaciones: 0, reuniones: 0, descartados: 0,
    cargo: { decisor_th: 0, seleccion: 0, otro_th: 0, fuera: 0, sin_cargo: 0 },
    telefono: { celular: 0, fijo: 0, otro_pais: 0, sin_telefono: 0 },
    tamano: { pequena: 0, rango: 0, grande: 0, sin_dato: 0 },
    numeros: { llamados: 0, vivos: 0, malos: 0, mudos: 0 },
    descartes: {},
  };
  for (const f of filas) {
    if (f.tocado) p.tocados++;
    if (f.conversacion) p.conversaciones++;
    if (f.reunion) p.reuniones++;
    if (f.llamado) {
      p.numeros.llamados++;
      if (f.numero_vivo) p.numeros.vivos++;
      else if (f.numero_invalido || f.razon_descarte === 'datos_malos') p.numeros.malos++;
      else p.numeros.mudos++;
    }
    p.cargo[perfilCargo(f.cargo, r)]++;
    p.telefono[tipoTelefono(f.telefono)]++;
    p.tamano[tamanoEmpresa(f.empleados, r.tamano)]++;
    if (f.razon_descarte) { p.descartados++; p.descartes[f.razon_descarte] = (p.descartes[f.razon_descarte] || 0) + 1; }
  }
  p.tasa_numeros_vivos = pct(p.numeros.vivos, p.numeros.llamados);
  p.tasa_numeros_malos = pct(p.numeros.malos, p.numeros.llamados);
  p.tasa_conversacion = pct(p.conversaciones, p.tocados);
  p.tasa_reunion = pct(p.reuniones, p.tocados);
  p.reunion_por_conversacion = pct(p.reuniones, p.conversaciones);
  return p;
}

// Nota (buena / regular / floja / pronto) y las razones, con signo: '+' lo que ayuda, '-' lo que
// estorba, '·' dato sin juicio. `promedio` (tasas de todas las listas) sirve de ancla en el texto.
function calificar(perfil, config, { promedio = null } = {}) {
  const r = reglas(config);
  const p = perfil;
  const razones = [];
  const add = (signo, texto) => razones.push({ signo, texto });

  // --- Resultado ---
  let nota;
  if (p.tocados < r.minimoTocados) nota = 'pronto';
  else if (p.tasa_reunion >= r.reunion.buena || (p.tasa_reunion >= r.reunion.regular && p.tasa_conversacion >= r.conversacion.buena)) nota = 'buena';
  else if (p.tasa_reunion >= r.reunion.regular || p.tasa_conversacion >= r.conversacion.regular) nota = 'regular';
  else nota = 'floja';

  const vs = (x, prom) => (promedio && prom != null && promedio.tocados >= r.minimoTocados ? ` (todas las listas: ${porc(prom)})` : '');
  if (p.tocados) {
    add(p.tasa_reunion >= r.reunion.buena ? '+' : p.tasa_reunion >= r.reunion.regular ? '·' : '-',
      `${p.reuniones} ${p.reuniones === 1 ? 'reunión' : 'reuniones'} de ${p.tocados} tocados: ${porc(p.tasa_reunion)}${vs(p.tasa_reunion, promedio && promedio.tasa_reunion)}`);
    add(p.tasa_conversacion >= r.conversacion.buena ? '+' : p.tasa_conversacion >= r.conversacion.regular ? '·' : '-',
      `${p.conversaciones} ${p.conversaciones === 1 ? 'conversación' : 'conversaciones'}: ${porc(p.tasa_conversacion)} de los tocados${vs(p.tasa_conversacion, promedio && promedio.tasa_conversacion)}`);
    if (p.conversaciones >= 5) {
      const rc = p.reunion_por_conversacion;
      add(rc >= 0.4 ? '+' : rc >= 0.2 ? '·' : '-', `De los que conversan, agenda ${rc >= 0.5 ? 'la mitad o más' : `1 de cada ${Math.max(2, Math.round(1 / Math.max(rc, 0.01)))}`}${rc < 0.2 ? ': se llega al teléfono pero no convence (¿no es quien decide? ¿sin necesidad?)' : ''}`);
    }
  }

  // --- Composición: lo que la lista traía ---
  const n = p.total || 1;
  const th = (p.cargo.decisor_th + p.cargo.seleccion + p.cargo.otro_th) / n;
  const mando = p.cargo.decisor_th / n;
  if (p.cargo.sin_cargo / n > r.sinCargoMax) add('-', `${porc(p.cargo.sin_cargo / n)} sin cargo: no se sabe a quién se llama`);
  if (th >= r.perfilThMin) add('+', `${porc(th)} con cargo de talento humano o selección (${porc(mando)} con mando: jefes, gerentes, directores)`);
  else if (p.cargo.fuera / n >= 0.3) add('-', `${porc(p.cargo.fuera / n)} con cargo fuera de TH (tecnología, comercial, gerencia general…): no es quien contrata reclutamiento`);
  else if (p.total && th > 0) add('·', `${porc(th)} con cargo de TH o selección, ${porc(mando)} con mando`);
  if (p.cargo.seleccion / n >= 0.5) add('·', `${porc(p.cargo.seleccion / n)} son reclutadores: conversan, pero la reunión suele necesitar a su jefe (son el champion, no el decisor)`);

  const cel = p.telefono.celular / n;
  if (p.telefono.sin_telefono / n >= 0.2) add('-', `${porc(p.telefono.sin_telefono / n)} sin teléfono: solo sirven para correo`);
  if (cel >= r.celularesMin) add('+', `${porc(cel)} celulares: se llega directo a la persona`);
  else if (p.telefono.fijo / n >= 0.4) add('-', `${porc(p.telefono.fijo / n)} fijos y solo ${porc(cel)} celulares: conmutador y recepción en el medio`);

  const conDato = p.total - p.tamano.sin_dato;
  if (conDato / n >= 0.5) {
    const enRango = p.tamano.rango / conDato;
    if (enRango >= 0.6) add('+', `${porc(enRango)} de las empresas con dato tienen entre ${r.tamano[0]} y ${r.tamano[1]} empleados (el rango que mejor agenda)`);
    else if (p.tamano.grande / conDato >= 0.4) add('-', `${porc(p.tamano.grande / conDato)} de las empresas tienen más de ${r.tamano[1]} empleados: corporativo, decisión lenta`);
    else if (p.tamano.pequena / conDato >= 0.4) add('·', `${porc(p.tamano.pequena / conDato)} de las empresas tienen menos de ${r.tamano[0]} empleados: deciden rápido, contratan poco`);
  } else if (p.total) add('·', `Sin dato de tamaño de empresa en ${porc(p.tamano.sin_dato / n)}: no se puede saber a quién le vendemos`);

  // --- Números: ¿sirven? ---
  const nn = p.numeros;
  if (nn.llamados >= r.minimoLlamados) {
    if (p.tasa_numeros_malos > r.numerosMalosMax) add('-', `${porc(p.tasa_numeros_malos)} de los números llamados no existen o no son de la persona (${nn.malos} de ${nn.llamados}): la base está vieja o mal tomada`);
    if (p.tasa_numeros_vivos >= r.numerosVivosMin) add('+', `${porc(p.tasa_numeros_vivos)} de los números llamados contestan (la persona, recepción o buzón): la base es real`);
    else if (p.tasa_numeros_vivos < r.numerosVivosMin * 0.67) add('-', `Solo ${porc(p.tasa_numeros_vivos)} de los números llamados dan señal de vida; ${nn.mudos} timbran y nadie contesta${p.tasa_numeros_malos > r.numerosMalosMax ? '' : ' (si pasa en todas las listas a la vez, es la telefonía, no la lista)'}`);
    else add('·', `${porc(p.tasa_numeros_vivos)} de los números llamados contestan`);
  }

  // --- Descartes: por qué se murieron ---
  const desc = Object.entries(p.descartes).filter(([k]) => !D.RAZONES_AUTOMATICAS.includes(k)).sort((a, b) => b[1] - a[1]);
  if (p.tocados && p.descartados / p.tocados >= 0.4) add('-', `${porc(p.descartados / p.tocados)} de los tocados ya descartados`);
  for (const [razon, k] of desc.slice(0, 2)) {
    if (k >= 3 && k / Math.max(p.tocados, 1) >= 0.1) add('-', `${k} descartados por "${D.RAZON_LABEL[razon] || razon}"${razon === 'no_es_decisor' ? ': la lista trae al cargo equivocado' : razon === 'ya_tiene_proveedor' || razon === 'no_interesa' ? '' : razon === 'datos_malos' ? ': teléfonos que no existen o no son de la persona' : ''}`);
  }

  const resumen = resumir(nota, p, r);
  return { nota, etiqueta: ETIQUETA[nota], resumen, razones, tasa_conversacion: p.tasa_conversacion, tasa_reunion: p.tasa_reunion, tocados: p.tocados, conversaciones: p.conversaciones, reuniones: p.reuniones, minimo_tocados: r.minimoTocados };
}

const ETIQUETA = { buena: 'Buena', regular: 'Regular', floja: 'Floja', pronto: 'Muy pronto' };

function resumir(nota, p, r) {
  if (nota === 'pronto') return `Con ${p.tocados} tocados todavía no se puede calificar (mínimo ${r.minimoTocados}).`;
  const n = p.total || 1;
  const th = (p.cargo.decisor_th + p.cargo.seleccion + p.cargo.otro_th) / n;
  const cel = p.telefono.celular / n;
  const nums = p.numeros.llamados >= r.minimoLlamados;
  const tiene = [th >= r.perfilThMin && 'cargo de TH', cel >= r.celularesMin && 'celulares', nums && p.tasa_numeros_vivos >= r.numerosVivosMin && 'números que contestan', (p.total - p.tamano.sin_dato) / n >= 0.5 && 'datos de empresa'].filter(Boolean);
  const falla = [p.cargo.sin_cargo / n > r.sinCargoMax && 'sin cargo', p.cargo.fuera / n >= 0.3 && 'cargos fuera de TH', cel < r.celularesMin && p.telefono.fijo / n >= 0.4 && 'fijos', nums && p.tasa_numeros_malos > r.numerosMalosMax && 'números malos', (p.descartes.no_es_decisor || 0) >= 3 && 'no es el decisor'].filter(Boolean);
  if (nota === 'buena') return `Rinde: ${porc(p.tasa_reunion)} de reunión por tocado. ${tiene.length ? `Lo que trae y hay que repetir: ${tiene.join(', ')}.` : 'Vale la pena pedir otra igual.'}`;
  if (nota === 'floja') return `No rinde: ${porc(p.tasa_reunion)} de reunión y ${porc(p.tasa_conversacion)} de conversación por tocado. ${falla.length ? `Lo que falla: ${falla.join(', ')}.` : 'Revisar de dónde salió antes de cargar otra igual.'}`;
  return `A medias: ${porc(p.tasa_reunion)} de reunión por tocado.${tiene.length ? ` Tiene ${tiene.join(' y ')}` : ''}${falla.length ? `${tiene.length ? ', pero' : ' Le'} ${tiene.length ? 'le ' : ''}pesa: ${falla.join(', ')}.` : tiene.length ? '.' : ''}`;
}

// Tasas globales (ancla) a partir de los perfiles de varias listas.
function promedioDe(perfiles) {
  const t = perfiles.reduce((a, p) => ({ tocados: a.tocados + p.tocados, conversaciones: a.conversaciones + p.conversaciones, reuniones: a.reuniones + p.reuniones }), { tocados: 0, conversaciones: 0, reuniones: 0 });
  return { ...t, tasa_conversacion: pct(t.conversaciones, t.tocados), tasa_reunion: pct(t.reuniones, t.tocados) };
}

module.exports = { reglas, perfilCargo, tipoTelefono, tamanoEmpresa, perfilar, calificar, promedioDe, ETIQUETA };

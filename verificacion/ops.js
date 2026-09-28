// Operaciones: Procesos completos, SaaS y Evaluaciones.
//
// Reemplaza las tres tablas de Airtable (base "Ops") que Weimar llenaba a mano. Se importaron
// una sola vez (datos/ops_airtable_2026-09-25.json) y desde ahí se llenan aquí. Lo que en
// Airtable eran fórmulas (días, salud, % de aprobación) se calcula aquí y no se guarda: así no
// se desactualiza ni se rompe cuando alguien borra una columna, que es justo lo que le pasó al
// "% de aprobación" de Evaluaciones.
//
// Este módulo lo usan el servidor (con Postgres) y el stub de pruebas (en memoria), con las
// mismas reglas: validación, lo que se llena solo y lo que se calcula.
const fs = require('fs');
const path = require('path');

const clean = s => (s == null ? '' : String(s)).trim();

// ---------------------------------------------------------------------------------------
// Opciones (las mismas de Airtable, con la ortografía corregida donde hacía falta)
// ---------------------------------------------------------------------------------------
const ETAPAS = ['Reclutamiento', 'Terna enviada', 'Facturación', 'Contratado', 'Pausado', 'Cancelado'];
const ETAPAS_ABIERTAS = ['Reclutamiento', 'Terna enviada', 'Facturación'];
const ETAPAS_CON_SALUD = ['Reclutamiento', 'Terna enviada'];
const ETAPAS_CIERRE = ['Contratado', 'Pausado', 'Cancelado'];
const TIERS = ['Alto', 'Nuevo · en prueba', 'Mediano', 'Bajo'];
const PRESUPUESTO = ['Sí, aprobado', 'En proceso de aprobación', 'No / No sabemos'];
const EXCLUSIVIDAD = ['Exclusiva', 'Compitiendo (otros headhunters o interno)', 'No sabemos'];
const CAUSAS = [
  'Externa pura · Cargo eliminado / reestructuración',
  'Externa pura · Presupuesto congelado (macro / cliente)',
  'Externa evitable · Cliente contrató por su cuenta',
  'Externa evitable · Contrató con otro headhunter',
  'Externa evitable · Cargo nunca estuvo aprobado (intake débil)',
  'Externa evitable · Expectativa salarial irreal no detectada',
  'Externa evitable · Cliente dejó de responder (ghosting)',
  'Interna · No logramos terna adecuada',
  'Interna · Candidatos rechazados por calidad',
  'Interna · Candidato(s) rechazaron la oferta',
  'Interna · Proceso lento, perdimos candidatos o al cliente',
  'Sin información · Ghosting sin causa conocida',
];
const SAAS_ESTADOS = ['Activa', 'Pausada', 'Terminada', 'Inactiva'];
const EVAL_ESTADOS = ['En evaluación', 'Resultados entregados', 'Terminado'];

// ---------------------------------------------------------------------------------------
// Columnas. t: texto | largo | num | fecha | sel | bool | estrellas | url.
// `ayuda` es lo que ve Weimar al pasar el mouse por el encabezado: el criterio para llenarla.
// `calc` son las que se calculan; no se editan.
// ---------------------------------------------------------------------------------------
const ESPECS = {
  procesos: {
    titulo: 'Procesos completos', singular: 'proceso', tabla: 'ops_procesos',
    abiertos: 'En curso', cerrados: 'Cerrados',
    campos: [
      { k: 'empresa', l: 'Empresa', t: 'texto', req: true, fijo: true },
      { k: 'cargo', l: 'Cargo', t: 'texto', req: true },
      { k: 'peaku_id', l: 'ID vacante', t: 'texto', ancho: 'id', ayuda: 'El número de la vacante en PeakU.' },
      { k: 'activado', l: 'Activación', t: 'fecha' },
      { k: 'primer_envio', l: 'Primer envío', t: 'fecha',
        ayuda: 'El día en que salió el primer candidato. Se pone solo la primera vez que se llena "Último envío". La promesa: el primero en 2 días hábiles desde la activación.' },
      { k: 'etapa', l: 'Etapa', t: 'sel', op: ETAPAS, req: true,
        ayuda: 'Al pasar a Contratado, Pausado o Cancelado se pone sola la fecha de cierre. Al pasar a Terna enviada, si no hay fecha de terna, se pone la de hoy.' },
      { k: 'faltan_terna', l: 'Faltan para la terna', t: 'num', ancho: 'xs', max: 10, ayuda: 'Cuántos candidatos faltan por enviar para completar la terna.' },
      { k: 'ultimo_envio', l: 'Último envío de candidatos', t: 'fecha' },
      { k: 'ultima_terna', l: 'Última terna enviada', t: 'fecha' },
      { k: 'garantia', l: 'Garantía', t: 'bool', ayuda: 'Es una reposición por garantía.' },
      { k: 'anticipo', l: 'Con anticipo', t: 'bool' },
      { k: 'tier', l: 'Tier del cliente', t: 'sel', op: TIERS,
        ayuda: 'Es la prioridad del reclutador y es de la EMPRESA: al cambiarlo aquí cambia en todos sus procesos. Alto y Nuevo = esfuerzo completo; Mediano = estándar; Bajo = reactivo.' },
      { k: 'presupuesto', l: 'Presupuesto aprobado', t: 'sel', op: PRESUPUESTO, ayuda: 'Llenar al activar el proceso. Predictor clave de cancelación.' },
      { k: 'exclusividad', l: 'Exclusividad', t: 'sel', op: EXCLUSIVIDAD, ayuda: 'Llenar al activar. ¿Somos los únicos buscando o competimos?' },
      { k: 'causa_cierre', l: 'Causa de cierre', t: 'sel', op: CAUSAS, ancho: 'xl',
        ayuda: 'Llenar SOLO cuando el proceso se cancela, se pausa largo o el contratado no se concreta.' },
      { k: 'fecha_cierre', l: 'Fecha de cierre', t: 'fecha' },
      { k: 'satisfaccion', l: 'Satisfacción del cliente', t: 'estrellas',
        ayuda: 'Al cerrar (con o sin contratación), pregúntale al cliente de 1 a 5. Si no se le preguntó, déjala vacía: una estrella puesta por defecto no mide nada.' },
      { k: 'notas', l: 'Notas', t: 'largo', ancho: 'xl' },
    ],
    calc: [
      { k: 'salud', l: 'Salud', t: 'salud', ayuda: 'Solo en Reclutamiento y Terna enviada. Verde: se movió hace 2 días o menos; amarilla: 3 a 5; roja: más de 5.' },
      { k: 'dias_sin_movimiento', l: 'Días sin movimiento', t: 'num', ayuda: 'Desde el último cambio de etapa, envío, faltantes, garantía o notas.' },
      { k: 'primer_envio_habiles', l: 'Días hábiles al primer envío', t: 'num', ayuda: 'De la activación al primer candidato, sin contar sábados ni domingos. 2 o menos cumple la promesa.' },
      { k: 'dias_sin_envio', l: 'Días sin enviar candidatos', t: 'num' },
      { k: 'duracion', l: 'Duración (días)', t: 'num', ayuda: 'De la activación al cierre; si sigue abierto, hasta hoy.' },
      { k: 'responsabilidad', l: 'Responsabilidad', t: 'texto', ayuda: 'Sale de la causa de cierre.' },
    ],
    buscar: ['empresa', 'cargo', 'peaku_id', 'notas'],
    nuevo: ['empresa', 'cargo', 'peaku_id', 'activado', 'etapa', 'tier', 'anticipo'],
    defecto: { etapa: 'Reclutamiento', activado: 'hoy' },
  },
  saas: {
    titulo: 'SaaS', singular: 'vacante SaaS', tabla: 'ops_saas',
    abiertos: 'Activas', cerrados: 'No activas',
    campos: [
      { k: 'cliente', l: 'Cliente', t: 'texto', req: true, fijo: true },
      { k: 'cargo', l: 'Cargo', t: 'texto' },
      { k: 'peaku_id', l: 'ID vacante', t: 'texto', ancho: 'id', req: true, ayuda: 'El número de la vacante en PeakU; arma el enlace.' },
      { k: 'activado', l: 'Publicada', t: 'fecha' },
      { k: 'estado', l: 'Estado', t: 'sel', op: SAAS_ESTADOS, req: true },
      { k: 'meta', l: 'Meta de destacados', t: 'num', ancho: 'xs', max: 1000 },
      { k: 'destacados', l: 'Destacados', t: 'num', ancho: 'xs', ayuda: 'Los de hoy. La meta se cumple con destacados, sin contar descartados.' },
      { k: 'descartados', l: 'Descartados', t: 'num', ancho: 'xs' },
      { k: 'aplicantes', l: 'Aplicantes totales', t: 'num', ancho: 'xs', ayuda: 'Aplicantes + destacados + descartados.' },
      { k: 'primer_destacado', l: 'Primer destacado', t: 'fecha', ayuda: 'Se pone sola el día en que aparece el primer destacado. La promesa: candidatos en 2 días hábiles.' },
      { k: 'meta_at', l: 'Meta cumplida el', t: 'fecha', ayuda: 'Se pone sola el día en que los destacados llegan a la meta.' },
      { k: 'notas', l: 'Notas', t: 'largo', ancho: 'xl' },
    ],
    calc: [
      { k: 'salud', l: 'Salud', t: 'salud', ayuda: 'Solo en activas. Verde: meta cumplida. Roja: más de 10 días publicada sin cumplir, o 2+ días sin actualizar. Amarilla: el resto.' },
      { k: 'faltan', l: 'Faltan destacados', t: 'num' },
      { k: 'dias_sin_actualizar', l: 'Días sin actualizar', t: 'num', ayuda: 'Desde la última vez que se tocaron los números (o se marcó "Sin cambios").' },
      { k: 'dias_publicada', l: 'Días publicada', t: 'num' },
      { k: 'dias_para_meta', l: 'Días hábiles hasta la meta', t: 'num', ayuda: 'De la publicación a la meta, sin contar sábados ni domingos.' },
      { k: 'pct_descartados', l: '% descartados', t: 'pct', ayuda: 'Descartados sobre aplicantes totales.' },
    ],
    buscar: ['cliente', 'cargo', 'peaku_id', 'notas'],
    nuevo: ['cliente', 'cargo', 'peaku_id', 'activado', 'meta', 'estado'],
    defecto: { estado: 'Activa', meta: 10, activado: 'hoy' },
  },
  evaluaciones: {
    titulo: 'Evaluaciones', singular: 'evaluación', tabla: 'ops_evaluaciones',
    abiertos: 'En curso', cerrados: 'Terminadas',
    campos: [
      { k: 'empresa', l: 'Empresa', t: 'texto', req: true, fijo: true },
      { k: 'cargo', l: 'Cargo o prueba', t: 'texto', req: true },
      { k: 'peaku_id', l: 'ID vacante', t: 'texto', ancho: 'id' },
      { k: 'activado', l: 'Activación', t: 'fecha' },
      { k: 'estado', l: 'Estado', t: 'sel', op: EVAL_ESTADOS, req: true },
      { k: 'evaluados', l: 'Evaluados', t: 'num', ancho: 'xs', max: 100000 },
      { k: 'aprobados', l: 'Aprobados', t: 'num', ancho: 'xs', max: 100000, ayuda: 'Cuántos de los evaluados aprobaron. Sin esto no hay % de aprobación.' },
      { k: 'satisfaccion', l: 'Satisfacción del cliente', t: 'estrellas' },
      { k: 'link', l: 'Link a la evaluación', t: 'url', ancho: 'l' },
      { k: 'notas', l: 'Notas internas', t: 'largo', ancho: 'xl' },
    ],
    calc: [
      { k: 'pct_aprobacion', l: '% aprobación', t: 'pct' },
      { k: 'dias_en_proceso', l: 'Días en proceso', t: 'num' },
    ],
    buscar: ['empresa', 'cargo', 'peaku_id', 'notas'],
    nuevo: ['empresa', 'cargo', 'peaku_id', 'activado', 'estado', 'evaluados'],
    defecto: { estado: 'En evaluación', activado: 'hoy' },
  },
};
const TIPOS = Object.keys(ESPECS);

// Tipo SQL de cada tipo de columna.
const SQL_T = { texto: 'TEXT', largo: 'TEXT', num: 'INTEGER', fecha: 'DATE', sel: 'TEXT', bool: 'BOOLEAN DEFAULT FALSE', estrellas: 'SMALLINT', url: 'TEXT' };
// Marcas de tiempo propias de cada tabla (además de created_at / updated_at).
const MARCAS = { procesos: ['movido_at'], saas: ['actualizado_at'], evaluaciones: [] };
// Qué cambios cuentan como "movimiento" (días sin movimiento) y como "actualización" en SaaS.
const MUEVE = { procesos: ['etapa', 'primer_envio', 'ultimo_envio', 'ultima_terna', 'faltan_terna', 'garantia', 'notas'], saas: ['aplicantes', 'destacados', 'descartados', 'meta', 'estado'] };

// ---------------------------------------------------------------------------------------
// Fechas (hora de Colombia, UTC-5)
// ---------------------------------------------------------------------------------------
const DIA = 86400000;
const hoyCo = (ahora = Date.now()) => new Date(new Date(ahora).getTime() - 5 * 3600000).toISOString().slice(0, 10);
function aFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) {
    if (isNaN(v)) return null;
    return `${v.getFullYear()}-${String(v.getMonth() + 1).padStart(2, '0')}-${String(v.getDate()).padStart(2, '0')}`;
  }
  const s = String(v).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}
const aIso = v => { if (v == null || v === '') return null; const d = new Date(v); return isNaN(d) ? null : d.toISOString(); };
const diasEntre = (desde, hasta) => (desde && hasta ? Math.round((Date.parse(hasta + 'T12:00:00Z') - Date.parse(desde + 'T12:00:00Z')) / DIA) : null);
const fechaValida = s => /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + 'T12:00:00Z')) && new Date(s + 'T12:00:00Z').toISOString().slice(0, 10) === s;

// Días hábiles (lunes a viernes; los festivos no se descuentan). habilesEntre cuenta los días
// hábiles después de `desde` hasta `hasta` inclusive: activado el viernes y enviado el martes = 2.
const diaSemana = f => new Date(f + 'T12:00:00Z').getUTCDay();
const masDias = (f, n) => { const d = new Date(f + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
function habilesEntre(desde, hasta) {
  if (!desde || !hasta) return null;
  if (hasta <= desde) return 0;
  let n = 0;
  for (let d = masDias(desde, 1), g = 0; d <= hasta && g < 4000; d = masDias(d, 1), g++) { const w = diaSemana(d); if (w !== 0 && w !== 6) n++; }
  return n;
}
function sumarHabiles(desde, n) {
  let d = desde, k = 0;
  while (k < n) { d = masDias(d, 1); const w = diaSemana(d); if (w !== 0 && w !== 6) k++; }
  return d;
}
const PROMESA_HABILES = 2;

// Fechas que no pueden ser anteriores a la activación ni estar en el futuro (son hechos).
const FECHAS_HECHO = { procesos: ['primer_envio', 'ultimo_envio', 'ultima_terna', 'fecha_cierre'], saas: ['primer_destacado', 'meta_at'], evaluaciones: [] };
const ANIO_MIN = 2015;
function fechasMal(tipo, f, hoy) {
  const mal = [];
  const tope = masDias(hoy, 366);
  const todas = ESPECS[tipo].campos.filter(c => c.t === 'fecha').map(c => c.k);
  for (const k of todas) {
    const v = f[k]; if (!v) continue;
    if (v < `${ANIO_MIN}-01-01` || v > tope) { mal.push(k); continue; }
    if (k === 'activado' && v > hoy) { mal.push(k); continue; }   // la activación ya pasó (hay filas de Airtable con 2027)
    if (FECHAS_HECHO[tipo].includes(k)) {
      if (v > hoy) mal.push(k);
      else if (f.activado && v < f.activado) mal.push(k);
    }
  }
  if (tipo === 'procesos' && f.primer_envio && f.ultimo_envio && f.ultimo_envio < f.primer_envio && !mal.includes('primer_envio')) mal.push('primer_envio');
  return mal;
}
const LEYENDA_FECHA = { fuera: 'Revisa el año: la fecha está fuera de rango.', futuro: 'Es un hecho y la fecha está en el futuro.', antes: 'Es anterior a la activación.' };

// ---------------------------------------------------------------------------------------
// Lo calculado (antes, fórmulas de Airtable)
// ---------------------------------------------------------------------------------------
function responsabilidad(causa) {
  const c = clean(causa);
  if (!c) return null;
  if (c.startsWith('Externa pura')) return 'Externa pura';
  if (c.startsWith('Externa evitable')) return 'Externa evitable';
  if (c.startsWith('Sin información')) return 'Sin información';
  return 'Interna';
}

function calcular(tipo, fila, ahora = Date.now()) {
  const hoy = hoyCo(ahora);
  const f = { ...fila };
  const diasDesdeTs = ts => (ts ? Math.max(0, diasEntre(hoyCo(Date.parse(ts)), hoy)) : null);
  if (tipo === 'procesos') {
    f.abierto = ETAPAS_ABIERTAS.includes(f.etapa);
    f.dias_sin_movimiento = diasDesdeTs(f.movido_at || f.updated_at || f.created_at);
    f.dias_sin_envio = f.abierto && f.ultimo_envio ? Math.max(0, diasEntre(f.ultimo_envio, hoy)) : null;
    f.duracion = f.activado ? Math.max(0, diasEntre(f.activado, f.fecha_cierre || hoy)) : null;
    f.responsabilidad = responsabilidad(f.causa_cierre);
    f.salud = !ETAPAS_CON_SALUD.includes(f.etapa) ? null
      : f.dias_sin_movimiento > 5 ? 'roja' : f.dias_sin_movimiento > 2 ? 'amarilla' : 'verde';
    f.falta_causa = ['Cancelado', 'Pausado'].includes(f.etapa) && !f.causa_cierre;
    f.fechas_mal = fechasMal('procesos', f, hoy);
    const ok = k => f[k] && !f.fechas_mal.includes(k) ? f[k] : null;
    // La promesa de 48 h: primer candidato en 2 días hábiles desde la activación.
    f.primer_envio_habiles = ok('activado') && ok('primer_envio') ? habilesEntre(f.activado, f.primer_envio) : null;
    f.cumple_48 = f.primer_envio_habiles == null ? null : f.primer_envio_habiles <= PROMESA_HABILES;
    // Sin ningún envío todavía: cuándo vence y si ya venció. (Con "último envío" pero sin
    // "primer envío" —filas importadas de Airtable— no se sabe: ni cumple ni incumple.)
    const sinEnvio = f.abierto && !f.primer_envio && !f.ultimo_envio && ok('activado');
    f.vence_48 = sinEnvio ? sumarHabiles(f.activado, PROMESA_HABILES) : null;
    f.atrasado_48 = sinEnvio ? hoy > f.vence_48 : false;
  } else if (tipo === 'saas') {
    f.abierto = f.estado === 'Activa';
    const meta = Number(f.meta) || 0, dest = Number(f.destacados) || 0;
    f.meta_cumplida = meta > 0 && dest >= meta;
    f.faltan = meta ? Math.max(0, meta - dest) : null;
    f.dias_publicada = f.activado ? Math.max(0, diasEntre(f.activado, hoy)) : null;
    f.fechas_mal = fechasMal('saas', f, hoy);
    const okS = k => f[k] && !f.fechas_mal.includes(k) ? f[k] : null;
    f.dias_para_meta = okS('activado') && okS('meta_at') ? habilesEntre(f.activado, f.meta_at) : null;
    f.primer_destacado_habiles = okS('activado') && okS('primer_destacado') ? habilesEntre(f.activado, f.primer_destacado) : null;
    f.pct_descartados = Number(f.aplicantes) > 0 && f.descartados != null ? Math.round(100 * Number(f.descartados) / Number(f.aplicantes)) : null;
    f.dias_sin_actualizar = diasDesdeTs(f.actualizado_at || f.updated_at || f.created_at);
    f.salud = !f.abierto ? null
      : f.meta_cumplida ? 'verde'
      : ((f.dias_publicada || 0) > 10 || (f.dias_sin_actualizar || 0) >= 2) ? 'roja' : 'amarilla';
  } else if (tipo === 'evaluaciones') {
    f.abierto = f.estado !== 'Terminado';
    const ev = Number(f.evaluados) || 0;
    f.pct_aprobacion = ev > 0 && f.aprobados != null ? Math.round(1000 * Number(f.aprobados) / ev) / 10 : null;
    f.dias_en_proceso = f.abierto && f.activado ? Math.max(0, diasEntre(f.activado, hoy)) : null;
    // Sin salud: que aprueben pocos es el resultado para el cliente, no un riesgo de la
    // operación, y una evaluación dura lo que el cliente siga mandando candidatos.
    f.salud = null;
    f.fechas_mal = fechasMal('evaluaciones', f, hoy);
  }
  return f;
}

// ---------------------------------------------------------------------------------------
// Validación: lo que llega del navegador se convierte al tipo de la columna o se rechaza con
// un mensaje que dice qué corregir.
// ---------------------------------------------------------------------------------------
function normalizar(tipo, cuerpo, { nuevo = false } = {}) {
  const esp = ESPECS[tipo];
  const cambios = {}, errores = [];
  for (const c of esp.campos) {
    if (!(c.k in (cuerpo || {}))) continue;
    let v = cuerpo[c.k];
    if (c.t === 'bool') { cambios[c.k] = v === true || v === 'true' || v === 1 || v === '1' || v === 'on'; continue; }
    v = clean(v);
    if (v === '') {
      if (c.req) errores.push(`${c.l} no puede quedar vacío.`);
      else cambios[c.k] = null;
      continue;
    }
    if (c.t === 'texto' || c.t === 'largo') {
      cambios[c.k] = v.slice(0, c.t === 'largo' ? 4000 : 300);
    } else if (c.t === 'num') {
      const n = Number(v.replace(',', '.'));
      if (!Number.isFinite(n) || n < 0 || Math.round(n) !== n) errores.push(`${c.l} tiene que ser un número entero, 0 o más.`);
      else if (n > (c.max || 100000)) errores.push(`${c.l} no puede pasar de ${c.max || 100000}.`);
      else cambios[c.k] = n;
    } else if (c.t === 'fecha') {
      if (!fechaValida(v)) errores.push(`${c.l} no es una fecha válida.`);
      else if (v < `${ANIO_MIN}-01-01` || v > masDias(hoyCo(), 366)) errores.push(`${c.l}: revisa el año (${v.slice(0, 4)}).`);
      else cambios[c.k] = v;
    } else if (c.t === 'sel') {
      const op = c.op.find(o => o.toLowerCase() === v.toLowerCase());
      if (!op) errores.push(`${c.l}: “${v}” no es una opción.`);
      else cambios[c.k] = op;
    } else if (c.t === 'estrellas') {
      const n = Number(v);
      if (![1, 2, 3, 4, 5].includes(n)) errores.push(`${c.l} va de 1 a 5.`);
      else cambios[c.k] = n;
    } else if (c.t === 'url') {
      if (!/^https?:\/\/\S+$/i.test(v)) errores.push(`${c.l} tiene que empezar por http:// o https://`);
      else cambios[c.k] = v.slice(0, 1000);
    }
  }
  if (nuevo) for (const c of esp.campos) if (c.req && !(c.k in cambios)) errores.push(`Falta ${c.l.toLowerCase()}.`);
  return { cambios, errores };
}

// Lo que se llena solo al guardar, a partir de la fila como estaba y los cambios.
function reglas(tipo, antes, cambios, { ahora = Date.now(), revisado = false } = {}) {
  const hoy = hoyCo(ahora);
  const c = { ...cambios };
  const m = { ...(antes || {}), ...c };
  const cambio = k => k in c && String(c[k] ?? '') !== String((antes || {})[k] ?? '');
  if (tipo === 'procesos') {
    if (cambio('etapa')) {
      if (ETAPAS_CIERRE.includes(m.etapa) && !m.fecha_cierre && !('fecha_cierre' in cambios)) c.fecha_cierre = hoy;
      if (ETAPAS_ABIERTAS.includes(m.etapa) && antes && ETAPAS_CIERRE.includes(antes.etapa) && !('fecha_cierre' in cambios)) c.fecha_cierre = null;
      if (m.etapa === 'Terna enviada' && !m.ultima_terna && !('ultima_terna' in cambios)) c.ultima_terna = hoy;
    }
    // El primer envío se fija la primera vez que se registra un envío.
    if (cambio('ultimo_envio') && m.ultimo_envio && !m.primer_envio && !('primer_envio' in cambios)) c.primer_envio = m.ultimo_envio;
    if (cambio('primer_envio') && m.primer_envio && !m.ultimo_envio && !('ultimo_envio' in cambios)) c.ultimo_envio = m.primer_envio;
    if (!antes || MUEVE.procesos.some(cambio)) c.movido_at = new Date(ahora).toISOString();
  } else if (tipo === 'saas') {
    const meta = Number(m.meta) || 0;
    // Solo el día en que CRUZA la meta (antes no la cumplía, ahora sí). Si ya la cumplía y no
    // tiene fecha (filas importadas de Airtable sin fecha), no se inventa la de hoy.
    const cumplia = antes && Number(antes.meta) > 0 && Number(antes.destacados) >= Number(antes.meta);
    if ((cambio('destacados') || cambio('meta')) && meta > 0 && Number(m.destacados) >= meta && !cumplia && !m.meta_at && !('meta_at' in cambios)) c.meta_at = hoy;
    // El primer destacado: el día en que pasa de 0 a 1 o más.
    const tenia = antes && Number(antes.destacados) > 0;
    if (cambio('destacados') && Number(m.destacados) > 0 && !tenia && !m.primer_destacado && !('primer_destacado' in cambios)) c.primer_destacado = hoy;
    if (!antes || revisado || MUEVE.saas.some(cambio)) c.actualizado_at = new Date(ahora).toISOString();
  }
  return c;
}

// Reglas que cruzan columnas y se revisan con la fila completa.
// Las fechas solo se revisan si se están tocando: una fila importada con una fecha dañada tiene
// que poder editarse (para arreglarla, o para cambiarle otra cosa) sin quedar bloqueada.
function coherencia(tipo, fila, cambios = null, ahora = Date.now()) {
  if (tipo === 'evaluaciones' && fila.aprobados != null && fila.evaluados != null && Number(fila.aprobados) > Number(fila.evaluados))
    return 'Aprobados no puede ser mayor que evaluados.';
  const hoy = hoyCo(ahora);
  const toca = k => !cambios || k in cambios;
  const nombre = k => (ESPECS[tipo].campos.find(c => c.k === k) || {}).l || k;
  if (fila.activado && toca('activado') && fila.activado > hoy) return `${nombre('activado')} no puede estar en el futuro.`;
  for (const k of FECHAS_HECHO[tipo] || []) {
    const v = fila[k]; if (!v) continue;
    if (toca(k) && v > hoy) return `${nombre(k)} no puede estar en el futuro.`;
    if ((toca(k) || toca('activado')) && fila.activado && v < fila.activado) return `${nombre(k)} no puede ser anterior a la activación (${fila.activado}).`;
  }
  return null;
}

// Una fila tal como sale hacia el navegador: fechas como AAAA-MM-DD, marcas como ISO.
function salida(tipo, fila, ahora) {
  const esp = ESPECS[tipo];
  const f = { id: fila.id };
  for (const c of esp.campos) {
    const v = fila[c.k];
    f[c.k] = c.t === 'fecha' ? aFecha(v) : (c.t === 'bool' ? !!v : (v == null ? null : (c.t === 'num' || c.t === 'estrellas' ? Number(v) : v)));
  }
  for (const k of ['created_at', 'updated_at', ...MARCAS[tipo]]) f[k] = aIso(fila[k]);
  return calcular(tipo, f, ahora);
}

// ---------------------------------------------------------------------------------------
// Almacenamiento: Postgres si hay pool, memoria si no (desarrollo local y stub).
// ---------------------------------------------------------------------------------------
const SEMILLA = path.join(__dirname, 'datos', 'ops_airtable_2026-09-25.json');

function crearOps({ pool = null, schema = 'verificacion', semilla = true, ahora = () => Date.now() } = {}) {
  const tabla = tipo => `${schema}.${ESPECS[tipo].tabla}`;
  const mem = { procesos: [], saas: [], evaluaciones: [], seq: 1 };
  const columnas = tipo => [...ESPECS[tipo].campos.map(c => c.k), ...MARCAS[tipo], 'airtable_id', 'created_at', 'updated_at'];

  async function init() {
    if (pool) {
      await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schema}`);
      for (const tipo of TIPOS) {
        const cols = ESPECS[tipo].campos.map(c => `${c.k} ${SQL_T[c.t]}`)
          .concat(MARCAS[tipo].map(k => `${k} TIMESTAMPTZ`));
        await pool.query(`CREATE TABLE IF NOT EXISTS ${tabla(tipo)} (
          id SERIAL PRIMARY KEY, ${cols.join(', ')}, airtable_id TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
        // Columnas que se agreguen después: idempotente, como el resto del esquema.
        for (const c of ESPECS[tipo].campos)
          await pool.query(`ALTER TABLE ${tabla(tipo)} ADD COLUMN IF NOT EXISTS ${c.k} ${SQL_T[c.t]}`);
      }
    }
    if (semilla) await sembrar();
  }

  // Importa lo de Airtable solo si la tabla está vacía: la importación es de una vez, y un
  // reinicio de Render no puede volver a meter filas ni pisar lo que Weimar ya cambió.
  async function sembrar(archivo = SEMILLA) {
    let datos;
    try { datos = JSON.parse(fs.readFileSync(archivo, 'utf8')); } catch (e) { return { ok: false, motivo: 'sin archivo de semilla' }; }
    const res = {};
    for (const tipo of TIPOS) {
      const filas = datos[tipo] || [];
      if (await contar(tipo) > 0) { res[tipo] = 0; continue; }
      for (const x of filas) await insertar(tipo, x);
      res[tipo] = filas.length;
    }
    return { ok: true, importadas: res };
  }

  async function contar(tipo) {
    if (pool) { const q = await pool.query(`SELECT COUNT(*)::int AS n FROM ${tabla(tipo)}`); return q.rows[0].n; }
    return mem[tipo].length;
  }

  // Inserta una fila ya limpia (semilla o creación). Solo columnas conocidas.
  async function insertar(tipo, x) {
    const cols = columnas(tipo).filter(k => x[k] !== undefined);
    if (pool) {
      const q = await pool.query(`INSERT INTO ${tabla(tipo)} (${cols.join(',')}) VALUES (${cols.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`,
        cols.map(k => x[k]));
      return q.rows[0];
    }
    const f = { id: mem.seq++, created_at: new Date(ahora()).toISOString(), updated_at: new Date(ahora()).toISOString() };
    for (const k of cols) f[k] = x[k];
    mem[tipo].push(f);
    return f;
  }

  async function obtener(tipo, id) {
    if (pool) { const q = await pool.query(`SELECT * FROM ${tabla(tipo)} WHERE id=$1`, [id]); return q.rows[0] || null; }
    return mem[tipo].find(f => f.id === id) || null;
  }

  async function listarCrudo(tipo) {
    return pool ? (await pool.query(`SELECT * FROM ${tabla(tipo)} ORDER BY id DESC`)).rows : mem[tipo].slice().reverse();
  }
  async function listar(tipo) {
    const t = ahora();
    return (await listarCrudo(tipo)).map(f => salida(tipo, f, t));
  }

  async function crear(tipo, cuerpo) {
    const { cambios, errores } = normalizar(tipo, cuerpo, { nuevo: true });
    if (errores.length) return { error: errores.join(' ') };
    const todo = { ...reglas(tipo, null, cambios, { ahora: ahora() }) };
    // Un proceso nuevo de una empresa conocida hereda su tier: el tier es de la empresa.
    if (tipo === 'procesos' && !todo.tier && clean(todo.empresa)) {
      const misma = (await listarCrudo('procesos')).find(f => f.tier && clean(f.empresa).toLowerCase() === clean(todo.empresa).toLowerCase());
      if (misma) todo.tier = misma.tier;
    }
    const incoh = coherencia(tipo, todo, null, ahora());
    if (incoh) return { error: incoh };
    const f = await insertar(tipo, todo);
    return { fila: salida(tipo, f, ahora()) };
  }

  async function actualizar(tipo, id, cuerpo) {
    const antes = await obtener(tipo, id);
    if (!antes) return { error: 'No existe.', status: 404 };
    const antesN = salida(tipo, antes, ahora());
    const { cambios, errores } = normalizar(tipo, cuerpo);
    if (errores.length) return { error: errores.join(' ') };
    const revisado = !!(cuerpo && cuerpo.revisado);
    if (!Object.keys(cambios).length && !revisado) return { fila: antesN };
    const todo = reglas(tipo, antesN, cambios, { ahora: ahora(), revisado });
    const incoh = coherencia(tipo, { ...antesN, ...todo }, todo, ahora());
    if (incoh) return { error: incoh };
    const ks = Object.keys(todo);
    let f;
    if (pool) {
      const q = await pool.query(`UPDATE ${tabla(tipo)} SET ${ks.map((k, i) => `${k}=$${i + 1}`).join(', ')}, updated_at=NOW() WHERE id=$${ks.length + 1} RETURNING *`,
        [...ks.map(k => todo[k]), id]);
      f = q.rows[0];
    } else {
      f = antes; Object.assign(f, todo, { updated_at: new Date(ahora()).toISOString() });
    }
    // El tier es de la empresa: todos sus procesos comparten el mismo.
    let tambien = [];
    if (tipo === 'procesos' && 'tier' in cambios && clean(f.empresa)) {
      if (pool) {
        const q = await pool.query(`UPDATE ${tabla(tipo)} SET tier=$1, updated_at=NOW()
          WHERE lower(trim(empresa))=lower(trim($2)) AND id<>$3 AND tier IS DISTINCT FROM $1 RETURNING id`, [cambios.tier, f.empresa, id]);
        tambien = q.rows.map(r => r.id);
      } else {
        mem.procesos.filter(x => x.id !== id && clean(x.empresa).toLowerCase() === clean(f.empresa).toLowerCase() && x.tier !== cambios.tier)
          .forEach(x => { x.tier = cambios.tier; tambien.push(x.id); });
      }
    }
    return { fila: salida(tipo, f, ahora()), tambien };
  }

  async function borrar(tipo, id) {
    if (pool) { const q = await pool.query(`DELETE FROM ${tabla(tipo)} WHERE id=$1 RETURNING id`, [id]); return q.rows.length > 0; }
    const i = mem[tipo].findIndex(f => f.id === id);
    if (i === -1) return false;
    mem[tipo].splice(i, 1);
    return true;
  }

  return { init, sembrar, listar, crear, actualizar, borrar, contar };
}

// ---------------------------------------------------------------------------------------
// INDICADORES DE OPERACIÓN (headhunting y SaaS), por semana de lunes a domingo (Colombia).
//
// Tres focos, en el orden en que pesan para que un cliente vuelva (literatura del sector y
// nuestros propios datos: de 12 empresas en las que se contrató, 9 abrieron otro proceso):
//   · CALIDAD de los candidatos. En headhunting, de los enviados (informes emitidos en la
//     consola), cuántos quiso entrevistar el cliente y cuántos contrató; más el resultado de
//     los procesos (contratados / resueltos), las reposiciones por garantía y las pérdidas por
//     causa interna. En SaaS, el % de vacantes que alcanza la meta de destacados.
//   · CLIENTE: recurrencia, tier de lo que está abierto, pérdidas externas evitables.
//   · VELOCIDAD: la promesa de 48 h, contada en días hábiles (activado el viernes, cumple si
//     el primero sale a más tardar el martes).
// Las tasas van sobre ventanas móviles (90 días; la de 48 h, 28) porque una semana sola tiene
// muy pocos casos; lo de la semana son conteos, comparados con la anterior.
// ---------------------------------------------------------------------------------------
const R = require('./rules');
// Desde cuándo se mide lo que depende de datos que antes no se anotaban (los enviados y qué dijo
// el cliente, el primer envío, el primer destacado, la satisfacción al cerrar). Antes de esta
// fecha esa información no existía o está incompleta, y medirla daría números falsos. Lo que sí
// se llevaba en Airtable (procesos, cierres, tier, metas de SaaS) conserva su historia.
const MEDICION_DESDE = process.env.OPS_MEDICION_DESDE || '2026-09-28';
const ENTREVISTADO = ['Lo entrevistó', 'Lo contrató'];
const CON_RESPUESTA = ['Lo entrevistó', 'Lo contrató', 'No lo entrevistó'];
const lunesDeF = f => masDias(f, -((diaSemana(f) + 6) % 7));
const medianaN = xs => { if (!xs.length) return null; const a = xs.slice().sort((x, y) => x - y), m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
const tasaN = (num, den) => ({ num, den, pct: den ? Math.round(100 * num / den) : null });

function indicadoresOps(procesos, saas, sesiones, { fecha = null, ahora = Date.now(), evaluador = '', desde = MEDICION_DESDE } = {}) {
  const hoy = hoyCo(ahora);
  const lunes = lunesDeF(fechaValida(String(fecha || '')) && fecha <= hoy ? fecha : hoy);
  const domingo = masDias(lunes, 6);
  const corte = domingo < hoy ? domingo : hoy;
  const en = (d, a, b) => !!d && d >= a && d <= b;
  const ult = n => [masDias(corte, -(n - 1)), corte];
  // Ventana recortada al inicio de la medición (para lo que antes no se anotaba).
  const med = ([a, b]) => [a < desde ? desde : a, b];
  const medido = (a, b) => b >= desde;          // ¿la semana [a, b] ya se mide?
  const P = Array.isArray(procesos) ? procesos : [], S = Array.isArray(saas) ? saas : [];
  const filtro = R.claveEvaluador(evaluador);
  const V = (Array.isArray(sesiones) ? sesiones : []).filter(s => !filtro || R.claveEvaluador(s.evaluator) === filtro);
  const ok = (f, k) => (f[k] && !(f.fechas_mal || []).includes(k) ? f[k] : null);
  const dia = ts => (ts ? R.diaLocal(ts) : null);

  // ---------------- Headhunting ----------------
  const contratado = p => p.etapa === 'Contratado' || p.etapa === 'Facturación';
  const perdido = p => p.etapa === 'Cancelado' || p.etapa === 'Pausado';
  // Fecha en que se resolvió. Sin fecha de cierre (filas importadas de Airtable), la contratación
  // se fecha con el último hito conocido (terna, envío) y la pérdida con el último movimiento.
  const resol = p => !(contratado(p) || perdido(p)) ? null
    : ok(p, 'fecha_cierre') || (contratado(p) ? (ok(p, 'ultima_terna') || ok(p, 'ultimo_envio')) : null) || dia(p.movido_at);
  const empresa = p => clean(p.empresa).toLowerCase();
  // Enviados = informes emitidos en la consola que sí salieron hacia el cliente.
  const enviado = s => s.status === 'issued' && s.issued_at && s.cliente_resultado !== 'No se le envió';
  const enviadosEn = (a, b) => V.filter(s => enviado(s) && en(dia(s.issued_at), a, b));
  const respEn = (a, b) => V.filter(s => enviado(s) && s.cliente_resultado && en(dia(s.cliente_resultado_at), a, b));

  function semanaHH(a, b) {
    const m = medido(a, b), [ma, mb] = med([a, b]);
    const env = enviadosEn(ma, mb), resp = respEn(ma, mb);
    return {
      medido: m,
      enviados: m ? env.length : null,
      entrevistas: m ? resp.filter(s => ENTREVISTADO.includes(s.cliente_resultado)).length : null,
      contratados_informe: m ? resp.filter(s => s.cliente_resultado === 'Lo contrató').length : null,
      nuevos: P.filter(p => en(ok(p, 'activado'), a, b)).length,
      primeros_envios: m ? P.filter(p => en(ok(p, 'primer_envio'), ma, mb)).length : null,
      ternas: P.filter(p => en(ok(p, 'ultima_terna'), a, b)).length,
      contrataciones: P.filter(p => contratado(p) && en(resol(p), a, b)).length,
      perdidos: P.filter(p => perdido(p) && en(resol(p), a, b)).length,
    };
  }
  // La promesa de 48 h sobre los procesos activados en [a, b]: cumple, no cumple (incluye los
  // que siguen sin envío pasado el plazo), aún en plazo, y sin dato (importados sin primer envío).
  function promesa(a0, b0) {
    const [a, b] = med([a0, b0]);
    const ps = b >= a ? P.filter(p => en(ok(p, 'activado'), a, b)) : [];
    const cumple = ps.filter(p => p.cumple_48 === true).length;
    const incumple = ps.filter(p => p.cumple_48 === false || p.atrasado_48).length;
    return { ...tasaN(cumple, cumple + incumple), cumple, incumple,
             en_plazo: ps.filter(p => p.vence_48 && !p.atrasado_48).length,
             sin_dato: ps.filter(p => p.cumple_48 == null && !p.vence_48).length,
             mediana_habiles: medianaN(ps.map(p => p.primer_envio_habiles).filter(x => x != null)) };
  }
  const [a90, b90] = ult(90), [a28, b28] = ult(28);
  const [m90a, m90b] = med([a90, b90]);
  const env90 = m90b >= m90a ? enviadosEn(m90a, m90b) : [];
  const conResp90 = env90.filter(s => CON_RESPUESTA.includes(s.cliente_resultado));
  const entrev90 = env90.filter(s => ENTREVISTADO.includes(s.cliente_resultado));
  const contr90 = env90.filter(s => s.cliente_resultado === 'Lo contrató');
  const conReq90 = env90.filter(s => Number(s.req_total) > 0);
  const res90 = P.filter(p => en(resol(p), a90, b90));
  const resMed = res90.filter(p => resol(p) >= desde);
  const sat90 = resMed.map(p => Number(p.satisfaccion)).filter(x => x >= 1 && x <= 5);
  // Recurrencia: empresas con al menos una contratación que abrieron otro proceso después.
  const porEmp = {};
  P.forEach(p => { const k = empresa(p); if (k) (porEmp[k] = porEmp[k] || []).push(p); });
  let conContr = 0, volvieron = 0;
  Object.values(porEmp).forEach(ps => {
    const fechas = ps.filter(p => contratado(p) && resol(p) && resol(p) <= corte).map(resol).sort();
    if (!fechas.length) return;
    conContr++;
    if (ps.some(p => ok(p, 'activado') && p.activado > fechas[0] && p.activado <= corte)) volvieron++;
  });
  const abiertos = P.filter(p => p.abierto);
  // Qué tan seguido termina en contratación cada tier (histórico): el tier predice el resultado.
  const tierHist = {};
  P.filter(p => contratado(p) || perdido(p)).forEach(p => {
    const k = p.tier || 'Sin tier', t = tierHist[k] || (tierHist[k] = { resueltos: 0, contratados: 0 });
    t.resueltos++; if (contratado(p)) t.contratados++;
  });
  const tier = {};
  abiertos.forEach(p => { const k = p.tier || 'Sin tier'; tier[k] = (tier[k] || 0) + 1; });
  const headhunting = {
    semana: semanaHH(lunes, domingo),
    previa: semanaHH(masDias(lunes, -7), masDias(lunes, -1)),
    calidad: {
      ventana: { desde: a90, hasta: b90 },
      enviados: env90.length,
      sin_respuesta: env90.length - conResp90.length,
      tasa_entrevista: tasaN(entrev90.length, conResp90.length),
      enviados_por_contratacion: contr90.length ? Math.round(10 * env90.length / contr90.length) / 10 : null,
      contratados_informe: contr90.length,
      cumplen_todo: tasaN(conReq90.filter(s => Number(s.req_cumple) >= Number(s.req_total)).length, conReq90.length),
      efectividad: tasaN(res90.filter(contratado).length, res90.length),
      perdidas_internas: res90.filter(p => clean(p.causa_cierre).startsWith('Interna')).length,
      garantias: P.filter(p => p.garantia && en(ok(p, 'activado'), a90, b90)).length,
      ventana_medida: { desde: m90a, hasta: m90b },
      satisfaccion: { promedio: sat90.length ? Math.round(10 * sat90.reduce((x, y) => x + y, 0) / sat90.length) / 10 : null, n: sat90.length, resueltos: resMed.length },
    },
    cliente: {
      recurrencia: tasaN(volvieron, conContr),
      empresas_abiertas: new Set(abiertos.map(empresa)).size,
      procesos_abiertos: abiertos.length,
      tier, tier_historico: tierHist,
      externas_evitables: res90.filter(p => clean(p.causa_cierre).startsWith('Externa evitable')).length,
      sin_causa: P.filter(p => p.falta_causa).length,
    },
    velocidad: { semana: promesa(lunes, domingo), ventana: promesa(a28, b28), dias_ventana: 28, desde: med([a28, b28])[0] },
    pendientes_48: abiertos.filter(p => p.vence_48 && p.activado >= desde).map(p => ({ id: p.id, empresa: p.empresa, cargo: p.cargo, activado: p.activado, vence: p.vence_48, atrasado: p.atrasado_48 }))
      .sort((x, y) => (y.atrasado - x.atrasado) || x.vence.localeCompare(y.vence)),
    tendencia: [],
  };

  // ---------------- SaaS ----------------
  const cli = s => clean(s.cliente).toLowerCase();
  function semanaSaaS(a, b) {
    const pub = S.filter(s => en(ok(s, 'activado'), a, b));
    const primeros = {};
    S.forEach(s => { const k = cli(s), d = ok(s, 'activado'); if (k && d && (!primeros[k] || d < primeros[k])) primeros[k] = d; });
    return {
      publicadas: pub.length,
      metas: S.filter(s => en(ok(s, 'meta_at'), a, b)).length,
      primeros_destacados: S.filter(s => en(ok(s, 'primer_destacado'), a, b)).length,
      clientes_nuevos: Object.values(primeros).filter(d => en(d, a, b)).length,
    };
  }
  const pub90 = S.filter(s => en(ok(s, 'activado'), a90, b90));
  const cumplida = s => !!ok(s, 'meta_at');
  const fallida = s => !cumplida(s) && (s.estado !== 'Activa' || (s.dias_publicada || 0) > 10);
  const conMeta = pub90.filter(s => cumplida(s) && s.dias_para_meta != null);
  const conPrimero = pub90.filter(s => s.primer_destacado_habiles != null && s.activado >= desde);
  const activas = S.filter(s => s.abierto);
  const vacPorCli = {};
  S.filter(s => ok(s, 'activado') && s.activado <= corte).forEach(s => { const k = cli(s); if (k) vacPorCli[k] = (vacPorCli[k] || 0) + 1; });
  const saasOut = {
    semana: semanaSaaS(lunes, domingo),
    previa: semanaSaaS(masDias(lunes, -7), masDias(lunes, -1)),
    calidad: {
      ventana: { desde: a90, hasta: b90 },
      meta: tasaN(pub90.filter(cumplida).length, pub90.filter(s => cumplida(s) || fallida(s)).length),
      en_curso: pub90.filter(s => !cumplida(s) && !fallida(s)).length,
      destacados_por_vacante: activas.length ? Math.round(10 * activas.reduce((n, s) => n + (Number(s.destacados) || 0), 0) / activas.length) / 10 : null,
    },
    cliente: {
      clientes_activos: new Set(activas.map(cli)).size,
      vacantes_activas: activas.length,
      recurrencia: tasaN(Object.values(vacPorCli).filter(n => n >= 2).length, Object.keys(vacPorCli).length),
    },
    velocidad: {
      meta_48: tasaN(conMeta.filter(s => s.dias_para_meta <= PROMESA_HABILES).length, conMeta.length),
      mediana_meta: medianaN(conMeta.map(s => s.dias_para_meta)),
      primer_48: tasaN(conPrimero.filter(s => s.primer_destacado_habiles <= PROMESA_HABILES).length, conPrimero.length),
    },
    al_dia: domingo >= hoy ? tasaN(activas.filter(s => s.dias_sin_actualizar === 0).length, activas.length) : null,
    tendencia: [],
  };

  for (let i = 7; i >= 0; i--) {
    const a = masDias(lunes, -7 * i), b = masDias(a, 6);
    const h = semanaHH(a, b), sq = semanaSaaS(a, b), pr = promesa(a, b);
    headhunting.tendencia.push({ inicio: a, medido: h.medido, enviados: h.enviados, entrevistas: h.entrevistas, nuevos: h.nuevos, contrataciones: h.contrataciones, promesa: h.medido ? pr.pct : null });
    const pubS = S.filter(s => en(ok(s, 'activado'), a, b) && cumplida(s) && s.dias_para_meta != null);
    saasOut.tendencia.push({ inicio: a, publicadas: sq.publicadas, metas: sq.metas,
      meta_48: tasaN(pubS.filter(s => s.dias_para_meta <= PROMESA_HABILES).length, pubS.length).pct });
  }
  return { lunes, domingo, hoy, corte, medicion_desde: desde, promesa_habiles: PROMESA_HABILES, headhunting, saas: saasOut };
}

// Rutas, iguales en el servidor y en el stub: el llamador pasa (método, tipo, id, cuerpo).
async function atender(ops, metodo, tipo, id, cuerpo) {
  if (!ESPECS[tipo]) return { status: 404, body: { error: 'No existe esa tabla.' } };
  if (metodo === 'GET' && id == null) {
    const esp = ESPECS[tipo];
    return { status: 200, body: { tipo, especificacion: esp, filas: await ops.listar(tipo), hoy: hoyCo() } };
  }
  if (metodo === 'POST' && id == null) {
    const r = await ops.crear(tipo, cuerpo);
    return r.error ? { status: 400, body: { error: r.error } } : { status: 200, body: r };
  }
  const n = Number(id);
  if (!Number.isInteger(n)) return { status: 400, body: { error: 'Id inválido.' } };
  if (metodo === 'PATCH') {
    const r = await ops.actualizar(tipo, n, cuerpo);
    return r.error ? { status: r.status || 400, body: { error: r.error } } : { status: 200, body: r };
  }
  if (metodo === 'DELETE') {
    return (await ops.borrar(tipo, n)) ? { status: 200, body: { ok: true } } : { status: 404, body: { error: 'No existe.' } };
  }
  return { status: 405, body: { error: 'Método no permitido.' } };
}

module.exports = {
  ESPECS, TIPOS, ETAPAS, TIERS, CAUSAS, SAAS_ESTADOS, EVAL_ESTADOS,
  calcular, normalizar, reglas, responsabilidad, crearOps, atender, hoyCo, SEMILLA,
  habilesEntre, sumarHabiles, PROMESA_HABILES, fechasMal, LEYENDA_FECHA, indicadoresOps, MEDICION_DESDE,
};

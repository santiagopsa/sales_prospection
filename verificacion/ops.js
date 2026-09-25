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
      { k: 'notas', l: 'Notas', t: 'largo', ancho: 'xl' },
    ],
    calc: [
      { k: 'salud', l: 'Salud', t: 'salud', ayuda: 'Solo en Reclutamiento y Terna enviada. Verde: se movió hace 2 días o menos; amarilla: 3 a 5; roja: más de 5.' },
      { k: 'dias_sin_movimiento', l: 'Días sin movimiento', t: 'num', ayuda: 'Desde el último cambio de etapa, envío, faltantes, garantía o notas.' },
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
      { k: 'meta_at', l: 'Meta cumplida el', t: 'fecha', ayuda: 'Se pone sola el día en que los destacados llegan a la meta.' },
      { k: 'notas', l: 'Notas', t: 'largo', ancho: 'xl' },
    ],
    calc: [
      { k: 'salud', l: 'Salud', t: 'salud', ayuda: 'Solo en activas. Verde: meta cumplida. Roja: más de 10 días publicada sin cumplir, o 2+ días sin actualizar. Amarilla: el resto.' },
      { k: 'faltan', l: 'Faltan destacados', t: 'num' },
      { k: 'dias_sin_actualizar', l: 'Días sin actualizar', t: 'num', ayuda: 'Desde la última vez que se tocaron los números (o se marcó "Sin cambios").' },
      { k: 'dias_publicada', l: 'Días publicada', t: 'num' },
      { k: 'dias_para_meta', l: 'Días hasta la meta', t: 'num' },
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
      { k: 'aprobados', l: 'Aprobados', t: 'num', ancho: 'xs', max: 100000, ayuda: 'Cuántos de los evaluados aprobaron. Sin esto no hay % de aprobación ni salud.' },
      { k: 'satisfaccion', l: 'Satisfacción del cliente', t: 'estrellas' },
      { k: 'link', l: 'Link a la evaluación', t: 'url', ancho: 'l' },
      { k: 'notas', l: 'Notas internas', t: 'largo', ancho: 'xl' },
    ],
    calc: [
      { k: 'salud', l: 'Salud', t: 'salud', ayuda: 'Solo si no está terminada. Verde: 70%+ aprueba y 14 días o menos. Roja: menos de 40% o más de 30 días. Sin aprobados: sin datos.' },
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
const MUEVE = { procesos: ['etapa', 'ultimo_envio', 'ultima_terna', 'faltan_terna', 'garantia', 'notas'], saas: ['aplicantes', 'destacados', 'descartados', 'meta', 'estado'] };

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
  } else if (tipo === 'saas') {
    f.abierto = f.estado === 'Activa';
    const meta = Number(f.meta) || 0, dest = Number(f.destacados) || 0;
    f.meta_cumplida = meta > 0 && dest >= meta;
    f.faltan = meta ? Math.max(0, meta - dest) : null;
    f.dias_publicada = f.activado ? Math.max(0, diasEntre(f.activado, hoy)) : null;
    f.dias_para_meta = f.activado && f.meta_at ? diasEntre(f.activado, f.meta_at) : null;
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
    f.salud = !f.abierto ? null
      : (f.pct_aprobacion == null || !f.activado) ? 'sin_datos'
      : (f.pct_aprobacion >= 70 && f.dias_en_proceso <= 14) ? 'verde'
      : (f.pct_aprobacion < 40 || f.dias_en_proceso > 30) ? 'roja' : 'amarilla';
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
    if (!antes || MUEVE.procesos.some(cambio)) c.movido_at = new Date(ahora).toISOString();
  } else if (tipo === 'saas') {
    const meta = Number(m.meta) || 0;
    if ((cambio('destacados') || cambio('meta')) && meta > 0 && Number(m.destacados) >= meta && !m.meta_at && !('meta_at' in cambios)) c.meta_at = hoy;
    if (!antes || revisado || MUEVE.saas.some(cambio)) c.actualizado_at = new Date(ahora).toISOString();
  }
  return c;
}

// Reglas que cruzan columnas y se revisan con la fila completa.
function coherencia(tipo, fila) {
  if (tipo === 'evaluaciones' && fila.aprobados != null && fila.evaluados != null && Number(fila.aprobados) > Number(fila.evaluados))
    return 'Aprobados no puede ser mayor que evaluados.';
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
    const incoh = coherencia(tipo, todo);
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
    const incoh = coherencia(tipo, { ...antesN, ...todo });
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
};

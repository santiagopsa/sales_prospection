// Carga de leads por CSV.
//
// Dos pasos con la misma función: `simular:true` devuelve el informe completo sin escribir
// nada (lo que Angie ve antes de confirmar), y `simular:false` hace la carga.
// La inserción de leads y de sus tareas es UNA sola sentencia SQL, así que es atómica sin
// transacción explícita: o entran el lead y sus tareas, o no entra nada de esa carga.
const { T } = require('./schema');
const { leerArchivo } = require('./normalizar');
const { planificar } = require('./secuencia');
const tiempo = require('./tiempo');

const MAX_FILAS = 5000; // una carga más grande casi siempre es el archivo equivocado

function error(status, message) { return Object.assign(new Error(message), { status }); }

async function importar(db, config, { archivo, contenido, simular = true, usuario = null, ahora = new Date() }) {
  usuario = require('./resultados').usuarioValido(config, usuario);
  const leido = leerArchivo(contenido);
  if (leido.error) throw error(400, leido.error);
  if (leido.filas.length + leido.errores.length > MAX_FILAS) {
    throw error(400, `El archivo tiene más de ${MAX_FILAS} filas. Pártelo en varias cargas.`);
  }

  // 1 · Repetidos dentro del mismo archivo: se queda la primera aparición.
  const vistos = new Map();
  const unicos = [], duplicados = [];
  for (const f of leido.filas) {
    const llaves = [f.lead.telefono && `t:${f.lead.telefono}`, f.lead.email && `e:${f.lead.email}`].filter(Boolean);
    const previa = llaves.map(k => vistos.get(k)).find(Boolean);
    if (previa) {
      duplicados.push({ fila: f.fila, empresa: f.lead.empresa, motivo: `repetido en el archivo (fila ${previa})` });
      continue;
    }
    llaves.forEach(k => vistos.set(k, f.fila));
    unicos.push(f);
  }

  // 2 · Repetidos contra lo que ya está en la base, con el lead con que chocan.
  const telefonos = unicos.map(f => f.lead.telefono).filter(Boolean);
  const emails = unicos.map(f => f.lead.email).filter(Boolean);
  const existentes = (await db.query(
    `SELECT id, empresa, contacto, telefono, email, etapa FROM ${T.leads}
     WHERE telefono IN (SELECT jsonb_array_elements_text($1::jsonb))
        OR email IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [JSON.stringify(telefonos), JSON.stringify(emails)],
  )).rows;
  const porTel = new Map(existentes.filter(l => l.telefono).map(l => [l.telefono, l]));
  const porMail = new Map(existentes.filter(l => l.email).map(l => [l.email, l]));

  const aCrear = [];
  for (const f of unicos) {
    const t = f.lead.telefono && porTel.get(f.lead.telefono);
    const m = f.lead.email && porMail.get(f.lead.email);
    const choque = t || m;
    if (choque) {
      duplicados.push({
        fila: f.fila, empresa: f.lead.empresa, lead_id: choque.id,
        motivo: `mismo ${t ? 'teléfono' : 'correo'} que el lead #${choque.id} (${choque.empresa}${choque.contacto ? ' · ' + choque.contacto : ''}, ${choque.etapa})`,
      });
    } else aCrear.push(f);
  }

  const plan = planificar(config, tiempo.fechaBogota(ahora));
  const informe = {
    archivo: archivo || null,
    columnas: leido.columnas,
    filas: leido.filas.length + leido.errores.length,
    creados: [],
    aCrear: aCrear.length,
    duplicados: duplicados.sort((a, b) => a.fila - b.fila),
    errores: leido.errores,
    avisos: leido.filas.filter(f => f.avisos.length).map(f => ({ fila: f.fila, empresa: f.lead.empresa, avisos: f.avisos })),
    secuencia: plan.map(p => ({ paso: p.paso, canal: p.canal, fecha: p.fecha })),
    simulado: !!simular,
  };
  if (simular || !aCrear.length) {
    if (!simular) informe.import_id = await registrarCarga(db, informe);
    return informe;
  }

  // 3 · Carga. ON CONFLICT DO NOTHING cubre la carrera con otra carga simultánea: esa fila
  // simplemente no vuelve en RETURNING y se informa como duplicada.
  const entrada = aCrear.map(f => ({ fila: f.fila, ...f.lead }));
  const tareas = plan.map(p => ({ paso: p.paso, canal: p.canal, due_at: p.due_at.toISOString() }));
  const r = await db.query(
    `WITH imp AS (
       INSERT INTO ${T.imports} (archivo, filas, usuario) VALUES ($1, $2, $5) RETURNING id
     ), entrada AS (
       SELECT * FROM jsonb_to_recordset($3::jsonb) AS x(
         fila INT, empresa TEXT, contacto TEXT, cargo TEXT, telefono TEXT, telefono_original TEXT,
         email TEXT, ciudad TEXT, fuente TEXT)
     ), nuevos AS (
       INSERT INTO ${T.leads} (empresa, contacto, cargo, telefono, telefono_original, email, ciudad, fuente, import_id)
       SELECT e.empresa, e.contacto, e.cargo, e.telefono, e.telefono_original, e.email, e.ciudad, e.fuente, (SELECT id FROM imp)
       FROM entrada e ORDER BY e.fila
       ON CONFLICT DO NOTHING
       RETURNING id, telefono, email
     ), tareas AS (
       INSERT INTO ${T.tasks} (lead_id, paso, canal, due_at)
       SELECT n.id, t.paso, t.canal, t.due_at
       FROM nuevos n CROSS JOIN jsonb_to_recordset($4::jsonb) AS t(paso INT, canal TEXT, due_at TIMESTAMPTZ)
       RETURNING lead_id
     )
     SELECT (SELECT id FROM imp) AS import_id,
            (SELECT COALESCE(json_agg(json_build_object('id', id, 'telefono', telefono, 'email', email)), '[]'::json) FROM nuevos) AS nuevos,
            (SELECT COUNT(*) FROM tareas)::int AS tareas`,
    [archivo || null, informe.filas, JSON.stringify(entrada), JSON.stringify(tareas), usuario],
  );
  const { import_id, nuevos } = r.rows[0];
  const idPor = new Map();
  for (const n of nuevos) { if (n.telefono) idPor.set(`t:${n.telefono}`, n.id); if (n.email) idPor.set(`e:${n.email}`, n.id); }
  for (const f of aCrear) {
    const id = (f.lead.telefono && idPor.get(`t:${f.lead.telefono}`)) || (f.lead.email && idPor.get(`e:${f.lead.email}`));
    if (id) informe.creados.push({ fila: f.fila, id, empresa: f.lead.empresa });
    else informe.duplicados.push({ fila: f.fila, empresa: f.lead.empresa, motivo: 'otra carga lo creó al mismo tiempo' });
  }
  informe.duplicados.sort((a, b) => a.fila - b.fila);
  informe.import_id = import_id;
  await registrarCarga(db, informe, import_id);
  return informe;
}

// Deja el informe guardado con la carga. Si esto falla, los leads ya entraron; solo se
// pierde el resumen, y por eso no se propaga el error.
async function registrarCarga(db, informe, id = null) {
  const detalle = JSON.stringify({ columnas: informe.columnas, duplicados: informe.duplicados, errores: informe.errores, avisos: informe.avisos });
  try {
    if (id) {
      await db.query(
        `UPDATE ${T.imports} SET creados=$2, duplicados=$3, con_error=$4, detalle=$5::jsonb WHERE id=$1`,
        [id, informe.creados.length, informe.duplicados.length, informe.errores.length, detalle]);
      return id;
    }
    const r = await db.query(
      `INSERT INTO ${T.imports} (archivo, filas, creados, duplicados, con_error, detalle) VALUES ($1,$2,0,$3,$4,$5::jsonb) RETURNING id`,
      [informe.archivo, informe.filas, informe.duplicados.length, informe.errores.length, detalle]);
    return r.rows[0].id;
  } catch (e) {
    console.error('[sdr] no se guardó el resumen de la carga:', e.message);
    return id;
  }
}

module.exports = { importar, MAX_FILAS };

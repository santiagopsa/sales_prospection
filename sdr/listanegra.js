// Lista negra: teléfonos y correos que no se vuelven a tocar.
//
// Entra por dos caminos: la razón "pidió que no lo contacten" al sacar un lead de la cola (automático)
// y a mano desde la vista Lista negra. Se consulta en la carga (esas filas quedan fuera con su
// motivo) y en la marcación directa (se rechaza). Un lead que ya existe y cae en la lista pasa a
// descartado con esa razón.
const { T } = require('./schema');
const { normalizarTelefono } = require('./normalizar');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const ms = col => `(EXTRACT(EPOCH FROM ${col}) * 1000)::float8`;

async function listar(db, { limite = 500 } = {}) {
  return (await db.query(
    `SELECT id, telefono, email, empresa, razon, nota, lead_id, usuario, ${ms('created_at')} AS created_ms
     FROM ${T.lista_negra} ORDER BY created_at DESC, id DESC LIMIT $1`, [Math.min(Number(limite) || 500, 5000)])).rows;
}

// ¿Cuáles de estos teléfonos / correos están en la lista? Devuelve { telefonos:Set, emails:Set }.
async function enLista(db, telefonos = [], emails = []) {
  telefonos = telefonos.filter(Boolean); emails = emails.filter(Boolean);
  if (!telefonos.length && !emails.length) return { telefonos: new Set(), emails: new Set() };
  const r = await db.query(
    `SELECT telefono, email FROM ${T.lista_negra}
     WHERE telefono IN (SELECT jsonb_array_elements_text($1::jsonb))
        OR email IN (SELECT jsonb_array_elements_text($2::jsonb))`,
    [JSON.stringify(telefonos), JSON.stringify(emails)]);
  return {
    telefonos: new Set(r.rows.map(x => x.telefono).filter(Boolean)),
    emails: new Set(r.rows.map(x => x.email).filter(Boolean)),
  };
}

// Agrega una entrada. `c` puede ser el pool o un cliente dentro de una transacción. Si el
// teléfono o el correo ya estaban, no duplica (devuelve la fila existente).
async function agregar(c, config, { telefono, email, empresa, razon, nota, leadId, usuario }) {
  let tel = null;
  if (telefono) {
    const n = normalizarTelefono(telefono, null, config);
    if (!n.e164) throw error(400, n.error || 'Teléfono inválido');
    tel = n.e164;
  }
  email = email ? String(email).trim().toLowerCase() : null;
  if (!tel && !email) throw error(400, 'Escribe un teléfono o un correo');
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw error(400, 'Correo inválido');
  const previa = await c.query(
    `SELECT id, telefono, email FROM ${T.lista_negra} WHERE ($1::text IS NOT NULL AND telefono = $1) OR ($2::text IS NOT NULL AND email = $2) LIMIT 1`, [tel, email]);
  if (previa.rows.length) return { ...previa.rows[0], existente: true };
  const r = await c.query(
    `INSERT INTO ${T.lista_negra} (telefono, email, empresa, razon, nota, lead_id, usuario)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, telefono, email`,
    [tel, email, empresa ? String(empresa).trim() || null : null, razon || null, nota || null, leadId || null, usuario || null]);
  return { ...r.rows[0], existente: false };
}

// Leads existentes que coinciden con una entrada (para descartarlos al meterla a mano).
async function leadsQueCoinciden(c, { telefono, email }) {
  return (await c.query(
    `SELECT id, etapa FROM ${T.leads} WHERE ($1::text IS NOT NULL AND telefono = $1) OR ($2::text IS NOT NULL AND email = $2)`,
    [telefono || null, email || null])).rows;
}

async function quitar(db, id) {
  const r = await db.query(`DELETE FROM ${T.lista_negra} WHERE id = $1 RETURNING id`, [Number(id)]);
  if (!r.rows.length) throw error(404, 'No está en la lista');
  return { ok: true };
}

module.exports = { listar, enLista, agregar, leadsQueCoinciden, quitar };

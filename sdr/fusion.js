// Fusionar dos leads que son el mismo contacto (se importó dos veces, se creó a mano con otro
// número…). Queda `destino`; `origen` se borra después de pasarle todo:
//   · toques, llamadas (con grabación y evaluación), compromisos y reservas de Calendly;
//   · datos que al destino le faltan (contacto, cargo, correo, ciudad…); los teléfonos de los dos
//     quedan como principal y segundo (si sobran, se guardan en extra.telefonos_extra);
//   · la etapa "más avanzada" (un lead descartado nunca le gana a uno vivo) con su secuencia
//     pendiente, su reunión y su deal. La secuencia pendiente del otro se borra.
// En extra.fusiones queda el rastro de qué se fusionó, cuándo y quién.
const { T } = require('./schema');
const { ETAPAS } = require('./dominio');

function error(status, message) { return Object.assign(new Error(message), { status }); }

const rango = l => (l.etapa === 'descartado' ? -1 : ETAPAS.indexOf(l.etapa));
const vacio = v => v == null || String(v).trim() === '' || v === 'Sin empresa';

async function fusionarLeads(db, config, { destinoId, origenId, usuario = null, ahora = new Date() }) {
  const R = require('./resultados');
  destinoId = Number(destinoId); origenId = Number(origenId);
  if (!Number.isInteger(destinoId) || !Number.isInteger(origenId)) throw error(400, 'Faltan los dos leads');
  if (destinoId === origenId) throw error(400, 'Es el mismo lead');
  usuario = R.usuarioValido(config, usuario);
  return R.enTransaccion(db, async c => {
    const filas = (await c.query(`SELECT * FROM ${T.leads} WHERE id IN ($1, $2) ORDER BY id FOR UPDATE`, [destinoId, origenId])).rows;
    const d = filas.find(x => x.id === destinoId), o = filas.find(x => x.id === origenId);
    if (!d || !o) throw error(404, `No existe el lead #${!d ? destinoId : origenId}`);
    const avisos = [];
    const vivo = rango(o) > rango(d) ? o : d;
    const otro = vivo === o ? d : o;

    // 1 · Tareas: la secuencia pendiente del que no manda se borra; lo demás pasa al destino
    //     con `paso` corrido (es solo el orden y es único por lead).
    const borradas = (await c.query(`DELETE FROM ${T.tasks} WHERE lead_id = $1 AND estado = 'pendiente' AND tipo = 'secuencia' RETURNING id`, [otro.id])).rows.length;
    const base = (await c.query(`SELECT COALESCE(MAX(paso), 0)::int AS n FROM ${T.tasks} WHERE lead_id = $1`, [destinoId])).rows[0].n;
    const movidas = (await c.query(`UPDATE ${T.tasks} SET lead_id = $1, paso = paso + $3 WHERE lead_id = $2 RETURNING id`, [destinoId, origenId, base])).rows.length;
    // 2 · Historia
    const toques = (await c.query(`UPDATE ${T.touches} SET lead_id = $1 WHERE lead_id = $2 RETURNING id`, [destinoId, origenId])).rows.length;
    const llamadas = (await c.query(`UPDATE ${T.calls} SET lead_id = $1 WHERE lead_id = $2 RETURNING id`, [destinoId, origenId])).rows.length;
    await c.query(`UPDATE ${T.calendly} SET lead_id = $1 WHERE lead_id = $2`, [destinoId, origenId]);
    await c.query(`UPDATE ${T.lista_negra} SET lead_id = $1 WHERE lead_id = $2`, [destinoId, origenId]);

    // 3 · Datos combinados
    const telefonos = [...new Set([d.telefono, d.telefono_alt, o.telefono, o.telefono_alt].filter(Boolean))];
    const correos = [...new Set([d.email, o.email].filter(Boolean))];
    const extra = { ...(o.extra || {}), ...(d.extra || {}) };
    if (telefonos.length > 2) extra.telefonos_extra = [...new Set([...(extra.telefonos_extra || []), ...telefonos.slice(2)])];
    if (correos.length > 1) extra.correos_extra = [...new Set([...(extra.correos_extra || []), ...correos.slice(1)])];
    extra.fusiones = [...((d.extra || {}).fusiones || []), ...((o.extra || {}).fusiones || []),
      { lead: o.id, empresa: o.empresa, contacto: o.contacto, telefono: o.telefono, email: o.email, etapa: o.etapa, por: usuario, at: ahora.toISOString() }];
    const tomar = k => (vacio(d[k]) ? o[k] : d[k]);
    let dealId = vivo.deal_id || otro.deal_id || null;
    if (d.deal_id && o.deal_id && d.deal_id !== o.deal_id) avisos.push(`El deal #${otro.deal_id} quedó en el Sandler sin lead (se conserva el #${vivo.deal_id}); bórralo allá si sobra.`);

    // El origen se borra antes de actualizar el destino: teléfono y correo son únicos.
    await c.query(`DELETE FROM ${T.leads} WHERE id = $1`, [origenId]);
    await c.query(
      `UPDATE ${T.leads} SET empresa = $2, contacto = $3, cargo = $4, ciudad = $5, fuente = $6, email = $7,
         telefono = $8, telefono_original = COALESCE(telefono_original, $9), telefono_alt = $10, extra = $11::jsonb,
         etapa = $12, etapa_at = $13, razon_descarte = $14, pausado_hasta = $15, reunion_at = $16, deal_id = $17,
         created_at = LEAST(created_at, $18), updated_at = NOW()
       WHERE id = $1`,
      [destinoId, tomar('empresa'), tomar('contacto'), tomar('cargo'), tomar('ciudad'), tomar('fuente'), correos[0] || null,
        telefonos[0] || null, o.telefono_original, telefonos[1] || null, JSON.stringify(extra),
        vivo.etapa, vivo.etapa_at, vivo.razon_descarte, vivo.pausado_hasta, vivo.reunion_at, dealId, o.created_at]);
    if (borradas && vivo === o) avisos.push('Siguió la secuencia del lead fusionado (estaba más avanzado).');
    return { id: destinoId, fusionado: origenId, etapa: vivo.etapa, movidos: { toques, llamadas, tareas: movidas }, secuencia_borrada: borradas, avisos };
  });
}

// Otros leads de la misma empresa (mismo nombre normalizado: "Acme S.A.S." = "ACME"): posibles
// duplicados o compañeros de trabajo del contacto. Se muestran en la ficha para fusionar.
async function mismaEmpresa(db, lead, { limite = 12 } = {}) {
  const LN = require('./listanegra');
  const norm = LN.normalizarEmpresa(lead.empresa);
  if (!norm || lead.empresa === 'Sin empresa') return [];
  const grupos = await require('./leads').buscarEmpresas(db, norm, { limite: 20 });
  const g = grupos.find(x => x.norm === norm);
  return g ? g.contactos.filter(x => x.id !== lead.id).slice(0, limite) : [];
}

module.exports = { fusionarLeads, mismaEmpresa };

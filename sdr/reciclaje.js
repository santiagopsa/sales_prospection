// Reciclaje: sacar de la cola lo que ya no va a dar más, para que los leads se acaben y haya que
// alimentar con lista nueva (reglas en config.RECICLAJE). Tres pasadas, idempotentes:
//
//   1. Secuencias vencidas: un toque de secuencia atrasado más de `secuencia_vencida_dias` se omite,
//      solo en leads que ya se tocaron al menos una vez (a los que nunca se ha llamado no se les toca
//      nada: son el pozo). Si al lead no le queda nada pendiente, se agota (AL_AGOTAR_SECUENCIA).
//   2. Huérfanos con historia: lead en etapa de Angie, ya tocado, sin ningún toque pendiente y sin
//      pausa. En "conversación" se pausa `pausa_meses` (sin_avance); en nuevo/contactado se descarta
//      (sin_respuesta) si AL_AGOTAR_SECUENCIA = 'descartar'.
//   3. Sin teléfono: lead sin teléfono y sin toques sale como datos_malos (no se puede llamar; sigue
//      en Brevo para correo).
//
// `simular: true` cuenta sin cambiar nada (node sdr/cli.js reciclaje).
const { T } = require('./schema');
const D = require('./dominio');
const tiempo = require('./tiempo');

function reglas(config) {
  const r = config.RECICLAJE || {};
  return {
    conversacionesMax: r.conversaciones_max == null ? null : Number(r.conversaciones_max) || null,
    pausaMeses: Number(r.pausa_meses) || 3,
    vencidaDias: r.secuencia_vencida_dias == null ? null : Number(r.secuencia_vencida_dias) || null,
    sinTelefono: r.sin_telefono !== false,
    agotarDescarta: config.AL_AGOTAR_SECUENCIA === 'descartar',
  };
}

async function correr(db, config, { ahora = new Date(), simular = false } = {}) {
  const r = reglas(config);
  const R = require('./resultados');
  const etapas = JSON.stringify(D.ETAPAS_DE_ANGIE);
  const out = { secuencias_omitidas: 0, leads_con_secuencia_omitida: 0, agotados: 0, huerfanos_pausados: 0, huerfanos_descartados: 0, sin_telefono: 0, simulado: simular, detalle: [] };

  // 1 · Secuencias vencidas (solo leads ya tocados, sin pausa).
  if (r.vencidaDias) {
    const limite = new Date(ahora.getTime() - r.vencidaDias * 86400000).toISOString();
    const q = await db.query(
      `SELECT t.id, t.lead_id FROM ${T.tasks} t JOIN ${T.leads} l ON l.id = t.lead_id
       WHERE t.estado = 'pendiente' AND t.tipo = 'secuencia' AND t.due_at < $1
         AND l.etapa IN (SELECT jsonb_array_elements_text($2::jsonb)) AND l.pausado_hasta IS NULL
         AND EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva')`, [limite, etapas]);
    out.secuencias_omitidas = q.rows.length;
    const leads = [...new Set(q.rows.map(x => x.lead_id))];
    out.leads_con_secuencia_omitida = leads.length;
    if (!simular && q.rows.length) {
      await db.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = $2 WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [JSON.stringify(q.rows.map(x => x.id)), ahora.toISOString()]);
    }
  }

  // 2 · Huérfanos con historia: nada pendiente, ya tocados, sin pausa (incluye los que quedaron sin
  //     nada por el paso 1).
  const h = await db.query(
    `SELECT l.id, l.etapa, l.empresa FROM ${T.leads} l
     WHERE l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb)) AND l.pausado_hasta IS NULL
       AND EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva')
       AND NOT EXISTS (SELECT 1 FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente'${simular && r.vencidaDias ? ` AND NOT (t.tipo = 'secuencia' AND t.due_at < $2)` : ''})`,
    simular && r.vencidaDias ? [etapas, new Date(ahora.getTime() - r.vencidaDias * 86400000).toISOString()] : [etapas]);
  for (const l of h.rows) {
    if (l.etapa === 'conversacion') {
      out.huerfanos_pausados++;
      if (!simular) await R.pausarPorReciclaje(db, config, l.id, { meses: r.pausaMeses, ahora, nota: 'Conversaciones sin avance y sin próximo toque (reciclaje)' });
    } else if (r.agotarDescarta) {
      out.huerfanos_descartados++; out.agotados++;
      if (!simular) await db.query(`UPDATE ${T.leads} SET etapa = 'descartado', etapa_at = NOW(), updated_at = NOW(), razon_descarte = 'sin_respuesta' WHERE id = $1`, [l.id]);
    }
    if (out.detalle.length < 30) out.detalle.push({ lead_id: l.id, empresa: l.empresa, etapa: l.etapa, accion: l.etapa === 'conversacion' ? 'pausa' : (r.agotarDescarta ? 'descartar' : 'nada') });
  }

  // 3 · Sin teléfono y sin toques: fuera de la cola.
  if (r.sinTelefono) {
    const q = await db.query(
      `SELECT l.id FROM ${T.leads} l WHERE l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb)) AND l.telefono IS NULL
         AND NOT EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva')`, [etapas]);
    out.sin_telefono = q.rows.length;
    if (!simular && q.rows.length) {
      const ids = JSON.stringify(q.rows.map(x => x.id));
      await db.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = $2 WHERE lead_id IN (SELECT jsonb_array_elements_text($1::jsonb)::int) AND estado = 'pendiente'`, [ids, ahora.toISOString()]);
      await db.query(`UPDATE ${T.leads} SET etapa = 'descartado', etapa_at = NOW(), updated_at = NOW(), razon_descarte = 'datos_malos' WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [ids]);
    }
  }
  return out;
}

// Una vez al día (y al arrancar): guarda la fecha de la última pasada en memoria del proceso.
let ultimaPasada = null;
async function jobDiario(db, config, { ahora = new Date(), log = console } = {}) {
  const hoy = tiempo.fechaBogota(ahora);
  if (ultimaPasada === hoy) return null;
  ultimaPasada = hoy;
  const r = await correr(db, config, { ahora });
  if (r.secuencias_omitidas || r.huerfanos_pausados || r.huerfanos_descartados || r.sin_telefono) {
    log.log(`[sdr/reciclaje] ${r.secuencias_omitidas} toques vencidos omitidos (${r.leads_con_secuencia_omitida} leads) · ${r.huerfanos_pausados} en pausa por conversaciones sin avance · ${r.huerfanos_descartados} agotados · ${r.sin_telefono} sin teléfono`);
  }
  return r;
}

module.exports = { reglas, correr, jobDiario, _reiniciar: () => { ultimaPasada = null; } };

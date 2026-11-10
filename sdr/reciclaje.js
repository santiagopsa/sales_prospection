// Reciclaje: sacar de la cola lo que ya no va a dar más, para que los leads se acaben y haya que
// alimentar con lista nueva (reglas en config.RECICLAJE). Tres pasadas, idempotentes:
//
//   1. Secuencias vencidas: un toque de secuencia atrasado más de `secuencia_vencida_dias` se omite,
//      solo en leads que ya se tocaron al menos una vez (a los que nunca se ha llamado no se les toca
//      nada: son el pozo). Si al lead no le queda nada pendiente, se agota (AL_AGOTAR_SECUENCIA).
//   2. Huérfanos con historia: lead en etapa de Angie, ya tocado, sin ningún toque pendiente y sin
//      pausa. En "conversación" se pausa `pausa_meses` (sin_avance); en nuevo/contactado se descarta
//      (sin_respuesta) si AL_AGOTAR_SECUENCIA = 'descartar'.
//   3. Sin nada para contactarlo: lead sin toques, sin teléfono, sin correo y sin LinkedIn sale como
//      sin_contacto. Sin teléfono pero con correo o LinkedIn se queda (antes salía como datos_malos:
//      ver rescatar).
//   4. Rescate: los que la regla vieja sacó así sin tocarlos nunca y que sí tienen correo o LinkedIn
//      vuelven a la cola con su secuencia desde hoy (RECICLAJE.rescatar_dias).
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
    sinContacto: (r.sin_contacto ?? r.sin_telefono) !== false,
    rescatarDias: r.rescatar_dias == null ? null : Number(r.rescatar_dias),
    agotarDescarta: config.AL_AGOTAR_SECUENCIA === 'descartar',
  };
}

async function correr(db, config, { ahora = new Date(), simular = false } = {}) {
  const r = reglas(config);
  const R = require('./resultados');
  const etapas = JSON.stringify(D.ETAPAS_DE_ANGIE);
  const out = { secuencias_omitidas: 0, leads_con_secuencia_omitida: 0, agotados: 0, huerfanos_pausados: 0, huerfanos_descartados: 0, sin_contacto: 0, rescatados: 0, simulado: simular, detalle: [] };

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
    `SELECT l.id, l.etapa, l.empresa,
            EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.resultado IN ('conversacion', 'pide_info', 'reunion_agendada')) AS hablo
     FROM ${T.leads} l
     WHERE l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb)) AND l.pausado_hasta IS NULL
       AND EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva')
       AND NOT EXISTS (SELECT 1 FROM ${T.tasks} t WHERE t.lead_id = l.id AND t.estado = 'pendiente'${simular && r.vencidaDias ? ` AND NOT (t.tipo = 'secuencia' AND t.due_at < $2)` : ''})`,
    simular && r.vencidaDias ? [etapas, new Date(ahora.getTime() - r.vencidaDias * 86400000).toISOString()] : [etapas]);
  for (const l of h.rows) {
    // Con alguien que ya conversó con Angie no se descarta "sin respuesta": pausa (sin_avance).
    if (l.etapa === 'conversacion' || l.hablo) {
      out.huerfanos_pausados++;
      if (!simular) await R.pausarPorReciclaje(db, config, l.id, { meses: r.pausaMeses, ahora, nota: 'Conversaciones sin avance y sin próximo toque (reciclaje)' });
    } else if (r.agotarDescarta) {
      out.huerfanos_descartados++; out.agotados++;
      if (!simular) await db.query(`UPDATE ${T.leads} SET etapa = 'descartado', etapa_at = NOW(), updated_at = NOW(), razon_descarte = 'sin_respuesta' WHERE id = $1`, [l.id]);
    }
    if (out.detalle.length < 30) out.detalle.push({ lead_id: l.id, empresa: l.empresa, etapa: l.etapa, accion: (l.etapa === 'conversacion' || l.hablo) ? 'pausa' : (r.agotarDescarta ? 'descartar' : 'nada') });
  }

  // 3 · Sin teléfono, sin correo, sin LinkedIn y sin toques: no hay cómo trabajarlo.
  const SIN_NADA = `l.telefono IS NULL AND l.telefono_alt IS NULL AND l.email IS NULL AND COALESCE(l.extra->>'linkedin', '') = ''`;
  if (r.sinContacto) {
    const q = await db.query(
      `SELECT l.id FROM ${T.leads} l WHERE l.etapa IN (SELECT jsonb_array_elements_text($1::jsonb)) AND ${SIN_NADA}
         AND NOT EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id AND x.canal <> 'ejecutiva')`, [etapas]);
    out.sin_contacto = q.rows.length;
    if (!simular && q.rows.length) {
      const ids = JSON.stringify(q.rows.map(x => x.id));
      await db.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = $2 WHERE lead_id IN (SELECT jsonb_array_elements_text($1::jsonb)::int) AND estado = 'pendiente'`, [ids, ahora.toISOString()]);
      await db.query(`UPDATE ${T.leads} SET etapa = 'descartado', etapa_at = NOW(), updated_at = NOW(), razon_descarte = 'sin_contacto' WHERE id IN (SELECT jsonb_array_elements_text($1::jsonb)::int)`, [ids]);
    }
  }

  // 4 · Rescate: descartados como datos_malos por la regla vieja (sin teléfono), nunca tocados (ni un
  //     toque, ni de la ejecutiva), con correo o LinkedIn, que llegaron hace menos de rescatar_dias.
  if (r.rescatarDias) {
    const desde = new Date(ahora.getTime() - r.rescatarDias * 86400000).toISOString();
    const q = await db.query(
      `SELECT l.id, l.empresa FROM ${T.leads} l
       WHERE l.etapa = 'descartado' AND l.razon_descarte = 'datos_malos' AND l.telefono IS NULL AND l.telefono_alt IS NULL
         AND (l.email IS NOT NULL OR COALESCE(l.extra->>'linkedin', '') <> '') AND l.created_at >= $1
         AND NOT EXISTS (SELECT 1 FROM ${T.touches} x WHERE x.lead_id = l.id)`, [desde]);
    out.rescatados = q.rows.length;
    if (!simular && q.rows.length) {
      const { planificar } = require('./secuencia');
      const plan = planificar(config, tiempo.fechaBogota(ahora));
      for (const l of q.rows) {
        await db.query(`UPDATE ${T.leads} SET etapa = 'nuevo', etapa_at = NOW(), updated_at = NOW(), razon_descarte = NULL, pausado_hasta = NULL WHERE id = $1`, [l.id]);
        const base = (await db.query(`SELECT COALESCE(MAX(paso), 0)::int AS n FROM ${T.tasks} WHERE lead_id = $1`, [l.id])).rows[0].n;
        for (const p of plan) await db.query(`INSERT INTO ${T.tasks} (lead_id, paso, canal, due_at) VALUES ($1, $2, $3, $4)`, [l.id, base + p.paso, p.canal, p.due_at.toISOString()]);
        await db.query(`INSERT INTO ${T.touches} (lead_id, canal, resultado, nota, created_at) VALUES ($1, 'ejecutiva', 'editado', $2, $3)`,
          [l.id, 'Vuelve a la cola: se había descartado solo por no tener teléfono (tiene correo o LinkedIn).', ahora.toISOString()]);
        if (out.detalle.length < 30) out.detalle.push({ lead_id: l.id, empresa: l.empresa, etapa: 'descartado', accion: 'rescatar' });
      }
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
  if (r.secuencias_omitidas || r.huerfanos_pausados || r.huerfanos_descartados || r.sin_contacto || r.rescatados) {
    log.log(`[sdr/reciclaje] ${r.secuencias_omitidas} toques vencidos omitidos (${r.leads_con_secuencia_omitida} leads) · ${r.huerfanos_pausados} en pausa por conversaciones sin avance · ${r.huerfanos_descartados} agotados · ${r.sin_contacto} sin teléfono, correo ni LinkedIn · ${r.rescatados} rescatados`);
  }
  return r;
}

module.exports = { reglas, correr, jobDiario, _reiniciar: () => { ultimaPasada = null; } };

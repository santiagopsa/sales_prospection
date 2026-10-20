// La ficha de una prueba gratis, pegada al deal (public.deals.data.prueba). Cuatro momentos:
//
//   1. Arranque: vacante, champion (el reclutador), criterio de éxito y el mapa del decisor como
//      descubrimiento (no bloquea). Se calcula la reunión de resultados a PRUEBA.dias_habiles y queda
//      como compromiso de la ejecutiva (va a su calendario), con un check-in a mitad de prueba.
//   2. Durante: "día N de 10" en la tarjeta del embudo; lo que Wei tiene en Operaciones se pega solo
//      (sdr/pruebas.js).
//   3. Resultados: los números de la prueba y la página de resultados, redactada por Claude para que
//      el champion la reenvíe a su jefe. Luisa la edita o le pide a Claude ajustes.
//   4. Decisión: plan / consumo / no / presupuesto del otro año con fecha. Cada una mueve el embudo
//      sola y, en el último caso, deja la fecha límite y el compromiso de retomar.
//
// Reglas en PRUEBA de config.js. El resumen de conversión (cuáles pruebas se vuelven clientes) sigue
// en sdr/pruebas.js; aquí vive la ficha de cada una.
const { T } = require('./schema');
const tiempo = require('./tiempo');
const R = require('./resultados');
const P = require('./pruebas');

function error(status, message) { return Object.assign(new Error(message), { status }); }
const Em = () => require('./embudo');
const C = () => require('./compromisos');

function reglas(config) {
  const p = config.PRUEBA || {};
  return {
    diasHabiles: Number(p.dias_habiles) || 10,
    checkinDia: p.checkin_dia == null ? null : Number(p.checkin_dia),
    hora: p.hora_reunion || '10:00',
    criterio: p.criterio_por_defecto || 'Terna de {cargo} en 5 días hábiles',
    retomarDiasAntes: Number(p.retomar_dias_antes) || 7,
    decisiones: p.decisiones || { plan: 'Plan', consumo: 'Por consumo', otro_ano: 'Presupuesto del otro año', no: 'No' },
    pagina: { modelo: (p.pagina || {}).modelo || null, maxPalabras: Number((p.pagina || {}).max_palabras) || 250, transcriptMax: Number((p.pagina || {}).transcript_max_chars) || 14000 },
  };
}
const PLATA = ['este_ano', 'otro_ano', 'no_sabe'];
const ejecutivaDe = config => (config.USUARIOS || []).find(u => u.rol === 'ejecutiva') || null;
const limpiar = (s, n = 400) => { const t = String(s == null ? '' : s).trim(); return t ? t.slice(0, n) : null; };
const vacanteId = url => { const m = /vacantes\/(\d+)/.exec(String(url || '')); return m ? Number(m[1]) : null; };

async function leerDeal(db, dealId) {
  const d = (await db.query(`SELECT * FROM public.deals WHERE id = $1`, [Number(dealId)])).rows[0];
  if (!d) throw error(404, `No existe el deal #${dealId}`);
  return d;
}
async function leadDe(db, dealId) {
  const r = await db.query(`SELECT id, empresa, contacto, cargo FROM ${T.leads} WHERE deal_id = $1 ORDER BY id LIMIT 1`, [Number(dealId)]);
  return r.rows[0] || null;
}
async function guardar(db, dealId, prueba) {
  await db.query(`UPDATE public.deals SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('prueba', $2::jsonb) WHERE id = $1`, [Number(dealId), JSON.stringify(prueba)]);
}

// Día N de la prueba (hábiles desde el arranque, contando el arranque como día 1).
function diaDe(config, prueba, ahora = new Date()) {
  if (!prueba || !prueba.inicio) return null;
  const hoy = tiempo.fechaBogota(ahora);
  let f = tiempo.aDiaHabil(prueba.inicio), n = 1;
  while (f < hoy) { f = tiempo.aDiaHabil(tiempo.sumarDias(f, 1)); n++; if (n > 400) break; }
  return hoy < prueba.inicio ? 0 : n;
}

// ---- 1 · Arranque ---------------------------------------------------------------------------

async function arrancar(db, config, { dealId, ficha = {}, usuario, ahora = new Date(), env = process.env }) {
  dealId = Number(dealId);
  const r = reglas(config);
  usuario = R.usuarioValido(config, usuario);
  const d = await leerDeal(db, dealId);
  const data = d.data || {};
  const previa = data.prueba || null;
  const inicio = ficha.inicio && /^\d{4}-\d{2}-\d{2}$/.test(ficha.inicio) ? ficha.inicio : tiempo.fechaBogota(ahora);
  const champion = { nombre: limpiar(ficha.champion_nombre, 120), cargo: limpiar(ficha.champion_cargo, 120) };
  if (!champion.nombre) throw error(400, 'Pon el nombre del reclutador que está probando (el champion).');
  const criterio = limpiar(ficha.criterio, 300);
  if (!criterio) throw error(400, 'Escribe el criterio de éxito en una frase (qué tiene que pasar para que la prueba se dé por buena).');
  const decisor = {
    quien: limpiar(ficha.decisor_quien, 160), cuando: limpiar(ficha.decisor_cuando, 160), que_pide: limpiar(ficha.decisor_que_pide, 300),
    plata: PLATA.includes(ficha.plata) ? ficha.plata : 'no_sabe',
  };
  const fueraDeAlcance = !!ficha.fuera_de_alcance;
  const resultadosFecha = tiempo.avanzar(inicio, r.diasHabiles, true);
  const checkinFecha = r.checkinDia ? tiempo.avanzar(inicio, r.checkinDia, true) : null;

  const prueba = {
    ...(previa || {}),
    vacante_url: limpiar(ficha.vacante_url, 300), vacante_id: vacanteId(ficha.vacante_url), cargo: limpiar(ficha.cargo, 120),
    champion, decisor, criterio, fuera_de_alcance: fueraDeAlcance,
    inicio, resultados_fecha: resultadosFecha, resultados_hora: r.hora, checkin_fecha: checkinFecha,
    arrancada_at: ahora.toISOString(), arrancada_por: usuario,
  };

  // Compromisos de la ejecutiva: la reunión de resultados (y el check-in), en su calendario.
  const eje = ejecutivaDe(config);
  const lead = await leadDe(db, dealId);
  const empresa = d.company || (lead && lead.empresa) || `deal #${dealId}`;
  const creados = [];
  const quienAtiende = eje ? eje.nombre : usuario;
  const notaFicha = [`Champion: ${champion.nombre}${champion.cargo ? ' (' + champion.cargo + ')' : ''}`, `Criterio: ${criterio}`, decisor.quien && `Decide: ${decisor.quien}`, decisor.cuando && `Presupuesto: ${decisor.cuando}`, prueba.vacante_url].filter(Boolean).join('\n');
  // Si ya había compromisos de una ficha anterior, se cancelan y se crean los nuevos.
  const omitidos = [];
  for (const id of [previa && previa.compromiso_id, previa && previa.checkin_compromiso_id].filter(Boolean)) {
    const u = await db.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = NOW() WHERE id = $1 AND estado = 'pendiente' RETURNING id`, [id]);
    if (u.rows.length) omitidos.push(id);
  }
  const t = await C().insertar(db, config, {
    leadId: lead ? lead.id : null, tipo: 'reunion', titulo: `Resultados de la prueba · ${empresa}`, canal: 'llamada',
    fecha: resultadosFecha, hora: r.hora, nota: `${notaFicha}\nEl champion trae al jefe (o no): ahí se decide plan, consumo, no u otro año.`, usuario: quienAtiende, creadoPor: usuario,
  });
  prueba.compromiso_id = t.id; creados.push(t.id);
  if (checkinFecha) {
    const ck = await C().insertar(db, config, {
      leadId: lead ? lead.id : null, tipo: 'seguimiento', titulo: `Check-in de la prueba · ${empresa}`, canal: 'llamada',
      fecha: checkinFecha, hora: r.hora, nota: `¿Cómo va la prueba? ¿Ya vio candidatos? ¿Qué le falta para llevárselo a ${decisor.quien || 'su jefe'}?`, usuario: quienAtiende, creadoPor: usuario,
    });
    prueba.checkin_compromiso_id = ck.id; creados.push(ck.id);
  } else prueba.checkin_compromiso_id = null;

  await guardar(db, dealId, prueba);
  // El deal queda en "Prueba gratis" si no estaba (deja prueba_at).
  const etapa = Em().etapaDe(config, d);
  let movido = false;
  if (!(etapa === 'propuesta' && d.propuesta_tipo === 'prueba')) {
    await Em().mover(db, config, { dealId, etapa: 'propuesta', tipo: 'prueba', usuario, ahora });
    movido = true;
  }
  // Calendario, mejor esfuerzo (red), fuera de lo anterior.
  const calendario = [];
  for (const id of omitidos) await C().sincronizar(db, config, env, id, 'borrar');
  for (const id of creados) calendario.push(await C().sincronizar(db, config, env, id, 'crear'));
  const avisos = [`Reunión de resultados el ${resultadosFecha} a las ${r.hora}${eje ? ' (compromiso de ' + eje.nombre + ')' : ''}.`];
  if (checkinFecha) avisos.push(`Check-in el ${checkinFecha}.`);
  if (fueraDeAlcance) avisos.push('Marcaste perfiles fuera de alcance: considera no arrancar la prueba y cerrarla como "no califica".');
  return { deal_id: dealId, prueba, movido, avisos, calendario };
}

// ---- 3 · Resultados -------------------------------------------------------------------------

const num = v => (v === '' || v == null ? null : Number.isFinite(Number(v)) ? Number(v) : null);

async function registrarResultados(db, config, { dealId, numeros = {}, usuario, ahora = new Date() }) {
  dealId = Number(dealId);
  usuario = R.usuarioValido(config, usuario);
  const d = await leerDeal(db, dealId);
  const prueba = (d.data || {}).prueba;
  if (!prueba || !prueba.inicio) throw error(409, 'La prueba no tiene ficha de arranque: arráncala primero.');
  const n = {
    presentados: num(numeros.presentados), entrevistados: num(numeros.entrevistados), dias_primera_terna: num(numeros.dias_primera_terna),
    contratados: num(numeros.contratados), pruebas_usadas: numeros.pruebas_usadas == null ? null : !!numeros.pruebas_usadas,
    comparado_con: limpiar(numeros.comparado_con, 160), criterio_cumplido: numeros.criterio_cumplido == null || numeros.criterio_cumplido === '' ? null : !!numeros.criterio_cumplido,
    nota: limpiar(numeros.nota, 1000), at: ahora.toISOString(), por: usuario,
  };
  if (n.presentados == null && n.entrevistados == null && n.contratados == null && !n.nota) throw error(400, 'Pon al menos un número de la prueba (candidatos presentados, entrevistados o contratados) o una nota.');
  prueba.numeros = n;
  await guardar(db, dealId, prueba);
  return { deal_id: dealId, numeros: n };
}

// Lo que el cliente dijo en el demo, para que la página hable con sus palabras.
function contextoDemo(config, data = {}) {
  const r = reglas(config);
  const pedido = Em().loQuePidio(data);
  const t = String(data.transcript || '').trim();
  const transcript = t.length > r.pagina.transcriptMax ? t.slice(0, r.pagina.transcriptMax) + '\n[… transcripción recortada …]' : t;
  return { pedido, transcript, con_demo: t.length > 0 };
}

function promptPagina(config, { d, prueba, lead, operacion, instrucciones, anterior }) {
  const r = reglas(config);
  const data = d.data || {};
  const { pedido, transcript } = contextoDemo(config, data);
  const n = prueba.numeros || {};
  const numeros = [
    n.presentados != null && `Candidatos presentados: ${n.presentados}`, n.entrevistados != null && `Entrevistados por el cliente: ${n.entrevistados}`,
    n.dias_primera_terna != null && `Días hábiles hasta la primera terna: ${n.dias_primera_terna}`, n.contratados != null && `Contratados: ${n.contratados}`,
    n.pruebas_usadas != null && `Usaron las pruebas de Peaku: ${n.pruebas_usadas ? 'sí' : 'no'}`, n.comparado_con && `Comparado con: ${n.comparado_con}`,
    n.criterio_cumplido != null && `Criterio de éxito cumplido: ${n.criterio_cumplido ? 'sí' : 'no'}`, n.nota && `Nota de la ejecutiva: ${n.nota}`,
  ].filter(Boolean).join('\n');
  const ops = (operacion || []).map(o => `${o.producto}: ${o.cargo || 'sin cargo'}${o.estado ? ' · ' + o.estado : ''}${o.primer_envio ? ' · primer candidato ' + o.primer_envio : ''}${o.destacados != null ? ' · ' + o.destacados + (o.meta ? '/' + o.meta : '') + ' destacados' : ''}${o.evaluados != null ? ' · ' + o.evaluados + ' evaluados' : ''}`).join('\n');
  const eje = ejecutivaDe(config);
  const system = `Eres ${eje ? eje.nombre : 'la ejecutiva comercial'}, ejecutiva comercial de Peaku (headhunting tech, SaaS de reclutamiento, evaluaciones y EOR en Colombia). Escribes la página de resultados de una prueba gratis que hizo un cliente.

PARA QUIÉN ES: la recibe el reclutador que hizo la prueba (el champion), pero está escrita para que él la REENVÍE a su jefe, la persona que aprueba el presupuesto. El jefe no estuvo en la prueba, no conoce Peaku y tiene dos minutos. El champion tiene que poder mandarla tal cual, sin editarla, y quedar bien.

CÓMO SE ESCRIBE:
- En español de Colombia, trato de usted, sin adjetivos de vendedor ("increíble", "líder", "innovador"). Hechos y números.
- Máximo ${r.pagina.maxPalabras} palabras. Texto plano, sin markdown, sin viñetas con asteriscos; párrafos cortos y, si sirve, líneas tipo "Candidatos presentados: 6".
- Estructura: (1) qué se probó y con qué vacante, en una línea; (2) el criterio de éxito que se acordó y si se cumplió; (3) los resultados en números; (4) lo que el cliente dijo que le dolía antes de la prueba, con sus propias palabras si la transcripción las tiene (una cita corta, entre comillas, de lo que dijo el cliente, nunca de lo que dijo la ejecutiva), y cómo quedó frente a eso; (5) el siguiente paso propuesto en una frase, con las dos salidas (plan o por consumo) sin precios, y la reunión de 20 minutos con el jefe.
- Si un número no existe, no lo inventes ni pongas un marcador: omite esa línea.
- No menciones que es un texto para reenviar ni que lo escribió una IA. No pongas asunto de correo, saludo largo ni firma: empieza por el contenido.`;
  const user = `EMPRESA: ${d.company || (lead && lead.empresa) || ''}
CHAMPION (reclutador que hizo la prueba): ${prueba.champion ? `${prueba.champion.nombre}${prueba.champion.cargo ? ', ' + prueba.champion.cargo : ''}` : '—'}
DECISOR CONOCIDO: ${prueba.decisor && prueba.decisor.quien ? prueba.decisor.quien : 'no se sabe'}${prueba.decisor && prueba.decisor.que_pide ? ` · lo que pediría para decir que sí: ${prueba.decisor.que_pide}` : ''}
VACANTE DE LA PRUEBA: ${prueba.cargo || '—'}${prueba.vacante_url ? ' · ' + prueba.vacante_url : ''}
CRITERIO DE ÉXITO ACORDADO: ${prueba.criterio}
ARRANQUE: ${prueba.inicio} · REUNIÓN DE RESULTADOS: ${prueba.resultados_fecha}

NÚMEROS DE LA PRUEBA (registrados por la ejecutiva):
${numeros || '(sin números todavía)'}
${ops ? `\nLO QUE OPERACIONES TIENE DE ESTA EMPRESA:\n${ops}` : ''}

LO QUE EL CLIENTE PIDIÓ Y CONTÓ EN EL DEMO (antes de la prueba):
${pedido || '(sin demo registrado)'}
${transcript ? `\nTRANSCRIPCIÓN DEL DEMO (para citar al cliente con sus palabras; EJECUTIVA es Peaku, lo demás es el cliente):\n${transcript}` : ''}
${anterior ? `\nVERSIÓN ANTERIOR DE LA PÁGINA (la ejecutiva quiere cambios sobre esta):\n${anterior}` : ''}
${instrucciones ? `\nAJUSTES QUE PIDE LA EJECUTIVA (obligatorios):\n${instrucciones}` : ''}

Escribe la página de resultados. Solo el texto.`;
  return { system, user };
}

async function redactarPagina(db, config, anthropic, { dealId, usuario, instrucciones, ahora = new Date() }) {
  dealId = Number(dealId);
  if (!anthropic) throw error(503, 'Sin ANTHROPIC_API_KEY: la redacción con IA no está disponible en este servidor.');
  const r = reglas(config);
  usuario = R.usuarioValido(config, usuario);
  const d = await leerDeal(db, dealId);
  const prueba = (d.data || {}).prueba;
  if (!prueba || !prueba.inicio) throw error(409, 'La prueba no tiene ficha de arranque.');
  if (!prueba.numeros) throw error(409, 'Registra primero los números de la prueba: sin ellos la página no tiene nada que decir.');
  const lead = await leadDe(db, dealId);
  let operacion = [];
  try { operacion = P.deEmpresa(await P.operacionEnPrueba(db), d.company); } catch (_) { operacion = []; }
  const anterior = instrucciones && prueba.pagina && prueba.pagina.texto ? prueba.pagina.texto : null;
  const { system, user } = promptPagina(config, { d, prueba, lead, operacion, instrucciones: limpiar(instrucciones, 1500), anterior });
  const msg = await anthropic.messages.create({ model: r.pagina.modelo || process.env.ANALYZE_MODEL || 'claude-opus-4-8', max_tokens: 1500, system, messages: [{ role: 'user', content: user }] });
  const texto = ((msg.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') || '').trim();
  if (texto.length < 80) throw error(502, 'La IA devolvió una página vacía. Intenta de nuevo.');
  prueba.pagina = { texto, redactada_at: ahora.toISOString(), modelo: msg.model || null, instrucciones: limpiar(instrucciones, 1500), editada_at: null, editada_por: null };
  await guardar(db, dealId, prueba);
  return { deal_id: dealId, pagina: prueba.pagina };
}

async function guardarPagina(db, config, { dealId, texto, usuario, ahora = new Date() }) {
  dealId = Number(dealId);
  usuario = R.usuarioValido(config, usuario);
  const d = await leerDeal(db, dealId);
  const prueba = (d.data || {}).prueba;
  if (!prueba || !prueba.inicio) throw error(409, 'La prueba no tiene ficha de arranque.');
  const t = String(texto || '').replace(/\r\n/g, '\n').trim();
  if (t.length < 40) throw error(400, 'La página quedó casi vacía.');
  prueba.pagina = { ...(prueba.pagina || {}), texto: t.slice(0, 8000), editada_at: ahora.toISOString(), editada_por: usuario };
  await guardar(db, dealId, prueba);
  return { deal_id: dealId, pagina: prueba.pagina };
}

// ---- 4 · Decisión ---------------------------------------------------------------------------

async function decidir(db, config, { dealId, tipo, fecha, nota, championTraeJefe, reunionJefeFecha, productos, usuario, ahora = new Date(), env = process.env }) {
  dealId = Number(dealId);
  const r = reglas(config);
  usuario = R.usuarioValido(config, usuario);
  if (!r.decisiones[tipo]) throw error(400, `Elige la decisión: ${Object.values(r.decisiones).join(' / ')}`);
  const d = await leerDeal(db, dealId);
  const prueba = (d.data || {}).prueba;
  if (!prueba || !prueba.inicio) throw error(409, 'La prueba no tiene ficha de arranque.');
  if (tipo === 'otro_ano' && !/^\d{4}-\d{2}(-\d{2})?$/.test(String(fecha || ''))) throw error(400, 'Con "presupuesto del otro año" pon el mes o el día del comité (YYYY-MM o YYYY-MM-DD): sin fecha es un "más adelante".');
  const fechaLimite = tipo === 'otro_ano' ? (String(fecha).length === 7 ? `${fecha}-01` : String(fecha)) : null;
  prueba.champion_trae_jefe = championTraeJefe == null || championTraeJefe === '' ? (prueba.champion_trae_jefe ?? null) : !!championTraeJefe;
  if (reunionJefeFecha && /^\d{4}-\d{2}-\d{2}$/.test(reunionJefeFecha)) prueba.reunion_jefe_fecha = reunionJefeFecha;
  prueba.decision = { tipo, label: r.decisiones[tipo], fecha: fechaLimite, nota: limpiar(nota, 600), at: ahora.toISOString(), por: usuario };
  await guardar(db, dealId, prueba);

  const avisos = [];
  const lead = await leadDe(db, dealId);
  const empresa = d.company || (lead && lead.empresa) || `deal #${dealId}`;
  let compromisoId = null;
  const motivoBase = `Prueba gratis: ${r.decisiones[tipo]}${prueba.decision.nota ? ' — ' + prueba.decision.nota : ''}`;
  if (tipo === 'plan' || tipo === 'consumo') {
    let prods = Array.isArray(productos) ? productos.filter(Boolean) : [];
    if (!prods.length) { let ops = []; try { ops = P.deEmpresa(await P.operacionEnPrueba(db), d.company); } catch (_) {} prods = productosPorDefecto(config, ops); }
    await Em().mover(db, config, { dealId, etapa: 'ganado', motivo: `Piloto validó la solución — ${motivoBase}`, productos: prods, usuario, ahora });
    avisos.push(`Ganado (${r.decisiones[tipo]}).`);
  } else if (tipo === 'no') {
    await Em().mover(db, config, { dealId, etapa: 'perdido', motivo: motivoBase, usuario, ahora });
    avisos.push('Perdido, con el motivo de la prueba.');
  } else {
    // Otro año: interesado, con fecha límite de decisión y compromiso de retomar antes del comité.
    await Em().mover(db, config, { dealId, etapa: 'interesado', usuario, ahora });
    await db.query(`UPDATE public.deals SET data = COALESCE(data, '{}'::jsonb) || jsonb_build_object('fechaLimiteDecision', $2::text) WHERE id = $1`, [dealId, fechaLimite]);
    const retomar = tiempo.aDiaHabil(tiempo.sumarDias(fechaLimite, -r.retomarDiasAntes));
    const eje = ejecutivaDe(config);
    const t = await C().insertar(db, config, {
      leadId: lead ? lead.id : null, tipo: 'seguimiento', titulo: `Retomar ${empresa}: presupuesto ${fechaLimite.slice(0, 7)}`, canal: 'llamada',
      fecha: retomar > tiempo.fechaBogota(ahora) ? retomar : tiempo.fechaBogota(ahora), hora: r.hora,
      nota: `La prueba fue bien; quedó para el presupuesto del ${fechaLimite.slice(0, 7)}. Puente por consumo mientras tanto. Champion: ${prueba.champion ? prueba.champion.nombre : '—'}.`,
      usuario: eje ? eje.nombre : usuario, creadoPor: usuario,
    });
    compromisoId = t.id;
    prueba.decision.compromiso_id = t.id;
    await guardar(db, dealId, prueba);
    await C().sincronizar(db, config, env, t.id, 'crear');
    avisos.push(`Interesado, con fecha límite ${fechaLimite} y compromiso de retomar el ${retomar}.`);
  }
  // La reunión de resultados queda hecha (si seguía pendiente).
  if (prueba.compromiso_id) await db.query(`UPDATE ${T.tasks} SET estado = 'hecha', done_at = $2 WHERE id = $1 AND estado = 'pendiente'`, [prueba.compromiso_id, ahora.toISOString()]);
  if (prueba.checkin_compromiso_id) await db.query(`UPDATE ${T.tasks} SET estado = 'omitida', done_at = $2 WHERE id = $1 AND estado = 'pendiente'`, [prueba.checkin_compromiso_id, ahora.toISOString()]);
  return { deal_id: dealId, decision: prueba.decision, compromiso_id: compromisoId, avisos };
}
// Qué se vendió, cuando la decisión es plan o consumo y no lo dijeron: lo que Wei tiene en prueba o SaaS.
function productosPorDefecto(config, ops) {
  const lista = ((config.EMBUDO || {}).productos) || ['SaaS'];
  const deOps = (ops || []).map(o => o.producto).filter(p => lista.includes(p));
  return deOps.length ? [...new Set(deOps)] : [lista.includes('SaaS') ? 'SaaS' : lista[0]];
}

// ---- Lectura --------------------------------------------------------------------------------

async function ficha(db, config, dealId, { ahora = new Date() } = {}) {
  dealId = Number(dealId);
  const r = reglas(config);
  const d = await leerDeal(db, dealId);
  const data = d.data || {};
  const prueba = data.prueba || null;
  let operacion = [];
  try { operacion = P.deEmpresa(await P.operacionEnPrueba(db), d.company); } catch (_) { operacion = []; }
  const lead = await leadDe(db, dealId);
  const demo = contextoDemo(config, data);
  const cargo = (prueba && prueba.cargo) || (operacion[0] && operacion[0].cargo) || (data.fichaCargos ? String(data.fichaCargos).split(/[,;\n]/)[0].trim() : '') || '';
  const sugerido = {
    champion_nombre: (lead && lead.contacto) || data.contactName || data.contacto || '',
    champion_cargo: (lead && lead.cargo) || data.contactRole || '',
    decisor_quien: data.decisor || ((data.qualif || {}).decisor_quien) || '',
    decisor_cuando: data.fechaLimiteDecision || '',
    cargo,
    criterio: r.criterio.replace('{cargo}', cargo || 'el cargo de la prueba'),
    vacante_url: operacion[0] && operacion[0].peaku_id ? `https://peaku.co/es/empresas/vacantes/${operacion[0].peaku_id}` : '',
  };
  const dia = prueba ? diaDe(config, prueba, ahora) : null;
  const hoy = tiempo.fechaBogota(ahora);
  return {
    deal_id: dealId, empresa: d.company, etapa: Em().etapaDe(config, d), propuesta_tipo: d.propuesta_tipo, prueba_at: d.prueba_at, ejecutiva: (ejecutivaDe(config) || {}).nombre || null,
    prueba, dia, dias_total: r.diasHabiles,
    vencida: !!(prueba && prueba.resultados_fecha && !prueba.decision && hoy > prueba.resultados_fecha),
    resultados_hoy: !!(prueba && prueba.resultados_fecha === hoy && !prueba.decision),
    operacion, con_demo: demo.con_demo, pedido_chars: demo.pedido.length, sugerido, reglas: { ...r, decisiones: r.decisiones, productos: (config.EMBUDO || {}).productos || [] },
  };
}

// Para el resumen de pruebas (sdr/pruebas.js): lo que la ficha aporta a cada fila.
function resumenFicha(config, prueba, ahora = new Date()) {
  if (!prueba || !prueba.inicio) return { tiene_ficha: false };
  const hoy = tiempo.fechaBogota(ahora);
  return {
    tiene_ficha: true, champion: prueba.champion ? prueba.champion.nombre : null, decisor: prueba.decisor ? prueba.decisor.quien : null,
    criterio: prueba.criterio, dia: diaDe(config, prueba, ahora), dias_total: reglas(config).diasHabiles,
    resultados_fecha: prueba.resultados_fecha, vencida: !!(prueba.resultados_fecha && !prueba.decision && hoy > prueba.resultados_fecha),
    con_numeros: !!prueba.numeros, con_pagina: !!(prueba.pagina && prueba.pagina.texto),
    champion_trae_jefe: prueba.champion_trae_jefe ?? null,
    decision: prueba.decision ? { tipo: prueba.decision.tipo, label: prueba.decision.label, fecha: prueba.decision.fecha } : null,
  };
}

module.exports = { reglas, arrancar, registrarResultados, redactarPagina, guardarPagina, decidir, ficha, resumenFicha, diaDe, promptPagina, contextoDemo };

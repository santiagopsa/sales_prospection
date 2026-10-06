// Tabla de rutas de la API, independiente del servidor. La usan el router de Express
// (producción) y el servidor de desarrollo sin dependencias (sdr/dev.js), así que las dos
// formas de correr el módulo no pueden divergir.
const { importar } = require('./importar');
const VERSION = String(Date.now());
const { consultarCola, posponerTarea } = require('./cola');
const L = require('./leads');
const D = require('./dominio');
const { registrarToque, registrarEjecutiva, agregarAListaNegra } = require('./resultados');
const LN = require('./listanegra');
const P = require('./pipeline');
const C = require('./compromisos');
const cal = require('./calendario');
const vox = require('./vox/servidor');
const ritmo = require('./ritmo');
const { ETAPAS, ETAPA_LABEL, CANALES, CANAL_LABEL } = D;

function rutas({ db, config, anthropic = null }) {
  const sinDb = () => { if (!db) throw Object.assign(new Error('SDR necesita DATABASE_URL'), { status: 503 }); };
  return [
    ['get', '/api/meta', async () => ({
      // Cambia con cada arranque del servidor (cada deploy): la pantalla avisa si quedó vieja.
      version: VERSION,
      etapas: ETAPAS.map(e => ({ id: e, label: ETAPA_LABEL[e] })),
      etapasAngie: D.ETAPAS_DE_ANGIE,
      canales: CANALES.map(c => ({ id: c, label: CANAL_LABEL[c] })),
      metas: { marcaciones: config.META_MARCACIONES_DIA, conversaciones: config.META_CONVERSACIONES_DIA },
      resultados: D.RESULTADOS_LLAMADA.map(r => ({ id: r, label: D.RESULTADO_LABEL[r] })),
      resultadoLabel: D.RESULTADO_LABEL,
      respuestasOtroCanal: D.RESPUESTAS_OTRO_CANAL,
      razones: D.RAZONES_DESCARTE.filter(r => r !== 'sin_respuesta' && r !== 'lista_negra').map(r => ({ id: r, label: D.RAZON_LABEL[r], definitiva: D.RAZONES_DEFINITIVAS.includes(r), reintento: (config.REINTENTO_POR_RAZON || {})[r] || null })),
      razonLabel: D.RAZON_LABEL,
      reintentoMeses: config.OPCIONES_REINTENTO_MESES || [1, 3, 6],
      usuarios: (config.USUARIOS || []).map(u => ({ nombre: u.nombre, rol: u.rol })),
      recordatorioGrabacion: config.RECORDATORIO_GRABACION || '',
      verTranscripcion: config.VER_TRANSCRIPCION || [],
      tiposCompromiso: Object.entries(config.TIPOS_COMPROMISO || {}).map(([id, t]) => ({ id, label: t.label, canal: t.canal, descripcion: t.descripcion })),
      calendarioActivo: cal.activo(process.env),
      listas: { origenes: (config.LISTAS || {}).origenes || [], altaPorDefecto: (config.LISTAS || {}).alta_por_defecto || [], diasCaliente: (config.LISTAS || {}).dias_caliente || 14 },
      calendly: require('./calendly').activo(config) ? { url: config.CALENDLY.url, origen: new URL(config.CALENDLY.url).origin, ejecutiva: config.CALENDLY.ejecutiva, permitirManual: !!config.CALENDLY.permitir_manual, horaDeCalendly: !!require('./calendly').token(process.env), mensaje: config.CALENDLY.mensaje || '', sincronizar_min: config.CALENDLY.sincronizar_min || 10 } : null,
    })],
    // Toque de Angie: llamada (con resultado obligatorio) o WhatsApp / correo / LinkedIn de un clic.
    ['post', '/api/leads/:id/toques', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      // Reunión agendada en el Calendly embebido: la hora sale de Calendly (con token) y la reserva queda anotada.
      const CAL = require('./calendly');
      const { detalle, evento } = b.resultado === 'reunion_agendada' ? await CAL.prepararDetalle(process.env, b.detalle) : { detalle: b.detalle, evento: null };
      const r = await registrarToque(db, config, {
        leadId: params.id, canal: b.canal, resultado: b.resultado, razon: b.razon, nota: b.nota,
        detalle, taskId: b.task_id, compromisoId: b.compromiso_id, callUuid: b.call_uuid, usuario: b.usuario, reintentoMeses: b.reintento_meses,
      });
      if (evento) {
        await CAL.registrarEvento(db, { ...evento, lead_id: Number(params.id), origen: 'app', estado: 'registrado' });
        r.calendly = { inicio: detalle.reunion_at, desde_calendly: !!CAL.token(process.env) };
      }
      return r;
    }],
    // Reagendar una reunión ya agendada (desde el Calendly embebido o a mano).
    ['post', '/api/leads/:id/reagendar', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      const CAL = require('./calendly');
      const { detalle, evento } = await CAL.prepararDetalle(process.env, { reunion_at: b.reunion_at, calendly: b.calendly });
      const r = await require('./resultados').reagendarReunion(db, config, { leadId: params.id, reunionAt: detalle.reunion_at, nota: b.nota, usuario: b.usuario });
      if (evento) await CAL.registrarEvento(db, { ...evento, lead_id: Number(params.id), origen: 'app', estado: 'registrado' });
      return r;
    }],
    // Link de Calendly para mandar por WhatsApp / correo / LinkedIn, marcado con el lead y el canal.
    ['get', '/api/leads/:id/calendly', async ({ params, query }) => {
      sinDb();
      const CAL = require('./calendly');
      if (!CAL.activo(config)) throw Object.assign(new Error('Calendly no está configurado (CALENDLY.url)'), { status: 400 });
      const lead = (await db.query(`SELECT id, empresa, contacto, email FROM sdr.leads WHERE id = $1`, [Number(params.id)])).rows[0];
      if (!lead) throw Object.assign(new Error('Lead no encontrado'), { status: 404 });
      return {
        enlace: CAL.enlace(config, { lead, canal: query.canal || null, usuario: query.usuario || null }),
        embebido: CAL.enlace(config, { lead, canal: query.canal || 'llamada', usuario: query.usuario || null, embebido: true, dominio: query.dominio || null }),
      };
    }],
    // Brevo (el CRM de Luisa): el cruce completo y el deal de Brevo de un lead o un deal del Sandler.
    ['get', '/api/brevo/estado', async () => ({ activo: require('./brevo').activo(process.env) })],
    ['get', '/api/brevo/chequeo', async ({ query }) => { sinDb(); return require('./brevo').chequeo(db, config, process.env, { forzar: query.forzar === '1' }); }],
    ['get', '/api/brevo/deal', async ({ query }) => {
      sinDb();
      const B = require('./brevo');
      if (!B.activo(process.env)) return { activo: false, deal: null };
      let email = query.email || null, empresa = query.empresa || null;
      if (query.lead_id) { const l = await L.detalleLead(db, query.lead_id); email = l.email; empresa = l.empresa; }
      else if (query.deal_id) { const r = await db.query(`SELECT d.company, l.email FROM public.deals d LEFT JOIN ${require('./schema').T.leads} l ON l.deal_id = d.id WHERE d.id = $1 LIMIT 1`, [query.deal_id]); if (r.rows[0]) { empresa = r.rows[0].company; email = r.rows[0].email; } }
      return { activo: true, deal: await B.dealDe(db, config, process.env, { email, empresa, dealId: query.deal_id }) };
    }],
    ['get', '/api/calendly/estado', async () => { sinDb(); return require('./calendly').estado(db, config, process.env); }],
    ['post', '/api/calendly/sincronizar', async () => { sinDb(); return require('./calendly').sincronizar(db, config, process.env); }],
    // Acciones de la ejecutiva comercial.
    ['post', '/api/leads/:id/ejecutiva', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return registrarEjecutiva(db, config, { leadId: params.id, accion: b.accion, razon: b.razon, nota: b.nota, usuario: b.usuario, reintentoMeses: b.reintento_meses });
    }],
    // Lista negra: ver, agregar a mano (descarta los leads que coincidan) y quitar.
    ['get', '/api/lista-negra', async () => { sinDb(); return LN.listar(db); }],
    ['post', '/api/lista-negra', async ({ body }) => { sinDb(); const b = body || {}; return agregarAListaNegra(db, config, { telefono: b.telefono, email: b.email, empresa: b.empresa, dominio: b.dominio, todaEmpresa: !!b.toda_empresa, nota: b.nota, usuario: b.usuario }); }],
    // Carga masiva de la base de lista negra (CSV/xlsx: empresa, teléfono, correo, dominio, motivo).
    ['post', '/api/lista-negra/importar', async ({ body }) => {
      sinDb();
      const { archivo, contenido, base64, confirmar } = body || {};
      const entrada = base64 ? Buffer.from(String(base64), 'base64') : contenido;
      if (!entrada) throw Object.assign(new Error('Falta el contenido del archivo'), { status: 400 });
      return LN.importarLista(db, config, { archivo, contenido: entrada, simular: !confirmar, usuario: require('./resultados').usuarioValido(config, (body || {}).usuario) });
    }],
    ['post', '/api/lista-negra/:id/quitar', async ({ params }) => { sinDb(); return LN.quitar(db, params.id); }],
    // Telefonía (Voximplant)
    ['get', '/api/vox/config', async () => vox.configPublica(process.env)],
    ['post', '/api/vox/login-key', async ({ body }) => vox.firmarLogin(process.env, (body || {}).key)],
    // Bitácora de un intento fallido desde el navegador → queda en el registro del servidor.
    ['post', '/api/vox/bitacora', async ({ body }) => {
      const b = body || {};
      console.error('[sdr/tel] llamada fallida', JSON.stringify({ lead_id: b.lead_id, uuid: b.uuid, telefono: b.telefono, usuario: b.usuario, motivo: b.motivo }), '\n  ' + (Array.isArray(b.bitacora) ? b.bitacora.map(String).slice(-15).join('\n  ') : ''));
      return { ok: true };
    }],
    ['post', '/api/vox/webhook', async ({ headers, body }) => { sinDb(); return vox.recibirWebhook(db, process.env, headers || {}, body, config); }],
    // Pipeline de audio: transcripción y métricas por llamada (la app se las muestra solo a VER_TRANSCRIPCION).
    ['get', '/api/pipeline/estado', async () => { sinDb(); return { ...(await P.estado(db)), activo: !!process.env.DEEPGRAM_API_KEY }; }],
    ['post', '/api/pipeline/revisar', async () => { sinDb(); return P.revisarTodas(db, config); }],
    ['get', '/api/llamadas/:id/transcripcion', async ({ params }) => { sinDb(); return P.transcripcionDeLlamada(db, params.id, config); }],
    ['post', '/api/llamadas/:id/evaluar', async ({ params }) => { sinDb(); return P.evaluar(db, config, process.env, params.id, { forzar: true }); }],
    // Mejora semanal: confirmar el foco y ver los informes guardados.
    ['post', '/api/mejora/foco', async ({ body }) => { sinDb(); const b = body || {}; return require('./mejora').confirmarFoco(db, config, { usuario: require('./resultados').usuarioValido(config, b.usuario), criterio: b.criterio, nota: b.nota }); }],
    ['get', '/api/mejora/informes', async ({ query }) => { sinDb(); return require('./mejora').informesGuardados(db, query.usuario || null); }],
    ['get', '/api/rubrica', async () => { sinDb(); const r = await require('./evaluador').rubricaActiva(db, config); return { version: r.version, fuentes: r.fuentes, criterios: r.criterios, reglas: r.reglas, pesos: config.PESOS_CRITERIOS || {} }; }],
    ['post', '/api/llamadas/:id/reprocesar', async ({ params }) => { sinDb(); return P.reencolar(db, params.id); }],
    ['get', '/api/cola', async ({ query }) => { sinDb(); return consultarCola(db, config, { usuario: query.usuario || null }); }],
    ['post', '/api/tareas/:id/posponer', async ({ params, body }) => {
      sinDb();
      const t = (await db.query(`SELECT tipo FROM sdr.tasks WHERE id = $1`, [Number(params.id)])).rows[0];
      if (t && t.tipo !== 'secuencia') return C.mover(db, config, process.env, params.id, { dias: (body || {}).dias });
      return posponerTarea(db, config, { taskId: params.id, dias: (body || {}).dias });
    }],
    // Compromisos: tareas con hora que nacen de una conversación (van al calendario del dueño).
    ['post', '/api/tareas', async ({ body }) => {
      sinDb();
      const b = body || {};
      const usuario = require('./resultados').usuarioValido(config, b.usuario);
      return C.crear(db, config, process.env, { leadId: b.lead_id, tipo: b.tipo, titulo: b.titulo, canal: b.canal, fecha: b.fecha, hora: b.hora, nota: b.nota, usuario: require('./resultados').usuarioValido(config, b.dueno) || usuario, creadoPor: usuario });
    }],
    ['post', '/api/tareas/:id/quitar-del-calendario', async ({ params }) => { sinDb(); return C.quitarDelCalendario(db, config, process.env, params.id); }],
    ['post', '/api/tareas/:id/hecha', async ({ params, body }) => { sinDb(); return C.hecha(db, config, process.env, params.id, { deshacer: !!(body || {}).deshacer }); }],
    ['post', '/api/tareas/:id/eliminar', async ({ params }) => { sinDb(); return C.eliminar(db, config, process.env, params.id); }],
    ['post', '/api/tareas/:id/mover', async ({ params, body }) => { sinDb(); const b = body || {}; return C.mover(db, config, process.env, params.id, { fecha: b.fecha, hora: b.hora, dias: b.dias, titulo: b.titulo, nota: b.nota }); }],
    ['get', '/api/compromisos', async ({ query }) => { sinDb(); return C.listar(db, config, { usuario: query.usuario || null, dias: Number(query.dias) || 7 }); }],
    ['get', '/api/calendario/estado', async () => ({ activo: cal.activo(process.env), usuarios: (config.USUARIOS || []).filter(u => u.email).map(u => u.nombre) })],
    // Prueba de la delegación: crea y borra un evento en el calendario del usuario dado.
    ['post', '/api/calendario/reintentar', async () => { sinDb(); return C.reintentarPendientes(db, config, process.env); }],
    ['post', '/api/calendario/probar', async ({ body }) => cal.probar(process.env, config, (body || {}).usuario || 'Angie')],
    // Listas (cada carga): prioridad, avance y leads en orden de trabajo.
    ['get', '/api/listas', async () => { sinDb(); return require('./listas').listar(db, config); }],
    ['get', '/api/listas/:id', async ({ params }) => { sinDb(); return require('./listas').detalle(db, config, params.id); }],
    ['post', '/api/listas/:id', async ({ params, body }) => { sinDb(); return require('./listas').actualizar(db, config, params.id, body || {}); }],
    // Embudo de la ejecutiva (lo muestra el Sandler Coach): deals por etapa, calificar y mover.
    ['get', '/api/embudo', async () => { sinDb(); return require('./embudo').tablero(db, config); }],
    ['post', '/api/embudo/:id/calificar', async ({ params, body }) => { sinDb(); const b = body || {}; return require('./embudo').calificar(db, config, { dealId: params.id, items: b.items, usuario: b.usuario }); }],
    ['post', '/api/embudo/:id/mover', async ({ params, body }) => { sinDb(); const b = body || {}; return require('./embudo').mover(db, config, { dealId: params.id, etapa: b.etapa, tipo: b.tipo, motivo: b.motivo, productos: b.productos, usuario: b.usuario }); }],
    // Cotización enviada: el documento (PDF/Word/texto) como texto, y su análisis contra el demo.
    ['get', '/api/embudo/:id/cotizacion', async ({ params }) => { sinDb(); return require('./embudo').cotizacion(db, params.id); }],
    ['post', '/api/embudo/:id/cotizacion', async ({ params, body }) => { sinDb(); const b = body || {}; return require('./embudo').guardarCotizacion(db, config, { dealId: params.id, archivo: b.archivo, base64: b.base64, texto: b.texto, usuario: b.usuario }); }],
    ['post', '/api/embudo/:id/cotizacion/analizar', async ({ params, body }) => { sinDb(); return require('./embudo').analizarCotizacion(db, config, anthropic, { dealId: params.id, usuario: (body || {}).usuario }); }],
    // Tablero de la ejecutiva: reuniones de la SDR del mes y calificación con chulos.
    ['get', '/api/ejecutiva', async ({ query }) => { sinDb(); return require('./ejecutiva').tablero(db, config, { mes: query.mes }); }],
    ['post', '/api/leads/:id/calificacion', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return require('./ejecutiva').calificar(db, config, { leadId: params.id, items: b.items, limpiar: !!b.limpiar, usuario: b.usuario });
    }],
    // Proyección de la silla comercial vs lo real (config.PROYECCION).
    ['get', '/api/proyeccion', async ({ query }) => { sinDb(); return require('./proyeccion').seguimiento(db, config, { hasta: query.hasta }); }],
    ['get', '/api/comision', async ({ query }) => { sinDb(); return require('./comision').resumenMes(db, config, { mes: query.mes, usuario: query.usuario || null }); }],
    ['get', '/api/historial', async ({ query }) => { sinDb(); return ritmo.historialDia(db, config, { fecha: query.fecha, usuario: query.usuario || null }); }],
    ['get', '/api/semana', async ({ query }) => { sinDb(); return ritmo.resumenSemana(db, config, { fecha: /^\d{4}-\d{2}-\d{2}$/.test(query.fecha || '') ? query.fecha : undefined, usuario: query.usuario || null }); }],
    ['get', '/api/pipeline', async () => { sinDb(); return L.pipeline(db); }],
    ['get', '/api/leads', async ({ query }) => {
      sinDb();
      return L.listarLeads(db, { etapa: query.etapa, huerfanos: query.huerfanos === '1', pausados: query.pausados === '1', q: query.q });
    }],
    ['get', '/api/leads/buscar', async ({ query }) => { sinDb(); return L.buscarLeads(db, query.q, { limite: query.limite }); }],
    ['get', '/api/leads/:id', async ({ params }) => {
      sinDb();
      const l = await L.detalleLead(db, params.id);
      try { l.misma_empresa = await require('./fusion').mismaEmpresa(db, l); } catch (e) { l.misma_empresa = []; }
      // La reserva de Calendly vigente: formulario, invitados y quién aceptó (de Google Calendar).
      try { l.reunion = await require('./calendly').reunionDe(db, l.id); } catch (e) { l.reunion = null; }
      return l;
    }],
    // Vuelve a mirar en Google Calendar quién está invitado a la reunión del lead y si aceptó.
    ['post', '/api/leads/:id/reunion/invitados', async ({ params }) => {
      sinDb();
      const CAL = require('./calendly');
      const r = await CAL.refrescarInvitados(db, config, process.env, { leadId: Number(params.id) });
      return { ...r, reunion: await CAL.reunionDe(db, params.id) };
    }],
    // Fusionar: el lead de la URL queda y absorbe a `origen_id` (que se borra).
    ['post', '/api/leads/:id/fusionar', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return require('./fusion').fusionarLeads(db, config, { destinoId: params.id, origenId: b.origen_id, usuario: b.usuario });
    }],
    ['post', '/api/leads/:id/editar', async ({ params, body }) => { sinDb(); const b = body || {}; return L.editarLead(db, config, params.id, b, require('./resultados').usuarioValido(config, b.usuario)); }],
    // Fallos de marcación: lo que el operador no cursó, el reporte de Angie y la revisión de Santiago.
    ['get', '/api/llamadas/fallidas', async () => { sinDb(); return L.fallosDeMarcacion(db); }],
    ['post', '/api/llamadas/reportar', async ({ body }) => { sinDb(); const b = body || {}; return L.reportarLlamada(db, { uuid: b.uuid, leadId: b.lead_id, telefono: b.telefono, codigo: b.codigo, estado: b.estado, nota: b.nota, usuario: require('./resultados').usuarioValido(config, b.usuario) }); }],
    ['post', '/api/llamadas/:id/revisar', async ({ params, body }) => { sinDb(); return L.revisarFallo(db, params.id, (body || {}).revisado !== false); }],
    ['post', '/api/marcar', async ({ body }) => { sinDb(); const b = body || {}; return L.leadParaMarcar(db, config, { telefono: b.telefono, empresa: b.empresa, contacto: b.contacto, leadId: b.lead_id || null, usuario: require('./resultados').usuarioValido(config, b.usuario) }); }],
    ['get', '/api/empresas/buscar', async ({ query }) => { sinDb(); return L.buscarEmpresas(db, query.q); }],
    ['get', '/api/cargas', async () => { sinDb(); return L.cargas(db); }],
    ['get', '/api/cargas/:id', async ({ params }) => { sinDb(); return L.detalleCarga(db, params.id); }],
    ['post', '/api/importar', async ({ body }) => {
      sinDb();
      const { archivo, contenido, base64, confirmar, lista } = body || {};
      const entrada = base64 ? Buffer.from(String(base64), 'base64') : contenido;
      if (!entrada) throw Object.assign(new Error('Falta el contenido del archivo'), { status: 400 });
      return importar(db, config, { archivo, contenido: entrada, simular: !confirmar, usuario: (body || {}).usuario, lista });
    }],
  ];
}

module.exports = { rutas };

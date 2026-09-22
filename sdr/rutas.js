// Tabla de rutas de la API, independiente del servidor. La usan el router de Express
// (producción) y el servidor de desarrollo sin dependencias (sdr/dev.js), así que las dos
// formas de correr el módulo no pueden divergir.
const { importar } = require('./importar');
const { consultarCola, posponerTarea } = require('./cola');
const L = require('./leads');
const D = require('./dominio');
const { registrarToque, registrarEjecutiva, agregarAListaNegra } = require('./resultados');
const LN = require('./listanegra');
const P = require('./pipeline');
const vox = require('./vox/servidor');
const ritmo = require('./ritmo');
const { ETAPAS, ETAPA_LABEL, CANALES, CANAL_LABEL } = D;

function rutas({ db, config }) {
  const sinDb = () => { if (!db) throw Object.assign(new Error('SDR necesita DATABASE_URL'), { status: 503 }); };
  return [
    ['get', '/api/meta', async () => ({
      etapas: ETAPAS.map(e => ({ id: e, label: ETAPA_LABEL[e] })),
      canales: CANALES.map(c => ({ id: c, label: CANAL_LABEL[c] })),
      metas: { marcaciones: config.META_MARCACIONES_DIA, conversaciones: config.META_CONVERSACIONES_DIA },
      resultados: D.RESULTADOS_LLAMADA.map(r => ({ id: r, label: D.RESULTADO_LABEL[r] })),
      resultadoLabel: D.RESULTADO_LABEL,
      razones: D.RAZONES_DESCARTE.filter(r => r !== 'sin_respuesta').map(r => ({ id: r, label: D.RAZON_LABEL[r], definitiva: D.RAZONES_DEFINITIVAS.includes(r), reintento: (config.REINTENTO_POR_RAZON || {})[r] || null })),
      razonLabel: D.RAZON_LABEL,
      reintentoMeses: config.OPCIONES_REINTENTO_MESES || [1, 3, 6],
      usuarios: (config.USUARIOS || []).map(u => ({ nombre: u.nombre, rol: u.rol })),
      recordatorioGrabacion: config.RECORDATORIO_GRABACION || '',
      verTranscripcion: config.VER_TRANSCRIPCION || [],
    })],
    // Toque de Angie: llamada (con resultado obligatorio) o WhatsApp / correo / LinkedIn de un clic.
    ['post', '/api/leads/:id/toques', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return registrarToque(db, config, {
        leadId: params.id, canal: b.canal, resultado: b.resultado, razon: b.razon, nota: b.nota,
        detalle: b.detalle, taskId: b.task_id, callUuid: b.call_uuid, usuario: b.usuario, reintentoMeses: b.reintento_meses,
      });
    }],
    // Acciones de la ejecutiva comercial.
    ['post', '/api/leads/:id/ejecutiva', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return registrarEjecutiva(db, config, { leadId: params.id, accion: b.accion, razon: b.razon, nota: b.nota, usuario: b.usuario, reintentoMeses: b.reintento_meses });
    }],
    // Lista negra: ver, agregar a mano (descarta los leads que coincidan) y quitar.
    ['get', '/api/lista-negra', async () => { sinDb(); return LN.listar(db); }],
    ['post', '/api/lista-negra', async ({ body }) => { sinDb(); const b = body || {}; return agregarAListaNegra(db, config, { telefono: b.telefono, email: b.email, empresa: b.empresa, nota: b.nota, usuario: b.usuario }); }],
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
    ['get', '/api/llamadas/:id/transcripcion', async ({ params }) => { sinDb(); return P.transcripcionDeLlamada(db, params.id); }],
    ['post', '/api/llamadas/:id/reprocesar', async ({ params }) => { sinDb(); return P.reencolar(db, params.id); }],
    ['get', '/api/cola', async ({ query }) => { sinDb(); return consultarCola(db, config, { usuario: query.usuario || null }); }],
    ['post', '/api/tareas/:id/posponer', async ({ params, body }) => { sinDb(); return posponerTarea(db, config, { taskId: params.id, dias: (body || {}).dias }); }],
    ['get', '/api/semana', async ({ query }) => { sinDb(); return ritmo.resumenSemana(db, config, { fecha: /^\d{4}-\d{2}-\d{2}$/.test(query.fecha || '') ? query.fecha : undefined, usuario: query.usuario || null }); }],
    ['get', '/api/pipeline', async () => { sinDb(); return L.pipeline(db); }],
    ['get', '/api/leads', async ({ query }) => {
      sinDb();
      return L.listarLeads(db, { etapa: query.etapa, huerfanos: query.huerfanos === '1', pausados: query.pausados === '1', q: query.q });
    }],
    ['get', '/api/leads/:id', async ({ params }) => { sinDb(); return L.detalleLead(db, params.id); }],
    ['post', '/api/leads/:id/editar', async ({ params, body }) => { sinDb(); const b = body || {}; return L.editarLead(db, config, params.id, b, require('./resultados').usuarioValido(config, b.usuario)); }],
    // Fallos de marcación: lo que el operador no cursó, el reporte de Angie y la revisión de Santiago.
    ['get', '/api/llamadas/fallidas', async () => { sinDb(); return L.fallosDeMarcacion(db); }],
    ['post', '/api/llamadas/reportar', async ({ body }) => { sinDb(); const b = body || {}; return L.reportarLlamada(db, { uuid: b.uuid, leadId: b.lead_id, telefono: b.telefono, codigo: b.codigo, estado: b.estado, nota: b.nota, usuario: require('./resultados').usuarioValido(config, b.usuario) }); }],
    ['post', '/api/llamadas/:id/revisar', async ({ params, body }) => { sinDb(); return L.revisarFallo(db, params.id, (body || {}).revisado !== false); }],
    ['post', '/api/marcar', async ({ body }) => { sinDb(); const b = body || {}; return L.leadParaMarcar(db, config, { telefono: b.telefono, empresa: b.empresa, contacto: b.contacto }); }],
    ['get', '/api/cargas', async () => { sinDb(); return L.cargas(db); }],
    ['get', '/api/cargas/:id', async ({ params }) => { sinDb(); return L.detalleCarga(db, params.id); }],
    ['post', '/api/importar', async ({ body }) => {
      sinDb();
      const { archivo, contenido, base64, confirmar } = body || {};
      const entrada = base64 ? Buffer.from(String(base64), 'base64') : contenido;
      if (!entrada) throw Object.assign(new Error('Falta el contenido del archivo'), { status: 400 });
      return importar(db, config, { archivo, contenido: entrada, simular: !confirmar, usuario: (body || {}).usuario });
    }],
  ];
}

module.exports = { rutas };

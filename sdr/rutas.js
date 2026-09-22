// Tabla de rutas de la API, independiente del servidor. La usan el router de Express
// (producción) y el servidor de desarrollo sin dependencias (sdr/dev.js), así que las dos
// formas de correr el módulo no pueden divergir.
const { importar } = require('./importar');
const { consultarCola, posponerTarea } = require('./cola');
const L = require('./leads');
const D = require('./dominio');
const { registrarToque, registrarEjecutiva } = require('./resultados');
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
      razones: D.RAZONES_DESCARTE.filter(r => r !== 'sin_respuesta').map(r => ({ id: r, label: D.RAZON_LABEL[r] })),
      razonLabel: D.RAZON_LABEL,
      usuarios: (config.USUARIOS || []).map(u => ({ nombre: u.nombre, rol: u.rol })),
    })],
    // Toque de Angie: llamada (con resultado obligatorio) o WhatsApp / correo / LinkedIn de un clic.
    ['post', '/api/leads/:id/toques', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return registrarToque(db, config, {
        leadId: params.id, canal: b.canal, resultado: b.resultado, razon: b.razon, nota: b.nota,
        detalle: b.detalle, taskId: b.task_id, callUuid: b.call_uuid, usuario: b.usuario,
      });
    }],
    // Acciones de la ejecutiva comercial.
    ['post', '/api/leads/:id/ejecutiva', async ({ params, body }) => {
      sinDb();
      const b = body || {};
      return registrarEjecutiva(db, config, { leadId: params.id, accion: b.accion, razon: b.razon, nota: b.nota, usuario: b.usuario });
    }],
    // Telefonía (Voximplant)
    ['get', '/api/vox/config', async () => vox.configPublica(process.env)],
    ['post', '/api/vox/login-key', async ({ body }) => vox.firmarLogin(process.env, (body || {}).key)],
    ['post', '/api/vox/webhook', async ({ headers, body }) => { sinDb(); return vox.recibirWebhook(db, process.env, headers || {}, body); }],
    ['get', '/api/cola', async ({ query }) => { sinDb(); return consultarCola(db, config, { usuario: query.usuario || null }); }],
    ['post', '/api/tareas/:id/posponer', async ({ params, body }) => { sinDb(); return posponerTarea(db, config, { taskId: params.id, dias: (body || {}).dias }); }],
    ['get', '/api/semana', async ({ query }) => { sinDb(); return ritmo.resumenSemana(db, config, { fecha: /^\d{4}-\d{2}-\d{2}$/.test(query.fecha || '') ? query.fecha : undefined, usuario: query.usuario || null }); }],
    ['get', '/api/pipeline', async () => { sinDb(); return L.pipeline(db); }],
    ['get', '/api/leads', async ({ query }) => {
      sinDb();
      return L.listarLeads(db, { etapa: query.etapa, huerfanos: query.huerfanos === '1', q: query.q });
    }],
    ['get', '/api/leads/:id', async ({ params }) => { sinDb(); return L.detalleLead(db, params.id); }],
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

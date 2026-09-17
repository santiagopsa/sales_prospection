// Tabla de rutas de la API, independiente del servidor. La usan el router de Express
// (producción) y el servidor de desarrollo sin dependencias (sdr/dev.js), así que las dos
// formas de correr el módulo no pueden divergir.
const { importar } = require('./importar');
const { consultarCola } = require('./cola');
const L = require('./leads');
const { ETAPAS, ETAPA_LABEL, CANALES, CANAL_LABEL } = require('./dominio');

function rutas({ db, config }) {
  const sinDb = () => { if (!db) throw Object.assign(new Error('SDR necesita DATABASE_URL'), { status: 503 }); };
  return [
    ['get', '/api/meta', async () => ({
      etapas: ETAPAS.map(e => ({ id: e, label: ETAPA_LABEL[e] })),
      canales: CANALES.map(c => ({ id: c, label: CANAL_LABEL[c] })),
      metas: { marcaciones: config.META_MARCACIONES_DIA, conversaciones: config.META_CONVERSACIONES_DIA },
    })],
    ['get', '/api/cola', async () => { sinDb(); return consultarCola(db, config); }],
    ['get', '/api/pipeline', async () => { sinDb(); return L.pipeline(db); }],
    ['get', '/api/leads', async ({ query }) => {
      sinDb();
      return L.listarLeads(db, { etapa: query.etapa, huerfanos: query.huerfanos === '1', q: query.q });
    }],
    ['get', '/api/leads/:id', async ({ params }) => { sinDb(); return L.detalleLead(db, params.id); }],
    ['get', '/api/cargas', async () => { sinDb(); return L.cargas(db); }],
    ['get', '/api/cargas/:id', async ({ params }) => { sinDb(); return L.detalleCarga(db, params.id); }],
    ['post', '/api/importar', async ({ body }) => {
      sinDb();
      const { archivo, contenido, confirmar } = body || {};
      if (!contenido) throw Object.assign(new Error('Falta el contenido del archivo'), { status: 400 });
      return importar(db, config, { archivo, contenido, simular: !confirmar });
    }],
  ];
}

module.exports = { rutas };

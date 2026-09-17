// Esquema de SDR Coach.
// Vive en su propio schema de Postgres ("sdr") dentro de la MISMA base del Sandler, igual que
// /verificacion. Todas las consultas califican el schema: el pool es compartido y tocar
// search_path rompería las queries del Sandler a deals y wishlist.
//
// Mismo patrón de migración que el resto del repo: sentencias idempotentes que corren al
// arrancar. Lo que se agregue en fases siguientes va al final de MIGRACIONES, nunca editando
// una sentencia que ya corrió en producción.
const { ETAPAS, CANALES } = require('./dominio');

const SCHEMA = 'sdr';
const T = {
  imports: `${SCHEMA}.lead_imports`,
  leads: `${SCHEMA}.leads`,
  tasks: `${SCHEMA}.tasks`,
  touches: `${SCHEMA}.touches`,
};

const lista = xs => xs.map(x => `'${x}'`).join(',');

const MIGRACIONES = [
  `CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`,

  // Cada carga de CSV queda registrada con lo que pasó fila por fila (creados, duplicados y
  // por qué, errores). Así "subí 300 y solo entraron 180" tiene respuesta sin volver al archivo.
  `CREATE TABLE IF NOT EXISTS ${T.imports} (
     id SERIAL PRIMARY KEY,
     archivo TEXT,
     filas INT NOT NULL DEFAULT 0,
     creados INT NOT NULL DEFAULT 0,
     duplicados INT NOT NULL DEFAULT 0,
     con_error INT NOT NULL DEFAULT 0,
     detalle JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,

  // telefono y email se guardan normalizados (E.164 y minúsculas): son la llave de
  // deduplicación. Lo que venía en el archivo queda en telefono_original para auditar.
  // deal_id apunta a public.deals cuando el lead pasa a reunión agendada (fase 2).
  `CREATE TABLE IF NOT EXISTS ${T.leads} (
     id SERIAL PRIMARY KEY,
     empresa TEXT NOT NULL,
     contacto TEXT,
     cargo TEXT,
     telefono TEXT,
     telefono_original TEXT,
     email TEXT,
     ciudad TEXT,
     fuente TEXT,
     etapa TEXT NOT NULL DEFAULT 'nuevo' CHECK (etapa IN (${lista(ETAPAS)})),
     etapa_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     razon_descarte TEXT,
     deal_id INT,
     import_id INT REFERENCES ${T.imports}(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // Los índices únicos son la garantía real contra duplicados: el chequeo previo de la carga
  // explica el porqué, pero si dos cargas corren a la vez, la base es la que decide.
  `CREATE UNIQUE INDEX IF NOT EXISTS sdr_leads_telefono_uq ON ${T.leads}(telefono) WHERE telefono IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sdr_leads_email_uq ON ${T.leads}(email) WHERE email IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS sdr_leads_etapa ON ${T.leads}(etapa)`,

  // Las tareas de la secuencia se crean todas al cargar el lead. `paso` es la posición en la
  // secuencia; `canal` y `due_at` quedan copiados, así que cambiar la secuencia en config no
  // reescribe la historia de los leads ya cargados.
  `CREATE TABLE IF NOT EXISTS ${T.tasks} (
     id SERIAL PRIMARY KEY,
     lead_id INT NOT NULL REFERENCES ${T.leads}(id) ON DELETE CASCADE,
     paso INT NOT NULL,
     canal TEXT NOT NULL CHECK (canal IN (${lista(CANALES)})),
     due_at TIMESTAMPTZ NOT NULL,
     estado TEXT NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','hecha','omitida')),
     done_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (lead_id, paso)
   )`,
  `CREATE INDEX IF NOT EXISTS sdr_tasks_pendientes ON ${T.tasks}(due_at) WHERE estado = 'pendiente'`,

  // Un toque es lo que Angie hizo de verdad (llamó, mandó WhatsApp…), con su resultado.
  // La tarea es lo que la secuencia pedía. Se separan porque no siempre coinciden.
  // Se llena desde la fase 2.
  `CREATE TABLE IF NOT EXISTS ${T.touches} (
     id SERIAL PRIMARY KEY,
     lead_id INT NOT NULL REFERENCES ${T.leads}(id) ON DELETE CASCADE,
     task_id INT REFERENCES ${T.tasks}(id) ON DELETE SET NULL,
     canal TEXT NOT NULL CHECK (canal IN (${lista(CANALES)})),
     resultado TEXT,
     razon_descarte TEXT,
     nota TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS sdr_touches_lead ON ${T.touches}(lead_id, created_at)`,
];

async function initSchema(db, log = console) {
  if (!db) return false;
  for (const q of MIGRACIONES) {
    try { await db.query(q); }
    catch (e) { log.error('[sdr] migración:', e.message); throw e; }
  }
  log.log(`[sdr] schema "${SCHEMA}" listo`);
  return true;
}

module.exports = { SCHEMA, T, MIGRACIONES, initSchema };

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
  calls: `${SCHEMA}.calls`,
  lista_negra: `${SCHEMA}.lista_negra`,
  transcripts: `${SCHEMA}.transcripts`,
  rubricas: `${SCHEMA}.rubricas`,
  evaluations: `${SCHEMA}.evaluations`,
  focos: `${SCHEMA}.focos`,
  informes: `${SCHEMA}.informes_semana`,
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

  // ---- M2 · Llamadas (fase 2 y 3) -------------------------------------------------------
  // Una fila por llamada, venga del navegador (Voximplant) o registrada a mano. `uuid` lo
  // genera el navegador antes de marcar, y viaja en customData al escenario: así el resultado
  // que Angie registra al colgar y el webhook de Voximplant (que llega después, con la
  // grabación) caen en la misma fila aunque lleguen en cualquier orden.
  `CREATE TABLE IF NOT EXISTS ${T.calls} (
     id SERIAL PRIMARY KEY,
     uuid TEXT UNIQUE,
     lead_id INT NOT NULL REFERENCES ${T.leads}(id) ON DELETE CASCADE,
     touch_id INT REFERENCES ${T.touches}(id) ON DELETE SET NULL,
     origen TEXT NOT NULL DEFAULT 'manual' CHECK (origen IN ('voximplant','manual')),
     telefono TEXT,
     started_at TIMESTAMPTZ,
     answered_at TIMESTAMPTZ,
     ended_at TIMESTAMPTZ,
     duracion_s INT,
     vox_call_id TEXT,
     vox_estado TEXT,
     record_url TEXT,
     pipeline_status TEXT NOT NULL DEFAULT 'no_aplica',
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS sdr_calls_lead ON ${T.calls}(lead_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS sdr_calls_pipeline ON ${T.calls}(pipeline_status) WHERE pipeline_status <> 'no_aplica'`,
  // El toque de una llamada apunta a su fila de calls; el resultado vive en el toque.
  `ALTER TABLE ${T.touches} ADD COLUMN IF NOT EXISTS call_id INT REFERENCES ${T.calls}(id) ON DELETE SET NULL`,
  // Lo que Angie anota al agendar: fecha de la reunión y ficha para la ejecutiva. Va en el
  // toque porque es lo que se dijo en ESA llamada; el deal del Sandler recibe una copia.
  `ALTER TABLE ${T.touches} ADD COLUMN IF NOT EXISTS detalle JSONB`,
  `ALTER TABLE ${T.leads} ADD COLUMN IF NOT EXISTS reunion_at TIMESTAMPTZ`,
  // Las acciones de la ejecutiva (reunión realizada, no-show, calificado) quedan en el historial
  // del lead como toques con canal 'ejecutiva'. El CHECK original solo admitía los canales de Angie.
  `ALTER TABLE ${T.touches} DROP CONSTRAINT IF EXISTS touches_canal_check`,
  `ALTER TABLE ${T.touches} DROP CONSTRAINT IF EXISTS sdr_touches_canal_check`,
  `ALTER TABLE ${T.touches} ADD CONSTRAINT sdr_touches_canal_check CHECK (canal IN (${lista(CANALES)}, 'ejecutiva'))`,
  // Quién lo hizo (etiqueta elegida en la barra, sin credenciales).
  `ALTER TABLE ${T.touches} ADD COLUMN IF NOT EXISTS usuario TEXT`,
  `ALTER TABLE ${T.imports} ADD COLUMN IF NOT EXISTS usuario TEXT`,
  // Contexto del contacto que trae el archivo (Apollo: industria, empleados, LinkedIn, país…).
  `ALTER TABLE ${T.leads} ADD COLUMN IF NOT EXISTS extra JSONB`,
  // Lead en pausa ("no ahora"): fuera de la cola hasta esta fecha, cuando su secuencia de reintento
  // lo trae de vuelta sola. NULL = no está en pausa.
  `ALTER TABLE ${T.leads} ADD COLUMN IF NOT EXISTS pausado_hasta TIMESTAMPTZ`,
  // Lista negra: teléfonos y correos que no se vuelven a tocar. Los llena "pidió que no lo
  // contacten" y la mano. Las cargas los dejan fuera y la marcación directa los rechaza.
  `CREATE TABLE IF NOT EXISTS ${T.lista_negra} (
     id SERIAL PRIMARY KEY,
     telefono TEXT,
     email TEXT,
     empresa TEXT,
     razon TEXT,
     nota TEXT,
     lead_id INT REFERENCES ${T.leads}(id) ON DELETE SET NULL,
     usuario TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CHECK (telefono IS NOT NULL OR email IS NOT NULL)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sdr_lista_negra_tel ON ${T.lista_negra}(telefono) WHERE telefono IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS sdr_lista_negra_email ON ${T.lista_negra}(email) WHERE email IS NOT NULL`,
  // ---- M3b · Fallos de marcación y datos editables ---------------------------------------
  // Código SIP y motivo que devolvió el operador, intentos que hizo el escenario, y el reporte
  // de Angie ("desde el celular sí entra") con su revisión.
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS vox_codigo TEXT`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS vox_motivo TEXT`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS vox_intentos INT`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS reporte TEXT`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS reportado_at TIMESTAMPTZ`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS revisado_at TIMESTAMPTZ`,
  // Segundo teléfono del lead (el principal sigue siendo la llave de deduplicación).
  `ALTER TABLE ${T.leads} ADD COLUMN IF NOT EXISTS telefono_alt TEXT`,

  // ---- M3c · Compromisos (tareas con hora que nacen de una conversación) y calendario ----------
  // tipo: 'secuencia' (los toques de la cadencia) o un tipo de TIPOS_COMPROMISO. Un compromiso
  // puede no tener lead (una tarea suelta del día). El evento de Google Calendar queda enlazado
  // por gcal_event_id en el calendario de gcal_usuario.
  `ALTER TABLE ${T.tasks} ALTER COLUMN lead_id DROP NOT NULL`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS tipo TEXT NOT NULL DEFAULT 'secuencia'`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS titulo TEXT`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS nota TEXT`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS con_hora BOOLEAN NOT NULL DEFAULT false`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS usuario TEXT`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS creado_por TEXT`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS gcal_event_id TEXT`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS gcal_usuario TEXT`,
  `ALTER TABLE ${T.tasks} ADD COLUMN IF NOT EXISTS gcal_error TEXT`,
  `CREATE INDEX IF NOT EXISTS sdr_tasks_compromisos ON ${T.tasks}(due_at) WHERE estado = 'pendiente' AND tipo <> 'secuencia'`,

  // ---- M4 · Pipeline de audio ------------------------------------------------------------
  // Estados de calls.pipeline_status: no_aplica (manual / sin resultado con conversación),
  // pendiente_resultado (llegó el webhook, falta el resultado), pendiente (lista para transcribir),
  // transcribiendo, transcrito, omitida (corta o sin conversación), error.
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS pipeline_error TEXT`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS pipeline_intentos INT NOT NULL DEFAULT 0`,
  `ALTER TABLE ${T.calls} ADD COLUMN IF NOT EXISTS pipeline_at TIMESTAMPTZ`,
  // Una transcripción por llamada: turnos [{quien, inicio, fin, texto, palabras}] con quién habló
  // (canal estéreo), el texto plano y las métricas calculadas (se recalculan sin volver a transcribir).
  `CREATE TABLE IF NOT EXISTS ${T.transcripts} (
     id SERIAL PRIMARY KEY,
     call_id INT NOT NULL UNIQUE REFERENCES ${T.calls}(id) ON DELETE CASCADE,
     proveedor TEXT NOT NULL DEFAULT 'deepgram',
     modelo TEXT,
     idioma TEXT,
     duracion_s REAL,
     turnos JSONB NOT NULL,
     texto TEXT,
     metricas JSONB,
     meta JSONB,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  // ---- M5 · Rúbrica, evaluaciones y mejora semanal ---------------------------------------
  // Una rúbrica es una versión inmutable (sdr/rubrica/v1.js). Cada evaluación queda atada a la
  // versión con la que se hizo, así las comparaciones entre semanas son justas.
  `CREATE TABLE IF NOT EXISTS ${T.rubricas} (
     id SERIAL PRIMARY KEY,
     version TEXT NOT NULL UNIQUE,
     fuentes TEXT,
     criterios JSONB NOT NULL,
     reglas JSONB NOT NULL,
     activa BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE TABLE IF NOT EXISTS ${T.evaluations} (
     id SERIAL PRIMARY KEY,
     call_id INT NOT NULL REFERENCES ${T.calls}(id) ON DELETE CASCADE,
     rubrica_version TEXT NOT NULL REFERENCES ${T.rubricas}(version),
     modelo TEXT,
     resultado JSONB NOT NULL,
     avisos JSONB,
     tokens_in INT,
     tokens_out INT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (call_id, rubrica_version)
   )`,
  // El foco de mejora: un criterio por FOCO_SEMANAS semanas, propuesto por el sistema y confirmado
  // por Angie desde la app. tasa_inicial es la tasa de "no cumple" cuando se propuso.
  `CREATE TABLE IF NOT EXISTS ${T.focos} (
     id SERIAL PRIMARY KEY,
     usuario TEXT NOT NULL,
     criterio TEXT NOT NULL,
     rubrica_version TEXT NOT NULL,
     desde DATE NOT NULL,
     hasta DATE NOT NULL,
     tasa_inicial REAL,
     llamadas_inicial INT,
     propuesto_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     confirmado_at TIMESTAMPTZ,
     cerrado_at TIMESTAMPTZ,
     nota TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS sdr_focos_usuario ON ${T.focos}(usuario, desde)`,
  // Foto del informe semanal (el job del viernes la guarda; la vista puede recalcular en vivo).
  `CREATE TABLE IF NOT EXISTS ${T.informes} (
     id SERIAL PRIMARY KEY,
     semana DATE NOT NULL,
     usuario TEXT NOT NULL,
     datos JSONB NOT NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     UNIQUE (semana, usuario)
   )`,
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

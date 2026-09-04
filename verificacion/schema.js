// Esquema de PeakU Verificado.
// Vive en su propio schema de Postgres ("verificacion") dentro de la MISMA base del Sandler.
// Todas las consultas califican el schema explícitamente: el pool es compartido con el Sandler,
// así que NO se puede tocar search_path — eso rompería sus queries a deals y wishlist.
const SCHEMA = process.env.VERIF_SCHEMA || 'verificacion';

const T = {
  companies:    `${SCHEMA}.companies`,
  vacancies:    `${SCHEMA}.vacancies`,
  requirements: `${SCHEMA}.requirements`,
  sessions:     `${SCHEMA}.sessions`,
  ratings:      `${SCHEMA}.ratings`,
};

async function initSchema(pool) {
  if (!pool) return false;

  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T.companies} (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      sector TEXT,
      contact TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T.vacancies} (
      id SERIAL PRIMARY KEY,
      company_id INT REFERENCES ${T.companies}(id) ON DELETE CASCADE,
      title TEXT NOT NULL,
      seniority TEXT,
      modality TEXT,
      city TEXT,
      salary_text TEXT,
      salary_min NUMERIC,
      salary_max NUMERIC,
      currency TEXT,
      context TEXT,
      urgency TEXT,
      recruiter TEXT,
      source_type TEXT,
      source_text TEXT,
      ai_raw JSONB,
      suggested_mode TEXT,
      status TEXT DEFAULT 'activa',
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T.requirements} (
      id SERIAL PRIMARY KEY,
      vacancy_id INT REFERENCES ${T.vacancies}(id) ON DELETE CASCADE,
      ord INT DEFAULT 0,
      text TEXT NOT NULL,
      kind TEXT DEFAULT 'excluyente',
      years INT,
      evidence_quote TEXT,
      criterio TEXT,
      detalles JSONB,
      q_escena TEXT,
      q_friccion TEXT,
      q_cruce TEXT,
      senales JSONB,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T.sessions} (
      id SERIAL PRIMARY KEY,
      vacancy_id INT REFERENCES ${T.vacancies}(id) ON DELETE SET NULL,
      report_code TEXT UNIQUE,
      candidate TEXT NOT NULL,
      candidate_email TEXT,
      evaluator TEXT,
      mode TEXT DEFAULT 'B',
      status TEXT DEFAULT 'draft',
      semaforo TEXT,
      identity JSONB,
      signals JSONB,
      data JSONB,
      integrity_hash TEXT,
      started_at TIMESTAMPTZ,
      issued_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${T.ratings} (
      id SERIAL PRIMARY KEY,
      session_id INT REFERENCES ${T.sessions}(id) ON DELETE CASCADE,
      requirement_id INT REFERENCES ${T.requirements}(id) ON DELETE SET NULL,
      req_text TEXT,
      ord INT DEFAULT 0,
      level INT,
      verdict TEXT,
      evidence TEXT
    );
  `);

  // Migraciones incrementales — seguras aunque ya existan.
  const alters = [
    // Tipo de sesión: 'sondeo' (primera entrevista, sin identidad) o 'cierre' (finalista, con identidad)
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS kind TEXT DEFAULT 'sondeo'`,
    // Verificación de identidad con Didit
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS didit_session_id TEXT`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS didit_url TEXT`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS didit_status TEXT`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS didit_at TIMESTAMPTZ`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS id_doc JSONB`,
    // El pantallazo de la entrevista vive aquí solo hasta que el face match lo usa; después se borra.
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS shot BYTEA`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS shot_mime TEXT`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS shot_at TIMESTAMPTZ`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS face_score NUMERIC`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS face_verdict TEXT`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS face_at TIMESTAMPTZ`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS id_note TEXT`,
    // Lo que el candidato declara y la recomendación del evaluador: alimentan el acta.
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS declara JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS recomendacion JSONB`,
    `CREATE INDEX IF NOT EXISTS idx_v_sess_code ON ${T.sessions}(report_code)`,
    // Lo extraído del CV: preguntas por requisito, trayectoria y puntos a aclarar.
    // El texto del CV NO se guarda — es dato personal y ya cumplió su función al analizarse.
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS cv_analisis JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS cv_at TIMESTAMPTZ`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS trayectoria JSONB`,
    // Un documento emitido no puede cambiar porque el software evolucionó. Al emitir se congela
    // todo lo que el acta necesita para volver a dibujarse igual, y de ahí se lee después.
    // La firma de integridad promete justamente eso: que el documento no fue alterado.
    // La entrevista y la calificación dejaron de ser el mismo momento. El reclutador
    // entrevista sin escribir, la llamada termina, y minutos después llega la transcripción
    // de Google. Entre esos dos momentos la sesión vive aquí, y tiene que poder cerrarse
    // y retomarse: la transcripción no está lista cuando uno cuelga.
    // El texto de la transcripción NO se guarda — es dato personal y ya cumplió su función
    // al analizarse. Lo que queda son las citas de evidencia, que son las que van al acta.
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS transcript_analisis JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS transcript_at TIMESTAMPTZ`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS entrevista_at TIMESTAMPTZ`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS snapshot JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS formato TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_v_sess_didit ON ${T.sessions}(didit_session_id)`,
    // El inglés no es un requisito más: no se mide preguntando "¿hablas inglés?" sino
    // pasando un tramo de la entrevista a inglés y viendo si lo sostiene. Vive en la
    // vacante porque el nivel que exige el cargo lo define el cliente, no el candidato.
    `ALTER TABLE ${T.vacancies} ADD COLUMN IF NOT EXISTS ingles_requerido BOOLEAN DEFAULT FALSE`,
    `ALTER TABLE ${T.vacancies} ADD COLUMN IF NOT EXISTS ingles_nivel TEXT`,
    `ALTER TABLE ${T.vacancies} ADD COLUMN IF NOT EXISTS ingles_uso TEXT`,
    `ALTER TABLE ${T.vacancies} ADD COLUMN IF NOT EXISTS ingles_cita TEXT`,
    // Lo observado en la sesión, que es lo que va al acta.
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS ingles JSONB`,
    `ALTER TABLE ${T.vacancies} ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ`,
    // El perfil de conducta: qué rasgos necesita ESTE cargo (en la vacante) y qué mostró
    // el candidato respecto a ellos (en la sesión). Dos candidatos pueden cumplir los mismos
    // tres requisitos y uno fracasar; lo que los separa es esto, y hasta ahora no se medía.
    // `impacto` son las tarjetas de capacidad que salen de la conversación, no del CV: el
    // CV lo escribió el candidato, la conversación la sostuvo delante de un evaluador.
    `ALTER TABLE ${T.vacancies} ADD COLUMN IF NOT EXISTS perfil JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS perfil JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS impacto JSONB`,
    // La sesión dura 30 minutos, así que se verifica UN empleo: el más reciente. Vive aparte
    // de `trayectoria` —que es lo que el CV declara— porque son dos cosas distintas: una la
    // escribió el candidato y la otra la sostuvo delante de un evaluador.
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS experiencia JSONB`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS reviewed_by TEXT`,
    `ALTER TABLE ${T.sessions} ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ`,

    // El informe del cliente dejó de pegar la cita cruda de la transcripción y pasó a
    // explicar el veredicto. `analisis` es esa explicación y `falta` lo que quedó sin
    // comprobar. `evidence` se conserva: es el rastro de auditoría, no el texto que se lee.
    `ALTER TABLE ${T.ratings} ADD COLUMN IF NOT EXISTS analisis TEXT`,
    `ALTER TABLE ${T.ratings} ADD COLUMN IF NOT EXISTS falta TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_v_req_vacancy ON ${T.requirements}(vacancy_id)`,
    `CREATE INDEX IF NOT EXISTS idx_v_sess_vacancy ON ${T.sessions}(vacancy_id)`,
    `CREATE INDEX IF NOT EXISTS idx_v_rat_session ON ${T.ratings}(session_id)`,
  ];
  for (const q of alters) {
    try { await pool.query(q); } catch (e) { console.error('[verificacion] migración:', e.message); }
  }
  console.log(`[verificacion] schema "${SCHEMA}" listo`);
  return true;
}

module.exports = { SCHEMA, T, initSchema };

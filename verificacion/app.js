// PeakU · Consola de Verificación — módulo montable
//
// Se monta sobre el servidor del Sandler y comparte su pool de Postgres.
// En server.js del Sandler, antes del SPA fallback:
//
//   const verificacion = require('./verificacion/app');
//   app.use('/verificacion', verificacion.router({ pool, anthropic, model: ANALYZE_MODEL }));
//   verificacion.initSchema(pool).catch(e => console.error('[verificacion]', e.message));
//
// No toca deals ni wishlist: sus tablas viven en el schema "verificacion".
const express = require('express');
const path = require('path');
const { buildIntakePrompt } = require('./prompts');
const { LVLTXT, clean, esCierre, semaforo, estadoIdentidad, bloqueos, tipoDocumento, integrityHash, reportCode } = require('./rules');
const didit = require('./didit');
const { T, initSchema } = require('./schema');

// Fallback en memoria para correr sin Postgres (pruebas locales). Se pierde al reiniciar.
const mem = { companies: [], vacancies: [], requirements: [], sessions: [], ratings: [], seq: 1 };
const nextId = () => mem.seq++;

// --- Auxiliares de identidad -------------------------------------------------

async function leerSesion(pool, id) {
  if (pool) {
    const q = await pool.query(
      `SELECT id, report_code, candidate, candidate_email, kind, didit_session_id, didit_status,
              face_verdict, face_score, id_note, shot_mime
       FROM ${T.sessions} WHERE id=$1`, [id]);
    return q.rows[0] || null;
  }
  return mem.sessions.find(x => x.id === id) || null;
}

async function leerCaptura(pool, id) {
  if (pool) {
    const q = await pool.query(`SELECT shot, shot_mime FROM ${T.sessions} WHERE id=$1`, [id]);
    if (!q.rows.length || !q.rows[0].shot) return null;
    return { buffer: q.rows[0].shot, mime: q.rows[0].shot_mime || 'image/jpeg' };
  }
  const s = mem.sessions.find(x => x.id === id);
  return s && s.shot ? { buffer: s.shot, mime: s.shot_mime || 'image/jpeg' } : null;
}

async function buscarPorDidit(pool, diditSessionId) {
  if (pool) {
    const q = await pool.query(`SELECT id FROM ${T.sessions} WHERE didit_session_id=$1 LIMIT 1`, [diditSessionId]);
    return q.rows.length ? q.rows[0].id : null;
  }
  const s = mem.sessions.find(x => x.didit_session_id === diditSessionId);
  return s ? s.id : null;
}

/**
 * Cierra el círculo: recupera la decisión de Didit y, si quedó aprobada, compara el rostro
 * de la entrevista contra el de la verificación. Si coinciden, la persona que respondió
 * es la persona verificada — que es lo único que el KYC por sí solo no puede afirmar.
 *
 * Al terminar borra la captura: ya cumplió su función y es un dato biométrico.
 */
async function procesarIdentidad(pool, body) {
  const diditId = body.session_id;
  if (!diditId) throw new Error('el webhook no traía session_id');
  const id = await buscarPorDidit(pool, diditId);
  if (!id) { console.warn('[verificacion/didit] sesión desconocida:', diditId); return { ignorada: true }; }

  const d = await didit.decision(diditId);
  let veredicto = null, score = null;

  if (d.status === 'Approved' && d.imagenRostro) {
    const captura = await leerCaptura(pool, id);
    if (captura) {
      try {
        const kyc = await didit.bajarImagen(d.imagenRostro);
        const fm = await didit.faceMatch(captura, kyc, {
          vendorData: String(id),
          metadata: { origen: 'peaku-verificacion' },
        });
        veredicto = fm.veredicto;
        score = fm.score;
        console.log(`[verificacion/didit] sesión ${id}: cotejo ${veredicto} (${score})`);
      } catch (e) {
        console.error('[verificacion/didit] face match falló:', e.message);
      }
    } else {
      console.warn(`[verificacion/didit] sesión ${id}: aprobada pero sin captura de la entrevista`);
    }
  }

  await guardarIdentidad(pool, id, {
    diditStatus: d.status,
    veredicto, score,
    documento: d.documento,
    // La captura se borra en cuanto el cotejo termina (o falla de forma definitiva).
    borrarCaptura: d.status === 'Approved' || d.status === 'Declined',
  });
  return { sesion: id, diditStatus: d.status, veredicto, score };
}

async function guardarIdentidad(pool, id, { diditStatus, veredicto, score, documento, borrarCaptura }) {
  if (pool) {
    await pool.query(
      `UPDATE ${T.sessions}
         SET didit_status=$2, didit_at=NOW(),
             face_verdict=COALESCE($3, face_verdict),
             face_score=COALESCE($4, face_score),
             face_at=CASE WHEN $3 IS NULL THEN face_at ELSE NOW() END,
             id_doc=COALESCE($5::jsonb, id_doc),
             shot=CASE WHEN $6 THEN NULL ELSE shot END,
             shot_mime=CASE WHEN $6 THEN NULL ELSE shot_mime END,
             updated_at=NOW()
       WHERE id=$1`,
      [id, diditStatus, veredicto, score, documento ? JSON.stringify(documento) : null, !!borrarCaptura]);
    return;
  }
  const s = mem.sessions.find(x => x.id === id);
  if (!s) return;
  s.didit_status = diditStatus;
  if (veredicto) { s.face_verdict = veredicto; s.face_score = score; }
  if (documento) s.id_doc = documento;
  if (borrarCaptura) { s.shot = null; s.shot_mime = null; }
}

function router({ pool = null, anthropic = null, model = 'claude-opus-4-8' } = {}) {
  const r = express.Router();

  // Body parser propio: los archivos llegan en base64 y pesan más que un transcript.
  // No toca el límite del servidor que lo monta.
  r.use(express.json({ limit: '12mb' }));

  // Con el mount point sin slash final, las rutas relativas del HTML resolverían
  // contra el nivel de arriba. Se fuerza el slash.
  r.get('/', (req, res, next) => {
    if (!req.originalUrl.split('?')[0].endsWith('/')) {
      const [p, q] = req.originalUrl.split('?');
      return res.redirect(301, p + '/' + (q ? '?' + q : ''));
    }
    next();
  });

  r.use(express.static(path.join(__dirname, 'public')));

  // -------------------------------------------------------------------------
  // EXTRAER TEXTO DE UN ARCHIVO
  // El frontend manda el archivo en base64 para no depender de multipart.
  // -------------------------------------------------------------------------
  r.post('/api/extract-text', async (req, res) => {
    try {
      const { filename, dataBase64 } = req.body || {};
      if (!dataBase64) return res.status(400).json({ error: 'falta el archivo' });
      const buf = Buffer.from(dataBase64, 'base64');
      const ext = (filename || '').toLowerCase().split('.').pop();

      let text = '';
      if (['txt', 'md', 'vtt', 'srt', 'csv', 'json', 'log'].includes(ext)) {
        text = buf.toString('utf8');
      } else if (ext === 'docx') {
        let mammoth;
        try { mammoth = require('mammoth'); }
        catch (e) { return res.status(501).json({ error: 'Para leer .docx falta instalar mammoth (npm install mammoth). Mientras tanto, abre el Word, copia el texto y pégalo.' }); }
        text = (await mammoth.extractRawText({ buffer: buf })).value || '';
      } else if (ext === 'pdf') {
        let pdfParse;
        try { pdfParse = require('pdf-parse/lib/pdf-parse.js'); }
        catch (e) { return res.status(501).json({ error: 'Para leer .pdf falta instalar pdf-parse (npm install pdf-parse). Mientras tanto, abre el PDF, copia el texto y pégalo.' }); }
        text = (await pdfParse(buf)).text || '';
      } else {
        text = buf.toString('utf8');
        if (/�/.test(text.slice(0, 2000))) {
          return res.status(415).json({ error: `No sé leer archivos .${ext}. Usa .txt, .docx, .pdf, .vtt o pega el texto.` });
        }
      }

      // Subtítulos: quitar marcas de tiempo de VTT/SRT.
      if (ext === 'vtt' || ext === 'srt') {
        text = text
          .replace(/^WEBVTT.*$/gm, '')
          .replace(/^\d+$/gm, '')
          .replace(/^[\d:.,]+\s*-->\s*[\d:.,]+.*$/gm, '')
          .replace(/\n{3,}/g, '\n\n');
      }

      text = text.replace(/\r\n/g, '\n').trim();
      res.json({ ok: true, text, chars: text.length });
    } catch (e) {
      console.error('[verificacion/extract]', e.message);
      res.status(500).json({ error: 'No se pudo leer el archivo: ' + e.message });
    }
  });

  // -------------------------------------------------------------------------
  // LEVANTAMIENTO: Claude lee la transcripción o el JD y arma la ficha
  // -------------------------------------------------------------------------
  r.post('/api/intake/analyze', async (req, res) => {
    try {
      if (!anthropic) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });
      const { sourceText, sourceType, companyHint, roleHint, recruiter } = req.body || {};
      if (!sourceText || sourceText.trim().length < 200) {
        return res.status(400).json({ error: 'El texto está vacío o es muy corto (mínimo 200 caracteres).' });
      }
      const msg = await anthropic.messages.create({
        model,
        max_tokens: 8000,
        messages: [{ role: 'user', content: buildIntakePrompt(sourceText, { sourceType, companyHint, roleHint, recruiter }) }],
      });
      const text = (msg.content && msg.content[0] && msg.content[0].text) || '';
      let jsonText = text.trim();
      const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenced) jsonText = fenced[1].trim();
      let parsed;
      try { parsed = JSON.parse(jsonText); }
      catch (e) {
        console.error('[verificacion/llm] JSON inválido:', e.message, '\n', text.slice(0, 500));
        return res.status(502).json({ error: 'Claude devolvió JSON inválido', raw: text.slice(0, 2000) });
      }
      parsed._usage = msg.usage;
      parsed._model = model;
      res.json(parsed);
    } catch (e) {
      console.error('[verificacion/llm]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // -------------------------------------------------------------------------
  // VACANTES
  // -------------------------------------------------------------------------
  r.post('/api/vacancies', async (req, res) => {
    try {
      const b = req.body || {};
      const emp = b.empresa || {}, vac = b.vacante || {};
      const reqs = Array.isArray(b.excluyentes) ? b.excluyentes.filter(x => clean(x.requisito)) : [];
      if (!clean(emp.nombre)) return res.status(400).json({ error: 'Falta el nombre de la empresa' });
      if (!clean(vac.titulo)) return res.status(400).json({ error: 'Falta el título del cargo' });
      if (!reqs.length) return res.status(400).json({ error: 'Se necesita al menos un requisito excluyente' });

      if (pool) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          let companyId;
          const found = await c.query(`SELECT id FROM ${T.companies} WHERE LOWER(TRIM(name))=LOWER(TRIM($1)) LIMIT 1`, [emp.nombre]);
          if (found.rows.length) {
            companyId = found.rows[0].id;
            await c.query(`UPDATE ${T.companies} SET sector=COALESCE(NULLIF($2,''),sector), contact=COALESCE(NULLIF($3,''),contact) WHERE id=$1`,
              [companyId, clean(emp.sector), clean(emp.contacto)]);
          } else {
            const ins = await c.query(`INSERT INTO ${T.companies} (name, sector, contact) VALUES ($1,$2,$3) RETURNING id`,
              [clean(emp.nombre), clean(emp.sector) || null, clean(emp.contacto) || null]);
            companyId = ins.rows[0].id;
          }

          const v = await c.query(
            `INSERT INTO ${T.vacancies} (company_id,title,seniority,modality,city,salary_text,salary_min,salary_max,currency,
                                         context,urgency,recruiter,source_type,source_text,ai_raw,suggested_mode)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
            [companyId, clean(vac.titulo), clean(vac.seniority) || null, clean(vac.modalidad) || null,
             clean(vac.ciudad) || null, clean(vac.salario_texto) || null,
             vac.salario_min ?? null, vac.salario_max ?? null, clean(vac.moneda) || null,
             clean(vac.contexto) || null, clean(vac.urgencia) || null, clean(b.recruiter) || null,
             clean(b.sourceType) || null, clean(b.sourceText) || null,
             b.aiRaw ? JSON.stringify(b.aiRaw) : null, clean(b.modalidad_sugerida) || null]
          );
          const vacancyId = v.rows[0].id;

          for (let i = 0; i < reqs.length; i++) {
            const q = reqs[i];
            await c.query(
              `INSERT INTO ${T.requirements} (vacancy_id,ord,text,kind,years,evidence_quote,criterio,detalles,q_escena,q_friccion,q_cruce,senales)
               VALUES ($1,$2,$3,'excluyente',$4,$5,$6,$7,$8,$9,$10,$11)`,
              [vacancyId, i, clean(q.requisito), q.anos_experiencia ?? null, clean(q.evidencia_cita) || null,
               clean(q.criterio_cumple) || null, JSON.stringify(q.detalles_verificables || []),
               clean(q.pregunta_escena) || null, clean(q.pregunta_friccion) || null, clean(q.pregunta_cruce) || null,
               JSON.stringify(q.senales_impostor || [])]
            );
          }
          await c.query('COMMIT');
          return res.json({ ok: true, id: vacancyId, company_id: companyId });
        } catch (e) { await c.query('ROLLBACK'); throw e; }
        finally { c.release(); }
      }

      // memoria
      let company = mem.companies.find(x => x.name.toLowerCase().trim() === clean(emp.nombre).toLowerCase());
      if (!company) { company = { id: nextId(), name: clean(emp.nombre), sector: clean(emp.sector), contact: clean(emp.contacto) }; mem.companies.push(company); }
      const vv = {
        id: nextId(), company_id: company.id, company_name: company.name, title: clean(vac.titulo),
        seniority: clean(vac.seniority), modality: clean(vac.modalidad), city: clean(vac.ciudad),
        salary_text: clean(vac.salario_texto), context: clean(vac.contexto), urgency: clean(vac.urgencia),
        recruiter: clean(b.recruiter), source_type: clean(b.sourceType), source_text: clean(b.sourceText),
        ai_raw: b.aiRaw || null, suggested_mode: clean(b.modalidad_sugerida), status: 'activa',
        created_at: new Date().toISOString(),
      };
      mem.vacancies.push(vv);
      reqs.forEach((q, i) => mem.requirements.push({
        id: nextId(), vacancy_id: vv.id, ord: i, text: clean(q.requisito), kind: 'excluyente',
        years: q.anos_experiencia ?? null, evidence_quote: clean(q.evidencia_cita), criterio: clean(q.criterio_cumple),
        detalles: q.detalles_verificables || [], q_escena: clean(q.pregunta_escena),
        q_friccion: clean(q.pregunta_friccion), q_cruce: clean(q.pregunta_cruce), senales: q.senales_impostor || [],
      }));
      res.json({ ok: true, id: vv.id, company_id: company.id });
    } catch (e) {
      console.error('[verificacion/vacancies]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/api/vacancies', async (_req, res) => {
    try {
      if (pool) {
        const q = await pool.query(`
          SELECT v.id, v.title, v.seniority, v.modality, v.city, v.status, v.suggested_mode,
                 v.recruiter, v.created_at, c.name AS company_name, c.id AS company_id,
                 (SELECT COUNT(*) FROM ${T.requirements} q WHERE q.vacancy_id=v.id)::int AS req_count,
                 (SELECT COUNT(*) FROM ${T.sessions} s WHERE s.vacancy_id=v.id)::int AS session_count
          FROM ${T.vacancies} v LEFT JOIN ${T.companies} c ON c.id=v.company_id
          ORDER BY v.created_at DESC LIMIT 200`);
        return res.json(q.rows);
      }
      res.json(mem.vacancies.slice().reverse().map(v => ({
        ...v,
        req_count: mem.requirements.filter(q => q.vacancy_id === v.id).length,
        session_count: mem.sessions.filter(s => s.vacancy_id === v.id).length,
      })));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/api/vacancies/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (pool) {
        const v = await pool.query(`
          SELECT v.*, c.name AS company_name, c.sector, c.contact
          FROM ${T.vacancies} v LEFT JOIN ${T.companies} c ON c.id=v.company_id WHERE v.id=$1`, [id]);
        if (!v.rows.length) return res.status(404).json({ error: 'not found' });
        const q = await pool.query(`SELECT * FROM ${T.requirements} WHERE vacancy_id=$1 ORDER BY ord, id`, [id]);
        return res.json({ ...v.rows[0], requirements: q.rows });
      }
      const v = mem.vacancies.find(x => x.id === id);
      if (!v) return res.status(404).json({ error: 'not found' });
      res.json({ ...v, requirements: mem.requirements.filter(q => q.vacancy_id === id).sort((a, b) => a.ord - b.ord) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.delete('/api/vacancies/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (pool) {
        const q = await pool.query(`DELETE FROM ${T.vacancies} WHERE id=$1 RETURNING id`, [id]);
        if (!q.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json({ ok: true, id });
      }
      const i = mem.vacancies.findIndex(x => x.id === id);
      if (i === -1) return res.status(404).json({ error: 'not found' });
      mem.vacancies.splice(i, 1);
      mem.requirements = mem.requirements.filter(q => q.vacancy_id !== id);
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // -------------------------------------------------------------------------
  // SESIONES
  // -------------------------------------------------------------------------
  r.post('/api/sessions', async (req, res) => {
    try {
      const b = req.body || {};
      if (!clean(b.candidate)) return res.status(400).json({ error: 'Falta el nombre del candidato' });
      const code = reportCode();
      const vacancyId = b.vacancy_id ? Number(b.vacancy_id) : null;
      const kind = b.kind === 'cierre' ? 'cierre' : 'sondeo';
      if (pool) {
        const q = await pool.query(
          `INSERT INTO ${T.sessions} (vacancy_id, report_code, candidate, candidate_email, evaluator, mode, kind, status, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',NOW()) RETURNING id, report_code, kind, started_at`,
          [vacancyId, code, clean(b.candidate), clean(b.candidate_email) || null, clean(b.evaluator) || null, b.mode === 'A' ? 'A' : 'B', kind]
        );
        return res.json({ ok: true, ...q.rows[0] });
      }
      const s = {
        id: nextId(), vacancy_id: vacancyId, report_code: code, candidate: clean(b.candidate),
        candidate_email: clean(b.candidate_email), evaluator: clean(b.evaluator), mode: b.mode === 'A' ? 'A' : 'B',
        kind, status: 'draft', identity: {}, signals: {}, data: {}, started_at: new Date().toISOString(),
      };
      mem.sessions.push(s);
      res.json({ ok: true, id: s.id, report_code: s.report_code, kind, started_at: s.started_at });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // -------------------------------------------------------------------------
  // IDENTIDAD (solo en sesiones de cierre)
  //
  // El candidato no muestra ningún documento en la llamada. Lo único que pasa durante
  // la entrevista es una captura de su rostro; el KYC va después, por su cuenta, desde
  // el celular. Al volver el resultado, cotejamos las dos caras.
  // -------------------------------------------------------------------------

  // Guarda el pantallazo del video. Llega en base64 ya reducido por el navegador.
  r.post('/api/sessions/:id/shot', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const { dataBase64, mime } = req.body || {};
      if (!dataBase64) return res.status(400).json({ error: 'falta la imagen' });
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length > 3 * 1024 * 1024) return res.status(413).json({ error: 'La captura pesa más de 3 MB.' });
      const tipo = (mime || 'image/jpeg').startsWith('image/') ? mime : 'image/jpeg';

      if (pool) {
        const q = await pool.query(
          `UPDATE ${T.sessions} SET shot=$2, shot_mime=$3, shot_at=NOW(), updated_at=NOW() WHERE id=$1 RETURNING id`,
          [id, buf, tipo]);
        if (!q.rows.length) return res.status(404).json({ error: 'not found' });
      } else {
        const s = mem.sessions.find(x => x.id === id);
        if (!s) return res.status(404).json({ error: 'not found' });
        Object.assign(s, { shot: buf, shot_mime: tipo, shot_at: new Date().toISOString() });
      }
      res.json({ ok: true, bytes: buf.length });
    } catch (e) {
      console.error('[verificacion/shot]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Devuelve la captura para poder revisarla (mientras siga guardada).
  r.get('/api/sessions/:id/shot', async (req, res) => {
    try {
      const id = Number(req.params.id);
      let buf = null, mime = 'image/jpeg';
      if (pool) {
        const q = await pool.query(`SELECT shot, shot_mime FROM ${T.sessions} WHERE id=$1`, [id]);
        if (q.rows.length && q.rows[0].shot) { buf = q.rows[0].shot; mime = q.rows[0].shot_mime || mime; }
      } else {
        const s = mem.sessions.find(x => x.id === id);
        if (s && s.shot) { buf = s.shot; mime = s.shot_mime || mime; }
      }
      if (!buf) return res.status(404).json({ error: 'sin captura' });
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'private, no-store');
      res.send(buf);
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Crea la sesión de Didit y devuelve el link para mandárselo al candidato.
  r.post('/api/sessions/:id/identidad', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      if (!didit.activo()) {
        return res.status(501).json({ error: 'Verificación de identidad no configurada', ...didit.estado() });
      }
      const s = await leerSesion(pool, id);
      if (!s) return res.status(404).json({ error: 'not found' });
      if (!esCierre(s.kind)) return res.status(400).json({ error: 'La verificación de identidad solo aplica en una sesión de cierre.' });

      const base = (b.publicUrl || process.env.PUBLIC_URL || '').replace(/\/+$/, '');
      const out = await didit.crearSesion({
        vendorData: s.report_code,
        metadata: { session_id: id, report_code: s.report_code, candidate: s.candidate },
        email: clean(b.email) || s.candidate_email || '',
        telefono: clean(b.telefono),
        avisarPorCorreo: !!b.avisarPorCorreo,
        callbackUrl: base ? `${base}/verificacion/gracias` : undefined,
      });

      if (pool) {
        await pool.query(
          `UPDATE ${T.sessions} SET didit_session_id=$2, didit_url=$3, didit_status=$4, updated_at=NOW() WHERE id=$1`,
          [id, out.sessionId, out.url, out.status || 'Not Started']);
      } else {
        Object.assign(mem.sessions.find(x => x.id === id),
          { didit_session_id: out.sessionId, didit_url: out.url, didit_status: out.status || 'Not Started' });
      }
      res.json({ ok: true, url: out.url, sessionId: out.sessionId, status: out.status });
    } catch (e) {
      console.error('[verificacion/identidad]', e.message);
      res.status(502).json({ error: 'Didit: ' + e.message });
    }
  });

  // El candidato se negó a verificarse. No es sospecha: el acta se emite sin capa de identidad.
  r.post('/api/sessions/:id/identidad/rechazada', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const nota = clean((req.body || {}).nota);
      if (pool) {
        const q = await pool.query(
          `UPDATE ${T.sessions} SET id_note='rechazada', data = COALESCE(data,'{}'::jsonb) || $2::jsonb, updated_at=NOW()
           WHERE id=$1 RETURNING id`, [id, JSON.stringify({ id_rechazo_nota: nota })]);
        if (!q.rows.length) return res.status(404).json({ error: 'not found' });
      } else {
        const s = mem.sessions.find(x => x.id === id);
        if (!s) return res.status(404).json({ error: 'not found' });
        s.id_note = 'rechazada';
      }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Webhook de Didit. Solo nos dice qué sesión cambió; los datos los pedimos nosotros.
  r.post('/api/didit/webhook', async (req, res) => {
    const body = req.body || {};
    try {
      const chk = didit.firmaValida(req.headers, body);
      if (!chk.ok) {
        console.warn('[verificacion/didit] webhook rechazado:', chk.motivo);
        return res.status(401).json({ error: chk.motivo });
      }
      // Responder rápido: Didit reintenta si tardamos, y el cotejo puede demorar.
      res.json({ ok: true });
      procesarIdentidad(pool, body).catch(e => console.error('[verificacion/didit] cotejo:', e.message));
    } catch (e) {
      console.error('[verificacion/didit] webhook:', e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  });

  // Reintento manual, por si el webhook no llegó.
  r.post('/api/sessions/:id/identidad/refrescar', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const s = await leerSesion(pool, id);
      if (!s) return res.status(404).json({ error: 'not found' });
      if (!s.didit_session_id) return res.status(400).json({ error: 'Esta sesión no tiene verificación enviada.' });
      const out = await procesarIdentidad(pool, { session_id: s.didit_session_id });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(502).json({ error: e.message });
    }
  });

  // -------------------------------------------------------------------------
  // VERIFICACIÓN PÚBLICA DE AUTENTICIDAD
  //
  // Quien recibe un acta necesita poder comprobar que es real. Esta página es abierta,
  // así que NO muestra el nombre del candidato ni sus calificaciones: solo confirma que
  // el documento salió de aquí, para qué cargo y qué cliente, y si certificó identidad.
  // Publicar la evaluación de una persona en una URL adivinable sería otra cosa muy distinta.
  // -------------------------------------------------------------------------
  async function actaPublica(code) {
    if (pool) {
      const q = await pool.query(`
        SELECT s.report_code, s.issued_at, s.status, s.kind, s.semaforo, s.integrity_hash,
               s.didit_status, s.face_verdict, s.id_note,
               v.title AS vacancy_title, c.name AS company_name
        FROM ${T.sessions} s
        LEFT JOIN ${T.vacancies} v ON v.id = s.vacancy_id
        LEFT JOIN ${T.companies} c ON c.id = v.company_id
        WHERE UPPER(s.report_code) = UPPER($1) AND s.status = 'issued'`, [code]);
      return q.rows[0] || null;
    }
    const s = mem.sessions.find(x => (x.report_code || '').toUpperCase() === code.toUpperCase() && x.status === 'issued');
    if (!s) return null;
    const v = mem.vacancies.find(x => x.id === s.vacancy_id);
    return { ...s, vacancy_title: v && v.title, company_name: v && v.company_name };
  }

  r.get('/api/v/:code', async (req, res) => {
    try {
      const s = await actaPublica(String(req.params.code || ''));
      if (!s) return res.status(404).json({ autentico: false, motivo: 'No existe un informe emitido con ese código.' });
      const doc = tipoDocumento({ kind: s.kind, diditStatus: s.didit_status, faceVerdict: s.face_verdict, idNote: s.id_note });
      const id = estadoIdentidad({ kind: s.kind, diditStatus: s.didit_status, faceVerdict: s.face_verdict, idNote: s.id_note });
      res.json({
        autentico: true,
        codigo: s.report_code,
        emitido: s.issued_at,
        documento: doc.titulo,
        alcance: doc.alcance,
        cargo: s.vacancy_title || null,
        cliente: s.company_name || null,
        identidad_verificada: id.estado === 'verificada',
        firma: s.integrity_hash || null,
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/v/:code?', async (req, res) => {
    const code = String(req.params.code || '').trim();
    let s = null;
    try { if (code) s = await actaPublica(code); } catch (e) {}
    const doc = s ? tipoDocumento({ kind: s.kind, diditStatus: s.didit_status, faceVerdict: s.face_verdict, idNote: s.id_note }) : null;
    const id = s ? estadoIdentidad({ kind: s.kind, diditStatus: s.didit_status, faceVerdict: s.face_verdict, idNote: s.id_note }) : null;
    const fecha = s && s.issued_at ? new Date(s.issued_at).toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
    const esc = t => String(t == null ? '' : t).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>Verificar un informe · PeakU</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;600;700;800&display=swap">
<style>
:root{--bg:#F5FAFC;--panel:#fff;--ink:#2A2E31;--ink2:#565656;--ink3:#8B8F92;--line:#DCE6EB;
 --brand:#00C3FF;--acc:#006D8F;--good:#157A57;--good-soft:#E5F3EE;--crit:#9E2318;--crit-soft:#FAE9E7}
@media(prefers-color-scheme:dark){:root{--bg:#15191C;--panel:#1E2327;--ink:#EDF2F4;--ink2:#A8AEB2;
 --ink3:#7B8285;--line:#2A3237;--acc:#5CD3FF;--good:#5FC79A;--good-soft:#122019;--crit:#F19286;--crit-soft:#26120F}}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Montserrat,system-ui,sans-serif;background:var(--bg);color:var(--ink);
 display:grid;place-items:center;min-height:100vh;padding:22px;line-height:1.5}
.c{background:var(--panel);border-radius:14px;padding:30px 30px 26px;max-width:470px;width:100%;
 box-shadow:0 4px 22px rgba(20,40,50,.07);border-top:3px solid var(--brand)}
.iso{width:44px;height:auto;display:block;margin-bottom:16px}
h1{font-size:19px;font-weight:800;letter-spacing:-.02em;margin-bottom:5px}
.sub{font-size:13.5px;color:var(--ink2);margin-bottom:20px}
.badge{display:inline-flex;align-items:center;gap:7px;font-size:12px;font-weight:700;letter-spacing:.04em;
 padding:6px 12px;border-radius:20px;margin-bottom:18px}
.ok{background:var(--good-soft);color:var(--good);border:1px solid var(--good)}
.no{background:var(--crit-soft);color:var(--crit);border:1px solid var(--crit)}
.row{display:flex;justify-content:space-between;gap:14px;padding:9px 0;border-bottom:1px solid var(--line);font-size:13.5px}
.row:last-of-type{border-bottom:none}
.row .k{color:var(--ink2)} .row .v{font-weight:600;text-align:right}
.firma{font-family:ui-monospace,Consolas,monospace;font-size:10.5px;color:var(--ink3);
 word-break:break-all;margin-top:14px;line-height:1.5}
.nota{font-size:12px;color:var(--ink3);margin-top:16px;line-height:1.55}
form{display:flex;gap:8px;margin-top:16px}
input{flex:1;font:inherit;font-size:14px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;
 background:var(--bg);color:var(--ink);text-transform:uppercase}
button{font:inherit;font-weight:700;font-size:14px;padding:10px 18px;border:none;border-radius:8px;
 background:var(--acc);color:#fff;cursor:pointer}
@media(prefers-color-scheme:dark){button{color:#15191C}}
</style></head><body><div class="c">
<svg class="iso" viewBox="0 0 174.8 90.4" aria-label="PeakU"><style>.a{fill:#00C3FF}.b{fill:#3E9DBD}</style><path class="b" d="M 126.84 54.14 C 131.82 58.32 139.23 57.67 143.40 52.70 L 125.39 37.59 C 121.22 42.56 121.87 49.97 126.84 54.14"/><path class="b" d="M 167.13 6.13 C 162.16 1.96 154.75 2.61 150.58 7.58 L 168.58 22.69 C 172.75 17.71 172.11 10.30 167.13 6.13"/><path class="b" d="M 152.02 24.14 C 147.05 19.96 146.40 12.55 150.58 7.58 L 125.39 37.59 C 129.57 32.62 136.98 31.97 141.95 36.14 C 146.93 40.31 147.57 47.73 143.40 52.70 L 168.58 22.69 C 164.41 27.66 157.00 28.31 152.02 24.14"/><path class="b" d="M 141.95 36.14 C 136.98 31.97 129.57 32.62 125.39 37.59 L 143.40 52.70 C 147.57 47.73 146.93 40.31 141.95 36.14"/><path class="b" d="M 152.02 24.14 C 157.00 28.31 164.41 27.66 168.58 22.69 L 150.58 7.58 C 146.40 12.55 147.05 19.96 152.02 24.14"/><path class="a" d="M 73.12 6.13 C 68.14 1.96 60.73 2.61 56.56 7.58 L 44.90 21.48 L 62.62 36.92 L 74.56 22.69 C 78.73 17.71 78.09 10.30 73.12 6.13"/><path class="a" d="M 120.12 6.13 C 115.15 1.96 107.74 2.61 103.57 7.58 L 121.57 22.69 C 125.75 17.71 125.10 10.30 120.12 6.13"/><path class="a" d="M 105.02 24.14 C 109.99 28.31 117.40 27.66 121.57 22.69 L 103.57 7.58 C 99.39 12.55 100.04 19.96 105.02 24.14"/><path class="a" d="M 53.21 67.60 L 62.98 55.95 C 60.76 58.59 56.82 58.94 54.17 56.72 C 51.53 54.50 51.18 50.55 53.40 47.91 L 24.20 82.71 C 23.55 83.49 22.80 84.15 22.00 84.72 L 21.99 84.75 C 21.99 84.75 33.67 76.08 34.11 75.75 C 36.51 74.02 39.46 72.99 42.66 72.99 C 42.65 72.99 42.65 72.99 42.64 72.99 L 42.68 72.99 C 42.67 72.99 42.66 72.99 42.66 72.99 C 46.39 73.00 50.01 74.67 50.94 78.48 L 50.94 78.48 C 49.87 74.83 50.58 70.73 53.21 67.60"/><path class="a" d="M 58.01 24.14 C 53.04 19.96 52.39 12.55 56.56 7.58 L 6.20 67.60 C 10.37 62.62 17.78 61.98 22.75 66.15 C 25.79 68.70 27.20 72.45 26.90 76.12 C 26.71 78.46 25.83 80.77 24.20 82.71 L 53.40 47.91 L 74.56 22.69 C 70.39 27.66 62.98 28.31 58.01 24.14"/><path class="a" d="M 22.75 66.15 C 17.78 61.98 10.37 62.62 6.20 67.60 C 2.02 72.57 2.67 79.98 7.64 84.16 C 11.84 87.67 17.75 87.75 22.01 84.72 C 22.80 84.15 23.55 83.49 24.20 82.71 C 25.83 80.77 26.71 78.46 26.90 76.12 C 27.20 72.45 25.79 68.70 22.75 66.15"/><path class="a" d="M 121.57 22.69 C 117.40 27.66 109.99 28.31 105.02 24.14 C 100.04 19.96 99.39 12.55 103.57 7.58 L 62.98 55.95 L 53.21 67.60 C 54.60 65.94 56.35 64.77 58.25 64.10 C 62.05 62.74 66.45 63.37 69.76 66.15 C 74.73 70.32 75.38 77.73 71.21 82.71 Z M 121.57 22.69"/><path class="a" d="M 69.76 66.15 C 66.45 63.37 62.05 62.74 58.25 64.10 C 56.35 64.77 54.60 65.94 53.21 67.60 C 50.58 70.73 49.87 74.83 50.94 78.48 C 51.57 80.62 52.82 82.61 54.66 84.16 C 59.62 88.33 67.04 87.68 71.21 82.71 C 75.38 77.73 74.73 70.32 69.76 66.15"/></svg>
${!code ? `
  <h1>Verificar un informe</h1>
  <p class="sub">Escribe el código que aparece en el documento para comprobar que salió de PeakU.</p>
  <form method="get" onsubmit="location.href='./'+this.q.value.trim();return false">
    <input name="q" placeholder="PKV-2026-000000" autofocus>
    <button type="submit">Verificar</button>
  </form>`
: s ? `
  <span class="badge ok">✓ INFORME AUTÉNTICO</span>
  <h1>${esc(doc.titulo)}</h1>
  <p class="sub">${esc(doc.alcance)}</p>
  <div class="row"><span class="k">Código</span><span class="v">${esc(s.report_code)}</span></div>
  <div class="row"><span class="k">Emitido</span><span class="v">${esc(fecha || '—')}</span></div>
  ${s.vacancy_title ? `<div class="row"><span class="k">Cargo</span><span class="v">${esc(s.vacancy_title)}</span></div>` : ''}
  ${s.company_name ? `<div class="row"><span class="k">Cliente</span><span class="v">${esc(s.company_name)}</span></div>` : ''}
  <div class="row"><span class="k">Identidad verificada</span><span class="v">${id.estado === 'verificada' ? 'Sí' : 'No'}</span></div>
  <div class="firma">Firma de integridad: ${esc(s.integrity_hash || '—')}</div>
  <p class="nota">Esta página confirma que el documento fue emitido por PeakU y no ha sido alterado.
  Por privacidad no muestra el nombre de la persona evaluada ni sus calificaciones: eso está en el informe
  que recibiste. Si el contenido de tu copia no coincide con lo aquí descrito, escríbenos.</p>`
: `
  <span class="badge no">✕ NO ENCONTRADO</span>
  <h1>Ese código no corresponde a ningún informe</h1>
  <p class="sub">Revisa que esté completo y sin espacios. Tiene la forma <b>PKV-2026-000000</b>.</p>
  <form method="get" onsubmit="location.href='../v/'+this.q.value.trim();return false">
    <input name="q" value="${esc(code)}" autofocus>
    <button type="submit">Reintentar</button>
  </form>
  <p class="nota">Si lo copiaste tal cual del documento y sigue sin aparecer, es posible que el informe
  no haya sido emitido o que la copia no sea auténtica.</p>`}
</div></body></html>`);
  });

  r.get('/api/didit/estado', (_req, res) => res.json(didit.estado()));

  // Abrir el webhook en el navegador es un GET, y el webhook es POST. En vez de un 404 seco,
  // decir qué es esta ruta y si está lista para recibir: es la primera cosa que uno prueba.
  r.get('/api/didit/webhook', (_req, res) => {
    const e = didit.estado();
    const falta = e.falta.concat(e.webhookFirmado ? [] : ['DIDIT_WEBHOOK_SECRET']);
    res.status(405).json({
      esto_es: 'El destino del webhook de Didit. Solo acepta POST, y quien lo llama es Didit.',
      ver_en_el_navegador_es_normal: true,
      // Ojo con la diferencia: esto describe al SERVIDOR, no a la consola de Didit.
      // Que el servidor esté listo no dice nada sobre si Didit tiene la URL registrada.
      servidor_listo_para_recibir: e.activo,
      firma_validada: e.webhookFirmado,
      falta,
      siguiente: falta.length
        ? `Falta configurar ${falta.join(', ')} en las variables de entorno. Aparte de eso, esta URL hay que registrarla como destino de webhook en la consola de Didit: el servidor no puede saber si ya lo hiciste.`
        : 'El servidor está listo y valida la firma. Lo único que no puede comprobar desde aquí es si Didit tiene esta URL registrada como destino: eso se ve en la consola de Didit.',
    });
  });

  // Página de regreso del candidato tras verificarse.
  r.get('/gracias', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!doctype html><html lang="es"><head><meta charset="utf-8">
      <meta name="viewport" content="width=device-width,initial-scale=1"><title>Verificación recibida</title>
      <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap">
      <style>body{font-family:Montserrat,system-ui,sans-serif;background:#F5FAFC;color:#2A2E31;display:grid;
      place-items:center;min-height:100vh;margin:0;padding:24px;text-align:center}
      .c{background:#fff;border-radius:14px;padding:36px 32px;max-width:420px;box-shadow:0 4px 20px rgba(20,40,50,.08);
      border-top:3px solid #00C3FF}h1{font-size:21px;margin:0 0 10px}p{color:#565656;line-height:1.55;font-size:15px;margin:0}</style>
      </head><body><div class="c"><h1>Listo, recibimos tu verificación</h1>
      <p>Gracias por tomarte el minuto. No guardamos la imagen de tu documento y no se comparte con la empresa:
      el informe solo indica que tu identidad quedó verificada.</p></div></body></html>`);
  });

  // sendBeacon solo sabe hacer POST y no espera respuesta: se usa el mismo guardado del PATCH.
  r.post('/api/sessions/:id/beacon', (req, res, next) => {
    req.method = 'PATCH';
    res.status(204);
    guardarAvance(req, res).catch(e => console.error('[verificacion/beacon]', e.message));
  });

  // Autosave del avance.
  r.patch('/api/sessions/:id', (req, res) => guardarAvance(req, res));

  async function guardarAvance(req, res) {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const identity = b.identity || {}, signals = b.signals || {};
      const ratings = Array.isArray(b.ratings) ? b.ratings : [];
      const s0 = await leerSesion(pool, id);
      if (!s0) return res.status(404).json({ error: 'not found' });
      const ctx = { kind: s0.kind, faceVerdict: s0.face_verdict, diditStatus: s0.didit_status, idNote: s0.id_note };
      const sem = semaforo({ identity, signals, ...ctx });

      if (pool) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const up = await c.query(
            `UPDATE ${T.sessions} SET identity=$2, signals=$3, data=$4, semaforo=$5,
                                      declara=$6, recomendacion=$7, updated_at=NOW()
             WHERE id=$1 RETURNING id`,
            [id, JSON.stringify(identity), JSON.stringify(signals), JSON.stringify(b.data || {}), sem.color,
             JSON.stringify(b.declara || {}), JSON.stringify(b.recomendacion || {})]
          );
          if (!up.rows.length) { await c.query('ROLLBACK'); return res.status(404).json({ error: 'not found' }); }
          await c.query(`DELETE FROM ${T.ratings} WHERE session_id=$1`, [id]);
          for (let i = 0; i < ratings.length; i++) {
            const q = ratings[i];
            await c.query(
              `INSERT INTO ${T.ratings} (session_id, requirement_id, req_text, ord, level, verdict, evidence)
               VALUES ($1,$2,$3,$4,$5,$6,$7)`,
              [id, q.requirement_id || null, clean(q.req_text), i, q.level || null,
               q.level ? LVLTXT[q.level] : null, clean(q.evidence) || null]
            );
          }
          await c.query('COMMIT');
          if (res.headersSent || res.statusCode === 204) return res.end();
          return res.json({ ok: true, id, semaforo: sem, identidad: estadoIdentidad(ctx) });
        } catch (e) { await c.query('ROLLBACK'); throw e; }
        finally { c.release(); }
      }

      const s = mem.sessions.find(x => x.id === id);
      if (!s) return res.status(404).json({ error: 'not found' });
      Object.assign(s, { identity, signals, data: b.data || {}, semaforo: sem.color,
                         declara: b.declara || {}, recomendacion: b.recomendacion || {} });
      mem.ratings = mem.ratings.filter(x => x.session_id !== id);
      ratings.forEach((q, i) => mem.ratings.push({
        id: nextId(), session_id: id, requirement_id: q.requirement_id || null, req_text: clean(q.req_text),
        ord: i, level: q.level || null, verdict: q.level ? LVLTXT[q.level] : null, evidence: clean(q.evidence),
      }));
      res.json({ ok: true, id, semaforo: sem, identidad: estadoIdentidad(ctx) });
    } catch (e) {
      console.error('[verificacion/sessions.patch]', e.message);
      if (!res.headersSent) res.status(500).json({ error: e.message });
    }
  }

  // Emisión del acta. El servidor vuelve a aplicar la regla: sin carpeta completa no hay acta.
  r.post('/api/sessions/:id/issue', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const identity = b.identity || {}, signals = b.signals || {};
      const ratings = Array.isArray(b.ratings) ? b.ratings : [];
      const s0 = await leerSesion(pool, id);
      if (!s0) return res.status(404).json({ error: 'not found' });
      const ctx = { kind: s0.kind, faceVerdict: s0.face_verdict, diditStatus: s0.didit_status, idNote: s0.id_note };
      const { faltas, semaforo: sem, identidad } = bloqueos({ identity, signals, ratings, ...ctx });
      if (faltas.length) {
        return res.status(409).json({ error: 'No se puede emitir el documento', faltas, semaforo: sem, identidad });
      }
      const doc = tipoDocumento(ctx);

      const hash = integrityHash({
        candidate: clean(b.candidate),
        ratings: ratings.map(x => ({ t: x.req_text, l: x.level })),
        identity, signals, kind: s0.kind, identidad: identidad.estado,
        faceScore: s0.face_score ?? null, at: new Date().toISOString(),
      });

      if (pool) {
        const q = await pool.query(
          `UPDATE ${T.sessions} SET status='issued', semaforo=$2, identity=$3, signals=$4, data=$5,
                                    integrity_hash=$6, issued_at=NOW(), updated_at=NOW()
           WHERE id=$1 RETURNING id, report_code, issued_at, integrity_hash`,
          [id, sem.color, JSON.stringify(identity), JSON.stringify(signals), JSON.stringify(b.data || {}), hash]
        );
        if (!q.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json({ ok: true, semaforo: sem, identidad, documento: doc, ...q.rows[0] });
      }
      const s = mem.sessions.find(x => x.id === id);
      if (!s) return res.status(404).json({ error: 'not found' });
      Object.assign(s, { status: 'issued', semaforo: sem.color, identity, signals, data: b.data || {}, integrity_hash: hash, issued_at: new Date().toISOString() });
      res.json({ ok: true, semaforo: sem, identidad, documento: doc, id, report_code: s.report_code, issued_at: s.issued_at, integrity_hash: hash });
    } catch (e) {
      console.error('[verificacion/sessions.issue]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/api/sessions', async (_req, res) => {
    try {
      if (pool) {
        const q = await pool.query(`
          SELECT s.id, s.report_code, s.candidate, s.evaluator, s.mode, s.kind, s.status, s.semaforo,
                 s.didit_status, s.face_verdict, s.face_score, s.id_note,
                 s.started_at, s.issued_at, v.title AS vacancy_title, c.name AS company_name
          FROM ${T.sessions} s
          LEFT JOIN ${T.vacancies} v ON v.id=s.vacancy_id
          LEFT JOIN ${T.companies} c ON c.id=v.company_id
          ORDER BY s.created_at DESC LIMIT 200`);
        return res.json(q.rows);
      }
      res.json(mem.sessions.slice().reverse().map(s => {
        const v = mem.vacancies.find(x => x.id === s.vacancy_id);
        return { ...s, vacancy_title: v && v.title, company_name: v && v.company_name };
      }));
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.get('/api/sessions/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (pool) {
        const s = await pool.query(`
          SELECT s.*, v.title AS vacancy_title, c.name AS company_name
          FROM ${T.sessions} s LEFT JOIN ${T.vacancies} v ON v.id=s.vacancy_id
          LEFT JOIN ${T.companies} c ON c.id=v.company_id WHERE s.id=$1`, [id]);
        if (!s.rows.length) return res.status(404).json({ error: 'not found' });
        const q = await pool.query(`SELECT * FROM ${T.ratings} WHERE session_id=$1 ORDER BY ord, id`, [id]);
        const row = s.rows[0];
        const ctx = { kind: row.kind, faceVerdict: row.face_verdict, diditStatus: row.didit_status, idNote: row.id_note };
        const { shot, ...sinImagen } = row;   // la imagen no viaja en el JSON
        return res.json({ ...sinImagen, tiene_captura: !!shot, identidad: estadoIdentidad(ctx),
                          documento: tipoDocumento(ctx), ratings: q.rows });
      }
      const s = mem.sessions.find(x => x.id === id);
      if (!s) return res.status(404).json({ error: 'not found' });
      const v = mem.vacancies.find(x => x.id === s.vacancy_id);
      res.json({ ...s, vacancy_title: v && v.title, company_name: v && v.company_name, ratings: mem.ratings.filter(x => x.session_id === id) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  r.delete('/api/sessions/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      if (pool) {
        const q = await pool.query(`DELETE FROM ${T.sessions} WHERE id=$1 RETURNING id`, [id]);
        if (!q.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json({ ok: true, id });
      }
      const i = mem.sessions.findIndex(x => x.id === id);
      if (i === -1) return res.status(404).json({ error: 'not found' });
      mem.sessions.splice(i, 1);
      mem.ratings = mem.ratings.filter(x => x.session_id !== id);
      res.json({ ok: true, id });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Salud propia — no interfiere con /api/health del Sandler.
  r.get('/api/health', async (_req, res) => {
    const out = { ok: true, app: 'verificacion', poolShared: !!pool, llm: !!anthropic, model, identidad: didit.estado() };
    if (!pool) return res.json({ ...out, db: false, mode: 'memoria' });
    try {
      const q = pool.query(`SELECT 1 AS ping FROM ${T.companies} LIMIT 1`);
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('db timeout 5s')), 5000));
      await Promise.race([q, timeout]);
      res.json({ ...out, db: true });
    } catch (e) {
      // La tabla puede no existir todavía si initSchema aún no corrió.
      res.status(500).json({ ...out, db: false, error: e.message });
    }
  });

  // Una ruta /api que no existe debe decirlo, no devolver la aplicación.
  // Sin esto, abrir por error /api/lo-que-sea entrega el index.html: el navegador lo pinta
  // sin estilos y parece que la app está rota, cuando lo único que pasa es que la ruta no existe.
  r.all('/api/*', (req, res) => {
    res.status(404).json({
      error: 'Esta ruta de la API no existe',
      ruta: req.originalUrl,
      metodo: req.method,
      pista: req.path === '/api/didit/webhook'
        ? 'El webhook solo acepta POST y lo llama Didit, no el navegador. Para comprobar que está configurado, abre /verificacion/api/didit/estado.'
        : 'Revisa la ruta. El estado general está en /verificacion/api/health.',
    });
  });

  // SPA fallback: cualquier otra ruta bajo el mount point sirve el index.
  r.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  return r;
}

module.exports = { router, initSchema };

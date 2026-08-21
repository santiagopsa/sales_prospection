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
const { LVLTXT, clean, semaforo, bloqueos, integrityHash, reportCode } = require('./rules');
const { T, initSchema } = require('./schema');

// Fallback en memoria para correr sin Postgres (pruebas locales). Se pierde al reiniciar.
const mem = { companies: [], vacancies: [], requirements: [], sessions: [], ratings: [], seq: 1 };
const nextId = () => mem.seq++;

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
      if (pool) {
        const q = await pool.query(
          `INSERT INTO ${T.sessions} (vacancy_id, report_code, candidate, candidate_email, evaluator, mode, status, started_at)
           VALUES ($1,$2,$3,$4,$5,$6,'draft',NOW()) RETURNING id, report_code, started_at`,
          [vacancyId, code, clean(b.candidate), clean(b.candidate_email) || null, clean(b.evaluator) || null, b.mode === 'A' ? 'A' : 'B']
        );
        return res.json({ ok: true, ...q.rows[0] });
      }
      const s = {
        id: nextId(), vacancy_id: vacancyId, report_code: code, candidate: clean(b.candidate),
        candidate_email: clean(b.candidate_email), evaluator: clean(b.evaluator), mode: b.mode === 'A' ? 'A' : 'B',
        status: 'draft', identity: {}, signals: {}, data: {}, started_at: new Date().toISOString(),
      };
      mem.sessions.push(s);
      res.json({ ok: true, id: s.id, report_code: s.report_code, started_at: s.started_at });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Autosave del avance.
  r.patch('/api/sessions/:id', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const identity = b.identity || {}, signals = b.signals || {};
      const ratings = Array.isArray(b.ratings) ? b.ratings : [];
      const sem = semaforo({ identity, signals });

      if (pool) {
        const c = await pool.connect();
        try {
          await c.query('BEGIN');
          const up = await c.query(
            `UPDATE ${T.sessions} SET identity=$2, signals=$3, data=$4, semaforo=$5, updated_at=NOW()
             WHERE id=$1 RETURNING id`,
            [id, JSON.stringify(identity), JSON.stringify(signals), JSON.stringify(b.data || {}), sem.color]
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
          return res.json({ ok: true, id, semaforo: sem });
        } catch (e) { await c.query('ROLLBACK'); throw e; }
        finally { c.release(); }
      }

      const s = mem.sessions.find(x => x.id === id);
      if (!s) return res.status(404).json({ error: 'not found' });
      Object.assign(s, { identity, signals, data: b.data || {}, semaforo: sem.color });
      mem.ratings = mem.ratings.filter(x => x.session_id !== id);
      ratings.forEach((q, i) => mem.ratings.push({
        id: nextId(), session_id: id, requirement_id: q.requirement_id || null, req_text: clean(q.req_text),
        ord: i, level: q.level || null, verdict: q.level ? LVLTXT[q.level] : null, evidence: clean(q.evidence),
      }));
      res.json({ ok: true, id, semaforo: sem });
    } catch (e) {
      console.error('[verificacion/sessions.patch]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // Emisión del acta. El servidor vuelve a aplicar la regla: sin carpeta completa no hay acta.
  r.post('/api/sessions/:id/issue', async (req, res) => {
    try {
      const id = Number(req.params.id);
      const b = req.body || {};
      const identity = b.identity || {}, signals = b.signals || {};
      const ratings = Array.isArray(b.ratings) ? b.ratings : [];
      const { faltas, semaforo: sem } = bloqueos({ identity, signals, ratings });
      if (faltas.length) return res.status(409).json({ error: 'No se puede emitir el acta', faltas, semaforo: sem });

      const hash = integrityHash({
        candidate: clean(b.candidate),
        ratings: ratings.map(x => ({ t: x.req_text, l: x.level })),
        identity, signals, at: new Date().toISOString(),
      });

      if (pool) {
        const q = await pool.query(
          `UPDATE ${T.sessions} SET status='issued', semaforo=$2, identity=$3, signals=$4, data=$5,
                                    integrity_hash=$6, issued_at=NOW(), updated_at=NOW()
           WHERE id=$1 RETURNING id, report_code, issued_at, integrity_hash`,
          [id, sem.color, JSON.stringify(identity), JSON.stringify(signals), JSON.stringify(b.data || {}), hash]
        );
        if (!q.rows.length) return res.status(404).json({ error: 'not found' });
        return res.json({ ok: true, semaforo: sem, ...q.rows[0] });
      }
      const s = mem.sessions.find(x => x.id === id);
      if (!s) return res.status(404).json({ error: 'not found' });
      Object.assign(s, { status: 'issued', semaforo: sem.color, identity, signals, data: b.data || {}, integrity_hash: hash, issued_at: new Date().toISOString() });
      res.json({ ok: true, semaforo: sem, id, report_code: s.report_code, issued_at: s.issued_at, integrity_hash: hash });
    } catch (e) {
      console.error('[verificacion/sessions.issue]', e.message);
      res.status(500).json({ error: e.message });
    }
  });

  r.get('/api/sessions', async (_req, res) => {
    try {
      if (pool) {
        const q = await pool.query(`
          SELECT s.id, s.report_code, s.candidate, s.evaluator, s.mode, s.status, s.semaforo,
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
        return res.json({ ...s.rows[0], ratings: q.rows });
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
    const out = { ok: true, app: 'verificacion', poolShared: !!pool, llm: !!anthropic, model };
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

  // SPA fallback propio: cualquier ruta bajo el mount point sirve el index.
  r.get('*', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

  return r;
}

module.exports = { router, initSchema };

// Integración con Didit — verificación de identidad.
//
// Flujo:
//   1. Durante la entrevista el reclutador sube un pantallazo del video (queda en la BD).
//   2. Al terminar la llamada, crea una sesión de Didit y le manda el link al candidato.
//   3. El candidato hace el KYC desde su celular: documento + prueba de vida + face match interno.
//   4. Didit avisa por webhook. Nosotros recuperamos la decisión, bajamos la selfie de la prueba
//      de vida y la comparamos contra el pantallazo con Face Match 1:1.
//      Eso es lo que liga a la persona verificada con la persona que estuvo en la entrevista.
//   5. Guardamos el puntaje y BORRAMOS el pantallazo. Ya cumplió su función.
//
// Endpoints (docs.didit.me, contrato v3):
//   POST https://verification.didit.me/v3/session/                  crear sesión
//   GET  https://verification.didit.me/v3/session/{id}/decision/    recuperar decisión
//   POST https://verification.didit.me/v3/face-match/               comparar dos rostros
const crypto = require('crypto');

const BASE = process.env.DIDIT_BASE_URL || 'https://verification.didit.me';
const API_KEY = process.env.DIDIT_API_KEY || '';
const WORKFLOW_ID = process.env.DIDIT_WORKFLOW_ID || '';
const WEBHOOK_SECRET = process.env.DIDIT_WEBHOOK_SECRET || '';

// Umbrales del face match. Didit declina por debajo de 30 por defecto; nosotros somos
// más exigentes para aprobar solo, y mandamos la franja intermedia a revisión humana.
// Un puntaje bajo NO significa impostor: un pantallazo borroso o de perfil también baja el puntaje.
const OK_MIN = Number(process.env.DIDIT_FACE_OK || 70);
const DUDA_MIN = Number(process.env.DIDIT_FACE_DUDA || 50);

const activo = () => !!(API_KEY && WORKFLOW_ID);

function estado() {
  return {
    activo: activo(),
    falta: [!API_KEY && 'DIDIT_API_KEY', !WORKFLOW_ID && 'DIDIT_WORKFLOW_ID'].filter(Boolean),
    webhookFirmado: !!WEBHOOK_SECRET,
    umbrales: { aprueba: OK_MIN, duda: DUDA_MIN },
  };
}

async function pedir(url, opts = {}) {
  const r = await fetch(url, {
    ...opts,
    headers: { 'x-api-key': API_KEY, ...(opts.headers || {}) },
  });
  const txt = await r.text();
  let j = null;
  try { j = JSON.parse(txt); } catch (e) {}
  if (!r.ok) {
    const err = new Error((j && (j.detail || j.message || j.error)) || `Didit respondió ${r.status}`);
    err.status = r.status;
    err.body = txt.slice(0, 500);
    throw err;
  }
  return j;
}

// --- 1. Crear la sesión de verificación -------------------------------------
// `callbackUrl` es a dónde vuelve el candidato al terminar (una página de gracias, no el webhook).
async function crearSesion({ vendorData, metadata, email, telefono, avisarPorCorreo, callbackUrl }) {
  if (!activo()) throw new Error('Didit no está configurado (falta DIDIT_API_KEY o DIDIT_WORKFLOW_ID)');
  const body = {
    workflow_id: WORKFLOW_ID,
    language: 'es',
    vendor_data: vendorData || undefined,
    metadata: metadata || undefined,
    callback: callbackUrl || undefined,
  };
  if (email || telefono) {
    body.contact_details = {
      email: email || undefined,
      phone: telefono || undefined,
      send_notification_emails: !!(avisarPorCorreo && email),
      email_lang: 'es',
    };
  }
  const out = await pedir(`${BASE}/v3/session/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { sessionId: out.session_id, url: out.url, status: out.status };
}

// --- 2. Recuperar la decisión ----------------------------------------------
// Todos los arreglos vienen en plural aunque traigan un solo elemento.
// Las URLs de las imágenes son enlaces firmados de vida corta: hay que bajarlas de una.
async function decision(sessionId) {
  if (!activo()) throw new Error('Didit no está configurado');
  const d = await pedir(`${BASE}/v3/session/${encodeURIComponent(sessionId)}/decision/`);
  const uno = (arr) => (Array.isArray(arr) && arr.length ? arr[0] : null);
  const idv = uno(d.id_verifications);
  const liv = uno(d.liveness_checks);
  const fm = uno(d.face_matches);
  return {
    status: d.status,
    // Preferimos la selfie de la prueba de vida; si no está, el retrato del documento.
    imagenRostro: (liv && liv.reference_image) || (idv && idv.portrait_image) || null,
    documento: idv ? {
      nombre: [idv.first_name, idv.last_name].filter(Boolean).join(' ') || idv.full_name || null,
      numero: idv.document_number || null,
      pais: idv.issuing_state || idv.id_country || null,
      tipo: idv.document_type || null,
      status: idv.status || null,
    } : null,
    liveness: liv ? { status: liv.status, score: liv.score ?? null } : null,
    faceMatchInterno: fm ? { status: fm.status, score: fm.score ?? null } : null,
    crudo: d,
  };
}

// --- 3. Face match 1:1 ------------------------------------------------------
// multipart/form-data con los dos binarios. Aquí está el vínculo real entre
// "la persona verificada" y "la persona que estuvo en la entrevista".
async function faceMatch(imagenEntrevista, imagenKyc, { vendorData, metadata } = {}) {
  if (!activo()) throw new Error('Didit no está configurado');
  const fd = new FormData();
  fd.append('user_image', new Blob([imagenEntrevista.buffer], { type: imagenEntrevista.mime || 'image/jpeg' }), 'entrevista.jpg');
  fd.append('ref_image', new Blob([imagenKyc.buffer], { type: imagenKyc.mime || 'image/jpeg' }), 'kyc.jpg');
  fd.append('save_api_request', 'false');
  if (vendorData) fd.append('vendor_data', vendorData);
  if (metadata) fd.append('metadata', JSON.stringify(metadata));

  const out = await pedir(`${BASE}/v3/face-match/`, { method: 'POST', body: fd });
  const fm = out.face_match || {};
  const score = typeof fm.score === 'number' ? fm.score : null;
  return {
    score,
    statusDidit: fm.status || null,
    veredicto: veredictoFace(score),
    warnings: fm.warnings || [],
    requestId: out.request_id || null,
  };
}

// El veredicto lo decidimos nosotros, no Didit: el umbral depende de para qué sirve el documento.
function veredictoFace(score) {
  if (score == null) return 'sin_dato';
  if (score >= OK_MIN) return 'coincide';
  if (score >= DUDA_MIN) return 'revisar';
  return 'no_coincide';
}

// --- Descargar una imagen desde una URL firmada de Didit --------------------
async function bajarImagen(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo bajar la imagen del rostro (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());
  return { buffer: buf, mime: r.headers.get('content-type') || 'image/jpeg' };
}

// --- Validación de la firma del webhook -------------------------------------
// Usamos X-Signature-Simple: firma "{timestamp}:{session_id}:{status}:{webhook_type}".
// Basta porque el webhook solo nos dice QUÉ sesión cambió — los datos reales los pedimos
// nosotros con la API key. Reproducir X-Signature-V2 exigiría replicar el JSON canónico
// de Python byte a byte, que es frágil y aquí no compra nada.
function firmaValida(headers, body) {
  if (!WEBHOOK_SECRET) return { ok: true, motivo: 'sin secreto configurado — sin validar' };
  const ts = headers['x-timestamp'];
  const sig = headers['x-signature-simple'];
  if (!ts || !sig) return { ok: false, motivo: 'faltan las cabeceras de firma' };
  if (Math.abs(Math.floor(Date.now() / 1000) - Number(ts)) > 300) {
    return { ok: false, motivo: 'el webhook llegó con más de 5 minutos de desfase' };
  }
  const base = `${ts}:${body.session_id}:${body.status}:${body.webhook_type}`;
  const esperada = crypto.createHmac('sha256', WEBHOOK_SECRET).update(base, 'utf8').digest('hex');
  const a = Buffer.from(esperada, 'utf8'), b = Buffer.from(String(sig), 'utf8');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, motivo: 'la firma no coincide' };
  }
  return { ok: true };
}

module.exports = { activo, estado, crearSesion, decision, faceMatch, bajarImagen, firmaValida, veredictoFace, OK_MIN, DUDA_MIN };

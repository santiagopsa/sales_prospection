// Escenario VoxEngine (corre en Voximplant, no aquí). Se genera con los valores de config y
// del setup, y vox:setup lo sube; por eso vive como texto en una función.
//
// Flujo: Angie llama desde el navegador (Web SDK) → el escenario contesta su tramo de una vez
// (para que oiga lo que pasa) y marca al prospecto por PSTN con el caller ID de Peaku → mientras
// timbra, Angie oye el tono real del operador → al contestar se unen los dos audios y arranca la
// grabación estéreo → al colgar cualquiera, se manda un webhook a Render con duración, estado,
// código del operador y enlace de la grabación.
//
// Si el operador falla con un código de LLAMADA_REINTENTAR_CODIGOS (404 "no encuentra el número",
// 503 congestión…), se vuelve a marcar hasta LLAMADA_REINTENTOS veces. Al rendirse, Angie OYE el
// motivo (voz) y el navegador lo recibe como mensaje para mostrarlo y dejarlo reportar.
//
// Mensajes al navegador (call.sendMessage, JSON): { fase, intento, codigo, motivo, estado }
//   fase: marcando | timbrando | reintentando | contestada | fallida

function generarEscenario({ callerId, webhookUrl, secreto, aviso, voz, avisoATodos, reintentos = 2, codigosReintento = [404, 408, 500, 502, 503, 504], pausaReintentoS = 2, mensajes = {} }) {
  const j = v => JSON.stringify(v);
  const M = Object.assign({
    marcando: 'Marcando',
    reintentando: 'No entró. Reintentando',
    numero_invalido: 'El operador dice que el número no existe o no se puede enrutar',
    ocupado: 'Ocupado',
    no_contesto: 'No contestaron',
    fallo_central: 'Falla de la central. No fue posible llamar',
  }, mensajes);
  return `// SDR Coach · generado por "node sdr/cli.js vox:setup" — no editar en el panel, se sobreescribe.
require(Modules.Recorder);

const CALLER_ID = ${j(callerId)};
const WEBHOOK = ${j(webhookUrl)};
const SECRETO = ${j(secreto)};
const AVISO = ${j(aviso)};
const VOZ_NOMBRE = ${j(voz)};
const AVISO_A_TODOS = ${j(!!avisoATodos)};
const REINTENTOS = ${j(Number(reintentos) || 0)};
const CODIGOS_REINTENTO = ${j(codigosReintento)};
const PAUSA_REINTENTO_MS = ${j(Math.round((Number(pausaReintentoS) || 0) * 1000))};
const MENSAJES = ${j(M)};

function voz() {
  try {
    const [prov, nombre] = VOZ_NOMBRE.split('.');
    if (VoiceList[prov] && VoiceList[prov][nombre]) return VoiceList[prov][nombre];
  } catch (e) {}
  return Language.ES_SPANISH;
}

// Qué significa el código SIP del operador para nosotros.
function clasificar(code, reason) {
  const r = String(reason || '').toUpperCase();
  if (code === 486 || code === 600 || r.indexOf('BUSY') >= 0) return 'ocupado';
  if (code === 404 || code === 484 || code === 604 || code === 410) return 'numero_invalido';
  if (code === 480 || code === 487 || code === 408 && r.indexOf('NO_USER') >= 0) return 'no_contesto';
  if (code === 603 || code === 403 && r.indexOf('DECLINE') >= 0) return 'rechazada';
  return 'fallo_central';
}

VoxEngine.addEventListener(AppEvents.CallAlerting, function (e) {
  const angie = e.call;
  let datos = {};
  try { datos = JSON.parse(e.customData || '{}'); } catch (err) {}
  const numero = (e.destination || '').replace(/[^0-9+]/g, '');
  const estado = { uuid: datos.uuid || null, lead_id: datos.lead_id || null, telefono: numero,
    started_at: new Date().toISOString(), answered_at: null, ended_at: null, estado: 'iniciando', codigo: null, motivo: null,
    intentos: 0, record_url: null, vox_call_id: null };
  let prospecto = null, recorder = null, cerrado = false, grabacionLista = false, esperandoGrabacion = false, angieLista = false;

  function avisar(fase, extra) {
    const m = { fase: fase, intento: estado.intentos, codigo: estado.codigo, motivo: estado.motivo, estado: estado.estado };
    if (extra) for (const k in extra) m[k] = extra[k];
    try { angie.sendMessage(JSON.stringify(m)); } catch (err) {}
  }

  function terminar(motivo) {
    if (cerrado) return;
    cerrado = true;
    estado.ended_at = new Date().toISOString();
    if (estado.answered_at) estado.duracion_s = Math.round((Date.parse(estado.ended_at) - Date.parse(estado.answered_at)) / 1000);
    if (!estado.estado || estado.estado === 'iniciando' || estado.estado === 'marcando') estado.estado = motivo;
    try { angie.hangup(); } catch (err) {}
    try { if (prospecto) prospecto.hangup(); } catch (err) {}
    // La URL de la grabación llega en RecorderStopped, unos segundos después de colgar.
    if (recorder && !grabacionLista) { esperandoGrabacion = true; setTimeout(enviar, 15000); }
    else enviar();
  }

  let enviado = false;
  function enviar() {
    if (enviado) return;
    enviado = true;
    Net.httpRequestAsync(WEBHOOK, {
      method: 'POST',
      headers: ['Content-Type: application/json', 'X-SDR-Secret: ' + SECRETO],
      postData: JSON.stringify(estado),
    }).then(function () { VoxEngine.terminate(); }, function () { VoxEngine.terminate(); });
  }

  // Le dice a Angie qué pasó (voz) y cuelga cuando termina de decirlo.
  function despedir(texto, motivo) {
    avisar('fallida');
    let colgado = false;
    const colgar = function () { if (colgado) return; colgado = true; terminar(motivo); };
    try {
      angie.addEventListener(CallEvents.PlaybackFinished, colgar);
      angie.say(texto, voz());
      setTimeout(colgar, 8000);
    } catch (err) { colgar(); }
  }

  if (!numero || !CALLER_ID) { estado.estado = 'error'; estado.codigo = 'sin_numero'; angie.reject(); return terminar('error'); }

  function marcar() {
    estado.intentos++;
    estado.estado = 'marcando';
    avisar('marcando');
    prospecto = VoxEngine.callPSTN(numero, CALLER_ID);
    estado.vox_call_id = prospecto.id();
    const esteIntento = prospecto;

    // Tono real del operador (early media) hacia Angie mientras timbra.
    esteIntento.addEventListener(CallEvents.AudioStarted, function () {
      if (cerrado || esteIntento !== prospecto) return;
      estado.estado = 'timbrando';
      try { esteIntento.sendMediaTo(angie); } catch (err) {}
      avisar('timbrando');
    });

    esteIntento.addEventListener(CallEvents.Connected, function () {
      if (cerrado) return;
      estado.answered_at = new Date().toISOString();
      estado.estado = 'contestada';
      avisar('contestada');
      recorder = VoxEngine.createRecorder({ stereo: true, hd_audio: true });
      recorder.addEventListener(RecorderEvents.Started, function (ev) { estado.record_url = ev.url || estado.record_url; });
      recorder.addEventListener(RecorderEvents.Stopped, function (ev) { estado.record_url = ev.url || estado.record_url; grabacionLista = true; if (esperandoGrabacion) enviar(); });
      // Canal izquierdo = prospecto, derecho = Angie (ver CANAL_ANGIE_EN_GRABACION en config).
      esteIntento.sendMediaTo(recorder);
      angie.sendMediaTo(recorder);
      const seguir = function () { VoxEngine.sendMediaBetween(angie, esteIntento); };
      if (AVISO) {
        // El prospecto oye el aviso antes de que se una la voz de Angie.
        esteIntento.addEventListener(CallEvents.PlaybackFinished, function () { seguir(); });
        esteIntento.say(AVISO, voz());
        if (AVISO_A_TODOS) angie.say(AVISO, voz());
      } else seguir();
    });

    esteIntento.addEventListener(CallEvents.Failed, function (ev) {
      if (cerrado || esteIntento !== prospecto) return;
      const tipo = clasificar(ev.code, ev.reason);
      estado.estado = tipo;
      estado.codigo = String(ev.code);
      estado.motivo = ev.reason || '';
      const reintentar = CODIGOS_REINTENTO.indexOf(ev.code) >= 0 && estado.intentos <= REINTENTOS;
      if (reintentar) {
        avisar('reintentando');
        try { angie.say(MENSAJES.reintentando, voz()); } catch (err) {}
        setTimeout(function () { if (!cerrado) marcar(); }, PAUSA_REINTENTO_MS);
        return;
      }
      if (tipo === 'no_contesto' || tipo === 'ocupado' || tipo === 'rechazada') return despedir(MENSAJES[tipo] || MENSAJES.no_contesto, tipo);
      despedir(MENSAJES[tipo] || MENSAJES.fallo_central, tipo);
    });

    esteIntento.addEventListener(CallEvents.Disconnected, function () { if (esteIntento === prospecto) terminar('colgada'); });
  }

  angie.addEventListener(CallEvents.Connected, function () {
    if (angieLista) return;
    angieLista = true;
    try { angie.say(MENSAJES.marcando, voz()); } catch (err) {}
    marcar();
  });
  angie.addEventListener(CallEvents.Disconnected, function () { if (!estado.answered_at && estado.estado !== 'numero_invalido' && estado.estado !== 'fallo_central') estado.estado = 'cancelada'; terminar('cancelada'); });
  angie.addEventListener(CallEvents.Failed, function () { terminar('cancelada'); });
  // Se contesta el tramo de Angie de una vez: así oye el tono del operador y los avisos.
  angie.answer();
});
`;
}

module.exports = { generarEscenario };

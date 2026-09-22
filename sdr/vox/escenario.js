// Escenario VoxEngine (corre en Voximplant, no aquí). Se genera con los valores de config y
// del setup, y vox:setup lo sube; por eso vive como texto en una función.
//
// Flujo: Angie llama desde el navegador (Web SDK) → el escenario marca al prospecto por PSTN
// con el caller ID de Peaku → al contestar, el prospecto oye el aviso de grabación → se unen
// los dos audios y arranca la grabación estéreo → al colgar cualquiera, se manda un webhook
// a Render con duración, estado y enlace de la grabación.

function generarEscenario({ callerId, webhookUrl, secreto, aviso, voz, avisoATodos }) {
  const j = v => JSON.stringify(v);
  return `// SDR Coach · generado por "node sdr/cli.js vox:setup" — no editar en el panel, se sobreescribe.
require(Modules.Recorder);

const CALLER_ID = ${j(callerId)};
const WEBHOOK = ${j(webhookUrl)};
const SECRETO = ${j(secreto)};
const AVISO = ${j(aviso)};
const VOZ_NOMBRE = ${j(voz)};
const AVISO_A_TODOS = ${j(!!avisoATodos)};

function voz() {
  try {
    const [prov, nombre] = VOZ_NOMBRE.split('.');
    if (VoiceList[prov] && VoiceList[prov][nombre]) return VoiceList[prov][nombre];
  } catch (e) {}
  return Language.ES_SPANISH;
}

VoxEngine.addEventListener(AppEvents.CallAlerting, function (e) {
  const angie = e.call;
  let datos = {};
  try { datos = JSON.parse(e.customData || '{}'); } catch (err) {}
  const numero = (e.destination || '').replace(/[^0-9+]/g, '');
  const estado = { uuid: datos.uuid || null, lead_id: datos.lead_id || null, telefono: numero,
    started_at: new Date().toISOString(), answered_at: null, ended_at: null, estado: 'iniciando', codigo: null, record_url: null, vox_call_id: null };
  let prospecto = null, recorder = null, cerrado = false, grabacionLista = false, esperandoGrabacion = false;

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

  if (!numero || !CALLER_ID) { estado.estado = 'error'; estado.codigo = 'sin_numero'; angie.reject(); return terminar('error'); }

  angie.ring();
  estado.estado = 'marcando';
  prospecto = VoxEngine.callPSTN(numero, CALLER_ID);
  estado.vox_call_id = prospecto.id();

  prospecto.addEventListener(CallEvents.Connected, function () {
    estado.answered_at = new Date().toISOString();
    estado.estado = 'contestada';
    angie.answer();
    recorder = VoxEngine.createRecorder({ stereo: true, hd_audio: true });
    recorder.addEventListener(RecorderEvents.Started, function (ev) { estado.record_url = ev.url || estado.record_url; });
    recorder.addEventListener(RecorderEvents.Stopped, function (ev) { estado.record_url = ev.url || estado.record_url; grabacionLista = true; if (esperandoGrabacion) enviar(); });
    // Canal izquierdo = prospecto, derecho = Angie (ver CANAL_ANGIE_EN_GRABACION en config).
    prospecto.sendMediaTo(recorder);
    angie.sendMediaTo(recorder);
    const seguir = function () {
      VoxEngine.sendMediaBetween(angie, prospecto);
    };
    if (AVISO) {
      // El prospecto oye el aviso antes de que se una la voz de Angie.
      prospecto.addEventListener(CallEvents.PlaybackFinished, function () { seguir(); });
      prospecto.say(AVISO, voz());
      if (AVISO_A_TODOS) angie.say(AVISO, voz());
    } else seguir();
  });
  prospecto.addEventListener(CallEvents.Failed, function (ev) {
    estado.estado = ev.code === 486 ? 'ocupado' : (ev.code === 487 || ev.code === 480 ? 'no_contesto' : 'fallida');
    estado.codigo = ev.code + ' ' + (ev.reason || '');
    terminar(estado.estado);
  });
  prospecto.addEventListener(CallEvents.Disconnected, function () { terminar('colgada'); });
  angie.addEventListener(CallEvents.Disconnected, function () { if (!estado.answered_at) estado.estado = 'cancelada'; terminar('cancelada'); });
  angie.addEventListener(CallEvents.Failed, function () { terminar('cancelada'); });
});
`;
}

module.exports = { generarEscenario };

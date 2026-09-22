// Telefonía en el navegador (Voximplant Web SDK). app.js solo conoce esta interfaz:
//   SDR_TELEFONIA.disponible() → bool
//   SDR_TELEFONIA.llamar({ lead, uuid }, { estado(txt), fin({ error?, cancelada? }) })
//   SDR_TELEFONIA.colgar()
// Si el SDK no cargó o el servidor no tiene las variables VOX_*, disponible() es false y la
// ficha muestra el botón apagado con el motivo.
(function () {
  let config = null;      // /api/vox/config
  let cliente = null;     // instancia del SDK
  let conectado = false;  // sesión iniciada
  let llamadaActual = null;
  let conectando = null;

  const SDK = () => window.VoxImplant;

  fetch('api/vox/config').then(r => r.json()).then(c => { config = c; }).catch(() => { config = { configurado: false, faltan: ['servidor'] }; });

  function disponible() { return !!(config && config.configurado && SDK()); }

  function motivo() {
    if (!SDK()) return 'No cargó el SDK de Voximplant (revisa la conexión).';
    if (!config) return 'Consultando la configuración…';
    if (!config.configurado) return 'Faltan en Render: ' + config.faltan.join(', ');
    return '';
  }

  // Conecta e inicia sesión una sola vez por pestaña. Login con llave de un solo uso: la
  // contraseña de Angie se queda en el servidor.
  async function sesion(estado) {
    if (conectado) return;
    if (conectando) return conectando;
    conectando = (async () => {
      const V = SDK();
      cliente = V.getInstance();
      estado('Conectando con la central…');
      try { await cliente.init({ micRequired: true, showDebugInfo: false, progressTone: true, progressToneCountry: 'US' }); }
      catch (e) { if (!/already/i.test(String(e && e.message))) throw e; }
      if (cliente.getClientState() !== V.ClientState.CONNECTED && cliente.getClientState() !== V.ClientState.LOGGED_IN) {
        await cliente.connect();
      }
      estado('Iniciando sesión…');
      const key = await new Promise((ok, no) => {
        const h = ev => {
          cliente.removeEventListener(V.Events.AuthResult, h);
          if (ev.result === false && ev.code === 302 && ev.key) ok(ev.key);
          else if (ev.result === true) ok(null);
          else no(new Error('No se pudo pedir la llave de sesión (código ' + ev.code + ')'));
        };
        cliente.addEventListener(V.Events.AuthResult, h);
        cliente.requestOneTimeLoginKey(config.usuario);
      });
      if (key) {
        const r = await fetch('api/vox/login-key', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }) });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'El servidor no firmó el login');
        await new Promise((ok, no) => {
          const h = ev => {
            cliente.removeEventListener(V.Events.AuthResult, h);
            ev.result ? ok() : no(new Error('Voximplant rechazó el login (código ' + ev.code + '). Revisa VOX_USER_PASSWORD en Render.'));
          };
          cliente.addEventListener(V.Events.AuthResult, h);
          cliente.loginWithOneTimeKey(config.usuario, d.hash);
        });
      }
      conectado = true;
      cliente.addEventListener(V.Events.ConnectionClosed, () => { conectado = false; });
    })();
    try { await conectando; } finally { conectando = null; }
  }

  function llamar({ lead, uuid }, cb) {
    const V = SDK();
    const estado = t => cb.estado && cb.estado(t);
    let terminado = false;
    const fin = info => { if (terminado) return; terminado = true; llamadaActual = null; cb.fin && cb.fin(info || {}); };
    (async () => {
      await sesion(estado);
      estado('Marcando a ' + lead.telefono + '…');
      const call = cliente.call({
        number: lead.telefono,
        video: { sendVideo: false, receiveVideo: false },
        customData: JSON.stringify({ uuid, lead_id: lead.id }),
      });
      llamadaActual = call;
      let contesto = false;
      call.addEventListener(V.CallEvents.Connected, () => { contesto = true; estado('En llamada'); });
      call.addEventListener(V.CallEvents.ProgressToneStart, () => estado('Timbrando…'));
      call.addEventListener(V.CallEvents.Disconnected, () => fin({ contesto }));
      call.addEventListener(V.CallEvents.Failed, ev => {
        // 486 ocupado, 480/487 no contesta: son resultados normales, no errores.
        const normal = [480, 486, 487, 603].includes(ev.code);
        fin(normal ? { contesto: false, codigo: ev.code } : { error: (ev.reason || 'falló') + ' (' + ev.code + ')', codigo: ev.code });
      });
    })().catch(e => fin({ error: e.message || String(e) }));
  }

  function colgar() {
    if (llamadaActual) { try { llamadaActual.hangup(); } catch (_) { /* nada */ } }
  }

  window.SDR_TELEFONIA = { disponible, motivo, llamar, colgar };
})();

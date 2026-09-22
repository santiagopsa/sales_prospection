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
  const log = (...a) => { try { console.log('[sdr/tel]', ...a); } catch (_) {} };
  const bitacora = [];   // últimos eventos, para mostrarlos en la ficha cuando algo falla
  const anotar = t => { bitacora.push(new Date().toLocaleTimeString('es-CO') + ' · ' + t); if (bitacora.length > 30) bitacora.shift(); log(t); };

  fetch('api/vox/config').then(r => r.json()).then(c => { config = c; }).catch(() => { config = { configurado: false, faltan: ['servidor'] }; });

  function disponible() { return !!(config && config.configurado && SDK()); }

  function motivo() {
    if (!SDK()) return 'No cargó el SDK de Voximplant (revisa la conexión).';
    if (!config) return 'Consultando la configuración…';
    if (!config.configurado) return 'Faltan en Render: ' + config.faltan.join(', ') + (config.faltan.includes('VOX_NODE') ? ' (el nodo está en el dashboard de Voximplant, sección "Credentials for working with API, SDK, SIP")' : '');
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
      estado('Conectando con la central…'); anotar('init');
      const nodo = V.ConnectionNode && V.ConnectionNode['NODE_' + config.node];
      if (!nodo) throw new Error('VOX_NODE=' + config.node + ' no es un nodo válido del SDK (1 a 13).');
      anotar('nodo NODE_' + config.node);
      try { await cliente.init({ node: nodo, micRequired: true, showDebugInfo: false, progressTone: true, progressToneCountry: 'US' }); }
      catch (e) {
        if (!/already/i.test(String(e && e.message))) {
          if (/NotAllowed|Permission|denied/i.test(String(e && (e.name + ' ' + e.message)))) throw new Error('El navegador no dio permiso de micrófono. Haz clic en el candado de la barra de direcciones y permite el micrófono.');
          throw new Error('No se pudo iniciar el SDK: ' + (e && e.message || e));
        }
      }
      anotar('estado del cliente: ' + cliente.getClientState());
      if (cliente.getClientState() !== V.ClientState.CONNECTED && cliente.getClientState() !== V.ClientState.LOGGED_IN) {
        try { await cliente.connect(); } catch (e) { throw new Error('No se pudo conectar con Voximplant: ' + (e && e.message || e)); }
      }
      anotar('conectado; pidiendo llave para ' + config.usuario);
      estado('Iniciando sesión…');
      const key = await new Promise((ok, no) => {
        const h = ev => {
          cliente.removeEventListener(V.Events.AuthResult, h);
          anotar('AuthResult (llave): result=' + ev.result + ' code=' + ev.code);
          if (ev.result === false && ev.code === 302 && ev.key) ok(ev.key);
          else if (ev.result === true) ok(null);
          else no(new Error('No se pudo pedir la llave de sesión (código ' + ev.code + '). ¿Existe el usuario ' + config.usuario + '?'));
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
            anotar('AuthResult (login): result=' + ev.result + ' code=' + ev.code);
            ev.result ? ok() : no(new Error('Voximplant rechazó el login (código ' + ev.code + '). Revisa VOX_USER_PASSWORD en Render (debe ser la del archivo voximplant-render.env).'));
          };
          cliente.addEventListener(V.Events.AuthResult, h);
          cliente.loginWithOneTimeKey(config.usuario, d.hash);
        });
      }
      conectado = true; anotar('sesión iniciada');
      cliente.addEventListener(V.Events.ConnectionClosed, () => { conectado = false; anotar('conexión cerrada'); });
    })();
    try { await conectando; } finally { conectando = null; }
  }

  // Lo que pasó en un intento fallido se manda al servidor para que quede en el registro de
  // Render (así se puede revisar después sin depender de la pantalla de Angie).
  function reportar(lead, uuid, motivo) {
    try {
      fetch('api/vox/bitacora', { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lead_id: lead.id, uuid, telefono: lead.telefono, motivo, bitacora: bitacora.slice(-15), usuario: (localStorage.getItem('sdr_usuario') || '') }) });
    } catch (_) { /* nada */ }
  }

  function llamar({ lead, uuid }, cb) {
    const V = SDK();
    const estado = t => cb.estado && cb.estado(t);
    let terminado = false;
    const fin = info => { if (terminado) return; terminado = true; llamadaActual = null; if (info && info.error) reportar(lead, uuid, info.error); cb.fin && cb.fin(info || {}); };
    let intentos = 0;

    const marcar = async () => {
      intentos++;
      // La sesión pudo caerse entre una llamada y otra (Render reinicia, la red se va): se
      // comprueba el estado real del SDK, no la bandera.
      if (cliente && conectado) {
        const st = cliente.getClientState();
        if (st !== V.ClientState.LOGGED_IN) { anotar('sesión perdida (estado ' + st + '); reconectando'); conectado = false; }
      }
      await sesion(estado);
      anotar('llamando a ' + lead.telefono + ' uuid=' + uuid + ' intento ' + intentos);
      estado('Marcando a ' + lead.telefono + '…');
      const call = cliente.call({
        number: lead.telefono,
        video: { sendVideo: false, receiveVideo: false },
        customData: JSON.stringify({ uuid, lead_id: lead.id }),
      });
      llamadaActual = call;
      let contesto = false;
      call.addEventListener(V.CallEvents.Connected, () => { contesto = true; anotar('Connected'); estado('En llamada'); });
      call.addEventListener(V.CallEvents.ProgressToneStart, () => { anotar('ProgressToneStart'); estado('Timbrando…'); });
      call.addEventListener(V.CallEvents.Disconnected, ev => { anotar('Disconnected ' + JSON.stringify(ev && ev.headers || {})); fin({ contesto }); });
      call.addEventListener(V.CallEvents.Failed, ev => {
        anotar('Failed code=' + ev.code + ' reason=' + ev.reason);
        // 486 ocupado, 480/487 no contesta: son resultados normales, no errores.
        if ([480, 486, 487, 603].includes(ev.code)) return fin({ contesto: false, codigo: ev.code, motivo: ev.reason });
        // Fallas transitorias del lado de la central: un reintento automático antes de rendirse.
        if (intentos < 2 && [500, 502, 503, 504, 408].includes(ev.code)) { estado('La central no respondió; reintentando…'); return setTimeout(() => marcar().catch(err => fin({ error: err.message || String(err) })), 1500); }
        fin({ error: (ev.reason || 'falló') + ' (código ' + ev.code + ')', codigo: ev.code });
      });
    };
    marcar().catch(e => { anotar('error: ' + (e.message || e)); fin({ error: e.message || String(e) }); });
  }

  function colgar() {
    if (llamadaActual) { try { llamadaActual.hangup(); } catch (_) { /* nada */ } }
  }

  window.SDR_TELEFONIA = { disponible, motivo, llamar, colgar, bitacora: () => bitacora.slice() };
})();

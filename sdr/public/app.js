// SDR Coach — pantalla de Angie. Vanilla, igual que el Sandler.
(function () {
  const $app = document.getElementById('app');
  let meta = { etapas: [], canales: [] };
  const etiqueta = (lista, id) => (lista.find(x => x.id === id) || {}).label || id;

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fecha = ms => ms == null ? '—' : new Date(ms).toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric', month: 'short' });
  const fechaHora = ms => ms == null ? '—' : new Date(ms).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  const telVisible = t => {
    if (!t) return '';
    const m = /^\+57(3\d{2})(\d{3})(\d{4})$/.exec(t) || /^\+57(60\d)(\d{3})(\d{4})$/.exec(t);
    return m ? `${m[1]} ${m[2]} ${m[3]}` : t;
  };
  const plural = (n, uno, varios) => `${n} ${n === 1 ? uno : varios}`;

  // Quién está usando la app: etiqueta elegida en la barra, sin credenciales. Va en cada POST.
  const USUARIO_KEY = 'sdr_usuario';
  const usuarioActual = () => { try { return localStorage.getItem(USUARIO_KEY) || ''; } catch (_) { return ''; } };
  function pintarUsuarios() {
    const $sel = document.getElementById('usuario');
    if (!$sel || !meta.usuarios) return;
    const actual = usuarioActual();
    $sel.innerHTML = '<option value="">¿Quién eres?</option>' + meta.usuarios.map(u => `<option value="${esc(u.nombre)}" ${u.nombre === actual ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('');
    $sel.classList.toggle('sin-usuario', !actual);
    $sel.onchange = () => { try { localStorage.setItem(USUARIO_KEY, $sel.value); } catch (_) {} $sel.classList.toggle('sin-usuario', !$sel.value); avisar($sel.value ? `Hola, ${$sel.value}.` : 'Elige quién eres para que quede registrado.'); render(); };
  }

  async function api(ruta, opciones = {}) {
    let body = opciones.body;
    if (body && (opciones.method || 'GET') !== 'GET') {
      if (!usuarioActual()) { const $sel = document.getElementById('usuario'); if ($sel) $sel.focus(); throw new Error('Elige quién eres en la barra de arriba antes de registrar algo.'); }
      body = { ...body, usuario: usuarioActual() };
    }
    const r = await fetch('api/' + ruta, {
      method: opciones.method || 'GET',
      headers: body ? { 'Content-Type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
    return datos;
  }

  const pintarError = e => `<div class="error">${esc(e.message)}</div>`;

  // ---------------------------------------------------------------- cola
  async function vistaCola(params = new URLSearchParams()) {
    const c = await api('cola' + (usuarioActual() ? '?usuario=' + encodeURIComponent(usuarioActual()) : ''));
    const i = c.indicadores;
    const ver = params.get('ver') || 'todas';   // todas | vencidas | hoy
    const lista = ver === 'vencidas' ? c.tareas.filter(t => t.vencida) : ver === 'hoy' ? c.tareas.filter(t => !t.vencida) : c.tareas;
    const kpiLink = (cual, activo) => `href="#/cola${cual === 'todas' ? '' : '?ver=' + cual}" class="kpi enlace ${activo ? 'activo' : ''}"`;
    const hoy = new Date(`${c.fecha}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    const b = c.bloque && c.bloque.enCurso;
    const barra = (valor, meta) => `<div class="meta"><i style="width:${Math.min(100, Math.round(valor / Math.max(meta, 1) * 100))}%"></i></div>`;
    const siguiente = c.tareas.find(t => t.canal === 'llamada' && t.telefono) || c.tareas[0];
    $app.innerHTML = `
      <div class="cabeza">
        <div><h1>Cola del día</h1><div class="suave">${esc(hoy)} · ${plural(c.tareas.length, 'toque pendiente', 'toques pendientes')}${c.usuario ? ` · ritmo de <b>${esc(c.usuario)}</b>` : ''}</div></div>
        <div class="acciones" style="margin:0">
          ${siguiente ? `<a class="btn primario grande" href="#/lead/${siguiente.lead_id}${siguiente.canal === 'llamada' && siguiente.telefono ? '?llamar=1' : ''}">${siguiente.canal === 'llamada' ? '📞 Llamar al siguiente' : 'Siguiente toque'} · ${esc(siguiente.empresa)}</a>` : ''}
          <a class="btn" href="#/marcar">Marcar</a>
        </div>
      </div>
      <div class="ritmo">
        <div class="ritmo-principal">
          ${b ? `
            <div class="ritmo-titulo"><b>${esc(b.nombre)}</b> <span class="suave">${b.inicio}–${b.fin} · quedan ${b.minutosRestantes} min</span></div>
            <div class="ritmo-num"><b>${b.marcaciones}</b><span class="suave"> / ${b.metaMarcaciones} marcaciones en este bloque</span></div>
            ${barra(b.marcaciones, b.metaMarcaciones)}
            <div class="suave" style="font-size:12px;margin-top:6px">Hoy: ${i.marcaciones} / ${i.metaMarcaciones} marcaciones · ${i.conversaciones} / ${i.metaConversaciones} conversaciones</div>`
          : `
            <div class="ritmo-titulo"><b>Hoy</b> <span class="suave">${c.bloque && c.bloque.siguiente ? `próximo bloque: ${esc(c.bloque.siguiente.nombre)} a las ${c.bloque.siguiente.inicio}` : 'fuera de bloque de prospección'}</span></div>
            <div class="ritmo-doble">
              <div><div class="ritmo-num"><b>${i.marcaciones}</b><span class="suave"> / ${i.metaMarcaciones} marcaciones</span></div>${barra(i.marcaciones, i.metaMarcaciones)}</div>
              <div><div class="ritmo-num"><b>${i.conversaciones}</b><span class="suave"> / ${i.metaConversaciones} conversaciones</span></div>${barra(i.conversaciones, i.metaConversaciones)}</div>
            </div>`}
        </div>
        <div class="ritmo-lado">
          <div class="racha ${c.racha.hoyCumple ? 'hoy' : ''}"><b>${c.racha.dias}</b><span>${c.racha.dias === 1 ? 'día seguido' : 'días seguidos'} cumpliendo la meta${c.racha.hoyCumple ? ' · hoy ✓' : ''}</span></div>
          <a href="#/semana" class="suave" style="font-size:12px">Ver la semana →</a>
        </div>
      </div>
      <div class="alertas">
        ${i.vencidas ? `<a ${kpiLink(ver === 'vencidas' ? 'todas' : 'vencidas', ver === 'vencidas')} data-mal><b>${i.vencidas}</b><span>${i.vencidas === 1 ? 'toque vencido' : 'toques vencidos'}</span></a>` : ''}
        ${i.huerfanos ? `<a class="kpi enlace alerta" href="#/pipeline?huerfanos=1"><b>${i.huerfanos}</b><span>${i.huerfanos === 1 ? 'lead sin próximo toque' : 'leads sin próximo toque'}</span></a>` : ''}
        ${!i.vencidas && !i.huerfanos ? '<span class="suave" style="font-size:12px">Sin vencidos ni leads huérfanos.</span>' : ''}
        ${ver === 'todas' ? '' : `<a class="kpi enlace" href="#/cola"><b>${c.tareas.length}</b><span>ver todos</span></a>`}
      </div>
      ${ver !== 'todas' ? `<div class="filtro-activo suave">Mostrando solo <b>${ver === 'vencidas' ? 'vencidas' : 'las de hoy'}</b> · <a href="#/cola">ver todas</a></div>` : ''}
      ${lista.length ? `<div class="cola">${lista.map((t, n) => `
        <div class="item" data-lead="${t.lead_id}">
          <div class="pos">${n + 1}</div>
          <div class="quien">
            <b>${esc(t.empresa)}</b>
            <div>${esc([t.contacto, t.cargo].filter(Boolean).join(' · ') || 'Sin contacto')}${t.ciudad ? ' · ' + esc(t.ciudad) : ''}</div>
            <div class="num">${esc(telVisible(t.telefono) || t.email || '')}</div>
          </div>
          <div class="lado">
            <span class="chip ${t.canal}">${esc(etiqueta(meta.canales, t.canal))} · paso ${t.paso}/${t.pasos_total}</span>
            ${t.vencida ? `<span class="chip vencida">Vencida ${plural(t.diasVencida, 'día', 'días')}</span>` : '<span class="chip hoy">Hoy</span>'}
            ${t.etapa !== 'nuevo' ? `<span class="chip etapa">${esc(etiqueta(meta.etapas, t.etapa))}</span>` : ''}
            <span class="mover"><button class="btn mini" data-posponer="1" data-task="${t.id}" title="Mover al siguiente día hábil">Mañana</button><button class="btn mini" data-posponer="5" data-task="${t.id}" title="Mover una semana">+1 semana</button></span>
          </div>
        </div>`).join('')}</div>`
        : `<div class="panel vacio">${ver === 'todas' ? 'No hay toques pendientes para hoy.<br><a href="#/importar">Carga una lista de leads</a> para empezar.' : 'Nada en este filtro. <a href="#/cola">Ver todas</a>'}</div>`}`;

    // Clic en la tarjeta abre la ficha; los botones de posponer no.
    $app.querySelectorAll('.item[data-lead]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button')) return;
      location.hash = '#/lead/' + el.dataset.lead;
    }));
    $app.querySelectorAll('[data-posponer]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try {
        const r = await api(`tareas/${b.dataset.task}/posponer`, { method: 'POST', body: { dias: Number(b.dataset.posponer) } });
        avisar(`Movida al ${fecha(new Date(r.due_at).getTime())}.`);
        await vistaCola(params);
      } catch (e) { avisar(e.message, 'error'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------- cargar
  function leerArchivo(file) {
    return file.arrayBuffer().then(buf => {
      // Excel en Windows guarda CSV en Windows-1252; si no es UTF-8 válido, se lee así.
      try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); }
      catch (_) { return new TextDecoder('windows-1252').decode(buf); }
    });
  }

  async function vistaImportar() {
    const cargas = await api('cargas').catch(() => []);
    $app.innerHTML = `
      <div class="cabeza"><div><h1>Cargar leads</h1>
        <div class="suave">CSV o Excel (.xlsx). Sirve la exportación de Apollo tal cual, o un archivo con empresa, contacto, cargo, teléfono, correo, ciudad y fuente.</div></div></div>
      <div id="msg"></div>
      <label class="soltar" id="soltar">
        <input type="file" id="archivo" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" hidden />
        <b>Arrastra el archivo aquí o haz clic para elegirlo</b>
        <p class="suave">Primero verás qué va a entrar. Nada se guarda hasta que confirmes.</p>
      </label>
      <div id="informe"></div>
      ${cargas.length ? `<div class="panel bloque"><h2>Cargas anteriores</h2><div class="tabla-env"><table>
        <thead><tr><th>Fecha</th><th>Archivo</th><th class="num">Filas</th><th class="num">Creados</th><th class="num">Duplicados</th><th class="num">Con error</th></tr></thead>
        <tbody>${cargas.map(c => `<tr><td>${fechaHora(c.created_ms)}</td><td>${esc(c.archivo || '—')}</td><td class="num">${c.filas}</td><td class="num">${c.creados}</td><td class="num">${c.duplicados}</td><td class="num">${c.con_error}</td></tr>`).join('')}</tbody>
      </table></div></div>` : ''}`;

    const $soltar = document.getElementById('soltar');
    const $input = document.getElementById('archivo');
    const tomar = async file => {
      if (!file) return;
      if (/\.xlsx$/i.test(file.name)) {
        const buf = await file.arrayBuffer();
        let bin = ''; const bytes = new Uint8Array(buf);
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        await analizar(file.name, null, btoa(bin));
      } else await analizar(file.name, await leerArchivo(file));
    };
    $input.addEventListener('change', () => tomar($input.files[0]));
    $soltar.addEventListener('dragover', e => { e.preventDefault(); $soltar.classList.add('encima'); });
    $soltar.addEventListener('dragleave', () => $soltar.classList.remove('encima'));
    $soltar.addEventListener('drop', e => { e.preventDefault(); $soltar.classList.remove('encima'); tomar(e.dataTransfer.files[0]); });
  }

  async function analizar(archivo, contenido, base64) {
    const $inf = document.getElementById('informe');
    const $msg = document.getElementById('msg');
    $msg.innerHTML = '';
    $inf.innerHTML = '<p class="vacio">Revisando el archivo…</p>';
    let inf;
    try { inf = await api('importar', { method: 'POST', body: { archivo, contenido, base64 } }); }
    catch (e) { $inf.innerHTML = ''; $msg.innerHTML = pintarError(e); return; }
    $inf.innerHTML = pintarInforme(inf, true);
    const $ok = document.getElementById('confirmar');
    if ($ok) $ok.addEventListener('click', async () => {
      $ok.disabled = true; $ok.textContent = 'Cargando…';
      try {
        const final = await api('importar', { method: 'POST', body: { archivo, contenido, base64, confirmar: true } });
        $inf.innerHTML = pintarInforme(final, false);
      } catch (e) { $msg.innerHTML = pintarError(e); $ok.disabled = false; $ok.textContent = 'Reintentar'; }
    });
    const $otro = document.getElementById('otro');
    if ($otro) $otro.addEventListener('click', () => render());
  }

  function pintarInforme(inf, simulado) {
    const creados = simulado ? inf.aCrear : inf.creados.length;
    const tabla = (titulo, filas, columna) => filas.length ? `
      <div class="panel bloque"><h2>${titulo}</h2><div class="tabla-env"><table>
        <thead><tr><th class="num">Fila</th><th>Empresa</th><th>${columna}</th></tr></thead>
        <tbody>${filas.map(f => `<tr><td class="num">${f.fila}</td><td>${esc(f.empresa || '—')}</td><td>${esc(f.motivo || (f.avisos || []).join('; '))}${f.lead_id ? ` · <a href="#/lead/${f.lead_id}">ver</a>` : ''}</td></tr>`).join('')}</tbody>
      </table></div></div>` : '';
    return `
      ${simulado ? '' : `<div class="panel bloque" style="border-color:var(--verde)"><b>Carga lista.</b> ${plural(creados, 'lead entró', 'leads entraron')} con su secuencia de toques. <a href="#/cola">Ir a la cola</a></div>`}
      <div class="resumen">
        <div class="kpi bien"><b>${creados}</b><span>${simulado ? 'Leads nuevos a crear' : 'Leads creados'}</span></div>
        <div class="kpi ${inf.duplicados.length ? 'alerta' : ''}"><b>${inf.duplicados.length}</b><span>Duplicados (no entran)</span></div>
        <div class="kpi ${inf.errores.length ? 'mal' : ''}"><b>${inf.errores.length}</b><span>Filas con error</span></div>
        <div class="kpi"><b>${inf.filas}</b><span>Filas en ${esc(inf.archivo || 'el archivo')}</span></div>
      </div>
      <div class="panel">
        <h2>Columnas reconocidas</h2>
        <div class="secuencia">${Object.entries(inf.columnas).map(([k, v]) => `<span class="chip">${esc(k)} ← "${esc(v)}"</span>`).join('')}</div>
        <h2 style="margin-top:14px">Secuencia que recibe cada lead</h2>
        <div class="secuencia">${inf.secuencia.map(p => `<span class="chip ${p.canal}">${p.paso}. ${esc(etiqueta(meta.canales, p.canal))} · ${fecha(new Date(p.fecha + 'T12:00:00-05:00').getTime())}</span>`).join('')}</div>
      </div>
      ${simulado ? `<div class="acciones">
        ${creados ? `<button class="btn primario" id="confirmar">Cargar ${plural(creados, 'lead', 'leads')}</button>` : '<b>No hay leads nuevos en este archivo.</b>'}
        <button class="btn" id="otro">Elegir otro archivo</button></div>` : ''}
      ${tabla('Filas con error', inf.errores, 'Motivo')}
      ${tabla('Duplicados', inf.duplicados, 'Por qué')}
      ${tabla('Entran con aviso', inf.avisos, 'Aviso')}`;
  }

  // ---------------------------------------------------------------- pipeline
  async function vistaPipeline(params) {
    const etapa = params.get('etapa') || '';
    const huerfanos = params.get('huerfanos') === '1';
    const q = params.get('q') || '';
    const qs = new URLSearchParams();
    if (etapa) qs.set('etapa', etapa);
    if (huerfanos) qs.set('huerfanos', '1');
    if (q) qs.set('q', q);
    const [{ etapas: conteo, huerfanos: nHuerfanos }, leads] = await Promise.all([api('pipeline'), api('leads?' + qs)]);
    const total = conteo.reduce((s, x) => s + x.n, 0);
    $app.innerHTML = `
      <div class="cabeza"><div><h1>Pipeline</h1><div class="suave">${plural(total, 'lead', 'leads')} en total</div></div></div>
      <div class="etapas">
        <a class="etapa ${!etapa && !huerfanos ? 'activo' : ''}" href="#/pipeline"><b>${total}</b><span>Todos</span></a>
        ${conteo.map(x => `<a class="etapa ${etapa === x.etapa ? 'activo' : ''}" href="#/pipeline?etapa=${x.etapa}"><b>${x.n}</b><span>${esc(etiqueta(meta.etapas, x.etapa))}</span></a>`).join('')}
        <a class="etapa ${huerfanos ? 'activo' : ''}" href="#/pipeline?huerfanos=1"><b>${nHuerfanos}</b><span>Sin próximo toque</span></a>
      </div>
      <form class="filtros" id="buscar"><input type="search" name="q" placeholder="Buscar por empresa, contacto, correo o teléfono" value="${esc(q)}" /><button class="btn">Buscar</button></form>
      ${leads.length ? `<div class="panel tabla-env"><table>
        <thead><tr><th>Empresa</th><th>Contacto</th><th>Teléfono / correo</th><th>Etapa</th><th>Próximo toque</th></tr></thead>
        <tbody>${leads.map(l => `<tr>
          <td><a href="#/lead/${l.id}"><b>${esc(l.empresa)}</b></a></td>
          <td>${esc([l.contacto, l.cargo].filter(Boolean).join(' · ') || '—')}</td>
          <td class="num">${esc(telVisible(l.telefono) || l.email || '—')}</td>
          <td><span class="chip etapa">${esc(etiqueta(meta.etapas, l.etapa))}</span></td>
          <td>${l.proximo_ms ? fecha(l.proximo_ms) : '<span class="suave">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="panel vacio">Ningún lead con este filtro.</div>'}`;
    document.getElementById('buscar').addEventListener('submit', e => {
      e.preventDefault();
      const nq = new FormData(e.target).get('q');
      const p = new URLSearchParams(qs); nq ? p.set('q', nq) : p.delete('q');
      location.hash = '#/pipeline?' + p;
    });
  }

  // ---------------------------------------------------------------- ficha
  let toast = null;
  function avisar(texto, tipo = 'ok') {
    if (toast) toast.remove();
    toast = document.createElement('div');
    toast.className = 'toast ' + tipo;
    toast.textContent = texto;
    document.body.appendChild(toast);
    setTimeout(() => toast && toast.remove(), tipo === 'ok' ? 4000 : 8000);
  }

  const DE_ANGIE = ['nuevo', 'contactado', 'conversacion'];
  const waLink = tel => tel ? `https://wa.me/${tel.replace(/\D/g, '')}` : null;
  const fechaLocal = d => { // Date → valor de <input type=datetime-local> en hora de Bogotá
    const p = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d);
    const g = t => p.find(x => x.type === t).value;
    return `${g('year')}-${g('month')}-${g('day')}T${g('hour') === '24' ? '00' : g('hour')}:${g('minute')}`;
  };

  async function vistaLead(id) {
    const l = await api('leads/' + encodeURIComponent(id));
    const deAngie = DE_ANGIE.includes(l.etapa);
    const tel = window.SDR_TELEFONIA || {};
    const puedeLlamar = !!(l.telefono && tel.disponible && tel.disponible());
    const proxima = l.tareas.find(t => t.estado === 'pendiente');
    const pintaToque = t => {
      const cuando = fechaHora(t.created_ms);
      const que = t.canal === 'ejecutiva' ? (meta.resultadoLabel[t.resultado] || t.resultado) : (meta.resultadoLabel[t.resultado] || t.resultado);
      const extra = [
        t.razon_descarte && (meta.razonLabel[t.razon_descarte] || t.razon_descarte),
        t.duracion_s != null && `${Math.floor(t.duracion_s / 60)}:${String(t.duracion_s % 60).padStart(2, '0')} min`,
        t.detalle && t.detalle.reunion_at && 'reunión ' + fechaHora(new Date(t.detalle.reunion_at).getTime()),
      ].filter(Boolean).join(' · ');
      return `<li>
        <span class="chip ${t.canal}">${esc(t.canal === 'ejecutiva' ? 'Ejecutiva' : etiqueta(meta.canales, t.canal))}</span>
        <div style="flex:1;min-width:0"><b>${esc(que)}</b>${extra ? ` <span class="suave">· ${esc(extra)}</span>` : ''}
          ${t.nota ? `<div class="suave" style="white-space:pre-wrap">${esc(t.nota)}</div>` : ''}
          ${t.record_url ? `<div><a href="${esc(t.record_url)}" target="_blank" rel="noopener">Escuchar grabación</a></div>` : ''}</div>
        <span class="suave" style="font-size:12px;white-space:nowrap;text-align:right">${cuando}${t.usuario ? `<br>${esc(t.usuario)}` : ''}</span>
      </li>`;
    };

    $app.innerHTML = `
      <div class="cabeza">
        <div><div class="suave"><a href="#/cola">← Cola</a></div><h1>${esc(l.empresa)}</h1>
          <div class="suave">${esc([l.contacto, l.cargo].filter(Boolean).join(' · ') || 'Sin contacto')}${l.ciudad ? ' · ' + esc(l.ciudad) : ''}</div></div>
        <div style="text-align:right">
          <span class="chip etapa" style="font-size:13px">${esc(etiqueta(meta.etapas, l.etapa))}</span>
          ${l.razon_descarte ? `<div class="suave" style="font-size:12px;margin-top:4px">${esc(meta.razonLabel[l.razon_descarte] || l.razon_descarte)}</div>` : ''}
          ${l.reunion_ms ? `<div class="suave" style="font-size:12px;margin-top:4px">Reunión: ${fechaHora(l.reunion_ms)}</div>` : ''}
          ${l.deal_id ? `<div style="font-size:12px;margin-top:4px"><a href="/#/deal/${l.deal_id}" target="_blank" rel="noopener">Deal #${l.deal_id} en el Sandler ↗</a></div>` : ''}
        </div>
      </div>
      <div id="msg"></div>
      <div class="ficha">
        <div>
          <div class="panel">
            <h2>Acciones</h2>
            ${deAngie ? `
              ${proxima ? `<p class="suave" style="margin:0 0 10px">Siguiente toque: <b>${esc(etiqueta(meta.canales, proxima.canal))}</b> · ${fecha(proxima.due_ms)}</p>` : '<p class="suave" style="margin:0 0 10px">Sin próximo toque programado.</p>'}
              <div class="acciones" style="margin-top:0">
                <button class="btn primario grande" id="llamar" ${puedeLlamar ? '' : 'disabled'} title="${puedeLlamar ? 'Llama desde el navegador' : (l.telefono ? (tel.motivo ? tel.motivo() : 'La telefonía no está configurada todavía') : 'El lead no tiene teléfono')}">📞 Llamar ${esc(telVisible(l.telefono) || '')}</button>
                <button class="btn" id="llamada-manual" ${l.telefono ? '' : 'disabled'}>Registrar llamada hecha por fuera</button>
              </div>
              <div id="llamada-estado" class="suave" style="min-height:18px;margin:6px 0">${!puedeLlamar && l.telefono && tel.motivo ? esc(tel.motivo()) : ''}</div>
              <div class="acciones">
                <button class="btn" data-toque="whatsapp" ${l.telefono ? '' : 'disabled'}>WhatsApp enviado</button>
                <button class="btn" data-toque="correo" ${l.email ? '' : 'disabled'}>Correo enviado</button>
                <button class="btn" data-toque="linkedin">LinkedIn enviado</button>
                <button class="btn peligro" id="descartar">Descartar</button>
              </div>
              <p class="suave" style="font-size:12px;margin:0">${l.telefono ? `<a href="${waLink(l.telefono)}" target="_blank" rel="noopener">Abrir WhatsApp ↗</a>` : ''}${l.email ? ` · <a href="mailto:${esc(l.email)}">Escribir correo ↗</a>` : ''}</p>`
            : l.etapa === 'descartado' ? '<p class="suave" style="margin:0">Lead descartado. No hay acciones.</p>'
            : `<p class="suave" style="margin:0 0 10px">Desde aquí decide la ejecutiva comercial.</p>
              <div class="acciones" style="margin-top:0">
                ${l.etapa === 'reunion_agendada' ? `<button class="btn primario" data-ejecutiva="reunion_realizada">Reunión realizada</button>
                <button class="btn" data-ejecutiva="no_show">No se presentó</button>` : ''}
                ${['reunion_agendada', 'reunion_realizada'].includes(l.etapa) ? `<button class="btn primario" data-ejecutiva="calificado">Calificado</button>` : ''}
                ${l.etapa !== 'calificado' ? `<button class="btn peligro" id="descartar">Descartar</button>` : ''}
              </div>`}
          </div>
          <div class="panel" style="margin-top:16px">
            <h2>Datos</h2>
            <dl>
              <dt>Teléfono</dt><dd class="num">${esc(telVisible(l.telefono) || '—')}${l.telefono_original && l.telefono && l.telefono_original !== telVisible(l.telefono) ? ` <span class="suave">(archivo: ${esc(l.telefono_original)})</span>` : ''}</dd>
              <dt>Correo</dt><dd>${esc(l.email || '—')}</dd>
              <dt>Ciudad</dt><dd>${esc(l.ciudad || '—')}</dd>
              <dt>Fuente</dt><dd>${esc(l.fuente || '—')}</dd>
              <dt>Cargado</dt><dd>${fechaHora(l.created_ms)}</dd>
              ${l.extra ? Object.entries({ industria: 'Industria', empleados: 'Empleados', seniority: 'Seniority', departamento: 'Área', pais: 'País', region: 'Región', ingresos: 'Ingresos', tecnologias: 'Tecnologías' })
                .filter(([k]) => l.extra[k]).map(([k, lab]) => `<dt>${lab}</dt><dd>${esc(l.extra[k])}</dd>`).join('') : ''}
              ${l.extra && (l.extra.linkedin || l.extra.sitio_web || l.extra.linkedin_empresa) ? `<dt>Enlaces</dt><dd>${[l.extra.linkedin && `<a href="${esc(l.extra.linkedin)}" target="_blank" rel="noopener">LinkedIn</a>`, l.extra.linkedin_empresa && `<a href="${esc(l.extra.linkedin_empresa)}" target="_blank" rel="noopener">LinkedIn empresa</a>`, l.extra.sitio_web && `<a href="${esc(/^https?:/.test(l.extra.sitio_web) ? l.extra.sitio_web : 'https://' + l.extra.sitio_web)}" target="_blank" rel="noopener">Sitio web</a>`].filter(Boolean).join(' · ')}</dd>` : ''}
            </dl>
            ${l.extra && l.extra.keywords ? `<p class="suave" style="font-size:12px;margin:10px 0 0"><b>Keywords:</b> ${esc(l.extra.keywords)}</p>` : ''}
          </div>
        </div>
        <div class="panel">
          <h2>Historial</h2>
          ${l.toques.length ? `<ul class="pasos historial">${l.toques.map(pintaToque).join('')}</ul>` : '<p class="suave" style="margin:0 0 14px">Todavía no hay toques registrados.</p>'}
          <h2 style="margin-top:16px">Secuencia</h2>
          <ul class="pasos">${l.tareas.map(t => `<li>
            <span class="n">${t.paso}</span>
            <span class="chip ${t.canal}">${esc(etiqueta(meta.canales, t.canal))}</span>
            <span class="${t.estado !== 'pendiente' ? 'hecha' : ''}">${fecha(t.due_ms)}</span>
            <span class="suave" style="margin-left:auto;font-size:12px">${esc(t.estado)}</span>
          </li>`).join('')}</ul>
        </div>
      </div>
      <div id="modal"></div>`;

    const $msg = document.getElementById('msg');
    const despues = r => {
      const partes = [`Registrado. Etapa: ${etiqueta(meta.etapas, r.etapa)}.`];
      if (r.proxima) partes.push(`Próximo toque: ${etiqueta(meta.canales, r.proxima.canal)} el ${fecha(new Date(r.proxima.due_at).getTime())}.`);
      (r.avisos || []).forEach(a => partes.push(a));
      avisar(partes.join(' '), (r.avisos || []).length ? 'aviso' : 'ok');
    };

    // Toques de un clic
    $app.querySelectorAll('[data-toque]').forEach(b => b.addEventListener('click', async () => {
      const canal = b.dataset.toque;
      if (canal === 'whatsapp' && l.telefono) window.open(waLink(l.telefono), '_blank', 'noopener');
      if (canal === 'correo' && l.email) window.open('mailto:' + l.email, '_self');
      b.disabled = true;
      try { despues(await api(`leads/${l.id}/toques`, { method: 'POST', body: { canal } })); location.hash = '#/cola'; }
      catch (e) { $msg.innerHTML = pintarError(e); b.disabled = false; }
    }));

    // Ejecutiva
    $app.querySelectorAll('[data-ejecutiva]').forEach(b => b.addEventListener('click', async () => {
      const accion = b.dataset.ejecutiva;
      const nota = window.prompt('Nota (opcional):', '') ;
      if (nota === null) return;
      b.disabled = true;
      try { despues(await api(`leads/${l.id}/ejecutiva`, { method: 'POST', body: { accion, nota } })); await vistaLead(l.id); }
      catch (e) { $msg.innerHTML = pintarError(e); b.disabled = false; }
    }));

    const $desc = document.getElementById('descartar');
    if ($desc) $desc.addEventListener('click', () => abrirResultado(l, { soloDescarte: true }));

    const $manual = document.getElementById('llamada-manual');
    if ($manual) $manual.addEventListener('click', () => abrirResultado(l, {}));

    const $llamar = document.getElementById('llamar');
    if ($llamar && puedeLlamar) $llamar.addEventListener('click', () => {
      const $estado = document.getElementById('llamada-estado');
      const uuid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      let enCurso = true, inicio = null, reloj = null;
      const mmss = ms => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
      const pintar = (fase, texto) => {
        // fase: conectando | timbrando | activa
        $estado.innerHTML = `<div class="llamada ${fase}">
          <span class="punto"></span>
          <div class="txt"><b>${esc(texto)}</b><span class="num" id="reloj">${inicio ? mmss(Date.now() - inicio) : ''}</span></div>
          <button class="btn colgar" type="button" id="colgar">Colgar</button></div>
          ${fase === 'activa' && meta.recordatorioGrabacion ? `<div class="recordatorio">🎙 ${esc(meta.recordatorioGrabacion)}</div>` : ''}`;
        document.getElementById('colgar').addEventListener('click', () => { if (enCurso) tel.colgar(); });
      };
      $llamar.disabled = true;
      pintar('conectando', 'Preparando la llamada…');
      tel.llamar({ lead: l, uuid }, {
        estado: txt => {
          const fase = /En llamada/.test(txt) ? 'activa' : (/Timbrando|Marcando/.test(txt) ? 'timbrando' : 'conectando');
          if (fase === 'activa' && !inicio) { inicio = Date.now(); reloj = setInterval(() => { const r = document.getElementById('reloj'); if (r) r.textContent = mmss(Date.now() - inicio); }, 1000); }
          pintar(fase, txt);
        },
        fin: info => {
          enCurso = false; clearInterval(reloj);
          $llamar.disabled = false;
          if (info && info.error) {
            // No salió la llamada: no hay nada que registrar. Se muestra el motivo y la bitácora.
            const detalle = (tel.bitacora ? tel.bitacora() : []).slice(-8).map(x => `<div>${esc(x)}</div>`).join('');
            $estado.innerHTML = `<div class="error" style="margin:0"><b>No se pudo llamar.</b> ${esc(info.error)}</div>
              <details style="margin-top:6px"><summary class="suave" style="cursor:pointer;font-size:12px">Detalle técnico</summary><div class="suave" style="font-size:12px;font-family:monospace">${detalle}</div></details>`;
            avisar('No se pudo llamar: ' + info.error, 'error');
            return;
          }
          const dur = inicio ? ` · ${mmss(Date.now() - inicio)}` : '';
          $estado.innerHTML = `<div class="llamada fin"><span class="punto"></span><div class="txt"><b>${info && info.contesto ? 'Llamada terminada' + dur : 'No contestaron' + (info && info.motivo ? ' (' + esc(info.motivo) + ')' : '')}</b></div></div>`;
          if (!(info && info.cancelada)) abrirResultado(l, { callUuid: uuid, obligatorio: true });
        },
      });
    });
  }

  // Diálogo de resultado de la llamada (obligatorio al colgar) o de descarte.
  function abrirResultado(l, { callUuid = null, obligatorio = false, soloDescarte = false } = {}) {
    const $modal = document.getElementById('modal');
    const resultados = soloDescarte ? meta.resultados.filter(r => r.id === 'descartado') : meta.resultados;
    const enUnaHora = new Date(Date.now() + 3600 * 1000);
    $modal.innerHTML = `
      <div class="velo"><form class="dialogo" id="frm">
        <h2>${soloDescarte ? 'Descartar lead' : 'Resultado de la llamada'}</h2>
        ${obligatorio ? '<p class="suave" style="margin:0 0 10px">Obligatorio: la llamada no queda registrada hasta que elijas un resultado.</p>' : ''}
        <div class="opciones">${resultados.map((r, i) => `<label class="opcion"><input type="radio" name="resultado" value="${r.id}" ${soloDescarte || (i === 0 && false) ? 'checked' : ''} required> ${esc(r.label)}</label>`).join('')}</div>
        <div id="campos-descarte" hidden>
          <label>Razón</label>
          <select name="razon">${meta.razones.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
        </div>
        <div id="campos-reunion" hidden>
          <label>Fecha y hora de la reunión</label>
          <input type="datetime-local" name="reunion_at" value="${fechaLocal(enUnaHora)}" />
          <div class="dos">
            <div><label>Ejecutiva que atiende</label><input name="ejecutiva" placeholder="Luisa" value="${esc((meta.usuarios || []).find(u => u.rol === 'ejecutiva') ? (meta.usuarios || []).find(u => u.rol === 'ejecutiva').nombre : '')}" /></div>
            <div><label>Línea de negocio</label><select name="linea_negocio"><option value="">—</option><option>Headhunting</option><option>EOR</option><option>SaaS</option></select></div>
          </div>
          <label>Cargos que necesita</label><input name="ficha_cargos" placeholder="Ej. 2 devs backend senior, 1 QA" />
          <div class="dos">
            <div><label>Costo de la vacante abierta</label><input name="ficha_costo" placeholder="Ej. $8M/mes por dev sin contratar" /></div>
            <div><label>Herramientas actuales</label><input name="ficha_herramientas" placeholder="Ej. LinkedIn, Computrabajo" /></div>
          </div>
          <div class="dos">
            <div><label>Actitud / interés</label><input name="actitud" placeholder="Ej. muy interesada, pidió propuesta" /></div>
            <div><label>Urgencia (¿por qué ahora?)</label><input name="urgencia" placeholder="Ej. proyecto arranca en octubre" /></div>
          </div>
        </div>
        <label>Nota</label>
        <textarea name="nota" rows="3" placeholder="Lo que valga la pena recordar de esta llamada"></textarea>
        <div class="acciones">
          <button class="btn primario" type="submit">Guardar</button>
          ${obligatorio ? '' : '<button class="btn" type="button" id="cancelar">Cancelar</button>'}
        </div>
        <div id="frm-error"></div>
      </form></div>`;
    const $frm = document.getElementById('frm');
    const mostrar = () => {
      const v = ($frm.querySelector('input[name=resultado]:checked') || {}).value;
      document.getElementById('campos-descarte').hidden = v !== 'descartado';
      document.getElementById('campos-reunion').hidden = v !== 'reunion_agendada';
    };
    $frm.querySelectorAll('input[name=resultado]').forEach(r => r.addEventListener('change', mostrar));
    mostrar();
    const $cancelar = document.getElementById('cancelar');
    if ($cancelar) $cancelar.addEventListener('click', () => { $modal.innerHTML = ''; });
    $frm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData($frm);
      const resultado = f.get('resultado');
      if (!resultado) return;
      const body = { nota: f.get('nota') || '' };
      let ruta;
      if (soloDescarte) {
        ruta = `leads/${l.id}/ejecutiva`;
        Object.assign(body, { accion: 'descartado', razon: f.get('razon') });
      } else {
        ruta = `leads/${l.id}/toques`;
        Object.assign(body, { canal: 'llamada', resultado, call_uuid: callUuid });
        if (resultado === 'descartado') body.razon = f.get('razon');
        if (resultado === 'reunion_agendada') {
          const local = f.get('reunion_at');
          body.detalle = {
            reunion_at: local ? new Date(local + ':00-05:00').toISOString() : null,
            ejecutiva: f.get('ejecutiva'), linea_negocio: f.get('linea_negocio'),
            ficha_cargos: f.get('ficha_cargos'), ficha_costo: f.get('ficha_costo'), ficha_herramientas: f.get('ficha_herramientas'),
            actitud: f.get('actitud'), urgencia: f.get('urgencia'),
          };
        }
      }
      $frm.querySelector('button[type=submit]').disabled = true;
      try {
        const r = await api(ruta, { method: 'POST', body });
        $modal.innerHTML = '';
        const partes = [`Registrado. Etapa: ${etiqueta(meta.etapas, r.etapa)}.`];
        if (r.proxima) partes.push(`Próximo toque: ${etiqueta(meta.canales, r.proxima.canal)} el ${fecha(new Date(r.proxima.due_at).getTime())}.`);
        (r.avisos || []).forEach(a => partes.push(a));
        avisar(partes.join(' '), (r.avisos || []).length ? 'aviso' : 'ok');
        // Doble toque: si no contestó, WhatsApp de una vez (abre el chat y registra el toque).
        if (['no_contesto', 'buzon'].includes(resultado) && l.telefono && ['nuevo', 'contactado', 'conversacion'].includes(r.etapa)) {
          $modal.innerHTML = `<div class="velo"><div class="dialogo" style="max-width:420px">
            <h2>No contestó. ¿Enviar WhatsApp ahora?</h2>
            <p class="suave" style="margin:0 0 12px">Abre el chat con ${esc(telVisible(l.telefono))} y registra el toque.</p>
            <div class="acciones" style="margin:0"><button class="btn primario" id="wa-si">Sí, abrir WhatsApp</button><button class="btn" id="wa-no">Ahora no</button></div></div></div>`;
          document.getElementById('wa-no').addEventListener('click', () => { $modal.innerHTML = ''; location.hash = '#/cola'; });
          document.getElementById('wa-si').addEventListener('click', async () => {
            window.open(waLink(l.telefono), '_blank', 'noopener');
            try { const w = await api(`leads/${l.id}/toques`, { method: 'POST', body: { canal: 'whatsapp' } }); avisar(`WhatsApp registrado.${w.proxima ? ' Próximo: ' + etiqueta(meta.canales, w.proxima.canal) + ' el ' + fecha(new Date(w.proxima.due_at).getTime()) + '.' : ''}`); }
            catch (e) { avisar(e.message, 'error'); }
            $modal.innerHTML = ''; location.hash = '#/cola';
          });
          return;
        }
        if (location.hash === '#/cola') render(); else location.hash = '#/cola';
      } catch (err) {
        document.getElementById('frm-error').innerHTML = pintarError(err);
        $frm.querySelector('button[type=submit]').disabled = false;
      }
    });
  }

  // ---------------------------------------------------------------- marcar
  function vistaMarcar() {
    $app.innerHTML = `
      <div class="cabeza"><div><h1>Marcar</h1><div class="suave">Un número que no está en ninguna lista. Si ya es de un lead, abre su ficha; si no, lo crea con la secuencia normal.</div></div></div>
      <form class="panel" id="frm-marcar" style="max-width:520px">
        <label class="suave" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">Teléfono</label>
        <input name="telefono" inputmode="tel" autofocus required placeholder="300 123 4567 · +52 55 1234 5678" style="font:inherit;font-size:20px;width:100%;padding:10px 12px;border:1px solid var(--linea);border-radius:9px" />
        <div class="dos" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px">
          <div><label class="suave" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">Empresa (opcional)</label><input name="empresa" style="font:inherit;width:100%;padding:8px 10px;border:1px solid var(--linea);border-radius:8px" /></div>
          <div><label class="suave" style="display:block;font-size:12px;font-weight:600;margin-bottom:4px">Contacto (opcional)</label><input name="contacto" style="font:inherit;width:100%;padding:8px 10px;border:1px solid var(--linea);border-radius:8px" /></div>
        </div>
        <div class="acciones"><button class="btn primario grande" type="submit">📞 Llamar</button><button class="btn" type="button" id="solo-crear">Solo abrir la ficha</button></div>
        <div id="marcar-error"></div>
      </form>`;
    const $f = document.getElementById('frm-marcar');
    const ir = async llamar => {
      const d = Object.fromEntries(new FormData($f));
      if (!d.telefono.trim()) return;
      try {
        const r = await api('marcar', { method: 'POST', body: d });
        if (r.existente) avisar(`Ese número ya es de ${r.empresa} (${etiqueta(meta.etapas, r.etapa)}).`);
        location.hash = `#/lead/${r.lead_id}${llamar ? '?llamar=1' : ''}`;
      } catch (e) { document.getElementById('marcar-error').innerHTML = pintarError(e); }
    };
    $f.addEventListener('submit', e => { e.preventDefault(); ir(true); });
    document.getElementById('solo-crear').addEventListener('click', () => ir(false));
  }

  // ---------------------------------------------------------------- semana
  async function vistaSemana(params) {
    const f = params.get('fecha');
    const qsw = new URLSearchParams(); if (f) qsw.set('fecha', f); if (usuarioActual()) qsw.set('usuario', usuarioActual());
    const w = await api('semana' + (qsw.toString() ? '?' + qsw : ''));
    const dia = x => new Date(x + 'T12:00:00-05:00').toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'short', day: 'numeric' });
    const rango = `${new Date(w.lunes + 'T12:00:00-05:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })} – ${new Date(w.domingo + 'T12:00:00-05:00').toLocaleDateString('es-CO', { day: 'numeric', month: 'short' })}`;
    const mover = n => { const d = new Date(w.lunes + 'T12:00:00-05:00'); d.setDate(d.getDate() + n * 7); return d.toISOString().slice(0, 10); };
    const pct = (a, b) => b ? Math.min(100, Math.round(a / b * 100)) : 0;
    const r = w.ratios;
    const tasa = (v, nombre, num, den) => `<div class="kpi"><b>${v == null ? '—' : v + '%'}</b><span>${nombre}</span><small>${num} de ${den}</small></div>`;
    $app.innerHTML = `
      <div class="cabeza">
        <div><h1>Semana${w.usuario ? ` de ${esc(w.usuario)}` : ''}</h1><div class="suave">${esc(rango)} · <a href="#/semana?fecha=${mover(-1)}">← anterior</a>${w.domingo < w.hoy ? ` · <a href="#/semana?fecha=${mover(1)}">siguiente →</a>` : ''}</div></div>
        <div class="racha ${w.racha.hoyCumple ? 'hoy' : ''}"><b>${w.racha.dias}</b><span>${w.racha.dias === 1 ? 'día seguido' : 'días seguidos'} cumpliendo la meta</span></div>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${w.totales.marcaciones}<span class="suave" style="font-size:14px"> / ${w.metas.marcaciones}</span></b><span>Marcaciones</span><div class="meta"><i style="width:${pct(w.totales.marcaciones, w.metas.marcaciones)}%"></i></div></div>
        <div class="kpi"><b>${w.totales.conversaciones}<span class="suave" style="font-size:14px"> / ${w.metas.conversaciones}</span></b><span>Conversaciones</span><div class="meta"><i style="width:${pct(w.totales.conversaciones, w.metas.conversaciones)}%"></i></div></div>
        <div class="kpi"><b>${w.totales.reuniones}</b><span>Reuniones agendadas</span></div>
        <div class="kpi"><b>${w.metas.diasCumplidos}<span class="suave" style="font-size:14px"> / ${w.metas.diasHabilesTranscurridos}</span></b><span>Días con meta cumplida</span></div>
      </div>
      <div class="panel tabla-env">
        <table><thead><tr><th>Día</th><th class="num">Marcaciones</th><th class="num">Conversaciones</th><th class="num">Reuniones</th><th class="num">WhatsApp</th><th class="num">Correo</th><th class="num">LinkedIn</th><th>Meta</th></tr></thead>
        <tbody>${w.dias.map(d => `<tr class="${d.fecha === w.hoy ? 'hoy' : ''} ${d.habil ? '' : 'suave'}">
          <td>${dia(d.fecha)}</td><td class="num">${d.marcaciones}</td><td class="num">${d.conversaciones}</td><td class="num">${d.reuniones}</td><td class="num">${d.whatsapp}</td><td class="num">${d.correo}</td><td class="num">${d.linkedin}</td>
          <td>${!d.habil ? '' : d.cumplida ? '<span class="chip whatsapp">cumplida</span>' : (d.fecha < w.hoy ? '<span class="chip vencida">no</span>' : (d.fecha === w.hoy ? '<span class="chip hoy">en curso</span>' : ''))}</td>
        </tr>`).join('')}</tbody></table>
      </div>
      <div class="panel bloque">
        <h2>Mejora de la semana</h2>
        <p class="suave" style="margin:0">Los hábitos, el foco de las próximas dos semanas y el mejor momento de la semana aparecen aquí cuando las llamadas con conversación pasen por transcripción y evaluación (siguiente fase).</p>
      </div>
      ${w.mostrarRatios ? `<div class="panel bloque"><h2>Tasas · últimos ${w.ratios.hasta === w.ratios.desde ? 1 : 14} días</h2>
        <div class="kpis" style="margin:0">
          ${tasa(r.tasaContacto, 'Tasa de contacto', r.conversaciones, r.marcaciones)}
          ${tasa(r.conversacionAReunion, 'Conversación → reunión', r.agendadas, r.conversaciones)}
          ${tasa(r.reunionRealizada, 'Reunión realizada', r.realizadas, r.realizadas + r.no_show)}
          ${tasa(r.realizadaACalificado, 'Realizada → calificado', r.calificados, r.realizadas)}
        </div></div>` : ''}`;
  }

  // ---------------------------------------------------------------- router
  async function render() {
    const [ruta, query] = (location.hash.replace(/^#\/?/, '') || 'cola').split('?');
    const partes = ruta.split('/');
    document.querySelectorAll('.barra nav a').forEach(a => a.classList.toggle('activo', a.dataset.r === partes[0]));
    try {
      if (partes[0] === 'importar') await vistaImportar();
      else if (partes[0] === 'pipeline') await vistaPipeline(new URLSearchParams(query));
      else if (partes[0] === 'marcar') vistaMarcar();
      else if (partes[0] === 'semana') await vistaSemana(new URLSearchParams(query));
      else if (partes[0] === 'lead' && partes[1]) {
        await vistaLead(partes[1]);
        if (new URLSearchParams(query).get('llamar') === '1') {
          history.replaceState(null, '', '#/lead/' + partes[1]);
          const $b = document.getElementById('llamar');
          if ($b && !$b.disabled) $b.click(); else avisar('No se puede llamar: ' + (($b && $b.title) || 'sin telefonía'), 'aviso');
        }
      }
      else await vistaCola(new URLSearchParams(query));
    } catch (e) {
      $app.innerHTML = pintarError(e);
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  api('meta').then(m => { meta = m; pintarUsuarios(); }).catch(() => {}).finally(render);
})();

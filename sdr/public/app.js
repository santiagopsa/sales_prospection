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

  async function api(ruta, opciones = {}) {
    const r = await fetch('api/' + ruta, {
      method: opciones.method || 'GET',
      headers: opciones.body ? { 'Content-Type': 'application/json' } : undefined,
      body: opciones.body ? JSON.stringify(opciones.body) : undefined,
    });
    const datos = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(datos.error || `Error ${r.status}`);
    return datos;
  }

  const pintarError = e => `<div class="error">${esc(e.message)}</div>`;

  // ---------------------------------------------------------------- cola
  async function vistaCola() {
    const c = await api('cola');
    const i = c.indicadores;
    const kpiMeta = (valor, meta, nombre) => `
      <div class="kpi"><b>${valor == null ? '—' : valor}<span class="suave" style="font-size:14px"> / ${meta}</span></b>
        <span>${nombre}</span>
        <div class="meta"><i style="width:${valor == null ? 0 : Math.min(100, Math.round(valor / meta * 100))}%"></i></div>
        ${valor == null ? '<small>Se cuenta al registrar llamadas (fase 2)</small>' : ''}
      </div>`;
    const hoy = new Date(`${c.fecha}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    $app.innerHTML = `
      <div class="cabeza">
        <div><h1>Cola del día</h1><div class="suave">${esc(hoy)} · ${plural(c.tareas.length, 'toque pendiente', 'toques pendientes')}</div></div>
        <a class="btn" href="#/importar">Cargar leads</a>
      </div>
      <div class="kpis">
        <div class="kpi ${i.vencidas ? 'mal' : ''}"><b>${i.vencidas}</b><span>Vencidas</span></div>
        <div class="kpi"><b>${i.deHoy}</b><span>Para hoy</span></div>
        <a class="kpi ${i.huerfanos ? 'alerta' : ''}" href="#/pipeline?huerfanos=1" style="color:inherit;text-decoration:none"><b>${i.huerfanos}</b><span>Leads sin próximo toque</span></a>
        ${kpiMeta(i.marcaciones, i.metaMarcaciones, 'Marcaciones')}
        ${kpiMeta(i.conversaciones, i.metaConversaciones, 'Conversaciones')}
      </div>
      ${c.tareas.length ? `<div class="cola">${c.tareas.map((t, n) => `
        <a class="item" href="#/lead/${t.lead_id}">
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
          </div>
        </a>`).join('')}</div>`
        : `<div class="panel vacio">No hay toques pendientes para hoy.<br><a href="#/importar">Carga una lista de leads</a> para empezar.</div>`}`;
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
        <div class="suave">CSV con empresa, contacto, cargo, teléfono, correo, ciudad y fuente. Separado por comas o punto y coma.</div></div></div>
      <div id="msg"></div>
      <label class="soltar" id="soltar">
        <input type="file" id="archivo" accept=".csv,text/csv" hidden />
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
      const contenido = await leerArchivo(file);
      await analizar(file.name, contenido);
    };
    $input.addEventListener('change', () => tomar($input.files[0]));
    $soltar.addEventListener('dragover', e => { e.preventDefault(); $soltar.classList.add('encima'); });
    $soltar.addEventListener('dragleave', () => $soltar.classList.remove('encima'));
    $soltar.addEventListener('drop', e => { e.preventDefault(); $soltar.classList.remove('encima'); tomar(e.dataTransfer.files[0]); });
  }

  async function analizar(archivo, contenido) {
    const $inf = document.getElementById('informe');
    const $msg = document.getElementById('msg');
    $msg.innerHTML = '';
    $inf.innerHTML = '<p class="vacio">Revisando el archivo…</p>';
    let inf;
    try { inf = await api('importar', { method: 'POST', body: { archivo, contenido } }); }
    catch (e) { $inf.innerHTML = ''; $msg.innerHTML = pintarError(e); return; }
    $inf.innerHTML = pintarInforme(inf, true);
    const $ok = document.getElementById('confirmar');
    if ($ok) $ok.addEventListener('click', async () => {
      $ok.disabled = true; $ok.textContent = 'Cargando…';
      try {
        const final = await api('importar', { method: 'POST', body: { archivo, contenido, confirmar: true } });
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
  async function vistaLead(id) {
    const l = await api('leads/' + encodeURIComponent(id));
    $app.innerHTML = `
      <div class="cabeza">
        <div><div class="suave"><a href="#/cola">← Cola</a></div><h1>${esc(l.empresa)}</h1>
          <div class="suave">${esc([l.contacto, l.cargo].filter(Boolean).join(' · ') || 'Sin contacto')}</div></div>
        <span class="chip etapa" style="font-size:13px">${esc(etiqueta(meta.etapas, l.etapa))}</span>
      </div>
      <div class="ficha">
        <div class="panel">
          <h2>Datos</h2>
          <dl>
            <dt>Teléfono</dt><dd class="num">${esc(telVisible(l.telefono) || '—')}${l.telefono_original && l.telefono && l.telefono_original !== telVisible(l.telefono) ? ` <span class="suave">(archivo: ${esc(l.telefono_original)})</span>` : ''}</dd>
            <dt>Correo</dt><dd>${esc(l.email || '—')}</dd>
            <dt>Ciudad</dt><dd>${esc(l.ciudad || '—')}</dd>
            <dt>Fuente</dt><dd>${esc(l.fuente || '—')}</dd>
            <dt>Cargado</dt><dd>${fechaHora(l.created_ms)}</dd>
          </dl>
          <p class="suave" style="margin:14px 0 0;font-size:12px">Llamar y registrar toques llega en las fases 2 y 3.</p>
        </div>
        <div class="panel">
          <h2>Secuencia</h2>
          <ul class="pasos">${l.tareas.map(t => `<li>
            <span class="n">${t.paso}</span>
            <span class="chip ${t.canal}">${esc(etiqueta(meta.canales, t.canal))}</span>
            <span class="${t.estado !== 'pendiente' ? 'hecha' : ''}">${fecha(t.due_ms)}</span>
            <span class="suave" style="margin-left:auto;font-size:12px">${esc(t.estado)}</span>
          </li>`).join('')}</ul>
          <h2 style="margin-top:16px">Toques</h2>
          ${l.toques.length ? '' : '<p class="suave" style="margin:0">Todavía no hay toques registrados.</p>'}
        </div>
      </div>`;
  }

  // ---------------------------------------------------------------- router
  async function render() {
    const [ruta, query] = (location.hash.replace(/^#\/?/, '') || 'cola').split('?');
    const partes = ruta.split('/');
    document.querySelectorAll('.barra nav a').forEach(a => a.classList.toggle('activo', a.dataset.r === partes[0]));
    try {
      if (partes[0] === 'importar') await vistaImportar();
      else if (partes[0] === 'pipeline') await vistaPipeline(new URLSearchParams(query));
      else if (partes[0] === 'lead' && partes[1]) await vistaLead(partes[1]);
      else await vistaCola();
    } catch (e) {
      $app.innerHTML = pintarError(e);
    }
    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', render);
  api('meta').then(m => { meta = m; }).catch(() => {}).finally(render);
})();

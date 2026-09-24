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
  const rolActual = () => ((meta.usuarios || []).find(u => u.nombre === usuarioActual()) || {}).rol || '';
  // Transcripción y métricas por llamada: solo para los roles de VER_TRANSCRIPCION (Angie recibe el semanal).
  const veTranscripcion = () => (meta.verTranscripcion || []).includes(rolActual());
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

  // ---------------------------------------------------------------- buscador (barra)
  // Para cuando alguien escribe por WhatsApp o correo: se escribe el nombre de la empresa, la persona,
  // el número o el correo y aparece la ficha. Enter abre el primero; flechas para moverse; Esc cierra.
  function enlazarBuscador() {
    const $q = document.getElementById('buscar-q'), $res = document.getElementById('buscar-resultados'), $frm = document.getElementById('buscador');
    if (!$q || !$res) return;
    let temporizador = null, ultimo = '', activo = -1;
    const cerrar = () => { $res.hidden = true; $res.innerHTML = ''; activo = -1; };
    const contexto = l => {
      const partes = [];
      if (l.contacto) partes.push(esc(l.contacto) + (l.cargo ? ' · ' + esc(l.cargo) : ''));
      if (l.telefono) partes.push('<span class="num">' + esc(telVisible(l.telefono)) + '</span>');
      if (l.email) partes.push(esc(l.email));
      const estado = l.pausado_ms ? `En pausa hasta ${fecha(l.pausado_ms)}` : etiqueta(meta.etapas, l.etapa);
      const ultimoToque = l.ultimo_ms ? `Último: ${esc(meta.resultadoLabel && meta.resultadoLabel[l.ultimo_resultado] || l.ultimo_resultado)} · ${fecha(l.ultimo_ms)}` : 'Sin toques todavía';
      return `<div class="suave">${partes.join(' · ')}</div><div class="suave">${esc(estado)} · ${ultimoToque}</div>`;
    };
    const pintar = lista => {
      if (!lista.length) { $res.innerHTML = `<div class="nada">Nada con "${esc(ultimo)}". Si es alguien nuevo, cárgalo en <a href="#/marcar">Marcar</a> o en Cargar leads.</div>`; $res.hidden = false; return; }
      $res.innerHTML = lista.map((l, i) => `<a class="res ${i === 0 ? 'activo' : ''}" href="#/lead/${l.id}"><b>${esc(l.empresa || 'Sin empresa')}</b>${contexto(l)}</a>`).join('');
      activo = 0; $res.hidden = false;
    };
    const buscar = async () => {
      const q = $q.value.trim();
      if (q.length < 2) return cerrar();
      ultimo = q;
      try { const lista = await api('leads/buscar?q=' + encodeURIComponent(q)); if (q === ultimo) pintar(lista); }
      catch (e) { $res.innerHTML = `<div class="nada">${esc(e.message)}</div>`; $res.hidden = false; }
    };
    $q.addEventListener('input', () => { clearTimeout(temporizador); temporizador = setTimeout(buscar, 220); });
    $q.addEventListener('focus', () => { if ($q.value.trim().length >= 2 && $res.innerHTML) $res.hidden = false; });
    $q.addEventListener('keydown', e => {
      const items = [...$res.querySelectorAll('a.res')];
      if (e.key === 'Escape') { cerrar(); $q.blur(); return; }
      if (!items.length) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        activo = (activo + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        items.forEach((a, i) => a.classList.toggle('activo', i === activo));
        items[activo].scrollIntoView({ block: 'nearest' });
      }
    });
    $frm.addEventListener('submit', e => {
      e.preventDefault();
      const items = [...$res.querySelectorAll('a.res')];
      if (items.length) { location.hash = items[Math.max(activo, 0)].getAttribute('href'); cerrar(); $q.value = ''; $q.blur(); }
      else buscar();
    });
    $res.addEventListener('click', e => { if (e.target.closest('a.res')) { cerrar(); $q.value = ''; } });
    document.addEventListener('click', e => { if (!$frm.contains(e.target)) cerrar(); });
    // Atajo: "/" desde cualquier parte enfoca el buscador.
    document.addEventListener('keydown', e => { if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName)) { e.preventDefault(); $q.focus(); $q.select(); } });
  }


  // ---------------------------------------------------------------- comisión (escalones)
  const MES_LARGO = mes => new Date(mes + '-15T12:00:00-05:00').toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });
  const MES_CORTO = mes => new Date(mes + '-15T12:00:00-05:00').toLocaleDateString('es-CO', { month: 'long' });
  const plata = (m, v) => `${esc(m)} ${Number(v).toLocaleString('es-CO')}`;
  const ESTADO_REUNION = {
    calificada: { label: 'Calificada', clase: 'whatsapp' },
    por_calificar: { label: 'Por calificar', clase: 'hoy' },
    programada: { label: 'Programada', clase: 'llamada' },
    no_califica: { label: 'No calificó', clase: 'vencida' },
    no_asistio: { label: 'No asistió', clase: 'vencida' },
    cancelada: { label: 'Cancelada', clase: 'vencida' },
  };
  // Escalera: una franja por tramo, cada una más alta que la anterior; se llena hasta las calificadas
  // y, rayado, hasta lo que podría llegar si califican las pendientes.
  function pintarEscalera(r, grande = false) {
    const k = r.comision, ts = k.tramos, m = r.reglas.moneda, n = k.n;
    const pot = r.potencial.n;
    const ultimo = ts[ts.length - 1].desde;
    const fin = Math.max(ultimo + Math.max(10, Math.round(ultimo / 3)), n + 3, pot + 1);
    const alto = i => (grande ? 18 : 10) + i * (grande ? 14 : 8);
    const zonas = ts.map((t, i) => {
      const desde = t.desde, hasta = i + 1 < ts.length ? ts[i + 1].desde : fin;
      const ancho = hasta - desde;
      const lleno = Math.max(0, Math.min(n, hasta) - desde) / ancho * 100;
      const potencial = Math.max(0, Math.min(pot, hasta) - Math.max(n, desde)) / ancho * 100;
      return `<div class="esc-zona t${Math.min(i, 3)} ${i === k.tramo.indice ? 'actual' : ''}" style="flex:${ancho} 1 0;height:${alto(i)}px" title="${esc(t.nombre)}: ${plata(m, t.valor)} por reunión desde la ${t.desde}">
        <i class="lleno" style="width:${lleno}%"></i><i class="pot" style="left:${lleno}%;width:${potencial}%"></i></div>`;
    }).join('');
    const marcas = ts.map((t, i) => `<span class="esc-marca" style="left:${t.desde / fin * 100}%"><b>${t.desde || ''}</b>${plata(m, t.valor)}${grande ? '<span class="cu"> c/u</span>' : ''}</span>`).join('');
    return `<div class="escalera ${grande ? 'grande' : ''}">
        <div class="esc-pista">${zonas}<span class="esc-yo" style="left:${n / fin * 100}%"><b>${n}</b></span></div>
        <div class="esc-marcas">${marcas}</div>
      </div>`;
  }
  function textoSiguiente(r) {
    const k = r.comision, m = r.reglas.moneda;
    if (!k.siguiente) return `Tramo más alto: cada calificada vale ${plata(m, k.tramo.valor)}.`;
    const s = k.siguiente;
    return `Faltan <b>${s.faltan}</b> ${s.faltan === 1 ? 'calificada' : 'calificadas'} para <b>${plata(m, s.valor)}</b> por reunión → ${plata(m, s.total_al_llegar)}${r.reglas.modo === 'escalon' && k.n ? ` (todas las del mes suben)` : ''}`;
  }
  function pintarComisionCorta(r) {
    if (!r) return '';
    const k = r.comision, m = r.reglas.moneda, c = r.conteo;
    return `<a class="panel comision" href="#/comision" title="Ver el detalle de la comisión">
      <div class="com-top">
        <div class="com-plata"><span class="suave">Comisión de ${esc(MES_CORTO(r.mes))}${r.usuario ? '' : ' · equipo SDR'}</span>
          <b>${plata(m, k.total)}</b>
          <span class="suave">${k.n} ${k.n === 1 ? 'calificada' : 'calificadas'} × ${plata(m, k.tramo.valor)}${r.reglas.modo === 'tramos' ? ' (por tramos)' : ''}</span></div>
        <div class="com-sig">${textoSiguiente(r)}</div>
      </div>
      ${pintarEscalera(r)}
      <div class="com-conteo suave">${plural(c.reuniones, 'reunión', 'reuniones')} del mes · <b>${c.calificadas}</b> calificadas${c.por_calificar ? ` · <b>${c.por_calificar}</b> por calificar` : ''}${c.programadas ? ` · ${c.programadas} programadas` : ''}${c.no_califica ? ` · ${c.no_califica} no calificaron` : ''}${c.no_asistio ? ` · ${c.no_asistio} no asistieron` : ''}${r.potencial.total > k.total ? ` · si califican las pendientes: ${plata(m, r.potencial.total)}` : ''}</div>
    </a>`;
  }
  async function vistaComision(params) {
    const qs = new URLSearchParams(); if (params.get('mes')) qs.set('mes', params.get('mes')); if (usuarioActual()) qs.set('usuario', usuarioActual());
    const r = await api('comision' + (qs.toString() ? '?' + qs : ''));
    const k = r.comision, m = r.reglas.moneda, c = r.conteo;
    const orden = ['calificada', 'por_calificar', 'programada', 'no_califica', 'no_asistio', 'cancelada'];
    const reuniones = r.reuniones.slice().sort((a, b) => orden.indexOf(a.estado) - orden.indexOf(b.estado) || (a.reunion_ms || a.agendada_ms) - (b.reunion_ms || b.agendada_ms));
    const escalones = k.tramos.map((t, i) => {
      const hasta = k.tramos[i + 1] ? k.tramos[i + 1].desde - 1 : null;
      const actual = i === k.tramo.indice, pasado = i < k.tramo.indice;
      return `<div class="escalon t${Math.min(i, 3)} ${actual ? 'actual' : ''} ${pasado ? 'pasado' : ''}" style="margin-top:${(k.tramos.length - 1 - i) * 18}px">
        <b>${plata(m, t.valor)}</b><span>por reunión</span>
        <small>${hasta != null ? `${t.desde || 1} a ${hasta}` : `${t.desde} o más`} calificadas</small>
        <small class="suave">${esc(t.nota || t.nombre)}</small>
        ${actual ? '<em>Estás aquí</em>' : ''}</div>`;
    }).join('');
    $app.innerHTML = `
      <div class="cabeza">
        <div><h1>Comisión de ${esc(MES_LARGO(r.mes))}</h1>
          <div class="suave">${r.usuario ? `de <b>${esc(r.usuario)}</b> · ` : 'equipo SDR · '}<a href="#/comision?mes=${r.anterior}">← mes anterior</a>${r.posterior <= r.hoy.slice(0, 7) ? ` · <a href="#/comision?mes=${r.posterior}">mes siguiente →</a>` : ''}</div></div>
        <a class="btn" href="#/cola">Cola del día</a>
      </div>
      <div class="panel comision grande">
        <div class="com-top">
          <div class="com-plata"><span class="suave">Llevas</span><b>${plata(m, k.total)}</b><span class="suave">${k.n} ${k.n === 1 ? 'reunión calificada' : 'reuniones calificadas'} × ${plata(m, k.tramo.valor)}</span></div>
          <div class="com-sig">${textoSiguiente(r)}${k.n ? `<div class="suave" style="font-size:12px;margin-top:4px">La próxima calificada suma ${plata(m, k.proxima_vale)}.</div>` : ''}</div>
        </div>
        ${pintarEscalera(r, true)}
        <div class="escalones">${escalones}</div>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${c.reuniones}</b><span>Reuniones del mes</span></div>
        <div class="kpi"><b>${c.calificadas}</b><span>Calificadas</span><small>cuentan para la comisión</small></div>
        <div class="kpi"><b>${c.por_calificar}</b><span>Por calificar</span><small>ya pasaron; falta que ${esc(((meta.usuarios || []).find(u => u.rol === 'ejecutiva') || { nombre: 'la ejecutiva' }).nombre)} las califique en el Sandler</small></div>
        <div class="kpi"><b>${c.programadas}</b><span>Programadas</span><small>todavía no son</small></div>
        <div class="kpi"><b>${c.no_califica + c.no_asistio + (c.canceladas || 0)}</b><span>No cuentan</span><small>${c.no_califica} no calificaron · ${c.no_asistio} no asistieron${c.canceladas ? ` · ${c.canceladas} canceladas` : ''}</small></div>
      </div>
      ${r.potencial.total > k.total ? `<p class="suave" style="margin:-4px 0 14px">Si califican todas las pendientes (${c.por_calificar + c.programadas}), el mes cerraría en <b>${plata(m, r.potencial.total)}</b>.</p>` : ''}
      <div class="panel">
        <h2>Reuniones de ${esc(MES_CORTO(r.mes))}</h2>
        ${reuniones.length ? `<ul class="pasos historial">${reuniones.map(x => `<li>
          <span class="chip ${ESTADO_REUNION[x.estado].clase}">${ESTADO_REUNION[x.estado].label}</span>
          <div style="flex:1;min-width:0"><a href="#/lead/${x.lead_id}"><b>${esc(x.empresa || 'Sin empresa')}</b></a>${x.contacto ? ' · ' + esc(x.contacto) : ''}
            <div class="suave" style="font-size:12px">${x.reunion_ms ? 'Reunión ' + fechaHora(x.reunion_ms) : 'Sin fecha de reunión'} · agendada ${fecha(x.agendada_ms)}${x.agendo && !r.usuario ? ' por ' + esc(x.agendo) : ''}${x.calificacion ? ' · Sandler: ' + esc(x.calificacion) : ''}${x.ejecutiva ? ' · ' + esc(x.ejecutiva) : ''}</div></div>
        </li>`).join('')}</ul>` : '<p class="vacio">Todavía no hay reuniones en este mes.</p>'}
      </div>
      <p class="suave" style="font-size:12px;margin-top:14px">Cuenta como calificada la reunión que ${esc('la ejecutiva')} califica <b>${esc(r.reglas.califica_con.join(' o '))}</b> en el Sandler Coach. ${r.reglas.modo === 'escalon' ? 'Al alcanzar un tramo, todas las calificadas del mes se pagan a ese valor.' : 'Cada reunión se paga al valor de su tramo.'} Cuenta en el mes ${r.reglas.mes_por === 'reunion' ? 'de la fecha de la reunión' : 'en que se agendó'}. Reglas en <code>COMISION</code> de <code>config.js</code>.</p>`;
  }

  // ---------------------------------------------------------------- cola
  async function vistaCola(params = new URLSearchParams()) {
    const qU = usuarioActual() ? '?usuario=' + encodeURIComponent(usuarioActual()) : '';
    const [c, com] = await Promise.all([api('cola' + qU), api('comision' + qU).catch(() => null)]);
    const i = c.indicadores;
    const ver = params.get('ver') || 'todas';   // todas | vencidas | hoy
    const lista = ver === 'vencidas' ? c.tareas.filter(t => t.vencida) : ver === 'hoy' ? c.tareas.filter(t => !t.vencida) : c.tareas;
    const kpiLink = (cual, activo) => `href="#/cola${cual === 'todas' ? '' : '?ver=' + cual}" class="kpi enlace ${activo ? 'activo' : ''}"`;
    const hoy = new Date(`${c.fecha}T12:00:00-05:00`).toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long' });
    const b = c.bloque && c.bloque.enCurso;
    const barra = (valor, meta) => `<div class="meta"><i style="width:${Math.min(100, Math.round(valor / Math.max(meta, 1) * 100))}%"></i></div>`;
    const pendientes = c.tareas.filter(t => !t.tocado_hoy);
    const siguiente = pendientes.find(t => t.canal === 'llamada' && t.telefono) || pendientes[0] || c.tareas[0];
    $app.innerHTML = `
      <div class="cabeza">
        <div><h1>Cola del día</h1><div class="suave">${esc(hoy)} · ${plural(c.tareas.length, 'toque pendiente', 'toques pendientes')}${c.usuario ? ` · ritmo de <b>${esc(c.usuario)}</b>` : ''}</div></div>
        <div class="acciones" style="margin:0">
          ${siguiente ? `<a class="btn primario grande" href="#/lead/${siguiente.lead_id}${siguiente.canal === 'llamada' && siguiente.telefono ? '?llamar=1' : ''}">${siguiente.canal === 'llamada' ? '📞 Llamar al siguiente' : 'Siguiente toque'} · ${esc(siguiente.empresa)}</a>` : ''}
          <a class="btn" href="#/marcar">Marcar</a>
          <button class="btn" id="nuevo-compromiso" title="Una tarea con fecha (y hora) que no es de la secuencia">+ Compromiso</button>
        </div>
      </div>
      ${pintarComisionCorta(com)}
      <div class="ritmo">
        <div class="ritmo-principal">
          ${b ? `
            <div class="ritmo-titulo"><b>${esc(b.nombre)}</b> <span class="suave">${b.inicio}–${b.fin} · quedan ${b.minutosRestantes} min</span></div>
            <div class="ritmo-num"><b>${b.marcaciones}</b><span class="suave"> / ${b.metaMarcaciones} marcaciones en este bloque</span></div>
            ${barra(b.marcaciones, b.metaMarcaciones)}
            <div class="suave" style="font-size:12px;margin-top:6px">Hoy: ${i.marcaciones} / ${i.metaMarcaciones} marcaciones · ${i.conversaciones} / ${i.metaConversaciones} conversaciones${i.metaReuniones != null ? ` · ${i.reuniones || 0} / ${i.metaReuniones} reuniones` : ''}</div>`
          : `
            <div class="ritmo-titulo"><b>Hoy</b> <span class="suave">${c.bloque && c.bloque.siguiente ? `próximo bloque: ${esc(c.bloque.siguiente.nombre)} a las ${c.bloque.siguiente.inicio}` : 'fuera de bloque de prospección'}</span></div>
            <div class="ritmo-doble">
              <div><div class="ritmo-num"><b>${i.marcaciones}</b><span class="suave"> / ${i.metaMarcaciones} marcaciones</span></div>${barra(i.marcaciones, i.metaMarcaciones)}</div>
              <div><div class="ritmo-num"><b>${i.conversaciones}</b><span class="suave"> / ${i.metaConversaciones} conversaciones</span></div>${barra(i.conversaciones, i.metaConversaciones)}</div>
            </div>
            ${i.metaReuniones != null ? `<div class="suave" style="font-size:12px;margin-top:6px"><b style="color:var(--texto)">${i.reuniones || 0}</b> / ${i.metaReuniones} reuniones agendadas hoy · con ${i.metaReuniones} el día queda cumplido así no llegues a las marcaciones</div>` : ''}`}
        </div>
        <div class="ritmo-lado">
          <div class="racha ${c.racha.hoyCumple ? 'hoy' : ''}"><b>${c.racha.dias}</b><span>${c.racha.dias === 1 ? 'día seguido' : 'días seguidos'} cumpliendo la meta${c.racha.hoyCumple ? ' · hoy ✓' : ''}</span></div>
          <div class="ritmo-links"><a href="#/historial" class="suave">Ver lo de hoy →</a><a href="#/semana" class="suave">Ver la semana →</a></div>
        </div>
      </div>
      <div class="alertas">
        ${i.vencidas ? `<a ${kpiLink(ver === 'vencidas' ? 'todas' : 'vencidas', ver === 'vencidas')} data-mal><b>${i.vencidas}</b><span>${i.vencidas === 1 ? 'toque vencido' : 'toques vencidos'}</span></a>` : ''}
        ${i.huerfanos ? `<a class="kpi enlace alerta" href="#/pipeline?huerfanos=1"><b>${i.huerfanos}</b><span>${i.huerfanos === 1 ? 'lead sin próximo toque' : 'leads sin próximo toque'}</span></a>` : ''}
        ${!i.vencidas && !i.huerfanos ? '<span class="suave" style="font-size:12px">Sin vencidos ni leads huérfanos.</span>' : ''}
        ${ver === 'todas' ? '' : `<a class="kpi enlace" href="#/cola"><b>${c.tareas.length}</b><span>ver todos</span></a>`}
      </div>
      ${pintarCompromisos(c.compromisos)}
      ${ver !== 'todas' ? `<div class="filtro-activo suave">Mostrando solo <b>${ver === 'vencidas' ? 'vencidas' : 'las de hoy'}</b> · <a href="#/cola">ver todas</a></div>` : ''}
      ${(() => {
        const porContactar = lista.filter(t => !t.tocado_hoy), tocados = lista.filter(t => t.tocado_hoy);
        const vacio = ver === 'todas' ? 'No hay toques pendientes para hoy.<br><a href="#/importar">Carga una lista de leads</a> para empezar.' : 'Nada en este filtro. <a href="#/cola">Ver todas</a>';
        return `
        <h2 class="seccion">Por contactar <span class="suave">${plural(porContactar.length, 'lead', 'leads')} · en orden de prioridad</span></h2>
        ${porContactar.length ? `<div class="cola">${porContactar.map((t, n) => tarjetaCola(t, n + 1)).join('')}</div>` : `<div class="panel vacio">${tocados.length ? 'Todos los de hoy ya tienen un toque. Los siguientes pasos están abajo.' : vacio}</div>`}
        ${tocados.length ? `<h2 class="seccion" style="margin-top:18px">Ya tocados hoy <span class="suave">${plural(tocados.length, 'lead', 'leads')} · el siguiente paso de su secuencia cae hoy</span></h2>
        <div class="cola tocados">${tocados.map((t, n) => tarjetaCola(t, null)).join('')}</div>` : ''}`;
      })()}
      <div id="modal"></div>`;

    // Clic en la tarjeta abre la ficha; los botones de posponer no.
    $app.querySelectorAll('.item[data-lead]').forEach(el => el.addEventListener('click', e => {
      if (e.target.closest('button') || e.target.closest('a')) return;
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
    $app.querySelectorAll('[data-sacar]').forEach(b => b.addEventListener('click', () => {
      const t = c.tareas.find(x => String(x.lead_id) === b.dataset.sacar);
      abrirSacar({ id: t.lead_id, empresa: t.empresa }, { alTerminar: () => vistaCola(params) });
    }));
    document.getElementById('nuevo-compromiso').addEventListener('click', () => abrirCompromiso({}, { alTerminar: () => vistaCola(params) }));
    enlazarCompromisos(() => vistaCola(params));
  }

  // Tarjeta de la cola: la acción que toca (verbo + canal), el contexto del último toque y el paso.
  const ACCION = { llamada: '📞 Llamar', whatsapp: '💬 Enviar WhatsApp', correo: '✉️ Enviar correo', linkedin: '💼 Mensaje por LinkedIn' };
  function contextoToque(t) {
    if (!t.ultimo_ms) return 'Sin contacto todavía';
    const cuando = t.tocado_hoy ? 'hoy ' + new Date(t.ultimo_ms).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' }) : fecha(t.ultimo_ms);
    const que = meta.resultadoLabel[t.ultimo_resultado] || t.ultimo_resultado || t.ultimo_canal;
    return `Último: ${cuando} · ${que}${t.ultimo_nota ? ' · «' + t.ultimo_nota.slice(0, 80) + (t.ultimo_nota.length > 80 ? '…' : '') + '»' : ''}`;
  }
  function tarjetaCola(t, n) {
    const href = `#/lead/${t.lead_id}${t.canal === 'llamada' && t.telefono ? '?llamar=1' : ''}`;
    return `<div class="item ${t.tocado_hoy ? 'tocado' : ''}" data-lead="${t.lead_id}">
      <div class="pos">${n == null ? '↻' : n}</div>
      <div class="quien">
        <a class="btn ${t.canal === 'llamada' ? 'primario' : ''} accion" href="${href}">${ACCION[t.canal] || esc(etiqueta(meta.canales, t.canal))}</a>
        <b>${esc(t.empresa)}</b> <span class="suave">${esc([t.contacto, t.cargo].filter(Boolean).join(' · ') || 'Sin contacto')}${t.ciudad ? ' · ' + esc(t.ciudad) : ''}</span>
        <div class="num">${esc(telVisible(t.telefono) || t.email || '')}</div>
        <div class="contexto suave">${esc(contextoToque(t))} · <span title="Paso ${t.paso} de los ${t.pasos_total} toques de la secuencia">toque ${t.paso} de ${t.pasos_total}</span></div>
      </div>
      <div class="lado">
        ${t.vencida ? `<span class="chip vencida">Vencida ${plural(t.diasVencida, 'día', 'días')}</span>` : '<span class="chip hoy">Hoy</span>'}
        ${t.etapa !== 'nuevo' ? `<span class="chip etapa">${esc(etiqueta(meta.etapas, t.etapa))}</span>` : ''}
        <span class="mover"><button class="btn mini" data-posponer="1" data-task="${t.id}" title="Mover al siguiente día hábil">Mañana</button><button class="btn mini" data-posponer="5" data-task="${t.id}" title="Mover una semana">+1 semana</button><button class="btn mini sacar" data-sacar="${t.lead_id}" title="Descartar o pausar: sale de la cola">Sacar</button></span>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------- compromisos
  const TIPO_LABEL = id => ((meta.tiposCompromiso || []).find(t => t.id === id) || {}).label || id;
  function pintarCompromisos(cs) {
    if (!cs || (!cs.hoy.length && !cs.proximos.length)) return '';
    const item = t => `<div class="compromiso ${t.vencido ? 'vencido' : ''}" data-cid="${t.id}">
        <div class="hora">${t.hora ? esc(t.hora) : (t.fecha ? fecha(t.due_ms) : 'hoy')}</div>
        <div class="que"><b>${esc(t.titulo || TIPO_LABEL(t.tipo))}</b> <span class="chip ${t.canal}">${esc(TIPO_LABEL(t.tipo))}</span>${t.gcal_event_id ? ` <span class="suave" title="${t.gcal_event_id === 'calendly' ? 'En el calendario (lo creó Calendly)' : 'En Google Calendar'}">📅</span>` : t.gcal_error ? ` <span class="suave" title="${esc(t.gcal_error)}" style="color:var(--mal)">📅!</span>` : ''}
          ${t.lead_id ? `<div><a href="#/lead/${t.lead_id}">${esc(t.empresa || 'lead')}</a>${t.contacto ? ' · ' + esc(t.contacto) : ''}${t.telefono ? ' · <span class="num">' + esc(telVisible(t.telefono)) + '</span>' : ''}</div>` : ''}
          ${t.nota ? `<div class="suave" style="font-size:12px;white-space:pre-wrap">${esc(t.nota)}</div>` : ''}
          ${t.usuario && t.usuario !== usuarioActual() ? `<div class="suave" style="font-size:12px">de ${esc(t.usuario)}</div>` : ''}</div>
        <span class="mover"><button class="btn mini" data-checha="${esc(JSON.stringify({ id: t.id, lead_id: t.lead_id, canal: t.canal, etapa: t.etapa, telefono: t.telefono, empresa: t.empresa, contacto: t.contacto, email: t.email }))}" title="${t.lead_id && t.canal === 'llamada' ? 'Ya llamé: registrar el resultado' : 'Marcar como hecha'}">Hecha</button><button class="btn mini" data-cposponer="1" data-cid2="${t.id}" title="Mover al siguiente día hábil">Mañana</button><button class="btn mini" data-cmover="${t.id}" title="Elegir fecha y hora">Mover</button><button class="btn mini sacar" data-cquitar="${t.id}" title="Quitar (no se hizo ni se hará)">Quitar</button></span>
      </div>`;
    return `<div class="panel compromisos">
      <h2>Compromisos de hoy <span class="suave" style="font-weight:400;font-size:12px">${cs.hoy.filter(t => t.vencido).length ? cs.hoy.filter(t => t.vencido).length + ' con la hora pasada · ' : ''}lo que quedaste con alguien, a su hora</span></h2>
      ${cs.hoy.length ? cs.hoy.map(item).join('') : '<div class="suave" style="font-size:13px">Nada pactado para hoy.</div>'}
      ${cs.proximos.length ? `<details style="margin-top:8px"><summary class="suave" style="cursor:pointer;font-size:12px">Próximos días: ${plural(cs.proximos.length, 'compromiso', 'compromisos')}</summary>${cs.proximos.map(item).join('')}</details>` : ''}
    </div>`;
  }
  function enlazarCompromisos(recargar) {
    const accion = async (b, ruta, body, ok) => { b.disabled = true; try { const r = await api(ruta, { method: 'POST', body: body || {} }); if (ok) ok(r); await recargar(); } catch (e) { avisar(e.message, 'error'); b.disabled = false; } };
    $app.querySelectorAll('[data-checha]').forEach(b => b.addEventListener('click', () => hechaConToque(b, JSON.parse(b.dataset.checha), accion, recargar)));
    $app.querySelectorAll('[data-cposponer]').forEach(b => b.addEventListener('click', () => accion(b, `tareas/${b.dataset.cid2}/mover`, { dias: Number(b.dataset.cposponer) }, r => avisar(`Movido al ${fecha(new Date(r.due_at).getTime())}.`))));
    $app.querySelectorAll('[data-cquitar]').forEach(b => b.addEventListener('click', () => { if (window.confirm('¿Quitar este compromiso?')) accion(b, `tareas/${b.dataset.cquitar}/eliminar`, {}, () => avisar('Quitado.')); }));
    $app.querySelectorAll('[data-cmover]').forEach(b => b.addEventListener('click', () => abrirMover(b.dataset.cmover, recargar)));
  }
  // "Hecha" en un compromiso con lead registra el toque (así cuenta en los indicadores y queda en el
  // historial): por llamada pide el resultado como cualquier llamada; por WhatsApp/correo/LinkedIn lo
  // registra de una vez. Sin lead, o con el lead ya en manos de la ejecutiva, solo cierra el compromiso.
  function hechaConToque(b, t, accion, recargar) {
    const deAngie = t.lead_id && (meta.etapasAngie || []).includes(t.etapa);
    if (!deAngie) return accion(b, `tareas/${t.id}/hecha`, {}, () => avisar('Hecha.'));
    if (t.canal === 'llamada') {
      return abrirResultado({ id: t.lead_id, telefono: t.telefono, empresa: t.empresa, contacto: t.contacto, email: t.email }, { compromisoId: t.id, alTerminar: recargar });
    }
    return accion(b, `leads/${t.lead_id}/toques`, { canal: t.canal, compromiso_id: t.id }, () => avisar(`Hecha y registrada como toque por ${etiqueta(meta.canales, t.canal)}.`));
  }
  function abrirMover(id, alTerminar) {
    const $modal = document.getElementById('modal');
    $modal.innerHTML = `<div class="velo"><form class="dialogo" id="frm-mover" style="max-width:380px">
        <h2>Mover compromiso</h2>
        <div class="dos"><div><label>Fecha</label><input type="date" name="fecha" required value="${new Date(Date.now() + 86400000).toISOString().slice(0, 10)}" /></div><div><label>Hora (opcional)</label><input type="time" name="hora" /></div></div>
        <div class="acciones"><button class="btn primario" type="submit">Mover</button><button class="btn" type="button" id="mover-cancelar">Cancelar</button></div>
        <div id="mover-error"></div></form></div>`;
    document.getElementById('mover-cancelar').addEventListener('click', () => { $modal.innerHTML = ''; });
    document.getElementById('frm-mover').addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData(e.target);
      try { await api(`tareas/${id}/mover`, { method: 'POST', body: { fecha: f.get('fecha'), hora: f.get('hora') || null } }); $modal.innerHTML = ''; avisar('Movido.'); await alTerminar(); }
      catch (err) { document.getElementById('mover-error').innerHTML = pintarError(err); }
    });
  }
  // Diálogo de nuevo compromiso: tipo, título, fecha, hora, dueño y nota. `lead` opcional.
  function abrirCompromiso({ lead = null, tipo = 'seguimiento' } = {}, { alTerminar } = {}) {
    const $modal = document.getElementById('modal');
    const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota' }).format(new Date());
    $modal.innerHTML = `<div class="velo"><form class="dialogo" id="frm-comp" style="max-width:460px">
        <h2>Nuevo compromiso${lead ? ' · ' + esc(lead.empresa) : ''}</h2>
        <label>¿Qué?</label>
        <div class="opciones fila">${(meta.tiposCompromiso || []).filter(t => t.id !== 'reunion').map(t => `<label class="opcion" title="${esc(t.descripcion || '')}"><input type="radio" name="tipo" value="${t.id}" ${t.id === tipo ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}</div>
        <label>Título</label><input name="titulo" placeholder="Ej. Llamar a Ana por la propuesta de EOR" required />
        <div class="dos"><div><label>Fecha</label><input type="date" name="fecha" required value="${hoy}" /></div><div><label>Hora (si la pactaste)</label><input type="time" name="hora" /></div></div>
        <div class="dos"><div><label>Dueño</label><select name="dueno">${(meta.usuarios || []).map(u => `<option value="${esc(u.nombre)}" ${u.nombre === usuarioActual() ? 'selected' : ''}>${esc(u.nombre)}</option>`).join('')}</select></div>
          <div><label>Por dónde</label><select name="canal">${(meta.canales || []).map(c => `<option value="${c.id}">${esc(c.label)}</option>`).join('')}</select></div></div>
        <label>Nota</label><textarea name="nota" rows="2" placeholder="Contexto para cuando llegue el momento"></textarea>
        <p class="suave" style="font-size:12px;margin:6px 0 0">${meta.calendarioActivo ? 'Queda en el Google Calendar del dueño (si tiene correo configurado).' : 'Google Calendar aún no está conectado: queda solo en la app.'}</p>
        <div class="acciones"><button class="btn primario" type="submit">Guardar</button><button class="btn" type="button" id="comp-cancelar">Cancelar</button></div>
        <div id="comp-error"></div></form></div>`;
    const $frm = document.getElementById('frm-comp');
    const ajustarCanal = () => { const t = (meta.tiposCompromiso || []).find(x => x.id === ($frm.querySelector('input[name=tipo]:checked') || {}).value); if (t && t.canal) $frm.querySelector('select[name=canal]').value = t.canal; };
    $frm.querySelectorAll('input[name=tipo]').forEach(r => r.addEventListener('change', ajustarCanal)); ajustarCanal();
    document.getElementById('comp-cancelar').addEventListener('click', () => { $modal.innerHTML = ''; });
    $frm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData($frm);
      $frm.querySelector('button[type=submit]').disabled = true;
      try {
        const r = await api('tareas', { method: 'POST', body: { lead_id: lead ? lead.id : null, tipo: f.get('tipo'), titulo: f.get('titulo'), fecha: f.get('fecha'), hora: f.get('hora') || null, dueno: f.get('dueno'), canal: f.get('canal'), nota: f.get('nota') || '' } });
        $modal.innerHTML = '';
        avisar(r.calendario && r.calendario.ok ? 'Compromiso guardado y en el calendario.' : r.calendario && r.calendario.error ? 'Compromiso guardado; el calendario falló: ' + r.calendario.error : 'Compromiso guardado.', r.calendario && r.calendario.error ? 'aviso' : 'ok');
        if (alTerminar) await alTerminar();
      } catch (err) { document.getElementById('comp-error').innerHTML = pintarError(err); $frm.querySelector('button[type=submit]').disabled = false; }
    });
  }

  // Diálogo "Sacar de la cola": razón cerrada + ¿volver a intentar? (descartar de verdad, o pausa
  // de N meses, propuesta según la razón). "Pidió que no lo contacten" va a la lista negra.
  function abrirSacar(l, { alTerminar, razon } = {}) {
    const $modal = document.getElementById('modal');
    $modal.innerHTML = `
      <div class="velo"><form class="dialogo" id="frm-sacar" style="max-width:460px">
        <h2>Sacar de la cola · ${esc(l.empresa)}</h2>
        <label>¿Por qué?</label>
        <select name="razon">${meta.razones.map(r => `<option value="${r.id}" ${r.id === razon ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}</select>
        <div id="sacar-reintento">${camposReintento()}</div>
        <label>Nota</label>
        <textarea name="nota" rows="2" placeholder="Lo que dijo, para cuando se retome"></textarea>
        <div class="acciones"><button class="btn primario" type="submit">Guardar</button><button class="btn" type="button" id="sacar-cancelar">Cancelar</button></div>
        <div id="sacar-error"></div>
      </form></div>`;
    const $frm = document.getElementById('frm-sacar');
    enlazarReintento($frm);
    document.getElementById('sacar-cancelar').addEventListener('click', () => { $modal.innerHTML = ''; });
    $frm.addEventListener('submit', async e => {
      e.preventDefault();
      const f = new FormData($frm);
      $frm.querySelector('button[type=submit]').disabled = true;
      try {
        const r = await api(`leads/${l.id}/ejecutiva`, { method: 'POST', body: { accion: 'descartado', razon: f.get('razon'), reintento_meses: Number(f.get('reintento') || 0), nota: f.get('nota') || '' } });
        $modal.innerHTML = '';
        avisar(r.pausado_hasta ? (r.avisos || []).join(' ') : `Descartado (${etiqueta(meta.razones, f.get('razon'))}). ${(r.avisos || []).join(' ')}`, r.pausado_hasta ? 'ok' : 'aviso');
        if (alTerminar) await alTerminar();
      } catch (err) { document.getElementById('sacar-error').innerHTML = pintarError(err); $frm.querySelector('button[type=submit]').disabled = false; }
    });
  }

  // Radios "¿Volver a intentar?" que comparten el diálogo de sacar y el de resultado de llamada.
  function camposReintento() {
    return `<label>¿Volver a intentar?</label>
      <div class="opciones fila" id="reintento-opciones">
        <label class="opcion"><input type="radio" name="reintento" value="0"> No, descartar</label>
        ${(meta.reintentoMeses || []).map(m => `<label class="opcion"><input type="radio" name="reintento" value="${m}"> En ${m} ${m === 1 ? 'mes' : 'meses'}</label>`).join('')}
      </div>
      <div class="suave" id="reintento-nota" style="font-size:12px;margin:-4px 0 8px"></div>`;
  }
  function enlazarReintento($frm) {
    const $razon = $frm.querySelector('select[name=razon]');
    const ajustar = () => {
      const r = meta.razones.find(x => x.id === $razon.value) || {};
      const $ops = $frm.querySelector('#reintento-opciones'), $nota = $frm.querySelector('#reintento-nota');
      if (!$ops) return;
      $ops.hidden = !!r.definitiva;
      const valor = r.definitiva ? '0' : String(r.reintento || 0);
      const radio = $frm.querySelector(`input[name=reintento][value="${valor}"]`) || $frm.querySelector('input[name=reintento]');
      if (radio) radio.checked = true;
      $nota.textContent = r.definitiva
        ? (r.id === 'no_contactar' ? 'Definitivo: el teléfono y el correo pasan a la lista negra y no vuelven a entrar por ninguna carga.' : 'Definitivo: el lead queda descartado.')
        : (r.reintento ? `Propuesto: pausa de ${r.reintento} meses. "No ahora" no es "nunca"; ese día vuelve solo a la cola.` : 'Propuesto: descartar. Cambia a una pausa si vale la pena retomarlo.');
    };
    $razon.addEventListener('change', ajustar);
    ajustar();
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
        ${(inf.listaNegra || []).length ? `<div class="kpi mal"><b>${inf.listaNegra.length}</b><span>En lista negra (no entran)</span></div>` : ''}
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
      ${tabla('Fuera por lista negra', inf.listaNegra || [], 'Por qué')}
      ${tabla('Entran con aviso', inf.avisos, 'Aviso')}`;
  }

  // ---------------------------------------------------------------- pipeline
  async function vistaPipeline(params) {
    const etapa = params.get('etapa') || '';
    const huerfanos = params.get('huerfanos') === '1';
    const pausados = params.get('pausados') === '1';
    const q = params.get('q') || '';
    const qs = new URLSearchParams();
    if (etapa) qs.set('etapa', etapa);
    if (huerfanos) qs.set('huerfanos', '1');
    if (pausados) qs.set('pausados', '1');
    if (q) qs.set('q', q);
    const [{ etapas: conteo, huerfanos: nHuerfanos, pausados: nPausados, listaNegra: nListaNegra, fallos: nFallos }, leads] = await Promise.all([api('pipeline'), api('leads?' + qs)]);
    const total = conteo.reduce((s, x) => s + x.n, 0);
    $app.innerHTML = `
      <div class="cabeza"><div><h1>Pipeline</h1><div class="suave">${plural(total, 'lead', 'leads')} en total</div></div></div>
      <div class="etapas">
        <a class="etapa ${!etapa && !huerfanos && !pausados ? 'activo' : ''}" href="#/pipeline"><b>${total}</b><span>Todos</span></a>
        ${conteo.map(x => `<a class="etapa ${etapa === x.etapa ? 'activo' : ''}" href="#/pipeline?etapa=${x.etapa}"><b>${x.n}</b><span>${esc(etiqueta(meta.etapas, x.etapa))}</span></a>`).join('')}
        <a class="etapa ${huerfanos ? 'activo' : ''}" href="#/pipeline?huerfanos=1"><b>${nHuerfanos}</b><span>Sin próximo toque</span></a>
        <a class="etapa ${pausados ? 'activo' : ''}" href="#/pipeline?pausados=1"><b>${nPausados || 0}</b><span>En pausa</span></a>
        <a class="etapa" href="#/lista-negra"><b>${nListaNegra || 0}</b><span>Lista negra</span></a>
        ${veTranscripcion() ? `<a class="etapa ${nFallos ? 'alerta' : ''}" href="#/fallos"><b>${nFallos || 0}</b><span>Fallos de marcación</span></a>` : ''}
      </div>
      <form class="filtros" id="buscar"><input type="search" name="q" placeholder="Buscar por empresa, contacto, correo o teléfono" value="${esc(q)}" /><button class="btn">Buscar</button></form>
      ${leads.length ? `<div class="panel tabla-env"><table>
        <thead><tr><th>Empresa</th><th>Contacto</th><th>Teléfono / correo</th><th>Etapa</th><th>Próximo toque</th></tr></thead>
        <tbody>${leads.map(l => `<tr>
          <td><a href="#/lead/${l.id}"><b>${esc(l.empresa)}</b></a></td>
          <td>${esc([l.contacto, l.cargo].filter(Boolean).join(' · ') || '—')}</td>
          <td class="num">${esc(telVisible(l.telefono) || l.email || '—')}</td>
          <td><span class="chip etapa">${esc(etiqueta(meta.etapas, l.etapa))}</span>${l.razon_descarte ? ` <span class="suave" style="font-size:12px">${esc(meta.razonLabel[l.razon_descarte] || l.razon_descarte)}</span>` : ''}</td>
          <td>${l.pausado_ms ? `<span class="chip pausa">En pausa hasta ${fecha(l.pausado_ms)}</span>` : l.proximo_ms ? fecha(l.proximo_ms) : '<span class="suave">—</span>'}</td>
        </tr>`).join('')}</tbody></table></div>`
        : '<div class="panel vacio">Ningún lead con este filtro.</div>'}`;
    document.getElementById('buscar').addEventListener('submit', e => {
      e.preventDefault();
      const nq = new FormData(e.target).get('q');
      const p = new URLSearchParams(qs); nq ? p.set('q', nq) : p.delete('q');
      location.hash = '#/pipeline?' + p;
    });
  }

  // ---------------------------------------------------------------- lista negra
  async function vistaListaNegra() {
    const lista = await api('lista-negra');
    $app.innerHTML = `
      <div class="cabeza"><div><div class="suave"><a href="#/pipeline">← Pipeline</a></div><h1>Lista negra</h1>
        <div class="suave">${plural(lista.length, 'entrada', 'entradas')}: personas (teléfono o correo) y empresas enteras (por nombre o dominio). Entran solos con "pidió que no lo contacten", a mano, o cargando tu base de lista negra. Las cargas de leads los dejan fuera, no se pueden marcar ni reactivar.</div></div></div>
      <div class="panel bloque">
        <h2>Cargar la base de lista negra <span class="suave" style="font-weight:400;font-size:12px">CSV o Excel con columnas empresa, teléfono, correo, dominio y motivo (cualquiera de ellas)</span></h2>
        <label class="soltar" id="ln-soltar" style="padding:18px"><input type="file" id="ln-archivo" accept=".csv,.xlsx" hidden /><b>Elige o suelta el archivo</b><div class="suave" style="font-size:12px">Primero se simula: ves cuántas entran, cuáles ya estaban y cuáles tienen error. Cada fila bloquea la empresa entera.</div></label>
        <div id="ln-informe"></div>
      </div>
      <div class="panel bloque">
        <h2>Agregar a mano</h2>
        <form id="ln-form" class="form-panel">
          <div><label>Teléfono</label><input name="telefono" placeholder="300 123 4567" /></div>
          <div><label>Correo</label><input name="email" type="email" placeholder="persona@empresa.co" /></div>
          <div><label>Empresa</label><input name="empresa" placeholder="ACME S.A.S." /></div>
          <div><label>Dominio (opcional)</label><input name="dominio" placeholder="acme.com" /></div>
          <div><label>Nota</label><input name="nota" placeholder="Por qué" /></div>
          <div><label style="display:flex;gap:6px;align-items:center;margin-top:22px"><input type="checkbox" name="toda_empresa" value="1" /> Bloquear toda la empresa</label></div>
          <div><button class="btn primario" type="submit">Agregar</button></div>
        </form>
        <div class="suave" style="font-size:12px;margin-top:6px">Con teléfono o correo se bloquea a esa persona; con solo empresa o dominio (o la casilla marcada), a toda la empresa.</div>
        <div id="ln-error"></div>
      </div>
      ${lista.length ? `<div class="panel tabla-env"><table>
        <thead><tr><th>Qué bloquea</th><th>Teléfono</th><th>Correo</th><th>Empresa</th><th>Nota</th><th>Cuándo</th><th></th></tr></thead>
        <tbody>${lista.map(x => `<tr>
          <td>${x.empresa_norm || x.dominio ? '<span class="chip vencida">Empresa</span>' : '<span class="chip etapa">Persona</span>'}${x.dominio ? `<div class="suave" style="font-size:12px">${esc(x.dominio)}</div>` : ''}</td>
          <td class="num">${esc(telVisible(x.telefono) || '—')}</td><td>${esc(x.email || '—')}</td>
          <td>${x.lead_id ? `<a href="#/lead/${x.lead_id}">${esc(x.empresa || 'ver lead')}</a>` : esc(x.empresa || '—')}</td>
          <td class="suave">${esc(x.nota || (meta.razonLabel[x.razon] || ''))}</td>
          <td class="suave" style="white-space:nowrap">${fecha(x.created_ms)}${x.usuario ? ` · ${esc(x.usuario)}` : ''}</td>
          <td><button class="btn mini" data-quitar="${x.id}">Quitar</button></td>
        </tr>`).join('')}</tbody></table></div>` : '<div class="panel vacio">La lista está vacía.</div>'}`;
    // Carga masiva: simula, muestra el informe, confirma.
    const $arch = document.getElementById('ln-archivo'), $inf = document.getElementById('ln-informe');
    const cargarLista = async (file, confirmar) => {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const base64 = btoa(bin);
      $inf.innerHTML = '<p class="suave">Leyendo…</p>';
      try {
        const r = await api('lista-negra/importar', { method: 'POST', body: { archivo: file.name, base64, confirmar } });
        const tabla = (titulo, filas, col) => filas.length ? `<details style="margin-top:6px"><summary style="cursor:pointer;font-size:13px">${titulo} (${filas.length})</summary><div class="tabla-env"><table><thead><tr><th class="num">Fila</th><th>Empresa</th><th>${col}</th></tr></thead><tbody>${filas.slice(0, 200).map(f => `<tr><td class="num">${f.fila}</td><td>${esc(f.empresa || '—')}</td><td>${esc(f.motivo || [f.telefono && telVisible(f.telefono), f.email, f.dominio].filter(Boolean).join(' · ') || '')}</td></tr>`).join('')}</tbody></table></div></details>` : '';
        $inf.innerHTML = `<div class="resumen" style="margin-top:10px">
            <div class="kpi bien"><b>${r.nuevos.length}</b><span>${r.simulado ? 'Entrarían' : 'Entraron'}</span></div>
            <div class="kpi"><b>${r.repetidos.length}</b><span>Ya estaban</span></div>
            <div class="kpi ${r.errores.length ? 'mal' : ''}"><b>${r.errores.length}</b><span>Con error</span></div>
            ${r.simulado ? '' : `<div class="kpi alerta"><b>${r.leads_descartados}</b><span>Leads descartados</span></div>`}
          </div>
          <div class="suave" style="font-size:12px">Columnas: ${Object.entries(r.columnas).map(([k, v]) => `${k} ← "${esc(v)}"`).join(' · ')}</div>
          ${r.simulado && r.nuevos.length ? `<div class="acciones"><button class="btn primario" id="ln-confirmar">Cargar ${plural(r.nuevos.length, 'entrada', 'entradas')}</button></div>` : ''}
          ${tabla('Nuevas', r.nuevos, 'Qué bloquea')}${tabla('Ya estaban', r.repetidos, 'Por qué')}${tabla('Con error', r.errores, 'Motivo')}`;
        const $ok = document.getElementById('ln-confirmar');
        if ($ok) $ok.addEventListener('click', async () => { $ok.disabled = true; await cargarLista(file, true); await vistaListaNegra(); });
        if (!r.simulado) avisar(`Lista negra cargada: ${r.nuevos.length} entradas, ${r.leads_descartados} leads descartados.`);
      } catch (err) { $inf.innerHTML = pintarError(err); }
    };
    $arch.addEventListener('change', () => { if ($arch.files[0]) cargarLista($arch.files[0], false); });
    const $sol = document.getElementById('ln-soltar');
    $sol.addEventListener('dragover', e => { e.preventDefault(); $sol.classList.add('encima'); });
    $sol.addEventListener('dragleave', () => $sol.classList.remove('encima'));
    $sol.addEventListener('drop', e => { e.preventDefault(); $sol.classList.remove('encima'); const f = e.dataTransfer.files[0]; if (f) cargarLista(f, false); });

    document.getElementById('ln-form').addEventListener('submit', async e => {
      e.preventDefault();
      const d = Object.fromEntries(new FormData(e.target));
      try {
        const r = await api('lista-negra', { method: 'POST', body: d });
        avisar(r.existente ? 'Ya estaba en la lista.' : `Agregado.${r.leads_descartados ? ` ${plural(r.leads_descartados, 'lead descartado', 'leads descartados')}.` : ''}`);
        await vistaListaNegra();
      } catch (err) { document.getElementById('ln-error').innerHTML = pintarError(err); }
    });
    $app.querySelectorAll('[data-quitar]').forEach(b => b.addEventListener('click', async () => {
      if (!window.confirm('¿Quitar de la lista negra? Podrá volver a entrar por una carga y a marcarse.')) return;
      b.disabled = true;
      try { await api(`lista-negra/${b.dataset.quitar}/quitar`, { method: 'POST', body: {} }); avisar('Quitado de la lista.'); await vistaListaNegra(); }
      catch (err) { avisar(err.message, 'error'); b.disabled = false; }
    }));
  }

  // Evaluación con rúbrica de una llamada (la ven admin y ejecutiva; Angie recibe el semanal).
  function pintarEvaluacion(c) {
    const e = c.evaluacion;
    const st = c.pipeline_status;
    if (!e) {
      const txt = st === 'evaluando' ? 'Evaluando con la rúbrica…' : st === 'error_evaluacion' ? `La evaluación falló: ${esc(c.pipeline_error || '')}` : st === 'transcrito' ? 'Pendiente de evaluar (el servidor lo hace en el próximo minuto).' : 'Sin evaluación.';
      return `<div class="panel bloque"><h2>Evaluación con rúbrica</h2><p class="suave" style="margin:0 0 8px">${txt}</p>${c.turnos ? '<button class="btn" id="evaluar">Evaluar ahora</button>' : ''}</div>`;
    }
    const r = e.resultado;
    const defs = Object.fromEntries((e.criterios || []).map(d => [d.id, d]));
    const marca = x => x.estado === 'no_cumple' ? '<span class="pill mal">✗ No cumple</span>' : x.estado === 'no_aplica' ? '<span class="pill suave">– No aplica</span>' : '<span class="pill bien">✓ Cumple</span>';
    return `<div class="panel bloque">
      <h2>Evaluación con rúbrica ${esc(e.rubrica_version)} <span class="suave" style="font-weight:400;font-size:12px">${esc(e.modelo || '')} · ${fechaHora(e.created_ms)} · <button class="btn mini" id="evaluar">Evaluar de nuevo</button></span></h2>
      ${r.resumen ? `<p style="margin:0 0 10px">${esc(r.resumen)}</p>` : ''}
      <div class="suave" style="font-size:12px;margin-bottom:10px">${r.no_cumple.length ? `${plural(r.no_cumple.length, 'criterio sin cumplir', 'criterios sin cumplir')} de ${r.criterios.length}` : 'Nada que señalar en los ' + r.criterios.length + ' criterios'} · grabación mencionada: ${r.menciono_grabacion ? 'sí' : 'no'}</div>
      <ul class="criterios">${r.criterios.map(x => `<li class="${x.estado}">
        <div class="cab">${marca(x)} <b>${esc((defs[x.id] || {}).nombre || x.id)}</b> <span class="suave" style="font-size:12px">confianza ${Math.round(x.confianza * 100)} %</span></div>
        ${x.nota ? `<div class="nota">${esc(x.nota)}</div>` : ''}
        ${x.cita ? `<div class="cita">«${esc(x.cita)}»</div>` : ''}
      </li>`).join('')}</ul>
      ${r.mejor_momento ? `<div class="mejor"><b>Mejor momento:</b> «${esc(r.mejor_momento.cita)}»<div class="suave" style="font-size:12px">${esc(r.mejor_momento.por_que || '')}</div></div>` : ''}
      ${(e.avisos || []).length ? `<div class="suave" style="font-size:11px;margin-top:8px">Validador: ${e.avisos.map(esc).join(' · ')}</div>` : ''}
    </div>`;
  }

  // ---------------------------------------------------------------- fallos de marcación
  async function vistaFallos() {
    const lista = await api('llamadas/fallidas');
    const pend = lista.filter(x => !x.revisado_ms);
    $app.innerHTML = `
      <div class="cabeza"><div><div class="suave"><a href="#/pipeline">← Pipeline</a></div><h1>Fallos de marcación</h1>
        <div class="suave">Llamadas que el operador de Voximplant no cursó (404 = no encuentra el número, 5xx = falla de central) y lo que Angie reportó. ${plural(pend.length, 'sin revisar', 'sin revisar')}.</div></div></div>
      ${lista.length ? `<div class="panel tabla-env"><table>
        <thead><tr><th>Cuándo</th><th>Empresa</th><th>Teléfono</th><th>Qué pasó</th><th class="num">Fallos / contestadas del número</th><th>Reporte</th><th></th></tr></thead>
        <tbody>${lista.map(x => `<tr class="${x.revisado_ms ? 'suave' : ''}">
          <td style="white-space:nowrap">${fechaHora(x.started_ms)}</td>
          <td><a href="#/lead/${x.lead_id}"><b>${esc(x.empresa)}</b></a>${x.contacto ? `<div class="suave" style="font-size:12px">${esc(x.contacto)}</div>` : ''}</td>
          <td class="num">${esc(telVisible(x.telefono) || '—')}</td>
          <td>${esc(x.vox_estado === 'numero_invalido' ? 'No encuentra el número' : x.vox_estado === 'fallo_central' ? 'Falla de central' : (x.vox_estado || '—'))}<div class="suave" style="font-size:12px">código ${esc(x.vox_codigo || '?')}${x.vox_motivo ? ' ' + esc(x.vox_motivo) : ''}${x.vox_intentos ? ' · ' + plural(x.vox_intentos, 'intento', 'intentos') : ''}${x.vox_call_id ? `<br><span title="ID de la llamada en Voximplant, para soporte" style="font-family:monospace">${esc(x.vox_call_id)}</span>` : ''}</div></td>
          <td class="num">${x.fallos_del_numero} / ${x.contestadas_del_numero}</td>
          <td>${x.reporte ? `<b>${esc(x.reporte)}</b>` : '<span class="suave">—</span>'}</td>
          <td><button class="btn mini" data-revisar="${x.id}" data-valor="${x.revisado_ms ? '0' : '1'}">${x.revisado_ms ? 'Reabrir' : 'Revisado'}</button></td>
        </tr>`).join('')}</tbody></table></div>
        <p class="suave" style="font-size:12px">Para Voximplant: si un número entra desde el celular y aquí sale 404 en varios intentos, pide en soporte que revisen la ruta para Colombia (números portados). Pásales teléfono, hora (UTC = Bogotá + 5) y el ID de la llamada.</p>`
        : '<div class="panel vacio">Sin fallos de marcación.</div>'}`;
    $app.querySelectorAll('[data-revisar]').forEach(b => b.addEventListener('click', async () => {
      b.disabled = true;
      try { await api(`llamadas/${b.dataset.revisar}/revisar`, { method: 'POST', body: { revisado: b.dataset.valor === '1' } }); await vistaFallos(); }
      catch (e) { avisar(e.message, 'error'); b.disabled = false; }
    }));
  }

  // ---------------------------------------------------------------- llamada (transcripción y métricas)
  const PIPELINE_LABEL = { pendiente_resultado: 'esperando resultado', pendiente: 'por transcribir', transcribiendo: 'transcribiendo…', transcrito: 'transcrita · evaluando', evaluando: 'evaluando…', evaluado: 'transcrita y evaluada', omitida: 'sin transcribir', error: 'error al transcribir', error_evaluacion: 'error al evaluar', no_aplica: '' };
  function pipelineChip(t) {
    const st = t.pipeline_status;
    if (!st || st === 'no_aplica') return '';
    if (st === 'evaluado') return ` · <a href="#/llamada/${t.call_id}">Ver transcripción, métricas y evaluación</a>`;
    if (st === 'transcrito' || st === 'evaluando') return ` · <a href="#/llamada/${t.call_id}">Ver transcripción y métricas</a> <span class="suave">(${PIPELINE_LABEL[st]})</span>`;
    if (st === 'error' || st === 'error_evaluacion') return ` · <a href="#/llamada/${t.call_id}" style="color:var(--mal)">${PIPELINE_LABEL[st]}</a>`;
    return ` · <span class="suave">${PIPELINE_LABEL[st] || st}</span>`;
  }
  const METRICAS = [
    ['proporcion_angie', 'Habla Angie', v => v == null ? '—' : Math.round(v * 100) + ' %', 'Del tiempo hablado. Con conversación real, menos de la mitad.'],
    ['preguntas_antes_del_pitch', 'Preguntas antes del pitch', v => v == null ? 'sin pitch' : v, 'Preguntar antes de contar.'],
    ['preguntas_angie', 'Preguntas de Angie', v => v, ''],
    ['primera_pregunta_s', 'Primera pregunta', v => v == null ? 'ninguna' : 'seg ' + Math.round(v), ''],
    ['pitch_en_s', 'Empieza el pitch', v => v == null ? 'no detectado' : 'seg ' + Math.round(v), 'Primer turno con una palabra de PALABRAS_PITCH.'],
    ['monologo_mas_largo_s', 'Monólogo más largo', v => Math.round(v) + ' s', ''],
    ['ppm_angie', 'Velocidad', v => v == null ? '—' : v + ' ppm', 'Palabras por minuto de habla propia.'],
    ['muletillas_por_min', 'Muletillas / min', v => v == null ? '—' : v, ''],
    ['interrupciones', 'Interrupciones', v => v, 'Angie arranca mientras el prospecto habla.'],
    ['turnos_prospecto', 'Turnos del prospecto', v => v, ''],
  ];
  async function vistaLlamada(id) {
    const c = await api('llamadas/' + encodeURIComponent(id) + '/transcripcion');
    const m = c.metricas || {};
    const mmss = s => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
    $app.innerHTML = `
      <div class="cabeza">
        <div><div class="suave"><a href="#/lead/${c.lead_id}">← ${esc(c.empresa)}</a></div><h1>Llamada${c.contacto ? ' con ' + esc(c.contacto) : ''}</h1>
          <div class="suave">${fechaHora(c.started_ms)}${c.duracion_s != null ? ' · ' + mmss(c.duracion_s) : ''}${c.resultado ? ' · ' + esc(meta.resultadoLabel[c.resultado] || c.resultado) : ''}${c.usuario ? ' · ' + esc(c.usuario) : ''}</div></div>
        <div class="acciones" style="margin:0">
          ${c.record_url ? `<a class="btn" href="${esc(c.record_url)}" target="_blank" rel="noopener">Escuchar grabación</a>` : ''}
          ${c.record_url ? '<button class="btn" id="reprocesar" title="Vuelve a transcribir y calcular">Reprocesar</button>' : ''}
        </div>
      </div>
      <div id="msg"></div>
      ${!veTranscripcion() ? '<div class="panel vacio">La transcripción por llamada es para la ejecutiva y el admin. Angie recibe el resumen de la semana.</div>' : !c.turnos ? `
        <div class="panel vacio">Estado: <b>${esc(PIPELINE_LABEL[c.pipeline_status] || c.pipeline_status)}</b>${c.pipeline_error ? `<div class="error" style="margin-top:10px;text-align:left">${esc(c.pipeline_error)}</div>` : ''}</div>` : `
      ${c.nota ? `<div class="panel bloque"><b>Nota de Angie:</b> <span style="white-space:pre-wrap">${esc(c.nota)}</span></div>` : ''}
      <div class="kpis">${METRICAS.map(([k, nombre, fmt, ayuda]) => `<div class="kpi" title="${esc(ayuda)}"><b>${esc(String(fmt(m[k])))}</b><span>${nombre}</span></div>`).join('')}</div>
      ${m.muletillas_detalle && Object.keys(m.muletillas_detalle).length ? `<div class="suave" style="font-size:12px;margin:-6px 0 14px">Muletillas: ${Object.entries(m.muletillas_detalle).map(([k, v]) => `${esc(k)} ×${v}`).join(', ')}</div>` : ''}
      ${pintarEvaluacion(c)}
      <div class="panel">
        <h2>Transcripción <span class="suave" style="font-weight:400;font-size:12px">${c.modelo ? esc(c.modelo) : ''}${c.transcrito_ms ? ' · ' + fechaHora(c.transcrito_ms) : ''}${c.meta && c.meta.modo === 'diarizacion' ? ' · grabación mono: voces separadas por diarización (Angie = quien dice Peaku)' : ''}</span></h2>
        <div class="turnos">${(c.turnos || []).map(t => `<div class="turno ${t.quien}"><span class="t">${mmss(t.inicio)}</span><span class="q">${t.quien === 'angie' ? 'Angie' : 'Prospecto'}</span><span class="x">${esc(t.texto)}</span></div>`).join('')}</div>
      </div>`}`;
    const $ev = document.getElementById('evaluar');
    if ($ev) $ev.addEventListener('click', async () => {
      $ev.disabled = true; $ev.textContent = 'Evaluando…';
      try { const r = await api(`llamadas/${c.id}/evaluar`, { method: 'POST', body: {} }); if (r.error) avisar('No se pudo evaluar: ' + r.error, 'error'); else avisar('Evaluada.'); await vistaLlamada(id); }
      catch (e) { avisar(e.message, 'error'); $ev.disabled = false; $ev.textContent = 'Evaluar'; }
    });
    const $re = document.getElementById('reprocesar');
    if ($re) $re.addEventListener('click', async () => {
      $re.disabled = true;
      try { await api(`llamadas/${c.id}/reprocesar`, { method: 'POST', body: {} }); avisar('En cola. El servidor la transcribe en el próximo minuto.'); }
      catch (e) { avisar(e.message, 'error'); $re.disabled = false; }
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
          ${t.record_url || (veTranscripcion() && t.pipeline_status && t.pipeline_status !== 'no_aplica') ? `<div style="font-size:12px">${t.record_url ? `<a href="${esc(t.record_url)}" target="_blank" rel="noopener">Escuchar grabación</a>` : ''}${veTranscripcion() && t.call_id ? pipelineChip(t) : ''}</div>` : ''}</div>
        <span class="suave" style="font-size:12px;white-space:nowrap;text-align:right">${cuando}${t.usuario ? `<br>${esc(t.usuario)}` : ''}</span>
      </li>`;
    };

    $app.innerHTML = `
      <div class="cabeza">
        <div><div class="suave"><a href="#/cola">← Cola</a></div><h1>${esc(l.empresa)}</h1>
          <div class="suave">${esc([l.contacto, l.cargo].filter(Boolean).join(' · ') || 'Sin contacto')}${l.ciudad ? ' · ' + esc(l.ciudad) : ''}</div></div>
        <div style="text-align:right">
          <span class="chip etapa" style="font-size:13px">${esc(etiqueta(meta.etapas, l.etapa))}</span>
          ${l.pausado_ms ? `<div style="margin-top:4px"><span class="chip pausa">En pausa hasta ${fecha(l.pausado_ms)}</span></div>` : ''}
          ${l.razon_descarte ? `<div class="suave" style="font-size:12px;margin-top:4px">${esc(meta.razonLabel[l.razon_descarte] || l.razon_descarte)}</div>` : ''}
          ${l.en_lista_negra ? '<div style="font-size:12px;margin-top:4px;color:var(--mal)"><b>En lista negra</b> · no contactar</div>' : ''}
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
                ${meta.calendly ? '<button class="btn" id="link-calendly" title="Mandar el Calendly de la ejecutiva por WhatsApp, correo o LinkedIn">📅 Link de Calendly</button>' : ''}
                <button class="btn" id="respondio" title="Te escribió por WhatsApp, correo o LinkedIn: registra qué pasó (cuenta como conversación)">Me respondió</button>
                <button class="btn" id="compromiso" title="Algo que quedaste con el prospecto, con fecha y hora">Compromiso</button>
                <button class="btn peligro" id="descartar" title="Descartar o pausar">Sacar de la cola</button>
                ${l.pausado_ms ? '<button class="btn" data-ejecutiva="reactivar" title="Quitar la pausa y volver a la cola desde hoy">Retomar ahora</button>' : ''}
              </div>
              <p class="suave" style="font-size:12px;margin:0">${l.telefono ? `<a href="${waLink(l.telefono)}" target="_blank" rel="noopener">Abrir WhatsApp ↗</a>` : ''}${l.email ? ` · <a href="mailto:${esc(l.email)}">Escribir correo ↗</a>` : ''}</p>`
            : l.etapa === 'descartado' ? `<p class="suave" style="margin:0 0 10px">Lead descartado${l.en_lista_negra ? ' y en lista negra: para volver a llamarlo hay que <a href="#/lista-negra">quitarlo de la lista</a> primero' : ''}.</p>
              ${l.en_lista_negra ? '' : '<div class="acciones" style="margin-top:0"><button class="btn" data-ejecutiva="reactivar" title="Vuelve a la cola con una secuencia corta desde hoy">Reactivar</button></div>'}`
            : `<p class="suave" style="margin:0 0 10px">Desde aquí decide la ejecutiva comercial.</p>
              <div class="acciones" style="margin-top:0">
                ${l.etapa === 'reunion_agendada' ? `<button class="btn primario" data-ejecutiva="reunion_realizada">Reunión realizada</button>
                <button class="btn" data-ejecutiva="no_show">No se presentó</button>` : ''}
                ${['reunion_agendada', 'reunion_realizada'].includes(l.etapa) ? `<button class="btn primario" data-ejecutiva="calificado">Calificado</button>` : ''}
                <button class="btn" id="compromiso" title="Una tarea con fecha y hora sobre este lead">Compromiso</button>
                ${meta.calendly && ['reunion_agendada', 'reunion_realizada'].includes(l.etapa) ? `<button class="btn" id="link-calendly" title="${l.etapa === 'reunion_agendada' ? 'Para reagendar: si reserva otro horario, la reunión se mueve sola (con el token de Calendly)' : 'Para una segunda reunión'}">📅 Link de Calendly</button>` : ''}
                ${l.etapa !== 'calificado' ? `<button class="btn peligro" id="descartar">Descartar</button>` : ''}
              </div>`}
          </div>
          <div class="panel" style="margin-top:16px">
            <h2>Datos <button class="btn mini" id="editar" style="float:right" title="Corregir teléfono, correo, contacto…">Editar</button></h2>
            <div id="datos-form" hidden></div>
            <dl id="datos-lista">
              <dt>Teléfono</dt><dd class="num">${esc(telVisible(l.telefono) || '—')}${l.telefono_original && l.telefono && l.telefono_original !== telVisible(l.telefono) ? ` <span class="suave">(archivo: ${esc(l.telefono_original)})</span>` : ''}</dd>
              ${l.telefono_alt ? `<dt>Otro teléfono</dt><dd class="num">${esc(telVisible(l.telefono_alt))}${deAngie && tel.disponible && tel.disponible() ? ` <button class="btn mini" id="llamar-alt" title="Llamar a este número">📞 Llamar</button>` : ''}</dd>` : ''}
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
            <span class="n">${t.tipo === 'secuencia' ? t.paso : '★'}</span>
            <span class="chip ${t.canal}">${esc(t.tipo === 'secuencia' ? etiqueta(meta.canales, t.canal) : TIPO_LABEL(t.tipo))}</span>
            <span class="${t.estado !== 'pendiente' ? 'hecha' : ''}">${t.con_hora ? fechaHora(t.due_ms) : fecha(t.due_ms)}${t.tipo !== 'secuencia' && t.titulo ? ' · ' + esc(t.titulo) : ''}${t.usuario && t.tipo !== 'secuencia' ? ` <span class="suave">(${esc(t.usuario)})</span>` : ''}</span>
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
      const nota = window.prompt(accion === 'reactivar' ? '¿Por qué se retoma? (opcional)' : 'Nota (opcional):', '') ;
      if (nota === null) return;
      b.disabled = true;
      try { despues(await api(`leads/${l.id}/ejecutiva`, { method: 'POST', body: { accion, nota } })); await vistaLead(l.id); }
      catch (e) { $msg.innerHTML = pintarError(e); b.disabled = false; }
    }));

    const $desc = document.getElementById('descartar');
    if ($desc) $desc.addEventListener('click', () => abrirSacar(l, { alTerminar: () => vistaLead(l.id) }));
    const $comp = document.getElementById('compromiso');
    if ($comp) $comp.addEventListener('click', () => abrirCompromiso({ lead: l }, { alTerminar: () => vistaLead(l.id) }));

    const $manual = document.getElementById('llamada-manual');
    if ($manual) $manual.addEventListener('click', () => abrirResultado(l, {}));
    const $linkCal = document.getElementById('link-calendly');
    if ($linkCal) $linkCal.addEventListener('click', () => enviarLinkCalendly(l, () => render()));
    const $respondio = document.getElementById('respondio');
    if ($respondio) $respondio.addEventListener('click', () => abrirResultado(l, { respuesta: true }));

    // Editar datos de contacto (los números cambian y las bases traen errores).
    const $editar = document.getElementById('editar');
    if ($editar) $editar.addEventListener('click', () => {
      const $f = document.getElementById('datos-form'), $dl = document.getElementById('datos-lista');
      const campo = (k, label, v, extra = '') => `<div><label>${label}</label><input name="${k}" value="${esc(v || '')}" ${extra} /></div>`;
      $f.innerHTML = `<form class="form-panel" id="frm-editar" style="grid-template-columns:1fr 1fr">
          ${campo('empresa', 'Empresa', l.empresa, 'required')}${campo('contacto', 'Contacto', l.contacto)}
          ${campo('cargo', 'Cargo', l.cargo)}${campo('ciudad', 'Ciudad', l.ciudad)}
          ${campo('telefono', 'Teléfono principal', telVisible(l.telefono), 'inputmode="tel"')}${campo('telefono_alt', 'Otro teléfono', telVisible(l.telefono_alt), 'inputmode="tel" placeholder="Si tiene otro número"')}
          ${campo('email', 'Correo', l.email, 'type="email"')}
          <div class="acciones" style="grid-column:1/-1;margin:0"><button class="btn primario" type="submit">Guardar</button><button class="btn" type="button" id="editar-cancelar">Cancelar</button></div>
          <div id="editar-error" style="grid-column:1/-1"></div></form>`;
      $f.hidden = false; $dl.hidden = true; $editar.hidden = true;
      document.getElementById('editar-cancelar').addEventListener('click', () => { $f.hidden = true; $dl.hidden = false; $editar.hidden = false; });
      document.getElementById('frm-editar').addEventListener('submit', async e => {
        e.preventDefault();
        const d = Object.fromEntries(new FormData(e.target));
        try {
          const r = await api(`leads/${l.id}/editar`, { method: 'POST', body: d });
          avisar(r.sin_cambios ? 'Sin cambios.' : 'Datos actualizados: ' + Object.keys(r.cambios).join(', ') + '.');
          await vistaLead(l.id);
        } catch (err) { document.getElementById('editar-error').innerHTML = pintarError(err); }
      });
    });

    const $llamar = document.getElementById('llamar');
    const $llamarAlt = document.getElementById('llamar-alt');
    if ($llamarAlt) $llamarAlt.addEventListener('click', () => iniciarLlamada(l.telefono_alt));
    if ($llamar && puedeLlamar) $llamar.addEventListener('click', () => iniciarLlamada(l.telefono));
    function iniciarLlamada(numero) {
      const $estado = document.getElementById('llamada-estado');
      const uuid = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());
      let enCurso = true, inicio = null, reloj = null, ultimo = ['conectando', ''];
      delete reservasEnLlamada[l.id];
      const mmss = ms => { const t = Math.floor(ms / 1000); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };
      const pintar = (fase, texto) => {
        // fase: conectando | timbrando | activa
        ultimo = [fase, texto];
        const reserva = reservasEnLlamada[l.id];
        const agendar = fase === 'activa' && meta.calendly
          ? (reserva ? `<span class="agendada">✅ Reunión agendada${reserva.reunion_at ? ' · ' + esc(fechaHora(new Date(reserva.reunion_at).getTime())) : ''}</span>`
            : `<button class="btn agendar" type="button" id="agendar-llamada" title="Abre el Calendly de ${esc(meta.calendly.ejecutiva)} sin colgar">📅 Agendar</button>`)
          : '';
        $estado.innerHTML = `<div class="llamada ${fase}">
          <span class="punto"></span>
          <div class="txt"><b>${esc(texto)}</b><span class="num" id="reloj">${inicio ? mmss(Date.now() - inicio) : ''}</span></div>
          ${agendar}
          <button class="btn colgar" type="button" id="colgar">Colgar</button></div>
          ${fase === 'activa' && meta.recordatorioGrabacion ? `<div class="recordatorio">🎙 ${esc(meta.recordatorioGrabacion)}</div>` : ''}`;
        document.getElementById('colgar').addEventListener('click', () => { if (enCurso) tel.colgar(); });
        const $ag = document.getElementById('agendar-llamada');
        if ($ag) $ag.addEventListener('click', async () => {
          $ag.disabled = true;
          const r = await reservarEnCalendly(l, 'llamada').catch(e => { avisar(e.message, 'error'); return null; });
          if (r) {
            reservasEnLlamada[l.id] = r;
            avisar('Reunión agendada en Calendly. Al colgar, el resultado ya viene listo.');
            aplicarReservaAlDialogo(l);
          }
          if (enCurso) pintar(...ultimo); else if ($ag.isConnected) $ag.disabled = false;
        });
      };
      $llamar.disabled = true;
      pintar('conectando', 'Preparando la llamada…');
      tel.llamar({ lead: l, uuid, telefono: numero }, {
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
          // El operador no cursó la llamada (número no encontrado, falla de central): no es un
          // resultado de prospección. Angie ve el motivo exacto y decide qué hacer.
          if (info && ['numero_invalido', 'fallo_central'].includes(info.estadoVox)) return pintarFallo(info);
          $estado.innerHTML = `<div class="llamada fin"><span class="punto"></span><div class="txt"><b>${info && info.contesto ? 'Llamada terminada' + dur : esc((info && info.motivoLegible) || 'No contestaron')}</b></div></div>`;
          if (!(info && info.cancelada)) abrirResultado(l, { callUuid: uuid, obligatorio: true });
        },
      });
      function pintarFallo(info) {
        const invalido = info.estadoVox === 'numero_invalido';
        $estado.innerHTML = `<div class="fallo">
          <b>${invalido ? 'No salió: el operador no encuentra el número' : 'No salió: falla de la central'}</b>
          <div class="suave" style="font-size:12px">${esc(telVisible(numero))} · código ${esc(info.codigo || '?')}${info.motivo ? ' ' + esc(info.motivo) : ''} · ${plural(info.intentos || 1, 'intento', 'intentos')}. ${invalido ? 'Puede ser un número malo, o un número portado que esta ruta no encuentra.' : 'Suele ser pasajero.'}</div>
          <div class="acciones" style="margin:8px 0 0">
            <button class="btn primario" id="fallo-reintentar">Volver a marcar</button>
            <button class="btn" id="fallo-reportar" title="Queda registrado para revisar la ruta con Voximplant">Desde el celular sí entra: reportar</button>
            ${invalido ? '<button class="btn" id="fallo-sacar">Número malo: sacar de la cola</button>' : ''}
            <button class="btn" id="fallo-otro">Registrar otro resultado</button>
          </div></div>`;
        document.getElementById('fallo-reintentar').addEventListener('click', () => iniciarLlamada(numero));
        document.getElementById('fallo-reportar').addEventListener('click', async () => {
          const b = document.getElementById('fallo-reportar'); b.disabled = true;
          try { await api('llamadas/reportar', { method: 'POST', body: { uuid, lead_id: l.id, telefono: numero, codigo: info.codigo, estado: info.estadoVox, nota: 'desde el celular sí entra' } }); avisar('Reportado. Santiago lo ve en Pipeline → Fallos de marcación.'); b.textContent = 'Reportado ✓'; }
          catch (e) { avisar(e.message, 'error'); b.disabled = false; }
        });
        const $sacar = document.getElementById('fallo-sacar');
        if ($sacar) $sacar.addEventListener('click', () => abrirSacar(l, { razon: 'datos_malos', alTerminar: () => { location.hash = '#/cola'; } }));
        document.getElementById('fallo-otro').addEventListener('click', () => abrirResultado(l, { callUuid: uuid }));
      }
    }
  }

  // Reuniones agendadas en Calendly durante la llamada, por lead: el diálogo de resultado las usa
  // en vez de volver a abrir Calendly.
  const reservasEnLlamada = {};
  // Si el diálogo de resultado ya está abierto cuando Calendly confirma (colgó antes), lo actualiza.
  function aplicarReservaAlDialogo(l) {
    const $frm = document.getElementById('frm');
    if (!$frm || Number($frm.dataset.lead) !== Number(l.id)) return;
    const rb = $frm.querySelector('input[name=resultado][value=reunion_agendada]');
    if (rb) { rb.checked = true; rb.dispatchEvent(new Event('change', { bubbles: true })); }
  }

  // Diálogo de resultado de la llamada (obligatorio al colgar) o de descarte.
  // Calendly embebido encima del diálogo. Resuelve con { event_uri, invitee_uri, reunion_at } cuando
  // Calendly avisa que la reserva quedó (calendly.event_scheduled), o null si se cierra sin agendar.
  function reservarEnCalendly(l, canal) {
    return new Promise(async (resolver, rechazar) => {
      let datos;
      try { datos = await api(`leads/${l.id}/calendly?canal=${encodeURIComponent(canal || 'llamada')}&dominio=${encodeURIComponent(location.hostname)}${usuarioActual() ? '&usuario=' + encodeURIComponent(usuarioActual()) : ''}`); }
      catch (e) { return rechazar(e); }
      const capa = document.createElement('div');
      capa.className = 'velo calendly-capa';
      capa.innerHTML = `<div class="dialogo calendly-dialogo">
          <div class="calendly-cabeza"><div><b>Agenda con ${esc(meta.calendly.ejecutiva)}</b> <span class="suave">· ${esc(l.empresa || '')}${l.contacto ? ' · ' + esc(l.contacto) : ''}</span>
            <div class="suave" style="font-size:12px">Elige día y hora con el prospecto y confirma en Calendly. Aquí se registra sola cuando Calendly confirme.</div></div>
            <button class="btn" type="button" data-cerrar>Cerrar sin agendar</button></div>
          <iframe class="calendly-marco" src="${esc(datos.embebido)}" title="Calendly" allow="payment"></iframe>
          <div class="calendly-listo" hidden></div>
        </div>`;
      document.body.appendChild(capa);
      const fin = v => { window.removeEventListener('message', oir); capa.remove(); resolver(v); };
      capa.querySelector('[data-cerrar]').addEventListener('click', () => fin(null));
      const oir = e => {
        if (e.origin !== meta.calendly.origen || !e.data || e.data.event !== 'calendly.event_scheduled') return;
        const p = e.data.payload || {};
        const reserva = { event_uri: p.event && p.event.uri, invitee_uri: p.invitee && p.invitee.uri };
        if (!reserva.event_uri) return;
        if (meta.calendly.horaDeCalendly) return fin(reserva);   // el servidor trae la hora de Calendly
        // Sin token no sabemos la hora: se pide (la que acaba de elegir en Calendly).
        const $listo = capa.querySelector('.calendly-listo');
        $listo.hidden = false;
        $listo.innerHTML = `<form id="frm-hora" style="display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap">
            <div><b>✅ Quedó agendada en Calendly.</b><div class="suave" style="font-size:12px">¿Qué día y a qué hora quedó?</div></div>
            <input type="datetime-local" name="hora" required value="${fechaLocal(new Date(Date.now() + 86400000))}" />
            <button class="btn primario" type="submit">Registrar reunión</button></form>`;
        capa.querySelector('#frm-hora').addEventListener('submit', ev => {
          ev.preventDefault();
          const v = new FormData(ev.target).get('hora');
          fin({ ...reserva, reunion_at: new Date(v + ':00-05:00').toISOString() });
        });
      };
      window.addEventListener('message', oir);
    });
  }

  // Link de Calendly para mandar: WhatsApp (abre el chat con el mensaje y registra el toque) o copiar.
  async function enviarLinkCalendly(l, despues) {
    const $modal = document.getElementById('modal');
    const armar = async canal => {
      const d = await api(`leads/${l.id}/calendly?canal=${canal}${usuarioActual() ? '&usuario=' + encodeURIComponent(usuarioActual()) : ''}`);
      const nombre = (l.contacto || '').split(' ')[0] || '';
      return (meta.calendly.mensaje || '{link}').replace('{nombre}', nombre).replace(/\s+,/, ',').replace('{ejecutiva}', meta.calendly.ejecutiva).replace('{link}', d.enlace);
    };
    $modal.innerHTML = `<div class="velo"><div class="dialogo" style="max-width:460px">
      <h2>Mandar el link de Calendly</h2>
      <p class="suave" style="margin:0 0 12px">El link lleva marcado el lead y el canal: si reserva desde ahí, la reunión queda a tu nombre y por ese canal${meta.calendly.horaDeCalendly ? ' (se detecta sola)' : ' (se detecta cuando esté el token de Calendly; si no, regístrala tú)'}.</p>
      <div class="acciones" style="margin:0;flex-wrap:wrap">
        <button class="btn primario" data-link="whatsapp" ${l.telefono ? '' : 'disabled'}>💬 Por WhatsApp</button>
        <button class="btn" data-link="correo">✉️ Copiar para correo</button>
        <button class="btn" data-link="linkedin">💼 Copiar para LinkedIn</button>
        <button class="btn" data-cerrar>Cerrar</button>
      </div><div id="link-msg" class="suave" style="margin-top:10px;font-size:12px;word-break:break-all"></div></div></div>`;
    $modal.querySelector('[data-cerrar]').addEventListener('click', () => { $modal.innerHTML = ''; });
    $modal.querySelectorAll('[data-link]').forEach(b => b.addEventListener('click', async () => {
      const canal = b.dataset.link;
      try {
        const texto = await armar(canal);
        if (canal === 'whatsapp') {
          window.open(`${waLink(l.telefono)}?text=${encodeURIComponent(texto)}`, '_blank', 'noopener');
          $modal.innerHTML = '';
          // Desde "reunión agendada" los toques son de la ejecutiva: solo se abre el chat.
          if (!(meta.etapasAngie || []).includes(l.etapa)) { avisar('Chat de WhatsApp abierto con el link.'); return; }
          const r = await api(`leads/${l.id}/toques`, { method: 'POST', body: { canal: 'whatsapp', nota: 'Envió el link de Calendly' } });
          avisar('WhatsApp con el link registrado.');
          if (despues) despues(r);
        } else {
          try { await navigator.clipboard.writeText(texto); document.getElementById('link-msg').textContent = 'Copiado: ' + texto; }
          catch (_) { document.getElementById('link-msg').textContent = texto; }
        }
      } catch (e) { document.getElementById('link-msg').innerHTML = pintarError(e); }
    }));
  }

  function abrirResultado(l, { callUuid = null, obligatorio = false, soloDescarte = false, compromisoId = null, alTerminar = null, respuesta = false } = {}) {
    const $modal = document.getElementById('modal');
    const resultados = soloDescarte ? meta.resultados.filter(r => r.id === 'descartado')
      : respuesta ? meta.resultados.filter(r => (meta.respuestasOtroCanal || []).includes(r.id)) : meta.resultados;
    const canalesRespuesta = (meta.canales || []).filter(c => c.id !== 'llamada');
    const enUnaHora = new Date(Date.now() + 3600 * 1000);
    $modal.innerHTML = `
      <div class="velo"><form class="dialogo" id="frm" data-lead="${l.id}">
        <h2>${soloDescarte ? 'Descartar lead' : respuesta ? 'El prospecto respondió' : 'Resultado de la llamada'}</h2>
        <div id="aviso-reserva" class="calendly-aviso" hidden></div>
        ${respuesta ? `<p class="suave" style="margin:0 0 10px">${esc(l.empresa || '')}${l.contacto ? ' · ' + esc(l.contacto) : ''} te escribió. Queda como toque por ese canal con el resultado que elijas: cuenta como conversación y mueve la etapa igual que una llamada.</p>
        <div class="opciones fila" style="margin-bottom:8px">${canalesRespuesta.map((c, i) => `<label class="opcion"><input type="radio" name="canal" value="${c.id}" ${i === 0 ? 'checked' : ''}> ${esc(c.label)}</label>`).join('')}</div>` : ''}
        ${compromisoId ? `<p class="suave" style="margin:0 0 10px">Seguimiento con <b>${esc(l.empresa || '')}</b>${l.contacto ? ' · ' + esc(l.contacto) : ''}. Al guardar, el compromiso queda hecho y la llamada cuenta en tus indicadores.</p>` : ''}
        ${obligatorio ? '<p class="suave" style="margin:0 0 10px">Obligatorio: la llamada no queda registrada hasta que elijas un resultado.</p>' : ''}
        <div class="opciones">${resultados.map((r, i) => `<label class="opcion"><input type="radio" name="resultado" value="${r.id}" ${soloDescarte || (i === 0 && false) ? 'checked' : ''} required> ${esc(r.label)}</label>`).join('')}</div>
        <div id="campos-descarte" hidden>
          <label>Razón</label>
          <select name="razon">${meta.razones.map(r => `<option value="${r.id}">${esc(r.label)}</option>`).join('')}</select>
          ${camposReintento()}
        </div>
        <div id="campos-reunion" hidden>
          ${meta.calendly ? `<div class="calendly-aviso">📅 Llena la ficha y al guardar se abre el <b>Calendly de ${esc(meta.calendly.ejecutiva)}</b>. La reunión queda registrada solo cuando Calendly confirme la reserva.
            ${meta.calendly.permitirManual ? `<label class="check"><input type="checkbox" name="manual" value="1"> Ya quedó agendada por fuera de Calendly (pongo la fecha a mano)</label>` : ''}</div>` : ''}
          <div id="fecha-manual" ${meta.calendly ? 'hidden' : ''}>
            <label>Fecha y hora de la reunión</label>
            <input type="datetime-local" name="reunion_at" value="${fechaLocal(enUnaHora)}" />
          </div>
          <div class="dos">
            <div><label>Ejecutiva que atiende</label><input name="ejecutiva" placeholder="Luisa" value="${esc(meta.calendly ? meta.calendly.ejecutiva : (meta.usuarios || []).find(u => u.rol === 'ejecutiva') ? (meta.usuarios || []).find(u => u.rol === 'ejecutiva').nombre : '')}" /></div>
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
        <textarea name="nota" rows="3" placeholder="${respuesta ? 'Qué te escribió y qué quedó (pega el mensaje si sirve)' : 'Lo que valga la pena recordar de esta llamada'}"></textarea>
        <details id="quede" style="margin-top:10px"><summary style="cursor:pointer;font-weight:600;font-size:13px">¿Quedaste en algo? (seguimiento con hora, enviar algo…)</summary>
          <div class="opciones fila" style="margin-top:8px">${(meta.tiposCompromiso || []).filter(t => ['seguimiento', 'enviar', 'otro'].includes(t.id)).map((t, i) => `<label class="opcion"><input type="radio" name="c_tipo" value="${t.id}" ${i === 0 ? 'checked' : ''}> ${esc(t.label)}</label>`).join('')}</div>
          <label>Qué</label><input name="c_titulo" placeholder="Ej. Llamarlo el jueves con la propuesta" />
          <div class="dos"><div><label>Fecha</label><input type="date" name="c_fecha" /></div><div><label>Hora</label><input type="time" name="c_hora" /></div></div>
        </details>
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
      const $manual = $frm.querySelector('input[name=manual]');
      const reserva = !soloDescarte && reservasEnLlamada[l.id];
      $frm.querySelector('button[type=submit]').textContent = v === 'reunion_agendada' && meta.calendly && !reserva && !($manual && $manual.checked) ? 'Guardar y abrir Calendly' : 'Guardar';
      // Reunión ya agendada en Calendly durante la llamada: no se vuelve a abrir Calendly.
      const $av = document.getElementById('aviso-reserva');
      const $calAv = $frm.querySelector('#campos-reunion .calendly-aviso');
      if (reserva) {
        $av.hidden = false;
        $av.innerHTML = v === 'reunion_agendada'
          ? `✅ <b>Ya quedó agendada en Calendly</b> durante la llamada${reserva.reunion_at ? ' para el ' + esc(fechaHora(new Date(reserva.reunion_at).getTime())).replace(/\.$/, '') : ''}. <span class="suave">Completa la ficha y guarda.</span>`
          : `⚠️ Hay una reunión agendada en Calendly en esta llamada. Si no va, cancélala en Calendly; aquí queda registrado el resultado que elijas.`;
        if ($calAv) $calAv.hidden = true;
      } else { $av.hidden = true; if ($calAv) $calAv.hidden = false; }
    };
    $frm.querySelectorAll('input[name=resultado]').forEach(r => r.addEventListener('change', mostrar));
    if (!soloDescarte && reservasEnLlamada[l.id]) { const rb = $frm.querySelector('input[name=resultado][value=reunion_agendada]'); if (rb) rb.checked = true; }
    mostrar();
    enlazarReintento($frm);
    const $manualCal = $frm.querySelector('input[name=manual]');
    if ($manualCal) $manualCal.addEventListener('change', () => { document.getElementById('fecha-manual').hidden = !$manualCal.checked; mostrar(); });
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
        Object.assign(body, { canal: respuesta ? (f.get('canal') || 'whatsapp') : 'llamada', resultado, call_uuid: callUuid, compromiso_id: compromisoId });
        if (resultado === 'descartado') { body.razon = f.get('razon'); body.reintento_meses = Number(f.get('reintento') || 0); }
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
      // Reunión con Calendly: no se registra hasta que Calendly confirme la reserva.
      if (!soloDescarte && resultado === 'reunion_agendada' && meta.calendly && (reservasEnLlamada[l.id] || !f.get('manual'))) {
        const reserva = reservasEnLlamada[l.id] || await reservarEnCalendly(l, body.canal).catch(err => { document.getElementById('frm-error').innerHTML = pintarError(err); return null; });
        if (!reserva) return;             // cerró sin agendar: nada queda registrado
        body.detalle.calendly = { event_uri: reserva.event_uri, invitee_uri: reserva.invitee_uri };
        body.detalle.reunion_at = reserva.reunion_at || null;
      }
      $frm.querySelector('button[type=submit]').disabled = true;
      try {
        const r = await api(ruta, { method: 'POST', body });
        delete reservasEnLlamada[l.id];
        // El compromiso que quedó pactado en la llamada, si lo llenó.
        if (f.get('c_titulo') && f.get('c_fecha') && resultado !== 'descartado') {
          try { const rc = await api('tareas', { method: 'POST', body: { lead_id: l.id, tipo: f.get('c_tipo') || 'seguimiento', titulo: f.get('c_titulo'), fecha: f.get('c_fecha'), hora: f.get('c_hora') || null } }); (r.avisos = r.avisos || []).push(rc.calendario && rc.calendario.ok ? 'Compromiso anotado y en el calendario.' : 'Compromiso anotado.'); }
          catch (err) { (r.avisos = r.avisos || []).push('El compromiso no se guardó: ' + err.message); }
        } else if (f.get('c_titulo') && !f.get('c_fecha')) (r.avisos = r.avisos || []).push('El compromiso no se guardó: faltó la fecha.');
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
        if (alTerminar) await alTerminar();
        else if (location.hash === '#/cola') render(); else location.hash = '#/cola';
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
        <div class="kpi"><b>${w.totales.reuniones}</b><span>Reuniones agendadas</span>${w.metas.reunionesDia != null ? `<small>${w.metas.reunionesDia} en un día = meta cumplida</small>` : ''}</div>
        <div class="kpi"><b>${w.metas.diasCumplidos}<span class="suave" style="font-size:14px"> / ${w.metas.diasHabilesTranscurridos}</span></b><span>Días con meta cumplida</span></div>
      </div>
      <div class="panel tabla-env">
        <table><thead><tr><th>Día</th><th class="num">Marcaciones</th><th class="num">Conversaciones</th><th class="num">Reuniones</th><th class="num">WhatsApp</th><th class="num">Correo</th><th class="num">LinkedIn</th><th>Meta</th></tr></thead>
        <tbody>${w.dias.map(d => `<tr class="${d.fecha === w.hoy ? 'hoy' : ''} ${d.habil ? '' : 'suave'}">
          <td><a href="#/historial/${d.fecha}" title="Ver qué se hizo ese día">${dia(d.fecha)}</a></td><td class="num">${d.marcaciones}</td><td class="num">${d.conversaciones}</td><td class="num">${d.reuniones}</td><td class="num">${d.whatsapp}</td><td class="num">${d.correo}</td><td class="num">${d.linkedin}</td>
          <td>${!d.habil ? '' : d.cumplida ? `<span class="chip whatsapp" title="${d.cumplida_por === 'reuniones' ? `${d.reuniones} reuniones agendadas (meta: ${w.metas.reunionesDia})` : 'por ' + d.cumplida_por}">cumplida${d.cumplida_por === 'reuniones' ? ` · ${d.reuniones} reuniones` : ''}</span>` : (d.fecha < w.hoy ? '<span class="chip vencida">no</span>' : (d.fecha === w.hoy ? '<span class="chip hoy">en curso</span>' : ''))}</td>
        </tr>`).join('')}</tbody></table>
      </div>
      ${pintarMejora(w.mejora)}
      ${w.mostrarRatios ? `<div class="panel bloque"><h2>Tasas · últimos ${w.ratios.hasta === w.ratios.desde ? 1 : 14} días</h2>
        <div class="kpis" style="margin:0">
          ${tasa(r.tasaContacto, 'Tasa de contacto', r.conversaciones, r.marcaciones)}
          ${tasa(r.conversacionAReunion, 'Conversación → reunión', r.agendadas, r.conversaciones)}
          ${tasa(r.reunionRealizada, 'Reunión realizada', r.realizadas, r.realizadas + r.no_show)}
          ${tasa(r.realizadaACalificado, 'Realizada → calificado', r.calificados, r.realizadas)}
        </div></div>` : ''}`;
    const $foco = document.getElementById('confirmar-foco');
    if ($foco) $foco.addEventListener('click', async () => {
      const sel = document.getElementById('foco-criterio');
      $foco.disabled = true;
      try { const r = await api('mejora/foco', { method: 'POST', body: { criterio: sel ? sel.value : $foco.dataset.criterio } }); avisar(`Foco confirmado: ${r.nombre}, hasta el ${fecha(new Date(r.hasta + 'T12:00:00-05:00').getTime())}.`); await vistaSemana(params); }
      catch (e) { avisar(e.message, 'error'); $foco.disabled = false; }
    });
  }

  // Mejora de la semana (fase 5): hábitos, foco, mejor momento, seguimiento. Angie sí ve esto.
  function pintarMejora(m) {
    if (!m) return '';
    const pct = v => v == null ? '—' : Math.round(v * 100) + ' %';
    const ejemplos = xs => (xs || []).slice(0, 2).map(x => `<div class="cita">«${esc(x.cita || x.nota || '')}»${x.empresa ? ` <span class="suave">· ${esc(x.empresa)}${veTranscripcion() && x.call_id ? ` · <a href="#/llamada/${x.call_id}">ver</a>` : ''}</span>` : ''}</div>`).join('');
    const foco = m.foco;
    const focoHtml = !foco ? (m.suficiente ? '<p class="suave" style="margin:0">Sin hábitos que señalar esta semana: ningún criterio falla en varias llamadas.</p>' : '')
      : foco.estado === 'activo' ? `
        <div class="foco activo"><div class="suave" style="font-size:12px">Foco en curso · ${plural(foco.dias_restantes, 'día', 'días')} más (hasta ${fecha(new Date(foco.hasta + 'T12:00:00-05:00').getTime())})</div>
          <b>${esc(foco.nombre)}</b><div class="suave" style="font-size:13px">${esc(foco.descripcion || '')}</div>
          <div class="progreso">Al empezar fallaba en ${pct(foco.tasa_inicial)} de las llamadas · esta semana ${foco.aplican_actual ? pct(foco.tasa_actual) + ' (' + foco.no_cumple_actual + ' de ' + foco.aplican_actual + ')' : 'sin llamadas evaluadas aún'}${foco.tendencia != null ? (foco.tendencia < 0 ? ' · <span class="tend-bien">mejorando</span>' : foco.tendencia > 0 ? ' · <span class="tend-mal">peor</span>' : ' · igual') : ''}</div>
          ${ejemplos(foco.ejemplos)}</div>`
      : `
        <div class="foco"><div class="suave" style="font-size:12px">Foco propuesto para las próximas ${foco.semanas || 2} semanas</div>
          <b>${esc(foco.nombre)}</b><div class="suave" style="font-size:13px">${esc(foco.descripcion || '')}</div>
          <div class="progreso">Falló en ${foco.no_cumple_actual} de ${foco.aplican_actual} llamadas (${pct(foco.tasa_inicial)}).</div>
          ${ejemplos(foco.ejemplos)}
          <div class="acciones" style="margin:10px 0 0;align-items:center">
            <button class="btn primario" id="confirmar-foco" data-criterio="${esc(foco.criterio)}">Trabajar esto las próximas ${foco.semanas || 2} semanas</button>
            <span class="suave" style="font-size:12px">o elige otro:</span>
            <select id="foco-criterio">${(m.criterios || []).map(c => `<option value="${c.id}" ${c.id === foco.criterio ? 'selected' : ''}>${esc(c.nombre)}</option>`).join('')}</select>
          </div></div>`;
    return `
      <div class="panel bloque mejora">
        <h2>Mejora de la semana <span class="suave" style="font-weight:400;font-size:12px">${plural(m.llamadas_evaluadas, 'llamada evaluada', 'llamadas evaluadas')} con la rúbrica ${esc(m.rubrica || '')}${m.suficiente ? '' : ' · con menos de ' + m.minimo_llamadas + ' no se habla de hábitos'}</span></h2>
        ${focoHtml}
        ${m.seguimiento ? `<div class="seguimiento"><b>Foco anterior · ${esc(m.seguimiento.nombre)}</b> (${m.seguimiento.desde} → ${m.seguimiento.hasta}): al empezar ${pct(m.seguimiento.tasa_inicial)}, esta semana ${m.seguimiento.aplican_actual ? pct(m.seguimiento.tasa_actual) : 'sin llamadas evaluadas'}${m.seguimiento.mejoro === true ? ' · <span class="tend-bien">mejoró</span>' : m.seguimiento.mejoro === false ? ' · <span class="tend-mal">sigue igual o peor</span>' : ''}</div>` : ''}
        ${m.habitos && m.habitos.length > 1 ? `<h3>Otros hábitos de la semana</h3><ul class="habitos">${m.habitos.slice(1).map(h => `<li><b>${esc(h.nombre)}</b> <span class="suave">${h.no_cumple} de ${h.aplican} llamadas</span>${ejemplos(h.ejemplos)}</li>`).join('')}</ul>` : ''}
        ${m.mejor_momento ? `<div class="mejor"><b>Mejor momento de la semana</b>${m.mejor_momento.empresa ? ` <span class="suave">· ${esc(m.mejor_momento.empresa)}</span>` : ''}<div>«${esc(m.mejor_momento.cita)}»</div><div class="suave" style="font-size:12px">${esc(m.mejor_momento.por_que || '')}</div></div>` : ''}
        ${m.fortalezas && m.fortalezas.length ? `<div class="suave" style="font-size:12px;margin-top:8px">Sin fallas esta semana: ${m.fortalezas.map(f => esc(f.nombre)).join(' · ')}</div>` : ''}
      </div>`;
  }

  // ---------------------------------------------------------------- historial de un día
  // "¿Qué hice ayer?": cada toque en orden con su lead, resultado y nota, y los compromisos cumplidos.
  async function vistaHistorial(fechaPedida) {
    const qs = new URLSearchParams(); if (fechaPedida) qs.set('fecha', fechaPedida); if (usuarioActual()) qs.set('usuario', usuarioActual());
    const h = await api('historial' + (qs.toString() ? '?' + qs : ''));
    const largo = x => new Date(x + 'T12:00:00-05:00').toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
    const hora = ms => new Date(ms).toLocaleTimeString('es-CO', { timeZone: 'America/Bogota', hour: 'numeric', minute: '2-digit' });
    const nombre = h.fecha === h.hoy ? 'Hoy' : h.fecha === h.ayerDeHoy ? 'Ayer' : '';
    const r = h.resumen;
    const fila = t => {
      const que = meta.resultadoLabel[t.resultado] || t.resultado;
      const extra = [
        t.razon_descarte && (meta.razonLabel[t.razon_descarte] || t.razon_descarte),
        t.duracion_s != null && `${Math.floor(t.duracion_s / 60)}:${String(t.duracion_s % 60).padStart(2, '0')} min`,
        t.call_origen === 'manual' && t.canal === 'llamada' && 'por fuera de la app',
        t.tarea_tipo && `compromiso: ${esc(t.tarea_titulo || TIPO_LABEL(t.tarea_tipo))}`,
        t.detalle && t.detalle.reunion_at && 'reunión ' + fechaHora(new Date(t.detalle.reunion_at).getTime()),
      ].filter(Boolean).join(' · ');
      const conv = (meta.respuestasOtroCanal || []).includes(t.resultado) || t.resultado === 'conversacion' || t.resultado === 'reunion_agendada';
      return `<li class="${conv ? 'conv' : ''}">
        <span class="suave hora-h">${hora(t.created_ms)}</span>
        <span class="chip ${t.canal}">${esc(etiqueta(meta.canales, t.canal))}</span>
        <div style="flex:1;min-width:0"><a href="#/lead/${t.lead_id}"><b>${esc(t.empresa || 'Sin empresa')}</b></a>${t.contacto ? ' · ' + esc(t.contacto) : ''}${t.telefono ? ' · <span class="num">' + esc(telVisible(t.telefono)) + '</span>' : ''}
          <div>${esc(que)}${extra ? ` <span class="suave">· ${extra}</span>` : ''}</div>
          ${t.nota ? `<div class="suave" style="white-space:pre-wrap">${esc(t.nota)}</div>` : ''}</div>
      </li>`;
    };
    $app.innerHTML = `
      <div class="cabeza">
        <div><h1>${nombre ? nombre + ' · ' : ''}${esc(largo(h.fecha))}</h1>
          <div class="suave">${h.usuario ? `gestión de <b>${esc(h.usuario)}</b> · ` : ''}<a href="#/historial/${h.ayer}">← día anterior</a>${h.fecha < h.hoy ? ` · <a href="#/historial/${h.manana}">día siguiente →</a>` : ''} · <a href="#/semana?fecha=${h.fecha}">ver la semana</a></div></div>
        <a class="btn" href="#/cola">Cola del día</a>
      </div>
      <div class="kpis">
        <div class="kpi"><b>${r.marcaciones}</b><span>Marcaciones</span></div>
        <div class="kpi"><b>${r.conversaciones}</b><span>Conversaciones</span></div>
        <div class="kpi"><b>${r.reuniones}</b><span>Reuniones agendadas</span></div>
        <div class="kpi"><b>${r.whatsapp + r.correo + r.linkedin}</b><span>WhatsApp / correo / LinkedIn</span><small>${r.whatsapp} · ${r.correo} · ${r.linkedin}</small></div>
        <div class="kpi"><b>${r.leads}</b><span>Leads tocados</span><small>${plural(r.toques, 'toque', 'toques')} en total</small></div>
      </div>
      ${h.compromisosHechos.length ? `<div class="panel" style="margin-bottom:14px"><h2>Compromisos cumplidos sin toque <span class="suave" style="font-weight:400;font-size:12px">se marcaron hechos pero no quedó registrado qué pasó</span></h2>
        <ul class="pasos historial">${h.compromisosHechos.map(c => `<li><span class="suave hora-h">${hora(c.done_ms)}</span><span class="chip ${c.canal}">${esc(TIPO_LABEL(c.tipo))}</span><div style="flex:1"><b>${esc(c.titulo || TIPO_LABEL(c.tipo))}</b>${c.lead_id ? ` · <a href="#/lead/${c.lead_id}">${esc(c.empresa || 'lead')}</a>${c.contacto ? ' · ' + esc(c.contacto) : ''}` : ''}</div></li>`).join('')}</ul></div>` : ''}
      <div class="panel">
        <h2>Toques del día <span class="suave" style="font-weight:400;font-size:12px">en orden · clic en la empresa abre la ficha</span></h2>
        ${h.toques.length ? `<ul class="pasos historial dia">${h.toques.map(fila).join('')}</ul>` : `<p class="vacio">Sin toques registrados ese día${h.usuario ? ` para ${esc(h.usuario)}` : ''}.</p>`}
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
      else if (partes[0] === 'lista-negra') await vistaListaNegra();
      else if (partes[0] === 'fallos') await vistaFallos();
      else if (partes[0] === 'llamada' && partes[1]) await vistaLlamada(partes[1]);
      else if (partes[0] === 'marcar') vistaMarcar();
      else if (partes[0] === 'semana') await vistaSemana(new URLSearchParams(query));
      else if (partes[0] === 'historial') await vistaHistorial(partes[1]);
      else if (partes[0] === 'comision') await vistaComision(new URLSearchParams(query));
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
  enlazarBuscador();
  api('meta').then(m => { meta = m; pintarUsuarios(); }).catch(() => {}).finally(render);
})();

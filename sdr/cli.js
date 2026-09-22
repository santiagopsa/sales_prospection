#!/usr/bin/env node
// Comandos de operación de SDR Coach. Todos aceptan --set RUTA=valor para probar un hueco de
// config.js sin editarlo ni desplegar.
//
//   node sdr/cli.js secuencia [--desde 2026-09-21]            fechas de las tareas de un lead nuevo
//   node sdr/cli.js cola                                        orden de la cola de hoy con el desglose del puntaje
//   node sdr/cli.js importar archivo.csv|.xlsx [--confirmar]   carga desde la terminal (sin --confirmar, simula)
//   node sdr/cli.js semana [--fecha 2026-09-22] [--usuario Angie]  resumen semanal (actividad, racha, tasas si MOSTRAR_RATIOS)
//   node sdr/cli.js limpiar --confirmar                        BORRA todos los leads, toques, llamadas y cargas del
//                                                               schema sdr (y los deals que el SDR creó en el Sandler).
//                                                               Sin --confirmar solo muestra cuánto se borraría.
//   node sdr/cli.js vox:setup [--key ruta.json] [--url https://…] [--numero +57…] [--rotar]
//                                                               deja Voximplant listo e imprime las variables de Render
//   node sdr/cli.js vox:escenario                               imprime el escenario que se subiría (para revisarlo)
//   node sdr/cli.js pipeline [--estado] [--call N] [--limite 5] transcribe las llamadas pendientes (necesita DEEPGRAM_API_KEY);
//                                                               --estado muestra el conteo y los errores; --call N reprocesa una
//   node sdr/cli.js metricas --call N                          muestra transcripción y métricas de una llamada; con --set
//                                                               recalcula las métricas (PALABRAS_PITCH, MONOLOGO_LARGO_S…) y las guarda
//
// Ejemplos:
//   node sdr/cli.js secuencia --set SALTAR_FINES_DE_SEMANA=false
//   node sdr/cli.js cola --set PRIORIDAD.porCanal.llamada=25 --set PRIORIDAD.porDiaVencido=0
const fs = require('fs');
const base = require('./config');
const { CANAL_LABEL, ETAPA_LABEL } = require('./dominio');

function parsearArgs(argv) {
  const a = { _: [], set: [] };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === '--set') a.set.push(argv[++i]);
    else if (t.startsWith('--')) {
      const k = t.slice(2);
      a[k] = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true;
    } else a._.push(t);
  }
  return a;
}

// Copia de config con los --set aplicados. Valida que la ruta exista: un typo en el nombre de
// un hueco no debe pasar en silencio como "no cambió nada".
function configCon(sets) {
  const c = JSON.parse(JSON.stringify(base));
  for (const s of sets) {
    const eq = s.indexOf('=');
    if (eq < 0) throw new Error(`--set espera RUTA=valor, recibí "${s}"`);
    const ruta = s.slice(0, eq).split('.');
    let valor = s.slice(eq + 1);
    try { valor = JSON.parse(valor); } catch (_) { /* queda como texto */ }
    let o = c;
    for (const k of ruta.slice(0, -1)) {
      if (o[k] === undefined || typeof o[k] !== 'object') throw new Error(`No existe el hueco ${ruta.join('.')}`);
      o = o[k];
    }
    const hoja = ruta[ruta.length - 1];
    if (!(hoja in o)) throw new Error(`No existe el hueco ${ruta.join('.')}`);
    console.log(`  · ${ruta.join('.')}: ${JSON.stringify(o[hoja])} → ${JSON.stringify(valor)}`);
    o[hoja] = valor;
  }
  return c;
}

const pad = (s, n) => String(s == null ? '' : s).slice(0, n).padEnd(n);

async function main() {
  const args = parsearArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'ayuda') {
    console.log(fs.readFileSync(__filename, 'utf8').split('\n').filter(l => l.startsWith('//')).map(l => l.slice(3)).join('\n'));
    return;
  }
  if (args.set.length) console.log('Con cambios:');
  const config = configCon(args.set);

  if (cmd === 'secuencia') {
    const { planificar } = require('./secuencia');
    const tiempo = require('./tiempo');
    const desde = args.desde || tiempo.fechaBogota();
    const dias = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];
    console.log(`\nLead cargado el ${desde} (${dias[tiempo.diaSemana(desde)]}):`);
    for (const p of planificar(config, desde)) {
      console.log(`  ${pad(p.paso, 3)} ${pad(CANAL_LABEL[p.canal], 9)} ${p.fecha} ${dias[tiempo.diaSemana(p.fecha)]}  día ${tiempo.diasEntre(tiempo.instante(desde, 12), tiempo.instante(p.fecha, 12))}`);
    }
    return;
  }

  if (cmd === 'vox:setup') {
    const { setup } = require('./vox/setup');
    await setup({ key: args.key, url: args.url, numero: args.numero, rotar: args.rotar === true, config });
    return;
  }
  if (cmd === 'vox:escenario') {
    const { generarEscenario } = require('./vox/escenario');
    console.log(generarEscenario({ callerId: '+57XXXXXXXXXX', webhookUrl: (config.PUBLIC_URL_POR_DEFECTO || '') + '/sdr/api/vox/webhook', secreto: '(secreto)', aviso: config.AVISO_GRABACION, voz: config.VOZ_AVISO, avisoATodos: config.AVISO_TAMBIEN_A_ANGIE, reintentos: config.LLAMADA_REINTENTOS, codigosReintento: config.LLAMADA_REINTENTAR_CODIGOS, pausaReintentoS: config.LLAMADA_PAUSA_REINTENTO_S, mensajes: config.MENSAJES_LLAMADA }));
    return;
  }

  const db = require('./db').conectar();
  try {
    if (cmd === 'cola') {
      const { consultarCola } = require('./cola');
      const c = await consultarCola(db, config, { usuario: args.usuario || null });
      const i = c.indicadores;
      console.log(`\nCola del ${c.fecha}: ${c.tareas.length} tareas · ${i.vencidas} vencidas · ${i.deHoy} de hoy · ${i.huerfanos} huérfanos\n`);
      console.log(`  ${pad('#', 4)}${pad('pts', 5)}${pad('etapa+canal+atraso', 20)}${pad('canal', 10)}${pad('etapa', 14)}empresa`);
      c.tareas.forEach((t, n) => {
        const d = t.desglose;
        console.log(`  ${pad(n + 1, 4)}${pad(t.puntaje, 5)}${pad(`${d.etapa}+${d.canal}+${d.atraso}${t.diasVencida ? ` (${t.diasVencida}d)` : ''}`, 20)}${pad(CANAL_LABEL[t.canal], 10)}${pad(ETAPA_LABEL[t.etapa], 14)}${t.empresa}`);
      });
    } else if (cmd === 'semana') {
      const { resumenSemana } = require('./ritmo');
      const r = await resumenSemana(db, config, { fecha: args.fecha, usuario: args.usuario || null });
      console.log(`\nSemana del ${r.lunes} al ${r.domingo}\n`);
      console.log(`  ${pad('fecha', 12)}${pad('marc', 6)}${pad('conv', 6)}${pad('reun', 6)}${pad('wa', 5)}${pad('mail', 6)}${pad('in', 4)}cumplida`);
      for (const d of r.dias) console.log(`  ${pad(d.fecha, 12)}${pad(d.marcaciones, 6)}${pad(d.conversaciones, 6)}${pad(d.reuniones, 6)}${pad(d.whatsapp, 5)}${pad(d.correo, 6)}${pad(d.linkedin, 4)}${d.habil ? (d.cumplida ? 'sí' : (d.fecha <= r.hoy ? 'no' : '')) : '—'}`);
      console.log(`\n  Totales: ${r.totales.marcaciones} marcaciones (meta ${r.metas.marcaciones}) · ${r.totales.conversaciones} conversaciones (meta ${r.metas.conversaciones}) · ${r.totales.reuniones} reuniones`);
      console.log(`  Días cumplidos: ${r.metas.diasCumplidos} de ${r.metas.diasHabilesTranscurridos} · racha: ${r.racha.dias} día(s)`);
      const x = r.ratios;
      console.log(`  Tasas (${x.desde} → ${x.hasta})${r.mostrarRatios ? '' : ' [ocultas en la app: MOSTRAR_RATIOS=false]'}: contacto ${x.tasaContacto ?? '—'}% · conv→reunión ${x.conversacionAReunion ?? '—'}% · reunión realizada ${x.reunionRealizada ?? '—'}% · realizada→calificado ${x.realizadaACalificado ?? '—'}%`);
    } else if (cmd === 'limpiar') {
      const { T } = require('./schema');
      const n = async (tabla) => (await db.query(`SELECT COUNT(*)::int AS n FROM ${tabla}`)).rows[0].n;
      const deals = (await db.query(`SELECT COUNT(*)::int AS n FROM public.deals WHERE id IN (SELECT deal_id FROM ${T.leads} WHERE deal_id IS NOT NULL)`)).rows[0].n;
      console.log(`\nEn la base: ${await n(T.leads)} leads · ${await n(T.tasks)} tareas · ${await n(T.touches)} toques · ${await n(T.calls)} llamadas · ${await n(T.imports)} cargas · ${await n(T.lista_negra)} en lista negra · ${deals} deals del SDR en el Sandler`);
      if (!args.confirmar) { console.log('Nada borrado. Para borrar de verdad: node sdr/cli.js limpiar --confirmar'); return; }
      await db.query('BEGIN');
      try {
        await db.query(`DELETE FROM public.deals WHERE id IN (SELECT deal_id FROM ${T.leads} WHERE deal_id IS NOT NULL)`);
        await db.query(`DELETE FROM ${T.touches}`); await db.query(`DELETE FROM ${T.calls}`); await db.query(`DELETE FROM ${T.tasks}`);
        await db.query(`DELETE FROM ${T.leads}`); await db.query(`DELETE FROM ${T.imports}`); await db.query(`DELETE FROM ${T.lista_negra}`);
        await db.query('COMMIT');
      } catch (e) { await db.query('ROLLBACK'); throw e; }
      console.log('Borrado. El schema, la rúbrica y la configuración quedan intactos.');
    } else if (cmd === 'importar') {
      const { importar } = require('./importar');
      const ruta = args._[1];
      if (!ruta) throw new Error('Uso: node sdr/cli.js importar archivo.csv [--confirmar]');
      const bytes = fs.readFileSync(ruta);
      const inf = await importar(db, config, { archivo: require('path').basename(ruta), contenido: /\.xlsx$/i.test(ruta) ? bytes : require('./normalizar').decodificar(bytes), simular: !args.confirmar, usuario: args.usuario });
      console.log(`\n${inf.simulado ? 'SIMULACIÓN (usa --confirmar para cargar)' : 'Carga #' + inf.import_id}`);
      console.log(`  filas ${inf.filas} · ${inf.simulado ? 'se crearían ' + inf.aCrear : 'creados ' + inf.creados.length} · duplicados ${inf.duplicados.length} · con error ${inf.errores.length}`);
      for (const d of inf.duplicados) console.log(`  dup  fila ${d.fila}: ${d.empresa} — ${d.motivo}`);
      for (const e of inf.errores) console.log(`  err  fila ${e.fila}: ${e.motivo}`);
      for (const a of inf.avisos) console.log(`  aviso fila ${a.fila}: ${a.avisos.join('; ')}`);
    } else if (cmd === 'pipeline') {
      const P = require('./pipeline');
      if (args.estado || (!args.call && !process.env.DEEPGRAM_API_KEY)) {
        const e = await P.estado(db);
        console.log(`\nLlamadas por estado: ${Object.entries(e.conteo).map(([k, v]) => `${k} ${v}`).join(' · ') || 'ninguna'}`);
        for (const x of e.errores) console.log(`  error llamada ${x.id} (lead ${x.lead_id}, ${x.pipeline_intentos} intentos): ${x.pipeline_error}`);
        if (!process.env.DEEPGRAM_API_KEY) console.log('Sin DEEPGRAM_API_KEY en el entorno: no se transcribe nada.');
        if (args.estado || !args.call) return;
      }
      if (args.call) {
        await P.reencolar(db, args.call);
        const r = await P.procesar(db, config, process.env, args.call, { forzar: true });
        console.log(r.error ? `Llamada ${r.call_id}: ${r.estado} · ${r.error}` : `Llamada ${r.call_id}: ${r.estado} · ${r.turnos} turnos`);
        if (r.metricas) imprimirMetricas(r.metricas);
        return;
      }
      const rs = await P.correrPendientes(db, config, process.env, { limite: Number(args.limite) || 5 });
      if (!rs.length) console.log('No hay llamadas pendientes.');
      for (const r of rs) console.log(r.error ? `Llamada ${r.call_id}: ${r.estado} · ${r.error}` : `Llamada ${r.call_id}: ${r.estado} · ${r.turnos} turnos`);
    } else if (cmd === 'metricas') {
      const P = require('./pipeline');
      if (!args.call) throw new Error('Falta --call N');
      const t = await P.transcripcionDeLlamada(db, args.call);
      if (!t.turnos) throw new Error(`La llamada ${args.call} está en "${t.pipeline_status}", sin transcripción.`);
      console.log(`\nLlamada ${t.id} · ${t.empresa}${t.contacto ? ' · ' + t.contacto : ''} · ${t.duracion_s || '?'} s · resultado: ${t.resultado || '—'}`);
      console.log(t.texto);
      const m = args.set.length ? await P.recalcularMetricas(db, config, args.call) : t.metricas;
      console.log(args.set.length ? '\nMétricas recalculadas y guardadas con los --set:' : '\nMétricas:');
      imprimirMetricas(m);
    } else {
      throw new Error(`Comando desconocido: ${cmd}. Usa "node sdr/cli.js ayuda".`);
    }
  } finally {
    await (db.end ? db.end() : null);
  }
}

function imprimirMetricas(m) {
  const { ETIQUETAS } = require('./pipeline/metricas');
  for (const [k, [nombre, fmt]] of Object.entries(ETIQUETAS)) console.log(`  ${nombre.padEnd(28)} ${fmt(m[k])}`);
  if (m.muletillas_detalle && Object.keys(m.muletillas_detalle).length) console.log(`  ${'Muletillas'.padEnd(28)} ${Object.entries(m.muletillas_detalle).map(([k, v]) => `${k} ×${v}`).join(', ')}`);
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });

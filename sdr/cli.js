#!/usr/bin/env node
// Comandos de operación de SDR Coach. Todos aceptan --set RUTA=valor para probar un hueco de
// config.js sin editarlo ni desplegar.
//
//   node sdr/cli.js secuencia [--desde 2026-09-21]            fechas de las tareas de un lead nuevo
//   node sdr/cli.js cola                                        orden de la cola de hoy con el desglose del puntaje
//   node sdr/cli.js importar archivo.csv [--confirmar]         carga desde la terminal (sin --confirmar, simula)
//   node sdr/cli.js vox:setup [--key ruta.json] [--url https://…] [--numero +57…]
//                                                               deja Voximplant listo e imprime las variables de Render
//   node sdr/cli.js vox:escenario                               imprime el escenario que se subiría (para revisarlo)
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
    await setup({ key: args.key, url: args.url, numero: args.numero, config });
    return;
  }
  if (cmd === 'vox:escenario') {
    const { generarEscenario } = require('./vox/escenario');
    console.log(generarEscenario({ callerId: '+57XXXXXXXXXX', webhookUrl: (config.PUBLIC_URL_POR_DEFECTO || '') + '/sdr/api/vox/webhook', secreto: '(secreto)', aviso: config.AVISO_GRABACION, voz: config.VOZ_AVISO, avisoATodos: config.AVISO_TAMBIEN_A_ANGIE }));
    return;
  }

  const db = require('./db').conectar();
  try {
    if (cmd === 'cola') {
      const { consultarCola } = require('./cola');
      const c = await consultarCola(db, config);
      const i = c.indicadores;
      console.log(`\nCola del ${c.fecha}: ${c.tareas.length} tareas · ${i.vencidas} vencidas · ${i.deHoy} de hoy · ${i.huerfanos} huérfanos\n`);
      console.log(`  ${pad('#', 4)}${pad('pts', 5)}${pad('etapa+canal+atraso', 20)}${pad('canal', 10)}${pad('etapa', 14)}empresa`);
      c.tareas.forEach((t, n) => {
        const d = t.desglose;
        console.log(`  ${pad(n + 1, 4)}${pad(t.puntaje, 5)}${pad(`${d.etapa}+${d.canal}+${d.atraso}${t.diasVencida ? ` (${t.diasVencida}d)` : ''}`, 20)}${pad(CANAL_LABEL[t.canal], 10)}${pad(ETAPA_LABEL[t.etapa], 14)}${t.empresa}`);
      });
    } else if (cmd === 'importar') {
      const { importar } = require('./importar');
      const ruta = args._[1];
      if (!ruta) throw new Error('Uso: node sdr/cli.js importar archivo.csv [--confirmar]');
      const inf = await importar(db, config, { archivo: require('path').basename(ruta), contenido: require('./normalizar').decodificar(fs.readFileSync(ruta)), simular: !args.confirmar });
      console.log(`\n${inf.simulado ? 'SIMULACIÓN (usa --confirmar para cargar)' : 'Carga #' + inf.import_id}`);
      console.log(`  filas ${inf.filas} · ${inf.simulado ? 'se crearían ' + inf.aCrear : 'creados ' + inf.creados.length} · duplicados ${inf.duplicados.length} · con error ${inf.errores.length}`);
      for (const d of inf.duplicados) console.log(`  dup  fila ${d.fila}: ${d.empresa} — ${d.motivo}`);
      for (const e of inf.errores) console.log(`  err  fila ${e.fila}: ${e.motivo}`);
      for (const a of inf.avisos) console.log(`  aviso fila ${a.fila}: ${a.avisos.join('; ')}`);
    } else {
      throw new Error(`Comando desconocido: ${cmd}. Usa "node sdr/cli.js ayuda".`);
    }
  } finally {
    await (db.end ? db.end() : null);
  }
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });

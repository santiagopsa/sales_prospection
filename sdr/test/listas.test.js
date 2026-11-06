// Listas priorizadas: la carga como lista, prioridad en la cola mientras está fresca y el orden
// de trabajo de una lista.
const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('listas priorizadas', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { consultarCola } = require('../cola');
  const { registrarToque } = require('../resultados');
  const Li = require('../listas');
  const base = require('../config');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  const lunes = new Date('2026-09-21T14:00:00Z');   // 9:00 Bogotá

  // Base vieja (Apollo, normal) y la lista de Luisa, que trae un contacto que ya estaba.
  const apollo = await importar(db, base, { archivo: 'apollo.csv', contenido: 'empresa,contacto,telefono\nVieja 1,A,3001111111\nVieja 2,B,3002222222\nVieja 3,C,3003333333', simular: false, lista: { origen: 'Apollo' }, ahora: lunes });
  assert.strictEqual(apollo.lista.prioridad, 'normal');
  const sim = await importar(db, base, { archivo: 'luisa-septiembre.xlsx.csv', contenido: 'empresa,contacto,telefono\nFresca 1,D,3004444444\nFresca 2,E,3005555555\nVieja 2,B,3002222222', simular: true, lista: { origen: 'Luisa', nombre: 'Feria RRHH' }, ahora: lunes });
  assert.deepStrictEqual(sim.lista, { nombre: 'Feria RRHH', origen: 'Luisa', prioridad: 'alta' });   // alta por defecto para Luisa
  assert.strictEqual(sim.ya_estaban, 1);
  const luisa = await importar(db, base, { archivo: 'x.csv', contenido: 'empresa,contacto,telefono\nFresca 1,D,3004444444\nFresca 2,E,3005555555\nVieja 2,B,3002222222', simular: false, lista: { origen: 'Luisa', nombre: 'Feria RRHH' }, ahora: lunes });
  assert.strictEqual(luisa.creados.length, 2);

  // En la cola, los de la lista de Luisa van primero (incluido el que ya estaba).
  let c = await consultarCola(db, base, { ahora: lunes });
  const primeros = c.tareas.slice(0, 3).map(t => t.empresa).sort();
  assert.deepStrictEqual(primeros, ['Fresca 1', 'Fresca 2', 'Vieja 2']);
  const f1 = c.tareas.find(t => t.empresa === 'Fresca 1');
  assert.strictEqual(f1.desglose.lista, 100);
  assert.strictEqual(f1.lista.nombre, 'Feria RRHH');
  assert.strictEqual(c.tareas.find(t => t.empresa === 'Vieja 1').lista, null);

  // Listado y detalle.
  const ls = await Li.listar(db, base, { ahora: lunes });
  assert.strictEqual(ls[0].nombre, 'Feria RRHH');
  assert.strictEqual(ls[0].caliente, true);
  assert.strictEqual(ls[0].dias_restantes, 14);
  assert.deepStrictEqual([ls[0].total, ls[0].por_tocar], [3, 3]);
  assert.strictEqual(ls[1].nombre, 'apollo');
  assert.strictEqual(ls[1].caliente, false);

  const f2 = c.tareas.find(t => t.empresa === 'Fresca 2').lead_id;
  await registrarToque(db, base, { leadId: f2, canal: 'llamada', resultado: 'no_contesto', usuario: 'Angie', ahora: new Date('2026-09-21T15:00:00Z') });
  const d = await Li.detalle(db, base, luisa.import_id, { ahora: new Date('2026-09-21T16:00:00Z') });
  assert.deepStrictEqual([d.por_tocar, d.en_curso, d.tocados_hoy], [2, 1, 1]);
  // Calidad: tocados / conversaciones / reuniones y la nota ("muy pronto" con 1 tocado).
  assert.deepStrictEqual([d.tocados, d.conversaciones, d.reuniones], [1, 0, 0]);
  assert.strictEqual(d.calidad.nota, 'pronto');
  assert.ok(d.calidad.razones.some(r => /100 % sin cargo/.test(r.texto)), 'la composición se ve aunque no se califique');
  assert.ok(d.calidad.razones.some(r => /100 % celulares/.test(r.texto)));
  // Una conversación que agenda: cuenta como conversación y reunión desde que llegó la lista.
  await registrarToque(db, base, { leadId: f2, canal: 'llamada', resultado: 'reunion_agendada', usuario: 'Angie', ahora: new Date('2026-09-21T15:30:00Z') });
  const d2 = await Li.detalle(db, base, luisa.import_id, { ahora: new Date('2026-09-21T16:00:00Z') });
  assert.deepStrictEqual([d2.tocados, d2.conversaciones, d2.reuniones], [1, 1, 1]);
  assert.strictEqual(d2.leads.find(x => x.id === f2).reunion, true);
  // El toque de antes de la lista no cuenta para ella: Vieja 2 se tocó en la lista de Apollo antes de llegar a la de Luisa.
  const v2 = c.tareas.find(t => t.empresa === 'Vieja 2').lead_id;
  await db.query(`UPDATE sdr.touches SET created_at = $2 WHERE id = (SELECT id FROM sdr.touches WHERE lead_id = $1 ORDER BY id LIMIT 1)`, [v2, '2026-09-20T14:00:00Z']).catch(() => {});
  const ls2 = await Li.listar(db, base, { ahora: new Date('2026-09-21T16:00:00Z') });
  const feria = ls2.find(x => x.nombre === 'Feria RRHH');
  assert.deepStrictEqual([feria.tocados, feria.conversaciones, feria.reuniones, feria.por_tocar], [1, 1, 1, 2]);
  assert.strictEqual(feria.calidad.etiqueta, 'Muy pronto');
  assert.ok(ls2.promedio && ls2.promedio.tocados === 1 && ls2.promedio.reuniones === 1);
  // Con el mínimo bajado a 1, la lista se califica y queda "buena" (1 reunión de 1 tocado).
  const laxo = { ...base, LISTAS: { ...base.LISTAS, calificacion: { ...base.LISTAS.calificacion, minimo_tocados: 1 } } };
  const d3 = await Li.detalle(db, laxo, luisa.import_id, { ahora: new Date('2026-09-21T16:00:00Z') });
  assert.strictEqual(d3.calidad.nota, 'buena');
  assert.ok(/Rinde: 100 % de reunión/.test(d3.calidad.resumen), d3.calidad.resumen);
  assert.strictEqual(d.leads[2].id, f2);                         // el tocado va después de los por tocar
  assert.strictEqual(Li.siguienteDe(d).empresa, 'Fresca 1');      // orden del archivo
  assert.strictEqual(Li.siguienteDe(d, Li.siguienteDe(d).id).empresa, 'Vieja 2');

  // Pasados 14 días ya no suma; cerrada tampoco.
  c = await consultarCola(db, base, { ahora: new Date('2026-10-06T14:00:00Z') });
  assert.ok(c.tareas.every(t => !t.lista));
  await Li.actualizar(db, base, luisa.import_id, { cerrar: true });
  c = await consultarCola(db, base, { ahora: lunes });
  assert.ok(c.tareas.every(t => !t.lista));
  const reab = await Li.actualizar(db, base, luisa.import_id, { reabrir: true, prioridad: 'normal', nombre: 'Feria' });
  assert.deepStrictEqual([reab.nombre, reab.prioridad, reab.caliente], ['Feria', 'normal', false]);
  await assert.rejects(Li.actualizar(db, base, luisa.import_id, { prioridad: 'urgente' }), /alta o normal/);
  await db.end();
});

// Contactos que Angie suma de una empresa de la lista (Marcar → empresa existente): cuentan en los %
// de la lista, en su propia línea del por qué, sin cambiar la composición del archivo.
test('listas: contactos de la misma empresa suman a la lista', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { registrarToque } = require('../resultados');
  const L = require('../leads');
  const Li = require('../listas');
  const base = require('../config');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  const d0 = new Date('2026-10-05T14:00:00Z');
  const vieja = await importar(db, base, { archivo: 'vieja.csv', contenido: 'empresa,contacto,cargo,telefono\nAcme S.A.S.,Ana,Gerente de Talento Humano,3007000001', simular: false, lista: { nombre: 'Vieja' }, ahora: new Date('2026-06-01T14:00:00Z') });
  const lista = await importar(db, base, { archivo: 'nueva.csv', contenido: 'empresa,contacto,cargo,telefono\nAcme SAS,Bea,Analista de selección,3007000002\nBeta Ltda,Cai,Jefe de Selección,3007000003', simular: false, lista: { nombre: 'Nueva' }, ahora: d0 });
  const otra = await importar(db, base, { archivo: 'otra.csv', contenido: 'empresa,contacto,cargo,telefono\nBeta,Dan,Director de Talento,3007000004', simular: false, lista: { nombre: 'Otra' }, ahora: new Date('2026-10-10T14:00:00Z') });

  // Angie marca a otra persona de Acme (escribe el nombre distinto): suma a la lista más reciente con Acme.
  const t1 = new Date('2026-10-20T15:00:00Z');
  const m = await L.leadParaMarcar(db, base, { telefono: '3007000010', empresa: 'ACME sas', contacto: 'Eva Jefe TH', ahora: t1 });
  assert.strictEqual(m.empresa_existente, 'Acme SAS');
  assert.deepStrictEqual(m.lista, { id: lista.import_id, nombre: 'Nueva' });
  const fila = (await db.query(`SELECT origen, agregado_at FROM sdr.lista_leads WHERE lead_id = $1`, [m.lead_id])).rows;
  assert.deepStrictEqual(fila.map(x => x.origen), ['misma_empresa']);
  // Si está trabajando otra lista que también trajo la empresa, va a esa (aunque sea más vieja y fuera de la ventana).
  const m2 = await L.leadParaMarcar(db, base, { telefono: '3007000011', empresa: 'Acme', contacto: 'Fer', listaId: vieja.import_id, ahora: t1 });
  assert.strictEqual(m2.lista.id, vieja.import_id);
  // Beta está en dos listas: sin lista activa, la más reciente (Otra).
  const m3 = await L.leadParaMarcar(db, base, { telefono: '3007000012', empresa: 'Beta', contacto: 'Gus', ahora: t1 });
  assert.strictEqual(m3.lista.id, otra.import_id);
  // Empresa que no vino en ninguna lista: nada.
  const m4 = await L.leadParaMarcar(db, base, { telefono: '3007000013', empresa: 'Sola SA', contacto: 'Hugo', ahora: t1 });
  assert.strictEqual(m4.lista, undefined);
  const m5 = await L.leadParaMarcar(db, base, { telefono: '3007000014', empresa: 'Sola', contacto: 'Iris', ahora: t1 });
  assert.strictEqual(m5.lista, undefined, 'la empresa existe pero no vino en el archivo de una lista');
  // Fuera de la ventana y sin lista activa: no suma (Vieja tiene 4+ meses; Acme también está en Nueva, así que probamos con otra empresa).
  await importar(db, base, { archivo: 'antigua.csv', contenido: 'empresa,contacto,telefono\nGama,Juan,3007000005', simular: false, lista: { nombre: 'Antigua' }, ahora: new Date('2026-05-01T14:00:00Z') });
  const m6 = await L.leadParaMarcar(db, base, { telefono: '3007000015', empresa: 'Gama', contacto: 'Kim', ahora: t1 });
  assert.strictEqual(m6.lista, undefined);

  // Eva conversa y agenda; Bea (archivo) no contesta.
  const bea = (await db.query(`SELECT id FROM sdr.leads WHERE contacto='Bea'`)).rows[0].id;
  await registrarToque(db, base, { leadId: bea, canal: 'llamada', resultado: 'no_contesto', ahora: new Date('2026-10-20T14:00:00Z') });
  await registrarToque(db, base, { leadId: m.lead_id, canal: 'llamada', resultado: 'reunion_agendada', ahora: new Date('2026-10-20T15:10:00Z') });
  const laxo = { ...base, LISTAS: { ...base.LISTAS, calificacion: { ...base.LISTAS.calificacion, minimo_tocados: 1 } } };
  const det = await Li.detalle(db, laxo, lista.import_id, { ahora: new Date('2026-10-21T14:00:00Z') });
  assert.deepStrictEqual([det.total, det.tocados, det.reuniones], [3, 2, 1]);
  assert.deepStrictEqual(det.agregados, { total: 1, tocados: 1, conversaciones: 1, reuniones: 1 });
  assert.strictEqual(det.leads.find(x => x.id === m.lead_id).sumado, true);
  assert.strictEqual(det.leads.find(x => x.id === bea).sumado, false);
  assert.ok(det.calidad.razones.some(r => r.signo === '+' && /Angie sumó 1 contacto de las mismas empresas: 1 tocados, 1 conversación, 1 reunión \(100 % de las reuniones de la lista\)/.test(r.texto)), JSON.stringify(det.calidad.razones));
  // Composición = solo el archivo: 2 contactos (Bea reclutadora, Cai jefe); Eva no cambia los cargos.
  assert.strictEqual(det.perfil.cargo.seleccion + det.perfil.cargo.decisor_th + det.perfil.cargo.otro_th + det.perfil.cargo.fuera + det.perfil.cargo.sin_cargo, 2);
  const ls = await Li.listar(db, laxo, { ahora: new Date('2026-10-21T14:00:00Z') });
  assert.deepStrictEqual(ls.find(x => x.id === lista.import_id).agregados, det.agregados);
  // Huecos: en_composicion suma a Eva a la composición; sumar=false la saca de todo.
  const enComp = { ...laxo, LISTAS: { ...laxo.LISTAS, misma_empresa: { ...laxo.LISTAS.misma_empresa, en_composicion: true } } };
  const d2 = await Li.detalle(db, enComp, lista.import_id, { ahora: new Date('2026-10-21T14:00:00Z') });
  assert.strictEqual(Object.values(d2.perfil.cargo).reduce((a, b) => a + b, 0), 3);
  const sinSumar = { ...laxo, LISTAS: { ...laxo.LISTAS, misma_empresa: { ...laxo.LISTAS.misma_empresa, sumar: false } } };
  const d3 = await Li.detalle(db, sinSumar, lista.import_id, { ahora: new Date('2026-10-21T14:00:00Z') });
  assert.deepStrictEqual([d3.total, d3.tocados, d3.reuniones, d3.agregados], [2, 1, 0, null]);

  // Históricos: un lead de Beta creado antes de esto (sin lista) se suma a la lista más reciente
  // anterior a él; uno creado antes de cualquier lista con su empresa, no. Idempotente.
  await db.query(`INSERT INTO sdr.leads (empresa, contacto, telefono, fuente, created_at) VALUES ('Beta S.A.', 'Lia', '+573007000020', 'marcacion directa', '2026-10-08T14:00:00Z'), ('Beta', 'Max', '+573007000021', 'marcacion directa', '2026-10-01T14:00:00Z')`);
  const sim = await Li.asociarHistoricos(db, base, { simular: true });
  assert.deepStrictEqual(sim.detalle.map(x => [x.contacto, x.lista]), [['Lia', 'Nueva']]);
  assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.lista_leads ll JOIN sdr.leads l ON l.id = ll.lead_id WHERE l.contacto = 'Lia'`)).rows[0].n, 0, 'simular no cambia nada');
  const ap = await Li.asociarHistoricos(db, base);
  assert.strictEqual(ap.asociados, 1);
  assert.strictEqual((await Li.asociarHistoricos(db, base)).asociados, 0);
  Li._reiniciar();
  assert.ok(await Li.jobAsociar(db, base, { log: { log() {} } }));
  assert.strictEqual(await Li.jobAsociar(db, base, { log: { log() {} } }), null);
  await db.end();
});

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

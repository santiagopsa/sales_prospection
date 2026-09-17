// Integración contra un Postgres real y vacío.
//   SDR_TEST_DATABASE_URL=postgres://postgres@localhost:5433/sdrtest?host=/tmp node --test sdr/test/
// Borra y recrea el schema "sdr" de esa base: nunca apuntarlo a producción.
const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('integración con Postgres', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { consultarCola } = require('../cola');
  const L = require('../leads');
  const config = require('../config');
  const tiempo = require('../tiempo');
  const db = conectar(url);
  const silencio = { log() {}, error: console.error };

  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, silencio);
  await initSchema(db, silencio); // idempotente

  const jueves = new Date('2026-09-17T15:00:00Z'); // 10:00 Bogotá
  const csv1 = [
    'Empresa;Contacto;Cargo;Teléfono;Correo;Ciudad;Fuente',
    'ACME;Ana Gómez;Gerente TA;300 123 4567;ana@acme.co;Medellín;lista A',
    'Beta;Luis;CTO;(4) 444 1234;;Medellín;lista A',
    'Gama;Eva;CEO;;EVA@gama.co;Bogotá;lista A',
    'ACME bis;Ana otra vez;;+57 300 1234567;;;lista A',   // repetido en archivo por teléfono
    ';Sin empresa;;3009998888;;;',                         // error
    'Delta;Juan;;12;;;',                                   // error: teléfono inválido y sin correo
  ].join('\n');

  await t.test('simular no escribe', async () => {
    const inf = await importar(db, config, { archivo: 'a.csv', contenido: csv1, simular: true, ahora: jueves });
    assert.strictEqual(inf.aCrear, 3);
    assert.strictEqual(inf.duplicados.length, 1);
    assert.match(inf.duplicados[0].motivo, /fila 2/);
    assert.strictEqual(inf.errores.length, 2);
    const n = (await db.query('SELECT COUNT(*)::int AS n FROM sdr.leads')).rows[0].n;
    assert.strictEqual(n, 0);
  });

  await t.test('confirmar crea leads y todas sus tareas', async () => {
    const inf = await importar(db, config, { archivo: 'a.csv', contenido: csv1, simular: false, ahora: jueves });
    assert.strictEqual(inf.creados.length, 3);
    const tareas = (await db.query('SELECT COUNT(*)::int AS n FROM sdr.tasks')).rows[0].n;
    assert.strictEqual(tareas, 3 * config.SECUENCIA_POR_DEFECTO.length);
    const carga = await L.detalleCarga(db, inf.import_id);
    assert.strictEqual(carga.creados, 3);
    assert.strictEqual(carga.duplicados, 1);
    assert.strictEqual(carga.con_error, 2);
    const beta = (await db.query(`SELECT telefono FROM sdr.leads WHERE empresa='Beta'`)).rows[0];
    assert.strictEqual(beta.telefono, '+576044441234');
  });

  await t.test('segunda carga detecta duplicados contra la base', async () => {
    const csv2 = 'empresa,telefono,email\nACME nueva,3001234567,\nGama 2,,eva@gama.co\nOmega,3105556677,omega@o.co';
    const inf = await importar(db, config, { archivo: 'b.csv', contenido: csv2, simular: false, ahora: jueves });
    assert.strictEqual(inf.creados.length, 1);
    assert.deepStrictEqual(inf.duplicados.map(d => d.motivo.split(' que ')[0]), ['mismo teléfono', 'mismo correo']);
    assert.match(inf.duplicados[0].motivo, /ACME · Ana Gómez, nuevo/);
  });

  await t.test('los índices únicos frenan duplicados aunque se salte el chequeo', async () => {
    await assert.rejects(db.query(`INSERT INTO sdr.leads (empresa, telefono) VALUES ('X', '+573001234567')`), /duplicate key/);
  });

  await t.test('cola: una tarea por lead, hoy y vencidas, ordenadas', async () => {
    // Omega entró el jueves; se simula que ACME va atrasada tres días hábiles.
    await db.query(`UPDATE sdr.tasks SET due_at = due_at - interval '5 days' WHERE lead_id = (SELECT id FROM sdr.leads WHERE empresa='ACME')`);
    const c = await consultarCola(db, config, { ahora: jueves });
    assert.strictEqual(c.fecha, '2026-09-17');
    assert.strictEqual(c.tareas.length, 4);                              // 4 leads, una tarea cada uno
    assert.strictEqual(new Set(c.tareas.map(x => x.lead_id)).size, 4);
    assert.strictEqual(c.tareas[0].empresa, 'ACME');                     // la vencida sube
    assert.strictEqual(c.tareas[0].vencida, true);
    assert.strictEqual(c.indicadores.vencidas, 1);
    assert.strictEqual(c.indicadores.deHoy, 3);
    assert.strictEqual(c.indicadores.huerfanos, 0);
    // Mañana a primera hora las del jueves que siguen pendientes aparecen como vencidas.
    const viernes = await consultarCola(db, config, { ahora: tiempo.instante('2026-09-18', 7) });
    assert.strictEqual(viernes.indicadores.vencidas, 4);
  });

  await t.test('huérfanos y descartados', async () => {
    await db.query(`UPDATE sdr.tasks SET estado='hecha' WHERE lead_id = (SELECT id FROM sdr.leads WHERE empresa='Beta')`);
    await db.query(`UPDATE sdr.leads SET etapa='descartado' WHERE empresa='Gama'`);
    const c = await consultarCola(db, config, { ahora: jueves });
    assert.strictEqual(c.indicadores.huerfanos, 1);
    assert.ok(!c.tareas.some(x => ['Beta', 'Gama'].includes(x.empresa)));
    const h = await L.listarLeads(db, { huerfanos: true });
    assert.deepStrictEqual(h.map(x => x.empresa), ['Beta']);
    const p = await L.pipeline(db);
    assert.strictEqual(p.etapas.find(x => x.etapa === 'nuevo').n, 3);
    assert.strictEqual(p.etapas.find(x => x.etapa === 'descartado').n, 1);
    assert.strictEqual(p.huerfanos, 1);
    const d = await L.detalleLead(db, h[0].id);
    assert.strictEqual(d.tareas.length, config.SECUENCIA_POR_DEFECTO.length);
    await assert.rejects(L.detalleLead(db, 99999), /no encontrado/);
  });

  db.end();
});

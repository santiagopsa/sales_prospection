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
    ';;;3009998888;;;',                                    // error: sin empresa ni nombre
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

  await t.test('posponer una tarea pendiente', async () => {
    const { posponerTarea } = require('../cola');
    const t1 = (await db.query(`SELECT t.id FROM sdr.tasks t JOIN sdr.leads l ON l.id=t.lead_id WHERE l.empresa='Omega' AND t.estado='pendiente' ORDER BY paso LIMIT 1`)).rows[0];
    const r = await posponerTarea(db, config, { taskId: t1.id, dias: 1, ahora: jueves });
    assert.strictEqual(r.fecha, '2026-09-18');
    const c = await consultarCola(db, config, { ahora: jueves });
    assert.ok(!c.tareas.some(x => x.empresa === 'Omega'));           // ya no es de hoy
    await assert.rejects(posponerTarea(db, config, { taskId: t1.id, dias: 0 }), /entre 1 y 60/);
    await db.query(`UPDATE sdr.tasks SET estado='hecha' WHERE id=$1`, [t1.id]);
    await assert.rejects(posponerTarea(db, config, { taskId: t1.id, dias: 2 }), /pendiente/);
  });

  await t.test('marcación directa: crea lead con secuencia o devuelve el existente', async () => {
    const n = await L.leadParaMarcar(db, config, { telefono: '311 222 3344', empresa: '', ahora: jueves });
    assert.strictEqual(n.existente, false);
    const l = (await db.query('SELECT empresa, fuente, telefono FROM sdr.leads WHERE id=$1', [n.lead_id])).rows[0];
    assert.deepStrictEqual(l, { empresa: 'Sin empresa', fuente: 'marcacion directa', telefono: '+573112223344' });
    assert.strictEqual((await db.query('SELECT COUNT(*)::int AS c FROM sdr.tasks WHERE lead_id=$1', [n.lead_id])).rows[0].c, config.SECUENCIA_POR_DEFECTO.length);
    const e = await L.leadParaMarcar(db, config, { telefono: '+57 300 123 4567' });
    assert.strictEqual(e.existente, true);
    assert.strictEqual(e.empresa, 'ACME');
    await assert.rejects(L.leadParaMarcar(db, config, { telefono: '12' }), /colombiano/);
  });

  await t.test('marcación directa: conecta con la empresa existente antes de crearla', async () => {
    await db.query(`INSERT INTO sdr.leads (empresa, contacto, telefono, ciudad, extra, etapa) VALUES
      ('Avalon Pharmaceutical LATAM S.A.S.', 'Jenny Molina', '+573188018246', 'Bogota', '{"industria":"pharma","empleados":"76","seniority":"Entry"}', 'reunion_agendada'),
      ('Avalon Pharmaceutical LATAM S.A.S.', 'Carlos Sin Tel', NULL, 'Bogota', NULL, 'nuevo')`);
    const emp = await L.buscarEmpresas(db, 'avalon pharma');
    assert.strictEqual(emp.length, 1);
    assert.strictEqual(emp[0].contactos.length, 2);
    assert.strictEqual(emp[0].lista_negra, false);
    // Misma empresa escrita distinto, persona nueva → contacto nuevo EN esa empresa, con sus datos de empresa.
    const n = await L.leadParaMarcar(db, config, { telefono: '311 555 0001', empresa: 'AVALON pharmaceutical latam', contacto: 'Ana Ruiz', usuario: 'Angie', ahora: jueves });
    assert.deepStrictEqual([n.existente, n.empresa_existente, n.otros_contactos], [false, 'Avalon Pharmaceutical LATAM S.A.S.', 2]);
    const nl = (await db.query('SELECT empresa, ciudad, extra FROM sdr.leads WHERE id=$1', [n.lead_id])).rows[0];
    assert.deepStrictEqual(nl, { empresa: 'Avalon Pharmaceutical LATAM S.A.S.', ciudad: 'Bogota', extra: { industria: 'pharma', empleados: '76' } }); // sin seniority (es de la persona)
    // Mismo contacto (por nombre, sin tildes) → se le agrega el número, no se duplica.
    const c = await L.leadParaMarcar(db, config, { telefono: '311 555 0002', empresa: 'Avalon Pharmaceutical LATAM', contacto: 'jenny molina', usuario: 'Angie', ahora: jueves });
    assert.deepStrictEqual([c.existente, c.conectado, c.principal], [true, 'contacto', false]);
    assert.strictEqual((await db.query(`SELECT telefono_alt FROM sdr.leads WHERE contacto='Jenny Molina'`)).rows[0].telefono_alt, '+573115550002');
    // Contacto elegido explícitamente sin teléfono → queda como principal.
    const sin = (await db.query(`SELECT id FROM sdr.leads WHERE contacto='Carlos Sin Tel'`)).rows[0].id;
    const k = await L.leadParaMarcar(db, config, { telefono: '311 555 0003', leadId: sin, ahora: jueves });
    assert.deepStrictEqual([k.conectado, k.principal], ['contacto', true]);
    // El número alterno ya se reconoce como de ese lead.
    assert.strictEqual((await L.leadParaMarcar(db, config, { telefono: '311 555 0002' })).existente, true);
    // Jenny ya tiene dos teléfonos: no se pisa.
    await assert.rejects(L.leadParaMarcar(db, config, { telefono: '311 555 0004', empresa: 'Avalon Pharmaceutical LATAM', contacto: 'Jenny Molina' }), /dos teléfonos/);
    // Empresa en lista negra → no deja crearla.
    await db.query(`INSERT INTO sdr.lista_negra (empresa_norm, nota) VALUES ('vetada', 'competidor')`);
    await assert.rejects(L.leadParaMarcar(db, config, { telefono: '311 555 0005', empresa: 'Vetada S.A.S.' }), /lista negra/);
    // Empresa nueva → se crea como antes.
    const z = await L.leadParaMarcar(db, config, { telefono: '311 555 0006', empresa: 'Zeta Nueva', ahora: jueves });
    assert.deepStrictEqual([z.existente, z.empresa_existente], [false, undefined]);
  });

  db.end();
});

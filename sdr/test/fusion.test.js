// Fusionar dos leads del mismo contacto, contra Postgres real.
const test = require('node:test');
const assert = require('assert');
const url = process.env.SDR_TEST_DATABASE_URL;

test('fusionar leads', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const { registrarToque } = require('../resultados');
  const F = require('../fusion');
  const base = require('../config');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  const lunes = new Date('2026-09-21T14:00:00Z');
  // La misma empresa entró dos veces con otro número y otro correo; y un tercero descartado.
  const csv = 'empresa,contacto,cargo,telefono,email\nAcme S.A.S.,Ana Ruiz,,3001234567,ana@acme.co\nACME,Ana Ruiz,Gerente RRHH,3005550000,\nAcme,Pedro,,3007770000,pedro@acme.co\nOtra,Eva,,3003333333,';
  await importar(db, base, { archivo: 'x.csv', contenido: csv, simular: false, ahora: lunes });
  const id = async tel => (await db.query(`SELECT id FROM sdr.leads WHERE telefono = $1`, [tel])).rows[0].id;
  const a1 = await id('+573001234567'), a2 = await id('+573005550000'), pedro = await id('+573007770000');

  // Toques en los dos: el segundo llegó a conversación.
  await registrarToque(db, base, { leadId: a1, canal: 'llamada', resultado: 'no_contesto', usuario: 'Angie', ahora: lunes });
  await registrarToque(db, base, { leadId: a2, canal: 'llamada', resultado: 'conversacion', usuario: 'Angie', ahora: new Date('2026-09-21T15:00:00Z') });
  await db.query(`INSERT INTO sdr.calls (lead_id, telefono) VALUES ($1, '+573005550000')`, [a2]);

  // Duplicados sugeridos en la ficha: misma empresa normalizada.
  const lead1 = (await db.query(`SELECT * FROM sdr.leads WHERE id = $1`, [a1])).rows[0];
  const misma = await F.mismaEmpresa(db, lead1);
  assert.deepStrictEqual(misma.map(x => x.id).sort((x, y) => x - y), [a2, pedro].sort((x, y) => x - y));

  await assert.rejects(F.fusionarLeads(db, base, { destinoId: a1, origenId: a1 }), /mismo lead/);
  await assert.rejects(F.fusionarLeads(db, base, { destinoId: a1, origenId: 99999 }), /No existe/);

  const llamadasAntes = (await db.query(`SELECT COUNT(*)::int AS n FROM sdr.calls WHERE lead_id IN ($1, $2)`, [a1, a2])).rows[0].n;
  const deA2 = (await db.query(`SELECT COUNT(*)::int AS n FROM sdr.calls WHERE lead_id = $1`, [a2])).rows[0].n;
  const r = await F.fusionarLeads(db, base, { destinoId: a1, origenId: a2, usuario: 'Angie' });
  assert.strictEqual(r.etapa, 'conversacion');                   // manda la etapa más avanzada
  assert.deepStrictEqual([r.movidos.toques, r.movidos.llamadas], [1, deA2]);
  const l = (await db.query(`SELECT * FROM sdr.leads WHERE id = $1`, [a1])).rows[0];
  assert.strictEqual(l.empresa, 'Acme S.A.S.');
  assert.strictEqual(l.cargo, 'Gerente RRHH');                   // dato que le faltaba
  assert.strictEqual(l.email, 'ana@acme.co');
  assert.deepStrictEqual([l.telefono, l.telefono_alt], ['+573001234567', '+573005550000']);
  assert.strictEqual(l.extra.fusiones.length, 1);
  assert.strictEqual(l.extra.fusiones[0].lead, a2);
  assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.leads WHERE id = $1`, [a2])).rows[0].n, 0);
  const toques = (await db.query(`SELECT resultado FROM sdr.touches WHERE lead_id = $1 ORDER BY created_at`, [a1])).rows.map(x => x.resultado);
  assert.deepStrictEqual(toques, ['no_contesto', 'conversacion']);
  assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.calls WHERE lead_id = $1`, [a1])).rows[0].n, llamadasAntes);
  // Una sola secuencia pendiente (la del que mandaba), sin choques de paso.
  const pend = (await db.query(`SELECT paso FROM sdr.tasks WHERE lead_id = $1 AND estado = 'pendiente' AND tipo = 'secuencia' ORDER BY paso`, [a1])).rows;
  assert.ok(pend.length >= 1);
  const pasos = (await db.query(`SELECT paso FROM sdr.tasks WHERE lead_id = $1`, [a1])).rows.map(x => x.paso);
  assert.strictEqual(new Set(pasos).size, pasos.length);

  // Un descartado nunca le gana a uno vivo; el correo que sobra queda en extra.
  await db.query(`UPDATE sdr.leads SET etapa = 'descartado', razon_descarte = 'no_interesa' WHERE id = $1`, [pedro]);
  const r2 = await F.fusionarLeads(db, base, { destinoId: pedro, origenId: a1, usuario: 'Angie' });
  assert.strictEqual(r2.etapa, 'conversacion');
  const p = (await db.query(`SELECT * FROM sdr.leads WHERE id = $1`, [pedro])).rows[0];
  assert.deepStrictEqual([p.etapa, p.razon_descarte, p.email], ['conversacion', null, 'pedro@acme.co']);
  assert.deepStrictEqual(p.extra.correos_extra, ['ana@acme.co']);
  assert.deepStrictEqual(p.extra.telefonos_extra, ['+573005550000']);
  assert.strictEqual(p.extra.fusiones.length, 2);
  await db.end();
});

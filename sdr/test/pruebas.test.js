// Pruebas gratis contra Postgres: de la bandera de Wei (verificacion.ops_*) al embudo de Luisa.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const P = require('../pruebas');
const url = process.env.SDR_TEST_DATABASE_URL;

test('mismaEmpresa cruza nombres de Wei y de Luisa', () => {
  assert.ok(P.mismaEmpresa('alpina', 'alpina'));
  assert.ok(P.mismaEmpresa('alpina productos', 'alpina'));
  assert.ok(!P.mismaEmpresa('alpinista', 'alpina'));
  assert.ok(!P.mismaEmpresa(null, 'alpina'));
});

test('los hitos salen de las columnas o, en los de antes, del historial', () => {
  const h = P.hitos({ prueba_ms: null, quoted_ms: null, created_ms: 1, historial: [
    { a: 'calificado', at: '2026-09-01T00:00:00Z' },
    { a: 'propuesta', tipo: 'prueba', at: '2026-09-02T00:00:00Z' },
    { a: 'propuesta', tipo: 'cotizacion', at: '2026-09-12T00:00:00Z' }] });
  assert.strictEqual(new Date(h.inicio).toISOString().slice(0, 10), '2026-09-02');
  assert.strictEqual(new Date(h.cotizada).toISOString().slice(0, 10), '2026-09-12');
  // Una cotización de ANTES de la prueba no cuenta como paso a cotización.
  const h2 = P.hitos({ prueba_ms: Date.parse('2026-09-10'), quoted_ms: Date.parse('2026-09-05'), historial: [] });
  assert.strictEqual(h2.cotizada, null);
});

test('pruebas: cuáles se convierten, y lo que Wei tiene en prueba', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const Em = require('../embudo');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  process.env.VERIF_SCHEMA = 'verif_pruebas';
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await db.query('DROP SCHEMA IF EXISTS verif_pruebas CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT,
    canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, calificacion_sandler TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  Em._reiniciar();
  const deal = async (company, extra = {}) => (await db.query(
    `INSERT INTO public.deals (company, calificacion_sandler, outcome, canal_adquisicion, data, created_at) VALUES ($1,'Completa','open','referido',$2,'2026-09-01T15:00:00Z') RETURNING id`,
    [company, JSON.stringify(extra.data || {})])).rows[0].id;

  // Sin las tablas de Wei, el embudo y el resumen funcionan igual.
  let t = await Em.tablero(db, base, { ahora: new Date('2026-09-02T15:00:00Z') });
  assert.ok(t.pruebas && t.pruebas.total === 0 && t.pruebas.sin_deal.length === 0);

  const alpina = await deal('Alpina S.A.S.');
  const nutresa = await deal('Nutresa');
  const rappi = await deal('Rappi');
  const quieta = await deal('Quieta Ltda');
  const vieja = await deal('Vieja', { data: { embudoHistorial: [{ a: 'propuesta', tipo: 'prueba', at: '2026-08-01T15:00:00Z' }] } });
  const mover = (id, etapa, at, extra = {}) => Em.mover(db, base, { dealId: id, etapa, usuario: 'Luisa', ahora: new Date(at), ...extra });

  await mover(alpina, 'propuesta', '2026-09-03T15:00:00Z', { tipo: 'prueba' });
  await mover(alpina, 'propuesta', '2026-09-10T15:00:00Z', { tipo: 'cotizacion' });
  await mover(alpina, 'ganado', '2026-09-20T15:00:00Z', { motivo: 'Piloto validó la solución', productos: ['Headhunting'] });
  await mover(nutresa, 'propuesta', '2026-09-05T15:00:00Z', { tipo: 'prueba' });
  await mover(nutresa, 'perdido', '2026-09-15T15:00:00Z', { motivo: 'Precio / presupuesto' });
  await mover(rappi, 'propuesta', '2026-09-25T15:00:00Z', { tipo: 'prueba' });
  await mover(quieta, 'propuesta', '2026-09-01T15:00:00Z', { tipo: 'prueba' });
  await db.query(`UPDATE public.deals SET outcome = 'won', closed_at = '2026-08-20T15:00:00Z', etapa_embudo = 'ganado' WHERE id = $1`, [vieja]);
  // prueba_at no se borra al pasar a cotización ni al ganar.
  assert.ok((await db.query(`SELECT prueba_at FROM public.deals WHERE id = $1`, [alpina])).rows[0].prueba_at);

  // Lo de Wei: una tabla de Operaciones con la bandera, como la crea /verificacion.
  await db.query('CREATE SCHEMA verif_pruebas');
  await db.query(`CREATE TABLE verif_pruebas.ops_procesos (id SERIAL PRIMARY KEY, empresa TEXT, cargo TEXT, etapa TEXT, activado DATE,
    primer_envio DATE, ultimo_envio DATE, fecha_cierre DATE, prueba BOOLEAN DEFAULT FALSE)`);
  await db.query(`INSERT INTO verif_pruebas.ops_procesos (empresa, cargo, etapa, activado, primer_envio, prueba) VALUES
    ('Rappi', 'Data Engineer', 'Terna enviada', '2026-09-24', '2026-09-25', TRUE),
    ('Rappi', 'Backend', 'Reclutamiento', '2026-09-24', NULL, FALSE),
    ('Movizzon', 'QA', 'Reclutamiento', '2026-09-26', NULL, TRUE)`);
  const movizzon = await deal('Movizzon');   // calificado, sin prueba: Luisa no la está siguiendo

  t = await Em.tablero(db, base, { ahora: new Date('2026-09-30T15:00:00Z') });
  const r = t.pruebas;
  assert.strictEqual(r.total, 5);
  const de = id => r.pruebas.find(p => p.deal_id === id);
  assert.strictEqual(de(alpina).estado, 'ganado');
  assert.strictEqual(de(alpina).dias_a_cotizacion, 7);
  assert.strictEqual(de(alpina).dias_a_cliente, 17);
  assert.strictEqual(de(nutresa).estado, 'perdido');
  assert.strictEqual(de(nutresa).llego_a_cotizacion, false);
  assert.strictEqual(de(rappi).estado, 'prueba');
  assert.strictEqual(de(rappi).dias_en_prueba, 5);
  assert.strictEqual(de(rappi).operacion.length, 1, 'solo lo que Wei marcó en prueba');
  assert.strictEqual(de(rappi).operacion[0].estado, 'Terna enviada');
  assert.strictEqual(de(quieta).quieta, true, `${base.EMBUDO.prueba_alerta_dias}+ días sin moverse`);
  assert.strictEqual(de(vieja).estado, 'ganado', 'las de antes de prueba_at salen del historial');
  assert.strictEqual(r.en_prueba, 2);
  assert.strictEqual(r.quietas, 1);
  assert.deepStrictEqual(r.conversion_cerradas, { n: 2, de: 3, pct: 67 });
  assert.strictEqual(r.a_cotizacion.n, 2);   // alpina y vieja (ganada)
  assert.strictEqual(r.pruebas[0].estado, 'prueba', 'las que van, arriba');
  // Wei tiene a Movizzon en prueba y Luisa no: sale aparte, con su deal para pasarlo a prueba.
  assert.strictEqual(r.sin_deal.length, 1);
  assert.strictEqual(r.sin_deal[0].empresa, 'Movizzon');
  assert.strictEqual(r.sin_deal[0].deal.deal_id, movizzon);
  assert.strictEqual(r.sin_deal[0].deal.etapa, 'calificado');
  // La tarjeta del embudo trae lo de Wei y si fue prueba.
  const card = Object.values(t.columnas).flat().find(x => x.deal_id === rappi);
  assert.strictEqual(card.fue_prueba, true);
  assert.strictEqual(card.operacion[0].cargo, 'Data Engineer');

  // ---- El esquema de la prueba: ficha de arranque, números, página y decisión (sdr/ficha_prueba.js).
  const F = require('../ficha_prueba');
  const ahora = new Date('2026-10-20T15:00:00Z');   // martes
  const sinDemo = await deal('Cimpa', { data: { fichaCargos: 'Ingeniero de datos, QA', decisor: 'Gerente general' } });
  await mover(sinDemo, 'propuesta', '2026-10-20T14:00:00Z', { tipo: 'prueba' });
  let f = await F.ficha(db, base, sinDemo, { ahora });
  assert.strictEqual(f.prueba, null);
  assert.strictEqual(f.sugerido.decisor_quien, 'Gerente general');
  assert.match(f.sugerido.criterio, /Ingeniero de datos/);
  await assert.rejects(F.arrancar(db, base, { dealId: sinDemo, ficha: { criterio: 'x' }, usuario: 'Luisa', ahora }), /champion/);
  await assert.rejects(F.arrancar(db, base, { dealId: sinDemo, ficha: { champion_nombre: 'Marian' }, usuario: 'Luisa', ahora }), /criterio/);
  const a = await F.arrancar(db, base, { dealId: sinDemo, usuario: 'Luisa', ahora, env: {}, ficha: {
    champion_nombre: 'Marian Ruiz', champion_cargo: 'Reclutadora', criterio: 'Terna de ingeniero de datos en 5 días hábiles',
    decisor_quien: 'Gerente general', decisor_cuando: 'Presupuesto en noviembre', plata: 'otro_ano', vacante_url: 'https://peaku.co/es/empresas/vacantes/59865', cargo: 'Ingeniero de datos',
  } });
  assert.strictEqual(a.prueba.inicio, '2026-10-20');
  assert.strictEqual(a.prueba.resultados_fecha, '2026-11-03', '10 días hábiles después');
  assert.strictEqual(a.prueba.checkin_fecha, '2026-10-27');
  assert.strictEqual(a.prueba.vacante_id, 59865);
  assert.strictEqual(a.movido, false, 'ya estaba en prueba');
  const comps = (await db.query(`SELECT tipo, titulo, usuario, estado, due_at FROM sdr.tasks WHERE id IN ($1, $2) ORDER BY due_at`, [a.prueba.checkin_compromiso_id, a.prueba.compromiso_id])).rows;
  assert.deepStrictEqual(comps.map(c => [c.tipo, c.usuario, c.estado]), [['seguimiento', 'Luisa', 'pendiente'], ['reunion', 'Luisa', 'pendiente']]);
  assert.match(comps[1].titulo, /Resultados de la prueba · Cimpa/);
  f = await F.ficha(db, base, sinDemo, { ahora: new Date('2026-10-27T15:00:00Z') });
  assert.strictEqual(f.dia, 6);
  assert.strictEqual(f.vencida, false);
  assert.strictEqual((await F.ficha(db, base, sinDemo, { ahora: new Date('2026-11-05T15:00:00Z') })).vencida, true);
  // Volver a arrancar cancela los compromisos anteriores y crea otros.
  const a2 = await F.arrancar(db, base, { dealId: sinDemo, usuario: 'Luisa', ahora: new Date('2026-10-21T15:00:00Z'), env: {}, ficha: { champion_nombre: 'Marian Ruiz', criterio: 'Terna en 5 días' } });
  assert.strictEqual((await db.query(`SELECT estado FROM sdr.tasks WHERE id = $1`, [a.prueba.compromiso_id])).rows[0].estado, 'omitida');
  assert.notStrictEqual(a2.prueba.compromiso_id, a.prueba.compromiso_id);
  // Página: sin números no hay nada que decir.
  const claude = { messages: { create: async ({ system, messages }) => { claude.ultimo = { system, user: messages[0].content }; return { model: 'claude-falso', content: [{ type: 'text', text: 'Se probó Peaku con la vacante de ingeniero de datos. Candidatos presentados: 6. Entrevistados: 3. Siguiente paso: reunión de 20 minutos.' }] }; } } };
  await assert.rejects(F.redactarPagina(db, base, claude, { dealId: sinDemo, usuario: 'Luisa' }), /números/);
  await assert.rejects(F.registrarResultados(db, base, { dealId: sinDemo, numeros: {}, usuario: 'Luisa' }), /al menos un número/);
  const n = await F.registrarResultados(db, base, { dealId: sinDemo, numeros: { presentados: '6', entrevistados: 3, dias_primera_terna: 4, contratados: '', pruebas_usadas: true, comparado_con: 'Magneto', criterio_cumplido: true }, usuario: 'Luisa' });
  assert.deepStrictEqual([n.numeros.presentados, n.numeros.contratados, n.numeros.criterio_cumplido], [6, null, true]);
  const pg = await F.redactarPagina(db, base, claude, { dealId: sinDemo, usuario: 'Luisa' });
  assert.match(pg.pagina.texto, /Candidatos presentados: 6/);
  assert.match(claude.ultimo.system, /REENVÍE a su jefe/);
  assert.match(claude.ultimo.user, /Candidatos presentados: 6/);
  assert.match(claude.ultimo.user, /Gerente general/);
  assert.doesNotMatch(claude.ultimo.user, /TRANSCRIPCIÓN DEL DEMO/, 'este deal no tiene demo');
  // Ajustes de Luisa: a mano, y pidiéndole a Claude cambios sobre la versión anterior.
  const g = await F.guardarPagina(db, base, { dealId: sinDemo, texto: pg.pagina.texto + '\nContacto: Luisa.', usuario: 'Luisa' });
  assert.ok(g.pagina.editada_at && g.pagina.texto.endsWith('Contacto: Luisa.'));
  await F.redactarPagina(db, base, claude, { dealId: sinDemo, usuario: 'Luisa', instrucciones: 'Más corto y sin la parte de Magneto' });
  assert.match(claude.ultimo.user, /VERSIÓN ANTERIOR DE LA PÁGINA/);
  assert.match(claude.ultimo.user, /Más corto y sin la parte de Magneto/);
  // Con demo: la transcripción entra (recortada) para citar al cliente.
  const conDemo = await deal('Enlace Editorial', { data: { transcript: 'EJECUTIVA: hola\nCLIENTE: nos demoramos tres meses llenando una vacante de desarrollador. ' + 'x'.repeat(20000), dolor: 'Se demoran 3 meses por vacante' } });
  await mover(conDemo, 'propuesta', '2026-10-01T14:00:00Z', { tipo: 'prueba' });
  await F.arrancar(db, base, { dealId: conDemo, usuario: 'Luisa', ahora: new Date('2026-10-01T15:00:00Z'), env: {}, ficha: { champion_nombre: 'Angie Pérez', criterio: 'Terna en 5 días' } });
  await F.registrarResultados(db, base, { dealId: conDemo, numeros: { presentados: 5, contratados: 1 }, usuario: 'Luisa' });
  await F.redactarPagina(db, base, { messages: { create: async ({ messages }) => { claude.ultimo = { user: messages[0].content }; return { content: [{ type: 'text', text: 'Página de prueba con más de ochenta caracteres para pasar la validación mínima del texto.' }] }; } } }, { dealId: conDemo, usuario: 'Luisa' });
  assert.match(claude.ultimo.user, /TRANSCRIPCIÓN DEL DEMO/);
  assert.match(claude.ultimo.user, /transcripción recortada/);
  assert.ok(claude.ultimo.user.length < 20000);
  assert.doesNotMatch(claude.ultimo.user, /LLAMADA DE SEGUIMIENTO/);
  // Llamada de seguimiento (después de la prueba): se guarda con los números, entra al prompt como la
  // voz del cliente sobre cómo le fue, y con ella sola ya se puede redactar.
  const seguimiento = 'LUISA: ¿cómo les fue?\nCLIENTE: la terna llegó en cuatro días y entrevistamos a dos; uno ya está en oferta. ' + 'y'.repeat(20000);
  const rs = await F.registrarResultados(db, base, { dealId: conDemo, numeros: { presentados: 5, contratados: 1, transcripcion_seguimiento: seguimiento, seguimiento_fecha: '2026-10-15' }, usuario: 'Luisa' });
  assert.deepStrictEqual([rs.seguimiento.chars, rs.seguimiento.fecha], [seguimiento.length, '2026-10-15']);
  const fs = await F.ficha(db, base, conDemo);
  assert.strictEqual(fs.con_seguimiento, true);
  assert.strictEqual(F.resumenFicha(base, fs.prueba).con_seguimiento, true);
  const claudeFalso = { messages: { create: async ({ system, messages }) => { claude.ultimo = { system, user: messages[0].content }; return { content: [{ type: 'text', text: 'Página de prueba con más de ochenta caracteres para pasar la validación mínima del texto.' }] }; } } };
  const pgs = await F.redactarPagina(db, base, claudeFalso, { dealId: conDemo, usuario: 'Luisa' });
  assert.strictEqual(pgs.pagina.con_seguimiento, true);
  assert.match(claude.ultimo.user, /TRANSCRIPCIÓN DE LA LLAMADA DE SEGUIMIENTO \(DESPUÉS de la prueba, 2026-10-15/);
  assert.match(claude.ultimo.user, /la terna llegó en cuatro días/);
  assert.match(claude.ultimo.system, /DESPUÉS de la prueba, en la llamada de seguimiento/);
  assert.match(claude.ultimo.system, /según nos contó/);
  assert.ok(claude.ultimo.user.length < 36000, 'las dos transcripciones recortadas');
  // Sin números pero con la llamada: se puede redactar. Borrarla (cadena vacía) la quita; sin mandarla, se conserva.
  const soloLlamada = await deal('Solo Llamada', {});
  await mover(soloLlamada, 'propuesta', '2026-10-01T14:00:00Z', { tipo: 'prueba' });
  await F.arrancar(db, base, { dealId: soloLlamada, usuario: 'Luisa', ahora: new Date('2026-10-01T15:00:00Z'), env: {}, ficha: { champion_nombre: 'Pepe', criterio: 'Terna en 5 días' } });
  await assert.rejects(F.redactarPagina(db, base, claudeFalso, { dealId: soloLlamada, usuario: 'Luisa' }), /llamada de seguimiento/);
  await F.registrarResultados(db, base, { dealId: soloLlamada, numeros: { transcripcion_seguimiento: 'CLIENTE: nos sirvió, contratamos a uno.' }, usuario: 'Luisa' });
  await F.redactarPagina(db, base, claudeFalso, { dealId: soloLlamada, usuario: 'Luisa' });
  assert.match(claude.ultimo.user, /contratamos a uno/);
  assert.match(claude.ultimo.user, /\(sin números todavía\)/);
  await F.registrarResultados(db, base, { dealId: soloLlamada, numeros: { presentados: 3 }, usuario: 'Luisa' });
  assert.strictEqual((await F.ficha(db, base, soloLlamada)).con_seguimiento, true, 'sin mandarla se conserva');
  await F.registrarResultados(db, base, { dealId: soloLlamada, numeros: { presentados: 3, transcripcion_seguimiento: '' }, usuario: 'Luisa' });
  assert.strictEqual((await F.ficha(db, base, soloLlamada)).con_seguimiento, false, 'vacía la borra');
  await assert.rejects(F.registrarResultados(db, base, { dealId: soloLlamada, numeros: { transcripcion_seguimiento: '' }, usuario: 'Luisa' }), /al menos un número/);
  // Decisión: "otro año" exige fecha; deja interesado + fecha límite + compromiso de retomar; cierra la reunión de resultados.
  await assert.rejects(F.decidir(db, base, { dealId: conDemo, tipo: 'otro_ano', usuario: 'Luisa' }), /fecha/);
  await assert.rejects(F.decidir(db, base, { dealId: conDemo, tipo: 'nada', usuario: 'Luisa' }), /Elige la decisión/);
  const dz = await F.decidir(db, base, { dealId: conDemo, tipo: 'otro_ano', fecha: '2027-01', championTraeJefe: true, nota: 'Comité de presupuesto', usuario: 'Luisa', ahora: new Date('2026-10-20T15:00:00Z'), env: {} });
  const fila = (await db.query(`SELECT etapa_embudo, data->>'fechaLimiteDecision' AS fl, data->'prueba' AS p FROM public.deals WHERE id = $1`, [conDemo])).rows[0];
  assert.strictEqual(fila.etapa_embudo, 'interesado');
  assert.strictEqual(fila.fl, '2027-01-01');
  assert.strictEqual(fila.p.champion_trae_jefe, true);
  assert.strictEqual(fila.p.decision.tipo, 'otro_ano');
  const ret = (await db.query(`SELECT titulo, due_at, estado FROM sdr.tasks WHERE id = $1`, [dz.compromiso_id])).rows[0];
  assert.match(ret.titulo, /Retomar Enlace Editorial/);
  assert.strictEqual(new Date(ret.due_at).toISOString().slice(0, 10), '2026-12-25');
  assert.strictEqual((await db.query(`SELECT estado FROM sdr.tasks WHERE id = $1`, [fila.p.compromiso_id])).rows[0].estado, 'hecha');
  // Consumo cierra como ganado con producto (por defecto SaaS); "no" cierra como perdido con el motivo de la prueba.
  await F.decidir(db, base, { dealId: sinDemo, tipo: 'consumo', productos: ['Headhunting'], championTraeJefe: false, usuario: 'Luisa', ahora, env: {} });
  const g2 = (await db.query(`SELECT outcome, outcome_reason, productos FROM public.deals WHERE id = $1`, [sinDemo])).rows[0];
  assert.deepStrictEqual([g2.outcome, g2.productos], ['won', 'Headhunting']);
  assert.match(g2.outcome_reason, /Por consumo/);
  const noVa = await deal('Aurofarma');
  await mover(noVa, 'propuesta', '2026-10-01T14:00:00Z', { tipo: 'prueba' });
  await F.arrancar(db, base, { dealId: noVa, usuario: 'Luisa', ahora: new Date('2026-10-01T15:00:00Z'), env: {}, ficha: { champion_nombre: 'X', criterio: 'y', fuera_de_alcance: true } });
  await F.decidir(db, base, { dealId: noVa, tipo: 'no', nota: 'Perfiles fuera de alcance', usuario: 'Luisa', ahora, env: {} });
  assert.strictEqual((await db.query(`SELECT outcome FROM public.deals WHERE id = $1`, [noVa])).rows[0].outcome, 'lost');
  // Arrancar la ficha de un deal que ya avanzó (interesado) o se cerró no lo devuelve a prueba ni lo reabre.
  const avanzado = await deal('Kenner');
  await mover(avanzado, 'propuesta', '2026-09-10T14:00:00Z', { tipo: 'prueba' }); await mover(avanzado, 'interesado', '2026-10-01T14:00:00Z');
  const av = await F.arrancar(db, base, { dealId: avanzado, usuario: 'Luisa', ahora, env: {}, ficha: { champion_nombre: 'Por confirmar', criterio: 'c', nota: 'El gerente estaba en China', inicio: '2026-09-10' } });
  assert.strictEqual(av.movido, false);
  assert.strictEqual((await db.query(`SELECT etapa_embudo FROM public.deals WHERE id = $1`, [avanzado])).rows[0].etapa_embudo, 'interesado');
  assert.strictEqual(av.prueba.nota, 'El gerente estaba en China');
  assert.strictEqual(av.prueba.compromiso_id, null, 'prueba pasada: sin compromisos vencidos en el calendario');
  assert.ok(av.avisos.some(a => /ya pasó/.test(a)));
  const perdidoYa = await deal('Auro');
  await mover(perdidoYa, 'perdido', '2026-10-01T14:00:00Z', { motivo: 'Lead sin valor (no calificaba)' });
  await F.arrancar(db, base, { dealId: perdidoYa, usuario: 'Luisa', ahora, env: {}, ficha: { champion_nombre: 'x', criterio: 'y', fuera_de_alcance: true, inicio: '2026-09-01' } });
  const pz = (await db.query(`SELECT outcome, prueba_at FROM public.deals WHERE id = $1`, [perdidoYa])).rows[0];
  assert.strictEqual(pz.outcome, 'lost'); assert.ok(pz.prueba_at, 'queda anotado que fue prueba');
  const dn = await F.decidir(db, base, { dealId: perdidoYa, tipo: 'no', nota: 'Perfiles fuera de alcance', usuario: 'Luisa', ahora, env: {} });
  assert.ok(dn.avisos.some(a => /Ya estaba perdido/.test(a)));
  assert.strictEqual((await db.query(`SELECT outcome_reason FROM public.deals WHERE id = $1`, [perdidoYa])).rows[0].outcome_reason, 'Lead sin valor (no calificaba)', 'el motivo original se respeta');

  // El resumen de pruebas trae el esquema: con ficha, decididas, champions que trajeron al jefe, por decisión.
  t = await Em.tablero(db, base, { ahora });
  const es = t.pruebas.esquema;
  assert.strictEqual(es.con_ficha, 6, 'incluye "Solo Llamada" (ficha con llamada de seguimiento, sin decisión)');
  assert.deepStrictEqual(es.con_decision, { n: 4, de: 6, pct: 67 });
  assert.deepStrictEqual(es.champion_trajo_jefe, { n: 1, de: 2, pct: 50 });
  assert.deepStrictEqual(es.por_decision, { otro_ano: 1, consumo: 1, no: 2 });
  assert.strictEqual(es.sin_ficha, 2, 'rappi y quieta siguen en prueba sin ficha');
  const cardCimpa = Object.values(t.columnas).flat().find(x => x.deal_id === sinDemo);
  assert.strictEqual(cardCimpa.prueba.champion, 'Marian Ruiz');
  assert.strictEqual(cardCimpa.prueba.decision.tipo, 'consumo');

  await db.query('DROP SCHEMA IF EXISTS verif_pruebas CASCADE');
  delete process.env.VERIF_SCHEMA;
  await db.end();
});

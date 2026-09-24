// Compromisos y Google Calendar: unidad (JWT, evento, token con fetch falso) y flujo contra Postgres.
const test = require('node:test');
const assert = require('assert');
const crypto = require('crypto');
const base = require('../config');
const cal = require('../calendario');
const url = process.env.SDR_TEST_DATABASE_URL;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const llave = { client_email: 'sdr@peaku-sdr.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const ENV = { GOOGLE_CALENDAR_KEY: JSON.stringify(llave), PUBLIC_URL: 'https://x' };

// Google falso: token + eventos en memoria.
function googleFalso() {
  const eventos = new Map(); let n = 0; const llamadas = [];
  const fetchFn = async (u, o = {}) => {
    llamadas.push([o.method || 'GET', u]);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (u.includes('oauth2')) return json(200, { access_token: 'tok', expires_in: 3600 });
    const m = /\/calendars\/primary\/events(?:\/([^?]+))?/.exec(u);
    if (o.method === 'POST') { const id = 'ev' + (++n); eventos.set(id, JSON.parse(o.body)); return json(200, { id, htmlLink: 'https://cal/' + id }); }
    if (o.method === 'PATCH') { if (!eventos.has(m[1])) return json(404, { error: { message: 'Not Found' } }); eventos.set(m[1], { ...eventos.get(m[1]), ...JSON.parse(o.body) }); return json(200, { id: m[1] }); }
    if (o.method === 'DELETE') { if (!eventos.has(m[1])) return json(404, { error: { message: 'Not Found' } }); eventos.delete(m[1]); return { ok: true, status: 204 }; }
    return json(200, {});
  };
  return { fetchFn, eventos, llamadas };
}

test('calendario: llave, correo por usuario y JWT firmado como el usuario', () => {
  assert.strictEqual(cal.leerLlave({}), null);
  assert.throws(() => cal.leerLlave({ GOOGLE_CALENDAR_KEY: '{no json' }), /JSON/);
  assert.strictEqual(cal.emailDe(base, 'angie'), 'angie@peaku.co');
  assert.strictEqual(cal.emailDe(base, 'Santiago'), null);
  const t = cal.jwt(llave, 'angie@peaku.co', 1000);
  const [cab, cuerpo, firma] = t.split('.');
  const p = JSON.parse(Buffer.from(cuerpo, 'base64url').toString());
  assert.strictEqual(p.sub, 'angie@peaku.co'); assert.strictEqual(p.iss, llave.client_email); assert.strictEqual(p.scope, cal.SCOPE); assert.strictEqual(p.exp, 4600);
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${cab}.${cuerpo}`), publicKey, Buffer.from(firma, 'base64url')));
});

test('calendario: evento con hora, sin hora, invitados y enlace al lead', () => {
  const t = { id: 7, tipo: 'seguimiento', titulo: 'Llamar por la propuesta', nota: 'pidió precios', due_at: '2026-09-23T20:00:00.000Z', con_hora: true };
  const ev = cal.eventoDe(base, t, { id: 3, empresa: 'ACME', contacto: 'Ana', telefono: '+573001234567' }, { publicUrl: 'https://x' });
  assert.strictEqual(ev.summary, 'SDR · Llamar por la propuesta · ACME (Ana)');
  assert.strictEqual(ev.start.dateTime, '2026-09-23T20:00:00.000Z');
  assert.strictEqual(ev.end.dateTime, '2026-09-23T20:15:00.000Z');
  assert.match(ev.description, /https:\/\/x\/sdr\/#\/lead\/3/);
  assert.strictEqual(ev.reminders.overrides[0].minutes, 10);
  const dia = cal.eventoDe(base, { ...t, con_hora: false, due_at: '2026-09-23T13:00:00.000Z', invitados: ['angie@peaku.co'] }, null);
  assert.deepStrictEqual(dia.start, { date: '2026-09-23' }); assert.deepStrictEqual(dia.end, { date: '2026-09-24' });
  assert.deepStrictEqual(dia.attendees, [{ email: 'angie@peaku.co' }]);
});

test('calendario: token con caché, errores de delegación legibles, probar crea y borra', async () => {
  const g = googleFalso();
  cal._tokens.clear();
  assert.strictEqual(await cal.token(ENV, 'angie@peaku.co', { fetchFn: g.fetchFn }), 'tok');
  assert.strictEqual(await cal.token(ENV, 'angie@peaku.co', { fetchFn: g.fetchFn }), 'tok');
  assert.strictEqual(g.llamadas.filter(x => x[1].includes('oauth2')).length, 1);
  const malo = async () => ({ ok: false, status: 401, json: async () => ({ error: 'unauthorized_client', error_description: 'Client is unauthorized' }) });
  cal._tokens.clear();
  await assert.rejects(cal.token(ENV, 'x@peaku.co', { fetchFn: malo }), /delegación de dominio/);
  await assert.rejects(cal.probar({}, base, 'Angie'), /GOOGLE_CALENDAR_KEY_FILE/);
  await assert.rejects(cal.probar(ENV, base, 'Santiago'), /no tiene correo/);
  cal._tokens.clear();
  const r = await cal.probar(ENV, base, 'Angie', { fetchFn: g.fetchFn });
  assert.strictEqual(r.calendario, 'angie@peaku.co');
  assert.strictEqual(g.eventos.size, 0);
  assert.ok(g.llamadas.some(x => x[0] === 'POST' && x[1].includes('/events')) && g.llamadas.some(x => x[0] === 'DELETE'));
});

test('compromisos contra la base', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async (t) => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { registrarToque, registrarEjecutiva } = require('../resultados');
  const { consultarCola } = require('../cola');
  const C = require('../compromisos');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, segment TEXT, has_ats BOOLEAN, data JSONB NOT NULL, linea_negocio TEXT, canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
  await db.query(`INSERT INTO sdr.leads (empresa, contacto, telefono) VALUES ('ACME', 'Ana', '+573001234567'), ('Beta', 'Luis', '+573002222222')`);
  const id = async e => (await db.query(`SELECT id FROM sdr.leads WHERE empresa=$1`, [e])).rows[0].id;
  const lunes = new Date('2026-09-21T14:00:00Z');
  const g = googleFalso();
  cal._tokens.clear();
  const opts = { fetchFn: g.fetchFn };

  await t.test('crear: con hora y sin hora; sin llave no toca Google; con llave crea el evento', async () => {
    const a = await C.crear(db, base, {}, { leadId: await id('ACME'), tipo: 'seguimiento', titulo: 'Llamar por propuesta', fecha: '2026-09-21', hora: '15:00', usuario: 'Angie' });
    assert.strictEqual(a.con_hora, true);
    assert.strictEqual(new Date(a.due_at).toISOString(), '2026-09-21T20:00:00.000Z');
    assert.strictEqual(a.calendario.omitido, 'sin llave');
    const b = await C.crear(db, base, ENV, { leadId: null, tipo: 'otro', titulo: 'Preparar lista de eventos', fecha: '2026-09-22', usuario: 'Angie' }, opts);
    assert.strictEqual(b.con_hora, false); assert.strictEqual(b.lead_id, null);
    assert.strictEqual(b.calendario.ok, true);
    assert.strictEqual(g.eventos.size, 1);
    assert.match([...g.eventos.values()][0].summary, /Preparar lista/);
    await assert.rejects(C.crear(db, base, {}, { tipo: 'nada', fecha: '2026-09-22' }), /Tipo de compromiso/);
    await assert.rejects(C.crear(db, base, {}, { tipo: 'otro', fecha: '22/09' }), /YYYY-MM-DD/);
    await assert.rejects(C.crear(db, base, {}, { tipo: 'otro', fecha: '2026-09-22', hora: '3pm' }), /HH:MM/);
    await assert.rejects(C.crear(db, base, {}, { tipo: 'otro', fecha: '2026-09-22', leadId: 999 }), /no encontrado/);
    // Sin correo (Santiago) queda en la app pero no en el calendario
    const c = await C.crear(db, base, ENV, { tipo: 'otro', titulo: 'x', fecha: '2026-09-22', usuario: 'Santiago' }, opts);
    assert.strictEqual(c.calendario.omitido, 'dueño sin correo');
  });

  await t.test('listar: hoy (con vencidos por hora) y próximos, por usuario; la cola los trae', async () => {
    const l = await C.listar(db, base, { usuario: 'Angie', ahora: new Date('2026-09-21T21:00:00Z') }); // 16:00 Bogotá
    assert.strictEqual(l.hoy.length, 1); assert.strictEqual(l.hoy[0].hora, '15:00'); assert.strictEqual(l.hoy[0].vencido, true);
    assert.strictEqual(l.proximos.length, 1); assert.strictEqual(l.proximos[0].fecha, '2026-09-22');
    const todos = await C.listar(db, base, { ahora: new Date('2026-09-21T21:00:00Z') });
    assert.strictEqual(todos.proximos.length, 2);
    const cola = await consultarCola(db, base, { ahora: new Date('2026-09-21T21:00:00Z'), usuario: 'Angie' });
    assert.strictEqual(cola.compromisos.hoy.length, 1);
    assert.strictEqual(cola.indicadores.compromisosVencidos, 1);
    assert.strictEqual(cola.tareas.length, 0); // los compromisos no son toques de secuencia
  });

  await t.test('mover y hecha sincronizan; posponer por días conserva la hora', async () => {
    const b = (await C.listar(db, base, { usuario: 'Angie', ahora: lunes })).proximos[0];
    const m = await C.mover(db, base, ENV, b.id, { fecha: '2026-09-24', hora: '10:30' }, opts);
    assert.strictEqual(m.con_hora, true); assert.strictEqual(m.calendario.ok, true);
    assert.strictEqual(g.eventos.get(b.gcal_event_id).start.dateTime, '2026-09-24T15:30:00.000Z');
    const h = await C.hecha(db, base, ENV, b.id, {}, opts);
    assert.strictEqual(h.estado, 'hecha'); assert.strictEqual(g.eventos.size, 0);
    const des = await C.hecha(db, base, ENV, b.id, { deshacer: true }, opts);
    assert.strictEqual(des.estado, 'pendiente'); assert.strictEqual(g.eventos.size, 1);
    const a = (await C.listar(db, base, { usuario: 'Angie', ahora: lunes })).hoy[0];
    const d = await C.mover(db, base, {}, a.id, { dias: 2 });
    assert.strictEqual(d.con_hora, true);
    assert.strictEqual(require('../tiempo').horaBogota(new Date(d.due_at)), '15:00');
    await assert.rejects(C.mover(db, base, {}, a.id, { dias: 500 }), /entre 1 y 90/);
    // Google falla → la tarea queda y el error se guarda
    const roto = { fetchFn: async (u, o) => u.includes('oauth2') ? g.fetchFn(u, o) : ({ ok: false, status: 500, json: async () => ({ error: { message: 'boom' } }) }) };
    const e = await C.mover(db, base, ENV, b.id, { dias: 1 }, roto);
    assert.strictEqual(e.calendario.ok, false); assert.match(e.calendario.error, /boom/);
    assert.match((await C.leer(db, b.id)).gcal_error, /boom/);
  });

  await t.test('reunión agendada crea el compromiso de la ejecutiva con Angie invitada; realizada lo cierra', async () => {
    const r = await registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'reunion_agendada', usuario: 'Angie', ahora: lunes, env: ENV,
      detalle: { reunion_at: '2026-09-25T15:00:00.000Z', ejecutiva: 'Luisa', ficha_cargos: '2 devs' } });
    assert.ok(r.compromiso_id);
    assert.match(r.avisos.join(' '), /compromiso de Luisa/);
    const c = await C.leer(db, r.compromiso_id);
    assert.strictEqual(c.tipo, 'reunion'); assert.strictEqual(c.usuario, 'Luisa'); assert.strictEqual(c.con_hora, true);
    assert.match(c.nota, /2 devs/);
    // El fetch de Google no está inyectado en registrarToque: usa el global. Sin red aquí → error guardado, tarea intacta.
    assert.ok(c.gcal_error || c.gcal_event_id);
    const luisa = await C.listar(db, base, { usuario: 'Luisa', ahora: lunes });
    assert.strictEqual(luisa.proximos.length, 1);
    await registrarEjecutiva(db, base, { leadId: await id('Beta'), accion: 'reunion_realizada', usuario: 'Luisa', env: ENV });
    assert.strictEqual((await db.query(`SELECT estado FROM sdr.tasks WHERE id=$1`, [c.id])).rows[0].estado, 'hecha');
  });

  await t.test('reintentarPendientes sube los que quedaron sin evento', async () => {
    const x = await C.crear(db, base, {}, { leadId: await id('ACME'), tipo: 'enviar', titulo: 'Caso de éxito', fecha: new Date(Date.now() + 86400000).toISOString().slice(0, 10), usuario: 'Angie' });
    assert.strictEqual(x.calendario.omitido, 'sin llave');
    assert.strictEqual((await C.reintentarPendientes(db, base, {})).omitido, 'sin llave');
    const antes = g.eventos.size;
    const r = await C.reintentarPendientes(db, base, ENV, opts);
    assert.ok(r.ok >= 1);
    assert.ok(g.eventos.size > antes);
    assert.ok((await C.leer(db, x.id)).gcal_event_id);
  });

  await t.test('hecha con toque: el seguimiento cumplido cuenta como llamada y no consume la secuencia', async () => {
    await db.query(`INSERT INTO sdr.leads (empresa, contacto, telefono) VALUES ('Gama', 'Gus', '+573003333333')`);
    const gama = await id('Gama');
    const ritmo = require('../ritmo');
    // Secuencia pendiente del lead (como si viniera de una carga) y un seguimiento pactado con hora.
    await db.query(`INSERT INTO sdr.tasks (lead_id, paso, canal, due_at, tipo) VALUES ($1, 1, 'llamada', $2, 'secuencia')`, [gama, lunes.toISOString()]);
    const seg = await C.crear(db, base, {}, { leadId: gama, tipo: 'seguimiento', titulo: 'Volver a llamar', fecha: '2026-09-21', hora: '10:00', usuario: 'Angie' });
    const antes = (await ritmo.actividadPorDia(db, '2026-09-21', '2026-09-21', base, 'Angie'))[0];
    const r = await registrarToque(db, base, { leadId: gama, canal: 'llamada', resultado: 'no_contesto', compromisoId: seg.id, usuario: 'Angie', ahora: lunes, env: {} });
    const despues = (await ritmo.actividadPorDia(db, '2026-09-21', '2026-09-21', base, 'Angie'))[0];
    assert.strictEqual(despues.marcaciones, antes.marcaciones + 1);
    assert.strictEqual(r.compromiso_hecho, seg.id);
    const tareas = (await db.query(`SELECT id, tipo, estado FROM sdr.tasks WHERE lead_id=$1 ORDER BY id`, [gama])).rows;
    assert.strictEqual(tareas.find(x => x.id === seg.id).estado, 'hecha');
    assert.strictEqual(tareas.find(x => x.tipo === 'secuencia').estado, 'pendiente'); // la secuencia sigue
    assert.ok(r.proxima && r.proxima.canal === 'llamada');
    const toque = (await db.query(`SELECT task_id, canal, call_id FROM sdr.touches WHERE lead_id=$1 ORDER BY id DESC LIMIT 1`, [gama])).rows[0];
    assert.strictEqual(toque.task_id, seg.id); assert.ok(toque.call_id);
    // Por WhatsApp: toque de un clic que cierra el compromiso. Repetirlo ya no está pendiente.
    const wa = await C.crear(db, base, {}, { leadId: gama, tipo: 'enviar', canal: 'whatsapp', titulo: 'Mandar brochure', fecha: '2026-09-21', usuario: 'Angie' });
    const w = await registrarToque(db, base, { leadId: gama, canal: 'whatsapp', compromisoId: wa.id, usuario: 'Angie', ahora: lunes, env: {} });
    assert.strictEqual(w.compromiso_hecho, wa.id);
    assert.strictEqual((await ritmo.actividadPorDia(db, '2026-09-21', '2026-09-21', base, 'Angie'))[0].whatsapp, despues.whatsapp + 1);
    await assert.rejects(registrarToque(db, base, { leadId: gama, canal: 'whatsapp', compromisoId: wa.id, usuario: 'Angie', ahora: lunes, env: {} }), /ya no está pendiente/);
  });

  await t.test('descartar omite también los compromisos del lead', async () => {
    const x = await C.crear(db, base, {}, { leadId: await id('ACME'), tipo: 'enviar', titulo: 'Propuesta', fecha: '2026-09-23', usuario: 'Angie' });
    await registrarEjecutiva(db, base, { leadId: await id('ACME'), accion: 'descartado', razon: 'no_interesa', reintentoMeses: 0, usuario: 'Angie', env: {} });
    assert.strictEqual((await db.query(`SELECT estado FROM sdr.tasks WHERE id=$1`, [x.id])).rows[0].estado, 'omitida');
    const l = await C.listar(db, base, { usuario: 'Angie', ahora: lunes });
    assert.ok(![...l.hoy, ...l.proximos].some(t => t.lead_id === x.lead_id));
  });

  await db.end();
});

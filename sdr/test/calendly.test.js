// Calendly: link con UTM, hora desde la API, reservas hechas desde el link y cancelaciones (API falsa).
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const CAL = require('../calendly');
const url = process.env.SDR_TEST_DATABASE_URL;
const ENV = { CALENDLY_TOKEN: 'tok' };

// Calendly falso: /users/me, listas de reservas por estado, reservas e invitados por URI.
function calendlyFalso() {
  const ev = {}, inv = {}, llamadas = [];
  const agregar = (id, { inicio, status = 'active', email, name, tracking = {}, motivo }) => {
    const uri = `https://api.calendly.com/scheduled_events/${id}`;
    ev[uri] = { uri, name: 'Demo 45 min', status, start_time: inicio, end_time: inicio, location: { join_url: 'https://meet/x' }, ...(motivo ? { cancellation: { reason: motivo } } : {}) };
    inv[uri] = { uri: `${uri}/invitees/i${id}`, email, name, status: 'active', tracking };
    return uri;
  };
  const fetchFn = async (u, o) => {
    llamadas.push(u);
    assert.strictEqual(o.headers.Authorization, 'Bearer tok');
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (u.endsWith('/users/me')) return json(200, { resource: { uri: 'https://api.calendly.com/users/luisa' } });
    if (u.includes('/scheduled_events?')) {
      const st = new URL(u).searchParams.get('status');
      return json(200, { collection: Object.values(ev).filter(e => e.status === st), pagination: {} });
    }
    const m = /^(https:\/\/api\.calendly\.com\/scheduled_events\/[^/?]+)(\/invitees(?:\/[^?]+)?)?/.exec(u);
    if (m && !m[2]) return ev[m[1]] ? json(200, { resource: ev[m[1]] }) : json(404, { message: 'no' });
    if (m && m[2] && m[2].startsWith('/invitees/')) return json(200, { resource: inv[m[1]] });
    if (m && m[2]) return json(200, { collection: [inv[m[1]]] });
    return json(404, { message: 'ruta desconocida ' + u });
  };
  return { fetchFn, agregar, ev, llamadas };
}

test('calendly: link marcado y lead desde el tracking', () => {
  const l = CAL.enlace(base, { lead: { id: 7, contacto: 'Ana Pérez', email: 'ana@x.co' }, canal: 'whatsapp', usuario: 'Angie' });
  const u = new URL(l);
  assert.strictEqual(u.origin + u.pathname, 'https://calendly.com/luisa-ztw/45min');
  assert.deepStrictEqual(Object.fromEntries(u.searchParams), { name: 'Ana Pérez', email: 'ana@x.co', utm_source: 'peaku-sdr', utm_medium: 'whatsapp', utm_content: 'lead-7', utm_term: 'Angie' });
  const e = new URL(CAL.enlace(base, { lead: { id: 7 }, canal: 'llamada', embebido: true, dominio: 'peaku-sandler.onrender.com' }));
  assert.strictEqual(e.searchParams.get('embed_domain'), 'peaku-sandler.onrender.com');
  assert.strictEqual(e.searchParams.get('embed_type'), 'Inline');
  assert.strictEqual(CAL.leadDeTracking({ utm_content: 'lead-42' }), 42);
  assert.strictEqual(CAL.leadDeTracking({ utm_content: 'otra-cosa' }), null);
  assert.strictEqual(CAL.enlace({ ...base, CALENDLY: null }, {}), null);
});

test('calendly: la hora sale de Calendly con token; sin token se exige a mano', async () => {
  const k = calendlyFalso();
  const uri = k.agregar('E1', { inicio: '2026-09-30T15:00:00.000Z', email: 'a@x.co', name: 'A' });
  const r = await CAL.prepararDetalle(ENV, { reunion_at: '2026-01-01T00:00:00Z', calendly: { event_uri: uri, invitee_uri: `${uri}/invitees/iE1` } }, { fetchFn: k.fetchFn });
  assert.strictEqual(r.detalle.reunion_at, '2026-09-30T15:00:00.000Z');
  assert.strictEqual(r.evento.email, 'a@x.co');
  await assert.rejects(CAL.prepararDetalle({}, { calendly: { event_uri: uri } }), /día y la hora/);
  const sin = await CAL.prepararDetalle({}, { reunion_at: '2026-09-30T15:00:00Z', calendly: { event_uri: uri } });
  assert.strictEqual(sin.evento.inicio, '2026-09-30T15:00:00Z');
  assert.deepStrictEqual(await CAL.prepararDetalle(ENV, { reunion_at: 'x' }), { detalle: { reunion_at: 'x' }, evento: null });
  await assert.rejects(CAL.prepararDetalle(ENV, { calendly: { event_uri: 'https://evil.com/x' } }, { fetchFn: k.fetchFn }), /inválida/);
});

test('calendly contra la base: reservas desde el link, sin lead, reagendadas y canceladas', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT, canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, calificacion_sandler TEXT)`);
  const lead = async (empresa, email, etapa = 'contactado') => (await db.query(`INSERT INTO sdr.leads (empresa, contacto, email, etapa) VALUES ($1, 'X', $2, $3) RETURNING id`, [empresa, email, etapa])).rows[0].id;
  const a = await lead('Por link', null);
  const b = await lead('Por correo', 'b@empresa.co');
  const ahora = new Date('2026-09-24T15:00:00Z');
  const k = calendlyFalso();
  k.agregar('A', { inicio: '2026-09-29T15:00:00.000Z', email: 'otra@gmail.com', name: 'Ana', tracking: { utm_source: 'peaku-sdr', utm_medium: 'correo', utm_content: `lead-${a}`, utm_term: 'Angie' } });
  k.agregar('B', { inicio: '2026-09-30T16:00:00.000Z', email: 'B@empresa.co', name: 'Beto' });           // sin UTM: por correo
  k.agregar('C', { inicio: '2026-10-01T16:00:00.000Z', email: 'nadie@x.co', name: 'Nadie' });            // ningún lead
  const log = { log() {}, error() {} };

  const r1 = await CAL.sincronizar(db, base, ENV, { ahora, fetchFn: k.fetchFn, log });
  assert.deepStrictEqual({ ...r1, errores: r1.errores.length }, { nuevas: 2, sin_lead: 1, movidas: 0, canceladas: 0, errores: 0 });
  const toque = async id => (await db.query(`SELECT canal, resultado, usuario, detalle FROM sdr.touches WHERE lead_id = $1 ORDER BY id DESC LIMIT 1`, [id])).rows[0];
  const ta = await toque(a);
  assert.deepStrictEqual([ta.canal, ta.resultado, ta.usuario], ['correo', 'reunion_agendada', 'Angie']);
  assert.strictEqual(ta.detalle.origen, 'calendly');
  assert.strictEqual((await toque(b)).canal, 'whatsapp');       // canal_por_defecto
  const la = (await db.query(`SELECT etapa, reunion_at, deal_id FROM sdr.leads WHERE id = $1`, [a])).rows[0];
  assert.strictEqual(la.etapa, 'reunion_agendada');
  assert.strictEqual(new Date(la.reunion_at).toISOString(), '2026-09-29T15:00:00.000Z');
  assert.ok(la.deal_id);
  // El compromiso de reunión de Luisa queda en la app, sin segundo evento en Google (lo creó Calendly).
  const reu = (await db.query(`SELECT id, gcal_event_id FROM sdr.tasks WHERE lead_id = $1 AND tipo = 'reunion'`, [a])).rows[0];
  assert.strictEqual(reu.gcal_event_id, 'calendly');
  let llamoGoogle = false;
  const C = require('../compromisos');
  const g = await C.sincronizar(db, base, { GOOGLE_CALENDAR_KEY: '{}' }, reu.id, 'mover', { fetchFn: async () => { llamoGoogle = true; return { ok: true, json: async () => ({}) }; } });
  assert.deepStrictEqual([g.ok, g.omitido, llamoGoogle], [true, 'el evento lo creó Calendly', false]);
  assert.strictEqual((await C.reintentarPendientes(db, base, {})).omitido, 'sin llave');
  // Segunda pasada: nada nuevo (ya están en la tabla).
  const r2 = await CAL.sincronizar(db, base, ENV, { ahora, fetchFn: k.fetchFn, log });
  assert.deepStrictEqual([r2.nuevas, r2.sin_lead, r2.canceladas], [0, 0, 0]);
  // Reagendó (nueva reserva del mismo lead): se mueve la hora, no se duplica.
  k.agregar('A2', { inicio: '2026-10-02T15:00:00.000Z', email: 'otra@gmail.com', tracking: { utm_content: `lead-${a}` } });
  k.ev['https://api.calendly.com/scheduled_events/A'].status = 'canceled';
  const r3 = await CAL.sincronizar(db, base, ENV, { ahora, fetchFn: k.fetchFn, log });
  assert.strictEqual(r3.movidas, 1);
  assert.strictEqual(r3.canceladas, 1);       // la vieja se marca cancelada, pero NO devuelve el lead (ya hay otra)
  assert.strictEqual((await db.query(`SELECT etapa FROM sdr.leads WHERE id = $1`, [a])).rows[0].etapa, 'reunion_agendada');
  // B cancela su única reunión: vuelve a la SDR con llamada programada y la comisión la ve cancelada.
  k.ev['https://api.calendly.com/scheduled_events/B'].status = 'canceled';
  k.ev['https://api.calendly.com/scheduled_events/B'].cancellation = { reason: 'Se me cruzó' };
  const r4 = await CAL.sincronizar(db, base, ENV, { ahora, fetchFn: k.fetchFn, log });
  assert.strictEqual(r4.canceladas, 1);
  const lb = (await db.query(`SELECT etapa, reunion_at FROM sdr.leads WHERE id = $1`, [b])).rows[0];
  assert.deepStrictEqual([lb.etapa, lb.reunion_at], ['conversacion', null]);
  const tb = await toque(b);
  assert.strictEqual(tb.resultado, 'reunion_cancelada');
  assert.match((await db.query(`SELECT nota FROM sdr.touches WHERE lead_id = $1 AND resultado = 'reunion_cancelada'`, [b])).rows[0].nota, /Se me cruzó/);
  assert.strictEqual((await db.query(`SELECT COUNT(*)::int AS n FROM sdr.tasks WHERE lead_id = $1 AND estado = 'pendiente' AND canal = 'llamada'`, [b])).rows[0].n, 1);
  const com = await require('../comision').resumenMes(db, base, { mes: '2026-09', usuario: 'Angie', ahora });
  assert.strictEqual(com.reuniones.find(x => x.lead_id === b).estado, 'cancelada');
  const est = await CAL.estado(db, base, ENV);
  assert.strictEqual(est.sin_lead.length, 1);
  // Sin token no hace nada.
  assert.deepStrictEqual(await CAL.sincronizar(db, base, {}), { omitido: 'sin CALENDLY_TOKEN' });
  await db.end();
});

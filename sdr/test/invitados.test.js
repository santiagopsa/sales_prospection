// Invitados de la reunión: Calendly dice quién reservó y qué respondió; Google Calendar (calendario de
// la ejecutiva, donde Calendly creó el evento) dice quién está invitado y si aceptó. API falsas.
const test = require('node:test');
const assert = require('assert');
const crypto = require('crypto');
const base = require('../config');
const CAL = require('../calendly');
const cal = require('../calendario');
const url = process.env.SDR_TEST_DATABASE_URL;

const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const llave = { client_email: 'sdr@peaku-sdr.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), token_uri: 'https://oauth2.googleapis.com/token' };
const ENV = { CALENDLY_TOKEN: 'tok', GOOGLE_CALENDAR_KEY: JSON.stringify(llave) };
const INICIO = '2026-10-02T15:00:00.000Z';

// Calendly + Google falsos en un solo fetch. `google` guarda los eventos por calendario (sub del JWT).
function falso() {
  const ev = {}, inv = {}, google = { 'luisa@peaku.co': [], 'angie@peaku.co': [] }, llamadas = [], patches = [];
  const agregar = (id, { inicio = INICIO, email, name, respuestas = [], guests = [], status = 'active' }) => {
    const uri = `https://api.calendly.com/scheduled_events/${id}`;
    ev[uri] = { uri, name: 'Conoce Peaku!', status, start_time: inicio, end_time: inicio, location: { join_url: 'https://meet/x' }, event_guests: guests.map(e => ({ email: e })) };
    inv[uri] = [{ uri: `${uri}/invitees/i${id}`, email, name, status: 'active', tracking: {}, text_reminder_number: '+57 316 0000000', questions_and_answers: respuestas.map(([q, a]) => ({ question: q, answer: a })) }];
    return uri;
  };
  const subDe = o => { const jwt = new URLSearchParams(o.body).get('assertion'); return JSON.parse(Buffer.from(jwt.split('.')[1], 'base64').toString()).sub; };
  let subActual = null;
  const fetchFn = async (u, o = {}) => {
    llamadas.push(u);
    const json = (status, body) => ({ ok: status < 300, status, json: async () => body });
    if (u.includes('oauth2')) { subActual = subDe(o); return json(200, { access_token: 'g-' + subActual, expires_in: 3600 }); }
    if (u.includes('googleapis.com/calendar')) {
      const sub = String(o.headers.Authorization).replace('Bearer g-', '');
      const uno = /\/events\/([^?]+)/.exec(u);
      if (uno) {
        const ev = (google[sub] || []).find(e => e.id === decodeURIComponent(uno[1]));
        if (!ev) return json(404, { error: { message: 'Not Found' } });
        if (o.method === 'PATCH') { assert.strictEqual(new URL(u).searchParams.get('sendUpdates'), 'none'); Object.assign(ev, JSON.parse(o.body)); patches.push([sub, ev.id]); }
        return json(200, ev);
      }
      const q = new URL(u).searchParams;
      const min = new Date(q.get('timeMin')).getTime(), max = new Date(q.get('timeMax')).getTime();
      return json(200, { items: (google[sub] || []).filter(e => { const t = new Date(e.start.dateTime).getTime(); return t >= min && t <= max; }) });
    }
    assert.strictEqual(o.headers.Authorization, 'Bearer tok');
    if (u.endsWith('/users/me')) return json(200, { resource: { uri: 'https://api.calendly.com/users/luisa' } });
    if (u.includes('/scheduled_events?')) { const st = new URL(u).searchParams.get('status'); return json(200, { collection: Object.values(ev).filter(e => e.status === st), pagination: {} }); }
    const m = /^(https:\/\/api\.calendly\.com\/scheduled_events\/[^/?]+)(\/invitees(?:\/[^?]+)?)?/.exec(u);
    if (m && !m[2]) return ev[m[1]] ? json(200, { resource: ev[m[1]] }) : json(404, { message: 'no' });
    if (m && m[2] && m[2].startsWith('/invitees/')) return json(200, { resource: inv[m[1]][0] });
    if (m && m[2]) return json(200, { collection: inv[m[1]] });
    return json(404, { message: 'ruta desconocida ' + u });
  };
  return { fetchFn, agregar, google, llamadas, patches };
}

test('calendario: buscarEvento ubica el evento de Calendly por hora e invitado y lee las respuestas', async () => {
  const k = falso();
  k.google['luisa@peaku.co'].push(
    { id: 'otro', status: 'confirmed', summary: 'Otra cosa', start: { dateTime: INICIO }, attendees: [{ email: 'x@y.co', responseStatus: 'accepted' }] },
    { id: 'g1', status: 'confirmed', summary: 'Conoce Peaku! - Cemento', htmlLink: 'https://cal/g1', hangoutLink: 'https://meet/g1',
      organizer: { email: 'luisa@peaku.co' }, start: { dateTime: INICIO },
      attendees: [{ email: 'luisa@peaku.co', organizer: true, self: true, responseStatus: 'accepted' }, { email: 'maria@cemento.co', displayName: 'María', responseStatus: 'accepted' }, { email: 'jefe@cemento.co', responseStatus: 'needsAction', optional: true }, { email: 'sala@resource.calendar.google.com', resource: true, responseStatus: 'accepted' }] },
  );
  const r = await cal.buscarEvento(ENV, base, 'Luisa', { inicio: INICIO, email: 'maria@cemento.co', nombre: 'María' }, { fetchFn: k.fetchFn });
  assert.strictEqual(r.id, 'g1');
  assert.strictEqual(r.calendario, 'luisa@peaku.co');
  assert.strictEqual(r.enlace_reunion, 'https://meet/g1');
  assert.deepStrictEqual(r.invitados.map(i => [i.email, i.estado, i.organizador, i.opcional]),
    [['luisa@peaku.co', 'acepto', true, false], ['maria@cemento.co', 'acepto', false, false], ['jefe@cemento.co', 'sin_responder', false, true]]);
  // Sin coincidencia (otra hora) → null; sin correo del usuario → null.
  assert.strictEqual(await cal.buscarEvento(ENV, base, 'Luisa', { inicio: '2026-10-03T15:00:00Z', email: 'maria@cemento.co' }, { fetchFn: k.fetchFn }), null);
  assert.strictEqual(await cal.buscarEvento(ENV, base, 'Santiago', { inicio: INICIO, email: 'maria@cemento.co' }, { fetchFn: k.fetchFn }), null);
});

test('invitados: la sincronización guarda formulario, invitados y respuesta; la ficha y el tablero los muestran', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', linea_negocio TEXT, canal_adquisicion TEXT, freelancer_nombre TEXT, outcome TEXT, calificacion_sandler TEXT)`);
  const leadId = (await db.query(`INSERT INTO sdr.leads (empresa, contacto, email, etapa) VALUES ('Manufacturas de Cemento', 'María', 'maria@cemento.co', 'conversacion') RETURNING id`)).rows[0].id;
  const ahora = new Date('2026-09-30T15:00:00Z');
  const k = falso();
  k.agregar('A', { email: 'maria@cemento.co', name: 'María', respuestas: [['Vacantes activas', '3'], ['Teléfono', '+57 316 7081572']], guests: ['jefe@cemento.co'] });
  // Calendly creó el evento en el calendario de Luisa, sin Angie: la sincronización la agrega como invitada (invitar_al_evento).
  k.google['luisa@peaku.co'].push({ id: 'g1', status: 'confirmed', summary: 'Conoce Peaku! - María', htmlLink: 'https://cal/g1', organizer: { email: 'luisa@peaku.co' }, start: { dateTime: INICIO },
    attendees: [{ email: 'luisa@peaku.co', organizer: true, self: true, responseStatus: 'accepted' }, { email: 'maria@cemento.co', responseStatus: 'needsAction' }, { email: 'jefe@cemento.co', responseStatus: 'declined' }] });
  const log = { log() {}, error() {} };

  const r = await CAL.sincronizar(db, base, ENV, { ahora, fetchFn: k.fetchFn, log });
  assert.strictEqual(r.nuevas, 1);
  assert.deepStrictEqual([r.invitados.revisadas, r.invitados.encontradas, r.invitados.errores, r.invitados.agregados], [1, 1, [], 1]);
  assert.deepStrictEqual(k.patches, [['luisa@peaku.co', 'g1']]);                       // Angie entró al evento, desde el calendario de Luisa

  const m = await CAL.reunionDe(db, leadId);
  assert.strictEqual(m.inicio_ms, new Date(INICIO).getTime());
  assert.deepStrictEqual(m.reservo, { email: 'maria@cemento.co', nombre: 'María' });
  assert.deepStrictEqual(m.respuestas, [{ pregunta: 'Vacantes activas', respuesta: '3' }, { pregunta: 'Teléfono', respuesta: '+57 316 7081572' }]);
  assert.deepStrictEqual(m.acompanantes, ['jefe@cemento.co']);
  assert.deepStrictEqual([m.invitados_fuente, m.calendario, m.evento], ['google', 'luisa@peaku.co', 'https://cal/g1']);
  assert.deepStrictEqual(m.invitados.map(i => [i.email, i.estado]), [['luisa@peaku.co', 'acepto'], ['maria@cemento.co', 'sin_responder'], ['jefe@cemento.co', 'rechazo'], ['angie@peaku.co', 'sin_responder']]);

  // El tablero de la ejecutiva trae lo mismo por reunión.
  const t = await require('../ejecutiva').tablero(db, base, { mes: '2026-10', ahora });
  const fila = t.reuniones.find(x => x.lead_id === leadId);
  assert.ok(fila, 'la reunión aparece en el tablero');
  assert.deepStrictEqual(fila.invitados.lista.map(i => i.estado), ['acepto', 'sin_responder', 'rechazo', 'sin_responder']);
  assert.strictEqual(fila.invitados.respuestas[0].respuesta, '3');

  // Dentro de la hora no se vuelve a mirar; con forzar / por lead sí. Cuando la aceptan, cambia.
  k.google['luisa@peaku.co'][0].attendees[1].responseStatus = 'accepted';
  const antes = k.llamadas.length;
  assert.strictEqual((await CAL.refrescarInvitados(db, base, ENV, { ahora: new Date(ahora.getTime() + 10 * 60000), fetchFn: k.fetchFn })).revisadas, 0);
  assert.strictEqual(k.llamadas.length, antes);
  const r2 = await CAL.refrescarInvitados(db, base, ENV, { leadId, ahora: new Date(ahora.getTime() + 10 * 60000), fetchFn: k.fetchFn });
  assert.deepStrictEqual([r2.revisadas, r2.encontradas, r2.agregados], [1, 1, undefined]);   // Angie ya está: no se vuelve a tocar el evento
  assert.strictEqual(k.patches.length, 1);
  assert.strictEqual((await CAL.reunionDe(db, leadId)).invitados.find(i => i.email === 'maria@cemento.co').estado, 'acepto');
  // Si el evento está en el calendario de Angie (ella no es la organizadora), se lee pero no se toca.
  k.google['angie@peaku.co'].push({ id: 'g2', status: 'confirmed', summary: 'Conoce Peaku! - María', organizer: { email: 'otra@peaku.co' }, start: { dateTime: INICIO }, attendees: [{ email: 'maria@cemento.co', responseStatus: 'accepted' }] });
  k.google['luisa@peaku.co'].length = 0;
  const r2b = await CAL.refrescarInvitados(db, base, ENV, { leadId, ahora, fetchFn: k.fetchFn });
  assert.deepStrictEqual([r2b.encontradas, r2b.agregados, k.patches.length, r2b.errores], [1, undefined, 1, []]);
  k.google['angie@peaku.co'].length = 0;

  // Reserva de antes de guardar respuestas (columna vacía) y evento que no está en ningún calendario.
  await db.query(`UPDATE sdr.calendly_eventos SET respuestas = NULL, invitados = NULL, invitados_at = NULL`);
  const r3 = await CAL.refrescarInvitados(db, base, ENV, { leadId, ahora, fetchFn: k.fetchFn });
  assert.deepStrictEqual([r3.revisadas, r3.encontradas], [1, 0]);
  const m3 = await CAL.reunionDe(db, leadId);
  assert.strictEqual(m3.respuestas.length, 2);                       // se completó desde Calendly
  assert.deepStrictEqual([m3.invitados_fuente, m3.invitados], ['ninguna', []]);
  assert.match(m3.invitados_motivo, /No encontré/);
  // Sin llave de Google, no se intenta.
  assert.strictEqual((await CAL.refrescarInvitados(db, base, { CALENDLY_TOKEN: 'tok' }, { leadId })).omitido, 'sin llave de Google Calendar');
  await db.end();
});

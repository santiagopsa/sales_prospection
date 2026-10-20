// Contactos de Angie en Brevo (sdr/brevo_contactos.js), con un Brevo falso que anota lo que recibe.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const BC = require('../brevo_contactos');
const url = process.env.SDR_TEST_DATABASE_URL;
const ENV = { BREVO_API_KEY: 'k', PUBLIC_URL: 'https://app.peaku.test' };

// Brevo falso: listas y atributos vacíos al principio; POST /contacts devuelve 201 con id nuevo la
// primera vez por identificador y 204 después; GET /contacts/{ident} devuelve el id conocido.
function brevoFalso({ fallar = null } = {}) {
  const llamadas = []; const porIdent = {}; let sig = 100; let listas = []; let carpetas = []; const atributos = [];
  const fetchFn = async (u, o = {}) => {
    const U = new URL(u); const p = U.pathname.replace('/v3', ''); const m = o.method || 'GET'; const body = o.body ? JSON.parse(o.body) : null;
    llamadas.push({ m, p, body, q: Object.fromEntries(U.searchParams) });
    const res = (status, j) => ({ ok: status < 400, status, text: async () => (j == null ? '' : JSON.stringify(j)) });
    if (fallar && fallar(m, p)) return res(400, { message: 'Invalid phone number' });
    if (m === 'GET' && p === '/contacts/lists') return res(200, { lists: listas });
    if (m === 'GET' && p === '/contacts/folders') return res(200, { folders: carpetas });
    if (m === 'POST' && p === '/contacts/folders') { const f = { id: 7, name: body.name }; carpetas.push(f); return res(201, { id: 7 }); }
    if (m === 'POST' && p === '/contacts/lists') { const l = { id: 42, name: body.name }; listas.push(l); return res(201, { id: 42 }); }
    if (m === 'GET' && p === '/contacts/attributes') return res(200, { attributes: atributos.map(name => ({ name, category: 'normal' })) });
    if (m === 'POST' && p.startsWith('/contacts/attributes/normal/')) { atributos.push(decodeURIComponent(p.split('/').pop())); return res(201, null); }
    if (m === 'POST' && p === '/contacts') {
      const ident = (body.email || body.attributes.SMS || '').toLowerCase();
      if (porIdent[ident]) return res(204, null);
      porIdent[ident] = sig++; return res(201, { id: porIdent[ident] });
    }
    if (m === 'GET' && p.startsWith('/contacts/')) { const ident = decodeURIComponent(p.slice('/contacts/'.length)).toLowerCase(); return porIdent[ident] ? res(200, { id: porIdent[ident] }) : res(404, { message: 'Contact does not exist' }); }
    return res(404, { message: 'no' });
  };
  return { fetchFn, llamadas, porIdent };
}

test('cuerpoContacto: nombre y apellido, SMS, atributos de PeakU, bloqueados fuera de la lista', () => {
  const lead = { id: 5, empresa: 'ACME', contacto: 'Ana María Pérez', cargo: 'Líder TH', ciudad: 'Medellín', telefono: '+573001234567', email: 'Ana@Acme.co', etapa: 'contactado', fuente: 'Apollo', lista_nombre: 'Lista oct' };
  const { body, bloqueado } = BC.cuerpoContacto(base, ENV, lead, 42);
  assert.strictEqual(bloqueado, false);
  assert.strictEqual(body.email, 'ana@acme.co');
  assert.deepStrictEqual([body.attributes.FIRSTNAME, body.attributes.LASTNAME, body.attributes.SMS], ['Ana', 'María Pérez', '+573001234567']);
  assert.strictEqual(body.attributes.ETAPA_PEAKU, 'Contactado');
  assert.strictEqual(body.attributes.LEAD_PEAKU, 'https://app.peaku.test/sdr/#/lead/5');
  assert.strictEqual(body.attributes.LISTA_PEAKU, 'Lista oct');
  assert.strictEqual(body.attributes.SDR_PEAKU, 'Angie');
  assert.deepStrictEqual(body.listIds, [42]); assert.strictEqual(body.updateEnabled, true); assert.strictEqual(body.emailBlacklisted, false);
  // Sin "+" si así se configura.
  const sinMas = BC.cuerpoContacto({ ...base, BREVO: { ...base.BREVO, contactos: { ...base.BREVO.contactos, telefono_con_mas: false } } }, ENV, lead, 42);
  assert.strictEqual(sinMas.body.attributes.SMS, '573001234567');
  // Pidió que no lo contacten: bloqueado para correo y SMS y fuera de la lista.
  const b = BC.cuerpoContacto(base, ENV, { ...lead, etapa: 'descartado', razon_descarte: 'no_contactar' }, 42);
  assert.strictEqual(b.bloqueado, true); assert.strictEqual(b.body.emailBlacklisted, true); assert.strictEqual(b.body.smsBlacklisted, true);
  assert.deepStrictEqual(b.body.unlinkListIds, [42]); assert.strictEqual(b.body.listIds, undefined);
  // Un atributo que no esté en la configuración no se manda.
  const pocos = BC.cuerpoContacto({ ...base, BREVO: { ...base.BREVO, contactos: { ...base.BREVO.contactos, atributos: { EMPRESA: 'text' } } } }, ENV, lead, 42);
  assert.deepStrictEqual(Object.keys(pocos.body.attributes).sort(), ['EMPRESA', 'FIRSTNAME', 'LASTNAME', 'SMS']);
});

test('sincronización contra la base: lista y atributos se crean una vez; nuevos, cambiados, sin identificador y bloqueados', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const { importar } = require('../importar');
  const L = require('../leads');
  const R = require('../resultados');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  BC._reiniciar();
  const lunes = new Date('2026-10-19T14:00:00Z');
  await importar(db, base, { archivo: 'b.csv', lista: { nombre: 'Lista Brevo' }, contenido: 'empresa,contacto,telefono,email\nACME,Ana Pérez,3001234567,ana@acme.co\nBeta,Luis,3002222222,', simular: false, ahora: lunes });
  await db.query(`INSERT INTO sdr.leads (empresa, contacto) VALUES ('Sin Datos SA', 'Nadie')`);
  const id = async e => (await db.query(`SELECT id FROM sdr.leads WHERE empresa=$1`, [e])).rows[0].id;
  const fila = async e => (await db.query(`SELECT brevo_id, brevo_error, brevo_at, updated_at FROM sdr.leads WHERE empresa=$1`, [e])).rows[0];

  // Sin llave no hace nada.
  assert.strictEqual((await BC.correrPendientes(db, base, {}, {})).hechos, 0);
  assert.strictEqual((await BC.pendientes(db, base)).length, 3);

  const b = brevoFalso();
  const r = await BC.correrPendientes(db, base, ENV, { fetchFn: b.fetchFn });
  assert.strictEqual(r.hechos, 2); assert.strictEqual(r.errores, 1);
  // La carpeta y la lista se crearon (una vez), y los atributos que faltaban.
  assert.strictEqual(b.llamadas.filter(x => x.m === 'POST' && x.p === '/contacts/folders').length, 1);
  assert.strictEqual(b.llamadas.filter(x => x.m === 'POST' && x.p === '/contacts/lists').length, 1);
  assert.strictEqual(b.llamadas.filter(x => x.p.startsWith('/contacts/attributes/normal/')).length, Object.keys(base.BREVO.contactos.atributos).length);
  const acme = await fila('ACME'), beta = await fila('Beta'), nadie = await fila('Sin Datos SA');
  assert.ok(acme.brevo_id && !acme.brevo_error);
  assert.ok(beta.brevo_id && !beta.brevo_error, 'solo con teléfono también se crea');
  assert.strictEqual(nadie.brevo_id, null); assert.match(nadie.brevo_error, /Sin correo ni teléfono/);
  const postAcme = b.llamadas.find(x => x.m === 'POST' && x.p === '/contacts' && x.body.email === 'ana@acme.co');
  assert.deepStrictEqual(postAcme.body.listIds, [42]);
  assert.strictEqual(postAcme.body.attributes.LISTA_PEAKU, 'Lista Brevo');
  assert.strictEqual(postAcme.body.attributes.ETAPA_PEAKU, 'Nuevo');
  // Nada pendiente (el que falló espera reintento_min).
  assert.deepStrictEqual(await BC.pendientes(db, base), []);
  const e1 = await BC.estado(db, base, ENV);
  assert.deepStrictEqual([e1.total, e1.sincronizados, e1.por_crear, e1.con_error, e1.lista_id], [3, 2, 0, 1, 42]);

  // Un cambio en la app (etapa) lo vuelve a mandar: 204 (ya existía) y el id se conserva sin GET.
  await R.registrarToque(db, base, { leadId: await id('ACME'), canal: 'whatsapp', ahora: new Date('2026-10-19T15:00:00Z') });
  assert.deepStrictEqual(await BC.pendientes(db, base), [await id('ACME')]);
  const antes = b.llamadas.length;
  const r2 = await BC.correrPendientes(db, base, ENV, { fetchFn: b.fetchFn });
  assert.strictEqual(r2.hechos, 1);
  const nuevas = b.llamadas.slice(antes);
  assert.strictEqual(nuevas.filter(x => x.p === '/contacts/lists' || x.p === '/contacts/attributes').length, 0, 'lista y atributos no se vuelven a pedir');
  assert.strictEqual(nuevas.find(x => x.m === 'POST' && x.p === '/contacts').body.attributes.ETAPA_PEAKU, 'Contactado');
  assert.strictEqual(nuevas.some(x => x.m === 'GET' && x.p.startsWith('/contacts/')), false);
  assert.strictEqual((await fila('ACME')).brevo_id, acme.brevo_id);

  // Editar el lead lo marca pendiente; el que pidió no ser contactado se manda bloqueado y fuera de la lista.
  await L.editarLead(db, base, await id('Beta'), { cargo: 'Gerente' }, 'Angie');
  await R.registrarToque(db, base, { leadId: await id('Beta'), canal: 'llamada', resultado: 'descartado', razon: 'no_contactar', ahora: new Date('2026-10-19T16:00:00Z') });
  const r3 = await BC.correrPendientes(db, base, ENV, { fetchFn: b.fetchFn });
  assert.strictEqual(r3.hechos, 1);
  const postBeta = b.llamadas.filter(x => x.m === 'POST' && x.p === '/contacts' && x.body.attributes.SMS === '+573002222222').pop();
  assert.strictEqual(postBeta.body.emailBlacklisted, true); assert.deepStrictEqual(postBeta.body.unlinkListIds, [42]);
  assert.strictEqual(postBeta.body.attributes.CARGO, 'Gerente');

  // Un lead que Brevo rechaza queda con el error y se reintenta a mano.
  const malo = brevoFalso({ fallar: (m, p) => m === 'POST' && p === '/contacts' });
  await db.query(`UPDATE sdr.leads SET email = 'nadie@sindatos.co', updated_at = NOW() WHERE empresa = 'Sin Datos SA'`);
  await assert.rejects(BC.sincronizarLead(db, base, ENV, await id('Sin Datos SA'), { fetchFn: malo.fetchFn }), /Invalid phone number/);
  assert.match((await fila('Sin Datos SA')).brevo_error, /Invalid phone/);
  const ok = await BC.sincronizarLead(db, base, ENV, await id('Sin Datos SA'), { fetchFn: b.fetchFn });
  assert.ok(ok.brevo_id && ok.url.endsWith(String(ok.brevo_id)));
  assert.strictEqual((await fila('Sin Datos SA')).brevo_error, null);
  await db.end();
});

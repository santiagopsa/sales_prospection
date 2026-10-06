// Cruce con Brevo: emparejar por correo y por empresa, diferencias de etapa y lo que queda a cada lado.
const test = require('node:test');
const assert = require('assert');
const base = require('../config');
const B = require('../brevo');
const url = process.env.SDR_TEST_DATABASE_URL;

// Brevo falso: dos pipelines, cuatro deals, empresas y contactos enlazados.
function brevoFalso() {
  const rutas = {
    '/crm/pipeline/details/all': [
      { pipeline: 'p1', pipeline_name: 'Ventas', stages: [{ id: 's1', name: 'Nuevo' }, { id: 's2', name: 'Propuesta' }, { id: 's3', name: 'Ganado' }, { id: 's9', name: 'En pausa' }] },
    ],
    '/crm/deals': { items: [
      { id: 'b1', attributes: { deal_name: 'ACME - SaaS', deal_stage: 's2', pipeline: 'p1', amount: 1200, close_date: '2026-11-15' }, linkedCompaniesIds: ['e1'], linkedContactsIds: ['c1'] },
      { id: 'b2', attributes: { deal_name: 'Delta Ltda', deal_stage: 's3', pipeline: 'p1' }, linkedCompaniesIds: [], linkedContactsIds: ['c2'] },
      { id: 'b3', attributes: { deal_name: 'Omega', deal_stage: 's1', pipeline: 'p1' }, linkedCompaniesIds: ['e3'], linkedContactsIds: [] },
      { id: 'b4', attributes: { deal_name: 'Zeta', deal_stage: 's9', pipeline: 'p1' }, linkedCompaniesIds: [], linkedContactsIds: [] },
      { id: 'b5', attributes: { deal_name: 'Viejo', deal_stage: 's3', pipeline: 'p1' }, linkedCompaniesIds: [], linkedContactsIds: [] },
    ] },
    '/crm/companies/e1': { id: 'e1', attributes: { name: 'ACME S.A.S.', domain: 'acme.com' } },
    '/crm/companies/e3': { id: 'e3', attributes: { name: 'Omega Group' } },
    '/contacts/c1': { id: 1, email: 'Ana@acme.com', attributes: { FIRSTNAME: 'Ana', LASTNAME: 'Ruiz' } },
    '/contacts/c2': { id: 2, email: 'juan@delta.co', attributes: {} },
  };
  const llamadas = [];
  const fetchFn = async (u, opts) => {
    const path = new URL(u).pathname.replace('/v3', '');
    const offset = Number(new URL(u).searchParams.get('offset') || 0);
    llamadas.push(path);
    assert.strictEqual(opts.headers['api-key'], 'xk-prueba');
    let body = rutas[path];
    if (body === undefined) return { ok: false, status: 404, json: async () => ({ message: 'no existe' }) };
    if (path === '/crm/deals' && offset > 0) body = { items: [] };
    return { ok: true, status: 200, json: async () => body };
  };
  return { fetchFn, llamadas };
}
const env = { BREVO_API_KEY: 'xk-prueba' };
const config = { ...base, BREVO: { ...base.BREVO, etapas: { Nuevo: 'sin_calificar', Propuesta: 'propuesta', Ganado: 'ganado' }, cache_min: 10 } };

test('brevo: cruce puro por correo y por empresa, con diferencias', async () => {
  B._reiniciar();
  const { fetchFn, llamadas } = brevoFalso();
  const datos = await B.leerBrevo(config, env, { fetchFn, ahora: new Date('2026-10-06T15:00:00Z') });
  assert.strictEqual(datos.deals.length, 5);
  assert.deepStrictEqual(datos.pipelines, [{ nombre: 'Ventas', etapas: ['Nuevo', 'Propuesta', 'Ganado', 'En pausa'] }]);
  const acme = datos.deals.find(d => d.id === 'b1');
  assert.strictEqual(acme.etapa, 'Propuesta');
  assert.deepStrictEqual(acme.contactos, [{ email: 'ana@acme.com', nombre: 'Ana Ruiz' }]);
  assert.strictEqual(acme.empresas[0].nombre, 'ACME S.A.S.');
  assert.strictEqual(acme.url, 'https://app.brevo.com/crm/deals/b1');
  // Caché: una segunda lectura dentro de la ventana no vuelve a Brevo.
  const n = llamadas.length;
  await B.leerBrevo(config, env, { fetchFn, ahora: new Date('2026-10-06T15:05:00Z') });
  assert.strictEqual(llamadas.length, n);
  await B.leerBrevo(config, env, { fetchFn, ahora: new Date('2026-10-06T15:05:00Z'), forzar: true });
  assert.ok(llamadas.length > n);

  const sandler = [
    { id: 1, empresa: 'Acme Colombia', email: 'ana@acme.com', etapa: 'calificado' },     // por correo; etapa distinta
    { id: 2, empresa: 'Delta', email: null, etapa: 'propuesta' },                        // por empresa (nombre del deal); cerrado en Brevo
    { id: 3, empresa: 'Omega S.A.S.', email: 'x@omega.com', etapa: 'sin_calificar' },   // por empresa enlazada; igual
    { id: 4, empresa: 'Sigma', email: null, etapa: 'calificado' },                       // solo Sandler
    { id: 5, empresa: 'Cerrada', email: null, etapa: 'perdido' },                        // cerrada: no se reporta
  ];
  const x = B.cruzar(config, sandler, datos.deals);
  assert.deepStrictEqual(x.pares.map(p => [p.sandler.id, p.brevo.id, p.por]), [[1, 'b1', 'correo'], [2, 'b2', 'empresa'], [3, 'b3', 'empresa']]);
  assert.match(x.pares[0].diferencias[0], /Etapa distinta: Sandler "Calificados", Brevo "Propuesta"/);
  assert.match(x.pares[1].diferencias[0], /En Brevo está ganado y en el Sandler sigue abierto/);
  assert.deepStrictEqual(x.pares[2].diferencias, []);
  assert.deepStrictEqual(x.solo_sandler.map(d => d.id), [4]);
  // Solo Brevo: Zeta (etapa sin regla, se muestra); Viejo está ganado en Brevo → no es pendiente.
  assert.deepStrictEqual(x.solo_brevo.map(b => b.id), ['b4']);
  assert.strictEqual(B.etapaEquivalente(config, 'PROPUESTA'), 'propuesta');
  assert.strictEqual(B.etapaEquivalente(config, 'En pausa'), null);
});

test('brevo: sin llave no hace nada; con llave mala, error claro', async () => {
  assert.strictEqual(B.activo({}), false);
  assert.strictEqual(await B.dealDe(null, config, {}, { email: 'a@b.c' }), null);
  assert.throws(() => B.cliente({}), /BREVO_API_KEY/);
  B._reiniciar();
  const fetchFn = async () => ({ ok: false, status: 401, json: async () => ({ message: 'Key not found' }) });
  await assert.rejects(B.leerBrevo(config, env, { fetchFn, forzar: true }), /Brevo 401 .*Key not found/);
});

test('brevo: chequeo contra la base (deals del Sandler con el correo del lead de Angie)', { skip: !url && 'sin SDR_TEST_DATABASE_URL' }, async () => {
  const { conectar } = require('../db');
  const { initSchema } = require('../schema');
  const db = conectar(url);
  process.on('exit', () => { try { db.end(); } catch (_) {} });
  await db.query('DROP SCHEMA IF EXISTS sdr CASCADE');
  await initSchema(db, { log() {}, error: console.error });
  await db.query('DROP TABLE IF EXISTS public.deals');
  await db.query(`CREATE TABLE public.deals (id SERIAL PRIMARY KEY, executive TEXT, company TEXT, data JSONB NOT NULL DEFAULT '{}', outcome TEXT, etapa_embudo TEXT, quoted_at TIMESTAMPTZ, calificacion_sandler TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), closed_at TIMESTAMPTZ)`);
  require('../embudo')._reiniciar();
  const deal = async (company, extra = {}) => (await db.query(`INSERT INTO public.deals (company, outcome, etapa_embudo, calificacion_sandler) VALUES ($1, $2, $3, $4) RETURNING id`, [company, extra.outcome || 'open', extra.etapa || null, extra.cal || null])).rows[0].id;
  const d1 = await deal('Acme Colombia', { etapa: 'calificado' });
  await db.query(`INSERT INTO sdr.leads (empresa, contacto, email, etapa, deal_id) VALUES ('Acme Colombia', 'Ana', 'ANA@acme.com', 'calificado', $1)`, [d1]);
  await deal('Delta', { etapa: 'propuesta' });
  await deal('Sigma', { cal: 'Completa' });
  await deal('Cerrada', { outcome: 'lost' });
  B._reiniciar();
  const { fetchFn } = brevoFalso();
  const c = await B.chequeo(db, config, env, { fetchFn });
  assert.deepStrictEqual(c.resumen, { sandler: 4, brevo: 5, pares: 2, con_diferencias: 2, solo_sandler: 1, solo_brevo: 2 });
  assert.strictEqual(c.pares[0].por, 'correo');
  assert.strictEqual(c.pares[0].sandler.email, 'ana@acme.com');
  assert.deepStrictEqual(c.etapas_sin_regla, ['En pausa']);
  assert.strictEqual(c.solo_sandler[0].empresa, 'Sigma');
  assert.strictEqual(c.solo_sandler[0].etapa, 'calificado');
  // Lo de Brevo para un lead por correo y para un deal por empresa.
  const porLead = await B.dealDe(db, config, env, { email: 'ana@acme.com', empresa: 'Otra' }, { fetchFn });
  assert.deepStrictEqual([porLead.id, porLead.por, porLead.etapa_equivalente], ['b1', 'correo', 'propuesta']);
  assert.strictEqual(await B.dealDe(db, config, env, { email: null, empresa: 'Nadie' }, { fetchFn }), null);
  await db.end();
});

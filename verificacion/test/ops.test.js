// Operaciones (lo que antes era Airtable): cálculos, validación, lo que se llena solo y la
// importación. Sin dependencias: node test/ops.test.js
const assert = require('assert');
const OPS = require('../ops');
const { calcular, normalizar, reglas, crearOps, atender } = OPS;

let n = 0;
const t = async (nombre, fn) => { await fn(); n++; console.log('  ✓', nombre); };
const AH = Date.parse('2026-09-25T15:00:00Z');       // viernes 25, 10 a. m. en Colombia
const hace = dias => new Date(AH - dias * 86400000).toISOString();

(async () => {
  console.log('procesos completos');
  await t('salud por días sin movimiento, solo en Reclutamiento y Terna enviada', () => {
    const s = d => calcular('procesos', { etapa: 'Reclutamiento', movido_at: hace(d) }, AH).salud;
    assert.deepStrictEqual([s(1), s(2), s(3), s(5), s(6)], ['verde', 'verde', 'amarilla', 'amarilla', 'roja']);
    assert.strictEqual(calcular('procesos', { etapa: 'Facturación', movido_at: hace(20) }, AH).salud, null);
    assert.strictEqual(calcular('procesos', { etapa: 'Facturación' }, AH).abierto, true);
    assert.strictEqual(calcular('procesos', { etapa: 'Cancelado' }, AH).abierto, false);
  });
  await t('duración hasta el cierre (o hasta hoy), responsabilidad y causa faltante', () => {
    const c = calcular('procesos', { etapa: 'Cancelado', activado: '2026-09-01', fecha_cierre: '2026-09-11', causa_cierre: 'Externa evitable · Contrató con otro headhunter' }, AH);
    assert.strictEqual(c.duracion, 10); assert.strictEqual(c.responsabilidad, 'Externa evitable'); assert.strictEqual(c.falta_causa, false);
    assert.strictEqual(calcular('procesos', { etapa: 'Reclutamiento', activado: '2026-09-01' }, AH).duracion, 24);
    assert.strictEqual(calcular('procesos', { etapa: 'Pausado' }, AH).falta_causa, true);
    assert.strictEqual(OPS.responsabilidad('Interna · No logramos terna adecuada'), 'Interna');
  });
  await t('al cerrar se pone la fecha de cierre; al reabrir se quita; terna enviada pone la fecha de terna', () => {
    const c1 = reglas('procesos', { etapa: 'Reclutamiento' }, { etapa: 'Cancelado' }, { ahora: AH });
    assert.strictEqual(c1.fecha_cierre, '2026-09-25'); assert.ok(c1.movido_at);
    const c2 = reglas('procesos', { etapa: 'Cancelado', fecha_cierre: '2026-09-20' }, { etapa: 'Reclutamiento' }, { ahora: AH });
    assert.strictEqual(c2.fecha_cierre, null);
    const c3 = reglas('procesos', { etapa: 'Reclutamiento' }, { etapa: 'Terna enviada' }, { ahora: AH });
    assert.strictEqual(c3.ultima_terna, '2026-09-25');
    const c4 = reglas('procesos', { etapa: 'Reclutamiento', ultima_terna: '2026-09-01' }, { etapa: 'Terna enviada' }, { ahora: AH });
    assert.ok(!('ultima_terna' in c4));
    const c5 = reglas('procesos', { etapa: 'Reclutamiento', tier: 'Alto' }, { tier: 'Bajo' }, { ahora: AH });
    assert.ok(!('movido_at' in c5), 'cambiar el tier no es movimiento del proceso');
  });

  console.log('SaaS');
  await t('la meta se cumple con destacados, sin contar descartados', () => {
    const c = calcular('saas', { estado: 'Activa', meta: 10, destacados: 8, descartados: 25, aplicantes: 200, activado: '2026-09-20', actualizado_at: hace(0) }, AH);
    assert.strictEqual(c.meta_cumplida, false); assert.strictEqual(c.faltan, 2);
    assert.strictEqual(c.pct_descartados, 13); assert.strictEqual(c.salud, 'amarilla');
    assert.strictEqual(calcular('saas', { estado: 'Activa', meta: 10, destacados: 10 }, AH).salud, 'verde');
  });
  await t('roja si lleva más de 10 días sin cumplir o 2 días sin actualizar; nada si no está activa', () => {
    assert.strictEqual(calcular('saas', { estado: 'Activa', meta: 10, destacados: 3, activado: '2026-09-10', actualizado_at: hace(0) }, AH).salud, 'roja');
    assert.strictEqual(calcular('saas', { estado: 'Activa', meta: 10, destacados: 3, activado: '2026-09-24', actualizado_at: hace(2) }, AH).salud, 'roja');
    assert.strictEqual(calcular('saas', { estado: 'Terminada', meta: 10, destacados: 3 }, AH).salud, null);
  });
  await t('la fecha de meta se pone sola el día en que se alcanza, y "sin cambios" cuenta como actualización', () => {
    const c = reglas('saas', { meta: 10, destacados: 9 }, { destacados: 10 }, { ahora: AH });
    assert.strictEqual(c.meta_at, '2026-09-25'); assert.ok(c.actualizado_at);
    assert.ok(!('meta_at' in reglas('saas', { meta: 10, destacados: 12, meta_at: '2026-09-01' }, { destacados: 13 }, { ahora: AH })));
    assert.ok(reglas('saas', { meta: 10, destacados: 3 }, {}, { ahora: AH, revisado: true }).actualizado_at);
  });

  console.log('evaluaciones');
  await t('% de aprobación y salud (el cálculo que Airtable perdió)', () => {
    const e = (ap, ev, act) => calcular('evaluaciones', { estado: 'En evaluación', evaluados: ev, aprobados: ap, activado: act }, AH);
    assert.strictEqual(e(7, 10, '2026-09-20').pct_aprobacion, 70); assert.strictEqual(e(7, 10, '2026-09-20').salud, 'verde');
    assert.strictEqual(e(3, 10, '2026-09-20').salud, 'roja');
    assert.strictEqual(e(5, 10, '2026-09-20').salud, 'amarilla');
    assert.strictEqual(e(9, 10, '2026-08-01').salud, 'roja');
    assert.strictEqual(e(null, 10, '2026-09-20').salud, 'sin_datos');
    assert.strictEqual(calcular('evaluaciones', { estado: 'Terminado', evaluados: 5, aprobados: 1 }, AH).salud, null);
  });

  console.log('validación');
  await t('tipos, opciones, obligatorios y mensajes que dicen qué corregir', () => {
    const v = normalizar('procesos', { etapa: 'terna enviada', faltan_terna: '2', garantia: 'true', activado: '2026-02-30', empresa: '' });
    assert.strictEqual(v.cambios.etapa, 'Terna enviada'); assert.strictEqual(v.cambios.faltan_terna, 2); assert.strictEqual(v.cambios.garantia, true);
    assert.ok(v.errores.some(e => /Activación no es una fecha válida/.test(e)));
    assert.ok(v.errores.some(e => /Empresa no puede quedar vacío/.test(e)));
    assert.ok(normalizar('procesos', { faltan_terna: '-1' }).errores.length);
    assert.ok(normalizar('procesos', { etapa: 'Ganado' }).errores[0].includes('no es una opción'));
    assert.ok(normalizar('evaluaciones', { link: 'peaku.co/x' }).errores.length);
    assert.strictEqual(normalizar('evaluaciones', { satisfaccion: '' }).cambios.satisfaccion, null);
    assert.ok(normalizar('saas', { cliente: 'X' }, { nuevo: true }).errores.some(e => /id vacante/.test(e)));
  });

  console.log('almacenamiento (memoria) y rutas');
  let reloj = AH;
  const ops = crearOps({ semilla: false, ahora: () => reloj });
  await t('crear, editar y borrar, con la validación cruzada de aprobados', async () => {
    const r = await atender(ops, 'POST', 'evaluaciones', null, { empresa: 'Siigo', cargo: 'DBA', estado: 'En evaluación', evaluados: 4 });
    assert.strictEqual(r.status, 200, JSON.stringify(r.body));
    const id = r.body.fila.id;
    const mal = await atender(ops, 'PATCH', 'evaluaciones', String(id), { aprobados: 5 });
    assert.strictEqual(mal.status, 400); assert.match(mal.body.error, /mayor que evaluados/);
    const ok = await atender(ops, 'PATCH', 'evaluaciones', String(id), { aprobados: 3 });
    assert.strictEqual(ok.body.fila.pct_aprobacion, 75);
    assert.strictEqual((await atender(ops, 'DELETE', 'evaluaciones', String(id))).status, 200);
    assert.strictEqual((await atender(ops, 'PATCH', 'evaluaciones', String(id), { aprobados: 1 })).status, 404);
    assert.strictEqual((await atender(ops, 'GET', 'otra', null)).status, 404);
  });
  await t('el tier se aplica a todos los procesos de la misma empresa', async () => {
    const a = (await ops.crear('procesos', { empresa: 'Somos', cargo: 'A', etapa: 'Reclutamiento' })).fila;
    const b = (await ops.crear('procesos', { empresa: ' somos ', cargo: 'B', etapa: 'Cancelado' })).fila;
    const c = (await ops.crear('procesos', { empresa: 'IDOM', cargo: 'C', etapa: 'Reclutamiento' })).fila;
    const r = await ops.actualizar('procesos', a.id, { tier: 'Alto' });
    assert.deepStrictEqual(r.tambien, [b.id]);
    const filas = await ops.listar('procesos');
    assert.strictEqual(filas.find(f => f.id === b.id).tier, 'Alto');
    assert.strictEqual(filas.find(f => f.id === c.id).tier, null);
  });
  await t('un proceso nuevo de una empresa conocida hereda su tier', async () => {
    const d = (await ops.crear('procesos', { empresa: 'SOMOS', cargo: 'D', etapa: 'Reclutamiento' })).fila;
    assert.strictEqual(d.tier, 'Alto');
  });
  await t('días sin movimiento avanzan con el reloj y un cambio los reinicia', async () => {
    const p = (await ops.crear('procesos', { empresa: 'Bego', cargo: 'X', etapa: 'Reclutamiento' })).fila;
    reloj = AH + 4 * 86400000;
    let f = (await ops.listar('procesos')).find(x => x.id === p.id);
    assert.strictEqual(f.dias_sin_movimiento, 4); assert.strictEqual(f.salud, 'amarilla');
    f = (await ops.actualizar('procesos', p.id, { faltan_terna: 1 })).fila;
    assert.strictEqual(f.dias_sin_movimiento, 0); assert.strictEqual(f.salud, 'verde');
    reloj = AH;
  });

  console.log('importación de Airtable');
  await t('la semilla entra completa una sola vez, con las columnas nuevas llenas desde las notas', async () => {
    const o = crearOps({ semilla: false, ahora: () => AH });
    const r1 = await o.sembrar();
    assert.deepStrictEqual(r1.importadas, { procesos: 87, saas: 212, evaluaciones: 39 });
    const r2 = await o.sembrar();
    assert.deepStrictEqual(r2.importadas, { procesos: 0, saas: 0, evaluaciones: 0 });
    const ps = await o.listar('procesos');
    assert.strictEqual(ps.length, 87);
    assert.ok(ps.some(p => p.faltan_terna === 2 && /Pendiente 2/.test(p.notas || '')));
    assert.ok(ps.filter(p => p.garantia).length >= 3);
    assert.ok(ps.every(p => OPS.ETAPAS.includes(p.etapa)));
    const ss = await o.listar('saas');
    assert.strictEqual(ss.filter(s => s.estado === 'Activa').length, 44);   // 45 en Airtable, menos una fila vacía creada hoy
    assert.ok(ss.every(s => s.peaku_id && s.cliente));
    const es = await o.listar('evaluaciones');
    assert.ok(es.every(e => e.aprobados === null));
    assert.ok(es.every(e => e.salud === null || e.salud === 'sin_datos'));
  });

  console.log(`\n${n} pruebas · todo en verde`);
})().catch(e => { console.error(e); process.exit(1); });

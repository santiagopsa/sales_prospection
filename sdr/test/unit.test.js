// node --test sdr/test/
const test = require('node:test');
const assert = require('assert');
const N = require('../normalizar');
const tiempo = require('../tiempo');
const { planificar } = require('../secuencia');
const { prioridad } = require('../cola');
const config = require('../config');

test('CSV: separador ; con comillas, BOM y salto de línea dentro del campo', () => {
  const t = '\uFEFFEmpresa;Nombre;Notas\r\n"ACME; S.A.S";Ana;"línea 1\nlínea 2"\r\n;;\r\nBeta;"Luis ""Lucho""";x';
  assert.strictEqual(N.detectarSeparador(t), ';');
  assert.deepStrictEqual(N.parsearCsv(t), [
    ['Empresa', 'Nombre', 'Notas'],
    ['ACME; S.A.S', 'Ana', 'línea 1\nlínea 2'],
    ['Beta', 'Luis "Lucho"', 'x'],
  ]);
});

test('Decodificar: UTF-8 y Windows-1252 de Excel', () => {
  assert.strictEqual(N.decodificar(Buffer.from('Compañía;Teléfono', 'utf8')), 'Compañía;Teléfono');
  assert.strictEqual(N.decodificar(Buffer.from([0x43, 0x6f, 0x6d, 0x70, 0x61, 0xf1, 0xed, 0x61])), 'Compañía');
});

test('Columnas: alias con tildes y mayúsculas', () => {
  const m = N.mapearColumnas(['Compañía', 'Nombre completo', 'Cargo', 'Teléfono Móvil', 'Correo electrónico', 'Ciudad', 'Fuente']);
  assert.deepStrictEqual(m, { empresa: 0, contacto: 1, cargo: 2, email: 4, fuente: 6, telefonos: [{ i: 3, orden: 8 }], ciudades: [{ i: 5, orden: 0 }], extra: {} });
});

test('Teléfono: formatos colombianos y extranjeros', () => {
  const e = (v, c) => N.normalizarTelefono(v, c).e164;
  assert.strictEqual(e('300 123 4567'), '+573001234567');
  assert.strictEqual(e('+57 (300) 123-4567'), '+573001234567');
  assert.strictEqual(e('573001234567'), '+573001234567');
  assert.strictEqual(e('604 444 1234'), '+576044441234');
  assert.strictEqual(e('(4) 444 1234'), '+576044441234');          // fijo viejo con indicativo
  assert.strictEqual(e('444 1234', 'Medellín'), '+576044441234');  // fijo de 7 con ciudad
  assert.strictEqual(e('+52 55 1234 5678'), '+525512345678');
  assert.strictEqual(e('0052 55 1234 5678'), '+525512345678');
  assert.strictEqual(e(''), null);
  assert.ok(N.normalizarTelefono('444 1234').error);
  assert.ok(N.normalizarTelefono('55 1234 5678').error);            // 10 dígitos sin + que no es CO
  assert.ok(N.normalizarTelefono('12345').error);
});

test('Correo: normaliza y rechaza inválidos', () => {
  assert.strictEqual(N.normalizarEmail('  Ana@ACME.co ').email, 'ana@acme.co');
  assert.ok(N.normalizarEmail('ana@acme').error);
  assert.strictEqual(N.normalizarEmail('').email, null);
});

test('leerArchivo: errores, avisos y nombre+apellido', () => {
  const r = N.leerArchivo('empresa,nombre,apellido,telefono,email\nACME,Ana,Gómez,3001234567,ana@acme.co\n,,,3001112222,\nBeta,Luis,,12,\nGama,Eva,,12,eva@gama.co');
  assert.strictEqual(r.filas.length, 2);
  assert.strictEqual(r.filas[0].lead.contacto, 'Ana Gómez');
  assert.deepStrictEqual(r.errores.map(x => x.fila), [3, 4]);
  assert.match(r.errores[0].motivo, /sin empresa ni nombre/);
  assert.match(r.errores[1].motivo, /teléfono/);
  assert.strictEqual(r.filas[1].lead.telefono, null);                 // Gama entra por correo…
  assert.strictEqual(r.filas[1].avisos.length, 1);                    // …con aviso del teléfono malo
  assert.match(N.leerArchivo('cargo,ciudad\nCEO,Bogotá').error, /empresa.*y teléfono o correo/);
});

test('Tiempo: fecha de Bogotá cruza la medianoche UTC', () => {
  assert.strictEqual(tiempo.fechaBogota(new Date('2026-09-17T03:00:00Z')), '2026-09-16');
  assert.strictEqual(tiempo.instante('2026-09-16', 8).toISOString(), '2026-09-16T13:00:00.000Z');
  assert.strictEqual(tiempo.avanzar('2026-09-18', 1, true), '2026-09-21');   // vie + 1 hábil = lun
  assert.strictEqual(tiempo.avanzar('2026-09-19', 0, true), '2026-09-21');   // sáb → lun
  assert.strictEqual(tiempo.avanzar('2026-09-18', 1, false), '2026-09-19');
});

test('Secuencia: días acumulados desde el toque anterior y fines de semana', () => {
  const cfg = { ...config, SECUENCIA_POR_DEFECTO: [{ canal: 'llamada', dias: 0 }, { canal: 'whatsapp', dias: 0 }, { canal: 'correo', dias: 2 }, { canal: 'llamada', dias: 1 }] };
  const p = planificar(cfg, '2026-09-17'); // jueves
  assert.deepStrictEqual(p.map(x => x.fecha), ['2026-09-17', '2026-09-17', '2026-09-21', '2026-09-22']);
  assert.strictEqual(p[0].due_at.toISOString(), '2026-09-17T13:00:00.000Z');
  const sinSaltar = planificar({ ...cfg, SALTAR_FINES_DE_SEMANA: false }, '2026-09-17');
  assert.deepStrictEqual(sinSaltar.map(x => x.fecha), ['2026-09-17', '2026-09-17', '2026-09-19', '2026-09-20']);
  assert.throws(() => planificar({ ...cfg, SECUENCIA_POR_DEFECTO: [{ canal: 'fax', dias: 0 }] }, '2026-09-17'), /fax/);
});

test('Prioridad: etapa + canal + atraso con tope', () => {
  const ahora = new Date('2026-09-30T15:00:00Z');
  const t = (etapa, canal, fecha) => prioridad({ etapa, canal, due_ms: tiempo.instante(fecha, 8).getTime() }, config, ahora);
  assert.deepStrictEqual(t('nuevo', 'llamada', '2026-09-30').desglose, { etapa: 10, canal: 10, atraso: 0, lista: 0, cargo: 0 });
  // Cargo con prioridad (PRIORIDAD.porCargo): selección/reclutamiento suma más que coordinador de TH; directores, nada.
  const conCargo = cargo => prioridad({ etapa: 'nuevo', canal: 'llamada', cargo, due_ms: tiempo.instante('2026-09-30', 8).getTime() }, config, ahora);
  assert.deepStrictEqual([conCargo('Coordinadora de Selección de Personal').desglose.cargo, conCargo('Coordinador de Talento Humano').desglose.cargo, conCargo('Head of Human Talent').desglose.cargo, conCargo(null).desglose.cargo], [15, 5, 0, 0]);
  assert.strictEqual(conCargo('Jefe de Reclutamiento').cargo_regla, 'selección / reclutamiento');
  assert.ok(conCargo('Analista de selección').puntaje > conCargo('Gerente General').puntaje);
  // Lead de una lista fresca de prioridad alta: suma LISTAS.puntos y le gana a todo lo demás.
  const deLista = prioridad({ etapa: 'nuevo', canal: 'correo', due_ms: tiempo.instante('2026-09-30', 8).getTime(), lista: { id: 1 } }, config, ahora);
  assert.strictEqual(deLista.desglose.lista, config.LISTAS.puntos);
  assert.ok(deLista.puntaje > t('conversacion', 'llamada', '2026-09-01').puntaje);
  assert.strictEqual(t('nuevo', 'llamada', '2026-09-28').desglose.atraso, 6);
  assert.strictEqual(t('nuevo', 'llamada', '2026-09-01').desglose.atraso, 21);        // tope 7 días × 3
  assert.ok(t('conversacion', 'correo', '2026-09-30').puntaje > t('nuevo', 'llamada', '2026-09-28').puntaje);
});

test('xlsx de Apollo: columnas en inglés, varios teléfonos, extra y Do Not Call', () => {
  const buf = require('fs').readFileSync(require('path').join(__dirname, 'fixtures', 'apollo.xlsx'));
  const r = N.leerArchivo(buf, 'apollo.xlsx');
  assert.ok(!r.error, r.error);
  assert.strictEqual(r.filas.length, 4);
  const [ana, luis, eva, solo] = r.filas.map(f => f.lead);
  assert.strictEqual(ana.empresa, 'ACME'); assert.strictEqual(ana.contacto, 'Ana Gómez'); assert.strictEqual(ana.cargo, 'Head of Talent');
  assert.strictEqual(ana.telefono, '+573001234567'); assert.strictEqual(ana.telefono_original, '3001234567');   // número de Excel, no "3.001234567E9"
  assert.strictEqual(ana.email, 'ana@acme.co'); assert.strictEqual(ana.ciudad, 'Medellín'); assert.strictEqual(ana.fuente, 'TA Antioquia');
  assert.deepStrictEqual(ana.extra, { seniority: 'Director', empleados: '250', industria: 'Software', linkedin: 'https://linkedin.com/in/ana', sitio_web: 'acme.co', pais: 'Colombia' });
  assert.strictEqual(luis.telefono, '+576044441234');    // segunda columna de teléfono
  assert.strictEqual(luis.ciudad, 'Medellín');           // Company City cuando City está vacío
  assert.strictEqual(eva.telefono, '+525512345678');     // el "12" inválido se salta y queda como aviso
  assert.match(r.filas[2].avisos[0], /"12"/);
  assert.strictEqual(solo.empresa, 'Solo Nombre');       // sin empresa: el lead se llama como el contacto
  assert.strictEqual(r.errores.length, 1);
  assert.match(r.errores[0].motivo, /Do Not Call/);
  assert.match(r.columnas.telefono, /Mobile Phone → Work Direct Phone → Corporate Phone/);
});

test('teléfono en notación científica de Excel', () => {
  assert.strictEqual(N.normalizarTelefono('3.016572696E9').e164, '+573016572696');
  assert.strictEqual(N.normalizarTelefono('3016572696.0').e164, '+573016572696');
  assert.strictEqual(N.normalizarTelefono(3016572696).e164, '+573016572696');
});

test('fijos viejos de Colombia y el "+1 571" de Apollo', () => {
  const e = v => N.normalizarTelefono(v).e164;
  assert.strictEqual(e('+1 571-702-6044'), '+576017026044');   // Bogotá mal leída como Virginia
  assert.strictEqual(e('+1 571-425-2600'), '+576014252600');
  assert.strictEqual(e('+57 1 7026044'), '+576017026044');     // fijo viejo con +57
  assert.strictEqual(e('+57 4 4441234'), '+576044441234');     // Medellín viejo
  assert.strictEqual(e('+57 601 7470213'), '+576017470213');   // fijo nuevo
  assert.strictEqual(e('+57 317 8345327'), '+573178345327');
  assert.strictEqual(e('+1 571-443-0900'), '+576014430900');
  assert.strictEqual(N.normalizarTelefono('+1 571-702-6044', null, { TELEFONO_1_571_ES_BOGOTA: false }).e164, '+15717026044');
  assert.strictEqual(e('+1 212-555-0100'), '+12125550100');    // otros +1 se respetan
});

test('sumarMeses: fin de mes se recorta y el año rueda', () => {
  const tiempo = require('../tiempo');
  assert.strictEqual(tiempo.sumarMeses('2026-09-21', 3), '2026-12-21');
  assert.strictEqual(tiempo.sumarMeses('2026-11-30', 3), '2027-02-28');
  assert.strictEqual(tiempo.sumarMeses('2026-01-31', 1), '2026-02-28');
  assert.strictEqual(tiempo.sumarMeses('2026-12-15', 1), '2027-01-15');
});

test('mesesReintento: por defecto según la razón, definitivas nunca, valida opciones', () => {
  const { mesesReintento } = require('../resultados');
  const cfg = require('../config');
  assert.strictEqual(mesesReintento(cfg, 'sin_presupuesto', undefined), 3);
  assert.strictEqual(mesesReintento(cfg, 'no_es_decisor', undefined), null);
  assert.strictEqual(mesesReintento(cfg, 'no_contactar', 6), null);
  assert.strictEqual(mesesReintento(cfg, 'sin_presupuesto', '6'), 6);
  assert.strictEqual(mesesReintento(cfg, 'sin_presupuesto', 0), null);
  assert.throws(() => mesesReintento(cfg, 'sin_presupuesto', 4), /1, 3, 6/);
});

test('json_ia: saca el objeto aunque venga con cercas, texto alrededor o varios bloques', () => {
  const J = require('../../json_ia');
  assert.deepStrictEqual(J.parsearJSON('{"a":1}'), { a: 1 });
  assert.deepStrictEqual(J.parsearJSON('Aquí está el análisis:\n```json\n{"a":1}\n```\nEspero que sirva.'), { a: 1 });
  assert.deepStrictEqual(J.parsearJSON('Claro. {"a":{"b":"x"}} fin'), { a: { b: 'x' } });
  assert.strictEqual(J.parsearJSON('{"a":"dijo "no" y se fue"}'), null); // comillas sin escapar: no parsea, toca reparar
  assert.strictEqual(J.parsearJSON('{"a":1'), null); // cortado
  assert.strictEqual(J.textoDe({ content: [{ type: 'text', text: '{"a"' }, { type: 'text', text: ':1}' }] }), '{"a":1}');
  assert.strictEqual(J.textoDe({}), '');
});

test('transcripción cortada por Meet: no se analiza, se avisa', () => {
  const T = require('../../transcripcion');
  const corta = 'Oct 7, 2026\nEncuentro Laboratorios Briller - PeakU - Transcript\n00:00:52\n\nAngie Oliveros: Hola, Santiago. again.\nSantiago Gonzalez: Um, No\n\nTranscription ended after 00:01:05\n\nThis editable transcript was computer generated and might contain errors. People can also change the text after it was created.';
  const e = T.evaluar(corta);
  assert.deepStrictEqual([e.palabras, e.duracion_s, e.cortada, e.suficiente], [5, 65, true, false]);
  assert.match(e.motivo, /se cortó a los 1 min 5 s/);
  const larga = 'Luisa Guerrero: ' + 'cuéntame cómo es el proceso hoy '.repeat(80) + '\n00:12:30\nCliente: ' + 'tenemos cuarenta vacantes y se nos demoran dos meses '.repeat(40) + '\nTranscription ended after 00:41:10';
  const l = T.evaluar(larga);
  assert.deepStrictEqual([l.palabras >= 400, l.cortada, l.suficiente, l.motivo], [true, false, true, null]);
  assert.strictEqual(T.evaluar('x '.repeat(50), { minimoPalabras: 10 }).suficiente, true);
});

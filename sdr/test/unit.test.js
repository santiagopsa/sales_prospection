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
  assert.deepStrictEqual(t('nuevo', 'llamada', '2026-09-30').desglose, { etapa: 10, canal: 10, atraso: 0 });
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

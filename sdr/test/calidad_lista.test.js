// Calidad de listas: clasificación de cargo/teléfono/tamaño y la nota con su por qué (puro, sin base).
const test = require('node:test');
const assert = require('assert');
const Q = require('../calidad_lista');
const base = require('../config');

test('calidad de lista: clasificación', () => {
  const r = Q.reglas(base);
  assert.strictEqual(Q.perfilCargo('Gerente de Talento Humano', r), 'decisor_th');
  assert.strictEqual(Q.perfilCargo('Jefe de Selección', r), 'decisor_th');
  assert.strictEqual(Q.perfilCargo('Head of People', r), 'decisor_th');
  assert.strictEqual(Q.perfilCargo('Analista de selección', r), 'seleccion');
  assert.strictEqual(Q.perfilCargo('Reclutadora', r), 'seleccion');
  assert.strictEqual(Q.perfilCargo('Analista de RRHH', r), 'otro_th');
  assert.strictEqual(Q.perfilCargo('CTO', r), 'fuera');
  assert.strictEqual(Q.perfilCargo('Gerente General', r), 'fuera');
  assert.strictEqual(Q.perfilCargo('', r), 'sin_cargo');
  assert.strictEqual(Q.tipoTelefono('+573001234567'), 'celular');
  assert.strictEqual(Q.tipoTelefono('+576012345678'), 'fijo');
  assert.strictEqual(Q.tipoTelefono('+525512345678'), 'otro_pais');
  assert.strictEqual(Q.tipoTelefono(null), 'sin_telefono');
  assert.deepStrictEqual([Q.tamanoEmpresa('12', [20, 500]), Q.tamanoEmpresa('120', [20, 500]), Q.tamanoEmpresa('1.200', [20, 500]), Q.tamanoEmpresa(null, [20, 500])], ['pequena', 'rango', 'grande', 'sin_dato']);
  // Las expresiones son huecos: con otra regla, otro resultado.
  const r2 = Q.reglas({ LISTAS: { calificacion: { cargo_th: 'gente', cargo_decisor: 'jefe' } } });
  assert.strictEqual(Q.perfilCargo('Jefe de gente', r2), 'decisor_th');
  assert.strictEqual(Q.perfilCargo('Gerente de Talento Humano', r2), 'fuera');
});

const fila = (o = {}) => ({ cargo: 'Gerente de Talento Humano', telefono: '+573001234567', empleados: '120', razon_descarte: null, tocado: true, conversacion: false, reunion: false, llamado: true, numero_vivo: true, numero_invalido: false, ...o });

test('calidad de lista: nota y por qué', () => {
  // Lista buena: 40 tocados, 14 conversaciones, 5 reuniones, todo TH con celular en rango.
  const buena = [];
  for (let i = 0; i < 40; i++) buena.push(fila({ conversacion: i < 14, reunion: i < 5 }));
  let c = Q.calificar(Q.perfilar(buena, base), base);
  assert.strictEqual(c.nota, 'buena');
  assert.ok(Math.abs(c.tasa_reunion - 0.125) < 1e-9);
  assert.ok(/Rinde: 13 % de reunión/.test(c.resumen), c.resumen);
  assert.ok(/repetir: cargo de TH, celulares, números que contestan, datos de empresa/.test(c.resumen), c.resumen);
  assert.ok(c.razones.some(r => r.signo === '+' && /100 % de los números llamados contestan/.test(r.texto)));
  // Con pocos llamados no se opina de los números; el mínimo es un hueco.
  let c2 = Q.calificar(Q.perfilar(buena.slice(0, 9), base), base);
  assert.ok(!c2.razones.some(r => /números llamados/.test(r.texto)));
  c2 = Q.calificar(Q.perfilar(buena.slice(0, 9), base), { LISTAS: { calificacion: { minimo_llamados: 5 } } });
  assert.ok(c2.razones.some(r => /números llamados contestan/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '+' && /5 reuniones de 40 tocados: 13 %/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '+' && /100 % con cargo de talento humano/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '+' && /100 % celulares/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '+' && /entre 20 y 500 empleados/.test(r.texto)));

  // Lista floja: sin cargo, fijos, descartados por no ser decisor.
  const floja = [];
  for (let i = 0; i < 50; i++) floja.push(fila({ cargo: i < 15 ? '' : i < 35 ? 'CTO' : 'Gerente de TH', telefono: i % 5 < 3 ? '+576012345678' : '+573001234567', empleados: null, conversacion: i < 5, reunion: i < 1, razon_descarte: i < 10 ? 'no_es_decisor' : i < 25 ? 'no_interesa' : i < 30 ? 'datos_malos' : null, numero_vivo: i < 15, numero_invalido: i >= 40 }));
  c = Q.calificar(Q.perfilar(floja, base), base, { promedio: { tocados: 400, tasa_reunion: 0.07, tasa_conversacion: 0.24 } });
  assert.strictEqual(c.nota, 'floja');
  assert.ok(/No rinde: 2 % de reunión y 10 % de conversación/.test(c.resumen), c.resumen);
  assert.ok(/Lo que falla: sin cargo, cargos fuera de TH, fijos, números malos, no es el decisor/.test(c.resumen), c.resumen);
  // Números: 15 vivos de 50 llamados; malos = 10 inválidos (40..49) + 5 datos_malos (25..29) = 15 → 30 %.
  assert.ok(c.razones.some(r => r.signo === '-' && /30 % de los números llamados no existen o no son de la persona \(15 de 50\)/.test(r.texto)), JSON.stringify(c.razones));
  assert.ok(c.razones.some(r => r.signo === '-' && /Solo 30 % de los números llamados dan señal de vida; 20 timbran/.test(r.texto)));
  assert.ok(c.razones.some(r => /todas las listas: 7 %/.test(r.texto)), 'ancla con el promedio');
  assert.ok(c.razones.some(r => r.signo === '-' && /30 % sin cargo/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '-' && /40 % con cargo fuera de TH/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '-' && /10 descartados por "No es el decisor": la lista trae al cargo equivocado/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '-' && /60 % fijos y solo 40 % celulares/.test(r.texto)));
  assert.ok(c.razones.some(r => r.signo === '·' && /Sin dato de tamaño/.test(r.texto)));
  assert.ok(c.razones.some(r => /agenda 1 de cada 5/.test(r.texto)));

  // Regular: conversa bien, agenda poco.
  const regular = [];
  for (let i = 0; i < 30; i++) regular.push(fila({ cargo: 'Reclutadora', conversacion: i < 10, reunion: i < 1 }));
  c = Q.calificar(Q.perfilar(regular, base), base);
  assert.strictEqual(c.nota, 'regular');
  assert.ok(c.razones.some(r => /100 % son reclutadores/.test(r.texto)));

  // Muy pronto: pocos tocados. Y el mínimo es un hueco.
  c = Q.calificar(Q.perfilar(buena.slice(0, 10), base), base);
  assert.strictEqual(c.nota, 'pronto');
  assert.ok(/mínimo 15/.test(c.resumen));
  c = Q.calificar(Q.perfilar(buena.slice(0, 10), base), { LISTAS: { calificacion: { minimo_tocados: 5 } } });
  assert.strictEqual(c.nota, 'buena');
  // Umbral de reunión más exigente: la buena pasa a regular.
  c = Q.calificar(Q.perfilar(buena, base), { ...base, LISTAS: { ...base.LISTAS, calificacion: { ...base.LISTAS.calificacion, reunion: { buena: 0.2, regular: 0.14 } } } });
  assert.strictEqual(c.nota, 'regular');
  // Sin tocar nada: no hay razones de resultado, sí de composición.
  c = Q.calificar(Q.perfilar(buena.map(x => ({ ...x, tocado: false, conversacion: false, reunion: false })), base), base);
  assert.strictEqual(c.nota, 'pronto');
  assert.ok(!c.razones.some(r => /tocados:/.test(r.texto)));

  const prom = Q.promedioDe([Q.perfilar(buena, base), Q.perfilar(floja, base)]);
  assert.deepStrictEqual([prom.tocados, prom.reuniones], [90, 6]);
});

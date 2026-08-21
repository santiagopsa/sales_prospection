// Pruebas de las reglas reales del servidor (rules.js). Sin dependencias: node test/rules.test.js
const assert = require('assert');
const { semaforo, bloqueos, integrityHash, reportCode, LVLTXT } = require('../rules');

const ID_OK = {grab:true, kyc:true, ced:true, ges:true, nom:true};
const OK_RATINGS = [{req_text:'x', level:5, evidence:'evidencia suficientemente larga'}];
let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };

console.log('semáforo');
t('identidad completa y cero señales → verde', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{}}).color, 'verde');
});
t('una señal → amarillo', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{lat:true}}).color, 'amarillo');
});
t('dos señales → amarillo', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{lat:true, voz:true}}).color, 'amarillo');
});
t('tres señales → rojo', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{lat:true, voz:true, aud:true}}).color, 'rojo');
});
t('identidad incompleta → rojo aunque no haya señales', () => {
  assert.strictEqual(semaforo({identity:{grab:true}, signals:{}}).color, 'rojo');
});
t('señales en falso no cuentan', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{lat:false, voz:false, aud:false}}).color, 'verde');
});
t('sin argumentos no revienta y da rojo', () => {
  assert.strictEqual(semaforo().color, 'rojo');
});

console.log('sin carpeta completa no hay acta');
t('todo completo → se puede emitir', () => {
  assert.deepStrictEqual(bloqueos({identity:ID_OK, signals:{}, ratings:OK_RATINGS}).faltas, []);
});
t('amarillo también puede emitir (queda pendiente de cuatro ojos)', () => {
  assert.deepStrictEqual(bloqueos({identity:ID_OK, signals:{lat:true}, ratings:OK_RATINGS}).faltas, []);
});
t('rojo bloquea', () => {
  const f = bloqueos({identity:ID_OK, signals:{a:1,b:1,c:1}, ratings:OK_RATINGS}).faltas;
  assert.ok(f.some(x => x.includes('rojo')));
});
t('identidad incompleta bloquea', () => {
  const f = bloqueos({identity:{grab:true}, signals:{}, ratings:OK_RATINGS}).faltas;
  assert.ok(f.some(x => x.includes('identidad')));
});
t('sin requisitos bloquea', () => {
  assert.ok(bloqueos({identity:ID_OK, signals:{}, ratings:[]}).faltas.length);
});
t('requisito sin calificar bloquea', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:null, evidence:'evidencia larga aquí'}]}).faltas;
  assert.ok(f.some(x => x.includes('sin calificar')));
});
t('evidencia corta bloquea', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:4, evidence:'corto'}]}).faltas;
  assert.ok(f.some(x => x.includes('evidencia')));
});
t('evidencia en blanco bloquea', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:4, evidence:'           '}]}).faltas;
  assert.ok(f.some(x => x.includes('evidencia')));
});

console.log('veredictos');
t('4 y 5 cumplen, 3 es parcial, 1 y 2 no cumplen', () => {
  assert.strictEqual(LVLTXT[5], 'CUMPLE');
  assert.strictEqual(LVLTXT[4], 'CUMPLE');
  assert.strictEqual(LVLTXT[3], 'PARCIAL');
  assert.strictEqual(LVLTXT[2], 'NO CUMPLE');
  assert.strictEqual(LVLTXT[1], 'NO CUMPLE');
});

console.log('firma de integridad');
t('el mismo contenido da la misma firma', () => {
  const a = {candidate:'Jorge', ratings:[['x',5]]};
  assert.strictEqual(integrityHash(a), integrityHash({...a}));
});
t('cambiar una calificación cambia la firma', () => {
  const a = integrityHash({candidate:'Jorge', ratings:[['x',5]]});
  const b = integrityHash({candidate:'Jorge', ratings:[['x',4]]});
  assert.notStrictEqual(a, b);
});
t('cambiar el nombre cambia la firma', () => {
  const a = integrityHash({candidate:'Jorge', ratings:[['x',5]]});
  const b = integrityHash({candidate:'Jorgé', ratings:[['x',5]]});
  assert.notStrictEqual(a, b);
});
t('es un sha-256 de 64 caracteres', () => {
  assert.match(integrityHash({a:1}), /^[0-9a-f]{64}$/);
});

console.log('código de informe');
t('tiene el formato PKV-AAAA-NNNNNN', () => {
  assert.match(reportCode(2026), /^PKV-2026-\d{6}$/);
});
t('no se repite en 500 intentos', () => {
  const s = new Set();
  for(let i=0;i<500;i++) s.add(reportCode(2026));
  assert.ok(s.size > 495, 'demasiadas colisiones: ' + s.size);
});

console.log(`\n${n} pruebas · todo en verde`);

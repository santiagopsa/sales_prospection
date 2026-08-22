// Pruebas de las reglas reales del servidor (rules.js). Sin dependencias: node test/rules.test.js
const assert = require('assert');
const { semaforo, bloqueos, estadoIdentidad, tipoDocumento, integrityHash, reportCode, LVLTXT } = require('../rules');

const ID_OK = {grab:true, cam:true, shot:true};   // integridad de la sesión, ya no incluye documento
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
t('faltar un punto de integridad no pone el semáforo en rojo por sí solo', () => {
  // Bloquea la emisión (ver bloqueos), pero no es una acusación contra el candidato.
  assert.strictEqual(semaforo({identity:{grab:true}, signals:{}}).color, 'verde');
});
t('señales en falso no cuentan', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{lat:false, voz:false, aud:false}}).color, 'verde');
});
t('sin argumentos no revienta', () => {
  assert.strictEqual(semaforo().color, 'verde');
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
t('integridad de sesión incompleta bloquea', () => {
  const f = bloqueos({identity:{grab:true}, signals:{}, ratings:OK_RATINGS}).faltas;
  assert.ok(f.some(x => x.includes('integridad')));
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

console.log('sondeo vs cierre — la identidad no se pide en la primera entrevista');
t('un sondeo completo se emite sin ninguna verificación de identidad', () => {
  assert.deepStrictEqual(bloqueos({identity:ID_OK, signals:{}, ratings:OK_RATINGS, kind:'sondeo'}).faltas, []);
});
t('un sondeo no exige la captura del rostro: no habría con qué cotejarla', () => {
  assert.deepStrictEqual(
    bloqueos({identity:{grab:true, cam:true}, signals:{}, ratings:OK_RATINGS, kind:'sondeo'}).faltas, []);
});
t('un cierre sí exige la captura del rostro', () => {
  const f = bloqueos({identity:{grab:true, cam:true}, signals:{}, ratings:OK_RATINGS, kind:'cierre',
                      diditStatus:'Approved', faceVerdict:'coincide'}).faltas;
  assert.ok(f.some(x => x.includes('captura')));
});
t('un cierre con la identidad pendiente NO se emite todavía', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:OK_RATINGS, kind:'cierre', diditStatus:null}).faltas;
  assert.ok(f.some(x => x.includes('identidad')), 'debería esperar el resultado');
});
t('un cierre verificado se emite', () => {
  assert.deepStrictEqual(
    bloqueos({identity:ID_OK, signals:{}, ratings:OK_RATINGS, kind:'cierre',
              diditStatus:'Approved', faceVerdict:'coincide'}).faltas, []);
});
t('si el candidato se negó, el cierre se emite igual (sin capa de identidad)', () => {
  assert.deepStrictEqual(
    bloqueos({identity:ID_OK, signals:{}, ratings:OK_RATINGS, kind:'cierre', idNote:'rechazada'}).faltas, []);
});
t('negarse NO es rojo — prudencia no es sospecha', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{}, kind:'cierre', idNote:'rechazada'}).color, 'verde');
});
t('que el rostro no corresponda SÍ es rojo', () => {
  const s = semaforo({identity:ID_OK, signals:{}, kind:'cierre', diditStatus:'Approved', faceVerdict:'no_coincide'});
  assert.strictEqual(s.color, 'rojo');
  assert.ok(s.idFalla);
});
t('un rostro dudoso deja la sesión en amarillo, no en rojo', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{}, kind:'cierre',
    diditStatus:'Approved', faceVerdict:'revisar'}).color, 'amarillo');
});
t('Didit rechaza el documento → rojo', () => {
  assert.strictEqual(semaforo({identity:ID_OK, signals:{}, kind:'cierre', diditStatus:'Declined'}).color, 'rojo');
});
t('el estado de identidad de un sondeo es no_aplica', () => {
  assert.strictEqual(estadoIdentidad({kind:'sondeo'}).estado, 'no_aplica');
});
t('aprobada pero sin cotejo no cuenta como verificada', () => {
  assert.strictEqual(estadoIdentidad({kind:'cierre', diditStatus:'Approved'}).estado, 'sin_cotejo');
});
t('abandonada se distingue de fallida', () => {
  assert.strictEqual(estadoIdentidad({kind:'cierre', diditStatus:'Abandoned'}).estado, 'abandonada');
  assert.strictEqual(estadoIdentidad({kind:'cierre', diditStatus:'Declined'}).estado, 'fallida');
});

console.log('qué documento sale');
t('un sondeo produce ficha interna, no acta', () => {
  assert.strictEqual(tipoDocumento({kind:'sondeo'}).tipo, 'ficha');
});
t('un cierre verificado produce el acta completa', () => {
  assert.strictEqual(tipoDocumento({kind:'cierre', diditStatus:'Approved', faceVerdict:'coincide'}).tipo, 'acta');
});
t('un cierre sin identidad lo dice en el título', () => {
  const d = tipoDocumento({kind:'cierre', idNote:'rechazada'});
  assert.strictEqual(d.tipo, 'acta_sin_id');
  assert.ok(d.alcance.includes('No certifica identidad'));
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

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
// Lo que se exige para emitir es el PORQUÉ del nivel —lo que se imprime—, no el rastro de
// auditoría. Cualquiera de los dos campos basta; ninguno de los dos, bloquea.
t('sin porqué ni evidencia bloquea', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:4, evidence:'corto'}]}).faltas;
  assert.ok(f.some(x => x.includes('por qué')));
});
t('todo en blanco bloquea', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:4, evidence:'           ', analisis:''}]}).faltas;
  assert.ok(f.some(x => x.includes('por qué')));
});
t('el porqué escrito a mano basta, sin evidencia', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:4, evidence:'',
    analisis:'Narró un caso propio con alcance y resultado.'}]}).faltas;
  assert.ok(!f.some(x => x.includes('por qué')));
});
t('la evidencia sola sigue bastando (sesiones anteriores)', () => {
  const f = bloqueos({identity:ID_OK, signals:{}, ratings:[{req_text:'x', level:4, evidence:'evidencia suficientemente larga'}]}).faltas;
  assert.ok(!f.some(x => x.includes('por qué')));
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

console.log('el empleo que se verifica');
const { conciliarEmpleo, mismaEmpresa, estadisticas, estadoTablero, claveEvaluador } = require('../rules');
const C = (c1, c2, c3, c4) => [['C1',c1],['C2',c2],['C3',c3],['C4',c4]].map(([id, v]) => ({id, cumplido:v, como:''}));
t('la misma empresa se reconoce con sufijos, tildes y mayúsculas', () => {
  assert.ok(mismaEmpresa('Jerónimo Martins Colombia S.A.S.', 'jeronimo martins'));
  assert.ok(mismaEmpresa('Grupo Éxito', 'Éxito'));
  assert.ok(!mismaEmpresa('Alpina', 'Nutresa'));
});
t('si el análisis verifica OTRO empleo, el declarado queda no verificado y se avisa', () => {
  const r = conciliarEmpleo({empresa:'Alpina', cargo:'Consultor'}, {empresa:'Nutresa', estado:'verificada', verificada:true, criterios:C(true,true,true,true), por_que_verificada:'x'});
  assert.strictEqual(r.estado, 'no_verificada'); assert.strictEqual(r.verificada, false);
  assert.strictEqual(r.empresa, 'Alpina'); assert.strictEqual(r.aviso, 'otro_empleo'); assert.strictEqual(r.otro_empleo, 'Nutresa');
  assert.strictEqual(r.por_que_verificada, '');
});
t('verificada exige C1, C2 y C3 cumplidos: sin C3 baja a no verificada y dice qué faltó', () => {
  const r = conciliarEmpleo({empresa:'Alpina'}, {empresa:'Alpina S.A.', estado:'verificada', criterios:C(true,true,null,true), por_que_verificada:'x'});
  assert.strictEqual(r.estado, 'no_verificada'); assert.match(r.que_falto, /C3/);
});
t('C4 incumplido es "contradice", aunque el modelo diga verificada', () => {
  assert.strictEqual(conciliarEmpleo({empresa:'Alpina'}, {empresa:'Alpina', estado:'verificada', criterios:C(true,true,true,false)}).estado, 'contradice');
});
t('con los cuatro criterios, queda verificada con su porqué y los datos del ancla', () => {
  const r = conciliarEmpleo({empresa:'Alpina', cargo:'Consultor SAP PP', periodo:'2023 - hoy'}, {empresa:'alpina', cargo:'otro texto', estado:'verificada', criterios:C(true,true,true,true), por_que_verificada:'Narró decisiones propias.'});
  assert.strictEqual(r.estado, 'verificada'); assert.strictEqual(r.cargo, 'Consultor SAP PP'); assert.strictEqual(r.por_que_verificada, 'Narró decisiones propias.');
});
t('sin ancla y sin empresa identificada no hay nada que verificar', () => {
  assert.strictEqual(conciliarEmpleo(null, {estado:'verificada', verificada:true}).estado, 'no_verificada');
});
t('análisis anteriores sin "estado" se leen por el booleano', () => {
  assert.strictEqual(conciliarEmpleo({empresa:'Alpina'}, {empresa:'Alpina', verificada:true}).estado, 'verificada');
});

console.log('el tablero');
// Jueves 24 de septiembre de 2026, 15:00 en Colombia (20:00 UTC).
const AHORA = Date.parse('2026-09-24T20:00:00Z');
const hace = (dias, horas = 0) => new Date(AHORA - dias * 86400000 - horas * 3600000).toISOString();
const S = [
  {evaluator:'Weimar', status:'issued', entrevista_at:hace(0, 20), issued_at:hace(0, 2), req_total:3, req_cumple:3},
  {evaluator:'weimar ', status:'issued', entrevista_at:hace(1, 30), issued_at:hace(1, 6), req_total:3, req_cumple:2},
  {evaluator:'Weimar', status:'issued', entrevista_at:hace(8), issued_at:hace(7), req_total:2, req_cumple:2},
  {evaluator:'Weimar', status:'draft', transcript_at:hace(0, 1), started_at:hace(0, 3)},
  {evaluator:'Weimar', status:'esperando', entrevista_at:hace(0, 5)},
  {evaluator:'Laura M.', status:'issued', entrevista_at:hace(2), issued_at:hace(2, -4), req_total:3, req_cumple:3},
];
t('el estado del tablero sale de la sesión', () => {
  assert.strictEqual(estadoTablero(S[0]), 'emitido');
  assert.strictEqual(estadoTablero(S[3]), 'calificar');
  assert.strictEqual(estadoTablero(S[4]), 'espera');
  assert.strictEqual(estadoTablero({status:'draft', transcript_status:'procesando', transcript_started_at:new Date().toISOString()}), 'analizando');
  assert.strictEqual(estadoTablero({status:'draft'}), 'en_curso');
});
t('el evaluador se agrupa aunque lo escriban distinto', () => {
  assert.strictEqual(claveEvaluador(' Weimar '), claveEvaluador('weimar'));
  const e = estadisticas(S, {ahora:AHORA});
  assert.deepStrictEqual(e.evaluadores.map(x => x.nombre), ['Weimar', 'Laura M.']);
});
t('esta semana, la pasada, racha, pendientes y calidad — por evaluador', () => {
  const e = estadisticas(S, {evaluador:'WEIMAR', ahora:AHORA});
  assert.strictEqual(e.semanas.length, 8);
  assert.strictEqual(e.esta_semana.informes, 2);          // jueves y miércoles
  assert.strictEqual(e.semana_pasada.informes, 1);        // hace 7 días
  assert.strictEqual(e.racha, 2);                         // hoy y ayer
  assert.strictEqual(e.pendientes.calificar, 1);
  assert.strictEqual(e.pendientes.espera, 1);
  assert.strictEqual(e.cumplen.informes, 3); assert.strictEqual(e.cumplen.cumplen, 2); assert.strictEqual(e.cumplen.pct, 67);
  assert.ok(e.horas_a_informe.mediana > 17 && e.horas_a_informe.mediana < 25, String(e.horas_a_informe.mediana));
  assert.strictEqual(e.equipo_semana, 3);                 // incluye a Laura
});
t('la racha salta el fin de semana y no la rompe un hoy todavía sin informe', () => {
  // Lunes 28 de septiembre, sin informe hoy; hubo el viernes 25 y el jueves 24.
  const lunes = Date.parse('2026-09-28T15:00:00Z');
  const r = estadisticas([
    {evaluator:'A', status:'issued', issued_at:'2026-09-25T18:00:00Z'},
    {evaluator:'A', status:'issued', issued_at:'2026-09-24T18:00:00Z'},
  ], {ahora:lunes}).racha;
  assert.strictEqual(r, 2);
});
t('sin datos no se rompe', () => {
  const e = estadisticas([], {ahora:AHORA});
  assert.strictEqual(e.racha, 0); assert.strictEqual(e.cumplen.pct, null); assert.strictEqual(e.horas_a_informe.mediana, null);
});

console.log(`\n${n} pruebas · todo en verde`);

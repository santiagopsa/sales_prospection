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

console.log('pulso de las vacantes');
{
  const { pulsoVacante, pulsoVacantes } = require('../rules');
  const AH = Date.parse('2026-09-24T15:00:00Z');
  const d = n => new Date(AH - n * 86400000).toISOString();
  const em = (vid, cumple, total, dias) => ({vacancy_id:vid, status:'issued', issued_at:d(dias), updated_at:d(dias), req_total:total, req_cumple:cumple});
  const pr = (vid, dias) => ({vacancy_id:vid, status:'draft', started_at:d(dias), updated_at:d(dias)});
  const V = [
    {id:1, title:'Terna lista', created_at:d(40)},                  // vieja pero movida: 3 cumplen todo
    {id:2, title:'Una apta',    created_at:d(5)},                   // nueva, 1 cumple, 1 en proceso
    {id:3, title:'Nadie cumple', created_at:d(30)},                 // movida, 2 validados sin cumplir
    {id:4, title:'Quieta',      created_at:d(60)},                  // sin movimiento en 14 días
    {id:5, title:'Cerrada',     created_at:d(3), status:'cerrada'}, // cerrada: nunca en movimiento
    {id:6, title:'Nueva vacía', created_at:d(2)},                   // nueva, sin candidatos
  ];
  const S = [em(1,3,3,2), em(1,2,2,20), em(1,3,3,25), em(1,1,3,4),
             em(2,2,2,1), pr(2,0),
             em(3,1,3,6), em(3,0,3,3),
             em(4,3,3,30), em(4,3,3,31),
             em(5,3,3,1)];
  t('terna completa → alta, aunque la vacante sea vieja, si tuvo movimiento', () => {
    const p = pulsoVacante(V[0], S, {ahora:AH});
    assert.strictEqual(p.reciente, true); assert.strictEqual(p.motivo, 'actividad');
    assert.strictEqual(p.validados, 4); assert.strictEqual(p.aptos, 3); assert.strictEqual(p.parciales, 1);
    assert.strictEqual(p.probabilidad, 'alta'); assert.strictEqual(p.faltan, 0);
    assert.match(p.razon, /Terna lista/);
  });
  t('una apta → media y dice cuántos faltan', () => {
    const p = pulsoVacante(V[1], S, {ahora:AH});
    assert.strictEqual(p.probabilidad, 'media'); assert.strictEqual(p.faltan, 2); assert.strictEqual(p.en_proceso, 1);
    assert.match(p.razon, /1 cumple todo; faltan 2 para la terna y hay 1 en proceso/);
  });
  t('validados sin ninguno que cumpla todo → baja, con la razón', () => {
    const p = pulsoVacante(V[2], S, {ahora:AH});
    assert.strictEqual(p.probabilidad, 'baja'); assert.strictEqual(p.parciales, 1); assert.strictEqual(p.no_cumplen, 1);
    assert.match(p.razon, /Ninguno de los 2 validados cumple todo/);
  });
  t('dos en proceso sin aptos → media: hay con qué completar la terna', () => {
    const p = pulsoVacante({id:9, created_at:d(1)}, [pr(9,0), pr(9,1)], {ahora:AH});
    assert.strictEqual(p.probabilidad, 'media'); assert.match(p.razon, /hay 2 en proceso/);
  });
  t('sin movimiento en 14 días no está en movimiento; cerrada nunca, y sin probabilidad', () => {
    assert.strictEqual(pulsoVacante(V[3], S, {ahora:AH}).reciente, false);
    const c = pulsoVacante(V[4], S, {ahora:AH});
    assert.strictEqual(c.reciente, false); assert.strictEqual(c.probabilidad, null);
  });
  t('nueva y vacía: en movimiento por creación, probabilidad baja', () => {
    const p = pulsoVacante(V[5], S, {ahora:AH});
    assert.strictEqual(p.reciente, true); assert.strictEqual(p.motivo, 'nueva'); assert.strictEqual(p.probabilidad, 'baja');
    assert.match(p.razon, /Sin candidatos verificados/);
  });
  t('lista ordenada por probabilidad y resumen solo de las que están en movimiento', () => {
    const r = pulsoVacantes(V, S, {ahora:AH});
    assert.deepStrictEqual(r.vacantes.filter(p => p.reciente).map(p => p.id), [1, 2, 3, 6]);
    assert.strictEqual(r.resumen.recientes, 4);
    assert.strictEqual(r.resumen.validados, 4 + 1 + 2);
    assert.strictEqual(r.resumen.aptos, 3 + 1);
    assert.deepStrictEqual([r.resumen.alta, r.resumen.media, r.resumen.baja], [1, 1, 2]);
    assert.strictEqual(r.resumen.validados_recientes, 2 + 1 + 2);  // emitidos en 14 días
  });
  t('ids como texto (pg) cuadran con números', () => {
    assert.strictEqual(pulsoVacante({id:'1', created_at:d(1)}, [{...em(1,3,3,1)}], {ahora:AH}).validados, 1);
  });
}

console.log('indicadores de la semana');
{
  const { indicadoresSemana } = require('../rules');
  const AH = Date.parse('2026-09-24T15:00:00Z');          // jueves 24, 10 a. m. en Colombia
  const V = [
    {id:1, title:'SAP PP', company_name:'IDOM', created_at:'2026-08-01T15:00:00Z'},
    {id:2, title:'SAP MM', company_name:'idom ', created_at:'2026-09-22T15:00:00Z'},   // nueva esta semana; misma empresa escrita distinto
    {id:3, title:'Data', company_name:'Movizzon', created_at:'2026-08-01T15:00:00Z'},
    {id:4, title:'BI', company_name:'Rappi', created_at:'2026-08-01T15:00:00Z'},        // activa, sin trabajar
    {id:5, title:'Vieja', company_name:'Alpina', created_at:'2026-07-01T15:00:00Z', status:'cerrada'},
    {id:6, title:'SAP FI', company_name:'IDOM', created_at:'2026-08-01T15:00:00Z'},
  ];
  const inf = (vid, ev, dia, cumple, total, sem='verde') => ({vacancy_id:vid, evaluator:ev, status:'issued', semaforo:sem,
    entrevista_at:`2026-09-${dia}T14:00:00Z`, issued_at:`2026-09-${dia}T20:00:00Z`, req_total:total, req_cumple:cumple});
  const S = [
    inf(1,'Weimar','21',3,3), inf(1,'Weimar','22',3,3), inf(1,'Laura','23',2,3,'amarillo'),
    inf(3,'Weimar','23',2,2),
    {vacancy_id:2, evaluator:'Weimar', status:'draft', entrevista_at:'2026-09-24T14:00:00Z'},   // entrevista hoy, sin informe
    inf(1,'Weimar','15',3,3), inf(1,'Weimar','16',3,3),                                          // semana pasada: la terna se completa el 21
    inf(5,'Laura','22',1,1),                                                                     // vacante cerrada, pero se trabajó
  ];
  t('semana: vacantes verificadas, calidad y empresas atendidas', () => {
    const r = indicadoresSemana(S, V, {ahora:AH});
    assert.strictEqual(r.lunes, '2026-09-21'); assert.strictEqual(r.domingo, '2026-09-27');
    const w = r.semana;
    assert.strictEqual(w.informes, 5); assert.strictEqual(w.entrevistas, 6);
    assert.strictEqual(w.vacantes_verificadas, 3);           // 1, 3 y 5
    assert.strictEqual(w.vacantes_trabajadas, 4);            // + la 2 (solo entrevista)
    assert.strictEqual(w.empresas_atendidas, 3);             // IDOM (una sola, aunque escrita distinto), Movizzon, Alpina
    assert.strictEqual(w.cumplen, 4); assert.strictEqual(w.pct_cumplen, 80);
    assert.strictEqual(w.pct_verdes, 80);
    assert.strictEqual(w.nuevas_vacantes, 1);
    assert.strictEqual(w.ternas, 1);                         // SAP PP: 15, 16 y 21
    assert.strictEqual(r.previa.informes, 2);
  });
  t('empresas: IDOM atendida con 2 de sus 3 vacantes; Rappi sin atender', () => {
    const r = indicadoresSemana(S, V, {ahora:AH});
    const idom = r.empresas.find(e => e.empresa.toLowerCase().trim() === 'idom');
    assert.strictEqual(idom.vacantes, 3); assert.strictEqual(idom.trabajadas, 2); assert.strictEqual(idom.atendida, true);
    const rappi = r.empresas.find(e => e.empresa === 'Rappi');
    assert.strictEqual(rappi.atendida, false); assert.strictEqual(rappi.trabajadas, 0);
    assert.strictEqual(r.empresas[r.empresas.length - 1].empresa, 'Rappi');   // las sin atender al final
    assert.strictEqual(r.empresas_con_vacantes, 4);
  });
  t('por día, de lunes a domingo, con hoy y lo que falta marcado', () => {
    const r = indicadoresSemana(S, V, {ahora:AH});
    assert.strictEqual(r.dias.length, 7);
    const mar = r.dias[1];
    assert.strictEqual(mar.fecha, '2026-09-22'); assert.strictEqual(mar.informes, 2); assert.strictEqual(mar.nuevas_vacantes, 1);
    assert.strictEqual(mar.empresas_atendidas, 2);
    assert.strictEqual(r.dias[3].entrevistas, 1); assert.strictEqual(r.dias[3].futuro, false);
    assert.strictEqual(r.dias[4].futuro, true); assert.strictEqual(r.dias[5].habil, false);
  });
  t('filtrado por evaluador: sus números, pero ternas y vacantes nuevas del equipo', () => {
    const r = indicadoresSemana(S, V, {ahora:AH, evaluador:'weimar'});
    assert.strictEqual(r.semana.informes, 3); assert.strictEqual(r.semana.empresas_atendidas, 2);
    assert.strictEqual(r.semana.ternas, 1); assert.strictEqual(r.semana.nuevas_vacantes, 1);
  });
  t('otra semana y fechas inválidas o futuras', () => {
    assert.strictEqual(indicadoresSemana(S, V, {ahora:AH, fecha:'2026-09-16'}).semana.informes, 2);
    assert.strictEqual(indicadoresSemana(S, V, {ahora:AH, fecha:'2027-01-01'}).lunes, '2026-09-21');
    assert.strictEqual(indicadoresSemana(S, V, {ahora:AH, fecha:'basura'}).lunes, '2026-09-21');
  });
  t('tasas de 28 días y tendencia de 8 semanas', () => {
    const r = indicadoresSemana(S, V, {ahora:AH});
    assert.strictEqual(r.tasas.hasta, '2026-09-24');
    assert.strictEqual(r.tasas.entrevista_a_informe.num, 7); assert.strictEqual(r.tasas.entrevista_a_informe.den, 8);
    assert.strictEqual(r.tasas.cumplen_todo.pct, 86);        // 6 de 7
    assert.strictEqual(r.tasas.vacantes_con_apto.num, 3); assert.strictEqual(r.tasas.vacantes_con_apto.den, 4);
    assert.strictEqual(r.tendencia.length, 8); assert.strictEqual(r.tendencia[7].informes, 5); assert.strictEqual(r.tendencia[6].informes, 2);
  });
  t('sin datos no se rompe', () => {
    const r = indicadoresSemana([], [], {ahora:AH});
    assert.strictEqual(r.semana.pct_cumplen, null); assert.strictEqual(r.empresas.length, 0); assert.strictEqual(r.tasas.cumplen_todo.pct, null);
  });
}

console.log(`\n${n} pruebas · todo en verde`);

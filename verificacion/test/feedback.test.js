// Lo que dice el cliente: la lectura de cada rechazo, la limpieza, la guía y los indicadores.
const assert = require('assert');
const F = require('../feedback');
let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };
const REQS = [{ id: 10, text: 'Rollouts' }, { id: 11, text: 'Listas de materiales' }];

t('la lectura sale del nivel que dio la verificación', () => {
  const L = x => F.lecturaFeedback({ con_sesion: true, ...x });
  assert.strictEqual(L({ motivo: 'requisito', requirement_id: 10, nivel: 5 }), 'desacuerdo');
  assert.strictEqual(L({ motivo: 'requisito', requirement_id: 10, nivel: 4 }), 'desacuerdo');
  assert.strictEqual(L({ motivo: 'requisito', requirement_id: 10, nivel: 3 }), 'advertido');
  assert.strictEqual(L({ motivo: 'requisito', requirement_id: 10, nivel: null }), 'sin_medir');
  assert.strictEqual(L({ motivo: 'seniority', requirement_id: null }), 'oculto');
  assert.strictEqual(L({ motivo: 'salario', requirement_id: 10, nivel: 5 }), 'no_calidad');
  assert.strictEqual(L({ motivo: 'cambio_perfil', requirement_id: null }), 'cambio_perfil');
  assert.strictEqual(F.lecturaFeedback({ motivo: 'requisito', requirement_id: 10, con_sesion: false }), 'general');
});

t('cada lectura solo admite el ajuste que tiene sentido', () => {
  const end = { tipo: 'endurecer', requirement_id: 10, criterio: 'Más' };
  assert.ok(F.normalizarPropuesta(end, { lectura: 'desacuerdo', requisitos: REQS }));
  assert.strictEqual(F.normalizarPropuesta(end, { lectura: 'advertido', requisitos: REQS }), null);
  assert.strictEqual(F.normalizarPropuesta(end, { lectura: 'no_calidad', requisitos: REQS }), null);
  assert.strictEqual(F.normalizarPropuesta({ ...end, requirement_id: 99 }, { lectura: 'desacuerdo', requisitos: REQS }), null);
  assert.strictEqual(F.normalizarPropuesta({ tipo: 'endurecer', requirement_id: 10 }, { lectura: 'desacuerdo', requisitos: REQS }), null);
  assert.ok(F.normalizarPropuesta({ tipo: 'requisito', texto: 'SAP BW' }, { lectura: 'oculto', requisitos: REQS }));
  assert.strictEqual(F.normalizarPropuesta({ tipo: 'requisito', texto: '' }, { lectura: 'oculto', requisitos: REQS }), null);
  assert.ok(F.normalizarPropuesta({ tipo: 'rasgo', rasgo: 'Reconoce errores' }, { lectura: 'oculto', requisitos: REQS }));
  assert.strictEqual(F.normalizarPropuesta({ tipo: 'borrar_todo' }, { lectura: 'oculto', requisitos: REQS }), null);
});

t('lo que llega se limpia; el nivel lo pone el servidor', () => {
  assert.ok(F.normalizarFeedback({ motivo: 'inventado', cita: 'x' }, { requisitos: REQS }).error);
  assert.ok(F.normalizarFeedback({ motivo: 'requisito', requirement_id: 99, cita: 'x' }, { requisitos: REQS }).error);
  assert.ok(F.normalizarFeedback({ motivo: 'requisito', requirement_id: 10 }, { requisitos: REQS }).error);
  const r = F.normalizarFeedback({ motivo: 'requisito', requirement_id: 10, cita: ' no sabía ', nivel_wei: 1,
    propuesta: { tipo: 'endurecer', requirement_id: 10, criterio: 'c' } }, { requisitos: REQS, con_sesion: true, nivel: 5 });
  assert.strictEqual(r.lectura, 'desacuerdo'); assert.strictEqual(r.nivel_wei, 5);
  assert.strictEqual(r.requisito_texto, 'Rollouts'); assert.strictEqual(r.cita, 'no sabía');
  assert.strictEqual(r.propuesta_estado, 'pendiente');
  const s = F.normalizarFeedback({ motivo: 'salario', cita: 'caro', propuesta: { tipo: 'requisito', texto: 'x' } }, { requisitos: REQS, con_sesion: true });
  assert.strictEqual(s.propuesta, null); assert.strictEqual(s.propuesta_estado, null);
});

t('a la guía vuelve lo del levantamiento primero y después lo más reciente', () => {
  const r = F.rechazosVacante({ ai_raw: { descartes_previos: 'Sabían la teoría' }, created_at: '2026-09-01' }, [
    { id: 1, motivo: 'requisito', cita: 'viejo', created_at: '2026-09-10', requirement_id: 10 },
    { id: 2, motivo: 'salario', cita: 'nuevo', created_at: '2026-09-20' }]);
  assert.deepStrictEqual(r.map(x => x.origen), ['levantamiento', 'feedback', 'feedback']);
  assert.strictEqual(r[1].cita, 'nuevo'); assert.strictEqual(r[2].motivo_txt, 'Un requisito técnico');
  assert.deepStrictEqual(F.rechazosVacante({}, []), []);
  const dup = F.rechazosVacante({}, [{ motivo: 'requisito', resumen: 'Flojo en X', created_at: '1' }, { motivo: 'requisito', resumen: 'flojo en x ', created_at: '2' }]);
  assert.strictEqual(dup.length, 1, 'lo repetido se dice una vez');
});

t('el acierto cuenta los entrevistados que se cayeron por algo que dimos por cumplido', () => {
  const AH = new Date('2026-10-08T12:00:00Z').getTime();
  const S = [
    { id: 1, status: 'issued', evaluator: 'W', cliente_resultado: 'No avanzó', cliente_resultado_at: '2026-10-01' },
    { id: 2, status: 'issued', evaluator: 'W', cliente_resultado: 'Lo contrató', cliente_resultado_at: '2026-10-02' },
    { id: 3, status: 'issued', evaluator: 'A', cliente_resultado: 'No avanzó', cliente_resultado_at: '2026-10-03' },
    { id: 4, status: 'issued', evaluator: 'W', cliente_resultado: 'No lo entrevistó', cliente_resultado_at: '2026-10-03' },
    { id: 5, status: 'issued', evaluator: 'W', cliente_resultado: 'No avanzó', cliente_resultado_at: '2026-01-03' },   // fuera de la ventana
  ];
  const FBK = [
    { session_id: 1, lectura: 'desacuerdo', motivo: 'requisito', company_name: 'Alpina', created_at: '2026-10-02', propuesta_estado: 'pendiente' },
    { session_id: 1, lectura: 'desacuerdo', motivo: 'requisito', company_name: 'Alpina', created_at: '2026-10-02' },
    { session_id: 3, lectura: 'no_calidad', motivo: 'salario', company_name: 'Nutresa', created_at: '2026-10-04' },
    { session_id: null, lectura: 'oculto', motivo: 'requisito', company_name: 'Alpina', created_at: '2026-10-05', propuesta_estado: 'aceptada' },
  ];
  const i = F.indicadoresFeedback(FBK, S, { ahora: AH });
  assert.strictEqual(i.entrevistados, 3); assert.strictEqual(i.no_avanzaron, 2); assert.strictEqual(i.sin_feedback, 0);
  assert.deepStrictEqual(i.falsos_positivos, { num: 1, den: 3, pct: 33 });   // un candidato, aunque tenga dos filas
  assert.strictEqual(i.acierto.pct, 67);
  assert.strictEqual(i.lecturas.desacuerdo, 2); assert.strictEqual(i.lecturas.oculto, 1);
  assert.strictEqual(i.empresas[0].empresa, 'Alpina'); assert.strictEqual(i.empresas[0].desacuerdo, 2);
  assert.strictEqual(i.propuestas_pendientes, 1); assert.strictEqual(i.ajustes_aceptados, 1);
  const w = F.indicadoresFeedback(FBK, S, { ahora: AH, evaluador: 'A' });
  assert.strictEqual(w.entrevistados, 1); assert.strictEqual(w.falsos_positivos.num, 0);
  assert.strictEqual(w.lecturas.oculto, 0, 'lo que es sobre la vacante no es de un evaluador');
});

console.log(`\n${n} pruebas · el feedback del cliente se lee bien`);

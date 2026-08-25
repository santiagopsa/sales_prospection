// Que el prompt LLEVE el texto que dice analizar.
//
// Esta prueba existe por el peor error de todo el módulo. `buildIntakePrompt(sourceText, ...)`
// recibía el texto y NUNCA lo insertaba en el prompt: se le pedía a Claude que leyera un
// job description que jamás le llegaba. Peor que un fallo ruidoso — con el nombre de la
// empresa y el cargo en el contexto, el modelo podía completar una ficha entera inventada,
// y esa ficha se guardaba como si fuera el levantamiento del cliente.
//
// Ninguna de las otras pruebas lo veía: el stub no llama a Claude, así que el flujo pasaba
// en verde de punta a punta con el prompt vacío por dentro.
const assert = require('assert');
const { buildIntakePrompt, buildCvPrompt } = require('../prompts');

let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };

console.log('los prompts llevan lo que dicen llevar');

const JD = 'BUSCAMOS CLIENT PARTNER — PATIENT SCHEDULING. Requisito innegociable: 4 años en RCM hospitalario. Sin eso no avanzamos.';

t('el prompt del levantamiento incluye el texto completo', () => {
  const p = buildIntakePrompt(JD, { sourceType: 'jd' });
  assert.ok(p.includes(JD), 'el texto a analizar no está en el prompt');
});

t('lo incluye también en el camino de transcripción', () => {
  const p = buildIntakePrompt(JD, { sourceType: 'transcripcion' });
  assert.ok(p.includes(JD), 'el texto a analizar no está en el prompt');
});

t('lo incluye aunque no haya ningún dato de contexto', () => {
  const p = buildIntakePrompt(JD, {});
  assert.ok(p.includes(JD));
});

t('lo incluye completo, no recortado', () => {
  const largo = Array.from({ length: 400 }, (_, i) => `Línea ${i}: requisito, contexto y ruido corporativo.`).join('\n');
  const p = buildIntakePrompt(largo, { sourceType: 'jd' });
  assert.ok(p.includes('Línea 0:'), 'falta el principio del texto');
  assert.ok(p.includes('Línea 399:'), 'el texto se está recortando');
});

t('el texto va delimitado, para separarlo de las instrucciones', () => {
  const p = buildIntakePrompt(JD, {});
  assert.ok(p.includes('INICIO_DEL_TEXTO') && p.includes('FIN_DEL_TEXTO'),
    'sin marcas no se distingue el material del cliente de las instrucciones');
  assert.ok(p.indexOf('INICIO_DEL_TEXTO') < p.indexOf(JD), 'el texto debe ir dentro de las marcas');
  assert.ok(p.indexOf(JD) < p.indexOf('FIN_DEL_TEXTO'));
});

t('el contexto aportado sigue llegando', () => {
  const p = buildIntakePrompt(JD, { companyHint: 'Newark Bullhorn', roleHint: 'Client Partner', recruiter: 'Weimar' });
  assert.ok(p.includes('Newark Bullhorn') && p.includes('Client Partner') && p.includes('Weimar'));
});

t('no revienta con el texto vacío o nulo', () => {
  assert.ok(typeof buildIntakePrompt('', {}) === 'string');
  assert.ok(typeof buildIntakePrompt(null, {}) === 'string');
  assert.ok(typeof buildIntakePrompt(undefined, {}) === 'string');
});

const CV = 'DAYANA MAUSSÁ. Alpina, 2023-actualidad: Consultor SAP PP, rollout del módulo de producción.';

t('el prompt del CV incluye el CV completo', () => {
  const p = buildCvPrompt(CV, { cargo: 'Consultor SAP PP', excluyentes: [{ text: 'Rollout de PP' }] });
  assert.ok(p.includes(CV), 'el CV no está en el prompt');
  assert.ok(p.includes('INICIO_DEL_CV') && p.includes('FIN_DEL_CV'));
});

t('el prompt del CV sigue llevando los requisitos y el cargo', () => {
  const p = buildCvPrompt(CV, {
    cargo: 'Consultor SAP PP', empresa: 'IDOM', candidato: 'Dayana',
    excluyentes: [{ text: 'Rollout de PP en producción', criterio: 'Narrar un go-live completo',
                    detalles: [{ detalle: '¿Qué transacción para listas de materiales?', respuesta_esperada: 'CS01' }] }],
  });
  for (const debe of ['Consultor SAP PP', 'IDOM', 'Dayana', 'Rollout de PP en producción',
                      'Narrar un go-live completo', 'CS01']) {
    assert.ok(p.includes(debe), `falta en el prompt del CV: ${debe}`);
  }
});

t('no revienta sin CV ni requisitos', () => {
  assert.ok(typeof buildCvPrompt('', {}) === 'string');
  assert.ok(typeof buildCvPrompt(null, {}) === 'string');
});

// Guardia general: ningún parámetro de entrada puede quedarse fuera del prompt en silencio.
t('todo lo que entra sale en el prompt — marcador único', () => {
  const marca = 'MARCADOR-UNICO-DE-PRUEBA-9F2C1D4E';
  assert.ok(buildIntakePrompt(marca, {}).includes(marca), 'el levantamiento perdió su entrada');
  assert.ok(buildCvPrompt(marca, {}).includes(marca), 'el análisis de CV perdió su entrada');
});

console.log(`\n${n} pruebas · los prompts no pierden su entrada`);

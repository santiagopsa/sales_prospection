'use strict';
/**
 * Qué es este archivo.
 *
 * Existe por un error concreto: la pantalla de transcripción mandaba el nombre en
 * `name` y el servidor lo leía de `filename`. Sin nombre no hay extensión, un .docx
 * caía al camino de texto plano, y el reclutador leía "No sé leer archivos ." —
 * un bug nuestro presentado como culpa del archivo, justo en el momento en que la
 * entrevista ya pasó y lo único que queda es la transcripción.
 */
const assert = require('assert');
const A = require('../archivos');

let n = 0, fallas = 0;
function t(nombre, fn) {
  n++;
  try { fn(); }
  catch (e) { fallas++; console.log('  ✗ ' + nombre + '\n    ' + e.message); }
}

const zip = Buffer.from([0x50, 0x4B, 0x03, 0x04, 0x14, 0x00, 0x06, 0x00]);
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n', 'latin1'), Buffer.alloc(20)]);
const txt = Buffer.from('Reclutador: hola\nCandidato: hola\n', 'utf8');

// --- el nombre viene en cualquiera de los dos campos ---
t('lee filename', () => assert.strictEqual(A.nombreDe({ filename: 'a.docx' }), 'a.docx'));
t('lee name', () => assert.strictEqual(A.nombreDe({ name: 'a.docx' }), 'a.docx'));
t('filename gana si vienen los dos', () =>
  assert.strictEqual(A.nombreDe({ filename: 'a.txt', name: 'b.pdf' }), 'a.txt'));
t('cuerpo vacío no revienta', () => assert.strictEqual(A.nombreDe(null), ''));

// --- la extensión del nombre ---
t('extensión simple', () => assert.strictEqual(A.extensionDelNombre('notas.TXT'), 'txt'));
t('nombre con puntos toma la última', () =>
  assert.strictEqual(A.extensionDelNombre('Entrevista 2026.03.11 - Ana.docx'), 'docx'));
t('sin punto no inventa extensión', () =>
  assert.strictEqual(A.extensionDelNombre('Transcripción de la reunión'), ''));
t('archivo oculto sin extensión', () => assert.strictEqual(A.extensionDelNombre('.env'), ''));

// --- la firma manda cuando el nombre no dice nada ---
t('zip sin nombre se reconoce como docx', () => assert.strictEqual(A.extensionDe('', zip), 'docx'));
t('pdf sin nombre se reconoce', () => assert.strictEqual(A.extensionDe('', pdf), 'pdf'));
t('nombre bueno se respeta', () => assert.strictEqual(A.extensionDe('x.vtt', txt), 'vtt'));
t('nombre desconocido cede ante la firma', () =>
  assert.strictEqual(A.extensionDe('descarga.bin', pdf), 'pdf'));
t('buffer corto no revienta', () => assert.strictEqual(A.extensionPorFirma(Buffer.from([1])), ''));

// --- EL BUG: el .docx mandado sin nombre tiene que llegar al lector de Word ---
t('REGRESIÓN: docx sin filename ya no cae a texto plano', () => {
  const ext = A.extensionDe(A.nombreDe({ name: 'Entrevista Ana.docx' }), zip);
  assert.strictEqual(ext, 'docx');
  assert.ok(!A.PLANAS.includes(ext), 'un .docx no puede tratarse como texto plano');
});
t('REGRESIÓN: aun sin nombre alguno, la firma lo salva', () =>
  assert.strictEqual(A.extensionDe(A.nombreDe({}), zip), 'docx'));

// --- el mensaje de error no le echa la culpa al archivo con una extensión inventada ---
t('mensaje con extensión conocida la nombra', () =>
  assert.ok(A.mensajeNoLeible('xlsx').includes('archivos .xlsx')));
t('mensaje sin extensión NO dice "archivos ."', () => {
  const m = A.mensajeNoLeible('');
  assert.ok(!/archivos \.\s*$|archivos \.\./.test(m), 'mensaje roto: ' + m);
  assert.ok(m.includes('no trae extensión'), m);
});
t('el mensaje siempre ofrece la salida de pegar el texto', () => {
  ['', 'xlsx', 'zip'].forEach(e => assert.ok(A.mensajeNoLeible(e).includes('pega el texto')));
});

// --- binario vs texto ---
t('texto normal no parece binario', () => assert.ok(!A.pareceBinario(txt.toString('utf8'))));
t('zip leído como utf8 sí parece binario', () =>
  assert.ok(A.pareceBinario(Buffer.concat([zip, Buffer.from([0xff, 0xfe, 0x00, 0x81])]).toString('utf8'))));

// --- subtítulos de Meet ---
t('quita marcas de tiempo del vtt', () => {
  const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:04.000\nReclutador: cuéntame del rollout.\n\n' +
              '2\n00:00:04.500 --> 00:00:09.000\nCandidato: fue en Alpina, en 2023.\n';
  const out = A.limpiarSubtitulos(vtt);
  assert.ok(!out.includes('-->'), 'quedaron marcas de tiempo');
  assert.ok(!/^\d+$/m.test(out), 'quedaron números de bloque');
  assert.ok(out.includes('Reclutador: cuéntame del rollout.'), 'se perdió el diálogo');
  assert.ok(out.includes('Candidato: fue en Alpina, en 2023.'), 'se perdió el diálogo');
});
t('no toca una transcripción que ya es texto', () => {
  const plano = 'Reclutador: hola\nCandidato: hola';
  assert.strictEqual(A.limpiarSubtitulos(plano), plano);
});

// --- el catálogo ---
t('vtt y srt son planas', () => ['vtt', 'srt'].forEach(e => assert.ok(A.PLANAS.includes(e))));
t('docx y pdf son conocidas pero no planas', () => {
  ['docx', 'pdf'].forEach(e => {
    assert.ok(A.CONOCIDAS.includes(e));
    assert.ok(!A.PLANAS.includes(e));
  });
});

console.log(`archivos: ${n - fallas}/${n} pruebas pasaron`);
process.exit(fallas ? 1 : 0);

// Verifica que el versionado de estáticos no se rompa en silencio.
// Si alguien cambia cómo index.html enlaza sus assets, el reemplazo del servidor deja de
// aplicar y el navegador vuelve a servir la versión vieja sin que nadie se entere.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
let n = 0;
const t = (nombre, fn) => { fn(); n++; console.log('  ✓', nombre); };

console.log('versionado de estáticos');
t('index.html enlaza el css tal como el servidor espera reemplazarlo', () => {
  assert.ok(html.includes('href="style.css"'), 'el <link> del css cambió de forma');
  assert.ok(app.includes(`'href="style.css"'`), 'el servidor busca otro patrón');
});
t('index.html enlaza el js tal como el servidor espera reemplazarlo', () => {
  assert.ok(html.includes('src="app.js"'), 'el <script> cambió de forma');
  assert.ok(app.includes(`'src="app.js"'`), 'el servidor busca otro patrón');
});
t('el codificador de QR va versionado y carga antes que la app', () => {
  assert.ok(html.includes('src="qr.js"'), 'falta el <script> de qr.js');
  assert.ok(html.indexOf('src="qr.js"') < html.indexOf('src="app.js"'), 'qr.js tiene que cargar antes que app.js');
  assert.ok(app.includes(`'src="qr.js"'`), 'el servidor no versiona qr.js');
  assert.ok(app.includes(`'index.html', 'qr.js'`), 'qr.js no entra en el hash de versión');
});
t('el QR no depende de ningún servicio externo', () => {
  const qr = fs.readFileSync(path.join(__dirname, '..', 'public', 'qr.js'), 'utf8');
  assert.ok(!/https?:\/\/(?!www\.w3\.org)/.test(qr), 'qr.js no puede pedirle la imagen a un tercero');
  assert.ok(!/fetch\(|XMLHttpRequest/.test(qr), 'el QR se genera en el cliente, sin red');
});
t('las rutas son relativas, no absolutas', () => {
  assert.ok(!html.includes('href="/style.css"'), 'una ruta absoluta rompe el montaje bajo /verificacion');
  assert.ok(!html.includes('src="/app.js"'), 'una ruta absoluta rompe el montaje bajo /verificacion');
  assert.ok(!html.includes('src="/qr.js"'), 'una ruta absoluta rompe el montaje bajo /verificacion');
});
t('el índice se sirve sin caché y los assets con caché larga', () => {
  assert.ok(app.includes("'Cache-Control', 'no-cache'"), 'el index debe revalidarse siempre');
  assert.ok(app.includes("maxAge: '365d'"), 'los assets versionados pueden cachearse fuerte');
});
t('la versión se calcula a partir del contenido de los archivos', () => {
  assert.ok(app.includes("createHash('sha1')"), 'la versión debe salir del contenido, no de un número a mano');
});

console.log(`\n${n} pruebas · el versionado está bien enganchado`);

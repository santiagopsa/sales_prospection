#!/usr/bin/env node
// Instalador de PeakU Verificado dentro del repo del Sandler.
//
//   node verificacion/instalar.js
//
// Aplica tres cambios en el repo, todos idempotentes (correrlo dos veces no hace nada la segunda):
//   1. server.js — monta el router en /verificacion antes del SPA fallback
//   2. server.js — sube el límite del body de 4mb a 12mb (los archivos llegan en base64)
//   3. package.json — agrega mammoth y pdf-parse para leer .docx y .pdf
//
// No toca nada más. Si algo no calza, avisa y no escribe: se aplica a mano con lo que imprime.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SERVER = path.join(ROOT, 'server.js');
const PKG = path.join(ROOT, 'package.json');

const MOUNT = `// ---------- PeakU Verificado ----------
// Se monta sobre el mismo pool y la misma base de datos. Sus tablas viven en el schema
// "verificacion", así que no toca deals ni wishlist. Si el módulo falta, el Sandler arranca igual.
try {
  const verificacion = require('./verificacion/app');
  app.use('/verificacion', verificacion.router({
    pool,
    anthropic,
    model: process.env.VERIF_MODEL || ANALYZE_MODEL,
  }));
  verificacion.initSchema(pool).catch(e => console.error('[verificacion] schema:', e.message));
  console.log('[verificacion] montada en /verificacion');
} catch (e) {
  console.error('[verificacion] no se pudo montar:', e.message);
}

`;

const ok = [], warn = [];

// --- server.js -------------------------------------------------------------
if (!fs.existsSync(SERVER)) {
  console.error('✗ No encuentro server.js en', ROOT);
  console.error('  Corre esto desde la raíz del repo del Sandler: node verificacion/instalar.js');
  process.exit(1);
}
let s = fs.readFileSync(SERVER, 'utf8');
const original = s;

// 1. montaje
if (s.includes("require('./verificacion/app')")) {
  ok.push('El montaje en /verificacion ya estaba.');
} else {
  const ancla = s.match(/\n\/\/ SPA fallback\n/);
  if (ancla) {
    s = s.replace(/\n\/\/ SPA fallback\n/, '\n' + MOUNT + '// SPA fallback\n');
    ok.push('Montaje insertado antes del SPA fallback.');
  } else {
    // Sin el comentario: se ancla al app.get('*') final.
    const alt = s.lastIndexOf("app.get('*'");
    if (alt === -1) {
      warn.push('No encontré dónde insertar el montaje. Pégalo a mano justo ANTES de app.get(\'*\'):\n\n' + MOUNT);
    } else {
      s = s.slice(0, alt) + MOUNT + s.slice(alt);
      ok.push("Montaje insertado antes de app.get('*').");
    }
  }
}

// 2. límite del body
// Un archivo de 9 MB en base64 pesa ~12 MB. Con el límite en 4mb, el navegador recibe un 413
// justo después de que el reclutador arrastró el archivo — el peor momento posible.
if (/express\.json\(\s*\{\s*limit:\s*'12mb'/.test(s)) {
  ok.push('El límite del body ya estaba en 12mb.');
} else if (/express\.json\(\s*\{\s*limit:\s*'4mb'\s*\}\s*\)/.test(s)) {
  s = s.replace(/express\.json\(\s*\{\s*limit:\s*'4mb'\s*\}\s*\)/, "express.json({ limit: '12mb' })");
  ok.push('Límite del body subido de 4mb a 12mb (los archivos llegan en base64).');
} else {
  warn.push("No pude ajustar el límite del body. Busca express.json({ limit: ... }) en server.js y súbelo a '12mb'.\n" +
            '  Sin eso, subir un archivo grande falla con 413 y solo funciona pegar el texto.');
}

if (s !== original) {
  fs.copyFileSync(SERVER, SERVER + '.bak');
  fs.writeFileSync(SERVER, s);
  ok.push('Respaldo del original en server.js.bak');
}

// --- package.json ----------------------------------------------------------
if (fs.existsSync(PKG)) {
  const pkg = JSON.parse(fs.readFileSync(PKG, 'utf8'));
  pkg.dependencies = pkg.dependencies || {};
  const nuevas = [];
  if (!pkg.dependencies.mammoth) { pkg.dependencies.mammoth = '^1.8.0'; nuevas.push('mammoth'); }
  if (!pkg.dependencies['pdf-parse']) { pkg.dependencies['pdf-parse'] = '^1.1.1'; nuevas.push('pdf-parse'); }
  if (nuevas.length) {
    pkg.dependencies = Object.fromEntries(Object.entries(pkg.dependencies).sort());
    fs.writeFileSync(PKG, JSON.stringify(pkg, null, 2) + '\n');
    ok.push(`Dependencias agregadas: ${nuevas.join(', ')} — corre npm install.`);
  } else {
    ok.push('mammoth y pdf-parse ya estaban en package.json.');
  }
} else {
  warn.push('No encontré package.json. Agrega mammoth y pdf-parse a mano.');
}

// --- reporte ---------------------------------------------------------------
console.log('\nPeakU Verificado · instalación\n');
ok.forEach(m => console.log('  ✓ ' + m));
warn.forEach(m => console.log('\n  ! ' + m));
console.log(`
Siguiente:
  npm install
  node server.js
  → http://localhost:3000/verificacion/

En Render no hace falta tocar nada más: usa el mismo web service, el mismo Postgres
y la misma ANTHROPIC_API_KEY. Las tablas se crean solas en el schema "verificacion"
la primera vez que arranca, en el deploy que sale de este commit.
`);
process.exit(warn.length ? 2 : 0);

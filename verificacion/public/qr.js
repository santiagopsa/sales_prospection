// Codificador QR propio: modo byte, nivel de corrección M, versiones 1 a 10.
//
// Por qué no un servicio externo (api.qrserver.com y parecidos): el código del acta
// viajaría a un tercero que quedaría con el registro de qué informe se consulta y cuándo,
// y un acta impresa terminaría con un cuadro roto el día que ese servicio se caiga.
// Un acta es un documento: no puede depender de la infraestructura de nadie más.
//
// Nivel M corrige ~15% de daño — suficiente para una pantalla compartida o un PDF impreso.
// Sale como SVG porque el acta se imprime, y un PNG a 300dpi se ve mordido.
//
// Funciona igual en Node (module.exports) y en el navegador (window.QR).
(function (raiz) {
  'use strict';

  // --- Aritmética en GF(256), el campo del Reed-Solomon del QR (polinomio 0x11D) ---
  var EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (function () {
    var x = 1;
    for (var i = 0; i < 255; i++) { EXP[i] = x; LOG[x] = i; x <<= 1; if (x & 0x100) x ^= 0x11D; }
    for (var j = 255; j < 512; j++) EXP[j] = EXP[j - 255];
  })();
  function mul(a, b) { return (a === 0 || b === 0) ? 0 : EXP[LOG[a] + LOG[b]]; }

  // Polinomio generador de grado n: producto de (x - α^i), i = 0..n-1.
  function genPoly(n) {
    var g = [1];
    for (var i = 0; i < n; i++) {
      var ng = new Array(g.length + 1).fill(0);
      for (var j = 0; j < g.length; j++) { ng[j] ^= g[j]; ng[j + 1] ^= mul(g[j], EXP[i]); }
      g = ng;
    }
    return g;
  }

  // Residuo de dividir los datos por el generador: son los códigos de corrección.
  function ecc(datos, n) {
    var g = genPoly(n), buf = datos.concat(new Array(n).fill(0));
    for (var i = 0; i < datos.length; i++) {
      var f = buf[i];
      if (!f) continue;
      for (var j = 1; j < g.length; j++) buf[i + j] ^= mul(g[j], f);
    }
    return buf.slice(datos.length);
  }

  // --- Tablas de la norma, solo para nivel M y versiones 1..10 ---
  // [códigos de corrección por bloque, bloques grupo 1, datos por bloque g1, bloques g2, datos g2]
  var M = {
    1:  [10, 1, 16, 0, 0],
    2:  [16, 1, 28, 0, 0],
    3:  [26, 1, 44, 0, 0],
    4:  [18, 2, 32, 0, 0],
    5:  [24, 2, 43, 0, 0],
    6:  [16, 4, 27, 0, 0],
    7:  [18, 4, 31, 0, 0],
    8:  [22, 2, 38, 2, 39],
    9:  [22, 3, 36, 2, 37],
    10: [26, 4, 43, 1, 44],
  };
  // Centros de los patrones de alineación por versión.
  var ALIN = {
    1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
    6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50],
  };

  function datosTotales(v) { var t = M[v]; return t[1] * t[2] + t[3] * t[4]; }
  // Capacidad en bytes: los datos menos la cabecera (4 bits de modo + el contador).
  function capacidad(v) { return datosTotales(v) - (v >= 10 ? 3 : 2); }

  function versionPara(nBytes) {
    for (var v = 1; v <= 10; v++) if (capacidad(v) >= nBytes) return v;
    return 0;
  }

  function utf8(texto) {
    var s = unescape(encodeURIComponent(String(texto))), b = [];
    for (var i = 0; i < s.length; i++) b.push(s.charCodeAt(i) & 0xff);
    return b;
  }

  // --- Bits de datos: modo byte + contador + carga + relleno ---
  function bitsDeDatos(bytes, v) {
    var bits = [];
    var push = function (valor, n) { for (var i = n - 1; i >= 0; i--) bits.push((valor >>> i) & 1); };
    push(0b0100, 4);                       // modo byte
    push(bytes.length, v >= 10 ? 16 : 8);  // el contador crece a partir de la versión 10
    for (var i = 0; i < bytes.length; i++) push(bytes[i], 8);

    var cap = datosTotales(v) * 8;
    for (var t = 0; t < 4 && bits.length < cap; t++) bits.push(0);   // terminador
    while (bits.length % 8) bits.push(0);                            // cierre de byte
    var relleno = [0xEC, 0x11], k = 0;
    while (bits.length < cap) { push(relleno[k++ % 2], 8); }

    var cw = [];
    for (var p = 0; p < bits.length; p += 8) {
      var b = 0;
      for (var q = 0; q < 8; q++) b = (b << 1) | bits[p + q];
      cw.push(b);
    }
    return cw;
  }

  // --- Bloques y entrelazado ---
  function codewords(texto, v) {
    var t = M[v], nEc = t[0];
    var datos = bitsDeDatos(utf8(texto), v);
    var bloques = [], correc = [], pos = 0, i;
    for (i = 0; i < t[1]; i++) { bloques.push(datos.slice(pos, pos + t[2])); pos += t[2]; }
    for (i = 0; i < t[3]; i++) { bloques.push(datos.slice(pos, pos + t[4])); pos += t[4]; }
    for (i = 0; i < bloques.length; i++) correc.push(ecc(bloques[i], nEc));

    var out = [], max = Math.max.apply(null, bloques.map(function (b) { return b.length; })), j;
    for (i = 0; i < max; i++) for (j = 0; j < bloques.length; j++) if (i < bloques[j].length) out.push(bloques[j][i]);
    for (i = 0; i < nEc; i++) for (j = 0; j < correc.length; j++) out.push(correc[j][i]);
    return out;
  }

  // --- Matriz ---
  function nueva(size) {
    var m = [], r;
    for (r = 0; r < size; r++) m.push(new Array(size).fill(false));
    return m;
  }

  function construir(texto, v) {
    var size = 17 + 4 * v;
    var mat = nueva(size), fija = nueva(size);   // "fija" = módulo de función, no lleva datos
    var i, j;

    function set(fil, col, oscuro) {
      if (fil < 0 || col < 0 || fil >= size || col >= size) return;
      mat[fil][col] = !!oscuro; fija[fil][col] = true;
    }

    // Localizadores (incluye el separador blanco alrededor).
    function localizador(cf, cc) {
      for (var dy = -4; dy <= 4; dy++) for (var dx = -4; dx <= 4; dx++) {
        var d = Math.max(Math.abs(dx), Math.abs(dy));
        set(cf + dy, cc + dx, d !== 2 && d !== 4);
      }
    }
    localizador(3, 3); localizador(3, size - 4); localizador(size - 4, 3);

    // Sincronización.
    for (i = 0; i < size; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }

    // Alineación, saltando los tres cruces con los localizadores.
    var cen = ALIN[v], n = cen.length;
    for (i = 0; i < n; i++) for (j = 0; j < n; j++) {
      if ((i === 0 && j === 0) || (i === 0 && j === n - 1) || (i === n - 1 && j === 0)) continue;
      for (var dy2 = -2; dy2 <= 2; dy2++) for (var dx2 = -2; dx2 <= 2; dx2++)
        set(cen[i] + dy2, cen[j] + dx2, Math.max(Math.abs(dx2), Math.abs(dy2)) !== 1);
    }

    // Reserva de las áreas de formato y de versión (se rellenan después).
    for (i = 0; i <= 8; i++) { set(8, i, false); set(i, 8, false); }
    for (i = 0; i < 8; i++) { set(8, size - 1 - i, false); set(size - 1 - i, 8, false); }
    set(size - 8, 8, true);   // módulo oscuro fijo
    if (v >= 7) {
      var rv = v;
      for (i = 0; i < 12; i++) rv = (rv << 1) ^ ((rv >>> 11) * 0x1F25);
      var bv = (v << 12) | rv;
      for (i = 0; i < 18; i++) {
        var bit = ((bv >>> i) & 1) === 1, a = size - 11 + (i % 3), b = Math.floor(i / 3);
        set(b, a, bit); set(a, b, bit);
      }
    }

    // Datos en zigzag, saltando la columna 6 (la de sincronización).
    var cw = codewords(texto, v), bit_i = 0, dir = -1, fil = size - 1;
    for (var col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;
      for (;;) {
        for (var c = 0; c < 2; c++) {
          var cc = col - c;
          if (!fija[fil][cc]) {
            var val = false;
            if (bit_i < cw.length * 8) val = ((cw[bit_i >> 3] >>> (7 - (bit_i & 7))) & 1) === 1;
            mat[fil][cc] = val; bit_i++;
          }
        }
        fil += dir;
        if (fil < 0 || fil >= size) { fil -= dir; dir = -dir; break; }
      }
    }
    return { mat: mat, fija: fija, size: size };
  }

  var MASCARAS = [
    function (i, j) { return (i + j) % 2 === 0; },
    function (i) { return i % 2 === 0; },
    function (i, j) { return j % 3 === 0; },
    function (i, j) { return (i + j) % 3 === 0; },
    function (i, j) { return (Math.floor(i / 2) + Math.floor(j / 3)) % 2 === 0; },
    function (i, j) { return (i * j) % 2 + (i * j) % 3 === 0; },
    function (i, j) { return ((i * j) % 2 + (i * j) % 3) % 2 === 0; },
    function (i, j) { return ((i + j) % 2 + (i * j) % 3) % 2 === 0; },
  ];

  function formato(mascara) {
    var d = (0b00 << 3) | mascara;   // 00 = nivel M
    var rem = d;
    for (var i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    return ((d << 10) | rem) ^ 0x5412;
  }

  function ponerFormato(mat, size, mascara) {
    var b = formato(mascara), i;
    var g = function (k) { return ((b >>> k) & 1) === 1; };
    for (i = 0; i <= 5; i++) mat[i][8] = g(i);
    mat[7][8] = g(6); mat[8][8] = g(7); mat[8][7] = g(8);
    for (i = 9; i < 15; i++) mat[8][14 - i] = g(i);
    for (i = 0; i < 8; i++) mat[8][size - 1 - i] = g(i);
    for (i = 8; i < 15; i++) mat[size - 15 + i][8] = g(i);
    mat[size - 8][8] = true;
  }

  // Penalización de la norma: la máscara buena es la que deja el dibujo menos confuso.
  function penalizacion(mat, size) {
    var p = 0, i, j, oscuros = 0;

    function corridas(get) {
      var total = 0;
      for (var a = 0; a < size; a++) {
        var run = 1, prev = get(a, 0), hist = [];
        for (var b = 1; b < size; b++) {
          var v = get(a, b);
          if (v === prev) { run++; }
          else { if (run >= 5) total += 3 + (run - 5); hist.push(run); run = 1; prev = v; }
        }
        if (run >= 5) total += 3 + (run - 5);
      }
      return total;
    }
    p += corridas(function (a, b) { return mat[a][b]; });
    p += corridas(function (a, b) { return mat[b][a]; });

    for (i = 0; i < size - 1; i++) for (j = 0; j < size - 1; j++) {
      var v0 = mat[i][j];
      if (v0 === mat[i][j + 1] && v0 === mat[i + 1][j] && v0 === mat[i + 1][j + 1]) p += 3;
    }

    var A = [true, false, true, true, true, false, true, false, false, false, false];
    var B = [false, false, false, false, true, false, true, true, true, false, true];
    function coincide(get, a, b, pat) {
      for (var k = 0; k < 11; k++) if (get(a, b + k) !== pat[k]) return false;
      return true;
    }
    for (i = 0; i < size; i++) for (j = 0; j + 11 <= size; j++) {
      if (coincide(function (x, y) { return mat[x][y]; }, i, j, A)) p += 40;
      if (coincide(function (x, y) { return mat[x][y]; }, i, j, B)) p += 40;
      if (coincide(function (x, y) { return mat[y][x]; }, i, j, A)) p += 40;
      if (coincide(function (x, y) { return mat[y][x]; }, i, j, B)) p += 40;
    }

    for (i = 0; i < size; i++) for (j = 0; j < size; j++) if (mat[i][j]) oscuros++;
    var pct = oscuros * 100 / (size * size);
    p += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return p;
  }

  // Devuelve la matriz final de módulos (true = oscuro).
  function matriz(texto) {
    var bytes = utf8(texto), v = versionPara(bytes.length);
    if (!v) throw new Error('El texto no cabe en un QR de hasta versión 10 (' + bytes.length + ' bytes).');
    var base = construir(texto, v), size = base.size;
    var mejor = null, mejorP = Infinity;
    for (var m = 0; m < 8; m++) {
      var mat = base.mat.map(function (f) { return f.slice(); });
      for (var i = 0; i < size; i++) for (var j = 0; j < size; j++)
        if (!base.fija[i][j] && MASCARAS[m](i, j)) mat[i][j] = !mat[i][j];
      ponerFormato(mat, size, m);
      var p = penalizacion(mat, size);
      if (p < mejorP) { mejorP = p; mejor = mat; }
    }
    return { modulos: mejor, size: size, version: v };
  }

  // SVG con un solo path: pesa poco y escala sin perder filo al imprimir.
  //
  // El tamaño se define en PÍXELES POR MÓDULO, no en píxeles totales, y esa no es una
  // preferencia de estilo: es la diferencia entre que el código se lea y que no.
  // Con shape-rendering="crispEdges" el navegador ajusta cada módulo a píxeles enteros;
  // si el módulo mide 2.6px, unos salen de 2 y otros de 3 y la rejilla deja de ser regular.
  // Un lector busca una rejilla uniforme: con módulos desiguales no encuentra nada, aunque
  // a simple vista el cuadrito se vea perfecto. Midiendo por módulo, el lado total siempre
  // es múltiplo entero — y sigue siéndolo con el escalado de Windows al 125% y al 150%.
  //
  // Menos de 3px por módulo no se lee en una pantalla normal. Por debajo de eso no se baja.
  var MODULO_MIN = 3;

  function svg(texto, opciones) {
    var o = opciones || {};
    var q = o.margen == null ? 4 : o.margen;          // zona tranquila, 4 módulos por norma
    var color = o.color || '#000';
    var fondo = o.fondo === null ? null : (o.fondo || '#fff');
    var r = matriz(texto), n = r.size, total = n + q * 2, d = '';
    for (var i = 0; i < n; i++) for (var j = 0; j < n; j++)
      if (r.modulos[i][j]) d += 'M' + (j + q) + ' ' + (i + q) + 'h1v1h-1z';

    // px es un objetivo aproximado: se redondea al múltiplo entero más cercano.
    var mod = o.modulo || (o.px ? Math.round(o.px / total) : 4);
    mod = Math.max(MODULO_MIN, Math.round(mod));
    var lado = total * mod;

    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + total + ' ' + total + '"' +
      ' width="' + lado + '" height="' + lado + '" data-modulo="' + mod + '"' +
      ' shape-rendering="crispEdges" role="img" aria-label="' + (o.alt || 'Código QR') + '">' +
      (fondo ? '<rect width="' + total + '" height="' + total + '" fill="' + fondo + '"/>' : '') +
      '<path fill="' + color + '" d="' + d + '"/></svg>';
  }

  var API = { matriz: matriz, svg: svg, capacidad: capacidad, versionPara: versionPara, MODULO_MIN: MODULO_MIN };
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  else raiz.QR = API;
})(typeof self !== 'undefined' ? self : this);

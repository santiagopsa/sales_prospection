#!/usr/bin/env python3
# Verificador independiente del codificador QR.
#
# No sirve de nada un QR que "se ve bien": o lo lee un celular o no sirve. Como en este
# entorno no hay librería de referencia con la cual comparar, aquí se hace lo más honesto:
# volver a implementar el DECODIFICADOR desde la norma, en otro lenguaje, y comprobar que
#   1) los bits de formato pasan su propio BCH,
#   2) los síndromes Reed-Solomon de cada bloque dan cero (o sea, la corrección es correcta),
#   3) el texto que sale es exactamente el que entró.
# Si las tres pasan, un lector real lo lee.
import json, subprocess, sys, os

RUTA = os.path.join(os.path.dirname(__file__), '..', 'public', 'qr.js')

# --- GF(256), implementado aparte del de JavaScript ---
EXP = [0] * 512
LOG = [0] * 256
_x = 1
for _i in range(255):
    EXP[_i] = _x
    LOG[_x] = _i
    _x <<= 1
    if _x & 0x100:
        _x ^= 0x11D
for _i in range(255, 512):
    EXP[_i] = EXP[_i - 255]


def gmul(a, b):
    return 0 if a == 0 or b == 0 else EXP[LOG[a] + LOG[b]]


# nivel M: [ec por bloque, bloques g1, datos g1, bloques g2, datos g2]
TABLA_M = {
    1: (10, 1, 16, 0, 0), 2: (16, 1, 28, 0, 0), 3: (26, 1, 44, 0, 0),
    4: (18, 2, 32, 0, 0), 5: (24, 2, 43, 0, 0), 6: (16, 4, 27, 0, 0),
    7: (18, 4, 31, 0, 0), 8: (22, 2, 38, 2, 39), 9: (22, 3, 36, 2, 37),
    10: (26, 4, 43, 1, 44),
}
ALIN = {1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30],
        6: [6, 34], 7: [6, 22, 38], 8: [6, 24, 42], 9: [6, 26, 46], 10: [6, 28, 50]}


def mapa_funcion(size, ver):
    """Los módulos que NO llevan datos, deducidos de la norma."""
    f = [[False] * size for _ in range(size)]

    def marca(r, c):
        if 0 <= r < size and 0 <= c < size:
            f[r][c] = True

    for (cr, cc) in [(3, 3), (3, size - 4), (size - 4, 3)]:
        for dy in range(-4, 5):
            for dx in range(-4, 5):
                marca(cr + dy, cc + dx)
    for i in range(size):
        marca(6, i)
        marca(i, 6)
    cen = ALIN[ver]
    n = len(cen)
    for i in range(n):
        for j in range(n):
            if (i, j) in [(0, 0), (0, n - 1), (n - 1, 0)]:
                continue
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    marca(cen[i] + dy, cen[j] + dx)
    for i in range(9):
        marca(8, i)
        marca(i, 8)
    for i in range(8):
        marca(8, size - 1 - i)
        marca(size - 1 - i, 8)
    marca(size - 8, 8)
    if ver >= 7:
        for i in range(18):
            a, b = size - 11 + i % 3, i // 3
            marca(b, a)
            marca(a, b)
    return f


MASCARAS = [
    lambda i, j: (i + j) % 2 == 0,
    lambda i, j: i % 2 == 0,
    lambda i, j: j % 3 == 0,
    lambda i, j: (i + j) % 3 == 0,
    lambda i, j: (i // 2 + j // 3) % 2 == 0,
    lambda i, j: (i * j) % 2 + (i * j) % 3 == 0,
    lambda i, j: ((i * j) % 2 + (i * j) % 3) % 2 == 0,
    lambda i, j: ((i + j) % 2 + (i * j) % 3) % 2 == 0,
]


def leer_formato(m, size):
    bits = []
    for i in range(6):
        bits.append(m[i][8])
    bits.append(m[7][8])
    bits.append(m[8][8])
    bits.append(m[8][7])
    for i in range(9, 15):
        bits.append(m[8][14 - i])
    v = 0
    for k, b in enumerate(bits):
        v |= (1 if b else 0) << k
    crudo = v ^ 0x5412
    # El BCH(15,5) del formato tiene que dar residuo cero: se divide por 0x537.
    r = crudo
    for i in range(14, 9, -1):
        if r >> i & 1:
            r ^= 0x537 << (i - 10)
    ok_bch = (r == 0)
    nivel = (crudo >> 13) & 0b11
    mascara = (crudo >> 10) & 0b111
    # la segunda copia tiene que decir lo mismo
    b2 = []
    for i in range(8):
        b2.append(m[8][size - 1 - i])
    for i in range(8, 15):
        b2.append(m[size - 15 + i][8])
    v2 = 0
    for k, b in enumerate(b2):
        v2 |= (1 if b else 0) << k
    return ok_bch, nivel, mascara, (v2 == v)


def revisar_patrones(mods, ver):
    """Los patrones fijos, uno por uno.

    Esta comprobación existe por un error que costó caro. El código decodificaba perfecto
    —formato válido, síndromes en cero, texto exacto— y las cámaras no lo leían. La causa:
    dos módulos mal en los patrones de sincronización. Este decodificador no los miraba
    porque deduce la rejilla del ancho del localizador; un lector real hace lo contrario,
    usa la sincronización para saber dónde cae cada módulo. Un QR puede ser válido en sus
    datos y aun así ser ilegible si su andamiaje está mal.
    """
    n = len(mods)
    f = []

    # Localizadores: anillo exterior oscuro, anillo blanco, centro 3×3 oscuro.
    for (cr, cc, donde) in [(3, 3, 'arriba-izquierda'), (3, n - 4, 'arriba-derecha'), (n - 4, 3, 'abajo-izquierda')]:
        for dy in range(-3, 4):
            for dx in range(-3, 4):
                esperado = max(abs(dx), abs(dy)) != 2
                if mods[cr + dy][cc + dx] != esperado:
                    f.append(f'localizador {donde} mal en ({cr+dy},{cc+dx})')
                    break
            else:
                continue
            break
        # Separador: el borde blanco alrededor del localizador.
        for d in range(-4, 5):
            for (r, c) in [(cr + d, cc - 4), (cr + d, cc + 4), (cr - 4, cc + d), (cr + 4, cc + d)]:
                if 0 <= r < n and 0 <= c < n and mods[r][c]:
                    f.append(f'separador {donde} manchado en ({r},{c})')
                    break

    # Sincronización: la referencia que usa la cámara para ubicar cada módulo.
    for i in range(8, n - 8):
        if mods[6][i] != (i % 2 == 0):
            f.append(f'sincronización horizontal mal en la columna {i}')
        if mods[i][6] != (i % 2 == 0):
            f.append(f'sincronización vertical mal en la fila {i}')

    # Alineación.
    cen = ALIN[ver]
    m = len(cen)
    for i in range(m):
        for j in range(m):
            if (i, j) in [(0, 0), (0, m - 1), (m - 1, 0)]:
                continue
            for dy in range(-2, 3):
                for dx in range(-2, 3):
                    if mods[cen[i] + dy][cen[j] + dx] != (max(abs(dx), abs(dy)) != 1):
                        f.append(f'alineación mal en ({cen[i]},{cen[j]})')
                        break
                else:
                    continue
                break

    if not mods[n - 8][8]:
        f.append('falta el módulo oscuro fijo en (size-8, 8)')

    # Sin duplicados: un patrón roto genera muchas quejas iguales.
    vistas, unicas = set(), []
    for x in f:
        if x not in vistas:
            vistas.add(x); unicas.append(x)
    return unicas


def decodificar(mods, ver, texto_esperado):
    size = len(mods)
    fallas = []
    if size != 17 + 4 * ver:
        fallas.append(f'tamaño {size} no corresponde a la versión {ver}')
        return fallas

    fallas.extend(revisar_patrones(mods, ver))

    ok_bch, nivel, mascara, copias_iguales = leer_formato(mods, size)
    if not ok_bch:
        fallas.append('los bits de formato no pasan su BCH')
    if nivel != 0b00:
        fallas.append(f'el nivel de corrección leído es {nivel:02b}, no M (00)')
    if not copias_iguales:
        fallas.append('las dos copias de los bits de formato no coinciden')

    fija = mapa_funcion(size, ver)
    m = [[mods[r][c] for c in range(size)] for r in range(size)]
    for r in range(size):
        for c in range(size):
            if not fija[r][c] and MASCARAS[mascara](r, c):
                m[r][c] = not m[r][c]

    # lectura en zigzag
    bits = []
    fil, direc = size - 1, -1
    col = size - 1
    while col > 0:
        if col == 6:
            col -= 1
        while True:
            for c in range(2):
                cc = col - c
                if not fija[fil][cc]:
                    bits.append(1 if m[fil][cc] else 0)
            fil += direc
            if fil < 0 or fil >= size:
                fil -= direc
                direc = -direc
                break
        col -= 2

    cw = []
    for p in range(0, len(bits) - 7, 8):
        b = 0
        for q in range(8):
            b = (b << 1) | bits[p + q]
        cw.append(b)

    nec, nb1, d1, nb2, d2 = TABLA_M[ver]
    total = (nb1 + nb2) * nec + nb1 * d1 + nb2 * d2
    if len(cw) < total:
        fallas.append(f'salieron {len(cw)} códigos, se esperaban {total}')
        return fallas
    cw = cw[:total]

    # des-entrelazado
    tam = [d1] * nb1 + [d2] * nb2
    bloques = [[] for _ in tam]
    idx = 0
    for i in range(max(tam)):
        for j, t in enumerate(tam):
            if i < t:
                bloques[j].append(cw[idx])
                idx += 1
    correc = [[] for _ in tam]
    for i in range(nec):
        for j in range(len(tam)):
            correc[j].append(cw[idx])
            idx += 1

    # Síndromes: el generador del QR tiene por raíces α^0 … α^(nec-1) — no α^1 en adelante,
    # que es la convención de otros Reed-Solomon. Si está bien, C(α^s) = 0 para todas ellas.
    for j in range(len(tam)):
        entero = bloques[j] + correc[j]
        for s in range(0, nec):
            acc = 0
            for coef in entero:
                acc = gmul(acc, EXP[s]) ^ coef
            if acc != 0:
                fallas.append(f'bloque {j}: síndrome {s} no es cero (Reed-Solomon mal calculado)')
                break

    # carga útil
    datos = []
    for b in bloques:
        datos.extend(b)
    flujo = ''.join(f'{x:08b}' for x in datos)
    modo = int(flujo[0:4], 2)
    if modo != 0b0100:
        fallas.append(f'el modo leído es {modo:04b}, no byte (0100)')
        return fallas
    nc = 16 if ver >= 10 else 8
    largo = int(flujo[4:4 + nc], 2)
    cuerpo = flujo[4 + nc:4 + nc + largo * 8]
    crudo = bytes(int(cuerpo[i:i + 8], 2) for i in range(0, len(cuerpo), 8))
    try:
        salida = crudo.decode('utf-8')
    except Exception as e:
        fallas.append(f'la carga no es UTF-8 válido: {e}')
        return fallas
    if salida != texto_esperado:
        fallas.append(f'salió {salida!r} en vez de {texto_esperado!r}')
    return fallas


if __name__ == '__main__':
    CASOS = [
        'https://peaku.co/verificacion/v/PKV-2026-483920',
        'PKV-2026-000001',
        'https://verify.didit.me/session/9f2c1d4e-77aa-4b1c-8e30-1a2b3c4d5e6f',
        'https://peaku.co/verificacion/v/PKV-2026-483920?utm=acta&r=Dayana%20Mauss%C3%A1',
        'Ñandú áéíóú — acento y eñe en UTF-8 para probar los bytes multibyte del QR.',
        'x',
        'a' * 106,   # empuja a versión 6
        'b' * 213,   # el techo de la versión 10
    ]

    js = f'''
    const QR = require({json.dumps(os.path.abspath(RUTA))});
    const casos = {json.dumps(CASOS, ensure_ascii=False)};
    const out = casos.map(t => {{
      const r = QR.matriz(t);
      return {{ version: r.version, size: r.size,
               mods: r.modulos.map(f => f.map(b => b ? 1 : 0).join('')) }};
    }});
    process.stdout.write(JSON.stringify(out));
    '''
    res = subprocess.run(['node', '-e', js], capture_output=True, text=True)
    if res.returncode != 0:
        print('el codificador falló:', res.stderr[-800:])
        sys.exit(1)
    salidas = json.loads(res.stdout)

    errores = 0
    print('verificación del codificador QR — decodificado desde cero en Python\n')
    for texto, r in zip(CASOS, salidas):
        mods = [[ch == '1' for ch in fila] for fila in r['mods']]
        fallas = decodificar(mods, r['version'], texto)
        etiqueta = (texto[:46] + '…') if len(texto) > 47 else texto
        if fallas:
            errores += 1
            print(f"  ✗ v{r['version']} · {etiqueta}")
            for f in fallas:
                print(f'      {f}')
        else:
            print(f"  ✓ v{r['version']} ({r['size']}×{r['size']}) · {etiqueta}")

    # El SVG tiene que ser autónomo: sin scripts, sin referencias externas.
    svg = subprocess.run(
        ['node', '-e', f'process.stdout.write(require({json.dumps(os.path.abspath(RUTA))}).svg("https://peaku.co/verificacion/v/PKV-2026-483920"))'],
        capture_output=True, text=True).stdout
    for prohibido in ['http://', 'https://fonts', '<script', '<image']:
        if prohibido in svg.replace('http://www.w3.org/2000/svg', ''):
            print(f'  ✗ el SVG contiene una referencia externa: {prohibido}')
            errores += 1
    if '<path' in svg and 'viewBox' in svg:
        print('  ✓ el SVG sale autónomo y vectorial')
    else:
        print('  ✗ el SVG no salió bien formado')
        errores += 1

    print(f"\n{len(CASOS)} códigos verificados · {'todo en verde' if not errores else str(errores) + ' con problemas'}")
    sys.exit(1 if errores else 0)

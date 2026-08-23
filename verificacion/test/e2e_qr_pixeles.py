"""El QR tal como lo ve una cámara: decodificado desde los PÍXELES que pinta el navegador.

Esta prueba existe por un error real. El QR se veía perfecto y no escaneaba. La causa:
el lado del SVG estaba fijo en píxeles totales, así que el módulo medía 2.6px; con
shape-rendering="crispEdges" el navegador redondea cada módulo a píxeles enteros y unos
salían de 2 y otros de 3. Un lector busca una rejilla uniforme y con módulos desiguales
no encuentra nada — aunque a simple vista el cuadrito esté impecable.

Decodificar la matriz que devuelve el codificador no detecta eso: hay que mirar el
resultado rasterizado. Y hay que hacerlo en las escalas que la gente de verdad usa:
Windows viene con 125% o 150% de fábrica en casi todo portátil.
"""
import sys, os, json, subprocess

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from qr_verify import decodificar
from PIL import Image
from playwright.sync_api import sync_playwright

QRJS = os.path.join(AQUI, '..', 'public', 'qr.js')
SALIDA = os.environ.get('QR_TMP', '/tmp')

# Los tamaños que usa la aplicación, y URLs de distinto largo para tocar varias versiones.
CASOS = [
    ('acta',            4,  'https://peaku.co/verificacion/v/PKV-2026-483920'),
    ('acta en Render',  4,  'https://sandler-coach-peaku.onrender.com/verificacion/v/PKV-2026-483920'),
    ('identidad',       6,  'https://verify.didit.me/es/session/sess_9f2c1d4e77aa4b1c'),
    ('pantalla completa', 11, 'https://verify.didit.me/es/session/sess_9f2c1d4e77aa4b1c'),
]
ESCALAS = [1, 1.25, 1.5, 2]     # 100%, y los escalados de Windows, y pantallas Retina
MODULO_MINIMO = 4               # px por módulo al 100%: por debajo, una cámara no lo resuelve

errs = []


def svg_de(url, modulo):
    return subprocess.run(
        ['node', '-e', f'process.stdout.write(require({json.dumps(os.path.abspath(QRJS))})'
                       f'.svg({json.dumps(url)},{{modulo:{modulo},fondo:"#fff",color:"#000"}}))'],
        capture_output=True, text=True).stdout


def modulos_desde_pixeles(im):
    """De la imagen a la matriz, como haría un lector: sin saber de antemano el tamaño."""
    g = im.convert('L')
    w, h = g.size
    px = g.load()
    def osc(x, y): return px[x, y] < 128

    xs = [x for x in range(w) if any(osc(x, y) for y in range(h))]
    ys = [y for y in range(h) if any(osc(x, y) for x in range(w))]
    if not xs or not ys:
        return None, 'no hay nada oscuro en la imagen'
    x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]

    # El localizador de arriba a la izquierda mide 7 módulos: su ancho da el paso.
    fila, run, x = y0 + 1, 0, x0
    while x <= x1 and osc(x, fila):
        run += 1; x += 1
    if run < 3:
        return None, 'no se encontró el patrón localizador'
    paso = run / 7.0
    n = round((x1 - x0 + 1) / paso)
    if n < 21 or (n - 17) % 4:
        return None, f'la rejilla no es regular: salen {n} módulos con paso {paso:.2f}px'
    esc = (x1 - x0 + 1) / n
    if esc < 2.5:
        return None, f'módulos de {esc:.2f}px: demasiado pequeños para leerse'
    mods = [[osc(min(w - 1, int(x0 + (c + .5) * esc)), min(h - 1, int(y0 + (f + .5) * esc)))
             for c in range(n)] for f in range(n)]
    return (mods, (n - 17) // 4), f'{n} módulos a {esc:.2f}px'


html = '<body style="margin:0;background:#fff">' + ''.join(
    f'<div id="c{i}" style="padding:12px;width:max-content">{svg_de(u, m)}</div>'
    for i, (_, m, u) in enumerate(CASOS)) + '</body>'
ruta = os.path.join(SALIDA, 'qr_pixeles.html')
open(ruta, 'w').write(html)

print('QR decodificado desde los píxeles del navegador\n')
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for escala in ESCALAS:
        pg = br.new_page(viewport={'width': 900, 'height': 800}, device_scale_factor=escala)
        pg.goto('file://' + ruta)
        pg.wait_for_timeout(150)
        print(f'  pantalla al {int(escala * 100)}%')
        for i, (nombre, modulo, url) in enumerate(CASOS):
            png = os.path.join(SALIDA, f'qrpx_{escala}_{i}.png')
            pg.query_selector(f'#c{i} svg').screenshot(path=png)
            r, nota = modulos_desde_pixeles(Image.open(png))
            if not r:
                errs.append(f'{nombre} al {int(escala*100)}%: {nota}')
                print(f'    ✗ {nombre}: {nota}')
                continue
            mods, ver = r
            fallas = decodificar(mods, ver, url)
            if fallas:
                errs.append(f'{nombre} al {int(escala*100)}%: {fallas[0]}')
                print(f'    ✗ {nombre}: {fallas[0][:80]}')
                continue
            print(f'    ✓ {nombre}: v{ver}, {nota}')

            # Que este decodificador lo lea no basta: aquí la imagen es perfecta, plana y
            # sin ruido. Una cámara trabaja con enfoque, ángulo y compresión, así que el
            # módulo tiene que ser cómodamente grande, no apenas suficiente.
            paso = float(nota.split('a ')[1].replace('px', ''))
            entero = abs(paso - round(paso)) < 0.01
            if escala == 1:
                if paso < MODULO_MINIMO:
                    errs.append(f'{nombre}: módulos de {paso:.2f}px al 100%, por debajo del mínimo de {MODULO_MINIMO}')
                if not entero:
                    errs.append(f'{nombre}: al 100% el módulo mide {paso:.2f}px y no un número entero '
                                f'de píxeles — la rejilla sale despareja y el lector no la encuentra')
        pg.close()
    br.close()

print()
print('ERRORES:', 'ninguno' if not errs else '')
for e in errs:
    print('  -', e)
sys.exit(1 if errs else 0)

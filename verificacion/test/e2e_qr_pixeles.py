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
    ('acta',            6,  'https://peaku.co/verificacion/v/PKV-2026-483920'),
    ('acta en Render',  6,  'https://sandler-coach-peaku.onrender.com/verificacion/v/PKV-2026-483920'),
    ('identidad',       7,  'https://verify.didit.me/es/session/sess_9f2c1d4e77aa4b1c'),
    ('pantalla completa', 11, 'https://verify.didit.me/es/session/sess_9f2c1d4e77aa4b1c'),
]
# 100%, los escalados de fábrica de Windows, Retina, y los zooms sueltos del navegador.
# Los fraccionarios (110%, 90%, 175%) son los que rompían la rejilla: un módulo "entero"
# en píxeles CSS cae en 4.4 o 5.4 píxeles físicos y el navegador redondea unos sí y otros no.
ESCALAS = [1, 1.1, 1.25, 1.5, 1.75, 2, 0.9]
MODULO_MINIMO = 4               # px por módulo al 100%: por debajo, una cámara no lo resuelve

errs = []


def modulo_para(objetivo, dpr):
    """El mismo ajuste que hace la aplicación: entero en píxeles FÍSICOS, no en CSS."""
    return max(1, round(objetivo * dpr)) / dpr


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


print('QR decodificado desde los píxeles del navegador\n')
with sync_playwright() as pw:
    br = pw.chromium.launch()
    for escala in ESCALAS:
        # El SVG se genera con el módulo ajustado a esta escala, igual que en el navegador.
        html = '<body style="margin:0;background:#fff">' + ''.join(
            f'<div id="c{i}" style="padding:12px;width:max-content">{svg_de(u, modulo_para(m, escala))}</div>'
            for i, (_, m, u) in enumerate(CASOS)) + '</body>'
        ruta = os.path.join(SALIDA, f'qr_pixeles_{escala}.html')
        open(ruta, 'w').write(html)
        pg = br.new_page(viewport={'width': 1100, 'height': 900}, device_scale_factor=escala)
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
            pct = int(escala * 100)
            # En píxeles FÍSICOS el módulo tiene que ser entero, en cualquier escala.
            if abs(paso - round(paso)) > 0.02:
                errs.append(f'{nombre} al {pct}%: el módulo mide {paso:.2f} píxeles físicos y no un número '
                            f'entero — la rejilla sale despareja y el lector no la encuentra')
            # Y en tamaño real no puede quedar por debajo del mínimo que resuelve una cámara.
            if paso / escala < MODULO_MINIMO - 0.01:
                errs.append(f'{nombre} al {pct}%: quedan {paso/escala:.2f}px CSS por módulo, '
                            f'por debajo del mínimo de {MODULO_MINIMO}')
        pg.close()
    br.close()

print()
print('ERRORES:', 'ninguno' if not errs else '')
for e in errs:
    print('  -', e)
sys.exit(1 if errs else 0)

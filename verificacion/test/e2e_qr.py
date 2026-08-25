"""Los dos QR, de punta a punta.

No basta con que aparezca un cuadrito en la pantalla. Aquí se saca el SVG que el navegador
de verdad dibujó, se reconstruye la matriz de módulos y se DECODIFICA con el verificador
independiente. Después se comprueba que la dirección que salió del QR del acta existe y
responde "auténtico" — porque un código que lleva a una página muerta es peor que no ponerlo.
"""
from playwright.sync_api import sync_playwright
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import flujo
import sys, time, subprocess, os, random, urllib.request, json, base64, re

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
from qr_verify import decodificar

PORT = random.randint(3200, 3900)
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(AQUI, "stub.js")],
                        env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None:
        print("el stub murió al arrancar"); sys.exit(1)
    try:
        urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception:
        time.sleep(0.25)
else:
    print("el stub no respondió"); sys.exit(1)

errs = []
T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es que haya hecho un rollout de PP en produccion. "
     "Tambien tiene que entender como PP se conversa con MM y QM. Rechazamos dos que sabian la teoria. ") * 4
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEJRIAAIhQCVQFy2AAAAABJRU5ErkJggg==")


def simular(**kw):
    r = urllib.request.Request(B.rstrip('/') + "/api/__simular", data=json.dumps(kw).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(r)


def leer_qr(svg_html, etiqueta):
    """Del SVG dibujado en el DOM a la matriz de módulos, y de ahí al texto."""
    vb = re.search(r'viewBox="0 0 (\d+) \1"', svg_html)
    d = re.search(r'\sd="([^"]*)"', svg_html)
    if not vb or not d:
        errs.append(f"{etiqueta}: el SVG no tiene viewBox o path legible")
        return None
    total, margen = int(vb.group(1)), 4
    size = total - margen * 2
    if size < 21 or (size - 17) % 4:
        errs.append(f"{etiqueta}: tamaño de matriz imposible ({size})")
        return None
    mods = [[False] * size for _ in range(size)]
    for x, y in re.findall(r'M(\d+) (\d+)h1v1h-1z', d.group(1)):
        c, f = int(x) - margen, int(y) - margen
        if 0 <= f < size and 0 <= c < size:
            mods[f][c] = True
    return mods, (size - 17) // 4


def comprobar(svg_html, esperado, etiqueta):
    r = leer_qr(svg_html, etiqueta)
    if not r:
        return
    mods, ver = r
    fallas = decodificar(mods, ver, esperado)
    if fallas:
        for f in fallas:
            errs.append(f"{etiqueta}: {f}")
    else:
        print(f"  ✓ {etiqueta} → v{ver}, decodifica exacto: {esperado[:58]}")


def preparar(pg, kind):
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.click(f'#setKind [data-k="{kind}"]'); pg.wait_for_timeout(120)
    pg.fill("#sCand", "Jorge Restrepo"); pg.fill("#sEval", "Laura M."); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)


def calificar(pg):
    pg.click("[data-next]"); pg.wait_for_timeout(300)
    flujo.entrevistar_y_calificar(pg, (5, 4))


print("QR de punta a punta\n")
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    simular(status="Approved", score=96.4, verdict="coincide")
    pg = br.new_page(viewport={"width": 1120, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))

    preparar(pg, "cierre")
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)
    pg.set_input_files("#shotFile", {"name": "c.png", "mimeType": "image/png", "buffer": PNG})
    pg.wait_for_timeout(800)
    calificar(pg)

    # --- 1. QR del link de identidad ---
    pg.click("#btnEnviarId"); pg.wait_for_timeout(900)
    caja = pg.query_selector(".qrid .qrbox svg")
    if not caja:
        errs.append("no apareció el QR del link de identidad")
    else:
        url = pg.inner_text(".linkbox .lk").strip()
        comprobar(caja.evaluate("e => e.outerHTML"), url, "QR de identidad")
    pg.screenshot(path="/tmp/pk/qr_01_identidad.png", full_page=True)

    # --- 1b. El mismo código a pantalla completa, para compartir en la llamada ---
    if not pg.query_selector("#btnQrGrande"):
        errs.append("no hay forma de ampliar el QR para compartir pantalla")
    else:
        pg.click("#btnQrGrande"); pg.wait_for_timeout(400)
        grande = pg.query_selector(".qrfull .qrbig svg")
        if not grande:
            errs.append("el QR ampliado no apareció")
        else:
            url = pg.inner_text(".linkbox .lk").strip()
            comprobar(grande.evaluate("e => e.outerHTML"), url, "QR ampliado")
            lado = grande.evaluate("e => e.getBoundingClientRect().width")
            if lado > pg.evaluate("() => innerWidth") or lado > pg.evaluate("() => innerHeight"):
                errs.append(f"el QR ampliado ({lado}px) no cabe en la pantalla")
            pg.screenshot(path="/tmp/pk/qr_04_ampliado.png")
        pg.click(".qrfull"); pg.wait_for_timeout(300)
        if pg.query_selector(".qrfull"):
            errs.append("el QR ampliado no se cierra al hacer clic")

    pg.click("#btnRefrescarId"); pg.wait_for_timeout(1000)
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)

    # --- 2. QR del acta ---
    qa = pg.query_selector(".abqr svg")
    if not qa:
        errs.append("el acta salió sin QR de autenticidad")
    else:
        destino = pg.get_attribute(".abqr", "title")
        if not destino or not destino.startswith("http"):
            errs.append(f"el QR del acta no apunta a una URL absoluta: {destino!r}")
        else:
            comprobar(qa.evaluate("e => e.outerHTML"), destino, "QR del acta")
            # El escrito y el escaneado tienen que llevar al mismo lado.
            escrito = pg.inner_text(".aback .abtx")
            if destino.replace("http://", "").replace("https://", "") not in escrito:
                errs.append("el QR y la URL impresa en el acta no coinciden")
            # Y esa dirección tiene que existir de verdad.
            try:
                html = urllib.request.urlopen(destino, timeout=5).read().decode()
                if "AUTÉNTICO" not in html.upper():
                    errs.append("la página a la que lleva el QR no confirma el informe")
            except Exception as e:
                errs.append(f"el QR lleva a una dirección que no responde: {e}")
    pg.screenshot(path="/tmp/pk/qr_02_acta.png", full_page=True)

    # El QR no puede estorbar al imprimir: el respaldo tiene que seguir cabiendo.
    pg.emulate_media(media="print")
    pg.wait_for_timeout(200)
    ancho = pg.evaluate("() => { const a=document.querySelector('.aback'); return a ? a.scrollWidth - a.clientWidth : 0 }")
    if ancho > 1:
        errs.append(f"el bloque de respaldo se desborda al imprimir ({ancho}px)")
    pg.screenshot(path="/tmp/pk/qr_03_acta_impresa.png", full_page=True)
    pg.emulate_media(media="screen")
    pg.close()
    br.close()

STUB.terminate()
print("\nERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

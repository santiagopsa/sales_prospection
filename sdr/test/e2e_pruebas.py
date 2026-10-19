"""Pruebas gratis en el embudo de Luisa, en el navegador, con el embudo real contra Postgres.

Un servidor mínimo (servidor_embudo.js) sirve public/ y las rutas del embudo con sdr/embudo.js.
Lo que hay que sostener:
  · "Prueba gratis" y "Cotización" se ven como dos columnas, una antes de la otra;
  · arriba, "Pruebas gratis": en prueba, a cotización, a cliente y de las resueltas;
  · la tarjeta trae lo que Wei tiene en prueba; la quieta se marca;
  · lo que Wei tiene en prueba sin deal en prueba sale aparte y se pasa a prueba de un clic;
  · mover de Prueba a Cotización cambia el tipo y la conversión sube.
Uso: SDR_TEST_DATABASE_URL=... python3 sdr/test/e2e_pruebas.py
"""
from playwright.sync_api import sync_playwright
import os, sys, subprocess, time, urllib.request, json, random
AQUI = os.path.dirname(os.path.abspath(__file__))
PORT = random.randint(4100, 4600)
SRV = subprocess.Popen(["node", os.path.join(AQUI, "servidor_embudo.js")], env={**os.environ, "PORT": str(PORT)},
                       stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
B = f"http://127.0.0.1:{PORT}"
for _ in range(80):
    try: urllib.request.urlopen(B + "/sdr/api/embudo", timeout=1); break
    except Exception: time.sleep(0.25)
else:
    print(SRV.stdout.read().decode()[:2000]); sys.exit(1)

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1440, "height": 1100})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B + "/#/embudo"); pg.wait_for_selector(".emb-tablero", timeout=10000); pg.wait_for_timeout(500)
    cols = pg.eval_on_selector_all(".emb-col", "els => els.map(e => e.dataset.col)")
    if cols[:5] != ["sin_calificar", "calificado", "prueba", "cotizacion", "interesado"]:
        errs.append(f"las columnas no son las esperadas: {cols}")
    panel = pg.inner_text(".emb-pruebas")
    for t in ["Pruebas gratis", "en prueba ahora", "pasaron a cotización", "se volvieron clientes", "de las ya resueltas"]:
        if t not in panel: errs.append(f"el panel no dice {t!r}")
    if "67%" not in panel: errs.append("la conversión de las resueltas debería ser 67%")
    if "Movizzon" not in panel or "Pasar a prueba" not in panel: errs.append("no sale lo que Wei tiene en prueba sin deal en prueba")
    rappi = pg.inner_text('.emb-col[data-col="prueba"] .emb-card:has-text("Rappi")')
    if "Data Engineer" not in rappi: errs.append("la tarjeta no trae lo que Wei tiene en prueba")
    quieta = pg.inner_text('.emb-col[data-col="prueba"] .emb-card:has-text("Quieta")')
    if "quieta" not in quieta: errs.append("la prueba quieta no se marca")
    pg.screenshot(path="/tmp/pk/pr_01_embudo.png", full_page=False)
    pg.locator(".emb-pruebas").screenshot(path="/tmp/pk/pr_02_panel.png")

    # Pasar Movizzon a prueba desde el panel
    pg.click('.emb-pruebas [data-aprueba]'); pg.wait_for_timeout(1200)
    if "Movizzon" not in pg.inner_text('.emb-col[data-col="prueba"]'): errs.append("Pasar a prueba no movió el deal")
    if "Pasar a prueba" in pg.inner_text(".emb-pruebas"): errs.append("Movizzon sigue como 'sin deal en prueba'")

    # Rappi: de Prueba a Cotización con "Mover a"
    pg.select_option('.emb-col[data-col="prueba"] .emb-card:has-text("Rappi") .emb-mover', "cotizacion"); pg.wait_for_timeout(1200)
    if pg.query_selector(".emb-velo"): pg.click(".emb-velo [data-cerrar]"); pg.wait_for_timeout(300)
    if "Rappi" not in pg.inner_text('.emb-col[data-col="cotizacion"]'): errs.append("Rappi no pasó a Cotización")
    card = pg.inner_text('.emb-col[data-col="cotizacion"] .emb-card:has-text("Rappi")')
    if "Vino de prueba" not in card: errs.append("en Cotización no dice que vino de prueba")
    estado = json.loads(urllib.request.urlopen(B + "/sdr/api/embudo").read())["pruebas"]
    if estado["a_cotizacion"]["n"] != 3: errs.append(f"a cotización debería ser 3: {estado['a_cotizacion']}")
    pg.set_viewport_size({"width": 390, "height": 900}); pg.wait_for_timeout(300)
    pg.locator(".emb-pruebas").screenshot(path="/tmp/pk/pr_03_movil.png")
    ancho = pg.evaluate("document.documentElement.scrollWidth")
    if ancho > 400: errs.append(f"en celular la página se desborda: {ancho}px")
    br.close()
SRV.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

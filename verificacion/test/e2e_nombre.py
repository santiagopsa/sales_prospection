"""Corregir el nombre del candidato desde la consola, en sesión y en un acta ya emitida.

El caso real: el reclutador escribió "Miguel" y era Juan Galindo, y se dio cuenta con el
informe ya emitido. Lo que hay que sostener:
  · junto al nombre, en la barra de arriba, hay un lápiz que abre la corrección (pregunta de
    la página con un campo de texto, no un prompt() del navegador);
  · en sesión, corrige el nombre en la pantalla y en el servidor;
  · en un acta emitida, corrige el nombre del informe, cambia la firma de integridad y deja
    la corrección anotada en el pie ("Corregido el …: nombre del candidato");
  · al reabrir el informe desde el tablero, sale con el nombre correcto y la anotación;
  · cancelar no cambia nada.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
import flujo
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
T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es un rollout de PP en produccion. "
     "Tambien PP con MM y QM. Rechazamos dos que sabian la teoria. ") * 5

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.dismiss())   # nada del navegador: si sale un prompt(), falla

    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Miguel"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    sid = pg.evaluate("() => S.sid")

    # ---------- A. En sesión: el lápiz, cancelar, corregir ----------
    if not pg.query_selector("#btnCorregirNombre"):
        errs.append("no hay lápiz junto al nombre en la barra de arriba")
    else:
        pg.click("#btnCorregirNombre"); pg.wait_for_timeout(250)
        if not pg.is_visible("#pgInput"):
            errs.append("la corrección no abre un campo de texto en la página")
        pg.click("#pgNo"); pg.wait_for_timeout(200)
        if pg.evaluate("() => S.cand") != "Miguel":
            errs.append("cancelar cambió el nombre")
        pg.click("#btnCorregirNombre"); pg.wait_for_timeout(250)
        pg.fill("#pgInput", "Juan Galindo"); pg.click("#pgSi"); pg.wait_for_timeout(600)
        if "Juan Galindo" not in pg.inner_text("#whoTop"):
            errs.append("la barra de arriba no muestra el nombre corregido")
        s = json.load(urllib.request.urlopen(B + f"api/sessions/{sid}"))
        if s.get("candidate") != "Juan Galindo":
            errs.append(f"el servidor no guardó el nombre corregido en sesión: {s.get('candidate')!r}")

    # ---------- B. Se emite (otra vez con error, a propósito) y se corrige sobre el acta ----------
    pg.click("#btnCorregirNombre"); pg.wait_for_timeout(250)
    pg.fill("#pgInput", "Miguel"); pg.click("#pgSi"); pg.wait_for_timeout(500)
    pg.evaluate("() => { S.idc = {grab:true, cam:true}; touch(); }")
    flujo.recorrer_guia(pg); flujo.pegar_transcripcion(pg); flujo.confirmar_niveles(pg, (5, 4))
    for _ in range(6):
        if "Cierre de la sesión" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(300)
    pg.evaluate("() => { S.reqs.forEach(r => { if(!r.lvl) r.lvl = 4; if(porqueDe(r).length <= EV_MIN) r.exp = 'Demostró el requisito con un caso propio.'; }); touch(); S.fase = fases().length - 1; render(); }")
    pg.wait_for_timeout(300)
    pg.click("#stage #btnActa"); pg.wait_for_selector("#vActa.on", timeout=15000); pg.wait_for_timeout(500)
    firma_antes = pg.evaluate("() => S.hash")
    if "Miguel" not in pg.inner_text("#actaStage"):
        errs.append("el acta no salió con el nombre (equivocado) con el que se emitió")

    pg.click("#btnCorregirNombre"); pg.wait_for_timeout(250)
    tx = pg.inner_text("#pregunta").lower()
    if "ya está emitido" not in tx or "firma" not in tx:
        errs.append("sobre un acta emitida no avisa que se vuelve a firmar")
    pg.fill("#pgInput", "Juan Galindo"); pg.click("#pgSi"); pg.wait_for_timeout(800)
    acta = pg.inner_text("#actaStage")
    if "Juan Galindo" not in acta or "Miguel" in acta:
        errs.append("el acta no quedó con el nombre corregido")
    if "Corregido el" not in acta or "nombre del candidato" not in acta:
        errs.append("el acta no anota la corrección al pie")
    if pg.evaluate("() => S.hash") == firma_antes:
        errs.append("la firma de integridad no cambió al corregir un acta emitida")
    if "Qué mueve a Juan" not in acta and "qué mueve a juan" not in acta.lower():
        pass  # los factores de cierre pueden no existir en este caso
    pg.screenshot(path="/tmp/pk/nombre_01_acta.png", full_page=True)

    # ---------- C. Reabrir desde el tablero ----------
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(400)
    tab = pg.inner_text("#sesList")
    if "Juan Galindo" not in tab or "Miguel" in tab:
        errs.append("el tablero sigue con el nombre viejo")
    pg.click(f'[data-ses="{sid}"]'); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
    acta2 = pg.inner_text("#actaStage")
    if "Juan Galindo" not in acta2 or "Corregido el" not in acta2:
        errs.append("al reabrir, el informe perdió el nombre corregido o la anotación")

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

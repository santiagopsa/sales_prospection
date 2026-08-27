"""El cierre tiene que decir POR QUÉ, no repetir la cita.

El renglón de cada requisito mostraba la evidencia textual recortada a 110 caracteres.
Eso es el insumo, no el juicio: quien revisa veía "4/5 · CUMPLE" y una frase a medias del
candidato, y tenía que deducir solo qué elemento de la rúbrica se había cumplido.

Lo que hay que sostener:
  · el renglón explica el nivel, no cita al candidato;
  · sin transcripción, la explicación es el ancla de la rúbrica — que ES la definición
    del nivel, no un relleno;
  · un requisito que no se tocó dice que no se midió, ni a favor ni en contra;
  · si el evaluador mueve el nivel que propuso la transcripción, se avisa: la explicación
    quedó explicando otro nivel, y callarlo sería presentar como sostenido algo que la
    conversación no sostiene;
  · y EL ACTA hace lo mismo: explica el veredicto en vez de pegar la cita cruda de la
    transcripción, y dice qué quedó sin verificar. Quien lee el informe no estuvo en la
    llamada y no tiene por qué interpretar un fragmento de diálogo.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request

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
     "Tambien PP con MM y QM. ") * 6

# Lo que el stub pone como cita del candidato. NO debe ser lo que se lee en el cierre.
CITA = "En Alpina, entre marzo y noviembre de 2023, yo llevé el rollout de PP"


def hasta_cierre(pg, niveles):
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(250)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Ana prueba"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(320)
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg)
    flujo.confirmar_niveles(pg, niveles)
    for _ in range(6):
        if "Cierre de la sesión" in pg.inner_text("#stage"):
            return True
        pg.click("[data-next]"); pg.wait_for_timeout(340)
    return "Cierre de la sesión" in pg.inner_text("#stage")


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])

    # ---------- A. Se confirma el nivel propuesto: se lee el porqué, no la cita ----------
    pg = br.new_page(viewport={"width": 1180, "height": 1100})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())
    if not hasta_cierre(pg, (5, 4)):
        errs.append("no se llegó al cierre de la sesión")
    else:
        filas = pg.query_selector_all(".res")
        if len(filas) < 2:
            errs.append(f"se esperaban 2 requisitos en el cierre, hay {len(filas)}")
        else:
            uno = filas[0].inner_text()
            if CITA in uno:
                errs.append("el cierre sigue mostrando la cita literal del candidato")
            if "rol individual" not in uno and "fricción" not in uno.lower():
                errs.append(f"no explica por qué cumple: {uno!r}")
            if "CUMPLE" not in uno:
                errs.append("se perdió el veredicto del renglón")

            # El segundo no se tocó en la conversación y el evaluador le puso 4 a mano:
            # sin justificación de la transcripción, la explicación es el ancla.
            dos = filas[1].inner_text()
            if "Ancla 4" not in dos:
                errs.append(f"sin transcripción no cae al ancla de la rúbrica: {dos!r}")
        pg.screenshot(path="/tmp/pk/pq_01_confirmado.png", full_page=True)
    pg.close()

    # ---------- B. El evaluador BAJA el nivel: hay que avisar ----------
    pg2 = br.new_page(viewport={"width": 1180, "height": 1100})
    pg2.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg2.on("dialog", lambda d: d.accept())
    if not hasta_cierre(pg2, (3, 4)):   # la transcripción proponía 5 en el primero
        errs.append("(B) no se llegó al cierre")
    else:
        uno = pg2.query_selector_all(".res")[0].inner_text()
        if "bajó el nivel" not in uno:
            errs.append(f"no avisa que el evaluador movió el nivel: {uno!r}")
        if "de 5 a 3" not in uno:
            errs.append(f"no dice de qué nivel a cuál se movió: {uno!r}")
        if not pg2.query_selector(".res .ajus"):
            errs.append("el aviso no se distingue visualmente del resto del renglón")
        pg2.screenshot(path="/tmp/pk/pq_02_ajustado.png", full_page=True)
    pg2.close()

    # ---------- C. Un requisito sin calificar no se rellena ----------
    pg3 = br.new_page(viewport={"width": 1180, "height": 1100})
    pg3.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg3.on("dialog", lambda d: d.accept())
    if not hasta_cierre(pg3, (5,)):     # el segundo queda sin nivel
        errs.append("(C) no se llegó al cierre")
    else:
        dos = pg3.query_selector_all(".res")[1].inner_text()
        if "SIN CALIFICAR" not in dos:
            errs.append(f"(C) el segundo debería estar sin calificar: {dos!r}")
        if "no se tocó" not in dos.lower() and "sin medir" not in dos.lower():
            errs.append(f"(C) no dice que quedó sin medir: {dos!r}")
        if "Ancla" in dos:
            errs.append("(C) le inventa un ancla a un requisito sin nivel")
        pg3.screenshot(path="/tmp/pk/pq_03_sin_medir.png", full_page=True)
    pg3.close()

    # ---------- D. EL ACTA: explicación y pendientes, no la cita ----------
    pg4 = br.new_page(viewport={"width": 1180, "height": 1100})
    pg4.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg4.on("dialog", lambda d: d.accept())
    if not hasta_cierre(pg4, (5, 4)):
        errs.append("(D) no se llegó al cierre")
    else:
        for _ in range(4):
            if pg4.query_selector("#btnActa"):
                break
            pg4.click("[data-next]"); pg4.wait_for_timeout(330)
        if pg4.query_selector('[data-rec="reserva"]'):
            pg4.click('[data-rec="reserva"]'); pg4.wait_for_timeout(150)
            pg4.fill('[data-r="texto"]', "Sostiene el nucleo del cargo.")
            pg4.wait_for_timeout(200); pg4.click("[data-next]"); pg4.wait_for_timeout(500)
        pg4.click("#btnActa"); pg4.wait_for_selector("#vActa.on", timeout=9000); pg4.wait_for_timeout(600)
        acta = pg4.inner_text("#actaStage")
        if CITA in acta:
            errs.append("REGRESIÓN: el acta sigue pegando la cita cruda de la transcripción")
        if "rollout completo en Alpina" not in acta:
            errs.append("el acta no trae la explicación del veredicto")
        if "Queda por verificar" not in acta:
            errs.append("el acta no dice qué quedó sin verificar")
        if "cuántos usuarios" not in acta:
            errs.append("no imprime el pendiente concreto que devolvió el análisis")
        if "REGISTRADA" in acta and "Evidencia textual en cada requisito" in acta:
            errs.append("el sello sigue prometiendo evidencia textual que ya no se imprime")
        pg4.screenshot(path="/tmp/pk/pq_04_acta.png", full_page=True)
    pg4.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

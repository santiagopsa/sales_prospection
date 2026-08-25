"""El inglés no se pregunta: se escucha.

"¿Hablas inglés?" no mide nada — todo el mundo dice B2. Y un certificado no dice si aguanta
un daily con el cliente, que es lo que el cargo necesita. Así que se pasa un tramo de la
entrevista a inglés, y el nivel sale de lo que sostuvo ahí, con su cita.

Lo que hay que sostener:
  · el inglés se define en la vacante (lo exige el cliente, no lo declara el candidato);
  · si el cargo no lo pide, la fase no existe y el acta no lo menciona;
  · durante la llamada es guion para cambiar de idioma, no una casilla que marcar;
  · después, el nivel propuesto viene con la cita EN INGLÉS que lo sostiene;
  · si no hubo tramo en inglés, se dice "no evaluado" — ni a favor ni en contra.
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
     "Tambien PP con MM y QM. Tiene que poder estar en el daily en ingles. ") * 5


def intake(pg, con_ingles=True):
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(400)
    if not con_ingles:
        pg.uncheck("#rIngOn"); pg.wait_for_timeout(150)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)


def abrir_sesion(pg, nombre):
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", nombre); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(350)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    # ---------- A. El levantamiento lo saca del texto del cliente ----------
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(500)
    if not pg.is_checked("#rIngOn"):
        errs.append("el levantamiento no marcó que el cargo exige inglés")
    if "daily" not in pg.input_value("#rIngUso").lower():
        errs.append(f"no trajo para qué se necesita el inglés: {pg.input_value('#rIngUso')!r}")
    pg.screenshot(path="/tmp/pk/ing_01_revision.png", full_page=True)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)

    # ---------- B. Durante la entrevista: guion, no casilla ----------
    abrir_sesion(pg, "Dayana Maussá")
    nav = pg.inner_text("#phaseNav")
    if "Inglés" not in nav:
        errs.append("no apareció la fase de inglés en la entrevista")
    for _ in range(6):
        if "Inglés" in pg.inner_text("#stage").split("\n")[0]:
            break
        pg.click("[data-next]"); pg.wait_for_timeout(320)
    guia = pg.inner_text("#stage")
    if "daily" not in guia.lower():
        errs.append("la guía de inglés no dice para qué lo necesita el cargo")
    if "Tell me about the project" not in guia:
        errs.append("la guía no trae el guion en inglés")
    if pg.query_selector("[data-ing]"):
        errs.append("durante la entrevista deja marcar el nivel de inglés — eso sale de la transcripción")
    pg.screenshot(path="/tmp/pk/ing_02_guia.png", full_page=True)

    # ---------- C. Después: nivel propuesto con su cita en inglés ----------
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg)
    flujo.confirmar_niveles(pg, (5, 4))
    for _ in range(4):
        if pg.query_selector("[data-ing]"):
            break
        pg.click("[data-next]"); pg.wait_for_timeout(320)
    if not pg.query_selector("[data-ing]"):
        errs.append("no se llega a confirmar el nivel de inglés")
    else:
        ing = pg.inner_text("#stage")
        if "the material master data was a mess" not in ing:
            errs.append("no muestra la cita en inglés de la transcripción")
        if not pg.query_selector(".lv.sel"):
            errs.append("no viene precargado el nivel propuesto por la transcripción")
        if "B2" not in ing:
            errs.append("no propone el nivel observado")
        pg.screenshot(path="/tmp/pk/ing_03_confirmar.png", full_page=True)

    # ---------- D. El acta lo reporta con su ancla ----------
    for _ in range(5):
        if pg.query_selector("#btnActa"):
            break
        pg.click("[data-next]"); pg.wait_for_timeout(350)
    if pg.query_selector('[data-rec="reserva"]'):
        pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(150)
        pg.fill('[data-r="texto"]', "Sostiene el nucleo del cargo.")
        pg.wait_for_timeout(200); pg.click("[data-next]"); pg.wait_for_timeout(500)
    if pg.is_disabled("#btnActa"):
        errs.append("no deja emitir estando completo")
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)
    acta = pg.inner_text("#actaStage")
    if "Lo que se oyó en inglés" not in acta:
        errs.append("el acta no trae el bloque de inglés")
    if "B2" not in acta:
        errs.append("el acta no dice el nivel observado")
    if "conducta" not in acta.lower():
        errs.append("el acta no aclara que se midió por conducta y no por certificado")
    pg.screenshot(path="/tmp/pk/ing_04_acta.png", full_page=True)
    pg.close()

    # ---------- E. Si el cargo NO exige inglés, no existe en ninguna parte ----------
    pg2 = br.new_page(viewport={"width": 1180, "height": 950})
    pg2.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg2.on("dialog", lambda d: d.accept())
    intake(pg2, con_ingles=False)
    abrir_sesion(pg2, "Ana Betancur")
    if "Inglés" in pg2.inner_text("#phaseNav"):
        errs.append("aparece la fase de inglés en un cargo que no lo pide")
    flujo.recorrer_guia(pg2)
    flujo.pegar_transcripcion(pg2)
    flujo.confirmar_niveles(pg2, (5, 4))
    for _ in range(4):
        if pg2.query_selector('[data-rec="reserva"]'):
            break
        pg2.click("[data-next]"); pg2.wait_for_timeout(320)
    if pg2.query_selector("[data-ing]"):
        errs.append("deja calificar inglés en un cargo que no lo pide")
    pg2.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

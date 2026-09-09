"""Cada pregunta lleva su criterio de validación, y el informe explica el nivel en dos renglones.

Lo que hay que sostener:
  · el levantamiento trae un criterio por pregunta y la revisión lo muestra bajo cada una;
  · la guía en vivo muestra, bajo cada pregunta, "se da por buena si…";
  · en la edición de la vacante el criterio se edita al lado de su pregunta y se guarda;
  · la calificación muestra el criterio por criterio (cumplido/parcial) que propuso el análisis,
    y precarga "qué demostró" y "qué lo separa del nivel siguiente";
  · el informe muestra una barra por requisito (en el encabezado y en cada fila), y el
    porqué como UN párrafo con lo positivo y lo que faltó, sin rótulos; en nivel 5 no hay brecha;
  · la brecha sobrevive a emitir y reabrir (va en el snapshot);
  · la bajada del encabezado conjuga bien ("quedaron", no "quedóron").
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
    pg.on("dialog", lambda d: d.accept())

    # ---------- A. Levantamiento: un criterio por pregunta ----------
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    rev = pg.inner_text("#vRevision")
    if "Se da por buena si" not in rev or "Debe nombrar la empresa y el periodo" not in rev:
        errs.append("la revisión del levantamiento no muestra el criterio bajo cada pregunta")
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    vac_id = pg.evaluate("() => VAC.id")

    # ---------- B. Edición: el criterio al lado de su pregunta, y se guarda ----------
    pg.click("#btnEditarVac"); pg.wait_for_selector("#vEditar.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click('[data-open="0"]'); pg.wait_for_timeout(250)
    if not pg.query_selector('[data-r="c_escena"][data-i="0"]'):
        errs.append("la edición no tiene el campo del criterio de la pregunta de escena")
    else:
        pg.fill('[data-r="c_escena"][data-i="0"]', "Debe decir la empresa, el año y qué parte del rollout hizo él.")
        pg.wait_for_timeout(150)
        pg.click("#btnGuardarEdit"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(400)
        v = json.load(urllib.request.urlopen(B + f"api/vacancies/{vac_id}"))
        c0 = (v.get("requirements") or [{}])[0].get("c_escena") or ""
        if "el año y qué parte" not in c0:
            errs.append(f"el criterio editado no se guardó en la vacante: {c0!r}")
        if not (v["requirements"][1].get("c_friccion") or ""):
            errs.append("el criterio de fricción del segundo requisito se perdió al guardar")

    # ---------- C. La guía en vivo muestra el criterio bajo la pregunta ----------
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Yesid Estupiñán"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate("() => { S.idc = {grab:true, cam:true}; touch(); }")
    visto = False
    for _ in range(12):
        tx = pg.inner_text("#stage")
        if "Se da por buena si" in tx and "el año y qué parte" in tx:
            visto = True; break
        b = pg.query_selector("#stage [data-next]")
        if not b or pg.query_selector("#btnATranscripcion"): break
        b.click(); pg.wait_for_timeout(200)
    if not visto:
        errs.append("la guía en vivo no muestra el criterio bajo la pregunta")
    pg.screenshot(path="/tmp/pk/crit_01_guia.png", full_page=True)
    flujo.recorrer_guia(pg)

    # ---------- D. Calificación: criterio por criterio, demostró y brecha ----------
    flujo.pegar_transcripcion(pg); pg.wait_for_timeout(300)
    cal = pg.inner_text("#stage").lower()
    if "criterio por criterio" not in cal or "cumplido" not in cal:
        errs.append("la calificación no muestra el criterio por criterio del análisis")
    if not pg.query_selector("[data-brecha]"):
        errs.append("la calificación no tiene el campo de la brecha")
    if "qué demostró" not in cal:
        errs.append("la calificación no rotula 'qué demostró'")
    pg.screenshot(path="/tmp/pk/crit_02_calif.png", full_page=True)
    # primer requisito: nivel 5 (sin brecha); segundo: 4 con brecha escrita a mano
    flujo.confirmar_niveles(pg, (5,))
    pg.click('[data-lv="4"]'); pg.wait_for_timeout(120)
    if not pg.input_value("[data-porque]").strip():
        pg.fill("[data-porque]", "Explicó la integración con un caso propio y precisó los quiebres.")
    pg.fill("[data-brecha]", "Sin embargo, describió el quiebre sin decir qué rehízo, que era lo que la pregunta pedía.")
    pg.wait_for_timeout(200)
    pg.click("[data-next]"); pg.wait_for_timeout(350)
    for _ in range(6):
        if "Cierre de la sesión" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(300)
    pg.evaluate("() => { S.reqs.forEach(r => { if(!r.lvl) r.lvl = 4; if(porqueDe(r).length <= EV_MIN) r.exp = 'Demostró el requisito con un caso propio.'; }); touch(); S.fase = fases().length - 1; render(); }")
    pg.wait_for_timeout(300)
    pg.click("#stage #btnActa"); pg.wait_for_selector("#vActa.on", timeout=15000); pg.wait_for_timeout(500)

    # ---------- E. El informe: barras y dos renglones ----------
    acta = pg.inner_text("#actaStage")
    pg.screenshot(path="/tmp/pk/crit_03_acta.png", full_page=True)
    if pg.eval_on_selector_all("#actaStage .score .sc", "els => els.length") != 2:
        errs.append("el encabezado no trae una barra por requisito")
    if pg.eval_on_selector_all("#actaStage .req .b5", "els => els.length") < 2:
        errs.append("las filas de requisito no traen la barra de cinco")
    llenos = pg.eval_on_selector_all("#actaStage .score .sc:nth-child(2) .b5 i.on", "els => els.length")
    if llenos != 5:
        errs.append(f"la barra del primer requisito (nivel 5) tiene {llenos} tramos llenos")
    # Lo positivo y lo que faltó van en el mismo párrafo, sin rótulos que lo deletreen.
    if "Para llegar a" in acta or "Demostró:" in acta or "Brecha" in acta:
        errs.append("el informe rotula el porqué ('Para llegar a 5', 'Brecha'): tiene que ser un solo párrafo")
    fila2 = pg.inner_text("#actaStage .req:nth-of-type(2) .aex")
    if "precisó los quiebres" not in fila2 or "sin decir qué rehízo" not in fila2:
        errs.append(f"la fila en 4 no lleva lo positivo y lo que faltó en un mismo párrafo: {fila2!r}")
    fila1 = pg.inner_text("#actaStage .req:nth-of-type(1) .aex")
    if "Sin embargo" in fila1:
        errs.append("el requisito en 5 lleva brecha, y en 5 no hay brecha")
    if "quedóron" in acta or "quederón" in acta:
        errs.append("la bajada sigue mal conjugada")
    if "2 quedaron sostenidos" not in acta:
        errs.append("la bajada no dice '2 quedaron sostenidos'")

    # ---------- F. La brecha sobrevive a reabrir ----------
    sid = pg.evaluate("() => S.sid")
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(400)
    pg.click(f'[data-ses="{sid}"]'); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
    if "sin decir qué rehízo" not in pg.inner_text("#actaStage"):
        errs.append("al reabrir el informe se perdió la brecha (no va en el snapshot)")

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

"""Falta indagar → repregunta.

Pasaba que un buen candidato salía mal calificado porque en la llamada nadie le pidió el caso.
El análisis distingue "no lo demostró" de "falta indagar" y, para lo segundo, trae preguntas
listas. El evaluador programa una llamada corta, pega esa transcripción y se combina con la
primera — solo en los requisitos repreguntados.

Lo que hay que sostener:
  · el requisito que quedó corto muestra FALTA INDAGAR con el punto y las preguntas;
  · el cierre lo resume antes de emitir y deja elegir qué llevar a la llamada;
  · programarla deja la verificación en el tablero como REPREGUNTAR;
  · la pantalla de la repregunta muestra las preguntas y acepta una transcripción corta;
  · al combinar, solo cambia lo repreguntado, se ve de dónde viene el nivel nuevo, y lo
    que no se repreguntó sigue pidiendo indagar;
  · se puede cancelar y calificar con lo que hay.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from flujo import TRANSCRIPCION, recorrer_guia, pegar_transcripcion, avanzar_hasta, ir_a_fase

AQUI = os.path.dirname(os.path.abspath(__file__))
PORT = random.randint(3200, 3600)
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
REP = ("Reclutador: la vez pasada me contaste del rollout; cuando fallo la integracion con calidad, que hiciste tu?\n"
       "Candidato: arme yo los planes de inspeccion uno por uno con el QM y los probe con el equipo de planta.\n") * 2


def api(path):
    return json.loads(urllib.request.urlopen(B + path, timeout=5).read())


def preparar(pg):
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Dayana Maussá"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    preparar(pg)
    recorrer_guia(pg)
    pegar_transcripcion(pg, TRANSCRIPCION + "\n__FALTA_INDAGAR__\n")
    sid = pg.evaluate("() => S.sid")

    # ---------- A. El requisito que quedó corto ----------
    avanzar_hasta(pg, "[data-lv]")
    st = pg.inner_text("#stage")
    if "FALTA INDAGAR" not in st.upper():
        errs.append("el requisito que quedó corto no dice FALTA INDAGAR")
    if "paso a paso" not in st:
        errs.append("no muestra las preguntas para la repregunta")
    if "no se imprime" not in st.lower():
        errs.append("no aclara que es uso interno")
    if not pg.query_selector('.lv.sel[data-lv="3"]'):
        errs.append("el nivel propuesto con lo que hay debería quedar en 3")
    pg.locator(".indagar").scroll_into_view_if_needed()
    pg.screenshot(path="/tmp/pk/rep_01_requisito.png", full_page=False)

    # ---------- B. El cierre lo resume y deja elegir ----------
    ir_a_fase(pg, "cierre")
    st = pg.inner_text("#stage")
    if "Faltó indagar en 2 requisitos" not in st:
        errs.append(f"el cierre no resume lo que faltó indagar: {st[:200]!r}")
    cajas = pg.query_selector_all('#stage [data-repsel]')
    if len(cajas) != 2:
        errs.append(f"el cierre debería dejar elegir 2 requisitos, hay {len(cajas)}")
    else:
        cajas[1].uncheck(); pg.wait_for_timeout(200)
    btn = pg.inner_text("#stage [data-programar]")
    if "(1)" not in btn:
        errs.append(f"al desmarcar uno el botón no cuenta 1: {btn!r}")
    pg.locator("#stage [data-programar]").scroll_into_view_if_needed()
    pg.screenshot(path="/tmp/pk/rep_02_cierre.png", full_page=False)

    # ---------- C. Programarla ----------
    pg.click("#stage [data-programar]"); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")
    pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(500)
    tr = pg.inner_text("#transStage")
    if "Repregunta a Dayana" not in tr:
        errs.append("no abre la pantalla de la repregunta")
    if "paso a paso" not in tr:
        errs.append("la pantalla de la repregunta no muestra las preguntas")
    if "No se tocó" in tr or "Cuéntame de un proyecto" in tr:
        errs.append("lleva el requisito que se desmarcó")
    pg.fill("#transText", "muy corta " * 5); pg.wait_for_timeout(200)
    if not pg.is_disabled("#btnAnalizarTrans"):
        errs.append("deja combinar una transcripción casi vacía")
    pg.fill("#transText", ""); pg.wait_for_timeout(100)
    pg.screenshot(path="/tmp/pk/rep_03_pantalla.png", full_page=True)
    s = api(f"api/sessions/{sid}")
    rq = (s.get("repregunta") or {}).get("requisitos") or []
    if [x["indice"] for x in rq] != [1]:
        errs.append(f"el servidor no guardó la repregunta del requisito 1: {rq!r}")

    # ---------- D. Queda en el tablero ----------
    pg.click("[data-salir]"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(800)
    cola = pg.inner_text("#colaList")
    if "REPREGUNTAR" not in cola.upper():
        errs.append(f"el tablero no muestra REPREGUNTAR: {cola[:160]!r}")
    pg.screenshot(path="/tmp/pk/rep_04_tablero.png", full_page=False)

    # ---------- E. Volver, pegar y combinar ----------
    pg.click('#colaList [data-abrir]:has-text("Dayana")'); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")
    pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)
    b = pg.inner_text("#actaStage")
    if "REPREGUNTAR" not in b.upper() or "pegar la repregunta" not in b.lower():
        errs.append(f"el borrador no lleva a la repregunta: {b[:200]!r}")
    pg.click("#btnRetomar"); pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(400)
    pg.fill("#transText", REP); pg.wait_for_timeout(200)
    if pg.is_disabled("#btnAnalizarTrans"):
        errs.append("no deja combinar una repregunta corta pero real")
    pg.click("#btnAnalizarTrans")
    pg.wait_for_selector("#vLive.on", timeout=20000); pg.wait_for_timeout(700)
    st = pg.inner_text("#stage")
    if "REPREGUNTADO" not in st.upper():
        errs.append("el requisito no dice que viene de la repregunta")
    if not pg.query_selector('.lv.sel[data-lv="4"]'):
        errs.append("el nivel nuevo (4) no quedó propuesto")
    if pg.query_selector(".indagar"):
        errs.append("el requisito repreguntado sigue pidiendo indagar")
    pg.screenshot(path="/tmp/pk/rep_05_repreguntado.png", full_page=False)
    s = api(f"api/sessions/{sid}")
    r = s.get("repregunta") or {}
    if not (r.get("hecha_at") and r.get("aplicada_at")):
        errs.append(f"el servidor no marcó la repregunta como hecha y aplicada: {r!r}")
    pr = s["transcript_analisis"]["por_requisito"]
    if pr[1].get("nivel") is not None or not (pr[1].get("indagar") or {}).get("falta"):
        errs.append("se tocó el requisito que no se repreguntó")

    # ---------- F. El otro sigue pendiente; programarla y cancelarla ----------
    ir_a_fase(pg, "cierre")
    st = pg.inner_text("#stage")
    if "Faltó indagar en un requisito" not in st:
        errs.append("el requisito no repreguntado debería seguir en el cierre")
    pg.click("#stage [data-programar]"); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")
    pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(400)
    if "ronda 2" not in pg.inner_text("#transStage").lower():
        errs.append("la segunda repregunta no dice que es la ronda 2")
    pg.click("#btnCancelarRep"); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")
    pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)
    if api(f"api/sessions/{sid}").get("repregunta") is not None:
        errs.append("cancelar no quitó la repregunta en el servidor")

    br.close()

STUB.terminate()
if errs:
    print("FALLAS:"); [print("  -", e) for e in errs]; sys.exit(1)
print("OK e2e repregunta: falta indagar, cierre, programar, tablero, combinar, cancelar")

"""Flujo de un cierre verificado: captura del rostro → link de identidad → cotejo → acta."""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json, base64

PORT = random.randint(3200, 3900)
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "stub.js")],
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

def simular(**kw):
    r = urllib.request.Request(B.rstrip('/') + "/api/__simular", data=json.dumps(kw).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(r)

# PNG 2x2 válido, sirve como "captura del video"
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEJRIAAIhQCVQFy2AAAAABJRU5ErkJggg==")

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
    pg.click('[data-lv="5"]'); pg.fill("[data-notes]", "Rollout en Alpina 2023, nueve meses, lideró listas de materiales.")
    pg.wait_for_timeout(150); pg.click("[data-next]"); pg.wait_for_timeout(300)
    pg.click('[data-lv="4"]'); pg.fill("[data-notes]", "Explicó la integración con un caso propio y precisó los quiebres.")
    pg.wait_for_timeout(200); pg.click("[data-next]"); pg.wait_for_timeout(400)
    # fase de contexto
    pg.fill('[data-d="pretension"]', "3.500.000 COP / mes")
    pg.fill('[data-d="disponibilidad"]', "2 semanas")
    pg.fill('[data-d="motivacion"]', "Busca autonomia en la decision tecnica; su salida responde a un techo.")
    pg.fill('[data-d="nogo"]', "Baja autonomia\nEntornos rigidos")
    pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(150)
    pg.fill('[data-r="texto"]', "El nucleo del cargo esta medido y sostenido con evidencia.")
    pg.click("#btnAddRiesgo"); pg.wait_for_timeout(200)
    pg.fill('[data-ri="0"][data-k="r"]', "Integracion con QM sin caso propio")
    pg.fill('[data-ri="0"][data-k="m"]', "Acompanar el primer cierre de mes")
    pg.wait_for_timeout(200)
    pg.click("[data-next]"); pg.wait_for_timeout(600)

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])

    # ---------- A. SONDEO: no debe pedir identidad ----------
    pg = br.new_page(viewport={"width":1120,"height":900})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    preparar(pg, "sondeo")
    ap = pg.inner_text("#stage").lower()
    for prohibido in ["muestras tu cédula", "cédula junto", "gestos aleatorios", "link para confirmar tu identidad"]:
        if prohibido in ap: errs.append(f"el sondeo le pide identificación al candidato: '{prohibido}'")
    if pg.query_selector("#shotBox"): errs.append("el sondeo pide captura del rostro y no debería")
    if len(pg.query_selector_all("[data-idc]")) != 2:
        errs.append(f"el sondeo debería tener 2 puntos de integridad, tiene {len(pg.query_selector_all('[data-idc]'))}")
    for k in ["grab","cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)
    calificar(pg)
    if pg.query_selector("#btnEnviarId"): errs.append("el sondeo ofrece verificación de identidad")
    if pg.is_disabled("#btnActa"): errs.append("el sondeo no deja emitir estando completo")
    pg.screenshot(path="/tmp/pk/id_01_sondeo_cierre.png", full_page=True)
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
    acta = pg.inner_text("#actaStage").lower()
    if "ficha de sondeo" not in acta: errs.append("el documento del sondeo no se llama ficha")
    if "no certifica identidad" not in acta: errs.append("la ficha no aclara que no certifica identidad")
    pg.screenshot(path="/tmp/pk/id_02_ficha.png", full_page=True)
    pg.close()

    # ---------- B. CIERRE: captura, link, cotejo y acta ----------
    simular(status="Approved", score=96.4, verdict="coincide")
    pg = br.new_page(viewport={"width":1120,"height":900})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    preparar(pg, "cierre")
    if not pg.query_selector("#shotBox"): errs.append("el cierre no pide captura del rostro")
    if len(pg.query_selector_all("[data-idc]")) != 3: errs.append("el cierre debería tener 3 puntos de integridad")
    for k in ["grab","cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)
    # subir la captura
    pg.set_input_files("#shotFile", {"name":"captura.png", "mimeType":"image/png", "buffer":PNG})
    pg.wait_for_timeout(900)
    if "guardada" not in pg.inner_text("#shotBox").lower(): errs.append("la captura no quedó marcada como guardada")
    pg.screenshot(path="/tmp/pk/id_03_apertura_cierre.png", full_page=True)
    calificar(pg)

    # sin verificación enviada, el acta debe estar bloqueada
    if not pg.is_disabled("#btnActa"): errs.append("el cierre dejó emitir sin resolver la identidad")
    if not pg.query_selector("#btnEnviarId"): errs.append("falta el botón de generar el link")
    pg.screenshot(path="/tmp/pk/id_04_cierre_pendiente.png", full_page=True)

    pg.click("#btnEnviarId"); pg.wait_for_timeout(800)
    cie = pg.inner_text("#stage")
    if "verify.didit.me" not in cie: errs.append("no apareció el link de verificación")
    if not pg.is_disabled("#btnActa"): errs.append("dejó emitir con la verificación apenas enviada")

    pg.click("#btnRefrescarId"); pg.wait_for_timeout(1000)
    cie2 = pg.inner_text("#stage")
    if "VERIFICADA" not in cie2.upper(): errs.append("no quedó marcada como verificada tras el cotejo")
    if "96.4" not in cie2: errs.append("no muestra el puntaje de coincidencia")
    if pg.is_disabled("#btnActa"): errs.append("no deja emitir con la identidad verificada")
    pg.screenshot(path="/tmp/pk/id_05_cierre_verificado.png", full_page=True)

    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
    acta = pg.inner_text("#actaStage")
    for must in ["Informe de verificación", "VERIFICADA", "96.4", "prueba de vida"]:
        if must.lower() not in acta.lower(): errs.append(f"falta en el acta verificada: {must}")
    if "no certifica identidad" in acta.lower(): errs.append("el acta verificada dice que no certifica identidad")
    pg.screenshot(path="/tmp/pk/id_06_acta_verificada.png", full_page=True)
    pg.close()

    # ---------- C. El candidato no quiso ----------
    pg = br.new_page(viewport={"width":1120,"height":900})
    pg.on("dialog", lambda d: d.accept())
    preparar(pg, "cierre")
    for k in ["grab","cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)
    pg.set_input_files("#shotFile", {"name":"c.png","mimeType":"image/png","buffer":PNG}); pg.wait_for_timeout(800)
    calificar(pg)
    pg.click("#btnRechazoId"); pg.wait_for_timeout(700)
    cie3 = pg.inner_text("#stage")
    if "NO QUISO" not in cie3.upper(): errs.append("no marcó que el candidato no quiso")
    if "ROJO" in cie3.upper(): errs.append("negarse puso el semáforo en rojo — no debería")
    if pg.is_disabled("#btnActa"): errs.append("negarse bloqueó la emisión — debería emitir sin capa de identidad")
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
    a3 = pg.inner_text("#actaStage").lower()
    if "verificación de conocimiento" not in a3: errs.append("el acta sin identidad no lo dice en el título")
    if "no certifica" not in a3: errs.append("el acta sin identidad no lo aclara en el respaldo")
    pg.screenshot(path="/tmp/pk/id_07_acta_sin_identidad.png", full_page=True)
    pg.close()

    # ---------- D. El rostro no corresponde ----------
    simular(status="Approved", score=12.0, verdict="no_coincide")
    pg = br.new_page(viewport={"width":1120,"height":900})
    preparar(pg, "cierre")
    for k in ["grab","cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)
    pg.set_input_files("#shotFile", {"name":"c.png","mimeType":"image/png","buffer":PNG}); pg.wait_for_timeout(800)
    calificar(pg)
    pg.click("#btnEnviarId"); pg.wait_for_timeout(700)
    pg.click("#btnRefrescarId"); pg.wait_for_timeout(1000)
    cie4 = pg.inner_text("#stage").upper()
    if "ROJO" not in cie4: errs.append("un rostro que no corresponde debería poner el semáforo en rojo")
    if not pg.is_disabled("#btnActa"): errs.append("dejó emitir con el rostro no coincidente")
    pg.screenshot(path="/tmp/pk/id_08_rostro_no_coincide.png", full_page=True)
    pg.close()

    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

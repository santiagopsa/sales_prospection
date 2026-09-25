"""Se verifica UN empleo, el más reciente declarado, y no otro.

Lo que pasó en producción: una verificación salió con un empleo ANTERIOR, sin relación con el
cargo, marcado como verificado (porque ahí estaba el caso de un requisito), y otra dejó sin
verificar el último empleo aunque se había narrado. Lo que hay que sostener:
  · sin CV, el reclutador anota el último empleo en la entrevista y la pregunta lo nombra;
  · ese empleo viaja como ancla al análisis;
  · si el análisis verifica OTRO empleo, no se le cree: el declarado queda no verificado, con
    el aviso, y el informe no nombra al otro;
  · si del empleo declarado no se habló, queda no verificado y se ve qué faltó;
  · el reclutador puede corregirlo (verificada + porqué) y eso es lo que sale en el informe;
  · si lo que contó no cuadra con lo declarado, la propuesta es "no coincide";
  · el cierre avisa cuando el empleo no está verificado y lleva a la fase para revisarlo.
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


def sesion(pg, vac_id, nombre, empresa=None):
    pg.evaluate(f"() => verVacante({vac_id})"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(250)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", nombre); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate("() => { S.idc = {grab:true, cam:true}; touch(); }")
    flujo.avanzar_hasta(pg, "#pregEmp", maximo=8)
    if empresa:
        pg.fill('[data-emp="empresa"]', empresa)
        pg.fill('[data-emp="cargo"]', "Analista de datos")
        pg.fill('[data-emp="periodo"]', "2023 – actualidad")
        pg.wait_for_timeout(200)
    return pg.evaluate("() => S.sid")


def hasta_cierre(pg):
    flujo.confirmar_niveles(pg, (5, 4))
    for _ in range(8):
        if "Cierre de la sesión" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(300)


def emitir(pg):
    pg.evaluate("() => { S.reqs.forEach(r => { if(!r.lvl) r.lvl = 4; if(porqueDe(r).length <= EV_MIN) r.exp = 'Demostró el requisito con un caso propio.'; }); touch(); S.fase = fases().length - 1; render(); }")
    pg.wait_for_timeout(300)
    pg.click("#stage #btnActa"); pg.wait_for_selector("#vActa.on", timeout=15000); pg.wait_for_timeout(500)
    return pg.inner_text("#actaStage")


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    vac_id = pg.evaluate("() => VAC.id")

    # ---------- A. Sin CV: el reclutador ancla el empleo; el análisis verifica OTRO ----------
    sid = sesion(pg, vac_id, "Ana Otro Empleo", empresa="Bancolombia")
    if "Bancolombia" not in pg.inner_text("#pregEmp"):
        errs.append("la pregunta no se actualiza con la empresa que anotó el reclutador")
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg, flujo.TRANSCRIPCION + " __OTRO_EMPLEO__ ")
    ses = json.load(urllib.request.urlopen(B + f"api/sessions/{sid}"))
    if (ses.get("__empleo_recibido") or {}).get("empresa") != "Bancolombia":
        errs.append(f"el ancla no llegó al análisis: {ses.get('__empleo_recibido')!r}")
    ex = (ses.get("transcript_analisis") or {}).get("experiencia_reciente") or {}
    if ex.get("empresa") != "Bancolombia" or ex.get("estado") != "no_verificada" or ex.get("aviso") != "otro_empleo":
        errs.append(f"el servidor no concilió el empleo contra el ancla: {ex!r}")
    hasta_cierre(pg)
    tx = pg.inner_text("#stage")
    if "último empleo queda como no verificado" not in tx.lower():
        errs.append("el cierre no avisa que el último empleo queda no verificado")
    pg.click("#btnIrExp"); pg.wait_for_timeout(400)
    tx = pg.inner_text("#stage")
    if "otro empleo" not in tx.lower() or "Nutresa" not in tx:
        errs.append("la fase no explica que el análisis se refirió a otro empleo")
    if not pg.query_selector('[data-expest="no_verificada"].sel'):
        errs.append("con el análisis sobre otro empleo, la propuesta no quedó en 'no verificada'")
    pg.screenshot(path="/tmp/pk/emp_01_otro.png", full_page=True)
    acta = emitir(pg)
    if "Nutresa" in acta:
        errs.append("el informe nombra el empleo anterior que el análisis verificó por error")
    if "Bancolombia" not in acta or "NO VERIFICADA" not in acta.upper():
        errs.append("el informe no muestra el empleo declarado como no verificado")

    # ---------- B. Del empleo declarado no se habló: el reclutador lo corrige ----------
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(300)
    sid = sesion(pg, vac_id, "Bruno Sin Empleo", empresa="Rappi")
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg, flujo.TRANSCRIPCION + " __SIN_EMPLEO__ ")
    flujo.confirmar_niveles(pg, (5, 4))
    flujo.avanzar_hasta(pg, '[data-expest="verificada"]')
    tx = pg.inner_text("#stage")
    if "no se habló" not in tx.lower():
        errs.append("no muestra qué faltó cuando del empleo no se habló")
    if not pg.query_selector('[data-expest="no_verificada"].sel'):
        errs.append("sin conversación sobre el empleo, la propuesta no es 'no verificada'")
    pg.click('[data-expest="verificada"]'); pg.wait_for_timeout(300)
    if not pg.query_selector("[data-exppq]"):
        errs.append("al marcar verificada no aparece el porqué que se imprime")
    else:
        pg.fill("[data-exppq]", "Describió sus responsabilidades en Rappi con un caso propio y fechas consistentes con lo declarado.")
        pg.wait_for_timeout(200)
    for _ in range(4):
        if "Cierre de la sesión" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(300)
    if "último empleo queda como no verificado" in pg.inner_text("#stage").lower():
        errs.append("marcado como verificado, el cierre sigue avisando")
    acta = emitir(pg)
    if "Rappi" not in acta or "Describió sus responsabilidades en Rappi" not in acta:
        errs.append("el informe no refleja el empleo verificado a mano con su porqué")
    if "NO VERIFICADA" in acta.upper():
        errs.append("el informe dice no verificada después de marcarla verificada")

    # ---------- C. Lo que contó no cuadra: 'no coincide' ----------
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(300)
    sid = sesion(pg, vac_id, "Carla Contradice", empresa="Alpina")
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg, flujo.TRANSCRIPCION + " __CONTRADICE__ ")
    flujo.confirmar_niveles(pg, (5, 4))
    flujo.avanzar_hasta(pg, '[data-expest="contradice"]')
    if not pg.query_selector('[data-expest="contradice"].sel'):
        errs.append("con C4 incumplido la propuesta no es 'no coincide'")
    pg.screenshot(path="/tmp/pk/emp_02_contradice.png", full_page=True)

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

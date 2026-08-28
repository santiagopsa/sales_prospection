"""Con CV cargado: preguntas del candidato, fase de trayectoria y bloque en el acta."""
from playwright.sync_api import sync_playwright
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import flujo
import sys, time, subprocess, os, random, urllib.request

PORT = random.randint(3200, 3900)
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "stub.js")],
                        env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None: print("el stub murió"); sys.exit(1)
    try: urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception: time.sleep(0.25)

errs = []
T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es que haya hecho un rollout de PP en produccion. "
     "Tambien tiene que entender como PP se conversa con MM y QM. Rechazamos dos que sabian la teoria. ") * 4
CV = ("JORGE RESTREPO — Consultor SAP PP. Alpina, 2023 a la fecha: lidero el rollout del modulo PP "
      "y el soporte al maestro de materiales para tres plantas. Quala, 2020 a 2022: analista funcional, "
      "soporte a produccion y construccion de reportes. Formacion: Ingenieria Industrial, Universidad de Antioquia. ") * 3

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width":1120,"height":900})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("console", lambda m: errs.append(f"CONSOLE: {m.text}") if (m.type=="error" and "TUNNEL" not in m.text and "fonts" not in m.text) else None)

    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(300)

    # el CV se carga antes de iniciar
    if not pg.query_selector("#cvDrop"): errs.append("no hay zona para cargar el CV")
    pg.set_input_files("#cvFile", {"name":"cv.txt","mimeType":"text/plain","buffer":CV.encode()})
    pg.wait_for_timeout(1000)
    if "listo" not in pg.inner_text("#cvSub").lower(): errs.append("el CV no quedó cargado")
    pg.fill("#sCand", "Jorge Restrepo"); pg.fill("#sEval", "Laura M."); pg.wait_for_timeout(150)
    pg.screenshot(path="/tmp/pk/cv_01_setup.png", full_page=True)

    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=15000); pg.wait_for_timeout(600)

    # la fase de trayectoria solo aparece porque hay CV
    nav = pg.inner_text("#phaseNav")
    if "Trayectoria" not in nav: errs.append("no apareció la fase de trayectoria")

    for k in ["grab","cam"]: pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(400)

    # requisito 1: preguntas sacadas del CV
    r1 = pg.inner_text("#stage")
    # La pregunta del CV ya no vive en un recuadro aparte: reemplaza a la genérica y se
    # lee arriba, marcada como "del CV".
    for must in ["del CV", "Alpina", "llévame a ese proyecto"]:
        if must.lower() not in r1.lower(): errs.append(f"el requisito 1 no trae del CV: {must}")
    pg.screenshot(path="/tmp/pk/cv_02_requisito.png", full_page=True)
    pg.click("[data-next]"); pg.wait_for_timeout(400)

    # requisito 2: el CV no lo cubre y debe avisarlo — durante la entrevista, en la guía
    r2 = pg.inner_text("#stage")
    if "no menciona" not in r2.lower(): errs.append("no avisa que el CV no cubre el segundo requisito")

    # la trayectoria durante la entrevista es guía: se pregunta, no se marca.
    # Se busca por selector porque entremedio puede haber una fase de inglés.
    flujo.avanzar_hasta(pg, "#stage .tray")
    tg = pg.inner_text("#stage")
    if "Trayectoria" not in tg: errs.append("la trayectoria no aparece durante la entrevista")
    if pg.query_selector('[data-tray="0"][data-est="confirmado"]'):
        errs.append("durante la entrevista deja marcar la trayectoria — eso viene con la transcripción")

    # entrevista → transcripción → niveles confirmados
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg)
    flujo.confirmar_niveles(pg, (5, 3), [
        "Narró el rollout de Alpina con fechas, alcance y el problema de MRP.",
        "Sondeado desde cero; la escena quedó genérica.",
    ])

    # trayectoria: ahora sí se marca. Se avanza por selector y no contando clics, porque
    # entremedio puede haber una fase de inglés según lo que pida la vacante.
    flujo.avanzar_hasta(pg, '[data-tray="0"][data-est="confirmado"]')
    tr = pg.inner_text("#stage")
    for must in ["Trayectoria", "Alpina", "Quala", "Hueco de casi un año"]:
        if must.lower() not in tr.lower(): errs.append(f"la fase de trayectoria no muestra: {must}")
    pg.screenshot(path="/tmp/pk/cv_03_trayectoria.png", full_page=True)
    pg.click('[data-tray="0"][data-est="confirmado"]'); pg.wait_for_timeout(200)
    pg.click('[data-tray="1"][data-est="sin_sostener"]'); pg.wait_for_timeout(300)
    pg.click("[data-next]"); pg.wait_for_timeout(500)

    # contexto y cierre
    pg.fill('[data-d="pretension"]', "3.500.000 COP / mes")
    pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(120)
    pg.fill('[data-r="texto"]', "Sostiene el rollout; la integración con QM quedó sin evidencia.")
    pg.wait_for_timeout(150); pg.click("[data-next]"); pg.wait_for_timeout(600)
    if pg.is_disabled("#btnActa"): errs.append("no deja emitir con todo completo")
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)

    acta = pg.inner_text("#actaStage")
    for must in ["Confirmada frente a declarada", "Alpina", "CONFIRMADA", "SIN SOSTENER", "Trayectoria contrastada"]:
        if must.lower() not in acta.lower(): errs.append(f"el acta no trae: {must}")
    pg.screenshot(path="/tmp/pk/cv_04_acta.png", full_page=True)

    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

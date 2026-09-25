"""Con CV cargado: preguntas del candidato, el último empleo anclado a la hoja de vida y bloque en el acta."""
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

    # el tramo del último empleo está siempre; con CV arranca anclado al primer empleo declarado
    nav = pg.inner_text("#phaseNav")
    if "Último empleo" not in nav: errs.append("no apareció la fase del último empleo")
    sid = pg.evaluate("() => S.sid")

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

    # El último empleo durante la entrevista: anclado a la hoja de vida, con la pregunta literal y
    # su criterio. Se pregunta, no se marca. La trayectoria completa queda plegada, sin verificar.
    flujo.avanzar_hasta(pg, "#pregEmp")
    tg = pg.inner_text("#stage")
    if pg.input_value('[data-emp="empresa"]') != "Alpina":
        errs.append(f"el último empleo no quedó anclado al primero de la hoja de vida: {pg.input_value('[data-emp=empresa]')!r}")
    if "Alpina" not in pg.inner_text("#pregEmp"): errs.append("la pregunta del último empleo no nombra la empresa")
    if "Se da por buena si" not in tg: errs.append("la pregunta del último empleo no trae su criterio")
    if "no se verifican" not in tg.lower(): errs.append("no aclara que los empleos anteriores no se verifican")
    if "Hueco de casi un año" not in tg: errs.append("los puntos abiertos del CV no aparecen durante la entrevista")
    if pg.query_selector('[data-expest]'):
        errs.append("durante la entrevista deja marcar el empleo — eso viene con la transcripción")
    pg.screenshot(path="/tmp/pk/cv_03a_empleo_guia.png", full_page=True)

    # entrevista → transcripción → niveles confirmados
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg)
    flujo.confirmar_niveles(pg, (5, 3), [
        "Narró el rollout de Alpina con fechas, alcance y el problema de MRP.",
        "Sondeado desde cero; la escena quedó genérica.",
    ])

    # El análisis recibió el empleo declarado como ancla.
    import json as _json
    ses = _json.load(urllib.request.urlopen(B + f"api/sessions/{sid}"))
    if ((ses.get("__empleo_recibido") or {}).get("empresa")) != "Alpina":
        errs.append(f"el análisis no recibió el último empleo como ancla: {ses.get('__empleo_recibido')!r}")

    # Último empleo en la calificación: criterio por criterio y el estado propuesto.
    flujo.avanzar_hasta(pg, '[data-expest="verificada"]')
    tr = pg.inner_text("#stage")
    for must in ["Último empleo", "C1", "C3", "En Alpina, entre marzo y noviembre"]:
        if must.lower() not in tr.lower(): errs.append(f"la fase del último empleo no muestra: {must}")
    if not pg.query_selector('[data-expest="verificada"].sel'):
        errs.append("la propuesta del análisis (verificada) no quedó seleccionada")
    pg.screenshot(path="/tmp/pk/cv_03_empleo.png", full_page=True)
    pg.click("[data-next]"); pg.wait_for_timeout(500)

    # contexto y cierre
    pg.fill('[data-d="pretension"]', "3.500.000 COP / mes")
    pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(120)
    pg.fill('[data-r="texto"]', "Sostiene el rollout; la integración con QM quedó sin evidencia.")
    pg.wait_for_timeout(150); pg.click("[data-next]"); pg.wait_for_timeout(600)
    if pg.is_disabled("#btnActa"): errs.append("no deja emitir con todo completo")
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)

    acta = pg.inner_text("#actaStage")
    # El informe ya no lista la trayectoria entera: en 30 minutos se verifica UN empleo, el
    # más reciente, y las anteriores no se mencionan. Lo que tiene que estar es ese empleo,
    # con su veredicto, y el resumen de lo que el candidato narró.
    for must in ["Alpina", "Experiencia"]:
        if must.lower() not in acta.lower(): errs.append(f"el acta no trae: {must}")
    if "verificada" not in acta.lower():
        errs.append("el acta no dice si la experiencia reciente quedó verificada")
    if "quala" in acta.lower():
        errs.append("el acta menciona una experiencia anterior: solo se reporta la más reciente")
    pg.screenshot(path="/tmp/pk/cv_04_acta.png", full_page=True)

    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

"""Prueba end-to-end del flujo completo contra el stub."""
from playwright.sync_api import sync_playwright
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import flujo
import sys, time, subprocess, os, random, urllib.request

PORT = random.randint(3200, 3900)
B = f"http://127.0.0.1:{PORT}/verificacion/"   # se prueba montada, no en la raíz
STUB = subprocess.Popen(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "stub.js")],
                        env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None:
        print("el stub murió al arrancar (código", STUB.poll(), ")"); sys.exit(1)
    try:
        urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception:
        time.sleep(0.25)
else:
    print("el stub no respondió a tiempo"); sys.exit(1)

errs = []

TRANSCRIPT = ("Marcela: bueno, cuéntenos qué necesitamos. Necesitamos un consultor SAP PP senior. "
              "Lo mínimo es que haya hecho un rollout de PP en produccion, sin eso no nos sirve. "
              "Tambien tiene que entender como PP se conversa con compras y con calidad, o sea MM y QM. "
              "Ya rechazamos dos candidatos que sabian la teoria pero nunca habian estado en un go-live. "
              "El salario esta entre 12 y 15 millones, hibrido en Bogota, y necesitamos terna en tres semanas. "
              "Ojala se defienda en ingles pero eso no es obligatorio. ") * 3

def shot(page, name):
    page.screenshot(path=f"/tmp/pk/{name}.png", full_page=True)

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--proxy-bypass-list=<-loopback>","--no-proxy-server"])
    pg = br.new_page(viewport={"width":1120,"height":900}, device_scale_factor=2)
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("console", lambda m: errs.append(f"CONSOLE {m.type}: {m.text}") if (m.type=="error" and "TUNNEL" not in m.text and "fonts.googleapis" not in m.text) else None)

    # --- tablero vacío ---
    pg.goto(B); pg.wait_for_timeout(700)
    assert "Vacantes verificables" in pg.inner_text("#vTablero"), "no cargó el tablero"
    assert "Todavía no hay vacantes" in pg.inner_text("#vacList"), "estado vacío mal"
    shot(pg, "app_01_tablero_vacio")

    # --- levantamiento ---
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(300)
    pg.fill("#srcText", TRANSCRIPT)
    pg.fill("#hEmp", "IDOM"); pg.fill("#hRol", "Consultor SAP PP"); pg.fill("#hRec", "Laura M.")
    pg.wait_for_timeout(200)
    assert not pg.is_disabled("#btnAnalizar"), "el botón de analizar sigue deshabilitado"
    shot(pg, "app_02_levantamiento")

    pg.click("#btnAnalizar")
    pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(500)
    rev = pg.inner_text("#revStage").lower() + " ".join(i.input_value() for i in pg.query_selector_all("#revStage input")).lower()
    for must in ["Revisa antes de guardar","Implementación de SAP PP","Integración PP con MM y QM",
                 "Detalles verificables","rechazaron candidatos antes","falta preguntarle al cliente"]:
        if must.lower() not in rev: errs.append(f"falta en revisión: {must}")
    assert pg.input_value("#rEmp") == "IDOM"
    assert pg.input_value("#rTit") == "Consultor SAP PP"
    shot(pg, "app_03_revision")

    # --- guardar vacante ---
    pg.click("#btnGuardarVac")
    pg.wait_for_selector("#vVacante.on", timeout=10000); pg.wait_for_timeout(500)
    vac = pg.inner_text("#vacStage").lower()
    for must in ["Consultor SAP PP","IDOM","Lo que se verifica","2 requisitos excluyentes",
                 "Verificar a un candidato","CS01"]:
        if must.lower() not in vac: errs.append(f"falta en vacante: {must}")
    shot(pg, "app_04_vacante")

    # --- setup de sesión ---
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(400)
    assert pg.is_disabled("#btnIniciar"), "debería estar bloqueado sin candidato"
    pg.fill("#sCand", "Jorge Restrepo"); pg.fill("#sEval", "Laura M.")
    pg.wait_for_timeout(200)
    assert not pg.is_disabled("#btnIniciar"), "no se habilitó el botón de iniciar"
    shot(pg, "app_05_setup")

    pg.click("#btnIniciar")
    pg.wait_for_selector("#vLive.on", timeout=10000); pg.wait_for_timeout(400)

    # --- apertura (sondeo: sin identidad) ---
    live = pg.inner_text("#stage")
    assert "Apertura" in live and "DILO ASÍ" in live
    # cada click re-renderiza el DOM, así que se selecciona de nuevo cada vez
    for k in ["grab","cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(120)
    if pg.query_selector_all(".chk.on").__len__() != 2: errs.append("no quedaron 2 puntos de integridad")
    shot(pg, "app_06_identidad")
    pg.click("[data-next]"); pg.wait_for_timeout(400)

    # --- requisito 1: debe traer las preguntas de la BD ---
    r1 = pg.inner_text("#stage").lower()
    for must in ["Implementación de SAP PP","QUÉ BUSCAS OÍR","último rollout de PP","se te cayó en ese go-live",
                 "Detalles verificables","CS01","Señales de impostor"]:
        if must.lower() not in r1: errs.append(f"falta en requisito 1: {must}")
    shot(pg, "app_07_requisito")

    # Durante la llamada la pantalla es guía: no hay nada que calificar todavía.
    if pg.query_selector('[data-lv="5"]'):
        errs.append("durante la entrevista aparecen los botones de calificar")

    # --- una señal, que sí se marca en el momento: no queda en la transcripción ---
    pg.click('[data-sg="lat"]'); pg.wait_for_timeout(200)
    if pg.inner_text("#sigCount") != "1": errs.append("el contador de señales no marcó 1")

    # --- fin de la entrevista, transcripción y confirmación de niveles ---
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg)
    if not pg.query_selector('[data-lv="5"]'):
        errs.append("después de la transcripción no aparecen los niveles")
    flujo.confirmar_niveles(pg, (5, 3), [
        "Rollout en Alpina 2023, 9 meses, lideró la configuración de listas de materiales. Narró el problema de MRP en go-live.",
        "Conoce la integración pero la escena fue genérica; no precisó los puntos de quiebre con QM.",
    ])
    for _ in range(4):
        if pg.query_selector('[data-d="pretension"]'):
            break
        pg.click("[data-next]"); pg.wait_for_timeout(350)

    # --- contexto ---
    pg.fill('[data-d="pretension"]', "3.500.000 COP / mes")
    pg.fill('[data-d="disponibilidad"]', "2 semanas")
    pg.fill('[data-d="motivacion"]', "Busca autonomía en la decisión técnica; su salida responde a un techo, no a un conflicto.")
    pg.fill('[data-d="nogo"]', "Baja autonomía\nEntornos rígidos")
    pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(150)
    pg.fill('[data-r="texto"]', "El núcleo del cargo está medido y sostenido con evidencia. La reserva es la integración con QM.")
    pg.click("#btnAddRiesgo"); pg.wait_for_timeout(200)
    pg.fill('[data-ri="0"][data-k="r"]', "Integración con QM sin caso propio")
    pg.fill('[data-ri="0"][data-k="m"]', "Acompañar el primer cierre de mes")
    pg.wait_for_timeout(200)
    pg.click("[data-next]"); pg.wait_for_timeout(600)

    # --- cierre ---
    cie = pg.inner_text("#stage").lower()
    for must in ["Cierre de la sesión","AMARILLO","Sin carpeta completa no hay acta","Latencia de soplo"]:
        if must.lower() not in cie: errs.append(f"falta en cierre: {must}")
    if pg.is_disabled("#btnActa"): errs.append("el botón de acta quedó bloqueado con todo completo")
    shot(pg, "app_08_cierre")

    # --- acta ---
    pg.click("#btnActa")
    pg.wait_for_selector("#vActa.on", timeout=10000); pg.wait_for_timeout(500)
    acta = pg.inner_text("#actaStage").lower()
    for must in ["Jorge Restrepo","Consultor SAP PP","IDOM","CUMPLE","PARCIAL",
                 "PeakU responde por este informe","Firma de integridad","PKV-2026-"]:
        if must.lower() not in acta: errs.append(f"falta en acta: {must}")
    if "—" in acta.split("firma de integridad:")[1][:12]: errs.append("la firma de integridad llegó vacía")
    shot(pg, "app_09_acta")

    # --- persistencia: recargar debe retomar la sesión ---
    pg.goto(B); pg.wait_for_timeout(900)
    # la sesión ya está emitida (fin=true) → debe ir al tablero y mostrar la verificación
    tb = pg.inner_text("#vTablero").lower()
    for must in ["Consultor SAP PP","Jorge Restrepo","AMARILLO"]:
        if must.lower() not in tb: errs.append(f"falta en tablero tras recargar: {must}")
    shot(pg, "app_10_tablero_lleno")

    # --- regla del servidor: sin evidencia no se emite ---
    import json, urllib.request
    def post(path, data):
        r = urllib.request.Request(B.rstrip("/")+path, data=json.dumps(data).encode(), headers={"Content-Type":"application/json"}, method="POST")
        try:
            return 200, json.loads(urllib.request.urlopen(r).read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())
    code, out = post("/api/sessions", {"vacancy_id":1,"candidate":"Prueba Regla","evaluator":"test","mode":"B"})
    sid = out["id"]
    code, out = post(f"/api/sessions/{sid}/issue", {
        "candidate":"Prueba Regla",
        "identity":{"grab":True,"cam":True},
        "signals":{}, "ratings":[{"req_text":"x","level":5,"evidence":"corto"}]})
    if code != 409: errs.append(f"el servidor emitió acta sin evidencia suficiente (code {code})")
    code, out = post(f"/api/sessions/{sid}/issue", {
        "candidate":"Prueba Regla", "identity":{}, "signals":{},
        "ratings":[{"req_text":"x","level":5,"evidence":"evidencia larga y suficiente aquí"}]})
    if code != 409: errs.append(f"el servidor emitió acta con la integridad de sesión incompleta (code {code})")
    code, out = post(f"/api/sessions/{sid}/issue", {
        "candidate":"Prueba Regla",
        "identity":{"grab":True,"cam":True},
        "signals":{"a":True,"b":True,"c":True},
        "ratings":[{"req_text":"x","level":5,"evidence":"evidencia larga y suficiente aquí"}]})
    if code != 409: errs.append(f"el servidor emitió acta en semáforo rojo (code {code})")

    # el mount point sin slash debe redirigir para que las rutas relativas resuelvan
    r = pg.goto(f"http://127.0.0.1:{PORT}/verificacion")
    if not pg.url.endswith("/verificacion/"): errs.append(f"no redirigió al slash final: {pg.url}")
    pg.wait_for_timeout(600)
    if "Vacantes verificables" not in pg.inner_text("#vTablero"): errs.append("no cargó montada sin slash")
    if pg.evaluate("getComputedStyle(document.body).backgroundColor") in ("rgba(0, 0, 0, 0)","transparent"):
        errs.append("el CSS no cargó bajo el mount point")

    # una ruta de API inexistente debe decirlo en JSON, no servir la aplicación
    import urllib.error
    for ruta, esperado in [("/api/no-existe", 404), ("/api/didit/webhook", 405)]:
        try:
            r = urllib.request.urlopen(f"http://127.0.0.1:{PORT}/verificacion{ruta}", timeout=3)
            code, cuerpo = r.status, r.read().decode()
        except urllib.error.HTTPError as e:
            code, cuerpo = e.code, e.read().decode()
        if code != esperado: errs.append(f"{ruta} devolvió {code}, se esperaba {esperado}")
        if "<html" in cuerpo.lower() or "<div" in cuerpo.lower():
            errs.append(f"{ruta} devolvió HTML en vez de JSON — el fallback se lo está tragando")

    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

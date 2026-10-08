"""Lo que dice el cliente cuando un candidato no avanza.

Para Wei es un solo paso: pegar lo que dijo el cliente. Lo demás corre solo.

Lo que hay que sostener:
  · marcar "No avanzó" abre un cuadro para pegar el mensaje, y se puede saltar;
  · el análisis corre solo y, si propone un ajuste, aparece ARRIBA en el tablero con aplicar o
    descartar; "dijimos que cumplía" cuando la verificación le había dado 4-5;
  · aplicar endurece el requisito de la vacante (y la tarjeta se va);
  · desde la vacante se pega feedback general; lo que no estaba en la vacante se agrega como
    requisito con un clic;
  · si el análisis falla, el texto queda y se reintenta desde el tablero;
  · lo que el cliente rechazó vuelve a la guía de la siguiente entrevista;
  · el indicador de acierto aparece en Indicadores.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
PORT = random.choice([p for p in range(3200, 3900) if p not in (3659,)])
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(AQUI, "stub.js")], env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None: print("el stub murió al arrancar"); sys.exit(1)
    try: urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception: time.sleep(0.25)
else:
    print("el stub no respondió"); sys.exit(1)

def api(ruta, metodo="GET", cuerpo=None):
    r = urllib.request.Request(B + ruta, method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                               headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))

AHORA = datetime.now(timezone.utc)
hace = lambda d=0, h=0: (AHORA - timedelta(days=d, hours=h)).isoformat().replace("+00:00", "Z")
api("api/__sembrar", "POST", {
    "vacantes": [{"title": "Consultor SAP PP", "company_name": "Alpina", "created_at": hace(5), "requisitos": ["Hojas de ruta", "Listas de materiales"]}],
    "sesiones": [
        {"candidate": "Carla Pérez", "evaluator": "Weimar", "vacante": 0, "status": "issued", "semaforo": "verde",
         "started_at": hace(2, 5), "entrevista_at": hace(2, 5), "issued_at": hace(2), "updated_at": hace(2), "ratings": [5, 4]},
        {"candidate": "Juan Gómez", "evaluator": "Weimar", "vacante": 0, "status": "issued", "semaforo": "verde",
         "started_at": hace(1, 5), "entrevista_at": hace(1, 5), "issued_at": hace(1), "updated_at": hace(1), "ratings": [3, 4]},
    ]})
vid = api("api/vacancies")[0]["id"]
ses = {s["candidate"]: s["id"] for s in api("api/sessions")}

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(700)
    if pg.is_visible("#ajustesCard"): errs.append("sin feedback, la tarjeta de ajustes no debería verse")

    # ---------- A. "No avanzó" → pegar y listo ----------
    pg.select_option(f'#sesList [data-cliente="{ses["Carla Pérez"]}"]', "No avanzó")
    pg.wait_for_selector("#fbModal.on", timeout=5000)
    if "Carla" not in pg.inner_text("#fbTitulo"): errs.append("el cuadro no dice de quién es")
    if not pg.is_disabled("#fbSi"): errs.append("deja guardar sin texto")
    pg.fill("#fbInput", "Hola Wei, Carla no siguió: no conocía las hojas de ruta, se enredó con lo básico.")
    pg.screenshot(path="/tmp/pk/fb_00_pegar.png")
    pg.click("#fbSi"); pg.wait_for_timeout(300)
    if pg.is_visible("#fbModal.on"): errs.append("el cuadro no se cerró al guardar")
    if api(f"api/sessions/{ses['Carla Pérez']}").get("cliente_resultado") != "No avanzó":
        errs.append("no quedó anotado 'No avanzó'")

    # ---------- B. El ajuste aparece arriba en el tablero ----------
    pg.wait_for_timeout(1800); pg.evaluate("loadTablero()"); pg.wait_for_timeout(900)
    if not pg.is_visible("#ajustesCard"): errs.append("el ajuste no aparece en el tablero")
    aj = pg.inner_text("#ajustesCard")
    for txt in ["DIJIMOS QUE CUMPLÍA", "Hojas de ruta", "CA01", "Aplicar a la vacante", "le dio 5"]:
        if txt.lower() not in aj.lower(): errs.append(f"la tarjeta de ajustes no dice {txt!r}")
    caja = pg.locator("#ajustesCard").bounding_box(); pulso = pg.locator("#pulsoCard").bounding_box()
    if caja and pulso and caja["y"] > pulso["y"]: errs.append("los ajustes no van arriba del tablero")
    pg.screenshot(path="/tmp/pk/fb_01_tablero.png")

    pg.click("#ajustesList [data-fbok]"); pg.wait_for_timeout(1200)
    if pg.is_visible("#ajustesCard"): errs.append("después de aplicar, la tarjeta sigue")
    r0 = api(f"api/vacancies/{vid}")["requirements"][0]
    if not any(d.get("respuesta_esperada") == "CA01" for d in r0.get("detalles") or []):
        errs.append("aplicar no agregó el detalle verificable al requisito")

    # ---------- C. Desde la vacante: feedback general, requisito oculto ----------
    pg.evaluate(f"verVacante({vid})"); pg.wait_for_selector("#vVacante.on"); pg.wait_for_timeout(600)
    vf = pg.inner_text("#vacFeedback")
    if "Ajuste aplicado" not in vf: errs.append("la vacante no muestra el ajuste ya aplicado")
    pg.click("#btnPegarFb"); pg.wait_for_selector("#fbModal.on")
    if not pg.is_visible("#fbCand"): errs.append("desde la vacante no deja elegir si es sobre un candidato o general")
    pg.fill("#fbInput", "Ninguno de los que mandaron sabía SAP BW, y eso es clave para el equipo.")
    pg.click("#fbSi"); pg.wait_for_timeout(4500)
    vf = pg.inner_text("#vacFeedback")
    if "NO ESTABA EN LA VACANTE" not in vf.upper(): errs.append(f"el feedback general no se leyó como requisito oculto: {vf[:200]!r}")
    pg.locator("#vacFeedback").scroll_into_view_if_needed()
    pg.screenshot(path="/tmp/pk/fb_02_vacante.png")
    pg.click("#vacFeedback [data-fbok]"); pg.wait_for_timeout(1500)
    if "Reportes en SAP BW" not in pg.inner_text("#vacStage"): errs.append("el requisito nuevo no aparece en la vacante")

    # ---------- D. Si el análisis falla, se reintenta desde el tablero ----------
    api("api/feedback", "POST", {"vacancy_id": vid, "session_id": ses["Juan Gómez"], "texto": "No siguió, no conocía las hojas de ruta. __FALLA__"})
    time.sleep(1.2)
    pg.evaluate("loadTablero()"); pg.wait_for_timeout(900)
    aj = pg.inner_text("#ajustesCard") if pg.is_visible("#ajustesCard") else ""
    if "NO SE PUDO ANALIZAR" not in aj.upper(): errs.append("el análisis fallido no aparece en el tablero")
    pg.click("#ajustesList [data-fbre]"); pg.wait_for_timeout(1800); pg.evaluate("loadTablero()"); pg.wait_for_timeout(900)
    if pg.is_visible("#ajustesCard") and "NO SE PUDO" in pg.inner_text("#ajustesCard").upper():
        errs.append("reintentar no lo analizó")
    fj = [f for f in api(f"api/feedback?vacancy_id={vid}") if f.get("session_id") == ses["Juan Gómez"]][0]
    if fj.get("lectura") != "advertido": errs.append(f"a Juan (nivel 3) debería leerse 'ya lo advertíamos': {fj.get('lectura')}")

    # ---------- E. Vuelve a la guía de la siguiente entrevista ----------
    pg.evaluate(f"verVacante({vid})"); pg.wait_for_selector("#vVacante.on"); pg.wait_for_timeout(500)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(300)
    pg.fill("#sCand", "Laura Ríos"); pg.fill("#sEval", "Weimar")
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)
    st = pg.inner_text("#stage")
    if "ya rechazó" not in st.lower() or "hojas de ruta" not in st.lower(): errs.append("la apertura no muestra lo que el cliente ya rechazó")
    pg.screenshot(path="/tmp/pk/fb_03_apertura.png", full_page=True)
    for _ in range(4):
        if "Requisito 1 de" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(350)
    st = pg.inner_text("#stage")
    if "rechazó a alguien por esto" not in st.lower(): errs.append("la guía del requisito no muestra el rechazo que apunta a él")
    if "Pregúntalo" not in st: errs.append("la guía no trae la pregunta sugerida")
    if pg.query_selector(".rechbox"):
        pg.locator(".rechbox").first.scroll_into_view_if_needed()
    pg.screenshot(path="/tmp/pk/fb_04_guia.png")

    # ---------- F. Indicadores ----------
    pg.evaluate("S = null; clearLocal(); navegar('indicadores')"); pg.wait_for_timeout(1200)
    ind = pg.inner_text("#indCuerpo")
    if "Cuando el cliente dice que no" not in ind: errs.append("Indicadores no muestra el acierto de la verificación")
    elif "Acierto de la verificación" not in ind: errs.append("falta el acierto")
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

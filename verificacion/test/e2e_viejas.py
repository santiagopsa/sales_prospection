"""Informes viejos: los que se emitieron antes de que el acta se congelara al emitir.

El problema que esto cierra: el tipo de documento se recalculaba cada vez que se abría el
informe. Un acta entregada como "Informe de verificación" pasaba a mostrarse como "Ficha de
sondeo" en cuanto cambió el modelo — es decir, el software reescribía un documento ya
entregado, justo lo contrario de lo que promete su firma de integridad.

Ahora hay dos comportamientos que hay que sostener:
  · un informe emitido de hoy en adelante se dibuja desde su snapshot y no cambia nunca;
  · uno viejo NO se inventa qué certificaba: lo dice de frente, y la página pública tampoco
    le afirma al cliente un tipo de documento que hoy significaría otra cosa.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json, base64

AQUI = os.path.dirname(os.path.abspath(__file__))
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
PNG = base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8Dwn4GBgYEJRIAAIhQCVQFy2AAAAABJRU5ErkJggg==")
RATINGS = [
    {"req_text": "Implementación de SAP PP en producción (5+ años)", "level": 5,
     "evidence": "Rollout en Alpina 2023, nueve meses, lideró listas de materiales."},
    {"req_text": "Integración PP con MM y QM", "level": 4,
     "evidence": "Explicó los puntos de quiebre con un caso propio."},
]


def pedir(ruta, payload, metodo="POST"):
    r = urllib.request.Request(B.rstrip('/') + ruta, data=json.dumps(payload).encode(),
                               headers={"Content-Type": "application/json"}, method=metodo)
    return json.loads(urllib.request.urlopen(r).read() or b'{}')


def post(ruta, payload):
    return pedir(ruta, payload, "POST")


def simular(**kw):
    post("/api/__simular", kw)


def abrir(pg, nombre):
    pg.click("#btnHome"); pg.wait_for_timeout(900)
    pg.click(f'[data-ses]:has-text("{nombre}")'); pg.wait_for_timeout(1200)
    return pg.inner_text("#actaStage")


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1120, "height": 900})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)

    # ---------- A. Un cierre verificado emitido HOY ----------
    simular(status="Approved", score=96.4, verdict="coincide")
    s = post("/api/sessions", {"vacancy_id": 1, "candidate": "Dayana Maussá",
                               "evaluator": "Laura M.", "mode": "B", "kind": "cierre"})
    sid = s["id"]
    post(f"/api/sessions/{sid}/shot", {"dataBase64": base64.b64encode(PNG).decode(), "mime": "image/png"})
    post(f"/api/sessions/{sid}/identidad", {"email": "d@x.co"})
    post(f"/api/sessions/{sid}/identidad/refrescar", {})
    pedir(f"/api/sessions/{sid}", {"identity": {"grab": True, "cam": True, "shot": True},
                                   "signals": {}, "ratings": RATINGS}, "PATCH")
    emitido = post(f"/api/sessions/{sid}/issue", {
        "candidate": "Dayana Maussá", "evaluator": "Laura M.",
        "identity": {"grab": True, "cam": True, "shot": True}, "signals": {}, "ratings": RATINGS})
    codigo = emitido["report_code"]
    if (emitido.get("documento") or {}).get("titulo") != "Informe de verificación":
        errs.append(f"el acta no se emitió como informe de verificación: {emitido.get('documento')}")

    hoy = abrir(pg, "Dayana")
    if "informe de verificación" not in hoy.lower():
        errs.append("el acta recién emitida no muestra su propio título")
    if "versión anterior del formato" in hoy.lower():
        errs.append("un acta nueva salió marcada como antigua")
    pg.screenshot(path="/tmp/pk/vieja_01_acta_nueva.png", full_page=True)

    # La página pública tiene que decir lo mismo que la copia del cliente.
    pub = json.loads(urllib.request.urlopen(B + "api/v/" + codigo, timeout=5).read())
    if pub.get("documento") != "Informe de verificación":
        errs.append(f"la página pública no dice el mismo documento: {pub.get('documento')!r}")
    if pub.get("identidad_verificada") is not True:
        errs.append("la página pública no refleja la identidad verificada")

    # ---------- B. La misma acta, tal como quedó guardada ANTES del snapshot ----------
    post(f"/api/__sin_snapshot/{sid}", {})
    vieja = abrir(pg, "Dayana")
    bajo = vieja.lower()
    if "ficha de sondeo" in bajo:
        errs.append("un informe viejo se está mostrando como ficha de sondeo — se reescribió el documento")
    if "versión anterior del formato" not in bajo:
        errs.append("el informe viejo no avisa que se emitió con otro formato")
    if "informe de verificación" not in bajo:
        errs.append("el informe viejo perdió su título")
    for debe in ["lo que medimos", "sesión supervisada", "sap pp en producción", "rollout en alpina"]:
        if debe not in bajo:
            errs.append(f"el informe viejo perdió una parte del acta: {debe}")
    if "2 requisitos medidos" not in bajo:
        errs.append("el informe viejo perdió la cuenta de requisitos")
    pg.screenshot(path="/tmp/pk/vieja_02_acta_vieja.png", full_page=True)

    # Y la página pública no puede afirmarle nada al cliente que no pueda sostener.
    pub2 = json.loads(urllib.request.urlopen(B + "api/v/" + codigo, timeout=5).read())
    if pub2.get("autentico") is not True:
        errs.append("un informe viejo dejó de ser auténtico")
    if pub2.get("documento") is not None:
        errs.append(f"la página pública afirma un tipo de documento que no puede sostener: {pub2.get('documento')!r}")
    if not (pub2.get("nota") or ""):
        errs.append("la página pública no explica por qué no muestra el tipo de documento")
    if pub2.get("codigo") != codigo:
        errs.append("la página pública perdió el código del informe")

    pg.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

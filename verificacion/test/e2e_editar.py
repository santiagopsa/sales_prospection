"""Editar una vacante sin perder el historial.

La edición existe porque recrear una vacante no era alternativa: las sesiones apuntan a
vacancy_id, así que borrarla y volverla a crear deja huérfanas las verificaciones ya hechas
y tira a la basura el análisis de la transcripción.

Lo que hay que sostener:
  · se corrigen los datos del cargo y también los requisitos, con agregar, quitar y reordenar;
  · las verificaciones ya emitidas NO cambian de contenido cuando se editan los requisitos —
    cada acta se congeló con su propio texto al emitirse;
  · el vínculo entre la vacante y sus verificaciones sobrevive a la edición.
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
RATINGS = [
    {"req_text": "Implementación de SAP PP en producción (5+ años)", "level": 5,
     "evidence": "Rollout en Alpina 2023, nueve meses, lideró listas de materiales."},
    {"req_text": "Integración PP con MM y QM", "level": 4,
     "evidence": "Explicó los puntos de quiebre con un caso propio."},
]


def pedir(ruta, payload=None, metodo="POST"):
    datos = json.dumps(payload).encode() if payload is not None else None
    r = urllib.request.Request(B.rstrip('/') + ruta, data=datos,
                               headers={"Content-Type": "application/json"}, method=metodo)
    return json.loads(urllib.request.urlopen(r).read() or b'{}')


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(400)

    # ---------- Una verificación emitida ANTES de editar ----------
    # El id no se asume: la secuencia del stub la comparten empresas, vacantes y requisitos.
    VID = pedir("/api/vacancies", None, "GET")[0]["id"]
    s = pedir("/api/sessions", {"vacancy_id": VID, "candidate": "Dayana Maussá",
                                "evaluator": "Laura M.", "mode": "B", "kind": "sondeo"})
    sid = s["id"]
    pedir(f"/api/sessions/{sid}", {"identity": {"grab": True, "cam": True}, "signals": {},
                                   "ratings": RATINGS}, "PATCH")
    emitido = pedir(f"/api/sessions/{sid}/issue", {
        "candidate": "Dayana Maussá", "evaluator": "Laura M.",
        "identity": {"grab": True, "cam": True}, "signals": {}, "ratings": RATINGS})
    codigo = emitido["report_code"]

    # ---------- Editar ----------
    pg.goto(B); pg.wait_for_timeout(700)
    pg.click('[data-vac]'); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(400)
    if not pg.query_selector("#btnEditarVac"):
        errs.append("no hay botón para editar la vacante")
    pg.click("#btnEditarVac"); pg.wait_for_selector("#vEditar.on", timeout=9000); pg.wait_for_timeout(400)

    texto_edicion = pg.inner_text("#editStage").lower()
    if "informe" not in texto_edicion or "emitido" not in texto_edicion:
        errs.append("no avisa que la vacante ya tiene informes emitidos")

    antes = len(pg.query_selector_all("#reqEdit .rq"))
    if antes < 2:
        errs.append(f"se esperaban al menos 2 requisitos para editar, hay {antes}")

    # datos del cargo
    pg.fill('[data-c="title"]', "Consultor SAP PP (Senior)")
    pg.fill('[data-c="city"]', "Medellín")
    pg.fill('[data-c="salary_text"]', "12.000.000 COP / mes")
    pg.fill('[data-c="company_name"]', "Alpina S.A.")
    pg.wait_for_timeout(150)

    # el texto de un requisito
    pg.fill('.rq:first-child [data-r="text"]', "Rollout de SAP PP en producción (7+ años)")
    pg.wait_for_timeout(150)

    # reordenar: bajar el primero
    pg.click('.rq:first-child [data-mv="1"]'); pg.wait_for_timeout(300)
    primero = pg.input_value('.rq:first-child [data-r="text"]')
    if "Rollout de SAP PP" in primero:
        errs.append("el reordenamiento no movió el requisito")

    # abrir el detalle del primero y escribir el criterio
    pg.click('.rq:first-child [data-open]'); pg.wait_for_timeout(300)
    if not pg.query_selector('.rq:first-child [data-r="criterio"]'):
        errs.append("no se abre el detalle del requisito")
    else:
        pg.fill('.rq:first-child [data-r="criterio"]', "Debe poder narrar un cierre de mes real, con nombres.")
        pg.fill('.rq:first-child [data-s="senales"]', "Habla en plural\nNo recuerda fechas")
        pg.wait_for_timeout(150)

    # agregar uno nuevo
    pg.click("#btnAddReq"); pg.wait_for_timeout(400)
    pg.fill('.rq:last-child [data-r="text"]', "Manejo de listas de materiales multinivel")
    pg.wait_for_timeout(200)
    if len(pg.query_selector_all("#reqEdit .rq")) != antes + 1:
        errs.append("no se agregó el requisito nuevo")

    pg.screenshot(path="/tmp/pk/edit_01_formulario.png", full_page=True)
    pg.click("#btnGuardarEdit")
    pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(600)

    # ---------- Lo guardado ----------
    vista = pg.inner_text("#vacStage")
    for debe in ["Consultor SAP PP (Senior)", "Alpina S.A.", "Medellín", "12.000.000",
                 "Rollout de SAP PP en producción (7+ años)", "Manejo de listas de materiales multinivel",
                 "Debe poder narrar un cierre de mes real"]:
        if debe.lower() not in vista.lower():
            errs.append(f"no quedó guardado: {debe}")
    pg.screenshot(path="/tmp/pk/edit_02_guardado.png", full_page=True)

    v = pedir(f"/api/vacancies/{VID}", None, "GET")
    if v.get("title") != "Consultor SAP PP (Senior)":
        errs.append(f"el título no se guardó en el servidor: {v.get('title')!r}")
    if len(v.get("requirements", [])) != antes + 1:
        errs.append(f"el servidor tiene {len(v.get('requirements',[]))} requisitos, se esperaban {antes+1}")
    ords = [q["ord"] for q in v.get("requirements", [])]
    if ords != sorted(ords) or ords != list(range(len(ords))):
        errs.append(f"el orden quedó inconsistente: {ords}")

    # ---------- El acta emitida antes NO cambió ----------
    pub = pedir("/api/v/" + codigo, None, "GET")
    if pub.get("autentico") is not True:
        errs.append("la verificación emitida dejó de ser auténtica tras editar la vacante")
    pg.goto(B); pg.wait_for_timeout(800)
    pg.click('[data-ses]:has-text("Dayana")'); pg.wait_for_timeout(1200)
    acta = pg.inner_text("#actaStage")
    if "Implementación de SAP PP en producción (5+ años)" not in acta:
        errs.append("el acta emitida perdió el texto original de su requisito: se reescribió un documento entregado")
    if "Rollout de SAP PP en producción (7+ años)" in acta:
        errs.append("el acta emitida adoptó el texto NUEVO del requisito — no debe cambiar")
    if "Manejo de listas de materiales multinivel" in acta:
        errs.append("al acta emitida le apareció un requisito que no se le midió")
    pg.screenshot(path="/tmp/pk/edit_03_acta_intacta.png", full_page=True)

    # ---------- No se puede dejar sin título ----------
    pg.goto(B); pg.wait_for_timeout(700)
    pg.click('[data-vac]'); pg.wait_for_timeout(600)
    pg.click("#btnEditarVac"); pg.wait_for_selector("#vEditar.on", timeout=9000); pg.wait_for_timeout(300)
    pg.fill('[data-c="title"]', "  ")
    pg.click("#btnGuardarEdit"); pg.wait_for_timeout(600)
    if not pg.is_visible("#vEditar.on"):
        errs.append("dejó guardar una vacante sin título")

    pg.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

"""Levantamiento con las dos fuentes: el JD y la transcripción de la reunión.

Pasó con Neduga: el JD ya estaba y la reunión fue solo de habilidades blandas. Lo que hay que
sostener:
  · hay una tercera opción, "Los dos: JD y reunión", que muestra una caja para el JD;
  · con esa opción no deja analizar si falta una de las dos; una reunión corta sí vale;
  · al servidor llegan las dos por separado, y la vacante guarda las dos rotuladas;
  · las otras dos opciones siguen igual (una sola caja).
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

AQUI = os.path.dirname(os.path.abspath(__file__))
PORT = random.choice([p for p in range(3200, 3900) if p != 3659])
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(AQUI, "stub.js")], env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None: print("el stub murió al arrancar"); sys.exit(1)
    try: urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception: time.sleep(0.25)
else:
    print("el stub no respondió"); sys.exit(1)
api = lambda r: json.load(urllib.request.urlopen(B + r))

JD = ("Neduga busca un Consultor SAP PP senior. Requisitos obligatorios: 5 años implementando SAP PP en "
      "producción, al menos un rollout completo, integración con MM y QM. Deseable: experiencia en alimentos. ") * 2
REUNION = ("Marcela: lo técnico ya está en el JD. Lo que nos importa es la actitud: que aguante la presión del "
           "cierre de mes y que le explique al usuario de planta sin hablarle en jerga.")

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_selector("#vIntake.on"); pg.wait_for_timeout(300)
    if pg.is_visible("#jdSet"): errs.append("la caja del JD se ve sin haber elegido 'Los dos'")
    if len(pg.query_selector_all("#srcType .seg")) != 3: errs.append("no están las tres opciones")

    pg.click('#srcType .seg[data-src="mixto"]'); pg.wait_for_timeout(200)
    if not pg.is_visible("#jdSet"): errs.append("con 'Los dos' no aparece la caja del JD")
    if "reunión" not in pg.inner_text("#srcTitulo").lower(): errs.append("la caja principal no dice que es la reunión")
    if "habilidades blandas" not in pg.inner_text("#srcHint"): errs.append("la ayuda no explica cuándo usar 'Los dos'")
    pg.fill("#jdText", JD); pg.wait_for_timeout(150)
    if not pg.is_disabled("#btnAnalizar"): errs.append("deja analizar con 'Los dos' y sin la reunión")
    pg.fill("#srcText", REUNION); pg.wait_for_timeout(150)
    if pg.is_disabled("#btnAnalizar"): errs.append("una reunión corta con el JD no deja analizar")
    pg.screenshot(path="/tmp/pk/mix_01_intake.png", full_page=True)

    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(400)
    u = api("api/__ultimo_levantamiento")
    if u.get("tipo") != "mixto" or "5 años" not in u.get("jd", "") or "presión" not in u.get("reunion", ""):
        errs.append(f"al servidor no llegaron las dos fuentes por separado: {u}")
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    v = api("api/vacancies/" + str(api("api/vacancies")[0]["id"]))
    st = v.get("source_text") or ""
    if v.get("source_type") != "mixto" or "=== JOB DESCRIPTION ===" not in st or "=== TRANSCRIPCIÓN DE LA REUNIÓN ===" not in st:
        errs.append(f"la vacante no guardó las dos fuentes rotuladas: {v.get('source_type')} {st[:80]!r}")
    if "aiRaw" in json.dumps(v.get("ai_raw") or {}) or "_fuente" in json.dumps(v.get("ai_raw") or {}):
        errs.append("el texto de las fuentes quedó duplicado en ai_raw")

    # Volver y elegir JD solo: una caja, y el JD guardado como tal.
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_selector("#vIntake.on"); pg.wait_for_timeout(200)
    pg.click('#srcType .seg[data-src="jd"]'); pg.wait_for_timeout(150)
    if pg.is_visible("#jdSet"): errs.append("con 'Job description' se ve la segunda caja")
    pg.set_viewport_size({"width": 390, "height": 900})
    pg.click('#srcType .seg[data-src="mixto"]'); pg.wait_for_timeout(150)
    pg.screenshot(path="/tmp/pk/mix_02_movil.png", full_page=True)
    if pg.evaluate("document.documentElement.scrollWidth") > 400: errs.append("en celular la pantalla se desborda")
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

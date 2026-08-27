"""Los minutos entre colgar y la transcripción.

Google se demora minutos en entregar la transcripción. Antes esos minutos no tenían dónde
ocurrir: la app obligaba a elegir entre "ya la tengo" —mentira— o "guardar y salir", y el
reclutador quedaba mirando un cuadro vacío. Mientras tanto lo único que de verdad corre
contra el reloj se quedaba sin hacer: mandarle al candidato la verificación de identidad,
que la hace mucho menos si se la mandan mañana.

Lo que hay que sostener:
  · desde la espera se puede subir el pantallazo tomado en la llamada;
  · desde la espera se puede generar y copiar el link de identidad;
  · al hacerlo, ESA pantalla se actualiza — no la de atrás;
  · lo que se hizo en la espera sigue ahí al pegar la transcripción y llegar al acta;
  · si la identidad ya está resuelta, el bloque no aparece: la pantalla es solo la
    transcripción y nada más.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request

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
     "Tambien PP con MM y QM. ") * 6

PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea735c9a400"
    "00000049454e44ae426082")


def hasta_espera(pg, kind="cierre", con_captura=False):
    """Intake → sesión → recorrer la guía → colgar → sala de espera."""
    pg.goto(B); pg.wait_for_timeout(420)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(320)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(260)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(300)
    if kind == "cierre":
        pg.click('#setKind [data-k="cierre"]'); pg.wait_for_timeout(150)
    pg.fill("#sCand", "Dayana Maussá"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(320)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    if con_captura and pg.query_selector("#shotFile"):
        pg.set_input_files("#shotFile", {"name": "rostro.png", "mimeType": "image/png", "buffer": PNG})
        pg.wait_for_timeout(1400)
    pg.click("[data-next]"); pg.wait_for_timeout(330)
    flujo.recorrer_guia(pg)
    pg.click("#btnATranscripcion")
    pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(420)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 1150})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    # ---------- A. La espera ofrece lo que sí se puede hacer ahora ----------
    hasta_espera(pg)
    cuerpo = pg.inner_text("#transStage")
    if not pg.query_selector("#shotBox"):
        errs.append("REGRESIÓN: no se puede subir el pantallazo mientras se espera")
    if not pg.query_selector("#btnEnviarId"):
        errs.append("REGRESIÓN: no se puede enviar la verificación de identidad desde la espera")
    # el CSS pone los títulos en mayúsculas, así que se compara sin distinguir
    if "ciérrale la identidad" not in cuerpo.lower():
        errs.append("la pantalla no dice qué hacer mientras espera")
    if "tomaste durante la llamada" not in cuerpo:
        errs.append("el recuadro pide TOMAR la captura en vez de SUBIR la que ya se tomó")
    if not pg.query_selector("#transText"):
        errs.append("se perdió el cuadro de la transcripción")
    pg.screenshot(path="/tmp/pk/esp_01_espera.png", full_page=True)

    # ---------- B. Subir el pantallazo repinta ESTA pantalla ----------
    pg.set_input_files("#shotFile", {"name": "rostro.png", "mimeType": "image/png", "buffer": PNG})
    pg.wait_for_timeout(1500)
    if not pg.query_selector("#vTrans.on"):
        errs.append("subir la captura sacó al reclutador de la pantalla de espera")
    if pg.query_selector("#shotBox"):
        errs.append("REGRESIÓN: la pantalla no se actualizó — sigue pidiendo la captura ya subida")
    if not pg.query_selector("#btnEnviarId"):
        errs.append("se perdió el bloque de identidad al subir la captura")

    # ---------- C. Generar el link, también sin salir ----------
    pg.click("#btnEnviarId"); pg.wait_for_timeout(1800)
    if not pg.query_selector("#vTrans.on"):
        errs.append("generar el link sacó al reclutador de la pantalla de espera")
    cuerpo = pg.inner_text("#transStage")
    if "verify.didit.me" not in cuerpo:
        errs.append("REGRESIÓN: se generó el link pero la pantalla de espera no lo muestra")
    if not pg.query_selector("#btnCopiarLink"):
        errs.append("no se puede copiar el link desde la espera")
    pg.screenshot(path="/tmp/pk/esp_02_link.png", full_page=True)

    # ---------- D. Lo hecho en la espera sobrevive hasta el acta ----------
    pg.fill("#transText", flujo.TRANSCRIPCION); pg.wait_for_timeout(250)
    pg.click("#btnAnalizarTrans")
    pg.wait_for_selector("#vLive.on", timeout=20000); pg.wait_for_timeout(600)
    flujo.confirmar_niveles(pg, (5, 4))
    for _ in range(6):
        if "Cierre de la sesión" in pg.inner_text("#stage"):
            break
        pg.click("[data-next]"); pg.wait_for_timeout(340)
    cierre_txt = pg.inner_text("#stage")
    if "Cierre de la sesión" not in cierre_txt:
        errs.append("(D) no se llegó al cierre")
    else:
        if pg.query_selector("#shotBox"):
            errs.append("el cierre vuelve a pedir la captura que ya se subió en la espera")
        if "verify.didit.me" not in cierre_txt:
            errs.append("se perdió el link de identidad generado en la espera")
        pg.screenshot(path="/tmp/pk/esp_03_cierre.png", full_page=True)
    pg.close()

    # ---------- E. En un sondeo la espera es solo la transcripción ----------
    pg2 = br.new_page(viewport={"width": 1180, "height": 1150})
    pg2.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg2.on("dialog", lambda d: d.accept())
    hasta_espera(pg2, kind="sondeo")
    if pg2.query_selector("#shotBox") or pg2.query_selector("#btnEnviarId"):
        errs.append("aparece identidad en la espera de un sondeo, que no la pide")
    if not pg2.query_selector("#transText"):
        errs.append("(E) se perdió el cuadro de la transcripción en el sondeo")
    if "ciérrale la identidad" in pg2.inner_text("#transStage").lower():
        errs.append("(E) el sondeo habla de identidad")
    pg2.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

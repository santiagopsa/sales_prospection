"""Subir el archivo de la transcripción.

El reclutador acaba de colgar. La entrevista ya pasó, no se repite, y lo único que queda
es el archivo que Google dejó en Drive. Si al soltarlo la app dice "No sé leer archivos ."
—que era un error nuestro disfrazado de culpa del archivo— se pierde la verificación.

Lo que hay que sostener:
  · un .vtt de Meet entra y llega limpio, sin marcas de tiempo;
  · un .docx entra (aunque por dentro sea un zip y el nombre venga como venga);
  · un archivo que de verdad no sabemos leer da un mensaje que dice qué hacer,
    y NUNCA la frase rota "No sé leer archivos ." sin extensión.
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
avisos = []
T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es un rollout de PP en produccion. "
     "Tambien PP con MM y QM. ") * 6

VTT = (b"WEBVTT\n\n"
       b"1\n00:00:01.000 --> 00:00:06.000\n"
       b"Reclutador: cuentame del rollout de PP que hiciste.\n\n"
       b"2\n00:00:06.500 --> 00:00:14.000\n"
       b"Candidato: fue en Alpina, entre marzo y noviembre de 2023, yo lo lidere.\n\n"
       b"3\n00:00:14.500 --> 00:00:22.000\n"
       b"Candidato: lo que se nos cayo fue el maestro de materiales en el go-live.\n") * 4

# Un .docx de verdad es un zip: empieza con PK\x03\x04. Con eso basta para probar el ruteo.
DOCX = b"PK\x03\x04\x14\x00\x06\x00" + bytes(range(200)) * 3

# Algo que no sabemos leer, con extensión y con contenido binario.
RARO = b"\x00\x01\x02\xff\xfe\x81\x82" * 100


def hasta_transcripcion(pg):
    """Intake -> vacante -> sesión -> recorrer la guía -> pantalla de transcripción."""
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(250)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Ana prueba"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(300)
    flujo.recorrer_guia(pg)
    pg.click("#btnATranscripcion")
    pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(300)


def soltar(pg, nombre, datos):
    """Como si el reclutador arrastrara el archivo al recuadro."""
    pg.set_input_files("#transFile", {"name": nombre, "mimeType": "application/octet-stream",
                                      "buffer": datos})
    pg.wait_for_timeout(1400)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    hasta_transcripcion(pg)

    # ---------- A. El .vtt de Meet: entra y llega limpio ----------
    soltar(pg, "Entrevista Ana - Transcripción.vtt", VTT)
    texto = pg.input_value("#transText")
    if not texto.strip():
        errs.append("el .vtt no llenó el cuadro de texto")
    else:
        if "-->" in texto:
            errs.append("el .vtt entró con las marcas de tiempo adentro")
        if "Alpina" not in texto:
            errs.append("se perdió el diálogo del .vtt")
        if "WEBVTT" in texto:
            errs.append("quedó la cabecera WEBVTT en la transcripción")
    if "caracteres leídos" not in pg.inner_text("#transDropS"):
        avisos.append("no confirma cuántos caracteres leyó")
    pg.screenshot(path="/tmp/pk/ta_01_vtt.png", full_page=True)

    # ---------- B. EL BUG: el .docx ----------
    # Sin recargar: soltar otro archivo reemplaza el anterior, que es justo lo que hace
    # el reclutador cuando se equivoca de archivo.
    pg.wait_for_timeout(3200)          # que se vaya el toast anterior
    pg.fill("#transText", ""); pg.wait_for_timeout(150)
    soltar(pg, "Entrevista Ana prueba.docx", DOCX)
    cuerpo = pg.inner_text("body")
    if "No sé leer" in cuerpo or "No se pudo leer" in cuerpo:
        errs.append("REGRESIÓN: el .docx sigue rebotando — " +
                    [l for l in cuerpo.split("\n") if "leer" in l][:1].__str__())
    if not pg.input_value("#transText").strip():
        errs.append("REGRESIÓN: el .docx no llenó el cuadro de texto")
    pg.screenshot(path="/tmp/pk/ta_02_docx.png", full_page=True)

    # ---------- C. Un archivo que de verdad no sabemos leer ----------
    pg.wait_for_timeout(3200)
    soltar(pg, "presupuesto.xlsx", RARO)
    cuerpo = pg.inner_text("body")
    if "No sé leer" not in cuerpo:
        errs.append("un .xlsx binario debería decir que no se sabe leer")
    if "archivos .." in cuerpo or "archivos . " in cuerpo:
        errs.append("el mensaje roto volvió: 'archivos .' sin extensión")
    if ".xlsx" not in cuerpo:
        avisos.append("el mensaje no nombra la extensión que rechazó")
    if "pega el texto" not in cuerpo:
        errs.append("el mensaje no ofrece la salida (pegar el texto)")
    # Y la salida tiene que funcionar de verdad: pegar el texto a mano.
    pg.fill("#transText", flujo.TRANSCRIPCION); pg.wait_for_timeout(250)
    if pg.is_disabled("#btnAnalizarTrans"):
        errs.append("después del archivo rechazado ya no deja pegar el texto")
    pg.screenshot(path="/tmp/pk/ta_03_rechazo.png", full_page=True)

    pg.close(); br.close()

STUB.terminate()
for a in avisos:
    print("  · aviso:", a)
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

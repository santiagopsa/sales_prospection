"""La entrevista y la calificación son dos momentos, no uno.

Durante la llamada el reclutador escucha: la pantalla es guía y nada más. Mientras uno
escribe notas deja de escuchar, y lo que se pierde es justo la repregunta que desarma a un
impostor. La evidencia sale de la transcripción, después de colgar.

Y la transcripción de Google tarda unos minutos, así que entre los dos momentos la sesión
tiene que poder cerrarse y retomarse — hoy o mañana, desde otro computador.

Lo que hay que sostener:
  · durante la entrevista NO hay campos de calificar ni de escribir evidencia;
  · al terminar se puede salir sin transcripción, y la sesión queda marcada esperándola;
  · al volver, se retoma justo en el paso de pegarla;
  · lo que sale de la transcripción son PROPUESTAS con su cita, que una persona confirma;
  · un requisito que no se tocó en la conversación queda sin nivel y se dice de frente.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

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
TRANS = ("Reclutador: cuentame de tu experiencia con SAP PP.\n"
         "Candidato: en Alpina, entre marzo y noviembre de 2023, yo lleve el rollout de PP. "
         "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live.\n"
         "Reclutador: que transaccion usas para listas de materiales?\n"
         "Candidato: CS01, y CS02 para modificar.\n") * 8


def preparar(pg):
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Dayana Maussá"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    preparar(pg)

    # ---------- A. Durante la entrevista: solo guía ----------
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(100)
    pg.click("[data-next]"); pg.wait_for_timeout(400)

    guia = pg.inner_text("#stage")
    if "Llévame al último rollout" not in guia:
        errs.append("la guía no muestra la pregunta de escena")
    if "CS01" not in guia:
        errs.append("la guía no muestra los detalles verificables")
    if pg.query_selector('[data-lv="5"]'):
        errs.append("durante la entrevista aparecen los botones de calificar — deben salir después")
    if pg.query_selector("[data-notes]"):
        errs.append("durante la entrevista aparece el campo de evidencia — la evidencia sale de la transcripción")
    if "no tomes notas" not in guia.lower():
        errs.append("la guía no le dice al reclutador que no tome notas")
    pg.screenshot(path="/tmp/pk/tr_01_guia.png", full_page=True)

    # recorrer los requisitos hasta el fin de la entrevista
    for _ in range(6):
        if "Terminaste la entrevista" in pg.inner_text("#stage"):
            break
        pg.click("[data-next]"); pg.wait_for_timeout(350)
    fin = pg.inner_text("#stage")
    if "Terminaste la entrevista" not in fin:
        errs.append("no se llega a la pantalla de fin de entrevista")
    if "unos minutos" not in fin.lower():
        errs.append("no advierte que la transcripción de Google tarda")
    pg.screenshot(path="/tmp/pk/tr_02_fin.png", full_page=True)

    # ---------- B. Salir sin transcripción y que quede marcada ----------
    pg.click("#btnEsperarTrans"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(700)
    fila = pg.inner_text("#sesList")
    if "ESPERA TRANSCRIPCIÓN" not in fila.upper():
        errs.append(f"el tablero no distingue la sesión que espera transcripción: {fila[:120]!r}")
    pg.screenshot(path="/tmp/pk/tr_03_tablero.png", full_page=True)

    # ---------- C. Volver y retomar justo donde toca ----------
    pg.click('[data-ses]:has-text("Dayana")'); pg.wait_for_timeout(900)
    borrador = pg.inner_text("#actaStage")
    if "ESPERANDO TRANSCRIPCIÓN" not in borrador.upper():
        errs.append("al reabrirla no dice que está esperando la transcripción")
    if "Pegar la transcripción" not in borrador:
        errs.append("el botón de retomar no lleva al paso que toca")
    pg.click("#btnRetomar"); pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(400)

    tr = pg.inner_text("#transStage")
    if "Meet Recordings" not in tr:
        errs.append("no dice dónde encontrar la transcripción")
    if "no se guarda" not in tr.lower():
        errs.append("no aclara que la transcripción no se guarda")
    if not pg.is_disabled("#btnAnalizarTrans"):
        errs.append("deja analizar con el campo vacío")

    # ---------- D. Pegarla y que salgan las propuestas ----------
    pg.fill("#transText", TRANS); pg.wait_for_timeout(300)
    if pg.is_disabled("#btnAnalizarTrans"):
        errs.append("no habilita el análisis con una transcripción válida")
    pg.screenshot(path="/tmp/pk/tr_04_pegar.png", full_page=True)
    pg.click("#btnAnalizarTrans"); pg.wait_for_selector("#vLive.on", timeout=15000); pg.wait_for_timeout(600)

    cal = pg.inner_text("#stage")
    if "confirma o corrige" not in cal.lower():
        errs.append("la pantalla de calificación no pide confirmar")
    if "en alpina" not in cal.lower():
        errs.append("no muestra la cita de la transcripción como evidencia")
    if not pg.query_selector('[data-lv="5"]'):
        errs.append("después de la transcripción no aparecen los niveles")
    if not pg.query_selector(".lv.sel"):
        errs.append("no viene precargado el nivel propuesto")
    ev = pg.input_value("[data-notes]")
    if "Alpina" not in ev:
        errs.append(f"la evidencia no quedó precargada con la cita: {ev[:70]!r}")
    pg.screenshot(path="/tmp/pk/tr_05_calificar.png", full_page=True)

    # ---------- E. El requisito que no se tocó se dice de frente ----------
    pg.click("[data-next]"); pg.wait_for_timeout(500)
    dos = pg.inner_text("#stage")
    if "no se tocó en la conversación" not in dos.lower():
        errs.append("no avisa cuando un requisito no se tocó en la entrevista")
    if pg.query_selector(".lv.sel"):
        errs.append("le puso nivel a un requisito que nunca se preguntó")
    pg.screenshot(path="/tmp/pk/tr_06_sin_cubrir.png", full_page=True)

    # ---------- F. Lo que declaró llega solo al contexto ----------
    for _ in range(4):
        if pg.query_selector('[data-d="pretension"]'):
            break
        pg.click("[data-next]"); pg.wait_for_timeout(400)
    if not pg.query_selector('[data-d="pretension"]'):
        errs.append("no se llega a la fase de contexto")
    else:
        pret = pg.input_value('[data-d="pretension"]')
        if "12 millones" not in pret:
            errs.append(f"la pretensión no se precargó de la transcripción: {pret!r}")
    pg.screenshot(path="/tmp/pk/tr_07_contexto.png", full_page=True)

    pg.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

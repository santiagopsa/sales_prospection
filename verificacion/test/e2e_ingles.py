"""El inglés lo juzga el evaluador, en vivo, y el acta dice que fue así.

Esta prueba cambió de forma porque cambió la decisión, no porque estuviera mal. Antes el
nivel salía de la transcripción, igual que el resto de la evidencia. No se puede: Google
Meet transcribe una reunión en un solo idioma por archivo, y su detección automática de
idioma corre una sola vez por reunión. Un tramo hablado en inglés dentro de una
transcripción en español sale escrito con fonética española — texto del que un modelo
igual propondría un nivel, porque siempre tiene con qué inventarlo. Ese nivel entraría a
un acta que promete que toda evidencia es cita textual.

Así que el inglés se juzga escuchando, y eso obliga a tres cosas que aquí se prueban:

  · se marca DURANTE la llamada, con nota y minuto de la grabación;
  · el análisis de la transcripción no puede proponerlo ni pisarlo;
  · el acta declara que este dato salió del oído del evaluador y no de la transcripción,
    porque es evidencia más débil que el resto del documento y callarlo sería darle al
    lector una confianza que este dato no tiene.

Y lo que pidió Santiago: que se decida en la pantalla de inicio, con la vacante por defecto.
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
     "Tambien PP con MM y QM. Tiene que poder estar en el daily en ingles. ") * 5


def hasta_vacante(pg):
    pg.goto(B); pg.wait_for_timeout(450)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(450)


def abrir_sesion(pg, nombre, ingles=None):
    """ingles=None deja el valor por defecto de la vacante; True/False lo fuerza."""
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(320)
    if ingles is not None:
        pg.click(f'#setIng [data-i="{1 if ingles else 0}"]'); pg.wait_for_timeout(160)
    pg.fill("#sCand", nombre); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(340)


def ir_a_ingles(pg, maximo=7):
    for _ in range(maximo):
        if "Inglés" in pg.inner_text("#stage").split("\n")[0]:
            return True
        pg.click("[data-next]"); pg.wait_for_timeout(330)
    return "Inglés" in pg.inner_text("#stage").split("\n")[0]


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 1150})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    # ---------- A. El levantamiento lo sigue sacando del texto del cliente ----------
    hasta_vacante(pg)
    if not pg.is_checked("#rIngOn"):
        errs.append("el levantamiento no marcó que el cargo exige inglés")
    if "daily" not in pg.input_value("#rIngUso").lower():
        errs.append(f"no trajo para qué se necesita el inglés: {pg.input_value('#rIngUso')!r}")
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)

    # ---------- B. La pantalla de inicio deja decidirlo, con la vacante por defecto ----------
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(400)
    if not pg.query_selector("#setIng"):
        errs.append("no está la selección de inglés en la pantalla de inicio")
    else:
        sel = pg.query_selector("#setIng .mode.sel")
        if not sel or sel.get_attribute("data-i") != "1":
            errs.append("la vacante exige inglés y la pantalla de inicio no viene marcada en sí")
    pg.screenshot(path="/tmp/pk/ing_01_setup.png", full_page=True)

    # ---------- C. En la llamada: se marca ahí, con nota y minuto ----------
    pg.fill("#sCand", "Dayana Maussá"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(340)

    if "Inglés" not in pg.inner_text("#phaseNav"):
        errs.append("no apareció la fase de inglés en la entrevista")
    if not ir_a_ingles(pg):
        errs.append("no se llegó a la fase de inglés")
    else:
        guia = pg.inner_text("#stage")
        if "daily" not in guia.lower():
            errs.append("la guía de inglés no dice para qué lo necesita el cargo")
        if "Tell me about the project" not in guia:
            errs.append("la guía no trae el guion en inglés")
        if not pg.query_selector('[data-ing="B2"]'):
            errs.append("REGRESIÓN: no se puede marcar el nivel de inglés durante la llamada")
        if "único tramo que calificas en vivo" not in guia:
            errs.append("no le avisa al reclutador que este tramo se califica en vivo")
        if not pg.query_selector("[data-ingnota]"):
            errs.append("no hay dónde escribir por qué se marcó ese nivel")
        if not pg.query_selector("[data-ingmin]"):
            errs.append("no hay dónde anotar el minuto de la grabación")
        pg.click('[data-ing="B2"]'); pg.wait_for_timeout(220)
        pg.fill("[data-ingnota]", "Sostuvo el rollout en inglés; se autocorrigió una vez y no buscó palabras.")
        pg.fill("[data-ingmin]", "18:40"); pg.wait_for_timeout(350)
        pg.screenshot(path="/tmp/pk/ing_02_envivo.png", full_page=True)

        # ---------- D. La transcripción no puede pisarlo ----------
        flujo.recorrer_guia(pg)
        flujo.pegar_transcripcion(pg)
        flujo.confirmar_niveles(pg, (5, 4))
        if not ir_a_ingles(pg, 6):
            errs.append("no se vuelve a la fase de inglés después de la transcripción")
        else:
            if not pg.query_selector('[data-ing="B2"].sel'):
                errs.append("REGRESIÓN: la transcripción borró o cambió el nivel que marcó el evaluador")
            if "autocorrigió" not in pg.input_value("[data-ingnota]"):
                errs.append("se perdió la nota del evaluador al llegar la transcripción")
            if pg.input_value("[data-ingmin]") != "18:40":
                errs.append("se perdió el minuto de la grabación")
            if "transcripción propone" in pg.inner_text("#stage"):
                errs.append("sigue diciendo que la transcripción propone un nivel de inglés")
            pg.screenshot(path="/tmp/pk/ing_03_despues.png", full_page=True)

        # ---------- E. El acta declara de dónde salió ----------
        for _ in range(5):
            if pg.query_selector("#btnActa"):
                break
            pg.click("[data-next]"); pg.wait_for_timeout(350)
        if pg.query_selector('[data-rec="reserva"]'):
            pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(150)
            pg.fill('[data-r="texto"]', "Sostiene el nucleo del cargo.")
            pg.wait_for_timeout(200); pg.click("[data-next]"); pg.wait_for_timeout(500)
        if not pg.query_selector("#btnActa"):
            errs.append("no se llegó al cierre para emitir")
        else:
            if pg.is_disabled("#btnActa"):
                errs.append("no deja emitir estando completo")
            pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(600)
            acta = pg.inner_text("#actaStage")
            if "B2" not in acta:
                errs.append("el acta no dice el nivel observado")
            if "no proviene de la transcripción" not in acta:
                errs.append("REGRESIÓN: el acta no declara que el inglés no sale de la transcripción")
            if "Weimar" not in acta:
                errs.append("el acta no dice quién marcó el nivel")
            if "18:40" not in acta:
                errs.append("el acta no trae el minuto que permite comprobarlo")
            if "conducta" not in acta.lower():
                errs.append("el acta no aclara que se midió por conducta y no por certificado")
            pg.screenshot(path="/tmp/pk/ing_04_acta.png", full_page=True)
    pg.close()

    # ---------- F. Apagarlo en la pantalla de inicio lo saca de todo ----------
    pg2 = br.new_page(viewport={"width": 1180, "height": 1150})
    pg2.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg2.on("dialog", lambda d: d.accept())
    hasta_vacante(pg2)
    pg2.click("#btnGuardarVac"); pg2.wait_for_selector("#vVacante.on", timeout=9000); pg2.wait_for_timeout(300)
    abrir_sesion(pg2, "Ana Betancur", ingles=False)   # la vacante SÍ lo pide; aquí se apaga
    if "Inglés" in pg2.inner_text("#phaseNav"):
        errs.append("se apagó el inglés en la pantalla de inicio y la fase aparece igual")
    flujo.recorrer_guia(pg2)
    flujo.pegar_transcripcion(pg2)
    flujo.confirmar_niveles(pg2, (5, 4))
    for _ in range(4):
        if pg2.query_selector('[data-rec="reserva"]'):
            break
        pg2.click("[data-next]"); pg2.wait_for_timeout(320)
    if pg2.query_selector("[data-ing]"):
        errs.append("deja calificar inglés en una sesión donde se apagó")
    pg2.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

"""El análisis corre en segundo plano: el reclutador no se queda esperando.

Antes, pegar la transcripción bloqueaba el navegador 30-40 segundos con un velo encima, y con
entrevistas de 30 minutos una tras otra eso era tiempo muerto real. Ahora el servidor contesta
enseguida y analiza aparte.

Lo que hay que sostener:
  · al pegar, la respuesta es inmediata y la pantalla ofrece irse al tablero;
  · el tablero muestra esa verificación como ANALIZANDO y se refresca solo;
  · MIENTRAS TANTO se puede abrir y empezar otra entrevista con otro candidato;
  · al terminar, el tablero la muestra LISTA PARA CALIFICAR;
  · al abrirla, las propuestas del análisis se aplican una sola vez y se puede calificar;
  · quien prefiere quedarse esperando, salta solo a la calificación cuando termina;
  · un análisis que falla vuelve a la sala de espera con el motivo, no se pierde en silencio.
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
         "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live.\n") * 10


def sesion_hasta_colgar(pg, nombre):
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", nombre); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate("() => { S.idc = {grab:true, cam:true}; touch(); }")
    # hasta el fin de la entrevista
    for _ in range(12):
        if "Fin de la entrevista" in pg.inner_text("#stage") or pg.query_selector("#btnATranscripcion"):
            break
        b = pg.query_selector("#stage [data-next]")
        if not b: break
        b.click(); pg.wait_for_timeout(200)
    pg.click("#btnATranscripcion"); pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(300)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    vac_id = pg.evaluate("() => VAC.id")

    # ---------- A. Primer candidato: pega y se va ----------
    sesion_hasta_colgar(pg, "Ana Primera")
    sid1 = pg.evaluate("() => S.sid")
    pg.fill("#transText", TRANS + " __LENTO__ "); pg.wait_for_timeout(150)
    t0 = time.time()
    pg.click("#btnAnalizarTrans")
    pg.wait_for_selector("#btnSeguirOtro", timeout=6000)
    dt = time.time() - t0
    if dt > 4:
        errs.append(f"pegar la transcripción bloqueó {dt:.1f}s: el análisis tiene que correr en segundo plano")
    tx = pg.inner_text("#transStage")
    if "siguiente entrevista" not in tx.lower():
        errs.append("la pantalla de procesando no le dice que puede seguir con otro")

    pg.click("#btnSeguirOtro"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(500)
    tab = pg.inner_text("#sesList")
    if "ANALIZANDO" not in tab:
        errs.append(f"el tablero no muestra la sesión como ANALIZANDO: {tab[:200]!r}")

    # ---------- B. Mientras tanto, otro candidato ----------
    pg.evaluate(f"() => verVacante({vac_id})"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    sesion_hasta_colgar(pg, "Bruno Segundo")
    sid2 = pg.evaluate("() => S.sid")
    if sid2 == sid1:
        errs.append("no se pudo abrir una segunda sesión mientras la primera analizaba")
    # el segundo también pega, y esta vez se queda esperando: debe saltar solo a calificar
    pg.fill("#transText", TRANS); pg.wait_for_timeout(150)
    pg.click("#btnAnalizarTrans")
    pg.wait_for_selector("#btnQuedarme", timeout=6000)
    pg.click("#btnQuedarme")
    pg.wait_for_selector("#vLive.on", timeout=15000); pg.wait_for_timeout(400)
    if not pg.evaluate("() => S.modo === 'calificacion' && S.reqs.some(r => r.lvl > 0)"):
        errs.append("quedarse esperando no saltó a la calificación con los niveles propuestos")

    # ---------- C. La primera terminó por su cuenta ----------
    pg.evaluate("async () => { await flush(); loadTablero(); }")
    pg.wait_for_selector("#vTablero.on", timeout=9000)
    listo = False
    for _ in range(30):
        pg.wait_for_timeout(700)
        if "LISTA PARA CALIFICAR" in pg.inner_text("#sesList"):
            listo = True; break
    if not listo:
        errs.append("la primera sesión nunca apareció como LISTA PARA CALIFICAR en el tablero")

    pg.click(f'[data-ses="{sid1}"]'); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")     # hay otra sesión en curso: se pregunta en la página
    pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(300)
    b = pg.inner_text("#actaStage")
    if "LISTA PARA CALIFICAR" not in b:
        errs.append("al abrir la primera sesión no dice que está lista para calificar")
    pg.click("#btnRetomar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)
    if not pg.evaluate("() => S.modo === 'calificacion' && S.reqs.some(r => r.lvl > 0)"):
        errs.append("al retomar la primera sesión no se aplicaron las propuestas del análisis")
    # y si se retoma otra vez, no se pisa lo que ya hay
    pg.evaluate("() => { S.reqs[0].lvl = 2; touch(); }")
    pg.evaluate("async () => { await flush(); loadTablero(); }")
    pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(500)
    pg.click(f'[data-ses="{sid1}"]'); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")
    pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnRetomar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    if pg.evaluate("() => S.reqs[0].lvl") != 2:
        errs.append("retomar por segunda vez pisó el nivel que el evaluador ya había corregido")

    # ---------- D. Un análisis que falla se explica ----------
    pg.evaluate("async () => { await flush(); loadTablero(); }")
    pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate(f"() => verVacante({vac_id})"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    sesion_hasta_colgar(pg, "Carla Tercera")
    pg.fill("#transText", TRANS + " __ILEGIBLE__ "); pg.wait_for_timeout(150)
    pg.click("#btnAnalizarTrans")
    pg.wait_for_selector("#btnQuedarme", timeout=6000); pg.click("#btnQuedarme")
    pg.wait_for_selector("#btnAnalizarTrans", timeout=15000); pg.wait_for_timeout(300)
    tx = pg.inner_text("#transStage")
    if "No se pudo sacar la evidencia" not in tx:
        errs.append("un análisis fallido no volvió a la sala de espera con el motivo")

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

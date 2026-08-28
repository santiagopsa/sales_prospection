"""El pantallazo de la llamada, y el botón que decía "Ir y completar".

Dos fallas que reportó Santiago y que son la misma raíz: los índices de fase estaban
escritos a mano ("fase 0 = identidad, fase i+1 = requisito i"), y eso dejó de ser cierto
cuando la sesión se partió en dos momentos —entrevista y calificación—. Resultado:

  · "Ir y completar" mandaba al requisito equivocado (i+1 en vez de i);
  · el renglón de identidad mandaba a la fase 0, que en la lista de calificación es
    el PRIMER REQUISITO, no la apertura — y la apertura ya ni existe en esa lista,
    así que la captura del rostro no tenía dónde subirse. Callejón sin salida.

Lo que hay que sostener:
  · el recuadro de la captura está en Apertura Y al final de la entrevista (que es
    cuando el reclutador de verdad la toma, con la llamada todavía abierta);
  · si al llegar al cierre falta la captura, se puede subir ahí mismo;
  · "Ir y completar" cae exactamente en el requisito que falta;
  · en un sondeo la captura SÍ se ofrece y se guarda —para poder verificar la identidad
    después sin repetir la entrevista— pero no es requisito para emitir su ficha.
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

# Un PNG de 1x1 real: sirve para que el navegador lo cargue en un <img> y lo reduzca.
PNG = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010806000000"
    "1f15c4890000000d4944415478da63f8ffff3f0005fe02fea735c9a400"
    "00000049454e44ae426082")


def sesion(pg, kind="cierre"):
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(250)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    if kind == "cierre":
        pg.click('#setKind [data-k="cierre"]'); pg.wait_for_timeout(150)
    pg.fill("#sCand", "Ana prueba"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1180, "height": 1100})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    # ---------- A. Apertura: el recuadro está ----------
    sesion(pg, "cierre")
    if not pg.query_selector("#shotBox"):
        errs.append("no está el recuadro de la captura en la Apertura")
    pg.screenshot(path="/tmp/pk/cap_01_apertura.png", full_page=True)

    # Se marcan grabación y cámara, pero NO se sube la captura: así llega incompleta.
    for k in ["grab", "cam"]:
        pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(320)

    # ---------- B. Fin de la entrevista: el recuadro tiene que estar AQUÍ ----------
    flujo.recorrer_guia(pg)
    fin = pg.inner_text("#stage")
    if "Terminaste la entrevista" not in fin:
        errs.append("no se llegó al fin de la entrevista")
    if not pg.query_selector("#shotBox"):
        errs.append("REGRESIÓN: no se puede tomar la captura al final de la entrevista, "
                    "que es el último momento con la llamada abierta")
    if "Vuelve a Apertura" in fin:
        errs.append("todavía manda a otra pantalla en vez de dejar subirla aquí")
    pg.screenshot(path="/tmp/pk/cap_02_fin.png", full_page=True)

    # Y tiene que funcionar de verdad, no solo aparecer.
    pg.set_input_files("#shotFile", {"name": "rostro.png", "mimeType": "image/png", "buffer": PNG})
    pg.wait_for_timeout(1500)
    if not pg.query_selector("#shotBox.has"):
        errs.append("subir la captura al final de la entrevista no la marca como guardada")
    pg.screenshot(path="/tmp/pk/cap_03_subida.png", full_page=True)

    # ---------- C. "Ir y completar" cae en el requisito correcto ----------
    # Se califica solo el primero: el segundo queda sin nivel a propósito.
    flujo.pegar_transcripcion(pg)
    pg.wait_for_timeout(300)
    nombres = [pg.inner_text("#stage").split("\n")[0]]
    flujo.confirmar_niveles(pg, (5,))
    segundo = None
    for _ in range(6):
        cab = pg.inner_text("#stage").split("\n")[0]
        if "Cierre de la sesión" in cab:
            break
        if pg.query_selector('[data-lv="5"]') and cab not in nombres:
            segundo = cab
        pg.click("[data-next]"); pg.wait_for_timeout(340)
    cab = pg.inner_text("#stage")
    if "Cierre de la sesión" not in cab:
        errs.append("no se llegó al cierre de la sesión")
    else:
        ir = pg.query_selector_all("[data-ir]")
        if not ir:
            errs.append("no aparece ningún 'Ir y completar' habiendo un requisito sin nivel")
        else:
            pg.screenshot(path="/tmp/pk/cap_04_cierre.png", full_page=True)
            ir[0].click(); pg.wait_for_timeout(420)
            destino = pg.inner_text("#stage").split("\n")[0]
            if not pg.query_selector('[data-lv="5"]'):
                errs.append(f"'Ir y completar' no cayó en un requisito, cayó en: {destino!r}")
            elif segundo and destino != segundo:
                errs.append(f"'Ir y completar' cayó en {destino!r} y el que faltaba era {segundo!r}")
            pg.screenshot(path="/tmp/pk/cap_05_destino.png", full_page=True)
    pg.close()

    # ---------- D. Si falta la captura, se sube desde el cierre ----------
    pg2 = br.new_page(viewport={"width": 1180, "height": 1100})
    pg2.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg2.on("dialog", lambda d: d.accept())
    sesion(pg2, "cierre")
    for k in ["grab", "cam"]:
        pg2.click(f'[data-idc="{k}"]'); pg2.wait_for_timeout(90)
    pg2.click("[data-next]"); pg2.wait_for_timeout(320)
    flujo.recorrer_guia(pg2)
    flujo.pegar_transcripcion(pg2)
    flujo.confirmar_niveles(pg2, (5, 4))
    for _ in range(6):
        if "Cierre de la sesión" in pg2.inner_text("#stage"):
            break
        pg2.click("[data-next]"); pg2.wait_for_timeout(340)
    if "Cierre de la sesión" not in pg2.inner_text("#stage"):
        errs.append("(D) no se llegó al cierre")
    else:
        if not pg2.query_selector("#shotBox"):
            errs.append("REGRESIÓN: falta la captura y el cierre no deja subirla — "
                        "callejón sin salida")
        else:
            pg2.set_input_files("#shotFile", {"name": "rostro.png", "mimeType": "image/png", "buffer": PNG})
            pg2.wait_for_timeout(1500)
            # Al subirla, el renglón de identidad se pone en verde y el recuadro
            # desaparece: ya no falta nada que arreglar ahí.
            texto = pg2.inner_text("#stage")
            if "captura" in texto.lower() and "falta" in texto.lower():
                errs.append("después de subirla, el cierre sigue diciendo que falta la captura")
            if pg2.query_selector("#shotBox"):
                errs.append("el recuadro sigue pidiendo la captura después de subirla")
            if not pg2.query_selector(".gate.ok"):
                errs.append("ningún renglón quedó en verde tras completar la identidad")
        pg2.screenshot(path="/tmp/pk/cap_06_cierre_sube.png", full_page=True)
    pg2.close()

    # ---------- E. El sondeo la ofrece y la guarda, pero no la exige ----------
    #  Cambió la decisión: antes el sondeo no guardaba ninguna imagen. Ahora sí, porque si
    #  el candidato avanza semanas después había que repetirle la entrevista solo para
    #  tener una cara contra la cual cotejar la identidad.
    pg3 = br.new_page(viewport={"width": 1180, "height": 1100})
    pg3.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg3.on("dialog", lambda d: d.accept())
    sesion(pg3, "sondeo")
    if not pg3.query_selector("#shotBox"):
        errs.append("el sondeo ya no deja guardar la captura del rostro")
    if "sin repetir la entrevista" not in pg3.inner_text("#stage"):
        errs.append("el sondeo no explica para qué se guarda la captura")
    for k in ["grab", "cam"]:
        pg3.click(f'[data-idc="{k}"]'); pg3.wait_for_timeout(90)
    pg3.set_input_files("#shotFile", {"name": "rostro.png", "mimeType": "image/png", "buffer": PNG})
    pg3.wait_for_timeout(1500)
    pg3.click("[data-next]"); pg3.wait_for_timeout(320)
    flujo.recorrer_guia(pg3)
    # Al final se puede reemplazar, igual que en un cierre.
    if not pg3.query_selector("#shotBox"):
        errs.append("no se puede corregir la captura al final de un sondeo")
    # Y la verificación queda disponible para después, sin repetir la entrevista.
    flujo.pegar_transcripcion(pg3)
    flujo.confirmar_niveles(pg3, (5, 4))
    for _ in range(6):
        if "Cierre de la sesión" in pg3.inner_text("#stage"):
            break
        pg3.click("[data-next]"); pg3.wait_for_timeout(340)
    if not pg3.query_selector("#btnVerifDespues"):
        errs.append("REGRESIÓN: el sondeo no ofrece verificar la identidad después")
    else:
        pg3.click("#btnVerifDespues"); pg3.wait_for_timeout(700)
        if not pg3.query_selector("#btnEnviarId"):
            errs.append("al pedir verificación diferida no aparece cómo generar el link")
        pg3.screenshot(path="/tmp/pk/cap_07_diferida.png", full_page=True)
        # El ascenso tiene que sobrevivir a recargar desde el tablero: si solo vive en el
        # navegador, el reclutador vuelve mañana y la verificación diferida desapareció.
        pg3.click("#btnEnviarId"); pg3.wait_for_timeout(1600)
        pg3.wait_for_timeout(1200)      # que alcance a guardarse
        # Se limpia el almacenamiento local a propósito: si no, la sesión se restaura del
        # navegador y la prueba pasaría aunque el servidor no hubiera guardado nada.
        pg3.evaluate("localStorage.clear()")
        pg3.reload(); pg3.wait_for_timeout(1100)
        # El tablero lista las verificaciones aparte de las vacantes: se abre directo.
        fila = pg3.query_selector('#sesList [data-ses]')
        if not fila:
            errs.append("no se ve la sesión al volver por el tablero")
        else:
            fila.click(); pg3.wait_for_timeout(1600)
            cuerpo = pg3.inner_text("body")
            if "Verificación de identidad" not in cuerpo:
                errs.append("REGRESIÓN: el ascenso a verificación no se guardó en el servidor — "
                            "al volver, la sesión es un sondeo otra vez")
    pg3.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

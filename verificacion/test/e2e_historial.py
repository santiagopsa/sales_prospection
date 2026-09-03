"""Abrir una verificación anterior desde el tablero: emitida y a medias."""
from playwright.sync_api import sync_playwright
import sys as _sys, os as _os
_sys.path.insert(0, _os.path.dirname(_os.path.abspath(__file__)))
import flujo
import sys, time, subprocess, os, random, urllib.request, json

PORT = random.randint(3200, 3900)
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(os.path.dirname(os.path.abspath(__file__)), "stub.js")],
                        env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None: print("el stub murió"); sys.exit(1)
    try: urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception: time.sleep(0.25)

errs = []
T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es que haya hecho un rollout de PP en produccion. "
     "Tambien tiene que entender como PP se conversa con MM y QM. Rechazamos dos que sabian la teoria. ") * 4

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width":1120,"height":900})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("console", lambda m: errs.append(f"CONSOLE: {m.text}") if (m.type=="error" and "TUNNEL" not in m.text and "fonts" not in m.text) else None)
    pg.on("dialog", lambda d: d.accept())

    # --- una sesión completa y emitida ---
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200); pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Jorge Restrepo"); pg.fill("#sEval", "Laura M."); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(250)
    for k in ["grab","cam"]: pg.click(f'[data-idc="{k}"]'); pg.wait_for_timeout(90)
    pg.click("[data-next]"); pg.wait_for_timeout(300)
    flujo.recorrer_guia(pg)
    flujo.pegar_transcripcion(pg)
    flujo.confirmar_niveles(pg, (5, 3), [
        "Rollout en Alpina 2023, nueve meses, lideró listas de materiales.",
        "Escena genérica; no precisó los quiebres con QM.",
    ])
    for _ in range(4):
        if pg.query_selector('[data-d="pretension"]'): break
        pg.click("[data-next]"); pg.wait_for_timeout(350)
    pg.fill('[data-d="pretension"]', "3.500.000 COP / mes")
    pg.fill('[data-d="motivacion"]', "Busca autonomía en la decisión técnica.")
    pg.click('[data-rec="reserva"]'); pg.wait_for_timeout(120)
    pg.fill('[data-r="texto"]', "Núcleo medido y sostenido; reserva en la integración con QM.")
    pg.wait_for_timeout(150); pg.click("[data-next]"); pg.wait_for_timeout(500)
    pg.click("#btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
    codigo = pg.inner_text("#actaStage").split("Informe")[1].split("\n")[0].strip()

    # --- una segunda sesión que se deja a medias ---
    pg.click("#btnReset"); pg.wait_for_timeout(700)
    pg.click(".row[data-vac]"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Ana Betancur"); pg.fill("#sEval", "Laura M."); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(250)
    pg.click('[data-idc="grab"]'); pg.wait_for_timeout(200)
    pg.click("[data-next]"); pg.wait_for_timeout(300)
    # Esta se deja a medias DENTRO de la entrevista, antes de la transcripción.
    pg.wait_for_timeout(1300)   # el autoguardado tiene 900 ms de retardo

    # --- volver al tablero y abrir las dos ---
    pg.click("#btnHome"); pg.wait_for_timeout(900)
    filas = pg.query_selector_all("[data-ses]")
    if len(filas) != 2: errs.append(f"el tablero muestra {len(filas)} verificaciones, se esperaban 2")

    # la emitida abre el acta completa
    pg.click('[data-ses]:has-text("Jorge Restrepo")'); pg.wait_for_timeout(1200)
    acta = pg.inner_text("#actaStage")
    # Los rótulos cambiaron con el formato v4 del informe; lo que esta prueba cuida es que un
    # acta abierta desde el historial traiga su contenido completo, no cómo se llaman las zonas.
    for must in ["Jorge Restrepo", "Requisito por requisito", "CUMPLE", "PARCIAL",
                 "Nuestra recomendación", "Firma de integridad"]:
        if must.lower() not in acta.lower(): errs.append(f"el acta histórica no muestra: {must}")
    if "3.500.000" not in acta: errs.append("el acta histórica perdió lo que el candidato declaró")
    if "Volver a la lista" not in pg.inner_text("#actaStage"): errs.append("no ofrece volver a la lista")
    if pg.is_visible("#clockWrap"): errs.append("muestra el cronómetro en una sesión ya cerrada")
    pg.screenshot(path="/tmp/pk/hist_acta.png", full_page=True)

    # volver y abrir la que quedó a medias
    pg.click("#btnReset"); pg.wait_for_timeout(900)
    pg.click('[data-ses]:has-text("Ana Betancur")'); pg.wait_for_timeout(1200)
    bor = pg.inner_text("#actaStage")
    for must in ["Ana Betancur", "SIN EMITIR", "Requisitos calificados", "Retomar la sesión"]:
        if must.lower() not in bor.lower(): errs.append(f"el borrador no muestra: {must}")
    # Quedó a medias DENTRO de la entrevista: todavía no hay nada calificado, porque los
    # niveles salen de la transcripción y esa entrevista ni siquiera terminó.
    if "0 de 2" not in bor: errs.append(f"no dice cuántos requisitos quedaron calificados: {bor[:150]!r}")
    pg.screenshot(path="/tmp/pk/hist_borrador.png", full_page=True)

    # retomar debe llevar a la sesión con lo ya registrado
    pg.click("#btnRetomar"); pg.wait_for_timeout(900)
    if not pg.is_visible("#vLive"): errs.append("retomar no abrió la sesión")
    nav = pg.inner_text("#phaseNav")
    if "Apertura" not in nav: errs.append("la sesión retomada no tiene sus fases")
    # Lo que sí tiene que sobrevivir a media entrevista: los puntos de integridad marcados.
    pg.click('.ph:has-text("Apertura")'); pg.wait_for_timeout(500)
    if len(pg.query_selector_all(".chk.on")) != 1:
        errs.append("la sesión retomada perdió el punto de integridad que ya estaba marcado")
    pg.click('.ph:has-text("Implementación")'); pg.wait_for_timeout(500)
    if pg.query_selector("[data-notes]"):
        errs.append("al retomar una entrevista sin terminar aparecen campos de calificar")
    if "no tomes notas" not in pg.inner_text("#stage").lower():
        errs.append("al retomar la entrevista no vuelve a la guía")

    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs: print("  -", e)
sys.exit(1 if errs else 0)

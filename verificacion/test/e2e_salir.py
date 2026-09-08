"""Salir de la sesión nunca se queda pegado.

Pasó en producción: el reclutador daba "Salir de la sesión" y la pantalla no reaccionaba.
Dos causas posibles, y las dos se cubren aquí:
  · el guardado esperaba al servidor sin tope; si el servidor no contestaba (Postgres sin
    conexiones libres, Render dormido) el botón quedaba muerto para siempre;
  · la pregunta era un confirm() del navegador, y Chrome los silencia cuando el usuario marcó
    "no permitir más diálogos": confirm() devuelve false y el clic no hace nada.

Lo que hay que sostener:
  · la pregunta es de la página, no del navegador: se contesta aunque los diálogos estén
    bloqueados;
  · con un servidor que no contesta, se sale igual en pocos segundos, se avisa, y la copia
    local NO se borra (al recargar se retoma);
  · con el servidor sano, se sale, se guarda y la copia local se limpia;
  · un acta ya emitida sale directo, sin pregunta;
  · "Guardar y salir" desde la sala de espera también sale;
  · "Ir al tablero y seguir con otro" no deja una sesión fantasma que se retome al recargar.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

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


def simular(**kw):
    r = urllib.request.Request(B.rstrip('/') + "/api/__simular", data=json.dumps(kw).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(r))


errs = []
T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es un rollout de PP en produccion. "
     "Tambien PP con MM y QM. Rechazamos dos que sabian la teoria. ") * 5
TRANS = ("Reclutador: cuentame de tu experiencia con SAP PP.\n"
         "Candidato: en Alpina, entre marzo y noviembre de 2023, yo lleve el rollout de PP. "
         "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live.\n") * 10

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 950})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    # Como un navegador con los diálogos bloqueados: cualquier confirm() devuelve false.
    pg.on("dialog", lambda d: d.dismiss())

    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    vac_id = pg.evaluate("() => VAC.id")

    def nueva(nombre):
        pg.evaluate(f"() => verVacante({vac_id})"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(250)
        pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
        pg.fill("#sCand", nombre); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
        pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
        pg.evaluate("() => { S.idc = {grab:true, cam:true}; touch(); }")
        pg.wait_for_timeout(1200)     # que el autoguardado normal pase antes de la prueba

    def colgar():
        for _ in range(12):
            if pg.query_selector("#btnATranscripcion"): break
            b = pg.query_selector("#stage [data-next]")
            if not b: break
            b.click(); pg.wait_for_timeout(200)
        pg.click("#btnATranscripcion"); pg.wait_for_selector("#vTrans.on", timeout=9000); pg.wait_for_timeout(300)

    # ---------- A. El servidor no contesta al guardar ----------
    nueva("Ana Colgada")
    sid_a = pg.evaluate("() => S.sid")
    simular(guardar_colgado=True)
    t0 = time.time()
    pg.click("#btnReset"); pg.wait_for_timeout(300)
    if not pg.is_visible("#pregunta"):
        errs.append("al dar salir no aparece la pregunta de la página (¿sigue usando confirm()?)")
    else:
        pg.click("#pgSi")
    try:
        pg.wait_for_selector("#vTablero.on", timeout=15000)
    except Exception:
        errs.append("con el servidor sin contestar, salir se quedó pegado")
        pg.screenshot(path="/tmp/pk/salir_pegado.png", full_page=True)
    dt = time.time() - t0
    if dt > 12:
        errs.append(f"salir tardó {dt:.0f}s con el servidor colgado: el tope no está funcionando")
    if pg.is_visible("#overlay"):
        errs.append("el velo de 'guardando' se quedó puesto")
    tx = pg.inner_text("#toast")
    if "no respondió" not in tx:
        errs.append(f"no avisó que el servidor no respondió: {tx!r}")
    local = pg.evaluate("() => { const r = localStorage.getItem('pkv_sesion_v2'); return r ? JSON.parse(r) : null; }")
    if not local or not local.get("S") or local["S"].get("sid") != sid_a:
        errs.append("con el servidor sin contestar, borró la copia local: eso es perder la sesión")
    if simular(guardar_colgado=False).get("colgados", 0) < 1:
        errs.append("la prueba no llegó a colgar ningún guardado: no probó nada")
    pg.screenshot(path="/tmp/pk/salir_01_colgado.png", full_page=True)

    # Al recargar, esa sesión se retoma desde la copia local.
    pg.reload(); pg.wait_for_timeout(900)
    if pg.evaluate("() => S && S.sid") != sid_a:
        errs.append("tras salir con el servidor caído, recargar no retomó la sesión desde la copia local")

    # ---------- B. Servidor sano: sale, guarda y limpia ----------
    pg.evaluate("() => { S.sig = S.sig || {}; touch(); }")
    pg.click("#btnReset"); pg.wait_for_timeout(300)
    if pg.is_visible("#pregunta"): pg.click("#pgSi")
    pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(400)
    if pg.evaluate("() => !!localStorage.getItem('pkv_sesion_v2')"):
        errs.append("con el servidor sano, salir dejó la copia local puesta")
    if pg.evaluate("() => S !== null"):
        errs.append("salir no soltó la sesión en memoria")
    if "Ana Colgada" not in pg.inner_text("#sesList"):
        errs.append("la sesión no aparece en el tablero después de salir")

    # "Seguir aquí" no sale.
    nueva("Beto Sigue")
    pg.click("#btnReset"); pg.wait_for_timeout(300)
    pg.click("#pgNo"); pg.wait_for_timeout(300)
    if not pg.query_selector("#vLive.on") or pg.is_visible("#pregunta"):
        errs.append("'Seguir aquí' no dejó al reclutador donde estaba")

    # El logo también pregunta en la página y sale.
    pg.click("#btnHome"); pg.wait_for_timeout(300)
    if not pg.is_visible("#pregunta"):
        errs.append("el logo con sesión en curso no pregunta en la página")
    else:
        pg.click("#pgSi"); pg.wait_for_selector("#vTablero.on", timeout=9000)

    # ---------- C. Sala de espera: guardar y salir ----------
    nueva("Carla Espera"); colgar()
    pg.click("[data-salir]")
    try:
        pg.wait_for_selector("#vTablero.on", timeout=12000)
    except Exception:
        errs.append("'Guardar y salir' desde la sala de espera se quedó pegado")
    pg.wait_for_timeout(400)
    if "ESPERA TRANSCRIPCIÓN" not in pg.inner_text("#sesList"):
        errs.append("la sesión que salió de la sala de espera no quedó como ESPERA TRANSCRIPCIÓN")

    # ---------- D. Seguir con otro mientras analiza: sin sesión fantasma ----------
    nueva("Dario Paralelo"); colgar()
    pg.fill("#transText", TRANS + " __LENTO__ "); pg.wait_for_timeout(150)
    pg.click("#btnAnalizarTrans"); pg.wait_for_selector("#btnSeguirOtro", timeout=6000)
    pg.click("#btnSeguirOtro"); pg.wait_for_selector("#vTablero.on", timeout=12000); pg.wait_for_timeout(300)
    pg.reload(); pg.wait_for_timeout(900)
    if not pg.query_selector("#vTablero.on"):
        errs.append("tras 'seguir con otro', recargar la página retomó una sesión fantasma en vez del tablero")

    # ---------- E. Acta emitida: sale directo ----------
    nueva("Elena Emitida")
    flujo.recorrer_guia(pg); flujo.pegar_transcripcion(pg); flujo.confirmar_niveles(pg, (5, 4))
    for _ in range(6):
        if "Cierre de la sesión" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      S.reqs.forEach(r => { if(!r.lvl) r.lvl = 4; if(porqueDe(r).length <= EV_MIN) r.exp = 'Sostuvo el requisito con un caso propio y verificable.'; });
      touch(); S.fase = fases().length - 1; render();
    }""")
    pg.wait_for_timeout(300)
    if pg.is_disabled("#stage #btnActa"):
        errs.append("(E) no dejó emitir: " + pg.inner_text("#stage")[-400:])
    else:
        pg.click("#stage #btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(400)
        pg.click("#btnReset")
        try:
            pg.wait_for_selector("#vTablero.on", timeout=9000)
        except Exception:
            errs.append("salir desde un acta emitida se quedó pegado")
        if pg.is_visible("#pregunta"):
            errs.append("un acta emitida no tiene nada que perder y aun así pregunta")

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

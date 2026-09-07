"""Lo que falta de un requisito se resuelve en el cierre, sin salir de la pantalla.

El caso real: la transcripción propuso los niveles pero no dejó el porqué de alguno —o el
evaluador calificó a mano— y la compuerta bloqueaba el informe exigiendo "evidencia textual"
que ya ni se imprime. El reclutador quedaba con un botón gris y un "Ir y completar" que lo
mandaba a otra pantalla.

Lo que hay que sostener:
  · la compuerta exige nivel y PORQUÉ (lo que se imprime), no el rastro de auditoría;
  · cuando falta, el cierre muestra ahí mismo los botones de nivel y el campo del porqué;
  · al llenarlos, la compuerta se abre y el informe se puede emitir;
  · el porqué escrito a mano es lo que sale en el informe;
  · el servidor aplica la misma regla: sin porqué ni evidencia devuelve 409, con porqué emite.
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
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Yesid Estupiñán"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)

    # El caso del pantallazo: niveles puestos, ni porqué ni evidencia en ninguno.
    pg.evaluate("""() => {
      S.idc = {grab:true, cam:true};
      S.modo = 'calificacion';
      S.reqs.forEach(r => { r.lvl = 4; r.exp = ''; r.ev = ''; });
      touch(); S.fase = fases().length - 1; render();
    }""")
    pg.wait_for_timeout(400)

    if not pg.is_disabled("#stage #btnActa"):
        errs.append("dejó emitir sin ningún porqué")
    tx = pg.inner_text("#stage")
    if "Evidencia textual" in tx:
        errs.append("la compuerta sigue pidiendo 'evidencia textual', que ya no se imprime")
    if "nivel y su porqué" not in tx:
        errs.append("la compuerta no dice que lo que falta es el porqué")
    if pg.query_selector("#stage [data-ir]"):
        errs.append("todavía manda a otra pantalla con 'Ir y completar' en vez de resolverlo aquí")
    pg.screenshot(path="/tmp/pk/fix_00_cierre.png", full_page=True)
    n_fix = pg.eval_on_selector_all("#stage .fixreq", "els => els.length")
    if n_fix != 2:
        errs.append(f"deberían aparecer 2 requisitos para completar en el cierre y aparecen {n_fix}")

    # Resolverlo ahí mismo: el segundo lo baja a 2 y escribe los dos porqués.
    pg.click('#stage [data-fixlv="2"][data-i="1"]'); pg.wait_for_timeout(250)
    if pg.evaluate("() => S.reqs[1].lvl") != 2:
        errs.append("el botón de nivel del cierre no cambió el nivel")
    pg.fill('#stage [data-fixpq="0"]', "Narró el rollout de Alpina con fechas, alcance y decisiones propias, y describió la caída del arranque con el detalle de quien la vivió.")
    pg.wait_for_timeout(150)
    pg.fill('#stage [data-fixpq="1"]', "Su experiencia se concentra en producción; no aportó un caso propio operando la integración con calidad.")
    pg.wait_for_timeout(150)
    pg.wait_for_timeout(300)

    # Los campos NO desaparecen debajo del cursor: se quedan, y lo que cambia es la compuerta.
    if not pg.query_selector("#stage .fixreq"):
        errs.append("los campos se esfumaron mientras se escribía")
    if pg.is_disabled("#stage #btnActa"):
        errs.append("con nivel y porqué completos, no deja emitir")

    # El servidor aplica la misma regla: sin porqué, 409; con porqué, emite.
    r409 = pg.evaluate("""async () => {
      const cuerpo = {candidate:S.cand, identity:S.idc, signals:S.sig, data:{mode:S.mode},
        ratings:S.reqs.map(r => ({requirement_id:r.rid, req_text:r.n, level:r.lvl, evidence:'', analisis:''}))};
      try{ await api('/api/sessions/'+S.sid+'/issue', {method:'POST', body:cuerpo}); return 'emitio'; }
      catch(e){ return (e.payload && e.payload.faltas || []).join(' | '); }
    }""")
    if "por qué" not in r409:
        errs.append(f"el servidor no exige el porqué: {r409!r}")

    pg.click("#stage #btnActa"); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)
    acta = pg.inner_text("#actaStage")
    if "Narró el rollout de Alpina" not in acta:
        errs.append("el porqué escrito a mano en el cierre no salió en el informe")
    if "no aportó un caso propio" not in acta:
        errs.append("el segundo porqué escrito a mano no salió en el informe")
    if "NO CUMPLE" not in acta:
        errs.append("el nivel corregido en el cierre no se refleja en el informe")
    pg.screenshot(path="/tmp/pk/fix_01_acta.png", full_page=True)

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

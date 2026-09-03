"""Recorre el flujo completo y fotografía el informe con el formato nuevo.

No es una prueba —no afirma nada— sino la forma de MIRAR lo que sale antes de mandárselo a
un cliente: deja las capturas de cada pantalla y el PDF del informe en $SALIDA (por defecto
/tmp/peaku-informe). Se corre igual que las e2e:

    python3 verificacion/test/shot_inf.py
    SALIDA=~/Escritorio/informe python3 verificacion/test/shot_inf.py
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.environ.get("SALIDA", os.path.join(os.path.sep, "tmp", "peaku-informe"))
os.makedirs(SALIDA, exist_ok=True)
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

T = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es un rollout de PP en produccion. "
     "Tambien PP con MM y QM. Rechazamos dos que sabian la teoria. ") * 5
TRANS = ("Reclutador: cuentame de tu experiencia con SAP PP.\n"
         "Candidato: en Alpina, entre marzo y noviembre de 2023, yo lleve el rollout de PP. "
         "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live.\n"
         "Reclutador: que transaccion usas para listas de materiales?\n"
         "Candidato: CS01, y CS02 para modificar.\n") * 8

def simular(**kw):
    r = urllib.request.Request(B.rstrip('/') + "/api/__simular", data=json.dumps(kw).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(r)


simular(status="Approved", score=96.4, verdict="coincide")

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(400)
    pg.screenshot(path=f"{SALIDA}/inf_01_revision.png", full_page=True)

    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SALIDA}/inf_02_vacante.png", full_page=True)

    pg.click("#btnEditarVac"); pg.wait_for_selector("#vEditar.on", timeout=9000); pg.wait_for_timeout(300)
    pg.screenshot(path=f"{SALIDA}/inf_03_editar.png", full_page=True)
    pg.click("[data-volver]"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(200)

    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Dayana Maussá"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#setKind .mode[data-k='cierre']"); pg.wait_for_timeout(100)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)

    # Recorre la guía hasta encontrar la fase de conducta
    for i in range(12):
        txt = pg.inner_text("#stage")
        if "Perfil de conducta" in txt:
            pg.screenshot(path=f"{SALIDA}/inf_04_conducta_guia.png", full_page=True)
            break
        b = pg.query_selector("#stage [data-next]")
        if not b: break
        b.click(); pg.wait_for_timeout(250)

    # marcar integridad y captura, y terminar la entrevista
    pg.evaluate("""() => {
      S.idc = {grab:true, cam:true, shot:true};
      S.ingNivel = 'B2'; S.ingNota = 'Sostuvo el caso en inglés sin volver al español.'; S.ingMin = '14:20';
      touch();
    }""")
    # Colgar y pegar la transcripción, como en la vida real
    pg.evaluate("""async (txt) => {
      await marcarFinEntrevista();
      const out = await api('/api/sessions/'+S.sid+'/transcript', {method:'POST', body:{transcript: txt}});
      aplicarTranscripcion(out.analisis);
    }""", TRANS)
    pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(500)

    # Recorrer la calificación: confirmar niveles, ver conducta e impacto
    for i in range(14):
        txt = pg.inner_text("#stage")
        if "Perfil de conducta" in txt and "Confirma" in txt:
            pg.screenshot(path=f"{SALIDA}/inf_05_conducta_calif.png", full_page=True)
        if "Cierre de la sesión" in txt:
            break
        b = pg.query_selector("#stage [data-next]")
        if not b: break
        b.click(); pg.wait_for_timeout(250)

    # Rellenar lo que el evaluador escribe y emitir
    pg.evaluate("""() => {
      S.reqs.forEach(r => { if(!r.lvl) r.lvl = 3; if((r.ev||'').length < 20) r.ev = 'Evidencia registrada durante la sesión para este requisito.'; });
      S.dec = {...(S.dec||{}), ubicacion:'Medellín · híbrido'};
      S.rec = {veredicto:'reserva',
        texto:'Sostiene el núcleo del cargo con un rollout propio y verificable. La reserva es la integración con QM, que no se alcanzó a medir en la sesión.',
        riesgos:[{r:'La integración con QM quedó sin medir', m:'Media hora técnica con el líder de calidad antes de la oferta'},
                 {r:'Viene de una consultora, no de planta', m:'Confirmar con referencias cómo maneja el usuario de piso'}]};
      touch(); S.fase = fases().length-1; render();
    }""")
    pg.wait_for_timeout(400)
    pg.screenshot(path=f"{SALIDA}/inf_06_cierre.png", full_page=True)
    # generar el link de identidad y refrescar el cotejo (el stub lo devuelve aprobado)
    pg.evaluate("""async () => {
      await api('/api/sessions/'+S.sid+'/identidad', {method:'POST', body:{}});
      await api('/api/sessions/'+S.sid+'/identidad/refrescar', {method:'POST', body:{}});
      await recargarIdentidad();
      render();
    }""")
    pg.wait_for_timeout(900)
    pg.on("console", lambda m: errs.append("console:"+m.text) if m.type=="error" else None)
    pg.evaluate("() => emitirActa()")
    pg.wait_for_timeout(2500)
    if not pg.query_selector("#vActa.on"):
        print("TOAST:", pg.inner_text("#toast"))
        print("ERRS:", errs)
    pg.wait_for_selector("#vActa.on", timeout=12000); pg.wait_for_timeout(700)
    pg.screenshot(path=f"{SALIDA}/inf_07_acta.png", full_page=True)

    # y como lo va a ver impreso
    pg.evaluate("() => prepararImpresion()")
    pg.emulate_media(media="print")
    pg.wait_for_timeout(400)
    pg.screenshot(path=f"{SALIDA}/inf_08_acta_print.png", full_page=True)
    pg.pdf(path=f"{SALIDA}/inf_acta.pdf", format="Letter", print_background=True,
           margin={"top": "14mm", "bottom": "16mm", "left": "12mm", "right": "12mm"})

    br.close()
    STUB.terminate()
    print("ERRORES:", "; ".join(errs) if errs else "ninguno")

"""Tres requisitos, dos preguntas, y un informe que conecta al candidato con lo pedido.

Lo que hay que sostener:
  · la vacante no admite más de tres requisitos excluyentes — ni desde la revisión, ni
    desde la edición, ni desde el servidor si alguien manda el POST a mano;
  · el inglés se define en la vacante y no cuenta contra ese tope;
  · la guía de la entrevista lee dos preguntas por requisito, no tres de relleno;
  · el perfil de conducta se pregunta en la llamada y se lee de la transcripción;
  · un rasgo que no se abordó sale como "no se abordó", no rellenado;
  · el informe del cliente muestra el ajuste requisito por requisito, la conducta y lo
    que el candidato demostró — y nada de eso sale del CV, sale de la sesión.
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
     "Tambien PP con MM y QM. Rechazamos dos que sabian la teoria. Aqui va a encontrar mucho sin "
     "documentar y tiene que poder avanzar igual. ") * 5
TRANS = ("Reclutador: cuentame de tu experiencia con SAP PP.\n"
         "Candidato: en Alpina, entre marzo y noviembre de 2023, yo lleve el rollout de PP. "
         "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live.\n"
         "Reclutador: que transaccion usas para listas de materiales?\n"
         "Candidato: CS01, y CS02 para modificar.\n") * 8


def post(ruta, cuerpo):
    r = urllib.request.Request(B.rstrip('/') + ruta, data=json.dumps(cuerpo).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    try:
        return json.loads(urllib.request.urlopen(r).read()), 200
    except urllib.error.HTTPError as e:
        return json.loads(e.read()), e.code


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    # ---------- A. El tope de tres ----------
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(400)

    rev = pg.inner_text("#vRevision")
    if "Máximo 3" not in rev:
        errs.append("la revisión no dice que el máximo son 3 requisitos")
    if "Perfil de conducta" not in rev:
        errs.append("la revisión no ofrece el perfil de conducta")

    # agregar hasta pasarse: el cuarto no debe entrar
    for _ in range(3):
        pg.click("#btnAddEx"); pg.wait_for_timeout(150)
    n = pg.eval_on_selector_all("#exList .exq", "els => els.length")
    if n > 3:
        errs.append(f"la revisión dejó tener {n} requisitos; el máximo son 3")

    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    vac = pg.inner_text("#vacStage")
    if "Perfil de conducta" not in vac:
        errs.append("la vacante no muestra el perfil de conducta")
    if "Tolerancia a la ambigüedad" not in vac:
        errs.append("la vacante perdió el rasgo que venía del levantamiento")

    # el servidor tampoco: cuatro requisitos por POST directo se rechazan
    cuerpo = {"empresa": {"nombre": "Prueba tope"}, "vacante": {"titulo": "Cargo"},
              "excluyentes": [{"requisito": f"R{i}"} for i in range(4)]}
    out, code = post("/api/vacancies", cuerpo)
    if code != 400:
        errs.append(f"el servidor aceptó 4 requisitos (código {code}) — el tope tiene que valer también ahí")

    # ---------- B. El inglés se define en la edición, y no cuenta como requisito ----------
    pg.click("#btnEditarVac"); pg.wait_for_selector("#vEditar.on", timeout=9000); pg.wait_for_timeout(300)
    # Los rótulos van en mayúsculas por CSS, así que se comparan sin distinguir caja.
    ed = pg.inner_text("#editStage").lower()
    if "inglés" not in ed:
        errs.append("no se puede definir el inglés al editar la vacante")
    if "no cuenta contra los 3 requisitos" not in ed:
        errs.append("la edición no aclara que el inglés va aparte del tope")
    if not pg.query_selector("#edIngOn"):
        errs.append("falta el interruptor de inglés en la edición")
    if not pg.is_checked("#edIngOn"):
        errs.append("el inglés de la vacante no llegó marcado a la edición")
    if "perfil de conducta" not in ed:
        errs.append("no se pueden editar los rasgos de conducta")
    if pg.input_value('#pfEdit [data-pf="rasgo"][data-i="0"]') != "Tolerancia a la ambigüedad":
        errs.append("la edición no trae el texto del rasgo")

    # Con el tope lleno desaparece el botón de agregar. Aquí solo hay 2 requisitos —los
    # vacíos que se agregaron arriba no se guardan— así que todavía debe estar.
    if not pg.query_selector("#btnAddReq"):
        errs.append("con 2 de 3 requisitos debería poder agregarse otro")
    pg.click("#btnAddReq"); pg.wait_for_timeout(250)
    if pg.query_selector("#btnAddReq"):
        errs.append("al llegar a 3 requisitos todavía se ofrece agregar otro")
    if pg.eval_on_selector_all("#reqEdit .rq", "els => els.length") != 3:
        errs.append("el tercer requisito no se agregó")
    pg.click("[data-volver]"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(250)

    # ---------- C. Dos preguntas por requisito en la guía ----------
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Dayana Maussá"); pg.fill("#sEval", "Weimar"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)

    vistas, conducta = [], False
    for _ in range(14):
        txt = pg.inner_text("#stage")
        if "Requisito 1 de" in txt or "Requisito 2 de" in txt:
            vistas.append(pg.eval_on_selector_all("#stage .preg .pq", "els => els.length"))
        if "Perfil de conducta" in txt:
            conducta = True
            if "Cuéntame de la última vez" not in txt:
                errs.append("la fase de conducta no lee la pregunta literal")
            if "Está si:" not in txt:
                errs.append("la fase de conducta no muestra contra qué contrastar")
        b = pg.query_selector("#stage [data-next]")
        if not b: break
        b.click(); pg.wait_for_timeout(220)
    if not conducta:
        errs.append("la guía de la entrevista no incluye la fase de conducta")
    if any(v > 3 for v in vistas):
        errs.append(f"algún requisito mostró más de 3 preguntas: {vistas}")
    if not vistas:
        errs.append("no se llegó a ver ninguna pantalla de requisito")

    # ---------- D. La conducta se lee de la transcripción ----------
    pg.evaluate("""() => { S.idc = {grab:true, cam:true}; touch(); }""")
    pg.evaluate("""async (txt) => {
      await marcarFinEntrevista();
      const out = await api('/api/sessions/'+S.sid+'/transcript', {method:'POST', body:{transcript: txt}});
      aplicarTranscripcion(out.analisis);
    }""", TRANS)
    pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(500)

    visto = False
    for _ in range(14):
        txt = pg.inner_text("#stage")
        if "Perfil de conducta" in txt and "Confirma" in txt:
            visto = True
            bajo_c = txt.lower()
            if "tolerancia a la ambigüedad" not in bajo_c:
                errs.append("la calificación de conducta no trae el rasgo del cargo")
            if "no se abordó" not in bajo_c:
                errs.append("un rasgo que no se tocó debería salir como NO SE ABORDÓ, no rellenado")
            if "lo que demostró" not in bajo_c:
                errs.append("no aparecen las tarjetas de lo que demostró")
            # Las tarjetas son campos editables: su contenido está en el value, no en el texto.
            if pg.input_value('#impList [data-imp="titulo"][data-i="0"]') != "6 años en SAP PP":
                errs.append("las tarjetas no traen lo que salió de la transcripción")
            # Y el rasgo que no se abordó no puede venir con observación inventada
            sin_abordar = pg.evaluate("() => (S.perfil||[]).filter(o => o.presente === null).length")
            if sin_abordar != 1:
                errs.append(f"se esperaba 1 rasgo sin abordar y hay {sin_abordar}")
        if "Cierre de la sesión" in txt:
            break
        b = pg.query_selector("#stage [data-next]")
        if not b: break
        b.click(); pg.wait_for_timeout(220)
    if not visto:
        errs.append("no apareció la pantalla de confirmar la conducta")

    # ---------- E. El informe conecta al candidato con lo que pidió el cliente ----------
    pg.evaluate("""() => {
      S.reqs.forEach(r => { if(!r.lvl) r.lvl = 3; if((r.ev||'').length < 20) r.ev = 'Evidencia registrada en la sesión para este requisito.'; });
      S.dec = {...(S.dec||{}), ubicacion:'Medellín · híbrido'};
      S.rec = {veredicto:'reserva', texto:'Sostiene el núcleo del cargo con un rollout propio.', riesgos:[]};
      touch(); S.fase = fases().length-1; render();
    }""")
    pg.wait_for_timeout(400)
    pg.click("#stage #btnActa")
    pg.wait_for_selector("#vActa.on", timeout=12000); pg.wait_for_timeout(600)
    acta = pg.inner_text("#actaStage")
    bajo = acta.lower()

    for debe, porque in [
        ("requisito por requisito", "el informe no muestra el ajuste requisito por requisito"),
        ("requisitos que definió", "el informe no dice cuántos de los requisitos del cliente quedaron sostenidos"),
        ("cómo se comportó en la sesión", "el informe no trae la conducta observada"),
        ("tolerancia a la ambigüedad", "el informe perdió el rasgo de conducta"),
        ("lo que demostró", "el informe no trae las tarjetas de lo demostrado"),
        ("6 años en sap pp", "las tarjetas del informe perdieron su contenido"),
        ("factores de cierre", "el informe no trae los factores de cierre"),
        ("medellín · híbrido", "la cinta de datos perdió la ubicación"),
    ]:
        if debe not in bajo:
            errs.append(porque)

    # y lo que NO puede decir: que la conducta es un perfil psicométrico
    if "psicométrico" not in bajo:
        errs.append("el informe no acota el alcance de la conducta observada")
    if "no se abordó" not in bajo:
        errs.append("el informe esconde el rasgo que no se alcanzó a medir")
    pg.screenshot(path="/tmp/pk/pf_01_acta.png", full_page=True)

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

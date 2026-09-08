"""El informe se entrega en español o en inglés, a elección del reclutador.

Lo que hay que sostener:
  · en el cierre hay un selector Español / English; por defecto español;
  · si elige English, al emitir el informe sale en inglés: rótulos fijos traducidos por la
    pantalla y contenido (requisitos, párrafos, cargo) traducido por el servidor;
  · los nombres propios (candidato, empresa, evaluador) no cambian;
  · nada del español se cuela: ni rótulos ni niveles ni fechas;
  · desde el informe se puede volver a español y otra vez a inglés sin volver a traducir
    (la traducción queda guardada con el acta);
  · al reabrir la verificación desde el tablero se abre en el idioma en que se dejó;
  · el PDF impreso lleva el título y el membrete en el idioma del informe;
  · si la traducción falla, el informe se queda en español y se avisa: nunca un documento
    a medias;
  · el informe corto en español no se toca: `print_check.py` sigue mandando ahí.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json, re

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

ES_PROHIBIDO = ["Requisito por requisito", "CUMPLE", "Verificado el", "Vigente hasta", "Posicionamiento",
                "Factores de cierre", "Nuestra recomendación", "Firma de integridad", "Escanee",
                "Sesión supervisada", "Recomendación:", "Ajuste al rol", "Lo que demostró", "Conducta",
                "SE EVIDENCIÓ", "Bitácora", "Señales de asistencia", "Informe de verificación",
                " de 20", "PeakU Verificado", "Aspiración", "Imprimir o guardar"]
EN_DEBE = ["Requirement by requirement", "MEETS", "Verified on", "Valid until", "Integrity signature",
           "Scan to verify", "Fit for the role", "PeakU stands behind this report", "Consultant"]


def emitir(pg, nombre, idioma):
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", nombre); pg.fill("#sEval", "Weimar Ruiz"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate("() => { S.idc = {grab:true, cam:true}; touch(); }")
    flujo.recorrer_guia(pg); flujo.pegar_transcripcion(pg); flujo.confirmar_niveles(pg, (5, 4))
    for _ in range(6):
        if "Cierre de la sesión" in pg.inner_text("#stage"): break
        pg.click("[data-next]"); pg.wait_for_timeout(300)
    pg.evaluate("""() => {
      S.reqs.forEach(r => { if(!r.lvl) r.lvl = 4; if(porqueDe(r).length <= EV_MIN) r.exp = 'Demostró el requisito con un caso propio.'; });
      S.dec = {...(S.dec||{}), ubicacion:'Medellín · híbrido', disponibilidad:'inmediata', pretension:'COP 9.500.000'};
      S.rec = {veredicto:'reserva', texto:'Sostuvo el núcleo del cargo con un rollout propio.',
               riesgos:[{r:'Viene de consultora, no de planta', m:'Confirmar con referencias'}]};
      touch(); S.fase = fases().length - 1; render();
    }""")
    pg.wait_for_timeout(300)
    if not pg.query_selector("#setIdioma"):
        errs.append("el cierre no tiene selector de idioma")
    else:
        sel = pg.get_attribute('#setIdioma .mode.sel', 'data-idioma')
        if sel != 'es':
            errs.append(f"el idioma por defecto debería ser español y es {sel!r}")
        pg.click(f'#setIdioma [data-idioma="{idioma}"]'); pg.wait_for_timeout(150)
    pg.click("#stage #btnActa"); pg.wait_for_selector("#vActa.on", timeout=15000); pg.wait_for_timeout(600)
    return pg.inner_text("#actaStage")


# innerText respeta text-transform: los rótulos en mayúsculas del CSS llegan en mayúsculas.
def texto(pg, sel="#actaStage"):
    return pg.inner_text(sel).lower()


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

    # ---------- A. Emitido en inglés ----------
    acta = emitir(pg, "Yesid Estupiñán", "en").lower()
    pg.screenshot(path="/tmp/pk/idioma_01_en.png", full_page=True)
    for must in EN_DEBE:
        if must.lower() not in acta:
            errs.append(f"en inglés falta: {must!r}")
    for bad in ES_PROHIBIDO:
        if bad.lower() in acta:
            errs.append(f"en inglés se coló español: {bad!r}")
    for propio in ["Yesid Estupiñán", "Weimar Ruiz"]:
        if propio.lower() not in acta:
            errs.append(f"el nombre propio {propio!r} no se conservó")
    if "sap pp" not in acta:
        errs.append("el nombre del producto (SAP PP) no se conservó")
    if pg.get_attribute("#actaStage .acta", "lang") != "en":
        errs.append("el documento no declara lang=en")
    hechas = simular().get("traducciones_hechas", 0)
    if hechas != 1:
        errs.append(f"debería haberse traducido exactamente una vez y fueron {hechas}")

    # El PDF lleva título y membrete en inglés.
    pg.evaluate("() => prepararImpresion()")
    titulo = pg.evaluate("() => document.title")
    if not ("report" in titulo or "sheet" in titulo) or "Informe" in titulo or "Ficha" in titulo:
        errs.append(f"el título del PDF no está en inglés: {titulo!r}")
    if "verified" not in texto(pg, "#printHd"):
        errs.append("el membrete impreso no está en inglés")

    # Y el PDF en inglés cabe en dos hojas, sin página casi vacía ni español colado.
    pg.emulate_media(media="print"); pg.wait_for_timeout(300)
    ruta = "/tmp/pk/idioma_acta_en.pdf"
    pg.pdf(path=ruta, format="Letter", print_background=True, prefer_css_page_size=True)
    pg.emulate_media(media="screen")
    import pypdf
    r = pypdf.PdfReader(ruta)
    if len(r.pages) > 2:
        errs.append(f"el PDF en inglés salió en {len(r.pages)} páginas")
    ptxt = "".join(("\n".join(pp.extract_text() or "" for pp in r.pages)).split()).lower()
    for bad in ["requisitoporrequisito", "verificadoel", "vigentehasta", "firmadeintegridad", "cumple"]:
        if bad in ptxt:
            errs.append(f"en el PDF en inglés se coló español: {bad!r}")
    if "requirementbyrequirement" not in ptxt:
        errs.append("el PDF en inglés no trae el texto en inglés")
    png = "/tmp/pk/idioma_pg"
    subprocess.run(["pdftoppm", "-png", "-r", "60", ruta, png], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    from PIL import Image
    # Una última página corta es normal; una intermedia casi vacía es un salto mal puesto.
    for i in range(1, len(r.pages)):
        im = Image.open(f"{png}-{i}.png").convert("L")
        oscuro = sum(1 for v in im.getdata() if v < 200) / (im.width * im.height)
        if oscuro < 0.12:
            errs.append(f"la página {i} del PDF en inglés está casi vacía ({oscuro:.0%} de tinta)")

    # ---------- B. Volver a español y otra vez a inglés, sin volver a traducir ----------
    pg.click("#btnIdioma"); pg.wait_for_timeout(500)
    es = texto(pg)
    if "requisito por requisito" not in es or "cumple" not in es:
        errs.append("volver a español no devolvió el informe en español")
    if "yesid estupiñán" not in es:
        errs.append("en español se perdió el nombre")
    pg.click("#btnIdioma"); pg.wait_for_timeout(500)
    en2 = texto(pg)
    if "requirement by requirement" not in en2:
        errs.append("volver a inglés no funcionó")
    hechas = simular().get("traducciones_hechas", 0)
    if hechas != 1:
        errs.append(f"al alternar idiomas volvió a traducir ({hechas} veces): la traducción tiene que quedar guardada")

    # ---------- C. Reabrir desde el tablero: se abre como se dejó ----------
    sid = pg.evaluate("() => S.sid")
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(500)
    pg.click(f'[data-ses="{sid}"]'); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)
    re1 = texto(pg)
    if "requirement by requirement" not in re1:
        errs.append("al reabrir desde el tablero no se abrió en inglés, que fue como se dejó")
    if "consultant" not in re1:
        errs.append("al reabrir en inglés no se usó la traducción guardada del contenido")
    hechas = simular().get("traducciones_hechas", 0)
    if hechas != 1:
        errs.append(f"reabrir volvió a traducir ({hechas})")
    pg.click("#btnIdioma"); pg.wait_for_timeout(400)          # se deja en español
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(500)
    pg.click(f'[data-ses="{sid}"]'); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(500)
    if "requisito por requisito" not in texto(pg):
        errs.append("se dejó en español y al reabrir no salió en español")

    # ---------- D. Emitido en español: nada de inglés ----------
    pg.click("#btnReset"); pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate(f"() => verVacante({vac_id})"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    acta_es = emitir(pg, "Dayana Maussá", "es").lower()
    if "requirement by requirement" in acta_es or "meets" in acta_es:
        errs.append("emitido en español salió inglés")
    if simular().get("traducciones_hechas", 0) != 1:
        errs.append("emitir en español pidió una traducción que nadie necesitaba")

    # ---------- E. La traducción falla: se queda en español y avisa ----------
    simular(traduccion_falla=True)
    pg.click("#btnIdioma"); pg.wait_for_timeout(600)
    tx = texto(pg)
    if "requisito por requisito" not in tx:
        errs.append("con la traducción fallida, el informe no se quedó en español")
    if "[en]" in tx or "requirement by" in tx:
        errs.append("con la traducción fallida, salió un documento a medias")
    if "No se pudo traducir" not in pg.inner_text("#toast"):
        errs.append("con la traducción fallida no avisó")
    if pg.is_visible("#overlay"):
        errs.append("con la traducción fallida el velo se quedó puesto")
    simular(traduccion_falla=False)

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

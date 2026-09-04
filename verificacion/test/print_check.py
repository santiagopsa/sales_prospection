"""Audita el PDF del informe como sale de verdad: desde el diálogo de impresión de Chrome.

El informe se le entrega a un cliente, así que el PDF no puede depender de que el
reclutador acierte con la configuración. Se prueban los cuatro casos que ocurren en la vida
real —Carta y A4, con y sin "Gráficos de fondo"— usando los márgenes que declara la propia
hoja de estilo (@page), no unos inventados aquí.

Lo que revisa, página por página:
  · que no haya páginas casi vacías (una página con menos del 12% de tinta en el cuerpo
    es un salto mal puesto, y en un documento de cliente se lee como un error);
  · que nada quede cortado por el borde de la página;
  · que el texto del informe esté completo en el PDF, no solo en la pantalla;
  · que el QR sobreviva a la impresión;
  · que sin gráficos de fondo el documento siga siendo legible y siga distinguiendo
    CUMPLE de NO CUMPLE, que es lo único que no puede perderse.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.environ.get("SALIDA", os.path.join(os.path.sep, "tmp", "peaku-print"))
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
     "Tambien PP con MM y QM, y saber leer un indicador de planta. Rechazamos dos que sabian la teoria. "
     "Aqui va a encontrar mucho sin documentar y tiene que poder avanzar igual. ") * 6
TRANS = ("Reclutador: cuentame de tu experiencia con SAP PP.\n"
         "Candidato: en Alpina, entre marzo y noviembre de 2023, yo lleve el rollout de PP. "
         "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live.\n"
         "Reclutador: que transaccion usas para listas de materiales?\n"
         "Candidato: CS01, y CS02 para modificar.\n") * 8

errs = []


def simular(**kw):
    r = urllib.request.Request(B.rstrip('/') + "/api/__simular", data=json.dumps(kw).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    urllib.request.urlopen(r)


simular(status="Approved", score=96.4, verdict="coincide")

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.accept())

    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.wait_for_timeout(150)
    pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(400)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Dayana Maussá Restrepo"); pg.fill("#sEval", "Weimar Ospina"); pg.wait_for_timeout(120)
    pg.click("#setKind .mode[data-k='cierre']"); pg.wait_for_timeout(100)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)

    pg.evaluate("""() => {
      S.idc = {grab:true, cam:true, shot:true};
      S.ingNivel = 'B2';
      S.ingNota = 'Sostuvo el caso del rollout en inglés sin volver al español; buscó dos palabras técnicas.';
      S.ingMin = '14:20'; touch();
    }""")
    pg.evaluate("""async (txt) => {
      await marcarFinEntrevista();
      const out = await api('/api/sessions/'+S.sid+'/transcript', {method:'POST', body:{transcript: txt}});
      aplicarTranscripcion(out.analisis);
    }""", TRANS)
    pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(500)

    pg.evaluate("""() => {
      S.reqs.forEach((r,i) => {
        if(!r.lvl) r.lvl = i === 1 ? 2 : 4;
        if((r.ev||'').length < 20) r.ev = 'Evidencia textual registrada durante la sesión para este requisito.';
        if(!r.exp) r.exp = 'Sostuvo el tema con un caso propio y fechado, y describió la fricción real del arranque con el detalle de quien la vivió.';
        if(!r.falta) r.falta = 'El volumen exacto de la operación que manejó conviene precisarlo con una referencia del cliente anterior.';
      });
      S.tray = [
        {empresa:'Alpina', cargo:'Consultor SAP PP', periodo:'2022 - 2024', estado:'confirmado'},
        {empresa:'Nutresa', cargo:'Analista funcional', periodo:'2019 - 2022', estado:'sin_confirmar'}
      ];
      S.dec = {...(S.dec||{}), ubicacion:'Medellín · híbrido', procesos:'Dos, ninguno en oferta'};
      S.rec = {veredicto:'reserva',
        texto:'Sostiene el núcleo del cargo con un rollout propio, fechado y con fricción narrada. La reserva es la integración con QM: quedó sin medir en la sesión y es la parte que el equipo de calidad va a usar todos los días.',
        riesgos:[{r:'La integración con QM quedó sin medir', m:'Media hora técnica con el líder de calidad antes de la oferta'},
                 {r:'Viene de una consultora, no de planta', m:'Confirmar con referencias cómo maneja al usuario de piso cuando la línea está parada'}]};
      touch(); S.fase = fases().length-1; render();
    }""")
    pg.wait_for_timeout(400)
    pg.evaluate("""async () => {
      await api('/api/sessions/'+S.sid+'/identidad', {method:'POST', body:{}});
      await api('/api/sessions/'+S.sid+'/identidad/refrescar', {method:'POST', body:{}});
      await recargarIdentidad();
      render();
    }""")
    pg.wait_for_timeout(800)
    pg.evaluate("() => emitirActa()")
    pg.wait_for_selector("#vActa.on", timeout=12000); pg.wait_for_timeout(800)

    texto_pantalla = pg.inner_text("#actaStage")
    pg.evaluate("() => prepararImpresion()")
    pg.emulate_media(media="print")
    pg.wait_for_timeout(400)

    # Los márgenes los pone la hoja de estilo (@page): aquí no se inventan, porque el
    # reclutador tampoco los va a poner a mano.
    casos = []
    for papel in ("Letter", "A4"):
        for fondo in (True, False):
            nombre = f"{papel.lower()}_{'confondo' if fondo else 'sinfondo'}"
            ruta = os.path.join(SALIDA, f"acta_{nombre}.pdf")
            pg.pdf(path=ruta, format=papel, print_background=fondo,
                   prefer_css_page_size=True)
            casos.append((nombre, ruta, fondo))

    # El QR del informe completo, a la resolución de una impresora y con el tamaño que le
    # pone el CSS de papel (130px, no los 6 módulos de pantalla).
    qr = pg.query_selector("#actaStage .abqr svg")
    if not qr:
        errs.append("el informe impreso perdió el QR de verificación")
        caja = None
    else:
        caja = qr.bounding_box()
        qr.screenshot(path=os.path.join(SALIDA, "qr_impreso.png"))
    url_qr = pg.evaluate("() => { const b=document.querySelector('#actaStage .abqr'); return b && b.title; }")

    # ------------------------------------------------------------------
    # El caso pelado: un sondeo sin inglés, sin conducta, sin trayectoria y sin
    # recomendación. Es donde las bandas de dos columnas se quedan con un solo hijo, y
    # donde un documento corto puede quedar como tres cajas sueltas en media hoja.
    # ------------------------------------------------------------------
    pg.emulate_media(media="screen")
    pg.wait_for_timeout(200)
    pg.evaluate("""async () => {
      const v = await api('/api/vacancies', {method:'POST', body:{
        empresa:{nombre:'Cliente Mínimo'}, vacante:{titulo:'Analista de soporte'},
        excluyentes:[{requisito:'Soporte de aplicaciones en producción'}],
        ingles:{requerido:false}, perfil:[], modalidad_sugerida:'B'}});
      const s = await api('/api/sessions', {method:'POST', body:{
        vacancy_id:v.id, candidate:'Andrés Peláez', evaluator:'Weimar Ospina', mode:'B', kind:'sondeo'}});
      const vv = await api('/api/vacancies/'+v.id);
      VAC = vv;
      S = {sid:s.id, id:s.report_code, cand:'Andrés Peláez', rol:vv.title, cli:vv.company_name,
           eval:'Weimar Ospina', mode:'B', kind:'sondeo', ident:null,
           reqs:(vv.requirements||[]).map(r => ({rid:r.id, n:r.text, lvl:4,
             ev:'Evidencia textual registrada durante la sesión.',
             exp:'Narró dos incidentes propios con fecha y describió cómo escaló el segundo.',
             falta:'El volumen de tickets que manejó conviene precisarlo con una referencia.', r})),
           pf:[], perfil:[], impacto:[], tray:[], ing:null, ingNivel:null,
           dec:{}, rec:{riesgos:[]}, idc:{grab:true, cam:true}, sig:{},
           fase:0, t0:Date.now(), tFase:Date.now(), fin:false, fecha:null, hash:null};
      await flush();
      await emitirActa();
    }""")
    pg.wait_for_selector("#vActa.on", timeout=12000); pg.wait_for_timeout(700)
    minimo_pantalla = pg.inner_text("#actaStage")
    pg.evaluate("() => prepararImpresion()")
    pg.emulate_media(media="print")
    pg.wait_for_timeout(300)
    ruta_min = os.path.join(SALIDA, "acta_minima.pdf")
    pg.pdf(path=ruta_min, format="Letter", print_background=True, prefer_css_page_size=True)

    br.close()
    STUB.terminate()

# ---------------------------------------------------------------------------
# Revisión del PDF ya generado
# ---------------------------------------------------------------------------
import warnings
warnings.filterwarnings("ignore")
import pypdf
from PIL import Image

DEBE = ["Dayana Maussá", "PeakU", "requisitos que definió", "Requisito por requisito",
        "Cómo se comportó en la sesión", "Cómo se sostuvo la sesión", "Factores de cierre",
        "Firma de integridad", "Por confirmar", "Tolerancia a la ambigüedad",
        "PeakU responde por este informe", "Experiencia",
        "Señales de asistencia por IA o fuente externa", "Bitácora de la sesión"]

# Lo que el informe del cliente NO puede decir nunca: frases cuyo sujeto sea la entrevista o
# el evaluador. Delatan el guion y convierten un dato del candidato en una falla nuestra.
PROHIBIDO = ["no se preguntó", "no se le pidió", "no se alcanzó", "no se profundizó",
             "no se abordó", "no se contrastó", "faltó indagar", "por tiempo",
             "la sesión no cubrió", "no se midió el inglés", "ancla 1", "ancla 2",
             "ancla 3", "ancla 4", "ancla 5", "queda por verificar"]

# El QR es lo único que fallaría en silencio: se ve impecable y no escanea. Se decodifica
# desde los PÍXELES que pinta el navegador CON EL CSS DE IMPRESIÓN aplicado —que es donde
# el cuadro se achica a 130px— y a la resolución de una impresora, no desde la matriz que
# produjo el codificador: ese error ya ocurrió una vez y la matriz salía perfecta.
sys.path.insert(0, AQUI)
from qr_verify import decodificar


def modulos_desde_pixeles(im):
    g = im.convert("L"); w, h = g.size; px = g.load()
    def osc(x, y): return px[x, y] < 128
    xs = [x for x in range(w) if any(osc(x, y) for y in range(h))]
    ys = [y for y in range(h) if any(osc(x, y) for x in range(w))]
    if not xs or not ys:
        return None, "no hay nada oscuro en la imagen"
    x0, x1, y0, y1 = xs[0], xs[-1], ys[0], ys[-1]
    fila, run, x = y0 + 1, 0, x0
    while x <= x1 and osc(x, fila):
        run += 1; x += 1
    if run < 3:
        return None, "no se encontró el patrón localizador"
    paso = run / 7.0
    n = round((x1 - x0 + 1) / paso)
    if n < 21 or (n - 17) % 4:
        return None, f"rejilla irregular: {n} módulos con paso {paso:.2f}px"
    esc = (x1 - x0 + 1) / n
    mods = [[osc(min(w - 1, int(x0 + (c + .5) * esc)), min(h - 1, int(y0 + (f + .5) * esc)))
             for c in range(n)] for f in range(n)]
    return (mods, (n - 17) // 4), esc


print("=" * 74)
for nombre, ruta, fondo in casos:
    r = pypdf.PdfReader(ruta)
    n = len(r.pages)
    # Los rótulos van en mayúsculas por CSS y el extractor parte los renglones donde
    # quiere, así que se compara sin caja y con los espacios normalizados.
    # Chrome emite el texto con el kerning metido dentro de las palabras ("r equisitos"),
    # así que para buscar se quitan TODOS los espacios de los dos lados de la comparación.
    crudo = "\n".join(p.extract_text() or "" for p in r.pages)
    txt = "".join(crudo.split()).lower()
    kb = os.path.getsize(ruta) // 1024
    faltan = [d for d in DEBE if "".join(d.split()).lower() not in txt]

    # Tinta por página: una página casi vacía es un salto mal puesto.
    png = os.path.join(SALIDA, f"pg_{nombre}")
    subprocess.run(["pdftoppm", "-png", "-r", "60", ruta, png],
                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    tinta = []
    for i in range(1, n + 1):
        f = f"{png}-{i}.png" if n < 10 else f"{png}-{i:02d}.png"
        if not os.path.exists(f):
            f = f"{png}-{i}.png"
        if not os.path.exists(f):
            tinta.append(None); continue
        im = Image.open(f).convert("L")
        w, h = im.size
        # se ignora el 6% superior e inferior: ahí solo hay margen
        cuerpo = im.crop((0, int(h * 0.06), w, int(h * 0.94)))
        pix = cuerpo.getdata()
        oscuros = sum(1 for p in pix if p < 245)
        tinta.append(round(100 * oscuros / len(pix), 1))

    print(f"{nombre:22} {n} pág · {kb} KB · tinta por página: {tinta}")
    if faltan:
        errs.append(f"[{nombre}] al PDF le falta texto: {faltan}")
    dichos = [d for d in PROHIBIDO if "".join(d.split()).lower() in txt]
    if dichos:
        errs.append(f"[{nombre}] el informe se pone en evidencia ante el cliente: {dichos}")
    # Una última página corta es normal (ahí termina el documento). Una intermedia no.
    for i, t in enumerate(tinta[:-1]):
        if t is not None and t < 12:
            errs.append(f"[{nombre}] la página {i+1} de {n} quedó casi vacía ({t}% de tinta): salto mal puesto")
    if n > 4:
        errs.append(f"[{nombre}] {n} páginas: demasiado largo para un informe de cliente")


print("=" * 74)
# ---- el QR ----
if caja:
    from PIL import Image as _I
    img_qr = _I.open(os.path.join(SALIDA, "qr_impreso.png"))
    out, info = modulos_desde_pixeles(img_qr)
    if out is None:
        errs.append(f"el QR impreso no se puede leer: {info}")
    else:
        mods, ver = out
        # decodificar() devuelve la lista de fallas: vacía significa que el QR leído desde
        # los píxeles dice exactamente la URL que el informe promete.
        if not url_qr or "/verificacion/v/PKV-" not in url_qr:
            errs.append(f"el bloque del QR no lleva la URL de verificación: {url_qr!r}")
        else:
            fallas = decodificar(mods, ver, url_qr)
            if fallas:
                errs.append(f"el QR impreso no dice lo que debería: {fallas}")
        # 130px CSS a 96 ppp son 34 mm; con 33 módulos, cada uno mide ~1 mm. Un lector de
        # celular necesita al menos 0.5 mm por módulo para resolver el papel a un palmo.
        mm_por_modulo = (caja["width"] / 96 * 25.4) / (ver * 4 + 17)
        print(f"{'QR impreso':22} {ver*4+17} módulos · {caja['width']:.0f}px CSS · "
              f"{mm_por_modulo:.2f} mm por módulo · decodifica ✓")
        if mm_por_modulo < 0.5:
            errs.append(f"el QR queda a {mm_por_modulo:.2f} mm por módulo: demasiado chico para el papel")

# ---- el informe pelado ----
rmin = pypdf.PdfReader(ruta_min)
tmin = "".join(("\n".join(p.extract_text() or "" for p in rmin.pages)).split()).lower()
print(f"{'informe mínimo':22} {len(rmin.pages)} pág · un requisito, sin inglés ni conducta")
if len(rmin.pages) != 1:
    errs.append(f"el informe mínimo salió en {len(rmin.pages)} páginas: debería caber en una")
for d in ["Andrés Peláez", "Requisito por requisito", "Cómo se sostuvo la sesión",
          "PeakU responde por este informe", "Firma de integridad"]:
    if "".join(d.split()).lower() not in tmin:
        errs.append(f"[mínimo] al PDF le falta: {d}")
# Y lo que NO puede afirmar: es un sondeo, no certifica identidad.
if "nocertificalaidentidad" not in tmin:
    errs.append("[mínimo] el informe de sondeo no aclara que no certifica identidad")
for prohibido in ["Lo que se oyó", "Cómo se comportó en la sesión", "Experiencia más reciente"]:
    if "".join(prohibido.split()).lower() in tmin:
        errs.append(f"[mínimo] aparece una sección sin datos: {prohibido}")

pantalla = "".join(texto_pantalla.split()).lower()
for d in DEBE:
    if "".join(d.split()).lower() not in pantalla:
        errs.append(f"la pantalla ya no muestra: {d}")
for d in PROHIBIDO:
    if "".join(d.split()).lower() in pantalla:
        errs.append(f"la pantalla del informe dice algo que delata el proceso: {d}")

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
print("PDFs en:", SALIDA)
sys.exit(1 if errs else 0)

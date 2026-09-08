"""El informe cabe en UNA hoja de Oficio con la carga de un caso real.

El caso es el de José: tres requisitos con recomendación, cinco tarjetas, tres rasgos de
conducta, experiencia verificada, sin inglés y un solo factor de cierre. Ese informe salía
en dos páginas de Oficio con el bloque de respaldo solo en la segunda.

Lo que hay que sostener:
  · en Oficio cabe en UNA página, con el ajuste a una hoja (zoom) dentro del piso legible;
  · en Carta no pasa de dos, y el ajuste nunca baja del piso (0.88): un informe ilegible es
    peor que uno de dos páginas;
  · el QR no se encoge con el resto del documento;
  · el informe sigue diciendo todo lo que tiene que decir (nada se recorta para caber).

También imprime cuánto mide cada bloque, que es la regla con la que se mide este trabajo:

    python3 verificacion/test/e2e_una_hoja.py
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

AQUI = os.path.dirname(os.path.abspath(__file__))
SALIDA = os.environ.get("SALIDA", "/tmp/pk/hoja")
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

T = ("Marcela: necesitamos un Head of Infrastructure. Lo minimo es experiencia administrando infraestructura de redes LAN/WAN. "
     "Tambien gestion de proveedores y SLA. Rechazamos dos que sabian la teoria. ") * 5

CASO = r"""() => {
  S.cand = 'José Montalvo'; S.eval = 'Weimar Gil';
  S.rol = 'Head of Infrastructure / Líder de Infraestructura';
  S.idc = {grab:true, cam:true};
  S.reqs = [
    {rid:null, n:'Experiencia administrando infraestructura de redes LAN/WAN y equipos como switches, routers, access points y firewalls', lvl:4, ev:'',
     exp:'Narró una caída real que resolvió por iniciativa propia instalando un backup 4G en un municipio lejano. Sin embargo, la WAN la manejaba centralmente Bogotá y su rol era de primer nivel. No detalló segmentación en VLAN, reglas de firewall propias ni marcas y modelos específicos de switches o routers.',
     falta:'Encajaría mejor con un par técnico senior en networking durante los primeros meses.', r:{}},
    {rid:null, n:'Experiencia gestionando proveedores, contratos y acuerdos de nivel de servicio (SLA)', lvl:4, ev:'',
     exp:'Narró un conflicto real y concreto con el proveedor Saurón, que reclasificaba daños como fallas eléctricas, y describió cómo lo confrontó cruzando datos con mantenimiento. La gestión de SLA la explicó vía tickets por criticidad, pero no citó umbrales numéricos como uptime o tiempos de respuesta ni penalidades contractuales.',
     falta:'', r:{}},
    {rid:null, n:'Gestión de presupuesto e infraestructura física con control en Excel/Google Sheets avanzado', lvl:4, ev:'',
     exp:'Distingue OPEX de CAPEX y describió reportes de daños y presentaciones a directivos, pero declaró explícitamente que no manejaba el control de presupuesto, que estaba a cargo de su jefe. No dio cifras del presupuesto, ni funciones avanzadas de Excel ni una optimización con impacto cuantificado.',
     falta:'Conviene contemplar apoyo o formación en control presupuestal si el rol lo exige de forma autónoma.', r:{}},
  ];
  S.impacto = [
    {titulo:'15 años en infraestructura', sub:'Trayectoria profesional', texto:'Carrera sostenida en infraestructura entre retail y motocicletas.'},
    {titulo:'60+ aperturas de tienda', sub:'Despliegue tecnológico', texto:'Implementó infraestructura de más de 60 tiendas en la costa.'},
    {titulo:'Coordinó mesa de ayuda', sub:'Liderazgo de equipo', texto:'Montó desde cero mesa de ayuda con 10 analistas.'},
    {titulo:'Implementación SAP', sub:'ERP', texto:'Lideró la migración a SAP en Grupo Supermotos.'},
    {titulo:'Nagios y monitoreo', sub:'Herramientas de red', texto:'Usó Nagios para monitoreo de redes y comunicaciones.'},
  ];
  S.perfil = [
    {rasgo:'Enfoque preventivo ante riesgos operativos', presente:true, observado:'Anticipó problemas de conectividad al saber que un municipio tenía señal deficiente antes de abrir la tienda, y gestionó tres proveedores de fibra para acelerar la instalación.'},
    {rasgo:'Decisión bajo presión en operación crítica', presente:true, observado:'Ante una apertura sin datáfonos, situación grave para la compañía, actuó cuando el conducto regular no dio respuesta y movió al proveedor para instalar antes de la fecha. El énfasis fue en insistencia más que en un análisis de causa raíz.'},
    {rasgo:'Coordinación de equipos y proveedores distribuidos', presente:true, observado:'Describió coordinación transversal en proyectos con Finanzas, contabilidad y proveedores de software, explicando que toda inversión pasaba por Finanzas y que mantenía comunicación desde el inicio hasta la entrega.'},
  ];
  S.exp = {empresa:'Jerónimo Martins Colombia', cargo:'Analista de infraestructura IT, luego coordinador de mesa de ayuda y especialista de operaciones', periodo:'9 años', verificada:true,
           porque:'Narró decisiones propias con escena y fricción real como el viaje a instalar un backup 4G, y los detalles de fases y proveedores son consistentes entre sí y con lo declarado.'};
  S.ing = null; S.ingNivel = null;
  S.dec = {pretension:'Entre 7 y 9 millones, se ajusta', motivacion:'La vacante describe casi toda su experiencia laboral y siente que encaja para la posición.'};
  S.rec = {veredicto:'', texto:'', riesgos:[]};
  touch(); S.fase = fases().length - 1; render();
}"""

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    errs = []
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(200)
    pg.fill("#srcText", T); pg.click("#btnAnalizar"); pg.wait_for_selector("#vRevision.on", timeout=15000); pg.wait_for_timeout(300)
    pg.click("#btnGuardarVac"); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "José Montalvo"); pg.fill("#sEval", "Weimar Gil"); pg.wait_for_timeout(120)
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(300)
    pg.evaluate(CASO); pg.wait_for_timeout(300)
    pg.evaluate("() => emitirActa()")
    pg.wait_for_selector("#vActa.on", timeout=12000); pg.wait_for_timeout(700)
    pg.screenshot(path=f"{SALIDA}/pantalla.png", full_page=True)

    k = pg.evaluate("() => prepararImpresion() || getComputedStyle(document.documentElement).getPropertyValue('--ajuste')")
    pg.emulate_media(media="print"); pg.wait_for_timeout(400)
    alto = pg.evaluate("() => document.querySelector('#actaStage .acta').getBoundingClientRect().height")
    ajuste = pg.evaluate("() => getComputedStyle(document.documentElement).getPropertyValue('--ajuste')")
    print(f"alto del informe en CSS de papel: {alto:.0f}px · --ajuste={ajuste.strip() or '1'}")
    sin = pg.evaluate("() => { const a=document.querySelector('#actaStage .acta'); const z=a.style.zoom; a.style.zoom='1'; const h=a.getBoundingClientRect().height; a.style.zoom=z; return h; }")
    geo = pg.evaluate("""() => { const r = e => { const b = e.getBoundingClientRect(); return [Math.round(b.top), Math.round(b.bottom), Math.round(b.width)]; };
      return {body: document.body.scrollHeight, stage: r(document.querySelector('#actaStage')), acta: r(document.querySelector('#actaStage .acta')),
              pie: r(document.querySelector('#actaStage .cierrepie')), alcance: r(document.querySelector('#actaStage .alcance') || document.body)}; }""")
    print("  geometría en papel:", geo)
    print("  medida del clon a lo ancho de Carta:", pg.evaluate("() => HOJA.ultimoAlto"), "px · k =", k)
    print(f"  sin ajuste: {sin:.0f}px · Carta usable ≈ 961px · Oficio usable ≈ 1249px")
    # Contraste: la misma página a lo ancho de una hoja Carta, en medios de impresión.
    pg.set_viewport_size({"width": 725, "height": 1000}); pg.wait_for_timeout(300)
    real = pg.evaluate("() => { const a=document.querySelector('#actaStage .acta'); const z=a.style.zoom; a.style.zoom='1'; const h=a.getBoundingClientRect().height; a.style.zoom=z; return [h, a.getBoundingClientRect().width]; }")
    print(f"  altura real en papel a 725px de ancho: {real[0]:.0f}px (ancho {real[1]:.0f})")
    partes = pg.evaluate("""() => { const a=document.querySelector('#actaStage .acta'); const z=a.style.zoom; a.style.zoom='1';
      const out = []; const top = a.getBoundingClientRect().top;
      for(const el of a.querySelectorAll(':scope > *, :scope > div > *')){ const b = el.getBoundingClientRect(); if(b.height>0) out.push([(el.className||el.tagName).toString().slice(0,18), Math.round(b.top-top), Math.round(b.height)]); }
      a.style.zoom=z; return out; }""")
    for nom, top, alto in partes: print(f"     {top:5d}  {alto:4d}  {nom}")
    pg.screenshot(path=f"{SALIDA}/papel_725.png", full_page=True)
    pg.set_viewport_size({"width": 1240, "height": 1000}); pg.wait_for_timeout(200)
    import pypdf
    paginas = {}
    for papel in ("Letter", "Legal"):
        ruta = f"{SALIDA}/jose_{papel.lower()}.pdf"
        pg.pdf(path=ruta, format=papel, print_background=True, prefer_css_page_size=True)
        r = pypdf.PdfReader(ruta)
        n = len(r.pages); paginas[papel] = n
        subprocess.run(["pdftoppm", "-png", "-r", "50", ruta, f"{SALIDA}/jose_{papel.lower()}"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        print(f"  {papel:7} → {n} página{'s' if n>1 else ''}")
        txt = "".join(("\n".join(pp.extract_text() or "" for pp in r.pages)).split()).lower()
        for debe in ["backup4G", "Saurón", "OPEXdeCAPEX", "Nagios", "JerónimoMartins", "PeakUrespondeporesteinforme", "Recomendación:", "Escala1-5"]:
            if "".join(debe.split()).lower() not in txt:
                errs.append(f"[{papel}] al PDF le falta: {debe}")
    kk = pg.evaluate("() => HOJA.ultimoK")
    if paginas["Legal"] != 1:
        errs.append(f"en Oficio salió en {paginas['Legal']} páginas: tiene que caber en una")
    if paginas["Letter"] > 2:
        errs.append(f"en Carta salió en {paginas['Letter']} páginas")
    if not (0.88 <= kk <= 1):
        errs.append(f"el ajuste a una hoja quedó en {kk}: fuera del piso legible")
    qr = pg.evaluate("() => { const q=document.querySelector('#actaStage .abqr svg'); return q ? q.getBoundingClientRect().width : 0; }")
    if abs(qr - 104) > 3:
        errs.append(f"el QR se encogió con el documento: mide {qr:.0f}px y debe seguir en 104")
    br.close()
    STUB.terminate()
    print("ERRORES:", "; ".join(errs) if errs else "ninguno")
    sys.exit(1 if errs else 0)

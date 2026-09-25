"""Los indicadores de la semana, como el cuadro de prospección.

Lo que hay que sostener:
  · la barra de arriba lleva de Tablero a Indicadores y marca dónde está;
  · los cuatro focos (vacantes verificadas, calidad, empresas atendidas, informes contra la meta)
    muestran lo mismo que calcula el servidor;
  · una empresa con 10 vacantes a la que se le trabajaron 3 sale "3 de 10" y ATENDIDA; la que no
    se tocó sale SIN ATENDER;
  · día por día, de lunes a domingo, con hoy marcado y el total de la semana;
  · se navega a la semana anterior y desde la tendencia de 8 semanas;
  · "ver como" filtra por evaluador;
  · en un teléfono no hay scroll horizontal.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
PORT = random.randint(3200, 3900)
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(AQUI, "stub.js")], env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None: print("el stub murió al arrancar"); sys.exit(1)
    try: urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception: time.sleep(0.25)
else:
    print("el stub no respondió"); sys.exit(1)

def post(ruta, cuerpo):
    r = urllib.request.Request(B.rstrip('/') + ruta, data=json.dumps(cuerpo).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(r))
def get(ruta):
    return json.load(urllib.request.urlopen(B + ruta))

AHORA = datetime.now(timezone.utc)
iso = lambda d: d.isoformat().replace("+00:00", "Z")
hace = lambda dias=0, horas=0: iso(AHORA - timedelta(days=dias, hours=horas))

# Grupo Éxito con 10 vacantes (se trabajan 3 esta semana), Movizzon con 2, Rappi con 1 sin tocar.
vac = [{"title": f"Cargo Éxito {i+1}", "company_name": "Grupo Éxito", "created_at": hace(40)} for i in range(10)]
vac += [{"title": "Data Engineer", "company_name": "Movizzon", "created_at": hace(40)},
        {"title": "Head of Infra", "company_name": "Movizzon", "created_at": hace(0, 2)},
        {"title": "Analista BI", "company_name": "Rappi", "created_at": hace(40)}]
ses = []
def inf(nombre, v, ev, dias, niveles, sem="verde"):
    ses.append({"candidate": nombre, "evaluator": ev, "vacante": v, "status": "issued", "semaforo": sem,
                "started_at": hace(dias, 6), "entrevista_at": hace(dias, 5), "issued_at": hace(dias, 1), "updated_at": hace(dias, 1),
                "ratings": niveles})
# Hoy (siempre cae en la semana en curso)
inf("Ana Hoy", 0, "Weimar", 0, [5, 4, 4])
inf("Beto Hoy", 1, "Weimar", 0, [4, 3, 4], "amarillo")
inf("Caro Hoy", 10, "Laura", 0, [5, 5])
ses.append({"candidate": "Dani Entrevista", "evaluator": "Weimar", "vacante": 2, "status": "draft",
            "started_at": hace(0, 3), "entrevista_at": hace(0, 3), "updated_at": hace(0, 3)})
# Semana pasada y antes
for i in range(4):
    inf(f"Viejo {i}", 3 + i, "Weimar", 8 + i, [5, 5, 4])
inf("Muy Viejo", 11, "Laura", 30, [2, 3])
post("/api/__sembrar", {"vacantes": vac, "sesiones": ses})

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(700)

    # ---------- Barra ----------
    if not pg.is_visible("#topNav") or not pg.query_selector('#topNav [data-nav="tablero"].on'):
        errs.append("la barra de arriba no está o no marca el tablero")
    pg.click('#topNav [data-nav="indicadores"]'); pg.wait_for_selector("#vIndicadores.on", timeout=9000); pg.wait_for_timeout(500)
    if not pg.query_selector('#topNav [data-nav="indicadores"].on'):
        errs.append("la barra no marca 'Indicadores'")
    d = get("api/indicadores")
    w = d["semana"]
    if "Semana del" not in pg.inner_text("#indTitulo"):
        errs.append("no dice qué semana es")

    # ---------- Focos ----------
    focos = pg.eval_on_selector_all(".ifoco", "e => e.map(x => x.innerText)")
    if len(focos) != 4:
        errs.append(f"no están los cuatro focos: {len(focos)}")
    else:
        if str(w["vacantes_verificadas"]) not in focos[0] or "VACANTES VERIFICADAS" not in focos[0].upper():
            errs.append(f"vacantes verificadas no cuadra: {focos[0]!r} vs {w['vacantes_verificadas']}")
        if w["pct_cumplen"] is None or f"{w['pct_cumplen']}%" not in focos[1]:
            errs.append(f"la calidad no cuadra: {focos[1]!r} vs {w['pct_cumplen']}")
        if f"{w['empresas_atendidas']} / {d['empresas_con_vacantes']}" not in focos[2].replace("\n", " "):
            errs.append(f"empresas atendidas no cuadra: {focos[2]!r}")
        if str(w["informes"]) not in focos[3]:
            errs.append(f"informes no cuadra: {focos[3]!r}")
    if w["vacantes_verificadas"] != 3 or w["empresas_atendidas"] != 2 or w["informes"] != 3:
        errs.append(f"el servidor cuenta mal la semana: {w}")

    # ---------- Empresas ----------
    emp = pg.inner_text("#indEmpresas")
    fila_exito = pg.inner_text('#indEmpresas tr:has-text("Grupo Éxito")')
    if "3 de 10" not in fila_exito or "ATENDIDA" not in fila_exito:
        errs.append(f"Grupo Éxito no sale '3 de 10' y atendida: {fila_exito!r}")
    if "SIN ATENDER" not in pg.inner_text('#indEmpresas tr:has-text("Rappi")'):
        errs.append("Rappi, sin trabajar, no sale sin atender")

    # ---------- Día por día ----------
    filas = pg.eval_on_selector_all(".itabla:not(.emp):not(.tend) tbody tr", "e => e.length")
    if filas != 7:
        errs.append(f"el día por día no trae 7 días: {filas}")
    if not pg.query_selector(".itabla tbody tr.hoy"):
        errs.append("hoy no está marcado en el día por día")
    hoy = pg.inner_text(".itabla tbody tr.hoy")
    if "3" not in hoy:
        errs.append(f"la fila de hoy no trae sus 3 informes: {hoy!r}")
    pg.screenshot(path="/tmp/pk/ind_01_semana.png", full_page=True)

    # ---------- Navegar ----------
    lunes = d["lunes"]
    pg.click('#indRango [data-sem]'); pg.wait_for_timeout(600)
    if pg.evaluate("() => IND.d.lunes") == lunes:
        errs.append("'semana anterior' no cambia de semana")
    if not pg.query_selector('#indRango [data-sem=""]'):
        errs.append("en una semana pasada no se ofrece volver a esta semana")
    mas_vieja = pg.evaluate("() => IND.d.tendencia[0].inicio")
    pg.click('.itabla.tend tbody tr:last-child'); pg.wait_for_timeout(600)
    if pg.evaluate("() => IND.d.lunes") != mas_vieja:
        errs.append("la fila de la tendencia no lleva a esa semana")

    # ---------- Ver como ----------
    pg.click('#indRango [data-sem=""]') if pg.query_selector('#indRango [data-sem=""]') else None
    pg.wait_for_timeout(500)
    pg.select_option("#selEvalInd", "Laura"); pg.wait_for_timeout(600)
    if pg.evaluate("() => IND.d.semana.informes") != 1 or "Laura" not in pg.inner_text("#indRango"):
        errs.append("'ver como Laura' no filtra los indicadores")
    pg.select_option("#selEvalInd", ""); pg.wait_for_timeout(500)

    # ---------- Desde el tablero ----------
    pg.click('#topNav [data-nav="tablero"]'); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(500)
    pg.click("#btnVerSemana"); pg.wait_for_selector("#vIndicadores.on", timeout=9000)

    # ---------- Teléfono ----------
    m = br.new_page(viewport={"width": 390, "height": 900})
    m.goto(B); m.wait_for_timeout(600)
    m.click('#topNav [data-nav="indicadores"]'); m.wait_for_selector("#vIndicadores.on"); m.wait_for_timeout(600)
    sw = m.evaluate("document.documentElement.scrollWidth")
    if sw > 390:
        errs.append(f"en el teléfono hay scroll horizontal: {sw}px")
    m.screenshot(path="/tmp/pk/ind_02_movil.png", full_page=True)

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

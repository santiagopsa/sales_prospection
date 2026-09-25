"""El tablero con historia: qué me toca hacer, cómo voy, y cada vacante con sus candidatos.

Con decenas de verificaciones la lista plana dejó de servir. Lo que hay que sostener:
  · "Para hacer ahora" lista lo pendiente, con lo que falló primero y lo listo para calificar
    después, cada uno con su acción; al abrir una fila, abre esa verificación;
  · "Ver como" filtra la cola, los indicadores y la lista por evaluador (aunque lo hayan
    escrito distinto), saluda por el nombre y se recuerda;
  · la meta de la semana muestra el avance y se puede cambiar; la racha cuenta días hábiles;
  · el pulso muestra solo las vacantes en movimiento (creadas o movidas en 14 días), en el orden
    del servidor, con sus validados, la terna y la probabilidad de cierre; se despliegan sus
    candidatos validados;
  · las vacantes cerradas salen del tablero y se ven en su filtro; cada vacante muestra sus
    números y un punto por candidato, y se despliega su lista;
  · la lista de verificaciones se busca por nombre o código, se filtra y se pagina;
  · la pantalla de la vacante lista a sus candidatos, validados primero, y abre el informe;
  · cerrar o reabrir una vacante desde el tablero mismo, o desde su pantalla, la saca/devuelve.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json
from datetime import datetime, timedelta, timezone

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


def post(ruta, cuerpo):
    r = urllib.request.Request(B.rstrip('/') + ruta, data=json.dumps(cuerpo).encode(),
                               headers={"Content-Type": "application/json"}, method="POST")
    return json.load(urllib.request.urlopen(r))


AHORA = datetime.now(timezone.utc)
iso = lambda d: d.isoformat().replace("+00:00", "Z")
hace = lambda dias=0, horas=0: iso(AHORA - timedelta(days=dias, hours=horas))

# Tres vacantes activas y una cerrada; ~30 verificaciones de dos evaluadores en 8 semanas.
random.seed(7)
vac = [
    {"title": "Consultor SAP PP", "company_name": "IDOM", "created_at": hace(60)},
    {"title": "Data Engineer", "company_name": "Movizzon", "created_at": hace(60)},
    {"title": "Head of Infrastructure", "company_name": "Movizzon", "created_at": hace(60)},
    {"title": "Analista BI", "company_name": "Rappi", "status": "cerrada", "created_at": hace(60)},
    {"title": "Vacante Quieta", "company_name": "Alpina", "created_at": hace(70)},
    {"title": "Vacante Nueva", "company_name": "Nutresa", "created_at": hace(2)},
]
nombres = ["Ana Torres", "Bruno Díaz", "Carla Ruiz", "Diego Mora", "Elena Paz", "Felipe Gil", "Gina Rojas",
           "Hugo Vélez", "Irene Sosa", "Juan Galindo", "Karen Lara", "Luis Ortiz", "Marta León", "Nico Ríos",
           "Olga Cruz", "Pablo Mejía", "Rosa Nieto", "Sergio Pinto", "Tania Gómez", "Uriel Vega", "Vera Mesa",
           "Wendy Soto", "Ximena Paz", "Yesid Estupiñán", "Zoe Lara", "Alba Ríos"]
ses = []
for i, n in enumerate(nombres):
    d = random.randint(1, 50)
    ev = "Weimar Gil" if i % 3 else ("weimar gil " if i % 2 else "Laura M.")
    lvls = random.choice([[5, 4, 4], [4, 3, 4], [4, 4, 5], [2, 3, 4], [5, 5]])
    ses.append({"candidate": n, "evaluator": ev, "vacante": i % 4, "status": "issued", "semaforo": "verde",
                "started_at": hace(d, 30), "entrevista_at": hace(d, 29), "issued_at": hace(d, random.randint(2, 28)),
                "updated_at": hace(d), "ratings": lvls})
# Esta semana: dos informes de Weimar hoy y ayer (racha).
ses.append({"candidate": "Quique Hoy", "evaluator": "Weimar Gil", "vacante": 0, "status": "issued", "semaforo": "verde",
            "started_at": hace(0, 8), "entrevista_at": hace(0, 7), "issued_at": hace(0, 1), "updated_at": hace(0, 1), "ratings": [5, 5, 4]})
# La quieta: dos informes viejos, nada en 14 días.
for i, n in enumerate(["Quieto Uno", "Quieto Dos"]):
    ses.append({"candidate": n, "evaluator": "Laura M.", "vacante": 4, "status": "issued", "semaforo": "verde",
                "started_at": hace(30 + i, 5), "entrevista_at": hace(30 + i, 4), "issued_at": hace(30 + i), "updated_at": hace(30 + i),
                "ratings": [5, 5, 4]})
# Pendientes, en distintos estados.
ses += [
    {"candidate": "Pendiente Calificar", "evaluator": "Weimar Gil", "vacante": 1, "status": "draft",
     "started_at": hace(0, 5), "entrevista_at": hace(0, 5), "transcript_at": hace(0, 2), "transcript_status": "lista",
     "transcript_analisis": {"por_requisito": []}, "updated_at": hace(0, 2)},
    {"candidate": "Pendiente Espera Vieja", "evaluator": "Weimar Gil", "vacante": 2, "status": "esperando",
     "started_at": hace(3), "entrevista_at": hace(3), "updated_at": hace(3)},
    {"candidate": "Pendiente Fallo", "evaluator": "Laura M.", "vacante": 1, "status": "draft",
     "started_at": hace(1), "entrevista_at": hace(1), "transcript_status": "error",
     "transcript_error": {"error": "ilegible"}, "updated_at": hace(1)},
    {"candidate": "Pendiente En Curso", "evaluator": "Laura M.", "vacante": 0, "status": "draft",
     "started_at": hace(0, 1), "updated_at": hace(0, 1)},
]
post("/api/__sembrar", {"vacantes": vac, "sesiones": ses})
TOTAL = len(ses)

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.on("dialog", lambda d: d.dismiss())

    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(900)
    pg.screenshot(path="/tmp/pk/tab_01_equipo.png", full_page=True)

    # ---------- Cola ----------
    cola = pg.inner_text("#colaList")
    for n in ["Pendiente Calificar", "Pendiente Espera Vieja", "Pendiente Fallo", "Pendiente En Curso"]:
        if n not in cola: errs.append(f"la cola no trae: {n}")
    if cola.find("Pendiente Fallo") > cola.find("Pendiente Calificar"):
        errs.append("en la cola, lo que falló no va primero")
    if "Calificar →" not in cola or "Pegar transcripción →" not in cola:
        errs.append("la cola no dice la acción de cada fila")
    if not pg.query_selector("#colaList .cwhen.viejo"):
        errs.append("la transcripción que lleva días esperando no se marca")
    if "Sergio Pinto" in cola:
        errs.append("la cola trae una verificación ya emitida")

    # ---------- Pulso de las vacantes ----------
    st0 = json.load(urllib.request.urlopen(B + "api/tablero"))
    rec = [p for p in st0["pulso"]["vacantes"] if p["reciente"]]
    titulos = [p["title"] for p in rec]
    if "Vacante Quieta" in titulos or "Analista BI" in titulos:
        errs.append(f"el pulso trae una vacante quieta o cerrada: {titulos}")
    if "Vacante Nueva" not in titulos or "Consultor SAP PP" not in titulos:
        errs.append(f"el pulso no trae la nueva o la movida: {titulos}")
    pl = pg.inner_text("#pulsoList")
    if "Vacante Quieta" in pl or "Analista BI" in pl:
        errs.append("en pantalla, el pulso muestra una vacante quieta o cerrada")
    en_pantalla = pg.eval_on_selector_all("#pulsoList .vrow .rowmain > b", "e => e.map(x => x.childNodes[0].textContent.trim())")
    if en_pantalla != titulos[:8]:
        errs.append(f"el pulso no sigue el orden del servidor: {en_pantalla} vs {titulos}")
    probs = pg.eval_on_selector_all("#pulsoList .vprob .tag", "e => e.map(x => x.textContent)")
    if len(probs) != len(en_pantalla) or not set(probs) <= {"ALTA", "MEDIA", "BAJA"}:
        errs.append(f"no todas las vacantes en movimiento traen su probabilidad: {probs}")
    ord_ = {"alta": 0, "media": 1, "baja": 2}
    if [ord_[p["probabilidad"]] for p in rec] != sorted(ord_[p["probabilidad"]] for p in rec):
        errs.append("el pulso no va de más a menos probable")
    sap = next(p for p in rec if p["title"] == "Consultor SAP PP")
    fila = pg.inner_text('#pulsoList .vac:has-text("Consultor SAP PP") .vcount')
    if str(sap["validados"]) not in fila:
        errs.append(f"el número de validados no coincide con el servidor: {fila!r} vs {sap['validados']}")
    res = pg.inner_text("#pulsoRes")
    if str(st0["pulso"]["resumen"]["recientes"]) not in res or "en movimiento" not in res:
        errs.append(f"el resumen del pulso no cuadra: {res!r}")
    if not pg.query_selector('#pulsoList .vac:has-text("Vacante Nueva") .pts.vacia'):
        errs.append("la vacante nueva sin candidatos no lo dice")
    pg.click('#pulsoList .vac:has-text("Consultor SAP PP") [data-vexp]'); pg.wait_for_timeout(250)
    vc = pg.inner_text('#pulsoList .vac:has-text("Consultor SAP PP") .vcands').lower()
    if "validados ·" not in vc or not pg.query_selector('#pulsoList .vcands [data-abrir]'):
        errs.append("desplegar una vacante del pulso no lista a sus candidatos validados")
    if "Meta de la semana" not in pg.inner_text("#metaCard"):
        errs.append("no está la meta de la semana")

    # ---------- Ver como Weimar (escrito de dos formas) ----------
    opciones = pg.eval_on_selector_all("#selEval option", "e => e.map(o => o.value)")
    if "Weimar Gil" not in opciones or len([o for o in opciones if "weimar" in o.lower()]) != 1:
        errs.append(f"el selector no agrupa al mismo evaluador escrito distinto: {opciones}")
    pg.select_option("#selEval", "Weimar Gil"); pg.wait_for_timeout(700)
    if "Hola, Weimar" not in pg.inner_text("#tabSaludo"):
        errs.append("no saluda al evaluador elegido")
    cola = pg.inner_text("#colaList")
    if "Pendiente Fallo" in cola or "Pendiente En Curso" in cola:
        errs.append("con 'ver como Weimar' la cola trae pendientes de Laura")
    if "🔥" not in pg.inner_text("#metaCard"):
        errs.append("la racha de Weimar (hoy) no aparece")
    st = json.load(urllib.request.urlopen(B + "api/tablero?evaluador=Weimar%20Gil"))
    if st["esta_semana"]["informes"] < 1 or st["racha"] < 1:
        errs.append(f"las estadísticas de Weimar no cuentan el informe de hoy: {st['esta_semana']} racha {st['racha']}")
    pg.screenshot(path="/tmp/pk/tab_02_weimar.png", full_page=True)
    pg.reload(); pg.wait_for_timeout(900)
    if pg.input_value("#selEval") != "Weimar Gil":
        errs.append("el 'ver como' no se recuerda al volver")

    # ---------- Meta ----------
    pg.click("#btnMeta"); pg.wait_for_timeout(250)
    pg.fill("#pgInput", "4"); pg.click("#pgSi"); pg.wait_for_timeout(300)
    if "de 4 informes" not in pg.inner_text("#metaCard"):
        errs.append("cambiar la meta no se refleja")

    # ---------- Vacantes ----------
    vl = pg.inner_text("#vacList")
    if "Analista BI" in vl:
        errs.append("una vacante cerrada aparece en el tablero por defecto")
    if "Vacante Quieta" not in vl or "Consultor SAP PP" in vl:
        errs.append("por defecto, la lista de vacantes no deja solo las que no están en el pulso")
    pg.fill("#qVac", "sap"); pg.wait_for_timeout(200)
    if "Consultor SAP PP" not in pg.inner_text("#vacList"):
        errs.append("buscar desde 'Sin movimiento' no encuentra una vacante en movimiento")
    pg.fill("#qVac", ""); pg.wait_for_timeout(150)
    pg.click('#segVac [data-fv="cerradas"]'); pg.wait_for_timeout(200)
    if "Analista BI" not in pg.inner_text("#vacList"):
        errs.append("el filtro 'Cerradas' no muestra la vacante cerrada")
    pg.click('#segVac [data-fv="activas"]'); pg.wait_for_timeout(200)
    pg.fill("#qVac", "movizzon"); pg.wait_for_timeout(200)
    vl = pg.inner_text("#vacList")
    if "Data Engineer" not in vl or "Consultor SAP PP" in vl:
        errs.append("el buscador de vacantes no filtra por empresa")
    if not pg.query_selector("#vacList .pt"):
        errs.append("las vacantes no muestran un punto por candidato")
    pg.click("#vacList [data-vexp]"); pg.wait_for_timeout(250)
    if not pg.query_selector("#vacList .vcands [data-abrir]"):
        errs.append("desplegar una vacante no muestra sus candidatos")
    pg.fill("#qVac", ""); pg.wait_for_timeout(200)

    # ---------- Sin movimiento, y cerrar/reabrir desde el tablero ----------
    pg.click('#segVac [data-fv="quietas"]'); pg.wait_for_timeout(200)
    vl = pg.inner_text("#vacList")
    if "Vacante Quieta" not in vl or "Consultor SAP PP" in vl:
        errs.append(f"el filtro 'Sin movimiento' no deja solo las quietas: {vl[:200]!r}")
    pg.click('#vacList .vac:has-text("Vacante Quieta") [data-vestado]'); pg.wait_for_timeout(900)
    if pg.query_selector('#vacList .vac:has-text("Vacante Quieta")'):
        errs.append("cerrar desde el tablero no la saca de la lista")
    if not pg.evaluate("() => TB.vs.some(v => v.title === 'Vacante Quieta' && v.status === 'cerrada')"):
        errs.append("cerrar desde el tablero no quedó guardado en el servidor")
    pg.click('#segVac [data-fv="cerradas"]'); pg.wait_for_timeout(200)
    pg.click('#vacList .vac:has-text("Vacante Quieta") [data-vestado]'); pg.wait_for_timeout(900)
    if pg.query_selector('#vacList .vac:has-text("Vacante Quieta")'):
        errs.append("reabrir desde el tablero no la saca de 'Cerradas'")
    pg.click('#segVac [data-fv="activas"]'); pg.wait_for_timeout(200)
    if "Vacante Quieta" not in pg.inner_text("#vacList"):
        errs.append("la vacante reabierta no vuelve a 'Activas'")
    if pg.screenshot(path="/tmp/pk/tab_03_pulso.png", full_page=True) is None: pass

    # ---------- Candidatos en la pantalla de la vacante ----------
    pg.click('#pulsoList .vrow:has-text("Consultor SAP PP")'); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    vc = pg.inner_text("#vacCands")
    vl_ = vc.lower()
    if "Quique Hoy" not in vc or "Pendiente En Curso" not in vc or "validados ·" not in vl_ or "en proceso ·" not in vl_:
        errs.append(f"la pantalla de la vacante no lista a sus candidatos por grupo: {vc[:300]!r}")
    if vl_.find("validados ·") > vl_.find("en proceso ·"):
        errs.append("en la vacante, los validados no van primero")
    if not pg.query_selector("#vacCands .vprob .tag") or "para la terna" not in vc and "terna +" not in vc:
        errs.append("la pantalla de la vacante no muestra la probabilidad y la terna")
    pg.screenshot(path="/tmp/pk/tab_04_vacante.png", full_page=True)
    pg.click('#vacCands [data-abrir]:has-text("Quique Hoy")'); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(300)
    if "Quique Hoy" not in pg.inner_text("#actaStage"):
        errs.append("abrir un candidato desde la vacante no abre su informe")
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(800)

    # ---------- Lista de verificaciones ----------
    pg.select_option("#selEval", ""); pg.wait_for_timeout(600)
    n = pg.eval_on_selector_all("#sesList [data-ses]", "e => e.length")
    if n != 25:
        errs.append(f"la lista no pagina de a 25 (muestra {n} de {TOTAL})")
    if pg.is_hidden("#btnMasSes"):
        errs.append("no está el botón 'ver más'")
    else:
        pg.click("#btnMasSes"); pg.wait_for_timeout(200)
        if pg.eval_on_selector_all("#sesList [data-ses]", "e => e.length") != TOTAL:
            errs.append("'ver más' no trae el resto")
    pg.fill("#qSes", "galindo"); pg.wait_for_timeout(200)
    if pg.eval_on_selector_all("#sesList [data-ses]", "e => e.length") != 1 or "Juan Galindo" not in pg.inner_text("#sesList"):
        errs.append("el buscador no encuentra por apellido")
    codigo = pg.evaluate("() => TB.ss.find(s => s.candidate === 'Juan Galindo').report_code")
    pg.fill("#qSes", codigo); pg.wait_for_timeout(200)
    if "Juan Galindo" not in pg.inner_text("#sesList"):
        errs.append("el buscador no encuentra por código PKV")
    pg.fill("#qSes", ""); pg.click('#segSes [data-fs="pendientes"]'); pg.wait_for_timeout(200)
    if pg.eval_on_selector_all("#sesList [data-ses]", "e => e.length") != 4:
        errs.append("el filtro 'Pendientes' no deja solo las 4 pendientes")
    if not pg.query_selector('#segSes [data-fs="todas"]'):
        errs.append("falta el filtro 'Todas'")
    pg.click('#segSes [data-fs="todas"]'); pg.wait_for_timeout(200)
    if not pg.query_selector("#sesList .res3"):
        errs.append("las emitidas no muestran cuántos requisitos cumplió")

    # ---------- Abrir desde la cola ----------
    pg.click('#colaList [data-abrir]:has-text("Pendiente Calificar")'); pg.wait_for_selector("#vActa.on", timeout=9000); pg.wait_for_timeout(300)
    if "Pendiente Calificar" not in pg.inner_text("#actaStage"):
        errs.append("abrir una fila de la cola no abre esa verificación")

    # ---------- Cerrar una vacante desde su pantalla ----------
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(700)
    pg.click('#pulsoList .vrow:has-text("Head of Infrastructure")'); pg.wait_for_selector("#vVacante.on", timeout=9000); pg.wait_for_timeout(300)
    pg.click("#btnEstadoVac"); pg.wait_for_timeout(250)
    pg.click("#pgSi"); pg.wait_for_timeout(700)
    if "Reabrir vacante" not in pg.inner_text("#btnEstadoVac"):
        errs.append("cerrar la vacante no cambió el botón a 'Reabrir'")
    pg.click("#vacStage [data-home]"); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(600)
    pg.click('#segVac [data-fv="activas"]'); pg.wait_for_timeout(200)
    if "Head of Infrastructure" in pg.inner_text("#vacList") or "Head of Infrastructure" in pg.inner_text("#pulsoList"):
        errs.append("la vacante cerrada sigue en el tablero")

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

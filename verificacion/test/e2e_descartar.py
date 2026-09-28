"""Descartar candidatos que no van a seguir en la verificación.

Lo que hay que sostener:
  · desde "Para hacer ahora", Descartar pide el motivo (sin motivo no deja) y el candidato sale
    de la cola, del conteo "en proceso" del pulso y de la lista "Todas";
  · queda en el filtro "Descartadas" con su motivo y se recupera de ahí;
  · en la pantalla de la vacante los descartados van aparte, plegados, y se recuperan;
  · un informe emitido no ofrece descartar;
  · dentro de una sesión en curso, "Descartar candidato" la guarda, la descarta y vuelve al tablero;
  · abrir un descartado pregunta si se recupera.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json
from datetime import datetime, timedelta, timezone

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, AQUI)
PORT = random.choice([p for p in range(3200, 3900) if p not in (3659,)])
B = f"http://127.0.0.1:{PORT}/verificacion/"
STUB = subprocess.Popen(["node", os.path.join(AQUI, "stub.js")], env={**os.environ, "PORT": str(PORT)},
                        stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT)
for _ in range(60):
    if STUB.poll() is not None: print("el stub murió al arrancar"); sys.exit(1)
    try: urllib.request.urlopen(B + "api/health", timeout=1); break
    except Exception: time.sleep(0.25)
else:
    print("el stub no respondió"); sys.exit(1)

def api(ruta, metodo="GET", cuerpo=None):
    r = urllib.request.Request(B + ruta, method=metodo, data=json.dumps(cuerpo).encode() if cuerpo is not None else None,
                               headers={"Content-Type": "application/json"})
    return json.load(urllib.request.urlopen(r))

AHORA = datetime.now(timezone.utc)
hace = lambda d=0, h=0: (AHORA - timedelta(days=d, hours=h)).isoformat().replace("+00:00", "Z")
api("api/__sembrar", "POST", {
    "vacantes": [{"title": "Data Engineer", "company_name": "Movizzon", "created_at": hace(3)}],
    "sesiones": [
        {"candidate": "Emitido Uno", "evaluator": "Weimar", "vacante": 0, "status": "issued", "semaforo": "verde",
         "started_at": hace(1, 5), "entrevista_at": hace(1, 5), "issued_at": hace(1), "updated_at": hace(1), "ratings": [5, 4]},
        {"candidate": "Nunca Llegó", "evaluator": "Weimar", "vacante": 0, "status": "esperando",
         "started_at": hace(2), "entrevista_at": hace(2), "updated_at": hace(2)},
        {"candidate": "Otro Pendiente", "evaluator": "Weimar", "vacante": 0, "status": "esperando",
         "started_at": hace(1), "entrevista_at": hace(1), "updated_at": hace(1)},
    ]})
vid = api("api/vacancies")[0]["id"]
en_proceso = lambda: next(p for p in api("api/tablero")["pulso"]["vacantes"] if p["id"] == vid)["en_proceso"]

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1240, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(700)
    if en_proceso() != 2: errs.append(f"al empezar, el pulso no tiene 2 en proceso: {en_proceso()}")

    # ---------- Desde la cola ----------
    pg.click('#colaList .crow:has-text("Nunca Llegó") [data-descartar]'); pg.wait_for_selector("#pregunta.on")
    if not pg.is_disabled("#pgSi"): errs.append("se puede descartar sin elegir el motivo")
    if pg.is_visible("#vActa.on") or pg.is_visible("#vLive.on"): errs.append("el botón Descartar abrió la verificación")
    pg.select_option("#pgSelect", "No se presentó a la entrevista")
    pg.fill("#pgInput", "no contestó el teléfono")
    pg.click("#pgSi"); pg.wait_for_timeout(900)
    if "Nunca Llegó" in pg.inner_text("#colaList"): errs.append("el descartado sigue en la cola")
    if en_proceso() != 1: errs.append(f"el descartado sigue contando en proceso en el pulso: {en_proceso()}")
    if "Nunca Llegó" in pg.inner_text("#sesList"): errs.append("el descartado sigue en la lista 'Todas'")
    pg.click('#segSes [data-fs="descartadas"]'); pg.wait_for_timeout(250)
    sl = pg.inner_text("#sesList")
    if "Nunca Llegó" not in sl or "No se presentó" not in sl or "DESCARTADO" not in sl:
        errs.append(f"'Descartadas' no lo muestra con su motivo: {sl[:200]!r}")
    if pg.query_selector('#sesList .row:has-text("Emitido Uno")'): errs.append("'Descartadas' trae un emitido")
    pg.screenshot(path="/tmp/pk/desc_01_lista.png", full_page=True)

    # Abrir un descartado pregunta si se recupera; cancelar no lo abre.
    pg.click('#sesList .row:has-text("Nunca Llegó") .rowmain'); pg.wait_for_selector("#pregunta.on")
    if "está descartado" not in pg.inner_text("#pgTitulo"): errs.append("abrir un descartado no pregunta si se recupera")
    pg.click("#pgNo"); pg.wait_for_timeout(300)
    if not pg.is_visible("#vTablero.on"): errs.append("cancelar la recuperación igual abrió la verificación")

    # Recuperar desde la lista
    pg.click('#sesList .row:has-text("Nunca Llegó") [data-recuperar]'); pg.wait_for_timeout(900)
    if "Nunca Llegó" not in pg.inner_text("#colaList"): errs.append("recuperar no lo devuelve a la cola")
    if en_proceso() != 2: errs.append("recuperar no lo devuelve al pulso")
    pg.click('#segSes [data-fs="todas"]'); pg.wait_for_timeout(200)
    if pg.query_selector('#sesList .row:has-text("Emitido Uno") [data-descartar]'): errs.append("un informe emitido ofrece Descartar")

    # ---------- En la pantalla de la vacante ----------
    sid = next(s["id"] for s in api("api/sessions") if s["candidate"] == "Otro Pendiente")
    api(f"api/sessions/{sid}/descartar", "POST", {"motivo": "Desistió o aceptó otra oferta"})
    pg.evaluate(f"() => verVacante({vid})"); pg.wait_for_selector("#vVacante.on"); pg.wait_for_timeout(400)
    vc = pg.inner_text("#vacCands")
    if "Descartados · 1".lower() not in vc.lower(): errs.append(f"la vacante no separa a los descartados: {vc[:250]!r}")
    if pg.is_visible('#vacCands .vdesc .row:has-text("Otro Pendiente")'): errs.append("los descartados no vienen plegados")
    pg.click("#vacCands .vdesc summary"); pg.wait_for_timeout(200)
    pg.click('#vacCands .row:has-text("Otro Pendiente") [data-recuperar]'); pg.wait_for_timeout(900)
    if "descartados" in pg.inner_text("#vacCands").lower(): errs.append("recuperar desde la vacante no lo saca de descartados")
    if pg.is_visible("#vActa.on") or pg.is_visible("#vLive.on"): errs.append("Recuperar en la vacante abrió la verificación")

    # ---------- Dentro de una sesión en curso ----------
    pg.click("#btnNuevaSesion"); pg.wait_for_timeout(250)
    pg.fill("#sCand", "Se Cayó En Vivo"); pg.fill("#sEval", "Weimar")
    pg.click("#btnIniciar"); pg.wait_for_selector("#vLive.on", timeout=9000); pg.wait_for_timeout(400)
    if not pg.is_visible("#btnDescartar"): errs.append("en la sesión no aparece 'Descartar candidato'")
    else:
        pg.click("#btnDescartar"); pg.wait_for_selector("#pregunta.on")
        pg.select_option("#pgSelect", "No cumple lo básico (se vio en la entrevista)"); pg.click("#pgSi")
        pg.wait_for_selector("#vTablero.on", timeout=9000); pg.wait_for_timeout(700)
        s = next(x for x in api("api/sessions") if x["candidate"] == "Se Cayó En Vivo")
        if s["estado_tablero"] != "descartado": errs.append("descartar desde la sesión no la descartó")
        if "Se Cayó En Vivo" in pg.inner_text("#colaList"): errs.append("el descartado en vivo quedó en la cola")
    pg.goto(B); pg.wait_for_timeout(600)
    if pg.is_visible("#vLive.on"): errs.append("al recargar, se retomó la sesión descartada")
    if pg.is_visible("#btnDescartar"): errs.append("'Descartar candidato' se ve en el tablero")

    br.close(); STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

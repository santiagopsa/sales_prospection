"""Indicadores de Wei: Headhunting y SaaS, y la respuesta del cliente en cada informe.

Lo que hay que sostener:
  · en cada informe emitido se anota qué hizo el cliente (entrevistó, contrató, no, no sabemos,
    no se le envió); se guarda sin abrir el informe y alimenta la calidad;
  · un enviado hace 3+ días sin respuesta aparece en "Para hacer ahora" para preguntar, y al
    anotar la respuesta sale de ahí;
  · Indicadores abre en Headhunting con los cuatro focos que calcula el servidor; la promesa
    de 48 h cuenta días hábiles y lista los procesos vencidos, que llevan a Procesos;
  · "Primer envío" se llena solo con el primer "Último envío", y una fecha imposible se rechaza;
  · la sección SaaS muestra sus focos; la de Verificación, los de siempre.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json
from datetime import datetime, timedelta, timezone, date

AQUI = os.path.dirname(os.path.abspath(__file__))
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
    try: return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e: return {"_status": e.code, **json.load(e)}

AHORA = datetime.now(timezone.utc)
HOY = (AHORA - timedelta(hours=5)).date()
iso = lambda d: d.isoformat().replace("+00:00", "Z")
hace = lambda d=0, h=0: iso(AHORA - timedelta(days=d, hours=h))
def habiles_atras(n):
    d = HOY; k = 0
    while k < n:
        d -= timedelta(days=1)
        if d.weekday() < 5: k += 1
    return d.isoformat()

api("api/__ops_semilla", "POST", {})
# Procesos con fechas conocidas para la promesa de 48 h.
vencido = api("api/ops/procesos", "POST", {"empresa": "Prueba 48h", "cargo": "Vencido sin envío", "etapa": "Reclutamiento", "activado": habiles_atras(5)})["fila"]
cumple = api("api/ops/procesos", "POST", {"empresa": "Prueba 48h", "cargo": "Cumplió", "etapa": "Reclutamiento", "activado": habiles_atras(3)})["fila"]
# Enviados: informes emitidos con distintas respuestas del cliente.
api("api/__sembrar", "POST", {
    "vacantes": [{"title": "Data Engineer", "company_name": "Movizzon", "created_at": hace(20)}],
    "sesiones": [
        {"candidate": f"Enviado {i}", "evaluator": "Weimar", "vacante": 0, "status": "issued", "semaforo": "verde",
         "started_at": hace(10 + i), "entrevista_at": hace(10 + i), "issued_at": hace(9 + i), "updated_at": hace(9 + i), "ratings": [5, 4],
         **({"cliente_resultado": r, "cliente_resultado_at": hace(5)} if r else {})}
        for i, r in enumerate(["Lo entrevistó", "Lo contrató", "No lo entrevistó", "No lo entrevistó", None])
    ] + [{"candidate": "Recién Enviado", "evaluator": "Weimar", "vacante": 0, "status": "issued", "semaforo": "verde",
          "started_at": hace(1), "entrevista_at": hace(1), "issued_at": hace(0, 3), "updated_at": hace(0, 3), "ratings": [5, 5]}]})

errs = []
with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1280, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(700)

    # ---------- Respuesta del cliente ----------
    cola = pg.inner_text("#colaList")
    if "Enviado 4" not in cola or "QUÉ DIJO EL CLIENTE" not in cola.upper():
        errs.append("el enviado hace días sin respuesta no aparece en la cola para preguntar")
    if "Recién Enviado" in cola:
        errs.append("un informe de hoy ya pide seguimiento")
    pg.select_option('#colaList .crow:has-text("Enviado 4") [data-cliente]', "Lo entrevistó"); pg.wait_for_timeout(700)
    if pg.is_visible("#vActa.on"): errs.append("anotar la respuesta abrió el informe")
    if "Enviado 4" in pg.inner_text("#colaList"): errs.append("al anotar la respuesta sigue en la cola")
    s4 = next(s for s in api("api/sessions") if s["candidate"] == "Enviado 4")
    if s4.get("cliente_resultado") != "Lo entrevistó": errs.append(f"la respuesta no se guardó: {s4.get('cliente_resultado')}")
    # Desde la lista de verificaciones
    pg.select_option('#sesList .row:has-text("Recién Enviado") [data-cliente]', "No se le envió"); pg.wait_for_timeout(600)
    if pg.is_visible("#vActa.on"): errs.append("la lista abrió el informe al anotar")
    r = api("api/sessions/%d/cliente" % next(s["id"] for s in api("api/sessions") if s["candidate"] == "Enviado 0"), "POST", {"resultado": "Otra cosa"})
    if r.get("_status") != 400: errs.append("una respuesta fuera de la lista se aceptó")

    # ---------- Primer envío y fechas imposibles ----------
    ult = habiles_atras(1)
    f = api(f"api/ops/procesos/{cumple['id']}", "PATCH", {"ultimo_envio": ult})["fila"]
    if f.get("primer_envio") != ult or f.get("primer_envio_habiles") != 2 or f.get("cumple_48") is not True:
        errs.append(f"el primer envío no se llenó solo o no cuenta días hábiles: {f.get('primer_envio')} {f.get('primer_envio_habiles')}")
    malo = api(f"api/ops/procesos/{cumple['id']}", "PATCH", {"ultima_terna": "2926-08-25"})
    if malo.get("_status") != 400: errs.append("aceptó una fecha del año 2926")
    antes = api(f"api/ops/procesos/{cumple['id']}", "PATCH", {"ultima_terna": "2020-01-01"})
    if antes.get("_status") != 400 or "anterior a la activación" not in antes.get("error", ""): errs.append(f"aceptó una terna anterior a la activación: {antes}")

    # ---------- Indicadores: Headhunting ----------
    pg.click('#topNav [data-nav="indicadores"]'); pg.wait_for_selector("#vIndicadores.on"); pg.wait_for_timeout(700)
    d = api("api/indicadores")["ops"]
    c = d["headhunting"]["calidad"]
    if not pg.query_selector('#segInd [data-sec="hh"].sel'): errs.append("Indicadores no abre en Headhunting")
    focos = pg.eval_on_selector_all(".ifoco", "e => e.map(x => x.innerText)")
    if len(focos) != 4: errs.append(f"Headhunting no tiene 4 focos: {len(focos)}")
    else:
        if c["tasa_entrevista"]["den"] != 5 or c["tasa_entrevista"]["num"] != 3:
            errs.append(f"la tasa de entrevista no cuenta bien: {c['tasa_entrevista']}")
        if f"{c['tasa_entrevista']['pct']}%" not in focos[0]: errs.append(f"el foco de calidad no muestra la tasa: {focos[0]!r}")
        if "48" not in focos[2].replace("2 días hábiles", "48") and "DÍAS HÁBILES" not in focos[2].upper(): errs.append("falta el foco de la promesa de 48 h")
    if c["enviados"] != 5: errs.append(f"'No se le envió' no se descuenta de los enviados: {c['enviados']}")
    pend = pg.inner_text("#indCuerpo .p48")
    if "Vencido sin envío" not in pend or "VENCIDO" not in pend: errs.append("el proceso vencido no aparece en la promesa de 48 h")
    if "Cumplió" in pend: errs.append("un proceso con primer envío sigue en la lista de 48 h")
    if "Sin tier" not in pg.inner_text("#indCuerpo") : errs.append("la tabla de tier no avisa de los procesos sin tier")
    pg.screenshot(path="/tmp/pk/ind_hh.png", full_page=True)
    pg.click('#indCuerpo [data-proceso="Vencido sin envío"]'); pg.wait_for_selector("#vOps.on", timeout=9000); pg.wait_for_timeout(700)
    if pg.eval_on_selector_all("#opsGrid tbody tr", "e => e.length") != 1 or "Vencido sin envío" not in pg.input_value("#opsGrid tbody tr [data-c='cargo']"):
        errs.append("el vencido no lleva a su fila en Procesos")
    if "sin primer candidato" not in pg.inner_text("#opsRes"): errs.append("Procesos no tiene la cifra de vencidos de 48 h")

    # ---------- SaaS y Verificación ----------
    pg.click('#topNav [data-nav="indicadores"]'); pg.wait_for_selector("#vIndicadores.on"); pg.wait_for_timeout(500)
    pg.click('#segInd [data-sec="saas"]'); pg.wait_for_timeout(300)
    t = pg.inner_text("#indCuerpo")
    if "alcanzan la meta" not in t.lower() or "vuelven a publicar" not in t.lower(): errs.append("SaaS no muestra sus focos")
    sq = d["saas"]["calidad"]["meta"]
    if sq["pct"] is None or f"{sq['pct']}%" not in t: errs.append(f"SaaS no muestra el % de meta del servidor: {sq}")
    pg.screenshot(path="/tmp/pk/ind_saas.png", full_page=True)
    pg.click('#segInd [data-sec="ver"]'); pg.wait_for_timeout(300)
    if "VACANTES VERIFICADAS" not in pg.inner_text("#indCuerpo").upper(): errs.append("la sección Verificación perdió sus focos")
    pg.reload(); pg.wait_for_timeout(500)
    pg.click('#topNav [data-nav="indicadores"]'); pg.wait_for_selector("#vIndicadores.on"); pg.wait_for_timeout(600)
    if not pg.query_selector('#segInd [data-sec="ver"].sel'): errs.append("la sección elegida no se recuerda")

    m = br.new_page(viewport={"width": 390, "height": 860})
    m.goto(B); m.wait_for_timeout(500)
    m.evaluate("() => { try{ localStorage.setItem('pkv_ind_sec','hh'); }catch(e){} }")
    m.click('#topNav [data-nav="indicadores"]'); m.wait_for_selector("#vIndicadores.on"); m.wait_for_timeout(700)
    if m.evaluate("document.documentElement.scrollWidth") > 390: errs.append("Headhunting en el teléfono tiene scroll horizontal")
    br.close(); STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

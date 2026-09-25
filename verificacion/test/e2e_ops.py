"""Operaciones: las tres pestañas que reemplazan a Airtable (Procesos completos, SaaS, Evaluaciones).

Lo que hay que sostener, con los datos reales importados de Airtable:
  · la barra lleva a cada pestaña y la marca; cada una trae sus filas y sus columnas;
  · una celda se guarda sola al salir, recalcula la salud en la misma fila y Enter baja a la
    siguiente fila en la misma columna;
  · lo que se llena solo: la fecha de cierre al cancelar, la fecha de meta al llegar a la meta;
  · el tier se aplica a todos los procesos de la empresa;
  · "Sin cambios" en SaaS cuenta como actualización del día;
  · un dato inválido no se guarda, se avisa y la celda vuelve a su valor;
  · las cifras de arriba filtran la tabla; crear y eliminar filas;
  · en el teléfono, la tabla se desplaza dentro de su caja y la página no.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request, json

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
    return json.load(urllib.request.urlopen(r))

sem = api("api/__ops_semilla", "POST", {})
errs = []
if sem.get("importadas") != {"procesos": 87, "saas": 212, "evaluaciones": 39}:
    errs.append(f"la semilla no entró completa: {sem}")

with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1360, "height": 1000})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))
    pg.goto(B); pg.wait_for_selector("#vTablero.on"); pg.wait_for_timeout(500)

    # ---------- Procesos ----------
    pg.click('#topNav [data-nav="procesos"]'); pg.wait_for_selector("#opsGrid table", timeout=9000); pg.wait_for_timeout(300)
    if not pg.query_selector('#topNav [data-nav="procesos"].on'):
        errs.append("la barra no marca 'Procesos'")
    if "Procesos completos" not in pg.inner_text("#opsTitulo"):
        errs.append("el título de la pestaña no es 'Procesos completos'")
    filas = api("api/ops/procesos")["filas"]
    abiertos = [f for f in filas if f["abierto"]]
    n = pg.eval_on_selector_all("#opsGrid tbody tr", "e => e.length")
    if n != len(abiertos):
        errs.append(f"'En curso' no muestra los {len(abiertos)} abiertos: {n}")
    heads = pg.inner_text("#opsGrid thead")
    for c in ["EMPRESA", "SALUD", "ETAPA", "FALTAN PARA LA TERNA", "TIER DEL CLIENTE", "CAUSA DE CIERRE", "DÍAS SIN MOVIMIENTO"]:
        if c not in heads.upper(): errs.append(f"falta la columna {c}")
    if "PRIORIDAD" in heads.upper():
        errs.append("sigue la columna 'Prioridad para el cliente'")
    pg.screenshot(path="/tmp/pk/ops_01_procesos.png", full_page=False)

    # Editar etapa → cancelar: fecha de cierre sola, fila pasa a cerrada, pide causa
    tr = pg.query_selector("#opsGrid tbody tr")
    pid = int(tr.get_attribute("data-id"))
    tr.query_selector('[data-c="etapa"]').select_option("Cancelado"); pg.wait_for_timeout(600)
    f = next(x for x in api("api/ops/procesos")["filas"] if x["id"] == pid)
    if f["etapa"] != "Cancelado" or not f["fecha_cierre"]:
        errs.append(f"cancelar no guardó la etapa o no puso la fecha de cierre: {f['etapa']} {f['fecha_cierre']}")
    if not pg.query_selector(f'#opsGrid tr[data-id="{pid}"].cerrada [data-k="causa_cierre"].falta'):
        errs.append("al cancelar no se marca que falta la causa de cierre")
    if pg.input_value(f'#opsGrid tr[data-id="{pid}"] [data-c="fecha_cierre"]') != f["fecha_cierre"]:
        errs.append("la fecha de cierre puesta por el servidor no aparece en la celda")

    # Tier por empresa
    somos = [x for x in filas if (x["empresa"] or "").lower() == "somos"]
    uno = next(x for x in somos if x["abierto"] and x["id"] != pid)
    pg.select_option(f'#opsGrid tr[data-id="{uno["id"]}"] [data-c="tier"]', "Bajo"); pg.wait_for_timeout(700)
    tiers = {x["tier"] for x in api("api/ops/procesos")["filas"] if (x["empresa"] or "").lower() == "somos"}
    if tiers != {"Bajo"}:
        errs.append(f"el tier no se aplicó a todos los procesos de Somos: {tiers}")

    # Validación: número negativo
    celda = f'#opsGrid tr[data-id="{uno["id"]}"] [data-c="faltan_terna"]'
    antes = pg.input_value(celda)
    pg.fill(celda, "-3"); pg.press(celda, "Tab"); pg.wait_for_timeout(600)
    if pg.input_value(celda) != antes:
        errs.append("un número inválido no volvió al valor anterior")
    if "No se guardó" not in pg.inner_text("#toast"):
        errs.append("un número inválido no avisa")

    # Cifra que filtra
    pg.click('#opsRes [data-extra="causa"]'); pg.wait_for_timeout(300)
    if pid not in [int(x) for x in pg.eval_on_selector_all("#opsGrid tbody tr", "e => e.map(r => r.dataset.id)")]:
        errs.append("la cifra 'sin causa' no muestra el proceso recién cancelado")
    pg.click('#opsAviso [data-extra=""]'); pg.wait_for_timeout(200)

    # Nuevo proceso de empresa conocida: hereda el tier
    pg.click("#btnOpsNuevo"); pg.wait_for_selector("#formOpsNuevo")
    pg.fill('#formOpsNuevo [name="empresa"]', "Somos"); pg.fill('#formOpsNuevo [name="cargo"]', "Cargo de prueba e2e")
    pg.click('#formOpsNuevo button[type="submit"]'); pg.wait_for_timeout(700)
    nuevo = next((x for x in api("api/ops/procesos")["filas"] if x["cargo"] == "Cargo de prueba e2e"), None)
    if not nuevo or nuevo["tier"] != "Bajo" or nuevo["etapa"] != "Reclutamiento":
        errs.append(f"el proceso nuevo no se creó bien: {nuevo}")
    elif not pg.query_selector(f'#opsGrid tr[data-id="{nuevo["id"]}"]'):
        errs.append("el proceso nuevo no aparece en la tabla")
    else:
        pg.click(f'#opsGrid tr[data-id="{nuevo["id"]}"] [data-accion="borrar"]'); pg.wait_for_timeout(250)
        pg.click("#pgSi"); pg.wait_for_timeout(600)
        if any(x["id"] == nuevo["id"] for x in api("api/ops/procesos")["filas"]):
            errs.append("eliminar no borró la fila")

    # ---------- SaaS ----------
    pg.click('#topNav [data-nav="saas"]'); pg.wait_for_selector('#opsTitulo:has-text("SaaS")', timeout=9000); pg.wait_for_timeout(400)
    heads = pg.inner_text("#opsGrid thead").upper()
    if "ACCOUNT" in heads or "OWNER" in heads or "CARGO" not in heads:
        errs.append("SaaS: no se quitaron AM/Owner o falta Cargo")
    n = pg.eval_on_selector_all("#opsGrid tbody tr", "e => e.length")
    if n != 44:
        errs.append(f"SaaS: 'Activas' no muestra las 44: {n}")
    fs = api("api/ops/saas")["filas"]
    # Una activa sin la meta: subir destacados hasta la meta la pone en verde y fecha la meta.
    s = next(x for x in fs if x["abierto"] and not x["meta_cumplida"] and x["meta"])
    celda = f'#opsGrid tr[data-id="{s["id"]}"] [data-c="destacados"]'
    pg.fill(celda, str(s["meta"])); pg.press(celda, "Enter"); pg.wait_for_timeout(700)
    s2 = next(x for x in api("api/ops/saas")["filas"] if x["id"] == s["id"])
    if not s2["meta_cumplida"] or not s2["meta_at"] or s2["salud"] != "verde":
        errs.append(f"llegar a la meta no la marcó cumplida ni puso la fecha: {s2['meta_at']} {s2['salud']}")
    if "BIEN" not in pg.inner_text(f'#opsGrid tr[data-id="{s["id"]}"] [data-calc="salud"]'):
        errs.append("la salud no se repintó en la fila")
    act = pg.evaluate("() => document.activeElement && document.activeElement.dataset.c")
    sig_id = pg.evaluate("() => document.activeElement.closest('tr') && +document.activeElement.closest('tr').dataset.id")
    if act != "destacados" or sig_id == s["id"]:
        errs.append("Enter no bajó a la misma columna de la fila siguiente")
    # Sin cambios
    otra = next(x for x in fs if x["abierto"] and x["id"] != s["id"] and (x["dias_sin_actualizar"] or 0) >= 1)
    pg.click(f'#opsGrid tr[data-id="{otra["id"]}"] [data-accion="revisado"]'); pg.wait_for_timeout(600)
    o2 = next(x for x in api("api/ops/saas")["filas"] if x["id"] == otra["id"])
    if o2["dias_sin_actualizar"] != 0:
        errs.append("'Sin cambios' no cuenta como actualización de hoy")
    pg.screenshot(path="/tmp/pk/ops_02_saas.png", full_page=False)

    # ---------- Evaluaciones ----------
    pg.click('#topNav [data-nav="evaluaciones"]'); pg.wait_for_selector('#opsTitulo:has-text("Evaluaciones")', timeout=9000); pg.wait_for_timeout(400)
    if "APROBADOS" not in pg.inner_text("#opsGrid thead").upper():
        errs.append("Evaluaciones: falta la columna Aprobados")
    fe = api("api/ops/evaluaciones")["filas"]
    e = next(x for x in fe if x["abierto"] and (x["evaluados"] or 0) >= 4)
    celda = f'#opsGrid tr[data-id="{e["id"]}"] [data-c="aprobados"]'
    pg.fill(celda, str(e["evaluados"] + 1)); pg.press(celda, "Tab"); pg.wait_for_timeout(600)
    if "mayor que evaluados" not in pg.inner_text("#toast"):
        errs.append("aprobados > evaluados no se rechaza con su mensaje")
    pg.fill(celda, str(e["evaluados"])); pg.press(celda, "Tab"); pg.wait_for_timeout(600)
    if "100%" not in pg.inner_text(f'#opsGrid tr[data-id="{e["id"]}"] [data-calc="pct_aprobacion"]'):
        errs.append("el % de aprobación no se calculó")
    pg.screenshot(path="/tmp/pk/ops_03_eval.png", full_page=False)

    # ---------- Teléfono ----------
    m = br.new_page(viewport={"width": 390, "height": 860})
    m.goto(B); m.wait_for_timeout(500)
    m.click('#topNav [data-nav="saas"]'); m.wait_for_selector("#opsGrid table", timeout=9000); m.wait_for_timeout(400)
    sw = m.evaluate("document.documentElement.scrollWidth")
    if sw > 390: errs.append(f"en el teléfono la página tiene scroll horizontal: {sw}px")
    m.screenshot(path="/tmp/pk/ops_04_movil.png", full_page=False)

    br.close()
    STUB.terminate()

print("ERRORES:", "; ".join(errs) if errs else "ninguno")
sys.exit(1 if errs else 0)

"""Cuando el análisis falla, la pantalla tiene que decir qué pasó y qué hacer.

Antes decía "No se pudo analizar: Claude devolvió JSON inválido" en un toast que se iba
solo. Ese mensaje tapaba dos fallas que se arreglan distinto —la respuesta se cortó por
longitud, o llegó envuelta en texto— y no dejaba nada en pantalla para actuar.
"""
from playwright.sync_api import sync_playwright
import sys, time, subprocess, os, random, urllib.request

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
BASE_TXT = ("Marcela: necesitamos un consultor SAP PP senior. Lo minimo es un rollout de PP en "
            "produccion. Tambien PP con MM y QM. Rechazamos dos que sabian la teoria. ") * 4


def analizar(pg, marca):
    pg.goto(B); pg.wait_for_timeout(500)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(250)
    pg.fill("#srcText", BASE_TXT + marca); pg.wait_for_timeout(200)
    pg.click("#btnAnalizar"); pg.wait_for_timeout(1600)


with sync_playwright() as pw:
    br = pw.chromium.launch(args=["--no-proxy-server"])
    pg = br.new_page(viewport={"width": 1120, "height": 900})
    pg.on("pageerror", lambda e: errs.append(f"JS: {e}"))

    # ---------- A. La respuesta se cortó por longitud ----------
    analizar(pg, " __TRUNCADO__")
    if not pg.is_visible("#intakeErr"):
        errs.append("no se muestra el aviso de error en pantalla")
    else:
        t = pg.inner_text("#intakeErr").lower()
        if "demasiado largo" not in t:
            errs.append(f"no nombra la causa real (longitud): {t[:90]!r}")
        if "texto más corto" not in t:
            errs.append("no dice qué hacer al respecto")
        if "json" in t:
            errs.append("le habla al usuario de JSON, que no le sirve de nada")
    if pg.is_visible("#vRevision.on"):
        errs.append("avanzó a la revisión pese al error")
    pg.screenshot(path="/tmp/pk/intake_err_truncado.png")

    # ---------- B. Llegó ilegible ----------
    analizar(pg, " __ILEGIBLE__")
    t = pg.inner_text("#intakeErr").lower()
    if "no se pudo extraer los requisitos" not in t:
        errs.append(f"el caso ilegible no se anuncia bien: {t[:90]!r}")
    if "vuelve a intentarlo" not in t:
        errs.append("no sugiere reintentar en el caso ilegible")
    if "demasiado largo" in t:
        errs.append("confunde el caso ilegible con el de longitud")

    # Lo que devolvió el modelo tiene que poder verse sin entrar al registro del servidor.
    det = pg.query_selector("#intakeErr details.crudo")
    if not det:
        errs.append("no se puede ver lo que devolvió Claude")
    else:
        if pg.is_visible("#intakeErr .crudo pre"):
            errs.append("el volcado crudo sale abierto y tapa el mensaje que importa")
        pg.click("#intakeErr .crudo summary"); pg.wait_for_timeout(300)
        crudo = pg.inner_text("#intakeErr .crudo pre")
        if "parece un contrato" not in crudo:
            errs.append(f"el volcado no trae la respuesta del modelo: {crudo[:80]!r}")
    pg.screenshot(path="/tmp/pk/intake_err_ilegible.png")

    # ---------- C. Un análisis bueno limpia el aviso y sigue de largo ----------
    analizar(pg, "")
    pg.wait_for_selector("#vRevision.on", timeout=15000)
    pg.goto(B); pg.wait_for_timeout(400)
    pg.click("#btnNuevoIntake"); pg.wait_for_timeout(250)
    if pg.is_visible("#intakeErr"):
        errs.append("el aviso de error quedó pegado después de un análisis bueno")

    pg.close()
    br.close()

STUB.terminate()
print("ERRORES:", "ninguno" if not errs else "")
for e in errs:
    print("  -", e)
sys.exit(1 if errs else 0)

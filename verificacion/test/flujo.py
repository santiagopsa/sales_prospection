"""Pasos compartidos por las pruebas de navegador.

Viven aquí porque el flujo de la sesión cambió de forma: la entrevista ya no se califica
mientras ocurre. Antes cada prueba repetía "marcar nivel, escribir evidencia, siguiente";
ahora hay dos momentos —recorrer la guía y, después de la transcripción, confirmar los
niveles— y repetir eso en seis archivos es garantía de que se desincronicen.
"""

# Una transcripción de mentira, pero con la forma de una real: turnos, nombres y suficiente
# largo para pasar el mínimo del servidor.
TRANSCRIPCION = (
    "Reclutador: cuentame de tu experiencia con este requisito.\n"
    "Candidato: en Alpina, entre marzo y noviembre de 2023, yo lleve el rollout. "
    "Lo que se nos cayo fue el maestro de materiales la primera semana del go-live, "
    "y me toco rehacer la carga con el equipo de datos.\n"
    "Reclutador: que transaccion usas para listas de materiales?\n"
    "Candidato: CS01 para crear, CS02 para modificar.\n"
) * 8


def recorrer_guia(pg, maximo=8):
    """Avanza por la guía de requisitos hasta el fin de la entrevista."""
    for _ in range(maximo):
        if "Terminaste la entrevista" in pg.inner_text("#stage"):
            return True
        pg.click("[data-next]")
        pg.wait_for_timeout(320)
    return "Terminaste la entrevista" in pg.inner_text("#stage")


def pegar_transcripcion(pg, texto=None):
    """Del fin de la entrevista a la pantalla de calificar, pasando por la transcripción."""
    pg.click("#btnATranscripcion")
    pg.wait_for_selector("#vTrans.on", timeout=9000)
    pg.wait_for_timeout(300)
    pg.fill("#transText", texto or TRANSCRIPCION)
    pg.wait_for_timeout(250)
    pg.click("#btnAnalizarTrans")
    pg.wait_for_selector("#vLive.on", timeout=20000)
    pg.wait_for_timeout(500)


def confirmar_niveles(pg, niveles=(5, 4), evidencias=None):
    """Confirma o corrige el nivel de cada requisito, como haría el evaluador."""
    ev = evidencias or [
        "Rollout en Alpina 2023, nueve meses, lideró listas de materiales.",
        "Explicó la integración con un caso propio y precisó los quiebres.",
    ]
    for i, n in enumerate(niveles):
        if not pg.query_selector(f'[data-lv="{n}"]'):
            break
        pg.click(f'[data-lv="{n}"]')
        pg.wait_for_timeout(120)
        caja = pg.query_selector("[data-notes]")
        if caja:
            pg.fill("[data-notes]", ev[i] if i < len(ev) else ev[-1])
        pg.wait_for_timeout(150)
        pg.click("[data-next]")
        pg.wait_for_timeout(350)


def entrevistar_y_calificar(pg, niveles=(5, 4), contexto=True):
    """La sesión completa: guía → transcripción → niveles confirmados → contexto."""
    recorrer_guia(pg)
    pegar_transcripcion(pg)
    confirmar_niveles(pg, niveles)
    if contexto:
        for _ in range(4):
            if pg.query_selector('[data-d="pretension"]'):
                break
            pg.click("[data-next]")
            pg.wait_for_timeout(350)
        if pg.query_selector('[data-d="pretension"]'):
            pg.fill('[data-d="pretension"]', "3.500.000 COP / mes")
            pg.fill('[data-d="disponibilidad"]', "2 semanas")
            pg.click('[data-rec="reserva"]')
            pg.wait_for_timeout(150)
            pg.fill('[data-r="texto"]', "El nucleo del cargo esta medido y sostenido con evidencia.")
            pg.wait_for_timeout(200)
            pg.click("[data-next]")
            pg.wait_for_timeout(500)

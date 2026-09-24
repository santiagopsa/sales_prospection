# SDR Coach (`/sdr`)

Módulo de prospección de Angie montado sobre el servidor del Sandler. Sus tablas viven en el schema `sdr`
de la misma base. No toca `deals`, `wishlist` ni `verificacion`, salvo para **crear** un deal cuando Angie
agenda una reunión. No tiene login: quien tenga el enlace `/sdr` opera todo (y puede llamar con cargo a la
cuenta de Voximplant: no compartas el enlace fuera del equipo).

Estado: fases 1 a 5 (leads, cola, resultados, etapas, llamadas desde el navegador, compromisos y calendario,
transcripción + métricas, evaluación con rúbrica, mejora semanal). Pendiente: calibración con 20 llamadas
puntuadas a mano (fase 6).

## Variables de entorno (Render)

| Variable | Para qué | De dónde sale |
|---|---|---|
| `DATABASE_URL` | La base (ya existe) | Render |
| `VOX_ACCOUNT` | Nombre de la cuenta de Voximplant | lo imprime `vox:setup` |
| `VOX_APP` | Aplicación (`sdr`) | `vox:setup` |
| `VOX_USER` | Usuario de Angie (`angie`) | `vox:setup` |
| `VOX_USER_PASSWORD` | Su contraseña; nunca sale del servidor | `vox:setup` (archivo `voximplant-render.env`) |
| `VOX_CALLER_ID` | Número que ve el prospecto, E.164 | `vox:setup` |
| `VOX_WEBHOOK_SECRET` | Firma del webhook del escenario | `vox:setup` |
| `PUBLIC_URL` | URL pública del servicio | `https://peaku-sandler.onrender.com` |
| `VOX_NODE` | Nodo de la cuenta (1–13); sin él el SDK no conecta | Dashboard de Voximplant → "Credentials for working with API, SDK, SIP" |
| `DEEPGRAM_API_KEY` | Transcripción de las llamadas con conversación | console.deepgram.com → API Keys |
| `ANTHROPIC_API_KEY` | Evaluación de las llamadas con la rúbrica (ya existe para el Sandler) | Render |
| `GOOGLE_CALENDAR_KEY_FILE` | Ruta al JSON de la cuenta de servicio (Secret File de Render: `/etc/secrets/google-calendar-key.json`) | Google Cloud → cuenta de servicio → clave JSON; delegación de dominio en el Admin de Workspace |

Sin las `VOX_*` todo funciona menos el botón **Llamar**, que aparece apagado con el motivo. Angie puede registrar
llamadas hechas por fuera mientras tanto.

## Poner Voximplant en marcha

1. En el panel de Voximplant: *Settings → Service accounts → Add*, rol **Owner**, *Generate key*. Guarda el JSON como
   `sdr/voximplant-key.json` (está en `.gitignore`).
2. En tu máquina, en la carpeta del repo:
   ```
   node sdr/cli.js vox:setup
   ```
   Crea (o reutiliza) la aplicación `sdr`, el usuario `angie`, el escenario `sdr-llamada`, la regla y amarra el
   número. Si la cuenta tiene más de un número, pásalo con `--numero +57…`. Imprime las variables y las deja en
   `sdr/voximplant-render.env` (también ignorado por git).
3. Pega las variables en Render → Environment, más `VOX_NODE` con el número de nodo que muestra el dashboard de Voximplant, y redespliega.
4. Abre un lead en `/sdr`, dale **Llamar**, acepta el micrófono. La primera llamada tarda unos segundos más (inicia sesión).

Volver a correr `vox:setup` conserva la contraseña y el secreto (los lee de `sdr/voximplant-render.env`), así que no hay que tocar Render; con `--rotar` genera nuevos y entonces sí hay que pegarlos otra vez.
Para cambiar el aviso de grabación o la voz: edita `AVISO_GRABACION` / `VOZ_AVISO` en `sdr/config.js`, corre
`vox:setup` (sube el escenario nuevo) y despliega. `node sdr/cli.js vox:escenario` muestra el escenario sin subirlo.

## Cómo funciona una llamada

Navegador (Web SDK, login con llave de un solo uso firmada por el servidor) → escenario VoxEngine → `callPSTN`
con `VOX_CALLER_ID` → al contestar se unen los audios y se graba en estéreo (sin aviso automático: Angie lo dice
ella misma; la franja de la llamada se lo recuerda con `RECORDATORIO_GRABACION`. `AVISO_GRABACION` vuelve a activarlo)
(prospecto izquierda, Angie derecha; ver `CANAL_ANGIE_EN_GRABACION`) → al colgar, Angie **tiene** que elegir un
resultado → el escenario manda un webhook a `/sdr/api/vox/webhook` con duración, estado y enlace de la grabación.
Resultado y webhook se unen por el `uuid` que genera el navegador, en cualquier orden.

La grabación queda en Voximplant (no hay storage propio). Su enlace aparece en el historial del lead.

**Qué oye y ve Angie mientras marca.** El escenario contesta el tramo de Angie de una vez, le dice "Marcando" y
le pasa el tono real del operador mientras timbra. Si el operador devuelve un código de
`LLAMADA_REINTENTAR_CODIGOS` (404 "no encuentra el número", 503…), vuelve a marcar hasta `LLAMADA_REINTENTOS`
veces con `LLAMADA_PAUSA_REINTENTO_S` de pausa, diciéndole "reintentando". Al rendirse, Angie **oye** el
motivo (`MENSAJES_LLAMADA`) y la ficha lo muestra con el código y los intentos, con tres salidas: **Volver a
marcar**, **Desde el celular sí entra: reportar** (queda en *Pipeline → Fallos de marcación* con el código,
para revisar la ruta con Voximplant) o **Número malo: sacar de la cola**. Un fallo del operador no abre el
diálogo de resultado: no es una marcación. Un 480/487 (timbró y no contestaron) o 486 (ocupado) sí lo abre.

**Deal en el Sandler.** Al agendar una reunión, el lead crea un deal (`canal_adquisicion = sdr_interno`) con la
ficha de Angie. En el Sandler, el detalle de ese deal muestra **Tomar este deal y hacer el demo**: la ejecutiva
entra al asistente con la ficha prellenada y, al guardar, se actualiza ese mismo deal (no se crea otro).

**Datos del lead.** En la ficha, *Editar* corrige empresa, contacto, cargo, ciudad, correo, teléfono principal
y un segundo teléfono (con su propio botón de llamar). Los teléfonos se normalizan igual que en la carga; si
el principal ya es de otro lead, lo dice. Cada edición queda en el historial.

## Transcripción y métricas (pipeline de audio)

Al colgar, dos cosas llegan en cualquier orden: el resultado que pone Angie y el webhook de Voximplant con la
grabación. Cuando están las dos, la llamada queda **pendiente** si el resultado es *conversación* o *reunión
agendada*, hay grabación y duró al menos `DURACION_MINIMA_PIPELINE_S` segundos contestados; si no, **omitida**.
Un trabajador dentro del servidor revisa cada `PIPELINE_INTERVALO_S` segundos y manda la grabación a **Deepgram**
(multicanal: el canal derecho es Angie, `CANAL_ANGIE_EN_GRABACION`), guarda los turnos con quién dijo qué y calcula
las métricas: proporción de habla, preguntas antes del pitch (`PALABRAS_PITCH`), monólogo más largo, velocidad,
muletillas (`PALABRAS_MULETILLA`), interrupciones. Sin `DEEPGRAM_API_KEY` las llamadas se acumulan en pendiente y
se procesan cuando la pongas. Falla `PIPELINE_REINTENTOS` veces → **error**.

Por diseño Angie no ve la transcripción llamada por llamada (roles en `VER_TRANSCRIPCION`): Luisa y Santiago la
ven en el historial del lead → *Ver transcripción y métricas*. Los números se recalculan sin volver a transcribir:

```
node sdr/cli.js pipeline --estado                     # cuántas hay por estado y los errores
node sdr/cli.js pipeline                              # transcribe las pendientes desde tu máquina (necesita DEEPGRAM_API_KEY)
node sdr/cli.js pipeline --call 12                    # reprocesa una llamada
node sdr/cli.js metricas --call 12                    # transcripción y métricas
node sdr/cli.js metricas --call 12 --set 'PALABRAS_PITCH=["peaku","ofrecemos"]'   # recalcula y guarda con otro hueco
```

Costo de referencia: Deepgram Nova cobra por minuto de audio; una llamada de 5 minutos en estéreo son 10 minutos
facturados (dos canales). Si la URL de la grabación no es pública, el pipeline descarga el audio y lo manda en bytes
(`PIPELINE_DESCARGAR_AUDIO` lo fuerza siempre).

## Evaluación con rúbrica y mejora semanal

Después de transcribir, cada llamada con conversación pasa por Claude con la **rúbrica activa** (`RUBRICA_ACTIVA`,
versiones en `sdr/rubrica/`; la v1 tiene 10 criterios de *Cold Calling Sucks*, *Fanatical Prospecting* y *The
Sales Development Playbook*). El evaluador devuelve JSON estricto por criterio: cumple / no cumple / no aplica,
**cita literal** (sin cita no se acepta un "no cumple": el validador lo descarta), confianza 0–1 y una nota
concreta; nunca consejo genérico. Se guarda en `sdr.evaluations` atado a la versión de la rúbrica, así una v2
no contamina las comparaciones. Estados del pipeline: transcrito → evaluando → evaluado (o error_evaluacion
tras `EVALUADOR_REINTENTOS`). Luisa y Santiago ven la evaluación en la página de la llamada; Angie no, por
diseño: ella recibe el semanal.

**Mejora de la semana** (vista *Semana*, para Angie): con las evaluaciones de la semana se calculan por
criterio cuántas llamadas fallaron de las que aplicaban. Un criterio es **hábito** solo si falla en
`HABITO_MIN_LLAMADAS` o más llamadas y en `HABITO_MIN_TASA` de las que aplicaban (una llamada mala no es un
hábito). El hábito que más pesa (`PESOS_CRITERIOS`: las palancas pesan 2) se propone como **foco** para
`FOCO_SEMANAS` semanas; Angie lo confirma desde la app (o elige otro criterio). Mientras el foco está activo, la
vista muestra la tasa inicial contra la de la semana; cuando vence, aparece como *foco anterior* con su
seguimiento y se propone el siguiente. También sale el **mejor momento** (la cita de Angie que más vale la
pena repetir, de la llamada con más criterios cumplidos) y lo que no falló. Los viernes a las
`INFORME_HORA` el servidor guarda una foto del informe (`sdr.informes_semana`) para el histórico.

```
node sdr/cli.js rubrica                          # la rúbrica activa con sus pesos
node sdr/cli.js evaluar --call 12                # evalúa (o reevalúa) una llamada transcrita
node sdr/cli.js mejora [--fecha 2026-09-25] [--usuario Angie]
node sdr/cli.js mejora --set HABITO_MIN_LLAMADAS=2 --set PESOS_CRITERIOS.no_monologo=3   # ver el efecto de mover un hueco
```

Cambiar la rúbrica: copia `sdr/rubrica/v1.js` como `v2.js`, edita, pon `RUBRICA_ACTIVA: 'v2'` y despliega; las
llamadas ya evaluadas conservan su v1. Costo de referencia: una llamada de 5 minutos son ~3–4 mil tokens de
entrada y ~500 de salida.

## Mover un hueco

Todos los huecos están en `sdr/config.js`, con un comentario de qué mueve cada uno. Antes de editar, puedes ver el
efecto con `--set`, que no guarda nada:

```
node sdr/cli.js secuencia --desde 2026-09-21 --set SALTAR_FINES_DE_SEMANA=false
node sdr/cli.js cola --set PRIORIDAD.porCanal.llamada=25
node sdr/cli.js importar archivo.csv            # simula la carga; --confirmar para cargar
node sdr/cli.js semana --set MOSTRAR_RATIOS=true    # resumen semanal con las tasas que la app oculta
node sdr/cli.js cola --set RACHA_CUMPLE_CON=cualquiera
```

`cola` e `importar` necesitan `DATABASE_URL`. Si el nombre del hueco tiene un error, el comando falla y lo dice.

## Archivos de leads
CSV (coma o punto y coma, UTF-8 o Windows-1252) o **.xlsx** (primera hoja). Se reconocen encabezados en español y
los de una exportación de **Apollo** tal cual: `First Name` + `Last Name` → contacto, `Title` → cargo,
`Company Name` → empresa (si falta, el lead se llama como el contacto), `Email`, teléfonos en orden
`Mobile Phone → Work Direct Phone → Corporate Phone → Company Phone → Other Phone → Home Phone` (el primero válido),
`City` o `Company City`, `Lists` → fuente. `Do Not Call = TRUE` deja la fila fuera. Industria, empleados, seniority,
país, LinkedIn, sitio web, keywords y tecnologías quedan en la ficha del lead. Los números que Excel guarda como
`3.016572696E9` se leen bien.

## Cola del día: por contactar y ya tocados hoy
Cada tarjeta dice la acción que toca (**Llamar**, **Enviar WhatsApp**, **Enviar correo**, **Mensaje por LinkedIn**), el
contexto del último toque ("Último: hoy 10:32 · No contestó") y el paso ("toque 2 de 9"). Los leads que ya
recibieron un toque hoy (llamó y no contestó, ya mandó el WhatsApp…) van en su propia sección **Ya tocados hoy**,
debajo, con su siguiente paso; los de arriba son los que faltan por contactar, en orden de prioridad.

## Compromisos y Google Calendar
Un compromiso es una tarea con fecha (y hora, si se pactó) que nace de una conversación, distinta de los toques
de la secuencia: **seguimiento** ("me dijo que lo llamara el jueves a las 3"), **enviar algo**, **reunión** (se crea
sola al agendar, para la ejecutiva, con Angie invitada) y **otra tarea** (con o sin lead). Se crean desde la cola
(**+ Compromiso**), desde la ficha (**Compromiso**) y desde el resultado de la llamada (**¿Quedaste en algo?**).
En la cola aparecen arriba, en **Compromisos de hoy**, por hora, con *Hecha*, *Mañana*, *Mover* y *Quitar*, y un
desplegable con los próximos días. Cada compromiso tiene dueño (`USUARIOS`); solo ve los suyos quien esté elegido
en la barra. Al descartar o pausar un lead se quitan también sus compromisos.

**Hecha registra el toque.** Si el compromiso es de un lead que sigue en manos de Angie, *Hecha* no solo cierra la
tarea: por **llamada** abre el mismo diálogo de resultado de cualquier llamada (cuenta en marcaciones y
conversaciones, mueve la etapa, queda en el historial); por **WhatsApp / correo / LinkedIn** registra el toque
por ese canal de una vez. La secuencia del lead no se consume (el compromiso es un extra pactado); si el lead ya
está con la ejecutiva o el compromiso no tiene lead, *Hecha* solo cierra la tarea. Antes esto no contaba, por eso
las llamadas de seguimiento no aparecían en los indicadores.

## Comisión por reuniones calificadas
Arriba de la cola, un panel verde con la **comisión del mes**: plata acumulada, cuántas calificadas lleva, la
escalera de tramos (se llena con las calificadas y, rayado, con las pendientes) y cuánto le falta para el
siguiente tramo. Clic → **Comisión** (también en la barra): los tres escalones con "Estás aquí", conteo del mes
(calificadas, por calificar, programadas, no cuentan), cuánto cerraría si califican las pendientes y la lista de
reuniones con su estado. Flechas para ver meses anteriores.

De dónde sale: cada reunión que la SDR agendó (toque *Reunión agendada*) y el deal que se creó en el Sandler
Coach. **Calificada** = la ejecutiva la tomó en el Sandler y quedó con calificación en
`COMISION.califica_con` (`Completa`). *Por calificar* = ya pasó y el deal no tiene calificación todavía.
*No calificó* = quedó Parcial o No califica. *No asistió* = la ejecutiva marcó no-show. Si la ejecutiva crea un
deal nuevo en vez de **Tomar este deal**, no queda enlazado y no cuenta: siempre tomar el del SDR.

Huecos en `COMISION` (`config.js`): `tramos` (desde / valor: 0 → 23, 20 → 30, 30 → 40), `modo` (`escalon`:
al llegar a un tramo todas las del mes pasan a ese valor; `tramos`: cada una a su tramo), `califica_con`,
`mes_por` (`reunion` o `agendada`). Una SDR ve lo suyo; la ejecutiva y el admin ven al equipo SDR.
```
node sdr/cli.js comision --mes 2026-09 --usuario Angie
node sdr/cli.js comision --mes 2026-09 --set COMISION.modo='"tramos"'
```

## Meta del día: marcaciones o reuniones
El día queda **cumplido** al llegar a `META_MARCACIONES_DIA` (o a conversaciones / cualquiera, según
`RACHA_CUMPLE_CON`), **o** al agendar `META_REUNIONES_DIA` reuniones (3) ese día, aunque falten marcaciones:
lo que importa al final son las reuniones. En la Semana el chip dice por qué ("cumplida · 3 reuniones"), en la
cola el panel *Hoy* muestra las reuniones del día contra esa meta, y la racha cuenta esos días igual.
`META_REUNIONES_DIA: null` apaga el criterio.

## Historial por día
**Historial** en la barra (también *Ver lo de hoy →* en la cola y el nombre de cada día en la tabla de la Semana)
abre un día: resumen (marcaciones, conversaciones, reuniones, WhatsApp/correo/LinkedIn, leads tocados) y cada
toque en orden con su lead, resultado, duración y nota; las conversaciones van resaltadas. Flechas para ir al día
anterior o siguiente. Los compromisos que se marcaron hechos ese día sin dejar toque (como pasaba antes del
arreglo de *Hecha*) salen en su propio bloque, para que la gestión no se pierda aunque no tenga resultado.
`GET /api/historial?fecha=YYYY-MM-DD&usuario=Angie`.

## Buscador y respuestas por otros canales
En la barra hay un buscador (atajo: tecla `/`): empresa, contacto, cargo, correo o teléfono, sin acentos ni
mayúsculas ("exito" encuentra "Grupo Éxito"; "313 470" encuentra +57 313 470 5454, también en el segundo
teléfono). Muestra etapa y último toque; *Enter* abre la primera ficha, flechas para moverse, *Esc* cierra.
Es para cuando alguien escribe por WhatsApp o correo y hay que llegar a su ficha en dos segundos.

En la ficha, **Me respondió** registra esa respuesta: se elige el canal (WhatsApp, correo, LinkedIn) y el
resultado (**conversación**, **reunión agendada** o **descartado**), con nota. Cuenta como conversación y mueve
la etapa igual que una llamada; los botones *WhatsApp enviado* / *Correo enviado* siguen siendo el envío normal.
Los resultados permitidos para una respuesta están en `RESPUESTAS_OTRO_CANAL` (`dominio.js`).

Con `GOOGLE_CALENDAR_KEY_FILE` y correo en `USUARIOS`, cada compromiso es un evento en el calendario del dueño
(se crea, se mueve y se borra con la tarea; aviso `CALENDARIO_AVISO_MIN` minutos antes; duración por tipo en
`CALENDARIO_DURACION_MIN`; tipos que se sincronizan en `CALENDARIO_TIPOS`). Los toques de secuencia no van al
calendario a propósito. Si Google falla, el compromiso queda igual y el error se ve en la tarjeta (📅!).

```
node sdr/cli.js calendario:probar --usuario Angie   # crea y borra un evento de prueba: confirma la delegación
```

Cómo se monta la cuenta de servicio (una vez): Google Cloud → proyecto → habilitar *Google Calendar API* → crear
cuenta de servicio sin roles → clave JSON (guardarla como `sdr/google-calendar-key.json`, ignorada por git) →
copiar su *ID único* → Admin de Workspace → Seguridad → Controles de API → Delegación de todo el dominio →
agregar el ID con el scope `https://www.googleapis.com/auth/calendar` → en Render, Secret File con el JSON y la
variable `GOOGLE_CALENDAR_KEY_FILE` apuntando a él.

## Sacar un lead de la cola: descartar, pausar, lista negra
Desde la cola (botón **Sacar** en la tarjeta), desde la ficha (**Sacar de la cola**) o como resultado
**Descartado** de una llamada. Siempre pide una razón cerrada y, según la razón, propone qué hacer:

- **Pausar N meses** (sin presupuesto, ya tiene proveedor, no le interesa, sin necesidad): se omiten los
  toques pendientes, el lead sale de la cola y queda **En pausa hasta** esa fecha; ese día vuelve solo con
  la `SECUENCIA_REINTENTO`. Los meses por razón están en `REINTENTO_POR_RAZON`; las opciones del diálogo en
  `OPCIONES_REINTENTO_MESES`. Angie puede cambiar la propuesta (incluido "No, descartar").
- **Descartar** (no es el decisor, otro, o cuando se elige "No, descartar"): definitivo, pero la ficha tiene
  **Reactivar**, que lo devuelve a la cola con la secuencia de reintento desde hoy.
- **Pidió que no lo contacten / número o correo equivocado**: definitivo, sin opción de reintento. El primero
  además mete el teléfono y el correo a la **lista negra**.

**Lista negra** (Pipeline → Lista negra): teléfonos, correos, **empresas** y **dominios** que no se vuelven a
tocar. Las cargas de leads dejan esas filas fuera y lo dicen en el informe (por teléfono, correo, empresa o
dominio del correo); **Marcar** rechaza el número; un lead en la lista no se puede reactivar hasta quitarlo de
ahí. Se agregan entradas a mano (con "Bloquear toda la empresa" veta la empresa completa, no solo ese contacto;
descarta los leads que coincidan con razón *En lista negra*) y se quitan con un clic. `limpiar --confirmar`
también la vacía.

La empresa se compara **normalizada**: sin acentos, minúsculas y sin sufijos legales (S.A.S., Ltda, Inc., y
letras sueltas al final), así "Grupo Éxito S.A.S." y "GRUPO EXITO SAS" son la misma. El dominio se saca del
correo o del sitio web (`https://www.exito.com` → `exito.com`).

**Cargar la base de lista negra de Peaku** (CSV o xlsx): botón **Cargar la base de lista negra** en esa misma
vista, o por consola:
```
node sdr/cli.js lista-negra lista.xlsx               # simula: qué entraría, qué ya estaba, qué leads se descartarían
node sdr/cli.js lista-negra lista.xlsx --confirmar   # carga de verdad
```
Reconoce columnas como `empresa` / `compañía` / `cliente`, `teléfono` / `celular`, `correo` / `email`,
`dominio` / `sitio web` / `web`, `motivo` / `nota`. Cada fila bloquea toda la empresa si trae empresa. Las
repetidas se saltan; siempre se puede simular primero y confirmar después.

## Usuarios
Sin credenciales: el desplegable de la barra (Angie, Luisa, Santiago; lista en `USUARIOS` de `config.js`) marca
quién hizo cada cosa y queda en el historial. La app no deja registrar nada sin elegir uno. Solo los toques del
rol `sdr` cuentan para marcaciones, conversaciones, bloques y racha; así las pruebas no ensucian los números.

## Borrar datos de prueba
```
node sdr/cli.js limpiar               # muestra cuánto hay
node sdr/cli.js limpiar --confirmar   # borra leads, tareas, toques, llamadas, cargas, lista negra y los deals que el SDR creó en el Sandler
```
Necesita `DATABASE_URL`. Lo más cómodo es correrlo desde la pestaña **Shell** del servicio en Render (ya tiene
la variable); desde tu máquina necesitas `npm install` (para `pg`) y la URL externa de la base.

## Pruebas
```
npm run test:sdr                                        # unitarias; las de base se saltan sin la variable
SDR_TEST_DATABASE_URL=postgres://... npm run test:sdr   # BORRA y recrea el schema sdr de esa base: nunca producción
```

## Desarrollo local sin el Sandler
```
DATABASE_URL=postgres://... node sdr/dev.js       # http://localhost:3100/sdr/
```

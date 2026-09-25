# PeakU · Consola de Verificación

Vive dentro del repo del Sandler Coach como un módulo montado en `/verificacion`. Comparte el web service de Render, el pool de Postgres y la API key de Anthropic; sus tablas viven en un **schema propio de Postgres** (`verificacion`), así que nunca se cruzan con `deals` ni `wishlist`.

Un servicio, una base de datos, dos productos.

---

## Qué hace

Convierte el **levantamiento de perfil** con el cliente en una **verificación auditable** del finalista.

El reclutador carga la transcripción de la reunión (o el job description). Claude extrae la empresa, la vacante y **hasta tres requisitos excluyentes** — y para cada uno construye el material con el que se verifica: qué debe poder narrar el candidato, tres detalles duros que solo conoce quien lo hizo de verdad, y las preguntas que se leen en voz alta. Extrae además el **perfil de conducta**: dos o tres rasgos que este cargo concreto necesita, cada uno con su pregunta. El reclutador revisa, corrige y guarda — puede cambiar todo eso después sin rehacer la vacante.

Después, para cada finalista, la app guía una sesión de 25 minutos contra esos mismos requisitos, con escalas ancladas 1-5, señales observables y un semáforo que **calcula el servidor, no el navegador**. Si la carpeta no está completa, no hay acta.

| # | Vista | Quién | Qué pasa |
|---|-------|-------|----------|
| 0 | Tablero | — | Vacantes y verificaciones recientes |
| 1 | Levantamiento | Reclutador | Sube el archivo o pega el texto |
| 2 | Análisis | Claude | Empresa, vacante, hasta 3 excluyentes y el perfil de conducta · 20-40 s |
| 3 | Revisión | Reclutador | Corrige lo que la IA no pilló y guarda |
| 4 | Vacante | — | Ficha con los requisitos y su material de verificación |
| 5 | Sesión | Reclutador | Apertura → un requisito por pantalla → trayectoria → contexto → cierre |
| 6 | Acta | — | Informe con firma de integridad, listo para PDF |

---

## Instalación

Desde la raíz del repo del Sandler, con la carpeta `verificacion/` ya adentro:

```bash
node verificacion/instalar.js
npm install
node server.js
# → http://localhost:3000/verificacion/
```

El instalador hace tres cambios, todos idempotentes (correrlo dos veces no repite nada):

1. **`server.js`** — monta el router justo antes del SPA fallback:
   ```js
   const verificacion = require('./verificacion/app');
   app.use('/verificacion', verificacion.router({ pool, anthropic, model: process.env.VERIF_MODEL || ANALYZE_MODEL }));
   verificacion.initSchema(pool).catch(e => console.error('[verificacion] schema:', e.message));
   ```
2. **`server.js`** — sube el límite del body de `4mb` a `12mb`. Los archivos viajan en base64, que engorda un tercio: sin este cambio, arrastrar un PDF de 5 MB falla con 413 justo después de soltarlo.
3. **`package.json`** — agrega `mammoth` y `pdf-parse`, para leer `.docx` y `.pdf`.

Deja `server.js.bak` con el original. Si algo no calza, no escribe nada y te imprime qué pegar a mano.

**En Render no hay que tocar nada:** mismo web service, mismo Postgres, misma `ANTHROPIC_API_KEY`. `render.yaml` tampoco cambia — el `buildCommand` ya es `npm install`, así que las dos dependencias nuevas entran solas. Al desplegar, `initSchema` crea el schema y las tablas la primera vez. El Sandler sigue en `/` y la verificación queda en `/verificacion/`.

Variables opcionales: `VERIF_MODEL` para usar un modelo distinto al del Sandler en el levantamiento, y `VERIF_SCHEMA` si algún día quieres mover las tablas a otro schema.

---

## Por qué un schema aparte y no un prefijo

El pool es compartido con el Sandler, así que **no se puede tocar `search_path`** — eso rompería sus consultas a `deals` y `wishlist`. Por eso cada consulta califica el schema explícitamente (`verificacion.vacancies`), desde `schema.js`, donde están todos los nombres en un solo lugar.

La ventaja concreta: nombres genéricos como `companies` o `sessions` no pueden chocar nunca con nada del Sandler, y puedes respaldar o borrar todo de una:

```bash
pg_dump -n verificacion "$DATABASE_URL" > verificacion.sql   # respaldo solo de este producto
```

---

## Esquema

```
verificacion.companies     id · name · sector · contact
verificacion.vacancies     id · company_id → companies · title · seniority · modality · city
                           salary_text/min/max · currency · context · urgency · recruiter
                           source_type · source_text · ai_raw (JSONB) · suggested_mode · status
verificacion.requirements  id · vacancy_id → vacancies · ord · text · kind · years
                           evidence_quote · criterio · detalles (JSONB) · q_escena · q_friccion
                           q_cruce · senales (JSONB)
verificacion.sessions      id · vacancy_id → vacancies · report_code · candidate · evaluator
                           mode (A|B) · status · semaforo · identity (JSONB) · signals (JSONB)
                           data (JSONB) · integrity_hash · started_at · issued_at
verificacion.ratings       id · session_id → sessions · requirement_id → requirements
                           req_text · ord · level (1-5) · verdict · evidence
```

`source_text` guarda la transcripción original y `ai_raw` la respuesta completa de Claude. Cuestan espacio, pero permiten reprocesar un levantamiento viejo con un prompt mejor sin volver a pedirle el archivo al cliente.

---

## Las reglas viven en `rules.js`

Aparte a propósito: son la parte que no puede fallar y la única con pruebas propias.

- **La regla del sujeto.** En todo lo que se imprime, el sujeto de la frase es el candidato o la evidencia — nunca la entrevista, el evaluador ni el tiempo disponible. "No se preguntó por las relaciones del modelo" y "su soltura con el modelado conviene validarla con una prueba corta" dicen el mismo hecho; la primera le cuenta al cliente que quien entrevistó no hizo su trabajo y le quita crédito a todo lo demás. El prompt de la transcripción trae la lista de frases prohibidas y `test/print_check.py` la verifica sobre el PDF: si una se cuela, la prueba falla.
- **Se verifica UN empleo: el más reciente declarado, y se decide antes de leer la transcripción.** La sesión dura 30 minutos; los empleos anteriores no se verifican ni van al informe. Pasó en producción que el análisis verificaba un empleo *anterior* sin relación con el cargo —porque ahí estaba el mejor caso de un requisito— y que dejaba sin verificar el último aunque se hubiera narrado. Ahora:
  - **Hay un ancla.** El tramo *Último empleo* existe siempre, en la entrevista y en la calificación. Con CV arranca con el primer empleo de la hoja de vida; sin CV, el reclutador lo anota cuando el candidato lo dice. La pregunta se lee literal y pide todo lo que exigen los criterios (*Cuéntame de tu trabajo más reciente, en X: qué cargo tenías y desde cuándo, qué era lo tuyo en el día a día, y una situación o un resultado concreto…*). La trayectoria completa queda plegada, como contexto.
  - **El ancla viaja al análisis** (`POST /transcript` con `empleo`; si no viene, la toma de la sesión o del primer tramo del CV) y el prompt verifica ese y ningún otro, con cuatro criterios fijos: C1 empresa, cargo y fechas que cuadran; C2 lo que hacía él; C3 una situación o resultado concreto de ese empleo; C4 nada contradice lo declarado.
  - **El servidor concilia antes de guardar** (`rules.js · conciliarEmpleo`): si el modelo habló de otra empresa, no se le cree —el declarado queda *no verificado* con el aviso—; si faltó C1, C2 o C3, no hay "verificada" aunque el modelo lo diga; si C4 falla, es *no coincide*.
  - **El reclutador decide.** En la calificación ve el criterio por criterio con las frases del candidato y marca *Verificada / No verificada / No coincide*; si la marca verificada, escribe el porqué que se imprime. El cierre avisa cuando queda sin verificar y lleva a ese tramo. En el informe solo hay dos resultados, *verificada* o *no verificada*, sin explicación.
  `test/e2e_empleo.py` recorre el empleo equivocado, el empleo del que no se habló, la corrección a mano y la contradicción; `rules.test.js` cubre la conciliación.
- **"Recomendación", no "por confirmar".** Una línea que decía *conviene confirmar X con una prueba* le preguntaba al cliente, en la práctica, por qué no lo confirmamos nosotros — y a esa altura ya no hay nada que hacer. Lo que queda es un consejo corto sobre cómo aprovechar el perfil, opcional, y vacío es lo normal. `print_check.py` falla si el PDF trae "por confirmar" o "conviene confirmar".
- **Cada pregunta lleva su criterio de validación, y el nivel se juzga contra eso.** Antes la rúbrica esperaba escena, fecha, alcance y fricción aunque la pregunta no las pidiera, y el candidato perdía nivel por no adivinar. Ahora el levantamiento produce, por cada pregunta, "se da por buena si…" (`c_escena`, `c_friccion`, `c_cruce`), con la regla de que el criterio solo puede exigir lo que la pregunta pide; el reclutador lo ve bajo la pregunta mientras entrevista y lo edita al lado de ella; y el análisis de la transcripción marca cada criterio como cumplido, parcial o no cumplido y saca el nivel de ahí. Lo que la pregunta no pidió no baja el nivel.
- **El porqué del nivel dice lo positivo y lo que faltó, en un solo párrafo.** "Por qué 4 y no 5" es lo primero que pregunta el cliente, y un párrafo de 55 palabras no lo contestaba. El análisis produce `demostro` (≤30 palabras) y `brecha` (≤25, vacía solo en 5), y el informe los imprime seguidos, sin rótulos —la brecha empieza con un conector natural—, con una barra de cinco tramos al lado y otra por requisito en el encabezado. Quien lo lee entiende por qué no llegó al nivel de arriba sin que el documento se lo deletree. **Regla de lo no pedido:** en la brecha solo entra lo que una pregunta o su criterio le pidió al candidato; lo que nadie le preguntó no se le reprocha ni le baja el nivel. Las actas anteriores siguen mostrando su párrafo: el snapshot no se reescribe.
- **Topes de largo, en el prompt.** 30 palabras para lo que demostró y 25 para la brecha, 35 por rasgo de conducta, 30 para el porqué de la experiencia, 12 por tarjeta, 8 para la aspiración. El informe es de una hoja, dos como máximo, y un párrafo largo no es más riguroso: es un párrafo que el cliente no lee.
- **La experiencia dice por qué quedó verificada**, no qué contó: decisiones propias, detalles consistentes entre sí y con lo declarado, alcance coherente con el cargo. Lo que contó ya está en los requisitos.
- **La conducta solo tiene dos resultados**: se evidenció o no se evidenció. No se explica el hueco: explicarlo es enseñar el guion.
- **El ancla de la rúbrica no se imprime.** "Ancla 4: escena y rol claros + 2/3 detalles verificables" es el criterio con el que trabajamos por dentro. El informe explica la escala una vez, en el idioma del cliente, y cuando no hay párrafo de analista cae a una frase por nivel (`NIVEL_CLIENTE`), nunca al ancla.
- **Máximo 3 requisitos excluyentes** (`MAX_REQ`). No es una preferencia de pantalla: la sesión dura 25 minutos y lo que se reparte entre los temas no es solo el tiempo sino la repregunta, que es donde se cae quien no hizo el trabajo. El levantamiento propone hasta 3, la revisión y la edición no dejan pasar de ahí, y el servidor devuelve `400` si alguien manda más por API. El **inglés no cuenta** contra el tope: no se pregunta, se escucha en un tramo aparte.
- **Las preguntas son completas y naturales, porque se leen literales.** El reclutador no reformula: lee. Así que cada pregunta pide con palabras todo lo que su criterio de validación va a exigir (empresa, época, qué hizo él, dos técnicas…) y suena a alguien hablando, con sus dos o tres partes hilvanadas de un tirón, no a formulario ni a examen. Las preguntas personalizadas del CV reemplazan a la genérica y heredan el mismo criterio, así que también lo piden. El prompt trae ejemplos buenos y malos, y `prompts.test.js` comprueba que la regla siga ahí.
- **Dos preguntas por requisito, tres como máximo.** Escena y fricción son obligatorias; el cruce solo se escribe cuando hay un hecho duro que separe a quien lo hizo de quien lo leyó. Si la vacante no trae cruce, la pantalla **no rellena** con una tercera: prefiere dos preguntas y seis minutos de seguimiento.
- **Semáforo.** Verde: cero señales. Amarillo: 1-2 señales, o un cotejo de rostro dudoso. Rojo: 3 o más señales, o —solo en un cierre— que el rostro verificado no corresponda al de la entrevista.
- **Sin carpeta completa no hay acta.** Cuatro condiciones: los cinco puntos de identidad marcados, cada requisito con su nivel **y con su porqué** —el párrafo que se imprime, más de 10 caracteres (`EV_MIN` en `public/app.js`)—, la verificación de identidad resuelta cuando es un cierre, y semáforo distinto de rojo. El botón de generar acta queda bloqueado hasta que se cumplan, y el servidor las vuelve a revisar en `/issue`: si algo falta devuelve `409` con la lista de razones, así que el navegador no puede saltárselo. Lo que se exige es lo que el cliente va a leer, no el rastro de auditoría: la evidencia textual (`evidence`) quedó plegada y opcional, y en el servidor basta con que exista el porqué **o** la evidencia.
- **Lo que falta se resuelve en el cierre, sin salir de la pantalla.** Pasó en producción: la transcripción propuso los niveles pero no dejó porqué en ninguno, y el reclutador quedó frente a un botón gris y un "Ir y completar" que lo mandaba a otra pantalla por cada requisito. Ahora la compuerta de requisitos muestra ahí mismo, por cada requisito incompleto, los cinco botones de nivel y el campo del porqué; al llenarlos la compuerta se abre sin repintar la pantalla (repintar al salir del campo hacía que el siguiente texto cayera en un elemento ya desmontado). Lo que se escribe ahí es lo que sale en el informe. `test/e2e_cierre_fix.py` cubre el caso del pantallazo.
- **Amarillo sí emite**, marcado como pendiente de cuatro ojos. Si prefieres que amarillo tampoco emita, es una línea en `bloqueos()`.
- **Firma de integridad.** SHA-256 sobre candidato, calificaciones, identidad y señales. Cambiar una calificación cambia la firma.
- **Corregir el nombre del candidato no se hace a escondidas.** Pasó: el reclutador escribió "Miguel", era Juan Galindo, y se dio cuenta con el acta emitida. El lápiz junto al nombre (barra de arriba, en sesión y en el acta) abre la corrección (`POST /api/sessions/:id/candidato`). En una sesión en curso solo cambia el nombre. En un acta emitida cambia el nombre del snapshot, **vuelve a firmar** el documento corregido y anota la corrección (campo, antes, después, cuándo), que el informe imprime al pie: *Corregido el 11 de septiembre de 2026: nombre del candidato*. El PDF anterior deja de corresponder a la firma vigente, que es lo correcto porque estaba mal. Nada más del documento congelado se toca. `test/correccion.test.js` (ruta real) y `test/e2e_nombre.py` lo cubren.

---

## Pruebas

```bash
node verificacion/test/rules.test.js       # 38 pruebas de las reglas, sin dependencias
node verificacion/test/assets.test.js      # que el versionado de estáticos siga enganchado
node verificacion/test/json_llm.test.js    # leer el JSON del modelo venga como venga
node verificacion/test/llm.test.js         # pedirJson contra un cliente falso, sin gastar tokens
node verificacion/test/prompts.test.js     # que el prompt lleve de verdad el texto que dice analizar
python3 verificacion/test/e2e.py           # flujo completo en navegador, contra test/stub.js
python3 verificacion/test/e2e_identidad.py # sondeo, cierre verificado, negativa y rostro que no corresponde
python3 verificacion/test/e2e_historial.py # abrir una verificación anterior y retomar una a medias
python3 verificacion/test/e2e_cv.py        # con CV: preguntas del candidato, trayectoria y acta
python3 verificacion/test/qr_verify.py     # decodifica los QR desde cero y comprueba el Reed-Solomon
python3 verificacion/test/e2e_qr.py        # los dos QR, escaneados desde el DOM real
python3 verificacion/test/e2e_qr_pixeles.py # el QR rasterizado, a 100%, 125%, 150% y 200%
python3 verificacion/test/e2e_viejas.py    # que un informe ya emitido no cambie de contenido
python3 verificacion/test/e2e_editar.py    # editar una vacante sin tocar las actas ya emitidas
python3 verificacion/test/e2e_intake_error.py # que un análisis fallido diga qué pasó y qué hacer
python3 verificacion/test/e2e_transcripcion.py # entrevistar sin escribir, calificar con la transcripción
python3 verificacion/test/e2e_ingles.py    # el inglés se mide escuchando, no preguntando
python3 verificacion/test/e2e_perfil.py    # tope de 3 requisitos, dos preguntas y el perfil de conducta
python3 verificacion/test/print_check.py   # el PDF que recibe el cliente, en los 4 casos reales
python3 verificacion/test/e2e_paralelo.py  # el análisis en segundo plano: pegar, irse, seguir con otro
python3 verificacion/test/e2e_salir.py     # salir de la sesión nunca se queda pegado, ni con el servidor caído
python3 verificacion/test/e2e_idioma.py    # el informe en español o en inglés: emitir, alternar, reabrir, PDF
python3 verificacion/test/e2e_una_hoja.py  # el caso de José cabe en UNA hoja de Oficio; mide cada bloque
python3 verificacion/test/e2e_criterios.py # criterio por pregunta; demostró / para llegar a N; barras
node verificacion/test/traduccion.test.js  # la ruta de traducción REAL con un modelo de mentira (express doblado)
node verificacion/test/correccion.test.js  # corregir el nombre: en borrador cambia; emitida, vuelve a firmar y anota
python3 verificacion/test/e2e_nombre.py    # el lápiz junto al nombre, en sesión y sobre el acta
python3 verificacion/test/e2e_empleo.py    # se verifica el último empleo declarado y no otro
python3 verificacion/test/e2e_tablero.py   # la cola, la meta, los indicadores, las vacantes y el buscador
```

Y una herramienta que no afirma nada, solo deja mirar el resultado — capturas de cada pantalla y el PDF del informe:

```bash
SALIDA=~/Escritorio/informe python3 verificacion/test/shot_inf.py
```

`test/stub.js` replica la API con `http` nativo y devuelve un levantamiento fijo en vez de llamar a Claude: prueba la interfaz sin API key, sin Postgres y sin `npm install`. Importa las reglas reales de `rules.js` y se monta en `/verificacion`, igual que en producción — así que lo que se prueba del semáforo, del acta y del punto de montaje es el código de verdad.

Lo que esas pruebas **no** cubren es la capa de Express real (el Router montado, los estáticos, el redirect al slash). Eso se verifica en un minuto al arrancar:

```bash
node server.js
curl -s localhost:3000/api/health               # el Sandler sigue vivo
curl -s localhost:3000/verificacion/api/health  # {"ok":true,"app":"verificacion","build":"…","db":true,...}
curl -sI localhost:3000/verificacion | head -1  # 301 hacia /verificacion/
```

---

## El informe y su verificación pública

El informe es a la vez el acta de verificación y el documento con el que se presenta al candidato. Eso no es una concesión: lo que hace vendible a un candidato es exactamente lo que quedó verificado, y tener dos documentos separados invita a que el bonito diga cosas que el riguroso no sostiene.

Va a dos columnas, formato `v4-2026-09`:

- **Encabezado** en dos columnas: a la izquierda el nombre, el cargo, el cliente y una bajada que es un conteo, no un adjetivo (*de los 3 requisitos que definió el cliente, 2 quedaron sostenidos con evidencia de una entrevista en vivo*); a la derecha los datos del informe y el resumen gráfico, una barra de cinco por requisito y, si el cargo lo pide, la del inglés.
- **Cómo se verificó** — cuatro celdas justo debajo del encabezado: entrevista en vivo (30 min, grabada y supervisada), identidad verificada (o bitácora archivada, en un sondeo), contrastado en conversación con casos propios —no con la hoja de vida—, y señales de asistencia. Es lo primero que se lee después del nombre porque es lo que distingue este informe de una lectura del CV: quien lo recibe tiene que saber que hubo una conversación real, con la identidad verificada, antes de leer un solo resultado.
- **Cinta de datos** — ubicación, disponibilidad, pretensión, otros procesos. Un chip solo aparece si el dato se recogió: un rótulo con nada detrás le dice al cliente que no preguntamos.
- **Posicionamiento** — el párrafo del evaluador, arriba, donde se lee primero.
- **Columna ancha · Ajuste al rol** — cada requisito con su barra, **un párrafo** con lo que el candidato demostró y, si aplica, si aplica, una *Recomendación* corta sobre cómo aprovechar el perfil. La escala se explica una sola vez al pie de la sección.
- **Conducta** — los rasgos que el cargo pedía y qué se evidenció de cada uno. Un rasgo sin evidencia sale como *sin evidencia*, sin explicación.
- **Integridad** — identidad con el puntaje de cotejo, *señales de asistencia por IA o fuente externa*, y la bitácora de la sesión (la transcripción archivada).
- **Columna angosta · Lo que demostró** — tarjetas con lo que sostuvo en la conversación. Salen de la transcripción, **no del CV**: el CV lo escribió el candidato, la conversación la sostuvo delante de un evaluador.
- **Inglés** — cuando el cargo lo pide, es una fila más de *Ajuste al rol*, con su barra (A1=1 … C1=5) y el veredicto contra el nivel exigido si este trae letra; y aparece también en el resumen gráfico del encabezado. Antes era una columna al pie y se perdía. Si no se evaluó, la fila lo dice.
- **Experiencia** — el empleo más reciente, con su veredicto y un párrafo de lo que el candidato narró.
- **Factores de cierre** — qué lo mueve, sus no negociables, las condiciones declaradas, y al lado la recomendación con sus riesgos y mitigación. Lo único del informe que es opinión, y va firmado. El texto lo escribe el evaluador a mano, así que la pantalla le recuerda ahí mismo la regla del sujeto.

El contexto y la recomendación se llenan en la fase **Contexto**; la conducta y las tarjetas, en la fase **Conducta**, después de leer la transcripción.

**Ojo con el formato.** El snapshot congela los *datos* de un informe emitido, que es lo que promete la firma de integridad. La maqueta no: un informe emitido bajo `v3-2026-08` se vuelve a dibujar con la de `v4`, con su mismo contenido. Si mañana hace falta que un informe viejo se vea exactamente como el día que se entregó, hay que guardar también el HTML, no solo los datos.

### El informe en español o en inglés

El reclutador elige el idioma en el cierre (selector **Español / English**, español por defecto) y puede cambiarlo después desde el informe emitido, con el botón *Ver en English / Ver en español*. El PDF sale en el idioma que se está viendo, con el título y el membrete en ese idioma.

Cómo está hecho, porque importa para no romperlo:

- **El snapshot sigue siendo uno y en español.** Lo que se congela al emitir no cambia. La traducción es una capa encima: `sessions.traducciones` guarda `{en:{textos, huella, at}}` y `sessions.idioma` recuerda en cuál se dejó.
- **Dos clases de texto.** Los **rótulos fijos** (títulos de sección, niveles CUMPLE/MEETS, sellos, fechas, la garantía, el pie) viven en la pantalla, en `ROTULOS` de `public/app.js`, en los dos idiomas. El **contenido** (requisitos, párrafos del análisis, cargo, rasgos de conducta, impacto, riesgos, lo declarado) lo traduce Claude una sola vez: `textosDelInforme()` arma un objeto plano `{clave: texto}` con exactamente lo que se imprime, `POST /api/sessions/:id/traduccion` lo manda con `buildTranslatePrompt` y guarda la respuesta. Al dibujar, `tx(clave, original)` devuelve la traducción si el informe está en inglés y el original si no.
- **Lo que no se traduce:** nombres de personas y empresas, productos y tecnologías, cifras, monedas, niveles A1…C1. Está en el prompt, y `prompts.test.js` comprueba que siga estando.
- **La respuesta del modelo se lee en `out.datos`**, que es lo que devuelve `pedirJson`. Leerla directo dejaba los rótulos en inglés y el contenido en español sin ningún error: por eso `test/traduccion.test.js` monta la ruta real con express doblado y un modelo de mentira. Al modelo se le manda una lista `{id, es}` y se le pide `{traducciones:[{id, en}]}`: las claves con puntos (`req.0.cuerpo`) en un objeto invitaban a anidarlas; `leerTraduccion()` acepta de todos modos lista, objeto plano u objeto anidado, y si vuelve menos de la mitad es un 502, no un informe a medias.
- **Nunca un documento a medias.** Si la traducción falla, el informe se queda en español y se avisa. Si el modelo devuelve una clave vacía, esa frase sale en español antes que en blanco. La traducción se reutiliza mientras los textos no cambien (huella), así que alternar idiomas o reabrir no vuelve a pagar tokens.
- **La página pública de verificación** (`/verificacion/v/:code`) sigue en español: certifica que el informe existe, no lo reproduce.

`test/e2e_idioma.py` recorre emitir en inglés, comprobar que no se cuela español ni se pierde un nombre propio, alternar sin volver a traducir, reabrir en el idioma en que se dejó, el PDF en inglés en dos hojas, y una traducción que falla.

### Salir de la sesión nunca se queda pegado

Pasó en producción: "Salir de la sesión" no hacía nada. Dos causas, y se cerraron las dos.

- **La pregunta ya no es un `confirm()` del navegador.** Chrome deja de mostrar los diálogos de una página cuando el usuario marcó "no permitir más" —y una entrevista larga con varios avisos invita a marcarlo—; desde ese momento `confirm()` devuelve `false` en silencio y el botón parece muerto. La pregunta ahora es un cuadro propio (`#pregunta`), que no depende de nada del navegador. Un acta ya emitida sale sin preguntar: no tiene nada que perder.
- **Guardar tiene tope de tiempo.** `flush()` esperaba al servidor sin límite; si Postgres no tenía conexiones libres o Render estaba dormido, la petición nunca contestaba y el reclutador se quedaba mirando la pantalla. Ahora `api()` acepta `tope` (ms) y `salirDeSesion()` guarda con 8 segundos de tope mostrando "Guardando la sesión…". Si el servidor no contesta, **se sale igual**, se avisa, se manda el `beacon`, y la copia local **no se borra**: al recargar la página la sesión se retoma. Con el servidor sano, se sale, se guarda y la copia local se limpia. "Ir al tablero y seguir con otro" y "Guardar y salir" de la sala de espera pasan por el mismo camino, así que ya no dejan una sesión fantasma que se retomaba sola al recargar.
- **En el servidor, `pool.connect()` también tiene tope** (`conectar()`, 10 s): el pool es del host y no tiene `connectionTimeoutMillis`, así que una petición podía esperar una conexión para siempre. Ahora contesta `503` y el navegador conserva su copia.

`test/e2e_salir.py` corre con los diálogos del navegador bloqueados y con el guardado colgado a propósito (`__simular {guardar_colgado:true}` en el stub).

### El análisis corre en segundo plano

Pegar la transcripción dejó de bloquear. Antes el navegador esperaba los 30-40 segundos del análisis con un velo encima y el reclutador no podía abrir la siguiente entrevista; con entrevistas de 30 minutos una tras otra, eso era tiempo muerto real. Ahora `POST /api/sessions/:id/transcript` contesta `202 {estado:'procesando'}` de inmediato y el análisis sigue solo en el servidor, con su estado en la sesión (`transcript_status`: `procesando` → `lista` | `error`). La pantalla de espera ofrece dos salidas: irse al tablero y empezar con otro candidato, o quedarse — en cuyo caso consulta cada cuatro segundos y salta sola a la calificación. El tablero muestra la sesión como *analizando* y se refresca solo mientras haya algo en curso; al terminar aparece como *lista para calificar*, y al abrirla las propuestas se aplican una sola vez (si ya hay niveles, el evaluador ya pasó por ahí y no se le pisa nada).

Un análisis en `procesando` desde hace más de seis minutos se reporta como interrumpido —Render reinicia el proceso al desplegar— y se ofrece volver a pegar. La transcripción no se guarda en ningún momento: vive en memoria mientras dura el análisis. `test/e2e_paralelo.py` recorre el caso completo: pegar, irse, abrir otra entrevista, volver a la primera ya lista, y un análisis que falla.

### Una hoja

El objetivo del informe es una hoja. Con la carga de un caso real —el de José: tres requisitos con recomendación, cinco tarjetas, tres rasgos, experiencia verificada— salía en dos páginas de Oficio con el respaldo solo en la segunda. Tres cosas lo resolvieron, y conviene saberlas antes de tocar el CSS de papel:

- **Estructura antes que tamaño de letra.** La fila del requisito en papel es de dos columnas (nombre con su nota debajo, y el párrafo), no de tres: la columna del medio con la nota sola le quitaba 60px de ancho al párrafo. La experiencia va como fila a lo ancho, no como columna de la banda de tres: en un tercio de hoja el cargo se partía en tres renglones y el porqué en seis, y esa columna fijaba la altura de toda la banda. Los factores de cierre, cuando son solo lo que dijo el candidato, entran como columna de esa banda. Las cinco tarjetas van en una fila (`.imps.n5`); en 4+1 la segunda fila era una tarjeta y tres huecos.
- **Ajuste a una hoja (`ajustarAUnaHoja()` en `public/app.js`).** Antes de imprimir, la pantalla copia las reglas de `@media print` a un ámbito `.papelmedida`, clona el acta ahí a lo ancho de una hoja y mide su altura. Si cabe en Carta, zoom 1. Si se pasa por poco, `--ajuste` toma la fracción justa (Chrome reacomoda el texto con `zoom`, a diferencia de `transform`). Si haría falta encoger más del **piso (0.88)** se intenta Oficio, y si tampoco, se queda a tamaño natural y son dos páginas: por debajo del piso el cuerpo queda en 7 puntos, y un informe ilegible es peor que uno de dos hojas. El QR compensa el zoom (`--ajusteqr`) y sigue midiendo 104px: esa es la garantía de que un celular lo lee del papel.
- **Márgenes de documento.** `@page` bajó de 14/13/15 a 12/12/13 mm.

Lo que NO se hace: recortar contenido para caber. `test/e2e_una_hoja.py` comprueba que el caso de José cabe en una hoja de Oficio, no pasa de dos en Carta, el ajuste queda dentro del piso, el QR no se encoge y el PDF sigue diciendo todo lo que tiene que decir; además imprime cuánto mide cada bloque, que es la regla con la que se mide este trabajo. En Carta, un informe con esa carga sigue siendo de dos páginas: a 8.5×11 no cabe sin bajar del piso.

### El PDF, que es lo que de verdad recibe el cliente

El informe se lee en papel o en un PDF adjunto a un correo, no en la consola. Y el reclutador no va a configurar nada: le da a *Imprimir* y guarda. Así que el documento tiene que salir bien **sin que nadie acierte con los ajustes**. `test/print_check.py` genera el PDF por los cuatro caminos que ocurren de verdad —Carta y A4, con y sin *Gráficos de fondo*— usando los márgenes que declara `@page`, y revisa página por página:

- **ninguna página intermedia casi vacía.** Se mide la tinta de cada hoja: por debajo del 12% es un salto mal puesto, y en un documento de cliente se lee como un error de impresión.
- **el texto completo en el PDF**, no solo en la pantalla. (El extractor ve el kerning de Chrome metido dentro de las palabras — `r equisitos` — así que compara sin espacios.)
- **el QR decodificado desde los píxeles**, con el CSS de papel puesto: 33 módulos a 104px son 0.83 mm por módulo, muy por encima del medio milímetro que necesita un celular contra el papel. Decodificar la matriz del codificador no sirve: ya pasó una vez que salía perfecta y el cuadro impreso no escaneaba.
- **el caso pelado**: un sondeo de un requisito, sin inglés ni conducta ni trayectoria, tiene que caber en **una** hoja. Es donde las bandas de dos columnas se quedan con un hijo vacío y el documento se rompe.

Tres decisiones de maquetación que existen por lo que se vio en esas pruebas:

- **Dos columnas también en papel.** El colapso a una columna está detrás de `@media screen`: una hoja Carta con márgenes mide ~700px CSS y disparaba el breakpoint, así que el informe se imprimía en una sola columna y pasaba de tres páginas a cuatro.
- **La columna del ajuste se vuelve una tarjeta por requisito.** Un panel único partido por el borde de la hoja queda abierto por abajo, como si la impresora hubiera cortado la caja.
- **El cierre —respaldo, QR y alcance— viaja entero y va apretado.** Veinte píxeles de más lo mandaban solo a una página siguiente, y en el informe corto eso dejaba una hoja con un solo recuadro.

**Lo que no se puede hacer: numerar las páginas.** Chrome no implementa las cajas de margen de `@page` (`@bottom-center{content:counter(page)}`), y un elemento `position:fixed` se repite pero **no reserva espacio**: se monta sobre el texto y, probado, duplica contenido y descuadra el documento entero. Hacerlo bien exige rearmar el informe como tabla con `thead`/`tfoot`, que es un cambio de estructura. Lo que sí se hace es poner el código del informe en el encabezado de la primera página y otra vez en el bloque de respaldo, y renombrar el `<title>` al imprimir (`Informe PKV-… · Nombre · PeakU`), que es lo que Chrome imprime arriba si el reclutador deja activada la casilla de encabezados.

Lo que **no** trae, porque no sale de la sesión: inglés por sub-habilidad, percentil contra la población evaluada y trayectoria confirmada vs. declarada. Eso vive en la base de datos de PeakU y en la verificación de referencias; conectarlo es un trabajo aparte.

### La URL de autenticidad existe de verdad

El acta imprime una dirección de este mismo servidor (`/verificacion/v/PKV-…`), armada con el dominio donde corre la app. Antes imprimía `peaku.co/verificar/…`, que no existía: una promesa impresa en un documento que va al cliente.

La página es pública y **no muestra el nombre del candidato ni sus calificaciones**. Confirma que el informe fue emitido, para qué cargo y cliente, si certificó identidad, y su firma de integridad. Publicar la evaluación de una persona en una URL adivinable sería otra cosa muy distinta.

`GET /verificacion/api/v/:code` devuelve lo mismo en JSON.

### El QR: dos, y ninguno pasa por un tercero

Una URL que hay que transcribir a mano es una URL que nadie verifica. Hay dos códigos:

1. **En el acta**, junto al bloque de respaldo: lleva a la página de autenticidad de ese informe. El que recibe el PDF apunta el celular y ve la confirmación.
2. **En el cierre**, junto al link de identidad: el reclutador comparte pantalla y el candidato lo escanea **antes de colgar**. Hace la verificación en el celular —donde está la cámara buena para el documento y la prueba de vida— en vez de esperar a que revise el correo cuando la llamada ya se enfrió.

Los genera `public/qr.js`, escrito aquí: modo byte, corrección nivel M, versiones 1 a 10, salida SVG. **No se usa un servicio externo** (`api.qrserver.com` y parecidos) por dos razones: ese tercero quedaría con el registro de qué informe se consulta y cuándo, y el día que se caiga, un acta ya impresa queda con un cuadro roto. Un documento no puede depender de la infraestructura de nadie más.

El QR va siempre negro sobre blanco, también en modo oscuro: hay lectores que no leen un código invertido.

**El tamaño se pide en píxeles por módulo, no en píxeles totales, y el módulo se ajusta al zoom de la pantalla.** No es una preferencia de estilo, es la diferencia entre que escanee y que no.

Con `shape-rendering="crispEdges"` el navegador ajusta cada módulo a píxeles enteros. Lo que tiene que dar entero no es el módulo en píxeles CSS sino en píxeles **físicos**: con el navegador al 110%, un módulo de 4px CSS aterriza en 4.4 píxeles físicos, unos se redondean a 4 y otros a 5, la rejilla deja de ser regular y ningún lector la encuentra — aunque a simple vista el cuadrito se vea impecable. Por eso `qrSvg` calcula `redondear(objetivo × devicePixelRatio) / devicePixelRatio`, y los QR se vuelven a pintar si cambia el zoom.

Tamaños objetivo: **6** en el acta, **7** en el cierre, y el botón *Ampliar para compartir pantalla*, que calcula el módulo contra el tamaño de la ventana. Ese botón existe porque compartir pantalla en una videollamada comprime la imagen, y lo primero que se pierde en una compresión es justo el detalle fino de un QR. El mínimo es 4px CSS por módulo: por debajo, una cámara no lo resuelve.

#### El error que enseñó a probar esto bien

El QR decodificaba perfecto —formato válido, síndromes Reed-Solomon en cero, texto exacto— y **ninguna cámara lo leía**. Eran dos defectos en el andamiaje, no en los datos:

1. Los patrones de **sincronización** se dibujaban recorriendo la fila 6 y la columna 6 completas, encima de los localizadores ya dibujados. Eso partía el borde de los tres localizadores — que es exactamente lo que una cámara busca primero para encontrar que ahí hay un QR. Con ese borde roto, el lector no ve ningún código.
2. La reserva del área de formato pisaba `(8,6)` y `(6,8)`, que no son área de formato sino el primer módulo de cada patrón de sincronización.

La lección: **un QR puede tener los datos impecables y ser ilegible si su andamiaje está mal.** El decodificador propio no lo veía porque deduce la rejilla del ancho del localizador; un lector real hace lo contrario, usa la sincronización para ubicar cada módulo. Por eso `qr_verify.py` ahora revisa **los patrones fijos uno por uno** —localizadores, separadores, sincronización, alineación, módulo oscuro— antes de mirar los datos.

Cómo se sabe que funciona, sin librería de referencia contra la cual comparar: `test/qr_verify.py` vuelve a implementar el **decodificador** desde la norma, en otro lenguaje, y comprueba que los patrones fijos están donde deben, que los bits de formato pasan su BCH, que los síndromes Reed-Solomon de cada bloque dan cero y que el texto que sale es idéntico al que entró. `test/e2e_qr.py` va más allá y decodifica el SVG que el navegador de verdad dibujó, comprueba que coincide con la URL impresa al lado, y **abre esa dirección** para confirmar que responde.

Y `test/e2e_qr_pixeles.py` decodifica desde los **píxeles rasterizados** al 90%, 100%, 110%, 125%, 150%, 175% y 200%, y exige que en cada escala el módulo mida un número entero de píxeles físicos. Esa prueba existe porque el error de arriba pasó de verdad: el codificador estaba bien, la matriz decodificaba perfecto, y el QR no escaneaba. Solo mirando el resultado pintado se ve.

---

## El CV del candidato

Es opcional, pero cambia la entrevista. Se carga al abrir la sesión y Claude lo cruza contra los requisitos de esa vacante. Lo que devuelve:

**Preguntas que citan lo que el candidato escribió.** No "cuéntame de tu experiencia en SAP", sino *"en tu CV dice que en Alpina lideraste el rollout de PP entre 2023 y 2024, llévame a ese proyecto"*. Una pregunta que serviría para cualquier candidato del cargo es una pregunta desperdiciada, y esas ya las tiene del levantamiento.

**Cuándo el CV no cubre un requisito.** Es lo más valioso que puede reportar: significa que el evaluador va a sondear a ciegas y conviene que lo sepa antes, no a mitad de la pregunta.

**La trayectoria declarada**, que se confirma tramo por tramo durante la sesión — confirmado, sin sostener o contradice. Eso alimenta el bloque de trayectoria del acta. *Confirmada* significa que el candidato narró ese trabajo con escena y detalle propios, no que aparezca en su hoja de vida.

**Los puntos que no cuadran**: huecos de tiempo, solapamientos, un cargo cuyo nivel no corresponde al recorrido previo, descripciones en plural donde debería haber aporte individual. Cada uno con la pregunta que lo aclararía sin sonar a interrogatorio — casi siempre hay una explicación normal, y la pregunta busca esa explicación.

**Del CV se guarda lo extraído, no el archivo.** El texto se descarta después del análisis: es un dato personal que ya cumplió su función. Lo que queda en la base son las preguntas y la trayectoria, que es lo que la sesión y el acta necesitan.

Cuesta una llamada de IA por sesión (entre 0,03 y 0,08 USD). Si el análisis falla, la sesión arranca igual con las preguntas del cargo.

### Lo que sigue sin estar en el acta

El **inglés por sub-habilidad** y el **percentil contra la población evaluada** del informe original. Eso no sale de la sesión ni del CV: vive en la base de datos de PeakU, en las pruebas que ya aplicaron y en los perfiles que ya evaluaron. Conectarlo es leer de esa base y fusionarlo con lo que mide la sesión — un trabajo aparte, no una variante de este.

---

## Por qué los estáticos van versionados

`app.js` y `style.css` se enlazan con `?v=<hash del contenido>`, calculado al arrancar el servidor. Sin eso, el navegador sirve los archivos de la visita anterior y el usuario ve **la versión vieja de la aplicación aunque el servidor ya tenga la nueva** — un error desconcertante, porque el servidor está bien y aun así la pantalla está mal.

El `index.html` se sirve con `Cache-Control: no-cache` (siempre revalida) y los assets con caché de un año, que es seguro justamente porque van versionados: si cambian, cambia su URL.

`test/assets.test.js` verifica que el enganche siga en pie. Si alguien cambia cómo el HTML enlaza sus assets, el reemplazo del servidor dejaría de aplicar en silencio y el problema volvería sin aviso.

---

## Marca

Sigue el Manual de Marca PeakU v1.5. Tres decisiones que conviene conocer antes de tocar los colores:

**El azul de marca no puede ser el color del texto.** `#00C3FF` sobre blanco da 2,05:1 de contraste — muy por debajo del 4,5:1 que necesita cualquier texto para ser legible, y tampoco sirve de fondo con letras blancas. Es un color de logotipo, no de interfaz. Así que `--brand: #00C3FF` se usa donde de verdad es el color de la marca (el isotipo, la franja superior, el modo oscuro) y para el texto, los botones y los bordes hay `--acc: #006D8F`: el mismo matiz exacto del logo (194°), oscurecido hasta 5,86:1. Se lee como el azul de PeakU porque *es* el azul de PeakU.

**El verde de marca quedó como color semántico.** El manual asigna el azul a la sección de candidatos y el verde a la de empresas. Esta consola trata de candidatos, así que el acento es azul — y eso deja el verde libre para significar CUMPLE sin que se confunda con "botón principal". `--good: #157A57` deriva de `#1D976C` oscurecido para que se lea sobre blanco.

**Ámbar y rojo no están en el manual.** Una herramienta de evaluación necesita tres estados y la marca solo trae dos colores. Los tonos de PARCIAL y NO CUMPLE se eligieron para convivir con la paleta sin competir con ella.

Toda la paleta está validada contra WCAG AA en los dos temas: cero fallos de contraste en las 28 combinaciones que la interfaz realmente usa.

**Tipografía:** Montserrat, en los tres pesos del manual — Bold para títulos, Regular para cuerpo, Italic donde hace falta. Los números usan `tabular-nums` para que los cronómetros no bailen. La única excepción es la firma de integridad del acta, en la monoespaciada del sistema: son 16 caracteres hexadecimales que alguien va a comparar carácter por carácter.

**Isotipo:** `public/index.html` y el acta lo llevan embebido como SVG, extraído del vectorial del propio manual (13 curvas, sin rasterizar). Está a 46px de ancho, apenas por encima del mínimo digital de 45px que exige el manual, con la zona de seguridad respetada. Sus dos colores salen de `--iso-a` y `--iso-b`, así que se adapta al tema oscuro sin tocar el SVG. El acta lo lleva arriba a la izquierda — posición 1 de las cinco que permite el manual — para que el PDF que recibe el cliente salga con marca.

---

## Identidad: dos etapas, y el documento nunca se pide en cámara

La app distingue **dos tipos de sesión**, porque la verificación de identidad no se gana el derecho a existir en la primera entrevista:

**Sondeo** — la primera entrevista. Cámara encendida y las señales observables, nada más. Al candidato no se le pide ninguna identificación: todavía no ha invertido nada en el proceso, así que abandonar le cuesta cero. Produce una **ficha interna** que acompaña la terna.

**Cierre** — el finalista, cuando hay una oferta de por medio. Suma la capa de identidad y produce el **acta** que va al cliente.

### Cómo funciona el cierre

Durante la llamada, lo único que pasa es que el reclutador toma un **pantallazo del video**. El candidato no muestra ningún documento: solo sabe que la sesión está grabada, que es lo normal.

Al terminar, la app genera un **link de Didit** y el reclutador se lo manda. El candidato hace el KYC desde su celular cuando quiera: documento, prueba de vida certificada iBeta, y face match interno contra el documento.

Cuando Didit avisa por webhook, el servidor recupera la decisión, baja la selfie de la prueba de vida y la compara con el pantallazo mediante **Face Match 1:1** ($0.05). Ese cotejo es la pieza que el KYC por sí solo no puede dar: el KYC certifica a quien hizo el KYC, no a quien estuvo en la entrevista. Sin el cotejo, el candidato real podría verificarse desde su celular mientras otra persona responde las preguntas.

**La captura se borra en cuanto el cotejo termina.** Lo que queda es el puntaje, no la imagen — es un dato biométrico y no hay razón para conservarlo.

### Umbrales y qué significan

| Puntaje | Veredicto | Efecto |
|---------|-----------|--------|
| ≥ 70 | coincide | Identidad verificada, el acta la certifica |
| 50–70 | revisar | Semáforo amarillo, revisión humana antes de emitir |
| < 50 | no coincide | Semáforo rojo, no se emite nada |

Un puntaje bajo **no prueba fraude**: una captura borrosa, de perfil o a contraluz también lo baja. Por eso la franja intermedia va a revisión humana en vez de decidir sola. Los umbrales se ajustan con `DIDIT_FACE_OK` y `DIDIT_FACE_DUDA`.

### Prudencia no es sospecha

Si el candidato prefiere no verificarse, **eso no es rojo**. El acta se emite igual, con otro título — *Informe de verificación de conocimiento* — y dice explícitamente que no certifica identidad. Rojo es que la verificación se hizo y el rostro no corresponde. Confundir las dos cosas costaría el finalista de un proceso vivo.

### Configuración

```bash
DIDIT_API_KEY=...            # de la consola de Didit
DIDIT_WORKFLOW_ID=...        # el flujo de verificación que hayas creado allá
DIDIT_WEBHOOK_SECRET=...     # se muestra una sola vez al crear el destino del webhook
PUBLIC_URL=https://tu-app.onrender.com   # para la página de regreso del candidato
DIDIT_FACE_OK=70             # opcional
DIDIT_FACE_DUDA=50           # opcional
```

En la consola de Didit, apunta el webhook a `https://tu-app.onrender.com/verificacion/api/didit/webhook`.

Sin `DIDIT_API_KEY` la app funciona igual: los sondeos no la necesitan, y en un cierre el botón avisa que falta configurarla. `GET /verificacion/api/didit/estado` dice qué falta.

**Sobre la firma del webhook:** se valida `X-Signature-Simple` (HMAC-SHA256 sobre `{timestamp}:{session_id}:{status}:{webhook_type}`) y se rechaza todo lo que llegue con más de 5 minutos de desfase. Basta porque el webhook solo indica *qué sesión cambió* — los datos reales los pide el servidor con la API key. Reproducir `X-Signature-V2` exigiría replicar byte a byte el JSON canónico de Python, que es frágil y aquí no compra nada.

**Sobre datos personales:** el pantallazo es un dato biométrico. Se guarda solo el tiempo que tarda el cotejo y se borra automáticamente. PeakU nunca almacena la imagen del documento — eso queda del lado de Didit. Vale la pena que el aviso de privacidad y la autorización de tratamiento de datos que ya usas mencionen la verificación de identidad de forma explícita; la Ley 1581 trata los datos biométricos como sensibles y exige autorización previa. Esto no es asesoría legal: confírmalo con quien lleve el tema en PeakU.

---

## El prompt tiene que llevar el texto

`buildIntakePrompt(sourceText, ctx)` recibía el texto y **nunca lo insertaba en el prompt**. Se le pedía a Claude que leyera un job description que jamás le llegaba. Lo mismo en `buildCvPrompt` con el CV.

Y no fallaba de forma ruidosa, que habría sido lo mejor: con el nombre de la empresa y el cargo en el contexto, el modelo a veces **completaba una ficha entera inventada**, y esa ficha se guardaba como si fuera el levantamiento del cliente. Cualquier vacante creada antes de este arreglo hay que revisarla contra su fuente: sus requisitos pueden no venir de ningún lado.

Por qué ninguna prueba lo veía: `test/stub.js` no llama a Claude, devuelve una respuesta fija. El flujo entero pasaba en verde con el prompt vacío por dentro. Un extremo a extremo que no toca el modelo no puede ver un prompt roto — hace falta mirar el prompt en sí, y eso es `test/prompts.test.js`.

El texto va delimitado entre marcas (`INICIO_DEL_TEXTO` / `FIN_DEL_TEXTO`) y cerca del principio. Los delimitadores no son decorativos: un JD lo escribe el cliente, así que hay que dejar explícito dónde empieza y dónde termina el material de fuera, y que es contenido para analizar, no instrucciones para obedecer.

## Prompt

Todo el prompt del levantamiento está en `prompts.js`, separado de la lógica. Las dos partes que más importan:

- **La regla de anclaje.** Todo requisito extraído debe tener cita textual; si el cliente no dijo cuántos años exige, no se inventa un número; lo ambiguo se reporta en `vacios_del_levantamiento` en vez de resolverlo por su cuenta.
- **Qué cuenta como excluyente.** Solo lo innegociable. Lo que se valida con un documento (título, certificación, visa) se aparta, porque eso no es trabajo de la entrevista. Máximo 5, porque una sesión de 25 minutos no alcanza para más.

Costo: entre 0,05 y 0,20 USD por levantamiento según el largo. Las sesiones no consumen IA.

---

## Saber qué versión está desplegada

`/verificacion/api/health` devuelve **`build`** —huella de los archivos del servidor más la de los estáticos— y **`assets`**, la de `public/` sola. Antes solo existía la de los estáticos, así que un cambio en el servidor no movía nada visible desde fuera y era imposible saber qué código estaba vivo. Eso costó tres rondas de "¿ya desplegaste?" mirando síntomas en vez de datos.

Después de cada `git push`, comparar el `build` que reporta el servidor con el que sale de:

```bash
node -e "const fs=require('fs'),cr=require('crypto'),path=require('path');const h=cr.createHash('sha1');
for(const f of ['app.js','llm.js','json_llm.js','rules.js','prompts.js','schema.js','didit.js'])h.update(fs.readFileSync('verificacion/'+f));
const hp=cr.createHash('sha1');for(const f of ['app.js','style.css','index.html','qr.js'])hp.update(fs.readFileSync('verificacion/public/'+f));
h.update(hp.digest('hex').slice(0,8));console.log(h.digest('hex').slice(0,8))"
```

Si coinciden, lo desplegado es lo que tienes en el repo. Si no, el deploy no ha terminado — y no tiene sentido diagnosticar nada más hasta que coincidan.

## Leer el JSON que devuelve Claude

`json_llm.js`, con sus pruebas. Existe porque *"Claude devolvió JSON inválido"* tapaba tres fallas distintas que se arreglan distinto: la respuesta **se cortó** por el límite de tokens, el modelo **escribió una frase antes** del JSON, o el texto vino en un **bloque de contenido que no era el primero** (y el código leía solo `content[0]`).

Las defensas, de la más barata a la más cara:

1. **Prefill — apagado por defecto.** Ponerle el `{` en la boca al modelo evita el "Claro, aquí tienes:", pero **no todos los modelos lo aceptan**: `claude-opus-4-8` responde `400 … does not support assistant message prefill`. El rechazo se reconoce y se reintenta sin él, pero apoyar el camino normal en reconocer el texto de un error ajeno es frágil —basta que cambien la redacción—, así que el prefill queda como optimización opcional: `VERIF_PREFILL=1`. El rescate por balanceo de llaves ya resuelve el preámbulo sin necesidad de él.
2. **Rescate y reparación.** Si llega envuelto, se extrae el objeto balanceando llaves e ignorando las que van dentro de una cadena, probando desde cada `{` de apertura. Después se intentan reparaciones que **no cambian el contenido, solo su codificación**:
   - comas colgando antes de un cierre;
   - **caracteres de control crudos dentro de una cadena** — el desliz que más aparece cuando la entrada trae viñetas: el modelo copia una lista del job description dentro de un valor y le mete saltos de línea de verdad. Un salto sin escapar dentro de una cadena es JSON inválido aunque las llaves cierren bien y el texto se vea impecable, y `JSON.parse` bota el objeto entero.
3. **Reintento.** Si `stop_reason` fue `max_tokens` —o el objeto abre y nunca cierra— se repite una vez con el doble de espacio. Si vuelve a cortarse, el error dice **eso**, que es accionable, en vez de "JSON inválido", que no lo es.

Y un cuarto punto que no es de parseo: **los errores de la API no llegan crudos a la pantalla.** Un `400 {"type":"error",...,"request_id":"req_011…"}` no le dice nada al reclutador y arrastra detalles de la petición; se registra completo en el servidor y al usuario le llega la traducción (clave inválida, modelo inexistente, saturación, indisponibilidad).

Y cuando aun así falla, **la pantalla muestra lo que devolvió el modelo** detrás de un desplegable. Sin eso, diagnosticar obliga a entrar al registro de Render — y quien está atascado frente a la pantalla no siempre tiene ese acceso a la mano.

El error llega a la pantalla con su `motivo` (`truncado`, `ilegible`, `api` o `interno`) y se muestra **en el formulario, no en un toast**: el mensaje dice qué hacer y un toast se va solo. Y no le habla al usuario de JSON, que no le sirve de nada.

## Editar una vacante

`PATCH /api/vacancies/:id` y su pantalla. Se corrigen los datos del cargo —título, empresa, seniority, modalidad, ciudad, salario, reclutador, contexto— y también **los requisitos**: texto, criterio, las tres preguntas, los detalles verificables y las señales de impostor, con agregar, quitar y reordenar.

Existe porque **recrear la vacante no era alternativa**:

- Las sesiones apuntan a `vacancy_id` con `ON DELETE SET NULL`. Borrar y volver a crear deja huérfanas todas las verificaciones ya hechas: aparecerían como "sin vacante".
- Cada levantamiento es una llamada a Claude sobre la transcripción completa. Recrear una vacante para corregir la ciudad es caro por partida doble.
- Lo valioso son los requisitos, que salen de la reunión con el cliente más el criterio del reclutador. Ese es el activo.

**Editar los requisitos no altera las actas ya emitidas.** Cada acta se congeló en su `snapshot` con el texto de sus propios requisitos, así que lo que se cambie aquí rige de aquí en adelante. Si la vacante ya tiene informes emitidos, la pantalla lo dice antes de dejar tocar nada. Al borrar un requisito, las calificaciones viejas conservan su `req_text` — solo se pone en NULL la referencia.

Sobre la empresa: si se cambia el nombre no se renombra la empresa existente, porque arrastraría a las otras vacantes del mismo cliente. Se busca una que se llame así y, si no hay, se crea, y se reengancha la vacante.

## El tablero

Con decenas de verificaciones la lista plana dejó de servir: lo que el reclutador necesita primero es saber qué le toca hacer, después cómo va, y al final encontrar lo que ya está terminado. El tablero responde en ese orden.

- **Ver como.** Un selector con los evaluadores que existen (agrupados aunque los hayan escrito distinto: "Weimar", "weimar ") filtra la cola, los indicadores y la lista. Se recuerda en el navegador y también rellena el campo *Evaluador* de las sesiones nuevas. No hay ranking entre personas: se compara cada uno consigo mismo, y cuando se ve a una persona aparece solo el total del equipo como referencia.
- **Meta de la semana y racha.** Una barra de avance contra una meta que cada uno fija (10 por defecto, se guarda en su navegador), una frase que empuja hacia lo concreto —si hay verificaciones listas para calificar, lo dice: son informes casi hechos— y la racha de días hábiles seguidos emitiendo (hoy sin informe todavía no la rompe; sábados y domingos no cuentan).
- **Cuatro indicadores.** Informes emitidos y entrevistas de la semana, con la comparación contra la semana pasada y las últimas 8 semanas en barras; la mediana de horas de la entrevista al informe (últimos 30 días contra los 30 anteriores; bajar es mejorar), y el porcentaje de informes en que el candidato cumplió todos los requisitos.
- **Para hacer ahora.** Lo pendiente, ordenado por lo que más urge —análisis fallidos, listas para calificar, transcripciones que esperan (marcadas cuando llevan más de un día), sesiones a medias, análisis en curso—, cada uno con su acción.
- **Vacantes.** Buscador, filtro *Activas / Cerradas / Todas*, orden por actividad reciente. Cada vacante muestra entrevistados, informes, cuántos cumplen todo y cuántos siguen en proceso, y un punto por candidato con el color de su resultado; se despliega para ver la lista. Una vacante se **cierra** desde su pantalla y sale del tablero sin tocar sus informes.
- **Verificaciones.** Buscador por nombre, vacante, evaluador o código PKV, filtro *Todas / Pendientes / Emitidas*, de 25 en 25. Las emitidas muestran cuántos requisitos cumplió.

Las cuentas las hace `rules.js · estadisticas` sobre todas las verificaciones (`GET /api/tablero?evaluador=`), con la hora de Colombia; el estado de cada verificación desde "qué me toca hacer" lo calcula `estadoTablero` y viaja en `GET /api/sessions` (que ahora trae la vacante y el resultado por requisitos, hasta 2.000 filas). La misma función la usan el servidor, el stub y las pruebas.

## La entrevista y la calificación son dos momentos

Antes eran uno solo: el reclutador entrevistaba y calificaba en la misma pantalla. Eso obliga a escribir mientras el candidato habla — y mientras uno escribe, deja de escuchar. Lo que se pierde es justo la repregunta que desarma a un impostor, que es todo el producto.

Ahora:

**Durante la llamada** la pantalla es **guía y nada más**: qué buscas oír, la pregunta de escena, la de fricción, la de cruce, los detalles verificables con su respuesta esperada, las señales a vigilar y —si hay CV— las preguntas que citan lo que el candidato escribió. No hay campos de calificar ni de evidencia. Lo único que sí se marca en el momento son las **señales**, porque son cosas que no quedan en el texto: latencia de soplo, mirada de lectura, audio delator.

**Después** se pega la transcripción y de ahí sale la evidencia: para cada requisito, una **cita textual de lo que dijo el candidato** y un nivel propuesto contra la misma rúbrica anclada que va impresa en el acta. El reclutador confirma o corrige. Lo que vuelve son propuestas, no calificaciones: el acta promete escalas ancladas, y quien responde por ese número tiene que haberlo mirado.

Dos cosas que manda el mundo real y que el diseño respeta:

- **La transcripción de Google tarda unos minutos.** La sesión no puede quedarse esperando en pantalla: al colgar pasa a `status='esperando'`, aparece en el tablero marcada **ESPERA TRANSCRIPCIÓN**, y se retoma cuando esté lista — hoy, mañana, desde otro computador. Reabrirla lleva directo al paso de pegarla.
- **La transcripción no se guarda.** Es la conversación entera de una persona; lo único que el acta necesita son las citas que sostienen cada requisito. Se analiza, se guardan las citas, y el texto se descarta. Mismo criterio que con el CV.

Un requisito que **no se tocó** en la conversación queda sin nivel y la pantalla lo dice de frente. No se rellena con lo que diga el CV ni con lo que parezca razonable: un requisito sin conversación es un requisito sin medir, y eso es un dato.

## El acta impresa

El acta se imprime y se manda al cliente, así que el papel no es un caso secundario: es el formato final.

**El papel no tiene modo oscuro.** Quien tuviera el sistema en oscuro imprimía un documento de fondo negro con texto claro — impecable en pantalla, ilegible en papel. En impresión se fuerza la paleta clara completa, siempre, redefiniendo los tokens dentro de `@media print`.

Lo demás que se corrigió, todo verificado generando el PDF de verdad y mirándolo:

- Los encabezados de zona ya no quedan huérfanos al pie de una página (`break-after:avoid`), y los bloques no se parten por la mitad.
- El alcance y la metodología **sí se imprimen**: eran un `.hint`, y la regla de impresión escondía todos los `.hint` por ser ayudas de interfaz. Pero eso no es una nota al margen, es parte de lo que el documento afirma.
- La firma de integridad ya no parte palabras a la mitad.

Lo que **no** tiene: membrete repetido en cada página. En Chrome un elemento fijo se repite al imprimir pero no reserva espacio, así que se monta sobre el texto de la página 2 en adelante; hacerlo bien exige rearmar el acta como tabla con `thead`, y no vale la pena a medias. El código del informe va en el encabezado de la primera página y otra vez en el bloque de respaldo.

## El inglés se mide escuchando

"¿Hablas inglés?" no mide nada: todo el mundo dice B2. Y un certificado tampoco dice si aguanta un daily con el cliente, que es lo que el cargo necesita. Así que **se pasa un tramo de la entrevista a inglés** y el nivel sale de lo que sostuvo ahí, con su cita.

- **Lo define la vacante, no el candidato.** El levantamiento extrae si el cargo lo exige, qué nivel pide el cliente y —lo más importante— **para qué lo necesita en el día a día**: no es lo mismo leer documentación que discutir una decisión con el cliente. Eso es lo que fija el listón.
- **Durante la llamada** hay un guion de cuatro pasos para cambiar de idioma sin que se sienta un examen sorpresa: anunciarlo, arrancar repitiendo algo que ya contó, subirlo al trabajo real, y discrepar para ver si piensa en inglés o tiene frases guardadas.
- **Después**, la transcripción trae ese tramo en inglés y propone un nivel contra una rúbrica de **conducta observable**, no de certificados: si buscó palabras, si se autocorrigió, si sostuvo el tema técnico o se replegó a frases hechas.
- Si **no hubo tramo en inglés**, el acta dice *no evaluado* — ni a favor ni en contra. Y si el cargo no lo exige, la fase no existe y el acta no lo menciona.

Una señal que el prompt vigila: alguien que responde en inglés sin titubeos, sin muletillas y con vocabulario más pulido que su español no es un C1, es alguien leyendo. Eso se reporta como nota, no como nivel.

El acta lo dice explícito: medido por conducta en un tramo de la entrevista, **no reemplaza una prueba estandarizada** si el cliente la exige.

## Historial

Cada verificación del tablero se abre. Si fue emitida, el acta se dibuja **desde el snapshot que se congeló al emitirla** (`sessions.snapshot`, con su `formato`), así que lo que se ve es exactamente lo que se entregó.

Esto arregla un problema real: antes el tipo de documento se **recalculaba** al abrir el informe. Un acta entregada como *"Informe de verificación"* pasó a mostrarse como *"Ficha de sondeo"* en cuanto cambió el modelo de sesiones — el software estaba reescribiendo un documento ya entregado, que es exactamente lo contrario de lo que promete su firma de integridad.

Los informes emitidos **antes** de que existiera el snapshot no se pueden reconstruir con honestidad, así que no se finge: se dibujan con lo que quedó guardado y llevan un aviso arriba diciendo que la copia entregada es la referencia. La página pública de esos informes confirma que son auténticos y que la firma corresponde, pero **no afirma un tipo de documento** que hoy significaría otra cosa. Si quedó a medias, muestra en qué punto quedó y ofrece **retomarla**: el avance vive en el servidor, no en el navegador, así que se puede seguir desde otro computador o después de cerrar la pestaña.

El autoguardado corre 900 ms después de cada cambio, pero al salir de la sesión se fuerza el guardado, y si se cierra la pestaña de golpe se manda con `sendBeacon` (`POST /api/sessions/:id/beacon`), que sobrevive al cierre. Sin eso, lo último que escribió el reclutador se perdía.

---

## Lo que falta

- Revisión de cuatro ojos dentro de la app: `reviewed_by` y `reviewed_at` ya están en la tabla, falta la pantalla.
- Volver a analizar una transcripción sobre una vacante existente, conservando su historial.
- Autenticación. Hoy cualquiera con el link entra, igual que el Sandler. Para piloto interno está bien; antes de mostrárselo a un cliente, no.

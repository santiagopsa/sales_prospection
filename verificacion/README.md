# PeakU · Consola de Verificación

Vive dentro del repo del Sandler Coach como un módulo montado en `/verificacion`. Comparte el web service de Render, el pool de Postgres y la API key de Anthropic; sus tablas viven en un **schema propio de Postgres** (`verificacion`), así que nunca se cruzan con `deals` ni `wishlist`.

Un servicio, una base de datos, dos productos.

---

## Qué hace

Convierte el **levantamiento de perfil** con el cliente en una **verificación auditable** del finalista.

El reclutador carga la transcripción de la reunión (o el job description). Claude extrae la empresa, la vacante y los **requisitos excluyentes** — y para cada uno construye el material con el que se verifica: qué debe poder narrar el candidato, tres detalles duros que solo conoce quien lo hizo de verdad, y las preguntas de escena, fricción y cruce. El reclutador revisa, corrige y guarda.

Después, para cada finalista, la app guía una sesión de 25 minutos contra esos mismos requisitos, con escalas ancladas 1-5, señales observables y un semáforo que **calcula el servidor, no el navegador**. Si la carpeta no está completa, no hay acta.

| # | Vista | Quién | Qué pasa |
|---|-------|-------|----------|
| 0 | Tablero | — | Vacantes y verificaciones recientes |
| 1 | Levantamiento | Reclutador | Sube el archivo o pega el texto |
| 2 | Análisis | Claude | Empresa, vacante y hasta 5 excluyentes · 20-40 s |
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

- **Semáforo.** Verde: cero señales. Amarillo: 1-2 señales, o un cotejo de rostro dudoso. Rojo: 3 o más señales, o —solo en un cierre— que el rostro verificado no corresponda al de la entrevista.
- **Sin carpeta completa no hay acta.** Cuatro condiciones: los cinco puntos de identidad marcados, todos los requisitos calificados, más de 10 caracteres de evidencia en cada uno (`EV_MIN` en `public/app.js`), y semáforo distinto de rojo. El botón de generar acta queda bloqueado hasta que las cuatro se cumplan, y el servidor las vuelve a revisar en `/issue`: si algo falta devuelve `409` con la lista de razones, así que el navegador no puede saltárselo. En la pantalla de cierre, cada condición que falla nombra exactamente qué le falta y ofrece un botón para ir a esa pantalla.
- **Amarillo sí emite**, marcado como pendiente de cuatro ojos. Si prefieres que amarillo tampoco emita, es una línea en `bloqueos()`.
- **Firma de integridad.** SHA-256 sobre candidato, calificaciones, identidad y señales. Cambiar una calificación cambia la firma.

---

## Pruebas

```bash
node verificacion/test/rules.test.js       # 38 pruebas de las reglas, sin dependencias
node verificacion/test/assets.test.js      # que el versionado de estáticos siga enganchado
python3 verificacion/test/e2e.py           # flujo completo en navegador, contra test/stub.js
python3 verificacion/test/e2e_identidad.py # sondeo, cierre verificado, negativa y rostro que no corresponde
python3 verificacion/test/e2e_historial.py # abrir una verificación anterior y retomar una a medias
python3 verificacion/test/e2e_cv.py        # con CV: preguntas del candidato, trayectoria y acta
python3 verificacion/test/qr_verify.py     # decodifica los QR desde cero y comprueba el Reed-Solomon
python3 verificacion/test/e2e_qr.py        # los dos QR, escaneados desde el DOM real
python3 verificacion/test/e2e_viejas.py    # que un informe ya emitido no cambie de contenido
```

`test/stub.js` replica la API con `http` nativo y devuelve un levantamiento fijo en vez de llamar a Claude: prueba la interfaz sin API key, sin Postgres y sin `npm install`. Importa las reglas reales de `rules.js` y se monta en `/verificacion`, igual que en producción — así que lo que se prueba del semáforo, del acta y del punto de montaje es el código de verdad.

Lo que esas pruebas **no** cubren es la capa de Express real (el Router montado, los estáticos, el redirect al slash). Eso se verifica en un minuto al arrancar:

```bash
node server.js
curl -s localhost:3000/api/health               # el Sandler sigue vivo
curl -s localhost:3000/verificacion/api/health  # {"ok":true,"app":"verificacion","db":true,...}
curl -sI localhost:3000/verificacion | head -1  # 301 hacia /verificacion/
```

---

## El informe y su verificación pública

El acta sigue el formato del informe rediseñado, no una versión reducida:

- **Sellos** arriba, derivados de lo que de verdad se midió en la sesión: identidad, supervisión, señales, requisitos.
- **Zona 1 · Lo que medimos** — cada requisito con su barra, la evidencia textual y **el ancla citada debajo**. Sin el ancla, un "4/5" es un número sin criterio detrás.
- **Integridad** — identidad con el puntaje de cotejo, señales, grabación, evidencia.
- **Zona 2 · Lo que declara** — pretensión, disponibilidad, motivación y no negociables, marcados como *sus palabras, no nuestra medición*.
- **Zona 3 · Nuestra recomendación** — veredicto, texto y riesgos con mitigación. Lo único del acta que es opinión, y va firmado.

Las zonas 2 y 3 se llenan en la fase **Contexto**, entre los requisitos y el cierre.

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

Cómo se sabe que funciona, sin librería de referencia contra la cual comparar: `test/qr_verify.py` vuelve a implementar el **decodificador** desde la norma, en otro lenguaje, y comprueba que los bits de formato pasan su BCH, que los síndromes Reed-Solomon de cada bloque dan cero y que el texto que sale es idéntico al que entró. `test/e2e_qr.py` va más allá y decodifica el SVG que el navegador de verdad dibujó, comprueba que coincide con la URL impresa al lado, y **abre esa dirección** para confirmar que responde.

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

## Prompt

Todo el prompt del levantamiento está en `prompts.js`, separado de la lógica. Las dos partes que más importan:

- **La regla de anclaje.** Todo requisito extraído debe tener cita textual; si el cliente no dijo cuántos años exige, no se inventa un número; lo ambiguo se reporta en `vacios_del_levantamiento` en vez de resolverlo por su cuenta.
- **Qué cuenta como excluyente.** Solo lo innegociable. Lo que se valida con un documento (título, certificación, visa) se aparta, porque eso no es trabajo de la entrevista. Máximo 5, porque una sesión de 25 minutos no alcanza para más.

Costo: entre 0,05 y 0,20 USD por levantamiento según el largo. Las sesiones no consumen IA.

---

## Historial

Cada verificación del tablero se abre. Si fue emitida, el acta se dibuja **desde el snapshot que se congeló al emitirla** (`sessions.snapshot`, con su `formato`), así que lo que se ve es exactamente lo que se entregó.

Esto arregla un problema real: antes el tipo de documento se **recalculaba** al abrir el informe. Un acta entregada como *"Informe de verificación"* pasó a mostrarse como *"Ficha de sondeo"* en cuanto cambió el modelo de sesiones — el software estaba reescribiendo un documento ya entregado, que es exactamente lo contrario de lo que promete su firma de integridad.

Los informes emitidos **antes** de que existiera el snapshot no se pueden reconstruir con honestidad, así que no se finge: se dibujan con lo que quedó guardado y llevan un aviso arriba diciendo que la copia entregada es la referencia. La página pública de esos informes confirma que son auténticos y que la firma corresponde, pero **no afirma un tipo de documento** que hoy significaría otra cosa. Si quedó a medias, muestra en qué punto quedó y ofrece **retomarla**: el avance vive en el servidor, no en el navegador, así que se puede seguir desde otro computador o después de cerrar la pestaña.

El autoguardado corre 900 ms después de cada cambio, pero al salir de la sesión se fuerza el guardado, y si se cierra la pestaña de golpe se manda con `sendBeacon` (`POST /api/sessions/:id/beacon`), que sobrevive al cierre. Sin eso, lo último que escribió el reclutador se perdía.

---

## Lo que falta

- Revisión de cuatro ojos dentro de la app: `reviewed_by` y `reviewed_at` ya están en la tabla, falta la pantalla.
- Autenticación. Hoy cualquiera con el link entra, igual que el Sandler. Para piloto interno está bien; antes de mostrárselo a un cliente, no.

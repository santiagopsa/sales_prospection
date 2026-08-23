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
| 5 | Sesión | Reclutador | Apertura → un requisito por pantalla → contexto → cierre |
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
python3 verificacion/test/e2e.py           # flujo completo en navegador, contra test/stub.js
python3 verificacion/test/e2e_identidad.py # sondeo, cierre verificado, negativa y rostro que no corresponde
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

## Lo que falta

- Detalle histórico de una sesión ya emitida (el tablero la lista pero no la abre).
- Revisión de cuatro ojos dentro de la app: `reviewed_by` y `reviewed_at` ya están en la tabla, falta la pantalla.
- Verificación pública del acta en `peaku.co/verificar/PKV-…` — el código ya se imprime en el informe.
- Autenticación. Hoy cualquiera con el link entra, igual que el Sandler. Para piloto interno está bien; antes de mostrárselo a un cliente, no.

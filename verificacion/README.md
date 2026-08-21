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
| 5 | Sesión | Reclutador | Identidad → un requisito por pantalla → cierre |
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

- **Semáforo.** Verde: identidad completa y cero señales. Amarillo: 1-2 señales. Rojo: identidad incompleta o 3 o más señales.
- **Sin carpeta completa no hay acta.** El servidor vuelve a revisar en `/issue`: identidad completa, todos los requisitos calificados, evidencia textual de más de 10 caracteres en cada uno, y semáforo distinto de rojo. Si algo falta devuelve `409` con la lista de razones — el navegador no puede saltárselo.
- **Amarillo sí emite**, marcado como pendiente de cuatro ojos. Si prefieres que amarillo tampoco emita, es una línea en `bloqueos()`.
- **Firma de integridad.** SHA-256 sobre candidato, calificaciones, identidad y señales. Cambiar una calificación cambia la firma.

---

## Pruebas

```bash
node verificacion/test/rules.test.js    # 22 pruebas de las reglas, sin dependencias
python3 verificacion/test/e2e.py        # flujo completo en navegador, contra test/stub.js
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

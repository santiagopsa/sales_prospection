# Variables de entorno de /verificacion

Se suman a las que ya usa el Sandler (`DATABASE_URL`, `ANTHROPIC_API_KEY`). Ninguna es obligatoria
para que la app arranque: sin ellas los sondeos funcionan igual y solo se desactiva la capa de identidad.

| Variable | Para qué | Dónde se obtiene |
|---|---|---|
| `DIDIT_API_KEY` | Crear verificaciones y cotejar rostros | Consola de Didit → API keys |
| `DIDIT_WORKFLOW_ID` | Qué flujo de verificación se usa | Consola de Didit → Workflows (UUID) |
| `DIDIT_WEBHOOK_SECRET` | Validar que el webhook viene de Didit | Se muestra **una sola vez** al crear el destino del webhook |
| `PUBLIC_URL` | Página de regreso del candidato al terminar | Tu dominio de Render |
| `DIDIT_FACE_OK` | Puntaje desde el que se da por verificado (default 70) | — |
| `DIDIT_FACE_DUDA` | Puntaje desde el que va a revisión humana (default 50) | — |
| `VERIF_MODEL` | Modelo del levantamiento si quieres otro que el del Sandler | — |
| `VERIF_SCHEMA` | Nombre del schema de Postgres (default `verificacion`) | — |

En la consola de Didit, el destino del webhook apunta a:

    https://tu-app.onrender.com/verificacion/api/didit/webhook

Para comprobar qué falta: `GET /verificacion/api/didit/estado`

# Peaku · Sandler Coach

Herramienta web para procesar demos comerciales de Peaku con IA. El ejecutivo pega el **transcript del demo** (Google Meet, Otter, Fireflies) y **Claude extrae automáticamente**:

- Dolor + embudo desarrollado (cuantificar / historia / impacto)
- Presupuesto, decisor, proceso de decisión, fecha límite
- Pedidos del cliente (lo que sí tenemos vs. lo que hay que construir)
- Calificación Sandler (Completa / Parcial / No califica)
- **Momentos críticos** del demo (dolor no desarrollado, precio antes de tiempo, cliente dictó pasos)
- **Preguntas faltantes** según Sandler
- **Acciones concretas** priorizadas para esta semana

El comercial solo llena: **datos iniciales** (ejecutivo, empresa, línea, canal) + **ficha de prospección** (lo que trajo el canal) + **transcript**. Todo lo demás lo hace la IA. El comercial revisa y ajusta antes de guardar.

Stack: Node 18 + Express + Postgres + Anthropic SDK. SPA en HTML/JS plano.

---

## 🚀 Deploy en Render

### Requisitos
- Cuenta de Render con Postgres plan Starter+ (el free trial se agota en 90 días)
- **API key de Anthropic** (https://console.anthropic.com/)

### Pasos

1. **Sube este folder a GitHub.**
2. En Render → **New +** → **Blueprint** → conecta el repo.
3. Render lee `render.yaml` y crea: web service + Postgres.
4. En **Environment del web service**, agrega:
   - `ANTHROPIC_API_KEY` = tu key de Anthropic (empieza con `sk-ant-...`)
   - `NODE_ENV` = `production` (ya está en render.yaml)
   - `DATABASE_URL` = ya se linkea sola con Postgres
5. **Settings → Networking → Generate Domain**.

Primera vez que arranca crea tablas + migra columnas. Costo típico de IA: **~$0.05–0.15 USD por análisis de demo** (transcript de 30-45 min).

---

## 🧭 Flujo (6 vistas)

| # | Vista | Quién llena | Contenido |
|---|-------|-------------|-----------|
| 0 | Datos iniciales | Comercial | Ejecutivo, empresa, línea (SaaS/HH/EOR), canal de adquisición, freelancer |
| 1 | Prospección | Comercial | Ficha que trajo el canal antes del demo (dinámica por canal) |
| 2 | Transcript | Comercial | Pega el transcript del demo (Google Meet) |
| 3 | Análisis IA | Claude | Extrae ~30 segundos |
| 4 | Revisar y ajustar | Comercial | Edita lo que la IA no pilló bien |
| 5 | Resultado + acciones | — | Calificación Sandler + acciones concretas + momentos críticos |

---

## 📋 Cómo obtener transcript de Google Meet

1. En el demo, menú de 3 puntos → **Grabar / Transcribir reunión**.
2. Al terminar, Google guarda el transcript en el **Drive** del organizador (carpeta `Meet Recordings`) y lo envía por correo.
3. Abre el documento, `Ctrl/Cmd + A` (seleccionar todo), `Ctrl/Cmd + C`, y pega en Vista 2 de la app.

También funciona con Otter, Fireflies o cualquier transcript en texto plano.

---

## 🛠 Correr local

```bash
npm install
export DATABASE_URL="postgres://..."   # opcional; sin esto usa memoria
export ANTHROPIC_API_KEY="sk-ant-..."
node server.js
# abre http://localhost:3000
```

---

## 📂 Estructura

```
peaku-sandler/
├── server.js           # Express + Postgres + Anthropic
├── package.json
├── render.yaml         # Config Render
├── Procfile
└── public/
    ├── index.html
    ├── style.css
    ├── app.js          # SPA con wizard + dashboards
    └── img/peaku-logo.png
```

---

## 🔒 Notas de seguridad

- **Sin auth**: cualquiera con el link puede ver/crear deals. Si vas a compartir públicamente, ponle Cloudflare Access o Basic Auth.
- El transcript se guarda en la DB (JSONB). Considera esto si contiene información sensible.
- La API key de Anthropic vive solo en las variables de Render — nunca en el repo.

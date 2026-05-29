# Peaku · Sandler Coach

Herramienta web para guiar a los ejecutivos comerciales de Peaku por el proceso Sandler + las preguntas de calificación de la guía interna. Te da en cada deal:

- **% de cumplimiento** de fundamentales y nice-to-have del proceso.
- **Qué mostrar de la plataforma** según el segmento detectado (Micro / PyME / Grande).
- **Qué faltó** del proceso para no avanzar al cierre con huecos.
- **Wishlist por segmento** — lo que los clientes piden y que aún no tenemos, ranqueado por frecuencia, para alimentar el roadmap.

Stack: Node 18 + Express + Postgres. SPA en HTML/JS plano (sin build step). Listo para Railway.

---

## 🚀 Deploy en Railway (5 minutos)

### Opción A — Desde GitHub (recomendado)

1. **Sube este folder a un repo de GitHub** (privado o público).

   ```bash
   cd peaku-sandler
   git init
   git add .
   git commit -m "init: peaku sandler coach"
   git branch -M main
   git remote add origin https://github.com/<TU_USUARIO>/peaku-sandler.git
   git push -u origin main
   ```

2. **Entra a [railway.app](https://railway.app)** → `New Project` → `Deploy from GitHub repo` → elige `peaku-sandler`.

3. **Agrega Postgres**: dentro del proyecto, click `+ New` → `Database` → `Add PostgreSQL`. Railway automáticamente expone la variable `DATABASE_URL` al servicio web.

4. **Variables de entorno** (en el servicio web → `Variables`):
   - `NODE_ENV` = `production`
   - `DATABASE_URL` ya viene linkeada automáticamente del plugin Postgres (déjala como está).

5. **Generar dominio público**: en el servicio web → `Settings` → `Networking` → `Generate Domain`. Te da una URL tipo `peaku-sandler-production.up.railway.app`.

6. Listo. La primera vez que arranque, el server crea las tablas `deals` y `wishlist` automáticamente.

### Opción B — Railway CLI

```bash
npm i -g @railway/cli
railway login
cd peaku-sandler
railway init
railway add --plugin postgresql
railway up
```

---

## 🧪 Correr local

```bash
cd peaku-sandler
npm install
# opcional: pon una DATABASE_URL real; si no, corre en modo memoria
node server.js
```

Abre http://localhost:3000

Sin `DATABASE_URL`, los deals se guardan en memoria (se pierden al reiniciar). Útil solo para desarrollo.

---

## 🧭 Flujo de la app

1. **Construcción** — contrato previo + vínculo (Fase 1 Sandler).
2. **Calificación rápida** — 5 preguntas que detectan segmento.
3. **Segmento detectado** — auto-clasifica en A/B/C y si ya tiene ATS.
4. **Dolor** — preguntas específicas por segmento (la guía cambia para Micro, PyME y Grande con ATS).
5. **Presupuesto / Decisión** — los tres fundamentales que no pueden faltar.
6. **Pedidos del cliente** — lista de cosas que el cliente dijo que necesitaría, marcando si las tenemos o no.
7. **Cierre** — post-venta + próximo paso concreto.
8. **Resultado** — % cumplimiento + qué mostrar + qué faltó + gaps que alimentan el wishlist.

Después de guardar, **`/wishlist`** muestra el ranking por segmento de las cosas más pedidas que aún no tenemos. Eso es input directo para roadmap.

---

## 📂 Estructura

```
peaku-sandler/
├── server.js           # Express + Postgres
├── package.json
├── railway.json        # Config Railway
├── Procfile
├── .env.example
└── public/
    ├── index.html      # Shell
    ├── style.css
    └── app.js          # SPA: wizard + dashboards
```

---

## 🛠 Customizar

- **Cambiar los módulos de Peaku** que se sugieren en cada segmento: edita `PEAKU_FEATURES`, `SHOW_BY_SEGMENT` y `DONT_SHOW_BY_SEGMENT` en `public/app.js` (al inicio).
- **Pesos del scoring**: edita la función `scoreDeal` en `server.js` y `localScore` en `public/app.js` (mantén ambas sincronizadas).
- **Preguntas por segmento**: están en la función `stepDiscovery` en `public/app.js`.

---

## ⚠️ Notas

- **Sin autenticación**: cualquiera con el link puede ver/crear deals. Si lo expones públicamente, ponle una contraseña básica con Railway's `BASIC_AUTH` o pásalo por un Cloudflare Access.
- El borrador del deal en curso se guarda en `localStorage` del navegador — si el comercial cierra la pestaña, recupera el progreso al abrir de nuevo.

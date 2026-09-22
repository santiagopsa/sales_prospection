# SDR Coach (`/sdr`)

Módulo de prospección de Angie montado sobre el servidor del Sandler. Sus tablas viven en el schema `sdr`
de la misma base. No toca `deals`, `wishlist` ni `verificacion`, salvo para **crear** un deal cuando Angie
agenda una reunión. No tiene login: quien tenga el enlace `/sdr` opera todo (y puede llamar con cargo a la
cuenta de Voximplant: no compartas el enlace fuera del equipo).

Estado: fases 1 a 3 (leads, cola, resultados, etapas, llamadas desde el navegador). Pendientes: pipeline de
audio (4), reporte semanal (5), calibración (6).

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
3. Pega las variables en Render → Environment y redespliega.
4. Abre un lead en `/sdr`, dale **Llamar**, acepta el micrófono. La primera llamada tarda unos segundos más (inicia sesión).

Volver a correr `vox:setup` conserva la contraseña y el secreto (los lee de `sdr/voximplant-render.env`), así que no hay que tocar Render; con `--rotar` genera nuevos y entonces sí hay que pegarlos otra vez.
Para cambiar el aviso de grabación o la voz: edita `AVISO_GRABACION` / `VOZ_AVISO` en `sdr/config.js`, corre
`vox:setup` (sube el escenario nuevo) y despliega. `node sdr/cli.js vox:escenario` muestra el escenario sin subirlo.

## Cómo funciona una llamada

Navegador (Web SDK, login con llave de un solo uso firmada por el servidor) → escenario VoxEngine → `callPSTN`
con `VOX_CALLER_ID` → al contestar, el prospecto oye el aviso → se unen los audios y se graba en estéreo
(prospecto izquierda, Angie derecha; ver `CANAL_ANGIE_EN_GRABACION`) → al colgar, Angie **tiene** que elegir un
resultado → el escenario manda un webhook a `/sdr/api/vox/webhook` con duración, estado y enlace de la grabación.
Resultado y webhook se unen por el `uuid` que genera el navegador, en cualquier orden.

La grabación queda en Voximplant (no hay storage propio). Su enlace aparece en el historial del lead.

## Mover un hueco

Todos los huecos están en `sdr/config.js`, con un comentario de qué mueve cada uno. Antes de editar, puedes ver el
efecto con `--set`, que no guarda nada:

```
node sdr/cli.js secuencia --desde 2026-09-21 --set SALTAR_FINES_DE_SEMANA=false
node sdr/cli.js cola --set PRIORIDAD.porCanal.llamada=25
node sdr/cli.js importar archivo.csv            # simula la carga; --confirmar para cargar
```

`cola` e `importar` necesitan `DATABASE_URL`. Si el nombre del hueco tiene un error, el comando falla y lo dice.

## Pruebas
```
npm run test:sdr                                        # unitarias; las de base se saltan sin la variable
SDR_TEST_DATABASE_URL=postgres://... npm run test:sdr   # BORRA y recrea el schema sdr de esa base: nunca producción
```

## Desarrollo local sin el Sandler
```
DATABASE_URL=postgres://... node sdr/dev.js       # http://localhost:3100/sdr/
```

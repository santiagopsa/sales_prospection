# SDR Coach (`/sdr`)

Módulo de prospección de Angie montado sobre el servidor del Sandler. Sus tablas viven en el schema `sdr`
de la misma base. No toca `deals`, `wishlist` ni `verificacion`, salvo para **crear** un deal cuando Angie
agenda una reunión. No tiene login: quien tenga el enlace `/sdr` opera todo (y puede llamar con cargo a la
cuenta de Voximplant: no compartas el enlace fuera del equipo).

Estado: fases 1 a 3 (leads, cola, resultados, etapas, llamadas desde el navegador) más la vista **Semana** con
actividad, racha y tasas (ocultas tras `MOSTRAR_RATIOS`). Pendientes: pipeline de audio (4), la parte de mejora del
reporte semanal (5), calibración (6).

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

## Usuarios
Sin credenciales: el desplegable de la barra (Angie, Luisa, Santiago; lista en `USUARIOS` de `config.js`) marca
quién hizo cada cosa y queda en el historial. La app no deja registrar nada sin elegir uno. Solo los toques del
rol `sdr` cuentan para marcaciones, conversaciones, bloques y racha; así las pruebas no ensucian los números.

## Borrar datos de prueba
```
node sdr/cli.js limpiar               # muestra cuánto hay
node sdr/cli.js limpiar --confirmar   # borra leads, tareas, toques, llamadas, cargas y los deals que el SDR creó en el Sandler
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

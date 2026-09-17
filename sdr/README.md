# SDR Coach (`/sdr`)

Módulo de prospección de Angie montado sobre el servidor del Sandler. Sus tablas viven en el schema `sdr`
de la misma base. No toca `deals`, `wishlist` ni `verificacion`. No tiene login: quien tenga el enlace `/sdr` opera todo.

> Este README se completa en la fase 6. Estado actual: **fase 1** (carga de CSV, secuencia, cola del día, pipeline y ficha de solo lectura).

## Variables de entorno
Solo usa las que ya existen: `DATABASE_URL`. Las de Voximplant, Deepgram y el evaluador llegan en sus fases.

## Mover un hueco
Todos los huecos están en `sdr/config.js`, con un comentario que explica qué mueve cada uno. Antes de editar, puedes ver el efecto con `--set`, que no guarda nada:

```
node sdr/cli.js secuencia --desde 2026-09-21 --set SALTAR_FINES_DE_SEMANA=false
node sdr/cli.js cola --set PRIORIDAD.porCanal.llamada=25
node sdr/cli.js importar archivo.csv            # simula la carga; --confirmar para cargar
```

`cola` e `importar` necesitan `DATABASE_URL`. Si el nombre del hueco tiene un error, el comando falla y lo dice; nunca sigue callado.

## Pruebas
```
npm run test:sdr                                  # unitarias; la de base se salta sin la variable
SDR_TEST_DATABASE_URL=postgres://... npm run test:sdr   # BORRA y recrea el schema sdr de esa base: nunca producción
```

## Desarrollo local sin el Sandler
```
DATABASE_URL=postgres://... node sdr/dev.js       # http://localhost:3100/sdr/
```

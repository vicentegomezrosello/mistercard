---
name: worker-api
description: Especialista en el Cloudflare Worker de mistercard (src/index.js, wrangler.jsonc, D1 mistercard_panel, R2 hold-fotos). Úsalo para cambios en /api/catalogo, /fotos/, caché, cabeceras, bindings o rutas nuevas del Worker.
---

Trabajas en el Worker de mistercard. Lee `CLAUDE.md` antes de empezar.

## Contexto
- `src/index.js` sirve los assets (`env.ASSETS`) y dos rutas GET/HEAD: `/api/catalogo` (D1) y `/fotos/<clave>` (R2).
- La D1 y el R2 los **escribe HOLD**, que es otra aplicación. Aquí solo se lee: nada de `INSERT`, `UPDATE`, `DELETE`, migraciones ni `PHOTOS.put`.
- El dueño del catálogo se filtra comparando `photoPrefix(user)` con `items/<CATALOG_OWNER_ID>/`.

## Reglas
1. SQL siempre con columnas explícitas (nunca `SELECT *`) y parámetros con `.bind()`. Nunca concatenar entrada del usuario.
2. La respuesta pública se construye campo a campo con valores saneados o en lista blanca. Prohibido exponer `user`, email, costes, beneficios, notas, fechas de compra o movimientos.
3. Valida toda clave de R2 con `PHOTO_KEY` y con el prefijo del dueño antes de leerla.
4. Errores: `console.error` en el servidor y un JSON genérico al cliente, sin trazas.
5. Caché: el catálogo es corto (`max-age=60`) y las fotos son `immutable`. Si cambias esto, explica por qué.
6. Si cambias la forma de la respuesta, actualiza `desdeAPI()` en `index.html` en el mismo cambio. Si no te lo han pedido, avisa al agente principal.
7. Si cambias `wrangler.jsonc`, no añadas secretos: van en `wrangler secret` o `.dev.vars`, que está ignorado.

## Verificación
- `node --check src/index.js`.
- Si hay credenciales, `npx wrangler dev` y probar con `curl` `/api/catalogo`, `/fotos/<clave inválida>` (debe dar 404) y un `POST` (debe dar 405).
- Indica qué has podido probar y qué no.

Termina con un resumen: archivos cambiados, impacto en el contrato de la API y riesgos.

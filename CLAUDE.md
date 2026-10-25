# mistercard · guía para Claude

Escaparate de cartas TCG (mistercard.es, Alicante). No hay carrito: se enseña el stock y la venta se cierra por DM de Instagram/WhatsApp. Todo el texto visible y los comentarios del código van en **español**.

## Arquitectura

- **Cloudflare Worker** (`wrangler.jsonc`, `src/index.js`). Sirve la raíz del repo como assets estáticos (`assets.directory: "./"`) y añade dos rutas de solo lectura:
  - `GET /api/catalogo` → productos publicados desde **HOLD** (D1 `mistercard_panel`, tabla `items`).
  - `GET /fotos/<clave>` → fotos en R2 (`hold-fotos`), solo bajo `items/<CATALOG_OWNER_ID>/`.
- **HOLD** (hold.mistercard.es) es otra app, fuera de este repo, que **escribe** la D1 y el R2. Aquí solo se lee. No se cambia el esquema ni se escribe en D1/R2 desde este repo.
- **Web pública**: `index.html`, que es una sola página con CSS y JS inline, sin build ni dependencias. Carga `content/sitio.json`, `content/apartados.json` y `/api/catalogo`. Si la API falla, usa `content/cartas.json` como respaldo.
- **Panel** `admin/`: Sveltia CMS (versión fijada) que hace commits directos a `main` con token de GitHub. Edita `content/sitio.json` y `content/apartados.json`. Los productos ya **no** se editan aquí.
- `calculadora-beneficios-tcg/index.html`: herramienta independiente, también sin build.

## Reglas críticas

1. **Todo lo que hay en la raíz es público.** Cualquier archivo nuevo que no sea web debe ir en `.assetsignore`. Revisa ese archivo siempre que crees carpetas o archivos de configuración.
2. **Datos privados de HOLD.** `/api/catalogo` elige las columnas una a una. Nunca se exponen costes, beneficios, notas, fechas de compra, email, `user` ni movimientos. Un campo nuevo en la respuesta tiene que estar justificado y ser público.
3. **Sin secretos en el repo, que es público.** El dueño se identifica por `CATALOG_OWNER_ID`, un hash, y no por el email.
4. **XSS.** `index.html` pinta con `innerHTML`, así que todo dato de la API o de `content/*.json` pasa por `esc()`. Las URLs de imágenes y enlaces también.
5. **Contrato API ↔ frontend.** Si cambias la forma de `/api/catalogo`, actualiza `desdeAPI()` en `index.html` en el mismo commit. Mapeo de secciones: `graded→gradeadas`, `sealed→sellado`, `singles→sueltas`, `lots→lotes`.
6. **Contrato CMS ↔ JSON.** Si cambias campos de `content/*.json`, actualiza `admin/config.yml` y el JS que los lee.
7. `main` se despliega en producción. Se trabaja en la rama asignada y nunca se hace push directo a `main`.

## Comprobaciones antes de commit

No hay tests ni linter. Mínimo:

```bash
node --check src/index.js
for f in content/*.json; do node -e "JSON.parse(require('fs').readFileSync('$f','utf8'))" || echo "JSON roto: $f"; done
npx wrangler dev   # prueba local; D1/R2 reales necesitan credenciales de Cloudflare
```

Para cambios visuales, abre la página con Playwright (está preinstalado) y revisa móvil (390 px) y escritorio.

## Estilo

- JS moderno sin frameworks ni dependencias nuevas, salvo que haya una razón clara.
- Código compacto, como el existente: funciones pequeñas y comentarios cortos en español que expliquen el porqué.
- Imágenes de producto en `.webp` dentro de `images/`.

## Agentes del proyecto (`.claude/agents/`)

- `worker-api`: Worker, D1, R2 y `wrangler.jsonc`.
- `frontend`: `index.html`, la calculadora, SEO y el panel CMS.
- `reviewer`: revisión de seguridad y de contratos antes de push. Solo lectura.

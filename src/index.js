// ===== mistercard · Worker de la web pública =====
// Sirve los archivos de la web (index.html, content/, images/, admin/…) igual que antes
// y añade dos rutas de solo lectura:
//   GET /api/catalogo  → productos publicados desde HOLD (solo datos públicos)
//   GET /fotos/<clave> → fotos de esos productos guardadas en R2 (bucket hold-fotos)
//
// Seguridad: la consulta elige columna por columna lo que sale a la web.
// Nunca se envían costes, beneficios, notas, fechas de compra, email ni movimientos.

const SECTIONS = ["graded", "sealed", "singles", "lots"];
const SECTION_BY_KIND = { graded: "graded", sealed: "sealed", single: "singles", figure: "lots" };
const PHOTO_KEY = /^items\/[0-9a-f]{24}\/[0-9a-f-]{36}\.(jpg|png|webp)$/;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const isApi = url.pathname === "/api/catalogo", isFoto = url.pathname.startsWith("/fotos/");
    if (!isApi && !isFoto) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("Método no permitido", { status: 405, headers: { allow: "GET, HEAD" } });
    try {
      return isApi ? await catalogo(env) : await foto(env, url);
    } catch (e) {
      console.error(e);
      return Response.json({ error: "no disponible" }, { status: 500, headers: { "cache-control": "no-store" } });
    }
  }
};

// El dueño del catálogo se identifica por el id de su carpeta de fotos en HOLD
// (items/<id>/, primeros 24 hex del SHA-256 de su email). Así el email no aparece en el repo.
function ownerPrefix(env) {
  const id = String(env.CATALOG_OWNER_ID || "").trim().toLowerCase();
  if (!/^[0-9a-f]{24}$/.test(id)) throw new Error("falta CATALOG_OWNER_ID");
  return `items/${id}/`;
}

async function catalogo(env) {
  const prefix = ownerPrefix(env);
  const { results } = await env.DB.prepare(
    "SELECT user, id, public_title, name, public_price, public_status, public_section, public_description, " +
    "game, set_name, grade_company, grade, kind, photos " +
    "FROM items WHERE published = 1 AND quantity > qty_out " +
    "ORDER BY published_at DESC, id ASC"
  ).all();
  // Solo los del dueño (el campo user se usa aquí y nunca sale en la respuesta)
  const own = new Map();
  const rows = [];
  for (const r of results || []) {
    if (!own.has(r.user)) own.set(r.user, (await photoPrefix(String(r.user || "").toLowerCase())) === prefix);
    if (own.get(r.user)) rows.push(r);
  }
  const items = rows.map((r) => ({
    id: r.id,
    public_title: r.public_title || r.name,
    public_price: typeof r.public_price === "number" ? r.public_price : null,
    public_status: r.public_status === "reserved" ? "reserved" : "available",
    public_section: SECTIONS.includes(r.public_section) ? r.public_section : (SECTION_BY_KIND[r.kind] || "singles"),
    public_description: r.public_description || null,
    game: r.game || null,
    set_name: r.set_name || null,
    grade_company: r.grade_company || null,
    grade: r.grade || null,
    kind: r.kind,
    photos: publicPhotos(r.photos, prefix)
  }));
  return Response.json({ items }, {
    headers: { "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" }
  });
}

// Claves R2 → /fotos/<clave>; URLs https tal cual; cualquier otra cosa se descarta.
function publicPhotos(raw, prefix) {
  let a;
  try { a = JSON.parse(raw || "[]"); } catch (_) { return []; }
  if (!Array.isArray(a)) return [];
  return a.map((p) => {
    if (typeof p !== "string") return null;
    if (PHOTO_KEY.test(p) && p.startsWith(prefix)) return "/fotos/" + p;
    return /^https:\/\/[^\s"'<>]+$/i.test(p) ? p : null;
  }).filter(Boolean).slice(0, 8);
}

async function foto(env, url) {
  let key;
  try { key = decodeURIComponent(url.pathname.slice("/fotos/".length)); } catch (_) { key = ""; }
  // Solo fotos de la carpeta del dueño del catálogo (HOLD guarda cada usuario en items/<hash>/)
  const prefix = ownerPrefix(env);
  if (!PHOTO_KEY.test(key) || !key.startsWith(prefix)) return new Response("No encontrada", { status: 404 });
  const obj = await env.PHOTOS.get(key);
  if (!obj) return new Response("No encontrada", { status: 404, headers: { "cache-control": "no-store" } });
  return new Response(obj.body, {
    headers: {
      "content-type": obj.httpMetadata?.contentType || "image/jpeg",
      "cache-control": "public, max-age=31536000, immutable",
      "etag": obj.httpEtag,
      "x-content-type-options": "nosniff"
    }
  });
}

// Misma carpeta que calcula HOLD: items/<primeros 24 hex del SHA-256 del email>/
async function photoPrefix(email) {
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email)));
  return "items/" + [...h.slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("") + "/";
}

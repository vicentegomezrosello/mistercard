// ===== Worker del panel privado mistercard =====
// Sirve la app (assets) y expone una API REST respaldada por D1.
// La identidad del usuario la pone Cloudflare Access en la cabecera
// Cf-Access-Authenticated-User-Email. Cada usuario solo ve SUS datos.

const DEFAULT_CFG = { ahorro: 30, personal: 20, reinv: 50 };

// Columnas de una operación, en orden. Fuente única de verdad para INSERT/SELECT.
const OP_COLS = [
  "id", "fecha", "nombre", "plataforma",
  "compra", "venta", "envio", "embalaje", "otros",
  "comisionPct", "fija", "beneficio", "roi", "neto", "comision",
  "ahorro", "personal", "reinv", "maxProxima"
];

let schemaLista = false; // optimización por isolate; CREATE IF NOT EXISTS igual es idempotente

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/")) {
      const user = request.headers.get("Cf-Access-Authenticated-User-Email");
      if (!user) return json({ error: "no-auth" }, 401);
      if (!env.DB) return json({ error: "sin-base-de-datos" }, 500);
      try {
        await ensureSchema(env);
        return await handleApi(request, env, url, user);
      } catch (e) {
        return json({ error: String((e && e.message) || e) }, 500);
      }
    }

    // Todo lo que no es /api/ lo sirve como archivo estático (la app).
    return env.ASSETS.fetch(request);
  }
};

async function ensureSchema(env) {
  if (schemaLista) return;
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS ops (
         id TEXT, user TEXT, fecha TEXT, nombre TEXT, plataforma TEXT,
         compra REAL, venta REAL, envio REAL, embalaje REAL, otros REAL,
         comisionPct REAL, fija REAL, beneficio REAL, roi REAL, neto REAL,
         comision REAL, ahorro REAL, personal REAL, reinv REAL, maxProxima REAL,
         PRIMARY KEY (user, id)
       )`
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS cfg (
         user TEXT PRIMARY KEY, ahorro INTEGER, personal INTEGER, reinv INTEGER
       )`
    )
  ]);
  schemaLista = true;
}

async function handleApi(request, env, url, user) {
  const p = url.pathname;
  const m = request.method;

  // GET /api/state -> { user, ops, cfg }
  if (p === "/api/state" && m === "GET") {
    const ops = await listOps(env, user);
    const cfg = await getCfg(env, user);
    return json({ user, ops, cfg });
  }

  // POST /api/ops -> inserta/actualiza una operación
  if (p === "/api/ops" && m === "POST") {
    const op = await request.json();
    if (!op || !op.id) return json({ error: "op-sin-id" }, 400);
    await env.DB.prepare(insertSQL()).bind(...bindOp(op, user)).run();
    return json({ ok: true });
  }

  // DELETE /api/ops?id=XXX -> borra una
  if (p === "/api/ops" && m === "DELETE") {
    const id = url.searchParams.get("id");
    if (!id) return json({ error: "falta-id" }, 400);
    await env.DB.prepare("DELETE FROM ops WHERE user=? AND id=?").bind(user, id).run();
    return json({ ok: true });
  }

  // POST /api/clear -> borra todas las del usuario
  if (p === "/api/clear" && m === "POST") {
    await env.DB.prepare("DELETE FROM ops WHERE user=?").bind(user).run();
    return json({ ok: true });
  }

  // PUT /api/cfg -> guarda el reparto
  if (p === "/api/cfg" && m === "PUT") {
    const c = await request.json();
    const ahorro = clampInt(c.ahorro), personal = clampInt(c.personal), reinv = clampInt(c.reinv);
    await env.DB.prepare(
      "INSERT INTO cfg (user, ahorro, personal, reinv) VALUES (?,?,?,?) " +
      "ON CONFLICT(user) DO UPDATE SET ahorro=excluded.ahorro, personal=excluded.personal, reinv=excluded.reinv"
    ).bind(user, ahorro, personal, reinv).run();
    return json({ ok: true });
  }

  // POST /api/replace -> reemplaza TODO (importar copia)
  if (p === "/api/replace" && m === "POST") {
    const body = await request.json();
    const ops = Array.isArray(body.ops) ? body.ops : [];
    const stmts = [env.DB.prepare("DELETE FROM ops WHERE user=?").bind(user)];
    for (const op of ops) {
      if (op && op.id) stmts.push(env.DB.prepare(insertSQL()).bind(...bindOp(op, user)));
    }
    if (body.cfg) {
      const c = body.cfg;
      stmts.push(env.DB.prepare(
        "INSERT INTO cfg (user, ahorro, personal, reinv) VALUES (?,?,?,?) " +
        "ON CONFLICT(user) DO UPDATE SET ahorro=excluded.ahorro, personal=excluded.personal, reinv=excluded.reinv"
      ).bind(user, clampInt(c.ahorro), clampInt(c.personal), clampInt(c.reinv)));
    }
    await env.DB.batch(stmts);
    return json({ ok: true });
  }

  return json({ error: "ruta-desconocida" }, 404);
}

function insertSQL() {
  const cols = ["user", ...OP_COLS];
  const placeholders = cols.map(() => "?").join(",");
  // INSERT OR REPLACE para que reenviar la misma op (reintento) no duplique.
  return `INSERT OR REPLACE INTO ops (${cols.join(",")}) VALUES (${placeholders})`;
}

function bindOp(op, user) {
  const vals = OP_COLS.map(c => {
    const v = op[c];
    if (c === "fecha" || c === "nombre" || c === "plataforma" || c === "id") {
      return v == null ? "" : String(v);
    }
    // numéricos: roi puede ser null; el resto a número o 0
    if (c === "roi") return (typeof v === "number" && Number.isFinite(v)) ? v : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  });
  return [user, ...vals];
}

async function listOps(env, user) {
  const { results } = await env.DB
    .prepare("SELECT * FROM ops WHERE user=? ORDER BY fecha DESC")
    .bind(user).all();
  // Quita la columna interna "user" antes de devolver al cliente.
  return (results || []).map(({ user: _u, ...rest }) => rest);
}

async function getCfg(env, user) {
  const row = await env.DB.prepare("SELECT ahorro, personal, reinv FROM cfg WHERE user=?").bind(user).first();
  if (!row) return { ...DEFAULT_CFG };
  return { ahorro: row.ahorro, personal: row.personal, reinv: row.reinv };
}

function clampInt(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, v));
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}

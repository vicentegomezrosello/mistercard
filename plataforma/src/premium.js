// Calculadora premium: misma lógica que panel.mistercard.es, pero los datos
// van ligados al vendedor (su sesión del panel) en lugar de a un email de Cloudflare Access.

import { json, error } from './util.js';

const DEF_CFG = { ahorro: 30, personal: 20, reinv: 50 };
const OP_COLS = [
  'id', 'fecha', 'nombre', 'plataforma',
  'compra', 'venta', 'envio', 'embalaje', 'otros',
  'comisionPct', 'fija', 'beneficio', 'roi', 'neto', 'comision',
  'ahorro', 'personal', 'reinv', 'maxProxima'
];
const MAX_OPS_REPLACE = 5000;

const insertSQL = () => {
  const cols = ['vendedor_id', ...OP_COLS];
  return `INSERT OR REPLACE INTO premium_ops (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`;
};

function bindOp(op, vid) {
  return [vid, ...OP_COLS.map(c => {
    const v = op[c];
    if (c === 'id') return String(v ?? '').slice(0, 64);
    if (c === 'fecha' || c === 'plataforma') return String(v ?? '').slice(0, 40);
    if (c === 'nombre') return String(v ?? '').slice(0, 160);
    if (c === 'roi') return (typeof v === 'number' && Number.isFinite(v)) ? v : null;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  })];
}

const clampInt = n => {
  const v = Math.round(Number(n));
  return Number.isFinite(v) ? Math.max(0, Math.min(100, v)) : 0;
};

const cfgSQL = 'INSERT INTO premium_cfg (vendedor_id, ahorro, personal, reinv) VALUES (?,?,?,?) ' +
  'ON CONFLICT(vendedor_id) DO UPDATE SET ahorro=excluded.ahorro, personal=excluded.personal, reinv=excluded.reinv';

async function cuerpo(req) {
  try { return await req.json(); } catch (e) { return null; }
}

export async function apiPremium(req, env, ruta, m, url, v, yo) {
  const vid = v.id;

  if (ruta === '/state' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM premium_ops WHERE vendedor_id = ? ORDER BY fecha DESC').bind(vid).all();
    const cfg = await env.DB.prepare('SELECT ahorro, personal, reinv FROM premium_cfg WHERE vendedor_id = ?').bind(vid).first();
    return json({
      user: yo.usuario,
      tienda: v.nombre,
      ops: results.map(({ vendedor_id: _v, ...resto }) => resto),
      cfg: cfg || { ...DEF_CFG }
    });
  }

  // En pausa (impago) se puede consultar, pero no guardar.
  if (v.estado !== 'activo') return error('Tu tienda está en pausa: la calculadora está en modo solo lectura.', 403);

  if (ruta === '/ops' && m === 'POST') {
    const op = await cuerpo(req);
    if (!op || !op.id) return error('Operación sin id');
    await env.DB.prepare(insertSQL()).bind(...bindOp(op, vid)).run();
    return json({ ok: true });
  }
  if (ruta === '/ops' && m === 'DELETE') {
    const id = url.searchParams.get('id');
    if (!id) return error('Falta id');
    await env.DB.prepare('DELETE FROM premium_ops WHERE vendedor_id = ? AND id = ?').bind(vid, id).run();
    return json({ ok: true });
  }
  if (ruta === '/clear' && m === 'POST') {
    await env.DB.prepare('DELETE FROM premium_ops WHERE vendedor_id = ?').bind(vid).run();
    return json({ ok: true });
  }
  if (ruta === '/cfg' && m === 'PUT') {
    const c = (await cuerpo(req)) || {};
    await env.DB.prepare(cfgSQL).bind(vid, clampInt(c.ahorro), clampInt(c.personal), clampInt(c.reinv)).run();
    return json({ ok: true });
  }
  // Importar copia: reemplaza todo (sirve para traer los datos de panel.mistercard.es).
  if (ruta === '/replace' && m === 'POST') {
    const b = (await cuerpo(req)) || {};
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, MAX_OPS_REPLACE) : [];
    const stmts = [env.DB.prepare('DELETE FROM premium_ops WHERE vendedor_id = ?').bind(vid)];
    for (const op of ops) if (op && op.id) stmts.push(env.DB.prepare(insertSQL()).bind(...bindOp(op, vid)));
    if (b.cfg) stmts.push(env.DB.prepare(cfgSQL).bind(vid, clampInt(b.cfg.ahorro), clampInt(b.cfg.personal), clampInt(b.cfg.reinv)));
    await env.DB.batch(stmts);
    return json({ ok: true });
  }
  return error('No encontrado', 404);
}

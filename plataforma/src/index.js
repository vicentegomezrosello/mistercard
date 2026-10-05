// Plataforma de tiendas TCG: una sola aplicación, una tienda por vendedor.
// Cada dominio (cartaspepe.es) muestra la tienda de su vendedor; /panel es el
// panel del vendedor y /superpanel, en el dominio de la plataforma, es el tuyo.

import {
  json, error, ahora, uid, aleatorio, claveLegible, sha256, hashClave, igualSeguro,
  leeCookie, cookieSesion, limpiaTexto, slugValido, normalizaHost, hostValido
} from './util.js';
import {
  APARTADOS, DISPONIBILIDAD, JUEGOS, FONDOS, configPorDefecto, CAMPOS_EDITABLES,
  cssTema, datosPublicos
} from './tienda.js';
import { apiPremium } from './premium.js';
import { dominioRaiz, preparaZona, compruebaZona, conectaHost, desconectaHost } from './cloudflare.js';

const DIAS_SESION = 30;
const MAX_FOTO = 4 * 1024 * 1024;          // 4 MB (las fotos llegan ya comprimidas del móvil)
const MAX_FOTOS_CARTA = 8;
const DIAS_VENDIDAS_VISIBLES = 30;          // las vendidas desaparecen solas de la tienda

export default {
  async fetch(req, env, ctx) {
    try {
      return await enruta(req, env, ctx);
    } catch (e) {
      console.error(e);
      return (new URL(req.url)).pathname.startsWith('/api/')
        ? error('Ha habido un error. Inténtalo de nuevo.', 500)
        : new Response('Error temporal. Inténtalo de nuevo en un momento.', { status: 500 });
    }
  }
};

function esHostPlataforma(env, host) {
  return host === normalizaHost(env.HOST_PLATAFORMA) || host.endsWith('.workers.dev') ||
    host === 'localhost' || host === '127.0.0.1';
}

async function enruta(req, env, ctx) {
  const url = new URL(req.url);
  const host = normalizaHost(url.host);
  const ruta = url.pathname;
  const plataforma = esHostPlataforma(env, host);

  if (ruta.startsWith('/api/')) return api(req, env, ctx, url, host, plataforma);
  if (ruta.startsWith('/img/')) return foto(req, env, ctx, ruta.slice(5));

  // Paneles (archivos estáticos). El superpanel solo existe en el dominio de la plataforma.
  if (ruta === '/panel') return Response.redirect(url.origin + '/panel/', 302);
  if (ruta === '/panel/premium' || ruta === '/panel/premium/') return env.ASSETS.fetch(new Request(url.origin + '/panel/premium.html'));
  if (ruta.startsWith('/panel/')) return env.ASSETS.fetch(new Request(url.origin + '/panel/index.html'));
  if (ruta.startsWith('/superpanel')) {
    if (!plataforma) return noEncontrado();
    if (ruta === '/superpanel') return Response.redirect(url.origin + '/superpanel/', 302);
    return env.ASSETS.fetch(new Request(url.origin + '/superpanel/index.html'));
  }

  // Tienda: por dominio propio o, en el dominio de la plataforma, por /t/<vendedor>/
  let vendedor = null, base = '/';
  if (plataforma) {
    const m = ruta.match(/^\/t\/([a-z0-9-]+)(\/.*)?$/);
    if (!m) {
      if (ruta === '/') return Response.redirect(url.origin + '/superpanel/', 302);
      return noEncontrado();
    }
    vendedor = await env.DB.prepare('SELECT * FROM vendedores WHERE id = ?').bind(m[1]).first();
    base = `/t/${m[1]}/`;
    if (!m[2]) return Response.redirect(url.origin + base, 302);
  } else {
    vendedor = await vendedorPorHost(env, host);
  }
  if (!vendedor || vendedor.estado === 'baja') return noEncontrado('Esta tienda no existe o ya no está disponible.');

  const sub = plataforma ? ruta.slice(base.length - 1) : ruta;
  if (sub === '/favicon.svg' || sub === '/favicon.ico') return favicon(vendedor);
  if (sub === '/robots.txt') return new Response(`User-agent: *\nAllow: /\nDisallow: /panel/\nSitemap: ${url.origin}/sitemap.xml\n`, { headers: { 'content-type': 'text/plain' } });
  if (sub === '/sitemap.xml') return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${url.origin}${base}</loc><changefreq>daily</changefreq></url></urlset>`, { headers: { 'content-type': 'application/xml' } });
  if (sub !== '/' && sub !== '/index.html') return noEncontrado();
  return tienda(req, env, ctx, vendedor, url.origin + base);
}

async function vendedorPorHost(env, host) {
  const sql = 'SELECT v.* FROM dominios d JOIN vendedores v ON v.id = d.vendedor_id WHERE d.host = ?';
  return (await env.DB.prepare(sql).bind(host).first()) ||
    (host.startsWith('www.') ? null : await env.DB.prepare(sql).bind('www.' + host).first()) ||
    (host.startsWith('www.') ? await env.DB.prepare(sql).bind(host.slice(4)).first() : null);
}

function noEncontrado(msg = 'Página no encontrada.') {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>No disponible</title><body style="margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:#0a1424;color:#f4ece0;font-family:system-ui,sans-serif;text-align:center;padding:24px"><p style="font-size:18px">${msg}</p></body>`,
    { status: 404, headers: { 'content-type': 'text/html; charset=utf-8' } });
}

function favicon(v) {
  const cfg = JSON.parse(v.config || '{}');
  const letra = (v.nombre || '?').trim().charAt(0).toUpperCase().replace(/[<&>]/g, '');
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="14" fill="${/^#[0-9a-f]{6}$/i.test(cfg.color) ? cfg.color : '#e0a84e'}"/><text x="32" y="44" font-family="Arial,sans-serif" font-size="36" font-weight="700" text-anchor="middle" fill="#0a1424">${letra}</text></svg>`;
  return new Response(svg, { headers: { 'content-type': 'image/svg+xml', 'cache-control': 'public, max-age=86400' } });
}

// ---------------------------------------------------------------- Tienda pública

async function tienda(req, env, ctx, vendedor, urlBase) {
  // La caché se identifica con la fecha del último cambio: al editar algo en el
  // panel cambia la fecha y la próxima visita ya ve la versión nueva.
  const clave = new Request(urlBase + '?__v=' + encodeURIComponent(vendedor.actualizado + '|' + vendedor.estado));
  const cache = caches.default;
  const alNavegador = r => {
    // El navegador siempre revalida (así los cambios del panel se ven al momento);
    // la copia rápida vive en la caché de Cloudflare.
    const h = new Headers(r.headers); h.set('cache-control', 'no-cache');
    return new Response(r.body, { status: r.status, headers: h });
  };
  const enCache = await cache.match(clave);
  if (enCache) return alNavegador(enCache);

  let datos;
  if (vendedor.estado === 'pausado') {
    datos = datosPublicos(vendedor, []);
    datos.aviso_estado = 'La tienda está en pausa temporalmente. Vuelve pronto.';
  } else {
    const { results } = await env.DB.prepare(
      `SELECT * FROM cartas WHERE vendedor_id = ?
         AND (disponibilidad != 'Vendida' OR actualizado > datetime('now', ?))
       ORDER BY apartado, orden, creado DESC`
    ).bind(vendedor.id, `-${DIAS_VENDIDAS_VISIBLES} days`).all();
    datos = datosPublicos(vendedor, results);
  }

  const s = datos.sitio;
  const titulo = `${s.nombre} · Cartas TCG coleccionables`;
  const desc = `Escaparate de cartas TCG de ${s.nombre}${s.ciudad ? ', envíos desde ' + s.ciudad : ''}. Fotos reales, estado y precio. Reserva por Instagram.`;
  const og = s.destacada_foto || s.logo_url;
  const cfg = JSON.parse(vendedor.config || '{}');
  const payload = JSON.stringify(datos).replace(/</g, '\\u003c');

  const plantilla = await env.ASSETS.fetch(new Request(new URL('/tienda.html', urlBase)));
  const pon = (sel, attr, val) => [sel, { element(e) { e.setAttribute(attr, val); } }];
  let rw = new HTMLRewriter()
    .on('title', { element(e) { e.setInnerContent(titulo); } })
    .on('style#tema', { element(e) { e.setInnerContent(cssTema(cfg)); } })
    .on('head', { element(e) { e.append(`<meta name="theme-color" content="${FONDOS[cfg.fondo] || FONDOS.noche}">`, { html: true }); } })
    .on('body', { element(e) { e.prepend(`<script>window.__DATOS=${payload};</script>`, { html: true }); } });
  for (const [sel, h] of [
    pon('meta[name=description]', 'content', desc),
    pon('link[rel=canonical]', 'href', urlBase),
    pon('meta[property="og:site_name"]', 'content', s.nombre),
    pon('meta[property="og:url"]', 'content', urlBase),
    pon('meta[property="og:title"]', 'content', titulo),
    pon('meta[property="og:description"]', 'content', desc),
    pon('meta[property="og:image"]', 'content', og ? new URL(og, urlBase).href : ''),
    pon('link[rel=icon]', 'href', new URL('favicon.svg', urlBase).pathname),
    pon('link[rel=apple-touch-icon]', 'href', new URL('favicon.svg', urlBase).pathname)
  ]) rw = rw.on(sel, h);

  const html = await rw.transform(plantilla).text();
  const resp = new Response(html, {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=86400',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'strict-origin-when-cross-origin'
    }
  });
  ctx.waitUntil(cache.put(clave, resp.clone()));
  return alNavegador(resp);
}

async function foto(req, env, ctx, clave) {
  if (!/^v\/[a-z0-9-]+\/[a-z0-9]+\.(webp|jpg|png)$/.test(clave)) return new Response('No encontrada', { status: 404 });
  const cache = caches.default;
  const enCache = await cache.match(req);
  if (enCache) return enCache;
  const obj = await env.FOTOS.get(clave);
  if (!obj) return new Response('No encontrada', { status: 404 });
  const resp = new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType || 'image/webp',
      'cache-control': 'public, max-age=31536000, immutable',
      etag: obj.httpEtag
    }
  });
  ctx.waitUntil(cache.put(req, resp.clone()));
  return resp;
}

// Marca la tienda como modificada: cambia la clave de caché de la página pública.
const tocaVendedor = (env, id) =>
  env.DB.prepare("UPDATE vendedores SET actualizado = datetime('now') WHERE id = ?").bind(id).run();

// ---------------------------------------------------------------- API

async function api(req, env, ctx, url, host, plataforma) {
  const ruta = url.pathname.slice(4); // sin "/api"
  const m = req.method;

  // Protección CSRF: las peticiones que cambian algo deben venir de esta misma web.
  if (m !== 'GET' && m !== 'HEAD') {
    const origen = req.headers.get('origin');
    if (origen && normalizaHost(origen) !== host) return error('Origen no permitido', 403);
  }

  if (ruta === '/login' && m === 'POST') return login(req, env, host, plataforma, url);
  if (ruta === '/logout' && m === 'POST') return logout(req, env, url);

  const yo = await usuarioActual(req, env);
  if (!yo) return error('Tienes que iniciar sesión', 401);

  if (ruta === '/yo' && m === 'GET') return infoYo(env, yo, url);
  if (ruta === '/clave' && m === 'PUT') return cambiaClave(req, env, yo);

  // Calculadora premium: solo el propio vendedor (ni el superadmin) y solo si la tiene contratada.
  if (ruta.startsWith('/premium/')) {
    if (yo.rol !== 'vendedor') return error('La calculadora premium es privada de cada vendedor.', 403);
    const v = await env.DB.prepare('SELECT * FROM vendedores WHERE id = ?').bind(yo.vendedor_id).first();
    if (!v || v.estado === 'baja') return error('Tienda no disponible', 403);
    if (!v.premium) return error('La calculadora premium no está activada en tu plan.', 403);
    return apiPremium(req, env, ruta.slice(8), m, url, v, yo);
  }

  if (ruta.startsWith('/super/')) {
    if (yo.rol !== 'super' || !plataforma) return error('No permitido', 403);
    return apiSuper(req, env, ctx, ruta.slice(6), m, url);
  }

  if (ruta.startsWith('/panel/')) {
    // El superadmin puede entrar al panel de cualquier vendedor con ?v=<id>.
    const vid = yo.rol === 'super' ? url.searchParams.get('v') : yo.vendedor_id;
    const v = vid ? await env.DB.prepare('SELECT * FROM vendedores WHERE id = ?').bind(vid).first() : null;
    if (!v || v.estado === 'baja') return error('Tienda no disponible', 403);
    if (v.estado === 'pausado' && m !== 'GET' && yo.rol !== 'super') {
      return error('Tu tienda está en pausa. Contacta con soporte para reactivarla.', 403);
    }
    return apiPanel(req, env, ctx, ruta.slice(6), m, v);
  }
  return error('No encontrado', 404);
}

async function cuerpo(req) {
  try { return await req.json(); } catch (e) { return {}; }
}

// ---- Sesiones

async function login(req, env, host, plataforma, url) {
  const b = await cuerpo(req);
  const usuario = limpiaTexto(b.usuario, 60).toLowerCase();
  const clave = String(b.clave || '');
  if (!usuario || !clave) return error('Escribe usuario y contraseña');

  // Máximo 8 intentos fallidos cada 15 minutos por IP y usuario.
  const ip = req.headers.get('cf-connecting-ip') || 'local';
  const kInt = await sha256(ip + '|' + usuario);
  const int = await env.DB.prepare("SELECT n, desde FROM intentos WHERE clave = ? AND desde > datetime('now','-15 minutes')").bind(kInt).first();
  if (int && int.n >= 8) return error('Demasiados intentos. Espera 15 minutos.', 429);
  const fallo = async () => {
    await env.DB.prepare(`INSERT INTO intentos (clave, n, desde) VALUES (?, 1, datetime('now'))
      ON CONFLICT(clave) DO UPDATE SET n = CASE WHEN desde > datetime('now','-15 minutes') THEN n + 1 ELSE 1 END,
      desde = CASE WHEN desde > datetime('now','-15 minutes') THEN desde ELSE datetime('now') END`).bind(kInt).run();
    return error('Usuario o contraseña incorrectos', 401);
  };

  let u = null;
  if (usuario === 'admin') {
    // Superadmin: su contraseña es el secreto SUPER_CLAVE del Worker. Solo en el dominio de la plataforma.
    if (!plataforma || !env.SUPER_CLAVE || !igualSeguro(await sha256(clave), await sha256(env.SUPER_CLAVE))) return fallo();
    await env.DB.prepare("INSERT OR IGNORE INTO usuarios (id, vendedor_id, usuario, pass_hash, pass_sal, rol) VALUES ('super', NULL, 'admin', '-', '-', 'super')").run();
    u = { id: 'super' };
  } else {
    const fila = await env.DB.prepare('SELECT * FROM usuarios WHERE usuario = ? AND rol = ?').bind(usuario, 'vendedor').first();
    if (!fila || !igualSeguro(await hashClave(clave, fila.pass_sal), fila.pass_hash)) return fallo();
    // En el dominio propio de una tienda solo puede entrar su vendedor.
    if (!plataforma) {
      const v = await vendedorPorHost(env, host);
      if (!v || v.id !== fila.vendedor_id) return fallo();
    }
    u = fila;
  }
  await env.DB.prepare('DELETE FROM intentos WHERE clave = ?').bind(kInt).run();

  const token = aleatorio(32);
  await env.DB.prepare("INSERT INTO sesiones (token, usuario_id, expira) VALUES (?, ?, datetime('now', ?))")
    .bind(await sha256(token), u.id, `+${DIAS_SESION} days`).run();
  // De paso, limpia sesiones caducadas.
  await env.DB.prepare("DELETE FROM sesiones WHERE expira < datetime('now')").run();
  return json({ ok: true }, 200, { 'set-cookie': cookieSesion(token, DIAS_SESION * 86400, url.protocol === 'https:') });
}

async function logout(req, env, url) {
  const t = leeCookie(req, 'sesion');
  if (t) await env.DB.prepare('DELETE FROM sesiones WHERE token = ?').bind(await sha256(t)).run();
  return json({ ok: true }, 200, { 'set-cookie': cookieSesion('', 0, url.protocol === 'https:') });
}

async function usuarioActual(req, env) {
  const t = leeCookie(req, 'sesion');
  if (!t) return null;
  return env.DB.prepare(`SELECT u.id, u.vendedor_id, u.usuario, u.rol FROM sesiones s JOIN usuarios u ON u.id = s.usuario_id
    WHERE s.token = ? AND s.expira > datetime('now')`).bind(await sha256(t)).first();
}

async function infoYo(env, yo, url) {
  const vid = yo.rol === 'super' ? url.searchParams.get('v') : yo.vendedor_id;
  const v = vid ? await env.DB.prepare('SELECT id, nombre, estado, config, prefijo_ref, premium FROM vendedores WHERE id = ?').bind(vid).first() : null;
  let dominio = null;
  if (v) {
    const d = await env.DB.prepare("SELECT host FROM dominios WHERE vendedor_id = ? AND host NOT LIKE 'www.%' ORDER BY estado = 'activo' DESC LIMIT 1").bind(v.id).first();
    dominio = d ? d.host : null;
  }
  return json({
    usuario: yo.usuario, rol: yo.rol,
    vendedor: v ? { id: v.id, nombre: v.nombre, estado: v.estado, prefijo: v.prefijo_ref, premium: !!v.premium, config: JSON.parse(v.config), dominio } : null,
    juegos: JUEGOS, apartados: APARTADOS, disponibilidad: DISPONIBILIDAD, fondos: FONDOS
  });
}

async function cambiaClave(req, env, yo) {
  if (yo.rol === 'super') return error('La contraseña de admin se cambia en el secreto SUPER_CLAVE del Worker.');
  const b = await cuerpo(req);
  const fila = await env.DB.prepare('SELECT * FROM usuarios WHERE id = ?').bind(yo.id).first();
  if (!igualSeguro(await hashClave(String(b.actual || ''), fila.pass_sal), fila.pass_hash)) return error('La contraseña actual no es correcta');
  const nueva = String(b.nueva || '');
  if (nueva.length < 8) return error('La contraseña nueva debe tener al menos 8 caracteres');
  const sal = aleatorio(16);
  await env.DB.prepare('UPDATE usuarios SET pass_hash = ?, pass_sal = ? WHERE id = ?').bind(await hashClave(nueva, sal), sal, yo.id).run();
  return json({ ok: true });
}

// ---- Panel del vendedor

function validaCarta(b, parcial = false) {
  const c = {};
  if (!parcial || 'nombre' in b) {
    c.nombre = limpiaTexto(b.nombre, 120);
    if (!c.nombre) return { error: 'La carta necesita un nombre' };
  }
  if (!parcial || 'apartado' in b) c.apartado = APARTADOS.includes(b.apartado) ? b.apartado : 'sueltas';
  if ('set' in b) c.set_detalle = limpiaTexto(b.set, 120);
  if ('juego' in b) c.juego = limpiaTexto(b.juego, 40);
  if ('estado_carta' in b) c.estado_carta = limpiaTexto(b.estado_carta, 60);
  if ('cert' in b) c.cert = limpiaTexto(b.cert, 40);
  if ('precio' in b) {
    const p = b.precio === '' || b.precio === null ? null : Number(String(b.precio).replace(',', '.'));
    if (p !== null && (!isFinite(p) || p < 0 || p > 10000000)) return { error: 'Precio no válido' };
    c.precio = p === null ? null : Math.round(p * 100) / 100;
  }
  if (!parcial || 'disponibilidad' in b) c.disponibilidad = DISPONIBILIDAD.includes(b.disponibilidad) ? b.disponibilidad : 'Disponible';
  if ('fotos' in b) {
    if (!Array.isArray(b.fotos)) return { error: 'Fotos no válidas' };
    c.fotos = b.fotos.filter(f => typeof f === 'string').slice(0, MAX_FOTOS_CARTA);
  }
  return { c };
}

async function apiPanel(req, env, ctx, ruta, m, v) {
  const prefijoFotos = `v/${v.id}/`;

  if (ruta === '/cartas' && m === 'GET') {
    const { results } = await env.DB.prepare('SELECT * FROM cartas WHERE vendedor_id = ? ORDER BY apartado, orden, creado DESC').bind(v.id).all();
    return json({ cartas: results.map(c => ({ ...c, fotos: JSON.parse(c.fotos) })) });
  }

  if (ruta === '/cartas' && m === 'POST') {
    const b = await cuerpo(req);
    const { c, error: e } = validaCarta(b);
    if (e) return error(e);
    c.fotos = (c.fotos || []).filter(f => f.startsWith(prefijoFotos));
    // Referencia automática: siguiente número libre (MC-010, MC-011…).
    const fila = await env.DB.prepare('UPDATE vendedores SET sig_ref = sig_ref + 1 WHERE id = ? RETURNING sig_ref - 1 AS n, prefijo_ref').bind(v.id).first();
    const ref = `${fila.prefijo_ref}-${String(fila.n).padStart(3, '0')}`;
    const id = uid();
    const minOrden = await env.DB.prepare('SELECT COALESCE(MIN(orden), 0) - 1 AS o FROM cartas WHERE vendedor_id = ? AND apartado = ?').bind(v.id, c.apartado).first();
    await env.DB.prepare(`INSERT INTO cartas (id, vendedor_id, ref, apartado, nombre, set_detalle, juego, estado_carta, cert, precio, disponibilidad, fotos, orden)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).bind(id, v.id, ref, c.apartado, c.nombre, c.set_detalle || '', c.juego || '', c.estado_carta || '',
      c.cert || '', c.precio ?? null, c.disponibilidad, JSON.stringify(c.fotos), minOrden.o).run();
    await tocaVendedor(env, v.id);
    return json({ ok: true, id, ref });
  }

  const mc = ruta.match(/^\/cartas\/([a-z0-9]+)(\/estado)?$/);
  if (mc) {
    const actual = await env.DB.prepare('SELECT * FROM cartas WHERE id = ? AND vendedor_id = ?').bind(mc[1], v.id).first();
    if (!actual) return error('Carta no encontrada', 404);
    const fotosAntes = JSON.parse(actual.fotos);

    if (mc[2] && m === 'POST') {
      const b = await cuerpo(req);
      if (!DISPONIBILIDAD.includes(b.disponibilidad)) return error('Estado no válido');
      await env.DB.prepare("UPDATE cartas SET disponibilidad = ?, actualizado = datetime('now') WHERE id = ?").bind(b.disponibilidad, actual.id).run();
      await tocaVendedor(env, v.id);
      return json({ ok: true });
    }
    if (!mc[2] && m === 'PUT') {
      const b = await cuerpo(req);
      const { c, error: e } = validaCarta(b, true);
      if (e) return error(e);
      if (c.fotos) c.fotos = c.fotos.filter(f => f.startsWith(prefijoFotos));
      const campos = Object.keys(c);
      if (!campos.length) return json({ ok: true });
      const vals = campos.map(k => k === 'fotos' ? JSON.stringify(c[k]) : c[k]);
      await env.DB.prepare(`UPDATE cartas SET ${campos.map(k => k + ' = ?').join(', ')}, actualizado = datetime('now') WHERE id = ?`)
        .bind(...vals, actual.id).run();
      if (c.fotos) {
        const quitadas = fotosAntes.filter(f => !c.fotos.includes(f));
        if (quitadas.length) ctx.waitUntil(env.FOTOS.delete(quitadas));
      }
      await tocaVendedor(env, v.id);
      return json({ ok: true });
    }
    if (!mc[2] && m === 'DELETE') {
      await env.DB.prepare('DELETE FROM cartas WHERE id = ?').bind(actual.id).run();
      if (fotosAntes.length) ctx.waitUntil(env.FOTOS.delete(fotosAntes));
      await tocaVendedor(env, v.id);
      return json({ ok: true });
    }
  }

  if (ruta === '/orden' && m === 'POST') {
    const b = await cuerpo(req);
    const ids = Array.isArray(b.ids) ? b.ids.slice(0, 2000) : [];
    const stmts = ids.map((id, i) => env.DB.prepare('UPDATE cartas SET orden = ? WHERE id = ? AND vendedor_id = ?').bind(i, String(id), v.id));
    if (stmts.length) await env.DB.batch(stmts);
    await tocaVendedor(env, v.id);
    return json({ ok: true });
  }

  if (ruta === '/fotos' && m === 'POST') {
    const tipo = (req.headers.get('content-type') || '').split(';')[0];
    const ext = { 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png' }[tipo];
    if (!ext) return error('Formato de foto no admitido');
    const largo = Number(req.headers.get('content-length') || 0);
    if (largo > MAX_FOTO) return error('La foto es demasiado grande');
    const datos = await req.arrayBuffer();
    if (!datos.byteLength || datos.byteLength > MAX_FOTO) return error('La foto es demasiado grande');
    const clave = `${prefijoFotos}${uid()}${uid()}.${ext}`;
    await env.FOTOS.put(clave, datos, { httpMetadata: { contentType: tipo } });
    return json({ ok: true, clave, url: '/img/' + clave });
  }

  if (ruta === '/tienda' && m === 'GET') {
    return json({ config: JSON.parse(v.config), nombre: v.nombre });
  }

  if (ruta === '/tienda' && m === 'PUT') {
    const b = await cuerpo(req);
    const cfg = JSON.parse(v.config);
    for (const [k, max] of Object.entries(CAMPOS_EDITABLES)) {
      if (k in b) cfg[k] = limpiaTexto(b[k], max);
    }
    if (cfg.instagram) cfg.instagram = cfg.instagram.replace(/^@/, '').replace(/[^a-zA-Z0-9._]/g, '');
    if (cfg.whatsapp) cfg.whatsapp = cfg.whatsapp.replace(/\D/g, '');
    if (!/^#[0-9a-f]{6}$/i.test(cfg.color)) cfg.color = '#e0a84e';
    if (!FONDOS[cfg.fondo]) cfg.fondo = 'noche';
    if ('columnas' in b) cfg.columnas = Math.min(6, Math.max(2, parseInt(b.columnas, 10) || 4));
    if ('compro_visible' in b) cfg.compro_visible = !!b.compro_visible;
    if ('destacada_carta' in b) cfg.destacada_carta = b.destacada_carta ? String(b.destacada_carta) : null;
    if (Array.isArray(b.garantias)) cfg.garantias = b.garantias.map(x => limpiaTexto(x, 60)).filter(Boolean).slice(0, 6);
    if (Array.isArray(b.compro_lista)) cfg.compro_lista = b.compro_lista.map(x => limpiaTexto(x, 40)).filter(Boolean).slice(0, 12);
    if (Array.isArray(b.pasos)) cfg.pasos = b.pasos.slice(0, 5).map(p => ({ titulo: limpiaTexto(p && p.titulo, 60), texto: limpiaTexto(p && p.texto, 240) })).filter(p => p.titulo || p.texto);
    if (b.apartados && typeof b.apartados === 'object') {
      for (const k of APARTADOS) {
        const a = b.apartados[k];
        if (!a) continue;
        cfg.apartados[k] = {
          nombre: limpiaTexto(a.nombre, 40) || cfg.apartados[k].nombre,
          visible: !!a.visible,
          orden: Math.min(9, Math.max(1, parseInt(a.orden, 10) || 1))
        };
      }
    }
    if ('logo' in b) {
      const antes = cfg.logo;
      cfg.logo = b.logo && String(b.logo).startsWith(prefijoFotos) ? String(b.logo) : null;
      if (antes && antes !== cfg.logo) ctx.waitUntil(env.FOTOS.delete(antes));
    }
    await env.DB.prepare("UPDATE vendedores SET config = ?, actualizado = datetime('now') WHERE id = ?").bind(JSON.stringify(cfg), v.id).run();
    return json({ ok: true, config: cfg });
  }

  return error('No encontrado', 404);
}

// ---- Superpanel (solo tú)

async function apiSuper(req, env, ctx, ruta, m, url) {
  if (ruta === '/vendedores' && m === 'GET') {
    const { results } = await env.DB.prepare(`SELECT v.id, v.nombre, v.estado, v.premium, v.notas, v.creado, v.actualizado,
      (SELECT COUNT(*) FROM cartas c WHERE c.vendedor_id = v.id) AS n_cartas,
      (SELECT usuario FROM usuarios u WHERE u.vendedor_id = v.id LIMIT 1) AS usuario
      FROM vendedores v ORDER BY v.creado`).all();
    const { results: doms } = await env.DB.prepare('SELECT * FROM dominios').all();
    return json({ vendedores: results.map(v => ({ ...v, dominios: doms.filter(d => d.vendedor_id === v.id) })), host_plataforma: env.HOST_PLATAFORMA || url.host });
  }

  if (ruta === '/vendedores' && m === 'POST') {
    const b = await cuerpo(req);
    const id = limpiaTexto(b.id, 32).toLowerCase();
    const nombre = limpiaTexto(b.nombre, 60);
    if (!slugValido(id)) return error('Identificador no válido: usa minúsculas, números y guiones (ej. cartaspepe)');
    if (!nombre) return error('Falta el nombre de la tienda');
    if (await env.DB.prepare('SELECT 1 FROM vendedores WHERE id = ?').bind(id).first()) return error('Ya existe un vendedor con ese identificador');
    const dominio = normalizaHost(b.dominio).replace(/^www\./, '');
    if (dominio && !hostValido(dominio)) return error('Dominio no válido');
    if (dominio && await env.DB.prepare('SELECT 1 FROM dominios WHERE host = ?').bind(dominio).first()) return error('Ese dominio ya está asignado');
    const palabras = nombre.normalize('NFD').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean);
    const auto = palabras.length > 1 ? palabras.map(w => w[0]).join('').slice(0, 3) : (palabras[0] || '').slice(0, 2);
    const prefijo = (limpiaTexto(b.prefijo, 4).toUpperCase().replace(/[^A-Z]/g, '') || auto.toUpperCase() || 'TC');
    const color = /^#[0-9a-f]{6}$/i.test(b.color || '') ? b.color : '#e0a84e';
    const cfg = configPorDefecto({
      nombre, ciudad: limpiaTexto(b.ciudad, 60),
      instagram: limpiaTexto(b.instagram, 40).replace(/^@/, ''),
      whatsapp: String(b.whatsapp || '').replace(/\D/g, ''), color, fondo: b.fondo
    });
    const usuario = (limpiaTexto(b.usuario, 40).toLowerCase() || id).replace(/[^a-z0-9._-]/g, '');
    if (await env.DB.prepare('SELECT 1 FROM usuarios WHERE usuario = ?').bind(usuario).first()) return error('Ese nombre de usuario ya existe');
    const clave = claveLegible(10);
    const sal = aleatorio(16);
    const stmts = [
      env.DB.prepare('INSERT INTO vendedores (id, nombre, config, prefijo_ref, notas, premium) VALUES (?,?,?,?,?,?)').bind(id, nombre, JSON.stringify(cfg), prefijo, limpiaTexto(b.notas, 500), b.premium ? 1 : 0),
      env.DB.prepare("INSERT INTO usuarios (id, vendedor_id, usuario, pass_hash, pass_sal, rol) VALUES (?,?,?,?,?, 'vendedor')").bind(uid(), id, usuario, await hashClave(clave, sal), sal)
    ];
    if (dominio) {
      stmts.push(env.DB.prepare('INSERT INTO dominios (host, vendedor_id) VALUES (?, ?)').bind(dominio, id));
      stmts.push(env.DB.prepare('INSERT INTO dominios (host, vendedor_id) VALUES (?, ?)').bind('www.' + dominio, id));
    }
    await env.DB.batch(stmts);
    return json({ ok: true, id, usuario, clave, dominio, vista_previa: `https://${env.HOST_PLATAFORMA || url.host}/t/${id}/` });
  }

  const mv = ruta.match(/^\/vendedores\/([a-z0-9-]+)(\/[a-z]+)?$/);
  if (mv) {
    const v = await env.DB.prepare('SELECT * FROM vendedores WHERE id = ?').bind(mv[1]).first();
    if (!v) return error('Vendedor no encontrado', 404);
    const accion = mv[2];

    if (accion === '/estado' && m === 'POST') {
      const b = await cuerpo(req);
      if (!['activo', 'pausado', 'baja'].includes(b.estado)) return error('Estado no válido');
      await env.DB.prepare("UPDATE vendedores SET estado = ?, actualizado = datetime('now') WHERE id = ?").bind(b.estado, v.id).run();
      if (b.estado !== 'activo') {
        // Cierra las sesiones del vendedor para que vea el cambio al momento.
        await env.DB.prepare('DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE vendedor_id = ?)').bind(v.id).run();
      }
      return json({ ok: true });
    }
    if (accion === '/clave' && m === 'POST') {
      const clave = claveLegible(10);
      const sal = aleatorio(16);
      const hash = await hashClave(clave, sal);
      const existe = await env.DB.prepare('SELECT 1 FROM usuarios WHERE vendedor_id = ?').bind(v.id).first();
      if (existe) await env.DB.prepare('UPDATE usuarios SET pass_hash = ?, pass_sal = ? WHERE vendedor_id = ?').bind(hash, sal, v.id).run();
      else await env.DB.prepare("INSERT INTO usuarios (id, vendedor_id, usuario, pass_hash, pass_sal, rol) VALUES (?,?,?,?,?, 'vendedor')").bind(uid(), v.id, v.id, hash, sal).run();
      await env.DB.prepare('DELETE FROM sesiones WHERE usuario_id IN (SELECT id FROM usuarios WHERE vendedor_id = ?)').bind(v.id).run();
      const u = await env.DB.prepare('SELECT usuario FROM usuarios WHERE vendedor_id = ?').bind(v.id).first();
      return json({ ok: true, usuario: u && u.usuario, clave });
    }
    if (accion === '/premium' && m === 'POST') {
      const b = await cuerpo(req);
      await env.DB.prepare('UPDATE vendedores SET premium = ? WHERE id = ?').bind(b.activo ? 1 : 0, v.id).run();
      return json({ ok: true });
    }
    if (accion === '/notas' && m === 'PUT') {
      const b = await cuerpo(req);
      await env.DB.prepare('UPDATE vendedores SET notas = ? WHERE id = ?').bind(limpiaTexto(b.notas, 1000), v.id).run();
      return json({ ok: true });
    }
    if (accion === '/dominio' && m === 'POST') {
      const b = await cuerpo(req);
      const dominio = normalizaHost(b.dominio).replace(/^www\./, '');
      if (!hostValido(dominio)) return error('Dominio no válido');
      const ocupado = await env.DB.prepare('SELECT vendedor_id FROM dominios WHERE host = ?').bind(dominio).first();
      if (ocupado && ocupado.vendedor_id !== v.id) return error('Ese dominio ya está asignado a otro vendedor');
      await env.DB.batch([
        env.DB.prepare('INSERT OR IGNORE INTO dominios (host, vendedor_id) VALUES (?, ?)').bind(dominio, v.id),
        env.DB.prepare('INSERT OR IGNORE INTO dominios (host, vendedor_id) VALUES (?, ?)').bind('www.' + dominio, v.id)
      ]);
      return json({ ok: true });
    }
    // Borrado definitivo: solo para vendedores dados de baja, y escribiendo su identificador.
    if (!accion && m === 'DELETE') {
      const b = await cuerpo(req);
      if (v.estado !== 'baja') return error('Primero da de baja al vendedor');
      if (b.confirmar !== v.id) return error('Escribe el identificador del vendedor para confirmar');
      const { results } = await env.DB.prepare('SELECT host FROM dominios WHERE vendedor_id = ? AND estado = ?').bind(v.id, 'activo').all();
      for (const d of results) { try { await desconectaHost(env, d.host); } catch (e) { /* seguimos */ } }
      let cursor;
      do {
        const lista = await env.FOTOS.list({ prefix: `v/${v.id}/`, cursor });
        if (lista.objects.length) await env.FOTOS.delete(lista.objects.map(o => o.key));
        cursor = lista.truncated ? lista.cursor : null;
      } while (cursor);
      await env.DB.prepare('DELETE FROM vendedores WHERE id = ?').bind(v.id).run();
      return json({ ok: true });
    }
  }

  // Conexión del dominio en Cloudflare: paso 1 (crear zona y obtener DNS) y paso 2 (comprobar y enganchar).
  const md = ruta.match(/^\/dominios\/([a-z0-9.-]+)\/(preparar|comprobar|quitar)$/);
  if (md && m === 'POST') {
    const host = md[1];
    const d = await env.DB.prepare('SELECT * FROM dominios WHERE host = ?').bind(host).first();
    if (!d) return error('Dominio no encontrado', 404);
    const raiz = dominioRaiz(host);
    try {
      if (md[2] === 'preparar') {
        const z = await preparaZona(env, raiz);
        await env.DB.prepare('UPDATE dominios SET zona_id = ? WHERE vendedor_id = ? AND (host = ? OR host = ?)').bind(z.zona_id, d.vendedor_id, raiz, 'www.' + raiz).run();
        return json({ ok: true, ...z });
      }
      if (md[2] === 'comprobar') {
        if (!d.zona_id) return error('Primero pulsa «Preparar»');
        const z = await compruebaZona(env, d.zona_id);
        if (z.estado !== 'active') return json({ ok: true, ...z, conectado: false });
        const hosts = [raiz, 'www.' + raiz];
        for (const h of hosts) await conectaHost(env, h, d.zona_id);
        await env.DB.prepare("UPDATE dominios SET estado = 'activo' WHERE vendedor_id = ? AND (host = ? OR host = ?)").bind(d.vendedor_id, raiz, 'www.' + raiz).run();
        return json({ ok: true, ...z, conectado: true });
      }
      if (md[2] === 'quitar') {
        for (const h of [raiz, 'www.' + raiz]) { try { await desconectaHost(env, h); } catch (e) { /* puede no estar conectado */ } }
        await env.DB.prepare('DELETE FROM dominios WHERE vendedor_id = ? AND (host = ? OR host = ?)').bind(d.vendedor_id, raiz, 'www.' + raiz).run();
        return json({ ok: true });
      }
    } catch (e) {
      return error(e.message, 502);
    }
  }

  return error('No encontrado', 404);
}

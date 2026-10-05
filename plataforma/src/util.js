// Utilidades comunes: respuestas, ids, contraseñas y cookies.

export const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
  });

export const error = (msg, status = 400) => json({ error: msg }, status);

export const ahora = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

const b64url = buf => btoa(String.fromCharCode(...new Uint8Array(buf)))
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export const aleatorio = (bytes = 24) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

export const uid = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);

// Contraseña legible para enviar por WhatsApp: sin caracteres confusos (0/O, 1/l).
export function claveLegible(n = 10) {
  const abc = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const r = crypto.getRandomValues(new Uint8Array(n));
  return Array.from(r, x => abc[x % abc.length]).join('');
}

export async function sha256(txt) {
  return b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(txt)));
}

// PBKDF2-SHA256. 100.000 iteraciones es el máximo que permite Cloudflare Workers.
export async function hashClave(clave, sal) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(clave), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(sal), iterations: 100000 }, key, 256);
  return b64url(bits);
}

// Comparación en tiempo constante (evita deducir la clave midiendo tiempos).
export function igualSeguro(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export function leeCookie(req, nombre) {
  const c = req.headers.get('cookie') || '';
  const m = c.match(new RegExp('(?:^|;\\s*)' + nombre + '=([^;]+)'));
  return m ? decodeURIComponent(m[1]) : null;
}

export function cookieSesion(token, maxAge, segura) {
  return `sesion=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${segura ? '; Secure' : ''}`;
}

export const limpiaTexto = (v, max = 300) => (v === null || v === undefined) ? '' : String(v).trim().slice(0, max);

export const slugValido = s => /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(s || '');

export function normalizaHost(h) {
  return String(h || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
}

export const hostValido = h => /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/.test(h || '');

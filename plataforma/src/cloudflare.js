// Conexión de dominios de clientes mediante la API de Cloudflare.
// Necesita dos secretos del Worker: CF_API_TOKEN y CF_ACCOUNT_ID.
// Permisos del token: Zone:Edit (crear zonas) y Workers Scripts:Edit (dominios del Worker).

const API = 'https://api.cloudflare.com/client/v4';

async function cf(env, ruta, opciones = {}) {
  if (!env.CF_API_TOKEN || !env.CF_ACCOUNT_ID) {
    throw new Error('Falta configurar CF_API_TOKEN y CF_ACCOUNT_ID en el Worker.');
  }
  const r = await fetch(API + ruta, {
    ...opciones,
    headers: { authorization: 'Bearer ' + env.CF_API_TOKEN, 'content-type': 'application/json', ...(opciones.headers || {}) }
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) {
    const msg = (j.errors || []).map(e => e.message).join('; ') || ('Error ' + r.status);
    throw new Error('Cloudflare: ' + msg);
  }
  return j.result;
}

// El dominio "raíz" de un host: cartaspepe.es para www.cartaspepe.es.
// (Suficiente para .es/.com; dominios tipo .com.es no se contemplan.)
export const dominioRaiz = host => host.split('.').slice(-2).join('.');

export async function buscaZona(env, raiz) {
  const r = await cf(env, `/zones?name=${encodeURIComponent(raiz)}&account.id=${env.CF_ACCOUNT_ID}`);
  return r[0] || null;
}

// Crea la zona si no existe y devuelve su estado y los servidores DNS a poner
// en el registrador del dominio (Hostinger, etc.).
export async function preparaZona(env, raiz) {
  let zona = await buscaZona(env, raiz);
  if (!zona) {
    zona = await cf(env, '/zones', {
      method: 'POST',
      body: JSON.stringify({ account: { id: env.CF_ACCOUNT_ID }, name: raiz, type: 'full' })
    });
  }
  return { zona_id: zona.id, estado: zona.status, nameservers: zona.name_servers || [] };
}

// Pide a Cloudflare que vuelva a comprobar si ya se cambiaron los DNS.
export async function compruebaZona(env, zonaId) {
  try { await cf(env, `/zones/${zonaId}/activation_check`, { method: 'PUT' }); } catch (e) { /* se limita a 1 vez/hora */ }
  const z = await cf(env, `/zones/${zonaId}`);
  return { estado: z.status, nameservers: z.name_servers || [] };
}

// Engancha un host (cartaspepe.es o www.cartaspepe.es) a este Worker.
// Cloudflare crea solo el registro DNS y el certificado HTTPS.
export async function conectaHost(env, host, zonaId) {
  return cf(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/domains`, {
    method: 'PUT',
    body: JSON.stringify({ environment: 'production', hostname: host, service: env.NOMBRE_WORKER || 'tiendas-tcg', zone_id: zonaId })
  });
}

export async function desconectaHost(env, host) {
  const lista = await cf(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/domains?hostname=${encodeURIComponent(host)}`);
  for (const d of lista || []) {
    await cf(env, `/accounts/${env.CF_ACCOUNT_ID}/workers/domains/${d.id}`, { method: 'DELETE' });
  }
}

// Importa mistercard (content/*.json + images/) como vendedor de la plataforma.
// Uso:  node scripts/importar-mistercard.mjs [--remote]
// Genera la base de datos y sube las fotos (en local o, con --remote, a Cloudflare).
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const remoto = process.argv.includes('--remote');
const raiz = new URL('../../', import.meta.url).pathname;
const sitio = JSON.parse(readFileSync(raiz + 'content/sitio.json', 'utf8'));
const ap = JSON.parse(readFileSync(raiz + 'content/apartados.json', 'utf8'));
const { cartas } = JSON.parse(readFileSync(raiz + 'content/cartas.json', 'utf8'));
const id = 'mistercard';
const q = v => v === null || v === undefined ? 'NULL' : typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`;
const uid = () => randomUUID().replace(/-/g, '').slice(0, 16);

const fotosASubir = [];
const claveDe = ruta => {
  if (!ruta) return null;
  const ext = ruta.split('.').pop().toLowerCase().replace('jpeg', 'jpg');
  const clave = `v/${id}/${uid()}${uid()}.${ext}`;
  fotosASubir.push([raiz + ruta.replace(/^\//, ''), clave, ext === 'webp' ? 'image/webp' : ext === 'png' ? 'image/png' : 'image/jpeg']);
  return clave;
};
const logo = claveDe('/assets/lockup.png');
const cfg = {
  nombre: 'mistercard', ciudad: 'Alicante', instagram: sitio.handle.replace(/^@/, ''), whatsapp: (sitio.whatsapp || '').replace(/\D/g, ''),
  color: '#e0a84e', fondo: 'noche', logo,
  aviso: sitio.aviso, badge: sitio.badge, titulo: sitio.titulo, intro: sitio.intro, boton1: sitio.boton1, boton2: sitio.boton2,
  dato1_pie: sitio.dato1_pie, dato2: sitio.dato2, dato2_pie: sitio.dato2_pie, dato3: sitio.dato3, dato3_pie: sitio.dato3_pie,
  escaparate_nota: sitio.escaparate_nota || '',
  garantias: ['Fotos reales de cada producto', 'Envíos desde Alicante', '100% con seguimiento', 'Entrega en 24-48 h tras el pago'],
  envio_texto: 'Envío en 24-48 h con seguimiento', pago_texto: 'Desde Alicante · Bizum o transferencia',
  destacada_titulo: sitio.destacada_titulo || 'Pieza de la semana', destacada_carta: null,
  columnas: parseInt(sitio.columnas, 10) || 4,
  como_titulo: sitio.como_titulo, como_texto: sitio.como_texto, pasos: sitio.pasos,
  compro_visible: sitio.compro_visible !== false, compro_titulo: sitio.compro_titulo, compro_texto: sitio.compro_texto,
  compro_lista: (sitio.compro_lista || []).map(x => typeof x === 'string' ? x : x.item).filter(Boolean),
  apartados: ap
};
let maxRef = 0;
const sql = [`DELETE FROM vendedores WHERE id = '${id}';`];
const filasCartas = cartas.map((c, i) => {
  const cid = uid();
  const fotos = [c.foto, ...(c.fotos || []).map(f => typeof f === 'string' ? f : f.img)].filter(Boolean).map(claveDe);
  const n = parseInt((c.ref || '').replace(/\D/g, ''), 10); if (n > maxRef) maxRef = n;
  if (sitio.destacada_foto && sitio.destacada_foto === c.foto) cfg.destacada_carta = cid;
  const precio = typeof c.precio === 'number' ? c.precio : parseFloat(String(c.precio || '').replace(/[^\d,.]/g, '').replace(',', '.')) || null;
  return `INSERT INTO cartas (id, vendedor_id, ref, apartado, nombre, set_detalle, juego, estado_carta, cert, precio, disponibilidad, fotos, orden) VALUES (${[cid, id, c.ref, c.apartado, c.nombre, c.set || '', c.juego || '', c.estado_carta || '', c.cert || '', precio, c.disponibilidad || 'Disponible', JSON.stringify(fotos), i].map(q).join(', ')});`;
});
sql.push(`INSERT INTO vendedores (id, nombre, config, prefijo_ref, sig_ref, notas, premium) VALUES (${[id, 'mistercard', JSON.stringify(cfg), 'MC', maxRef + 1, 'Tienda propia (primer vendedor)', 1].map(q).join(', ')});`);
sql.push(...filasCartas);
sql.push(`INSERT OR IGNORE INTO dominios (host, vendedor_id, estado) VALUES ('mistercard.es', '${id}', 'pendiente'), ('www.mistercard.es', '${id}', 'pendiente');`);
writeFileSync('importar-mistercard.sql', sql.join('\n') + '\n');

const flag = remoto ? '--remote' : '--local';
execFileSync('npx', ['wrangler', 'd1', 'execute', 'tiendas-tcg', flag, '--file', 'importar-mistercard.sql'], { stdio: 'inherit' });
for (const [archivo, clave, tipo] of fotosASubir) {
  execFileSync('npx', ['wrangler', 'r2', 'object', 'put', `tiendas-tcg-fotos/${clave}`, '--file', archivo, '--content-type', tipo, flag], { stdio: 'ignore' });
}
console.log(`Importadas ${cartas.length} cartas y ${fotosASubir.length} fotos (${remoto ? 'Cloudflare' : 'local'}).`);
console.log('Falta crear el usuario del panel de mistercard desde el superpanel («Nueva contraseña»).');

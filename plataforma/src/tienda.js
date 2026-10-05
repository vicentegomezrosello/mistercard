// Configuración de cada tienda: valores por defecto, colores y datos públicos.

export const APARTADOS = ['gradeadas', 'sellado', 'sueltas', 'lotes'];
export const DISPONIBILIDAD = ['Disponible', 'Reservada', 'Vendida'];
export const JUEGOS = ['Pokémon', 'One Piece', 'Riftbound', 'Lorcana', 'Magic', 'Yu-Gi-Oh!', 'Dragon Ball', 'Digimon', 'Deportivas', 'Otro'];

// Paletas de fondo oscuras que combinan con cualquier color de acento.
export const FONDOS = {
  noche: '#0a1424',
  negro: '#0b0b0d',
  grafito: '#15171c',
  granate: '#1a0b0f',
  bosque: '#0a1712',
  morado: '#130c1f'
};

export function configPorDefecto({ nombre, ciudad, instagram, whatsapp, color, fondo }) {
  const desde = ciudad ? ` · ${ciudad}` : '';
  return {
    nombre,
    ciudad: ciudad || '',
    instagram: instagram || '',
    whatsapp: whatsapp || '',
    color: color || '#e0a84e',
    fondo: FONDOS[fondo] ? fondo : 'noche',
    logo: null,
    aviso: 'Reservas por mensaje directo en Instagram',
    badge: `Escaparate de cartas TCG${desde}`,
    titulo: 'Mira el escaparate y escríbeme por Instagram.',
    intro: 'Aquí no hay carrito. Enseño lo que tengo disponible, tú me mandas un mensaje con la carta que te interesa y cerramos precio, estado y envío por privado.',
    boton1: 'Escribir por Instagram',
    boton2: 'Ver el escaparate',
    dato1_pie: 'respondo en el día',
    dato2: '', dato2_pie: '',
    dato3: '', dato3_pie: '',
    escaparate_nota: '',
    garantias: ['Fotos reales de cada producto', ciudad ? `Envíos desde ${ciudad}` : 'Envíos a toda España', '100% con seguimiento', 'Entrega en 24-48 h tras el pago'],
    envio_texto: 'Envío en 24-48 h con seguimiento',
    pago_texto: (ciudad ? `Desde ${ciudad} · ` : '') + 'Bizum o transferencia',
    destacada_titulo: 'Pieza de la semana',
    destacada_carta: null,
    columnas: 4,
    como_titulo: 'Cómo comprar',
    como_texto: 'Tres pasos, todo por mensaje directo.',
    pasos: [
      { titulo: 'Me escribes por Instagram', texto: 'Con la referencia de la carta o una captura.' },
      { titulo: 'Te confirmo y reservo', texto: 'Estado real, fotos extra si las pides y precio final con envío.' },
      { titulo: 'Pagas y sale el paquete', texto: 'Bizum o transferencia. Envío protegido con seguimiento en 24-48 h.' }
    ],
    compro_visible: true,
    compro_titulo: 'También compro colecciones',
    compro_texto: 'Mándame fotos del lote por Instagram y te digo qué me interesa y a qué precio. Sin compromiso.',
    compro_lista: [],
    apartados: {
      gradeadas: { nombre: 'Cartas gradeadas', visible: true, orden: 1 },
      sellado: { nombre: 'Producto sellado', visible: true, orden: 2 },
      sueltas: { nombre: 'Cartas sueltas', visible: true, orden: 3 },
      lotes: { nombre: 'Lotes y colecciones', visible: true, orden: 4 }
    }
  };
}

// Campos que el vendedor puede cambiar desde su panel, con su longitud máxima.
export const CAMPOS_EDITABLES = {
  instagram: 40, whatsapp: 20, ciudad: 60, color: 7, fondo: 12,
  aviso: 120, badge: 80, titulo: 120, intro: 500, boton1: 40, boton2: 40,
  dato1_pie: 40, dato2: 20, dato2_pie: 40, dato3: 20, dato3_pie: 40,
  escaparate_nota: 80, envio_texto: 80, pago_texto: 80, destacada_titulo: 40,
  como_titulo: 60, como_texto: 160, compro_titulo: 80, compro_texto: 500
};

const hexARgb = h => {
  const m = /^#?([0-9a-f]{6})$/i.exec(h || '');
  const n = parseInt(m ? m[1] : 'e0a84e', 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgbAHex = ([r, g, b]) => '#' + [r, g, b].map(x => Math.round(Math.max(0, Math.min(255, x))).toString(16).padStart(2, '0')).join('');
const mezcla = (a, b, t) => a.map((x, i) => x + (b[i] - x) * t);
const luminancia = ([r, g, b]) => {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

// Calcula todos los tonos de la tienda a partir del color de acento y el fondo.
export function cssTema(cfg) {
  const ac = hexARgb(cfg.color);
  const fo = hexARgb(FONDOS[cfg.fondo] || FONDOS.noche);
  const claro = mezcla(ac, [255, 255, 255], 0.22);
  // Texto sobre botones del color de acento: oscuro si el acento es claro, blanco si es oscuro.
  const sobre = luminancia(ac) > 0.32 ? rgbAHex(fo) : '#ffffff';
  const v = {
    '--acento': rgbAHex(ac),
    '--acento-claro': rgbAHex(claro),
    '--acento-rgb': ac.join(','),
    '--fondo': rgbAHex(fo),
    '--fondo-rgb': fo.join(','),
    '--fondo-2': rgbAHex(mezcla(fo, [255, 255, 255], 0.025)),
    '--sup': rgbAHex(mezcla(fo, [255, 255, 255], 0.04)),
    '--sup-2': rgbAHex(mezcla(mezcla(fo, ac, 0.10), [255, 255, 255], 0.08)),
    '--sobre-acento': sobre
  };
  return ':root{' + Object.entries(v).map(([k, x]) => `${k}:${x}`).join(';') + '}';
}

export const urlFoto = clave => clave ? '/img/' + clave : '';

// Formato de una carta tal y como la espera la plantilla de la tienda.
export function cartaPublica(c) {
  const fotos = JSON.parse(c.fotos || '[]');
  return {
    id: c.id,
    apartado: c.apartado,
    foto: urlFoto(fotos[0]),
    fotos: fotos.slice(1).map(urlFoto),
    nombre: c.nombre,
    set: c.set_detalle || '',
    juego: c.juego || '',
    estado_carta: c.estado_carta || '',
    cert: c.cert || '',
    precio: c.precio,
    disponibilidad: c.disponibilidad,
    ref: c.ref
  };
}

// Junta todo lo que la página pública necesita en un solo objeto.
export function datosPublicos(vendedor, cartas) {
  const cfg = JSON.parse(vendedor.config || '{}');
  const lista = cartas.map(cartaPublica);
  const dest = lista.find(c => c.id === cfg.destacada_carta) || lista.find(c => c.disponibilidad === 'Disponible' && c.foto) || lista.find(c => c.disponibilidad !== 'Vendida' && c.foto) || null;
  const sitio = {
    ...cfg,
    nombre: vendedor.nombre,
    logo_url: urlFoto(cfg.logo),
    handle: cfg.instagram ? '@' + cfg.instagram.replace(/^@/, '') : '',
    instagram: cfg.instagram ? 'https://instagram.com/' + cfg.instagram.replace(/^@/, '') : '',
    whatsapp: cfg.whatsapp || '',
    actualizado: vendedor.actualizado,
    destacada_titulo: cfg.destacada_titulo || 'Pieza de la semana',
    destacada_etiqueta: dest ? dest.estado_carta : '',
    destacada_set: dest ? dest.nombre : '',
    destacada_precio: dest ? dest.precio : '',
    destacada_foto: dest ? dest.foto : '',
    destacada_dorso: '',
    feed: []
  };
  delete sitio.apartados; delete sitio.logo; delete sitio.destacada_carta;
  return { sitio, apartados: cfg.apartados || {}, cartas: lista };
}

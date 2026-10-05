-- Plataforma multi-vendedor. Un vendedor = una tienda.
CREATE TABLE vendedores (
  id          TEXT PRIMARY KEY,              -- slug corto: "mistercard", "cartaspepe"
  nombre      TEXT NOT NULL,
  estado      TEXT NOT NULL DEFAULT 'activo', -- activo | pausado | baja
  config      TEXT NOT NULL DEFAULT '{}',    -- JSON: colores, textos, contacto, apartados…
  prefijo_ref TEXT NOT NULL DEFAULT 'MC',    -- referencias: MC-001, CP-001…
  sig_ref     INTEGER NOT NULL DEFAULT 1,    -- siguiente número de referencia
  notas       TEXT,                          -- notas internas (solo superpanel)
  creado      TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE dominios (
  host        TEXT PRIMARY KEY,              -- "cartaspepe.es", "www.cartaspepe.es"
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  estado      TEXT NOT NULL DEFAULT 'pendiente', -- pendiente | activo
  zona_id     TEXT,                          -- id de la zona en Cloudflare
  creado      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_dominios_vendedor ON dominios(vendedor_id);

CREATE TABLE usuarios (
  id          TEXT PRIMARY KEY,
  vendedor_id TEXT REFERENCES vendedores(id) ON DELETE CASCADE, -- NULL = superadmin
  usuario     TEXT NOT NULL UNIQUE,
  pass_hash   TEXT NOT NULL,
  pass_sal    TEXT NOT NULL,
  rol         TEXT NOT NULL DEFAULT 'vendedor', -- vendedor | super
  creado      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sesiones (
  token       TEXT PRIMARY KEY,              -- se guarda el hash, nunca el token
  usuario_id  TEXT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
  expira      TEXT NOT NULL
);
CREATE INDEX idx_sesiones_usuario ON sesiones(usuario_id);

CREATE TABLE cartas (
  id             TEXT PRIMARY KEY,
  vendedor_id    TEXT NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  ref            TEXT NOT NULL,
  apartado       TEXT NOT NULL DEFAULT 'sueltas',
  nombre         TEXT NOT NULL,
  set_detalle    TEXT,
  juego          TEXT,
  estado_carta   TEXT,
  cert           TEXT,
  precio         REAL,
  disponibilidad TEXT NOT NULL DEFAULT 'Disponible', -- Disponible | Reservada | Vendida
  fotos          TEXT NOT NULL DEFAULT '[]',          -- JSON: claves en R2
  orden          INTEGER NOT NULL DEFAULT 0,
  creado         TEXT NOT NULL DEFAULT (datetime('now')),
  actualizado    TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_cartas_vendedor ON cartas(vendedor_id, apartado, orden);
CREATE UNIQUE INDEX idx_cartas_ref ON cartas(vendedor_id, ref);

-- Intentos de login, para frenar ataques de fuerza bruta.
CREATE TABLE intentos (
  clave  TEXT PRIMARY KEY,                   -- ip|usuario
  n      INTEGER NOT NULL DEFAULT 0,
  desde  TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Módulo "Calculadora premium": operaciones de compra/venta y reparto del beneficio.
-- Privado de cada vendedor: ni siquiera el superadmin puede verlo.

ALTER TABLE vendedores ADD COLUMN premium INTEGER NOT NULL DEFAULT 0;  -- 1 = módulo contratado

CREATE TABLE premium_ops (
  vendedor_id TEXT NOT NULL REFERENCES vendedores(id) ON DELETE CASCADE,
  id          TEXT NOT NULL,
  fecha TEXT, nombre TEXT, plataforma TEXT,
  compra REAL, venta REAL, envio REAL, embalaje REAL, otros REAL,
  comisionPct REAL, fija REAL, beneficio REAL, roi REAL, neto REAL, comision REAL,
  ahorro REAL, personal REAL, reinv REAL, maxProxima REAL,
  PRIMARY KEY (vendedor_id, id)
);
CREATE INDEX idx_premium_ops_fecha ON premium_ops(vendedor_id, fecha);

CREATE TABLE premium_cfg (
  vendedor_id TEXT PRIMARY KEY REFERENCES vendedores(id) ON DELETE CASCADE,
  ahorro INTEGER NOT NULL DEFAULT 30,
  personal INTEGER NOT NULL DEFAULT 20,
  reinv INTEGER NOT NULL DEFAULT 50
);

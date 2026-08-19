CREATE TABLE IF NOT EXISTS usuarios (
    id BIGSERIAL PRIMARY KEY,
    google_sub VARCHAR(255) UNIQUE,
    email VARCHAR(255) UNIQUE NOT NULL,
    nombre VARCHAR(120) NOT NULL,
    apellido VARCHAR(120) NOT NULL DEFAULT '',
    dni VARCHAR(30),
    legajo VARCHAR(40) UNIQUE,
    area VARCHAR(180),
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS roles (
    id BIGSERIAL PRIMARY KEY,
    codigo VARCHAR(30) UNIQUE NOT NULL,
    descripcion VARCHAR(120)
);

INSERT INTO roles (codigo, descripcion) VALUES
    ('AGENTE', 'Agente que solicita permisos'),
    ('JEFE', 'Jefatura autorizante'),
    ('RRHH', 'Recursos Humanos'),
    ('ADMIN', 'Administrador del sistema')
ON CONFLICT (codigo) DO NOTHING;

CREATE TABLE IF NOT EXISTS usuario_roles (
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    rol_id BIGINT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    PRIMARY KEY (usuario_id, rol_id)
);

CREATE TABLE IF NOT EXISTS jefaturas (
    id BIGSERIAL PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    jefe_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    fecha_desde DATE NOT NULL DEFAULT CURRENT_DATE,
    fecha_hasta DATE,
    es_suplencia BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (usuario_id <> jefe_id)
);
CREATE INDEX IF NOT EXISTS idx_jefaturas_usuario ON jefaturas(usuario_id, fecha_desde, fecha_hasta);
CREATE INDEX IF NOT EXISTS idx_jefaturas_jefe ON jefaturas(jefe_id, fecha_desde, fecha_hasta);

CREATE TABLE IF NOT EXISTS feriados (
    fecha DATE PRIMARY KEY,
    descripcion VARCHAR(250) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE IF NOT EXISTS permisos_salida (
    id BIGSERIAL PRIMARY KEY,
    numero_permiso VARCHAR(30) UNIQUE,
    agente_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    jefe_asignado_id BIGINT REFERENCES usuarios(id) ON DELETE RESTRICT,
    tipo VARCHAR(20) NOT NULL CHECK (tipo IN ('OFICIAL','PARTICULAR')),
    fecha_salida DATE NOT NULL,
    lugar_destino VARCHAR(300),
    hora_salida TIME NOT NULL,
    hora_regreso TIME,
    sin_regreso BOOLEAN NOT NULL DEFAULT FALSE,
    minutos_autorizados INTEGER CHECK (minutos_autorizados IS NULL OR minutos_autorizados > 0),
    fecha_devolucion DATE,
    observaciones TEXT,
    estado VARCHAR(30) NOT NULL DEFAULT 'BORRADOR' CHECK (estado IN (
        'BORRADOR','PENDIENTE_JEFE','PENDIENTE_RRHH','VERIFICADO_RRHH','RECHAZADO','CANCELADO_AGENTE'
    )),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((sin_regreso = TRUE AND hora_regreso IS NULL) OR sin_regreso = FALSE),
    CHECK ((tipo = 'OFICIAL' AND lugar_destino IS NOT NULL) OR tipo = 'PARTICULAR'),
    CHECK ((tipo = 'PARTICULAR' AND fecha_devolucion IS NOT NULL) OR tipo = 'OFICIAL')
);
CREATE INDEX IF NOT EXISTS idx_permisos_agente ON permisos_salida(agente_id, fecha_salida DESC);
CREATE INDEX IF NOT EXISTS idx_permisos_estado ON permisos_salida(estado, fecha_salida DESC);
CREATE INDEX IF NOT EXISTS idx_permisos_jefe ON permisos_salida(jefe_asignado_id, estado);

CREATE TABLE IF NOT EXISTS aprobaciones (
    id BIGSERIAL PRIMARY KEY,
    permiso_id BIGINT NOT NULL REFERENCES permisos_salida(id) ON DELETE CASCADE,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE RESTRICT,
    tipo_aprobacion VARCHAR(20) NOT NULL CHECK (tipo_aprobacion IN ('JEFE','RRHH')),
    decision VARCHAR(20) NOT NULL CHECK (decision IN ('APROBADO','RECHAZADO','VERIFICADO')),
    observacion TEXT,
    fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_aprobaciones_permiso ON aprobaciones(permiso_id, fecha_hora);

CREATE TABLE IF NOT EXISTS historial_permiso (
    id BIGSERIAL PRIMARY KEY,
    permiso_id BIGINT NOT NULL REFERENCES permisos_salida(id) ON DELETE CASCADE,
    usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    evento VARCHAR(60) NOT NULL,
    estado_anterior VARCHAR(30),
    estado_nuevo VARCHAR(30),
    detalle TEXT,
    fecha_hora TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_historial_permiso ON historial_permiso(permiso_id, fecha_hora);

CREATE TABLE IF NOT EXISTS reposiciones (
    id BIGSERIAL PRIMARY KEY,
    permiso_id BIGINT UNIQUE NOT NULL REFERENCES permisos_salida(id) ON DELETE CASCADE,
    fecha_prevista DATE NOT NULL,
    fecha_real DATE,
    minutos_a_reponer INTEGER,
    minutos_repuestos INTEGER NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','PARCIAL','CUMPLIDA','VENCIDA')),
    verificado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_verificacion TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS sync_sheets (
    permiso_id BIGINT PRIMARY KEY REFERENCES permisos_salida(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','SINCRONIZADO','ERROR')),
    ultimo_intento TIMESTAMPTZ,
    ultimo_exito TIMESTAMPTZ,
    mensaje_error TEXT,
    numero_intentos INTEGER NOT NULL DEFAULT 0
);

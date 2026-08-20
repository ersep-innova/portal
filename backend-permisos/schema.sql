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
    jornada_desde TIME NOT NULL DEFAULT '08:00',
    jornada_hasta TIME NOT NULL DEFAULT '14:00',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Migración idempotente para bases creadas con la versión anterior.
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS jornada_desde TIME NOT NULL DEFAULT '08:00';
ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS jornada_hasta TIME NOT NULL DEFAULT '14:00';

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
    jornada_desde TIME NOT NULL DEFAULT '08:00',
    jornada_hasta TIME NOT NULL DEFAULT '14:00',
    minutos_calculados INTEGER,
    minutos_declarados INTEGER,
    minutos_autorizados INTEGER,
    justificacion_minutos TEXT,
    fecha_devolucion DATE,
    fecha_limite_devolucion DATE,
    fuera_plazo_reglamentario BOOLEAN NOT NULL DEFAULT FALSE,
    justificacion_fuera_plazo TEXT,
    observaciones TEXT,
    estado VARCHAR(30) NOT NULL DEFAULT 'BORRADOR',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK ((sin_regreso = TRUE AND hora_regreso IS NULL) OR sin_regreso = FALSE),
    CHECK ((tipo = 'OFICIAL' AND lugar_destino IS NOT NULL) OR tipo = 'PARTICULAR'),
    CHECK ((tipo = 'PARTICULAR' AND fecha_devolucion IS NOT NULL) OR tipo = 'OFICIAL')
);

ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS jornada_desde TIME NOT NULL DEFAULT '08:00';
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS jornada_hasta TIME NOT NULL DEFAULT '14:00';
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS minutos_calculados INTEGER;
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS minutos_declarados INTEGER;
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS justificacion_minutos TEXT;
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS fecha_limite_devolucion DATE;
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS fuera_plazo_reglamentario BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE permisos_salida ADD COLUMN IF NOT EXISTS justificacion_fuera_plazo TEXT;

UPDATE permisos_salida
SET minutos_declarados = COALESCE(minutos_declarados, minutos_autorizados),
    minutos_calculados = COALESCE(minutos_calculados, minutos_autorizados)
WHERE minutos_declarados IS NULL OR minutos_calculados IS NULL;

DO $$
DECLARE
    c RECORD;
BEGIN
    FOR c IN
        SELECT conname, pg_get_constraintdef(oid) AS def
        FROM pg_constraint
        WHERE conrelid = 'permisos_salida'::regclass AND contype = 'c'
    LOOP
        IF c.def ILIKE '%BORRADOR%' AND c.def ILIKE '%PENDIENTE_RRHH%' THEN
            EXECUTE format('ALTER TABLE permisos_salida DROP CONSTRAINT %I', c.conname);
        ELSIF c.def ILIKE '%minutos_autorizados%' AND c.def ILIKE '%> 0%' THEN
            EXECUTE format('ALTER TABLE permisos_salida DROP CONSTRAINT %I', c.conname);
        END IF;
    END LOOP;
END $$;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='permisos_salida'::regclass AND conname='ck_permisos_estado_v2'
    ) THEN
        ALTER TABLE permisos_salida ADD CONSTRAINT ck_permisos_estado_v2 CHECK (estado IN (
            'BORRADOR','PENDIENTE_JEFE','PENDIENTE_RRHH','VERIFICADO_RRHH',
            'RECHAZADO','RECHAZADO_JEFE','RECHAZADO_RRHH','CANCELADO_AGENTE'
        ));
    END IF;
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid='permisos_salida'::regclass AND conname='ck_permisos_minutos_v2'
    ) THEN
        ALTER TABLE permisos_salida ADD CONSTRAINT ck_permisos_minutos_v2 CHECK (
            (minutos_autorizados IS NULL OR minutos_autorizados >= 0)
            AND (minutos_calculados IS NULL OR minutos_calculados >= 0)
            AND (minutos_declarados IS NULL OR minutos_declarados >= 0)
        );
    END IF;
END $$;

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
    hora_desde_prevista TIME,
    hora_hasta_prevista TIME,
    fecha_real DATE,
    minutos_a_reponer INTEGER,
    minutos_repuestos INTEGER NOT NULL DEFAULT 0,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','PARCIAL','CUMPLIDA','VENCIDA')),
    verificado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    fecha_verificacion TIMESTAMPTZ
);
ALTER TABLE reposiciones ADD COLUMN IF NOT EXISTS hora_desde_prevista TIME;
ALTER TABLE reposiciones ADD COLUMN IF NOT EXISTS hora_hasta_prevista TIME;

CREATE TABLE IF NOT EXISTS sync_sheets (
    permiso_id BIGINT PRIMARY KEY REFERENCES permisos_salida(id) ON DELETE CASCADE,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE' CHECK (estado IN ('PENDIENTE','SINCRONIZADO','ERROR')),
    ultimo_intento TIMESTAMPTZ,
    ultimo_exito TIMESTAMPTZ,
    mensaje_error TEXT,
    numero_intentos INTEGER NOT NULL DEFAULT 0
);

-- Integración OAuth con Google Sheets.
-- El refresh token queda en PostgreSQL; nunca se publica en GitHub Pages.
CREATE TABLE IF NOT EXISTS google_sheets_oauth_states (
    state VARCHAR(255) PRIMARY KEY,
    usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
    code_verifier TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL
);

-- Migración idempotente para instalaciones que ya tenían la tabla OAuth.
ALTER TABLE google_sheets_oauth_states
    ADD COLUMN IF NOT EXISTS code_verifier TEXT;

CREATE INDEX IF NOT EXISTS idx_google_sheets_oauth_states_exp
    ON google_sheets_oauth_states(expires_at);

CREATE TABLE IF NOT EXISTS google_sheets_integracion (
    id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
    autorizado_por BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
    autorizado_email VARCHAR(255),
    refresh_token TEXT NOT NULL,
    scope TEXT,
    sheet_id VARCHAR(255) NOT NULL,
    activo BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- ============================================================
-- V5 · Auditoría de notificaciones por correo electrónico
-- ============================================================
CREATE TABLE IF NOT EXISTS notificaciones_email (
    id BIGSERIAL PRIMARY KEY,
    permiso_id BIGINT NOT NULL REFERENCES permisos_salida(id) ON DELETE CASCADE,
    destinatario VARCHAR(255) NOT NULL,
    tipo VARCHAR(60) NOT NULL,
    asunto TEXT NOT NULL,
    estado VARCHAR(20) NOT NULL DEFAULT 'PENDIENTE'
        CHECK (estado IN ('PENDIENTE','ENVIANDO','ENVIADO','ERROR','OMITIDO')),
    proveedor VARCHAR(40) NOT NULL DEFAULT 'RESEND',
    proveedor_id VARCHAR(255),
    mensaje_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ultimo_intento TIMESTAMPTZ,
    enviado_at TIMESTAMPTZ,
    UNIQUE (permiso_id, tipo)
);

CREATE INDEX IF NOT EXISTS idx_notificaciones_email_estado
    ON notificaciones_email(estado, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notificaciones_email_permiso
    ON notificaciones_email(permiso_id, created_at DESC);

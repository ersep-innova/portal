from contextlib import asynccontextmanager
from datetime import date, time
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, Header, HTTPException, Query
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from app.auth import (
    ensure_bootstrap_admin,
    get_current_user,
    hash_password,
    login_user,
    logout_session,
    require_roles,
)
from app.config import settings
from app.database import close_pool, connection, init_schema, start_pool
from app.email_service import notify_permission_event, send_test_email
from app.sheets_service import (
    create_authorization_url,
    disconnect as disconnect_sheets,
    finish_authorization,
    integration_status,
    sync_all,
)
from app.workflow import (
    active_boss,
    add_history,
    calculate_minutes,
    get_permission_for_user,
    max_business_date,
    minutes_between,
)


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_pool()
    init_schema()
    ensure_bootstrap_admin()
    yield
    close_pool()


app = FastAPI(title="ERSeP · Permisos de Salida API", version="0.3.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class LoginIn(BaseModel):
    usuario: str = Field(min_length=1, max_length=80)
    clave: str = Field(min_length=1, max_length=200)


class PermissionIn(BaseModel):
    tipo: Literal["OFICIAL", "PARTICULAR"]
    fecha_salida: date
    lugar_destino: str | None = Field(default=None, max_length=300)
    hora_salida: str
    hora_regreso: str | None = None
    sin_regreso: bool = False
    minutos_declarados: int | None = Field(default=None, ge=0, le=24 * 60)
    justificacion_minutos: str | None = Field(default=None, max_length=1000)
    fecha_devolucion: date | None = None
    devolucion_hora_desde: str | None = None
    devolucion_hora_hasta: str | None = None
    justificacion_fuera_plazo: str | None = Field(default=None, max_length=1000)
    observaciones: str | None = Field(default=None, max_length=1000)


class DecisionIn(BaseModel):
    observacion: str | None = Field(default=None, max_length=1000)


class AdminUserIn(BaseModel):
    username: str = Field(min_length=3, max_length=80, pattern=r"^[A-Za-z0-9._-]+$")
    password: str | None = Field(default=None, min_length=6, max_length=200)
    email: EmailStr
    nombre: str = Field(min_length=1, max_length=120)
    apellido: str = Field(min_length=1, max_length=120)
    legajo: str = Field(min_length=1, max_length=40)
    dni: str | None = Field(default=None, max_length=30)
    area: str | None = Field(default=None, max_length=180)
    jornada_desde: str = "08:00"
    jornada_hasta: str = "14:00"
    roles: list[Literal["AGENTE", "JEFE", "RRHH", "ADMIN"]] = ["AGENTE"]
    jefe_email: EmailStr | None = None


class AdminUserStatusIn(BaseModel):
    activo: bool


def _parse_time(value: str | None):
    if value is None or value == "":
        return None
    try:
        hh, mm = value.split(":")[:2]
        parsed = time(hour=int(hh), minute=int(mm))
        return parsed
    except Exception:
        raise HTTPException(status_code=422, detail=f"Hora inválida: {value}")


def _serialize_permission(row: dict):
    for key in (
        "hora_salida", "hora_regreso", "jornada_desde", "jornada_hasta",
        "reposicion_hora_desde", "reposicion_hora_hasta",
    ):
        if row.get(key) is not None:
            row[key] = str(row[key])[:5]
    return row


def _serialize_user(row: dict):
    row = dict(row)
    row.pop("password_hash", None)
    row.pop("google_sub", None)
    for key in ("jornada_desde", "jornada_hasta"):
        if row.get(key) is not None:
            row[key] = str(row[key])[:5]
    return row


@app.get("/api/health")
def health():
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 ok")
            db_ok = cur.fetchone()["ok"] == 1
    try:
        sheets = integration_status()
    except Exception:
        sheets = {"configured": False, "authorized": False}
    return {
        "status": "ok",
        "database": db_ok,
        "auth": "local",
        "bootstrap_configured": bool(settings.bootstrap_admin_password),
        "sheets_configured": bool(sheets.get("configured")),
        "sheets_authorized": bool(sheets.get("authorized")),
    }


@app.post("/api/auth/login")
def auth_login(payload: LoginIn):
    result = login_user(payload.usuario, payload.clave)
    result["user"] = _serialize_user(result["user"])
    return result


@app.post("/api/auth/logout")
def auth_logout(authorization: str | None = Header(default=None)):
    logout_session(authorization)
    return {"status": "ok"}


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(get_current_user)):
    return _serialize_user({
        "id": user["id"],
        "email": user["email"],
        "nombre": user["nombre"],
        "apellido": user["apellido"],
        "dni": user.get("dni"),
        "legajo": user.get("legajo"),
        "area": user.get("area"),
        "jornada_desde": user.get("jornada_desde"),
        "jornada_hasta": user.get("jornada_hasta"),
        "roles": user["roles"],
    })


@app.get("/api/reglas/plazo-devolucion")
def return_deadline(fecha_salida: date = Query(...), user: dict = Depends(require_roles("AGENTE"))):
    with connection() as conn:
        with conn.cursor() as cur:
            limit_date = max_business_date(cur, fecha_salida, 7)
    return {
        "fecha_salida": fecha_salida,
        "fecha_limite": limit_date,
        "dias_habiles": 7,
        "mensaje": "Por reglamento, la devolución debería realizarse dentro de los próximos 7 días hábiles.",
    }


@app.post("/api/permisos")
def create_permission(payload: PermissionIn, bg: BackgroundTasks, user: dict = Depends(require_roles("AGENTE"))):
    if payload.tipo == "OFICIAL" and not (payload.lugar_destino or "").strip():
        raise HTTPException(status_code=422, detail="Las salidas oficiales requieren lugar de destino.")
    if payload.tipo == "PARTICULAR" and not payload.fecha_devolucion:
        raise HTTPException(status_code=422, detail="Las salidas particulares requieren fecha de devolución de horas.")

    start = _parse_time(payload.hora_salida)
    end = _parse_time(payload.hora_regreso)
    workday_start = user.get("jornada_desde") or time(8, 0)
    workday_end = user.get("jornada_hasta") or time(14, 0)
    calculated = calculate_minutes(start, end, payload.sin_regreso, workday_end)
    declared = calculated if payload.minutos_declarados is None else payload.minutos_declarados

    if declared != calculated and not (payload.justificacion_minutos or "").strip():
        raise HTTPException(
            status_code=422,
            detail="El tiempo declarado difiere del cálculo automático. Debe explicar el motivo de la diferencia.",
        )

    return_from = _parse_time(payload.devolucion_hora_desde)
    return_to = _parse_time(payload.devolucion_hora_hasta)

    with connection() as conn:
        with conn.cursor() as cur:
            limit_date = None
            outside = False
            return_minutes = None
            if payload.tipo == "PARTICULAR":
                if payload.fecha_devolucion < payload.fecha_salida:
                    raise HTTPException(status_code=422, detail="La fecha de devolución no puede ser anterior a la salida.")
                if return_from is None or return_to is None:
                    raise HTTPException(status_code=422, detail="Debe indicar el tramo horario desde/hasta en el que devolverá las horas.")
                return_minutes = minutes_between(return_from, return_to)
                limit_date = max_business_date(cur, payload.fecha_salida, 7)
                outside = payload.fecha_devolucion > limit_date
                if outside and not (payload.justificacion_fuera_plazo or "").strip():
                    raise HTTPException(
                        status_code=422,
                        detail=(
                            f"La fecha seleccionada supera el plazo reglamentario sugerido ({limit_date.strftime('%d/%m/%Y')}). "
                            "Puede continuar, pero debe indicar una observación para consideración de RR.HH."
                        ),
                    )

            cur.execute("""
                INSERT INTO permisos_salida (
                  agente_id,tipo,fecha_salida,lugar_destino,hora_salida,hora_regreso,sin_regreso,
                  jornada_desde,jornada_hasta,minutos_calculados,minutos_declarados,minutos_autorizados,
                  justificacion_minutos,fecha_devolucion,fecha_limite_devolucion,fuera_plazo_reglamentario,
                  justificacion_fuera_plazo,observaciones,estado
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'BORRADOR') RETURNING *
            """, (
                user["id"], payload.tipo, payload.fecha_salida, (payload.lugar_destino or "").strip() or None,
                start, end, payload.sin_regreso, workday_start, workday_end, calculated, declared, declared,
                (payload.justificacion_minutos or "").strip() or None, payload.fecha_devolucion, limit_date, outside,
                (payload.justificacion_fuera_plazo or "").strip() or None, payload.observaciones,
            ))
            p = cur.fetchone()
            number = f"PS-{payload.fecha_salida.year}-{p['id']:06d}"
            cur.execute("UPDATE permisos_salida SET numero_permiso=%s WHERE id=%s", (number, p["id"]))

            details = [f"Jornada {str(workday_start)[:5]}–{str(workday_end)[:5]}", f"Cálculo automático: {calculated} min", f"Declarado: {declared} min"]
            if declared != calculated:
                details.append(f"Justificación: {(payload.justificacion_minutos or '').strip()}")
            if outside:
                details.append(f"Devolución fuera del plazo sugerido ({limit_date.strftime('%d/%m/%Y')}): {(payload.justificacion_fuera_plazo or '').strip()}")
            add_history(cur, p["id"], user["id"], "SOLICITUD_CREADA", None, "BORRADOR", " · ".join(details))

            if payload.tipo == "PARTICULAR":
                cur.execute("""
                    INSERT INTO reposiciones (
                        permiso_id,fecha_prevista,hora_desde_prevista,hora_hasta_prevista,minutos_a_reponer
                    ) VALUES (%s,%s,%s,%s,%s)
                """, (p["id"], payload.fecha_devolucion, return_from, return_to, declared))
                if return_minutes != declared:
                    add_history(
                        cur, p["id"], user["id"], "TRAMO_REPOSICION_DIFERENTE", "BORRADOR", "BORRADOR",
                        f"El tramo propuesto equivale a {return_minutes} min y el tiempo declarado es {declared} min.",
                    )
            conn.commit()
            p["numero_permiso"] = number
            result = _serialize_permission(p)

    if settings.sheets_enabled:
        bg.add_task(sync_all)
    return result


@app.post("/api/permisos/{permission_id}/enviar")
def send_permission(permission_id: int, bg: BackgroundTasks, user: dict = Depends(require_roles("AGENTE"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p = cur.fetchone()
            if not p or p["agente_id"] != user["id"]:
                raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["estado"] != "BORRADOR":
                raise HTTPException(status_code=409, detail="Solo un borrador puede enviarse a autorización.")
            boss = active_boss(cur, user["id"], p["fecha_salida"])
            if not boss:
                raise HTTPException(status_code=409, detail="No tenés un jefe activo configurado para esa fecha. Solicitá a un administrador que configure tu jefatura.")
            cur.execute("UPDATE permisos_salida SET estado='PENDIENTE_JEFE',jefe_asignado_id=%s,updated_at=NOW() WHERE id=%s", (boss["id"], permission_id))
            add_history(cur, permission_id, user["id"], "ENVIADO_A_JEFE", "BORRADOR", "PENDIENTE_JEFE", f"Jefatura asignada: {boss['nombre']} {boss['apellido']}")
            conn.commit()
    if settings.sheets_enabled:
        bg.add_task(sync_all)
    bg.add_task(notify_permission_event, permission_id, "SOLICITUD_ENVIADA", None)
    return {"status": "ok", "message": "Solicitud enviada a autorización."}


@app.get("/api/permisos/mios")
def my_permissions(user: dict = Depends(require_roles("AGENTE"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.*,trim(concat(u.nombre,' ',u.apellido)) agente_nombre,
                       r.hora_desde_prevista reposicion_hora_desde,r.hora_hasta_prevista reposicion_hora_hasta
                FROM permisos_salida p
                JOIN usuarios u ON u.id=p.agente_id
                LEFT JOIN reposiciones r ON r.permiso_id=p.id
                WHERE p.agente_id=%s ORDER BY p.fecha_salida DESC,p.id DESC
            """, (user["id"],))
            rows = [_serialize_permission(r) for r in cur.fetchall()]
    return {"items": rows}


@app.get("/api/permisos/{permission_id}")
def permission_detail(permission_id: int, user: dict = Depends(get_current_user)):
    return _serialize_permission(get_permission_for_user(permission_id, user))


@app.get("/api/jefatura/pendientes")
def boss_queue(user: dict = Depends(require_roles("JEFE"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.*,trim(concat(u.nombre,' ',u.apellido)) agente_nombre,u.legajo,
                       r.hora_desde_prevista reposicion_hora_desde,r.hora_hasta_prevista reposicion_hora_hasta
                FROM permisos_salida p
                JOIN usuarios u ON u.id=p.agente_id
                LEFT JOIN reposiciones r ON r.permiso_id=p.id
                WHERE p.jefe_asignado_id=%s AND p.estado='PENDIENTE_JEFE'
                ORDER BY p.fecha_salida,p.hora_salida
            """, (user["id"],))
            rows = [_serialize_permission(r) for r in cur.fetchall()]
    return {"items": rows}


@app.post("/api/permisos/{permission_id}/autorizar")
def authorize(permission_id: int, payload: DecisionIn, bg: BackgroundTasks, user: dict = Depends(require_roles("JEFE"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["jefe_asignado_id"] != user["id"] and "ADMIN" not in user["roles"]:
                raise HTTPException(status_code=403, detail="No sos la jefatura asignada a esta solicitud.")
            if p["estado"] != "PENDIENTE_JEFE":
                raise HTTPException(status_code=409, detail="La solicitud ya no está pendiente de autorización.")
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'JEFE','APROBADO',%s)", (permission_id, user["id"], payload.observacion))
            cur.execute("UPDATE permisos_salida SET estado='PENDIENTE_RRHH',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur, permission_id, user["id"], "AUTORIZADO_JEFE", "PENDIENTE_JEFE", "PENDIENTE_RRHH", payload.observacion)
            conn.commit()
    if settings.sheets_enabled:
        bg.add_task(sync_all)
    bg.add_task(notify_permission_event, permission_id, "JEFATURA_APROBADO", payload.observacion)
    return {"status": "ok"}


@app.post("/api/permisos/{permission_id}/rechazar")
def reject(permission_id: int, payload: DecisionIn, bg: BackgroundTasks, user: dict = Depends(require_roles("JEFE"))):
    reason = (payload.observacion or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="Debe indicar el motivo del rechazo.")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["jefe_asignado_id"] != user["id"] and "ADMIN" not in user["roles"]:
                raise HTTPException(status_code=403, detail="No sos la jefatura asignada.")
            if p["estado"] != "PENDIENTE_JEFE":
                raise HTTPException(status_code=409, detail="La solicitud ya no está pendiente.")
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'JEFE','RECHAZADO',%s)", (permission_id, user["id"], reason))
            cur.execute("UPDATE permisos_salida SET estado='RECHAZADO_JEFE',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur, permission_id, user["id"], "RECHAZADO_JEFE", "PENDIENTE_JEFE", "RECHAZADO_JEFE", reason)
            conn.commit()
    if settings.sheets_enabled:
        bg.add_task(sync_all)
    bg.add_task(notify_permission_event, permission_id, "JEFATURA_RECHAZADO", reason)
    return {"status": "ok"}


@app.get("/api/rrhh/permisos")
def rrhh_permissions(estado: str | None = Query(default=None), tipo: str | None = Query(default=None), user: dict = Depends(require_roles("RRHH"))):
    clauses = []
    params = []
    if estado:
        clauses.append("p.estado=%s")
        params.append(estado)
    if tipo:
        clauses.append("p.tipo=%s")
        params.append(tipo)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT p.*,trim(concat(a.nombre,' ',a.apellido)) agente_nombre,a.legajo,
                       trim(concat(j.nombre,' ',j.apellido)) jefe_nombre,
                       r.hora_desde_prevista reposicion_hora_desde,r.hora_hasta_prevista reposicion_hora_hasta
                FROM permisos_salida p
                JOIN usuarios a ON a.id=p.agente_id
                LEFT JOIN usuarios j ON j.id=p.jefe_asignado_id
                LEFT JOIN reposiciones r ON r.permiso_id=p.id
                {where} ORDER BY p.fecha_salida DESC,p.id DESC LIMIT 1000
            """, params)
            rows = [_serialize_permission(r) for r in cur.fetchall()]
    return {"items": rows}


@app.get("/api/rrhh/dashboard")
def rrhh_dashboard(user: dict = Depends(require_roles("RRHH"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)) total_mes,
                  COUNT(*) FILTER (WHERE estado='PENDIENTE_RRHH') pendientes_rrhh,
                  COUNT(*) FILTER (WHERE tipo='PARTICULAR' AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)) particulares_mes,
                  COALESCE(SUM(minutos_declarados) FILTER (WHERE tipo='PARTICULAR' AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)),0) minutos_particulares_mes
                FROM permisos_salida
            """)
            return cur.fetchone()


@app.post("/api/permisos/{permission_id}/verificar-rrhh")
def verify_rrhh(permission_id: int, payload: DecisionIn, bg: BackgroundTasks, user: dict = Depends(require_roles("RRHH"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["estado"] != "PENDIENTE_RRHH":
                raise HTTPException(status_code=409, detail="El permiso no está pendiente de RR.HH.")
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'RRHH','VERIFICADO',%s)", (permission_id, user["id"], payload.observacion))
            cur.execute("UPDATE permisos_salida SET estado='VERIFICADO_RRHH',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur, permission_id, user["id"], "VERIFICADO_RRHH", "PENDIENTE_RRHH", "VERIFICADO_RRHH", payload.observacion)
            conn.commit()
    if settings.sheets_enabled:
        bg.add_task(sync_all)
    bg.add_task(notify_permission_event, permission_id, "RRHH_APROBADO", payload.observacion)
    return {"status": "ok"}


@app.post("/api/permisos/{permission_id}/rechazar-rrhh")
def reject_rrhh(permission_id: int, payload: DecisionIn, bg: BackgroundTasks, user: dict = Depends(require_roles("RRHH"))):
    reason = (payload.observacion or "").strip()
    if not reason:
        raise HTTPException(status_code=422, detail="RR.HH. debe indicar obligatoriamente el motivo del rechazo.")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["estado"] != "PENDIENTE_RRHH":
                raise HTTPException(status_code=409, detail="El permiso no está pendiente de RR.HH.")
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'RRHH','RECHAZADO',%s)", (permission_id, user["id"], reason))
            cur.execute("UPDATE permisos_salida SET estado='RECHAZADO_RRHH',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur, permission_id, user["id"], "RECHAZADO_RRHH", "PENDIENTE_RRHH", "RECHAZADO_RRHH", reason)
            conn.commit()
    if settings.sheets_enabled:
        bg.add_task(sync_all)
    bg.add_task(notify_permission_event, permission_id, "RRHH_RECHAZADO", reason)
    return {"status": "ok"}


@app.post("/api/admin/email/test")
def test_email(user: dict = Depends(require_roles("ADMIN"))):
    """Envía una prueba real a la dirección del administrador autenticado."""
    recipient = (user.get("email") or "").strip()
    if not recipient or recipient.endswith("@ersep.local"):
        raise HTTPException(
            status_code=422,
            detail="Configurá un email real para este usuario antes de probar las notificaciones.",
        )
    try:
        return send_test_email(recipient, user.get("nombre") or "Administrador")
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible enviar el correo de prueba: {exc}",
        )


@app.get("/api/admin/usuarios")
def list_users(user: dict = Depends(require_roles("ADMIN"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
              SELECT u.*,COALESCE(array_agg(DISTINCT r.codigo) FILTER (WHERE r.codigo IS NOT NULL),'{}') roles,
                     trim(concat(jefe.nombre,' ',jefe.apellido)) jefe_nombre,jefe.email jefe_email
              FROM usuarios u
              LEFT JOIN usuario_roles ur ON ur.usuario_id=u.id
              LEFT JOIN roles r ON r.id=ur.rol_id
              LEFT JOIN LATERAL (
                SELECT jj.jefe_id FROM jefaturas jj
                WHERE jj.usuario_id=u.id AND jj.fecha_desde<=CURRENT_DATE AND (jj.fecha_hasta IS NULL OR jj.fecha_hasta>=CURRENT_DATE)
                ORDER BY jj.es_suplencia DESC,jj.fecha_desde DESC LIMIT 1
              ) ja ON TRUE
              LEFT JOIN usuarios jefe ON jefe.id=ja.jefe_id
              GROUP BY u.id,jefe.nombre,jefe.apellido,jefe.email
              ORDER BY u.activo DESC,u.apellido,u.nombre
            """)
            return {"items": [_serialize_user(r) for r in cur.fetchall()]}


@app.post("/api/admin/usuarios")
def upsert_user(payload: AdminUserIn, user: dict = Depends(require_roles("ADMIN"))):
    work_start = _parse_time(payload.jornada_desde)
    work_end = _parse_time(payload.jornada_hasta)
    if work_start >= work_end:
        raise HTTPException(status_code=422, detail="El fin de la jornada debe ser posterior al inicio.")

    username = payload.username.strip().lower()
    email = payload.email.lower()

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM usuarios WHERE email=%s", (email,))
            existing = cur.fetchone()

            cur.execute(
                "SELECT id FROM usuarios WHERE lower(username)=lower(%s) AND email<>%s",
                (username, email),
            )
            conflict = cur.fetchone()
            if conflict:
                raise HTTPException(status_code=409, detail="Ese nombre de usuario ya está en uso.")

            if existing:
                if payload.password:
                    cur.execute(
                        """
                        UPDATE usuarios SET
                            username=%s,password_hash=%s,nombre=%s,apellido=%s,legajo=%s,dni=%s,area=%s,
                            jornada_desde=%s,jornada_hasta=%s,activo=TRUE,updated_at=NOW()
                        WHERE id=%s RETURNING *
                        """,
                        (
                            username, hash_password(payload.password), payload.nombre, payload.apellido,
                            payload.legajo, payload.dni, payload.area, work_start, work_end, existing["id"],
                        ),
                    )
                else:
                    cur.execute(
                        """
                        UPDATE usuarios SET
                            username=%s,nombre=%s,apellido=%s,legajo=%s,dni=%s,area=%s,
                            jornada_desde=%s,jornada_hasta=%s,activo=TRUE,updated_at=NOW()
                        WHERE id=%s RETURNING *
                        """,
                        (
                            username, payload.nombre, payload.apellido, payload.legajo, payload.dni,
                            payload.area, work_start, work_end, existing["id"],
                        ),
                    )
                target = cur.fetchone()
            else:
                if not payload.password:
                    raise HTTPException(
                        status_code=422,
                        detail="Para crear un usuario nuevo debe indicar una clave inicial de al menos 6 caracteres.",
                    )
                cur.execute(
                    """
                    INSERT INTO usuarios(
                        username,password_hash,email,nombre,apellido,legajo,dni,area,jornada_desde,jornada_hasta,activo
                    )
                    VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,TRUE)
                    RETURNING *
                    """,
                    (
                        username, hash_password(payload.password), email, payload.nombre, payload.apellido,
                        payload.legajo, payload.dni, payload.area, work_start, work_end,
                    ),
                )
                target = cur.fetchone()

            cur.execute("DELETE FROM usuario_roles WHERE usuario_id=%s", (target["id"],))
            roles = set(payload.roles or ["AGENTE"])
            for role in roles:
                cur.execute(
                    "INSERT INTO usuario_roles(usuario_id,rol_id) SELECT %s,id FROM roles WHERE codigo=%s ON CONFLICT DO NOTHING",
                    (target["id"], role),
                )

            if payload.jefe_email:
                cur.execute(
                    "SELECT id FROM usuarios WHERE email=%s AND activo=TRUE",
                    (payload.jefe_email.lower(),),
                )
                boss = cur.fetchone()
                if not boss:
                    raise HTTPException(status_code=422, detail="El email del jefe todavía no está creado como usuario activo.")
                if boss["id"] == target["id"]:
                    raise HTTPException(status_code=422, detail="Un usuario no puede ser su propio jefe.")
                cur.execute(
                    "UPDATE jefaturas SET fecha_hasta=CURRENT_DATE-1 WHERE usuario_id=%s AND fecha_hasta IS NULL",
                    (target["id"],),
                )
                cur.execute(
                    "INSERT INTO jefaturas(usuario_id,jefe_id,fecha_desde) VALUES (%s,%s,CURRENT_DATE)",
                    (target["id"], boss["id"]),
                )
            conn.commit()
            return {"status": "ok", "id": target["id"]}


@app.post("/api/admin/usuarios/{target_id}/estado")
def set_user_status(target_id: int, payload: AdminUserStatusIn, user: dict = Depends(require_roles("ADMIN"))):
    if target_id == user["id"] and not payload.activo:
        raise HTTPException(status_code=409, detail="No podés deshabilitar tu propio usuario.")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM usuarios WHERE id=%s", (target_id,))
            target = cur.fetchone()
            if not target:
                raise HTTPException(status_code=404, detail="Usuario inexistente.")
            if (target.get("username") or "").lower() == settings.bootstrap_admin_username.lower() and not payload.activo:
                raise HTTPException(status_code=409, detail="La cuenta administradora inicial no puede deshabilitarse desde el panel.")
            cur.execute("UPDATE usuarios SET activo=%s,updated_at=NOW() WHERE id=%s", (payload.activo, target_id))
            if not payload.activo:
                cur.execute("UPDATE jefaturas SET fecha_hasta=CURRENT_DATE-1 WHERE (usuario_id=%s OR jefe_id=%s) AND fecha_hasta IS NULL", (target_id, target_id))
            conn.commit()
    return {"status": "ok", "activo": payload.activo}


@app.get("/api/sheets/status")
def sheets_status(user: dict = Depends(require_roles("RRHH"))):
    return integration_status()


@app.post("/api/sheets/connect")
def sheets_connect(user: dict = Depends(require_roles("RRHH"))):
    try:
        return {"authorization_url": create_authorization_url(user)}
    except Exception as exc:
        raise HTTPException(
            status_code=503,
            detail=f"No fue posible iniciar la autorización de Google Sheets: {exc}",
        )


@app.get("/api/google-sheets/callback")
def google_sheets_callback(
    state: str | None = Query(default=None),
    code: str | None = Query(default=None),
    error: str | None = Query(default=None),
):
    base = settings.permisos_frontend_url.rstrip("/") + "/"
    if error:
        return RedirectResponse(
            url=f"{base}?sheets=error&message={error}",
            status_code=302,
        )
    if not state or not code:
        return RedirectResponse(
            url=f"{base}?sheets=error&message=respuesta_incompleta",
            status_code=302,
        )

    try:
        finish_authorization(state, code)
        return RedirectResponse(
            url=f"{base}?sheets=connected",
            status_code=302,
        )
    except Exception as exc:
        from urllib.parse import quote
        return RedirectResponse(
            url=f"{base}?sheets=error&message={quote(str(exc))}",
            status_code=302,
        )


@app.post("/api/sheets/disconnect")
def sheets_disconnect(user: dict = Depends(require_roles("RRHH"))):
    try:
        return disconnect_sheets()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible desconectar Google Sheets: {exc}",
        )


@app.post("/api/sheets/sync")
def sync_sheets(user: dict = Depends(require_roles("RRHH"))):
    try:
        return sync_all()
    except Exception as exc:
        raise HTTPException(
            status_code=502,
            detail=f"No fue posible sincronizar Google Sheets: {exc}",
        )

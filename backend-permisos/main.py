from contextlib import asynccontextmanager
from datetime import date
from typing import Literal

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr, Field

from app.auth import get_current_user, require_roles
from app.config import settings
from app.database import close_pool, connection, init_schema, start_pool
from app.sheets_service import sync_all
from app.workflow import active_boss, add_history, calculate_minutes, get_permission_for_user, max_business_date


@asynccontextmanager
async def lifespan(app: FastAPI):
    start_pool()
    init_schema()
    yield
    close_pool()


app = FastAPI(title="ERSeP · Permisos de Salida API", version="0.1.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(settings.frontend_origins),
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


class PermissionIn(BaseModel):
    tipo: Literal["OFICIAL", "PARTICULAR"]
    fecha_salida: date
    lugar_destino: str | None = Field(default=None, max_length=300)
    hora_salida: str
    hora_regreso: str | None = None
    sin_regreso: bool = False
    fecha_devolucion: date | None = None
    observaciones: str | None = Field(default=None, max_length=1000)


class DecisionIn(BaseModel):
    observacion: str | None = Field(default=None, max_length=1000)


class AdminUserIn(BaseModel):
    email: EmailStr
    nombre: str = Field(min_length=1, max_length=120)
    apellido: str = Field(min_length=1, max_length=120)
    legajo: str = Field(min_length=1, max_length=40)
    dni: str | None = Field(default=None, max_length=30)
    area: str | None = Field(default=None, max_length=180)
    roles: list[Literal["AGENTE","JEFE","RRHH","ADMIN"]] = ["AGENTE"]
    jefe_email: EmailStr | None = None


def _parse_time(value: str | None):
    if value is None:
        return None
    from datetime import time
    try:
        hh, mm = value.split(":")[:2]
        return time(hour=int(hh), minute=int(mm))
    except Exception:
        raise HTTPException(status_code=422, detail=f"Hora inválida: {value}")


def _serialize_permission(row: dict):
    for key in ("hora_salida", "hora_regreso"):
        if row.get(key) is not None:
            row[key] = str(row[key])[:5]
    return row


@app.get("/api/health")
def health():
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT 1 ok")
            db_ok = cur.fetchone()["ok"] == 1
    return {"status": "ok", "database": db_ok, "sheets_configured": bool(settings.google_sheet_id and settings.google_credentials_json)}


@app.get("/api/auth/me")
def auth_me(user: dict = Depends(get_current_user)):
    return {
        "id": user["id"], "email": user["email"], "nombre": user["nombre"], "apellido": user["apellido"],
        "dni": user.get("dni"), "legajo": user.get("legajo"), "area": user.get("area"), "roles": user["roles"]
    }


@app.post("/api/permisos")
def create_permission(payload: PermissionIn, user: dict = Depends(require_roles("AGENTE"))):
    if payload.tipo == "OFICIAL" and not (payload.lugar_destino or "").strip():
        raise HTTPException(status_code=422, detail="Las salidas oficiales requieren lugar de destino.")
    if payload.tipo == "PARTICULAR" and not payload.fecha_devolucion:
        raise HTTPException(status_code=422, detail="Las salidas particulares requieren fecha de devolución de horas.")

    start = _parse_time(payload.hora_salida)
    end = _parse_time(payload.hora_regreso)
    minutes = calculate_minutes(start, end, payload.sin_regreso)

    with connection() as conn:
        with conn.cursor() as cur:
            if payload.tipo == "PARTICULAR":
                max_date = max_business_date(cur, payload.fecha_salida, 7)
                if payload.fecha_devolucion < payload.fecha_salida or payload.fecha_devolucion > max_date:
                    raise HTTPException(status_code=422, detail=f"La devolución debe realizarse entre la fecha de salida y el {max_date.strftime('%d/%m/%Y')} (7 días hábiles).")
            cur.execute("""
                INSERT INTO permisos_salida (
                  agente_id,tipo,fecha_salida,lugar_destino,hora_salida,hora_regreso,sin_regreso,minutos_autorizados,fecha_devolucion,observaciones,estado
                ) VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,'BORRADOR') RETURNING *
            """, (user["id"],payload.tipo,payload.fecha_salida,(payload.lugar_destino or "").strip() or None,start,end,payload.sin_regreso,minutes,payload.fecha_devolucion,payload.observaciones))
            p = cur.fetchone()
            number = f"PS-{payload.fecha_salida.year}-{p['id']:06d}"
            cur.execute("UPDATE permisos_salida SET numero_permiso=%s WHERE id=%s", (number,p["id"]))
            add_history(cur,p["id"],user["id"],"SOLICITUD_CREADA",None,"BORRADOR",None)
            if payload.tipo == "PARTICULAR":
                cur.execute("""INSERT INTO reposiciones (permiso_id,fecha_prevista,minutos_a_reponer) VALUES (%s,%s,%s)""", (p["id"],payload.fecha_devolucion,minutes))
            conn.commit()
            p["numero_permiso"] = number
            return _serialize_permission(p)


@app.post("/api/permisos/{permission_id}/enviar")
def send_permission(permission_id: int, user: dict = Depends(require_roles("AGENTE"))):
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
            cur.execute("UPDATE permisos_salida SET estado='PENDIENTE_JEFE',jefe_asignado_id=%s,updated_at=NOW() WHERE id=%s", (boss["id"],permission_id))
            add_history(cur,permission_id,user["id"],"ENVIADO_A_JEFE","BORRADOR","PENDIENTE_JEFE",f"Jefatura asignada: {boss['nombre']} {boss['apellido']}")
            conn.commit()
    return {"status":"ok","message":"Solicitud enviada a autorización."}


@app.get("/api/permisos/mios")
def my_permissions(user: dict = Depends(require_roles("AGENTE"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.*,trim(concat(u.nombre,' ',u.apellido)) agente_nombre
                FROM permisos_salida p JOIN usuarios u ON u.id=p.agente_id
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
                SELECT p.*,trim(concat(u.nombre,' ',u.apellido)) agente_nombre,u.legajo
                FROM permisos_salida p JOIN usuarios u ON u.id=p.agente_id
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
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'JEFE','APROBADO',%s)", (permission_id,user["id"],payload.observacion))
            cur.execute("UPDATE permisos_salida SET estado='PENDIENTE_RRHH',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur,permission_id,user["id"],"AUTORIZADO_JEFE","PENDIENTE_JEFE","PENDIENTE_RRHH",payload.observacion)
            conn.commit()
    if settings.sheets_enabled: bg.add_task(sync_all)
    return {"status":"ok"}


@app.post("/api/permisos/{permission_id}/rechazar")
def reject(permission_id: int, payload: DecisionIn, user: dict = Depends(require_roles("JEFE"))):
    if not (payload.observacion or "").strip():
        raise HTTPException(status_code=422, detail="Debe indicar el motivo del rechazo.")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p = cur.fetchone()
            if not p: raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["jefe_asignado_id"] != user["id"] and "ADMIN" not in user["roles"]:
                raise HTTPException(status_code=403, detail="No sos la jefatura asignada.")
            if p["estado"] != "PENDIENTE_JEFE":
                raise HTTPException(status_code=409, detail="La solicitud ya no está pendiente.")
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'JEFE','RECHAZADO',%s)", (permission_id,user["id"],payload.observacion))
            cur.execute("UPDATE permisos_salida SET estado='RECHAZADO',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur,permission_id,user["id"],"RECHAZADO_JEFE","PENDIENTE_JEFE","RECHAZADO",payload.observacion)
            conn.commit()
    return {"status":"ok"}


@app.get("/api/rrhh/permisos")
def rrhh_permissions(estado: str | None = Query(default=None), tipo: str | None = Query(default=None), user: dict = Depends(require_roles("RRHH"))):
    clauses=[]; params=[]
    if estado: clauses.append("p.estado=%s"); params.append(estado)
    if tipo: clauses.append("p.tipo=%s"); params.append(tipo)
    where = "WHERE " + " AND ".join(clauses) if clauses else ""
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(f"""
                SELECT p.*,trim(concat(a.nombre,' ',a.apellido)) agente_nombre,a.legajo,trim(concat(j.nombre,' ',j.apellido)) jefe_nombre
                FROM permisos_salida p JOIN usuarios a ON a.id=p.agente_id LEFT JOIN usuarios j ON j.id=p.jefe_asignado_id
                {where} ORDER BY p.fecha_salida DESC,p.id DESC LIMIT 1000
            """, params)
            rows=[_serialize_permission(r) for r in cur.fetchall()]
    return {"items":rows}


@app.get("/api/rrhh/dashboard")
def rrhh_dashboard(user: dict = Depends(require_roles("RRHH"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)) total_mes,
                  COUNT(*) FILTER (WHERE estado='PENDIENTE_RRHH') pendientes_rrhh,
                  COUNT(*) FILTER (WHERE tipo='PARTICULAR' AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)) particulares_mes,
                  COALESCE(SUM(minutos_autorizados) FILTER (WHERE tipo='PARTICULAR' AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)),0) minutos_particulares_mes
                FROM permisos_salida
            """)
            return cur.fetchone()


@app.post("/api/permisos/{permission_id}/verificar-rrhh")
def verify_rrhh(permission_id: int, payload: DecisionIn, bg: BackgroundTasks, user: dict = Depends(require_roles("RRHH"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM permisos_salida WHERE id=%s FOR UPDATE", (permission_id,))
            p=cur.fetchone()
            if not p: raise HTTPException(status_code=404, detail="Permiso inexistente.")
            if p["estado"] != "PENDIENTE_RRHH": raise HTTPException(status_code=409, detail="El permiso no está pendiente de RR.HH.")
            cur.execute("INSERT INTO aprobaciones (permiso_id,usuario_id,tipo_aprobacion,decision,observacion) VALUES (%s,%s,'RRHH','VERIFICADO',%s)", (permission_id,user["id"],payload.observacion))
            cur.execute("UPDATE permisos_salida SET estado='VERIFICADO_RRHH',updated_at=NOW() WHERE id=%s", (permission_id,))
            add_history(cur,permission_id,user["id"],"VERIFICADO_RRHH","PENDIENTE_RRHH","VERIFICADO_RRHH",payload.observacion)
            conn.commit()
    if settings.sheets_enabled: bg.add_task(sync_all)
    return {"status":"ok"}


@app.get("/api/admin/usuarios")
def list_users(user: dict = Depends(require_roles("ADMIN"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
              SELECT u.*,COALESCE(array_agg(DISTINCT r.codigo) FILTER (WHERE r.codigo IS NOT NULL),'{}') roles,
                     trim(concat(jefe.nombre,' ',jefe.apellido)) jefe_nombre
              FROM usuarios u
              LEFT JOIN usuario_roles ur ON ur.usuario_id=u.id LEFT JOIN roles r ON r.id=ur.rol_id
              LEFT JOIN LATERAL (
                SELECT jj.jefe_id FROM jefaturas jj WHERE jj.usuario_id=u.id AND jj.fecha_desde<=CURRENT_DATE AND (jj.fecha_hasta IS NULL OR jj.fecha_hasta>=CURRENT_DATE)
                ORDER BY jj.es_suplencia DESC,jj.fecha_desde DESC LIMIT 1
              ) ja ON TRUE
              LEFT JOIN usuarios jefe ON jefe.id=ja.jefe_id
              GROUP BY u.id,jefe.nombre,jefe.apellido ORDER BY u.apellido,u.nombre
            """)
            return {"items":cur.fetchall()}


@app.post("/api/admin/usuarios")
def upsert_user(payload: AdminUserIn, user: dict = Depends(require_roles("ADMIN"))):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
              INSERT INTO usuarios(email,nombre,apellido,legajo,dni,area,activo)
              VALUES (%s,%s,%s,%s,%s,%s,TRUE)
              ON CONFLICT(email) DO UPDATE SET nombre=EXCLUDED.nombre,apellido=EXCLUDED.apellido,legajo=EXCLUDED.legajo,dni=EXCLUDED.dni,area=EXCLUDED.area,activo=TRUE,updated_at=NOW()
              RETURNING *
            """, (payload.email.lower(),payload.nombre,payload.apellido,payload.legajo,payload.dni,payload.area))
            target=cur.fetchone()
            cur.execute("DELETE FROM usuario_roles WHERE usuario_id=%s", (target["id"],))
            for role in set(payload.roles or ["AGENTE"]):
                cur.execute("INSERT INTO usuario_roles(usuario_id,rol_id) SELECT %s,id FROM roles WHERE codigo=%s", (target["id"],role))
            if payload.jefe_email:
                cur.execute("SELECT id FROM usuarios WHERE email=%s AND activo=TRUE", (payload.jefe_email.lower(),))
                boss=cur.fetchone()
                if not boss: raise HTTPException(status_code=422, detail="El email del jefe todavía no está creado como usuario activo.")
                cur.execute("UPDATE jefaturas SET fecha_hasta=CURRENT_DATE-1 WHERE usuario_id=%s AND fecha_hasta IS NULL", (target["id"],))
                cur.execute("INSERT INTO jefaturas(usuario_id,jefe_id,fecha_desde) VALUES (%s,%s,CURRENT_DATE)", (target["id"],boss["id"]))
            conn.commit()
            return {"status":"ok","id":target["id"]}


@app.post("/api/sheets/sync")
def sync_sheets(user: dict = Depends(require_roles("RRHH"))):
    try:
        return sync_all()
    except Exception as exc:
        raise HTTPException(status_code=502, detail=f"No fue posible sincronizar Google Sheets: {exc}")

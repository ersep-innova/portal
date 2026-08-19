from datetime import date, datetime, timedelta
from fastapi import HTTPException
from .database import connection


def active_boss(cur, user_id: int, on_date: date):
    cur.execute("""
        SELECT u.*
        FROM jefaturas j
        JOIN usuarios u ON u.id = j.jefe_id
        WHERE j.usuario_id=%s
          AND j.fecha_desde <= %s
          AND (j.fecha_hasta IS NULL OR j.fecha_hasta >= %s)
          AND u.activo=TRUE
        ORDER BY j.es_suplencia DESC, j.fecha_desde DESC
        LIMIT 1
    """, (user_id, on_date, on_date))
    return cur.fetchone()


def max_business_date(cur, start: date, business_days: int = 7) -> date:
    cur.execute("SELECT fecha FROM feriados WHERE activo=TRUE AND fecha > %s AND fecha <= %s", (start, start + timedelta(days=20)))
    holidays = {r["fecha"] for r in cur.fetchall()}
    cursor = start
    count = 0
    while count < business_days:
        cursor += timedelta(days=1)
        if cursor.weekday() < 5 and cursor not in holidays:
            count += 1
    return cursor


def calculate_minutes(start_time, end_time, no_return: bool):
    if no_return:
        return None
    if end_time is None:
        raise HTTPException(status_code=422, detail="Debe indicar hora de regreso o marcar 'Sin regreso'.")
    start = datetime.combine(date.today(), start_time)
    end = datetime.combine(date.today(), end_time)
    minutes = int((end - start).total_seconds() // 60)
    if minutes <= 0:
        raise HTTPException(status_code=422, detail="La hora de regreso debe ser posterior a la hora de salida.")
    return minutes


def add_history(cur, permission_id: int, user_id: int | None, event: str, previous: str | None, new: str | None, detail: str | None = None):
    cur.execute("""
        INSERT INTO historial_permiso (permiso_id, usuario_id, evento, estado_anterior, estado_nuevo, detalle)
        VALUES (%s,%s,%s,%s,%s,%s)
    """, (permission_id, user_id, event, previous, new, detail))


def get_permission_for_user(permission_id: int, user: dict):
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.*, trim(concat(a.nombre,' ',a.apellido)) agente_nombre, a.legajo, a.dni, a.area,
                       trim(concat(j.nombre,' ',j.apellido)) jefe_nombre
                FROM permisos_salida p
                JOIN usuarios a ON a.id=p.agente_id
                LEFT JOIN usuarios j ON j.id=p.jefe_asignado_id
                WHERE p.id=%s
            """, (permission_id,))
            p = cur.fetchone()
            if not p:
                raise HTTPException(status_code=404, detail="Permiso inexistente.")
            allowed = p["agente_id"] == user["id"] or p.get("jefe_asignado_id") == user["id"] or bool(set(user["roles"]) & {"RRHH","ADMIN"})
            if not allowed:
                raise HTTPException(status_code=403, detail="No podés consultar este permiso.")
            cur.execute("""
                SELECT h.*, trim(concat(u.nombre,' ',u.apellido)) usuario_nombre
                FROM historial_permiso h LEFT JOIN usuarios u ON u.id=h.usuario_id
                WHERE h.permiso_id=%s ORDER BY h.fecha_hora ASC
            """, (permission_id,))
            p["historial"] = cur.fetchall()
            return p

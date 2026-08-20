import json
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials

from .config import settings
from .database import connection

SCOPES = [
    # Acceso mínimo necesario: el Sheet se comparte directamente con la cuenta de servicio.
    "https://www.googleapis.com/auth/spreadsheets",
]


def _client():
    if not settings.sheets_enabled or not settings.google_sheet_id or not settings.google_credentials_json:
        return None
    info = json.loads(settings.google_credentials_json)
    creds = Credentials.from_service_account_info(info, scopes=SCOPES)
    return gspread.authorize(creds)


def _worksheet(book, title, rows=1000, cols=40):
    try:
        return book.worksheet(title)
    except gspread.WorksheetNotFound:
        return book.add_worksheet(title=title, rows=rows, cols=cols)


def _t(value):
    return "" if value is None else str(value)[:5]


def sync_all() -> dict:
    client = _client()
    if client is None:
        return {"status": "skipped", "message": "Google Sheets todavía no está configurado."}

    book = client.open_by_key(settings.google_sheet_id)
    ws = _worksheet(book, "PERMISOS")
    ws_repo = _worksheet(book, "REPOSICIONES")
    ws_summary = _worksheet(book, "RESUMEN", rows=100, cols=10)

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id,p.numero_permiso,p.fecha_salida,
                       trim(concat(a.nombre,' ',a.apellido)) agente,a.dni,a.legajo,a.area,
                       p.tipo,p.lugar_destino,p.hora_salida,p.hora_regreso,p.sin_regreso,
                       p.jornada_desde,p.jornada_hasta,p.minutos_calculados,p.minutos_declarados,
                       p.justificacion_minutos,p.fecha_devolucion,p.fecha_limite_devolucion,
                       p.fuera_plazo_reglamentario,p.justificacion_fuera_plazo,
                       trim(concat(j.nombre,' ',j.apellido)) jefe,p.estado,
                       p.created_at,p.updated_at
                FROM permisos_salida p
                JOIN usuarios a ON a.id=p.agente_id
                LEFT JOIN usuarios j ON j.id=p.jefe_asignado_id
                ORDER BY p.fecha_salida DESC,p.id DESC
            """)
            permits = cur.fetchall()
            cur.execute("""
                SELECT r.*,p.numero_permiso,trim(concat(u.nombre,' ',u.apellido)) agente
                FROM reposiciones r
                JOIN permisos_salida p ON p.id=r.permiso_id
                JOIN usuarios u ON u.id=p.agente_id
                ORDER BY r.fecha_prevista DESC
            """)
            repos = cur.fetchall()
            cur.execute("""
                SELECT
                  COUNT(*) FILTER (WHERE date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)) total_mes,
                  COUNT(*) FILTER (WHERE estado='PENDIENTE_RRHH') pendientes_rrhh,
                  COUNT(*) FILTER (WHERE tipo='PARTICULAR' AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)) particulares_mes,
                  COALESCE(SUM(minutos_declarados) FILTER (WHERE tipo='PARTICULAR' AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)),0) minutos_particulares_mes
                FROM permisos_salida
            """)
            summary = cur.fetchone()

    header = [
        "ID","Número","Fecha","Agente","DNI","Legajo","Área","Tipo","Destino","Salida","Regreso","Sin regreso",
        "Jornada desde","Jornada hasta","Minutos calculados","Minutos declarados","Justificación diferencia",
        "Fecha devolución","Fecha límite 7 días hábiles","Fuera de plazo","Justificación fuera de plazo",
        "Jefe","Estado","Creado","Actualizado"
    ]
    values = [header]
    for p in permits:
        values.append([
            p["id"], p["numero_permiso"], str(p["fecha_salida"]), p["agente"], p["dni"] or "", p["legajo"] or "", p["area"] or "", p["tipo"],
            p["lugar_destino"] or "", _t(p["hora_salida"]), "" if p["sin_regreso"] else _t(p["hora_regreso"]), "SI" if p["sin_regreso"] else "NO",
            _t(p["jornada_desde"]), _t(p["jornada_hasta"]), p["minutos_calculados"] if p["minutos_calculados"] is not None else "",
            p["minutos_declarados"] if p["minutos_declarados"] is not None else "", p["justificacion_minutos"] or "",
            str(p["fecha_devolucion"] or ""), str(p["fecha_limite_devolucion"] or ""), "SI" if p["fuera_plazo_reglamentario"] else "NO",
            p["justificacion_fuera_plazo"] or "", p["jefe"] or "", p["estado"], p["created_at"].isoformat(), p["updated_at"].isoformat()
        ])
    ws.clear()
    ws.update(values, "A1")
    ws.freeze(rows=1)

    repo_header = [
        "Número permiso","Agente","Fecha prevista","Desde","Hasta","Fecha real",
        "Minutos a reponer","Minutos repuestos","Estado"
    ]
    repo_values = [repo_header] + [[
        r["numero_permiso"], r["agente"], str(r["fecha_prevista"]), _t(r.get("hora_desde_prevista")), _t(r.get("hora_hasta_prevista")),
        str(r["fecha_real"] or ""), r["minutos_a_reponer"] if r["minutos_a_reponer"] is not None else "", r["minutos_repuestos"], r["estado"]
    ] for r in repos]
    ws_repo.clear()
    ws_repo.update(repo_values, "A1")
    ws_repo.freeze(rows=1)

    summary_values = [
        ["Indicador", "Valor"],
        ["Permisos del mes", summary["total_mes"]],
        ["Pendientes RR.HH.", summary["pendientes_rrhh"]],
        ["Particulares del mes", summary["particulares_mes"]],
        ["Minutos particulares del mes", summary["minutos_particulares_mes"]],
        ["Última sincronización", datetime.now().isoformat(timespec="seconds")],
    ]
    ws_summary.clear()
    ws_summary.update(summary_values, "A1")
    ws_summary.freeze(rows=1)

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO sync_sheets (permiso_id, estado, ultimo_intento, ultimo_exito, numero_intentos)
                SELECT id,'SINCRONIZADO',NOW(),NOW(),1 FROM permisos_salida
                ON CONFLICT (permiso_id) DO UPDATE SET
                  estado='SINCRONIZADO',ultimo_intento=NOW(),ultimo_exito=NOW(),mensaje_error=NULL,
                  numero_intentos=sync_sheets.numero_intentos+1
            """)
        conn.commit()
    return {"status": "ok", "message": f"Google Sheets sincronizado: {len(permits)} permisos."}

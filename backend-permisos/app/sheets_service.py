import secrets
from datetime import datetime, timedelta

import gspread
import requests
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow

from .config import settings
from .database import connection

SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
]

AUTH_URI = "https://accounts.google.com/o/oauth2/auth"
TOKEN_URI = "https://oauth2.googleapis.com/token"
REVOKE_URI = "https://oauth2.googleapis.com/revoke"


def _client_config() -> dict:
    return {
        "web": {
            "client_id": settings.google_oauth_client_id,
            "client_secret": settings.google_oauth_client_secret,
            "auth_uri": AUTH_URI,
            "token_uri": TOKEN_URI,
            "redirect_uris": [settings.google_sheets_redirect_uri],
        }
    }


def oauth_base_configured() -> bool:
    return bool(
        settings.sheets_enabled
        and settings.google_oauth_client_id
        and settings.google_oauth_client_secret
        and settings.google_sheet_id
        and settings.google_sheets_redirect_uri
    )


def get_integration() -> dict | None:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT g.*, trim(concat(u.nombre,' ',u.apellido)) autorizado_nombre
                FROM google_sheets_integracion g
                LEFT JOIN usuarios u ON u.id=g.autorizado_por
                WHERE g.id=1 AND g.activo=TRUE
            """)
            return cur.fetchone()


def integration_status() -> dict:
    integration = get_integration()
    return {
        "enabled": settings.sheets_enabled,
        "base_configured": oauth_base_configured(),
        "authorized": bool(integration),
        "configured": bool(integration and oauth_base_configured()),
        "sheet_url": (
            f"https://docs.google.com/spreadsheets/d/{settings.google_sheet_id}/edit"
            if settings.google_sheet_id else None
        ),
        "authorized_by": integration.get("autorizado_nombre") if integration else None,
        "authorized_email": integration.get("autorizado_email") if integration else None,
    }


def create_authorization_url(user: dict) -> str:
    if not oauth_base_configured():
        raise RuntimeError(
            "Google Sheets OAuth no está completamente configurado en Render."
        )

    state = secrets.token_urlsafe(32)
    expires = datetime.utcnow() + timedelta(minutes=10)

    # PKCE: el code_verifier debe sobrevivir hasta el callback OAuth.
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        state=state,
        autogenerate_code_verifier=True,
    )
    flow.redirect_uri = settings.google_sheets_redirect_uri

    authorization_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
    )

    code_verifier = flow.code_verifier
    if not code_verifier:
        raise RuntimeError("No fue posible generar el code_verifier OAuth.")

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM google_sheets_oauth_states WHERE expires_at < NOW()"
            )
            cur.execute("""
                INSERT INTO google_sheets_oauth_states (
                    state, usuario_id, code_verifier, expires_at
                )
                VALUES (%s,%s,%s,%s)
            """, (state, user["id"], code_verifier, expires))
        conn.commit()

    return authorization_url


def finish_authorization(state: str, code: str) -> dict:
    if not oauth_base_configured():
        raise RuntimeError("La integración OAuth con Google Sheets no está configurada.")

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT s.*,u.email
                FROM google_sheets_oauth_states s
                JOIN usuarios u ON u.id=s.usuario_id
                WHERE s.state=%s AND s.expires_at >= NOW()
            """, (state,))
            state_row = cur.fetchone()
            if not state_row:
                raise RuntimeError("La autorización expiró o el parámetro state no es válido.")
            if not state_row.get("code_verifier"):
                raise RuntimeError(
                    "La autorización OAuth no tiene code_verifier. Iniciá nuevamente la conexión con Google Sheets."
                )

    # Se reconstruye el Flow con el MISMO code_verifier utilizado al generar
    # el code_challenge enviado a Google.
    flow = Flow.from_client_config(
        _client_config(),
        scopes=SCOPES,
        state=state,
        code_verifier=state_row["code_verifier"],
    )
    flow.redirect_uri = settings.google_sheets_redirect_uri
    flow.fetch_token(code=code)
    creds = flow.credentials

    if not creds.refresh_token:
        raise RuntimeError(
            "Google no devolvió un refresh token. Volvé a conectar la cuenta y aceptá nuevamente el acceso."
        )

    # Verifica de inmediato que la cuenta autorizada realmente puede abrir el Sheet.
    test_client = gspread.authorize(creds)
    test_client.open_by_key(settings.google_sheet_id)

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                INSERT INTO google_sheets_integracion (
                    id,autorizado_por,autorizado_email,refresh_token,scope,sheet_id,activo,updated_at
                )
                VALUES (1,%s,%s,%s,%s,%s,TRUE,NOW())
                ON CONFLICT (id) DO UPDATE SET
                    autorizado_por=EXCLUDED.autorizado_por,
                    autorizado_email=EXCLUDED.autorizado_email,
                    refresh_token=EXCLUDED.refresh_token,
                    scope=EXCLUDED.scope,
                    sheet_id=EXCLUDED.sheet_id,
                    activo=TRUE,
                    updated_at=NOW()
            """, (
                state_row["usuario_id"],
                state_row["email"],
                creds.refresh_token,
                " ".join(SCOPES),
                settings.google_sheet_id,
            ))
            cur.execute("DELETE FROM google_sheets_oauth_states WHERE state=%s", (state,))
        conn.commit()

    return {
        "status": "ok",
        "authorized_email": state_row["email"],
        "sheet_url": f"https://docs.google.com/spreadsheets/d/{settings.google_sheet_id}/edit",
    }


def disconnect() -> dict:
    integration = get_integration()
    if not integration:
        return {"status": "ok", "message": "Google Sheets ya estaba desconectado."}

    try:
        requests.post(
            REVOKE_URI,
            params={"token": integration["refresh_token"]},
            timeout=15,
        )
    except Exception:
        pass

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("DELETE FROM google_sheets_integracion WHERE id=1")
        conn.commit()

    return {"status": "ok", "message": "Cuenta Google desconectada de Sheets."}


def _credentials() -> Credentials | None:
    integration = get_integration()
    if not integration or not oauth_base_configured():
        return None

    return Credentials(
        token=None,
        refresh_token=integration["refresh_token"],
        token_uri=TOKEN_URI,
        client_id=settings.google_oauth_client_id,
        client_secret=settings.google_oauth_client_secret,
        scopes=SCOPES,
    )


def _client():
    creds = _credentials()
    if creds is None:
        return None
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
        return {
            "status": "skipped",
            "message": "Google Sheets todavía no está autorizado.",
        }

    book = client.open_by_key(settings.google_sheet_id)
    ws = _worksheet(book, "PERMISOS")
    ws_repo = _worksheet(book, "REPOSICIONES")
    ws_summary = _worksheet(book, "RESUMEN", rows=100, cols=10)

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("""
                SELECT p.id,p.numero_permiso,p.fecha_salida,
                       trim(concat(a.nombre,' ',a.apellido)) agente,a.dni,a.legajo,
                       COALESCE(op.nombre,ou.nombre,a.area) oficina,
                       p.tipo,p.lugar_destino,p.hora_salida,p.hora_regreso,p.sin_regreso,
                       p.jornada_desde,p.jornada_hasta,p.minutos_calculados,p.minutos_declarados,
                       p.justificacion_minutos,p.fecha_devolucion,p.fecha_limite_devolucion,
                       p.fuera_plazo_reglamentario,p.justificacion_fuera_plazo,
                       trim(concat(j.nombre,' ',j.apellido)) jefe,p.estado,
                       p.created_at,p.updated_at
                FROM permisos_salida p
                JOIN usuarios a ON a.id=p.agente_id
                LEFT JOIN oficinas op ON op.id=p.oficina_id
                LEFT JOIN oficinas ou ON ou.id=a.oficina_id
                LEFT JOIN usuarios j ON j.id=p.jefe_asignado_id
                ORDER BY p.fecha_salida DESC,p.id DESC
            """)
            permits = cur.fetchall()

            cur.execute("""
                SELECT r.*,p.numero_permiso,trim(concat(u.nombre,' ',u.apellido)) agente
                FROM reposiciones r
                JOIN permisos_salida p ON p.id=r.permiso_id
                JOIN usuarios u ON u.id=p.agente_id
                ORDER BY COALESCE(r.fecha_prevista,r.fecha_horas_extra) DESC NULLS LAST
            """)
            repos = cur.fetchall()

            cur.execute("""
                SELECT
                  COUNT(*) FILTER (
                    WHERE date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)
                  ) total_mes,
                  COUNT(*) FILTER (WHERE estado='PENDIENTE_RRHH') pendientes_rrhh,
                  COUNT(*) FILTER (
                    WHERE tipo='PARTICULAR'
                      AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)
                  ) particulares_mes,
                  COALESCE(SUM(minutos_declarados) FILTER (
                    WHERE tipo='PARTICULAR'
                      AND date_trunc('month',fecha_salida)=date_trunc('month',CURRENT_DATE)
                  ),0) minutos_particulares_mes
                FROM permisos_salida
            """)
            summary = cur.fetchone()

    header = [
        "ID","Número","Fecha","Agente","DNI","Legajo","Oficina","Tipo","Destino",
        "Salida","Regreso","Sin regreso","Jornada desde","Jornada hasta",
        "Minutos calculados","Minutos declarados","Justificación diferencia",
        "Fecha devolución","Fecha límite 7 días hábiles","Fuera de plazo",
        "Justificación fuera de plazo","Jefe","Estado","Creado","Actualizado"
    ]

    values = [header]
    for p in permits:
        values.append([
            p["id"], p["numero_permiso"], str(p["fecha_salida"]), p["agente"],
            p["dni"] or "", p["legajo"] or "", p["oficina"] or "", p["tipo"],
            p["lugar_destino"] or "", _t(p["hora_salida"]),
            "" if p["sin_regreso"] else _t(p["hora_regreso"]),
            "SI" if p["sin_regreso"] else "NO",
            _t(p["jornada_desde"]), _t(p["jornada_hasta"]),
            p["minutos_calculados"] if p["minutos_calculados"] is not None else "",
            p["minutos_declarados"] if p["minutos_declarados"] is not None else "",
            p["justificacion_minutos"] or "",
            str(p["fecha_devolucion"] or ""),
            str(p["fecha_limite_devolucion"] or ""),
            "SI" if p["fuera_plazo_reglamentario"] else "NO",
            p["justificacion_fuera_plazo"] or "",
            p["jefe"] or "",
            p["estado"],
            p["created_at"].isoformat(),
            p["updated_at"].isoformat(),
        ])

    ws.clear()
    ws.update(values, "A1")
    ws.freeze(rows=1)

    repo_header = [
        "Número permiso","Agente","Modalidad","Fecha devolución","Desde devolución","Hasta devolución",
        "Fecha horas extras previas","Desde horas extras","Hasta horas extras","Minutos horas extras",
        "Fecha real","Minutos a compensar","Minutos compensados","Estado"
    ]
    repo_values = [repo_header] + [[
        r["numero_permiso"], r["agente"], r.get("modalidad") or "DEVOLVER_HORAS",
        str(r.get("fecha_prevista") or ""),
        _t(r.get("hora_desde_prevista")), _t(r.get("hora_hasta_prevista")),
        str(r.get("fecha_horas_extra") or ""),
        _t(r.get("hora_desde_horas_extra")), _t(r.get("hora_hasta_horas_extra")),
        r.get("minutos_horas_extra") if r.get("minutos_horas_extra") is not None else "",
        str(r.get("fecha_real") or ""),
        r["minutos_a_reponer"] if r["minutos_a_reponer"] is not None else "",
        r["minutos_repuestos"],
        r["estado"],
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
                INSERT INTO sync_sheets (
                    permiso_id, estado, ultimo_intento, ultimo_exito, numero_intentos
                )
                SELECT id,'SINCRONIZADO',NOW(),NOW(),1
                FROM permisos_salida
                ON CONFLICT (permiso_id) DO UPDATE SET
                    estado='SINCRONIZADO',
                    ultimo_intento=NOW(),
                    ultimo_exito=NOW(),
                    mensaje_error=NULL,
                    numero_intentos=sync_sheets.numero_intentos+1
            """)
        conn.commit()

    return {
        "status": "ok",
        "message": f"Google Sheets sincronizado: {len(permits)} permisos.",
    }

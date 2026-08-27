import base64
import logging
import os
import smtplib
import ssl
import threading
import time
from email.message import EmailMessage
from email.utils import make_msgid
from html import escape

import requests

from .config import settings
from .database import connection

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"
GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token"
GMAIL_SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send"
RRHH_CONTACT_EMAIL = "ersep.capacitaciones@gmail.com"

# Cache en memoria del access_token de Gmail. El refresh token permanece sólo
# en las variables de entorno de Render y nunca se expone al frontend.
_GMAIL_TOKEN_LOCK = threading.Lock()
_GMAIL_TOKEN_CACHE = {"access_token": "", "expires_at": 0.0}


def _provider() -> str:
    return os.getenv("EMAIL_PROVIDER", "gmail_api").strip().lower()


def _smtp_config() -> dict:
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com").strip(),
        "port": int(os.getenv("SMTP_PORT", "465")),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        "ssl": os.getenv("SMTP_SSL", "true").strip().lower() in {"1", "true", "yes", "on"},
    }


def _gmail_api_config() -> dict:
    return {
        "client_id": os.getenv("GMAIL_API_CLIENT_ID", "").strip(),
        "client_secret": os.getenv("GMAIL_API_CLIENT_SECRET", "").strip(),
        "refresh_token": os.getenv("GMAIL_API_REFRESH_TOKEN", "").strip(),
    }


EVENTS = {
    "SOLICITUD_ENVIADA": {
        "subject": "Permiso {numero}: solicitud enviada a su jefatura",
        "title": "Solicitud enviada",
        "status": "Pendiente de autorización de jefatura",
        "message": "Su solicitud fue enviada correctamente a la jefatura asignada.",
    },
    "JEFATURA_APROBADO": {
        "subject": "Permiso {numero}: autorizado por su jefatura",
        "title": "Autorizado por jefatura",
        "status": "Pendiente de verificación de RR.HH.",
        "message": "Su jefatura autorizó la solicitud. El trámite fue remitido a Recursos Humanos.",
    },
    "JEFATURA_RECHAZADO": {
        "subject": "Permiso {numero}: rechazado por su jefatura",
        "title": "Rechazado por jefatura",
        "status": "Rechazado por jefatura",
        "message": "Su jefatura rechazó la solicitud.",
    },
    "RRHH_APROBADO": {
        "subject": "Permiso {numero}: verificado por Recursos Humanos",
        "title": "Verificado por Recursos Humanos",
        "status": "Verificado por RR.HH.",
        "message": "Recursos Humanos verificó la solicitud.",
    },
    "RRHH_RECHAZADO": {
        "subject": "Permiso {numero}: rechazado por Recursos Humanos",
        "title": "Rechazado por Recursos Humanos",
        "status": "Rechazado por RR.HH.",
        "message": "Recursos Humanos rechazó la solicitud.",
    },
}


def _enabled() -> bool:
    return os.getenv("EMAIL_ENABLED", "false").strip().lower() in {
        "1", "true", "yes", "on"
    }


def _api_key() -> str:
    return os.getenv("RESEND_API_KEY", "").strip()


def _from_address() -> str:
    return os.getenv("EMAIL_FROM", "").strip()


def _http_error(response: requests.Response, context: str) -> RuntimeError:
    detail = ""
    try:
        body = response.json()
        err = body.get("error")
        if isinstance(err, dict):
            detail = err.get("message") or err.get("status") or str(err)
        elif err:
            detail = str(err)
        detail = body.get("error_description") or detail
    except Exception:
        detail = (response.text or "").strip()[:1000]

    suffix = f": {detail}" if detail else ""
    return RuntimeError(f"{context} (HTTP {response.status_code}){suffix}")


def _invalidate_gmail_access_token() -> None:
    with _GMAIL_TOKEN_LOCK:
        _GMAIL_TOKEN_CACHE["access_token"] = ""
        _GMAIL_TOKEN_CACHE["expires_at"] = 0.0


def _gmail_access_token(force_refresh: bool = False) -> str:
    cfg = _gmail_api_config()
    missing = [
        name
        for name, value in {
            "GMAIL_API_CLIENT_ID": cfg["client_id"],
            "GMAIL_API_CLIENT_SECRET": cfg["client_secret"],
            "GMAIL_API_REFRESH_TOKEN": cfg["refresh_token"],
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError("Faltan variables de Gmail API en Render: " + ", ".join(missing))

    now = time.time()
    with _GMAIL_TOKEN_LOCK:
        cached = _GMAIL_TOKEN_CACHE["access_token"]
        expires_at = float(_GMAIL_TOKEN_CACHE["expires_at"] or 0)
        if not force_refresh and cached and now < expires_at - 60:
            return cached

        response = requests.post(
            GOOGLE_TOKEN_URL,
            data={
                "client_id": cfg["client_id"],
                "client_secret": cfg["client_secret"],
                "refresh_token": cfg["refresh_token"],
                "grant_type": "refresh_token",
            },
            timeout=20,
        )
        if not response.ok:
            raise _http_error(response, "Google rechazó la renovación del token OAuth")

        payload = response.json()
        access_token = (payload.get("access_token") or "").strip()
        if not access_token:
            raise RuntimeError("Google no devolvió access_token al renovar OAuth.")

        expires_in = int(payload.get("expires_in") or 3600)
        _GMAIL_TOKEN_CACHE["access_token"] = access_token
        _GMAIL_TOKEN_CACHE["expires_at"] = time.time() + max(expires_in, 60)
        return access_token


def _build_message(recipient: str, subject: str, html: str) -> EmailMessage:
    from_address = _from_address()
    if not from_address:
        raise RuntimeError("Falta EMAIL_FROM en Render.")

    msg = EmailMessage()
    msg["From"] = from_address
    msg["To"] = recipient
    msg["Subject"] = subject
    domain = from_address.split("@")[-1] if "@" in from_address else None
    msg["Message-ID"] = make_msgid(domain=domain)
    msg.set_content(
        "Este mensaje fue generado automáticamente por el Sistema de Permisos de Salida del ERSeP. "
        "Abra este correo con un cliente compatible con HTML para ver el contenido completo."
    )
    msg.add_alternative(html, subtype="html")
    return msg


def _send_gmail_api(recipient: str, subject: str, html: str) -> str | None:
    msg = _build_message(recipient, subject, html)
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("ascii")

    # Si un access_token almacenado en caché fuera rechazado, se renueva una vez.
    for attempt in range(2):
        token = _gmail_access_token(force_refresh=attempt > 0)
        response = requests.post(
            GMAIL_SEND_URL,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                "Content-Type": "application/json",
            },
            json={"raw": raw},
            timeout=25,
        )
        if response.status_code == 401 and attempt == 0:
            _invalidate_gmail_access_token()
            continue
        if not response.ok:
            raise _http_error(response, "Gmail API rechazó el envío")
        payload = response.json()
        return payload.get("id")

    raise RuntimeError("No fue posible autenticar el envío con Gmail API.")


def _send_email(recipient: str, subject: str, html: str) -> str | None:
    provider = _provider()
    from_address = _from_address()
    if not from_address:
        raise RuntimeError("Falta EMAIL_FROM en Render.")

    if provider in {"gmail_api", "gmail_https", "gmail_rest"}:
        return _send_gmail_api(recipient, subject, html)

    # Compatibilidad heredada. En Render Free los puertos SMTP pueden estar
    # bloqueados, por eso gmail_api es el proveedor recomendado.
    if provider in {"gmail", "gmail_smtp", "smtp"}:
        cfg = _smtp_config()
        if not cfg["user"] or not cfg["password"]:
            raise RuntimeError("Faltan SMTP_USER y/o SMTP_PASSWORD en Render.")
        msg = _build_message(recipient, subject, html)

        context = ssl.create_default_context()
        if cfg["ssl"]:
            with smtplib.SMTP_SSL(cfg["host"], cfg["port"], context=context, timeout=20) as server:
                server.login(cfg["user"], cfg["password"])
                server.send_message(msg)
        else:
            with smtplib.SMTP(cfg["host"], cfg["port"], timeout=20) as server:
                server.starttls(context=context)
                server.login(cfg["user"], cfg["password"])
                server.send_message(msg)
        return msg.get("Message-ID")

    if provider == "resend":
        api_key = _api_key()
        if not api_key:
            raise RuntimeError("Falta RESEND_API_KEY en Render.")
        response = requests.post(
            RESEND_URL,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "from": from_address,
                "to": [recipient],
                "subject": subject,
                "html": html,
            },
            timeout=20,
        )
        if not response.ok:
            raise _http_error(response, "Resend rechazó el envío")
        return response.json().get("id")

    raise RuntimeError(f"EMAIL_PROVIDER no reconocido: {provider}")


def _portal_url() -> str:
    try:
        return settings.permisos_frontend_url.rstrip("/") + "/"
    except Exception:
        return ""


def _permission(permission_id: int) -> dict:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT
                    p.id,p.numero_permiso,p.fecha_salida,p.tipo,p.estado,p.lugar_destino,
                    p.hora_salida,p.hora_regreso,p.sin_regreso,p.jornada_desde,p.jornada_hasta,
                    p.minutos_calculados,p.minutos_declarados,p.justificacion_minutos,
                    p.fecha_devolucion,p.fecha_limite_devolucion,p.fuera_plazo_reglamentario,
                    p.justificacion_fuera_plazo,p.modalidad_compensacion,p.observaciones,
                    a.email AS agente_email,a.nombre AS agente_nombre,a.apellido AS agente_apellido,
                    a.legajo,a.dni,
                    COALESCE(op.nombre,ou.nombre,a.area) oficina,
                    trim(concat(j.nombre,' ',j.apellido)) jefe_nombre,
                    j.email jefe_email,
                    r.modalidad reposicion_modalidad,r.fecha_prevista reposicion_fecha,
                    r.hora_desde_prevista reposicion_desde,r.hora_hasta_prevista reposicion_hasta,
                    r.fecha_horas_extra,r.hora_desde_horas_extra,r.hora_hasta_horas_extra,r.minutos_horas_extra
                FROM permisos_salida p
                JOIN usuarios a ON a.id = p.agente_id
                LEFT JOIN oficinas op ON op.id=p.oficina_id
                LEFT JOIN oficinas ou ON ou.id=a.oficina_id
                LEFT JOIN usuarios j ON j.id = p.jefe_asignado_id
                LEFT JOIN reposiciones r ON r.permiso_id=p.id
                WHERE p.id = %s
                """,
                (permission_id,),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"Permiso {permission_id} inexistente.")
            return row


def _fmt_date(value) -> str:
    return value.strftime("%d/%m/%Y") if value else "—"


def _fmt_time(value) -> str:
    return str(value)[:5] if value is not None else "—"


def _fmt_minutes(value) -> str:
    if value is None:
        return "—"
    value = int(value)
    h, m = divmod(value, 60)
    if h and m:
        return f"{h} h {m} min"
    if h:
        return f"{h} h"
    return f"{m} min"


def _html_body(p: dict, event: dict, observation: str | None) -> str:
    numero = escape(str(p.get("numero_permiso") or f"#{p['id']}"))
    nombre = escape(" ".join(x for x in [p.get("agente_nombre"), p.get("agente_apellido")] if x).strip() or "Agente")
    tipo = escape(str(p.get("tipo") or "—").title())
    estado = escape(event["status"])
    mensaje = escape(event["message"])
    mode = p.get("reposicion_modalidad") or p.get("modalidad_compensacion") or "DEVOLVER_HORAS"
    salida = f"{_fmt_time(p.get('hora_salida'))} → {'Sin regreso' if p.get('sin_regreso') else _fmt_time(p.get('hora_regreso'))}"

    if mode == "HORAS_EXTRAS_PREVIAS" and p.get("tipo") == "PARTICULAR":
        compensacion = (
            f"Usa horas extras previas · {_fmt_date(p.get('fecha_horas_extra'))} · "
            f"{_fmt_time(p.get('hora_desde_horas_extra'))} → {_fmt_time(p.get('hora_hasta_horas_extra'))} "
            f"({_fmt_minutes(p.get('minutos_horas_extra'))})"
        )
    elif p.get("tipo") == "PARTICULAR":
        compensacion = (
            f"Devolución de horas · {_fmt_date(p.get('reposicion_fecha') or p.get('fecha_devolucion'))} · "
            f"{_fmt_time(p.get('reposicion_desde'))} → {_fmt_time(p.get('reposicion_hasta'))}"
        )
    else:
        compensacion = "No corresponde (salida oficial)"

    rows = [
        ("Permiso", numero),
        ("Agente", nombre),
        ("Legajo", escape(str(p.get("legajo") or "—"))),
        ("DNI", escape(str(p.get("dni") or "—"))),
        ("Email del agente", escape(str(p.get("agente_email") or "—"))),
        ("Oficina", escape(str(p.get("oficina") or "—"))),
        ("Jefatura", escape(str(p.get("jefe_nombre") or "—"))),
        ("Fecha de salida", _fmt_date(p.get("fecha_salida"))),
        ("Hora / regreso", escape(salida)),
        ("Tipo de salida", tipo),
        ("Destino", escape(str(p.get("lugar_destino") or "—"))),
        ("Jornada habitual", escape(f"{_fmt_time(p.get('jornada_desde'))} → {_fmt_time(p.get('jornada_hasta'))}")),
        ("Tiempo calculado por el sistema", _fmt_minutes(p.get("minutos_calculados"))),
        ("Tiempo de salida declarado por el agente", _fmt_minutes(p.get("minutos_declarados"))),
        ("Compensación / devolución", escape(compensacion)),
        ("Estado actual", estado),
    ]
    if p.get("fecha_limite_devolucion"):
        rows.append(("Fecha límite sugerida de devolución", _fmt_date(p.get("fecha_limite_devolucion"))))
    if p.get("justificacion_minutos"):
        rows.append(("Justificación del tiempo declarado", escape(str(p.get("justificacion_minutos")))))
    if p.get("justificacion_fuera_plazo"):
        rows.append(("Justificación por devolución fuera de término", escape(str(p.get("justificacion_fuera_plazo")))))
    if p.get("observaciones"):
        rows.append(("Observaciones", escape(str(p.get("observaciones")))))

    table_rows = "".join(
        '<tr><td style="padding:9px 8px;border-bottom:1px solid #e8eaed;font-weight:700;width:42%;vertical-align:top">{}</td>'
        '<td style="padding:9px 8px;border-bottom:1px solid #e8eaed;vertical-align:top">{}</td></tr>'.format(escape(label), value)
        for label, value in rows
    )

    obs = (observation or "").strip()
    obs_html = ""
    if obs:
        obs_html = f"""
        <div style="margin-top:18px;padding:14px 16px;background:#f6f7f9;border-left:4px solid #6b7280;border-radius:8px">
            <div style="font-weight:700;margin-bottom:6px">Observación de la actuación</div>
            <div>{escape(obs)}</div>
        </div>
        """

    critical_html = ""
    if p.get("tipo") == "PARTICULAR":
        declared = int(p.get("minutos_declarados") or 0)
        compensated = None
        if mode == "HORAS_EXTRAS_PREVIAS":
            compensated = p.get("minutos_horas_extra")
        elif p.get("reposicion_desde") and p.get("reposicion_hasta"):
            try:
                a = p["reposicion_desde"].hour * 60 + p["reposicion_desde"].minute
                b = p["reposicion_hasta"].hour * 60 + p["reposicion_hasta"].minute
                compensated = b - a
            except Exception:
                pass
        if compensated is not None and int(compensated) < declared:
            critical_html = f"""
            <div style="margin-top:18px;padding:14px 16px;background:#fff1f0;border:1px solid #f5b7b1;border-left:5px solid #b42318;border-radius:8px;color:#8a1c14">
              <strong>Atención: la compensación informada es insuficiente.</strong><br>
              Se informaron {_fmt_minutes(compensated)} para una salida declarada de {_fmt_minutes(declared)}.
            </div>"""

    portal = _portal_url()
    button = f"""
      <div style="margin-top:24px">
        <a href="{escape(portal)}" style="display:inline-block;background:#850921;color:#fff;text-decoration:none;padding:11px 18px;border-radius:8px;font-weight:700">Abrir Permisos de Salida</a>
      </div>""" if portal else ""

    return f"""<!doctype html>
<html><body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#202124">
  <div style="max-width:700px;margin:24px auto;background:#fff;border-radius:12px;overflow:hidden;border:1px solid #e0e0e0">
    <div style="height:7px;background:linear-gradient(90deg,#079ed0 0 16.6%,#48a62f 16.6% 33.2%,#eead08 33.2% 49.8%,#0c6858 49.8% 66.4%,#75828a 66.4% 83%,#a88976 83% 100%)"></div>
    <div style="padding:20px 24px;background:#25282a;color:#fff">
      <div style="font-size:13px;opacity:.85">ERSeP · Permisos de Salida</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">{escape(event['title'])}</div>
    </div>
    <div style="padding:24px">
      <p>Hola {nombre},</p>
      <p>{mensaje}</p>
      <p style="color:#5f6368;font-size:13px">A continuación se incluye el detalle completo registrado en el sistema.</p>
      <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px">{table_rows}</table>
      {critical_html}
      {obs_html}
      <div style="margin-top:22px;padding:14px 16px;background:#f7f8f9;border:1px solid #e1e4e6;border-radius:8px;font-size:13px;line-height:1.55">
        <strong>¿Necesitás informar un cambio o inconveniente?</strong><br>
        Comunicate con Recursos Humanos: <a href="mailto:{RRHH_CONTACT_EMAIL}" style="color:#850921;font-weight:700">{RRHH_CONTACT_EMAIL}</a>.
      </div>
      {button}
      <p style="margin-top:26px;color:#73777a;font-size:12px;line-height:1.5">Este es un mensaje automático del Sistema de Permisos de Salida del ERSeP. Ante cualquier diferencia en los datos, comuníquese con RR.HH.</p>
    </div>
  </div>
</body></html>"""


def _upsert_notification(
    permission_id: int,
    recipient: str,
    event_type: str,
    subject: str,
) -> dict:
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO notificaciones_email (
                    permiso_id,destinatario,tipo,asunto,estado,proveedor
                )
                VALUES (%s,%s,%s,%s,'PENDIENTE',%s)
                ON CONFLICT (permiso_id,tipo) DO UPDATE SET
                    destinatario=EXCLUDED.destinatario,
                    asunto=EXCLUDED.asunto,
                    proveedor=EXCLUDED.proveedor
                RETURNING *
                """,
                (permission_id, recipient, event_type, subject, _provider().upper()),
            )
            row = cur.fetchone()
        conn.commit()
    return row


def _mark(notification_id: int, state: str, provider_id: str | None = None, error: str | None = None):
    with connection() as conn:
        with conn.cursor() as cur:
            if state == "ENVIADO":
                cur.execute(
                    """
                    UPDATE notificaciones_email
                    SET estado='ENVIADO',
                        proveedor_id=%s,
                        mensaje_error=NULL,
                        ultimo_intento=NOW(),
                        enviado_at=NOW()
                    WHERE id=%s
                    """,
                    (provider_id, notification_id),
                )
            else:
                cur.execute(
                    """
                    UPDATE notificaciones_email
                    SET estado=%s,
                        mensaje_error=%s,
                        ultimo_intento=NOW()
                    WHERE id=%s
                    """,
                    (state, error, notification_id),
                )
        conn.commit()


def notify_permission_event(
    permission_id: int,
    event_type: str,
    observation: str | None = None,
) -> dict:
    """Envía una notificación transaccional y deja auditoría en PostgreSQL.

    Está pensada para ejecutarse con FastAPI BackgroundTasks. Un fallo de correo
    nunca revierte la aprobación/rechazo que ya fue confirmado en la base.
    """
    event = EVENTS.get(event_type)
    if not event:
        logger.warning("Evento de email desconocido: %s", event_type)
        return {"status": "skipped", "reason": "unknown_event"}

    p = _permission(permission_id)
    recipient = (p.get("agente_email") or "").strip()
    if not recipient:
        logger.warning("El permiso %s no tiene email de agente.", permission_id)
        return {"status": "skipped", "reason": "missing_recipient"}

    numero = p.get("numero_permiso") or f"#{permission_id}"
    subject = event["subject"].format(numero=numero)
    notification = _upsert_notification(
        permission_id, recipient, event_type, subject
    )

    # Idempotencia local: si ya fue enviado, no lo vuelve a mandar.
    if notification.get("estado") == "ENVIADO":
        return {
            "status": "already_sent",
            "notification_id": notification["id"],
        }

    if not _enabled():
        _mark(
            notification["id"],
            "OMITIDO",
            error="EMAIL_ENABLED no está activado.",
        )
        return {"status": "skipped", "reason": "disabled"}

    if not _from_address():
        error = "Falta EMAIL_FROM en Render."
        _mark(notification["id"], "ERROR", error=error)
        logger.error(error)
        return {"status": "error", "reason": "missing_configuration"}

    _mark(notification["id"], "ENVIANDO")

    try:
        provider_id = _send_email(
            recipient,
            subject,
            _html_body(p, event, observation),
        )
        _mark(notification["id"], "ENVIADO", provider_id=provider_id)
        return {
            "status": "ok",
            "notification_id": notification["id"],
            "provider_id": provider_id,
            "to": recipient,
        }
    except Exception as exc:
        error = str(exc)
        try:
            if getattr(exc, "response", None) is not None:
                body = exc.response.text[:1500]
                error = f"{error} · {body}"
        except Exception:
            pass
        _mark(notification["id"], "ERROR", error=error[:4000])
        logger.exception(
            "Falló la notificación %s del permiso %s", event_type, permission_id
        )
        return {"status": "error", "reason": error}


def send_test_email(recipient: str, name: str = "Administrador") -> dict:
    if not _enabled():
        raise RuntimeError("EMAIL_ENABLED no está activado en Render.")

    subject = "Prueba · Permisos de Salida ERSeP"
    html = f"""
        <div style="font-family:Arial,sans-serif;max-width:600px">
          <h2>Correo configurado correctamente</h2>
          <p>Hola {escape(name)},</p>
          <p>
            El backend de Permisos de Salida pudo enviar este mensaje mediante
            <strong>{escape(_provider())}</strong>.
          </p>
        </div>
    """
    provider_id = _send_email(recipient, subject, html)
    return {
        "status": "ok",
        "to": recipient,
        "provider": _provider(),
        "provider_id": provider_id,
    }

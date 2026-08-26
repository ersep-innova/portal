import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from email.utils import make_msgid
from html import escape

import requests

from .config import settings
from .database import connection

logger = logging.getLogger(__name__)

RESEND_URL = "https://api.resend.com/emails"


def _provider() -> str:
    return os.getenv("EMAIL_PROVIDER", "gmail_smtp").strip().lower()


def _smtp_config() -> dict:
    return {
        "host": os.getenv("SMTP_HOST", "smtp.gmail.com").strip(),
        "port": int(os.getenv("SMTP_PORT", "465")),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        "ssl": os.getenv("SMTP_SSL", "true").strip().lower() in {"1", "true", "yes", "on"},
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


def _send_email(recipient: str, subject: str, html: str) -> str | None:
    provider = _provider()
    from_address = _from_address()
    if not from_address:
        raise RuntimeError("Falta EMAIL_FROM en Render.")

    if provider in {"gmail", "gmail_smtp", "smtp"}:
        cfg = _smtp_config()
        if not cfg["user"] or not cfg["password"]:
            raise RuntimeError("Faltan SMTP_USER y/o SMTP_PASSWORD en Render.")
        msg = EmailMessage()
        msg["From"] = from_address
        msg["To"] = recipient
        msg["Subject"] = subject
        message_id = make_msgid(domain=(cfg["user"].split("@")[-1] if "@" in cfg["user"] else None))
        msg["Message-ID"] = message_id
        msg.set_content("Este mensaje requiere un cliente compatible con HTML.")
        msg.add_alternative(html, subtype="html")

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
        return message_id

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
        response.raise_for_status()
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
                    p.id,
                    p.numero_permiso,
                    p.fecha_salida,
                    p.tipo,
                    p.estado,
                    p.lugar_destino,
                    p.hora_salida,
                    p.hora_regreso,
                    p.sin_regreso,
                    p.fecha_devolucion,
                    a.email AS agente_email,
                    a.nombre AS agente_nombre,
                    a.apellido AS agente_apellido
                FROM permisos_salida p
                JOIN usuarios a ON a.id = p.agente_id
                WHERE p.id = %s
                """,
                (permission_id,),
            )
            row = cur.fetchone()
            if not row:
                raise RuntimeError(f"Permiso {permission_id} inexistente.")
            return row


def _html_body(p: dict, event: dict, observation: str | None) -> str:
    numero = escape(str(p.get("numero_permiso") or f"#{p['id']}"))
    nombre = escape(
        " ".join(
            x for x in [p.get("agente_nombre"), p.get("agente_apellido")] if x
        ).strip()
        or "Agente"
    )
    fecha = p["fecha_salida"].strftime("%d/%m/%Y") if p.get("fecha_salida") else "-"
    tipo = escape(str(p.get("tipo") or "-").title())
    estado = escape(event["status"])
    mensaje = escape(event["message"])
    obs = (observation or "").strip()
    obs_html = ""
    if obs:
        obs_html = f"""
        <div style="margin-top:18px;padding:14px 16px;background:#f6f7f9;border-left:4px solid #6b7280;border-radius:6px">
            <div style="font-weight:700;margin-bottom:6px">Observación informada</div>
            <div>{escape(obs)}</div>
        </div>
        """

    portal = _portal_url()
    button = ""
    if portal:
        button = f"""
        <div style="margin-top:24px">
            <a href="{escape(portal)}"
               style="display:inline-block;background:#1f4e79;color:#ffffff;text-decoration:none;
                      padding:11px 18px;border-radius:7px;font-weight:700">
                Ver Permisos de Salida
            </a>
        </div>
        """

    return f"""<!doctype html>
<html>
<body style="margin:0;background:#f3f4f6;font-family:Arial,Helvetica,sans-serif;color:#1f2937">
  <div style="max-width:620px;margin:24px auto;background:white;border-radius:10px;
              overflow:hidden;border:1px solid #e5e7eb">
    <div style="padding:20px 24px;background:#1f4e79;color:white">
      <div style="font-size:13px;opacity:.9">ERSeP · Permisos de Salida</div>
      <div style="font-size:22px;font-weight:700;margin-top:4px">{escape(event["title"])}</div>
    </div>
    <div style="padding:24px">
      <p>Hola {nombre},</p>
      <p>{mensaje}</p>

      <table style="width:100%;border-collapse:collapse;margin-top:18px;font-size:14px">
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Permiso</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">{numero}</td>
        </tr>
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Fecha de salida</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">{fecha}</td>
        </tr>
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Tipo</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">{tipo}</td>
        </tr>
        <tr>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb;font-weight:700">Estado actual</td>
          <td style="padding:8px;border-bottom:1px solid #e5e7eb">{estado}</td>
        </tr>
      </table>

      {obs_html}
      {button}

      <p style="margin-top:26px;color:#6b7280;font-size:12px;line-height:1.5">
        Este es un mensaje automático del Sistema de Permisos de Salida del ERSeP.
        No responda este correo.
      </p>
    </div>
  </div>
</body>
</html>"""


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

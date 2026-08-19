from fastapi import Depends, Header, HTTPException
from google.auth.transport import requests as google_requests
from google.oauth2 import id_token
from .config import settings
from .database import connection


def _get_roles(cur, user_id: int) -> list[str]:
    cur.execute("""
        SELECT r.codigo
        FROM roles r
        JOIN usuario_roles ur ON ur.rol_id = r.id
        WHERE ur.usuario_id = %s
        ORDER BY r.codigo
    """, (user_id,))
    return [row["codigo"] for row in cur.fetchall()]


def _bootstrap_admin(cur, email: str, sub: str, claims: dict):
    if email.lower() not in settings.bootstrap_admin_emails:
        return None
    given = claims.get("given_name") or claims.get("name") or email.split("@")[0]
    family = claims.get("family_name") or ""
    cur.execute("""
        INSERT INTO usuarios (google_sub, email, nombre, apellido, activo)
        VALUES (%s,%s,%s,%s,TRUE)
        ON CONFLICT (email) DO UPDATE SET
          google_sub = EXCLUDED.google_sub,
          nombre = COALESCE(NULLIF(usuarios.nombre,''), EXCLUDED.nombre),
          apellido = COALESCE(NULLIF(usuarios.apellido,''), EXCLUDED.apellido),
          updated_at = NOW()
        RETURNING *
    """, (sub, email.lower(), given, family))
    user = cur.fetchone()
    for code in ("AGENTE", "ADMIN"):
        cur.execute("""
            INSERT INTO usuario_roles (usuario_id, rol_id)
            SELECT %s, id FROM roles WHERE codigo=%s
            ON CONFLICT DO NOTHING
        """, (user["id"], code))
    return user


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sesión no iniciada.")
    token = authorization[7:].strip()
    if not settings.google_oauth_client_id:
        raise HTTPException(status_code=503, detail="GOOGLE_OAUTH_CLIENT_ID no está configurado en el backend.")

    try:
        claims = id_token.verify_oauth2_token(token, google_requests.Request(), settings.google_oauth_client_id)
    except Exception:
        raise HTTPException(status_code=401, detail="La sesión de Google no es válida o expiró.")

    email = (claims.get("email") or "").lower()
    sub = claims.get("sub")
    if not email or not sub or not claims.get("email_verified"):
        raise HTTPException(status_code=401, detail="Google no entregó una identidad verificada.")

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT * FROM usuarios WHERE email=%s", (email,))
            user = cur.fetchone()
            if not user:
                user = _bootstrap_admin(cur, email, sub, claims)
                if not user:
                    raise HTTPException(status_code=403, detail="Tu cuenta Google no está habilitada para este sistema.")
                conn.commit()
            elif not user["activo"]:
                raise HTTPException(status_code=403, detail="Tu usuario se encuentra deshabilitado.")
            else:
                if user.get("google_sub") != sub:
                    cur.execute("UPDATE usuarios SET google_sub=%s, updated_at=NOW() WHERE id=%s", (sub, user["id"]))
                    conn.commit()
                    user["google_sub"] = sub
            roles = _get_roles(cur, user["id"])

    return {**user, "roles": roles}


def require_roles(*required: str):
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if "ADMIN" in user["roles"] or any(role in user["roles"] for role in required):
            return user
        raise HTTPException(status_code=403, detail="No tenés permisos para realizar esta acción.")
    return dependency

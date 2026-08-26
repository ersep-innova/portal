import base64
import hashlib
import hmac
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import Depends, Header, HTTPException

from .config import settings
from .database import connection

PBKDF2_ITERATIONS = 260_000


def _get_roles(cur, user_id: int) -> list[str]:
    cur.execute(
        """
        SELECT r.codigo
        FROM roles r
        JOIN usuario_roles ur ON ur.rol_id = r.id
        WHERE ur.usuario_id = %s
        ORDER BY r.codigo
        """,
        (user_id,),
    )
    return [row["codigo"] for row in cur.fetchall()]


def hash_password(password: str) -> str:
    if not password:
        raise ValueError("La clave no puede estar vacía.")
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), salt, PBKDF2_ITERATIONS
    )
    return "pbkdf2_sha256${}${}${}".format(
        PBKDF2_ITERATIONS,
        base64.urlsafe_b64encode(salt).decode("ascii"),
        base64.urlsafe_b64encode(digest).decode("ascii"),
    )


def verify_password(password: str, encoded: str | None) -> bool:
    if not encoded:
        return False
    try:
        algorithm, iterations_text, salt_b64, digest_b64 = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        iterations = int(iterations_text)
        salt = base64.urlsafe_b64decode(salt_b64.encode("ascii"))
        expected = base64.urlsafe_b64decode(digest_b64.encode("ascii"))
        actual = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), salt, iterations
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def _token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _safe_user(user: dict, roles: list[str]) -> dict:
    return {**user, "roles": roles}


def ensure_bootstrap_admin() -> None:
    """Crea/recupera un administrador inicial sólo si existe clave en variables de entorno."""
    username = settings.bootstrap_admin_username.strip().lower()
    password = settings.bootstrap_admin_password
    email = settings.bootstrap_admin_email.strip().lower() or "admin@ersep.local"

    if not username or not password:
        return

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios WHERE lower(username)=lower(%s)",
                (username,),
            )
            user = cur.fetchone()
            if not user:
                # Facilita migrar una instalación anterior que ya tenía al admin por email de Google.
                cur.execute("SELECT * FROM usuarios WHERE lower(email)=lower(%s)", (email,))
                user = cur.fetchone()
                if user:
                    cur.execute(
                        "UPDATE usuarios SET username=%s, activo=TRUE, updated_at=NOW() WHERE id=%s",
                        (username, user["id"]),
                    )
                    user["username"] = username
            if user:
                # No pisa la clave de un administrador ya configurado.
                changed = False
                if not user.get("password_hash"):
                    cur.execute(
                        "UPDATE usuarios SET password_hash=%s, activo=TRUE, updated_at=NOW() WHERE id=%s",
                        (hash_password(password), user["id"]),
                    )
                    changed = True
                for code in ("AGENTE", "ADMIN"):
                    cur.execute(
                        """
                        INSERT INTO usuario_roles (usuario_id, rol_id)
                        SELECT %s, id FROM roles WHERE codigo=%s
                        ON CONFLICT DO NOTHING
                        """,
                        (user["id"], code),
                    )
                    changed = True
                if changed:
                    conn.commit()
                return

            cur.execute(
                """
                INSERT INTO usuarios (
                    username,email,nombre,apellido,legajo,password_hash,activo
                )
                VALUES (%s,%s,'Administrador','Permisos',NULL,%s,TRUE)
                RETURNING id
                """,
                (username, email, hash_password(password)),
            )
            user_id = cur.fetchone()["id"]
            for code in ("AGENTE", "ADMIN", "RRHH"):
                cur.execute(
                    """
                    INSERT INTO usuario_roles (usuario_id, rol_id)
                    SELECT %s, id FROM roles WHERE codigo=%s
                    ON CONFLICT DO NOTHING
                    """,
                    (user_id, code),
                )
        conn.commit()


def login_user(username: str, password: str) -> dict:
    username = (username or "").strip().lower()
    if not username or not password:
        raise HTTPException(status_code=422, detail="Ingresá usuario y clave.")

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "SELECT * FROM usuarios WHERE lower(username)=lower(%s)",
                (username,),
            )
            user = cur.fetchone()
            if not user or not verify_password(password, user.get("password_hash")):
                raise HTTPException(status_code=401, detail="Usuario o clave incorrectos.")
            if not user["activo"]:
                raise HTTPException(status_code=403, detail="Tu usuario se encuentra deshabilitado.")

            token = secrets.token_urlsafe(40)
            expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.auth_session_hours)
            cur.execute("DELETE FROM sesiones_usuario WHERE expires_at <= NOW()")
            cur.execute(
                """
                INSERT INTO sesiones_usuario (usuario_id,token_hash,expires_at)
                VALUES (%s,%s,%s)
                """,
                (user["id"], _token_hash(token), expires_at),
            )
            cur.execute(
                "UPDATE usuarios SET last_login_at=NOW(),updated_at=NOW() WHERE id=%s",
                (user["id"],),
            )
            roles = _get_roles(cur, user["id"])
        conn.commit()

    return {
        "token": token,
        "expires_at": expires_at.isoformat(),
        "user": _safe_user(user, roles),
    }


def _extract_bearer(authorization: str | None) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Sesión no iniciada.")
    token = authorization[7:].strip()
    if not token:
        raise HTTPException(status_code=401, detail="Sesión no iniciada.")
    return token


def get_current_user(authorization: str | None = Header(default=None)) -> dict:
    token = _extract_bearer(authorization)
    token_hash = _token_hash(token)

    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                SELECT u.*
                FROM sesiones_usuario s
                JOIN usuarios u ON u.id=s.usuario_id
                WHERE s.token_hash=%s AND s.expires_at > NOW()
                """,
                (token_hash,),
            )
            user = cur.fetchone()
            if not user:
                raise HTTPException(status_code=401, detail="La sesión expiró o no es válida.")
            if not user["activo"]:
                cur.execute("DELETE FROM sesiones_usuario WHERE token_hash=%s", (token_hash,))
                conn.commit()
                raise HTTPException(status_code=403, detail="Tu usuario se encuentra deshabilitado.")

            cur.execute(
                "UPDATE sesiones_usuario SET last_used_at=NOW() WHERE token_hash=%s",
                (token_hash,),
            )
            roles = _get_roles(cur, user["id"])
        conn.commit()

    return _safe_user(user, roles)


def logout_session(authorization: str | None) -> None:
    if not authorization or not authorization.startswith("Bearer "):
        return
    token = authorization[7:].strip()
    if not token:
        return
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM sesiones_usuario WHERE token_hash=%s", (_token_hash(token),)
            )
        conn.commit()


def require_roles(*required: str):
    def dependency(user: dict = Depends(get_current_user)) -> dict:
        if "ADMIN" in user["roles"] or any(role in user["roles"] for role in required):
            return user
        raise HTTPException(status_code=403, detail="No tenés permisos para realizar esta acción.")

    return dependency

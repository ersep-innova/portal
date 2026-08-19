from pathlib import Path
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool
from .config import settings

pool: ConnectionPool | None = None


def start_pool() -> None:
    global pool
    if not settings.database_url:
        raise RuntimeError("DATABASE_URL no está configurada.")
    if pool is None:
        pool = ConnectionPool(
            conninfo=settings.database_url,
            min_size=1,
            max_size=8,
            kwargs={"row_factory": dict_row},
            open=True,
        )
        pool.wait(timeout=20)


def close_pool() -> None:
    global pool
    if pool is not None:
        pool.close()
        pool = None


def connection():
    if pool is None:
        raise RuntimeError("El pool PostgreSQL no está iniciado.")
    return pool.connection()


def init_schema() -> None:
    schema_path = Path(__file__).resolve().parent.parent / "schema.sql"
    sql = schema_path.read_text(encoding="utf-8")
    with connection() as conn:
        with conn.cursor() as cur:
            cur.execute(sql)
        conn.commit()

"""Database connection pooling helper for PostgreSQL using psycopg2."""

from __future__ import annotations

import logging
import os
import time
from contextlib import contextmanager
from typing import Generator

import psycopg2
from psycopg2.extensions import connection
from psycopg2.pool import SimpleConnectionPool

logger = logging.getLogger(__name__)

# Initialize a thread-safe connection pool singleton
_pool: SimpleConnectionPool | None = None
_pool_created_at: float = 0.0

# DSQL IAM auth tokens expire after ~15 min. The pool captures the token into
# its connect kwargs at construction, so recycle the whole pool before expiry —
# otherwise every NEW connection opened after ~15 min fails auth.
_DSQL_POOL_MAX_AGE_S = 600.0


def _connection_params() -> dict:
    """psycopg2 connect params.

    DEFAULT (unchanged): standard Postgres via DATABASE_URL.
    OPT-IN: when DSQL_ENDPOINT is set, connect to Aurora DSQL with TLS and a
    short-lived IAM auth token as the password. No DSQL code runs otherwise.
    """
    endpoint = os.environ.get("DSQL_ENDPOINT")
    if not endpoint:
        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable is not set.")
        return {"dsn": db_url}

    import boto3  # local import: only needed in DSQL mode

    region = os.environ.get("DSQL_REGION") or os.environ.get("AWS_REGION") or "us-east-1"
    user = os.environ.get("DSQL_USER", "admin")
    database = os.environ.get("DSQL_DATABASE", "postgres")
    client = boto3.client("dsql", region_name=region)
    # NOTE: tokens are short-lived (~15 min). get_pool() recycles the whole pool
    # before expiry so new connections always carry a fresh token.
    if user == "admin":
        token = client.generate_db_connect_admin_auth_token(endpoint, region)
    else:
        token = client.generate_db_connect_auth_token(endpoint, region)
    return {
        "host": endpoint,
        "port": 5432,
        "user": user,
        "dbname": database,
        "password": token,
        "sslmode": "require",
    }


def get_pool() -> SimpleConnectionPool:
    """Get or initialize the PostgreSQL connection pool."""
    global _pool, _pool_created_at  # noqa: PLW0603
    if (
        _pool is not None
        and os.environ.get("DSQL_ENDPOINT")
        and time.time() - _pool_created_at > _DSQL_POOL_MAX_AGE_S
    ):
        logger.info("Recycling DSQL connection pool to refresh the IAM auth token...")
        try:
            _pool.closeall()
        except Exception as err:
            logger.warning("Error closing stale DSQL pool: %s", err)
        _pool = None
    if _pool is None:
        logger.info("Initializing PostgreSQL connection pool...")
        # Since the worker is single-threaded or runs a simple poll loop,
        # a simple pool of 2 to 10 connections is perfect.
        _pool = SimpleConnectionPool(
            minconn=2,
            maxconn=10,
            **_connection_params(),
        )
        _pool_created_at = time.time()
        logger.info("Database connection pool initialized.")
    return _pool


@contextmanager
def get_db_connection() -> Generator[connection, None, None]:
    """Context manager for obtaining a database connection from the pool.

    Dead connections (Postgres restart, idle disconnect, expired DSQL token)
    are closed and evicted instead of being returned to the pool, so the
    worker self-heals instead of failing forever on the same broken socket."""
    pool = get_pool()
    conn = pool.getconn()
    broken = False
    try:
        yield conn
        conn.commit()
    except Exception as orig_err:
        try:
            conn.rollback()
        except Exception:
            broken = True  # rollback failing means the connection is dead
        if conn.closed or isinstance(orig_err, (psycopg2.OperationalError, psycopg2.InterfaceError)):
            broken = True
        raise
    finally:
        try:
            pool.putconn(conn, close=broken)
        except Exception as err:
            logger.warning("Failed returning connection to pool: %s", err)


def check_db_health() -> bool:
    """Verify database connectivity."""
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1")
                return True
    except Exception as err:
        logger.error("Database health check failed: %s", err)
        return False

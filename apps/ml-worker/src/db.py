"""Database connection pooling helper for PostgreSQL using psycopg2."""

from __future__ import annotations

import logging
import os
from contextlib import contextmanager
from typing import Generator

import psycopg2
from psycopg2.extensions import connection
from psycopg2.pool import SimpleConnectionPool

logger = logging.getLogger(__name__)

# Initialize a thread-safe connection pool singleton
_pool: SimpleConnectionPool | None = None


def get_pool() -> SimpleConnectionPool:
    """Get or initialize the PostgreSQL connection pool."""
    global _pool  # noqa: PLW0603
    if _pool is None:
        db_url = os.environ.get("DATABASE_URL")
        if not db_url:
            raise ValueError("DATABASE_URL environment variable is not set.")

        logger.info("Initializing PostgreSQL connection pool...")
        # Since the worker is single-threaded or runs a simple poll loop, 
        # a simple pool of 2 to 10 connections is perfect.
        _pool = SimpleConnectionPool(
            minconn=2,
            maxconn=10,
            dsn=db_url,
        )
        logger.info("Database connection pool initialized.")
    return _pool


@contextmanager
def get_db_connection() -> Generator[connection, None, None]:
    """Context manager for obtaining a database connection from the pool."""
    pool = get_pool()
    conn = pool.getconn()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        pool.putconn(conn)


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

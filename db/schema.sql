-- Aurora DSQL is PostgreSQL-compatible
-- Run this against your DSQL cluster to initialize the schema

CREATE TABLE IF NOT EXISTS users_2 (
  id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  first_name VARCHAR(100) NOT NULL,
  last_name  VARCHAR(100) NOT NULL,
  email      VARCHAR(255) NOT NULL UNIQUE,
  created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

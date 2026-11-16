#!/bin/bash
# Creates the two DB roles. leadpilot_owner owns the schema and runs migrations.
# leadpilot_app is what the API/worker connect as: NOT superuser, NOT owner, so RLS applies.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U postgres -d leadpilot <<SQL

# Shadow database for `prisma migrate dev` (needs the same extensions as the real DB).
psql -v ON_ERROR_STOP=1 -U postgres <<SQL
CREATE DATABASE leadpilot_shadow OWNER leadpilot_owner;
SQL
for e in citext pgcrypto btree_gist pg_trgm vector; do psql -v ON_ERROR_STOP=1 -U postgres -d leadpilot_shadow -c "CREATE EXTENSION IF NOT EXISTS $e"; done
CREATE ROLE leadpilot_owner LOGIN PASSWORD '${POSTGRES_PASSWORD}' CREATEDB;
CREATE ROLE leadpilot_app LOGIN PASSWORD '${APP_ROLE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT ALL ON DATABASE leadpilot TO leadpilot_owner;
GRANT CONNECT ON DATABASE leadpilot TO leadpilot_app;
ALTER SCHEMA public OWNER TO leadpilot_owner;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
SQL

#!/bin/bash
# Creates the two DB roles. leadpilot_owner owns the schema and runs migrations.
# leadpilot_app is what the API/worker connect as: NOT superuser, NOT owner, so RLS applies.
set -euo pipefail
psql -v ON_ERROR_STOP=1 -U postgres -d leadpilot <<SQL
CREATE ROLE leadpilot_owner LOGIN PASSWORD '${POSTGRES_PASSWORD}' CREATEDB;
CREATE ROLE leadpilot_app LOGIN PASSWORD '${APP_ROLE_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
GRANT ALL ON DATABASE leadpilot TO leadpilot_owner;
GRANT CONNECT ON DATABASE leadpilot TO leadpilot_app;
ALTER SCHEMA public OWNER TO leadpilot_owner;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

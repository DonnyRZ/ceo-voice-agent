#!/usr/bin/env bash
psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" -v ON_ERROR_STOP=1 <<'SQL'
\getenv app_password DATABASE_APP_PASSWORD
CREATE ROLE ruang_kerja_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOBYPASSRLS;
SQL

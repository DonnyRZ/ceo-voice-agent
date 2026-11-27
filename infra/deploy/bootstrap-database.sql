\set ON_ERROR_STOP on
-- Run with an existing PostgreSQL administrator, once per new environment.
-- Pass -v environment=stage or prod. Passwords come from the caller's private environment.
SELECT :'environment' IN ('stage','prod') AND current_setting('server_version_num')::int >= 150000 AS valid_environment \gset
\if :valid_environment
\else
  \quit 1
\endif
SELECT 'ceo_voice_agent_' || :'environment' AS database,
       'ceo_' || :'environment' || '_owner' AS owner_role,
       'ceo_' || :'environment' || '_app' AS app_role \gset
\getenv owner_password CEO_OWNER_PASSWORD
\getenv app_password CEO_APP_PASSWORD
SELECT length(:'owner_password') >= 32 AND length(:'app_password') >= 32
  AND :'owner_password' <> :'app_password'
  AND NOT EXISTS (SELECT FROM pg_database WHERE datname = :'database')
  AND NOT EXISTS (SELECT FROM pg_roles WHERE rolname IN (:'owner_role', :'app_role')) AS ready \gset
\if :ready
\else
  \echo 'Database/role sudah ada atau password tidak valid. Tidak ada data yang ditimpa.'
  \quit 1
\endif
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'owner_role', :'owner_password') \gexec
SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD %L', :'app_role', :'app_password') \gexec
-- Function-level SET for an unregistered custom GUC needs an explicit parameter ACL.
SELECT format('GRANT SET ON PARAMETER "app.user_id" TO %I', :'owner_role') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'database', :'owner_role') \gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM PUBLIC', :'database') \gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I, %I', :'database', :'owner_role', :'app_role') \gexec
\connect :database
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

#!/bin/sh
set -eu
migration_sha=$(sha256sum /opt/support/001-ticket-schema.sql | cut -d ' ' -f 1)
psql -v ON_ERROR_STOP=1 --username postgres --dbname postgres --set=app_password="$SUPPORT_DB_PASSWORD" --set=keycloak_password="$KEYCLOAK_DB_PASSWORD" --set=migration_sha="$migration_sha" <<'SQL'
CREATE ROLE support_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'app_password';
CREATE ROLE keycloak LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD :'keycloak_password';
CREATE DATABASE support;
CREATE DATABASE keycloak OWNER keycloak;
\connect support
\i /opt/support/001-ticket-schema.sql
CREATE TABLE schema_migrations(version text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now());
INSERT INTO schema_migrations(version,checksum) VALUES('001-ticket-schema.sql', :'migration_sha');
\i /opt/support/seed-local.sql
SQL

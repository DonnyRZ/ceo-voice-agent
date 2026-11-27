#!/usr/bin/env bash
# Sourced by deploy.sh. The old app continues serving during backup/migration.
run_db() { docker run --rm --network host --env-file "$RUNTIME_ENV_FILE" --env-file "$MIGRATE_ENV_FILE" "$image" "$@"; }
backup_and_migrate() {
  local major backup
  # Fetch version and backup connection metadata in one checked DB connection.
  run_db node ops/database.mjs pg-env > "$scratch/pg.env"
  major=$(sed -n 's/^PGVERSION=//p' "$scratch/pg.env")
  [[ "$major" =~ ^(1[5-9]|[2-9][0-9])$ ]] || return 65
  # Pull only on first use; don't contact the registry on every release.
  docker image inspect "postgres:$major" >/dev/null 2>&1 || docker pull "postgres:$major" >/dev/null
  mkdir -p "$site/backups"
  backup="$site/backups/$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}.dump"
  docker run --rm --network host --env-file "$scratch/pg.env" "postgres:$major" pg_dump --format=custom > "$backup.partial"
  [[ -s "$backup.partial" ]] || return 65
  mv "$backup.partial" "$backup"
  # Bound lock waits so a migration cannot block live writes indefinitely.
  docker run --rm --network host --env-file "$RUNTIME_ENV_FILE" --env-file "$MIGRATE_ENV_FILE" \
    -e 'PGOPTIONS=-c lock_timeout=3000 -c statement_timeout=60000' "$image" node build/backend/db/migrate.js
}

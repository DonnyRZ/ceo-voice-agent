#!/usr/bin/env bash
# Runs against disposable containers, never the VPS or a configured application DB.
set -Eeuo pipefail
umask 077
image=${1:?Masukkan image aplikasi yang akan diuji}
name="ceo-smoke-$$"
scratch=$(mktemp -d)
ops=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cleanup() {
  docker rm -fv "$name-stage" "$name-prod" "$name-db" >/dev/null 2>&1 || true
  docker network rm "$name" >/dev/null 2>&1 || true
  rm -rf -- "$scratch"
}
trap cleanup EXIT
password=$(openssl rand -hex 32)
printf 'POSTGRES_PASSWORD=%s\n' "$password" > "$scratch/postgres.env"
docker network create "$name" >/dev/null
docker run -d --name "$name-db" --network "$name" --network-alias pg --env-file "$scratch/postgres.env" pgvector/pgvector:pg17-trixie >/dev/null
ready=false
for attempt in {1..60}; do
  if docker exec "$name-db" sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres' >/dev/null 2>&1; then ready=true; break; fi
  sleep 1
done
$ready || { echo 'PostgreSQL fixture gagal siap.' >&2; exit 1; }
for stage in stage prod; do
  owner_password=$(openssl rand -hex 32)
  app_password=$(openssl rand -hex 32)
  token=$(openssl rand -hex 32)
  printf 'CEO_OWNER_PASSWORD=%s\nCEO_APP_PASSWORD=%s\n' "$owner_password" "$app_password" > "$scratch/bootstrap.env"
  docker exec -i --env-file "$scratch/bootstrap.env" "$name-db" psql -X -U postgres -d postgres -v "environment=$stage" < "$ops/bootstrap-database.sql"
  runtime="postgresql://ceo_${stage}_app:$app_password@pg:5432/ceo_voice_agent_$stage"
  printf 'DATABASE_URL=%s\nDATABASE_ADMIN_URL=postgresql://ceo_%s_owner:%s@pg:5432/ceo_voice_agent_%s\n' "$runtime" "$stage" "$owner_password" "$stage" > "$scratch/migrate-$stage.env"
  printf 'DATABASE_URL=%s\nAPP_ORIGIN=http://localhost\nBETTER_AUTH_SECRET=%s\nDEPLOY_CONTROL_TOKEN=%s\nAI_VOICE_ENABLED=false\n' "$runtime" "$(openssl rand -hex 32)" "$token" > "$scratch/runtime-$stage.env"
done
for stage in stage prod; do
  docker run --rm --network "$name" --env-file "$scratch/migrate-$stage.env" "$image" node build/backend/db/migrate.js
  docker run -d --name "$name-$stage" --network "$name" --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m --cap-drop ALL --security-opt no-new-privileges --env-file "$scratch/runtime-$stage.env" -e HOST=0.0.0.0 -e API_PORT=3000 -p 127.0.0.1::3000 "$image" >/dev/null
  port=$(docker inspect "$name-$stage" --format '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}')
  healthy=false
  for attempt in {1..30}; do
    if curl -fsS --max-time 3 "http://127.0.0.1:$port/api/health" >/dev/null 2>&1; then healthy=true; break; fi
    sleep 1
  done
  $healthy || { docker logs "$name-$stage"; exit 1; }
  curl -fsS "http://127.0.0.1:$port/" | grep -qi '<!doctype html>'
  [[ $(curl -s -o /dev/null -w '%{http_code}' -X POST "http://127.0.0.1:$port/internal/deployment/drain") == 404 ]]
  token=$(sed -n 's/^DEPLOY_CONTROL_TOKEN=//p' "$scratch/runtime-$stage.env")
  printf 'x-deploy-token: %s\n' "$token" > "$scratch/header"
  curl -fsS --header "@$scratch/header" -X POST "http://127.0.0.1:$port/internal/deployment/drain" | grep -q '"activeVoiceSessions":0'
  [[ $(curl -s -o /dev/null -w '%{http_code}' --header "@$scratch/header" -X POST "http://127.0.0.1:$port/internal/deployment/resume") == 204 ]]
  docker exec -i "$name-$stage" node --input-type=module <<'JS'
import { Client } from 'pg';
if (process.env.DATABASE_ADMIN_URL) throw new Error('Admin credential leaked into runtime.');
const url = new URL(process.env.DATABASE_URL);
url.pathname = url.pathname.endsWith('_stage') ? '/ceo_voice_agent_prod' : '/ceo_voice_agent_stage';
const client = new Client({ connectionString: url.href });
try { await client.connect(); throw new Error('Cross-environment database access must be rejected.'); }
catch (error) { if (error.code !== '42501') throw error; }
finally { await client.end(); }
JS
  docker exec "$name-db" pg_dump -U postgres -d "ceo_voice_agent_$stage" -Fc > "$scratch/$stage.dump"
  docker exec -i "$name-db" pg_restore --list < "$scratch/$stage.dump" > /dev/null
  docker rm -f "$name-$stage" >/dev/null
  echo "Container $stage, migrasi, sumber UI, kontrol sesi, backup, dan isolasi database lulus."
done

#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
stage=${1:?Gunakan stage atau prod}
image=${2:?Image release wajib diisi}
expected_id=${3:?ID image wajib diisi}
[[ "$stage" =~ ^(stage|prod)$ ]] || exit 64
[[ "$image" =~ ^ghcr\.io/[a-z0-9._/-]+:(stage|prod)-sha-([a-f0-9]{40})-[0-9]+-[0-9]+$ ]] || exit 64
[[ "${BASH_REMATCH[1]}" == "$stage" ]] || exit 64
revision=${BASH_REMATCH[2]}
[[ "$expected_id" =~ ^sha256:[a-f0-9]{64}$ ]] || exit 64
root=${CEO_DEPLOY_ROOT:-/opt/ceo-voice-agent}
site="$root/$stage"
ops=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -d "$site" && -f "$site/runtime.env" && -f "$site/migrate.env" ]] || { echo 'Environment VPS belum disiapkan.' >&2; exit 78; }
exec 9>"$site/deploy.lock"
flock -n 9 || { echo 'Deployment lingkungan ini sedang berjalan.' >&2; exit 75; }
export APP_PORT=4311
[[ "$stage" == prod ]] && APP_PORT=4312
export RUNTIME_ENV_FILE="$site/runtime.env" APP_IMAGE="$image"
compose=(docker compose --project-name "ceo-$stage" --file "$ops/compose.yaml")
[[ $(docker image inspect "$image" --format '{{.Id}}') == "$expected_id" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$revision" ]] || exit 65
previous=''
[[ -f "$site/active-image" ]] && previous=$(cat "$site/active-image")
[[ -z "$previous" || "$previous" =~ ^ghcr\.io/[a-z0-9._/-]+:$stage-sha-[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 65
scratch=$(mktemp -d "$site/.deploy.XXXXXX")
switched=false
healthy() { curl --fail --silent --max-time 4 "http://127.0.0.1:$APP_PORT/api/health" >/dev/null; }
control() { curl --fail --silent --show-error --max-time 5 --header "@$scratch/header" --request POST "http://127.0.0.1:$APP_PORT/internal/deployment/$1"; }
finish() {
  code=$?
  trap - EXIT
  if (( code != 0 )); then
    if $switched && [[ -n "$previous" ]]; then
      APP_IMAGE="$previous" "${compose[@]}" up -d --no-build --wait --wait-timeout 90 app || echo 'Rollback membutuhkan pemeriksaan operator.' >&2
    elif $switched; then
      "${compose[@]}" stop app || true
    fi
    [[ -z "$previous" ]] || control resume >/dev/null || true
  fi
  rm -rf -- "$scratch"
  exit "$code"
}
trap finish EXIT
# The header file keeps the control token out of process arguments and logs.
token=$(sed -n 's/^DEPLOY_CONTROL_TOKEN=//p' "$RUNTIME_ENV_FILE")
[[ "$token" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || { echo 'DEPLOY_CONTROL_TOKEN harus token acak tanpa tanda kutip.' >&2; exit 78; }
printf 'x-deploy-token: %s\n' "$token" > "$scratch/header"
unset token
run_db() { docker run --rm --network host --env-file "$site/runtime.env" --env-file "$site/migrate.env" "$image" "$@"; }
major=$(run_db node ops/database.mjs version)
[[ "$major" =~ ^(1[5-9]|[2-9][0-9])$ ]] || exit 65
docker pull "postgres:$major-bookworm" >/dev/null
run_db node ops/database.mjs pg-env > "$scratch/pg.env"
mkdir -p "$site/backups"
backup="$site/backups/$(date -u +%Y%m%dT%H%M%SZ)-${revision:0:12}.dump"
docker run --rm --network host --env-file "$scratch/pg.env" "postgres:$major-bookworm" pg_dump --format=custom > "$backup.partial"
[[ -s "$backup.partial" ]] || exit 65
mv "$backup.partial" "$backup"
if [[ -n "$previous" ]]; then
  healthy || { echo 'Versi aktif tidak sehat; hentikan deployment untuk pemeriksaan.' >&2; exit 69; }
  deadline=$((SECONDS + 660))
  while true; do
    active=$(control drain | python3 -c 'import json,sys; v=json.load(sys.stdin)["activeVoiceSessions"]; assert isinstance(v,int) and v>=0; print(v)')
    (( active == 0 )) && break
    (( SECONDS < deadline )) || { echo 'Sesi suara masih aktif; deployment dibatalkan.' >&2; exit 75; }
    sleep 3
  done
fi
run_db node build/backend/db/migrate.js
switched=true
"${compose[@]}" up -d --no-build --wait --wait-timeout 90 app
healthy
printf '%s\n' "$image" > "$site/active-image.new"
mv "$site/active-image.new" "$site/active-image"
printf '%s\n' "$revision" > "$site/active-commit"
echo "Deployment $stage selesai untuk $revision."

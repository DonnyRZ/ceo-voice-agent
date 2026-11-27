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
site="${CEO_DEPLOY_ROOT:-/opt/ceo-voice-agent}/$stage"
ops=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
[[ -f "$site/runtime.env" && -f "$site/migrate.env" ]] || exit 78
exec 9>"$site/deploy.lock"; flock -n 9 || exit 75
export DEPLOY_ENV="$stage" APP_IMAGE="$image" RUNTIME_ENV_FILE="$site/runtime.env"
export GATEWAY_PORT=4311 BLUE_PORT=4321 GREEN_PORT=4331
if [[ "$stage" == prod ]]; then GATEWAY_PORT=4312; BLUE_PORT=4322; GREEN_PORT=4332; fi
export DEPLOY_UID; DEPLOY_UID=$(id -u)
export DEPLOY_GID; DEPLOY_GID=$(id -g)
export GATEWAY_IMAGE='caddy:2.10.2-alpine@sha256:4c6e91c6ed0e2fa03efd5b44747b625fec79bc9cd06ac5235a779726618e530d' GATEWAY_CONFIG_DIR="$site/gateway"
[[ $(docker image inspect "$image" --format '{{.Id}}') == "$expected_id" ]] || exit 65
[[ $(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}') == "$revision" ]] || exit 65
previous=''; old_slot=''; slot=blue
[[ ! -f "$site/active-image" ]] || previous=$(cat "$site/active-image")
if [[ -n "$previous" ]]; then
  [[ "$previous" =~ ^ghcr\.io/[a-z0-9._/-]+:$stage-sha-[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 65
  [[ -f "$site/active-slot" ]] || { echo 'Topologi lama memerlukan migrasi gateway terlebih dahulu.' >&2; exit 78; }
  old_slot=$(cat "$site/active-slot"); [[ "$old_slot" =~ ^(blue|green)$ ]] || exit 65
  [[ "$old_slot" != blue ]] || slot=green
fi
scratch=$(mktemp -d "$site/.deploy.XXXXXX")
mkdir -p "$site/gateway"
markers=(active-image active-commit active-slot rollback-image rollback-commit)
for marker in "${markers[@]}"; do
  [[ ! -f "$site/$marker" ]] || cp "$site/$marker" "$scratch/$marker"
done
# shellcheck source=infra/deploy/gateway.sh
source "$ops/gateway.sh"
# shellcheck source=infra/deploy/database.sh
source "$ops/database.sh"
# shellcheck source=infra/deploy/assets.sh
source "$ops/assets.sh"
export APP_PORT; APP_PORT=$(proxy_port "$slot")
compose=(docker compose --project-name "ceo-$stage-$slot" --file "$ops/compose.yaml")
healthy() { curl --fail --silent --max-time 4 "http://127.0.0.1:$1/api/health" >/dev/null; }
control() { curl --fail --silent --show-error --max-time 5 --header "@$scratch/header" --request POST "http://127.0.0.1:$1/internal/deployment/$2"; }
active_count() { control "$1" drain | python3 -c 'import json,sys; v=json.load(sys.stdin)["activeVoiceSessions"]; assert type(v) is int and v>=0; print(v)'; }
started=false; switched=false; committed=false
finish() {
  code=$?; trap - EXIT
  if (( code != 0 )) && ! $committed; then
    safe=true
    if $switched; then
      restore_gateway || { safe=false; echo 'Gateway memerlukan pemeriksaan; kedua slot dipertahankan.' >&2; }
    fi
    if $safe; then
      for marker in "${markers[@]}"; do
        if [[ -f "$scratch/$marker" ]]; then mv -f "$scratch/$marker" "$site/$marker"
        else rm -f -- "$site/$marker"; fi
      done
      remove_candidate=true
      if $switched && $started; then
        count=$(active_count "$APP_PORT") || count=unknown
        [[ "$count" == 0 ]] || remove_candidate=false
      fi
      if $started && $remove_candidate; then
        rm -f "$GATEWAY_CONFIG_DIR/$slot.live"
        "${compose[@]}" rm -sf app >/dev/null || true
      fi
    fi
  fi
  rm -rf -- "$scratch"
  bash "$ops/cleanup.sh" "$stage" "${image%%:*}" || echo 'Cleanup akan dicoba pada deployment berikutnya.' >&2
  python3 "$ops/assets-cleanup.py" "$site" || echo 'Cleanup aset ditunda.' >&2
  exit "$code"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
token=$(sed -n 's/^DEPLOY_CONTROL_TOKEN=//p' "$RUNTIME_ENV_FILE")
[[ "$token" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || exit 78
printf 'x-deploy-token: %s\n' "$token" > "$scratch/header"; unset token
if [[ -n "$previous" ]]; then healthy "$GATEWAY_PORT" && healthy "$(proxy_port "$old_slot")" || exit 69; fi
# A previous long-running drain may occupy the inactive slot. Never kill its voice sessions.
if healthy "$APP_PORT"; then
  [[ $(active_count "$APP_PORT") == 0 ]] || { echo 'Slot cadangan masih melayani sesi; versi aktif tetap berjalan.' >&2; exit 75; }
fi
docker image inspect "$GATEWAY_IMAGE" >/dev/null 2>&1 || docker pull "$GATEWAY_IMAGE" >/dev/null
prepare_gateway
backup_and_migrate
printf 'deployment phase=database_ready elapsed_seconds=%s\n' "$SECONDS"
started=true
"${compose[@]}" up -d --no-build --wait --wait-timeout 90 app
healthy "$APP_PORT"
printf 'deployment phase=candidate_ready elapsed_seconds=%s\n' "$SECONDS"
prepare_assets
curl --fail --silent --max-time 5 "http://127.0.0.1:$APP_PORT/" | grep -qi '<!doctype html>'
switched=true
switch_gateway
gateway_ready=false
for attempt in {1..30}; do
  if healthy "$GATEWAY_PORT"; then gateway_ready=true; break; fi
  sleep 1
done
$gateway_ready || exit 69
[[ -z "$previous" ]] || {
  printf '%s\n' "$previous" > "$site/rollback-image"
  cp "$site/active-commit" "$site/rollback-commit"
}
printf '%s\n' "$image" > "$site/active-image.new"; mv "$site/active-image.new" "$site/active-image"
printf '%s\n' "$revision" > "$site/active-commit"
printf '%s\n' "$slot" > "$site/active-slot"
committed=true
printf 'deployment phase=traffic_switched elapsed_seconds=%s\n' "$SECONDS"
if [[ -n "$old_slot" ]]; then
  old_port=$(proxy_port "$old_slot"); deadline=$((SECONDS + 660)); drained=false
  while active=$(active_count "$old_port"); do
    if (( active == 0 )); then drained=true; break; fi
    (( SECONDS < deadline )) || break
    sleep 3
  done
  if $drained; then
    # No sessions remain: unpin the old slot before graceful process shutdown.
    rm -f "$GATEWAY_CONFIG_DIR/$old_slot.live"
      docker compose --project-name "ceo-$stage-$old_slot" --file "$ops/compose.yaml" stop --timeout 30 app >/dev/null
      docker compose --project-name "ceo-$stage-$old_slot" --file "$ops/compose.yaml" rm -f app >/dev/null
  else echo 'Versi baru aktif; slot lama dipertahankan sampai sesi selesai. Maksimal dua slot.' >&2; fi
fi
echo "Deployment $stage selesai untuk $revision pada slot $slot."

#!/usr/bin/env bash
# LOCAL disposable database and containers only. Refuse any existing ceo-stage deployment.
set -Eeuo pipefail
umask 077
repo=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)
cd "$repo"
base_image=${1:?Masukkan image aplikasi lokal yang sudah dibangun}
docker image inspect "$base_image" >/dev/null
# Never reuse/delete an existing application budget volume.
if docker volume inspect ceo-stage-voice-budget >/dev/null 2>&1; then exit 64; fi
[[ -z $(docker ps -aq --filter name=ceo-stage) ]] || exit 64
for port in 4311 4321 4331; do
  [[ -z $(ss -ltnH "sport = :$port") ]] || exit 64
done
root=$(mktemp -d /tmp/ceo-rollout.XXXXXX)
name="ceo-rollout-db-$$"
image_base=ghcr.io/test/ceo-rollout-$$
cleanup() {
  for project in ceo-stage-blue ceo-stage-green ceo-stage-gateway; do
    ids=$(docker ps -aq --filter "label=com.docker.compose.project=$project")
    [[ -z "$ids" ]] || docker rm -fv $ids >/dev/null 2>&1 || true
  done
  docker volume rm ceo-stage-voice-budget >/dev/null 2>&1 || true
  docker rm -fv "$name" >/dev/null 2>&1 || true
  docker image ls --filter "reference=$image_base:*" --format '{{.Repository}}:{{.Tag}}' | xargs -r docker image rm >/dev/null 2>&1 || true
  rm -rf -- "$root"
}
trap cleanup EXIT
mkdir "$root/stage"
printf 'POSTGRES_PASSWORD=%s\n' "$(openssl rand -hex 32)" > "$root/postgres.env"
docker run -d --name "$name" --env-file "$root/postgres.env" -p 127.0.0.1::5432 pgvector/pgvector:pg17-trixie >/dev/null
for i in {1..60}; do
  if docker exec "$name" sh -c '[ "$(cat /proc/1/comm)" = postgres ] && pg_isready -U postgres' >/dev/null 2>&1; then break; fi
  sleep 1
done
port=$(docker inspect "$name" --format '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}')
owner=$(openssl rand -hex 32); app=$(openssl rand -hex 32)
printf 'CEO_OWNER_PASSWORD=%s\nCEO_APP_PASSWORD=%s\n' "$owner" "$app" > "$root/bootstrap.env"
docker exec -i --env-file "$root/bootstrap.env" "$name" psql -X -U postgres -d postgres -v environment=stage < infra/deploy/bootstrap-database.sql > "$root/bootstrap.log"
printf 'DATABASE_URL=postgresql://ceo_stage_app:%s@127.0.0.1:%s/ceo_voice_agent_stage\nAPP_ORIGIN=https://example.invalid\nBETTER_AUTH_SECRET=%s\nDEPLOY_CONTROL_TOKEN=%s\nAI_VOICE_ENABLED=false\n' "$app" "$port" "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$root/stage/runtime.env"
printf 'DATABASE_ADMIN_URL=postgresql://ceo_stage_owner:%s@127.0.0.1:%s/ceo_voice_agent_stage\n' "$owner" "$port" > "$root/stage/migrate.env"
for attempt in 1 2; do
  char=a
  printf -v sha '%040d' 0; sha=${sha//0/$char}
  tag="$image_base:stage-sha-$sha-$attempt-1"
  if [[ "$attempt" == 1 ]]; then
  container=$(docker create "$base_image")
  docker commit --change "LABEL org.opencontainers.image.revision=$sha org.opencontainers.image.source=https://github.com/test/ceo-rollout-$$" "$container" "$tag" > /dev/null
  docker rm -v "$container" >/dev/null
  first_tag="$tag"
  else docker tag "$first_tag" "$tag"; fi
  id=$(docker image inspect "$tag" --format '{{.Id}}')
  CEO_DEPLOY_ROOT="$root" bash infra/deploy/deploy.sh stage "$tag" "$id" > "$root/deploy-$attempt.log" 2>&1 || { tail -n 35 "$root/deploy-$attempt.log"; exit 1; }
  curl -fsS http://127.0.0.1:4311/api/health >/dev/null
  curl -fsS http://127.0.0.1:4311/ | grep -qi '<!doctype html>'
  [[ -n $(find "$root/stage/gateway/static/assets" -type f -name '*.js') ]]
  echo "LOCAL real deployment $attempt succeeded."
done
[[ $(cat "$root/stage/active-slot") == green ]]
[[ $(docker ps -q --filter label=com.docker.compose.project=ceo-stage-blue | wc -l) == 0 ]]
echo 'Initial install + blue-to-green replacement + shared DB migrations + old container cleanup passed.'

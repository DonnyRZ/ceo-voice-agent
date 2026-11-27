#!/usr/bin/env bash
# Manual pre-domain check only. No packages, image pulls, migration, or services.
set -Eeuo pipefail
[[ "$DEPLOY_ENV" =~ ^(stage|prod)$ ]] || exit 64
[[ "$STAGE_DEPLOY_ENABLED" == false && "$PROD_DEPLOY_ENABLED" == false ]] || {
  echo 'Pemeriksaan pra-aktivasi memerlukan kedua flag deployment false.' >&2; exit 78;
}
[[ $(id -un) == ceo-deploy ]] || { echo 'Runner harus memakai akun ceo-deploy.' >&2; exit 78; }
for tool in docker gh psql python3 ss stat; do command -v "$tool" >/dev/null || exit 78; done
site="${CEO_DEPLOY_ROOT:-/var/www/ceo-agent}/$DEPLOY_ENV"
ops=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
for directory in "$site" "$site/shared"; do
  [[ -d "$directory" && -r "$directory" && -w "$directory" && -x "$directory" ]]
  [[ $(stat -c '%a' "$directory") == 700 && $(stat -c '%U' "$directory") == ceo-deploy ]]
done
# shellcheck source=infra/deploy/config.sh
source "$ops/config.sh"
for config in "$RUNTIME_ENV_FILE" "$MIGRATE_ENV_FILE" "$COMPOSE_ENV_FILE"; do
  [[ -r "$config" && $(stat -c '%U' "$config") == ceo-deploy ]]
done
docker version --format 'Docker server {{.Server.Version}}'
docker compose version --short
gh --version | head -1
psql --version
df -h "$site" | tail -1
for port in "$GATEWAY_PORT" "$BLUE_PORT" "$GREEN_PORT"; do
  [[ -z $(ss -ltnH "sport = :$port") ]] || { echo "Port $port sudah dipakai; periksa sebelum aktivasi." >&2; exit 78; }
done
python3 "$ops/readiness-db.py" "$site" "$DEPLOY_ENV"
echo "VPS readiness $DEPLOY_ENV lulus; domain/origin dan SMTP masih menunggu konfigurasi. Deployment tetap nonaktif."

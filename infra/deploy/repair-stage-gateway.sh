#!/usr/bin/env bash
# Planned bootstrap repair, stage only. Never called by routine deployment.
set -Eeuo pipefail
umask 077
[[ "${PUBLIC_APP_URL:-}" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ ]] || exit 78
site="${CEO_DEPLOY_ROOT:-/var/www/ceo-agent}/stage"
ops=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
source "$ops/config.sh"
export GATEWAY_CONFIG_DIR="$site/gateway"
source "$ops/gateway.sh"
exec 9>"$site/deploy.lock"; flock -n 9 || exit 75
slot=$(cat "$site/active-slot"); [[ "$slot" =~ ^(blue|green)$ ]] || exit 78
port=$(proxy_port "$slot")
container=ceo-stage-gateway
[[ $(docker inspect "$container" --format '{{index .Config.Labels "com.docker.compose.project"}}') == ceo-stage-gateway ]] || exit 78
active="$GATEWAY_CONFIG_DIR/active.Caddyfile"
[[ -f "$active" && ! -L "$active" ]] || exit 78
scratch=$(mktemp -d "$site/.gateway-repair.XXXXXX")
draining=false; changed=false; committed=false
control() { curl --fail --silent --show-error --max-time 5 --header "@$scratch/header" --request POST "http://127.0.0.1:$port/internal/deployment/$1"; }
cleanup() {
  code=$?; trap - EXIT
  restored=true
  if $changed && ! $committed; then
    cp "$scratch/previous.Caddyfile" "$active" && docker restart --time 30 "$container" >/dev/null || restored=false
  fi
  if $draining && ! control resume >/dev/null; then
    echo 'Periksa status penerimaan sesi suara stage.' >&2
    [[ "$code" != 0 ]] || code=1
  fi
  rm -f "$GATEWAY_CONFIG_DIR/repair.Caddyfile" "$scratch/header"
  if $restored; then rm -rf -- "$scratch"; else echo "Pemulihan gateway gagal; backup privat dipertahankan di $scratch." >&2; fi
  exit "$code"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
token=$(sed -n 's/^DEPLOY_CONTROL_TOKEN=//p' "$RUNTIME_ENV_FILE")
[[ "$token" =~ ^[A-Za-z0-9_-]{43,128}$ ]] || exit 78
printf 'x-deploy-token: %s\n' "$token" > "$scratch/header"; unset token
draining=true
count=$(control drain | python3 -c 'import json,sys; print(json.load(sys.stdin)["activeVoiceSessions"])')
[[ "$count" == 0 ]] || { echo 'Perbaikan ditolak: masih ada sesi suara aktif.' >&2; exit 75; }
write_gateway "$GATEWAY_CONFIG_DIR/repair.Caddyfile"
if ! cmp -s "$active" "$GATEWAY_CONFIG_DIR/repair.Caddyfile"; then
  # Only the known loopback-host restriction may change; never replace unknown config.
  python3 - "$active" "$GATEWAY_CONFIG_DIR/repair.Caddyfile" "$GATEWAY_PORT" <<'PY'
from pathlib import Path
import sys
old, new = Path(sys.argv[1]).read_text(), Path(sys.argv[2]).read_text()
assert old.replace('http://127.0.0.1:' + sys.argv[3] + ' {', 'http://:' + sys.argv[3] + ' {', 1) == new
PY
  docker exec "$container" caddy validate --config /etc/ceo/repair.Caddyfile --adapter caddyfile >/dev/null
  cp -a "$active" "$scratch/previous.Caddyfile"
  changed=true
  mv -f "$GATEWAY_CONFIG_DIR/repair.Caddyfile" "$active"
  docker restart --time 30 "$container" >/dev/null
fi
authority=$(python3 -c 'from urllib.parse import urlsplit; import sys; print(urlsplit(sys.argv[1]).netloc)' "$PUBLIC_APP_URL")
ready=false
for attempt in {1..20}; do
  if curl --fail --silent --max-time 3 --header "Host: $authority" "http://127.0.0.1:$GATEWAY_PORT/api/health" | python3 -c 'import json,sys; assert json.load(sys.stdin)["status"]=="ok"' 2>/dev/null; then ready=true; break; fi
  sleep 1
done
$ready || exit 69
python3 "$ops/public-smoke.py" "$PUBLIC_APP_URL"
committed=true
echo 'Gateway stage menerima Host publik; backend dan data tidak diganti.'

#!/usr/bin/env bash
# Sourced by deploy.sh. Parse only the documented Compose ports, never shell code.
RUNTIME_ENV_FILE="$site/shared/api.env"
MIGRATE_ENV_FILE="$site/shared/migrate.env"
COMPOSE_ENV_FILE="$site/shared/compose.env"
for config in "$RUNTIME_ENV_FILE" "$MIGRATE_ENV_FILE" "$COMPOSE_ENV_FILE"; do
  [[ -f "$config" && ! -L "$config" ]] || { echo "Konfigurasi privat belum tersedia: $config" >&2; exit 78; }
  mode=$(stat -c '%a' "$config")
  (( (8#$mode & 077) == 0 )) || { echo "Izin file harus 0600 atau 0400: $config" >&2; exit 78; }
done
unset GATEWAY_PORT BLUE_PORT GREEN_PORT
while IFS= read -r line || [[ -n "$line" ]]; do
  [[ -z "$line" || "$line" == \#* ]] && continue
  [[ "$line" =~ ^(GATEWAY_PORT|BLUE_PORT|GREEN_PORT)=([1-9][0-9]{3,4})$ ]] || { echo 'compose.env hanya menerima tiga port desimal yang didokumentasikan.' >&2; exit 78; }
  key=${BASH_REMATCH[1]}; value=${BASH_REMATCH[2]}
  [[ ! -v "$key" ]] && (( value > 1023 && value <= 65535 )) || exit 78
  printf -v "$key" '%s' "$value"
done < "$COMPOSE_ENV_FILE"
[[ -n "${GATEWAY_PORT:-}" && -n "${BLUE_PORT:-}" && -n "${GREEN_PORT:-}" ]] || exit 78
[[ "$GATEWAY_PORT" != "$BLUE_PORT" && "$GATEWAY_PORT" != "$GREEN_PORT" && "$BLUE_PORT" != "$GREEN_PORT" ]] || exit 78
export RUNTIME_ENV_FILE MIGRATE_ENV_FILE COMPOSE_ENV_FILE GATEWAY_PORT BLUE_PORT GREEN_PORT

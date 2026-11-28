#!/usr/bin/env bash
# Sourced by deploy.sh. Routine releases change one filesystem pointer, never reload Caddy.
proxy_port() { [[ "$1" == blue ]] && echo "$BLUE_PORT" || echo "$GREEN_PORT"; }
write_gateway() {
  local output=$1 slot port
  {
    printf '{\n admin off\n auto_https off\n persist_config off\n}\n'
    printf 'http://:%s {\n bind 127.0.0.1\n route {\n' "$GATEWAY_PORT"
    printf ' @internal path /internal/*\n respond @internal 404\n'
    for slot in blue green; do
      port=$(proxy_port "$slot")
      printf ' @session_%s {\n path /api/ceo/voice/sessions/*\n header_regexp Cookie "(^|;[ ]*)ceo_voice_slot=%s(;|$)"\n file {\n root /etc/ceo\n try_files %s.live\n }\n }\n' "$slot" "$slot" "$slot"
      printf ' handle @session_%s {\n reverse_proxy 127.0.0.1:%s {\n flush_interval -1\n transport http {\n keepalive 30s\n }\n }\n }\n' "$slot" "$port"
    done
    printf ' handle /assets/* {\n root * /etc/ceo/static\n file_server\n }\n'
    printf ' @current_blue file {\n root /etc/ceo/current\n try_files blue\n }\n'
    # One file lookup selects a branch; no pair of checks can straddle the atomic switch.
    for slot in blue green; do
      port=$(proxy_port "$slot")
      if [[ "$slot" == blue ]]; then printf ' handle @current_blue {\n'; else printf ' handle {\n'; fi
      printf ' @start_%s {\n method POST\n path /api/ceo/voice/sessions\n }\n' "$slot"
      printf ' header @start_%s +Set-Cookie "ceo_voice_slot=%s; Path=/api/ceo/voice/sessions; HttpOnly; Secure; SameSite=Strict"\n' "$slot" "$slot"
      printf ' reverse_proxy 127.0.0.1:%s {\n flush_interval -1\n transport http {\n keepalive 30s\n }\n }\n }\n' "$port"
    done
    printf ' }\n}\n'
  } > "$output"
}
set_gateway_route() {
  local target=$1
  [[ "$target" =~ ^(blue|green)$ ]] || return 64
  touch "$GATEWAY_CONFIG_DIR/$target.live" || return $?
  ln -sfn "routes/$target" "$GATEWAY_CONFIG_DIR/current.next" || return $?
  mv -Tf "$GATEWAY_CONFIG_DIR/current.next" "$GATEWAY_CONFIG_DIR/current"
}
prepare_gateway() {
  mkdir -p "$GATEWAY_CONFIG_DIR/routes/blue" "$GATEWAY_CONFIG_DIR/routes/green"
  touch "$GATEWAY_CONFIG_DIR/routes/blue/blue" "$GATEWAY_CONFIG_DIR/routes/green/green"
  write_gateway "$GATEWAY_CONFIG_DIR/next.Caddyfile"
  docker run --rm --network host --user "$DEPLOY_UID:$DEPLOY_GID" -v "$GATEWAY_CONFIG_DIR:/etc/ceo:ro" "$GATEWAY_IMAGE" caddy validate --config /etc/ceo/next.Caddyfile --adapter caddyfile >/dev/null
  if [[ -f "$GATEWAY_CONFIG_DIR/active.Caddyfile" ]]; then
    cmp -s "$GATEWAY_CONFIG_DIR/next.Caddyfile" "$GATEWAY_CONFIG_DIR/active.Caddyfile" || {
      echo 'Konfigurasi gateway berubah; perlu upgrade gateway terencana, bukan reload saat rilis aplikasi.' >&2; return 78;
    }
  else mv "$GATEWAY_CONFIG_DIR/next.Caddyfile" "$GATEWAY_CONFIG_DIR/active.Caddyfile"; fi
}
switch_gateway() {
  set_gateway_route "$slot" || return $?
  if ! docker inspect "ceo-$stage-gateway" >/dev/null 2>&1; then
    docker compose --env-file "$COMPOSE_ENV_FILE" --project-name "ceo-$stage-gateway" --file "$ops/gateway.compose.yaml" up -d --no-build gateway
  fi
}
restore_gateway() {
  [[ -n "$old_slot" ]] || return 1
  set_gateway_route "$old_slot"
}

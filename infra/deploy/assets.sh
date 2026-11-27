#!/usr/bin/env bash
# Keep content-hashed JS/CSS available to tabs opened before a deployment.
prepare_assets() {
  mkdir -p "$scratch/assets" "$site/gateway/static/assets" "$site/gateway/manifests"
  "${compose[@]}" cp app:/app/build/frontend/dist/assets/. "$scratch/assets/"
  find "$scratch/assets" -type f -printf '%P\n' | sort > "$site/gateway/manifests/$revision"
  [[ -s "$site/gateway/manifests/$revision" ]] || { echo 'Bundle frontend kosong.' >&2; return 65; }
  cp -a "$scratch/assets/." "$site/gateway/static/assets/"
}

#!/usr/bin/env bash
# Remove only unused release tags for THIS app/environment, never global prune.
set -Eeuo pipefail
stage=${1:?Lingkungan wajib diisi}
repository=${2:?Repository image wajib diisi}
[[ "$stage" =~ ^(stage|prod)$ && "$repository" =~ ^ghcr\.io/[a-z0-9._/-]+$ ]] || exit 64
site="${CEO_DEPLOY_ROOT:-/var/www/ceo-agent}/$stage"
[[ -d "$site" ]] || exit 0
active=''
[[ ! -f "$site/active-image" ]] || active=$(cat "$site/active-image")
rollback=''
[[ ! -f "$site/rollback-image" ]] || rollback=$(cat "$site/rollback-image")
for kept in "$active" "$rollback"; do
  [[ -z "$kept" || "$kept" =~ ^$repository:$stage-sha-[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || exit 65
done
# Include stopped containers too: another environment/operator may still need them.
containers=$(docker ps -aq)
protected=''
[[ -z "$containers" ]] || protected=$(docker inspect --format '{{.Image}}' $containers)
while read -r tag; do
  [[ "$tag" == "$repository:$stage-sha-"* ]] || continue
  [[ "$tag" != "$active" && "$tag" != "$rollback" ]] || continue
  [[ "$tag" =~ ^$repository:$stage-sha-[a-f0-9]{40}-[0-9]+-[0-9]+$ ]] || continue
  image_id=$(docker image inspect "$tag" --format '{{.Id}}') || continue
  [[ $'\n'"$protected"$'\n' != *$'\n'"$image_id"$'\n'* ]] || continue
  source=$(docker image inspect "$tag" --format '{{index .Config.Labels "org.opencontainers.image.source"}}') || continue
  [[ "${source,,}" == "https://github.com/${repository#ghcr.io/}" ]] || continue
  docker image rm "$tag" || echo "Image masih dipakai; dipertahankan: $tag" >&2
 done < <(docker image ls --filter "reference=$repository:$stage-sha-*" --format '{{.Repository}}:{{.Tag}}')

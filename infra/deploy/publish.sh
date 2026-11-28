#!/usr/bin/env bash
# Runs on the dedicated VPS runner; builds/tests stay on GitHub-hosted runners.
set -Eeuo pipefail
umask 077
[[ "${PUBLIC_APP_URL:-}" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ ]] || { echo 'APP_URL HTTPS wajib dikonfigurasi sebelum aktivasi.' >&2; exit 78; }
[[ "$RELEASE_ENV" =~ ^(stage|prod)$ && "$RELEASE_ID" =~ ^[a-f0-9]{40}$ ]]
[[ "$GITHUB_REPOSITORY" =~ ^[a-zA-Z0-9_.-]+/[a-zA-Z0-9_.-]+$ ]]
[[ "$RELEASE_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+:(stage|prod)-sha-([a-f0-9]{40})-[0-9]+-[0-9]+$ ]]
[[ "${BASH_REMATCH[1]}" == "$RELEASE_ENV" && "${BASH_REMATCH[2]}" == "$RELEASE_ID" ]]
[[ "${RELEASE_IMAGE%%:*}" == "ghcr.io/${GITHUB_REPOSITORY,,}" ]]
[[ "$RELEASE_IMAGE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ ( "$RELEASE_ENV" == stage && "$RELEASE_BRANCH" == develop ) || ( "$RELEASE_ENV" == prod && "$RELEASE_BRANCH" == main ) ]]
site="${CEO_DEPLOY_ROOT:-/var/www/ceo-agent}/$RELEASE_ENV"
[[ -d "$site/shared" ]] || { echo 'Konfigurasi shared VPS belum disiapkan.' >&2; exit 78; }
latest=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$RELEASE_BRANCH" --jq '.object.sha')
[[ "$latest" == "$RELEASE_ID" ]] || { echo 'Versi lama tidak boleh menggantikan commit terbaru.' >&2; exit 1; }
scratch=$(mktemp -d "$RUNNER_TEMP/ceo-deploy.XXXXXX")
locked=false
cleanup() {
  code=$?; trap - EXIT
  if $locked; then
    bash infra/deploy/cleanup.sh "$RELEASE_ENV" "${RELEASE_IMAGE%%:*}" || echo 'Cleanup image ditunda sampai rilis berikutnya.' >&2
  fi
  rm -rf -- "$scratch"
  exit "$code"
}
trap cleanup EXIT
# Do not leave the automatic token in the VPS user's persistent Docker credentials.
export DOCKER_CONFIG="$scratch/docker"
mkdir -m 700 "$DOCKER_CONFIG"
exec 8>"$site/deploy.lock"; flock -n 8 || exit 75
locked=true
bash infra/deploy/cleanup.sh "$RELEASE_ENV" "${RELEASE_IMAGE%%:*}"
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
docker pull "$RELEASE_IMAGE"
[[ $(docker image inspect "$RELEASE_IMAGE" --format '{{.Id}}') == "$RELEASE_IMAGE_ID" ]]
latest=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$RELEASE_BRANCH" --jq '.object.sha')
[[ "$latest" == "$RELEASE_ID" ]] || { echo 'Commit baru ditemukan; aplikasi VPS tidak diganti.' >&2; exit 1; }
rm -rf -- "$DOCKER_CONFIG"; unset DOCKER_CONFIG GH_TOKEN
release="$site/releases/$RELEASE_ID"
mkdir -p "$release"
for file in compose.yaml gateway.compose.yaml deploy.sh gateway.sh database.sh cleanup.sh assets.sh assets-cleanup.py config.sh public-smoke.py; do
  install -m 600 "infra/deploy/$file" "$release/$file"
done
# FD 8 stays locked throughout deploy; deploy.sh reuses it rather than relocking.
CEO_DEPLOY_LOCK_HELD=true bash "$release/deploy.sh" "$RELEASE_ENV" "$RELEASE_IMAGE" "$RELEASE_IMAGE_ID"

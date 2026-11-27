#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
[[ "${PUBLIC_APP_URL:-}" =~ ^https://[a-zA-Z0-9.-]+(:[0-9]+)?/?$ ]] || { echo 'APP_URL HTTPS wajib dikonfigurasi sebelum aktivasi.' >&2; exit 78; }
[[ "$VPS_HOST" =~ ^[a-zA-Z0-9.-]+$ && "$VPS_USER" =~ ^[a-z_][a-z0-9_-]*$ && "$VPS_PORT" =~ ^[0-9]{1,5}$ ]]
(( 10#$VPS_PORT > 0 && 10#$VPS_PORT <= 65535 ))
[[ "$RELEASE_ENV" =~ ^(stage|prod)$ && "$RELEASE_SHA" =~ ^[a-f0-9]{40}$ ]]
[[ "$RELEASE_IMAGE" =~ ^ghcr\.io/[a-z0-9._/-]+:(stage|prod)-sha-([a-f0-9]{40})-[0-9]+-[0-9]+$ ]]
[[ "${BASH_REMATCH[1]}" == "$RELEASE_ENV" && "${BASH_REMATCH[2]}" == "$RELEASE_SHA" ]]
[[ "$RELEASE_ID" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ ( "$RELEASE_ENV" == stage && "$RELEASE_BRANCH" == develop ) || ( "$RELEASE_ENV" == prod && "$RELEASE_BRANCH" == main ) ]]
[[ -n "$VPS_SSH_KEY" && -n "$VPS_KNOWN_HOSTS" ]]
latest=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$RELEASE_BRANCH" --jq '.object.sha')
[[ "$latest" == "$RELEASE_SHA" ]] || { echo 'Versi lama tidak boleh menggantikan commit terbaru.' >&2; exit 1; }
scratch=$(mktemp -d "$RUNNER_TEMP/ceo-deploy.XXXXXX")
remote_ready=false
cleanup() {
  code=$?; trap - EXIT
  if (( code != 0 )) && $remote_ready; then
    remote_cleanup || echo 'Cleanup release tertunda; akan dicoba pada deploy berikutnya.' >&2
  fi
  rm -rf -- "$scratch"; docker logout ghcr.io >/dev/null 2>&1 || true
  exit "$code"
}
trap cleanup EXIT
printf '%s\n' "$VPS_SSH_KEY" > "$scratch/key"
printf '%s\n' "$VPS_KNOWN_HOSTS" > "$scratch/known_hosts"
unset VPS_SSH_KEY VPS_KNOWN_HOSTS
ssh_args=(-F /dev/null -i "$scratch/key" -p "$VPS_PORT" -o BatchMode=yes -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$scratch/known_hosts" -o ConnectTimeout=15)
remote="$VPS_USER@$VPS_HOST"
release="/opt/ceo-voice-agent/releases/$RELEASE_SHA"
remote_cleanup() {
  ssh "${ssh_args[@]}" "$remote" "if test -d '/opt/ceo-voice-agent/$RELEASE_ENV'; then flock -n '/opt/ceo-voice-agent/$RELEASE_ENV/deploy.lock' bash '$release/cleanup.sh' '$RELEASE_ENV' '${RELEASE_IMAGE%%:*}'; fi"
}
printf '%s' "$GH_TOKEN" | docker login ghcr.io -u "$GITHUB_ACTOR" --password-stdin
docker pull "$RELEASE_IMAGE"
[[ $(docker image inspect "$RELEASE_IMAGE" --format '{{.Id}}') == "$RELEASE_ID" ]]
# No registry token or application .env is sent to GitHub/VPS command arguments.
tar -C infra/deploy -czf - compose.yaml gateway.compose.yaml deploy.sh gateway.sh database.sh cleanup.sh assets.sh assets-cleanup.py | ssh "${ssh_args[@]}" "$remote" "umask 077; mkdir -p '$release'; tar -xzf - -C '$release'"
remote_ready=true
remote_cleanup
docker save "$RELEASE_IMAGE" | gzip -1 | ssh "${ssh_args[@]}" "$remote" 'gzip -dc | docker load'
latest=$(gh api "repos/$GITHUB_REPOSITORY/git/ref/heads/$RELEASE_BRANCH" --jq '.object.sha')
[[ "$latest" == "$RELEASE_SHA" ]] || { echo 'Commit baru ditemukan; aplikasi VPS tidak diganti.' >&2; exit 1; }
ssh "${ssh_args[@]}" "$remote" "bash '$release/deploy.sh' '$RELEASE_ENV' '$RELEASE_IMAGE' '$RELEASE_ID'"
curl --fail --silent --show-error --retry 5 --retry-delay 2 --retry-connrefused --max-time 10 "${PUBLIC_APP_URL%/}/api/health"

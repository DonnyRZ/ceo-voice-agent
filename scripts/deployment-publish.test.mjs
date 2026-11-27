import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const sha = 'a'.repeat(40), id = 'sha256:' + 'b'.repeat(64);
for (const target of ['stage', 'prod']) {
  for (const mode of ['success', 'superseded-before', 'superseded-after', 'pull-failure', 'wrong-image', 'busy']) {
    test(`VPS runner ${target}/${mode} preserves active traffic and removes temporary credentials`, () => {
      const root = mkdtempSync(join(tmpdir(), 'ceo-publish-'));
      for (const dir of ['bin', 'runner', `${target}/shared`]) mkdirSync(join(root, dir), { recursive: true });
      function bin(name, script) { writeFileSync(join(root, 'bin', name), '#!/bin/bash\nset -eu\n' + script, { mode: 0o700 }); }
      try {
        bin('gh', `n=0; [[ ! -f "$ROOT/count" ]] || n=$(cat "$ROOT/count"); echo $((n+1)) > "$ROOT/count"
if [[ ( "$MODE" == superseded-before && "$n" == 0 ) || ( "$MODE" == superseded-after && "$n" == 1 ) ]]; then echo '${'c'.repeat(40)}'; else echo '${sha}'; fi\n`);
        bin('docker', `echo "docker $*" >> "$ROOT/trace"
case "$1" in
 login) cat > "$DOCKER_CONFIG/config.json";;
 pull) [[ "$MODE" != pull-failure ]];;
 image) [[ "$MODE" != wrong-image ]] && echo '${id}' || echo sha256:wrong;;
esac\n`);
        bin('bash', `
if [[ "$1" == */deploy.sh ]]; then
  [[ ! -v GH_TOKEN && ! -v DOCKER_CONFIG ]]
  [[ "$CEO_DEPLOY_LOCK_HELD" == true ]]
  [[ $(readlink /proc/self/fd/8) == "$ROOT/$TARGET/deploy.lock" ]]
  echo "deploy $*" >> "$ROOT/trace"
else echo cleanup >> "$ROOT/trace"; fi\n`);
        bin('ssh', 'echo UNEXPECTED_SSH >> "$ROOT/trace"; exit 1\n');
        bin('curl', 'echo health >> "$ROOT/trace"\n');
        const env = { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, ROOT: root,
          MODE: mode, TARGET: target, CEO_DEPLOY_ROOT: root, RUNNER_TEMP: join(root, 'runner'),
          PUBLIC_APP_URL: `https://${target}.example.com`, RELEASE_ENV: target,
          RELEASE_ID: sha, RELEASE_IMAGE_ID: id, RELEASE_BRANCH: target === 'stage' ? 'develop' : 'main',
          GITHUB_REPOSITORY: 'test/app', GITHUB_ACTOR: 'fixture', GH_TOKEN: 'fixture-token',
          RELEASE_IMAGE: `ghcr.io/test/app:${target}-sha-${sha}-1-1`,
        };
        const args = mode === 'busy'
          ? ['-c', 'exec 9>"$ROOT/$TARGET/deploy.lock"; flock -n 9; exec /bin/bash infra/deploy/publish.sh']
          : ['infra/deploy/publish.sh'];
        const result = spawnSync('/bin/bash', args, { encoding: 'utf8', env });
        assert.equal(result.status, mode === 'success' ? 0 : mode === 'busy' ? 75 : 1, result.stderr);
        const trace = existsSync(join(root, 'trace')) ? readFileSync(join(root, 'trace'), 'utf8') : '';
        if (mode === 'success') {
          assert.match(trace, /docker pull[^]*deploy[^]*health/);
          assert.ok(trace.includes(`${target}/releases/${sha}/deploy.sh`));
          assert.equal(readFileSync(join(root, `${target}/releases/${sha}/compose.yaml`), 'utf8'), readFileSync('infra/deploy/compose.yaml', 'utf8'));
        } else assert.doesNotMatch(trace, /deploy |health/);
        if (!['busy', 'superseded-before'].includes(mode)) assert.match(trace, /cleanup/);
        assert.doesNotMatch(trace + result.stdout + result.stderr, /fixture-token|UNEXPECTED_SSH/);
        assert.deepEqual(readdirSync(join(root, 'runner')), []);
        assert.equal(existsSync(join(root, target === 'stage' ? 'prod' : 'stage')), false);
      } finally { rmSync(root, { recursive: true, force: true }); }
    });
  }
}

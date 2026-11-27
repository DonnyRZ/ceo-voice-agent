import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
for (const mode of ['success', 'superseded', 'load-failure']) test(`image transfer ${mode} cleans safely without deploying superseded images`, () => {
  const root = mkdtempSync(join(tmpdir(), 'ceo-publish-'));
  const sha = 'a'.repeat(40), id = 'sha256:' + 'b'.repeat(64);
  mkdirSync(join(root, 'bin')); mkdirSync(join(root, 'runner'));
  function bin(name, script) { writeFileSync(join(root, 'bin', name), '#!/bin/bash\nset -eu\n' + script, { mode: 0o700 }); }
  try {
    bin('gh', `n=0; [[ ! -f "$ROOT/count" ]] || n=$(cat "$ROOT/count"); echo $((n+1)) > "$ROOT/count"
if [[ "$MODE" == superseded && "$n" == 1 ]]; then echo '${'c'.repeat(40)}'; else echo '${sha}'; fi\n`);
    bin('docker', `
case "$1" in
 login) cat >/dev/null;;
 inspect|image) echo '${id}';;
 save) printf fixture;;
esac\n`);
    bin('ssh', `last="\${!#}"; echo "$last" >> "$ROOT/trace"
if [[ "$last" == *'tar -xzf'* || "$last" == *'docker load'* ]]; then cat >/dev/null; fi
if [[ "$last" == *'docker load'* && "$MODE" == load-failure ]]; then exit 1; fi\n`);
    bin('curl', ':\n');
    const result = spawnSync('bash', ['infra/deploy/publish.sh'], { encoding: 'utf8', env: { ...process.env,
      PATH: `${root}/bin:${process.env.PATH}`, ROOT: root, MODE: mode, RUNNER_TEMP: join(root, 'runner'),
      PUBLIC_APP_URL: 'https://stage.example.com', VPS_HOST: 'example.com', VPS_USER: 'deploy', VPS_PORT: '22',
      VPS_SSH_KEY: 'private-fixture', VPS_KNOWN_HOSTS: 'fixture-host-key', RELEASE_ENV: 'stage',
      RELEASE_SHA: sha, RELEASE_ID: id, RELEASE_BRANCH: 'develop', GITHUB_REPOSITORY: 'test/app',
      GITHUB_ACTOR: 'fixture', GH_TOKEN: 'fixture-token', RELEASE_IMAGE: `ghcr.io/test/app:stage-sha-${sha}-1-1`,
    } });
    assert.equal(result.status, mode === 'success' ? 0 : 1, result.stderr);
    const trace = readFileSync(join(root, 'trace'), 'utf8');
    assert.ok(trace.indexOf('tar -xzf') < trace.indexOf('docker load'));
    assert.match(trace, /flock -n.*cleanup.sh/);
    if (mode === 'success') assert.match(trace, /bash .*deploy.sh/);
    else {
      assert.doesNotMatch(trace, /bash .*deploy.sh/);
      assert.equal(trace.match(/cleanup.sh/g).length, 2);
    }
    assert.equal(trace.includes('private-fixture'), false);
    assert.equal(trace.includes('fixture-token'), false);
    assert.deepEqual(readdirSync(join(root, 'runner')), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

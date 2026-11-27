import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

const sha = 'a'.repeat(40), old = 'b'.repeat(40), id = `sha256:${'c'.repeat(64)}`;
function fixture(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'ceo-release-test-'));
  const bin = join(root, 'bin'), site = join(root, 'stage');
  mkdirSync(bin); mkdirSync(site);
  writeFileSync(join(site, 'runtime.env'), `DEPLOY_CONTROL_TOKEN=${'d'.repeat(64)}\n`);
  writeFileSync(join(site, 'migrate.env'), 'DATABASE_ADMIN_URL=test\n');
  writeFileSync(join(site, 'active-image'), `ghcr.io/test/app:stage-sha-${old}-1-1\n`);
  function executable(name, body) { writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 }); }
  executable('docker', `
if [[ "$1" == image ]]; then
  [[ "$*" == *Config.Labels* ]] && echo '${sha}' || echo '${id}'; exit 0
fi
if [[ "$1" == pull ]]; then exit 0; fi
if [[ "$1" == run ]]; then
  if [[ "$*" == *'ops/database.mjs version'* ]]; then echo 17
  elif [[ "$*" == *'ops/database.mjs pg-env'* ]]; then echo PGDATABASE=ceo_voice_agent_stage
  elif [[ "$*" == *pg_dump* ]]; then echo fixture-backup
  elif [[ "$*" == *db/migrate.js* ]]; then
    echo migrate >> "$TRACE"; [[ "$MODE" != migration-failure ]] || exit 1
  fi; exit 0
fi
if [[ "$1" == compose ]]; then
  echo "compose $APP_IMAGE" >> "$TRACE"
  printf '%s' "$APP_IMAGE" > "$STATE"
fi`);
  executable('curl', `
if [[ "$*" == *deployment/drain* ]]; then
  echo drain >> "$TRACE"; echo '{"activeVoiceSessions":0}'
elif [[ "$*" == *deployment/resume* ]]; then echo resume >> "$TRACE"
elif [[ "$MODE" == health-failure && -f "$STATE" && $(cat "$STATE") == *'${sha}'* ]]; then exit 22
fi`);
  return { root, bin, site, mode, close: () => rmSync(root, { recursive: true, force: true }) };
}
function run(f, stage = 'stage', image = `ghcr.io/test/app:stage-sha-${sha}-1-1`) {
  return spawnSync('bash', ['infra/deploy/deploy.sh', stage, image, id], {
    encoding: 'utf8', env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, CEO_DEPLOY_ROOT: f.root,
      TRACE: join(f.root, 'trace'), STATE: join(f.root, 'state'), MODE: f.mode },
  });
}

test('deployment backs up, drains, migrates and atomically records a healthy image', () => {
  const f = fixture();
  try {
    const result = run(f); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), `ghcr.io/test/app:stage-sha-${sha}-1-1`);
    assert.match(readFileSync(join(f.root, 'trace'), 'utf8'), /drain\nmigrate\ncompose/);
    assert.equal(existsSync(join(f.site, 'backups')), true);
  } finally { f.close(); }
});

for (const mode of ['migration-failure', 'health-failure']) test(`${mode} preserves the previous image and resumes voice admission`, () => {
  const f = fixture(mode);
  try {
    assert.notEqual(run(f).status, 0);
    assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), `ghcr.io/test/app:stage-sha-${old}-1-1`);
    const trace = readFileSync(join(f.root, 'trace'), 'utf8');
    assert.match(trace, /resume/);
    if (mode === 'health-failure') assert.match(trace, new RegExp(`compose ghcr.io/test/app:stage-sha-${old}-1-1`));
    else assert.doesNotMatch(trace, /compose/);
  } finally { f.close(); }
});

test('invalid environments and mutable image tags fail before server operations', () => {
  const f = fixture();
  try {
    assert.notEqual(run(f, '../prod').status, 0);
    assert.notEqual(run(f, 'stage', 'ghcr.io/test/app:latest').status, 0);
    assert.equal(existsSync(join(f.root, 'trace')), false);
  } finally { f.close(); }
});

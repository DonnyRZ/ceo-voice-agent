import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readlinkSync, symlinkSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
const sha = 'a'.repeat(40), old = 'b'.repeat(40), id = `sha256:${'c'.repeat(64)}`;
const release = `ghcr.io/test/app:stage-sha-${sha}-1-1`;
const previous = `ghcr.io/test/app:stage-sha-${old}-1-1`;
function fixture(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'ceo-release-test-'));
  const bin = join(root, 'bin'), site = join(root, 'stage');
  mkdirSync(bin); mkdirSync(site); mkdirSync(join(site, 'gateway')); mkdirSync(join(site, 'shared'));
  writeFileSync(join(site, 'shared/api.env'), `DEPLOY_CONTROL_TOKEN=${'d'.repeat(64)}\n`, { mode: 0o600 });
  writeFileSync(join(site, 'shared/migrate.env'), 'DATABASE_ADMIN_URL=test\n', { mode: 0o600 });
  writeFileSync(join(site, 'shared/compose.env'), 'GATEWAY_PORT=4311\nBLUE_PORT=4321\nGREEN_PORT=4331\n', { mode: 0o600 });
  writeFileSync(join(site, 'active-image'), previous + '\n');
  writeFileSync(join(site, 'active-slot'), 'blue\n');
  writeFileSync(join(site, 'active-commit'), old + '\n');
  symlinkSync('routes/blue', join(site, 'gateway/current'));
  writeFileSync(join(site, 'gateway/blue.live'), '');
  if (mode === 'changed-gateway') writeFileSync(join(site, 'gateway/active.Caddyfile'), 'must-not-reload');
  function executable(name, body) { writeFileSync(join(bin, name), `#!/bin/bash\nset -eu\n${body}\n`, { mode: 0o700 }); }
  executable('sleep', ':');
  executable('python3', `
if [[ "$1" == */public-smoke.py ]]; then
  echo public-check >> "$TRACE"; [[ "$MODE" != public-failure ]]
else exec /usr/bin/python3 "$@"; fi`);
  executable('mv', `
if [[ "$*" == *gateway/current.next* ]]; then
  echo switch >> "$TRACE"
  if [[ "$MODE" == switch-failure && ! -f "$ROOT/switched" ]]; then touch "$ROOT/switched"; exit 1; fi
  [[ "$MODE" != metadata-failure ]] || chmod 400 "$ROOT/stage/active-slot"
fi
exec /bin/mv "$@"`);
  executable('docker', `
if [[ "$1" == image && "$2" == inspect ]]; then
  [[ "$*" == *Config.Labels* ]] && echo '${sha}' || echo '${id}'; exit 0
fi
if [[ "$1" == ps || "$1" == image || "$1" == pull ]]; then exit 0; fi
if [[ "$1" == inspect ]]; then exit 0; fi
if [[ "$1" == run ]]; then
  if [[ "$*" == *'caddy validate'* ]]; then
    echo validate >> "$TRACE"
    [[ "$MODE" != config-failure || -f "$ROOT/validated" ]] || { touch "$ROOT/validated"; exit 1; }
  elif [[ "$*" == *'ops/database.mjs pg-env'* ]]; then printf 'PGVERSION=17\nPGDATABASE=ceo_voice_agent_stage\n'
  elif [[ "$*" == *pg_dump* ]]; then echo backup >> "$TRACE"; echo fixture-backup
  elif [[ "$*" == *db/migrate.js* ]]; then
    echo migrate >> "$TRACE"; [[ "$MODE" != migration-failure ]] || exit 1
  fi; exit 0
fi
if [[ "$1" == compose ]]; then
  echo "compose $*" >> "$TRACE"
  if [[ "$*" == *'up -d'* ]]; then touch "$ROOT/candidate"; fi
  if [[ "$*" == *' cp '* ]]; then dest="\${!#}"; echo bundle > "$dest/bundle.js"; fi
fi`);
  executable('curl', `
if [[ "$*" == *'4331'* && ! -f "$ROOT/candidate" && "$MODE" != busy-slot ]]; then exit 7; fi
if [[ "$*" == *deployment/drain* ]]; then
  echo "drain $*" >> "$TRACE"
  [[ "$MODE" != drain-failure ]] || exit 22
  [[ "$MODE" != busy-slot ]] || { echo '{"activeVoiceSessions":1}'; exit 0; }
  if [[ "$MODE" == active-voice && ! -f "$ROOT/drained" ]]; then
    touch "$ROOT/drained"; echo '{"activeVoiceSessions":1}'
  else echo '{"activeVoiceSessions":0}'; fi
elif [[ "$*" == *'4331/api/health'* && "$MODE" == health-failure ]]; then exit 22
elif [[ "$*" == *'4311/api/health'* && "$MODE" == gateway-health-failure && $(readlink "$ROOT/stage/gateway/current") == routes/green ]]; then exit 22
elif [[ "$*" != *'/api/health'* ]]; then echo '<!doctype html>'
fi`);
  return { root, bin, site, mode, close: () => rmSync(root, { recursive: true, force: true }) };
}
function run(f, stage = 'stage', image = release, extra = {}) {
  return spawnSync('bash', ['infra/deploy/deploy.sh', stage, image, id], { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, CEO_DEPLOY_ROOT: f.root,
      ROOT: f.root, TRACE: join(f.root, 'trace'), MODE: f.mode, ...extra } });
}
const traceOf = (f) => readFileSync(join(f.root, 'trace'), 'utf8');
for (const mode of ['success', 'active-voice']) test(`${mode}: prepare candidate before switching, drain old after switching`, () => {
  const f = fixture(mode);
  try {
    const result = run(f); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), release);
    assert.equal(readFileSync(join(f.site, 'rollback-image'), 'utf8').trim(), previous);
    assert.equal(readFileSync(join(f.site, 'active-slot'), 'utf8').trim(), 'green');
    const trace = traceOf(f);
    assert.match(trace, /validate\nbackup\nmigrate\ncompose.*ceo-stage-green.*up -d[^]*switch\ndrain/);
    assert.match(trace, /ceo-stage-blue.*rm -f app/);
    assert.doesNotMatch(trace, /ceo-stage-blue.*(?:up|down)/);
    if (mode === 'active-voice') assert.equal(trace.match(/drain /g).length, 2);
  } finally { f.close(); }
});
for (const mode of ['migration-failure', 'health-failure', 'config-failure', 'switch-failure', 'gateway-health-failure', 'metadata-failure', 'changed-gateway']) {
  test(`${mode}: previous slot is never stopped or recreated`, () => {
    const f = fixture(mode);
    try {
      assert.notEqual(run(f).status, 0);
      assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), previous);
      assert.equal(readFileSync(join(f.site, 'active-commit'), 'utf8').trim(), old);
      assert.equal(readFileSync(join(f.site, 'active-slot'), 'utf8').trim(), 'blue');
      const trace = traceOf(f);
      assert.doesNotMatch(trace, /ceo-stage-blue/);
      assert.doesNotMatch(trace, /drain .*4321/);
      if (mode.includes('failure') && !['migration-failure', 'health-failure'].includes(mode)) {
        assert.equal(readlinkSync(join(f.site, 'gateway/current')), 'routes/blue');
      }
    } finally { f.close(); }
  });
}
test('drain failure retains healthy new traffic and the old session process', () => {
  const f = fixture('drain-failure');
  try {
    const result = run(f); assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), release);
    assert.doesNotMatch(traceOf(f), /ceo-stage-blue.*rm/);
    assert.match(result.stderr, /slot lama dipertahankan/);
  } finally { f.close(); }
});
test('busy inactive slot cannot be overwritten', () => {
  const f = fixture('busy-slot');
  try {
    assert.notEqual(run(f).status, 0);
    assert.doesNotMatch(traceOf(f), /migrate|compose|switch/);
    assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), previous);
  } finally { f.close(); }
});
test('invalid environment or mutable tag is rejected without server mutations', () => {
  const f = fixture();
  try {
    assert.notEqual(run(f, '../prod').status, 0);
    assert.notEqual(run(f, 'stage', 'ghcr.io/test/app:latest').status, 0);
    assert.equal(existsSync(join(f.root, 'trace')), false);
  } finally { f.close(); }
});
test('publisher lock stays held through the real deployment script without deadlock', () => {
  const f = fixture();
  try {
    const result = spawnSync('/bin/bash', ['-c',
      'exec 8>"$ROOT/stage/deploy.lock"; flock -n 8; export CEO_DEPLOY_LOCK_HELD=true; exec bash infra/deploy/deploy.sh "$@"',
      'fixture', 'stage', release, id], { encoding: 'utf8', timeout: 10_000,
      env: { ...process.env, PATH: `${f.bin}:${process.env.PATH}`, CEO_DEPLOY_ROOT: f.root,
        ROOT: f.root, TRACE: join(f.root, 'trace'), MODE: f.mode } });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(f.site, 'active-slot'), 'utf8').trim(), 'green');
  } finally { f.close(); }
});
test('claiming a publisher lock without the correct descriptor is rejected before changing the app', () => {
  const f = fixture();
  try {
    const result = spawnSync('/bin/bash', ['infra/deploy/deploy.sh', 'stage', release, id], {
      encoding: 'utf8', env: { ...process.env, CEO_DEPLOY_ROOT: f.root, CEO_DEPLOY_LOCK_HELD: 'true' },
    });
    assert.notEqual(result.status, 0);
    assert.equal(existsSync(join(f.root, 'trace')), false);
    assert.equal(readFileSync(join(f.site, 'active-slot'), 'utf8').trim(), 'blue');
  } finally { f.close(); }
});
test('public body/asset failure restores the old route before draining its process', () => {
  const f = fixture('public-failure');
  try {
    const result = run(f, 'stage', release, { PUBLIC_APP_URL: 'https://stage.example.test' });
    assert.notEqual(result.status, 0);
    assert.match(traceOf(f), /public-check/);
    assert.doesNotMatch(traceOf(f), /ceo-stage-blue.*(?:stop|rm)/);
    assert.doesNotMatch(traceOf(f), /drain .*4321/);
    assert.equal(readlinkSync(join(f.site, 'gateway/current')), 'routes/blue');
    assert.equal(readFileSync(join(f.site, 'active-image'), 'utf8').trim(), previous);
  } finally { f.close(); }
});

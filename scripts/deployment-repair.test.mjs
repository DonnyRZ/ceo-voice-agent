import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const python = spawnSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).stdout.trim();
assert.match(python, /^\/[a-zA-Z0-9/_.-]+$/);
for (const mode of ['success', 'busy', 'unknown-config', 'validation-error', 'public-error']) {
  test(`planned stage gateway repair ${mode} preserves config and voice admission on failure`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ceo-gateway-repair-'));
    const site = join(root, 'stage'), gateway = join(site, 'gateway'), bin = join(root, 'bin');
    for (const directory of [gateway, bin, join(site, 'shared')]) mkdirSync(directory, { recursive: true });
    const secret = 'd'.repeat(64);
    try {
      for (const [file, value] of Object.entries({ 'api.env': `DEPLOY_CONTROL_TOKEN=${secret}\n`,
        'migrate.env': 'DATABASE_ADMIN_URL=fixture\n', 'compose.env': 'GATEWAY_PORT=4311\nBLUE_PORT=4321\nGREEN_PORT=4331\n' })) {
        writeFileSync(join(site, 'shared', file), value, { mode: 0o600 });
      }
      writeFileSync(join(site, 'active-slot'), 'blue\n');
      const active = join(gateway, 'active.Caddyfile');
      const generated = spawnSync('/bin/bash', ['-c', 'source infra/deploy/gateway.sh; write_gateway "$OUT"'], {
        env: { ...process.env, GATEWAY_PORT: '4311', BLUE_PORT: '4321', GREEN_PORT: '4331', OUT: active }, encoding: 'utf8',
      });
      assert.equal(generated.status, 0, generated.stderr);
      const legacy = readFileSync(active, 'utf8').replace('http://:4311 {', 'http://127.0.0.1:4311 {')
        + (mode === 'unknown-config' ? '# operator customization\n' : '');
      writeFileSync(active, legacy);
      const executable = (name, body) => writeFileSync(join(bin, name), '#!/bin/bash\nset -eu\n' + body, { mode: 0o700 });
      executable('docker', `echo "docker $*" >> "$ROOT/trace"
if [[ "$1" == inspect ]]; then echo ceo-stage-gateway
elif [[ "$1" == exec && "$MODE" == validation-error ]]; then exit 1; fi\n`);
      executable('curl', `echo "curl $*" >> "$ROOT/trace"
if [[ "$*" == *deployment/drain* ]]; then
 [[ "$MODE" != busy ]] && echo '{"activeVoiceSessions":0}' || echo '{"activeVoiceSessions":1}'
elif [[ "$*" != *deployment/resume* ]]; then echo '{"status":"ok"}'; fi\n`);
      executable('python3', `if [[ "$1" == */public-smoke.py ]]; then [[ "$MODE" != public-error ]]; else exec ${python} "$@"; fi\n`);
      const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, ROOT: root,
        CEO_DEPLOY_ROOT: root, PUBLIC_APP_URL: 'https://stage.example.test', MODE: mode };
      const run = () => spawnSync('/bin/bash', ['infra/deploy/repair-stage-gateway.sh'], { encoding: 'utf8', timeout: 5000, env });
      const result = run();
      assert.equal(result.status, mode === 'success' ? 0 : mode === 'busy' ? 75 : 1, result.stderr);
      let trace = readFileSync(join(root, 'trace'), 'utf8');
      assert.match(trace, /deployment\/resume/);
      assert.doesNotMatch(trace + result.stdout + result.stderr, new RegExp(secret));
      if (mode === 'success') {
        assert.match(readFileSync(active, 'utf8'), /http:\/\/:4311/);
        assert.equal((trace.match(/docker restart/g) || []).length, 1);
        assert.equal(run().status, 0);
        trace = readFileSync(join(root, 'trace'), 'utf8');
        assert.equal((trace.match(/docker restart/g) || []).length, 1, 'idempotent repair must not restart again');
      } else {
        assert.equal(readFileSync(active, 'utf8'), legacy);
        assert.equal((trace.match(/docker restart/g) || []).length, mode === 'public-error' ? 2 : 0);
      }
      assert.doesNotMatch(trace, /ceo-prod|postgres|nginx|prune/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

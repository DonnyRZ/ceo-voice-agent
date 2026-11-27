import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

for (const scenario of ['stage', 'prod', 'missing', 'public', 'duplicate', 'collision', 'overflow', 'shell', 'reserved']) {
  test(`shared config ${scenario}: validate private files and parse ports without executing shell`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ceo-shared-'));
    const shared = join(root, 'shared');
    mkdirSync(shared);
    try {
      writeFileSync(join(shared, 'api.env'), 'BETTER_AUTH_SECRET=fixture-secret\n', { mode: 0o600 });
      if (scenario !== 'missing') writeFileSync(join(shared, 'migrate.env'), 'DATABASE_ADMIN_URL=fixture\n', { mode: 0o600 });
      let ports = scenario === 'prod' ? 'GATEWAY_PORT=4312\nBLUE_PORT=4322\nGREEN_PORT=4332\n'
        : 'GATEWAY_PORT=4311\nBLUE_PORT=4321\nGREEN_PORT=4331\n';
      if (scenario === 'duplicate') ports += 'BLUE_PORT=4391\n';
      if (scenario === 'collision') ports = ports.replace('GREEN_PORT=4331', 'GREEN_PORT=4321');
      if (scenario === 'overflow') ports = ports.replace('GREEN_PORT=4331', 'GREEN_PORT=99999');
      if (scenario === 'shell') ports += 'EXTRA=$(touch "$ROOT/executed")\n';
      if (scenario === 'reserved') ports += 'COMPOSE_FILE=/tmp/untrusted.yml\n';
      writeFileSync(join(shared, 'compose.env'), ports, { mode: 0o600 });
      if (scenario === 'public') chmodSync(join(shared, 'api.env'), 0o644);
      const result = spawnSync('/bin/bash', ['-euc',
        'site="$ROOT"; source infra/deploy/config.sh; printf "%s|%s|%s|%s" "$RUNTIME_ENV_FILE" "$GATEWAY_PORT" "$BLUE_PORT" "$GREEN_PORT"'],
      { encoding: 'utf8', env: { ...process.env, ROOT: root } });
      const valid = ['stage', 'prod'].includes(scenario);
      assert.equal(result.status, valid ? 0 : 78, result.stderr);
      if (valid) assert.equal(result.stdout, `${shared}/api.env|${scenario === 'prod' ? '4312|4322|4332' : '4311|4321|4331'}`);
      assert.doesNotMatch(result.stdout + result.stderr, /fixture-secret|DATABASE_ADMIN_URL=fixture/);
      assert.equal(existsSync(join(root, 'executed')), false);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

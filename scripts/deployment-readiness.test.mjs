import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

for (const mode of ['stage', 'prod', 'cross-connect', 'superuser', 'owner-member', 'wrong-owner',
  'missing-extension', 'wrong-role', 'other-host', 'duplicate-key', 'psql-error']) {
  test(`read-only VPS database readiness ${mode} never leaks private credentials`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ceo-readiness-'));
    const stage = mode === 'prod' ? 'prod' : 'stage';
    mkdirSync(join(root, 'shared')); mkdirSync(join(root, 'bin'));
    try {
      const appPassword = randomBytes(24).toString('hex'), ownerPassword = randomBytes(24).toString('hex');
      const app = `postgresql://ceo_${stage}_app:${appPassword}@127.0.0.1:5432/ceo_voice_agent_${stage}`;
      const owner = `postgresql://ceo_${stage}_owner:${ownerPassword}@127.0.0.1:5432/ceo_voice_agent_${stage}`;
      let runtime = `DATABASE_URL=${mode === 'wrong-role' ? app.replace('_app:', '_owner:') : app}\n`;
      if (mode === 'duplicate-key') runtime += `DATABASE_URL=${app}\n`;
      writeFileSync(join(root, 'shared/api.env'), runtime);
      writeFileSync(join(root, 'shared/migrate.env'), `DATABASE_ADMIN_URL="${mode === 'other-host' ? owner.replace('127.0.0.1', '127.0.0.2') : owner}"\n`);
      writeFileSync(join(root, 'bin/psql'), `#!/usr/bin/env python3
import json,os,sys
from pathlib import Path
mode=os.environ['MODE']; app=os.environ['PGUSER'].endswith('_app')
assert 'default_transaction_read_only=on' in os.environ['PGOPTIONS']
assert 'statement_timeout=5000' in os.environ['PGOPTIONS']
assert 'PGPASSWORD' not in os.environ
passfile=Path(os.environ['PGPASSFILE'])
assert passfile.stat().st_mode & 0o777 == 0o600
assert os.environ['TEST_APP_PASSWORD' if app else 'TEST_OWNER_PASSWORD'] in passfile.read_text()
Path(os.environ['TEST_ROOT'],'passfile-path').write_text(str(passfile))
assert not any(os.environ['TEST_APP_PASSWORD'] in argument or os.environ['TEST_OWNER_PASSWORD'] in argument for argument in sys.argv)
assert sys.argv[-1].lstrip().startswith('SELECT ')
if mode == 'psql-error':
    print(os.environ['TEST_APP_PASSWORD'],os.environ['TEST_OWNER_PASSWORD'],file=sys.stderr); sys.exit(2)
print(json.dumps(dict(database=os.environ['PGDATABASE'],role=os.environ['PGUSER'],version='16.16',
  extensions=1 if mode=='missing-extension' else 2,safe_role=mode!='superuser',
  owns_database=app if mode=='wrong-owner' else not app,cross_connect=mode=='cross-connect',
  member_of_owner=not app or mode=='owner-member')))
`, { mode: 0o700 });
      const result = spawnSync('python3', ['infra/deploy/readiness-db.py', root, stage], {
        encoding: 'utf8', timeout: 5000, env: { ...process.env, MODE: mode, PATH: `${root}/bin:${process.env.PATH}`,
          TEST_APP_PASSWORD: appPassword, TEST_OWNER_PASSWORD: ownerPassword, TEST_ROOT: root },
      });
      assert.equal(result.status, ['stage', 'prod'].includes(mode) ? 0 : 1, result.stderr);
      assert.equal((result.stdout + result.stderr).includes(appPassword), false);
      assert.equal((result.stdout + result.stderr).includes(ownerPassword), false);
      assert.doesNotMatch(result.stdout + result.stderr, /postgresql:\/\//);
      if (existsSync(join(root, 'passfile-path'))) {
        assert.equal(existsSync(readFileSync(join(root, 'passfile-path'), 'utf8')), false);
      }
      if (result.status === 0) {
        const records = result.stdout.trim().split('\n').map(JSON.parse);
        assert.deepEqual(records.map((x) => x.role), [`ceo_${stage}_app`, `ceo_${stage}_owner`]);
      }
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

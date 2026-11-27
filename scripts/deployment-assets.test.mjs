import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

for (const mode of ['normal', 'missing-manifest', 'invalid-path']) {
  test(`asset retention ${mode} preserves protected releases and rejects unsafe cleanup`, () => {
    const root = mkdtempSync(join(tmpdir(), 'ceo-assets-test-'));
    const assets = join(root, 'gateway/static/assets'), manifests = join(root, 'gateway/manifests');
    const current = 'a'.repeat(40), previous = 'b'.repeat(40), obsolete = 'c'.repeat(40);
    try {
      mkdirSync(assets, { recursive: true }); mkdirSync(manifests, { recursive: true });
      writeFileSync(join(root, 'active-commit'), current); writeFileSync(join(root, 'rollback-commit'), previous);
      writeFileSync(join(manifests, current), mode === 'invalid-path' ? '../outside' : 'new.js\nshared.css\n');
      if (mode !== 'missing-manifest') writeFileSync(join(manifests, previous), 'old.js\nshared.css\n');
      writeFileSync(join(manifests, obsolete), 'stale.js\n');
      for (const name of ['new.js', 'old.js', 'shared.css', 'stale.js']) writeFileSync(join(assets, name), name);
      writeFileSync(join(root, 'outside'), 'keep');
      const result = spawnSync('python3', ['infra/deploy/assets-cleanup.py', root]);
      assert.equal(result.status, mode === 'invalid-path' ? 1 : 0);
      for (const name of ['new.js', 'old.js', 'shared.css']) assert.equal(existsSync(join(assets, name)), true);
      assert.equal(existsSync(join(root, 'outside')), true);
      assert.equal(existsSync(join(assets, 'stale.js')), mode !== 'normal');
      assert.equal(existsSync(join(manifests, obsolete)), mode !== 'normal');
    } finally { rmSync(root, { recursive: true, force: true }); }
  });
}

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

for (const firstRelease of [false, true]) test(`cleanup protects used images, including failed first release=${firstRelease}`, () => {
  const root = mkdtempSync(join(tmpdir(), 'ceo-image-retention-'));
  const repository = 'ghcr.io/test/app';
  const image = (letter, env = 'stage') => `${repository}:${env}-sha-${letter.repeat(40)}-1-1`;
  const active = image('a'), rollback = image('b'), used = image('c'), obsolete = image('d'), foreignLabel = image('e');
  try {
    mkdirSync(join(root, 'stage')); mkdirSync(join(root, 'bin'));
    if (!firstRelease) {
      writeFileSync(join(root, 'stage/active-image'), active);
      writeFileSync(join(root, 'stage/rollback-image'), rollback);
    }
    writeFileSync(join(root, 'images'), [active, rollback, used, obsolete, foreignLabel,
      image('f', 'prod'), 'ghcr.io/other/app:stage-sha-' + 'a'.repeat(40) + '-1-1', repository + ':latest'].join('\n') + '\n');
    writeFileSync(join(root, 'bin/docker'), `#!/bin/bash
set -eu
if [[ "$1" == ps ]]; then echo running-container
elif [[ "$1" == inspect ]]; then echo sha256:used
elif [[ "$1" == image && "$2" == ls ]]; then cat "$ROOT/images"
elif [[ "$1" == image && "$2" == inspect ]]; then
  if [[ "$*" == *Config.Labels* ]]; then
    [[ "$3" != '${foreignLabel}' ]] && echo https://github.com/Test/App || echo https://github.com/other/app
  elif [[ "$3" == '${used}' ]]; then echo sha256:used
  else echo sha256:unused; fi
elif [[ "$1" == image && "$2" == rm ]]; then echo "$3" >> "$ROOT/removed"
else echo "UNSAFE $*" >> "$ROOT/unsafe"; exit 1
fi
`, { mode: 0o700 });
    const result = spawnSync('bash', ['infra/deploy/cleanup.sh', 'stage', repository], {
      encoding: 'utf8', env: { ...process.env, PATH: `${root}/bin:${process.env.PATH}`, CEO_DEPLOY_ROOT: root, ROOT: root },
    });
    assert.equal(result.status, 0, result.stderr);
    const removed = readFileSync(join(root, 'removed'), 'utf8').trim().split('\n').sort();
    assert.deepEqual(removed, (firstRelease ? [active, rollback, obsolete] : [obsolete]).sort());
    assert.equal(existsSync(join(root, 'unsafe')), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { screens } from './catalog.ts';

test('setiap rute React Router memiliki layar desktop/mobile pada katalog audit', () => {
  const source = readFileSync('frontend/src/app/routes.tsx', 'utf8');
  const patterns = [];
  let prefix = '';
  // The route file declares the three role trees in separate RequireSession groups.
  // Read their literal paths without executing application or lazy-import code.
  for (const line of source.split('\n')) {
    const role = line.match(/RequireSession role="([^"]+)"/);
    if (role) prefix = { ceo: '/ceo', superadmin: '/admin', member: '' }[role[1]];
    if (/index:\s*true/.test(line)) patterns.push(prefix || '/');
    for (const [, segment] of line.matchAll(/\bpath:\s*'([^']+)'/g)) {
      if (['ceo', 'admin'].includes(segment)) continue; // Parent containers have an index route.
      patterns.push(segment.startsWith('/') ? segment : `${prefix}/${segment}`);
    }
  }
  for (const pattern of patterns) {
    const expression = new RegExp(`^${pattern.replace(/:[^/]+/g, '[^/]+').replaceAll('*', '.*')}$`);
    assert.ok(screens.some(({ path }) => expression.test(path.split('#')[0])), `Rute belum diaudit: ${pattern}`);
  }
  assert.equal(patterns.length, 38, 'Perubahan rute perlu diperiksa dan dicatat pada laporan cakupan.');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { branchAllowed, mergedRelease } from './branch-policy.mjs';
const repo = 'DonnyRZ/ceo-voice-agent';

test('only standard topic branches enter develop, and only same-repo develop enters main', () => {
  for (const prefix of ['feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'chore', 'build', 'ci', 'security']) {
    assert.equal(branchAllowed('develop', `${prefix}/valid-name`, repo, repo), true);
    assert.equal(branchAllowed('main', `${prefix}/valid-name`, repo, repo), false);
  }
  for (const head of ['main', 'develop', 'random', 'fix/BadName', 'fix/a/b', 'fix/-a', 'fix/a_']) {
    assert.equal(branchAllowed('develop', head, repo, repo), false);
  }
  assert.equal(branchAllowed('main', 'develop', repo, repo), true);
  assert.equal(branchAllowed('main', 'develop', 'someone/fork', repo), false);
});
test('direct push, unmerged PR, wrong target and stale merge commit cannot release', () => {
  const pr = { merged_at: 'now', merge_commit_sha: 'sha', base: { ref: 'develop' }, head: { ref: 'fix/change', repo: { full_name: repo } } };
  assert.equal(mergedRelease([pr], 'develop', 'sha', repo), true);
  assert.equal(mergedRelease([], 'develop', 'sha', repo), false);
  assert.equal(mergedRelease([{ ...pr, merged_at: null }], 'develop', 'sha', repo), false);
  assert.equal(mergedRelease([pr], 'main', 'sha', repo), false);
  assert.equal(mergedRelease([pr], 'develop', 'old-sha', repo), false);
  assert.equal(mergedRelease([{ ...pr, head: { ref: 'main' } }], 'develop', 'sha', repo), false);
});

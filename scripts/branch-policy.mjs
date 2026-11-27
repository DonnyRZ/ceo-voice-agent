import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export function branchAllowed(base, head, headRepository, repository) {
  if (base === 'main') return head === 'develop' && headRepository === repository;
  if (base !== 'develop') return false;
  return /^(feat|fix|refactor|perf|test|docs|chore|build|ci|security)\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(head)
    && head.length <= 100;
}
export function mergedRelease(pulls, base, sha, repository) {
  return pulls.some((pr) => pr.merged_at && pr.merge_commit_sha === sha && pr.base.ref === base
    && branchAllowed(base, pr.head.ref, pr.head.repo?.full_name, repository));
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  const data = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  const repo = process.env.GITHUB_REPOSITORY;
  let allowed = false;
  if (mode === 'pull-request') {
    const pr = data.pull_request;
    allowed = Boolean(pr && branchAllowed(pr.base.ref, pr.head.ref, pr.head.repo?.full_name, repo));
  } else if (mode === 'release') {
    allowed = mergedRelease(data, process.env.BRANCH, process.env.SHA, repo);
  }
  if (!allowed) {
    console.error('Alur wajib: feat|fix|refactor|perf|test|docs|chore|build|ci|security/nama → develop → main melalui PR yang di-merge.');
    process.exitCode = 1;
  }
}

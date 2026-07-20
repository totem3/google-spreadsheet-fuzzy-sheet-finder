import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readText = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = (path) => JSON.parse(readText(path));

test('keeps package and extension versions synchronized', () => {
  assert.equal(readJson('manifest.json').version, readJson('package.json').version);
});

test('configures a root Node release and tracks its current version', () => {
  const config = readJson('release-please-config.json');
  const manifest = readJson('.release-please-manifest.json');
  const root = config.packages['.'];

  assert.equal(config['bootstrap-sha'], '2766262d566dc05a03473a3bcecdd67dffbd36e6');
  assert.equal(manifest['.'], readJson('package.json').version);
  assert.equal(root['release-type'], 'node');
  assert.equal(root['include-component-in-tag'], false);
  assert.equal(root['include-v-in-tag'], true);
  assert.deepEqual(root['extra-files'], [{
    type: 'json',
    path: 'manifest.json',
    jsonpath: '$.version',
  }]);
});

test('uses a pinned Release Please action only for main pushes', () => {
  const workflow = readText('.github/workflows/release-please.yml');

  assert.match(workflow, /^  push:\n    branches:\n      - main$/m);
  assert.match(
    workflow,
    /^\s+uses:\s+googleapis\/release-please-action@[a-f0-9]{40} # v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/m,
  );
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /token: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /pull_request_target/);
});

test('validates ordinary pull request titles without privileged triggers', () => {
  const workflow = readText('.github/workflows/semantic-pull-request.yml');

  assert.match(workflow, /^  pull_request:\n    types: \[opened, reopened, edited, synchronize\]$/m);
  assert.doesNotMatch(workflow, /pull_request_target/);
  assert.match(workflow, /pull-requests: read/);
  assert.doesNotMatch(workflow, /actions\/checkout/);
  assert.match(
    workflow,
    /^\s+uses:\s+amannn\/action-semantic-pull-request@[a-f0-9]{40} # v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)$/m,
  );
  assert.match(workflow, /GITHUB_TOKEN: \$\{\{ github\.token \}\}/);

  for (const type of [
    'feat', 'fix', 'deps', 'docs', 'refactor',
    'test', 'chore', 'ci', 'build', 'revert',
  ]) {
    assert.match(workflow, new RegExp(`^            ${type}$`, 'm'));
  }

  assert.match(workflow, /subjectPattern: '\^\[a-z\]\.\+\$'/);
});

test('checks GitHub Actions dependencies weekly', () => {
  const dependabot = readText('.github/dependabot.yml');

  assert.match(dependabot, /package-ecosystem: github-actions/);
  assert.match(dependabot, /interval: weekly/);
  assert.match(dependabot, /prefix: chore/);
  assert.match(dependabot, /include: scope/);
});

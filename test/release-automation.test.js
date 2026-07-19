import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const readText = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const readJson = (path) => JSON.parse(readText(path));

test('keeps package and extension versions synchronized', () => {
  assert.equal(readJson('manifest.json').version, readJson('package.json').version);
});

test('bootstraps a root Node release at 0.1.0', () => {
  const config = readJson('release-please-config.json');
  const manifest = readJson('.release-please-manifest.json');
  const root = config.packages['.'];

  assert.equal(config['bootstrap-sha'], '2766262d566dc05a03473a3bcecdd67dffbd36e6');
  assert.equal(manifest['.'], '0.1.0');
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
  assert.match(workflow, /googleapis\/release-please-action@45996ed1f6d02564a971a2fa1b5860e934307cf7 # v5\.0\.0/);
  assert.match(workflow, /contents: write/);
  assert.match(workflow, /issues: write/);
  assert.match(workflow, /pull-requests: write/);
  assert.match(workflow, /token: \$\{\{ github\.token \}\}/);
  assert.doesNotMatch(workflow, /pull_request_target/);
});

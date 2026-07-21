import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const projectRoot = path.resolve(import.meta.dirname, '..');
const buildScript = path.join(projectRoot, 'scripts', 'build-extension.js');

function runBuild(sourceRoot, outputRoot) {
  return spawnSync(process.execPath, [buildScript, sourceRoot, outputRoot], {
    cwd: projectRoot,
    encoding: 'utf8',
  });
}

function getManifestResources(manifest) {
  return [
    manifest.background.service_worker,
    ...manifest.content_scripts.flatMap((contentScript) => [
      ...contentScript.js,
      ...(contentScript.css || []),
    ]),
    ...manifest.web_accessible_resources.flatMap(({ resources }) => resources),
  ];
}

function createBuildManifest(overrides = {}) {
  return {
    background: { service_worker: 'src/service-worker.js' },
    content_scripts: [],
    web_accessible_resources: [],
    ...overrides,
  };
}

test('should build an unpacked extension with every manifest resource', (t) => {
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-build-'));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));

  const result = runBuild(projectRoot, outputRoot);

  assert.equal(result.status, 0, result.stderr);
  const sourceManifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'manifest.json'), 'utf8'));
  const builtManifest = JSON.parse(fs.readFileSync(path.join(outputRoot, 'manifest.json'), 'utf8'));
  assert.deepEqual(builtManifest, sourceManifest);
  for (const resource of getManifestResources(builtManifest)) {
    assert.equal(
      fs.readFileSync(path.join(outputRoot, resource), 'utf8'),
      fs.readFileSync(path.join(projectRoot, resource), 'utf8'),
    );
  }
});

test('should reject a manifest resource that does not exist', (t) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-source-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-output-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'src/missing.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing extension resource: src\/missing\.js/);
});

test('should reject a manifest resource outside the project root', (t) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-source-'));
  const outputRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-output-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  t.after(() => fs.rmSync(outputRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: '../outside.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Extension resource escapes project root: \.\.\/outside\.js/);
});

test('should reject using the project root as the output directory', (t) => {
  const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-source-'));
  t.after(() => fs.rmSync(sourceRoot, { recursive: true, force: true }));
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'src/service-worker.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, sourceRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output root must differ from source root/);
  assert.equal(fs.existsSync(path.join(sourceRoot, 'manifest.json')), true);
});

test('should reject an output directory that contains the real source root', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-boundary-'));
  const outputRoot = path.join(fixtureRoot, 'output');
  const sourceRoot = path.join(outputRoot, 'source');
  const sourceLink = path.join(fixtureRoot, 'source-link');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'src/service-worker.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );
  fs.symlinkSync(sourceRoot, sourceLink, 'dir');

  const result = runBuild(sourceLink, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output root must not contain source root/);
  assert.equal(fs.existsSync(path.join(sourceRoot, 'manifest.json')), true);
});

test('should reject a manifest resource whose symlink target is outside the source root', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-symlink-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  const outsideResource = path.join(fixtureRoot, 'outside.js');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(outsideResource, 'sensitive content');
  fs.symlinkSync(outsideResource, path.join(sourceRoot, 'src', 'service-worker.js'));
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'src/service-worker.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Extension resource escapes project root: src\/service-worker\.js/);
  assert.equal(fs.existsSync(path.join(outputRoot, 'src', 'service-worker.js')), false);
});

test('should reject a manifest resource inside the output root before deleting it', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-overlap-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(sourceRoot, 'dist');
  const outputResource = path.join(outputRoot, 'service-worker.js');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(outputRoot, { recursive: true });
  fs.writeFileSync(outputResource, 'source content');
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'dist/service-worker.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Extension resource overlaps output root: dist\/service-worker\.js/);
  assert.equal(fs.readFileSync(outputResource, 'utf8'), 'source content');
});

test('should reject a manifest whose symlink target is outside the source root', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-manifest-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  const outsideManifest = path.join(fixtureRoot, 'manifest.json');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(
    outsideManifest,
    JSON.stringify({
      background: { service_worker: 'src/service-worker.js' },
      content_scripts: [],
      web_accessible_resources: [],
    }),
  );
  fs.symlinkSync(outsideManifest, path.join(sourceRoot, 'manifest.json'));

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Extension manifest escapes project root/);
  assert.equal(fs.existsSync(path.join(outputRoot, 'manifest.json')), false);
});

test('should copy a content script stylesheet that is not web accessible', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-css-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'content.js'), 'export {};');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'content.css'), '.content {}');
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'src/service-worker.js' },
      content_scripts: [{ js: ['src/content.js'], css: ['src/content.css'] }],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, outputRoot);

  assert.equal(result.status, 0, result.stderr);
  assert.equal(fs.readFileSync(path.join(outputRoot, 'src', 'content.css'), 'utf8'), '.content {}');
});

test('should reject a content script stylesheet that does not exist', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-css-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(path.join(sourceRoot, 'src', 'content.js'), 'export {};');
  fs.writeFileSync(
    path.join(sourceRoot, 'manifest.json'),
    JSON.stringify({
      background: { service_worker: 'src/service-worker.js' },
      content_scripts: [{ js: ['src/content.js'], css: ['src/missing.css'] }],
      web_accessible_resources: [],
    }),
  );

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing extension resource: src\/missing\.css/);
});

test('should preserve an existing non-directory output root', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-output-type-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(path.join(sourceRoot, 'manifest.json'), JSON.stringify(createBuildManifest()));
  fs.writeFileSync(outputRoot, 'existing output');

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output root must be a directory/);
  assert.equal(fs.readFileSync(outputRoot, 'utf8'), 'existing output');
});

test('should preserve an existing output symlink', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-output-link-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputTarget = path.join(fixtureRoot, 'output-target');
  const outputRoot = path.join(fixtureRoot, 'output');
  const markerPath = path.join(outputTarget, 'marker.txt');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.mkdirSync(outputTarget);
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(path.join(sourceRoot, 'manifest.json'), JSON.stringify(createBuildManifest()));
  fs.writeFileSync(markerPath, 'existing output');
  fs.symlinkSync(outputTarget, outputRoot, 'dir');

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output root must not be a symbolic link/);
  assert.equal(fs.lstatSync(outputRoot).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), 'existing output');
});

test('should preserve an existing output symlink to a file', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-output-file-link-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputTarget = path.join(fixtureRoot, 'output-target');
  const outputRoot = path.join(fixtureRoot, 'output');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(path.join(sourceRoot, 'src'), { recursive: true });
  fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
  fs.writeFileSync(path.join(sourceRoot, 'manifest.json'), JSON.stringify(createBuildManifest()));
  fs.writeFileSync(outputTarget, 'existing output');
  fs.symlinkSync(outputTarget, outputRoot, 'file');

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Output root must not be a symbolic link/);
  assert.equal(fs.lstatSync(outputRoot).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(outputTarget, 'utf8'), 'existing output');
});

test('should reject invalid manifest inputs without deleting existing output', async (t) => {
  const invalidManifests = [
    ['invalid JSON', '{', /Invalid extension manifest: expected valid JSON/],
    ['null root', 'null', /Invalid extension manifest: root must be an object/],
    ['array root', '[]', /Invalid extension manifest: root must be an object/],
    ['missing background', JSON.stringify(createBuildManifest({ background: undefined })), /Invalid extension manifest: background must be an object/],
    ['null background', JSON.stringify(createBuildManifest({ background: null })), /Invalid extension manifest: background must be an object/],
    ['missing service worker', JSON.stringify(createBuildManifest({ background: {} })), /Invalid extension manifest: background\.service_worker must be a non-empty string/],
    ['empty service worker', JSON.stringify(createBuildManifest({ background: { service_worker: '' } })), /Invalid extension manifest: background\.service_worker must be a non-empty string/],
    ['missing content scripts', JSON.stringify(createBuildManifest({ content_scripts: undefined })), /Invalid extension manifest: content_scripts must be an array/],
    ['invalid content scripts', JSON.stringify(createBuildManifest({ content_scripts: null })), /Invalid extension manifest: content_scripts must be an array/],
    ['invalid content script', JSON.stringify(createBuildManifest({ content_scripts: [null] })), /Invalid extension manifest: content_scripts\[0\] must be an object/],
    ['missing content script JavaScript', JSON.stringify(createBuildManifest({ content_scripts: [{}] })), /Invalid extension manifest: content_scripts\[0\]\.js must be an array/],
    ['invalid JavaScript resource', JSON.stringify(createBuildManifest({ content_scripts: [{ js: [1] }] })), /Invalid extension manifest: content_scripts\[0\]\.js\[0\] must be a non-empty string/],
    ['invalid optional content script CSS', JSON.stringify(createBuildManifest({ content_scripts: [{ js: [], css: {} }] })), /Invalid extension manifest: content_scripts\[0\]\.css must be an array/],
    ['invalid CSS resource', JSON.stringify(createBuildManifest({ content_scripts: [{ js: [], css: [''] }] })), /Invalid extension manifest: content_scripts\[0\]\.css\[0\] must be a non-empty string/],
    ['missing web resources', JSON.stringify(createBuildManifest({ web_accessible_resources: undefined })), /Invalid extension manifest: web_accessible_resources must be an array/],
    ['invalid web resources', JSON.stringify(createBuildManifest({ web_accessible_resources: {} })), /Invalid extension manifest: web_accessible_resources must be an array/],
    ['invalid web resource entry', JSON.stringify(createBuildManifest({ web_accessible_resources: [null] })), /Invalid extension manifest: web_accessible_resources\[0\] must be an object/],
    ['missing resource list', JSON.stringify(createBuildManifest({ web_accessible_resources: [{}] })), /Invalid extension manifest: web_accessible_resources\[0\]\.resources must be an array/],
    ['invalid web resource', JSON.stringify(createBuildManifest({ web_accessible_resources: [{ resources: [false] }] })), /Invalid extension manifest: web_accessible_resources\[0\]\.resources\[0\] must be a non-empty string/],
  ];

  for (const [name, manifestContents, expectedError] of invalidManifests) {
    await t.test(name, () => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-manifest-shape-'));
      const sourceRoot = path.join(fixtureRoot, 'source');
      const outputRoot = path.join(fixtureRoot, 'output');
      const markerPath = path.join(outputRoot, 'marker.txt');
      t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
      fs.mkdirSync(sourceRoot, { recursive: true });
      fs.mkdirSync(outputRoot);
      fs.writeFileSync(path.join(sourceRoot, 'manifest.json'), manifestContents);
      fs.writeFileSync(markerPath, 'existing output');

      const result = runBuild(sourceRoot, outputRoot);

      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, expectedError, name);
      assert.equal(fs.readFileSync(markerPath, 'utf8'), 'existing output', name);
    });
  }
});

test('should reject a missing manifest without deleting existing output', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-missing-manifest-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  const markerPath = path.join(outputRoot, 'marker.txt');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(outputRoot);
  fs.writeFileSync(markerPath, 'existing output');

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing extension manifest/);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), 'existing output');
});

test('should reject a broken manifest symlink without deleting existing output', (t) => {
  const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-manifest-link-'));
  const sourceRoot = path.join(fixtureRoot, 'source');
  const outputRoot = path.join(fixtureRoot, 'output');
  const markerPath = path.join(outputRoot, 'marker.txt');
  t.after(() => fs.rmSync(fixtureRoot, { recursive: true, force: true }));
  fs.mkdirSync(sourceRoot);
  fs.mkdirSync(outputRoot);
  fs.symlinkSync(path.join(fixtureRoot, 'missing-manifest.json'), path.join(sourceRoot, 'manifest.json'));
  fs.writeFileSync(markerPath, 'existing output');

  const result = runBuild(sourceRoot, outputRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Missing extension manifest/);
  assert.equal(fs.readFileSync(markerPath, 'utf8'), 'existing output');
});

test('should preserve existing output when a manifest resource cannot be read', async (t) => {
  const resourceCases = [
    ['background service worker', (resource) => createBuildManifest({
      background: { service_worker: resource },
    })],
    ['content script JavaScript', (resource) => createBuildManifest({
      content_scripts: [{ js: [resource] }],
    })],
    ['content script stylesheet', (resource) => createBuildManifest({
      content_scripts: [{ js: [], css: [resource] }],
    })],
    ['web accessible resource', (resource) => createBuildManifest({
      web_accessible_resources: [{ resources: [resource] }],
    })],
  ];

  for (const [name, createManifest] of resourceCases) {
    await t.test(name, (subtest) => {
      const fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'sheet-finder-resource-permission-'));
      const sourceRoot = path.join(fixtureRoot, 'source');
      const outputRoot = path.join(fixtureRoot, 'output');
      const resource = 'src/restricted.js';
      const resourcePath = path.join(sourceRoot, resource);
      const markerPath = path.join(outputRoot, 'marker.txt');
      subtest.after(() => {
        fs.chmodSync(resourcePath, 0o600);
        fs.rmSync(fixtureRoot, { recursive: true, force: true });
      });
      fs.mkdirSync(path.dirname(resourcePath), { recursive: true });
      fs.mkdirSync(outputRoot);
      fs.writeFileSync(path.join(sourceRoot, 'src', 'service-worker.js'), 'export {};');
      fs.writeFileSync(resourcePath, 'restricted content');
      fs.writeFileSync(path.join(sourceRoot, 'manifest.json'), JSON.stringify(createManifest(resource)));
      fs.writeFileSync(markerPath, 'existing output');
      fs.chmodSync(resourcePath, 0o000);

      const result = runBuild(sourceRoot, outputRoot);

      assert.notEqual(result.status, 0, name);
      assert.match(result.stderr, /EACCES|permission denied/i, name);
      assert.equal(fs.readFileSync(markerPath, 'utf8'), 'existing output', name);
    });
  }
});

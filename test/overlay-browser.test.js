import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

function resolveChromeExecutable() {
  const configuredExecutable = process.env.CHROME_BIN;
  if (configuredExecutable) {
    assert.equal(existsSync(configuredExecutable), true, `CHROME_BIN does not exist: ${configuredExecutable}`);
    return configuredExecutable;
  }

  const headlessShellCacheRoots = {
    darwin: path.join(os.homedir(), 'Library', 'Caches', 'ms-playwright'),
    linux: path.join(os.homedir(), '.cache', 'ms-playwright'),
    win32: path.join(os.homedir(), 'AppData', 'Local', 'ms-playwright'),
  };
  const headlessShellRelativePaths = {
    darwin: [
      'chrome-headless-shell-mac-arm64/chrome-headless-shell',
      'chrome-headless-shell-mac-x64/chrome-headless-shell',
    ],
    linux: ['chrome-headless-shell-linux64/chrome-headless-shell'],
    win32: ['chrome-headless-shell-win64/chrome-headless-shell.exe'],
  };
  const cacheRoot = headlessShellCacheRoots[process.platform];
  const cachedHeadlessShells = cacheRoot && existsSync(cacheRoot)
    ? readdirSync(cacheRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith('chromium_headless_shell-'))
      .sort((left, right) => right.name.localeCompare(left.name, 'en', { numeric: true }))
      .flatMap((entry) => headlessShellRelativePaths[process.platform]
        .map((relativePath) => path.join(cacheRoot, entry.name, relativePath)))
    : [];

  const candidatesByPlatform = {
    darwin: [...cachedHeadlessShells, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
    linux: [...cachedHeadlessShells, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium'],
    win32: [
      ...cachedHeadlessShells,
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    ],
  };
  const candidates = candidatesByPlatform[process.platform];
  assert.ok(candidates, `Chrome browser integration is unsupported on ${process.platform}`);
  const executable = candidates.find((candidate) => existsSync(candidate));
  assert.ok(executable, 'Google Chrome is required; set CHROME_BIN to its executable path');
  return executable;
}

function createBrowserHarnessHtml(projectRoot) {
  const sourceUrl = (relativePath) => pathToFileURL(path.join(projectRoot, relativePath)).href;
  const stylesheetUrl = sourceUrl('src/overlay.css');
  const scripts = [
    'src/search-content.js',
    'src/overlay-state.js',
    'src/overlay.js',
  ].map((relativePath) => `<script src=${JSON.stringify(sourceUrl(relativePath))}></script>`).join('\n');

  return `<!doctype html>
<html lang="ja">
<head><meta charset="utf-8"><title>Sheet Finder browser integration</title></head>
<body>
  <pre id="browser-test-result">pending</pre>
  <script>
    const browserTestOutput = document.getElementById('browser-test-result');
    globalThis.requestAnimationFrame = (callback) => setTimeout(() => callback(performance.now()), 0);
    globalThis.cancelAnimationFrame = clearTimeout;
    window.addEventListener('error', (event) => {
      const source = event.target?.src || event.filename || 'inline script';
      browserTestOutput.textContent = JSON.stringify({
        ok: false,
        error: \`\${event.message || 'resource load failed'} at \${source}:\${event.lineno || 0}\`,
      });
    }, true);
    window.addEventListener('unhandledrejection', (event) => {
      browserTestOutput.textContent = JSON.stringify({
        ok: false,
        error: event.reason?.stack || String(event.reason),
      });
    });
    globalThis.chrome = globalThis.chrome || {};
    globalThis.chrome.runtime = { getURL: () => ${JSON.stringify(stylesheetUrl)} };
  </script>
  ${scripts}
  <script>
    const output = document.getElementById('browser-test-result');
    const createSheets = (count) => Array.from(
      { length: count },
      (_, index) => ({ name: \`シート\${index + 1}\` }),
    );
    const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));

    async function settleLayout() {
      await nextFrame();
      await nextFrame();
    }

    async function waitFor(predicate, message) {
      for (let attempt = 0; attempt < 120; attempt += 1) {
        if (predicate()) return;
        await nextFrame();
      }
      throw new Error(message);
    }

    function getOverlayElements() {
      const host = document.getElementById('sheet-finder-overlay-host');
      if (!host) throw new Error('overlay host is missing');
      const root = host.shadowRoot;
      return {
        host,
        input: root.querySelector('input'),
        results: root.querySelector('.results'),
        status: root.querySelector('.status'),
      };
    }

    function measureSelection(expectedName) {
      const { results } = getOverlayElements();
      const selected = results.querySelector('.result.is-selected');
      if (!selected) throw new Error('selected row is missing');
      const selectedRect = selected.getBoundingClientRect();
      const resultsRect = results.getBoundingClientRect();
      const selectedCenter = selectedRect.top + selectedRect.height / 2;
      const resultsCenter = resultsRect.top + resultsRect.height / 2;
      return {
        centerDelta: Math.abs(selectedCenter - resultsCenter),
        clientHeight: results.clientHeight,
        currentIsSelected: selected.classList.contains('is-current'),
        expectedName,
        maxScrollTop: results.scrollHeight - results.clientHeight,
        name: selected.dataset.name,
        scrollHeight: results.scrollHeight,
        scrollTop: results.scrollTop,
        visible: selectedRect.top >= resultsRect.top - 1 && selectedRect.bottom <= resultsRect.bottom + 1,
      };
    }

    async function run() {
      let sheets = createSheets(30);
      let currentName = 'シート1';
      let activatedName = null;
      const controller = SheetFinder.createOverlayController({
        adapter: {
          activateSheet: async (name) => { activatedName = name; },
          getSheets: async () => ({ sheets, currentName }),
        },
        documentRef: document,
        normalize: SheetFinder.contentSearch.normalize,
        searchSheets: SheetFinder.contentSearch.searchSheets,
      });
      controller.observeCurrentSheet('シート21');
      controller.observeCurrentSheet(currentName);
      controller.open();

      await waitFor(
        () => getOverlayElements().status.textContent === '30件のシート',
        'initial sheet list did not render',
      );
      await settleLayout();
      const middle = measureSelection('シート21');

      const initialElements = getOverlayElements();
      const currentRow = initialElements.results.querySelector('.result.is-current');
      const selectionSeparatedFromCurrent = currentRow?.dataset.name === currentName &&
        !currentRow.classList.contains('is-selected');

      initialElements.input.value = '';
      initialElements.input.dispatchEvent(new Event('input', { bubbles: true }));
      await settleLayout();
      const first = measureSelection('シート1');

      getOverlayElements().input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowUp',
      }));
      await settleLayout();
      const last = measureSelection('シート30');

      const searchInput = getOverlayElements().input;
      searchInput.value = 'シート21';
      searchInput.dispatchEvent(new Event('input', { bubbles: true }));
      await settleLayout();
      const search = measureSelection('シート21');

      sheets = createSheets(31);
      await controller.refresh();
      await waitFor(
        () => getOverlayElements().status.textContent === '31件のシート',
        'refreshed sheet list did not render',
      );
      await settleLayout();
      const refresh = measureSelection('シート21');

      sheets = [{ name: 'A' }, { name: 'B' }];
      currentName = 'A';
      getOverlayElements().input.value = '';
      getOverlayElements().input.dispatchEvent(new Event('input', { bubbles: true }));
      await controller.refresh();
      await waitFor(
        () => getOverlayElements().status.textContent === '2件のシート',
        'short sheet list did not render',
      );
      await settleLayout();
      const shortList = measureSelection('A');

      getOverlayElements().input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'ArrowDown',
      }));
      await settleLayout();
      const shortListMoved = measureSelection('B');

      getOverlayElements().input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Enter',
      }));
      await waitFor(() => !document.getElementById('sheet-finder-overlay-host'), 'Enter did not close overlay');
      const closedAfterEnter = !document.getElementById('sheet-finder-overlay-host');

      controller.open();
      await waitFor(
        () => getOverlayElements().status.textContent === '2件のシート',
        'reopened sheet list did not render',
      );
      getOverlayElements().input.dispatchEvent(new KeyboardEvent('keydown', {
        bubbles: true,
        key: 'Escape',
      }));
      const closedAfterEscape = !document.getElementById('sheet-finder-overlay-host');

      return {
        activatedName,
        closedAfterEnter,
        closedAfterEscape,
        first,
        last,
        middle,
        refresh,
        search,
        selectionSeparatedFromCurrent,
        shortList,
        shortListMoved,
      };
    }

    run().then(
      (result) => { output.textContent = JSON.stringify({ ok: true, result }); },
      (error) => { output.textContent = JSON.stringify({ ok: false, error: error.stack || error.message }); },
    );
  </script>
</body>
</html>`;
}

function parseBrowserResult(serializedDom) {
  const match = serializedDom.match(/<pre id="browser-test-result">([^<]*)<\/pre>/);
  assert.ok(match, 'browser integration result was not rendered');
  return JSON.parse(match[1]);
}

test('should keep the selected row visible in a real browser layout', async () => {
  const projectRoot = fileURLToPath(new URL('..', import.meta.url));
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'sheet-finder-browser-'));
  try {
    const htmlPath = path.join(temporaryRoot, 'overlay-browser.html');
    await writeFile(htmlPath, createBrowserHarnessHtml(projectRoot), 'utf8');
    const chromeExecutable = resolveChromeExecutable();
    const { stdout } = await execFileAsync(chromeExecutable, [
      '--headless=new',
      '--disable-background-networking',
      '--disable-component-update',
      '--disable-default-apps',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--disable-background-timer-throttling',
      '--disable-renderer-backgrounding',
      '--no-first-run',
      '--no-sandbox',
      '--no-zygote',
      '--single-process',
      '--run-all-compositor-stages-before-draw',
      '--allow-file-access-from-files',
      `--user-data-dir=${path.join(temporaryRoot, 'profile')}`,
      '--virtual-time-budget=5000',
      '--dump-dom',
      pathToFileURL(htmlPath).href,
    ], { maxBuffer: 4 * 1024 * 1024, timeout: 20_000 });
    const browserResult = parseBrowserResult(stdout);

    assert.equal(browserResult.ok, true, browserResult.error);
    const result = browserResult.result;
    assert.equal(result.selectionSeparatedFromCurrent, true);

    assert.equal(result.middle.name, result.middle.expectedName);
    assert.equal(result.middle.visible, true);
    assert.ok(result.middle.centerDelta <= 2, `middle row center delta was ${result.middle.centerDelta}`);
    assert.ok(result.middle.scrollTop > 0);

    assert.equal(result.first.name, result.first.expectedName);
    assert.equal(result.first.visible, true);
    assert.ok(result.first.scrollTop <= 1, `first row scrollTop was ${result.first.scrollTop}`);

    assert.equal(result.last.name, result.last.expectedName);
    assert.equal(result.last.visible, true);
    assert.ok(
      Math.abs(result.last.scrollTop - result.last.maxScrollTop) <= 1,
      `last row was not clamped to the end: ${JSON.stringify(result.last)}`,
    );

    for (const measurement of [result.search, result.refresh, result.shortListMoved]) {
      assert.equal(measurement.name, measurement.expectedName);
      assert.equal(measurement.visible, true);
    }
    assert.ok(result.shortList.scrollHeight <= result.shortList.clientHeight);
    assert.equal(result.activatedName, 'B');
    assert.equal(result.closedAfterEnter, true);
    assert.equal(result.closedAfterEscape, true);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});

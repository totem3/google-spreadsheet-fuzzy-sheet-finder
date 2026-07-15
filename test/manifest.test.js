import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manifest = JSON.parse(fs.readFileSync(new URL('../manifest.json', import.meta.url), 'utf8'));

test('uses the action and command to toggle the page overlay', () => {
  assert.equal(manifest.side_panel, undefined);
  assert.equal(manifest.commands['toggle-sheet-finder'].description, 'シート検索オーバーレイを開閉');
  assert.deepEqual(manifest.content_scripts[0].js, [
    'src/search-content.js',
    'src/overlay-state.js',
    'src/sheets-adapter.js',
    'src/overlay.js',
    'src/content.js',
  ]);
});

test('exposes only the overlay stylesheet to matching Sheets pages', () => {
  assert.deepEqual(manifest.web_accessible_resources, [{
    resources: ['src/overlay.css'],
    matches: ['https://docs.google.com/*'],
  }]);
});

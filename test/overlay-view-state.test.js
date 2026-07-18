import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/overlay.js', import.meta.url), 'utf8');

test('represents view lifecycle with one exclusive status', () => {
  const statuses = [...source.matchAll(/status:\s*'([^']+)'/g)]
    .map((match) => match[1]);

  assert.deepEqual([...new Set(statuses)].sort(), [
    'activating',
    'error',
    'idle',
    'loading',
  ]);
  assert.doesNotMatch(source, /\b(?:loading|moving):\s*(?:true|false)\b/);
  assert.doesNotMatch(source, /view\.(?:loading|moving)\b/);
});

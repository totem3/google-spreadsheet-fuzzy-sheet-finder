import test from 'node:test';
import assert from 'node:assert/strict';
import { normalize, searchSheets } from '../src/search.js';

test('normalizes width, whitespace, and case', () => {
  assert.equal(normalize('  ＡＢＣ  '), 'abc');
});

test('ranks exact before prefix before middle matches', () => {
  const results = searchSheets(['月次売上', '売上サマリー', '売上', '前年売上'], '売上');
  assert.deepEqual(results.map(({ name }) => name), ['売上', '売上サマリー', '月次売上', '前年売上']);
});

test('returns every sheet for an empty query', () => {
  assert.deepEqual(searchSheets(['A', 'B'], ''), [
    { name: 'A', index: 0, rank: 3, matchIndex: -1 },
    { name: 'B', index: 1, rank: 3, matchIndex: -1 },
  ]);
});

test('returns no results for a missing query', () => {
  assert.deepEqual(searchSheets(['A'], 'Z'), []);
});

test('keeps same-position matches deterministic', () => {
  const results = searchSheets(['X売上長', '売上短', 'A売上', '売上'], '売上');
  assert.deepEqual(results.map(({ name }) => name), ['売上', '売上短', 'A売上', 'X売上長']);
});

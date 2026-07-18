import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadOverlayState() {
  const source = fs.readFileSync(new URL('../src/overlay-state.js', import.meta.url), 'utf8');
  const context = { SheetFinder: {} };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.SheetFinder.overlayState;
}

const sheets = [
  { name: '売上' },
  { name: '売上サマリー' },
  { name: '経費' },
];

test('opening the overlay resets the query and selects the previous sheet', () => {
  const { createState, open } = loadOverlayState();
  const state = {
    ...createState(),
    currentName: '経費',
    previousName: '売上サマリー',
  };

  const opened = open({ ...state, query: 'old query', selectedIndex: 2 }, sheets, '経費');

  assert.deepEqual(JSON.parse(JSON.stringify(opened)), {
    open: true,
    sheets,
    currentName: '経費',
    previousName: '売上サマリー',
    query: '',
    selectedIndex: 1,
  });
});

test('the initial current sheet observation does not create false history', () => {
  const { createState, observeCurrentSheet } = loadOverlayState();

  const observed = observeCurrentSheet(createState(), '売上');

  assert.equal(observed.currentName, '売上');
  assert.equal(observed.previousName, null);
});

test('only a real current sheet change advances history', () => {
  const { createState, observeCurrentSheet } = loadOverlayState();
  const initial = observeCurrentSheet(createState(), '売上');

  const empty = observeCurrentSheet(initial, '  ');
  const duplicate = observeCurrentSheet(empty, '  売上  ');
  const changed = observeCurrentSheet(duplicate, '経費');

  assert.equal(empty, initial);
  assert.equal(duplicate, initial);
  assert.equal(changed.currentName, '経費');
  assert.equal(changed.previousName, '売上');
});

test('returning from B to A makes B the previous sheet', () => {
  const { createState, observeCurrentSheet } = loadOverlayState();
  const atA = observeCurrentSheet(createState(), 'A');
  const atB = observeCurrentSheet(atA, 'B');

  const returnedToA = observeCurrentSheet(atB, 'A');

  assert.equal(returnedToA.currentName, 'A');
  assert.equal(returnedToA.previousName, 'B');
});

test('opening falls back to the current sheet when the previous sheet is absent', () => {
  const { createState, open } = loadOverlayState();
  const state = {
    ...createState(),
    currentName: '経費',
    previousName: '削除済み',
  };

  const opened = open(state, sheets, '経費');

  assert.equal(opened.selectedIndex, 2);
});

test('opening safely selects the first result when neither history sheet exists', () => {
  const { createState, open } = loadOverlayState();

  const opened = open(createState(), sheets, null);

  assert.equal(opened.selectedIndex, 0);
});

test('selection movement wraps around the available results', () => {
  const { createState, moveSelection } = loadOverlayState();
  const state = { ...createState(), open: true, selectedIndex: 0 };

  assert.equal(moveSelection(state, -1, sheets.length).selectedIndex, 2);
  assert.equal(moveSelection({ ...state, selectedIndex: 2 }, 1, sheets.length).selectedIndex, 0);
});

test('closing the overlay clears transient search state', () => {
  const { close } = loadOverlayState();
  const state = {
    open: true,
    sheets,
    currentName: '売上',
    previousName: '経費',
    query: '売',
    selectedIndex: 1,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(close(state))), {
    open: false,
    sheets,
    currentName: '売上',
    previousName: '経費',
    query: '',
    selectedIndex: 0,
  });
});

test('does not commit a selection while an IME is composing', () => {
  const { shouldCommitSelection } = loadOverlayState();

  assert.equal(shouldCommitSelection({ isComposing: true, keyCode: 13 }), false);
  assert.equal(shouldCommitSelection({ isComposing: false, keyCode: 229 }), false);
  assert.equal(shouldCommitSelection({ isComposing: false, keyCode: 13 }), true);
});

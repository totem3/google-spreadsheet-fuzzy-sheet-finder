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

test('opening the overlay resets the query and selects the first result', () => {
  const { createState, open } = loadOverlayState();
  const state = createState();

  const opened = open({ ...state, query: 'old query', selectedIndex: 2 }, sheets, '経費');

  assert.deepEqual(JSON.parse(JSON.stringify(opened)), {
    open: true,
    sheets,
    currentName: '経費',
    query: '',
    selectedIndex: 0,
  });
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
    query: '売',
    selectedIndex: 1,
  };

  assert.deepEqual(JSON.parse(JSON.stringify(close(state))), {
    open: false,
    sheets,
    currentName: '売上',
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

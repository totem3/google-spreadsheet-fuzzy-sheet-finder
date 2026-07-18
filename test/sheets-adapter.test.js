import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function loadAdapter() {
  const source = fs.readFileSync(new URL('../src/sheets-adapter.js', import.meta.url), 'utf8');
  const context = {
    setTimeout,
    clearTimeout,
    KeyboardEvent: class {},
    MouseEvent: class {
      constructor(type) { this.type = type; }
    },
  };
  context.globalThis = context;
  vm.runInNewContext(source, context);
  return context.SheetFinder.createSheetsAdapter;
}

function createElement({ ariaLabel, textContent }) {
  const documentRef = {
    defaultView: { getComputedStyle: () => ({}) },
  };
  return {
    ownerDocument: documentRef,
    textContent,
    offsetParent: {},
    getClientRects: () => [{}],
    getAttribute: (name) => name === 'aria-label' ? ariaLabel : null,
    click() {},
  };
}

test('uses the visible sheet name instead of a numbered aria label', async () => {
  const tab = createElement({ ariaLabel: '4信用リスク', textContent: '信用リスク' });
  const documentRef = {
    defaultView: { getComputedStyle: () => ({}) },
    querySelectorAll: (selector) => selector === '.docs-sheet-tab' ? [tab] : [],
    querySelector: () => null,
  };

  const adapter = loadAdapter()(documentRef);
  const { sheets } = await adapter.getSheets();

  assert.equal(sheets.length, 1);
  assert.equal(sheets[0].name, '信用リスク');
});

test('reads the current sheet without opening the all-sheets menu', () => {
  let menuClicks = 0;
  const selectedTab = createElement({ ariaLabel: '2経費', textContent: '経費' });
  const menuControl = {
    ...createElement({ ariaLabel: 'All sheets', textContent: '' }),
    click: () => { menuClicks += 1; },
  };
  const documentRef = {
    defaultView: { getComputedStyle: () => ({}) },
    querySelector: (selector) => {
      if (selector.includes('aria-selected="true"')) return selectedTab;
      if (selector.includes('All sheets')) return menuControl;
      return null;
    },
    querySelectorAll: () => [],
  };

  const adapter = loadAdapter()(documentRef);

  assert.equal(adapter.getCurrentSheetName(), '経費');
  assert.equal(menuClicks, 0);
});

test('reads the current sheet from the active class used by Google Sheets', () => {
  const innerName = { textContent: 'シート1' };
  const activeTab = {
    ...createElement({ ariaLabel: 'シート1', textContent: '0シート1' }),
    className: 'goog-inline-block docs-sheet-tab docs-material docs-sheet-active-tab',
    querySelector: (selector) =>
      selector === '.docs-sheet-tab-name, .docs-sheet-tab-text, [data-sheet-name]' ? innerName : null,
    getAttribute: (name) => {
      if (name === 'role') return 'button';
      if (name === 'aria-label') return 'シート1';
      return null;
    },
  };
  const documentRef = {
    defaultView: { getComputedStyle: () => ({}) },
    querySelector: (selector) => selector.includes('.docs-sheet-active-tab') ? activeTab : null,
    querySelectorAll: () => [],
  };

  const adapter = loadAdapter()(documentRef);

  assert.equal(activeTab.getAttribute('role'), 'button');
  assert.equal(activeTab.getAttribute('aria-selected'), null);
  assert.equal(adapter.getCurrentSheetName(), 'シート1');
});

test('keeps recognizing the legacy selected-tab class', () => {
  const selectedTab = createElement({ ariaLabel: '旧形式', textContent: '旧形式' });
  const documentRef = {
    defaultView: { getComputedStyle: () => ({}) },
    querySelector: (selector) => selector.includes('.docs-sheet-tab-selected') ? selectedTab : null,
    querySelectorAll: () => [],
  };

  const adapter = loadAdapter()(documentRef);

  assert.equal(adapter.getCurrentSheetName(), '旧形式');
});

test('activates a sheet after listing sheets through the all-sheets menu', async () => {
  let menuOpen = false;
  let activated = false;
  const documentRef = {
    defaultView: { getComputedStyle: () => ({}) },
    dispatchEvent: () => true,
    querySelector: (selector) => selector.includes('All sheets') ? control : null,
    querySelectorAll: (selector) => {
      if (selector === '.docs-sheet-tab' || selector.startsWith('[role="tab"]')) return [];
      if (selector.includes('menuitem') && menuOpen) return [menuItem];
      return [];
    },
  };
  const control = {
    ownerDocument: documentRef,
    offsetParent: {},
    getClientRects: () => [{}],
    getAttribute: () => null,
    click: () => { menuOpen = !menuOpen; },
  };
  const menuItem = {
    ownerDocument: documentRef,
    textContent: '信用リスク',
    offsetParent: {},
    getClientRects: () => [{}],
    getAttribute: () => null,
    dispatchEvent: (event) => {
      if (event.type === 'mousedown') activated = true;
      return true;
    },
    click: () => {},
  };

  const adapter = loadAdapter()(documentRef);
  await adapter.getSheets();
  await adapter.activateSheet('信用リスク');

  assert.equal(activated, true);
});

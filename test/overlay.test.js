import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

class FakeElement {
  constructor(tagName, documentRef) {
    this.tagName = tagName;
    this.ownerDocument = documentRef;
    this.children = [];
    this.attributes = new Map();
    this.listeners = new Map();
    this.classes = new Set();
    this.classList = { add: (name) => this.classes.add(name) };
    this.dataset = {};
    this.value = '';
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  set innerHTML(value) {
    this.ownerDocument.populateDialog(this);
  }

  append(...children) { this.children.push(...children); }
  attachShadow() { return new FakeElement('shadow-root', this.ownerDocument); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, event = {}) { this.listeners.get(type)?.({ target: this, ...event }); }
  focus() {}
  querySelector(selector) { return this.dialogElements?.[selector] || null; }
  remove() { this.removed = true; }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function createDocument() {
  const documentRef = {
    body: { append(element) { this.child = element; } },
    createElement: (tagName) => new FakeElement(tagName, documentRef),
    populateDialog(backdrop) {
      const dialogElements = {
        '.close': new FakeElement('button', documentRef),
        '.dialog': new FakeElement('section', documentRef),
        '.empty': new FakeElement('p', documentRef),
        'input': new FakeElement('input', documentRef),
        '.refresh': new FakeElement('button', documentRef),
        '.results': new FakeElement('div', documentRef),
        '.status': new FakeElement('p', documentRef),
      };
      backdrop.dialogElements = dialogElements;
      documentRef.dialogElements = dialogElements;
    },
  };
  return documentRef;
}

function loadController(documentRef, adapter) {
  const context = { chrome: { runtime: { getURL: () => '' } }, document: documentRef };
  context.globalThis = context;
  for (const path of ['../src/search-content.js', '../src/overlay-state.js', '../src/overlay.js']) {
    vm.runInNewContext(fs.readFileSync(new URL(path, import.meta.url), 'utf8'), context);
  }
  return context.SheetFinder.createOverlayController({
    documentRef,
    adapter,
    normalize: context.SheetFinder.contentSearch.normalize,
    searchSheets: context.SheetFinder.contentSearch.searchSheets,
  });
}

test('opening after A to B selects A, while typing resets to the first match', async () => {
  const documentRef = createDocument();
  const controller = loadController(documentRef, {
    getSheets: async () => ({
      sheets: [{ name: 'A' }, { name: 'B' }],
      currentName: 'B',
    }),
  });

  controller.observeCurrentSheet('A');
  controller.observeCurrentSheet('B');
  controller.open();
  await new Promise((resolve) => setImmediate(resolve));

  const results = documentRef.dialogElements['.results'];
  assert.equal(results.children[0].dataset.name, 'A');
  assert.equal(results.children[0].classes.has('is-selected'), true);
  assert.equal(results.children[1].classes.has('is-current'), true);

  const input = documentRef.dialogElements.input;
  input.value = 'B';
  input.dispatch('input');

  assert.equal(results.children.length, 1);
  assert.equal(results.children[0].dataset.name, 'B');
  assert.equal(results.children[0].classes.has('is-selected'), true);
});

test('initial selection follows the sorted empty-query results', async () => {
  const documentRef = createDocument();
  const controller = loadController(documentRef, {
    getSheets: async () => ({
      sheets: [
        { name: 'Previous sheet with a long name' },
        { name: 'X' },
        { name: 'Current' },
      ],
      currentName: 'Current',
    }),
  });

  controller.observeCurrentSheet('Previous sheet with a long name');
  controller.observeCurrentSheet('Current');
  controller.open();
  await new Promise((resolve) => setImmediate(resolve));

  const selected = documentRef.dialogElements['.results'].children
    .find((result) => result.classes.has('is-selected'));
  assert.equal(selected.dataset.name, 'Previous sheet with a long name');
});

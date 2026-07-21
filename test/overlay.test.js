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
    this.scrollIntoViewCalls = [];
    this.value = '';
  }

  set className(value) {
    this.classes = new Set(String(value).split(/\s+/).filter(Boolean));
  }

  set innerHTML(value) {
    this.ownerDocument.populateDialog(this);
  }

  append(...children) {
    for (const child of children) {
      child.parentElement = this;
      if (child.tagName === 'link') this.ownerDocument.registerStylesheet(child);
    }
    this.children.push(...children);
  }
  attachShadow() {
    const shadow = new FakeElement('shadow-root', this.ownerDocument);
    shadow.parentElement = this;
    return shadow;
  }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type, event = {}) { this.listeners.get(type)?.({ target: this, ...event }); }
  focus() {
    this.ownerDocument.activeElement = this;
  }
  querySelector(selector) { return this.dialogElements?.[selector] || null; }
  remove() {
    this.removed = true;
    if (this.parentElement?.child === this) this.parentElement.child = null;
    this.parentElement = null;
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parentElement = null;
    for (const child of children) child.parentElement = this;
    this.children = [...children];
  }
  scrollIntoView(options) {
    const call = {
      element: this,
      options,
      wasAttached: this.isConnected(),
    };
    this.scrollIntoViewCalls.push(call);
    this.ownerDocument.scrollIntoViewCalls.push(call);
  }
  isConnected() {
    let element = this;
    while (element) {
      if (element === this.ownerDocument.body) return true;
      element = element.parentElement;
    }
    return false;
  }
  closest(selector) {
    if (selector === 'button[data-name]' && this.tagName === 'button' && this.dataset.name) return this;
    return null;
  }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
}

function createDocument(stylesheetLoadsImmediately) {
  let nextAnimationFrameId = 1;
  const documentRef = {
    activeElement: null,
    animationFrameCallbacks: new Map(),
    body: {
      append(element) {
        this.child = element;
        element.parentElement = this;
      },
    },
    cancelAnimationFrame(id) {
      this.animationFrameCallbacks.delete(id);
    },
    createElement: (tagName) => new FakeElement(tagName, documentRef),
    flushAnimationFrames() {
      const callbacks = [...this.animationFrameCallbacks.values()];
      this.animationFrameCallbacks.clear();
      for (const callback of callbacks) callback();
    },
    failStylesheet(stylesheet = this.stylesheets.at(-1)) {
      stylesheet.dispatch('error');
    },
    loadStylesheet(stylesheet = this.stylesheets.at(-1)) {
      stylesheet.dispatch('load');
    },
    queueAnimationFrame(callback) {
      const id = nextAnimationFrameId;
      nextAnimationFrameId += 1;
      this.animationFrameCallbacks.set(id, callback);
      return id;
    },
    registerStylesheet(stylesheet) {
      this.stylesheets.push(stylesheet);
      if (stylesheetLoadsImmediately) this.loadStylesheet(stylesheet);
    },
    scrollIntoViewCalls: [],
    stylesheets: [],
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
      for (const element of Object.values(dialogElements)) element.parentElement = backdrop;
      backdrop.dialogElements = dialogElements;
      documentRef.dialogElements = dialogElements;
    },
  };
  return documentRef;
}

function loadController(documentRef, adapter) {
  const context = {
    cancelAnimationFrame: (id) => documentRef.cancelAnimationFrame(id),
    chrome: { runtime: { getURL: () => '' } },
    document: documentRef,
    Element: FakeElement,
    HTMLElement: FakeElement,
    requestAnimationFrame: (callback) => documentRef.queueAnimationFrame(callback),
  };
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

function createSheets(count) {
  return Array.from({ length: count }, (_, index) => ({ name: `シート${index + 1}` }));
}

function findResultByName(documentRef, name) {
  return documentRef.dialogElements['.results'].children
    .find((result) => result.dataset.name === name);
}

function assertScrollCalls(documentRef, expectedElements) {
  assert.equal(documentRef.scrollIntoViewCalls.length, expectedElements.length);
  for (const [index, expectedElement] of expectedElements.entries()) {
    const call = documentRef.scrollIntoViewCalls[index];
    assert.equal(call.element, expectedElement);
    assert.deepEqual(JSON.parse(JSON.stringify(call.options)), {
      block: 'center',
      inline: 'nearest',
    });
    assert.equal(call.wasAttached, true);
  }
}

async function flushAsyncWork(documentRef) {
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();
}

function createDeferred() {
  let reject;
  let resolve;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

test('opening after A to B selects A, while typing resets to the first match', async () => {
  const documentRef = createDocument(true);
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

test('should ignore result-list clicks whose target is not an element', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({
      sheets: [{ name: 'A' }],
      currentName: 'A',
    }),
  });

  controller.open();
  await new Promise((resolve) => setImmediate(resolve));

  const results = documentRef.dialogElements['.results'];
  assert.doesNotThrow(() => results.dispatch('click', { target: {} }));
});

test('initial selection follows the sorted empty-query results', async () => {
  const documentRef = createDocument(true);
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

test('should center the selected row rather than the current row when opening a long list', async () => {
  const documentRef = createDocument(true);
  const sheets = createSheets(30);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets, currentName: 'シート1' }),
  });
  controller.observeCurrentSheet('シート21');
  controller.observeCurrentSheet('シート1');

  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート21');
  const current = findResultByName(documentRef, 'シート1');
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(current.classes.has('is-current'), true);
  assert.equal(selected.scrollIntoViewCalls.length, 1);
  assertScrollCalls(documentRef, [selected]);
  assert.equal(current.scrollIntoViewCalls.length, 0);
});

test('should keep keyboard navigation in the search input when moving selection down', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  const input = documentRef.dialogElements.input;

  input.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート2');
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(documentRef.activeElement, input);
  assert.equal(documentRef.scrollIntoViewCalls.length, 1);
  assertScrollCalls(documentRef, [selected]);
});

test('should scroll the last row into view when ArrowUp wraps from the first row', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;

  documentRef.dialogElements.input.dispatch('keydown', {
    key: 'ArrowUp',
    preventDefault() {},
  });
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート3');
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(documentRef.scrollIntoViewCalls.length, 1);
  assertScrollCalls(documentRef, [selected]);
});

test('should scroll the first row into view when ArrowDown wraps from the last row', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート3' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;

  documentRef.dialogElements.input.dispatch('keydown', {
    key: 'ArrowDown',
    preventDefault() {},
  });
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート1');
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(documentRef.scrollIntoViewCalls.length, 1);
  assertScrollCalls(documentRef, [selected]);
});

test('should scroll the selected match into view when search results change', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(30), currentName: 'シート1' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  const input = documentRef.dialogElements.input;

  input.value = 'シート21';
  input.dispatch('input');
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート21');
  assert.equal(documentRef.dialogElements['.results'].children.length, 1);
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(documentRef.scrollIntoViewCalls.length, 1);
  assertScrollCalls(documentRef, [selected]);
});

test('should scroll the replacement selection into view after refreshing the sheet list', async () => {
  const documentRef = createDocument(true);
  const responses = [
    {
      sheets: [{ name: '前回のシート' }, { name: '現在のシート' }],
      currentName: '現在のシート',
    },
    {
      sheets: [{ name: '追加されたシート' }, { name: '現在のシート' }],
      currentName: '現在のシート',
    },
  ];
  let responseIndex = 0;
  const controller = loadController(documentRef, {
    getSheets: async () => responses[responseIndex++],
  });
  controller.observeCurrentSheet('前回のシート');
  controller.observeCurrentSheet('現在のシート');
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;

  documentRef.dialogElements['.refresh'].dispatch('click');
  await flushAsyncWork(documentRef);

  const selected = findResultByName(documentRef, '現在のシート');
  assert.equal(selected.classes.has('is-selected'), true);
  assertScrollCalls(documentRef, [selected]);
});

test('should scroll only the latest selected row after consecutive renders', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  const input = documentRef.dialogElements.input;

  input.value = 'シート1';
  input.dispatch('input');
  input.value = 'シート2';
  input.dispatch('input');
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート2');
  assertScrollCalls(documentRef, [selected]);
});

test('should wait for the current stylesheet and then scroll the latest selection', async () => {
  const documentRef = createDocument(false);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });

  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  const staleStylesheet = documentRef.stylesheets[0];
  controller.close();
  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  const input = documentRef.dialogElements.input;
  input.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  documentRef.flushAnimationFrames();
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);

  documentRef.loadStylesheet(staleStylesheet);
  documentRef.flushAnimationFrames();
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);

  documentRef.loadStylesheet();
  documentRef.flushAnimationFrames();
  const selected = findResultByName(documentRef, 'シート2');
  assertScrollCalls(documentRef, [selected]);
});

test('should ignore a stale stylesheet error and scroll after the current stylesheet errors', async () => {
  const documentRef = createDocument(false);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });

  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  const staleStylesheet = documentRef.stylesheets[0];
  controller.close();
  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.dialogElements.input.dispatch('keydown', {
    key: 'ArrowDown',
    preventDefault() {},
  });

  documentRef.failStylesheet(staleStylesheet);
  documentRef.flushAnimationFrames();
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);

  documentRef.failStylesheet();
  documentRef.flushAnimationFrames();
  const selected = findResultByName(documentRef, 'シート2');
  assertScrollCalls(documentRef, [selected]);
});

test('should isolate the latest refresh render when the response is deferred', async () => {
  const documentRef = createDocument(true);
  const refreshResponse = createDeferred();
  let requestCount = 0;
  const controller = loadController(documentRef, {
    getSheets: () => {
      requestCount += 1;
      if (requestCount === 1) {
        return Promise.resolve({ sheets: [{ name: '前回のシート' }], currentName: '前回のシート' });
      }
      return refreshResponse.promise;
    },
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;

  documentRef.dialogElements['.refresh'].dispatch('click');
  refreshResponse.resolve({ sheets: [{ name: '更新後のシート' }], currentName: '更新後のシート' });
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, '更新後のシート');
  assertScrollCalls(documentRef, [selected]);
});

test('should preserve the selected row and isolate scrolling when refreshing fails', async () => {
  const documentRef = createDocument(true);
  const refreshResponse = createDeferred();
  let requestCount = 0;
  const controller = loadController(documentRef, {
    getSheets: () => {
      requestCount += 1;
      if (requestCount === 1) {
        return Promise.resolve({ sheets: createSheets(3), currentName: 'シート1' });
      }
      return refreshResponse.promise;
    },
  });
  controller.open();
  await flushAsyncWork(documentRef);
  const input = documentRef.dialogElements.input;
  input.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  documentRef.flushAnimationFrames();
  documentRef.scrollIntoViewCalls.length = 0;

  documentRef.dialogElements['.refresh'].dispatch('click');
  refreshResponse.reject(new Error('一覧取得失敗'));
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート2');
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '一覧取得失敗');
  assertScrollCalls(documentRef, [selected]);
});

test('should preserve the selected row and isolate scrolling when activation fails', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const controller = loadController(documentRef, {
    activateSheet: () => activation.promise,
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  const input = documentRef.dialogElements.input;

  input.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });
  input.dispatch('keydown', {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {},
  });
  activation.reject(new Error('移動失敗'));
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, 'シート2');
  assert.equal(controller.isOpen(), true);
  assert.equal(selected.classes.has('is-selected'), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '移動失敗');
  assertScrollCalls(documentRef, [selected]);
});

test('should ignore the UI refresh while a successful activation is pending', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const activatedNames = [];
  let requestCount = 0;
  const controller = loadController(documentRef, {
    activateSheet: (name) => {
      activatedNames.push(name);
      return activation.promise;
    },
    getSheets: async () => {
      requestCount += 1;
      return { sheets: [{ name: '選択シート' }], currentName: '選択シート' };
    },
  });
  controller.open();
  await flushAsyncWork(documentRef);

  documentRef.dialogElements.input.dispatch('keydown', {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {},
  });
  documentRef.dialogElements['.refresh'].dispatch('click');
  await flushAsyncWork(documentRef);
  const statusAfterRefresh = documentRef.dialogElements['.status'].textContent;
  const selected = findResultByName(documentRef, '選択シート');
  documentRef.dialogElements['.results'].dispatch('click', { target: selected });
  activation.resolve();
  await flushAsyncWork(documentRef);

  assert.equal(requestCount, 1);
  assert.deepEqual(activatedNames, ['選択シート']);
  assert.equal(statusAfterRefresh, '移動中…');
  assert.equal(controller.isOpen(), false);
});

test('should ignore the public refresh while a failed activation is pending', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const activatedNames = [];
  let requestCount = 0;
  const controller = loadController(documentRef, {
    activateSheet: (name) => {
      activatedNames.push(name);
      return activation.promise;
    },
    getSheets: async () => {
      requestCount += 1;
      return { sheets: [{ name: '選択シート' }], currentName: '選択シート' };
    },
  });
  controller.open();
  await flushAsyncWork(documentRef);

  const selected = findResultByName(documentRef, '選択シート');
  documentRef.dialogElements['.results'].dispatch('click', { target: selected });
  controller.refresh();
  await flushAsyncWork(documentRef);
  const statusAfterRefresh = documentRef.dialogElements['.status'].textContent;
  documentRef.dialogElements.input.dispatch('keydown', {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {},
  });
  activation.reject(new Error('移動失敗'));
  await flushAsyncWork(documentRef);

  assert.equal(requestCount, 1);
  assert.deepEqual(activatedNames, ['選択シート']);
  assert.equal(statusAfterRefresh, '移動中…');
  assert.equal(controller.isOpen(), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '移動失敗');
});

test('should ignore a stale successful Enter activation after closing and reopening', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const activatedNames = [];
  const controller = loadController(documentRef, {
    activateSheet: (name) => {
      activatedNames.push(name);
      return activation.promise;
    },
    getSheets: async () => ({ sheets: [{ name: '選択シート' }], currentName: '選択シート' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  const input = documentRef.dialogElements.input;

  input.dispatch('keydown', {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {},
  });
  assert.deepEqual(activatedNames, ['選択シート']);
  input.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  activation.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  assert.equal(controller.isOpen(), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '1件のシート');
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);
});

test('should ignore a stale failed Enter activation after closing and reopening', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const activatedNames = [];
  const controller = loadController(documentRef, {
    activateSheet: (name) => {
      activatedNames.push(name);
      return activation.promise;
    },
    getSheets: async () => ({ sheets: [{ name: '選択シート' }], currentName: '選択シート' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  const input = documentRef.dialogElements.input;

  input.dispatch('keydown', {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {},
  });
  assert.deepEqual(activatedNames, ['選択シート']);
  input.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  activation.reject(new Error('古い移動失敗'));
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  assert.equal(controller.isOpen(), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '1件のシート');
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);
});

test('should ignore a stale successful click activation after closing and reopening', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const activatedNames = [];
  const controller = loadController(documentRef, {
    activateSheet: (name) => {
      activatedNames.push(name);
      return activation.promise;
    },
    getSheets: async () => ({ sheets: [{ name: '選択シート' }], currentName: '選択シート' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  const selected = findResultByName(documentRef, '選択シート');

  documentRef.dialogElements['.results'].dispatch('click', { target: selected });
  assert.deepEqual(activatedNames, ['選択シート']);
  documentRef.dialogElements.input.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  activation.resolve();
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  assert.equal(controller.isOpen(), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '1件のシート');
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);
});

test('should ignore a stale failed click activation after closing and reopening', async () => {
  const documentRef = createDocument(true);
  const activation = createDeferred();
  const activatedNames = [];
  const controller = loadController(documentRef, {
    activateSheet: (name) => {
      activatedNames.push(name);
      return activation.promise;
    },
    getSheets: async () => ({ sheets: [{ name: '選択シート' }], currentName: '選択シート' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  const selected = findResultByName(documentRef, '選択シート');

  documentRef.dialogElements['.results'].dispatch('click', { target: selected });
  assert.deepEqual(activatedNames, ['選択シート']);
  documentRef.dialogElements.input.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  activation.reject(new Error('古い移動失敗'));
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  assert.equal(controller.isOpen(), true);
  assert.equal(documentRef.dialogElements['.status'].textContent, '1件のシート');
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);
});

test('should cancel a pending scroll when closing and reopening', async () => {
  const documentRef = createDocument(true);
  const responses = [
    { sheets: [{ name: '閉じる前のシート' }], currentName: '閉じる前のシート' },
    { sheets: [{ name: '再表示後のシート' }], currentName: '再表示後のシート' },
  ];
  let responseIndex = 0;
  const controller = loadController(documentRef, {
    getSheets: async () => responses[responseIndex++],
  });

  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  controller.close();
  controller.open();
  await new Promise((resolve) => setImmediate(resolve));
  documentRef.flushAnimationFrames();

  const selected = findResultByName(documentRef, '再表示後のシート');
  assertScrollCalls(documentRef, [selected]);
});

test('should not request scrolling when search has no selected result', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(3), currentName: 'シート1' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  documentRef.scrollIntoViewCalls.length = 0;
  const input = documentRef.dialogElements.input;

  input.value = '一致しない検索語';
  input.dispatch('input');

  assert.equal(documentRef.dialogElements['.results'].children.length, 0);
  assert.equal(documentRef.scrollIntoViewCalls.length, 0);
});

test('should activate the selected sheet with Enter when the full list fits', async () => {
  const documentRef = createDocument(true);
  const activatedNames = [];
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(2), currentName: 'シート1' }),
    activateSheet: async (name) => activatedNames.push(name),
  });
  controller.open();
  await flushAsyncWork(documentRef);
  const input = documentRef.dialogElements.input;
  input.dispatch('keydown', { key: 'ArrowDown', preventDefault() {} });

  input.dispatch('keydown', {
    key: 'Enter',
    isComposing: false,
    keyCode: 13,
    preventDefault() {},
  });
  await flushAsyncWork(documentRef);

  assert.deepEqual(activatedNames, ['シート2']);
  assert.equal(controller.isOpen(), false);
});

test('should close the overlay with Escape after automatic scrolling', async () => {
  const documentRef = createDocument(true);
  const controller = loadController(documentRef, {
    getSheets: async () => ({ sheets: createSheets(30), currentName: 'シート21' }),
  });
  controller.open();
  await flushAsyncWork(documentRef);

  documentRef.dialogElements.input.dispatch('keydown', {
    key: 'Escape',
    preventDefault() {},
  });

  assert.equal(controller.isOpen(), false);
});

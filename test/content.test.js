import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

function createObserverHarness() {
  const instances = [];
  class Observer {
    constructor(callback) {
      this.callback = callback;
      this.observations = [];
      this.activeTargets = [];
      this.disconnectCount = 0;
      instances.push(this);
    }

    observe(target, options) {
      this.observations.push({ target, options });
      this.activeTargets.push(target);
    }

    disconnect() {
      this.disconnectCount += 1;
      this.activeTargets = [];
    }
  }
  return { instances, Observer };
}

test('observes body structure separately from sheet-tab attributes', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const body = {};
  const tabA = {};
  const tabB = {};
  const harness = createObserverHarness();
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() {} } },
    SheetFinder: {
      createSheetsAdapter: () => ({ getCurrentSheetName: () => 'A' }),
      createOverlayController: () => ({ observeCurrentSheet() {} }),
    },
    MutationObserver: harness.Observer,
    document: {
      body,
      querySelector: () => tabA,
      querySelectorAll: () => [tabA, tabB],
    },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);

  assert.equal(harness.instances.length, 2);
  const structureObserver = harness.instances.find((observer) =>
    observer.observations.some(({ target }) => target === body));
  const attributeObserver = harness.instances.find((observer) => observer !== structureObserver);
  assert.deepEqual(
    JSON.parse(JSON.stringify(structureObserver.observations[0].options)),
    { childList: true, subtree: true },
  );
  assert.deepEqual(attributeObserver.activeTargets, [tabA, tabB]);
  for (const { options } of attributeObserver.observations) {
    assert.deepEqual(JSON.parse(JSON.stringify(options)), {
      attributeFilter: ['aria-selected', 'class'],
      attributes: true,
    });
  }
});

test('rebinds when candidate nodes add or replace sheet tabs', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const body = {};
  const tabA = { matches: () => true };
  const tabB = { matches: () => true };
  const tabC = { matches: () => true };
  const tabD = { matches: () => true };
  let tabs = [tabA, tabB];
  let currentName = 'A';
  const observedNames = [];
  const harness = createObserverHarness();
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() {} } },
    SheetFinder: {
      createSheetsAdapter: () => ({ getCurrentSheetName: () => currentName }),
      createOverlayController: () => ({
        observeCurrentSheet: (name) => observedNames.push(name),
      }),
    },
    MutationObserver: harness.Observer,
    document: {
      body,
      querySelector: () => tabs[0] || null,
      querySelectorAll: () => tabs,
    },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  const structureObserver = harness.instances.find((observer) =>
    observer.observations.some(({ target }) => target === body));
  const attributeObserver = harness.instances.find((observer) => observer !== structureObserver);

  tabs = [tabB, tabC];
  currentName = 'C';
  structureObserver.callback([{
    type: 'childList',
    addedNodes: [{ nodeType: 3 }],
    removedNodes: [{
      matches: () => false,
      querySelector: () => tabA,
    }, { nodeType: 3 }],
  }]);
  assert.deepEqual(attributeObserver.activeTargets, [tabB, tabC]);
  assert.equal(attributeObserver.disconnectCount, 1);
  assert.deepEqual(observedNames, ['A', 'C']);

  const observationCount = attributeObserver.observations.length;
  structureObserver.callback([{ type: 'childList' }]);
  assert.equal(attributeObserver.disconnectCount, 1);
  assert.equal(attributeObserver.observations.length, observationCount);

  tabs = [tabC, tabD];
  currentName = 'D';
  structureObserver.callback([{
    type: 'childList',
    addedNodes: [tabD],
    removedNodes: [tabB],
  }]);
  assert.deepEqual(attributeObserver.activeTargets, [tabC, tabD]);
  assert.equal(attributeObserver.disconnectCount, 2);
  assert.deepEqual(observedNames, ['A', 'C', 'D']);

  currentName = 'C';
  attributeObserver.callback([{ type: 'attributes', target: tabC }]);
  assert.deepEqual(observedNames, ['A', 'C', 'D', 'C']);
});

test('unrelated child-list changes do not rescan or rebind sheet tabs', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  const body = {};
  let connectionReads = 0;
  let containsCalls = 0;
  const tabA = {
    get isConnected() { connectionReads += 1; return true; },
  };
  const tabB = {
    get isConnected() { connectionReads += 1; return true; },
  };
  const unrelatedElement = {
    matches: () => false,
    querySelector: () => null,
    contains: () => { containsCalls += 1; return false; },
  };
  const textNode = {
    nodeType: 3,
    contains: () => { containsCalls += 1; return false; },
  };
  let queryCalls = 0;
  let singleQueryCalls = 0;
  let scheduledCallback;
  const harness = createObserverHarness();
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() {} } },
    SheetFinder: {
      createSheetsAdapter: () => ({ getCurrentSheetName: () => 'A' }),
      createOverlayController: () => ({ observeCurrentSheet() {} }),
    },
    MutationObserver: harness.Observer,
    document: {
      body,
      querySelector: () => {
        singleQueryCalls += 1;
        return tabA;
      },
      querySelectorAll: () => {
        queryCalls += 1;
        return [tabA, tabB];
      },
    },
    setTimeout: (callback) => { scheduledCallback = callback; return 1; },
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  const structureObserver = harness.instances.find((observer) =>
    observer.observations.some(({ target }) => target === body));
  const attributeObserver = harness.instances.find((observer) => observer !== structureObserver);
  const observationCount = attributeObserver.observations.length;

  structureObserver.callback([{
    type: 'childList',
    addedNodes: [unrelatedElement, textNode],
    removedNodes: [{ nodeType: 8 }],
  }]);
  scheduledCallback();

  assert.equal(queryCalls, 1);
  assert.equal(singleQueryCalls, 0);
  assert.equal(containsCalls, 0);
  assert.equal(connectionReads, 2);
  assert.equal(attributeObserver.disconnectCount, 0);
  assert.equal(attributeObserver.observations.length, observationCount);
});

test('tracks direct sheet changes while the overlay is closed without listing sheets', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  let currentName = 'A';
  let listCalls = 0;
  const observedNames = [];
  const body = {};
  const tabA = {};
  const tabB = {};
  const harness = createObserverHarness();
  const adapter = {
    getCurrentSheetName: () => currentName,
    getSheets: () => { listCalls += 1; },
  };
  const overlay = {
    isOpen: () => false,
    observeCurrentSheet: (name) => observedNames.push(name),
  };
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() {} } },
    SheetFinder: {
      createSheetsAdapter: () => adapter,
      createOverlayController: () => overlay,
    },
    MutationObserver: harness.Observer,
    document: {
      body,
      querySelector: () => tabA,
      querySelectorAll: () => [tabA, tabB],
    },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  const structureObserver = harness.instances.find((observer) =>
    observer.observations.some(({ target }) => target === body));
  const attributeObserver = harness.instances.find((observer) => observer !== structureObserver);
  currentName = 'B';
  attributeObserver.callback([{
    type: 'attributes',
    attributeName: 'aria-selected',
    target: tabB,
  }]);

  assert.deepEqual(observedNames, ['A', 'B']);
  assert.equal(listCalls, 0);
  const observeOptions = attributeObserver.observations[0].options;
  assert.equal(observeOptions.attributes, true);
  assert.deepEqual(
    JSON.parse(JSON.stringify(observeOptions.attributeFilter)),
    ['aria-selected', 'class'],
  );
});

test('does not read the current sheet for unrelated attribute changes', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  let mutationCallback;
  let readCalls = 0;
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() {} } },
    SheetFinder: {
      createSheetsAdapter: () => ({
        getCurrentSheetName: () => { readCalls += 1; return 'A'; },
      }),
      createOverlayController: () => ({ observeCurrentSheet() {} }),
    },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
    },
    document: { body: {}, querySelector: () => ({}) },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  mutationCallback([{
    type: 'attributes',
    attributeName: 'class',
    target: { matches: () => false, querySelector: () => null },
  }]);

  assert.equal(readCalls, 1);
});

test('ignores a missing current sheet during DOM observation without throwing', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  let mutationCallback;
  const context = {
    chrome: { runtime: { onMessage: { addListener() {} }, sendMessage() {} } },
    SheetFinder: {
      createSheetsAdapter: () => ({ getCurrentSheetName: () => null }),
      createOverlayController: () => ({ observeCurrentSheet() {} }),
    },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
    },
    document: { body: {}, querySelector: () => ({}) },
    setTimeout: () => 1,
    clearTimeout() {},
  };
  context.globalThis = context;

  assert.doesNotThrow(() => vm.runInNewContext(source, context));
  assert.doesNotThrow(() => mutationCallback([{ type: 'childList' }]));
});

test('does not throw when the extension context disappears before a sheet change notification', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  let mutationCallback;
  let scheduledCallback;
  const runtime = { onMessage: { addListener() {} }, sendMessage() {} };
  const context = {
    chrome: { runtime },
    SheetFinder: { createSheetsAdapter: () => ({}) },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
    },
    document: {
      body: {},
      querySelector: () => ({})
    },
    setTimeout: (callback) => { scheduledCallback = callback; return 1; },
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  context.chrome.runtime = undefined;

  assert.doesNotThrow(() => {
    mutationCallback();
    scheduledCallback();
  });
});

test('does not throw when the invalidated runtime throws while reading sendMessage', () => {
  const source = fs.readFileSync(new URL('../src/content.js', import.meta.url), 'utf8');
  let mutationCallback;
  let scheduledCallback;
  const runtime = { onMessage: { addListener() {} }, sendMessage() {} };
  const context = {
    chrome: { runtime },
    SheetFinder: { createSheetsAdapter: () => ({}) },
    MutationObserver: class {
      constructor(callback) { mutationCallback = callback; }
      observe() {}
    },
    document: { body: {}, querySelector: () => ({}) },
    setTimeout: (callback) => { scheduledCallback = callback; return 1; },
    clearTimeout() {},
  };
  context.globalThis = context;

  vm.runInNewContext(source, context);
  Object.defineProperty(context.chrome, 'runtime', {
    configurable: true,
    get: () => ({
      get sendMessage() { throw new Error('Extension context invalidated'); },
    }),
  });

  assert.doesNotThrow(() => {
    mutationCallback();
    scheduledCallback();
  });
});

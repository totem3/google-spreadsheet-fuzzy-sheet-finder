import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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

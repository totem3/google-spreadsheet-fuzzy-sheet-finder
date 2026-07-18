(function startContentScript(global) {
  const SHEET_TAB_SELECTOR = '.docs-sheet-tab, [role="tab"]';
  const adapter = global.SheetFinder?.createSheetsAdapter?.();
  const overlay = adapter && global.SheetFinder?.createOverlayController?.({
    adapter,
    normalize: global.SheetFinder?.contentSearch?.normalize,
    searchSheets: global.SheetFinder?.contentSearch?.searchSheets,
  });
  const runtime = global.chrome?.runtime;

  function errorResponse(error) {
    return {
      ok: false,
      code: error?.code || 'CONTENT_SCRIPT_ERROR',
      message: error?.message || 'Google Sheetsの画面を読み取れませんでした。',
    };
  }

  if (adapter && typeof runtime?.onMessage?.addListener === 'function') {
    runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message?.type === 'TOGGLE_OVERLAY') {
        overlay?.toggle();
        return undefined;
      }

      if (message?.type === 'SHEETS_CHANGED') {
        overlay?.refresh();
        return undefined;
      }

      if (!['GET_SHEETS', 'ACTIVATE_SHEET'].includes(message?.type)) return undefined;

      (async () => {
        try {
          if (message.type === 'GET_SHEETS') {
            const { sheets, currentName } = await adapter.getSheets();
            sendResponse({ ok: true, sheets, currentName });
            return;
          }

          await adapter.activateSheet(message.name);
          sendResponse({ ok: true });
        } catch (error) {
          sendResponse(errorResponse(error));
        }
      })();

      return true;
    });
  }

  function notifySheetsChanged() {
    try {
      const currentRuntime = global.chrome?.runtime;
      if (typeof currentRuntime?.sendMessage !== 'function') return;
      Promise.resolve(currentRuntime.sendMessage({ type: 'SHEETS_CHANGED' })).catch(() => {});
    } catch {
      // The extension may have been reloaded while this page was still open.
    }
  }

  function observeCurrentSheet() {
    try {
      const currentName = adapter?.getCurrentSheetName?.();
      if (currentName) overlay?.observeCurrentSheet?.(currentName);
    } catch {
      // Sheets can briefly replace the tab DOM while changing sheets.
    }
  }

  function getSheetTabs() {
    try {
      return [...(global.document.querySelectorAll?.(SHEET_TAB_SELECTOR) || [])];
    } catch {
      return [];
    }
  }

  observeCurrentSheet();

  let notificationTimer;
  let observedSheetTabs = [];
  function scheduleSheetsChangedNotification() {
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      if (observedSheetTabs.length) notifySheetsChanged();
    }, 800);
  }

  const sheetTabObserver = new MutationObserver(() => {
    observeCurrentSheet();
    scheduleSheetsChangedNotification();
  });

  function rebindSheetTabObserver() {
    const nextTabs = getSheetTabs();
    const observedSet = new Set(observedSheetTabs);
    if (nextTabs.length === observedSheetTabs.length && nextTabs.every((tab) => observedSet.has(tab))) {
      return false;
    }

    if (observedSheetTabs.length) sheetTabObserver.disconnect();
    observedSheetTabs = nextTabs;
    for (const tab of observedSheetTabs) {
      sheetTabObserver.observe(tab, {
        attributeFilter: ['aria-selected', 'class'],
        attributes: true,
      });
    }
    return true;
  }

  function containsSheetTabCandidate(node) {
    try {
      return Boolean(node?.matches?.(SHEET_TAB_SELECTOR) || node?.querySelector?.(SHEET_TAB_SELECTOR));
    } catch {
      return false;
    }
  }

  function mayChangeSheetTabs(mutations) {
    let hasChildListMutation = false;
    for (const mutation of mutations || []) {
      if (mutation.type !== 'childList') continue;
      hasChildListMutation = true;
      const nodes = [...(mutation.addedNodes || []), ...(mutation.removedNodes || [])];
      if (nodes.some(containsSheetTabCandidate)) return true;
    }
    return hasChildListMutation && observedSheetTabs.some((tab) => tab?.isConnected === false);
  }

  rebindSheetTabObserver();

  const structureObserver = new MutationObserver((mutations) => {
    if (mayChangeSheetTabs(mutations) && rebindSheetTabObserver()) observeCurrentSheet();
    scheduleSheetsChangedNotification();
  });

  if (global.document.body) {
    structureObserver.observe(global.document.body, { childList: true, subtree: true });
  }
})(globalThis);

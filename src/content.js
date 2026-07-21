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

  let refreshTimer;
  let observedSheetTabs = [];
  let observedSheetTabSet = new Set();
  function scheduleSheetsRefresh() {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      if (observedSheetTabs.length) overlay?.refresh();
    }, 800);
  }

  const sheetTabObserver = new MutationObserver(() => {
    observeCurrentSheet();
    scheduleSheetsRefresh();
  });

  function rebindSheetTabObserver() {
    const nextTabs = getSheetTabs();
    if (nextTabs.length === observedSheetTabs.length && nextTabs.every((tab) => observedSheetTabSet.has(tab))) {
      return false;
    }

    if (observedSheetTabs.length) sheetTabObserver.disconnect();
    observedSheetTabs = nextTabs;
    observedSheetTabSet = new Set(nextTabs);
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

  function isInsideObservedSheetTab(node) {
    try {
      if (observedSheetTabSet.has(node)) return true;
      const closestTab = node?.closest?.(SHEET_TAB_SELECTOR);
      return Boolean(closestTab && observedSheetTabSet.has(closestTab));
    } catch {
      return false;
    }
  }

  rebindSheetTabObserver();

  const structureObserver = new MutationObserver((mutations) => {
    const tabsMayHaveChanged = mayChangeSheetTabs(mutations);
    const tabContentChanged = mutations?.some((mutation) =>
      mutation.type === 'childList' && isInsideObservedSheetTab(mutation.target),
    );

    if (tabsMayHaveChanged && rebindSheetTabObserver()) observeCurrentSheet();
    if (tabsMayHaveChanged || tabContentChanged) scheduleSheetsRefresh();
  });

  if (global.document.body) {
    structureObserver.observe(global.document.body, { childList: true, subtree: true });
  }
})(globalThis);

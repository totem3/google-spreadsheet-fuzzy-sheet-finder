(function startContentScript(global) {
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

  let notificationTimer;
  const observer = new MutationObserver(() => {
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
      if (global.document.querySelector('.docs-sheet-tab, [role="tab"]')) {
        notifySheetsChanged();
      }
    }, 800);
  });

  if (global.document.body) {
    observer.observe(global.document.body, { childList: true, subtree: true });
  }
})(globalThis);

const SHEETS_URL_PREFIX = 'https://docs.google.com/spreadsheets/';

function isGoogleSheetsTab(tab) {
  return typeof tab?.url === 'string' && tab.url.startsWith(SHEETS_URL_PREFIX);
}

async function getActiveSheetsTab() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!isGoogleSheetsTab(tab)) return null;
  return tab;
}

async function relayToActiveSheet(message) {
  const tab = await getActiveSheetsTab();
  if (!tab?.id) {
    return {
      ok: false,
      code: 'NOT_SHEETS_TAB',
      message: 'Google Sheetsを開いたタブをアクティブにしてください。',
    };
  }

  try {
    const response = await chrome.tabs.sendMessage(tab.id, message);
    return response || {
      ok: false,
      code: 'EMPTY_RESPONSE',
      message: 'Google Sheetsから応答がありませんでした。ページを再読み込みしてください。',
    };
  } catch {
    return {
      ok: false,
      code: 'CONTENT_SCRIPT_UNAVAILABLE',
      message: 'シート画面を読み取れませんでした。Google Sheetsを再読み込みしてください。',
    };
  }
}

async function toggleActiveSheetOverlay() {
  await relayToActiveSheet({ type: 'TOGGLE_OVERLAY' });
}

chrome.action.onClicked.addListener(() => {
  toggleActiveSheetOverlay().catch(() => {});
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sheet-finder') toggleActiveSheetOverlay().catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'SHEETS_CHANGED') {
    chrome.runtime.sendMessage({ type: 'SHEETS_CHANGED' }).catch(() => {});
    return undefined;
  }

  if (message?.type === 'TOGGLE_OVERLAY') {
    toggleActiveSheetOverlay().catch(() => {});
    return undefined;
  }

  if (!['GET_SHEETS', 'ACTIVATE_SHEET'].includes(message?.type)) return undefined;

  (async () => {
    if (message.type === 'ACTIVATE_SHEET' && typeof message.name !== 'string') {
      sendResponse({
        ok: false,
        code: 'INVALID_SHEET_NAME',
        message: '移動先のシート名が不正です。',
      });
      return;
    }
    sendResponse(await relayToActiveSheet(message));
  })();

  return true;
});

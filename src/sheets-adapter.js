(function registerSheetsAdapter(global) {
  const TAB_SELECTORS = [
    '.docs-sheet-tab',
    '[role="tab"][aria-label]',
    '[role="tab"][data-tooltip]',
  ];
  const ALL_SHEETS_SELECTORS = [
    '[aria-label*="All sheets" i]',
    '[aria-label*="すべてのシート"]',
    '[data-tooltip*="All sheets" i]',
    '[data-tooltip*="すべてのシート"]',
    '[title*="All sheets" i]',
    '[title*="すべてのシート"]',
  ];
  const MENU_ITEM_SELECTORS = [
    '[role="menu"] [role="menuitem"]',
    '.goog-menuitem',
  ];

  const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

  function normalize(value) {
    return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  }

  function isVisible(element) {
    if (!element) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
    return element.getClientRects().length > 0 || element.offsetParent !== null;
  }

  function getLabel(element) {
    const nameElement = element.querySelector?.('.docs-sheet-tab-name, .docs-sheet-tab-text, [data-sheet-name]');
    const explicitName = String(nameElement?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (explicitName) return explicitName;

    const visibleText = String(element.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (visibleText) return visibleText;

    const label = element.getAttribute('aria-label') ||
      element.getAttribute('data-tooltip') ||
      element.getAttribute('title') ||
      element.textContent;
    return String(label ?? '').replace(/\s+/g, ' ').trim();
  }

  function uniqueNames(elements) {
    const names = [];
    const seen = new Set();
    for (const element of elements) {
      if (!isVisible(element)) continue;
      const name = getLabel(element);
      const key = normalize(name);
      if (!key || seen.has(key)) continue;
      seen.add(key);
      names.push({ name, key });
    }
    return names;
  }

  function findAllSheetsControl(documentRef) {
    for (const selector of ALL_SHEETS_SELECTORS) {
      const control = documentRef.querySelector(selector);
      if (isVisible(control)) return control;
    }
    return null;
  }

  function getVisibleTabElements(documentRef) {
    const elements = [];
    for (const selector of TAB_SELECTORS) {
      elements.push(...documentRef.querySelectorAll(selector));
    }
    return elements.filter((element, index, list) => list.indexOf(element) === index);
  }

  function getVisibleSheetNames(documentRef) {
    return uniqueNames(getVisibleTabElements(documentRef));
  }

  function getMenuItems(documentRef) {
    const elements = [];
    for (const selector of MENU_ITEM_SELECTORS) {
      elements.push(...documentRef.querySelectorAll(selector));
    }
    return uniqueNames(elements);
  }

  function getCurrentSheetName(documentRef) {
    const selected = documentRef.querySelector('[role="tab"][aria-selected="true"], .docs-sheet-tab-selected');
    return selected && isVisible(selected) ? getLabel(selected) : null;
  }

  function clickLikeUser(element, documentRef) {
    element.focus?.();
    const MouseEventConstructor = documentRef.defaultView?.MouseEvent || globalThis.MouseEvent;
    if (typeof element.dispatchEvent !== 'function' || typeof MouseEventConstructor !== 'function') {
      element.click();
      return;
    }

    for (const type of ['mousedown', 'mouseup', 'click']) {
      element.dispatchEvent(new MouseEventConstructor(type, {
        bubbles: true,
        cancelable: true,
        view: documentRef.defaultView,
      }));
    }
  }

  function closeMenu(documentRef, control) {
    const event = new KeyboardEvent('keydown', {
      key: 'Escape',
      code: 'Escape',
      bubbles: true,
      cancelable: true,
    });
    documentRef.defaultView?.dispatchEvent?.(event);
    documentRef.dispatchEvent(event);

    // Sheets may handle Escape on a different event target. If the menu is
    // still open, toggle it closed through the same control used to open it.
    if (control && getMenuItems(documentRef).length > 0) control.click();
  }

  async function readAllSheetsMenu(documentRef) {
    const control = findAllSheetsControl(documentRef);
    if (!control) return [];

    control.click();
    await wait(120);
    try {
      return getMenuItems(documentRef);
    } finally {
      closeMenu(documentRef, control);
    }
  }

  function mergeNames(...groups) {
    const result = [];
    const seen = new Set();
    for (const group of groups) {
      for (const item of group) {
        if (seen.has(item.key)) continue;
        seen.add(item.key);
        result.push(item);
      }
    }
    return result;
  }

  function createSheetsAdapter(documentRef = document) {
    async function getSheets() {
      const visible = getVisibleSheetNames(documentRef);
      const menu = await readAllSheetsMenu(documentRef);
      const sheets = mergeNames(visible, menu);
      if (!sheets.length) {
        const error = new Error('シート一覧を取得できませんでした。Google Sheetsを再読み込みしてください。');
        error.code = 'SHEETS_NOT_FOUND';
        throw error;
      }
      return { sheets, currentName: getCurrentSheetName(documentRef) };
    }

    async function activateSheet(name) {
      const target = normalize(name);
      const visibleElement = getVisibleTabElements(documentRef)
        .find((element) => isVisible(element) && normalize(getLabel(element)) === target);
      if (visibleElement) {
        clickLikeUser(visibleElement, documentRef);
        return;
      }

      const control = findAllSheetsControl(documentRef);
      if (control) {
        control.click();
        await wait(120);
        let activated = false;
        try {
          const menuElement = MENU_ITEM_SELECTORS
            .flatMap((selector) => [...documentRef.querySelectorAll(selector)])
            .find((element) => isVisible(element) && normalize(getLabel(element)) === target);
          if (menuElement) {
            clickLikeUser(menuElement, documentRef);
            activated = true;
            return;
          }
        } finally {
          if (!activated) closeMenu(documentRef, control);
        }
      }

      const error = new Error(`シート「${name}」が見つかりませんでした。`);
      error.code = 'SHEET_NOT_FOUND';
      throw error;
    }

    return { getSheets, activateSheet };
  }

  global.SheetFinder = global.SheetFinder || {};
  global.SheetFinder.createSheetsAdapter = createSheetsAdapter;
})(globalThis);

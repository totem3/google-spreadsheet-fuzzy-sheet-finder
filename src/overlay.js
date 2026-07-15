(function registerOverlay(global) {
  function createOverlayController({ documentRef = global.document, adapter, searchSheets, normalize }) {
    const stateApi = global.SheetFinder.overlayState;
    let state = stateApi.createState();
    let host;
    let shadow;
    let ui;
    let requestToken = 0;
    let view = { error: '', loading: false, moving: false };

    function ensureDom() {
      if (host) return;

      host = documentRef.createElement('div');
      host.id = 'sheet-finder-overlay-host';
      host.setAttribute('aria-live', 'polite');
      shadow = host.attachShadow({ mode: 'open' });

      const stylesheet = documentRef.createElement('link');
      stylesheet.rel = 'stylesheet';
      stylesheet.href = global.chrome?.runtime?.getURL?.('src/overlay.css') || '';
      shadow.append(stylesheet);

      const backdrop = documentRef.createElement('div');
      backdrop.className = 'backdrop';
      backdrop.innerHTML = `
        <section class="dialog" role="dialog" aria-modal="true" aria-labelledby="sheet-finder-title">
          <div class="dialog-header">
            <div class="heading-group">
              <span class="brand-mark" aria-hidden="true">↗</span>
              <div>
                <p class="eyebrow">SHEET FINDER</p>
                <h1 id="sheet-finder-title">シートへ移動</h1>
              </div>
            </div>
            <div class="header-actions">
              <button class="header-button refresh" type="button" aria-label="シート一覧を更新" title="更新">↻</button>
              <button class="header-button close" type="button" aria-label="閉じる" title="閉じる">Esc</button>
            </div>
          </div>

          <label class="search-box">
            <span class="search-icon" aria-hidden="true">⌕</span>
            <input type="search" autocomplete="off" placeholder="シート名を入力" aria-label="シート名を検索" aria-controls="sheet-finder-results">
            <kbd>↑↓</kbd>
          </label>

          <div class="result-meta">
            <p class="status" role="status" aria-live="polite"></p>
            <span class="meta-hint">Enterで移動</span>
          </div>
          <div id="sheet-finder-results" class="results" role="listbox" aria-label="シート検索結果"></div>
          <p class="empty" hidden></p>
        </section>`;
      shadow.append(backdrop);

      ui = {
        backdrop,
        close: backdrop.querySelector('.close'),
        dialog: backdrop.querySelector('.dialog'),
        empty: backdrop.querySelector('.empty'),
        input: backdrop.querySelector('input'),
        refresh: backdrop.querySelector('.refresh'),
        results: backdrop.querySelector('.results'),
        status: backdrop.querySelector('.status'),
      };

      backdrop.addEventListener('click', (event) => {
        if (event.target === backdrop) close();
      });
      ui.close.addEventListener('click', close);
      ui.refresh.addEventListener('click', requestSheets);
      ui.input.addEventListener('input', () => {
        state = { ...state, query: ui.input.value, selectedIndex: 0 };
        render();
      });
      ui.input.addEventListener('keydown', handleKeydown);
      ui.results.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-name]');
        if (button) activateSelected(button.dataset.name);
      });

      documentRef.body.append(host);
    }

    function handleKeydown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return;
      }

      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const results = getResults();
        const delta = event.key === 'ArrowDown' ? 1 : -1;
        state = stateApi.moveSelection(state, delta, results.length);
        render();
        return;
      }

      if (event.key === 'Enter') {
        if (!stateApi.shouldCommitSelection(event)) return;
        event.preventDefault();
        const result = getResults()[state.selectedIndex];
        if (result) activateSelected(result.name);
      }
    }

    function getResults() {
      return searchSheets(state.sheets.map((sheet) => sheet.name), state.query);
    }

    function render() {
      if (!ui) return;

      const results = getResults();
      state = {
        ...state,
        selectedIndex: Math.min(state.selectedIndex, Math.max(0, results.length - 1)),
      };
      ui.input.value = state.query;
      ui.input.setAttribute('aria-activedescendant', results[state.selectedIndex] ? `sheet-result-${state.selectedIndex}` : '');
      ui.results.replaceChildren();
      ui.empty.hidden = results.length !== 0;
      ui.empty.textContent = view.error || (state.sheets.length ? '一致するシートがありません' : 'シート一覧がありません');

      for (const [index, result] of results.entries()) {
        const button = documentRef.createElement('button');
        button.type = 'button';
        button.className = 'result';
        button.dataset.name = result.name;
        button.id = `sheet-result-${index}`;
        button.setAttribute('role', 'option');
        button.setAttribute('aria-selected', String(index === state.selectedIndex));
        if (index === state.selectedIndex) button.classList.add('is-selected');
        if (normalize(result.name) === normalize(state.currentName)) button.classList.add('is-current');

        const indexLabel = documentRef.createElement('span');
        indexLabel.className = 'result-index';
        indexLabel.textContent = String(index + 1).padStart(2, '0');
        const name = documentRef.createElement('span');
        name.className = 'result-name';
        name.textContent = result.name;
        button.append(indexLabel, name);
        ui.results.append(button);
      }

      ui.status.dataset.tone = view.error ? 'error' : 'normal';
      ui.status.textContent = view.error || (view.loading ? 'シート一覧を読み込み中…' : view.moving ? '移動中…' : `${results.length}件のシート`);
      ui.refresh.disabled = view.loading || view.moving;
      ui.close.disabled = view.moving;
    }

    async function requestSheets() {
      if (!state.open) return;
      const token = ++requestToken;
      view = { error: '', loading: true, moving: false };
      render();

      try {
        const response = await adapter.getSheets();
        if (!state.open || token !== requestToken) return;
        state = stateApi.open(state, response.sheets || [], response.currentName);
        view = { error: '', loading: false, moving: false };
        render();
        ui.input.focus();
      } catch (error) {
        if (!state.open || token !== requestToken) return;
        view = {
          error: error?.message || 'シート一覧を取得できませんでした。Google Sheetsを再読み込みしてください。',
          loading: false,
          moving: false,
        };
        render();
        ui.input.focus();
      }
    }

    async function activateSelected(name) {
      if (view.loading || view.moving) return;
      view = { error: '', loading: false, moving: true };
      render();

      try {
        await adapter.activateSheet(name);
        close();
      } catch (error) {
        view = {
          error: error?.message || 'シートへ移動できませんでした。',
          loading: false,
          moving: false,
        };
        render();
      }
    }

    function open() {
      if (state.open) return;
      ensureDom();
      state = stateApi.open(state, [], null);
      view = { error: '', loading: true, moving: false };
      render();
      ui.input.focus();
      requestSheets();
    }

    function close() {
      requestToken += 1;
      state = stateApi.close(state);
      view = { error: '', loading: false, moving: false };
      host?.remove();
      host = undefined;
      shadow = undefined;
      ui = undefined;
    }

    function toggle() {
      if (state.open) close();
      else open();
    }

    return {
      close,
      isOpen: () => state.open,
      open,
      refresh: requestSheets,
      toggle,
    };
  }

  global.SheetFinder = global.SheetFinder || {};
  global.SheetFinder.createOverlayController = createOverlayController;
})(globalThis);

(function registerOverlayState(global) {
  function createState() {
    return {
      open: false,
      sheets: [],
      currentName: null,
      previousName: null,
      query: '',
      selectedIndex: 0,
    };
  }

  function normalize(value) {
    return String(value ?? '').normalize('NFKC').trim().toLocaleLowerCase('ja-JP');
  }

  function observeCurrentSheet(state, currentName) {
    const nextKey = normalize(currentName);
    if (!nextKey || nextKey === normalize(state.currentName)) return state;
    return {
      ...state,
      currentName,
      previousName: state.currentName || null,
    };
  }

  function findSheetIndex(sheets, name) {
    const target = normalize(name);
    if (!target) return -1;
    return sheets.findIndex((sheet) => normalize(sheet.name) === target);
  }

  function initialSelectedIndex(results, currentName, previousName) {
    const previousIndex = findSheetIndex(results, previousName);
    if (previousIndex >= 0) return previousIndex;
    const currentIndex = findSheetIndex(results, currentName);
    return currentIndex >= 0 ? currentIndex : 0;
  }

  function open(state, sheets, currentName, orderedResults = sheets) {
    const observed = observeCurrentSheet(state, currentName);
    return {
      ...observed,
      open: true,
      sheets: [...sheets],
      query: '',
      selectedIndex: initialSelectedIndex(orderedResults, observed.currentName, observed.previousName),
    };
  }

  function close(state) {
    return {
      ...state,
      open: false,
      query: '',
      selectedIndex: 0,
    };
  }

  function moveSelection(state, delta, resultCount) {
    if (!resultCount) return { ...state, selectedIndex: 0 };
    return {
      ...state,
      selectedIndex: (state.selectedIndex + delta + resultCount) % resultCount,
    };
  }

  function shouldCommitSelection(event) {
    return !event?.isComposing && event?.keyCode !== 229;
  }

  global.SheetFinder = global.SheetFinder || {};
  global.SheetFinder.overlayState = {
    close,
    createState,
    initialSelectedIndex,
    moveSelection,
    observeCurrentSheet,
    open,
    shouldCommitSelection,
  };
})(globalThis);

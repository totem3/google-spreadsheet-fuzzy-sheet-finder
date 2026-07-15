(function registerOverlayState(global) {
  function createState() {
    return {
      open: false,
      sheets: [],
      currentName: null,
      query: '',
      selectedIndex: 0,
    };
  }

  function open(state, sheets, currentName) {
    return {
      ...state,
      open: true,
      sheets: [...sheets],
      currentName: currentName || null,
      query: '',
      selectedIndex: 0,
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
    moveSelection,
    open,
    shouldCommitSelection,
  };
})(globalThis);

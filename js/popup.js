'use strict';
/* Requires js/common.js */

/*** CONSTANTS ***/
const ERROR_COLOR = '#ff8989';
const WHITE_COLOR = '#ffffff';
const ERROR_TEXT = "Content script was not loaded. Are you currently in the Chrome Web Store or in a chrome:// page? If you are, content scripts won't work here. If not, please wait for the page to finish loading or refresh the page.";
const UNSUPPORTED_TEXT = "This browser doesn't support the CSS Custom Highlight API, which this extension needs (Chrome 105 or newer).";
const SHOW_HISTORY_TITLE = 'Show search history (Alt+H)';
const HIDE_HISTORY_TITLE = 'Hide search history (Alt+H)';
const HISTORY_IS_EMPTY_TEXT = 'Search history is empty.';
const CLEAR_ALL_HISTORY_TEXT = 'Clear History';
const CLEAR_CONFIRM_MS = 2000;

const svg = (body) => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const EYE = '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>';
const ICONS = {
  up: svg('<polyline points="18 15 12 9 6 15"/>'),
  down: svg('<polyline points="6 9 12 15 18 9"/>'),
  remove: svg('<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>'),
  visible: svg(EYE),
  all: svg(EYE + '<line x1="2" y1="2" x2="22" y2="22" stroke-dasharray="3 3"/>'),
  hidden: svg('<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>')
};
const VISIBILITY_TITLES = {
  visible: 'Searching visible text only. Click to search all text (Alt+V)',
  all: 'Searching all text, including hidden. Click to search hidden text only (Alt+V)',
  hidden: 'Searching hidden text only. Click to search visible text only (Alt+V)'
};
/*** CONSTANTS ***/

/*** ELEMENTS ***/
const searchesEl = document.getElementById('searches');
const historyEl = document.getElementById('history');
const historyButton = document.getElementById('show-history');
const shortcutsEl = document.getElementById('shortcuts');
const helpButton = document.getElementById('help');
const errorEl = document.getElementById('error');
const statusEl = document.getElementById('status');
/*** ELEMENTS ***/

/*** STATE ***/
let activeTabId = null;
let instantResults = DEFAULT_SETTINGS.instantResults;
let highlightColor = DEFAULT_SETTINGS.highlightColor;
// Options a new box starts with: the last ones chosen in any box.
let defaultOptions = {
  caseInsensitive: DEFAULT_SETTINGS.caseInsensitive,
  visibility: DEFAULT_SETTINGS.visibilityMode
};
let searchHistory = [];
let maxHistoryLength = DEFAULT_SETTINGS.maxHistoryLength;
let clearHistoryArmedUntil = 0;
let statusTimer = null;

/*
 * One row per search box, keyed by id (0 = the first box, which can't be removed).
 * { id, el, input, countEl, caseButton, visibilityButton,
 *   caseInsensitive, visibility, optionsSet, userEdited, lastSentValue }
 *   optionsSet    – options came from the page or the user, so stored defaults don't override them
 *   userEdited    – once the user types, stop overwriting the input from the page
 *   lastSentValue – pattern the content script currently has for this box
 */
const rows = new Map();
let focusedRowId = 0;   // copy, history and Alt+I/Alt+V act on the box last focused
/*** STATE ***/

/*** HELPERS ***/
function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

function showError(text) {
  errorEl.textContent = text;
}

function showStatus(text) {
  clearTimeout(statusTimer);
  statusEl.textContent = text;
  statusTimer = setTimeout(() => { statusEl.textContent = ''; }, CLEAR_CONFIRM_MS);
}

/* Send a message to the active tab's content script */
function sendToTab(message, onResponse) {
  if (!activeTabId) return;
  chrome.tabs.sendMessage(activeTabId, message, (response) => {
    if (chrome.runtime.lastError || !response) {
      showError(ERROR_TEXT);
      return;
    }
    if (onResponse) onResponse(response);
  });
}

function focusedRow() {
  return rows.get(focusedRowId) || rows.get(0);
}

function iconButton(html, title, handler, className) {
  const button = document.createElement('a');
  button.href = '#';
  button.innerHTML = html;
  button.title = title;
  button.setAttribute('aria-label', title);
  if (className) button.classList.add(className);
  button.addEventListener('click', (e) => {
    e.preventDefault();
    handler();
  });
  return button;
}
/*** HELPERS ***/

/*** ROWS ***/
/* Build a search box. Rows are kept in id order so restored boxes line up. */
function createRow(id) {
  const el = document.createElement('div');
  el.className = 'flexContainer searchRow';
  el.dataset.id = String(id);

  const wrapper = document.createElement('div');
  wrapper.className = 'inputWrapper';
  const input = document.createElement('input');
  input.className = 'regexInput';
  input.type = 'text';
  input.placeholder = id === 0 ? 'Enter regex...' : 'Enter another regex...';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.setAttribute('aria-label', `Regular expression ${id + 1}`);
  const countEl = document.createElement('span');
  countEl.className = 'numResults';
  countEl.setAttribute('aria-live', 'polite');
  wrapper.append(input, countEl);

  const row = {
    id, el, input, countEl,
    caseInsensitive: defaultOptions.caseInsensitive,
    visibility: defaultOptions.visibility,
    optionsSet: false,
    userEdited: false,
    lastSentValue: null
  };

  row.caseButton = iconButton('Aa', '', () => toggleCase(row), 'caseButton');
  row.visibilityButton = iconButton('', '', () => cycleVisibility(row));
  const buttons = document.createElement('div');
  buttons.className = 'buttonGroup';
  buttons.append(
    row.caseButton,
    row.visibilityButton,
    iconButton(ICONS.up, 'Previous match (Shift+Enter)', () => selectPrev(row)),
    iconButton(ICONS.down, 'Next match (Enter)', () => selectNext(row)),
    id === 0
      ? iconButton(ICONS.remove, 'Clear this search', () => clearRow(row))
      : iconButton(ICONS.remove, 'Remove this search', () => removeRow(row))
  );
  el.append(wrapper, buttons);

  const next = [...searchesEl.children].find((child) => Number(child.dataset.id) > id);
  searchesEl.insertBefore(el, next || null);

  input.addEventListener('focus', () => { focusedRowId = id; });
  input.addEventListener('input', () => {
    row.userEdited = true;
    if (instantResults) passInputToContentScript(row);
  });

  rows.set(id, row);
  paintRow(row);
  renderOptions(row);
  return row;
}

function paintRow(row) {
  row.input.style.setProperty('--row-color', colorForSearch(row.id, highlightColor));
}

function renderOptions(row) {
  const caseTitle = row.caseInsensitive
    ? 'Case insensitive. Click for case sensitive (Alt+I)'
    : 'Case sensitive. Click for case insensitive (Alt+I)';
  row.caseButton.title = caseTitle;
  row.caseButton.setAttribute('aria-label', caseTitle);
  row.caseButton.classList.toggle('selected', row.caseInsensitive);
  row.caseButton.setAttribute('aria-pressed', String(row.caseInsensitive));

  const visibilityTitle = VISIBILITY_TITLES[row.visibility];
  row.visibilityButton.innerHTML = ICONS[row.visibility];
  row.visibilityButton.title = visibilityTitle;
  row.visibilityButton.setAttribute('aria-label', visibilityTitle);
  row.visibilityButton.classList.toggle('selected', row.visibility !== 'visible');
}

function addRow() {
  if (rows.size >= MAX_SEARCHES) {
    showStatus(`At most ${MAX_SEARCHES} searches at a time`);
    return;
  }
  let id = 1;
  while (rows.has(id)) id++;   // reuse the lowest free id so colors stay stable
  createRow(id).input.focus();
}

function removeRow(row) {
  sendToTab({ message: 'removeSearch', searchId: row.id });
  row.el.remove();
  rows.delete(row.id);
  rows.get(0).input.focus();
}

function clearRow(row) {
  row.input.value = '';
  row.userEdited = true;
  passInputToContentScript(row);
  row.input.focus();
}

function clearAll() {
  for (const row of [...rows.values()]) {
    if (row.id === 0) clearRow(row); else removeRow(row);
  }
}

function renderCount(row, info) {
  if (!info.regexString) {
    row.countEl.textContent = '';
  } else if (info.numResults > 0) {
    row.countEl.textContent = `${info.currentSelection + 1} of ${info.numResults}${info.truncated ? '+' : ''}`;
  } else {
    row.countEl.textContent = '0 of 0';
  }
}

/* Apply search state reported by the content script to a row */
function applySearchInfo(row, info) {
  if (!row.userEdited && row.input.value !== info.regexString) {
    row.input.value = info.regexString;
    row.lastSentValue = info.regexString;
    if (row.id === 0) row.input.select();
  }
  if (info.regexString !== row.input.value) return;   // stale result for an older pattern
  renderCount(row, info);
}
/*** ROWS ***/

/*** SEARCH ***/
function passInputToContentScript(row) {
  const regexString = row.input.value;
  row.input.style.backgroundColor = isValidRegex(regexString) ? WHITE_COLOR : ERROR_COLOR;
  if (!activeTabId) return;
  row.lastSentValue = regexString;
  sendToTab({
    message: 'search',
    searchId: row.id,
    regexString: regexString,
    caseInsensitive: row.caseInsensitive,
    visibility: row.visibility
  });
}

function selectNext(row) {
  sendToTab({ message: 'selectNextNode', searchId: row.id });
}

function selectPrev(row) {
  sendToTab({ message: 'selectPrevNode', searchId: row.id });
}

/* Apply a changed option: redraw, remember it for new boxes, and re-run this box's search */
function optionsChanged(row) {
  row.optionsSet = true;
  renderOptions(row);
  defaultOptions = { caseInsensitive: row.caseInsensitive, visibility: row.visibility };
  chrome.storage.local.set({ caseInsensitive: row.caseInsensitive, visibilityMode: row.visibility });
  passInputToContentScript(row);
}

function toggleCase(row) {
  row.caseInsensitive = !row.caseInsensitive;
  optionsChanged(row);
}

function cycleVisibility(row) {
  row.visibility = VISIBILITY_MODES[(VISIBILITY_MODES.indexOf(row.visibility) + 1) % VISIBILITY_MODES.length];
  optionsChanged(row);
}

function copyToClipboard() {
  sendToTab({ message: 'copyToClipboard', searchId: focusedRow().id }, (response) => {
    if (!response.count) {
      showStatus('No matches to copy');
      return;
    }
    navigator.clipboard.writeText(response.text).then(
      () => showStatus(`Copied ${response.count} match${response.count === 1 ? '' : 'es'}`),
      () => showStatus('Could not copy to clipboard')
    );
  });
}
/*** SEARCH ***/

/*** HISTORY ***/
function saveHistory() {
  chrome.storage.local.set({ searchHistory: searchHistory });
  updateHistoryDiv();
}

function createHistoryLineElement(text) {
  const deleteEntrySpan = document.createElement('span');
  deleteEntrySpan.className = 'historyDeleteEntry';
  deleteEntrySpan.textContent = '✕';
  deleteEntrySpan.title = 'Remove from history';
  deleteEntrySpan.addEventListener('click', () => {
    searchHistory = searchHistory.filter((entry) => entry !== text);
    saveHistory();
  });

  const linkSpan = document.createElement('span');
  linkSpan.className = 'historyLink';
  linkSpan.textContent = text;
  linkSpan.title = 'Search for this in the last focused box';
  linkSpan.addEventListener('click', () => {
    const row = focusedRow();
    if (row.input.value !== text) {
      row.input.value = text;
      row.userEdited = true;
      passInputToContentScript(row);
    }
    row.input.focus();
  });

  const lineDiv = document.createElement('div');
  lineDiv.appendChild(deleteEntrySpan);
  lineDiv.appendChild(linkSpan);
  return lineDiv;
}

function updateHistoryDiv() {
  historyEl.textContent = '';
  if (searchHistory.length === 0) {
    const span = document.createElement('span');
    span.className = 'historyIsEmptyMessage';
    span.textContent = HISTORY_IS_EMPTY_TEXT;
    historyEl.appendChild(span);
    return;
  }
  for (let i = searchHistory.length - 1; i >= 0; i--) {
    historyEl.appendChild(createHistoryLineElement(searchHistory[i]));
  }
  const clearButton = document.createElement('a');
  clearButton.href = '#';
  clearButton.textContent = CLEAR_ALL_HISTORY_TEXT;
  clearButton.className = 'clearHistoryButton';
  clearButton.addEventListener('click', (e) => {
    e.preventDefault();
    clearSearchHistory();
  });
  historyEl.appendChild(clearButton);
}

function addToHistory(regex) {
  if (!regex) return;
  searchHistory = searchHistory.filter((entry) => entry !== regex);
  searchHistory.push(regex);
  if (searchHistory.length > maxHistoryLength) {
    searchHistory.splice(0, searchHistory.length - maxHistoryLength);
  }
  saveHistory();
}

function clearSearchHistory() {
  searchHistory = [];
  saveHistory();
}

/* Alt+X must be pressed twice within a short window, since it can't be undone */
function requestClearHistory() {
  const now = Date.now();
  if (now < clearHistoryArmedUntil) {
    clearHistoryArmedUntil = 0;
    clearSearchHistory();
    showStatus('Search history cleared');
  } else {
    clearHistoryArmedUntil = now + CLEAR_CONFIRM_MS;
    showStatus('Press Alt+X again to clear search history');
  }
}

function setHistoryVisibility(makeVisible) {
  historyEl.style.display = makeVisible ? 'block' : 'none';
  historyButton.title = makeVisible ? HIDE_HISTORY_TITLE : SHOW_HISTORY_TITLE;
  historyButton.className = makeVisible ? 'selected' : '';
  historyButton.setAttribute('aria-expanded', String(makeVisible));
}

function toggleHistoryVisibility() {
  const makeVisible = historyEl.style.display !== 'block';
  setHistoryVisibility(makeVisible);
  chrome.storage.local.set({ isSearchHistoryVisible: makeVisible });
}

function toggleHelp() {
  const makeVisible = shortcutsEl.style.display !== 'block';
  shortcutsEl.style.display = makeVisible ? 'block' : 'none';
  helpButton.className = makeVisible ? 'selected' : '';
  helpButton.setAttribute('aria-expanded', String(makeVisible));
}
/*** HISTORY ***/

/*** LISTENERS ***/
function onClick(id, handler) {
  document.getElementById(id).addEventListener('click', (e) => {
    e.preventDefault();
    handler();
  });
}

onClick('add-search', addRow);
onClick('copy-to-clipboard', copyToClipboard);
onClick('clear-all', clearAll);
onClick('show-history', toggleHistoryVisibility);
onClick('help', toggleHelp);

/* Search results from the content script */
chrome.runtime.onMessage.addListener((request, sender) => {
  if (request.message !== 'returnSearchInfo') return;
  if (!sender.tab || sender.tab.id !== activeTabId) return;   // ignore background tabs
  const row = rows.get(request.searchId);
  if (!row) return;
  applySearchInfo(row, request);
  if (request.numResults > 0 && request.cause === 'selectNode' && request.regexString === row.input.value) {
    addToHistory(request.regexString);
  }
});

window.addEventListener('keydown', (e) => {
  const row = [...rows.values()].find((r) => r.input === document.activeElement);
  if (e.key === 'Enter' && row) {
    if (e.shiftKey) {
      selectPrev(row);
    } else if (row.input.value !== row.lastSentValue) {
      passInputToContentScript(row);
    } else {
      selectNext(row);
    }
    e.preventDefault();
    return;
  }

  if (e.altKey) {
    const actions = {
      i: () => toggleCase(focusedRow()),
      v: () => cycleVisibility(focusedRow()),
      n: addRow,
      c: copyToClipboard,
      x: requestClearHistory,
      h: toggleHistoryVisibility,
      s: toggleHelp
    };
    const action = actions[e.key.toLowerCase()];
    if (action) {
      action();
      e.preventDefault();
    }
  }
});
/*** LISTENERS ***/

/*** INIT ***/
const mainRow = createRow(0);

chrome.storage.local.get({
  ...DEFAULT_SETTINGS,
  searchHistory: [],
  isSearchHistoryVisible: false
}, (result) => {
  instantResults = result.instantResults;
  highlightColor = result.highlightColor;
  defaultOptions = {
    caseInsensitive: !!result.caseInsensitive,
    visibility: VISIBILITY_MODES.includes(result.visibilityMode) ? result.visibilityMode : 'visible'
  };
  for (const row of rows.values()) {
    paintRow(row);
    if (!row.optionsSet) {
      row.caseInsensitive = defaultOptions.caseInsensitive;
      row.visibility = defaultOptions.visibility;
      renderOptions(row);
    }
  }
  const parsedMax = parseInt(result.maxHistoryLength, 10);
  maxHistoryLength = Number.isInteger(parsedMax) && parsedMax >= 0 ? parsedMax : DEFAULT_SETTINGS.maxHistoryLength;
  searchHistory = Array.isArray(result.searchHistory) ? result.searchHistory.slice() : [];
  setHistoryVisibility(result.isSearchHistoryVisible);
  updateHistoryDiv();
});

/* Find the active tab and restore its search boxes */
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || !tab.id) {
    showError(ERROR_TEXT);
    return;
  }
  activeTabId = tab.id;
  sendToTab({ message: 'getSearchInfo' }, (response) => {
    if (response.supported === false) {
      showError(UNSUPPORTED_TEXT);
      return;
    }
    for (const info of response.searches || []) {
      if (info.searchId >= MAX_SEARCHES) continue;
      const row = rows.get(info.searchId) || createRow(info.searchId);
      row.caseInsensitive = !!info.caseInsensitive;
      row.visibility = VISIBILITY_MODES.includes(info.visibility) ? info.visibility : 'visible';
      row.optionsSet = true;
      renderOptions(row);
      applySearchInfo(row, info);
    }
  });
});

/* Focus the first input and select its text */
mainRow.input.focus();
window.setTimeout(() => mainRow.input.select(), 0);
//Thanks to http://stackoverflow.com/questions/480735#comment40578284_14573552
/*** INIT ***/

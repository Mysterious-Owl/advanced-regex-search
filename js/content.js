'use strict';
/* Requires js/common.js (loaded first via manifest.json). */

/*** CONSTANTS ***/
// Elements whose contents are never searched (not rendered as text, or not stylable).
const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'SVG', 'MATH', 'AUDIO', 'VIDEO',
  'CANVAS', 'IFRAME', 'OBJECT', 'SELECT', 'INPUT', 'TEXTAREA'
]);
const MAX_SEARCH_MS = 1500;       // stop collecting matches for one query after this long
const REFRESH_DELAY_MS = 500;     // debounce for re-searching after DOM changes
const REFRESH_MAX_WAIT_MS = 2000;
const HEX_COLOR = /^#[0-9a-f]{6}$/i;
const BLOCK_END = {};             // marker pushed on the traversal stack
const SEARCH_SETTINGS = ['maxResults'];
const COLOR_SETTINGS = ['highlightColor', 'selectedColor', 'textColor'];
/*** CONSTANTS ***/

/*** STATE ***/
const highlightSupported =
  typeof Highlight === 'function' && typeof CSS !== 'undefined' && !!CSS.highlights;
const selectedHighlight = highlightSupported ? new Highlight() : null;
if (highlightSupported) {
  selectedHighlight.priority = 1000;   // the selected match wins over every query's color
  CSS.highlights.set('regex-search-selected', selectedHighlight);
}

/*
 * One entry per search box in the popup, keyed by the box's id (0 = the main box).
 * { id, regexString, caseInsensitive, visibility, regex, selectedIndex, ranges, texts, truncated, highlight }
 * visibility is one of VISIBILITY_MODES ('visible', 'all', 'hidden').
 */
const searches = new Map();
let activeSearchId = 0;   // the query whose selected match is shown
let settings = { ...DEFAULT_SETTINGS };
let settingsLoaded = false;
const settingsReady = chrome.storage.local.get(DEFAULT_SETTINGS).then((result) => {
  settings = result;
  settingsLoaded = true;
});
let styleEl = null;
let refreshTimer = null;
let refreshPendingSince = 0;
const observer = new MutationObserver(scheduleRefresh);
/*** STATE ***/

/* Run fn now if settings are loaded, otherwise once they are (preserving order) */
function whenReady(fn) {
  if (settingsLoaded) fn(); else settingsReady.then(fn);
}

/*** STYLES ***/
function safeColor(value, fallback) {
  return HEX_COLOR.test(value) ? value : fallback;
}

/* Write one ::highlight rule per query, plus the selected-match rule */
function applyStyles() {
  if (!styleEl) {
    styleEl = document.createElement('style');
    styleEl.id = 'regex-search-styles';
  }
  if (!styleEl.isConnected) {
    (document.head || document.documentElement).appendChild(styleEl);
  }
  const textColor = safeColor(settings.textColor, DEFAULT_SETTINGS.textColor);
  const highlightColor = safeColor(settings.highlightColor, DEFAULT_SETTINGS.highlightColor);
  const selectedColor = safeColor(settings.selectedColor, DEFAULT_SETTINGS.selectedColor);
  const rules = [...searches.keys()].map((id) =>
    `::highlight(regex-search-${id}) { background-color: ${colorForSearch(id, highlightColor)}; color: ${textColor}; }`
  );
  rules.push(`::highlight(regex-search-selected) { background-color: ${selectedColor}; color: ${textColor}; }`);
  styleEl.textContent = rules.join('\n');
}
/*** STYLES ***/

/*** TEXT COLLECTION ***/
function searchRoot() {
  return document.body || document.documentElement;
}

/*
 * Flatten the text under `root` into one string so matches can span inline
 * elements (e.g. "fo<b>o</b>"). Block boundaries and <br> become "\n" so matches
 * don't run across paragraphs. `mode` picks which text is included:
 *   'visible' – rendered text only (hidden subtrees aren't even visited)
 *   'hidden'  – only text hidden by display/visibility/content-visibility or a closed <details>
 *   'all'     – both
 * Returns the string plus segments mapping string offsets back to text nodes.
 */
function collectText(root, mode) {
  const includeHidden = mode !== 'visible';
  const segments = [];
  let text = '';
  const breakLine = () => {
    if (text.length && text[text.length - 1] !== '\n') text += '\n';
  };

  // Parallel stacks: the node to visit, and whether it sits in hidden content.
  const stack = [root];
  const hiddenStack = [false];
  while (stack.length) {
    const item = stack.pop();
    const hidden = hiddenStack.pop();
    if (item === BLOCK_END) {
      breakLine();
      continue;
    }
    if (item.nodeType === Node.TEXT_NODE) {
      const wanted = mode === 'all' || (mode === 'hidden') === hidden;
      if (!wanted) {
        // In hidden-only mode, skipped visible text separates the hidden runs around it.
        if (mode === 'hidden') breakLine();
        continue;
      }
      const value = item.nodeValue;
      if (value) {
        segments.push({ node: item, start: text.length, end: text.length + value.length });
        text += value;
      }
      continue;
    }
    if (item.nodeType !== Node.ELEMENT_NODE) continue;

    const tag = item.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) continue;
    if (tag === 'BR') {
      breakLine();
      continue;
    }

    const style = getComputedStyle(item);
    const display = style.display;
    const selfHidden = display === 'none' || style.contentVisibility === 'hidden';
    if (selfHidden && !includeHidden) continue;
    const elementHidden = hidden || selfHidden;

    const isInline = display === 'inline' || display === 'contents' || display.startsWith('ruby');
    if (!isInline) {
      breakLine();
      stack.push(BLOCK_END);
      hiddenStack.push(false);
    }
    // visibility is inherited but can be overridden by descendants, so it only
    // hides this element's own text; child elements check their own style.
    const textHidden = elementHidden || style.visibility === 'hidden' || style.visibility === 'collapse';
    // A closed <details> only renders its <summary>.
    const closedDetails = tag === 'DETAILS' && !item.open;
    for (let child = item.lastChild; child; child = child.previousSibling) {
      let childHidden = child.nodeType === Node.TEXT_NODE ? textHidden : elementHidden;
      if (closedDetails && !(child.nodeType === Node.ELEMENT_NODE && child.tagName === 'SUMMARY')) {
        childHidden = true;
      }
      if (childHidden && !includeHidden) continue;
      stack.push(child);
      hiddenStack.push(childHidden);
    }
  }
  return { text, segments };
}

/* Index of the first segment whose end is after `offset` */
function firstSegmentEndingAfter(segments, offset) {
  let lo = 0, hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].end > offset) hi = mid; else lo = mid + 1;
  }
  return lo;
}

/* Index of the last segment whose start is before `offset` */
function lastSegmentStartingBefore(segments, offset) {
  let lo = 0, hi = segments.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start < offset) lo = mid + 1; else hi = mid;
  }
  return lo - 1;
}

/* Build a DOM Range for [start, end) of the flattened text, or null if it only covers separators */
function rangeFor(segments, start, end) {
  const i = firstSegmentEndingAfter(segments, start);
  const j = lastSegmentStartingBefore(segments, end);
  if (i >= segments.length || j < i) return null;
  const first = segments[i];
  const last = segments[j];
  const range = new Range();
  range.setStart(first.node, Math.max(0, start - first.start));
  range.setEnd(last.node, Math.min(end - last.start, last.node.length));
  return range;
}

/* Find matches of `regex` (must have the g flag) in the flattened text */
function findRanges(regex, flat) {
  const { text, segments } = flat;
  const maxResults = Number(settings.maxResults) || DEFAULT_SETTINGS.maxResults;
  const ranges = [];
  const texts = [];   // matched text; a range's toString() would include hidden text it spans
  const deadline = performance.now() + MAX_SEARCH_MS;
  let truncated = false;
  let match;

  regex.lastIndex = 0;
  while ((match = regex.exec(text)) !== null) {
    if (match[0].length === 0) {   // zero-width match: nothing to highlight
      regex.lastIndex++;
      continue;
    }
    const range = rangeFor(segments, match.index, match.index + match[0].length);
    if (range) {
      ranges.push(range);
      texts.push(match[0]);
    }
    if (ranges.length >= maxResults || performance.now() > deadline) {
      truncated = true;
      break;
    }
  }
  return { ranges, texts, truncated };
}
/*** TEXT COLLECTION ***/

/*** SEARCHES ***/
function totalResults() {
  let total = 0;
  for (const s of searches.values()) total += s.ranges.length;
  return total;
}

function anyTruncated() {
  for (const s of searches.values()) if (s.truncated) return true;
  return false;
}

function returnSearchInfo(s, cause) {
  try {
    chrome.runtime.sendMessage({
      message: 'returnSearchInfo',
      searchId: s.id,
      regexString: s.regexString,
      currentSelection: s.selectedIndex,
      numResults: s.ranges.length,
      truncated: s.truncated,
      totalResults: totalResults(),
      anyTruncated: anyTruncated(),
      cause: cause
    }).catch(() => { /* nobody listening */ });
  } catch (e) {
    // Extension was reloaded; this content script is orphaned.
    observer.disconnect();
  }
}

function getSearch(id) {
  let s = searches.get(id);
  if (!s) {
    s = {
      id, regexString: '', caseInsensitive: false, visibility: 'visible',
      regex: null, selectedIndex: 0, ranges: [], texts: [], truncated: false, highlight: new Highlight()
    };
    searches.set(id, s);
    CSS.highlights.set(`regex-search-${id}`, s.highlight);
    applyStyles();
  }
  return s;
}

function setRanges(s, result) {
  s.ranges = result.ranges;
  s.texts = result.texts;
  s.truncated = result.truncated;
  s.highlight.clear();
  for (const range of s.ranges) s.highlight.add(range);
}

function clearSearch(s, regexString) {
  s.regexString = regexString;
  s.regex = null;
  s.selectedIndex = 0;
  setRanges(s, { ranges: [], texts: [], truncated: false });
  if (s.id === activeSearchId) selectedHighlight.clear();
}

function buildRegex(s) {
  return new RegExp(s.regexString, s.caseInsensitive ? 'gmi' : 'gm');
}

/* Flattened text per visibility mode, computed lazily and shared within one pass */
function flatTextCache() {
  const cache = new Map();
  return (mode) => {
    if (!cache.has(mode)) cache.set(mode, collectText(searchRoot(), mode));
    return cache.get(mode);
  };
}

function isValidRegex(pattern) {
  try {
    new RegExp(pattern);
    return true;
  } catch (e) {
    return false;
  }
}

/* Open any closed <details> around the range so a hidden match becomes visible */
function revealRange(range) {
  for (let el = range.startContainer.parentElement; el; el = el.parentElement) {
    if (el.tagName === 'DETAILS' && !el.open) el.open = true;
  }
}

/* Scroll so the given range is visible, including inside scrollable containers */
function scrollToRange(range, s) {
  const element = range.startContainer.parentElement;
  if (!element) return;
  if (s.visibility !== 'visible') revealRange(range);
  if (element.getBoundingClientRect().height <= window.innerHeight) {
    element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'smooth' });
  } else {
    // Element taller than the viewport: centering it could hide the match, so scroll to the match itself.
    const rect = range.getBoundingClientRect();
    window.scrollTo({
      top: window.scrollY + rect.top - window.innerHeight / 2,
      behavior: 'smooth'
    });
  }
}

/* Show the selected match of the active query */
function showSelection(scroll) {
  selectedHighlight.clear();
  const s = searches.get(activeSearchId);
  const range = s && s.ranges[s.selectedIndex];
  if (range) {
    selectedHighlight.add(range);
    if (scroll) scrollToRange(range, s);
  }
}

function selectRange(id, getNext) {
  const s = searches.get(id);
  if (!s || s.ranges.length === 0) return;
  const length = s.ranges.length;
  if (id === activeSearchId) {
    s.selectedIndex = (s.selectedIndex + (getNext ? 1 : -1) + length) % length;
  }
  // Switching to another query just shows its current selection first.
  activeSearchId = id;
  showSelection(true);
  returnSearchInfo(s, 'selectNode');
}

function updateObserver() {
  const active = [...searches.values()].some((s) => s.regex);
  observer.disconnect();
  if (active) {
    observer.observe(searchRoot(), { childList: true, subtree: true, characterData: true });
  } else {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
}

function search(id, regexString, options) {
  const s = getSearch(id);
  const caseInsensitive = !!(options && options.caseInsensitive);
  const visibility = options && VISIBILITY_MODES.includes(options.visibility) ? options.visibility : 'visible';
  const optionsChanged = caseInsensitive !== s.caseInsensitive || visibility !== s.visibility;
  s.caseInsensitive = caseInsensitive;
  s.visibility = visibility;

  const valid = typeof regexString === 'string' && regexString !== '' && isValidRegex(regexString);
  if (!valid) {
    clearSearch(s, typeof regexString === 'string' ? regexString : '');
    updateObserver();
    returnSearchInfo(s, 'search');
    return;
  }
  if (!optionsChanged && regexString === s.regexString && s.regex) {
    selectRange(id, true);   // same pattern again: step to the next match
    return;
  }

  s.regexString = regexString;
  s.regex = buildRegex(s);
  s.selectedIndex = 0;
  setRanges(s, findRanges(s.regex, collectText(searchRoot(), s.visibility)));
  activeSearchId = id;
  showSelection(true);
  updateObserver();
  returnSearchInfo(s, 'search');
}

function removeSearch(id) {
  const s = searches.get(id);
  if (!s) return;
  s.highlight.clear();
  CSS.highlights.delete(`regex-search-${id}`);
  searches.delete(id);
  applyStyles();
  if (id === activeSearchId) selectedHighlight.clear();
  updateObserver();
  returnSearchInfo({ ...s, ranges: [], truncated: false }, 'remove');
}

/*
 * Re-run every active query against the current page. With `reportAll` (after a
 * settings change) every query reports back; otherwise only those whose count changed.
 */
function rerunAll(reportAll) {
  const active = [...searches.values()].filter((s) => s.regex);
  if (active.length === 0) return;
  const flatText = flatTextCache();   // queries with the same visibility mode share one pass
  const changed = [];
  for (const s of active) {
    const previousCount = s.ranges.length;
    setRanges(s, findRanges(s.regex, flatText(s.visibility)));
    s.selectedIndex = Math.min(s.selectedIndex, Math.max(0, s.ranges.length - 1));
    if (reportAll || s.ranges.length !== previousCount) changed.push(s);
  }
  showSelection(false);
  for (const s of changed) returnSearchInfo(s, 'refresh');
}

/*
 * Debounce re-searching after DOM changes, but never wait longer than
 * REFRESH_MAX_WAIT_MS, so pages that change constantly (clocks, tickers) still refresh.
 */
function scheduleRefresh() {
  const now = performance.now();
  if (refreshTimer === null) refreshPendingSince = now;
  clearTimeout(refreshTimer);
  const wait = Math.min(REFRESH_DELAY_MS, Math.max(0, refreshPendingSince + REFRESH_MAX_WAIT_MS - now));
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    rerunAll(false);
  }, wait);
}
/*** SEARCHES ***/

/*** LISTENERS ***/
// Options-page changes (colors, max results) apply to the page right away.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  whenReady(() => {
    for (const key of Object.keys(changes)) {
      if (key in DEFAULT_SETTINGS) settings[key] = changes[key].newValue ?? DEFAULT_SETTINGS[key];
    }
    if (!highlightSupported) return;
    if (styleEl && COLOR_SETTINGS.some((key) => key in changes)) applyStyles();
    if (SEARCH_SETTINGS.some((key) => key in changes)) rerunAll(true);
  });
});

// Every message gets a response so the popup's callback never sees a closed-port error.
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (!highlightSupported) {
    sendResponse({ ok: true, supported: false, searches: [] });
    return;
  }
  const id = Number.isInteger(request.searchId) ? request.searchId : 0;
  switch (request.message) {
    case 'search':
      whenReady(() => search(id, request.regexString, request));
      sendResponse({ ok: true });
      break;
    case 'selectNextNode':
      selectRange(id, true);
      sendResponse({ ok: true });
      break;
    case 'selectPrevNode':
      selectRange(id, false);
      sendResponse({ ok: true });
      break;
    case 'removeSearch':
      removeSearch(id);
      sendResponse({ ok: true });
      break;
    case 'copyToClipboard': {
      const s = searches.get(id);
      const texts = s ? s.texts : [];
      sendResponse({ ok: true, count: texts.length, text: texts.join('\n') });
      break;
    }
    case 'getSearchInfo':
      sendResponse({
        ok: true,
        supported: true,
        searches: [...searches.values()].map((s) => ({
          searchId: s.id,
          regexString: s.regexString,
          caseInsensitive: s.caseInsensitive,
          visibility: s.visibility,
          currentSelection: s.selectedIndex,
          numResults: s.ranges.length,
          truncated: s.truncated
        }))
      });
      break;
  }
});
/*** LISTENERS ***/

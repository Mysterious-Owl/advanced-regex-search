/* Shared by the content script, popup and options page. */

// Which text a search looks at. The popup's eye button cycles through these in order.
const VISIBILITY_MODES = Object.freeze(['visible', 'all', 'hidden']);

const DEFAULT_SETTINGS = Object.freeze({
  highlightColor: '#ffff00',
  selectedColor: '#ff9900',
  textColor: '#000000',
  maxResults: 500,
  instantResults: true,
  maxHistoryLength: 30,
  // Starting options for a new search box; updated whenever a box's toggle is used.
  caseInsensitive: false,
  visibilityMode: 'visible'
});

// Highlight colors for the additional search boxes; the first box uses the highlightColor setting.
const EXTRA_SEARCH_COLORS = Object.freeze([
  '#7cfc8a', '#7fdbff', '#ff9ff3', '#c5a3ff', '#ffd27f', '#9fffe0', '#ff8a8a'
]);

const MAX_SEARCHES = 8;

function colorForSearch(id, highlightColor) {
  return id === 0 ? highlightColor : EXTRA_SEARCH_COLORS[(id - 1) % EXTRA_SEARCH_COLORS.length];
}

/*** CONSTANTS ***/
var ELEMENT_NODE_TYPE = 1;
var TEXT_NODE_TYPE = 3;
var UNEXPANDABLE = /(script|style|svg|audio|canvas|figure|video|select|input|textarea)/i;
var DEFAULT_MAX_RESULTS = 500;
var DEFAULT_HIGHLIGHT_COLOR = '#ffff00';
var DEFAULT_SELECTED_COLOR = '#ff9900';
var DEFAULT_TEXT_COLOR = '#000000';
var DEFAULT_CASE_INSENSITIVE = false;
/*** CONSTANTS ***/

/*** VARIABLES ***/
var searchInfo;
var resultsHighlight = new Highlight();
var selectedHighlight = new Highlight();
/*** VARIABLES ***/

/*** INIT API ***/
if (typeof CSS !== 'undefined' && CSS.highlights) {
  CSS.highlights.set('search-results', resultsHighlight);
  CSS.highlights.set('search-selected', selectedHighlight);
}

function injectStyles() {
  if (document.getElementById('regex-search-styles')) return;

  chrome.storage.local.get({
    'highlightColor': DEFAULT_HIGHLIGHT_COLOR,
    'selectedColor': DEFAULT_SELECTED_COLOR,
    'textColor': DEFAULT_TEXT_COLOR
  }).then((result) => {
    var style = document.createElement('style');
    style.id = 'regex-search-styles';
    style.textContent = `
      ::highlight(search-results) {
        background-color: ${result.highlightColor};
        color: ${result.textColor};
      }
      ::highlight(search-selected) {
        background-color: ${result.selectedColor};
        color: ${result.textColor};
      }
    `;
    document.head.appendChild(style);
  });
}
/*** INIT API ***/

/*** LIBRARY FUNCTIONS ***/
Element.prototype.documentOffsetTop = function () {
  return this.offsetTop + (this.offsetParent ? this.offsetParent.documentOffsetTop() : 0);
};
Element.prototype.visible = function () {
  return (!window.getComputedStyle(this) || window.getComputedStyle(this).getPropertyValue('display') == '' ||
    window.getComputedStyle(this).getPropertyValue('display') != 'none')
}
/*** LIBRARY FUNCTIONS ***/


/*** FUNCTIONS ***/
/* Initialize search information for this tab */
function initSearchInfo(pattern) {
  var pattern = typeof pattern !== 'undefined' ? pattern : '';
  searchInfo = {
    regexString: pattern,
    selectedIndex: 0,
    highlightedRanges: [], // Changed from nodes to ranges
    length: 0
  }
}

/* Send message with search information for this tab */
function returnSearchInfo(cause) {
  chrome.runtime.sendMessage({
    'message': 'returnSearchInfo',
    'regexString': searchInfo.regexString,
    'currentSelection': searchInfo.selectedIndex,
    'numResults': searchInfo.length,
    'cause': cause
  });
}

function updateStyles() {
  const styleEl = document.getElementById('regex-search-styles');
  if (styleEl) styleEl.remove();
  injectStyles();
}

/* Highlight all text that matches regex using Highlight API */
function highlight(regex, maxResults) {
  resultsHighlight.clear();
  selectedHighlight.clear();
  injectStyles();

  const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: function (node) {
      if (node.parentNode && UNEXPANDABLE.test(node.parentNode.tagName) || (node.parentNode && !node.parentNode.visible())) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    }
  });

  let node;
  while ((node = treeWalker.nextNode()) && searchInfo.length < maxResults) {
    const text = node.textContent;
    let match;
    // We need to use a loop with exec if global, but our regex might not be global
    // To find all matches in a node, we should ensure the regex is global or just use a loop
    const globalRegex = new RegExp(regex.source, regex.flags.includes('g') ? regex.flags : regex.flags + 'g');

    while ((match = globalRegex.exec(text)) !== null) {
      if (searchInfo.length >= maxResults) break;

      const range = new Range();
      range.setStart(node, match.index);
      range.setEnd(node, match.index + match[0].length);

      searchInfo.highlightedRanges.push(range);
      resultsHighlight.add(range);
      searchInfo.length += 1;

      if (globalRegex.lastIndex === match.index) {
        globalRegex.lastIndex++; // Avoid infinite loops for zero-width matches
      }
    }
  }
};

/* Remove all highlights from page */
function removeHighlight() {
  resultsHighlight.clear();
  selectedHighlight.clear();
  const styleEl = document.getElementById('regex-search-styles');
  if (styleEl) styleEl.remove();
};

/* Scroll page to given range */
function scrollToRange(range) {
  const rect = range.getBoundingClientRect();
  if (rect) {
    window.scrollTo({
      top: window.pageYOffset + rect.top - (window.innerHeight / 2),
      behavior: 'smooth'
    });
    // Try to focus parent
    const parent = range.commonAncestorContainer.parentElement;
    if (parent) parent.focus();
  }
}

/* Select first regex match on page */
function selectFirstRange() {
  if (searchInfo.length > 0) {
    selectedHighlight.clear();
    const firstRange = searchInfo.highlightedRanges[0];
    selectedHighlight.add(firstRange);
    scrollToRange(firstRange);
  }
}

/* Helper for selecting a regex matched element */
function selectRange(getNext) {
  var length = searchInfo.length;
  if (length > 0) {
    if (getNext) {
      if (searchInfo.selectedIndex === length - 1) {
        searchInfo.selectedIndex = 0;
      } else {
        searchInfo.selectedIndex += 1;
      }
    } else {
      if (searchInfo.selectedIndex === 0) {
        searchInfo.selectedIndex = length - 1;
      } else {
        searchInfo.selectedIndex -= 1;
      }
    }

    selectedHighlight.clear();
    const activeRange = searchInfo.highlightedRanges[searchInfo.selectedIndex];
    selectedHighlight.add(activeRange);

    returnSearchInfo('selectNode');
    scrollToRange(activeRange);
  }
}

/* Forward cycle through regex matched elements */
function selectNextRange() {
  selectRange(true);
}

/* Backward cycle through regex matched elements */
function selectPrevRange() {
  selectRange(false);
}

/* Validate that a given pattern string is a valid regex */
function validateRegex(pattern) {
  try {
    var regex = new RegExp(pattern);
    return regex;
  } catch (e) {
    return false;
  }
}

/* Find and highlight regex matches in web page from a given regex string or pattern */
function search(regexString, configurationChanged) {
  var regex = validateRegex(regexString);
  if (regex && regexString != '' && (configurationChanged || regexString !== searchInfo.regexString)) { // new valid regex string
    removeHighlight();
    if (configurationChanged) updateStyles();

    chrome.storage.local.get({
      'maxResults': DEFAULT_MAX_RESULTS,
      'caseInsensitive': DEFAULT_CASE_INSENSITIVE
    }).then((result) => {
      initSearchInfo(regexString);
      let flags = 'g';
      if (result.caseInsensitive) {
        flags += 'i';
      }
      const searchRegex = new RegExp(regexString, flags);

      highlight(searchRegex, result.maxResults);
      selectFirstRange();
      returnSearchInfo('search');
    });
  } else if (regex && regexString != '' && regexString === searchInfo.regexString) { // elements are already highlighted
    selectNextRange();
  } else { // blank string or invalid regex
    removeHighlight();
    initSearchInfo(regexString);
    returnSearchInfo('search');
  }
}
/*** FUNCTIONS ***/

/*** LISTENERS ***/
/* Received search message, find regex matches */
chrome.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if ('search' == request.message) {
    search(request.regexString, request.configurationChanged);
  }
  /* Received selectNextNode message, select next regex match */
  else if ('selectNextNode' == request.message) {
    selectNextRange();
  }
  /* Received selectPrevNode message, select previous regex match */
  else if ('selectPrevNode' == request.message) {
    selectPrevRange();
  }
  else if ('copyToClipboard' == request.message) {
    var clipboardHelper = document.createElement('textarea');
    try {
      var text = searchInfo.highlightedRanges.map(function (range) {
        return range.toString();
      }).join('\n');
      clipboardHelper.appendChild(document.createTextNode(text));
      document.body.appendChild(clipboardHelper);
      clipboardHelper.select();
      document.execCommand('copy');
    } finally {
      document.body.removeChild(clipboardHelper);
    }
  }
  /* Received getSearchInfo message, return search information for this tab */
  else if ('getSearchInfo' == request.message) {
    sendResponse({ message: "I'm alive!" });
    returnSearchInfo('getSearchInfo');
  }
});
/*** LISTENERS ***/


/*** INIT ***/
initSearchInfo();
/*** INIT ***/

/* Drop settings from older versions (searchHidden became a per-box visibility mode) */
chrome.runtime.onInstalled.addListener(function () {
  chrome.storage.local.remove('searchHidden');
});

/* Received returnSearchInfo message, set badge text with the total number of results across all queries */
chrome.runtime.onMessage.addListener(function (request, sender) {
  if (request.message === 'returnSearchInfo' && sender.tab) {
    const count = request.totalResults > 0
      ? String(request.totalResults) + (request.anyTruncated ? '+' : '')
      : '';
    chrome.action.setBadgeText({ text: count, tabId: sender.tab.id });
  }
});

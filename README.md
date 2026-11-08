# Advanced Regex Search

A Chrome extension that highlights regular-expression matches on the current page, in place of the built-in Ctrl+F.

Matches are highlighted with the [CSS Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/API/CSS_Custom_Highlight_API), so the page's DOM is never modified: no wrapper elements, no broken layouts or event handlers. Requires Chrome 105 or newer.

Based on [Chrome Regex Search](https://github.com/rogershen/chrome-regex-search) by Roger Shen.

## Features

- Highlights matches as you type, or on Enter if instant search is turned off.
- Up to 8 searches at once, each highlighted in its own color.
- Matches can span inline elements, e.g. `foo` in `fo<b>o</b>`.
- Per box: case-sensitive or case-insensitive, and one of three text modes: **visible only**, **all text**, or **hidden only**. Hidden means `display: none`, `visibility: hidden`, `content-visibility: hidden`, or the body of a closed `<details>`. `<script>`, `<style>` and form fields are never searched.
- Highlights update automatically when the page changes, and color changes in the options apply immediately.
- Copy a box's matches to the clipboard, search history.
- Total match count on the toolbar badge (`500+` means a result limit was reached).

## Installation (unpacked)

1. Open `chrome://extensions` and enable **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pages that were already open need a reload before the extension works on them.

## Usage

Open the popup with **Alt+Shift+F** (or click the toolbar icon) and type a JavaScript regular expression, without the surrounding slashes. The input turns red while the pattern is invalid.

How patterns are matched:

- Patterns run with the `g` and `m` flags, plus `i` when the box is case-insensitive.
- Each block element (paragraph, list item, table cell, …) and each `<br>` counts as a line break, so `^` and `$` match at the start and end of each line, and `.` never matches across blocks. A pattern that explicitly contains `\n` or `\s` can match across a block boundary.
- Zero-width patterns such as `\b` or `^` find nothing, since there is nothing to highlight.
- In the **all** and **hidden** modes, hidden matches are counted and included when copying, but most can't be shown or scrolled to. The exception is a match inside a closed `<details>`, which is opened when you jump to it.
- In **visible** mode, text hidden between two visible parts is ignored, so `visend` matches `vis<span hidden>ible</span>end`, as it reads on screen.
- Matching stops after the configured max results, or after 1.5 seconds, whichever comes first.

A pattern is added to the search history once you move between its matches (Enter, Shift+Enter or the arrow buttons). Click a history entry to search for it again in the box you last used.

### The popup

The top toolbar holds actions for the whole popup: **+** add a search box, **copy** the current box's matches, **clear all** searches, **history** and **help**.

Below it is one row per search box. Every row has:

| Control | What it does |
|---|---|
| Input | The pattern. The colored stripe on its left is the box's highlight color. The match count ("2 of 5") is shown inside it. |
| **Aa** | Case-insensitive when highlighted (blue), case-sensitive otherwise |
| Eye | Which text to search; click to cycle. Open eye = visible only (default). Eye with a dashed slash = all text. Crossed-out eye = hidden only. The button is blue in the two non-default modes. |
| ▲ / ▼ | Previous / next match |
| ✕ | Removes the box. On the first box, it clears the pattern instead. |

### Multiple searches

Click **+** (or press Alt+N) to add another search box below the existing ones, up to 8 in total. The first box uses the highlight color from the options, and the others use a fixed palette (green, blue, pink, purple, …). Enter and Shift+Enter move through the matches of the box you're typing in. The orange "selected" highlight follows the box you're navigating in.

A new box starts with the case and visibility settings you chose most recently in any box. **Copy**, clicking a history entry, Alt+I and Alt+V act on the box you last used. The boxes and their settings belong to the tab: closing and reopening the popup restores them, and reloading the page clears them.

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| Alt+Shift+F | Open the popup (change at `chrome://extensions/shortcuts`) |
| Enter | Search, or go to the next match if the pattern hasn't changed |
| Shift+Enter | Previous match |
| Alt+I | Toggle case-insensitive search for the current box |
| Alt+V | Cycle visible / all / hidden text for the current box |
| Alt+N | Add another search box |
| Alt+C | Copy the current box's matches, one per line |
| Alt+H | Toggle search history |
| Alt+X (twice) | Clear search history |
| Alt+S | Toggle shortcut help |

### Options

Right-click the toolbar icon → **Options**.

| Setting | Default | Notes |
|---|---|---|
| Highlight / selected / text color | yellow / orange / black | Applied to open pages immediately |
| Instant highlighting | on | When off, press Enter to search |
| Max results | 500 | Per search box. Lower is faster on large pages |
| Max history records | 30 | 0 disables history |

**Reset to Defaults** restores these settings, and resets the starting case/visibility settings for new boxes to case-sensitive / visible only. Your search history is kept.

## Permissions

| Permission | Why |
|---|---|
| `storage` | Saves settings and search history locally |
| `activeTab` | Lets the popup message the current tab |
| `clipboardWrite` | Copies matches to the clipboard |
| Content script on `http`, `https`, `file` pages | Searches and highlights the page. Nothing is sent anywhere. |

For `file://` pages, turn on **Allow access to file URLs** on the extension's details page.

## Limitations

- Text inside `<input>` and `<textarea>` can't be highlighted.
- Shadow DOM and iframes aren't searched.
- A catastrophically backtracking regex (e.g. `(a+)+$`) can still freeze the page. JavaScript regex matching can't be interrupted, so the 1.5-second limit only applies between matches.
- Content scripts don't run on `chrome://` pages or the Chrome Web Store.

## Development

No build step. Edit the files and click the reload icon on `chrome://extensions`.

| File | Role |
|---|---|
| `manifest.json` | Manifest V3 configuration |
| `js/common.js` | Default settings, visibility modes, the extra-search color palette and the search limit. Loaded before the content script, popup and options scripts. |
| `js/content.js` | Runs in every page. Keeps one search per popup box. Flattens the rendered text into one string (block boundaries become `\n`), runs each regex over it, maps matches back to DOM `Range`s, and registers one `Highlight` per search with `CSS.highlights` (`regex-search-<id>`, plus `regex-search-selected`). Each search has its own case flag and visibility mode, and searches with the same mode share one pass over the page. A `MutationObserver` re-runs the searches when the page changes, and a `chrome.storage.onChanged` listener restyles them when colors change or re-runs them when max results changes. |
| `js/popup.js`, `popup.html` | Search boxes, history and keyboard shortcuts |
| `js/background.js` | Service worker that sets the badge to the total count |
| `js/options.js`, `options.html` | Settings page |
| `tools/make_icons.py` | Generates `icons/` (run `python tools/make_icons.py`, needs Pillow) |

The popup and content script communicate with `chrome.tabs.sendMessage`. Each search box has a numeric `searchId` (0 for the main box), and every message except `getSearchInfo` carries one:

| Message (popup → page) | Effect |
|---|---|
| `search` | Run that box's search with its `caseInsensitive` and `visibility` options. Re-sending the same pattern and options selects the next match. |
| `selectNextNode` / `selectPrevNode` | Move that box's selection |
| `removeSearch` | Drop that box's search and highlights |
| `copyToClipboard` | Returns that box's matched text (exactly what the regex matched) |
| `getSearchInfo` | Returns whether the Highlight API is supported, and every search's pattern, options and count, so the popup can rebuild its boxes |

The content script answers every message. After each search, selection change, removal or refresh, it broadcasts `returnSearchInfo`, which holds the box's `searchId`, pattern, selected index, count and truncated flag, plus `totalResults`/`anyTruncated` across all boxes. The popup updates that box, and the background worker updates the badge.

Case and visibility are sent with each `search` message. The popup also saves the last-used values as the starting settings for new boxes. Options changes (colors, max results) reach open pages through `chrome.storage.onChanged`, so they apply immediately.

All settings live in `chrome.storage.local`: `highlightColor`, `selectedColor`, `textColor`, `maxResults`, `instantResults`, `maxHistoryLength`, `caseInsensitive` and `visibilityMode` (starting options for new boxes), `searchHistory`, `isSearchHistoryVisible`.

## Changelog

### 1.1.0

- Renamed to Advanced Regex Search. The popup shortcut is now Alt+Shift+F.
- Highlighting uses the CSS Custom Highlight API instead of wrapping matches in elements.
- Matches can span inline elements. `^`/`$` match per line, and zero-width matches are ignored.
- Text hidden by `visibility`, `content-visibility` or a closed `<details>` is now recognized as hidden.
- Multiple simultaneous searches: **+** / Alt+N adds a search box with its own highlight color.
- Per-box case toggle and a three-way text mode (visible only / all / hidden only) on every box.
- New logo.
- Highlights refresh when the page changes.
- Redesigned popup: shared actions in a top toolbar, one row of controls per search box, inline SVG icons, and no external stylesheet.
- Copying uses the Clipboard API. Alt+X must be pressed twice.
- Fixed: the history panel's visibility not being remembered, searches stalling after a lost message, Enter searching for the old pattern with instant search off, and invalid history-length values.

## License

MIT. See [LICENSE](LICENSE).

/* Requires js/common.js */

/*** CONSTANTS ***/
const DEFAULTS = DEFAULT_SETTINGS;
const WHITE_COLOR = '#ffffff';
const ERROR_COLOR = '#ff8989';
const GOOD_COLOR = '#89ff89';
/*** CONSTANTS ***/

/*** FUNCTIONS ***/
let statusTimer = null;

/* Show status text for a while */
function markStatus(text, time = 1250) {
  const status = document.getElementById('status');
  clearTimeout(statusTimer);
  status.textContent = text;
  statusTimer = setTimeout(() => { status.textContent = ''; }, time);
}

/* Validate a whole-number input; returns the number or null */
function validateInteger(id, min, label) {
  const input = document.getElementById(id);
  const value = input.value.trim();
  const num = Number(value);
  if (/^\d+$/.test(value) && Number.isSafeInteger(num) && num >= min) {
    if (input === document.activeElement) {
      input.style.backgroundColor = GOOD_COLOR;
      setTimeout(() => { input.style.backgroundColor = WHITE_COLOR; }, 1250);
    }
    return num;
  }
  markStatus(`${label}: '${value}' is not a whole number of at least ${min}.`, 2500);
  input.style.backgroundColor = ERROR_COLOR;
  return null;
}

/* Save options to storage */
function saveOptions() {
  const maxResults = validateInteger('maxResults', 1, 'Max results');
  const maxHistoryLength = validateInteger('maxHistoryLength', 0, 'Max records');
  if (maxResults === null || maxHistoryLength === null) return;

  chrome.storage.local.set({
    highlightColor: document.getElementById('highlightColor').value,
    selectedColor: document.getElementById('selectedColor').value,
    textColor: document.getElementById('textColor').value,
    maxResults: maxResults,
    instantResults: document.getElementById('instantResults').checked,
    maxHistoryLength: maxHistoryLength
  }).then(() => {
    markStatus('New settings saved');
  });
}

function updateExamples() {
  const highlighted = document.getElementById('exampleHighlighted');
  const selected = document.getElementById('exampleSelected');
  const textColor = document.getElementById('textColor').value;
  highlighted.style.backgroundColor = document.getElementById('highlightColor').value;
  selected.style.backgroundColor = document.getElementById('selectedColor').value;
  highlighted.style.color = textColor;
  selected.style.color = textColor;
}

/* Load options from storage */
function loadOptions() {
  return chrome.storage.local.get(DEFAULTS).then((result) => {
    document.getElementById('highlightColor').value = result.highlightColor;
    document.getElementById('selectedColor').value = result.selectedColor;
    document.getElementById('textColor').value = result.textColor;
    document.getElementById('maxResults').value = result.maxResults;
    document.getElementById('instantResults').checked = result.instantResults;
    document.getElementById('maxHistoryLength').value = result.maxHistoryLength;
    updateExamples();
  });
}

/* Restore default settings (search history is kept) */
function restoreDefaults() {
  chrome.storage.local.remove(Object.keys(DEFAULTS))
    .then(loadOptions)
    .then(() => markStatus('Defaults restored'));
}
/*** FUNCTIONS ***/

/*** LISTENERS ***/
document.addEventListener('DOMContentLoaded', function () {
  loadOptions();

  ['highlightColor', 'selectedColor', 'textColor'].forEach((id) => {
    document.getElementById(id).addEventListener('change', () => {
      updateExamples();
      saveOptions();
    });
  });

  ['maxResults', 'instantResults', 'maxHistoryLength'].forEach((id) => {
    document.getElementById(id).addEventListener('change', saveOptions);
  });

  document.getElementById('buttonSave').addEventListener('click', saveOptions);
  document.getElementById('buttonReset').addEventListener('click', restoreDefaults);
});
/*** LISTENERS ***/

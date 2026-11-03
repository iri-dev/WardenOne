/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('popup-settings-search.js', 'utf8');
const popupHtml = fs.readFileSync('popup.html', 'utf8');
const searchBlock = source.match(/;\(function\(\)\{\r?\n  var inp=document\.getElementById\('wo-settings-search'\);[\s\S]*?\r?\n\}\)\(\);/);
assert(searchBlock, 'popup settings-search module must remain discoverable');
assert(popupHtml.indexOf('<script src="popup-scroll-memory.js"></script>') < popupHtml.indexOf('<script src="popup-settings-search.js"></script>'),
  'settings search must load after popup memory helpers');
assert(popupHtml.includes('<script src="protection-event-settings.js"></script>')
  && popupHtml.indexOf('<script src="protection-event-settings.js"></script>') < popupHtml.indexOf('<script src="popup-settings-search.js"></script>'),
  'settings search must load after its event ownership registry');
assert(popupHtml.includes('id="js-shield"') && popupHtml.includes('WebAssembly startup'),
  'the search fixture must cover the real Script Shield section');

class FakeClassList {
  constructor(names) {
    this.names = new Set(names || []);
  }

  contains(name) {
    return this.names.has(name);
  }

  toggle(name, force) {
    const next = force === undefined ? !this.names.has(name) : !!force;
    if (next) this.names.add(name);
    else this.names.delete(name);
    return next;
  }

  remove(name) {
    this.names.delete(name);
  }

  add(name) {
    this.names.add(name);
  }
}

class FakeElement {
  constructor(options) {
    const opts = options || {};
    this.id = opts.id || '';
    this.tagName = opts.tagName || 'DIV';
    this.textContent = opts.text || '';
    this.value = opts.value || '';
    this.open = !!opts.open;
    this.style = {};
    this.parentElement = null;
    this.previousElementSibling = null;
    this.children = [];
    this.listeners = Object.create(null);
    this.attributes = Object.assign({}, opts.attributes || {});
    this.classList = new FakeClassList(opts.classes || []);
  }

  append(child) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  getAttribute(name) {
    if (name === 'id') return this.id || null;
    return Object.prototype.hasOwnProperty.call(this.attributes, name) ? this.attributes[name] : null;
  }

  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }

  hasAttribute(name) {
    return Object.prototype.hasOwnProperty.call(this.attributes, name);
  }

  removeAttribute(name) {
    delete this.attributes[name];
  }

  addEventListener(type, listener) {
    this.listeners[type] = listener;
  }

  emit(type) {
    assert(this.listeners[type], this.id + ' must listen for ' + type);
    this.listeners[type]({ target: this });
  }

  focus() {}

  querySelector(selector) {
    if (selector === '.row:not(.wo-hidden)') {
      return this.children.find((child) => child.classList.contains('row') && !child.classList.contains('wo-hidden')) || null;
    }
    if (selector === '.name') return this.children.find((child) => child.classList.contains('name')) || null;
    return null;
  }

  querySelectorAll(selector) {
    if (selector === '[data-key]') {
      return this.children.flatMap((child) => (child.hasAttribute('data-key') ? [child] : []).concat(child.querySelectorAll(selector)));
    }
    if (selector.indexOf('.eyeshield-') >= 0) return eyeSearchChildren.slice();
    if (selector === 'button') return this.children.filter((child) => child.tagName === 'BUTTON');
    return [];
  }
}

const searchInput = new FakeElement({ id: 'wo-settings-search' });
const clearButton = new FakeElement({ id: 'wo-search-clear', tagName: 'BUTTON' });
const resultCount = new FakeElement({ id: 'wo-search-count' });
const noResult = new FakeElement({ id: 'wo-noresult' });

const eyeHeading = new FakeElement({ id: 'eyeshield-title', tagName: 'H2', text: 'EyeShield' });
const eyePanel = new FakeElement({
  id: 'eyeshield-panel',
  tagName: 'SECTION',
  classes: ['eyeshield-panel'],
  text: 'Normal Light Dark Ultra This site brightness 100% Extras contrast saturation warmth grayscale Reset to default',
});
eyePanel.previousElementSibling = eyeHeading;
const eyeModes = eyePanel.append(new FakeElement({ id: 'eyeshield-modes', classes: ['eyeshield-modes'], text: 'Normal Light Dark Ultra' }));
const normalMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Normal', attributes: { 'data-eyeshield-mode': 'off' } }));
const lightMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Light', attributes: { 'data-eyeshield-mode': 'light' } }));
const darkMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Dark', attributes: { 'data-eyeshield-mode': 'dark' } }));
const ultraMode = eyeModes.append(new FakeElement({ classes: ['eyeshield-mode'], text: 'Ultra', attributes: { 'data-eyeshield-mode': 'ultra' } }));
const brightnessLabel = eyePanel.append(new FakeElement({ classes: ['eyeshield-slider-row'], text: 'This site brightness 100%' }));
const brightnessRange = eyePanel.append(new FakeElement({ id: 'eyeshield-brightness', tagName: 'INPUT', classes: ['eyeshield-range'] }));
const extras = eyePanel.append(new FakeElement({ id: 'eyeshield-extras', tagName: 'DETAILS', classes: ['eyeshield-extras'], text: 'Extras contrast saturation warmth grayscale Reset to default' }));
const eyeSearchChildren = [eyeModes, normalMode, lightMode, darkMode, ultraMode, brightnessLabel, brightnessRange, extras];

const interfaceHeading = new FakeElement({ tagName: 'H2', text: 'Interface' });
const interfaceGroup = new FakeElement({ classes: ['card-group'] });
interfaceGroup.previousElementSibling = interfaceHeading;
const interfaceTheme = interfaceGroup.append(new FakeElement({ classes: ['row'], text: 'Theme Light Dark' }));

const tabGroup = new FakeElement({ classes: ['card-group'] });
const tabRow = tabGroup.append(new FakeElement({ classes: ['row'], text: 'Maximum tabs Acts when a new tab pushes the window past this count.' }));
const tabInput = tabRow.append(new FakeElement({ id: 'tl-max', tagName: 'INPUT' }));

const scriptHeading = new FakeElement({ tagName: 'H2', text: 'Script Shield' });
const scriptGroup = new FakeElement({ id: 'js-shield', classes: ['card-group'] });
scriptGroup.previousElementSibling = scriptHeading;
const webAssemblyRow = scriptGroup.append(new FakeElement({ classes: ['row'], text: 'Block JavaScript and WebAssembly startup' }));
const trustedScriptRow = scriptGroup.append(new FakeElement({ classes: ['row'], text: 'Trusted script sites' }));

const rewindDetails = new FakeElement({ tagName: 'DETAILS', classes: ['rewind-drop'], open: false });
const rewindGroup = rewindDetails.append(new FakeElement({ classes: ['card-group'] }));
/* The real row's wording matters here: it carries both 'speed' and 'records', which is how
   a search for 'speech rec' used to land on it. */
const rewindRow = rewindGroup.append(new FakeElement({ classes: ['row'], text: 'Twitch local rewind DVR Buffer length plus speed 1-2x It records the live stream' }));
const micGroup = new FakeElement({ classes: ['card-group'] });
const micHeading = new FakeElement({ tagName: 'H2', text: 'Media Shield' });
micGroup.previousElementSibling = micHeading;
const micRow = micGroup.append(new FakeElement({ classes: ['row'], text: 'Block camera and microphone includes speech recognition which reaches the microphone by a different route' }));
const cookieGroup = new FakeElement({ classes: ['card-group'] });
const cookieThirdRow = cookieGroup.append(new FakeElement({ classes: ['row'], text: 'Block third-party cookies' }));
cookieThirdRow.append(new FakeElement({ tagName: 'INPUT', attributes: { 'data-key': 'blockThirdPartyCookies' } }));
const cookieAllRow = cookieGroup.append(new FakeElement({ classes: ['row'], text: 'Block all cookies' }));
cookieAllRow.append(new FakeElement({ tagName: 'INPUT', attributes: { 'data-key': 'blockAllCookies' } }));

/* Two sections that both answer "site perm", the weaker one first, as in the real popup. */
const nameRow = (name, desc) => {
  const row = new FakeElement({ classes: ['row'], text: name + ' ' + desc });
  row.append(new FakeElement({ classes: ['name'], text: name }));
  return row;
};
const groupsEl = new FakeElement({ id: 'groups', classes: ['group'] });
const downloadHeading = groupsEl.append(new FakeElement({ tagName: 'H2', text: 'Download Shield' }));
const downloadGroup = groupsEl.append(new FakeElement({ classes: ['card-group'] }));
const trustedDownloadRow = downloadGroup.append(nameRow('Trusted download sites', 'Trusted sources are graded more gently; a permanent list.'));
const securityHeading = groupsEl.append(new FakeElement({ tagName: 'H2', text: 'Security Centre' }));
const securityGroup = groupsEl.append(new FakeElement({ classes: ['card-group'] }));
const cookieHeading = groupsEl.append(new FakeElement({ tagName: 'H2', text: 'Cookie protection' }));
groupsEl.append(cookieGroup);
cookieGroup.previousElementSibling = cookieHeading;
const extensionRow = securityGroup.append(nameRow('Review installed extensions', 'Checks each extension site access and permissions.'));
const permScannerRow = securityGroup.append(nameRow('Site permission scanner', 'Scan this site, then allow, block, or ask for each permission.'));
downloadGroup.previousElementSibling = downloadHeading;
securityGroup.previousElementSibling = securityHeading;

/* The footer under the settings list: reachable by id, as in the real popup. */
const footerButtons = [
  ['allowlist', 'Allowlist this site'], ['verify-repair', 'Verify & repair'],
  ['open-activity', 'Activity log'], ['open-notifications', 'Notification centre'], ['open-network', 'Network (DNS)'],
].map(([id, text]) => new FakeElement({ id, tagName: 'BUTTON', text }));

const byId = new Map([
  ...footerButtons.map((button) => [button.id, button]),
  [searchInput.id, searchInput],
  [clearButton.id, clearButton],
  [resultCount.id, resultCount],
  [noResult.id, noResult],
  [eyeHeading.id, eyeHeading],
  [eyePanel.id, eyePanel],
  [eyeModes.id, eyeModes],
  [brightnessRange.id, brightnessRange],
  [extras.id, extras],
  [scriptGroup.id, scriptGroup],
  [tabInput.id, tabInput],
  [groupsEl.id, groupsEl],
]);

const document = {
  visibilityState: 'visible',
  getElementById(id) { return byId.get(id) || null; },
  addEventListener() {},
  querySelector(selector) {
    if (selector === '.master' || selector === '.top-quick') return null;
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.row') return [rewindRow, interfaceTheme, tabRow, micRow, cookieThirdRow, cookieAllRow, webAssemblyRow, trustedScriptRow, trustedDownloadRow, extensionRow, permScannerRow];
    if (selector === '.card-group') return [rewindGroup, interfaceGroup, tabGroup, micGroup, cookieGroup, scriptGroup, downloadGroup, securityGroup];
    if (selector === '.group>h2, .eyeshield-panel+h2, #js-shield+h2') return [eyeHeading, interfaceHeading, scriptHeading, downloadHeading, securityHeading, cookieHeading];
    if (selector.indexOf('.eyeshield-mode') >= 0) return eyeSearchChildren.slice();
    return [];
  },
};

const storage = { get() {}, set() {}, remove() {} };
let initialMemory = {};
const context = {
  POPUP_SEARCH_KEY: 'wardenone_popup_search_memory',
  clearTimeout() {},
  console,
  Date,
  document,
  popupScrollStore() { return storage; },
  readInitialPopupMemory(callback) { callback(initialMemory); },
  writePopupMemoryMirror(key, entry) { initialMemory[key] = entry; },
  restorePopupSearch() {},
  setTimeout() { return 1; },
  window: { addEventListener() {} },
  wardenEventProtectionKeys(type) {
    return type === 'blocked_thirdparty_cookie' ? ['blockThirdPartyCookies']
      : type === 'cookie_blocked' ? ['blockAllCookies', 'blockThirdPartyCookies', 'blockAllCookies'] : [];
  },
  $(id) { return document.getElementById(id); },
};

vm.runInNewContext(searchBlock[0], context, { filename: 'popup-settings-search.js' });

searchInput.value = 'dar';
searchInput.emit('input');

assert.strictEqual(resultCount.textContent, '2 results', 'Dark must count EyeShield and Interface once each');
assert(!eyePanel.classList.contains('wo-hidden'), 'Dark must keep the EyeShield panel visible');
for (const control of [normalMode, lightMode, darkMode, ultraMode, brightnessLabel, brightnessRange, extras]) {
  assert(!control.classList.contains('wo-hidden'), 'Dark must keep the compound EyeShield control intact');
}
assert(!interfaceTheme.classList.contains('wo-hidden'), 'Dark must surface the Interface theme row');
assert(rewindDetails.classList.contains('wo-hidden'), 'an unmatched rewind summary must not be orphaned in results');

searchInput.value = 'eyeshield';
searchInput.emit('input');
assert.strictEqual(resultCount.textContent, '1 result', 'EyeShield must not be double-counted through its heading');

searchInput.value = 'maximum tabs';
searchInput.emit('input');
assert(!tabRow.classList.contains('wo-hidden'), 'the matching number setting must remain visible');
assert(!tabInput.classList.contains('wo-hidden'), 'search must not hide its input separately');
searchInput.value = 'tl max';
searchInput.emit('input');
assert(!tabRow.classList.contains('wo-hidden') && !tabInput.classList.contains('wo-hidden'),
  'a control-specific keyword must reveal the whole interactive row');

searchInput.value = 'WebAssembly';
searchInput.emit('input');
assert(!scriptGroup.classList.contains('wo-hidden'), 'WebAssembly must keep Script Shield visible');
assert(!scriptHeading.classList.contains('wo-hidden'), 'WebAssembly must keep the Script Shield heading visible');
assert(!webAssemblyRow.classList.contains('wo-hidden'), 'the matching Script Shield row must stay visible');
searchInput.value = 'WebAssembly startup';
searchInput.emit('input');
assert(trustedScriptRow.classList.contains('wo-hidden'), 'unrelated Script Shield rows may hide');

searchInput.value = 'trusted script sites';
searchInput.emit('input');
assert(!scriptGroup.classList.contains('wo-hidden'), 'a later Script Shield row must also keep its section visible');
assert(!trustedScriptRow.classList.contains('wo-hidden'), 'the trusted sites row must stay visible');

searchInput.value = 'twitch';
searchInput.emit('input');
assert(!rewindDetails.classList.contains('wo-hidden'), 'a matching rewind section must be visible');
assert.strictEqual(rewindDetails.open, true, 'search must open a matching collapsed rewind section');

searchInput.value = '';
searchInput.emit('input');
assert(!eyePanel.classList.contains('wo-hidden'), 'clearing search must restore EyeShield');
assert(!rewindDetails.classList.contains('wo-hidden'), 'clearing search must restore the rewind section');
assert.strictEqual(rewindDetails.open, false, 'clearing search must restore the rewind section collapsed state');
assert.strictEqual(resultCount.textContent, '', 'clearing search must clear the result count');
assert(!scriptGroup.classList.contains('wo-hidden') && !scriptHeading.classList.contains('wo-hidden'),
  'clearing search must restore Script Shield');
assert(!webAssemblyRow.classList.contains('wo-hidden') && !trustedScriptRow.classList.contains('wo-hidden'),
  'clearing search must restore every Script Shield row');

/* Fuzzy matching used to allow two edits from six characters up -- a third of a six-letter
   word. So 'speech' matched 'speed', and because the Twitch rewind row also says 'records',
   a search for 'speech rec' returned it: both tokens 'matched', neither meaningfully. Two
   edits now need a word long enough to survive them. */
searchInput.value = 'speech rec';
searchInput.emit('input');
assert(rewindRow.classList.contains('wo-hidden'),
  'speech must not fuzzy-match speed: the Twitch rewind row is not a speech setting');
assert(!micRow.classList.contains('wo-hidden'),
  'the row that actually mentions speech recognition must still be found');

searchInput.value = 'speech';
searchInput.emit('input');
assert(rewindRow.classList.contains('wo-hidden'), 'speech alone must not reach the rewind row either');

/* The other half: real typos must still work, or the fix has traded one annoyance for a
   worse one. Each of these is a single edit from a word in the microphone row. */
for (const typo of ['microphon', 'recogniton', 'camra']) {
  searchInput.value = typo;
  searchInput.emit('input');
  assert(!micRow.classList.contains('wo-hidden'), 'a one-edit typo must still find its setting: ' + typo);
}

/* Searching used to filter the footer's buttons out one by one: Verify & repair and the
   Activity / Notification / Network row vanished, leaving their description and an empty
   band behind. The footer is not a search result; it stays whole, as it is with no search. */
for (const query of ['cookies', 'repair', 'zzzz']) {
  searchInput.value = query;
  searchInput.emit('input');
  for (const button of footerButtons) {
    assert(!button.classList.contains('wo-hidden'), 'searching "' + query + '" must not hide the footer button ' + button.id);
  }
}
searchInput.value = 'cookies';
searchInput.emit('input');
assert.strictEqual(resultCount.textContent, '3 results', 'only the matching cookie rows and their heading count; footer buttons do not');

for (const query of ['blocked_thirdparty_cookie', '  BLOCKED_THIRDPARTY_COOKIE  ']) {
  searchInput.value = query;
  searchInput.emit('input');
  assert.strictEqual(resultCount.textContent, '1 result', 'an exact event ID reveals its owner once');
  assert(!cookieThirdRow.classList.contains('wo-hidden') && cookieAllRow.classList.contains('wo-hidden'));
  assert(micRow.classList.contains('wo-hidden') && trustedDownloadRow.classList.contains('wo-hidden'));
}
searchInput.value = 'cookie_blocked';
searchInput.emit('input');
assert.strictEqual(resultCount.textContent, '2 results', 'an event alias deduplicates its responsible controls');
assert(!cookieAllRow.classList.contains('wo-hidden') && !cookieThirdRow.classList.contains('wo-hidden'));
assert(Number(cookieAllRow.style.order) < Number(cookieThirdRow.style.order), 'event owners preserve their registry priority');
searchInput.value = 'cookie_blokced';
searchInput.emit('input');
assert.strictEqual(resultCount.textContent, '0 results', 'unknown event IDs do not fuzzy-match other controls');

/* 2026-10-31: "site perm" listed Trusted download sites first and the permission scanner further down,
   because results kept page order. The setting whose own name starts with the words searched now leads. */
searchInput.value = 'site perm';
searchInput.emit('input');
const order = (el) => Number(el.style.order);
assert(!trustedDownloadRow.classList.contains('wo-hidden') && !permScannerRow.classList.contains('wo-hidden'), 'both sections answer');
assert(groupsEl.classList.contains('wo-ranked'), 'sections are ranked while searching');
assert(order(securityHeading) < order(downloadHeading) && order(securityGroup) < order(downloadGroup), 'the scanner section comes first');
assert(order(securityHeading) < order(securityGroup), 'a section keeps its heading above its rows');
assert(order(permScannerRow) < order(extensionRow), 'the scanner leads inside its section');
searchInput.value = 'download';
searchInput.emit('input');
assert(order(downloadHeading) < order(securityHeading), 'ranking follows the query, not the last search');
searchInput.value = '';
searchInput.emit('input');
assert(!groupsEl.classList.contains('wo-ranked') && groupsEl.children.every((el) => !el.style.order), 'clearing restores page order');

initialMemory ={ wardenone_popup_search_memory: { q: 'WebAssembly' } };
let restored = false;
context.restorePopupSearch(() => {
  restored = true;
  assert.strictEqual(searchInput.value, 'WebAssembly', 'the prefetched search must apply before scroll restoration continues');
  assert(!webAssemblyRow.classList.contains('wo-hidden') && !scriptGroup.classList.contains('wo-hidden'));
});
assert(restored);

const catalog = {};
vm.runInNewContext(fs.readFileSync('protection-event-settings.js', 'utf8'), catalog);
context.wardenEventProtectionKeys = catalog.wardenEventProtectionKeys;
for (const [query, count] of [['cookie_blocked', '2 results'], ['blocked_thirdparty_cookie', '1 result']]) {
  searchInput.value = query;
  searchInput.emit('input');
  assert.strictEqual(resultCount.textContent, count, query + ' follows the shipped event ownership registry');
  assert(!cookieThirdRow.classList.contains('wo-hidden'));
}

console.log('[ok] popup settings-search grouping checks passed');

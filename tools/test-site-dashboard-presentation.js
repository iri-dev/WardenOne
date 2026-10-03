/* The dashboard must not turn an unobserved action into a reassuring zero. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(__dirname, '..', 'popup.html'), 'utf8');
function functionSource(name) {
  const start = source.indexOf('function ' + name + '(');
  assert(start >= 0, name + ' exists');
  let depth = 0;
  let opened = false;
  for (let i = start; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') { depth--; if (opened && depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(name + ' was not closed');
}

function element(tag = 'div') {
  let ownText = '';
  return {
    tagName: tag,
    children: [],
    hidden: false,
    className: '',
    appendChild(child) { this.children.push(child); return child; },
    get textContent() { return ownText + this.children.map((child) => child.textContent).join(''); },
    set textContent(value) { ownText = String(value); this.children = []; },
  };
}
const ids = [
  'site-dash-host', 'site-dash-state', 'site-dash-since', 'site-dash-total', 'site-dash-label',
  'site-dash-note', 'site-dash-cats', 'site-dash-cats-title', 'site-dash-sources',
  'site-dash-sources-title', 'site-dash-allowlist', 'site-dash-allowlist-desc',
  'site-dash-protections', 'site-dash-foot',
];
const nodes = Object.fromEntries(ids.map((id) => [id, element()]));
const context = vm.createContext({
  document: { createElement: element },
  $: (id) => nodes[id],
  config: { allowlist: [] },
  fmtCount: String,
  siteDashIsBrave: true,
  siteDashState: () => ({ cls: '', text: 'Protected', line: '' }),
  siteDashTime: () => '12:00',
  siteDashProtectionState: () => ({ cls: '', text: 'On' }),
  renderSiteDashTimeline() {},
  renderSiteDashRecent() {},
  renderSiteDashChecks() {},
});
vm.runInContext("const SITE_DASH_CATEGORIES = [{id:'trackers',label:'Trackers'},{id:'ads',label:'Ads'}]; const SITE_DASH_PROTECTIONS = [{key:'adShield',label:'AdShield'}];", context);
for (const name of ['siteDashEl', 'siteDashCountNotes', 'renderSiteDashSources', 'renderSiteDashboard']) {
  vm.runInContext(functionSource(name), context);
}

const base = {
  host: 'youtube.com', web: true, since: Date.now(), total: 0,
  cats: { trackers: 0, ads: 0 }, noticed: 0,
  net: { available: true, sources: [] }, retained: { total: 0 },
};
context.summary = base;
vm.runInContext('renderSiteDashboard(summary)', context);
assert.equal(nodes['site-dash-label'].textContent, 'no WardenOne actions recorded');
assert.equal(nodes['site-dash-cats'].hidden, true);
assert.equal(nodes['site-dash-cats-title'].hidden, true);
assert.equal(nodes['site-dash-sources'].hidden, true);
assert.equal(nodes['site-dash-protections'].children.length, 1, 'protection status remains available');
assert.match(nodes['site-dash-note'].textContent, /zero means WardenOne recorded no block/);
assert.match(nodes['site-dash-note'].textContent, /Brave Shields may stop/);
assert.doesNotMatch(nodes['site-dash-note'].textContent, /nothing needed stopping/i);

context.summary = {
  ...base, total: 3, cats: { trackers: 2, ads: 1 },
  net: { available: true, sources: [{ name: 'Tracker list', count: 2 }, { name: 'AdShield / EasyList', count: 1 }] },
};
vm.runInContext('renderSiteDashboard(summary)', context);
assert.equal(nodes['site-dash-cats'].hidden, false);
assert.equal(nodes['site-dash-cats'].children.length, 2);
assert.equal(nodes['site-dash-sources'].hidden, false);
assert.equal(nodes['site-dash-sources'].children[0].textContent, 'Tracker list2');
assert.equal(nodes['site-dash-sources'].children[1].textContent, 'AdShield / EasyList1');
assert.match(nodes['site-dash-sources'].textContent, /not the request addresses/);
assert.match(html, /id="site-dash-logger"[^>]*>Inspect new requests/);
assert.match(source, /chrome\.runtime\.getURL\('logger\.html'\)/);
console.log('[ok] Site Dashboard zero state and matched-rule sources');

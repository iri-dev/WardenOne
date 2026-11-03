/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');

const health = fs.readFileSync('popup-health.js', 'utf8');
const background = fs.readFileSync('background.js', 'utf8');
const html = fs.readFileSync('popup.html', 'utf8');
const start = health.indexOf('function listSourceBreakdown(');
const end = health.indexOf('function renderListPublishers(', start);
assert(start >= 0 && end > start);
class Element {
  constructor() { this.children = []; this.hidden = false; this.open = false; }
  set textContent(value) { this.text = value; this.children = []; }
  get textContent() { return String(this.text || '') + this.children.map(child => child.textContent).join(''); }
  append(...children) { this.children.push(...children); }
  appendChild(child) { this.children.push(child); }
}
const elements = Object.fromEntries(['list-source-details', 'list-source-rows', 'list-source-note', 'list-source-table']
  .map(id => [id, new Element()]));
const ui = { URL, document: { createElement: () => new Element() }, $: id => elements[id], fmtCount: n => n.toLocaleString('en-US') };
vm.createContext(ui);
vm.runInContext(health.slice(start, end), ui);
const meta = {
  activeCount: 25, activeRuleCount: 18, packagedActiveCount: 5, activeLearnedCount: 2,
  feedDomainCounts: [
    { url: 'https://publisher.example/security.txt', count: 12, listedCount: 20, activeCount: 12 },
    { url: 'https://publisher.example/tracking.txt', count: 8, listedCount: 15, activeCount: 6 },
  ],
  packagedDomainCounts: { base: 2, adshield_easylist: 3, trackers: 0, easyprivacy: 0, badger_trained: 0, cname_trackers: 0 },
  packagedListedDomainCounts: { base: 100, adshield_easylist: 5000, trackers: 40, easyprivacy: 47000, badger_trained: 3100, cname_trackers: 119000 },
  activePackagedRulesets: ['base', 'adshield_easylist', 'trackers', 'easyprivacy', 'badger_trained', 'cname_trackers'],
};
const sum = rows => rows.reduce((total, row) => total + row.addedCount, 0);
let result = ui.listSourceBreakdown(meta);
const threatView = ui.listSourceBreakdown({ ...meta, feedDomainCounts: [
  { ...meta.feedDomainCounts[0], url: 'https://threatview.io/Downloads/DOMAIN-High-Confidence-Feed.txt' },
  meta.feedDomainCounts[1],
] }).rows.find(row => row.name === 'ThreatView');
assert.equal(threatView.count, 20);
assert.equal(threatView.addedCount, 12);
assert.equal(threatView.url, 'https://threatview.io/Downloads/DOMAIN-High-Confidence-Feed.txt');
const oneHosts = ui.listSourceBreakdown({ ...meta, feedDomainCounts: [
  { ...meta.feedDomainCounts[0], url: 'https://raw.githubusercontent.com/badmojr/1Hosts/master/Lite/adblock.txt' },
  meta.feedDomainCounts[1],
] }).rows.find(row => row.name === '1Hosts Lite');
assert.equal(oneHosts.count, 20);
assert.equal(oneHosts.addedCount, 12);
assert.equal(sum(result.rows), 25);
assert.equal(result.rows.find(row => row.name === 'publisher.example · tracking.txt').count, 15,
  'overlapping lists show their full size as the main figure');
assert.equal(result.rows.find(row => row.name === 'publisher.example · tracking.txt').addedCount, 6);
assert.equal(result.rows.find(row => row.name === 'Privacy Badger').count, 3100);
assert.equal(result.rows.find(row => row.name === 'Privacy Badger').addedCount, 0,
  'a list fully covered by other sources still shows its full size');
assert(!/Update the blocklist/.test(result.note));
const disabled = { ...meta, activeCount: 22, packagedActiveCount: 2,
  activePackagedRulesets: meta.activePackagedRulesets.filter(id => id !== 'adshield_easylist') };
result = ui.listSourceBreakdown(disabled);
assert.equal(sum(result.rows), 22);
assert.equal(result.rows.find(row => row.name === 'AdShield').count, 5000);
assert.equal(result.rows.find(row => row.name === 'AdShield').addedCount, 0);
assert.match(result.rows.find(row => row.name === 'AdShield').detail, /off/);
const legacy = { ...meta };
delete legacy.feedDomainCounts;
delete legacy.activePackagedRulesets;
delete legacy.activeLearnedCount;
result = ui.listSourceBreakdown(legacy);
assert.equal(sum(result.rows), 25);
assert.equal(result.rows.find(row => row.name === 'Downloaded feeds').addedCount, 18);
assert.equal(result.rows.find(row => row.name === 'Downloaded feeds').count, null);
assert.match(result.note, /Update the blocklist/);
const oldSizes = { ...meta, feedDomainCounts: meta.feedDomainCounts.map(({ listedCount, ...source }) => source) };
delete oldSizes.packagedListedDomainCounts;
result = ui.listSourceBreakdown(oldSizes);
assert.equal(sum(result.rows), 25);
assert.equal(result.rows.find(row => row.name === 'AdShield').count, null,
  'an old contribution is never relabelled as the full list size');
for (const source of [
  { url: 'javascript:alert(1)', count: 18, activeCount: 18 },
  { url: 'https://user:password@example.com/list', count: 18, activeCount: 18 },
  { url: 'https://example.com/list', count: 18, activeCount: -1 },
  { url: 'https://example.com/list', count: 1, activeCount: 18 },
  { url: 'https://example.com/list', count: 18, activeCount: '18' },
  { url: 'https://example.com/list', count: Infinity, activeCount: 18 },
  null,
]) {
  result = ui.listSourceBreakdown({ ...meta, feedDomainCounts: [source] });
  assert.equal(sum(result.rows), 25);
  assert.equal(result.rows.find(row => row.name === 'Downloaded feeds').addedCount, 18);
}
result = ui.listSourceBreakdown({ ...meta, feedDomainCounts: [meta.feedDomainCounts[0], meta.feedDomainCounts[0]] });
assert(result.rows.some(row => row.name === 'Downloaded feeds'), 'duplicate source rows are not displayed');
assert.equal(ui.listSourceBreakdown({ ...meta, activeCount: NaN }).rows.length, 0);
assert.equal(ui.listSourceBreakdown({ ...meta, packagedActiveCount: 6 }).rows.length, 0,
  'inconsistent saved counts do not become an invented breakdown');
elements['list-source-details'].open = true;
ui.renderListSources(meta);
assert.equal(elements['list-source-rows'].children.length, 9);
assert.equal(elements['list-source-table'].hidden, false);
assert.equal(elements['list-source-details'].open, true, 'refreshes preserve the reader\'s expanded view');
ui.renderListSources(null);
assert.equal(elements['list-source-rows'].children.length, 0);
assert.equal(elements['list-source-table'].hidden, true);
assert.match(elements['list-source-note'].textContent, /Update/);
assert(html.includes('id="list-source-details"') && html.includes('<th scope="col">In list</th>'));
assert(health.slice(health.indexOf('function renderListMeta(')).includes('renderListSources(meta)'));
assert(fs.readFileSync('popup.js', 'utf8').includes('renderListSources(meta)'));

const metaStart = background.indexOf('function buildListMeta(');
const metaEnd = background.indexOf('function refreshListMetaCounts(', metaStart);
const worker = {
  LEARNED: { a: {}, b: {}, c: {} }, LEARNED_MAX: 2, MAX_DYNAMIC: 18000, STATIC_RULE_COUNT: 162,
  PACKAGED_RULESET_FILES: [['base', 'rules.json'], ['adshield_easylist', 'rules-adshield.json']],
  STATIC_RULESET_ACTIVE: { base: true, adshield_easylist: false },
};
vm.createContext(worker);
vm.runInContext(background.slice(metaStart, metaEnd), worker);
result = worker.buildListMeta({ remoteCount: 20, activeRuleCount: 18, packagedDomainCounts: { base: 2, adshield_easylist: 3 } });
assert.equal(result.activeCount, 22);
assert.equal(result.activeLearnedCount, 2);
assert.deepEqual(Array.from(result.activePackagedRulesets), ['base']);
console.log('[ok] source contributions, disabled lists, saved-data validation and popup refresh');

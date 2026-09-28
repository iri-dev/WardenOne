/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const from = background.indexOf('const LIST_PUBLISHER_STALE_MS');
const to = background.indexOf('function listIntegritySeed', from);
assert(from >= 0 && to > from, 'publisher date helpers moved');
const context = { Date, Number, String, Set, Map, Array, Object };
vm.createContext(context);
vm.runInContext(background.slice(from, to) + '\nglobalThis.api = { parseListPublisherDate, listSourcePublications, listPublisherSummary, mergedListPublisherSources };', context);
const api = context.api;
const now = Date.parse('2026-09-28T12:00:00Z');
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log('  ok - ' + name);
}

check('VN badsite keeps its 2025 publisher date after a 2026 fetch', () => {
  const text = '# VN Badsite Filter\n# Updated: 2025-04-11T12:02:15Z\n0.0.0.0 bad.example';
  const publishedAt = api.parseListPublisherDate(text, now);
  assert.strictEqual(publishedAt, Date.parse('2025-04-11T12:02:15Z'));
  const url = 'https://malware-filter.gitlab.io/vn-badsite-filter/vn-badsite-filter-hosts.txt';
  const records = { [url]: { publisherUpdatedAt: publishedAt, acceptedAt: now } };
  const entries = api.listSourcePublications([url], records, []);
  assert.strictEqual(entries[0].fetchedAt, now);
  assert.strictEqual(entries[0].publishedAt, publishedAt);
  assert.strictEqual(api.listPublisherSummary(entries, now).stale, 1);
});

check('real publisher header formats are recognized', () => {
  const examples = [
    '! Last modified: 28 Sep 2026 09:18 UTC\n||ads.example^',
    '! TimeUpdated: 2026-09-26T11:05:41+00:00\n||ads.example^',
    '# Date: 27 September 2026 02:18:15 (UTC)\n0.0.0.0 bad.example',
    '# Last Update: Mon, 28 Sep 2026 04:00:13 UTC\n0.0.0.0 bad.example',
    '! Last modified: Mon, 28 Sep 2026 10:26:47 +0000\n||ads.example^',
    '# Last update April 5 2023\n0.0.0.0 bad.example',
    '# Destroylist - Primary Active | plain | 131,810 domains | 2026-09-28 09:07 UTC\n0.0.0.0 bad.example',
  ];
  for (const text of examples) assert(api.parseListPublisherDate(text, now) > 0, text);
  assert.strictEqual(api.parseListPublisherDate('# Last update April 5 2023\n0.0.0.0 bad.example', now),
    Date.parse('2023-04-05T00:00:00Z'), 'publisher dates without a time use UTC midnight');
});

check('unlabelled, missing, invalid and body-only dates remain unknown', () => {
  const examples = [
    '# 2026-09-28\n0.0.0.0 bad.example',
    '! Version: 202609280923\n||ads.example^',
    '# Updated: 2026-02-30\n0.0.0.0 bad.example',
    '# Updated: 2099-01-01\n0.0.0.0 bad.example',
    '0.0.0.0 bad.example\n# Updated: 2026-09-28',
    '# Updated: yesterday\n0.0.0.0 bad.example',
  ];
  for (const text of examples) assert.strictEqual(api.parseListPublisherDate(text, now), 0, text);
});

check('failed downloads retain the last accepted publisher date and state', () => {
  const url = 'https://example.org/list.txt';
  const records = { [url]: { publisherUpdatedAt: Date.parse('2026-09-20T00:00:00Z'), acceptedAt: now - 86400000 } };
  const entries = api.listSourcePublications([url, 'https://example.org/no-date.txt'], records, [{ url }]);
  assert.strictEqual(entries[0].fetchFailed, true);
  assert.strictEqual(entries[0].publishedAt, records[url].publisherUpdatedAt);
  assert.strictEqual(entries[1].publishedAt, 0);
  assert.strictEqual(api.listPublisherSummary(entries, now).unknown, 1);
});

check('old publisher dates are information, not a setup failure', () => {
  const issueFrom = background.indexOf('  if (list.publisher.stale) {', background.indexOf('async function buildProtectionHealthSummary'));
  const issueTo = background.indexOf('  // A feed that did not answer', issueFrom);
  assert(issueFrom >= 0 && issueTo > issueFrom);
  const issues = [];
  new Function('list', 'addIssue', background.slice(issueFrom, issueTo))(
    { publisher: { stale: 4 } }, (severity, text, topLevel) => issues.push({ severity, text, topLevel })
  );
  assert.strictEqual(issues.length, 1);
  assert.strictEqual(issues[0].severity, 'info');
  assert.notStrictEqual(issues[0].topLevel, true);
  assert(/Downloaded rules remain active/.test(issues[0].text));

  const from = background.indexOf('  const configuredShields = healthCountActiveShields(cfg);', issueTo);
  const to = background.indexOf('  return {', from);
  assert(from >= 0 && to > from);
  const decide = new Function('cfg', 'issues', 'tabEvidence', 'list', 'healthCountActiveShields',
    background.slice(from, to) + '\nreturn { status, detail, highest };');
  const cfg = { enabled: true };
  const verified = { state: 'verified', text: 'Engine verified.' };
  const old = decide(cfg, issues, verified, { publisher: { stale: 4 } }, () => 74);
  assert.strictEqual(old.status, 'Protections on');
  assert.strictEqual(old.highest, 'ok');
  assert(/Blocklist/.test(old.detail));
  const fresh = decide(cfg, [], verified, { publisher: { stale: 0 } }, () => 74);
  assert.strictEqual(fresh.status, "You're safe");
  const restricted = decide(cfg, issues, { state: 'restricted', text: 'Extensions do not run here.' },
    { publisher: { stale: 4 } }, () => 74);
  assert(/Extensions do not run here/.test(restricted.detail));
});

check('bundled files are excluded and duplicate URLs use the latest accepted copy', () => {
  const remote = api.listSourcePublications([{ url: 'https://example.org/feed', label: 'remote' }, { url: 'wardenone-bundled:list', localPath: 'list.json' }],
    { 'https://example.org/feed': { publisherUpdatedAt: 0, acceptedAt: now - 1000 } }, []);
  assert.strictEqual(remote.length, 1);
  const latest = api.mergedListPublisherSources(remote, [{ url: 'https://example.org/feed', publishedAt: now, fetchedAt: now, fetchFailed: false }]);
  assert.strictEqual(latest.length, 1);
  assert.strictEqual(latest[0].publishedAt, now);
});

check('network, supplemental and cosmetic fetches all record dates for the popup', () => {
  assert(/evaluateListSourceIntegrity\([\s\S]*?parseListPublisherDate\(text\)/.test(background));
  assert(/evaluateSupplementalSourceIntegrity\([^;]*parseListPublisherDate\(text\)/.test(background));
  assert(/wardenone_adshield_cosmetic_publishers: listSourcePublications/.test(background));
  assert(/publisherSources: listSourcePublications/.test(background));
  assert(/id="list-publisher-details"/.test(html));
  assert(/Older dates do not switch off downloaded rules/.test(html));
  assert(/publisher date unknown/.test(popup));
  assert(/let line = 'Fetched '/.test(popup));
  assert(/publisherUpdatedAt: parseListPublisherDate\(got\.text\)/.test(background), 'custom subscriptions must record publisher dates');
  assert(/bits\.push\(publisherDate \? 'publisher '/.test(popup), 'custom subscriptions must show publisher dates');
  const metaStart = popup.indexOf('function renderListMeta()');
  const metaEnd = popup.indexOf("$('update-now').addEventListener", metaStart);
  assert(metaStart >= 0 && metaEnd > metaStart);
  assert(!/line \+= .*publisher dates over 30 days old/.test(popup.slice(metaStart, metaEnd)),
    'the Blocklist summary should leave source-date counts to its dedicated details');
});

check('popup names the old feed and displays unknown separately from fetch time', () => {
  const start = popup.indexOf('function renderListPublishers');
  const end = popup.indexOf('function renderListMeta', start);
  assert(start >= 0 && end > start);
  const elements = {};
  const make = () => ({ children: [], textContent: '', hidden: false,
    append(...children) { this.children.push(...children); },
    appendChild(child) { this.children.push(child); } });
  for (const id of ['list-publisher-details', 'list-publisher-summary', 'list-publisher-rows']) elements[id] = make();
  class FixedDate extends Date { static now() { return now; } }
  const uiContext = { Date: FixedDate, Number, String, Array, Map, URL, document: { createElement: make },
    $: (id) => elements[id], fmtAgo: () => 'ago' };
  vm.createContext(uiContext);
  vm.runInContext(popup.slice(start, end) + '\nglobalThis.render = renderListPublishers;', uiContext);
  const result = uiContext.render([
    { url: 'https://malware-filter.gitlab.io/vn-badsite-filter/list.txt', publishedAt: Date.parse('2025-04-11T12:02:15Z'), fetchedAt: now },
    { url: 'https://example.org/unknown.txt', publishedAt: 0, fetchedAt: now },
  ]);
  assert.strictEqual(result.stale, 1);
  assert.strictEqual(result.unknown, 1);
  assert(/1 old/.test(elements['list-publisher-summary'].textContent));
  const rows = elements['list-publisher-rows'].children;
  assert(/malware-filter\.gitlab\.io/.test(rows[0].children[0].textContent));
  assert(/Publisher:/.test(rows[0].children[1].textContent));
  assert.strictEqual(rows[1].children[1].textContent, 'publisher date unknown');
  assert(/fetched/.test(rows[1].children[2].textContent));
});

console.log('[ok] list publisher date checks passed (' + passed + ' checks)');

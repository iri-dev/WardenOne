/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'site-dashboard-shared.js'), 'utf8');
const popup = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const settings = fs.readFileSync(path.join(root, 'settings.html'), 'utf8');
const settingsJs = fs.readFileSync(path.join(root, 'settings.js'), 'utf8');
const context = vm.createContext({});
vm.runInContext(source, context);

context.report = {
  network: { available: true, byCategory: { trackers: 2, ads: 1, security: 1 } },
  page: { typeCounts: {
    youtube_ads_removed: 4,
    scriptlet_mutator_blocked: 3,
    blocked_popup: 2,
    warned_phishing: 1,
    memory_slept: 9,
  } },
};
const combined = vm.runInContext('wardenSiteDashSummarize(report)', context);
assert.equal(combined.cats.ads, 5, 'YouTube player removals and network ad blocks share the Ads count');
assert.equal(combined.cats.trackers, 5, 'page and network tracker actions are combined');
assert.equal(combined.cats.popups, 2);
assert.equal(combined.cats.security, 1);
assert.equal(combined.noticed, 1, 'warnings remain outside the stopped-action total');
assert.equal(combined.total, 13, 'tab housekeeping is not presented as a page action');

context.report = {
  network: { available: true, byCategory: { trackers: 0, ads: 0 } },
  page: { typeCounts: { youtube_ads_removed: 4 } },
};
const screenshotCase = vm.runInContext('wardenSiteDashSummarize(report)', context);
assert.equal(screenshotCase.cats.ads, 4,
  'Settings must not show zero ads when the popup counted four YouTube player removals');

for (const [name, html, entry] of [['popup', popup, 'popup.js'], ['Settings', settings, 'settings.js']]) {
  assert(html.indexOf('site-dashboard-shared.js') >= 0 && html.indexOf('site-dashboard-shared.js') < html.indexOf(entry),
    name + ' loads the shared counter before its entry script');
}
assert(settingsJs.includes('wardenSiteDashSummarize(report)'), 'Settings uses the shared counter');
assert(settingsJs.includes('WardenOne actions on this page'), 'Settings labels the combined total honestly');
assert(!settingsJs.includes('Network blocks on this tab'), 'Settings no longer labels page actions as network-only');

console.log('[ok] shared Site Dashboard counts include network and page actions');

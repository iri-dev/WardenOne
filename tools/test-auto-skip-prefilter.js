/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
function lift(name) {
  const match = source.match(new RegExp(name + '=(\\/(?:\\\\.|[^\\/])*\\/[a-z]*)'));
  assert(match, name + ' exists');
  return vm.runInNewContext(match[1]);
}
const start = source.indexOf('tryAutoSkip=()=>{');
const end = source.indexOf('start=()=>{', start);
assert(start >= 0 && end > start, 'the auto-skip function is present');
const code = 'const ' + source.slice(start, end).replace(/,\s*$/, ';') + 'globalThis.run=tryAutoSkip;';

function scan(elements) {
  let textReads = 0;
  let adChecks = 0;
  const nodes = elements.map((entry) => ({
    textContent: entry.text || '',
    className: entry.className || '',
    id: entry.id || '',
    get innerText() { textReads++; return entry.visible === undefined ? entry.text || '' : entry.visible; },
  }));
  const context = {
    document: { querySelectorAll: () => nodes },
    WO: { autoSkipDownloadAds: true, __autoSkippedOnce: false },
    overlayCleanerOn: () => true,
    AD_SIGNAL: lift('AD_SIGNAL'),
    AUTO_SKIP_AD_HINT: lift('AUTO_SKIP_AD_HINT'),
    findDownloadUrl: () => { adChecks++; return null; },
    findContinueLink: () => null,
  };
  vm.runInNewContext(code, context);
  assert.strictEqual(context.run(), false);
  return { textReads, adChecks };
}

assert.deepStrictEqual(scan(Array.from({ length: 160 }, () => ({ text: 'Ordinary article text' }))),
  { textReads: 0, adChecks: 0 }, 'ordinary containers do not trigger layout-dependent text reads');
for (const [entry, label] of [
  [{ text: 'Sponsored' }, 'visible sponsor label'],
  [{ text: 'continuetodownload', visible: 'continue to download' }, 'spaces inserted by layout'],
  [{ text: 'adchoices', visible: 'ad choices' }, 'split ad choices'],
  [{ className: 'box-c21-modal' }, 'named download modal'],
  [{ id: 'data-campaign-7' }, 'campaign marker'],
]) {
  const result = scan([entry]);
  assert.strictEqual(result.adChecks, 1, label + ' still reaches the download-gate check');
}
assert.deepStrictEqual(scan([{ text: 'Download a manual', visible: 'Read a manual' }]),
  { textReads: 1, adChecks: 0 }, 'the cheap hint does not itself establish an ad');

console.log('auto-skip prefilter tests passed');

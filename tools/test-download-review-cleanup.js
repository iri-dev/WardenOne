/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const vm = require('vm');
const { world, download } = require('./test-download-early-pause.js');

const pending = (sandbox, id) => (sandbox.store.wardenone_pending_downloads || {})[String(id)];
const reviewTab = (id) => ({ id, url: 'chrome-extension://wardenone/download-review.html?id=' + id });

async function addReview(sandbox, id, extra = {}) {
  const review = Object.assign({ id: String(id), downloadId: id, grade: 'D', paused: true, createdAt: Date.now() }, extra);
  await sandbox.rememberPendingDownload(review);
  sandbox.openTabs.push(reviewTab(id));
  return review;
}

async function main() {
  for (const closeTabs of [false, true]) {
    for (const failure of ['callback error', 'synchronous throw', 'missing result', 'malformed result']) {
      const { guard, sandbox } = world();
      const item = download(601, 'https://files.example/tool.exe', { paused: true });
      sandbox.downloadItems.push(item, download(602, 'https://files.example/old.exe', { state: 'interrupted' }),
        download(603, 'https://files.example/active.exe', { paused: true }));
      const review = await addReview(sandbox, 601);
      await addReview(sandbox, 602);
      await addReview(sandbox, 603);
      const saved = JSON.stringify(review);
      const search = sandbox.chrome.downloads.search;
      sandbox.chrome.downloads.search = (query, cb) => {
        if (Number(query.id) !== 601) return search(query, cb);
        if (failure === 'synchronous throw') throw new Error('Download lookup unavailable');
        if (failure === 'missing result') return cb();
        if (failure === 'malformed result') return cb({});
        sandbox.chrome.runtime.lastError = { message: 'Download lookup unavailable' };
        try { cb([]); } finally { sandbox.chrome.runtime.lastError = null; }
      };

      await guard.cleanupDownloadReviews(closeTabs);
      assert.equal(JSON.stringify(pending(sandbox, 601)), saved, failure + ': retain the persisted review');
      assert.equal(vm.runInContext('PENDING_DOWNLOADS["601"].id', sandbox), '601', failure + ': retain the in-memory review');
      assert(!sandbox.closedTabs.includes(601), failure + ': retain its review window');
      assert(pending(sandbox, 603), failure + ': retain other active reviews');
      assert(!pending(sandbox, 602), failure + ': continue cleaning confirmed obsolete reviews');
      assert.equal(sandbox.closedTabs.includes(602), closeTabs);
      await guard.runDownloadGuardScan(601, { id: 601 }, 'changed');
      assert.equal(JSON.stringify(pending(sandbox, 601)), saved, failure + ': a rescan retains the review');
      assert(!sandbox.closedTabs.includes(601), failure + ': a rescan cannot dismiss an unknown download');
      assert.equal(await sandbox.downloadSearch({ id: 601 }), null, failure + ': report an unknown lookup');
      await assert.rejects(sandbox.downloadSearch({ id: 601 }, true), failure + ': strict lookups must reject');

      sandbox.chrome.downloads.search = search;
      item.state = 'interrupted';
      await guard.cleanupDownloadReviews(true);
      assert(!pending(sandbox, 601), failure + ': remove the review after Chrome confirms interruption');
      assert(sandbox.closedTabs.includes(601));
      assert(pending(sandbox, 603));
    }
  }
  console.log('  [ok] unknown lookups retain reviews and windows while confirmed obsolete neighbors are cleaned');

  for (const scenario of [
    { name: 'confirmed missing download', missing: true, obsolete: true },
    { name: 'confirmed interrupted download', state: 'interrupted', obsolete: true },
    { name: 'paused download completed externally', state: 'complete', obsolete: true },
    { name: 'download still paused', state: 'in_progress', obsolete: false },
    { name: 'saved file awaiting a decision', state: 'complete', review: { paused: false, finishedBeforeStop: true }, obsolete: false },
    { name: 'unconfirmed cleanup with no Chrome entry', missing: true,
      review: { removed: { cancelled: true, removedFile: false }, cleanupPending: true, interventionFailed: true }, obsolete: false },
    { name: 'confirmed deletion notice', missing: true,
      review: { removed: { removedFile: true }, autoBlocked: true }, obsolete: false },
  ]) {
    const { guard, sandbox } = world();
    if (!scenario.missing) sandbox.downloadItems.push(download(611, 'https://files.example/tool.exe', { state: scenario.state, paused: true }));
    await addReview(sandbox, 611, scenario.review);
    const items = await sandbox.downloadSearch({ id: 611 });
    assert(Array.isArray(items), scenario.name + ': successful lookups return an array');
    await guard.cleanupDownloadReviews(true);
    assert.equal(!pending(sandbox, 611), scenario.obsolete, scenario.name);
    assert.equal(sandbox.closedTabs.includes(611), scenario.obsolete, scenario.name);
  }
  console.log('  [ok] confirmed missing, interrupted and completed states retain their existing review policy');
  console.log('[ok] download review cleanup tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

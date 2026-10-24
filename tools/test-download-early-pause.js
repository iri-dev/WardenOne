/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Download Guard's race with small downloads: what pauses before the scheduled scan, and how a
   review tells a download it stopped from a file that had already finished.
   Run: node tools/test-download-early-pause.js */
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');
const { loadDownloadGuard } = require('./test-download-guard.js');

const FEED_KEY = 'wardenone_download_threat_feeds';
const tick = () => new Promise((resolve) => setImmediate(resolve));

/* Chrome's own rules: pause and resume need an in-progress download, removeFile a complete one,
   cancel is a silent no-op once finished, and erase drops the entry. */
function chromeDownloads(sandbox) {
  const d = sandbox.chrome.downloads;
  const find = (id) => sandbox.downloadItems.find((x) => Number(x.id) === Number(id));
  const fail = (cb, message) => {
    sandbox.chrome.runtime.lastError = { message };
    try { if (cb) cb(); } finally { sandbox.chrome.runtime.lastError = null; }
  };
  d.pause = (id, cb) => {
    sandbox.calls.push(['pause', Number(id)]);
    const it = find(id);
    if (sandbox.beforePause) sandbox.beforePause(it);
    if (!it || it.state !== 'in_progress' || sandbox.pauseFails) return fail(cb, 'Download must be in progress');
    it.paused = true;
    if (cb) cb();
  };
  d.resume = (id, cb) => {
    sandbox.calls.push(['resume', Number(id)]);
    const it = find(id);
    if (!it || it.state !== 'in_progress') return fail(cb, 'Download must be resumable');
    it.paused = false;
    if (cb) cb();
  };
  d.cancel = (id, cb) => {
    sandbox.calls.push(['cancel', Number(id)]);
    const it = find(id);
    if (sandbox.beforeCancel) sandbox.beforeCancel(it);
    if (sandbox.cancelFails) return fail(cb, 'Cancellation failed');
    if (it && it.state === 'in_progress' && !sandbox.cancelNoOp) it.state = 'interrupted';
    if (cb) cb();
  };
  d.removeFile = (id, cb) => {
    sandbox.calls.push(['removeFile', Number(id)]);
    const it = find(id);
    if (!it || it.state !== 'complete' || sandbox.removeFileFails) return fail(cb, 'Download must be complete');
    it.exists = false;
    if (cb) cb();
  };
  d.erase = (query, cb) => {
    sandbox.calls.push(['erase', Number(query && query.id)]);
    if (sandbox.eraseFails) return fail(cb, 'Erasure failed');
    const at = sandbox.downloadItems.findIndex((x) => Number(x.id) === Number(query && query.id));
    if (at >= 0) sandbox.downloadItems.splice(at, 1);
    if (cb) cb([query && query.id]);
  };
}

function world() {
  const { guard, sandbox } = loadDownloadGuard();
  chromeDownloads(sandbox);
  sandbox.crypto = crypto.webcrypto;
  sandbox.TextEncoder = TextEncoder;
  sandbox.decisions = [];
  sandbox.queueHistory = (entry) => {
    sandbox.calls.push(['history', entry && entry.type]);
    if (entry && entry.type === 'download_guard') sandbox.decisions.push(entry.detail.decision);
  };
  sandbox.messageSenderIsTab = () => false;
  sandbox.openTabs = [];
  sandbox.closedTabs = [];
  sandbox.tabsQuery = async () => sandbox.openTabs.slice();
  sandbox.tabsRemove = async (ids) => { sandbox.closedTabs.push(...[].concat(ids)); return { ok: true }; };
  sandbox.focuses = 0;
  sandbox.tabsUpdate = async () => { sandbox.focuses++; return { ok: true }; };
  return { guard, sandbox };
}

function download(id, url, extra) {
  const name = url.split('/').pop();
  return Object.assign({
    id, url, finalUrl: url, referrer: '', filename: 'C:\\Downloads\\' + name,
    mime: 'application/octet-stream', danger: '', state: 'in_progress', startTime: new Date().toISOString(),
  }, extra || {});
}

const paused = (sandbox, id) => sandbox.calls.some((c) => c[0] === 'pause' && c[1] === id);
const pending = (sandbox, id) => sandbox.store.wardenone_pending_downloads && sandbox.store.wardenone_pending_downloads[String(id)];

async function listFeed(sandbox, lines) {
  const packed = await vm.runInContext('packDownloadThreatFeed', sandbox)('payload-urls', lines.join('\n'));
  sandbox.store[FEED_KEY] = { version: 1, updatedAt: Date.now(), sha256Prefixes: '',
    payloadUrlKeys: packed.packed, payloadUrlDirDepths: packed.dirDepths };
  vm.runInContext('resetDownloadThreatFeedCache()', sandbox);
}

async function main() {
  /* ---- which names pause at creation ---- */
  {
    const { guard } = world();
    for (const name of ['setup.exe', 'invoice.pdf.exe', 'disk.iso', 'invoice.zip', 'photos.7z', 'logs.tar.gz',
      'backup.rar', 'contract.docm', 'budget.xlsm', 'deck.pptm', 'macros.xlsb']) {
      assert.equal(guard.downloadLooksRisky({ filename: 'C:\\Downloads\\' + name }), true, name + ' pauses at creation');
    }
    assert.equal(guard.downloadLooksRisky({ url: 'https://files.example/archive.zip?sig=1' }), true, 'the URL name counts before Chrome picks a filename');
    for (const name of ['photo.png', 'paper.pdf', 'notes.docx', 'sheet.xlsx', 'song.mp3']) {
      assert.equal(guard.downloadLooksRisky({ filename: 'C:\\Downloads\\' + name }), false, name + ' is left to the scan');
    }
    console.log('  [ok] archives and macro-enabled Office files pause with programs and disk images');
  }

  /* ---- archives and macro documents pause before any await ---- */
  {
    const { guard, sandbox } = world();
    for (const [id, url] of [[101, 'https://files.example/archive.zip'], [102, 'https://files.example/report.docm']]) {
      sandbox.downloadItems.push(download(id, url));
      assert.equal(guard.handleDownloadCreated(download(id, url, { filename: '' })), null, 'no list check needed for a risky name');
      assert(paused(sandbox, id), url + ' was not paused synchronously in onCreated');
      assert(guard.EARLY_PAUSED.has(String(id)));
    }

    sandbox.__cfgCache = Object.assign({}, sandbox.__cfgCache, { downloadReputation: false });
    guard.handleDownloadCreated(download(103, 'https://files.example/archive.zip'));
    assert(!paused(sandbox, 103), 'an off Download Guard never pauses');
    console.log('  [ok] a risky name pauses synchronously, and only while Download Guard is on');
  }

  /* ---- a Content-Disposition name arrives after onCreated (measured in Edge: 4-31 ms later) ---- */
  {
    const { guard, sandbox } = world();
    const named = download(111, 'https://files.example/get?id=1', { filename: '' });
    sandbox.downloadItems.push(named);
    await guard.handleDownloadCreated(named);
    assert(!paused(sandbox, 111), 'nothing about /get?id=1 is risky yet');
    guard.handleDownloadChanged({ id: 111, filename: { previous: '', current: 'C:\\Downloads\\setup.exe' } });
    assert(paused(sandbox, 111), 'the filename event did not pause a Content-Disposition setup.exe');
    assert(guard.EARLY_PAUSED.has('111'), 'the scan must know to resume it if it grades clean');

    const doc = download(112, 'https://files.example/get?id=2', { filename: '' });
    sandbox.downloadItems.push(doc);
    await guard.handleDownloadCreated(doc);
    guard.handleDownloadChanged({ id: 112, filename: { previous: '', current: 'C:\\Downloads\\notes.docx' } });
    assert(!paused(sandbox, 112), 'an ordinary document name is left to the scan');

    named.filename = 'C:\\Downloads\\setup.exe';
    await guard.runDownloadGuardScan(111, named, 'created');
    const callsAfterScan = sandbox.calls.length;
    guard.handleDownloadChanged({ id: 111, filename: { previous: '', current: 'C:\\Downloads\\setup.exe' } });
    guard.handleDownloadChanged({ id: 999, filename: { previous: '', current: 'C:\\Downloads\\old.exe' } });
    assert(!sandbox.calls.slice(callsAfterScan).some((c) => c[0] === 'pause'),
      'a filename event after the first scan, or for a download this worker never saw created, must not pause');
    console.log('  [ok] a risky Content-Disposition name pauses on the filename event, before the first scan only');
  }

  /* ---- a listed address with a harmless name pauses before the scan decides ---- */
  {
    const { guard, sandbox } = world();
    await listFeed(sandbox, ['||cdn.example/files/report.pdf^$all']);
    const listed = download(201, 'https://cdn.example/files/report.pdf', { mime: 'application/pdf' });
    sandbox.downloadItems.push(listed);

    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const plainGet = sandbox.localGetStrict;
    sandbox.localGetStrict = (key) => (key === FEED_KEY ? gate.then(() => plainGet(key)) : plainGet(key));
    vm.runInContext('resetDownloadThreatFeedCache()', sandbox);
    let searches = 0;
    const search = sandbox.chrome.downloads.search;
    sandbox.chrome.downloads.search = (query, cb) => { searches++; search(query, cb); };

    const check = guard.handleDownloadCreated(listed);
    assert(check && typeof check.then === 'function', 'a harmless name still gets a list check');
    assert(!paused(sandbox, 201), 'nothing is known about the address yet');
    const scan = guard.runDownloadGuardScan(201, listed, 'created');
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(searches, 0, 'the scan waits for the early check instead of racing it');
    release();
    await check;
    assert(paused(sandbox, 201), 'a listed address pauses from onCreated');
    await scan;
    const review = pending(sandbox, 201);
    assert(review, 'the listed download is reviewed');
    assert.equal(review.grade, 'E');
    assert.equal(review.paused, true);
    assert.equal(review.finishedBeforeStop, false);
    assert(!sandbox.calls.some((c) => c[0] === 'resume'), 'a listed download is never resumed by the scan');
    console.log('  [ok] a listed payload address pauses at creation and the scan waits for that check');
  }

  {
    const { guard, sandbox } = world();
    sandbox.BLOCKED_DOMAINS = new Set(['bad.example']);
    await guard.handleDownloadCreated(download(211, 'https://dl.bad.example/readme.txt'));
    assert(paused(sandbox, 211), 'a blocklisted host pauses whatever the name');
    await guard.handleDownloadCreated(download(212, 'blob:https://bad.example/0d1f'));
    assert(paused(sandbox, 212), 'a blob download carries its origin');
    await guard.handleDownloadCreated(download(213, 'https://files.example/photo.png'));
    assert(!paused(sandbox, 213), 'an unlisted ordinary file is not paused');
    assert(!guard.EARLY_PAUSED.has('213'));
    console.log('  [ok] a blocklisted host pauses at creation; ordinary files do not');
  }

  /* ---- a file that finished first is reviewed as saved, and the review survives ---- */
  {
    const { guard, sandbox } = world();
    const done = download(301, 'https://smallvendor.example/files/tool.exe', { state: 'complete', endTime: new Date().toISOString() });
    sandbox.downloadItems.push(done);
    sandbox.openTabs = [{ id: 9, url: 'chrome-extension://wardenone/download-review.html?id=301' }];
    await guard.runDownloadGuardScan(301, done, 'created');
    const review = pending(sandbox, 301);
    assert(review, 'a finished risky file is still reviewed');
    assert.equal(review.paused, false);
    assert.equal(review.finishedBeforeStop, true);
    assert.equal(review.recommendation, 'Review the source before opening this file.');

    assert.equal(sandbox.focuses, 1, 'the review window opens once');
    await guard.runDownloadGuardScan(301, null, 'created-followup');
    assert(pending(sandbox, 301), 'the 1.2 s follow-up scan withdrew the review of a saved file');
    assert.equal(sandbox.focuses, 1, 'a rescan of a finished file pulled its review window forward again');
    await guard.cleanupDownloadReviews(true);
    assert(pending(sandbox, 301), 'the review page loading closed its own review');
    assert.deepEqual(sandbox.closedTabs, [], 'the review window was closed under the reader');

    const kept = await guard.handleDownloadDecision(301, 'continue', {});
    assert.equal(kept.decision, 'kept');
    assert(!sandbox.calls.some((c) => c[0] === 'resume'), 'there is nothing to resume');
    assert.deepEqual(sandbox.decisions, ['kept']);
    console.log('  [ok] a file saved before the pause keeps its review until answered');
  }

  {
    const { guard, sandbox } = world();
    for (const id of [311, 312]) {
      const done = download(id, 'https://smallvendor.example/files/tool' + id + '.exe', { state: 'complete', exists: true, endTime: new Date().toISOString() });
      sandbox.downloadItems.push(done);
      await guard.runDownloadGuardScan(id, done, 'created');
    }
    sandbox.openTabs = [311, 312].map((id) => ({ id, url: 'chrome-extension://wardenone/download-review.html?id=' + id }));
    const deleted = await guard.handleDownloadDecision(311, 'cancel', {});
    assert.equal(deleted.deleted, true);
    assert.equal(deleted.decision, 'deleted');
    for (let i = 0; i < 5; i++) await tick();
    assert(sandbox.closedTabs.includes(311));

    sandbox.removeFileFails = true;
    const failed = await guard.handleDownloadDecision(312, 'cancel', {});
    for (let i = 0; i < 5; i++) await tick();
    assert.equal(failed.deleted, false);
    assert.equal(failed.ok, false);
    assert.equal(failed.decision, 'delete failed');
    assert(pending(sandbox, 312), 'a failed delete retains the review for retry');
    assert(sandbox.downloadItems.some((item) => item.id === 312), 'a failed delete retains the download ID for retry');
    assert(!sandbox.closedTabs.includes(312), 'a failed delete closed the window that says what to do next');

    await guard.cleanupDownloadReviews(true);
    vm.runInContext('delete PENDING_DOWNLOADS["312"]', sandbox);
    const failedAgain = await guard.handleDownloadDecision(312, 'cancel', {});
    assert.equal(failedAgain.ok, false, 'a second failed deletion is an unsuccessful operation');
    assert.equal(failedAgain.decision, 'delete failed', 'the second attempt must still find the persisted review');
    assert.equal(failedAgain.deleted, false);
    assert.equal(failedAgain.review.createdAt, failed.review.createdAt);
    assert(pending(sandbox, 312), 'a repeated failure retains the review');
    assert.equal(sandbox.downloadItems.find((item) => item.id === 312).exists, true);
    assert(!sandbox.closedTabs.includes(312));
    const page = loadReviewPage();
    page.show(failed.review);
    page.box.reply = failedAgain;
    vm.runInContext('decide', page.box)('cancel');
    assert.equal(page.text('cancel'), 'Retry Delete File');
    assert.equal(page.byId('cancel').disabled, false);
    assert.equal(page.box.closed, 0);

    sandbox.removeFileFails = false;
    const retried = await guard.handleDownloadDecision(312, 'cancel', {});
    assert.equal(retried.ok, true);
    assert.equal(retried.decision, 'deleted');
    assert.equal(retried.deleted, true);
    assert(!pending(sandbox, 312), 'confirmed deletion resolves the review');
    assert.equal(sandbox.calls.filter((call) => call[0] === 'removeFile' && call[1] === 312).length, 3,
      'each retry must reach Chrome instead of returning a missing-review error');
    for (let i = 0; i < 5; i++) await tick();
    assert(sandbox.closedTabs.includes(312));
    assert.deepEqual(sandbox.decisions, ['deleted', 'delete failed', 'delete failed', 'deleted']);
    console.log('  [ok] saved-file deletion keeps its review through repeated failures and can succeed on retry');
  }

  /* ---- a pause refused because the file just finished ---- */
  {
    const { guard, sandbox } = world();
    const racing = download(321, 'https://smallvendor.example/files/tool.exe');
    sandbox.downloadItems.push(racing);
    sandbox.beforePause = (it) => { if (it) it.state = 'complete'; };
    await guard.runDownloadGuardScan(321, racing, 'created');
    const review = pending(sandbox, 321);
    assert.equal(review.paused, false);
    assert.equal(review.finishedBeforeStop, true, 'a refused pause is checked against Chrome, not assumed');
    console.log('  [ok] a download that finishes just before the pause is reported as saved');
  }

  /* ---- a pause refused mid-download, and the file finishes later ---- */
  {
    const { guard, sandbox } = world();
    const stuck = download(331, 'https://smallvendor.example/files/tool.exe');
    sandbox.downloadItems.push(stuck);
    const pause = sandbox.chrome.downloads.pause;
    sandbox.chrome.downloads.pause = (id, cb) => {
      sandbox.chrome.runtime.lastError = { message: 'Download must be resumable' };
      try { cb(); } finally { sandbox.chrome.runtime.lastError = null; }
    };
    await guard.runDownloadGuardScan(331, stuck, 'created');
    assert.equal(pending(sandbox, 331).paused, false);
    assert.equal(pending(sandbox, 331).finishedBeforeStop, false, 'still downloading is not finished');
    sandbox.chrome.downloads.pause = pause;
    stuck.state = 'complete';
    await guard.runDownloadGuardScan(331, { id: 331 }, 'changed');
    assert(pending(sandbox, 331), 'an unpaused download finishing must not withdraw its review');
    assert.equal(pending(sandbox, 331).finishedBeforeStop, true, 'the review now says the file is saved');
    console.log('  [ok] a review that could not pause is updated when the file lands');
  }

  /* ---- a paused review the reader resumed elsewhere still lapses ---- */
  {
    const { guard, sandbox } = world();
    const held = download(341, 'https://smallvendor.example/files/tool.exe');
    sandbox.downloadItems.push(held);
    await guard.runDownloadGuardScan(341, held, 'created');
    assert.equal(pending(sandbox, 341).paused, true);
    held.state = 'complete';
    await guard.runDownloadGuardScan(341, { id: 341 }, 'changed');
    assert(!pending(sandbox, 341), 'a download resumed outside the review and finished is settled');
    console.log('  [ok] a paused download resumed outside the review still withdraws it');
  }

  /* ---- critical files: blocked in flight versus deleted after finishing ---- */
  {
    const { guard, sandbox } = world();
    const inFlight = download(351, 'https://evil.example/payload.exe', { danger: 'content' });
    sandbox.downloadItems.push(inFlight);
    await guard.runDownloadGuardScan(351, inFlight, 'created');
    const blocked = pending(sandbox, 351);
    assert.equal(blocked.autoBlocked, true);
    assert.equal(blocked.finishedBeforeStop, false);
    assert.equal(blocked.removed.removedFile, false, 'an in-flight download has no finished file to remove');
    assert.equal(blocked.recommendation, 'Do not download this file again.');
    await guard.cleanupDownloadReviews(true);
    assert(pending(sandbox, 351), 'the block notice vanished once its entry was erased');
    await guard.runDownloadGuardScan(351, { id: 351 }, 'changed');
    assert.equal(JSON.stringify(pending(sandbox, 351)), JSON.stringify(blocked), 'a rescan rewrote a finished notice');

    const landed = download(352, 'https://evil.example/second.exe', { danger: 'content', state: 'complete', endTime: new Date().toISOString() });
    sandbox.downloadItems.push(landed);
    await guard.runDownloadGuardScan(352, landed, 'created');
    const removed = pending(sandbox, 352);
    assert.equal(removed.autoBlocked, true);
    assert.equal(removed.finishedBeforeStop, true);
    assert.equal(removed.removed.removedFile, true);
    assert.deepEqual(sandbox.decisions, ['blocked before it finished', 'deleted after it finished']);
    console.log('  [ok] history records whether a critical file was stopped or deleted after it finished');
  }

  for (const scenario of [
    { name: 'all removal APIs fail', cancelFails: true, removeFileFails: true, eraseFails: true, stopped: false, paused: true },
    { name: 'pause and removal fail', pauseFails: true, cancelFails: true, removeFileFails: true, stopped: false, paused: false },
    { name: 'completed cancellation is a no-op', state: 'complete', removeFileFails: true, stopped: false, finished: true },
    { name: 'completion races cancellation', completeOnCancel: true, removeFileFails: true, stopped: false, finished: true },
    { name: 'cancellation callback leaves transfer running', cancelNoOp: true, removeFileFails: true, stopped: false, paused: true },
    { name: 'cancellation state cannot be read', searchFailsAfterCancel: true, stopped: false },
    { name: 'cancel succeeds and erase fails', eraseFails: true, stopped: true, cancelled: true },
    { name: 'deletion succeeds despite cancel failure', state: 'complete', cancelFails: true, stopped: true, deleted: true, finished: true },
    { name: 'deletion succeeds and erase fails', state: 'complete', eraseFails: true, stopped: true, deleted: true, finished: true },
  ]) {
    const { guard, sandbox } = world();
    Object.assign(sandbox, scenario);
    const search = sandbox.chrome.downloads.search;
    if (scenario.completeOnCancel) sandbox.beforeCancel = (item) => { item.state = 'complete'; };
    if (scenario.searchFailsAfterCancel) sandbox.beforeCancel = () => {
      sandbox.chrome.downloads.search = (_query, cb) => {
        sandbox.chrome.runtime.lastError = { message: 'Search failed' };
        try { cb(); } finally { sandbox.chrome.runtime.lastError = null; }
      };
    };
    const item = download(361, 'https://evil.example/payload.exe', { danger: 'content', state: scenario.state || 'in_progress' });
    sandbox.downloadItems.push(item);
    sandbox.openTabs = [{ id: 19, url: 'chrome-extension://wardenone/download-review.html?id=361' }];
    await guard.runDownloadGuardScan(361, item, 'created');
    const review = pending(sandbox, 361);
    assert.equal(review.autoBlocked, scenario.stopped, scenario.name);
    assert.equal(review.interventionFailed, !scenario.stopped, scenario.name);
    assert.equal(review.paused, !!scenario.paused, scenario.name);
    assert.equal(review.finishedBeforeStop, !!scenario.finished, scenario.name);
    assert.equal(review.removed.cancelled, !!scenario.cancelled, scenario.name);
    assert.equal(review.removed.removedFile, !!scenario.deleted, scenario.name);
    assert.equal(review.removed.erased, scenario.stopped && !scenario.eraseFails, scenario.name);
    assert.equal(sandbox.calls.some((call) => call[0] === 'erase'), scenario.stopped,
      scenario.name + ': erase must not destroy the recovery handle before removal succeeds');
    assert.equal(sandbox.decisions[0], scenario.stopped
      ? (scenario.deleted ? 'deleted after it finished' : 'blocked before it finished') : 'automatic block failed', scenario.name);
    assert.equal(sandbox.store.wardenone_download_handled['361'].decision, scenario.stopped ? 'auto-blocked' : 'auto-block failed');
    await guard.cleanupDownloadReviews(true);
    assert(pending(sandbox, 361), scenario.name + ': cleanup discarded the notice');
    assert.deepEqual(sandbox.closedTabs, [], scenario.name);

    const { byId, text, show } = loadReviewPage();
    show(review);
    assert.equal(byId('continue').hidden, true, scenario.name + ': critical downloads cannot be continued');
    assert.equal(byId('trust-continue').hidden, true, scenario.name);
    if (scenario.stopped) {
      assert.equal(text('cancel'), 'Close');
      const callCount = sandbox.calls.filter((call) => ['cancel', 'removeFile', 'erase'].includes(call[0])).length;
      const dismissed = await guard.handleDownloadDecision(361, 'cancel', {});
      assert.equal(dismissed.ok, true);
      assert.equal(sandbox.calls.filter((call) => ['cancel', 'removeFile', 'erase'].includes(call[0])).length, callCount,
        scenario.name + ': Close dismisses a confirmed-removal notice without retrying removal');
      continue;
    }
    assert.equal(text('title'), 'Download removal could not be confirmed');
    assert.equal(text('cancel'), scenario.finished ? 'Retry Delete File' : 'Retry Cancel Download');
    assert.match(text('pause-note'), /could not confirm it was stopped or deleted/);
    assert.equal(sandbox.downloadItems.includes(item), true, scenario.name + ': download remains available for retry');
    assert.notEqual(review.recommendation, 'Do not download this file again.');
    const denied = await guard.handleDownloadDecision(361, 'continue', {});
    assert.equal(denied.ok, false);
    const retryFailed = await guard.handleDownloadDecision(361, 'cancel', {});
    assert.equal(retryFailed.ok, false, scenario.name);
    assert(pending(sandbox, 361), scenario.name + ': failed retry discarded its review');
    assert.deepEqual(sandbox.closedTabs, [], scenario.name);

    Object.assign(sandbox, { cancelFails: false, removeFileFails: false, eraseFails: false, cancelNoOp: false, beforeCancel: null });
    sandbox.chrome.downloads.search = search;
    await guard.runDownloadGuardScan(361, { id: 361 }, 'changed');
    const recovered = pending(sandbox, 361);
    assert.equal(recovered.autoBlocked, true, scenario.name + ': subsequent scans must retry removal');
    assert.equal(recovered.interventionFailed, false);
    assert.equal(recovered.createdAt, review.createdAt);
    assert.equal(sandbox.decisions[sandbox.decisions.length - 1], scenario.finished ? 'deleted after it finished' : 'blocked before it finished');
  }
  console.log('  [ok] critical removal failures preserve warnings, retry handles and accurate history');

  {
    const { guard, sandbox } = world();
    const item = download(371, 'https://evil.example/payload.exe', { danger: 'content' });
    sandbox.downloadItems.push(item);
    sandbox.cancelFails = true;
    await guard.runDownloadGuardScan(371, item, 'created');
    item.state = 'complete';
    sandbox.removeFileFails = true;
    await guard.cleanupDownloadReviews(true);
    assert(pending(sandbox, 371), 'finishing after a failed removal must retain the warning');
    await guard.runDownloadGuardScan(371, { id: 371 }, 'changed');
    assert.equal(pending(sandbox, 371).finishedBeforeStop, true);
    assert.equal(pending(sandbox, 371).paused, false);
    sandbox.removeFileFails = false;
    const retry = await guard.handleDownloadDecision(371, 'cancel', {});
    assert.equal(retry.ok, true);
    assert.equal(retry.deleted, true);
    assert(!pending(sandbox, 371), 'a successful manual retry resolves the warning');
    console.log('  [ok] completion after failed removal keeps the warning and manual deletion can recover');
  }

  /* ---- the review window says which case it is ---- */
  {
    const { box, byId, text, show } = loadReviewPage();

    show({ paused: true });
    assert.equal(text('title'), 'Download paused for review');
    assert.match(text('pause-note'), /paused until you choose/);
    assert.equal(text('cancel'), 'Cancel Download');
    assert.equal(text('continue'), 'Continue Download');

    show({ paused: false, finishedBeforeStop: true });
    assert.equal(text('title'), 'Downloaded before it could be paused');
    assert.match(text('pause-note'), /already saved on your computer/);
    assert.equal(text('cancel'), 'Delete File');
    assert.equal(text('continue'), 'Keep File');

    show({ paused: false, pauseError: 'Download must be resumable' });
    assert.match(text('pause-note'), /could not pause this download/);
    assert.equal(text('cancel'), 'Cancel Download', 're-rendering resets the button labels');

    show({ grade: 'F', autoBlocked: true, finishedBeforeStop: false, removed: { removedFile: false } });
    assert.equal(text('title'), 'Download blocked before it finished');
    assert.match(text('pause-note'), /before it finished/);
    assert.equal(text('cancel'), 'Close');
    show({ grade: 'F', autoBlocked: true, finishedBeforeStop: true, removed: { removedFile: true } });
    assert.equal(text('title'), 'Dangerous file deleted');
    assert.match(text('pause-note'), /finished downloading before WardenOne could stop it\. WardenOne deleted it/);
    show({ grade: 'F', autoBlocked: true, finishedBeforeStop: true, removed: { removedFile: false } });
    assert.equal(text('title'), 'Dangerous file already downloaded');
    assert.match(text('pause-note'), /could not confirm it was deleted/);

    show({ paused: false, finishedBeforeStop: true });
    box.reply = { ok: false, decision: 'delete failed', deleted: false,
      review: { grade: 'F', finishedBeforeStop: true, interventionFailed: true, reasons: [] },
      error: 'WardenOne could not confirm this download was stopped or deleted. Retry removal.' };
    vm.runInContext('decide', box)('cancel');
    assert.match(text('result'), /could not confirm this download was stopped or deleted/);
    assert.equal(text('cancel'), 'Retry Delete File');
    assert.equal(byId('cancel').disabled, false, 'a failed retry must leave its button usable');
    assert.equal(box.closed, 0, 'the window closed before its instruction could be read');
    box.reply = { ok: true, decision: 'deleted', deleted: true };
    vm.runInContext('decide', box)('cancel');
    assert.equal(text('result'), 'File deleted.');
    assert.equal(box.closed, 1);

    show({ grade: 'F', interventionFailed: true, paused: true });
    box.reply = { ok: true, decision: 'deleted', deleted: true };
    vm.runInContext('setBusy', box)(false);
    vm.runInContext('decide', box)('cancel');
    assert.equal(text('result'), 'File deleted.', 'a manual retry can delete a file that completed since rendering');
    show({ grade: 'F', autoBlocked: true, finishedBeforeStop: true, removed: { removedFile: true } });
    assert.equal(text('result'), '', 'an updated notice clears the previous intervention result');
    console.log('  [ok] the review window distinguishes stopped downloads from saved files');
  }

  console.log('[ok] download early-pause tests passed');
}

/* download-review.js in a minimal DOM. render() and decide() are its top-level functions. */
function loadReviewPage() {
  const elements = new Map();
  const element = () => ({
    textContent: '', hidden: false, disabled: false, className: '', style: {}, dataset: {}, onclick: null,
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    querySelector() { return element(); }, appendChild() {}, addEventListener() {},
  });
  const byId = (id) => { if (!elements.has(id)) elements.set(id, element()); return elements.get(id); };
  const box = {
    URLSearchParams, location: { search: '?id=7' }, closed: 0, sent: null,
    document: { body: element(), getElementById: byId, createElement: element, addEventListener() {} },
    setTimeout(fn) { fn(); return 1; }, clearTimeout() {}, setInterval() { return 1; }, clearInterval() {},
    chrome: { runtime: { lastError: null, onMessage: { addListener() {} },
      sendMessage(msg, cb) { box.sent = msg; if (cb) cb(box.reply); } } },
  };
  box.window = { close() { box.closed++; } };
  vm.createContext(box);
  vm.runInContext(fs.readFileSync('download-review.js', 'utf8'), box, { filename: 'download-review.js' });
  const text = (id) => byId(id).textContent;
  const show = (review) => vm.runInContext('render', box)(Object.assign({ grade: 'D', status: 'Unverified Source', reasons: [] }, review));
  return { box, byId, text, show };
}

module.exports = { world, download, loadReviewPage };
if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

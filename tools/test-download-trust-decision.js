/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* "Trust site & Continue": the review window and the worker must agree on which grades offer it.
   The window offered it on D while the worker refused anything but C, so the button always failed.
   Run: node tools/test-download-trust-decision.js */
'use strict';

const assert = require('assert/strict');
const vm = require('vm');
const { world, download, loadReviewPage } = require('./test-download-early-pause.js');

const pending = (sandbox, id) => sandbox.store.wardenone_pending_downloads && sandbox.store.wardenone_pending_downloads[String(id)];
const reviewDownload = (id, grade = 'D', extra = {}) => grade === 'C'
  ? download(id, 'https://smallvendor.example/files/report.pdf', { danger: 'sensitivecontentwarning', ...extra })
  : download(id, 'https://smallvendor.example/files/%00/tool.exe', extra);

async function main() {
  /* ---- a real grade-D review can be trusted, and the trust is remembered ---- */
  {
    const { guard, sandbox } = world();
    const page = loadReviewPage();
    const first = reviewDownload(401);
    sandbox.downloadItems.push(first);
    await guard.runDownloadGuardScan(401, first, 'created');
    const review = pending(sandbox, 401);
    assert.equal(review.grade, 'D', 'an installer with URL obfuscation is Unverified Source');
    assert.equal(review.paused, true);
    assert.equal(review.trustAllowed, true);
    assert.equal(review.trustHost, 'smallvendor.example');

    page.show(review);
    const trustBtn = page.byId('trust-continue');
    assert.equal(trustBtn.hidden, false, 'the review window no longer offers Trust on D');
    assert.equal(trustBtn.textContent, 'Trust smallvendor.example & Continue');

    const result = await guard.handleDownloadDecision(401, 'trust-continue', {});
    assert.equal(result.ok, true, 'the worker refused the Trust button the window showed: ' + (result.error || ''));
    assert.equal(result.decision, 'trusted and continued');
    assert.equal(result.trustedHost, 'smallvendor.example');
    assert(sandbox.calls.some((c) => c[0] === 'resume' && c[1] === 401), 'a trusted download must be resumed');
    assert.deepEqual([...sandbox.store.wardenone_download_trusted_sites], ['smallvendor.example']);
    assert(!pending(sandbox, 401), 'the answered review is withdrawn');

    const next = reviewDownload(402);
    sandbox.downloadItems.push(next);
    await guard.runDownloadGuardScan(402, next, 'created');
    assert(!pending(sandbox, 402), 'the next file from a trusted site was reviewed again');
    assert(!sandbox.calls.some((c) => c[0] === 'pause' && c[1] === 402), 'the next file from a trusted site was paused');
    console.log('  [ok] Trust & Continue on a grade-D review resumes it and remembers the site');
  }

  for (const scenario of [
    { grade: 'C', sites: undefined, failure: 'callback' },
    { grade: 'D', sites: ['other.example'], failure: 'callback' },
    { grade: 'D', sites: ['other.example', 'smallvendor.example'], failure: 'callback' },
    { grade: 'D', sites: ['other.example'], failure: 'throw' },
  ]) {
    const { guard, sandbox } = world();
    const item = reviewDownload(403, scenario.grade);
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(403, item, 'created');
    assert.equal(pending(sandbox, 403).grade, scenario.grade);
    sandbox.store.wardenone_download_trusted_sites = scenario.sites && scenario.sites.slice();
    const before = JSON.stringify(sandbox.store.wardenone_download_trusted_sites);
    sandbox.openTabs = [{ id: 17, url: 'chrome-extension://wardenone/download-review.html?id=403' }];
    const localSet = sandbox.localSet;
    let trustWrites = 0;
    sandbox.localSet = async (obj) => {
      if (Object.hasOwn(obj, 'wardenone_download_trusted_sites')) {
        trustWrites++;
        assert.equal(item.paused, false, 'trust must be saved after Chrome resumes the download');
      }
      return localSet(obj);
    };
    const resume = sandbox.chrome.downloads.resume;
    let resumeReached = false;
    let resumeCallback;
    sandbox.chrome.downloads.resume = (_id, cb) => {
      resumeReached = true;
      if (scenario.failure === 'throw') throw new Error('Resume failed');
      resumeCallback = cb;
    };
    const decision = guard.handleDownloadDecision(403, 'trust-continue', {});
    for (let i = 0; i < 10 && !resumeReached; i++) await new Promise((resolve) => setImmediate(resolve));
    assert.equal(resumeReached, true);
    assert.equal(trustWrites, 0, 'no trust write while resume is awaiting confirmation');
    assert.equal(JSON.stringify(sandbox.store.wardenone_download_trusted_sites), before);
    if (resumeCallback) {
      sandbox.chrome.runtime.lastError = { message: 'Resume failed' };
      try { resumeCallback(); } finally { sandbox.chrome.runtime.lastError = null; }
    }
    const result = await decision;
    assert.equal(result.ok, false);
    assert.match(result.error, /Resume failed/);
    assert.equal(trustWrites, 0, 'failed resume must not save trust');
    assert.equal(JSON.stringify(sandbox.store.wardenone_download_trusted_sites), before, 'existing trust decisions are preserved');
    assert.equal(pending(sandbox, 403).trusted, false);
    assert.equal(pending(sandbox, 403).paused, true);
    assert.deepEqual(sandbox.decisions, [], 'failed resume must not log trusted continuation');
    assert.deepEqual(sandbox.closedTabs, [], 'the failed action keeps its review available');
    sandbox.chrome.downloads.resume = resume;
    const retry = await guard.handleDownloadDecision(403, 'trust-continue', {});
    assert.equal(retry.ok, true);
    assert.equal(trustWrites, 1);
    assert.deepEqual([...sandbox.store.wardenone_download_trusted_sites],
      [...new Set([...(scenario.sites || []), 'smallvendor.example'])].sort());
    assert(!pending(sandbox, 403));
  }
  console.log('  [ok] refused and thrown resume failures never write trust, and the action can be retried');

  for (const failure of ['write', 'full']) {
    const { guard, sandbox } = world();
    const item = reviewDownload(404);
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(404, item, 'created');
    const page = loadReviewPage();
    page.show(pending(sandbox, 404));
    sandbox.store.wardenone_download_trusted_sites = failure === 'full'
      ? Array.from({ length: 1000 }, (_, i) => 'vendor' + i + '.example') : ['other.example'];
    const before = JSON.stringify(sandbox.store.wardenone_download_trusted_sites);
    const localSet = sandbox.localSet;
    sandbox.localSet = async (obj) => {
      if (Object.hasOwn(obj, 'wardenone_download_trusted_sites')) throw new Error('Trust storage unavailable');
      return localSet(obj);
    };
    const result = await guard.handleDownloadDecision(404, 'trust-continue', {});
    assert.equal(result.ok, false);
    assert.equal(result.continued, true);
    assert.match(result.error, /Chrome resumed this download, but WardenOne could not save the trust decision/);
    assert.match(result.error, failure === 'full' ? /list is full/ : /Trust storage unavailable/);
    assert.equal(item.paused, false);
    assert.equal(pending(sandbox, 404).paused, false, 'retry state must reflect the successful resume');
    assert.equal(pending(sandbox, 404).trusted, false);
    assert.equal(JSON.stringify(sandbox.store.wardenone_download_trusted_sites), before);
    assert.deepEqual(sandbox.decisions, ['continued; trust failed']);
    page.box.reply = result;
    vm.runInContext('decide', page.box)('trust-continue');
    assert.equal(page.text('result'), result.error, 'the review explains the partial success');
    assert.equal(page.text('title'), 'Download continued; trust was not saved');
    assert.match(page.text('pause-note'), /Chrome resumed this download/);
    assert.equal(page.byId('trust-continue').disabled, false);
    assert.equal(page.box.closed, 0);

    const failedRetry = await guard.handleDownloadDecision(404, 'trust-continue', {});
    assert.equal(failedRetry.ok, false);
    assert.equal(failedRetry.continued, true, 'a failed trust retry retains the confirmed continuation');
    assert.match(failedRetry.error, /Chrome resumed this download/);
    assert.deepEqual(sandbox.decisions, ['continued; trust failed'], 'a trust-only retry must not log another resume');

    sandbox.localSet = localSet;
    if (failure === 'full') sandbox.store.wardenone_download_trusted_sites.pop();
    const retry = await guard.handleDownloadDecision(404, 'trust-continue', {});
    assert.equal(retry.ok, true);
    assert.equal(sandbox.calls.filter((call) => call[0] === 'resume' && call[1] === 404).length, 1,
      'retrying trust after a successful resume must not resume again');
    assert(sandbox.store.wardenone_download_trusted_sites.includes('smallvendor.example'));
    assert(!pending(sandbox, 404));
  }
  console.log('  [ok] trust-save failures after resume report partial success and retain accurate retry state');

  {
    const { guard, sandbox } = world();
    const item = reviewDownload(405, 'D', { state: 'complete', endTime: new Date().toISOString() });
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(405, item, 'created');
    const result = await guard.handleDownloadDecision(405, 'trust-continue', {});
    assert.equal(result.ok, true);
    assert.equal(result.decision, 'trusted and kept');
    assert(!sandbox.calls.some((call) => call[0] === 'resume'), 'Trust & Keep has nothing to resume');
    assert.deepEqual([...sandbox.store.wardenone_download_trusted_sites], ['smallvendor.example']);
    console.log('  [ok] Trust & Keep still saves trust for an already completed file');
  }

  /* ---- for every grade, what the window offers is what the worker accepts ---- */
  {
    const offers = {};
    for (const [n, grade] of ['C', 'D', 'E', 'F'].entries()) {
      const { guard, sandbox } = world();
      const page = loadReviewPage();
      const id = 410 + n;
      sandbox.downloadItems.push(download(id, 'https://smallvendor.example/files/tool.exe'));
      const review = { id: String(id), downloadId: id, grade, status: grade, reasons: [], paused: true,
        trustAllowed: true, trusted: false, trustHost: 'smallvendor.example', createdAt: Date.now() };
      await vm.runInContext('rememberPendingDownload', sandbox)(review);
      page.show(review);
      const shown = !page.byId('trust-continue').hidden;
      const accepted = (await guard.handleDownloadDecision(id, 'trust-continue', {})).ok === true;
      assert.equal(accepted, shown, 'grade ' + grade + ': the window ' + (shown ? 'offers' : 'hides')
        + ' Trust but the worker ' + (accepted ? 'accepts' : 'refuses') + ' it');
      offers[grade] = shown;
    }
    assert.deepEqual(offers, { C: true, D: true, E: false, F: false }, 'Trust belongs to C and D only');
    console.log('  [ok] the review window and the worker agree on which grades can be trusted');
  }

  /* ---- grade alone is not enough: an ineligible source stays refused ---- */
  {
    const { guard, sandbox } = world();
    sandbox.downloadItems.push(download(420, 'https://smallvendor.example/files/tool.exe'));
    await vm.runInContext('rememberPendingDownload', sandbox)({ id: '420', downloadId: 420, grade: 'D', reasons: [],
      paused: true, trustAllowed: false, trustHost: 'smallvendor.example', createdAt: Date.now() });
    const refused = await guard.handleDownloadDecision(420, 'trust-continue', {});
    assert.equal(refused.ok, false);
    assert.match(refused.error, /not eligible/);
    assert.equal(sandbox.store.wardenone_download_trusted_sites, undefined, 'nothing was trusted');
    console.log('  [ok] a grade-D source that is not eligible for trust is still refused');
  }

  console.log('[ok] download trust decision tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

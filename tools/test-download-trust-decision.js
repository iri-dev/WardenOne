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

async function main() {
  /* ---- a real grade-D review can be trusted, and the trust is remembered ---- */
  {
    const { guard, sandbox } = world();
    const page = loadReviewPage();
    const first = download(401, 'http://smallvendor.example/files/tool.exe');
    sandbox.downloadItems.push(first);
    await guard.runDownloadGuardScan(401, first, 'created');
    const review = pending(sandbox, 401);
    assert.equal(review.grade, 'D', 'an insecure-transport installer from an unknown vendor is Unverified Source');
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

    const next = download(402, 'http://smallvendor.example/files/tool-2.exe');
    sandbox.downloadItems.push(next);
    await guard.runDownloadGuardScan(402, next, 'created');
    assert(!pending(sandbox, 402), 'the next file from a trusted site was reviewed again');
    assert(!sandbox.calls.some((c) => c[0] === 'pause' && c[1] === 402), 'the next file from a trusted site was paused');
    console.log('  [ok] Trust & Continue on a grade-D review resumes it and remembers the site');
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

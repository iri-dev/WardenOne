/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* A download from a page WardenOne already warned about is held, and a fake update's program is removed.
   The Browser Guard 1v1 (2026-11-13) saw a fake "ChromeSetup.exe" graded D, allowed and left on disk while
   the page itself showed a fake update warning; Browser Guard deleted it afterwards.
   Run: node tools/test-download-flagged-pages.js */
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const { loadDownloadGuard } = require('./test-download-guard.js');

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
    if (!it || it.state !== 'in_progress') return fail(cb, 'Download must be in progress');
    it.paused = true; if (cb) cb();
  };
  d.resume = (id, cb) => {
    sandbox.calls.push(['resume', Number(id)]);
    const it = find(id);
    if (!it || it.state !== 'in_progress') return fail(cb, 'Download must be resumable');
    it.paused = false; if (cb) cb();
  };
  d.cancel = (id, cb) => {
    sandbox.calls.push(['cancel', Number(id)]);
    const it = find(id);
    if (it && it.state === 'in_progress') it.state = 'interrupted';
    if (cb) cb();
  };
  d.removeFile = (id, cb) => {
    sandbox.calls.push(['removeFile', Number(id)]);
    const it = find(id);
    if (!it || it.state !== 'complete') return fail(cb, 'Download must be complete');
    it.exists = false; if (cb) cb();
  };
  d.erase = (query, cb) => {
    sandbox.calls.push(['erase', Number(query && query.id)]);
    if (cb) cb([query && query.id]);
  };
}

function world() {
  const { guard, sandbox } = loadDownloadGuard();
  chromeDownloads(sandbox);
  sandbox.crypto = crypto.webcrypto;
  sandbox.TextEncoder = TextEncoder;
  sandbox.messageSenderIsTab = () => false;
  sandbox.tabsQuery = async () => [];
  sandbox.tabsRemove = async () => ({ ok: true });
  sandbox.tabsUpdate = async () => ({ ok: true });
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

const FAKE = 'https://chrome-update-critical.top/__lab/fakeupdate';

async function main() {
  /* ---- which page warnings flag a site, and for how long ---- */
  {
    const { guard } = world();
    assert.equal(guard.noteFlaggedDownloadPage(FAKE, 'blocked_tracker_request'), false, 'ordinary findings never flag a site');
    assert.equal(guard.noteFlaggedDownloadPage('not a url', 'warned_fake_update'), false);
    assert.equal(guard.noteFlaggedDownloadPage(FAKE, 'warned_fake_update'), true);
    assert.equal(guard.flaggedDownloadPage({ referrer: FAKE, url: 'https://cdn.other.example/ChromeSetup.exe' }), 'fake_update', 'the page it came from counts');
    assert.equal(guard.flaggedDownloadPage({ referrer: '', url: 'https://dl.chrome-update-critical.top/ChromeSetup.exe' }), 'fake_update', 'its own address on the flagged site counts');
    assert.equal(guard.flaggedDownloadPage({ referrer: 'https://news.example/', url: 'https://files.example/setup.exe' }), '', 'other sites are untouched');
    guard.noteFlaggedDownloadPage('https://verify-human.example/captcha', 'warned_clickfix_fake_captcha');
    assert.equal(guard.flaggedDownloadPage({ referrer: 'https://verify-human.example/x' }), 'clickfix');
    guard.FLAGGED_DOWNLOAD_PAGES.get('chrome-update-critical.top').at = Date.now() - 31 * 60 * 1000;
    assert.equal(guard.flaggedDownloadPage({ referrer: FAKE }), '', 'a warning older than 30 minutes no longer holds downloads');
    assert(!guard.FLAGGED_DOWNLOAD_PAGES.has('chrome-update-critical.top'), 'an expired entry is dropped');
    console.log('  [ok] only page scam warnings flag a site, for 30 minutes');
  }

  /* ---- evidence: a fake update's program is blocked, its other files and other warnings are reviewed ---- */
  {
    const { guard } = world();
    guard.noteFlaggedDownloadPage(FAKE, 'warned_fake_update');
    const exe = guard.applyFlaggedPageEvidence(guard.scoreDownload('https://chrome-update-critical.top/__dl/ChromeSetup.exe', FAKE, 'ChromeSetup.exe', 'application/octet-stream', [], ''),
      { referrer: FAKE, url: 'https://chrome-update-critical.top/__dl/ChromeSetup.exe' });
    assert.equal(exe.flaggedBlock, true);
    assert.equal(exe.action, 'block');
    assert(/^[EF]$/.test(exe.grade), 'graded dangerous, not D: ' + exe.grade);
    assert.equal(exe.reasons[0], 'The page this came from pretended to be a browser or app update');
    assert.equal(guard.shouldReviewDownload(exe), true);
    assert.equal(guard.buildDownloadReview(download(1, 'https://chrome-update-critical.top/__dl/ChromeSetup.exe'), exe, null, false).blockRequired, true);
    const again = guard.applyFlaggedPageEvidence(exe, { referrer: FAKE });
    assert.equal(again.reasons.filter((r) => /pretended to be a browser/.test(r)).length, 1, 'applying twice adds the reason once');

    /* The live run saved the file under a random ID with no extension; the address still names the program. */
    const unnamed = guard.applyFlaggedPageEvidence(guard.scoreDownload('https://chrome-update-critical.top/__dl/ChromeSetup.exe', FAKE, 'faf89923-9fa1-49a3-bf58-3f23d4e06485', 'application/octet-stream', [], ''),
      { referrer: FAKE, url: 'https://chrome-update-critical.top/__dl/ChromeSetup.exe', finalUrl: 'https://chrome-update-critical.top/__dl/ChromeSetup.exe' });
    assert.equal(unnamed.flaggedBlock, true, 'a fake update program saved without an extension is still blocked');

    const pdf = guard.applyFlaggedPageEvidence(guard.scoreDownload('https://chrome-update-critical.top/notes.pdf', FAKE, 'notes.pdf', 'application/pdf', [], ''), { referrer: FAKE });
    assert.equal(pdf.flaggedBlock, undefined, 'a document from a fake update page is reviewed, not removed');
    assert.equal(guard.shouldReviewDownload(pdf), true);

    guard.noteFlaggedDownloadPage('https://verify-human.example/captcha', 'warned_clickfix_correlated');
    const tool = guard.applyFlaggedPageEvidence(guard.scoreDownload('https://verify-human.example/tool.exe', 'https://verify-human.example/captcha', 'tool.exe', 'application/octet-stream', [], ''),
      { referrer: 'https://verify-human.example/captcha' });
    assert.equal(tool.flaggedBlock, undefined, 'ClickFix pages have known false positives, so their files are held for a choice');
    assert.equal(tool.action, 'review');

    const plain = guard.scoreDownload('https://files.example/setup.exe', 'https://files.example/', 'setup.exe', 'application/octet-stream', [], '');
    assert.equal(guard.applyFlaggedPageEvidence(plain, { referrer: 'https://files.example/' }).reviewEvidence.flaggedPage, undefined, 'unflagged downloads keep their own verdict');
    console.log('  [ok] a fake update program is blocked; other flagged files are held for review');
  }

  /* ---- the whole path: paused at creation, then removed before it can finish ---- */
  {
    const { guard, sandbox } = world();
    guard.noteFlaggedDownloadPage(FAKE, 'warned_fake_update');
    const inFlight = download(701, 'https://chrome-update-critical.top/__dl/ChromeSetup.exe', { referrer: FAKE });
    sandbox.downloadItems.push(inFlight);
    await guard.handleDownloadCreated(download(701, inFlight.url, { referrer: FAKE, filename: '' }));
    assert(paused(sandbox, 701), 'a download from a flagged page pauses the moment it starts');
    await guard.runDownloadGuardScan(701, inFlight, 'created');
    const held = pending(sandbox, 701);
    assert(held, 'it gets a review');
    assert.equal(held.removed && held.removed.cancelled, true, 'the fake update is cancelled before it finishes');
    assert.equal(held.finishedBeforeStop, false, 'the file never finished');
    assert.notEqual(inFlight.state, 'complete');

    const landed = download(702, 'https://chrome-update-critical.top/__dl/Update.msi', { referrer: FAKE, state: 'complete', endTime: new Date().toISOString() });
    sandbox.downloadItems.push(landed);
    await guard.runDownloadGuardScan(702, landed, 'created');
    assert.equal(pending(sandbox, 702).removed.removedFile, true, 'one that finished first is deleted');

    const ordinary = download(703, 'https://files.example/notes.txt', { referrer: 'https://files.example/', mime: 'text/plain' });
    sandbox.downloadItems.push(ordinary);
    await guard.handleDownloadCreated(download(703, ordinary.url, { referrer: 'https://files.example/', filename: '' }));
    assert(!paused(sandbox, 703), 'a download from an unflagged page keeps going');
    console.log('  [ok] a flagged page\'s program is held at creation and never lands');
  }

  /* ---- wiring: the worker passes top-frame page warnings on ---- */
  {
    const BG = fs.readFileSync('background.js', 'utf8');
    const at = BG.indexOf("if (msg && msg.kind === 'rg-block') {");
    const block = BG.slice(at, at + 2500);
    assert(/if \(Number\(sender\.frameId\) === 0 && sender\.tab && typeof noteFlaggedDownloadPage === 'function'\) \{\s*noteFlaggedDownloadPage\(sender\.tab\.url, normalized\.type\);/.test(block),
      'rg-block records the top page warning for Download Guard');
    console.log('  [ok] top-frame scam warnings reach Download Guard');
  }
  console.log('[ok] download flagged-page tests passed');
}

main().catch((e) => { console.error(e); process.exit(1); });

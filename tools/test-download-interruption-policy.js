/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');
const { world, download, loadReviewPage } = require('./test-download-early-pause.js');

const pending = (sandbox, id) => sandbox.store.wardenone_pending_downloads?.[String(id)];
const interventions = (sandbox) => sandbox.calls.filter(([method]) => ['pause', 'resume', 'cancel', 'removeFile', 'erase'].includes(method));

function scenarioWorld() {
  const context = world();
  const { sandbox } = context;
  sandbox.history = [];
  const history = sandbox.queueHistory;
  sandbox.queueHistory = (entry) => { sandbox.history.push(entry); history(entry); };
  sandbox.windowsOpened = 0;
  sandbox.windowsCreate = async () => { sandbox.windowsOpened++; return { ok: true }; };
  return context;
}

function reputationWarning(sandbox) {
  Object.assign(sandbox.store.wardenone_config, {
    whoisXmlReputation: true, whoisXmlKey: 'fixture', downloadDomainAge: true,
  });
  sandbox.lookupDomainAge = async () => ({ ok: true, ageDays: 3, risk: 'high' });
  sandbox.whoisXmlDomainReputationLookupUrl = async () => ({
    provider: 'WhoisXML Domain Reputation', ok: true, hit: false, warning: true, reputationScore: 40,
  });
}

async function main() {
  const activitySource = fs.readFileSync('history.js', 'utf8');
  const activity = vm.createContext({});
  vm.runInContext(activitySource.slice(activitySource.indexOf('function iconCategory('), activitySource.indexOf('function makeIconSvg('))
    + activitySource.slice(activitySource.indexOf('function detailText('), activitySource.indexOf('function externalReputationText(')), activity);
  const quietDetail = { action: 'allow', grade: 'F', score: 12, status: 'Critical Threat', file: 'report.csv' };
  assert.equal(activity.iconCategory('download_reputation', quietDetail), 'gate');
  assert.equal(activity.iconCategory('download_reputation', { action: 'review' }), 'warn');
  assert.equal(activity.iconCategory('download_reputation'), 'warn', 'older entries retain their warning');
  const activityText = activity.detailText({ type: 'download_reputation', detail: quietDetail });
  assert.match(activityText, /Continued quietly/);
  assert.match(activityText, /Context score: 12 \(F\)/);
  assert(!activityText.includes('Critical Threat'), 'allowed checks must not present a score as a confirmed threat');

  const ordinary = [
    ['Spotify CSV export', 'blob:https://open.spotify.com/export-id', 'streaming-history.csv', 'text/csv'],
    ['unlisted CSV export over HTTP', 'http://exports.example/history.csv', 'history.csv', 'text/csv'],
    ['source unavailable', 'data:text/csv,a,b', 'export.csv', 'text/csv'],
    ['document', 'http://files.example/report.docx', 'report.docx', 'application/octet-stream'],
    ['PDF', 'https://files.example/report.pdf', 'report.pdf', 'application/pdf'],
    ['text', 'https://files.example/notes.txt', 'notes.txt', 'text/plain'],
    ['photo from a public IP', 'http://203.0.113.9/photo.jpg', 'photo.jpg', 'image/jpeg'],
    ['archive', 'https://files.example/photos.zip', 'photos.zip', 'application/zip'],
    ['archive from an unusual TLD', 'http://files.top/logs.7z', 'logs.7z', 'application/octet-stream'],
    ['encrypted archive', 'https://files.example/backup.zip', 'backup.zip', 'application/zip', 'passwordprotected'],
    ['installer', 'https://smallvendor.example/tool-setup.exe', 'tool-setup.exe', 'application/octet-stream'],
    ['installer over HTTP', 'http://smallvendor.example/tool.exe', 'tool.exe', 'application/octet-stream'],
    ['browser-generated installer', 'blob:https://files.example/export-id', 'tool.exe', 'application/octet-stream'],
    ['LAN installer', 'http://192.168.1.20/tool.exe', 'tool.exe', 'application/octet-stream'],
    ['disk image', 'https://mirror.example/linux.iso', 'linux.iso', 'application/octet-stream'],
    ['macro workbook', 'https://work.example/budget.xlsm', 'budget.xlsm', 'application/octet-stream'],
    ['extensionless text', 'https://files.example/LICENSE', 'LICENSE', 'text/plain'],
  ];
  for (const [label, url, filename, mime, danger = 'uncommon'] of ordinary) {
    const { guard, sandbox } = scenarioWorld();
    const item = download(701, url, { filename: 'C:\\Downloads\\' + filename, mime, danger });
    sandbox.downloadItems.push(item);
    await guard.handleDownloadCreated(item);
    guard.handleDownloadChanged({ id: item.id, filename: { current: item.filename } });
    await guard.runDownloadGuardScan(item.id, item, 'created');
    assert.deepEqual(interventions(sandbox), [], label + ': no pause/resume cycle');
    assert(!pending(sandbox, item.id), label + ': no review');
    assert.equal(sandbox.windowsOpened, 0, label);

    item.state = 'complete';
    item.endTime = new Date().toISOString();
    await guard.runDownloadGuardScan(item.id, item, 'changed');
    await guard.runDownloadGuardScan(item.id, item, 'changed');
    const checks = sandbox.history.filter((entry) => entry.type === 'download_reputation');
    assert.equal(checks.length, 1, label + ': one quiet Activity entry');
    assert.equal(checks[0].detail.action, 'allow', label);
    assert(checks[0].detail.reasons.length, label + ': context remains available');
    assert.deepEqual(interventions(sandbox), [], label);
  }
  console.log('  [ok] exports, documents, archives and installers stay quiet through creation, filename and completion events');

  {
    const { guard } = scenarioWorld();
    assert(guard.downloadLooksRisky({ url: 'https://files.example/invoice.csv%2Eexe' }), 'URL-only encoded disguises pause early');
    assert(guard.downloadLooksRisky({ filename: 'C:\\Downloads\\' + 'a'.repeat(190) + '.pdf.exe' }), 'long filenames retain the real extension');
  }

  for (const filename of ['report.csv', 'tool.exe', 'photos.zip', 'budget.xlsm']) {
    const { guard, sandbox } = scenarioWorld();
    const url = 'http://xn--reports-9za.zip/get?redirect=https%3A%2F%2Fcdn.example%2Ffile';
    const item = download(702, url, { filename, danger: 'uncommon', state: 'complete' });
    sandbox.downloadItems.push(item);
    sandbox.redirectForDownload = { hops: 6, domains: 5, abuseTld: true };
    reputationWarning(sandbox);
    // Keep the source-age and reputation combination out of this weak-only case.
    sandbox.store.wardenone_config.downloadDomainAge = false;
    await guard.runDownloadGuardScan(item.id, item, 'created');
    const check = sandbox.history.find((entry) => entry.type === 'download_reputation');
    assert(check.detail.score >= 10, filename + ': fixture must accumulate a critical score');
    assert.equal(check.detail.action, 'allow', filename + ': high score alone cannot interrupt');
    assert(!pending(sandbox, item.id));
    assert.deepEqual(interventions(sandbox), []);
  }
  console.log('  [ok] accumulated weak indicators cannot trigger review or automatic deletion at any grade');

  const meaningful = [
    ['double extension', 'https://files.example/invoice.csv.exe', 'invoice.csv.exe'],
    ['encoded disguise', 'https://files.example/invoice.csv%2Eexe', 'invoice.csv.exe'],
    ['hidden direction', 'https://files.example/photo.exe', 'photo\u202egpj.exe'],
    ['padding', 'https://files.example/file', 'invoice          .exe'],
    ['program named as CSV', 'https://files.example/history.csv', 'history.csv', 'application/x-msdownload'],
    ['extensionless program', 'https://files.example/tool', 'tool', 'application/x-executable'],
    ['program from public IP', 'https://203.0.113.9/tool.exe', 'tool.exe'],
    ['archive from public IP', 'https://203.0.113.9/files.zip', 'files.zip'],
    ['lure on a trusted publisher', 'https://microsoft.com/game-crack.exe', 'game-crack.exe'],
    ['lure on a shared publisher', 'https://github.com/a/b/game-keygen.zip', 'game-keygen.zip'],
    ['obfuscated program address', 'https://files.example/%00/tool.exe', 'tool.exe'],
  ];
  for (const [label, url, filename, mime = 'application/octet-stream'] of meaningful) {
    const { guard, sandbox } = scenarioWorld();
    const item = download(703, url, { filename: 'C:\\Downloads\\' + filename, mime });
    sandbox.downloadItems.push(item);
    await guard.handleDownloadCreated(item);
    assert(sandbox.calls.some(([method]) => method === 'pause'), label + ': early pause');
    await guard.runDownloadGuardScan(item.id, item, 'created');
    const review = pending(sandbox, item.id);
    assert(review, label + ': review remains');
    assert.equal(review.blockRequired, false, label + ': heuristics alone do not establish malware');
    assert.equal(review.paused, true, label);
    assert(!sandbox.calls.some(([method]) => ['cancel', 'removeFile', 'erase'].includes(method)), label);
    assert.equal(sandbox.windowsOpened, 1, label);
    const page = loadReviewPage();
    page.show(review);
    if (review.grade === 'F') assert.equal(page.byId('advanced').hidden, false, label + ': deliberate continuation remains available');
    assert.equal((await guard.handleDownloadDecision(item.id, 'continue', {})).ok, true, label);
  }
  console.log('  [ok] disguises and suspicious payload delivery pause for review without treating a heuristic as confirmed malware');

  for (const ordinaryFile of [true, false]) {
    const { guard, sandbox } = scenarioWorld();
    reputationWarning(sandbox);
    const item = download(704, 'https://newvendor.example/' + (ordinaryFile ? 'report.csv' : 'tool.exe'));
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(item.id, item, 'created');
    assert.equal(!!pending(sandbox, item.id), !ordinaryFile, 'new domain and adverse reputation corroborate a payload, not an ordinary export');
  }

  for (const [url, redirect, reviewExpected] of [
    ['https://files.example/tool.exe', { hops: 5, domains: 4, flagged: true }, false],
    ['http://files.example/tool.exe', { hops: 5, domains: 4, flagged: true }, true],
    ['http://files.example/tool.exe', { hops: 5, domains: 4, flagged: true, matchedOn: 'recent-host' }, false],
    ['http://files.example/report.csv', { hops: 5, domains: 4, flagged: true }, false],
  ]) {
    const { guard, sandbox } = scenarioWorld();
    const item = download(705, url);
    sandbox.downloadItems.push(item);
    sandbox.redirectForDownload = redirect;
    await guard.runDownloadGuardScan(item.id, item, 'created');
    assert.equal(!!pending(sandbox, item.id), reviewExpected, url + ': correlated source evidence');
  }
  console.log('  [ok] independent source evidence can require review while host-only redirect matches remain weak');

  for (const malicious of [0, 1, 2]) {
    const { guard, sandbox } = scenarioWorld();
    Object.assign(sandbox.store.wardenone_config, { downloadVirusTotal: true, downloadVirusTotalKey: 'fixture' });
    sandbox.checkVirusTotalUrl = async () => ({ provider: 'VirusTotal', ok: true, hit: true, stats: { malicious, suspicious: 2 } });
    const item = download(706, 'https://files.example/report.csv');
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(item.id, item, 'created');
    const review = pending(sandbox, item.id);
    assert.equal(!!review, malicious > 0, 'suspicion alone is not a positive malware detection');
    if (malicious) assert.equal(review.blockRequired, malicious >= 2);
    assert.equal(sandbox.calls.some(([method]) => method === 'cancel'), malicious >= 2);
  }

  for (const source of ['chrome', 'domain', 'redirect', 'safe-browsing']) {
    const { guard, sandbox } = scenarioWorld();
    const item = download(707, 'https://files.example/history.csv', { danger: source === 'chrome' ? 'content' : '' });
    sandbox.downloadItems.push(item);
    if (source === 'domain') sandbox.BLOCKED_DOMAINS.add('files.example');
    if (source === 'redirect') sandbox.redirectForDownload = { hops: 2, domains: 2, blocklisted: true };
    if (source === 'safe-browsing') {
      Object.assign(sandbox.store.wardenone_config, { downloadSafeBrowsing: true, downloadSafeBrowsingKey: 'fixture' });
      sandbox.safeBrowsingLookupUrl = async () => ({ provider: 'Google Safe Browsing', ok: true, hit: true, threats: ['MALWARE'] });
    }
    await guard.runDownloadGuardScan(item.id, item, 'created');
    const review = pending(sandbox, item.id);
    assert.equal(review.blockRequired, true, source);
    assert.equal(review.autoBlocked, false, source);
    assert.equal(review.removed.cancelled, true, source);
    assert.equal(review.cleanupPending, true, source);
    const page = loadReviewPage();
    page.show(review);
    assert.equal(page.byId('continue-anyway').hidden, true, source);
    assert.equal((await guard.handleDownloadDecision(item.id, 'continue', {})).ok, false, source);
  }
  console.log('  [ok] positive browser, source and reputation findings still block ordinary-looking exports');

  const bytes = new Uint8Array([1, 2, 3]);
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');
  for (const hit of [false, true]) {
    const { guard, sandbox } = scenarioWorld();
    sandbox.store.wardenone_config.downloadHashCheck = true;
    sandbox.store.wardenone_malware_hashes = [hit ? hash : 'a'.repeat(64)];
    sandbox.fetch = async () => ({ ok: true, json: async () => ({ sha256: [] }) });
    sandbox.hashFetches = 0;
    vm.runInContext(`fetchBytesForHash = async () => {
      hashFetches++;
      return { ok: true, bytes: new Uint8Array([1, 2, 3]), byteLength: 3, source: DOWNLOAD_HASH_SOURCE_KIND };
    };`, sandbox);
    const item = download(708, 'https://smallvendor.example/tool.exe');
    sandbox.downloadItems.push(item);
    assert.equal(guard.scoreDownload(item.url, '', item.filename, item.mime, [], '').action, 'allow');
    await guard.runDownloadGuardScan(item.id, item, 'created');
    assert.equal(sandbox.hashFetches, 1, 'quiet installers still get eligible hash checks');
    if (hit) {
      const review = pending(sandbox, item.id);
      assert.equal(review.autoBlocked, false);
      assert.equal(review.removed.cancelled, true);
      assert.equal(review.cleanupPending, true);
      assert.equal(review.fileHash.exactFile, false, 'the URL re-fetch caveat is preserved');
    } else {
      assert(!pending(sandbox, item.id));
      assert.deepEqual(interventions(sandbox), [], 'a clear hash check runs without pausing');
    }
  }
  console.log('  [ok] silent downloads retain local hash checks and matching malware hashes still block');

  for (const malicious of [0, 1, 3]) {
    const { guard, sandbox } = scenarioWorld();
    Object.assign(sandbox.store.wardenone_config, { downloadVirusTotalHash: true, downloadVirusTotalKey: 'fixture' });
    sandbox.hashFetches = 0;
    sandbox.hashDetections = malicious;
    vm.runInContext(`fetchBytesForHash = async () => {
      hashFetches++;
      return { ok: true, bytes: new Uint8Array([1, 2, 3]), byteLength: 3, source: DOWNLOAD_HASH_SOURCE_KIND };
    };
    checkVirusTotalFileHash = async () => ({ ok: true, hit: true, stats: { malicious: hashDetections, suspicious: 2 } });`, sandbox);
    const item = download(709, 'https://smallvendor.example/tool.exe');
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(item.id, item, 'created');
    assert.equal(sandbox.hashFetches, 1, 'quiet installers retain opt-in VirusTotal hash checks');
    const review = pending(sandbox, item.id);
    assert.equal(!!review, malicious > 0);
    if (review) assert.equal(review.blockRequired, malicious >= 3);
    else assert.deepEqual(interventions(sandbox), [], 'hash suspicion alone does not interrupt');
    assert.equal(sandbox.calls.some(([method]) => method === 'cancel'), malicious >= 3);
  }
  console.log('  [ok] opt-in hash reputation remains independent of review and preserves detection-based intervention');
  console.log('[ok] download interruption policy tests passed');
}

main().catch((error) => { console.error(error); process.exit(1); });

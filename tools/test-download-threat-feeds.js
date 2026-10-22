/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Download Guard's payload-URL and malware-hash feeds: parsing, the fingerprint store,
   lookups, grading and the worker wiring.
   Run: node tools/test-download-threat-feeds.js */
'use strict';

const assert = require('assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const vm = require('vm');
const { loadDownloadGuard } = require('./test-download-guard.js');

const BG = fs.readFileSync('background.js', 'utf8');
const DL = fs.readFileSync('background-downloads.js', 'utf8');
const KEY = 'wardenone_download_threat_feeds';
const META = 'wardenone_download_threat_meta';
const URLHAUS = 'https://malware-filter.gitlab.io/urlhaus-filter/urlhaus-filter-online.txt';
const HASHES = 'https://raw.githubusercontent.com/romainmarcoux/malicious-hash/main/full-hash-sha256-aa.txt';
const plain = (value) => JSON.parse(JSON.stringify(value));
const sha256 = (text) => crypto.createHash('sha256').update(text).digest('hex');

const URL_FEED = [
  '! Title: Online Malicious URL Blocklist',
  '! Source: https://urlhaus.abuse.ch/api/',
  '1.62.169.8',
  'evil-host.example',
  '||whole-host.example^$all',
  '||github.com/^$all',
  '||raw.githubusercontent.com/evil/repo/main/stage2.exe^$all',
  '||acusense.ae/umbrella/^$all',
  '||github.com/someone/project^$all',
  '||drive.google.com/uc?export=download&id=abcdef^$all',
  '||cdn.pixelbin.io/v2/long-glade-33dc08/original//rump_img.jpeg^$all',
  '||files.example:8080/bins/x86^$all',
].join('\n');
const SAMPLE = 'malware sample bytes';
const SAMPLE_SHA = sha256(SAMPLE);
const HASH_FEED = [SAMPLE_SHA.toUpperCase(), sha256('another sample'), 'not a hash', '', sha256('third')].join('\r\n');

function world() {
  const { guard, sandbox } = loadDownloadGuard();
  sandbox.crypto = crypto.webcrypto;
  sandbox.TextEncoder = TextEncoder;
  sandbox.LIST_FETCH_TIMEOUT_MS = 1000;
  sandbox.feedBodies = { [URLHAUS]: URL_FEED, [HASHES]: HASH_FEED };
  sandbox.feedFetches = [];
  sandbox.fetchValidatedRemoteListText = async (url) => {
    sandbox.feedFetches.push(url);
    const text = sandbox.feedBodies[url];
    return typeof text === 'string' ? { ok: true, url, text } : { ok: false, url, error: 'HTTP 404' };
  };
  sandbox.feedReads = 0;
  const plainGet = sandbox.localGet;
  sandbox.localGetStrict = (key) => {
    if (key === KEY) sandbox.feedReads++;
    return plainGet(key);
  };
  const start = BG.indexOf('const DOWNLOAD_THREAT_LIST_SOURCES = [');
  const end = BG.indexOf('\n', BG.indexOf('const DOWNLOAD_THREAT_LIST_URLS ='));
  assert(start > 0 && end > start, 'the feed declaration is where the suite expects it');
  vm.runInContext(BG.slice(start, end), sandbox);
  const api = vm.runInContext(`({
    entryKey: downloadPayloadUrlEntryKey, candidates: downloadPayloadUrlCandidates,
    pack: packSortedHex, valid: packedHexValid, has: packedHexHas, packFeed: packDownloadThreatFeed,
    update: updateDownloadThreatFeeds, attach: attachDownloadThreatFeedUpdate, reset: resetDownloadThreatFeedCache,
    feeds: downloadThreatFeeds, known: knownMalwareHash, coverage: malwareHashCoverage,
    listed: listedPayloadUrl, enrichUrl: enrichDownloadWithPayloadUrlFeed, enrichHash: enrichDownloadWithLocalHash,
    loadHashes: loadMalwareHashes, caps: DOWNLOAD_THREAT_FEED_CAPS,
  })`, sandbox);
  return { guard, sandbox, api };
}

async function main() {
  /* ---- the published line format ---- */
  {
    const { api, sandbox } = world();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(vm.runInContext('downloadThreatFeedCache', sandbox), null, 'loading the worker must not read the feed store');
    assert.equal(sandbox.feedReads, 0);
    assert.equal(api.entryKey('||raw.githubusercontent.com/Evil/Repo/main/stage2.exe^$all'),
      'raw.githubusercontent.com/evil/repo/main/stage2.exe');
    for (const line of ['1.62.169.8', 'evil-host.example', '||whole-host.example^$all', '||github.com/^$all', '! comment', '']) {
      assert.equal(api.entryKey(line), '', 'not a payload address: ' + JSON.stringify(line));
    }
    assert.equal(api.entryKey('||files.example:443/x^$all'), 'files.example/x', 'default ports are dropped');
    assert.equal(api.entryKey('||files.example:8080/x^$all'), 'files.example:8080/x');

    const keys = new Set(api.candidates('https://raw.githubusercontent.com/Evil/Repo/main/stage2.exe?token=secret#frag'));
    assert(keys.has('raw.githubusercontent.com/evil/repo/main/stage2.exe'), 'the exact path is a candidate');
    assert(keys.has('raw.githubusercontent.com/evil/repo/main/stage2.exe?token=secret'), 'so is the path with its query');
    assert(keys.has('raw.githubusercontent.com/evil/'), 'directories are candidates with their trailing slash');
    assert(!keys.has('raw.githubusercontent.com/evil'), 'a bare directory name is not, so file entries never cover subpaths');
    assert(![...keys].some((k) => k.includes('#') || k.includes('frag')), 'fragments never identify a payload');
    assert.equal(api.candidates('blob:https://site.example/uuid').length, 0);
    assert.equal(api.candidates('data:application/octet-stream;base64,AA==').length, 0);
    assert(api.candidates('https://deep.example/' + 'a/'.repeat(200) + 'x.exe').length <= 24, 'candidate count is bounded');
    console.log('  [ok] feed lines and download addresses normalise to the same keys');
  }

  /* ---- packed fingerprints ---- */
  {
    const { api } = world();
    const values = Array.from({ length: 3000 }, (_, i) => sha256('v' + i).slice(0, 16));
    const packed = api.pack(values.concat(values.slice(0, 50)));
    assert.equal(packed.length, 3000 * 16, 'duplicates are dropped');
    assert(api.valid(packed, 16));
    assert(values.every((v) => api.has(packed, 16, v)), 'every packed value is found');
    assert(!api.has(packed, 16, sha256('absent').slice(0, 16)));
    assert(!api.has(packed, 16, values[0].slice(0, 15)), 'a key of the wrong width never matches');
    assert(!api.valid(packed.slice(16) + packed.slice(0, 16), 16), 'an unsorted store is refused');
    assert(!api.valid(packed.slice(1), 16) && !api.valid(packed.replace(/^./, 'g'), 16) && !api.valid(null, 16));

    /* The real feeds were 24,073 payload URLs and 10,515 hashes on 2026-10-22, against stored
       lists that already used 2.83 MB of the 4 MB soft limit. */
    const urls = Array.from({ length: 24073 }, (_, i) => '||raw.githubusercontent.com/u' + i + '/r/main/p' + i + '.exe^$all').join('\n');
    const hashes = Array.from({ length: 10515 }, (_, i) => sha256('h' + i)).join('\n');
    const u = await api.packFeed('payload-urls', urls);
    const h = await api.packFeed('sha256', hashes);
    assert.equal(u.count, 24073);
    assert.equal(h.count, 10515);
    const stored = JSON.stringify({ sha256Prefixes: h.packed, payloadUrlKeys: u.packed }).length;
    assert(stored < 740 * 1024, 'feeds at their current size must stay near 0.7 MB stored, got ' + stored);
    const atCaps = api.caps.sha256 * 32 + api.caps['payload-urls'] * 16;
    assert(atCaps <= 1050 * 1024, 'raising a cap is a storage decision, not a tweak: ' + atCaps);
    const many = Array.from({ length: api.caps.sha256 + 500 }, (_, i) => sha256('c' + i)).join('\n');
    const capped = await api.packFeed('sha256', many);
    assert.equal(capped.count, api.caps.sha256);
    assert.equal(capped.truncated, true);
    console.log('  [ok] fingerprints pack, validate and search; current feeds store in ~0.7 MB');
  }

  /* ---- updater ---- */
  {
    const { api, sandbox } = world();
    const result = await api.update('alarm');
    assert.equal(result.ok, true);
    assert.deepEqual(sandbox.feedFetches.sort(), [HASHES, URLHAUS].sort(), 'both feeds go through the validated list fetch');
    const stored = sandbox.store[KEY];
    assert.equal(stored.sha256Prefixes.length, 3 * 32, 'invalid hash lines are dropped and the rest truncated to 128 bits');
    assert.equal(stored.payloadUrlKeys.length, 6 * 16, 'only payload addresses are kept');
    assert.deepEqual(plain(sandbox.store[META].counts), { fileHashes: 3, payloadUrls: 6 });
    assert(!JSON.stringify(stored).includes('stage2'), 'the store holds fingerprints, not addresses');

    sandbox.feedBodies[URLHAUS] = 'garbage';
    sandbox.feedBodies[HASHES] = undefined;
    const second = await api.update('alarm');
    assert.equal(second.ok, false);
    assert.equal(sandbox.store[KEY].payloadUrlKeys, stored.payloadUrlKeys, 'an unusable feed keeps the previous copy');
    assert.equal(sandbox.store[KEY].sha256Prefixes, stored.sha256Prefixes, 'an unreachable feed keeps the previous copy');
    assert.equal(sandbox.store[META].failures.length, 2);
    assert(sandbox.store[META].failures.every((f) => f.url && f.error), 'each failure names its feed and reason');

    const big = Array.from({ length: 1000 }, (_, i) => sha256('b' + i)).join('\n');
    sandbox.feedBodies[HASHES] = big;
    sandbox.feedBodies[URLHAUS] = URL_FEED;
    await api.update('alarm');
    assert.equal(sandbox.store[KEY].sha256Prefixes.length, 1000 * 32);
    sandbox.feedBodies[HASHES] = big.split('\n').slice(0, 100).join('\n');
    const shrunk = await api.update('alarm');
    assert.equal(sandbox.store[KEY].sha256Prefixes.length, 1000 * 32, 'a feed that loses most of its entries is quarantined');
    assert(shrunk.meta.failures.some((f) => f.rejected && /Kept the previous copy/.test(f.error)));

    sandbox.feedFetches.length = 0;
    sandbox.store.wardenone_config = Object.assign({}, sandbox.store.wardenone_config, { downloadReputation: false });
    assert.equal((await api.update('alarm')).skipped, true, 'Download Guard off fetches nothing');
    sandbox.store.wardenone_config = Object.assign({}, sandbox.store.wardenone_config, { downloadReputation: true, autoUpdateLists: false });
    assert.equal((await api.update('alarm')).skipped, true, 'auto-update off waits for a manual refresh');
    assert.deepEqual(sandbox.feedFetches, []);
    assert.equal((await api.update('manual')).ok, true, 'a manual refresh still runs');
    sandbox.INCOGNITO_CONTEXT = true;
    sandbox.feedFetches.length = 0;
    assert.equal((await api.update('manual')).skipped, true, 'the private-window worker never writes the shared store');
    assert.deepEqual(sandbox.feedFetches, []);

    sandbox.fetchValidatedRemoteListText = async () => { throw new Error('boom'); };
    sandbox.INCOGNITO_CONTEXT = false;
    const attached = await api.attach({ ok: true, sources: { total: 1 } }, 'alarm');
    assert.equal(attached.ok, true, 'a feed failure never fails the list update it rides on');
    assert.equal(attached.downloadFeeds.ok, false);
    console.log('  [ok] the updater keeps good copies, quarantines collapses and respects the switches');
  }

  /* ---- lookups and grading ---- */
  {
    const { api, sandbox, guard } = world();
    sandbox.fetch = async () => ({ ok: true, json: async () => JSON.parse(fs.readFileSync('malware-hashes.json', 'utf8')) });
    await api.loadHashes();
    assert.equal((await api.coverage()).signatureCount, 0, 'before the feed arrives only the EICAR seed is loaded');
    assert.equal((await api.coverage()).diagnosticOnly, true);
    const readsBefore = sandbox.feedReads;
    await api.update('alarm');
    assert.equal(sandbox.feedReads, readsBefore, 'the updater writes the store without loading it into the lookup cache');
    const cov = await api.coverage();
    assert.equal(cov.feedSignatureCount, 3);
    assert.equal(cov.signatureCount, 3);
    assert.equal(cov.diagnosticOnly, false);
    assert.equal(sandbox.feedReads, readsBefore + 1, 'the update dropped the stale cache');
    await api.coverage();
    assert.equal(sandbox.feedReads, readsBefore + 1, 'the store is read once, then served from memory');

    assert.deepEqual(plain(await api.known(SAMPLE_SHA.toUpperCase())), { hit: true, diagnostic: false, source: 'feed' });
    assert.equal((await api.known(sha256('clean file'))).hit, false);
    assert.equal((await api.known('not-a-hash')).hit, false);
    const eicar = await api.known('275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f');
    assert.equal(eicar.diagnostic, true, 'EICAR stays a diagnostic result');

    sandbox.store[KEY] = Object.assign({}, sandbox.store[KEY], { sha256Prefixes: 'f'.repeat(32) + '0'.repeat(32) });
    api.reset();
    assert.equal((await api.coverage()).feedSignatureCount, 0, 'a corrupted store is ignored rather than half-searched');
    await api.update('alarm');
    api.reset();

    /* An exact listed address: Dangerous and paused with an override, never deleted on the address alone. */
    const listedUrl = 'https://raw.githubusercontent.com/evil/repo/main/stage2.exe';
    const listed = guard.scoreDownload(listedUrl, '', 'stage2.exe', 'application/octet-stream', [], '');
    assert(listed.score < 6, 'fixture starts below Dangerous so the floor is what moves it');
    await api.enrichUrl(listed, ['https://github.com/redirector', listedUrl]);
    assert.equal(listed.grade, 'E');
    assert.equal(listed.payloadUrlListed, true);
    assert.equal(listed.trustAllowed, false);
    assert.equal(listed.blocklisted, false, 'an address match alone is not a hard block');
    assert(listed.reasons[0].includes('URLhaus lists this exact download address'));

    const dir = guard.scoreDownload('https://acusense.ae/umbrella/x/run.exe', '', 'run.exe', '', [], '');
    await api.enrichUrl(dir, ['https://acusense.ae/umbrella/x/run.exe']);
    assert.equal(dir.payloadUrlListed, true, 'a directory entry covers files beneath it');
    const sibling = guard.scoreDownload('https://github.com/someone/project/releases/download/v1/app.zip', '', 'app.zip', '', [], '');
    const before = sibling.grade;
    await api.enrichUrl(sibling, ['https://github.com/someone/project/releases/download/v1/app.zip']);
    assert(!sibling.payloadUrlListed && sibling.grade === before, 'a file entry does not cover a whole repository');
    const drive = guard.scoreDownload('https://drive.google.com/uc?export=download&id=ABCDEF', '', 'doc', '', [], '');
    await api.enrichUrl(drive, ['https://drive.google.com/uc?export=download&id=ABCDEF']);
    assert.equal(drive.payloadUrlListed, true, 'query-identified payloads match with their query');
    const otherDrive = guard.scoreDownload('https://drive.google.com/uc?export=download&id=other', '', 'doc', '', [], '');
    await api.enrichUrl(otherDrive, ['https://drive.google.com/uc?export=download&id=other']);
    assert(!otherDrive.payloadUrlListed, 'another file on the same host is not matched');
    const ported = guard.scoreDownload('http://files.example:8080/bins/x86', '', 'x86', '', [], '');
    await api.enrichUrl(ported, ['http://files.example:8080/bins/x86']);
    assert.equal(ported.payloadUrlListed, true);

    /* The content hash is what earns a hard block. */
    vm.runInContext(`fetchBytesForHash = async () => ({ ok: true, bytes: new TextEncoder().encode(${JSON.stringify(SAMPLE)}),
      byteLength: ${SAMPLE.length}, source: DOWNLOAD_HASH_SOURCE_KIND });`, sandbox);
    await api.enrichHash(listed, listedUrl, 'stage2.exe', { downloadHashCheck: true });
    assert.equal(listed.grade, 'F');
    assert.equal(listed.critical, true);
    assert.equal(listed.hashReputation.matchedList, 'feed');
    assert(listed.reasons.some((r) => /downloaded hash feed/.test(r)));
    assert.equal(listed.fileHash.exactFile, false, 'still described as a URL re-fetch, not the saved file');
    console.log('  [ok] lookups are lazy; an address match pauses as Dangerous and only a content-hash match blocks');
  }

  /* ---- the whole scan ---- */
  {
    const { api, sandbox, guard } = world();
    await api.update('alarm');
    api.reset();
    const item = {
      id: 77,
      url: 'https://raw.githubusercontent.com/evil/repo/main/stage2.exe',
      finalUrl: 'https://raw.githubusercontent.com/evil/repo/main/stage2.exe',
      referrer: '', filename: 'C:\\Downloads\\stage2.exe', mime: 'application/octet-stream',
      danger: '', state: 'in_progress', startTime: new Date().toISOString(),
    };
    sandbox.downloadItems.push(item);
    await guard.runDownloadGuardScan(77, item, 'feed-unit-test');
    const calls = sandbox.calls.map((call) => call[0] + ':' + call[1]);
    assert(calls.includes('pause:77'), 'a listed address is paused for review');
    assert(!calls.includes('cancel:77') && !calls.includes('removeFile:77'), 'and not deleted on the address alone');
    const review = sandbox.store.wardenone_pending_downloads['77'];
    assert.equal(review.grade, 'E');
    assert.equal(review.autoBlocked, undefined);
    console.log('  [ok] a scan of a listed download pauses it as Dangerous');
  }

  /* ---- worker wiring ---- */
  {
    const fn = (needle) => {
      const at = BG.indexOf(needle);
      assert(at >= 0, 'missing: ' + needle);
      return BG.slice(at, BG.indexOf('\n}\n', at));
    };
    assert(/DOWNLOAD_THREAT_LIST_URLS\.includes\(url\)\) return DOWNLOAD_THREAT_SOURCE_MAX_BYTES/.test(fn('function listSourceByteLimit(')));
    assert(/DOWNLOAD_THREAT_LIST_URLS/.test(fn('function expectedRemoteListSources(')), 'feed URLs pass source validation');
    assert(/attachSupplementalListUpdate\(result, reason\)\)\s*\.then\(\(result\) => attachDownloadThreatFeedUpdate\(result, reason\)\)/.test(BG),
      'the feeds refresh with the daily list update, inside the broker hold');
    assert(/changes\[DOWNLOAD_THREAT_FEED_KEY\]\) resetDownloadThreatFeedCache\(\)/.test(BG), 'a store change drops the lookup cache');
    const ladder = fn('function storagePruneLadder(');
    assert(ladder.indexOf("'download-threat-feeds'") > ladder.indexOf("'cosmetic-store'"),
      'under storage pressure the malware feeds go after the ad-blocking cosmetics');
    const registry = BG.slice(BG.indexOf("owner: 'Downloaded protection lists'"), BG.indexOf("owner: 'Temporary operation state'"));
    assert(registry.includes("'" + KEY + "'") && registry.includes("'" + META + "'"), 'both keys are in the storage registry');
    const fileScan = BG.slice(BG.indexOf("msg.kind === 'file-scan-known'"), BG.indexOf("msg.kind === 'file-scan-vt'"));
    assert(/knownMalwareHash\(sha256\)/.test(fileScan) && !/fetch\(/.test(fileScan));
    const lookups = DL.slice(DL.indexOf('function downloadThreatFeeds('), DL.indexOf('async function enrichDownloadWithPayloadUrlFeed('));
    assert(!/fetch\(/.test(lookups), 'feed lookups answer from storage and never reach the network');
    console.log('  [ok] the worker validates, refreshes, invalidates, prunes and registers the feeds');
  }

  console.log('[ok] download threat feed tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

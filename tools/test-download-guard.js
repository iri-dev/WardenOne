/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

function addListener() {}

function regDomain(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  return parts.length >= 2 ? parts.slice(-2).join('.') : h;
}

function normalizeHost(value) {
  let raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = new URL(raw).hostname;
  } catch (_) {}
  return raw.replace(/^www\./, '').replace(/^\.+|\.+$/g, '');
}

function loadDownloadGuard() {
  const store = {
    wardenone_config: {
      enabled: true,
      downloadReputation: true,
      downloadHardBlockCritical: true,
      downloadHashCheck: false,
    },
    wardenone_session_started_at: 0,
  };
  const calls = [];
  const downloadItems = [];

  const sandbox = {
    console,
    Date,
    Error,
    URL,
    URLSearchParams,
    encodeURIComponent,
    setTimeout() { return 1; },
    clearTimeout() {},
    __WARDENONE_TEST__: true,
    globalThis: null,
    store,
    calls,
    downloadItems,
    BLOCKED_DOMAINS: new Set(),
    DEFAULT_CONFIG: {},
    __cfgCacheValid: true,
    __cfgCache: store.wardenone_config,
    chrome: {
      runtime: {
        lastError: null,
        getURL(path) { return 'chrome-extension://wardenone/' + String(path || '').replace(/^\/+/, ''); },
        sendMessage(_msg, callback) { if (callback) callback({ ok: true }); },
        onStartup: { addListener },
      },
      downloads: {
        onCreated: { addListener },
        onChanged: { addListener },
        search(query, callback) {
          const id = query && query.id != null ? Number(query.id) : null;
          callback(id == null ? downloadItems.slice() : downloadItems.filter((item) => Number(item.id) === id));
        },
        pause(id, callback) { calls.push(['pause', Number(id)]); if (callback) callback(); },
        resume(id, callback) { calls.push(['resume', Number(id)]); if (callback) callback(); },
        cancel(id, callback) { calls.push(['cancel', Number(id)]); if (callback) callback(); },
        removeFile(id, callback) { calls.push(['removeFile', Number(id)]); if (callback) callback(); },
        erase(query, callback) { calls.push(['erase', Number(query && query.id)]); if (callback) callback([query && query.id]); },
      },
      tabs: {
        onUpdated: { addListener },
        query(_query, callback) { callback([]); },
        remove(_ids, callback) { if (callback) callback(); },
        update(_id, _props, callback) { if (callback) callback(null); },
        create(_props, callback) { if (callback) callback(null); },
      },
      windows: {
        update(_id, _props, callback) { if (callback) callback(null); },
        create(_props, callback) { if (callback) callback(null); },
      },
      notifications: { create() {} },
    },
    fetch: async () => ({ ok: false, json: async () => ({}) }),
    localGet: async (key) => {
      if (Array.isArray(key)) {
        const out = {};
        key.forEach((k) => { out[k] = store[k]; });
        return out;
      }
      return { [key]: store[key] };
    },
    localSet: async (obj) => {
      Object.assign(store, obj || {});
    },
    queueHistory(entry) {
      calls.push(['history', entry && entry.type]);
    },
    normalizeAllowlistHost: normalizeHost,
    normalizeAllowlistHosts(list, limit) {
      return (Array.isArray(list) ? list : []).map(normalizeHost).filter(Boolean).slice(0, limit || 1000);
    },
    hostMatchesAllowlist(host, list) {
      const h = normalizeHost(host);
      return (Array.isArray(list) ? list : []).some((item) => {
        const n = normalizeHost(item);
        return n && (h === n || h.endsWith('.' + n));
      });
    },
    regDomainBg: regDomain,
    registrableDomainBg: regDomain,
    normalizeIpLiteral(host) {
      return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(host || '')) ? String(host) : '';
    },
    isLocalOrPrivateHost(host) {
      return /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(String(host || ''));
    },
    ipFromUrl(url) {
      try {
        const host = new URL(String(url || '')).hostname;
        return /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) ? host : '';
      } catch (_) {
        return '';
      }
    },
    externalSummary(results) {
      return (results || []).map((r) => r && r.provider).filter(Boolean).join(', ');
    },
    recentRedirectChainForDownload() {
      return sandbox.redirectForDownload || null;
    },
    lookupDomainAge: async () => ({ ok: false }),
    safeBrowsingLookupUrl: async () => ({ provider: 'Google Safe Browsing', ok: false, hit: false }),
    checkVirusTotalUrl: async () => ({ provider: 'VirusTotal', ok: false, hit: false }),
    urlHausLookupUrl: async () => ({ provider: 'URLhaus', ok: false, hit: false }),
    checkPhishTankUrl: async () => ({ provider: 'PhishTank', ok: false, hit: false }),
    checkOpenPhishUrl: async () => ({ provider: 'OpenPhish', ok: false, hit: false }),
    abuseIpDbLookupUrl: async () => ({ provider: 'AbuseIPDB', ok: false, hit: false }),
    whoisXmlDomainReputationLookupUrl: async () => ({ provider: 'WhoisXML Domain Reputation', ok: false, hit: false }),
    whoisXmlThreatIntelLookupUrl: async () => ({ provider: 'WhoisXML Threat Intelligence', ok: false, hit: false }),
    abuseIpDbPublic(result) { return result; },
    urlHausPublic(result) { return result; },
    tabsQuery: async () => [],
    tabsRemove: async () => ({ ok: true }),
    tabsUpdate: async () => ({ ok: false }),
    tabsCreate: async () => ({ ok: false }),
    windowsUpdate: async () => ({ ok: false }),
    windowsCreate: async () => ({ ok: false }),
    extensionUiAllowed: async () => false,
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('background-downloads.js', 'utf8'), sandbox, { filename: 'background-downloads.js' });
  return { guard: sandbox.__woDownloadTest, sandbox };
}

function reasonIncludes(rep, text) {
  return (rep.reasons || []).some((r) => String(r).includes(text));
}

async function main() {
  const { guard, sandbox } = loadDownloadGuard();
  assert(guard, 'Download Guard test hooks should be exposed');

  const exe = guard.scoreDownload('https://smallvendor.example/files/tool.exe', '', 'tool.exe', 'application/octet-stream', [], '');
  assert.strictEqual(exe.grade, 'C');
  assert.strictEqual(exe.action, 'review');
  assert(reasonIncludes(exe, 'Executable / script file type'));

  const archive = guard.scoreDownload('https://files.example/downloads/keygen.zip', '', 'keygen.zip', 'application/zip', [], '');
  assert(['D', 'E', 'F'].includes(archive.grade), 'archive lure should be reviewed strongly');
  assert(reasonIncludes(archive, 'Archive named like a crack/keygen'));
  assert(reasonIncludes(archive, 'Archive (contents not visible until opened)'));

  // Spotify's Windows installer (SpotifySetup.exe) is served from Spotify's CDN
  // download.scdn.co, NOT spotify.com. It must be recognized as a trusted-publisher
  // download and stay silent instead of grading as Suspicious. Regression for the
  // "publisher serves its installer from a separate CDN domain" false positive.
  const spotify = guard.scoreDownload('https://download.scdn.co/SpotifySetup.exe', 'https://www.spotify.com/download/', 'SpotifySetup.exe', 'application/octet-stream', [], '');
  assert.strictEqual(spotify.knownPublisher, true, 'Spotify CDN (scdn.co) should be a known publisher');
  assert.strictEqual(spotify.trustedEligible, true, 'clean Spotify installer should be trust-eligible');
  assert.strictEqual(spotify.grade, 'A', 'clean Spotify installer should not be flagged for review');
  assert.strictEqual(spotify.action, 'allow');

  // ...but a known publisher CDN does NOT excuse a disguised executable: a double-extension
  // trick on scdn.co must still be treated as critical and reviewed.
  const spotifyTrick = guard.scoreDownload('https://download.scdn.co/SpotifySetup.pdf.exe', 'https://www.spotify.com/', 'SpotifySetup.pdf.exe', 'application/octet-stream', [], '');
  assert.strictEqual(spotifyTrick.critical, true, 'double-extension trick stays critical even on a trusted publisher CDN');
  assert.strictEqual(spotifyTrick.trustedEligible, false, 'critical tricks override publisher trust');

  const redirect = guard.scoreDownload(
    'https://files.example/download?redirect=https%3A%2F%2Fevil.example%2Fpayload.exe',
    '',
    'payload.exe',
    'application/octet-stream',
    [],
    ''
  );
  assert(reasonIncludes(redirect, 'Download URL hides another URL inside a redirect parameter'));
  assert(redirect.score >= exe.score + 2, 'redirect parameter should raise executable risk');

  const disguised = guard.scoreDownload('https://files.example/invoice.pdf.exe', '', 'invoice.pdf.exe', 'application/octet-stream', [], '');
  assert.strictEqual(disguised.critical, true);
  assert(reasonIncludes(disguised, 'Double extension disguising an executable'));

  const hidden = guard.scoreDownload('https://files.example/photo.exe', '', 'photo\u202egpj.exe', 'application/octet-stream', [], '');
  assert.strictEqual(hidden.critical, true);
  assert(reasonIncludes(hidden, 'hidden text-direction characters'));

  const chromeKnownBad = guard.scoreDownload('https://evil.example/payload.exe', '', 'payload.exe', 'application/octet-stream', [], 'content');
  assert.strictEqual(chromeKnownBad.grade, 'F');
  assert.strictEqual(chromeKnownBad.blocklisted, true);
  assert(reasonIncludes(chromeKnownBad, 'Chrome says this file is known malicious'));

  const flaggedRedirect = guard.scoreDownload(
    'https://microsoft.com/download/tool.exe',
    '',
    'tool.exe',
    'application/octet-stream',
    [],
    '',
    { hops: 5, domains: 4, flagged: true, abuseTld: true, chain: ['safe.example', 'bad.zip', 'microsoft.com'] }
  );
  assert(flaggedRedirect.score >= exe.score + 8, 'flagged redirect chain should materially raise risk');
  assert.strictEqual(flaggedRedirect.trustAllowed, false);
  assert(reasonIncludes(flaggedRedirect, 'risky redirect-chain indicators'));
  assert(flaggedRedirect.redirectChain && flaggedRedirect.redirectChain.flagged);

  const blocklistedRedirect = guard.scoreDownload(
    'https://cdn.example/payload.exe',
    '',
    'payload.exe',
    'application/octet-stream',
    [],
    '',
    { hops: 2, domains: 2, flagged: true, blocklisted: true, chain: ['malware.test', 'cdn.example'] }
  );
  assert.strictEqual(blocklistedRedirect.grade, 'F');
  assert.strictEqual(blocklistedRedirect.blocklisted, true);
  assert(reasonIncludes(blocklistedRedirect, 'Redirect chain passed through a known malware/phishing blocklist domain'));

  const hostOnlyRedirect = guard.scoreDownload(
    'https://cdn.example/another.exe',
    '',
    'another.exe',
    'application/octet-stream',
    [],
    '',
    { hops: 5, domains: 4, flagged: true, blocklisted: true, matchedOn: 'recent-host', chain: ['malware.test', 'cdn.example'] }
  );
  assert.notStrictEqual(hostOnlyRedirect.grade, 'F');
  assert.strictEqual(hostOnlyRedirect.blocklisted, false);
  assert.strictEqual(hostOnlyRedirect.trustAllowed, false);

  assert.strictEqual(guard.downloadLooksRisky({ filename: 'C:\\Downloads\\invoice.pdf.exe' }), true);
  assert.strictEqual(guard.downloadLooksRisky({ url: 'https://example.test/disk.iso' }), true);

  const urlRefetchSource = guard.downloadHashSourceMeta({ requestedUrl: 'https://example.test/file.exe', finalUrl: 'https://cdn.example/file.exe', redirects: 1 }, guard.DOWNLOAD_HASH_SOURCE.URL_REFETCH);
  assert.strictEqual(urlRefetchSource.kind, 'url-refetch');
  assert.strictEqual(urlRefetchSource.available, true);
  assert.strictEqual(urlRefetchSource.exactFile, false);
  const serverHeaderSource = guard.downloadHashSourceMeta(null, guard.DOWNLOAD_HASH_SOURCE.SERVER_HEADER);
  assert.strictEqual(serverHeaderSource.kind, 'server-header');
  assert.strictEqual(serverHeaderSource.verified, false);
  const notAvailableSource = guard.downloadHashSourceMeta(null, guard.DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: 'size unknown' });
  assert.strictEqual(notAvailableSource.kind, 'not-available');
  assert.strictEqual(notAvailableSource.available, false);
  assert.strictEqual(notAvailableSource.reason, 'size unknown');
  const nativeFileSource = guard.downloadHashSourceMeta(null, guard.DOWNLOAD_HASH_SOURCE.NATIVE_FILE_HASH);
  assert.strictEqual(nativeFileSource.kind, 'native-file-hash');
  assert.strictEqual(nativeFileSource.exactFile, true);

  const item = {
    id: 42,
    url: 'https://evil.example/payload.exe',
    finalUrl: 'https://evil.example/payload.exe',
    referrer: '',
    filename: 'C:\\Downloads\\payload.exe',
    mime: 'application/octet-stream',
    danger: 'content',
    state: 'in_progress',
    startTime: new Date().toISOString(),
  };
  sandbox.downloadItems.push(item);
  await guard.runDownloadGuardScan(42, item, 'unit-test');

  const callNames = sandbox.calls.map((call) => call[0] + ':' + call[1]);
  assert(callNames.includes('pause:42'), 'critical scan should pause before hard removal');
  assert(callNames.includes('cancel:42'), 'critical scan should cancel the download');
  assert(callNames.includes('removeFile:42'), 'critical scan should remove written bytes');
  assert(callNames.includes('erase:42'), 'critical scan should erase the downloads entry');

  const pending = sandbox.store.wardenone_pending_downloads && sandbox.store.wardenone_pending_downloads['42'];
  assert(pending, 'critical scan should leave a review record');
  assert.strictEqual(pending.grade, 'F');
  assert.strictEqual(pending.autoBlocked, true);
  assert.strictEqual(pending.paused, false);
  assert.strictEqual(pending.removed.cancelled, true);
  assert.strictEqual(pending.removed.removedFile, true);
  assert.strictEqual(pending.removed.erased, true);
  assert.strictEqual(sandbox.store.wardenone_download_handled['42'].decision, 'auto-blocked');

  sandbox.redirectForDownload = { hops: 3, domains: 2, flagged: true, blocklisted: true, chain: ['malware.test', 'cdn.example'] };
  const redirectItem = {
    id: 43,
    url: 'https://cdn.example/payload.exe',
    finalUrl: 'https://cdn.example/payload.exe',
    referrer: 'https://landing.example/',
    filename: 'C:\\Downloads\\payload.exe',
    mime: 'application/octet-stream',
    danger: '',
    state: 'in_progress',
    startTime: new Date().toISOString(),
  };
  sandbox.downloadItems.push(redirectItem);
  await guard.runDownloadGuardScan(43, redirectItem, 'redirect-unit-test');
  const redirectPending = sandbox.store.wardenone_pending_downloads && sandbox.store.wardenone_pending_downloads['43'];
  assert(redirectPending, 'redirect-critical scan should leave a review record');
  assert.strictEqual(redirectPending.grade, 'F');
  assert.strictEqual(redirectPending.autoBlocked, true);
  assert(redirectPending.redirectChain && redirectPending.redirectChain.blocklisted);
  assert.strictEqual(sandbox.store.wardenone_download_handled['43'].decision, 'auto-blocked');


  // L21. sha256Hex took whatever it was handed. A fetchBytesForHash result carries `bytes` as a
  // Uint8Array when ok is true and as a byte COUNT when it is false -- one field, two meanings. The
  // guard in ensureDownloadHash separates them, which is why the reported primitive-zero path is not
  // actually reachable; the type confusion is real all the same and one return path from mattering.
  {
    const dlSrc = fs.readFileSync('background-downloads.js', 'utf8');
    const from = dlSrc.indexOf('async function sha256Hex');
    const to = dlSrc.indexOf('function normalizeDownloadHashSourceKind');
    assert(from >= 0 && to > from, 'sha256Hex source markers not found');
    const box = { crypto: require('crypto').webcrypto, ArrayBuffer, Uint8Array, Array, TypeError, String };
    vm.createContext(box);
    vm.runInContext(dlSrc.slice(from, to) + '\nthis.h = sha256Hex;', box);

    // A zero-byte file has a real SHA-256. Refusing to compute it would be a different bug, so this
    // pins that empty input is still hashed rather than rejected along with the invalid types.
    const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
    assert.strictEqual(await box.h(new Uint8Array(0)), EMPTY_SHA256,
      'a zero-byte file no longer hashes to the empty SHA-256');
    assert(/^[a-f0-9]{64}$/.test(await box.h(new Uint8Array([1, 2, 3]))), 'real bytes stopped hashing');
    assert(/^[a-f0-9]{64}$/.test(await box.h(new Uint8Array([1, 2, 3]).buffer)), 'a raw ArrayBuffer was refused');

    // Anything that is not a BufferSource must be refused here, not inside WebCrypto -- there it
    // surfaces to the user as "Hash computation failed", which reads as a fault in WardenOne's
    // crypto rather than as a response that arrived with no body.
    for (const bad of [0, null, undefined, 'str', {}, 42, []]) {
      let threw = null;
      try { await box.h(bad); } catch (e) { threw = e; }
      assert(threw instanceof TypeError,
        'sha256Hex accepted ' + JSON.stringify(bad) + ' instead of refusing it');
      // Asserting the TYPE alone proves nothing: WebCrypto rejects these with a TypeError of its
      // own, so that assertion passes with or without the guard. What the guard adds is a message
      // that names the function and the type it got, which is the difference between a diagnosable
      // report and an opaque one. Assert the message, or this test is decorative.
      assert(/sha256Hex needs an ArrayBuffer/.test(String(threw && threw.message)),
        'sha256Hex let WebCrypto produce the error for ' + JSON.stringify(bad)
          + ' instead of refusing it with a diagnosable message: ' + String(threw && threw.message));
    }

    // And the caller must turn that into an ordinary metadata error with an actionable reason.
    assert(/no file data was returned/.test(dlSrc),
      'ensureDownloadHash no longer reports a missing body distinctly from a crypto failure');
    assert(/ArrayBuffer\.isView\(fetched\.bytes\)/.test(dlSrc),
      'ensureDownloadHash no longer validates the fetched body before hashing');
    console.log('  [ok] sha256Hex refuses non-BufferSource input and still hashes empty files');
  }

  console.log('[ok] download guard tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

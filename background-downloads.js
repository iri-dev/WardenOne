/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne Download Guard runtime
 * =================================
 * Owns download scoring, review storage/UI, hash-reputation hooks, trusted
 * download sites, Chrome downloads listeners, and critical hard-block handling.
 * Shared reputation providers and storage/browser wrappers stay in background.js.
 */

// Scores describe context; evidence determines review. Hashes fingerprint a fresh URL re-fetch, not arbitrary saved bytes;
// opt-in VirusTotal receives only the SHA-256.
const DANGEROUS_EXT = /\.(exe|scr|msi|msix|bat|cmd|com|pif|cpl|jar|vbs|vbe|vbscript|js|jse|wsf|wsh|ws|ps1|ps2|psc1|ps1xml|hta|reg|dll|sys|apk|dmg|pkg|app|deb|rpm|gadget|inf|lnk|msc|msp|msu|diagcab|ade|adp|chm|mht|mhtml|url|scf|application|appref-ms|jnlp|xll|settingcontent-ms|library-ms|iqy|slk|desktop|crx|xpi|scptd|terminal)$/i;
const ARCHIVE_EXT = /\.(zip|rar|7z|gz|tar|cab|ace|arj|tgz|bz2|xz|lzh)$/i;
// disk-image / container formats increasingly used to smuggle executables past
// mail/AV filters (Qakbot, IcedID, etc. ship malware inside .iso/.img/.vhd).
const CONTAINER_EXT = /\.(iso|img|vhd|vhdx|udf)$/i;
const MACRO_DOC_EXT = /\.(docm|xlsm|pptm|dotm|xlam|xltm|xlsb)$/i;
// Separate ordinary installer names from crack/keygen signals so setup.exe is not scored like a crack.
const BENIGN_INSTALLER_HINT = /(setup|install(er)?|update(r)?|full[-_. ]?installer)/i;
// Anchored to a non-letter boundary. Unanchored, these matched any word CONTAINING them, so
// firecracker.exe and nutcracker-setup.exe graded E "Dangerous" -- and so did SerialMonitor.exe and
// every serial-port utility, because bare `serial` is an ordinary English word. Narrowed to the
// piracy form (serial-key / serialnum / serial code) so it still catches what it is meant to.
const LURE_HINT = /(^|[^a-z])(crack|keygen|activator|nulled|warez|serial[-_ ]?(key|num|no|code)|cracked|repack|pre-?activated|free-?download|activador|kmspico|autokms)/i;
// Kept for the places that only care "does this name look like SOME kind of installer", such as
// the raw-IP check, where either flavour is equally interesting.
const INSTALLER_HINT = new RegExp(BENIGN_INSTALLER_HINT.source + '|' + LURE_HINT.source, 'i');
const DOWNLOAD_PENDING_KEY = 'wardenone_pending_downloads';
const DOWNLOAD_HANDLED_KEY = 'wardenone_download_handled';
const DOWNLOAD_TRUSTED_KEY = 'wardenone_download_trusted_sites';
try { globalThis.DOWNLOAD_TRUSTED_KEY = DOWNLOAD_TRUSTED_KEY; } catch (_) {}

/* Download reviews contain the source URL and filename. storage.local is shared
 * with the regular profile, so the private split worker keeps its review/decision
 * state and site trust in storage.session instead. Mixed reads (config + trust)
 * merge the two areas without moving ordinary settings out of durable storage. */
const PRIVATE_DOWNLOAD_STORE_KEYS = new Set([
  DOWNLOAD_PENDING_KEY, DOWNLOAD_HANDLED_KEY, DOWNLOAD_TRUSTED_KEY, 'wardenone_session_started_at',
]);
function privateDownloadContext() {
  try { return typeof INCOGNITO_CONTEXT !== 'undefined' && INCOGNITO_CONTEXT; } catch (_) { return false; }
}
function downloadStateGet(keys) {
  if (!privateDownloadContext()) return localGet(keys);
  const list = Array.isArray(keys) ? keys : [keys];
  const sessionKeys = list.filter((key) => PRIVATE_DOWNLOAD_STORE_KEYS.has(key));
  const localKeys = list.filter((key) => !PRIVATE_DOWNLOAD_STORE_KEYS.has(key));
  return Promise.all([
    localKeys.length ? localGet(localKeys) : Promise.resolve({}),
    sessionKeys.length ? chrome.storage.session.get(sessionKeys) : Promise.resolve({}),
  ]).then(([durable, transient]) => Object.assign({}, durable || {}, transient || {}));
}
function downloadStateSet(obj) {
  if (!privateDownloadContext()) return localSet(obj);
  return chrome.storage.session.set(obj);
}

const DOWNLOAD_HASH_TIMEOUT_MS = 15000;
const DOWNLOAD_HASH_MAX_BYTES = 50 * 1024 * 1024;
const DOWNLOAD_HASH_SOURCE = Object.freeze({
  URL_REFETCH: 'url-refetch',
  SERVER_HEADER: 'server-header',
  NOT_AVAILABLE: 'not-available',
  NATIVE_FILE_HASH: 'native-file-hash',
});
const DOWNLOAD_HASH_SOURCE_KIND = DOWNLOAD_HASH_SOURCE.URL_REFETCH;
const DOWNLOAD_HASH_SOURCE_NOTE = 'Chrome extensions cannot read arbitrary saved download files; this hash is computed from a fresh fetch of the download URL.';
const DOWNLOAD_HASH_SOURCE_META = Object.freeze({
  'url-refetch': {
    label: 'URL re-fetch',
    available: true,
    exactFile: false,
    verified: true,
    caveat: DOWNLOAD_HASH_SOURCE_NOTE,
  },
  'server-header': {
    label: 'Server-provided hash',
    available: true,
    exactFile: false,
    verified: false,
    caveat: 'Hash was advertised by the download server, not computed from the saved file.',
  },
  'not-available': {
    label: 'Hash not available',
    available: false,
    exactFile: false,
    verified: false,
    caveat: 'No usable hash source was available for this download.',
  },
  'native-file-hash': {
    label: 'Native file hash',
    available: true,
    exactFile: true,
    verified: true,
    caveat: 'Hash computed from the saved file by a trusted native helper.',
  },
});
const DOWNLOAD_REVIEW_TTL_MS = 2 * 60 * 60 * 1000;
const DOWNLOAD_HANDLED_TTL_MS = 24 * 60 * 60 * 1000;
const CHROME_DANGER_STRONG = new Set(['url', 'content', 'host', 'unwanted', 'deepscannedopeneddangerous', 'sensitivecontentblock', 'accountcompromise']);
const CHROME_DANGER_MEDIUM = new Set(['file', 'uncommon', 'passwordprotected', 'blockedtoolarge', 'sensitivecontentwarning', 'deepscannedfailed', 'blockedscanfailed']);
// Prevalence and incomplete scans remain scoring context, not positive threat findings.
const CHROME_DANGER_WEAK = new Set(['uncommon', 'blockedtoolarge', 'deepscannedfailed', 'blockedscanfailed']);
const CHROME_DANGER_PENDING = new Set(['asyncscanning', 'asynclocalpasswordscanning', 'promptforscanning', 'promptforlocalpasswordscanning']);
const DOWNLOAD_GRADE_META = {
  A: { grade: 'A', status: 'Trusted', color: '#2e9e5b' },
  B: { grade: 'B', status: 'Good', color: '#2e9e5b' },
  C: { grade: 'C', status: 'Review Recommended', color: '#8b3fb0' },
  // D describes source uncertainty; the grade alone does not require intervention.
  D: { grade: 'D', status: 'Unverified Source', color: '#bd7a2a' },
  E: { grade: 'E', status: 'Dangerous', color: '#c0392b' },
  F: { grade: 'F', status: 'Critical Threat', color: '#7f1d1d' },
};
const PENDING_DOWNLOADS = {};
const DOWNLOAD_SCAN_TIMERS = {};
const DOWNLOAD_SCANNING = {};
// Early pauses remain owned until the scan resumes the file or persists its review.
const EARLY_PAUSED = new Set();
/* Listed-source checks started in onCreated. Scans wait for their download's check, so a late
   pause can never land after a scan has already resumed or reviewed that download. */
const EARLY_SOURCE_CHECKS = new Map();
/* Downloads created in this worker whose first scan has not finished. Only these may be paused
   by the filename event; a later pause could hold a file the reader already chose to continue. */
const AWAITING_FIRST_SCAN = new Map();
const FORCED_DOWNLOAD_REQUESTS = new Map();
const FORCED_DOWNLOAD_CONTEXT = new Map();
const FORCED_DOWNLOAD_CHECKS = new Map();
const FORCED_DOWNLOAD_REASONS = new Map();
const FORCED_DOWNLOAD_WINDOW_MS = 30000;

function observeForcedDownloadRequest(details) {
  if (!details || details.tabId < 0 || !/^https?:/i.test(details.url)) return;
  const now = Date.now();
  for (const [key, entry] of FORCED_DOWNLOAD_REQUESTS) {
    if (now - entry.at > FORCED_DOWNLOAD_WINDOW_MS) FORCED_DOWNLOAD_REQUESTS.delete(key);
  }
  const previous = FORCED_DOWNLOAD_REQUESTS.get(details.url);
  const ambiguous = previous && (previous.ambiguous || previous.tabId !== details.tabId || previous.frameId !== (details.frameId || 0));
  FORCED_DOWNLOAD_REQUESTS.delete(details.url);
  FORCED_DOWNLOAD_REQUESTS.set(details.url, { tabId: details.tabId, frameId: details.frameId || 0,
    initiator: details.initiator || '', at: now, ambiguous: !!ambiguous });
  while (FORCED_DOWNLOAD_REQUESTS.size > 128) FORCED_DOWNLOAD_REQUESTS.delete(FORCED_DOWNLOAD_REQUESTS.keys().next().value);
}
try {
  chrome.webRequest.onBeforeRequest.addListener(observeForcedDownloadRequest,
    { urls: ['http://*/*', 'https://*/*'], types: ['main_frame', 'sub_frame', 'other'] });
} catch (_) {}

function forcedDownloadSettingApplies(cfg, host) {
  if (cfg.enabled === false || cfg.forcedDownloadProtection === false) return false;
  if (typeof activeAllowlist === 'function' && hostMatchesAllowlist(host, activeAllowlist(cfg))) return false;
  for (const [pattern, off] of Object.entries(cfg.siteOverrides || {})) {
    if (typeof hostMatchesSite === 'function' && hostMatchesSite(host, pattern)
      && off && (off.enabled === false || off.forcedDownloadProtection === false)) return false;
  }
  return true;
}
async function forcedDownloadContext(item) {
  if (!item || item.byExtensionId || !chrome.tabs || !chrome.tabs.sendMessage) return null;
  let owner = FORCED_DOWNLOAD_REQUESTS.get(item.url) || FORCED_DOWNLOAD_REQUESTS.get(item.finalUrl);
  if (owner && Date.now() - owner.at > FORCED_DOWNLOAD_WINDOW_MS) owner = null;
  if (owner && owner.ambiguous) return null;
  /* No referrer and no page initiator can mean Save link as or a URL typed in the address bar. */
  if (!item.referrer && (!owner || !/^https?:/i.test(owner.initiator))) return null;
  if (!owner) {
    const tabs = await tabsQuery({});
    const matches = tabs.filter(tab => tab.url === item.referrer);
    if (matches.length !== 1) return null;
    owner = { tabId: matches[0].id, frameId: 0 };
  }
  return new Promise(resolve => {
    let finished = false;
    const done = value => { if (!finished) { finished = true; clearTimeout(timer); resolve(value); } };
    const timer = setTimeout(() => done(null), 800);
    try {
      chrome.tabs.sendMessage(owner.tabId, { kind: 'download-intent-query', filename: downloadNameFromItemish(item.filename || item.finalUrl || item.url),
        downloadId: String(item.id), urls: [item.url, item.finalUrl].filter(Boolean) },
        { frameId: owner.frameId }, response => {
          if (chrome.runtime.lastError || !response || response.ok !== true || response.enabled !== true) return done(null);
          try {
            const source = new URL(response.url);
            if (!/^https?:$/.test(source.protocol) || (item.referrer && response.url !== item.referrer)
              || (!item.referrer && source.origin !== owner.initiator)) return done(null);
            const started = Date.parse(item.startTime || '') || Date.now();
            if (!Number.isFinite(response.startedAt) || response.startedAt > started + 100 || Date.now() - started > 60000) return done(null);
            done({ ...response, host: source.hostname });
          } catch (_) { done(null); }
        });
    } catch (_) { done(null); }
  });
}
/* Mirrors bridge.js: a control whose address names a file asked for that file only. */
const FORCED_DOWNLOAD_NAMED_FILE = /\.(?:exe|msi|msix|scr|bat|cmd|ps1|vbs|js|jar|apk|dmg|pkg|zip|7z|rar|pdf|docx?|xlsx?|csv|png|jpe?g|mp[34]|webm)(?:$|[?#])/i;
function forcedDownloadFromAddress(item, href) {
  const strip = (value) => { try { return new URL(value).href.split('#')[0]; } catch (_) { return ''; } };
  const wanted = strip(href);
  /* url is where Chrome started the download and finalUrl where its server redirects ended. */
  return !!wanted && [item.url, item.finalUrl].some((value) => strip(value) === wanted);
}
function unexpectedDownloadReason(item, context) {
  if (!context) return '';
  const gesture = context.gesture;
  const now = Date.parse(item.startTime || '') || Date.now();
  const filename = downloadNameFromItemish(item.filename || item.finalUrl || item.url);
  const active = DANGEROUS_EXT.test(filename) || CONTAINER_EXT.test(filename) || MACRO_DOC_EXT.test(filename);
  if (context.spent === true) return active ? 'The download request on this page was already used by a different file.' : '';
  const recent = gesture && Number.isFinite(gesture.at) && now - gesture.at >= -1000 && now - gesture.at <= FORCED_DOWNLOAD_WINDOW_MS;
  if (!recent) return context.hadGesture ? '' : 'No download request was observed in the page that started this file.';
  if (gesture.requested === true) {
    if (gesture.label === 'Download once') return forcedDownloadFromAddress(item, gesture.href)
      ? '' : 'A different file address used the one-time download choice.';
    if (active && (/^(?:blob|data):/i.test(gesture.href || '') || FORCED_DOWNLOAD_NAMED_FILE.test(gesture.href || ''))
      && !forcedDownloadFromAddress(item, gesture.href)) return 'This file did not come from the address the download control named.';
    if (context.productMismatch === true && active) return 'The installer filename differs from the product heading on the download page.';
    const claimed = String(gesture.claimed || gesture.label || '').match(/[^\s/\\]+\.(?:pdf|docx?|xlsx?|png|jpe?g|mp[34]|zip|exe|msi)\b/i);
    if (active && claimed && claimed[0].split('.').pop().toLowerCase() !== filename.split('.').pop().toLowerCase()) {
      return 'The page offered a different file type from the active file delivered.';
    }
    return '';
  }
  return active ? 'A page action that was not identified as a download started an active file.' : '';
}
function checkForcedDownload(item) {
  const key = String(item.id);
  const work = (async () => {
    const stored = await localGet('wardenone_config');
    const cfg = stored && stored.wardenone_config || {};
    if (!forcedDownloadSettingApplies(cfg, '')) return;
    let context = await forcedDownloadContext(item);
    if (!context) context = FORCED_DOWNLOAD_CONTEXT.get(key);
    if (context) {
      FORCED_DOWNLOAD_CONTEXT.set(key, context);
      while (FORCED_DOWNLOAD_CONTEXT.size > 128) {
        const oldest = FORCED_DOWNLOAD_CONTEXT.keys().next().value;
        FORCED_DOWNLOAD_CONTEXT.delete(oldest); FORCED_DOWNLOAD_REASONS.delete(oldest);
      }
    }
    const latestConfig = await localGet('wardenone_config');
    if (!context || !forcedDownloadSettingApplies(latestConfig && latestConfig.wardenone_config || {}, context.host) || await isDownloadHandled(key)) return;
    const why = unexpectedDownloadReason(item, context);
    if (!why) return;
    FORCED_DOWNLOAD_REASONS.set(key, why);
    if (item.state !== 'complete' && item.state !== 'interrupted' && !EARLY_PAUSED.has(key)) await earlyPauseDownload(item.id);
  })().catch(() => {}).finally(() => { if (FORCED_DOWNLOAD_CHECKS.get(key) === work) FORCED_DOWNLOAD_CHECKS.delete(key); });
  FORCED_DOWNLOAD_CHECKS.set(key, work);
  return work;
}
function applyForcedDownloadEvidence(rep, why) {
  if (!why) return rep;
  rep.intentReason = why;
  if (rep.action !== 'block') rep.action = 'review';
  rep.reviewEvidence = Object.assign({}, rep.reviewEvidence, { unexpectedDownload: true });
  if (!rep.reasons.some(reason => reason.startsWith('Forced Download Protection:'))) rep.reasons.unshift('Forced Download Protection: ' + why);
  if (!rep.blocklisted && !rep.critical && !/^[EF]$/.test(rep.grade)) {
    rep.grade = 'C'; rep.status = 'Unexpected download'; rep.color = DOWNLOAD_GRADE_META.C.color;
    rep.trustAllowed = false;
  }
  return rep;
}

function downloadLooksRisky(item) {
  const url = item && (item.finalUrl || item.url) || '';
  const name = downloadNameFromItemish(item && item.filename || url);
  return shouldReviewDownload(scoreDownload(url, item && item.referrer, name,
    item && item.mime, [], item && item.danger));
}
function earlyPauseDownload(id) {
  EARLY_PAUSED.add(String(id));
  return Promise.resolve(downloadApiCall('pause', id)).catch(() => {});
}
/* onCreated fires before Chrome picks the filename, so a Content-Disposition name such as
   setup.exe from /get?id=1 is first seen in this onChanged delta, a few milliseconds later. */
function earlyPauseNamedDownload(id, filename) {
  const key = String(id);
  if (!AWAITING_FIRST_SCAN.has(key) || EARLY_PAUSED.has(key)) return;
  const item = Object.assign({}, AWAITING_FIRST_SCAN.get(key), { filename });
  AWAITING_FIRST_SCAN.set(key, item);
  try { if (downloadLooksRisky(item)) earlyPauseDownload(id); } catch (_) {}
}
function downloadHostBlocklisted(urls) {
  for (const raw of urls) {
    try {
      const host = new URL(/^blob:https?:/i.test(raw) ? raw.slice(5) : raw).hostname;
      const rd = regDomainBg(host);
      if (rd && (BLOCKED_DOMAINS.has(rd) || BLOCKED_DOMAINS.has(host))) return true;
    } catch (_) {}
  }
  return false;
}
/* A listed address serving a harmless-looking name passes the name sniff. Check the local lists
   now instead of after the scheduled scan's other awaits. */
function earlyPauseListedSource(item) {
  const key = String(item.id);
  const urls = [item.url, item.finalUrl].filter(Boolean);
  if (!urls.length) return null;
  const pauseIfListed = (listed) => (listed && !EARLY_PAUSED.has(key) ? earlyPauseDownload(item.id) : null);
  const check = Promise.all([
    listedPayloadUrl(urls).then(pauseIfListed, () => {}),
    Promise.resolve(typeof securityStoresReady === 'function' ? securityStoresReady() : null)
      .then(() => pauseIfListed(downloadHostBlocklisted(urls)), () => {}),
  ]).then(() => {}, () => {}).finally(() => {
    if (EARLY_SOURCE_CHECKS.get(key) === check) EARLY_SOURCE_CHECKS.delete(key);
  });
  EARLY_SOURCE_CHECKS.set(key, check);
  return check;
}
const DOWNLOAD_SAFE_LOGGED = new Set();

// Session stamps exclude downloads restored from a previous browser run.
// Never stamp an extension update. Generation-check cold reads so a late
// previous-session value cannot overwrite a fresh startup stamp.
let SESSION_STARTED_AT = 0;
let sessionMarkGeneration = 0;
const downloadSessionMarkReady = (() => {
  const startedAt = sessionMarkGeneration;
  return downloadStateGet('wardenone_session_started_at').then((x) => {
    if (sessionMarkGeneration !== startedAt) return;
    SESSION_STARTED_AT = (x && x.wardenone_session_started_at) || 0;
  }).catch(() => {});
})();
async function markBrowserSessionStart() {
  sessionMarkGeneration++;
  SESSION_STARTED_AT = Date.now();
  try { await downloadStateSet({ wardenone_session_started_at: SESSION_STARTED_AT }); } catch (_) {}
}
function downloadStartedBeforeSession(item) {
  if (!SESSION_STARTED_AT) return false;               // unknown (first run) -> don't suppress
  const t = Date.parse((item && item.startTime) || '');
  if (!t) return false;                                // no/invalid start time -> don't suppress
  return t < (SESSION_STARTED_AT - 5000);              // 5s margin for clock skew
}

function normalizeDownloadTrustHost(host) {
  let h = String(host || '').trim().toLowerCase();
  if (!h) return '';
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(h)) h = new URL(h).hostname;
  } catch (_) {}
  h = regDomain(h.replace(/^\.+|\.+$/g, ''));
  if (!/^[a-z0-9.-]+$/i.test(h)) return '';
  return h;
}

// Vetted publishers suppress ordinary reviews independently of user trust. Filename disguises and confirmed threats still
// override that allowance.
const KNOWN_PUBLISHER_DOMAINS = new Set([
  // Microsoft / VS Code / GitHub
  'microsoft.com', 'visualstudio.com', 'vscode.dev', 'windows.com', 'office.com',
  'live.com', 'msftconnecttest.com', 'github.com', 'githubassets.com',
  'dot.net', 'nuget.org', 'powershellgallery.com', 'githubusercontent.com',
  // Google
  'google.com', 'goog', 'chrome.com', 'gstatic.com',
  'android.com', 'dl.google.com', 'googleapis.com', 'gvt1.com', 'gvt2.com',
  // Mozilla
  'mozilla.org', 'mozilla.net', 'firefox.com',
  // Apple
  'apple.com', 'icloud.com',
  // major dev / runtimes
  'python.org', 'pythonhosted.org', 'nodejs.org', 'oracle.com', 'java.com',
  'adoptium.net', 'rust-lang.org', 'golang.org', 'go.dev', 'docker.com',
  'jetbrains.com', 'gradle.org', 'apache.org', 'eclipse.org', 'git-scm.com',
  'gitforwindows.org', 'cmake.org', 'llvm.org', 'msys2.org', 'mingw-w64.org',
  'anaconda.com', 'conda.io', 'chocolatey.org', 'wixtoolset.org',
  'npmjs.com', 'yarnpkg.com', 'pnpm.io', 'deno.com', 'bun.sh', 'ruby-lang.org',
  'rubygems.org', 'php.net', 'composer.org', 'getcomposer.org', 'perl.org',
  'cpan.org', 'lua.org', 'haskell.org', 'scala-lang.org', 'elixir-lang.org',
  'erlang.org', 'ziglang.org', 'dart.dev', 'flutter.dev', 'kotlinlang.org',
  'r-project.org', 'posit.co', 'quarto.org', 'julia-lang.org', 'vagrantup.com',
  'hashicorp.com', 'terraform.io', 'podman.io', 'kubernetes.io', 'helm.sh',
  'k8s.io',
  'sqlite.org', 'postgresql.org', 'mysql.com', 'mariadb.org', 'mongodb.com',
  'redis.io', 'elastic.co',
  // widely-used apps
  'videolan.org', 'libreoffice.org', 'gimp.org', 'blender.org', 'audacityteam.org',
  'obsproject.com', 'notepad-plus-plus.org', '7-zip.org', 'winrar.com', 'rarlab.com',
  'getsharex.com', 'signal.org', 'discord.com',
  // Spotify ships its desktop installer (SpotifySetup.exe) from its own CDN
  // (download.scdn.co / spotifycdn.com), NOT spotify.com — list the CDN too so a clean
  // install from the official site stays silent instead of grading as Suspicious.
  'spotify.com', 'scdn.co', 'spotifycdn.com',
  'slack.com', 'zoom.us', 'steampowered.com', 'epicgames.com', 'gog.com',
  'sourceforge.net', 'fosshub.com', 'ninite.com', 'adobe.com', 'telegram.org',
  'whatsapp.com', '1password.com', 'bitwarden.com', 'proton.me', 'protonvpn.com',
  'tailscale.com', 'wireguard.com', 'openvpn.net', 'anydesk.com', 'teamviewer.com',
  'rufus.ie', 'balena.io', 'voidtools.com', 'scootersoftware.com', 'winmerge.org',
  'meldmerge.org', 'greenshot.org', 'irfanview.com', 'xnview.com', 'paint.net',
  'handbrake.fr', 'makemkv.com', 'filezilla-project.org', 'winscp.net',
  'putty.org', 'chiark.greenend.org.uk', 'mobatek.net', 'mremoteng.org',
  'notion.so', 'obsidian.md', 'logseq.com', 'todoist.com', 'evernote.com',
  'resilio.com', 'syncthing.net',
  'backblaze.com', 'carbonite.com', 'easeus.com', 'macrium.com', 'veeam.com',
  'paragon-software.com', 'acronis.com', 'readdle.com', 'calibre-ebook.com',
  'qbittorrent.org', 'transmissionbt.com', 'deluge-torrent.org',
  'nordvpn.com', 'expressvpn.com', 'surfshark.com', 'mullvad.net', 'ivpn.net',
  'windscribe.com', 'privateinternetaccess.com', 'parsec.app', 'splashtop.com',
  'rustdesk.com', 'vmware.com', 'broadcom.com', 'virtualbox.org', 'qemu.org',
  'proxmox.com', 'postman.com', 'insomnia.rest', 'dbeaver.io',
  'beekeeperstudio.io', 'wiresharkfoundation.org', 'peazip.github.io',
  'peazip.org', 'codecguide.com', 'foobar2000.org', 'mpv.io', 'kodi.tv',
  'plex.tv', 'wacom.com', 'elgato.com', 'focusrite.com', 'framework.com',
  'obsproject.github.io', 'piriform.com', 'ccleaner.com', 'bleachbit.org',
  'dropboxstatic.com', 'cloudflareclient.com', 'win-rar.com', 'dotpdn.com',
  'recuva.com', 'windirstat.net', 'wiztreefree.com', 'diskinternals.com',
  'altools.co.kr', 'bandisoft.com',
  // streaming / media services
  'netflix.com', 'crunchyroll.com', 'funimation.com', 'hidive.com', 'hulu.com',
  'disneyplus.com', 'max.com', 'hbomax.com', 'paramountplus.com', 'peacocktv.com',
  'primevideo.com', 'youtube.com', 'youtu.be', 'twitch.tv', 'tubitv.com',
  'pluto.tv', 'sling.com', 'fubo.tv', 'philo.com', 'vudu.com', 'fandango.com',
  'roku.com', 'stremio.com', 'netflix.net', 'nflxvideo.net', 'nflximg.net',
  'dssott.com', 'bamgrid.com', 'disneypluscdn.com', 'huluim.com',
  'theplatform.com', 'nbcuni.com', 'nbc.com', 'starz.com', 'showtime.com',
  'amcplus.com', 'britbox.com', 'curiositystream.com', 'mubi.com',
  'criterionchannel.com', 'kanopy.com',
  // browsers
  'brave.com', 'vivaldi.com', 'opera.com', 'torproject.org', 'waterfox.net',
  'librewolf.net', 'floorp.app',
  // security vendors (their own tools)
  'malwarebytes.com', 'malwarebytes.org', 'mbamupdates.com', 'bitdefender.com',
  'eset.com', 'kaspersky.com', 'avast.com', 'avg.com', 'avira.com', 'norton.com',
  'mcafee.com', 'trendmicro.com', 'sophos.com', 'f-secure.com', 'emsisoft.com',
  'virustotal.com', 'wireshark.org', 'clamav.net', 'clamwin.com', 'crowdstrike.com',
  'kaspersky-labs.com', 'avcdn.net',
  'sentinelone.com', 'paloaltonetworks.com', 'checkpoint.com', 'fortinet.com',
  'webroot.com', 'zonealarm.com', 'comodo.com', 'glasswire.com', 'portmaster.app',
  'safing.io', 'keepass.info', 'keepassxc.org', 'yubico.com', 'veracrypt.fr',
  'gnupg.org', 'gpg4win.org', 'adguard.com', 'adguard-vpn.com', 'quad9.net',
  'nextdns.io', 'cleanbrowsing.org',
  // hardware and driver publishers
  'nvidia.com', 'amd.com', 'intel.com', 'logitech.com', 'logi.com', 'razer.com',
  'corsair.com', 'steelseries.com', 'asus.com', 'dell.com', 'hp.com',
  'lenovo.com', 'realtek.com', 'acer.com', 'msi.com', 'gigabyte.com',
  'asrock.com', 'evga.com', 'western-digital.com', 'wdc.com', 'seagate.com',
  'samsung.com', 'crucial.com', 'kingston.com', 'sandisk.com', 'synology.com',
  'qnap.com', 'tp-link.com', 'netgear.com', 'linksys.com', 'ubnt.com',
  'ui.com', 'canon.com', 'epson.com', 'brother.com', 'xerox.com',
  'beelink.com', 'minisforum.com',
  // game/platform publishers
  'battle.net', 'blizzard.com', 'ea.com', 'ubisoft.com', 'riotgames.com',
  'minecraft.net', 'rockstargames.com', 'valvesoftware.com',
  'humblebundle.com', 'bethesda.net', 'wargaming.net', 'warframe.com',
  'square-enix-games.com', 'overwolf.com', 'store.steampowered.com',
  'steamstatic.com', 'steamcontent.com', 'epicgames.dev', 'gog-statics.com',
  'ubi.com', 'riotcdn.net',
  'playvalorant.com', 'leagueoflegends.com', 'roblox.com', 'robloxcdn.com',
  'minecraftservices.com',
  // cloud/platform vendor CLIs and agents
  'aws.amazon.com', 'azure.com', 'digitalocean.com',
  'linode.com', 'akamai.com', 'cloud.google.com', 'oraclecloud.com',
  'cloudflare.com', 'fly.io', 'render.com', 'heroku.com', 'vercel.com',
  'netlify.com',
  // ---- Additional vetted publishers (expanded download exceptions) ----------
  // Same rule as the rest of this list: provider-controlled domains ONLY. No
  // shared CDNs, user-content hosts, or personal cloud drives (dropbox/mega/
  // mediafire/drive.google/etc.) -- an attacker can host a payload on those.
  // communication / meetings / chat / mail
  'webex.com', 'goto.com', 'gotomeeting.com', 'skype.com', 'thunderbird.net',
  'tuta.com', 'tutanota.com', 'element.io', 'mattermost.com', 'rocket.chat',
  'teamspeak.com', 'mumble.info', 'viber.com', 'line.me', 'wechat.com',
  'guilded.com', 'loom.com',
  // office / productivity / notes / reference
  'onlyoffice.com', 'wps.com', 'wpsoffice.com', 'softmaker.com', 'freeoffice.com',
  'grammarly.com', 'zotero.org', 'xmind.app', 'xmind.net', 'anytype.io',
  'standardnotes.com', 'joplinapp.org', 'techsmith.com',
  // Claude creates downloadable documents and archives inside the web app. Its artifact/file
  // host is multi-tenant, so it receives only the limited platform rebate below, not full trust.
  'anthropic.com', 'claude.ai', 'claude.com', 'claudeusercontent.com',
  // dev tools / editors / IDEs / terminals / databases
  'sublimetext.com', 'sublimemerge.com', 'gitkraken.com', 'sourcetreeapp.com',
  'atlassian.com', 'fork.dev', 'tortoisegit.org', 'tortoisesvn.net',
  'cursor.com', 'cursor.sh', 'warp.dev', 'iterm2.com', 'hyper.is', 'termius.com',
  'heidisql.com', 'pgadmin.org', 'sqlitebrowser.org', 'tableplus.com',
  'unity.com', 'unity3d.com', 'unrealengine.com', 'godotengine.org',
  'arduino.cc', 'raspberrypi.com', 'raspberrypi.org', 'nmap.org',
  'autohotkey.com', 'chromium.org', 'rclone.org', 'cyberduck.io',
  // remote access / backup
  'nomachine.com', 'realvnc.com', 'duplicati.com',
  // creative / graphics / audio / video production
  'serif.com', 'inkscape.org', 'krita.org', 'darktable.org', 'rawtherapee.com',
  'shotcut.org', 'kdenlive.org', 'openshot.org', 'blackmagicdesign.com',
  'streamlabs.com', 'cockos.com', 'ardour.org', 'musescore.org', 'lmms.io',
  'bandlab.com', 'image-line.com', 'ableton.com', 'native-instruments.com',
  'steinberg.net', 'presonus.com', 'mpc-hc.org', 'figma.com', 'sketch.com',
  'canva.com', 'diagrams.net', 'scribus.net',
  // media players / servers
  'jellyfin.org', 'emby.media', 'getmusicbee.com',
  // emulators (official project sites)
  'retroarch.com', 'libretro.com', 'dolphin-emu.org', 'pcsx2.net', 'ppsspp.org',
  'rpcs3.net', 'mgba.io',
  // utilities / system tools
  'sysinternals.com', 'nirsoft.net', 'ventoy.net', 'cpuid.com', 'hwinfo.com',
  'techpowerup.com', 'crystaldewworld.com', 'jam-software.com',
  'revouninstaller.com', 'binaryfortress.com', 'rainmeter.net',
  'justgetflux.com', 'screentogif.com', 'wagnardsoft.com', 'displaylink.com',
  // password managers / privacy / VPN / extra browsers
  'lastpass.com', 'dashlane.com', 'nordpass.com', 'authy.com', 'cryptomator.org',
  'cyberghostvpn.com', 'duckduckgo.com', 'palemoon.org',
  // gaming / launchers
  'playstation.com', 'xbox.com', 'nintendo.com', 'faceit.com', 'medal.tv',
  'prismlauncher.org', 'lunarclient.com',
  // audio hardware / peripherals / printers / drivers
  'rode.com', 'shure.com', 'sennheiser.com', 'jabra.com', 'system76.com',
  'qualcomm.com', 'anker.com', 'poly.com', 'benq.com', 'viewsonic.com',
  'lg.com', 'sony.com', 'kioxia.com', 'lexmark.com', 'ricoh.com',
  'garmin.com', 'gopro.com', 'dji.com',
  // Provider-controlled domains only. Shared CDNs/user-content hosts (CloudFront,
  // --- security software (a scared user's first download is often one of these) ---
  'malwarebytes.com', 'bitdefender.com', 'avast.com', 'avg.com', 'eset.com',
  'kaspersky.com', 'norton.com', 'nortonlifelock.com', 'mcafee.com', 'trendmicro.com',
  'sophos.com', 'f-secure.com', 'bleepingcomputer.com', 'piriform.com', 'ccleaner.com',
  // --- operating systems and distros (an ISO is otherwise graded on the container alone) ---
  'ubuntu.com', 'canonical.com', 'debian.org', 'fedoraproject.org', 'linuxmint.com',
  'archlinux.org', 'opensuse.org', 'raspberrypi.com', 'raspberrypi.org', 'kernel.org',
  'kali.org', 'tails.net', 'manjaro.org', 'alpinelinux.org', 'rockylinux.org',
  'almalinux.org', 'centos.org', 'nixos.org', 'gentoo.org', 'freebsd.org',
  'openbsd.org', 'netbsd.org', 'elementary.io', 'zorin.com', 'endeavouros.com',
  // --- platforms whose real download host is not the marketing domain ---
  'zoom.us', 'steamstatic.com', 'f-droid.org', 'forgecdn.net', 'curseforge.com',
  // --- browsers ---
  'brave.com', 'opera.com', 'vivaldi.com', 'duckduckgo.com', 'torproject.org',
  // --- communication / conferencing ---
  'slack.com', 'slack-edge.com', 'telegram.org', 'signal.org', 'whatsapp.com', 'skype.com',
  'teamviewer.com', 'anydesk.com', 'webex.com', 'gotomeeting.com',
  // --- media, creative and office ---
  'handbrake.fr', 'gimp.org', 'inkscape.org', 'blender.org', 'krita.org',
  'libreoffice.org', 'openoffice.org', 'onlyoffice.com', 'foxit.com', 'foxitsoftware.com',
  'irfanview.com', 'paint.net', 'getpaint.net', 'shotcut.org', 'kdenlive.org',
  'davinciresolve.com', 'blackmagicdesign.com', 'sketchup.com', 'autodesk.com',
  // --- gaming platforms and studios ---
  'gog.com', 'ea.com', 'ubisoft.com', 'battle.net', 'blizzard.com', 'riotgames.com',
  'minecraft.net', 'mojang.com', 'roblox.com', 'unity.com', 'unrealengine.com',
  // --- hardware, drivers and peripherals ---
  'corsair.com', 'razer.com', 'steelseries.com', 'msi.com', 'gigabyte.com', 'asrock.com',
  'seagate.com', 'westerndigital.com', 'samsung.com', 'brother.com', 'brother-usa.com',
  'realtek.com', 'displaylink.com', 'wacom.com', 'elgato.com', 'sandisk.com',
  'acer.com', 'msi.com', 'razerzone.com', 'synology.com', 'qnap.com', 'ubnt.com', 'ui.com',
  // --- utilities a PC owner is told to install ---
  'winscp.net', 'putty.org', 'filezilla-project.org', 'rufus.ie', 'balena.io',
  'cpuid.com', 'hwinfo.com', 'crystalmark.info', 'voidtools.com', 'sumatrapdfreader.org',
  'qbittorrent.org', 'thunderbird.net', 'protonvpn.com', 'proton.me', 'mullvad.net',
  'nordvpn.com', 'expressvpn.com', 'openvpn.net', 'wireguard.com',
  'logmein.com', 'dropbox.com', 'box.com', 'sync.com', 'pcloud.com',
  // Fastly, Akamai, GitHub Pages/raw content, Azure CDN, jsDelivr, personal cloud
  // drives, etc.) are not trusted as publishers because arbitrary third parties can
  // host there.
]);

// These are exact, vendor-operated delivery hosts on otherwise shared infrastructure.
// Trust must never widen to sibling tenants: awscli.amazonaws.com is the official AWS
// CLI route, while arbitrary-bucket.amazonaws.com remains an ordinary untrusted source.
const EXACT_OFFICIAL_INSTALLER_HOSTS = new Set([
  'dl.discordapp.net',
  'awscli.amazonaws.com',
  'azurecliprod.blob.core.windows.net',
  'epicgames-download1.akamaized.net',
  'setup.rbxcdn.com',
  'gdlp01.c-wss.com',
]);

function isKnownPublisherDomain(host) {
  const h = normalizeDownloadTrustHost(host);
  if (!h) return false;
  if (EXACT_OFFICIAL_INSTALLER_HOSTS.has(h)) return true;
  if (KNOWN_PUBLISHER_DOMAINS.has(h)) return true;
  // match subdomains: dl.google.com -> google.com, update.code.visualstudio.com etc.
  for (const dom of KNOWN_PUBLISHER_DOMAINS) {
    if (h === dom || h.endsWith('.' + dom)) return true;
  }
  return false;
}

// Multi-tenant publishers receive a reduced rebate: platform reputation does not endorse each file.
// Include githubusercontent.com because GitHub release downloads redirect there.
// Public hosting suffixes must not grant trust to every tenant.
const SHARED_HOSTING_SUFFIXES = new Set([
  'cloudfront.net', 'amazonaws.com', 'windows.net', 'azureedge.net', 'azurewebsites.net',
  'pages.dev', 'workers.dev', 'r2.dev', 'netlify.app', 'vercel.app', 'web.app',
  'firebaseapp.com', 'herokuapp.com', 'github.io', 'gitlab.io', 'b-cdn.net', 'fastly.net',
  'akamaized.net', 'googleusercontent.com', 'dropboxusercontent.com', 'appspot.com',
  'blob.core.windows.net', 'digitaloceanspaces.com', 'backblazeb2.com', 'wasabisys.com',
  'claudeusercontent.com',
]);
// The host a Trust decision should actually be recorded against.
function downloadTrustTarget(host) {
  const h = String(host || '');
  if (!h) return '';
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(h)) return h;
  const rd = regDomainBg(h);
  if (!rd) return '';
  return SHARED_HOSTING_SUFFIXES.has(rd) ? h : siteIdentity(h);
}

const MULTITENANT_PUBLISHER_HOSTS = new Set([
  'github.com', 'sourceforge.net', 'githubusercontent.com', 'claudeusercontent.com',
]);
function isMultiTenantPublisherHost(host) {
  const h = normalizeDownloadTrustHost(host);
  if (!h) return false;
  if (EXACT_OFFICIAL_INSTALLER_HOSTS.has(h)) return false;
  for (const dom of MULTITENANT_PUBLISHER_HOSTS) {
    if (h === dom || h.endsWith('.' + dom)) return true;
  }
  return false;
}

function trustedDownloadMatch(host, trustedSites) {
  const h = normalizeAllowlistHost(host);
  if (!h) return '';
  const list = Array.isArray(trustedSites) ? trustedSites : [];
  return list.find((site) => {
    const t = normalizeAllowlistHost(site);
    return t && hostMatchesSite(h, t);
  }) || '';
}

async function getTrustedDownloadSites() {
  const x = await downloadStateGet(DOWNLOAD_TRUSTED_KEY);
  return normalizeAllowlistHosts(x && x[DOWNLOAD_TRUSTED_KEY], 1000);
}

async function addTrustedDownloadSite(host) {
  const clean = normalizeAllowlistHost(host);
  if (!clean) return { ok: false, error: 'No valid site to trust.' };
  const list = await getTrustedDownloadSites();
  if (list.length >= 1000 && !list.includes(clean)) return { ok: false, error: 'Trusted site list is full.' };
  if (!list.some((x) => normalizeAllowlistHost(x) === clean)) list.push(clean);
  list.sort();
  await downloadStateSet({ [DOWNLOAD_TRUSTED_KEY]: list });
  return { ok: true, host: clean, items: list };
}

async function removeTrustedDownloadSite(host) {
  const clean = normalizeAllowlistHost(host);
  const list = (await getTrustedDownloadSites()).filter((x) => normalizeAllowlistHost(x) !== clean);
  await downloadStateSet({ [DOWNLOAD_TRUSTED_KEY]: list });
  return { ok: true, host: clean, items: list };
}

function downloadGradeFromScore(score, critical) {
  if (critical || score >= 10) return DOWNLOAD_GRADE_META.F;
  if (score >= 6) return DOWNLOAD_GRADE_META.E;
  if (score >= 3) return DOWNLOAD_GRADE_META.D;
  if (score >= 2) return DOWNLOAD_GRADE_META.C;
  if (score >= 1) return DOWNLOAD_GRADE_META.B;
  return DOWNLOAD_GRADE_META.A;
}

function shouldReviewDownload(rep) {
  if (!rep) return false;
  if (rep.blocklisted || rep.critical || rep.payloadUrlListed) return true;
  const evidence = rep.reviewEvidence || {};
  if (evidence.unexpectedDownload) return true;
  if (evidence.browserWarning || evidence.malwareDetection) return true;
  if (!evidence.activeContent) return false;
  if (evidence.lure) return true;
  if (rep.trustedEligible) return false;
  return !!(evidence.publicIp || evidence.obfuscatedUrl || evidence.hiddenProgram
    || (evidence.flaggedRedirect && (evidence.insecure || evidence.lookalike || evidence.youngDomain || evidence.reputationWarning))
    || (evidence.youngDomain && evidence.reputationWarning));
}

function downloadRecommendation(grade, finished) {
  if (finished) {
    if (grade === 'C') return 'Review the source before opening this file.';
    if (grade === 'D') return 'WardenOne could not confirm where this came from. Keep it only if this is the file you meant to download from a site you know.';
    if (grade === 'E') return 'Deleting it is recommended unless you are completely sure this source is legitimate.';
    if (grade === 'F') return 'Delete this file without opening it. Opening it could put this computer at serious risk.';
  }
  if (grade === 'C') return 'Review the source before continuing.';
  if (grade === 'D') return 'WardenOne could not confirm where this came from. Continue if this is the file you meant to download from a site you know.';
  if (grade === 'E') return 'Cancellation is recommended unless you are completely sure this source is legitimate.';
  if (grade === 'F') return 'Cancel this download. Continuing could put this computer at serious risk.';
  return 'No action needed.';
}

/* Failed lookups return null; an empty array confirms no matching download. */
function downloadSearch(query, strict = false) {
  return new Promise((resolve, reject) => {
    try {
      chrome.downloads.search(query || {}, (items) => {
        const err = chrome.runtime.lastError;
        if (err || !Array.isArray(items)) {
          if (strict) reject(new Error(err && err.message || 'Download lookup failed'));
          else resolve(null);
          return;
        }
        resolve(items);
      });
    } catch (e) {
      if (strict) reject(e);
      else resolve(null);
    }
  });
}

function appendExternalReputation(rep, entry) {
  if (!rep || !entry) return rep;
  rep.externalReputation = Array.isArray(rep.externalReputation) ? rep.externalReputation : [];
  rep.externalReputation.push(entry);
  rep.externalSummary = externalSummary(rep.externalReputation);
  return rep;
}

function downloadNameFromItemish(filenameOrUrl) {
  const raw = String(filenameOrUrl || '');
  const slashName = raw.split(/[\\/]/).pop() || raw;
  if (/^[a-z]:[\\/]/i.test(raw)) return slashName;
  try {
    const u = new URL(raw);
    const name = u.pathname.split('/').pop() || slashName || '';
    try { return decodeURIComponent(name); } catch (_) { return name; }
  } catch (_) {
    return slashName;
  }
}

function shouldCheckVirusTotalHash(rep, url, filename) {
  if (!rep || !url || !/^https?:/i.test(url)) return false;
  try {
    const u = new URL(String(url || ''));
    if (isLocalOrPrivateHost(u.hostname)) return false;
  } catch (_) {
    return false;
  }
  if (rep.trustedEligible && !rep.blocklisted) return false;
  const name = downloadNameFromItemish(filename || url);
  const riskyType = DANGEROUS_EXT.test(name) || ARCHIVE_EXT.test(name) || CONTAINER_EXT.test(name) || MACRO_DOC_EXT.test(name) || INSTALLER_HINT.test(name);
  return rep.score >= 1 || rep.action === 'review' || riskyType;
}

function formatBytesShort(n) {
  const size = Number(n || 0);
  if (!size) return '0 B';
  if (size >= 1024 * 1024) return Math.round(size / 1024 / 1024) + ' MB';
  if (size >= 1024) return Math.round(size / 1024) + ' KB';
  return size + ' B';
}

const DOWNLOAD_HASH_HOP_QUEUES = new Map();
const DOWNLOAD_HASH_ACTIVE_HOPS = new Map();
/* webRequest stamps use another clock than Date.now(); Chrome 121 on Windows put a hop's own request up to 11 ms early. */
const DOWNLOAD_HASH_CLOCK_SLACK_MS = 50;
let downloadHashStartObserverReady = false;
let downloadHashRedirectObserverReady = false;

function downloadHashObservation(details) {
  const job = details && DOWNLOAD_HASH_ACTIVE_HOPS.get(details.url);
  return job && details.initiator === job.origin && details.tabId === -1 && details.method === 'GET'
    && details.type === 'xmlhttprequest' && typeof details.requestId === 'string' ? job : null;
}

// Register synchronously so redirects can be bound to the hop's observed request ID.
try {
  chrome.webRequest.onBeforeRequest.addListener((details) => {
    const job = downloadHashObservation(details);
    /* A late event from an older same-URL request can land inside the slack; the single-request check then fails closed. */
    if (job && details.timeStamp + DOWNLOAD_HASH_CLOCK_SLACK_MS >= job.startedAt) job.requests.add(details.requestId);
  }, { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest'], tabId: -1 });
  downloadHashStartObserverReady = true;
} catch (_) {}
try {
  chrome.webRequest.onBeforeRedirect.addListener((details) => {
    const job = downloadHashObservation(details);
    if (!job || !job.requests.has(details.requestId)) return;
    job.redirect = { id: details.requestId, url: details.redirectUrl };
    job.finish();
  }, { urls: ['http://*/*', 'https://*/*'], types: ['xmlhttprequest'], tabId: -1 });
  downloadHashRedirectObserverReady = true;
} catch (_) {}

function fetchDownloadHashHop(url, signal) {
  const previous = DOWNLOAD_HASH_HOP_QUEUES.get(url) || Promise.resolve();
  const task = previous.then(() => observeDownloadHashHop(url, signal));
  const settled = task.catch(() => {});
  DOWNLOAD_HASH_HOP_QUEUES.set(url, settled);
  settled.then(() => { if (DOWNLOAD_HASH_HOP_QUEUES.get(url) === settled) DOWNLOAD_HASH_HOP_QUEUES.delete(url); });
  return task;
}

async function observeDownloadHashHop(url, signal) {
  if (signal.aborted) throw new Error('Hash fetch timed out');
  let finish;
  const observed = new Promise((resolve) => { finish = resolve; });
  const aborted = () => finish();
  const job = { origin: chrome.runtime.getURL('').replace(/\/$/, ''), startedAt: Date.now(), requests: new Set(), redirect: null, finish };
  DOWNLOAD_HASH_ACTIVE_HOPS.set(url, job);
  try {
    // Manual Fetch hides Location. Observe only this worker's request, then validate before the next GET.
    signal.addEventListener('abort', aborted, { once: true });
    const response = await fetch(url, {
      method: 'GET', credentials: 'omit', redirect: 'manual', cache: 'no-store', signal,
    });
    if (response.type !== 'opaqueredirect') return { response, redirectUrl: '' };
    if (!downloadHashStartObserverReady || !downloadHashRedirectObserverReady) {
      throw new Error('Hash redirect observation is unavailable');
    }
    await observed;
    if (signal.aborted) throw new Error('Hash fetch timed out');
    if (!job.redirect || job.requests.size !== 1 || !job.requests.has(job.redirect.id)) {
      throw new Error('Hash redirect target could not be verified');
    }
    return { response, redirectUrl: job.redirect.url };
  } finally {
    signal.removeEventListener('abort', aborted);
    DOWNLOAD_HASH_ACTIVE_HOPS.delete(url);
  }
}

async function fetchBytesForHash(url, maxBytes) {
  let currentUrl = '';
  let requestedUrl = '';
  try {
    const u = new URL(String(url || ''));
    if ((u.protocol !== 'http:' && u.protocol !== 'https:') || isLocalOrPrivateHost(u.hostname)) {
      return { ok: false, skipped: true, reason: 'Hash check skipped for local or private-network URL', maxBytes };
    }
    u.hash = '';
    currentUrl = u.href;
    requestedUrl = currentUrl;
  } catch (_) {
    return { ok: false, skipped: true, reason: 'Hash check skipped for invalid URL', maxBytes };
  }
  for (let redirects = 0; redirects <= 4; redirects++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOWNLOAD_HASH_TIMEOUT_MS);
    try {
      const { response: res, redirectUrl } = await fetchDownloadHashHop(currentUrl, controller.signal);
      if (res.type === 'opaqueredirect') {
        if (redirects === 4) break;
        let nextUrl = '';
        try {
          if (!redirectUrl) throw new Error('Missing redirect target');
          const next = new URL(redirectUrl, currentUrl);
          if (next.protocol !== 'http:' && next.protocol !== 'https:') {
            return { ok: false, skipped: true, reason: 'Hash check skipped after non-web redirect', maxBytes };
          }
          if (isLocalOrPrivateHost(next.hostname)) {
            return { ok: false, skipped: true, reason: 'Hash check skipped after local or private-network redirect', maxBytes };
          }
          next.hash = '';
          nextUrl = next.href;
        } catch (_) {
          return { ok: false, skipped: true, reason: 'Hash check skipped after invalid redirect', maxBytes };
        }
        currentUrl = nextUrl;
        continue;
      }
      if (!res.ok) return { ok: false, reason: 'Download could not be re-fetched for hashing (HTTP ' + res.status + ')' };

      const contentType = String((res.headers && res.headers.get('content-type')) || '').slice(0, 120);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared && declared > maxBytes) {
        try { controller.abort(); } catch (_) {}
        return {
          ok: false,
          skipped: true,
          reason: 'File is larger than the hash-check limit (' + formatBytesShort(maxBytes) + ')',
          bytes: declared,
          maxBytes,
        };
      }

      if (!res.body || !res.body.getReader) {
        if (!declared) {
          return { ok: false, skipped: true, reason: 'File size was unknown and streaming was unavailable', maxBytes };
        }
        const buffer = await res.arrayBuffer();
        if (buffer.byteLength > maxBytes) {
          return {
            ok: false,
            skipped: true,
            reason: 'File is larger than the hash-check limit (' + formatBytesShort(maxBytes) + ')',
            bytes: buffer.byteLength,
            maxBytes,
          };
        }
        return {
          ok: true,
          bytes: new Uint8Array(buffer),
          byteLength: buffer.byteLength,
          requestedUrl,
          finalUrl: currentUrl,
          redirects,
          contentType,
          contentLength: declared || buffer.byteLength,
          source: DOWNLOAD_HASH_SOURCE_KIND,
          exactFile: false,
        };
      }

      const reader = res.body.getReader();
      const chunks = [];
      let total = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        const chunk = part.value || new Uint8Array(0);
        total += chunk.byteLength;
        if (total > maxBytes) {
          try { await reader.cancel(); } catch (_) {}
          return {
            ok: false,
            skipped: true,
            reason: 'File is larger than the hash-check limit (' + formatBytesShort(maxBytes) + ')',
            bytes: total,
            maxBytes,
          };
        }
        chunks.push(chunk);
      }

      const bytes = new Uint8Array(total);
      let offset = 0;
      chunks.forEach((chunk) => {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      });
      return {
        ok: true,
        bytes,
        byteLength: total,
        requestedUrl,
        finalUrl: currentUrl,
        redirects,
        contentType,
        contentLength: declared || total,
        source: DOWNLOAD_HASH_SOURCE_KIND,
        exactFile: false,
      };
    } catch (e) {
      return { ok: false, reason: 'Download could not be re-fetched for hashing', error: String(e).slice(0, 120) };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, skipped: true, reason: 'Hash check skipped after too many redirects', maxBytes };
}

// Failed fetch results carry a byte count, not a BufferSource. Reject that before calling digest.
// An empty buffer is valid input and has a SHA-256 hash.
async function sha256Hex(bytes) {
  const isBufferSource = bytes instanceof ArrayBuffer
    || (typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(bytes));
  if (!isBufferSource) throw new TypeError('sha256Hex needs an ArrayBuffer or a view, got ' + typeof bytes);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function normalizeDownloadHashSourceKind(kind) {
  const value = String(kind || '').trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(DOWNLOAD_HASH_SOURCE_META, value)
    ? value
    : DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE;
}

function downloadHashSourceMeta(fetched, kind, extra) {
  const source = fetched || {};
  const method = normalizeDownloadHashSourceKind(kind || source.source || source.method || DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE);
  const base = DOWNLOAD_HASH_SOURCE_META[method] || DOWNLOAD_HASH_SOURCE_META[DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE];
  return {
    kind: method,
    method,
    label: base.label,
    available: !!base.available,
    exactFile: !!base.exactFile,
    verified: !!base.verified,
    caveat: String((extra && extra.caveat) || source.caveat || base.caveat || '').slice(0, 240),
    reason: String((extra && extra.reason) || source.reason || '').slice(0, 180),
    /* The re-fetch addresses ride inside the review that is persisted, and nothing reads them
       back as addresses -- the same display form as the review itself (PRIV-05). */
    requestedUrl: downloadDisplayUrl(source.requestedUrl || ''),
    finalUrl: downloadDisplayUrl(source.finalUrl || ''),
    redirects: Number(source.redirects || 0),
    contentType: String(source.contentType || '').slice(0, 120),
    contentLength: Number(source.contentLength || source.byteLength || source.bytes || 0),
    maxBytes: DOWNLOAD_HASH_MAX_BYTES,
  };
}

/* The bundled EICAR entry is diagnostic. Only additional signatures justify an
   automatic URL re-fetch; that response still cannot verify the saved file. */
const EICAR_SHA256 = '275a021bbfb6489e54d471899f7db9d1663fc695ec2fe2a2c4538aabf651fd0f';
let MALWARE_HASHES = new Set();
const MALWARE_HASH_SOURCES = { bundled: new Set(), stored: new Set() };
let malwareHashesReady = Promise.resolve();
function addMalwareHashes(arr, target) {
  for (const h of (Array.isArray(arr) ? arr : [])) {
    const v = String(h || '').trim().toLowerCase();
    if (/^[a-f0-9]{64}$/.test(v)) target.add(v);
  }
}
function localMalwareHashCoverage() {
  const signatureCount = MALWARE_HASHES.size - (MALWARE_HASHES.has(EICAR_SHA256) ? 1 : 0);
  return { listSize: MALWARE_HASHES.size, signatureCount,
    diagnosticOnly: MALWARE_HASHES.size > 0 && signatureCount === 0 };
}
function loadMalwareHashes() {
  malwareHashesReady = malwareHashesReady.then(async () => {
    const sources = { ...MALWARE_HASH_SOURCES };
    try {
      const res = await fetch(chrome.runtime.getURL('malware-hashes.json'), { cache: 'no-store' });
      if (res && res.ok) {
        const data = await res.json();
        const next = new Set();
        addMalwareHashes(Array.isArray(data) ? data : (data && data.sha256), next);
        sources.bundled = next;
      }
    } catch (_) {}
    try {
      const x = await localGetStrict('wardenone_malware_hashes');
      const stored = x && x.wardenone_malware_hashes;
      const next = new Set();
      addMalwareHashes(Array.isArray(stored) ? stored : (stored && stored.sha256), next);
      sources.stored = next;
    } catch (_) {}
    const next = new Set();
    for (const hashes of Object.values(sources)) {
      for (const hash of hashes) next.add(hash);
    }
    Object.assign(MALWARE_HASH_SOURCES, sources);
    MALWARE_HASHES = next;
  });
  return malwareHashesReady;
}
loadMalwareHashes();

/* Download Guard feeds (DOWNLOAD_THREAT_LIST_SOURCES). File hashes use sorted 128-bit prefixes
   packed as bytes in base64, preserving both complete source lists within local storage. */
const DOWNLOAD_THREAT_FEED_KEY = 'wardenone_download_threat_feeds';
const DOWNLOAD_THREAT_META_KEY = 'wardenone_download_threat_meta';
/* 128 bits per file hash and 64 per address: far past accidental collision at these sizes. */
const DOWNLOAD_HASH_PREFIX_HEX = 32;
const DOWNLOAD_URL_KEY_HEX = 16;
const DOWNLOAD_THREAT_FEED_CAPS = { 'payload-urls': 32000 };
const DOWNLOAD_THREAT_DRIFT = { minBaseline: 200, dropRatio: 0.25 };
const DOWNLOAD_URL_KEY_MAX_CHARS = 2048;
/* Directory depth checked when a store predates its depth list: shallowest first, so padding a path
   beneath a listed directory cannot push that directory out. */
const DOWNLOAD_URL_FALLBACK_DIR_DEPTH = 24;
const LISTED_PAYLOAD_URL_MIN_SCORE = 6;

/* URL.host keeps only a port that is not the scheme's default. The publisher lowercases whole URLs
   and drops a leading www. before listing them, so both are folded here or those payloads never match. */
function downloadPayloadUrlParts(raw) {
  let u;
  try { u = new URL(String(raw || '')); } catch (_) { return null; }
  if (!/^https?:$/.test(u.protocol) || !u.hostname || u.pathname.length < 2) return null;
  return { host: u.host.replace(/^www\.(?=[^:])/, ''), path: u.pathname.toLowerCase(), search: u.search.toLowerCase() };
}
/* Only an entry ending in '/' covers what is beneath it; any other entry names one file, so a short
   listed path on a shared host cannot quietly cover everything under it. */
function downloadPayloadUrlEntryKey(line) {
  const m = /^\|\|([^\s^$]+)\^(?:\$[a-z,]*)?$/i.exec(String(line || '').trim());
  if (!m || m[1].indexOf('/') < 0 || m[1].length > DOWNLOAD_URL_KEY_MAX_CHARS) return '';
  const parts = downloadPayloadUrlParts('http://' + m[1]);
  if (!parts) return '';
  /* A listed port already survived its own scheme's default; reading the entry as http drops :80. */
  const host = /:80$/.test(m[1].split(/[/?]/, 1)[0]) ? parts.host + ':80' : parts.host;
  return host + parts.path + parts.search;
}
/* Depth is the slash count of a directory key ('host/a/' is 2). Directories are only checked at
   depths the feed lists, which bounds the lookups without dropping any listed parent. */
function downloadPayloadUrlDirDepth(key) {
  return key.endsWith('/') && key.indexOf('?') < 0 ? key.split('/').length - 1 : 0;
}
function downloadPayloadUrlCandidates(raw, dirDepths) {
  const parts = downloadPayloadUrlParts(raw);
  if (!parts) return [];
  const listed = Array.isArray(dirDepths) ? new Set(dirDepths) : null;
  const deepest = listed ? Math.max(0, ...listed) : DOWNLOAD_URL_FALLBACK_DIR_DEPTH;
  const out = new Set();
  for (let i = parts.path.indexOf('/', 1), depth = 2; i > 0 && depth <= deepest; i = parts.path.indexOf('/', i + 1), depth++) {
    const key = parts.host + parts.path.slice(0, i + 1);
    if (key.length > DOWNLOAD_URL_KEY_MAX_CHARS) break;
    if (!listed || listed.has(depth)) out.add(key);
  }
  out.add(parts.host + parts.path);
  if (parts.search) out.add(parts.host + parts.path + parts.search);
  return [...out].filter((key) => key.length <= DOWNLOAD_URL_KEY_MAX_CHARS);
}
async function downloadUrlKeyFingerprint(key) {
  return (await sha256Hex(new TextEncoder().encode(key))).slice(0, DOWNLOAD_URL_KEY_HEX);
}

function packSortedHex(values) {
  return [...new Set(values)].sort().join('');
}
function packedHexValid(packed, width) {
  if (typeof packed !== 'string' || packed.length % width || !/^[0-9a-f]*$/.test(packed)) return false;
  for (let at = width; at < packed.length; at += width) {
    if (packed.slice(at - width, at) >= packed.slice(at, at + width)) return false;
  }
  return true;
}
function packedHexHas(packed, width, key) {
  if (!packed || !key || key.length !== width) return false;
  let lo = 0;
  let hi = packed.length / width - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const value = packed.slice(mid * width, mid * width + width);
    if (value === key) return true;
    if (value < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

function packedHashBytes(hex) {
  const chunks = [];
  for (let at = 0; at < hex.length; at += 8192) {
    const slice = hex.slice(at, at + 8192);
    const bytes = new Array(slice.length / 2);
    for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(slice.slice(i * 2, i * 2 + 2), 16);
    chunks.push(String.fromCharCode(...bytes));
  }
  return chunks.join('');
}
function packedHashBytesValid(bytes) {
  if (typeof bytes !== 'string' || bytes.length % (DOWNLOAD_HASH_PREFIX_HEX / 2)) return false;
  const width = DOWNLOAD_HASH_PREFIX_HEX / 2;
  for (let at = width; at < bytes.length; at += width) {
    if (bytes.slice(at - width, at) >= bytes.slice(at, at + width)) return false;
  }
  return true;
}
function packedHashBytesHas(bytes, hexPrefix) {
  if (!bytes || !/^[a-f0-9]{32}$/.test(hexPrefix)) return false;
  const key = packedHashBytes(hexPrefix);
  const width = DOWNLOAD_HASH_PREFIX_HEX / 2;
  let lo = 0;
  let hi = bytes.length / width - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const value = bytes.slice(mid * width, mid * width + width);
    if (value === key) return true;
    if (value < key) lo = mid + 1;
    else hi = mid - 1;
  }
  return false;
}

async function packDownloadThreatFeed(kind, text, limit) {
  const cap = kind === 'sha256' ? 0 : (limit || DOWNLOAD_THREAT_FEED_CAPS[kind] || 0);
  const lines = String(text || '').split(/\r?\n/);
  if (kind === 'sha256') {
    const seen = new Set();
    for (const line of lines) {
      const hash = line.trim().toLowerCase();
      if (/^[a-f0-9]{64}$/.test(hash)) seen.add(hash.slice(0, DOWNLOAD_HASH_PREFIX_HEX));
      if (cap && seen.size >= cap) break;
    }
    return { packed: packSortedHex(seen), count: seen.size, truncated: false };
  }
  const keys = new Set();
  for (const line of lines) {
    const key = downloadPayloadUrlEntryKey(line);
    if (key) keys.add(key);
    if (keys.size >= cap) break;
  }
  const fingerprints = [];
  const list = [...keys];
  for (let i = 0; i < list.length; i += 256) {
    fingerprints.push(...await Promise.all(list.slice(i, i + 256).map(downloadUrlKeyFingerprint)));
  }
  const packed = packSortedHex(fingerprints);
  const dirDepths = [...new Set(list.map(downloadPayloadUrlDirDepth).filter(Boolean))].sort((a, b) => a - b);
  return { packed, count: packed.length / DOWNLOAD_URL_KEY_HEX, truncated: keys.size >= cap, dirDepths };
}

function readDownloadThreatFeedStore(stored) {
  // Version 1 hashes came from the combined feed and may contain OTX inputs.
  let hashes = '';
  if (stored && stored.version === 2 && packedHexValid(stored.sha256Prefixes, DOWNLOAD_HASH_PREFIX_HEX)) {
    hashes = packedHashBytes(stored.sha256Prefixes);
  } else if (stored && stored.version === 3 && typeof stored.sha256Bytes === 'string') {
    try {
      const decoded = atob(stored.sha256Bytes);
      if (btoa(decoded) === stored.sha256Bytes && packedHashBytesValid(decoded)) hashes = decoded;
    } catch (_) {}
  }
  const urls = packedHexValid(stored && stored.payloadUrlKeys, DOWNLOAD_URL_KEY_HEX) ? stored.payloadUrlKeys : '';
  const depths = stored && stored.payloadUrlDirDepths;
  const urlDirDepths = Array.isArray(depths) && depths.length <= DOWNLOAD_URL_KEY_MAX_CHARS
    && depths.every((d) => Number.isInteger(d) && d >= 2 && d <= DOWNLOAD_URL_KEY_MAX_CHARS) ? depths : null;
  return {
    hashes,
    hashCount: hashes.length / (DOWNLOAD_HASH_PREFIX_HEX / 2),
    urls,
    urlCount: urls.length / DOWNLOAD_URL_KEY_HEX,
    urlDirDepths,
    updatedAt: Number(stored && stored.updatedAt) || 0,
  };
}
let downloadThreatFeedCache = null;
function resetDownloadThreatFeedCache() {
  downloadThreatFeedCache = null;
}
function downloadThreatFeeds() {
  if (!downloadThreatFeedCache) {
    const pending = (async () => {
      try {
        const x = await localGetStrict(DOWNLOAD_THREAT_FEED_KEY);
        return readDownloadThreatFeedStore(x && x[DOWNLOAD_THREAT_FEED_KEY]);
      } catch (_) {
        if (downloadThreatFeedCache === pending) downloadThreatFeedCache = null;
        return readDownloadThreatFeedStore(null);
      }
    })();
    downloadThreatFeedCache = pending;
  }
  return downloadThreatFeedCache;
}

/* source: 'bundled' or 'stored' for MALWARE_HASHES, 'feed' for the downloaded hash feed. */
async function knownMalwareHash(sha256) {
  const hash = String(sha256 || '').trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(hash)) return { hit: false, diagnostic: false, source: '' };
  await malwareHashesReady;
  if (MALWARE_HASHES.has(hash)) {
    return { hit: true, diagnostic: hash === EICAR_SHA256, source: MALWARE_HASH_SOURCES.stored.has(hash) ? 'stored' : 'bundled' };
  }
  const feeds = await downloadThreatFeeds();
  if (packedHashBytesHas(feeds.hashes, hash.slice(0, DOWNLOAD_HASH_PREFIX_HEX))) {
    return { hit: true, diagnostic: false, source: 'feed' };
  }
  return { hit: false, diagnostic: false, source: '' };
}
async function malwareHashCoverage() {
  await malwareHashesReady;
  const local = localMalwareHashCoverage();
  const feeds = await downloadThreatFeeds();
  const signatureCount = local.signatureCount + feeds.hashCount;
  return {
    listSize: local.listSize + feeds.hashCount,
    signatureCount,
    feedSignatureCount: feeds.hashCount,
    diagnosticOnly: local.listSize > 0 && signatureCount === 0,
  };
}

async function listedPayloadUrl(urls) {
  const feeds = await downloadThreatFeeds();
  if (!feeds.urlCount) return '';
  const seen = new Set();
  for (const url of urls || []) {
    for (const key of downloadPayloadUrlCandidates(url, feeds.urlDirDepths)) {
      if (seen.has(key)) continue;
      seen.add(key);
      if (packedHexHas(feeds.urls, DOWNLOAD_URL_KEY_HEX, await downloadUrlKeyFingerprint(key))) return String(url);
    }
  }
  return '';
}

/* URLhaus also lists official installers that attack scripts fetch, so an address match pauses
   the download as Dangerous with a deliberate override; deleting it takes a content-hash match. */
async function enrichDownloadWithPayloadUrlFeed(rep, urls) {
  if (!rep) return rep;
  let matched = '';
  try { matched = await listedPayloadUrl(urls); } catch (_) { return rep; }
  if (!matched) return rep;
  rep.score = Math.max(Number(rep.score) || 0, LISTED_PAYLOAD_URL_MIN_SCORE);
  /* Publisher trust is about the host; this names the file, and it also unlocks the hash check. */
  rep.trustedEligible = false;
  rep.trustAllowed = false;
  rep.payloadUrlListed = true;
  rep.reasons.unshift('URLhaus lists this exact download address as a malware source');
  appendExternalReputation(rep, { provider: 'URLhaus payload feed', ok: true, hit: true, url: downloadDisplayUrl(matched) });
  return applyDownloadMeta(rep);
}

async function updateDownloadThreatFeeds(reason) {
  if (privateDownloadContext()) return { ok: false, skipped: true, error: 'Private-window worker' };
  const cfgStore = await localGet('wardenone_config');
  const cfg = (cfgStore && cfgStore.wardenone_config) || {};
  const forced = /^(manual|settings-change|master-reenable|repair)$/i.test(String(reason || ''));
  if (cfg.enabled === false || cfg.downloadReputation === false) return { ok: false, skipped: true, error: 'Download Guard is off' };
  if (cfg.autoUpdateLists === false && !forced) return { ok: false, skipped: true, error: 'Auto-update is disabled' };

  const held = await localGet([DOWNLOAD_THREAT_FEED_KEY, DOWNLOAD_THREAT_META_KEY]);
  const stored = held && held[DOWNLOAD_THREAT_FEED_KEY];
  const previous = readDownloadThreatFeedStore(stored);
  const previousMeta = (held && held[DOWNLOAD_THREAT_META_KEY]) || {};
  const packed = { sha256: previous.hashes, 'payload-urls': previous.urls };
  let urlDirDepths = previous.urlDirDepths;
  const hashSourceCount = DOWNLOAD_THREAT_LIST_SOURCES.filter((source) => source.kind === 'sha256').length;
  const results = await Promise.all(DOWNLOAD_THREAT_LIST_SOURCES.map(async (source) => {
    const fetched = await fetchValidatedRemoteListText(source.url, false, LIST_FETCH_TIMEOUT_MS);
    if (!fetched || !fetched.ok) {
      return { url: source.url, kind: source.kind, ok: false, error: String((fetched && fetched.error) || 'failed').slice(0, 180) };
    }
    const next = await packDownloadThreatFeed(source.kind, fetched.text);
    const priorCount = Number(previousMeta.sourceCounts?.[source.url]);
    const before = source.kind === 'sha256'
      ? Number.isSafeInteger(priorCount) && priorCount >= 0 ? priorCount : 0
      : previous.urlCount;
    /* A feed that suddenly loses most of its entries is far likelier broken than cleaned up. */
    if (!next.count || (before >= DOWNLOAD_THREAT_DRIFT.minBaseline && next.count < before * DOWNLOAD_THREAT_DRIFT.dropRatio)) {
      return { url: source.url, kind: source.kind, ok: false, rejected: true,
        error: 'Kept the previous copy: ' + next.count + ' usable entries, down from ' + before };
    }
    return { url: source.url, kind: source.kind, ok: true, count: next.count, truncated: next.truncated, next };
  }));

  const hashResults = results.filter((result) => result.kind === 'sha256');
  const hashesReady = hashResults.length === hashSourceCount && hashResults.every((result) => result.ok);
  const hashesAvailable = hashesReady || (!previous.hashCount && hashResults.some((result) => result.ok));
  if (hashesAvailable) {
    const prefixes = [];
    for (const result of hashResults) {
      if (!result.ok) continue;
      for (let at = 0; at < result.next.packed.length; at += DOWNLOAD_HASH_PREFIX_HEX) {
        prefixes.push(result.next.packed.slice(at, at + DOWNLOAD_HASH_PREFIX_HEX));
      }
    }
    packed.sha256 = packedHashBytes(packSortedHex(prefixes));
  }
  const urlResult = results.find((result) => result.kind === 'payload-urls' && result.ok);
  if (urlResult) {
    packed['payload-urls'] = urlResult.next.packed;
    urlDirDepths = urlResult.next.dirDepths;
  }

  const now = Date.now();
  const succeeded = results.filter((r) => r.ok).length;
  const updated = hashesAvailable || !!urlResult;
  const store = { version: 3, updatedAt: updated ? now : previous.updatedAt, sha256Bytes: btoa(packed.sha256),
    payloadUrlKeys: packed['payload-urls'], payloadUrlDirDepths: urlDirDepths };
  const meta = {
    version: 3,
    updated: updated ? now : (stored && stored.version >= 2 ? previousMeta.updated || 0 : 0),
    lastAttempt: now,
    reason: String(reason || ''),
    counts: { fileHashes: packed.sha256.length / (DOWNLOAD_HASH_PREFIX_HEX / 2), payloadUrls: store.payloadUrlKeys.length / DOWNLOAD_URL_KEY_HEX },
    sourceCounts: hashesAvailable ? Object.fromEntries(hashResults.filter((result) => result.ok).map((result) => [result.url, result.count]))
      : stored && stored.version >= 2 ? previousMeta.sourceCounts || {} : {},
    sources: { total: results.length, succeeded, failed: results.length - succeeded },
    failures: results.filter((r) => !r.ok).map((r) => ({ url: r.url, error: r.error, rejected: !!r.rejected })),
  };
  await localSet(updated || !stored || stored.version !== 3
    ? { [DOWNLOAD_THREAT_FEED_KEY]: store, [DOWNLOAD_THREAT_META_KEY]: meta }
    : { [DOWNLOAD_THREAT_META_KEY]: meta });
  resetDownloadThreatFeedCache();
  if (updated && typeof pruneStorageIfNeeded === 'function') await pruneStorageIfNeeded('download-threat-feeds').catch(() => {});
  return { ok: updated, meta };
}

async function attachDownloadThreatFeedUpdate(result, reason) {
  try {
    return Object.assign({}, result || {}, { downloadFeeds: await updateDownloadThreatFeeds(reason) });
  } catch (e) {
    return Object.assign({}, result || {}, { downloadFeeds: { ok: false, error: String(e).slice(0, 180) } });
  }
}

// Compute (and cache on rep.fileHash) the SHA-256 URL re-fetch fingerprint exactly once,
// so the local and VirusTotal hash checks share one fetch+hash instead of doing it twice.
async function ensureDownloadHash(rep, url) {
  if (rep && rep.fileHash && /^[a-f0-9]{64}$/.test(String(rep.fileHash.sha256 || ''))) {
    const source = rep.fileHash.hashSource || downloadHashSourceMeta(rep.fileHash, rep.fileHash.source || rep.fileHash.sourceKind);
    return {
      ok: true,
      sha256: String(rep.fileHash.sha256).toLowerCase(),
      bytes: rep.fileHash.bytes || 0,
      source,
      exactFile: source.exactFile === true || rep.fileHash.exactFile === true,
    };
  }
  const fetched = await fetchBytesForHash(url, DOWNLOAD_HASH_MAX_BYTES);
  if (!fetched || !fetched.ok) {
    const reason = (fetched && fetched.reason) || 'Hash check could not run';
    return {
      ok: false,
      skipped: !!(fetched && fetched.skipped),
      reason,
      bytes: (fetched && fetched.bytes) || 0,
      source: downloadHashSourceMeta(fetched, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason }),
      exactFile: false,
    };
  }
  // ok was true, but that only promises the fetch succeeded -- not that a body came with it. Caught
  // here so it lands on the ordinary download-metadata error path with a reason a person can act on,
  // instead of reaching digest() and surfacing as "Hash computation failed", which reads like a
  // crypto fault in WardenOne rather than a missing response body.
  if (!(fetched.bytes instanceof ArrayBuffer)
    && !(typeof ArrayBuffer.isView === 'function' && ArrayBuffer.isView(fetched.bytes))) {
    const reason = 'Hash check could not run: no file data was returned';
    return {
      ok: false,
      reason,
      bytes: 0,
      source: downloadHashSourceMeta(fetched, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason }),
      exactFile: false,
    };
  }
  try {
    const sha256 = await sha256Hex(fetched.bytes);
    const byteLength = fetched.byteLength || (fetched.bytes && fetched.bytes.byteLength) || 0;
    const hashSource = downloadHashSourceMeta(fetched, DOWNLOAD_HASH_SOURCE.URL_REFETCH);
    if (rep) rep.fileHash = {
      sha256,
      bytes: byteLength,
      source: hashSource.kind,
      sourceKind: hashSource.kind,
      exactFile: hashSource.exactFile,
      hashSource,
    };
    return { ok: true, sha256, bytes: byteLength, source: hashSource, exactFile: hashSource.exactFile };
  } catch (e) {
    const reason = 'Hash computation failed';
    return {
      ok: false,
      reason,
      error: String(e).slice(0, 120),
      source: downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason }),
      exactFile: false,
    };
  }
}

/* Hash eligibility is independent of whether the scan interrupts the download. */
async function enrichDownloadWithLocalHash(rep, url, filename, cfg) {
  if (!cfg || cfg.downloadHashCheck === false) return rep;
  if (!shouldCheckVirusTotalHash(rep, url, filename)) return rep;
  const coverage = await malwareHashCoverage();
  if (!coverage.signatureCount) {
    if (!rep.hashReputation) rep.hashReputation = {
      provider: 'Local SHA-256 list', local: true, checked: false, skipped: true, ...coverage,
      reason: coverage.diagnosticOnly
        ? 'Local hash check skipped: the bundled list contains only the EICAR test signature and the malware hash feed is not loaded yet. No re-fetch was made for this local check.'
        : 'Local hash check skipped: no malware signatures are loaded.',
    };
    return rep;
  }
  const h = await ensureDownloadHash(rep, url);
  if (!h.ok) {
    if (!rep.hashReputation) {
      rep.hashReputation = {
        provider: 'Local malware-hash set',
        checked: false,
        local: true,
        skipped: !!h.skipped,
        reason: h.reason || 'Hash check could not run',
        source: h.source || downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: h.reason || 'Hash check could not run' }),
        exactFile: false,
        maxBytes: DOWNLOAD_HASH_MAX_BYTES,
      };
    }
    return rep;
  }
  const known = await knownMalwareHash(h.sha256);
  if (known.diagnostic) {
    rep.hashReputation = { provider: 'Local SHA-256 list', checked: true, ok: true,
      hit: true, local: true, diagnostic: true, sha256: h.sha256,
      source: h.source || null, exactFile: h.exactFile === true, ...coverage };
    return rep;
  }
  if (known.hit) {
    rep.score += 100;
    rep.blocklisted = true;
    rep.critical = true;
    rep.trustAllowed = false;
    rep.reasons.unshift(known.source === 'feed'
      ? 'URL-content hash matches a known-malware sample (downloaded hash feed)'
      : 'URL-content hash matches a known-malware signature (local database)');
    appendExternalReputation(rep, { provider: 'Local malware-hash set', sha256: h.sha256, hit: true, matchedList: known.source, source: h.source || null, exactFile: h.exactFile === true });
    rep.hashReputation = { provider: 'Local malware-hash set', checked: true, ok: true, hit: true, local: true, matchedList: known.source, sha256: h.sha256, source: h.source || null, exactFile: h.exactFile === true };
    return applyDownloadMeta(rep);
  }
  if (!rep.hashReputation) {
    rep.hashReputation = { provider: 'Local malware-hash set', checked: true, ok: true, hit: false, local: true, sha256: h.sha256, source: h.source || null, exactFile: h.exactFile === true };
  }
  return rep;
}

async function checkVirusTotalFileHash(sha256, apiKey) {
  const key = String(apiKey || '').trim();
  const id = String(sha256 || '').trim().toLowerCase();
  if (!key || !/^[a-f0-9]{64}$/.test(id)) return null;
  try {
    const res = await fetchJsonWithTimeout('https://www.virustotal.com/api/v3/files/' + encodeURIComponent(id), {
      method: 'GET',
      headers: { 'x-apikey': key, 'Accept': 'application/json' },
    });
    if (res.status === 404) return { provider: 'VirusTotal file hash', ok: true, hit: false, notFound: true, sha256: id };
    if (!res.ok) return { provider: 'VirusTotal file hash', ok: false, status: res.status, sha256: id };
    const attrs = res.data && res.data.data && res.data.data.attributes;
    const stats = (attrs && attrs.last_analysis_stats) || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    return {
      provider: 'VirusTotal file hash',
      ok: true,
      hit: malicious > 0 || suspicious > 0,
      sha256: String((attrs && attrs.sha256) || id),
      stats: {
        malicious,
        suspicious,
        harmless: Number(stats.harmless || 0),
        undetected: Number(stats.undetected || 0),
      },
      reputation: Number((attrs && attrs.reputation) || 0),
      meaningfulName: String((attrs && attrs.meaningful_name) || '').slice(0, 120),
      typeDescription: String((attrs && attrs.type_description) || '').slice(0, 80),
      lastAnalysisDate: Number((attrs && attrs.last_analysis_date) || 0),
      timesSubmitted: Number((attrs && attrs.times_submitted) || 0),
    };
  } catch (e) {
    return { provider: 'VirusTotal file hash', ok: false, error: String(e).slice(0, 120), sha256: id };
  }
}

async function enrichDownloadWithVirusTotalHash(rep, url, filename, cfg) {
  const key = String((cfg && cfg.downloadVirusTotalKey) || '').trim();
  if (!cfg || cfg.downloadVirusTotalHash !== true || !key) return rep;
  if (!shouldCheckVirusTotalHash(rep, url, filename)) return rep;

  // Shares the single re-fetch+hash with the local malware-hash check (ensureDownloadHash
  // returns the already-computed rep.fileHash if the local check ran first).
  const h = await ensureDownloadHash(rep, url);
  if (!h.ok) {
    rep.hashReputation = {
      provider: 'VirusTotal file hash',
      checked: false,
      skipped: !!h.skipped,
      reason: h.reason || 'Hash check could not run',
      source: h.source || downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: h.reason || 'Hash check could not run' }),
      exactFile: false,
      bytes: h.bytes || 0,
      maxBytes: DOWNLOAD_HASH_MAX_BYTES,
    };
    return rep;
  }

  try {
    const sha256 = h.sha256;
    const vt = await checkVirusTotalFileHash(sha256, key);
    if (!vt) return rep;

    rep.hashReputation = {
      provider: 'VirusTotal file hash',
      checked: true,
      ok: !!vt.ok,
      hit: !!vt.hit,
      notFound: !!vt.notFound,
      sha256,
      source: h.source || null,
      exactFile: h.exactFile === true,
      stats: vt.stats || null,
      reputation: vt.reputation || 0,
      meaningfulName: vt.meaningfulName || '',
      typeDescription: vt.typeDescription || '',
      lastAnalysisDate: vt.lastAnalysisDate || 0,
      timesSubmitted: vt.timesSubmitted || 0,
      status: vt.status || 0,
      error: vt.error || '',
    };

    if (!vt.ok || !vt.hit) return rep;

    const stats = vt.stats || {};
    const malicious = Number(stats.malicious || 0);
    const suspicious = Number(stats.suspicious || 0);
    rep.trustAllowed = false;
    appendExternalReputation(rep, {
      provider: 'VirusTotal file hash',
      sha256,
      source: h.source || null,
      exactFile: h.exactFile === true,
      stats: vt.stats,
      reputation: vt.reputation,
      meaningfulName: vt.meaningfulName || '',
      typeDescription: vt.typeDescription || '',
    });

    if (malicious >= 3) {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('VirusTotal URL-content hash is known malicious (' + malicious + ' detections)');
    } else if (malicious >= 1 || suspicious >= 2) {
      if (malicious >= 1) rep.reviewEvidence.malwareDetection = true;
      rep.score += 10;
      rep.reasons.unshift('VirusTotal URL-content hash has ' + malicious + ' malicious / ' + suspicious + ' suspicious detections');
    } else if (suspicious === 1) {
      rep.score += 3;
      rep.reasons.unshift('VirusTotal URL-content hash has one suspicious detection');
    }

    return applyDownloadMeta(rep);
  } catch (e) {
    rep.hashReputation = {
      provider: 'VirusTotal file hash',
      checked: false,
      reason: 'Hash check could not run',
      source: downloadHashSourceMeta(null, DOWNLOAD_HASH_SOURCE.NOT_AVAILABLE, { reason: 'Hash check could not run' }),
      exactFile: false,
      error: String(e).slice(0, 120),
      maxBytes: DOWNLOAD_HASH_MAX_BYTES,
    };
    return rep;
  }
}

// Serialize whole-object writes so concurrent scans cannot lose pending or handled records (M25).
// The fallback supports tests that load this module without background.js.
function withDownloadStore(name, task) {
  return typeof serializeSubsystem === 'function' ? serializeSubsystem(name, task) : task();
}

async function rememberPendingDownload(review) {
  PENDING_DOWNLOADS[review.id] = review;
  return withDownloadStore(DOWNLOAD_PENDING_KEY, async () => {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
    store[review.id] = review;
    /* An expired review is dropped as this one is written, not left for the next sweep. */
    const cutoff = Date.now() - DOWNLOAD_REVIEW_TTL_MS;
    for (const id of Object.keys(store)) {
      const r = store[id];
      if (id !== review.id && (!r || !r.createdAt || r.createdAt < cutoff)) { delete store[id]; delete PENDING_DOWNLOADS[id]; }
    }
    const entries = Object.entries(store).sort((a, b) => (b[1].createdAt || 0) - (a[1].createdAt || 0));
    while (entries.length > 25) {
      const old = entries.pop();
      if (old) delete store[old[0]];
    }
    await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: store });
  });
}

async function getPendingDownload(id) {
  const key = String(id || '');
  let review = PENDING_DOWNLOADS[key];
  if (!review) {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    review = ((x && x[DOWNLOAD_PENDING_KEY]) || {})[key];
    if (review) PENDING_DOWNLOADS[key] = review;
  }
  if (review && review.removed) applyDownloadRemovalResult(review, review.removed);
  return review || null;
}

async function removePendingDownload(id) {
  const key = String(id || '');
  delete PENDING_DOWNLOADS[key];
  return withDownloadStore(DOWNLOAD_PENDING_KEY, async () => {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
    delete store[key];
    await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: store });
  });
}

// The read half, unqueued on purpose: callers that already hold the lane use this one, because a
// task that waited on its own lane would wait forever.
async function readHandledDownloads() {
  const x = await downloadStateGet(DOWNLOAD_HANDLED_KEY);
  const store = (x && x[DOWNLOAD_HANDLED_KEY] && typeof x[DOWNLOAD_HANDLED_KEY] === 'object') ? x[DOWNLOAD_HANDLED_KEY] : {};
  const now = Date.now();
  let changed = false;
  Object.keys(store).forEach((id) => {
    if (!store[id] || !store[id].at || (now - store[id].at) > DOWNLOAD_HANDLED_TTL_MS) {
      delete store[id];
      changed = true;
    }
  });
  return { store, changed };
}

async function getHandledDownloads() {
  return withDownloadStore(DOWNLOAD_HANDLED_KEY, async () => {
    const { store, changed } = await readHandledDownloads();
    if (changed) await downloadStateSet({ [DOWNLOAD_HANDLED_KEY]: store });
    return store;
  });
}

async function isDownloadHandled(id) {
  const key = String(id || '');
  if (!key) return true;
  const store = await getHandledDownloads();
  return !!store[key];
}

async function rememberHandledDownload(id, decision) {
  const key = String(id || '');
  if (!key) return;
  return withDownloadStore(DOWNLOAD_HANDLED_KEY, async () => {
    const { store } = await readHandledDownloads();
    store[key] = { at: Date.now(), decision: String(decision || 'handled').slice(0, 40) };
    const entries = Object.entries(store).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
    while (entries.length > 250) {
      const old = entries.pop();
      if (old) delete store[old[0]];
    }
    await downloadStateSet({ [DOWNLOAD_HANDLED_KEY]: store });
  });
}

function reviewUrlForId(id) {
  return chrome.runtime.getURL('download-review.html?id=' + encodeURIComponent(String(id || '')));
}

function reviewIdFromUrl(url) {
  try {
    const u = new URL(url || '');
    if (!/\/download-review\.html$/i.test(u.pathname)) return '';
    return u.searchParams.get('id') || '';
  } catch (_) {
    return '';
  }
}

async function findDownloadReviewTabs(id) {
  const wanted = String(id || '');
  const tabs = await tabsQuery({});
  return tabs.filter((tab) => {
    const rid = reviewIdFromUrl(tab.url || tab.pendingUrl || '');
    return rid && (!wanted || rid === wanted);
  });
}

async function closeDownloadReviewTabs(id) {
  const tabs = await findDownloadReviewTabs(id);
  const ids = tabs.map((tab) => tab.id).filter((tabId) => tabId != null);
  if (ids.length) await tabsRemove(ids);
}

/* Reviews normally lapse when a download moves on. Removal notices, including failures, stay
   until answered so cleanup cannot hide an unresolved intervention. */
function downloadReviewSuperseded(review, item) {
  if (review && (review.removed || review.autoBlocked || review.interventionFailed)) return false;
  if (!item || item.state === 'interrupted') return true;
  return item.state === 'complete' && !!(review && review.paused);
}

async function cleanupDownloadReviews(closeTabs) {
  try {
    // The scan reads the store, decides what is stale, and writes the survivors back -- with
    // awaits on downloads.search in between, which is a long time for a concurrent add to be lost
    // in. Queued with the adds and removes so it cannot drop a review created while it was looking.
    const { store, activeIds } = await withDownloadStore(DOWNLOAD_PENDING_KEY, async () => {
      const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
      const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
      const now = Date.now();
      const activeIds = new Set();
      let changed = false;

      for (const id of Object.keys(store)) {
        const review = store[id] || {};
        let stale = !review.createdAt || (now - review.createdAt) > DOWNLOAD_REVIEW_TTL_MS;
        if (!stale && review.downloadId != null) {
          const items = await downloadSearch({ id: Number(review.downloadId) });
          if (items !== null && downloadReviewSuperseded(review, items[0])) stale = true;
        }
        if (stale) {
          delete store[id];
          delete PENDING_DOWNLOADS[id];
          changed = true;
        } else {
          PENDING_DOWNLOADS[id] = review;
          activeIds.add(String(id));
        }
      }

      if (changed) await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: store });
      return { store, activeIds };
    });
    void store;
    await getHandledDownloads();

    if (closeTabs) {
      const tabs = await findDownloadReviewTabs('');
      const staleTabIds = tabs
        .filter((tab) => !activeIds.has(reviewIdFromUrl(tab.url || tab.pendingUrl || '')))
        .map((tab) => tab.id)
        .filter((tabId) => tabId != null);
      if (staleTabIds.length) await tabsRemove(staleTabIds);
    }
  } catch (_) {}
}

// On a NEW browser session, clear out any pending reviews left over from before so
// restored downloads don't re-pop. We mark each leftover download "handled" (so a
// restart-triggered re-scan won't surface it again) and wipe the pending store +
// any panel still showing. The download itself stays paused in Chrome for the user
// to resume/cancel -- we never silently continue a risky download.
async function quiesceDownloadReviewsForNewSession() {
  try {
    const x = await downloadStateGet(DOWNLOAD_PENDING_KEY);
    const store = (x && x[DOWNLOAD_PENDING_KEY] && typeof x[DOWNLOAD_PENDING_KEY] === 'object') ? x[DOWNLOAD_PENDING_KEY] : {};
    for (const id of Object.keys(store)) {
      const review = store[id] || {};
      await rememberHandledDownload(review.downloadId != null ? review.downloadId : id, 'previous-session');
    }
    for (const k of Object.keys(PENDING_DOWNLOADS)) delete PENDING_DOWNLOADS[k];
    await downloadStateSet({ [DOWNLOAD_PENDING_KEY]: {} });
    await dismissDownloadReviewPanels();
  } catch (_) {}
}

function downloadApiCall(method, id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads[method](Number(id), () => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

// chrome.downloads.erase takes a QUERY object ({id}), not a bare id, so it can't go
// through downloadApiCall (which passes Number(id)).
function downloadErase(id) {
  return new Promise((resolve) => {
    try {
      chrome.downloads.erase({ id: Number(id) }, () => {
        const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
        resolve({ ok: !err, error: err || '' });
      });
    } catch (e) {
      resolve({ ok: false, error: String(e) });
    }
  });
}

/* Confirm state: a successful cancel callback may mean the file already completed.
   Neither interruption nor exists:false proves partial cleanup; retain the entry until deletion succeeds. */
async function hardRemoveDownload(id) {
  const out = { cancelled: false, removedFile: false, erased: false, state: '', paused: false, verificationFailed: false };
  const cancel = await downloadApiCall('cancel', id);
  try { const r = await downloadApiCall('removeFile', id); out.removedFile = !!(r && r.ok); } catch (_) {}
  try {
    const items = await downloadSearch({ id: Number(id) }, true);
    const item = items && items[0];
    out.verificationFailed = !item;
    if (item) {
      out.state = item.state;
      out.paused = item.state === 'in_progress' && !!item.paused;
      out.cancelled = !!(cancel.ok && item.state === 'interrupted');
    }
  } catch (_) {
    out.verificationFailed = true;
  }
  if (out.removedFile) {
    try { const e = await downloadErase(id); out.erased = !!(e && e.ok); } catch (_) {}
  }
  return out;
}

function applyDownloadRemovalResult(review, removed) {
  review.removed = removed;
  const deleted = removed.removedFile === true;
  const stopped = removed.cancelled === true || deleted;
  review.cleanupPending = !deleted;
  review.interventionFailed = review.cleanupPending;
  if (review.blockRequired === true || (review.blockRequired !== false && review.grade === 'F')) review.autoBlocked = !review.cleanupPending;
  review.finishedBeforeStop = review.finishedBeforeStop || deleted || removed.state === 'complete';
  review.paused = !stopped && !review.finishedBeforeStop && removed.paused;
  review.recommendation = review.cleanupPending ? 'Retry file removal, or check Chrome Downloads and delete the file without opening it.'
    : 'Do not download this file again.';
}

async function recordAutomaticDownloadRemoval(review) {
  await rememberPendingDownload(review);
  logDownloadDecision(review, review.cleanupPending
    ? (review.removed.cancelled === true ? 'cancelled; cleanup unconfirmed' : 'automatic block failed')
    : (review.finishedBeforeStop ? 'deleted after it finished' : 'blocked before it finished'));
  await rememberHandledDownload(review.downloadId, review.cleanupPending ? 'auto-block failed' : 'auto-blocked');
}

async function openDownloadReview(review) {
  // Keep download details inside extension-owned UI. The web page never receives
  // the review payload, so it cannot read, hide, or tamper with the warning.
  try { await rememberPendingDownload(review); } catch (_) {}
  const url = reviewUrlForId(review && review.id);

  // Focus an existing review page for this download instead of opening duplicates.
  try {
    const tabs = await findDownloadReviewTabs(review && review.id);
    const tab = tabs && tabs[0];
    if (tab && tab.id != null) {
      if (tab.windowId != null) await windowsUpdate(tab.windowId, { focused: true });
      await tabsUpdate(tab.id, { active: true });
      try {
        chrome.runtime.sendMessage({ kind: 'download-review-updated', id: review.id, review }, () => {
          void chrome.runtime.lastError;
        });
      } catch (_) {}
      return { ok: true, reviewPage: true, existing: true };
    }
  } catch (_) {}

  try {
    const win = await windowsCreate({
      url,
      type: 'popup',
      width: 520,
      height: 720,
      focused: true,
    });
    if (win && win.ok) return { ok: true, reviewPage: true, window: true };
  } catch (_) {}

  try {
    const tab = await tabsCreate({ url, active: true });
    if (tab && tab.ok) return { ok: true, reviewPage: true, tab: true };
  } catch (_) {}

  // Last resort: a system notification so the user still knows Chrome could not
  // open the extension review surface. The pending review remains available.
  const canNotify = await extensionUiAllowed();
  if (canNotify) {
    try {
      await showWardenSystemNotification('wo-dl-' + review.id, {
        type: 'basic',
        iconUrl: 'icons/icon128.png',
        title: 'Download Shield: ' + (review.status || ('Grade ' + review.grade)),
        message: (review.file || 'A download') + '\n' + (review.recommendation || 'Review this download.'),
        priority: 2,
      }, 'download_review');
    } catch (_) {}
  }
  return { ok: true, notification: canNotify, silent: !canNotify };
}

// Close extension-owned review UI. Omit id to close every pending review page.
async function dismissDownloadReviewPanels(id) {
  try {
    await closeDownloadReviewTabs(id || '');
  } catch (_) {}
}

/* Persist only the redacted review URL; signed links and identifiers can be credentials (PRIV-05).
   Decisions use the Chrome download ID, which also retains the exact URL outside our review store. */
function downloadDisplayUrl(raw) {
  const text = String(raw || '');
  if (!text) return '';
  const web = /^blob:https?:/i.test(text) ? text.slice(5) : text;
  try { if (typeof safeUrlForLog === 'function') return safeUrlForLog(web); } catch (_) {}
  try { const u = new URL(web); return u.protocol + '//' + u.host; } catch (_) { return ''; }
}
try { globalThis.downloadDisplayUrl = downloadDisplayUrl; } catch (_) {}

function buildDownloadReview(item, rep, pauseResult, finishedBeforeStop) {
  const name = (item.filename || item.url || '').split(/[\\/]/).pop() || '(unknown file)';
  return {
    id: String(item.id),
    downloadId: item.id,
    file: name.slice(0, 120),
    url: downloadDisplayUrl(item.finalUrl || item.url || ''),
    source: rep.source,
    mime: item.mime || '',
    grade: rep.grade,
    status: rep.status,
    color: rep.color,
    score: rep.score,
    blockRequired: !!rep.blocklisted,
    reviewEvidence: rep.reviewEvidence,
    intentReason: rep.intentReason || '',
    intentSourceHost: rep.intentSourceHost || '',
    reasons: rep.reasons.slice(0, 8),
    recommendation: downloadRecommendation(rep.grade, finishedBeforeStop),
    trusted: !!rep.trusted,
    trustedEligible: !!rep.trustedEligible,
    trustAllowed: !!rep.trustAllowed,
    trustHost: rep.trustHost || '',
    chromeDanger: rep.chromeDanger || '',
    domainAge: rep.domainAge || null,
    redirectChain: rep.redirectChain || null,
    externalReputation: rep.externalReputation || [],
    fileHash: rep.fileHash || null,
    hashReputation: rep.hashReputation || null,
    paused: !!(pauseResult && pauseResult.ok),
    pauseError: pauseResult && pauseResult.error ? pauseResult.error : '',
    /* The whole file was already saved when WardenOne identified it, so nothing was stopped. */
    finishedBeforeStop: !!finishedBeforeStop,
    createdAt: Date.now(),
  };
}

function logDownloadCheck(item, rep) {
  queueHistory({
    type: 'download_reputation',
    detail: {
      grade: rep.grade,
      status: rep.status,
      score: rep.score,
      action: rep.action,
      reviewEvidence: rep.reviewEvidence,
      source: rep.source,
      file: ((item.filename || '').split(/[\\/]/).pop() || '').slice(0, 80),
      reasons: rep.reasons.slice(0, 4),
      trusted: !!rep.trusted,
      chromeDanger: rep.chromeDanger || '',
      domainAge: rep.domainAge || null,
      redirectChain: rep.redirectChain || null,
      externalReputation: rep.externalReputation || [],
      fileHash: rep.fileHash || null,
      hashReputation: rep.hashReputation || null,
    },
    url: item.finalUrl || item.url || rep.source,
    at: Date.now(),
  });
}

function logDownloadDecision(review, decision) {
  queueHistory({
    type: 'download_guard',
    detail: {
      grade: review.grade,
      status: review.status,
      decision,
      source: review.source,
      file: review.file,
      reasons: (review.reasons || []).slice(0, 4),
      trusted: !!review.trusted,
      chromeDanger: review.chromeDanger || '',
      domainAge: review.domainAge || null,
      redirectChain: review.redirectChain || null,
      externalReputation: review.externalReputation || [],
      fileHash: review.fileHash || null,
      hashReputation: review.hashReputation || null,
    },
    url: review.url || review.source,
    at: Date.now(),
  });
}

async function handleDownloadDecision(id, decision, sender) {
  const review = await getPendingDownload(id);
  if (!review) return { ok: false, error: 'This download review is no longer available.' };
  if (messageSenderIsTab(sender)) {
    return { ok: false, error: 'Download review decisions must come from the WardenOne review window.' };
  }
  const grade = String(review.grade || '').toUpperCase();
  if (decision === 'continue' || decision === 'keep' || decision === 'trust-continue') {
    if (review.blockRequired === true || (review.blockRequired !== false && grade === 'F')) {
      return { ok: false, error: 'Critical downloads cannot be continued through Download Shield.' };
    }
    if (decision === 'trust-continue') {
      /* The review window offers Trust on C and D; D is where a recurring work file lands. */
      if (grade !== 'C' && grade !== 'D') {
        return { ok: false, error: 'Only lower-risk review downloads can be trusted and continued.' };
      }
      if (!review.trustAllowed || !normalizeAllowlistHost(review.trustHost)) {
        return { ok: false, error: 'This source is not eligible for trusted continuation.' };
      }
    }
    let resumed = false;
    if (review.paused) {
      const res = await downloadApiCall('resume', review.downloadId);
      if (!res.ok) return { ok: false, error: res.error || 'Chrome could not resume this download.' };
      review.paused = false;
      resumed = true;
    }
    let trustedHost = '';
    if (decision === 'trust-continue') {
      let trust;
      try { trust = await addTrustedDownloadSite(review.trustHost); }
      catch (e) { trust = { ok: false, error: String(e && e.message || e) }; }
      if (!trust.ok) {
        review.trustSaveFailed = resumed || !!review.trustSaveFailed;
        try { await rememberPendingDownload(review); } catch (_) {}
        if (resumed) logDownloadDecision(review, 'continued; trust failed');
        return { ok: false, continued: review.trustSaveFailed, review,
          error: (review.trustSaveFailed ? 'Chrome resumed this download, but WardenOne could not save the trust decision. ' : '')
            + (trust.error || 'WardenOne could not save the trust decision.') };
      }
      trustedHost = trust.host;
      review.trusted = true;
    }
    const label = (decision === 'trust-continue' ? 'trusted and ' : '') + (review.finishedBeforeStop ? 'kept' : 'continued');
    logDownloadDecision(review, label);
    await removePendingDownload(id);
    await rememberHandledDownload(review.downloadId || id, label);
    dismissDownloadReviewPanels(id);
    return { ok: true, decision: label, trustedHost };
  }
  if (decision === 'cancel') {
    const removed = review.removed && review.removed.removedFile === true ? review.removed : await hardRemoveDownload(review.downloadId);
    applyDownloadRemovalResult(review, removed);
    const deleted = removed.removedFile === true;
    const label = deleted ? 'deleted' : removed.cancelled === true ? 'cancelled; cleanup unconfirmed'
      : (review.finishedBeforeStop ? 'delete failed' : 'cancel failed');
    logDownloadDecision(review, label);
    if (review.interventionFailed) {
      await rememberPendingDownload(review);
      await rememberHandledDownload(review.downloadId || id, label);
      return { ok: false, decision: label, removed, deleted, review,
        error: (removed.cancelled === true ? 'WardenOne stopped this download, but could not confirm its file data was deleted. '
          : 'WardenOne could not confirm this download was stopped or deleted. ')
          + 'Retry removal, or check Chrome Downloads and delete the file without opening it.' };
    }
    await removePendingDownload(id);
    await rememberHandledDownload(review.downloadId || id, label);
    dismissDownloadReviewPanels(id);
    return { ok: true, decision: label, removed, deleted };
  }
  return { ok: false, error: 'Unknown decision.' };
}

// All download-risk weights in one tunable table. Positive = more suspicious; the two
// *Rebate values are SUBTRACTED. Centralised so the weights can be eyeballed and tuned in
// one place instead of hunting through the scoring prose in scoreDownload(). Proven
// behaviour-equivalent to the previous inline literals by a golden old-vs-new test.
const DL_WEIGHT = {
  // chromePending is 0 on purpose. "Chrome has not finished its scan yet" is not a fact about the
  // file, and at 1 point it combined with any other single 1-point signal to cross the review line
  // -- opening a panel built on information that was still arriving. The reason line is kept, so it
  // still shows up whenever the file is being reviewed for some real cause.
  chromeKnownBad: 100, chromeReviewFile: 3, chromeReviewOther: 2, chromeReviewWeak: 1, chromePending: 0,
  blocklist: 100, executable: 3, macroDoc: 3, container: 3,
  executableInstaller: 3, archiveInstaller: 5, archive: 1,
  noExtension: 2, noExtensionBinary: 2, uncommonType: 1,
  httpInsecure: 1, unknownDomain: 1, blobRiskyFile: 2, unusualProtocol: 1,
  redirectParam: 2, obfuscatedPath: 1, lureWording: 2,
  redirectChain: 2, redirectManyDomains: 2, redirectFlaggedHop: 6, redirectBlocklistedHop: 100,
  doubleExtension: 5, hiddenChars: 5, paddingTrick: 3, versionedReleaseRebate: 1,
  mimeDisagree: 2, mimeProgramNamedDoc: 3, multipleTricks: 5,
  ipHostInstaller: 2, rawIpExecutable: 2, rawIpInsecure: 1,
  punycodeHost: 2, confusableTld: 4, throwawayTld: 2, trustedSiteRebate: 3,
  passwordArchive: 2,
};

function normalizeDownloadRedirectRisk(info) {
  if (!info || typeof info !== 'object') return null;
  const hops = Math.max(0, Number(info.hops || 0));
  const domains = Math.max(0, Number(info.domains || 0));
  if (!hops && !domains && !info.flagged && !info.blocklisted) return null;
  const matchedOn = String(info.matchedOn || '').slice(0, 40);
  const weakHostOnlyMatch = matchedOn === 'recent-host';
  return {
    hops,
    domains,
    flagged: !!info.flagged && !weakHostOnlyMatch,
    blocklisted: !!info.blocklisted && !weakHostOnlyMatch,
    abuseTld: !!info.abuseTld && !weakHostOnlyMatch,
    maxed: !!info.maxed && !weakHostOnlyMatch,
    matchedOn,
    chain: Array.isArray(info.chain) ? info.chain.slice(0, 12) : [],
    finalHost: String(info.finalHost || '').slice(0, 120),
  };
}

function downloadRedirectContext(finalUrl, referrer, item) {
  try {
    if (typeof recentRedirectChainForDownload === 'function') {
      return recentRedirectChainForDownload(finalUrl, referrer || (item && item.referrer) || '', item || null);
    }
  } catch (_) {}
  return null;
}

// Returns { grade, status, color, action, source, reasons[], score }
function scoreDownload(finalUrl, referrer, filename, mime, trustedSites, chromeDanger, redirectChain) {
  const W = DL_WEIGHT;
  const reasons = [];
  let host = '';
  // A blob: URL carries its origin inside itself -- blob:https://vault.bitwarden.com/<uuid>. Parsed
  // naively the hostname comes out empty, so every in-page export (a password vault backup, a
  // spreadsheet a web app generated) was charged unknownDomain, shown as "(unknown)" in the review
  // panel, and could never match the publisher list or the user's own trusted sites.
  try {
    const raw = finalUrl || referrer || '';
    host = new URL(/^blob:https?:/i.test(raw) ? raw.slice(5) : raw).hostname;
  } catch (_) {}
  const rd = regDomainBg(host);
  const name = (filename || '').split(/[\\/]/).pop() || '';
  const isDangerous = DANGEROUS_EXT.test(name);
  const isArchive = ARCHIVE_EXT.test(name);
  const isContainer = CONTAINER_EXT.test(name);
  const isMacro = MACRO_DOC_EXT.test(name);
  const onBlocklist = rd && (BLOCKED_DOMAINS.has(rd) || BLOCKED_DOMAINS.has(host));
  const httpInsecure = /^http:\/\//i.test(finalUrl || '');
  // Exclude LAN downloads from public-host penalties. Filename disguises retain their score and critical status.
  const privateHost = !!(host && isLocalOrPrivateHost(host));
  let lanNoise = 0;
  const installerName = INSTALLER_HINT.test(name);
  const lureName = LURE_HINT.test(name);
  const trustMatch = trustedDownloadMatch(host, trustedSites);
  const danger = String(chromeDanger || '').toLowerCase();
  const chromeKnownBad = CHROME_DANGER_STRONG.has(danger);
  const chromeReview = CHROME_DANGER_MEDIUM.has(danger);
  const chromePending = CHROME_DANGER_PENDING.has(danger);
  const finalUrlText = String(finalUrl || '');
  let urlPathQuery = finalUrlText;
  try {
    const u = new URL(finalUrlText);
    urlPathQuery = (u.pathname || '') + ' ' + (u.search || '') + ' ' + (u.hash || '');
  } catch (_) {}

  let score = 0;
  const reviewEvidence = {
    activeContent: isDangerous || isArchive || isContainer || isMacro,
    browserWarning: danger === 'file' || danger === 'sensitivecontentwarning',
    lure: false,
    publicIp: false,
    obfuscatedUrl: false,
    hiddenProgram: false,
    flaggedRedirect: false,
    insecure: httpInsecure && !privateHost,
    lookalike: /(^|\.)xn--/i.test(host),
  };
  if (chromeKnownBad) {
    score += W.chromeKnownBad;
    if (danger === 'url') reasons.unshift('Chrome says this download URL is known malicious');
    else if (danger === 'content') reasons.unshift('Chrome says this file is known malicious');
    else if (danger === 'host') reasons.unshift('Chrome says this host distributes malicious binaries');
    else if (danger === 'unwanted') reasons.unshift('Chrome says this download is potentially unwanted or unsafe');
    else reasons.unshift('Chrome flagged this download as dangerous');
  } else if (chromeReview) {
    score += danger === 'file' ? W.chromeReviewFile
      : (CHROME_DANGER_WEAK.has(danger) ? W.chromeReviewWeak : W.chromeReviewOther);
    if (danger === 'file') reasons.push('Chrome says the filename is suspicious');
    else if (danger === 'uncommon') reasons.push('Chrome says this download is uncommon');
    else if (danger === 'passwordprotected') reasons.push('Chrome says this file is password-protected');
    else if (danger === 'blockedtoolarge') reasons.push('Chrome says the file was too large for full scanning');
    else if (danger === 'sensitivecontentwarning') reasons.push('Chrome raised a sensitive-content warning');
    else reasons.push('Chrome could not fully complete its download safety scan');
  } else if (chromePending) {
    score += W.chromePending;
    reasons.push('Chrome safety scanning is still pending');
  }
  if (onBlocklist) { score += W.blocklist; reasons.push('Source is on a known malware/phishing blocklist'); }
  if (isDangerous) { score += W.executable; reasons.push('This is a program, not a document'); }
  if (isMacro) { score += W.macroDoc; reasons.push('Office file that can contain macros'); }
  if (isContainer) { score += W.container; reasons.push('Disk-image file (often used to smuggle malware past scanners)'); }
  if (isDangerous && lureName) { score += W.executableInstaller; reasons.push('Name suggests a crack, keygen or pirated installer'); }
  if (isArchive && lureName) { score += W.archiveInstaller; reasons.push('Archive named like a crack or keygen'); }
  if (isArchive) { score += W.archive; reasons.push('Archive (contents not visible until opened)'); }
  // Encryption limits inspection of archive contents; retain that uncertainty in the score.
  if ((isArchive || isContainer) && danger === 'passwordprotected') {
    score += W.passwordArchive; reasons.push('Password-protected archive cannot be scanned for malware');
  }

  // An executable-specific MIME type can reveal a program with its extension removed.
  const KNOWN_SAFE_EXT = /\.(pdf|docx?|xlsx?|pptx?|txt|rtf|csv|tsv|json|xml|ya?ml|html?|md|jpe?g|png|gif|webp|svg|bmp|tiff?|ico|heic|mp3|wav|flac|ogg|m4a|aac|mp4|mkv|mov|webm|avi|wmv|m4v|epub|mobi|ttf|otf|woff2?|odt|ods|odp)$/i;
  const hasExt = /\.[a-z0-9]{1,8}$/i.test(name);
  const knownType = isDangerous || isArchive || isContainer || isMacro || KNOWN_SAFE_EXT.test(name);
  // octet-stream removed for the same reason as the named-document test further down: it means
  // "unspecified binary", which dumb CDNs and share hosts send for everything they do not
  // recognise. It is not an assertion that the file is a program.
  const binaryMime = /(x-msdownload|x-msdos-program|x-executable|x-mach-binary|x-elf)/i.test(String(mime || ''));
  reviewEvidence.activeContent = reviewEvidence.activeContent || binaryMime;
  reviewEvidence.hiddenProgram = !!(name && !hasExt && binaryMime);
  if (name && !hasExt) {
    score += W.noExtension; reasons.push('File has no extension (can hide what it really is)');
    if (binaryMime) { score += W.noExtensionBinary; reasons.push('No extension but served as a program/binary'); }
  } else if (name && !knownType) {
    score += W.uncommonType; reasons.push('Uncommon file type — confirm you trust the source');
  }

  if (httpInsecure) {
    score += W.httpInsecure; reasons.push('Downloaded over insecure HTTP');
    if (privateHost) lanNoise += W.httpInsecure;
  }
  if (!rd) { score += W.unknownDomain; reasons.push('Source domain could not be determined'); }
  if (/blob:/i.test(finalUrlText) && (isDangerous || isArchive || isContainer || isMacro)) {
    score += W.blobRiskyFile; reasons.push('Download uses a browser-generated blob URL that hides the original source');
  } else if (finalUrlText && !/^https?:/i.test(finalUrlText) && (isDangerous || isArchive || isContainer || isMacro)) {
    score += W.unusualProtocol; reasons.push('Download URL protocol is unusual for a risky file');
  }

  // Score foreign embedded destinations, not same-site CDN/mirror handoffs. Ignore the common tracking key u; unparsable
  // destinations still score.
  const embedded = /(^|[?&])(url|redirect|redir|target|dest|destination|next|download_url)=(https?%3a[^&#]*|https?:\/\/[^&#]*)/i.exec(finalUrlText);
  let embeddedForeign = false;
  if (embedded) {
    try {
      const inner = regDomainBg(new URL(decodeURIComponent(embedded[3])).hostname);
      embeddedForeign = !inner || inner !== rd;
    } catch (_) { embeddedForeign = true; }
  }
  if (embeddedForeign) {
    score += W.redirectParam; reasons.push('Download URL hides another URL inside a redirect parameter');
  }
  const redirectRisk = normalizeDownloadRedirectRisk(redirectChain);
  reviewEvidence.flaggedRedirect = !!(redirectRisk && (redirectRisk.flagged || redirectRisk.maxed));
  let redirectCritical = false;
  let redirectTrustBreaker = false;
  if (redirectRisk) {
    if (redirectRisk.blocklisted) {
      score += W.redirectBlocklistedHop;
      redirectCritical = true;
      redirectTrustBreaker = true;
      reasons.unshift('Redirect chain passed through a known malware/phishing blocklist domain');
    } else if (redirectRisk.flagged) {
      score += W.redirectFlaggedHop;
      redirectTrustBreaker = true;
      reasons.push('Redirect chain included a risky hop before the download');
    }
    if (redirectRisk.maxed) {
      score += W.redirectFlaggedHop;
      redirectTrustBreaker = true;
      reasons.push('Redirect chain exceeded the safe hop limit before the download');
    } else if (redirectRisk.hops >= 4) {
      score += W.redirectChain;
      redirectTrustBreaker = true;
      reasons.push('Download followed a multi-hop redirect chain');
    }
    if (redirectRisk.domains >= 4) {
      score += W.redirectManyDomains;
      redirectTrustBreaker = true;
      reasons.push('Redirect chain crossed several unrelated domains');
    }
    if (redirectRisk.abuseTld && !redirectRisk.blocklisted) {
      redirectTrustBreaker = true;
      reasons.push('Redirect chain touched an abuse-prone domain before the download');
    }
  }
  // A parameter value containing ../ is not path traversal. Flag null bytes or double encoding;
  // the browser has already normalised traversal in the URL path.
  reviewEvidence.obfuscatedUrl = /%00|%25(2e|32)|(^|[/?&=])\.\.(%2f|%5c)/i.test(urlPathQuery);
  if (reviewEvidence.obfuscatedUrl) {
    score += W.obfuscatedPath; reasons.push('Download URL contains obfuscated path characters');
  }
  // Same non-letter boundary as LURE_HINT, and for the same reason: unanchored, `crack` matched the
  // URL of firecracker.exe and nutcracker-setup.exe. This is the second copy of that pattern -- the
  // filename test is not the only place it lives, so fixing one and not the other left the grade
  // unchanged and the reason line reading "scam or piracy lure wording" over an ordinary download.
  const urlLure = (isDangerous || isArchive || isContainer || isMacro) && /(^|[^a-z])(crack|keygen|activator|nulled|warez|free[-_%20 ]?nitro|steam[-_%20 ]?gift|wallet[-_%20 ]?(verify|update)|airdrop|claim[-_%20 ]?reward)/i.test(urlPathQuery + ' ' + host);
  reviewEvidence.lure = lureName || urlLure;
  if (urlLure) {
    score += W.lureWording; reasons.push('Download URL uses scam or piracy lure wording');
  }

  // Restrict inner decoy extensions to document/media types so dotted software names and archive.tar.gz are not treated as
  // disguises.
  const doubleExt = /\.(pdf|jpe?g|png|gif|webp|svg|bmp|tiff?|ico|heic|docx?|xlsx?|csv|tsv|pptx?|txt|rtf|md|json|xml|html?|odt|ods|epub|mp4|mkv|mov|avi|webm|wmv|m4v|mp3|wav|flac|ogg|m4a|aac|zip|rar|7z)\.(exe|scr|com|pif|bat|cmd|js|jse|vbs|vbe|jar|msi|msix|cpl|hta|ps1|lnk|wsf|reg|msc|scf)$/i;
  const hasDoubleExt = doubleExt.test(name);
  if (hasDoubleExt) { score += W.doubleExtension; reasons.push('Double extension disguising an executable (e.g. .pdf.exe)'); }

  // RIGHT-TO-LEFT OVERRIDE spoof: U+202E reverses how the filename renders, so
  // "exe.gpj" displays as a harmless image while actually being .exe -- a well-known
  // malware filename trick. Any RTL/LTR override or zero-width char in a filename is
  // a strong red flag.
  const hasHiddenChars = /[\u202A-\u202E\u2066-\u2069\u200B-\u200F]/.test(name);
  if (hasHiddenChars) {
    score += W.hiddenChars; reasons.push('Filename contains hidden text-direction characters (used to disguise the real type)');
  }

  // name padding: "invoice                 .exe" -- many spaces/underscores before the
  // extension to push it out of view in the UI.
  const hasPaddingTrick = /\s{6,}\.[a-z0-9]{2,5}$/i.test(name) || /_{8,}\.[a-z0-9]{2,5}$/i.test(name);
  if (hasPaddingTrick) {
    score += W.paddingTrick; reasons.push('Filename padded to hide its real extension');
  }

  // ---- grading refinements (reduce false positives, sharpen true risk) ----
  // A clean, version-numbered installer name from HTTPS is a normal-software pattern
  // (e.g. "VSCodeSetup-x64-1.89.1.exe", "node-v20.11.0-x64.msi"). Slightly lower the
  // generic "executable" anxiety when the name looks like a real release artifact and
  // nothing else is wrong.
  const looksVersionedRelease = /[-_ ]v?\d+\.\d+(\.\d+)?([-_.](x64|x86|win|win32|win64|amd64|arm64|setup|installer|stable|release))*\.(exe|msi|dmg|pkg|deb|rpm|appimage|zip)$/i.test(name);
  // Only corroborate a versioned-release name when the SOURCE is already trusted (user
  // trust list or known publisher). An attacker on an unknown/throwaway host can name a
  // payload "app-v2.1.0-x64.exe" for free; granting that a score discount nudged it below
  // the review threshold (D->C). On a trusted source the name is genuine corroboration.
  if (looksVersionedRelease && !httpInsecure && !lureName && score > 0 && score <= 3
    && (trustMatch || isKnownPublisherDomain(host))) {
    score -= W.versionedReleaseRebate; reasons.push('Filename looks like a normal versioned software release');
  }

  // extension / MIME mismatch: a file served as one thing but named another. Computed
  // BEFORE trickCount so a "served as a program but named like a document" file counts
  // toward the multiple-disguise-tricks bonus below (it is a disguise trick too).
  let dangerousMimeMismatch = false;
  try {
    const m = (mime || '').toLowerCase();
    // Anchor content-type checks and allow native text MIME types for scripts and similar formats. Filename disguises
    // invalidate that exemption.
    const declaredDocType = /^(text\/|image\/)/.test(m) || /(application\/pdf|officedocument)/.test(m);
    const textNativeExt = /\.(js|jse|vbs|vbe|wsf|wsh|ps1|psm1|hta|reg|url|scf|inf|desktop|iqy|slk|mht|mhtml|jnlp|bat|cmd|sh|py|pl|rb)$/i.test(name);
    const nameTrick = hasDoubleExt || hasHiddenChars || hasPaddingTrick;
    if (m && isDangerous && declaredDocType && !(textNativeExt && !nameTrick)) {
      score += W.mimeDisagree; reasons.push('File type and its declared content type disagree');
    }
    // Only executable-specific MIME types contradict a document filename. application/octet-stream
    // means unspecified binary and is common for legitimate PDFs and other files.
    if (binaryMime && KNOWN_SAFE_EXT.test(name)) {
      score += W.mimeProgramNamedDoc; dangerousMimeMismatch = true; reasons.push('Served as a program but named like a document');
    }
  } catch (_) {}

  // Two independent strong tricks together = near-certain malware; push to the top.
  const trickCount = [hasDoubleExt, hasHiddenChars, hasPaddingTrick, dangerousMimeMismatch].filter(Boolean).length;
  if (trickCount >= 2) { score += W.multipleTricks; reasons.unshift('Multiple filename-disguise tricks combined (high-confidence malware pattern)'); }

  // Combine insecure bare-IP delivery with lure names, not ordinary installer names.
  if (isDangerous && /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && (lureName || isArchive)) {
    score += W.ipHostInstaller; reasons.push('Executable with installer/crack name from a raw IP host');
    if (privateHost) lanNoise += W.ipHostInstaller;
  }

  // IP-address host serving an executable -- common in malware drops; worse over HTTP
  const rawIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
  reviewEvidence.publicIp = rawIp && !privateHost;
  if (isDangerous && rawIp) {
    score += W.rawIpExecutable; reasons.push('Executable served directly from a raw IP address');
    if (privateHost) lanNoise += W.rawIpExecutable;
  }
  if (isDangerous && rawIp && httpInsecure) {
    score += W.rawIpInsecure; reasons.push('Insecure raw-IP source');
    if (privateHost) lanNoise += W.rawIpInsecure;
  }

  // Archives/disk-images hide their contents until opened (the Qakbot/IcedID "exe inside
  // a zip/iso" pattern). We do NOT review every archive (most are benign), but legit
  // software essentially never ships an archive from a raw IP -- that combination is a
  // strong drive-by-drop signal that would otherwise sit silent at grade B.
  if ((isArchive || isContainer) && rawIp) {
    score += W.rawIpExecutable; reasons.push('Archive/disk-image served directly from a raw IP address (contents hidden until opened)');
    if (privateHost) lanNoise += W.rawIpExecutable;
  }

  // IDN / punycode host (xn--) for a download source -- lookalike-domain delivery
  if (/(^|\.)xn--/i.test(host)) { score += W.punycodeHost; reasons.push('Source uses a lookalike (punycode) domain'); }

  // throwaway / abuse-prone TLDs frequently used for malware distribution. The
  // .zip and .mov TLDs are especially dangerous because they look like filenames,
  // so an executable served from one is weighted higher.
  if (/\.(zip|mov)$/i.test(host)) { score += W.confusableTld; reasons.push('Source on a filename-confusable TLD (.zip/.mov)'); }
  else if (/\.(cfd|sbs|top|xyz|click|link|rest|quest|cyou|icu|gq|cf|ml|ga|tk|work|monster|lol)$/i.test(host)) {
    // Waive the TLD charge only for a lone clean executable. Archives can have the same baseline
    // score but still need the charge for hidden contents.
    const loneCleanExe = isDangerous && !isArchive && !isContainer && !isMacro && score === W.executable;
    if (!loneCleanExe) {
      score += W.throwawayTld; reasons.push('Source on a throwaway-style TLD');
    }
  }

  const critical = !!(onBlocklist || chromeKnownBad || hasDoubleExt || hasHiddenChars || hasPaddingTrick || dangerousMimeMismatch || redirectCritical);
  // Refund the public-internet-only charges for a host on the user's own network -- but never for
  // a file that is critical (disguised name, blocklisted, Chrome-flagged) or lure-named.
  if (lanNoise > 0 && privateHost && !critical && !lureName) {
    score = Math.max(0, score - lanNoise);
    reasons.push('Source is on your own network, so raw-address and insecure-transport penalties were not applied');
  }
  const knownPublisher = isKnownPublisherDomain(host);
  // A known, vetted publisher (microsoft.com, mozilla.org, github.com, ...) is
  // trusted automatically -- normal downloads from them stay silent. But critical
  // tricks STILL override: a disguised .pdf.exe from any domain gets reviewed.
  const trustedEligible = !!((trustMatch || knownPublisher) && !critical && !redirectTrustBreaker
    && !reviewEvidence.browserWarning && !reviewEvidence.lure);
  if (trustedEligible) {
    if (knownPublisher && !trustMatch && isMultiTenantPublisherHost(host)) {
      // github.com / sourceforge.net host arbitrary third-party binaries; being on the
      // platform is not an endorsement of THIS file. Soften with the trusted-site rebate
      // instead of full silent trust so a suspicious-named payload (installer/crack/lure
      // wording, throwaway signals) from a random repo/project still surfaces for review.
      score = Math.max(0, score - W.trustedSiteRebate);
      reasons.unshift('Hosted on a known but multi-tenant publisher — limited trust (file not endorsed by the platform)');
    } else if (knownPublisher && !trustMatch) {
      // zero out ordinary risk for a clean file from a known publisher so it's silent
      score = 0;
      reasons.unshift('Source is a known, trusted software publisher');
    } else {
      score = Math.max(0, score - W.trustedSiteRebate);
      reasons.unshift('Source is in your trusted download sites');
    }
  } else if ((trustMatch || knownPublisher) && critical) {
    reasons.unshift(knownPublisher
      ? 'Known publisher domain, but critical file indicators still require review'
      : 'Trusted site matched, but critical file indicators still require review');
  } else if ((trustMatch || knownPublisher) && redirectTrustBreaker) {
    reasons.unshift(knownPublisher
      ? 'Known publisher domain, but risky redirect-chain indicators still require review'
      : 'Trusted site matched, but risky redirect-chain indicators still require review');
  }

  // Retain the lower context score for an otherwise unremarkable vendor executable.
  if (!trustedEligible && isDangerous && !critical && !isArchive && !isContainer && !isMacro
    && rd && (!httpInsecure || privateHost) && !lureName && score === W.executable) {
    score -= 1;
    reasons.push('Nothing against this file except that it is a program');
  }
  // Apply the same score adjustment to a lone disk image or macro document.
  if (!trustedEligible && !critical && !isDangerous && !isArchive
    && rd && (!httpInsecure || privateHost) && !lureName
    && ((isContainer && !isMacro && score === W.container)
      || (isMacro && !isContainer && score === W.macroDoc))) {
    score -= 1;
    reasons.push('Nothing against this file except its type, and it came from an established site');
  }

  return applyDownloadMeta({
    score,
    source: host || '(unknown)',
    reasons,
    trusted: !!(trustMatch || knownPublisher),
    trustedEligible,
    knownPublisher,
    // What Trust hands over has to be what the button says. On a shared-hosting suffix the
    // registrable domain is the PLATFORM -- trusting one cloudfront distribution would have
    // allowlisted every distribution on cloudfront.net. On a raw IP it was a meaningless
    // two-label fragment ("1.20" from 192.168.1.20). Both now resolve to the exact host.
    trustAllowed: !!(downloadTrustTarget(host) && !critical && !redirectTrustBreaker),
    trustHost: trustMatch || downloadTrustTarget(host),
    critical,
    reviewEvidence,
    blocklisted: !!(onBlocklist || chromeKnownBad || redirectCritical),
    chromeDanger: chromeDanger || '',
    redirectChain: redirectRisk || null,
    domainAge: null,
    externalReputation: [],
  });
}

function applyDownloadMeta(rep) {
  const meta = downloadGradeFromScore(rep.score, !!rep.blocklisted);
  rep.grade = meta.grade;
  rep.status = meta.status;
  rep.color = meta.color;
  rep.action = shouldReviewDownload(rep) ? 'review' : 'allow';
  rep.level = Math.max(0, 'ABCDEF'.indexOf(meta.grade));
  rep.levelText = meta.grade + ' - ' + meta.status;
  return rep;
}

function shouldCheckDownloadDomainAge(rep) {
  if (!rep || !rep.source || rep.source === '(unknown)') return false;
  if (rep.trustedEligible) return false;
  if (rep.blocklisted) return false;
  return rep.score >= 1 || /(\.zip|\.mov|\.cfd|\.sbs|\.top|\.xyz|\.click|\.link|\.rest|\.quest|\.cyou|\.icu|\.gq|\.cf|\.ml|\.ga|\.tk|\.work|\.monster|\.lol)$/i.test(rep.source);
}

async function enrichDownloadWithDomainAge(rep, cfg) {
  if (!shouldCheckDownloadDomainAge(rep)) return rep;
  const age = await lookupDomainAge(rep.source, cfg);
  if (!age || !age.ok || typeof age.ageDays !== 'number') return rep;
  rep.domainAge = {
    domain: age.domain,
    created: age.created,
    ageDays: age.ageDays,
    risk: age.risk,
    provider: age.provider || '',
    registrar: age.registrar || '',
    registrantOrg: age.registrantOrg || '',
    registrantCountry: age.registrantCountry || '',
    privacy: !!age.privacy,
    nameServers: Array.isArray(age.nameServers) ? age.nameServers.slice(0, 4) : [],
  };
  rep.reviewEvidence.youngDomain = age.ageDays < 30;
  if (age.ageDays < 7) {
    rep.score += 3;
    rep.reasons.push('Source domain is brand new (' + age.ageDays + ' days old)');
  } else if (age.ageDays < 30) {
    rep.score += 2;
    rep.reasons.push('Source domain is very new (' + age.ageDays + ' days old)');
  } else if (age.ageDays < 90) {
    rep.score += 1;
    rep.reasons.push('Source domain is fairly new (' + age.ageDays + ' days old)');
  } else if (age.ageDays >= 1825 && !age.privacy && age.registrantOrg && !rep.critical && !rep.blocklisted) {
    // The mirror image of the new-domain penalties above. A domain registered five or more years
    // ago to a named organisation, with nothing redacted, is real evidence -- but the key only ever
    // spent points, never returned any, so paying for WHOIS bought interruptions and no
    // reassurance. Floored at zero and refused on anything critical.
    if (rep.score > 0) rep.score = Math.max(0, rep.score - 1);
    rep.reasons.push('Source domain has belonged to ' + age.registrantOrg + ' for '
      + Math.floor(age.ageDays / 365) + '+ years');
  } else {
    rep.reasons.push('Source domain age checked: ' + age.risk + ' risk');
  }
  if (age.registrar) rep.reasons.push('Registrar clue: ' + age.registrar);
  if (age.registrantOrg && !age.privacy) rep.reasons.push('Registrant organization clue: ' + age.registrantOrg);
  if (age.privacy) rep.reasons.push('WHOIS ownership appears privacy-protected or redacted');
  return applyDownloadMeta(rep);
}

async function enrichDownloadWithExternalReputation(rep, url, cfg) {
  if (!url || !/^https?:/i.test(url)) return rep;
  const checks = [];
  if (cfg && cfg.downloadSafeBrowsing === true && String(cfg.downloadSafeBrowsingKey || '').trim()) {
    checks.push(safeBrowsingLookupUrl(url, { cfg, key: cfg.downloadSafeBrowsingKey }));
  }
  if (cfg && cfg.downloadVirusTotal === true && String(cfg.downloadVirusTotalKey || '').trim()) {
    // PRIV-03: never send private-network addresses or URL queries to VirusTotal; they can expose intranet names and
    // download credentials.
    if (normalizePublicHttpUrl(url)) {
      try {
        const u = new URL(url);
        u.username = '';
        u.password = '';
        u.search = '';
        u.hash = '';
        if (u.href.length <= 2000) checks.push(checkVirusTotalUrl(u.href, cfg.downloadVirusTotalKey));
      } catch (_) {}
    }
  }
  if (cfg && cfg.urlHaus === true && String(cfg.urlHausKey || '').trim()) {
    checks.push(urlHausLookupUrl(url, { cfg, key: cfg.urlHausKey, context: 'download' }));
  }
  if (cfg && cfg.phishTank === true && String(cfg.phishTankKey || '').trim()) {
    checks.push(checkPhishTankUrl(url, cfg));
  }
  if (cfg && cfg.openPhish === true) {
    checks.push(checkOpenPhishUrl(url, cfg));
  }
  if (cfg && cfg.abuseIpDb === true && String(cfg.abuseIpDbKey || '').trim() && ipFromUrl(url)) {
    checks.push(abuseIpDbLookupUrl(url, { cfg, key: cfg.abuseIpDbKey }));
  }
  if (cfg && cfg.whoisXmlReputation === true && String(cfg.whoisXmlKey || '').trim()) {
    checks.push(whoisXmlDomainReputationLookupUrl(url, { cfg, key: cfg.whoisXmlKey }));
  }
  if (cfg && cfg.whoisXmlThreatIntel === true && String(cfg.whoisXmlKey || '').trim()) {
    checks.push(whoisXmlThreatIntelLookupUrl(url, { cfg, key: cfg.whoisXmlKey }));
  }
  if (!checks.length) return rep;

  const results = (await Promise.all(checks)).filter(Boolean);
  const hits = [];
  results.forEach((result) => {
    if (!result || !result.ok || !result.hit) return;
    hits.push(result);
    rep.trustAllowed = false;
    if (result.provider === 'Google Safe Browsing') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('Google Safe Browsing flagged this download URL' + (result.threats && result.threats.length ? ': ' + result.threats.join(', ') : ''));
    } else if (result.provider === 'PhishTank') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('PhishTank verified this download URL as phishing' + (result.phishId ? ' (#' + result.phishId + ')' : ''));
    } else if (result.provider === 'OpenPhish') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('OpenPhish feed matched this download URL as phishing');
    } else if (result.provider === 'AbuseIPDB') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('AbuseIPDB reports high abuse confidence for this raw-IP download source (' + (result.score || 0) + '%)');
    } else if (result.provider === 'URLhaus') {
      rep.score += 100;
      rep.blocklisted = true;
      const family = result.signatures && result.signatures.length ? ' (' + result.signatures.slice(0, 3).join(', ') + ')' : '';
      const scope = result.hostOnly ? 'download host' : 'download URL';
      rep.reasons.unshift('URLhaus flagged this ' + scope + ' as malware delivery' + (result.threat ? ': ' + result.threat : '') + family);
    } else if (result.provider === 'WhoisXML Domain Reputation') {
      const score = result.reputationScore != null ? Math.round(Number(result.reputationScore)) : null;
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('WhoisXML Domain Reputation flagged this source' + (score != null ? ' (' + score + '/100 reputation)' : ''));
    } else if (result.provider === 'WhoisXML Threat Intelligence') {
      rep.score += 100;
      rep.blocklisted = true;
      rep.reasons.unshift('WhoisXML Threat Intelligence matched this download URL' + ((result.threatTypes && result.threatTypes.length) ? ': ' + result.threatTypes.join(', ') : ''));
    } else if (result.provider === 'VirusTotal') {
      const stats = result.stats || {};
      const malicious = Number(stats.malicious || 0);
      const suspicious = Number(stats.suspicious || 0);
      if (malicious >= 2) {
        rep.reviewEvidence.malwareDetection = true;
        rep.blocklisted = true;
        rep.score += 10;
        rep.reasons.unshift('VirusTotal reports ' + malicious + ' malicious detections for this URL');
      } else if (malicious === 1 || suspicious >= 2) {
        rep.reviewEvidence.malwareDetection = malicious === 1;
        // Cap isolated reputation disagreements for vetted publishers; enrichment can still warn without overriding
        // publisher trust on weak evidence alone.
        rep.score += (rep.trustedEligible ? 2 : 6);
        rep.reasons.unshift('VirusTotal reports suspicious URL detections');
      } else if (suspicious === 1) {
        rep.score += (rep.trustedEligible ? 2 : 3);
        rep.reasons.unshift('VirusTotal has one suspicious detection for this URL');
      }
    }
  });
  // A clean consensus can reduce noncritical, unlisted URL risk by one. Re-fetch hashes are not exact-file evidence and
  // cannot justify a rebate.
  if (!rep.critical && !rep.blocklisted) {
    const vtClean = results.find((r) => r && r.ok && !r.hit && r.provider === 'VirusTotal'
      && r.stats && Number(r.stats.malicious || 0) === 0 && Number(r.stats.suspicious || 0) === 0
      && Number(r.stats.harmless || 0) >= 10);
    if (vtClean && rep.score > 0) {
      rep.score = Math.max(0, rep.score - 1);
      rep.reasons.push('VirusTotal found nothing against this file across '
        + Number(vtClean.stats.harmless || 0) + ' engines');
    }
  }
  results.forEach((result) => {
    if (!result || !result.ok || result.hit || result.provider !== 'AbuseIPDB' || !result.warning) return;
    rep.trustAllowed = false;
    rep.score += rep.trustedEligible ? 2 : (Number(result.score || 0) >= 50 ? 3 : 2);
    rep.reasons.unshift('AbuseIPDB reports suspicious raw-IP source (' + (result.score || 0) + '% abuse confidence)');
  });
  results.forEach((result) => {
    if (!result || !result.ok || result.hit || !result.warning) return;
    if (result.provider === 'AbuseIPDB' || result.provider === 'WhoisXML Domain Reputation' || result.provider === 'WhoisXML Threat Intelligence') {
      rep.reviewEvidence.reputationWarning = true;
    }
    if (result.provider === 'WhoisXML Domain Reputation') {
      rep.trustAllowed = false;
      const score = result.reputationScore != null ? Math.round(Number(result.reputationScore)) : null;
      rep.score += score != null && score < 45 ? 4 : 2;
      rep.reasons.unshift('WhoisXML reports suspicious domain reputation' + (score != null ? ' (' + score + '/100)' : ''));
    } else if (result.provider === 'WhoisXML Threat Intelligence') {
      rep.trustAllowed = false;
      rep.score += 4;
      rep.reasons.unshift('WhoisXML Threat Intelligence returned an IoC warning');
    }
  });
  rep.externalReputation = results.map((result) => {
    if (result.provider === 'VirusTotal') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        notFound: !!result.notFound,
        status: result.status || 0,
        error: result.error || '',
        stats: result.stats || null,
        reputation: result.reputation || 0,
      };
    }
    if (result.provider === 'PhishTank') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        inDatabase: !!result.inDatabase,
        verified: !!result.verified,
        valid: !!result.valid,
        phishId: result.phishId || '',
        detailPage: result.detailPage || '',
        rateLimited: !!result.rateLimited,
        cloudflare: !!result.cloudflare,
      };
    }
    if (result.provider === 'OpenPhish') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        matchedUrl: result.matchedUrl || '',
        feedSize: Number(result.feedSize || 0),
        stale: !!result.stale,
      };
    }
    if (result.provider === 'AbuseIPDB') {
      return abuseIpDbPublic(result);
    }
    if (result.provider === 'URLhaus') {
      return urlHausPublic(result);
    }
    if (result.provider === 'WhoisXML Domain Reputation') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        warning: !!result.warning,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        domain: result.domain || '',
        reputationScore: result.reputationScore != null ? Number(result.reputationScore) : null,
        warningCodes: Array.isArray(result.warningCodes) ? result.warningCodes.slice(0, 12) : [],
        warnings: Array.isArray(result.warnings) ? result.warnings.slice(0, 8) : [],
        rateLimited: !!result.rateLimited,
      };
    }
    if (result.provider === 'WhoisXML Threat Intelligence') {
      return {
        provider: result.provider,
        ok: result.ok !== false,
        hit: !!result.hit,
        warning: !!result.warning,
        status: result.status || 0,
        error: result.error || '',
        threats: result.threats || [],
        ioc: result.ioc || '',
        total: Number(result.total || 0),
        threatTypes: Array.isArray(result.threatTypes) ? result.threatTypes.slice(0, 8) : [],
        results: Array.isArray(result.results) ? result.results.slice(0, 8) : [],
        rateLimited: !!result.rateLimited,
      };
    }
    return {
      provider: result.provider,
      ok: result.ok !== false,
      hit: !!result.hit,
      status: result.status || 0,
      error: result.error || '',
      threats: result.threats || [],
    };
  });
  if (rep.externalReputation.length) rep.externalSummary = externalSummary(rep.externalReputation);
  return applyDownloadMeta(rep);
}

function isRecentCompletedDownload(item) {
  try {
    const ts = item && item.endTime ? new Date(item.endTime).getTime() : 0;
    // widened from 15s to 60s: a fast download can complete before our scheduled
    // scan runs, and we still want to surface a review for it.
    return !!ts && (Date.now() - ts) < 60000;
  } catch (_) {
    return false;
  }
}

async function latestDownloadItem(id, hint) {
  const items = await downloadSearch({ id: Number(id) });
  if (items === null) return null;
  if (items && items[0]) return Object.assign({}, hint || {}, items[0]);
  return hint && hint.id != null ? hint : null;
}

async function pauseDownloadForReview(item, rep, previous) {
  if (previous || !shouldReviewDownload(rep) || item.state === 'complete' || item.state === 'interrupted') return previous;
  return downloadApiCall('pause', item.id);
}

async function runDownloadGuardScan(id, hint, reason) {
  const key = String(id || (hint && hint.id) || '');
  if (!key) return;
  if (DOWNLOAD_SCANNING[key]) {
    scheduleDownloadGuardScan(key, hint, 'rescan-after-busy', 900);
    return;
  }
  DOWNLOAD_SCANNING[key] = true;

  try {
    if (FORCED_DOWNLOAD_CHECKS.has(key)) await FORCED_DOWNLOAD_CHECKS.get(key);
    if (EARLY_SOURCE_CHECKS.has(key)) await EARLY_SOURCE_CHECKS.get(key);
    await cleanupDownloadReviews(false);
    let pending = await getPendingDownload(key);
    if (await isDownloadHandled(key) && !pending) return;
    /* The file is gone; nothing a rescan learns can change that notice. */
    if (pending && pending.removed && pending.removed.removedFile === true) return;

    const item = await latestDownloadItem(key, hint);
    if (!item || item.id == null) return;
    if (!pending && (FORCED_DOWNLOAD_CONTEXT.has(key) || reason === 'recover')) await checkForcedDownload(item);

    if (item.state === 'interrupted' && !(pending && pending.interventionFailed)) {
      if (pending) {
        await removePendingDownload(key);
        await rememberHandledDownload(key, 'interrupted');
        await closeDownloadReviewTabs(key);
      }
      return;
    }

    if (item.state === 'complete' && pending && !pending.interventionFailed) {
      /* A finished file cannot change, so its review stands until answered. */
      if (pending.finishedBeforeStop) return;
      /* Paused by WardenOne and finished anyway: it was resumed outside the review. */
      if (pending.paused) {
        await removePendingDownload(key);
        await rememberHandledDownload(key, 'completed');
        await closeDownloadReviewTabs(key);
        return;
      }
      /* Chrome refused the pause and the file has since finished; rescan so the review says so. */
    }

    // Leftover from a PREVIOUS browser session (Chrome restores paused/interrupted
    // downloads on restart). Never re-pop a review for these -- resolve quietly and
    // leave the download paused in Chrome for the user to manage.
    await downloadSessionMarkReady;
    if (downloadStartedBeforeSession(item)) {
      if (pending) await removePendingDownload(key);
      await rememberHandledDownload(key, 'previous-session');
      await closeDownloadReviewTabs(key);
      return;
    }

    const cfgStore = await downloadStateGet(['wardenone_config', DOWNLOAD_TRUSTED_KEY]);
    const cfg = (cfgStore && cfgStore.wardenone_config) || {};
    const intentSourceHost = (FORCED_DOWNLOAD_CONTEXT.get(key) || {}).host || (pending && pending.intentSourceHost) || '';
    const intentWhy = forcedDownloadSettingApplies(cfg, intentSourceHost)
      ? FORCED_DOWNLOAD_REASONS.get(key) || (pending && pending.reviewEvidence && pending.reviewEvidence.unexpectedDownload && pending.intentReason) : '';
    if (cfg.enabled === false || (cfg.downloadReputation === false && !intentWhy)) {
      // Guard is off -> never leave a file stuck in the onCreated early-pause.
      if (EARLY_PAUSED.has(key)) { Promise.resolve(downloadApiCall('resume', item.id)).catch(() => {}); EARLY_PAUSED.delete(key); }
      return;
    }
    if (pending && pending.cleanupPending) {
      applyDownloadRemovalResult(pending, await hardRemoveDownload(item.id));
      await recordAutomaticDownloadRemoval(pending);
      await openDownloadReview(pending);
      return;
    }
    const trustedSites = Array.isArray(cfgStore && cfgStore[DOWNLOAD_TRUSTED_KEY]) ? cfgStore[DOWNLOAD_TRUSTED_KEY] : [];
    // Await blocklist and redirect-window hydration before scoring the first download after wake (M17).
    if (typeof securityStoresReady === 'function') await securityStoresReady();
    if (typeof RECENT_REDIRECT_MIRROR !== 'undefined') await RECENT_REDIRECT_MIRROR.ready();
    const downloadUrl = item.finalUrl || item.url || '';
    const filename = item.filename || item.url || '';
    const redirectContext = downloadRedirectContext(downloadUrl, item.referrer, item);
    let rep = scoreDownload(downloadUrl, item.referrer, filename, item.mime, trustedSites, item.danger, redirectContext);
    rep.intentSourceHost = intentSourceHost;
    applyForcedDownloadEvidence(rep, intentWhy);
    /* Checked before the pause decision: a listed address must not finish while lookups run. */
    if (cfg.downloadReputation !== false) rep = await enrichDownloadWithPayloadUrlFeed(rep, [item.url, item.finalUrl]);
    let pauseResult = await pauseDownloadForReview(item, rep, null);

    if (cfg.downloadReputation !== false) {
      if (cfg.downloadDomainAge === true) rep = await enrichDownloadWithDomainAge(rep, cfg);
      rep = await enrichDownloadWithExternalReputation(rep, downloadUrl, cfg);
      pauseResult = await pauseDownloadForReview(item, rep, pauseResult);
      /* The local check skips URL re-fetching while only diagnostic signatures are loaded. */
      rep = await enrichDownloadWithLocalHash(rep, downloadUrl, filename, cfg);
      pauseResult = await pauseDownloadForReview(item, rep, pauseResult);
      rep = await enrichDownloadWithVirusTotalHash(rep, downloadUrl, filename, cfg);
    }
    applyForcedDownloadEvidence(rep, intentWhy);

    if (!shouldReviewDownload(rep)) {
      // Resume if WE paused it -- either the scan's own pause, or the onCreated early-pause.
      if ((pauseResult && pauseResult.ok) || EARLY_PAUSED.has(key)) await downloadApiCall('resume', item.id);
      EARLY_PAUSED.delete(key);
      // A review panel may already be open from an earlier scan that ran while Chrome had not
      // finished its own check. The verdict is in now and it is clean, so withdraw the panel
      // instead of leaving the user staring at a warning about a file that has been cleared.
      try { await dismissDownloadReviewPanels(key); } catch (_) {}
      if (item.state === 'complete' && !DOWNLOAD_SAFE_LOGGED.has(key)) {
        DOWNLOAD_SAFE_LOGGED.add(key);
        logDownloadCheck(item, rep);
        await rememberHandledDownload(key, 'allowed');
      }
      return;
    }

    // Review each risky ID once regardless of completion timing; small/cached downloads may finish
    // before the first scan.
    const alreadyHandled = await isDownloadHandled(key);
    if (item.state === 'complete' && !isRecentCompletedDownload(item) && !pending && alreadyHandled) {
      // genuinely stale (finished long ago, already dealt with) -> just log, no popup
      logDownloadCheck(item, rep);
      return;
    }

    pauseResult = await pauseDownloadForReview(item, rep, pauseResult);
    /* A refused pause usually means Chrome finished writing first. Ask Chrome, because the review
       must not claim a stop that never happened. */
    const finishedBeforeStop = !(pauseResult && pauseResult.ok)
      && (item.state === 'complete' || ((await latestDownloadItem(key, item)) || {}).state === 'complete');

    const oldReview = await getPendingDownload(key);
    const review = buildDownloadReview(item, rep, pauseResult, finishedBeforeStop);
    if (oldReview && oldReview.createdAt) review.createdAt = oldReview.createdAt;
    if (oldReview && oldReview.paused && !finishedBeforeStop) {
      review.paused = true;
      if (!review.pauseError) review.pauseError = oldReview.pauseError || '';
    }

    /* Threat findings default to removal; a high heuristic score alone does not.
       downloadHardBlockCritical:false retains pause-only review. */
    if (review.blockRequired && cfg.downloadHardBlockCritical !== false) {
      applyDownloadRemovalResult(review, await hardRemoveDownload(item.id));
    }
    // From here the review's own pause/removed state owns the download; drop the early-pause tag.
    EARLY_PAUSED.delete(key);

    if (!review.removed) await rememberPendingDownload(review);
    if (!oldReview || oldReview.grade !== review.grade || oldReview.score !== review.score) {
      logDownloadCheck(item, rep);
    }
    // Persist handled state after pausing. Worker termination between the two can cause a duplicate
    // review; pause and storage writes cannot be atomic. Recovery must never silently resume it.
    if (review.removed) await recordAutomaticDownloadRemoval(review);
    else await rememberHandledDownload(key, 'reviewed');
    await openDownloadReview(review);
  } catch (e) {
    queueHistory({
      type: 'download_guard',
      detail: { decision: 'error', reason: reason || '', error: String(e).slice(0, 120) },
      url: hint && (hint.finalUrl || hint.url) || '',
      at: Date.now(),
    });
  } finally {
    delete DOWNLOAD_SCANNING[key];
    AWAITING_FIRST_SCAN.delete(key);
  }
}

function scheduleDownloadGuardScan(id, hint, reason, delayMs) {
  const key = String(id || (hint && hint.id) || '');
  if (!key) return;
  if (DOWNLOAD_SCAN_TIMERS[key]) clearTimeout(DOWNLOAD_SCAN_TIMERS[key]);
  DOWNLOAD_SCAN_TIMERS[key] = setTimeout(() => {
    delete DOWNLOAD_SCAN_TIMERS[key];
    runDownloadGuardScan(key, hint || null, reason || 'scheduled');
  }, typeof delayMs === 'number' ? delayMs : 250);
}

/* Pause actionable evidence before the scheduled scan; ordinary file types keep downloading. */
function handleDownloadCreated(item) {
  if (!item || item.id == null) return;
  const intentCheck = checkForcedDownload(item);
  let sourceCheck = null;
  try {
    // Skip the early-pause when the cached config already says the guard is off (avoids a
    // pointless pause/resume cycle; a cold cache falls through and the scan resolves it).
    const guardOff = __cfgCacheValid && __cfgCache && (__cfgCache.enabled === false || __cfgCache.downloadReputation === false);
    if (!guardOff && item && item.id != null && item.state !== 'complete' && item.state !== 'interrupted') {
      AWAITING_FIRST_SCAN.set(String(item.id), item);
      if (downloadLooksRisky(item)) earlyPauseDownload(item.id);
      else sourceCheck = earlyPauseListedSource(item);
    }
  } catch (_) {}
  scheduleDownloadGuardScan(item.id, item, 'created', 180);
  setTimeout(() => scheduleDownloadGuardScan(item.id, null, 'created-followup', 0), 1200);
  return sourceCheck ? Promise.all([sourceCheck, intentCheck]) : intentCheck;
}

function handleDownloadChanged(delta) {
  if (!delta || delta.id == null) return;
  if (delta.filename && delta.filename.current) earlyPauseNamedDownload(delta.id, delta.filename.current);
  if ((delta.filename || delta.mime || delta.finalUrl) && FORCED_DOWNLOAD_CONTEXT.has(String(delta.id))) {
    latestDownloadItem(delta.id, { id: delta.id }).then(item => item && checkForcedDownload(item)).catch(() => {});
  }
  const relevant = delta.filename || delta.finalUrl || delta.url || delta.mime || delta.danger || delta.state || delta.exists || delta.paused;
  if (relevant) scheduleDownloadGuardScan(delta.id, { id: delta.id }, 'changed', 160);
}

try {
  chrome.downloads.onCreated.addListener(handleDownloadCreated);
  chrome.downloads.onChanged.addListener(handleDownloadChanged);
} catch (_) {}
try {
  chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
    /* Bound the async filename stage; never keep Chrome waiting for a review UI. */
    let finished = false;
    const release = () => { if (!finished) { finished = true; clearTimeout(timer); suggest(); } };
    const timer = setTimeout(release, 1000);
    checkForcedDownload(item).then(release, release);
    return true;
  });
} catch (_) {}

// Reconcile Chrome’s paused downloads on every worker boot (M25). A worker can stop between
// pausing and persisting the review, so storage alone cannot identify every orphan.
// Rebuild missing reviews without resuming downloads.
async function recoverStrandedPausedDownloads() {
  try {
    const cfgStore = await localGet('wardenone_config');
    const cfg = (cfgStore && cfgStore.wardenone_config) || {};
    if (cfg.enabled === false || (cfg.downloadReputation === false && cfg.forcedDownloadProtection === false)) return 0;
    const items = await downloadSearch({ state: 'in_progress', paused: true });
    if (!Array.isArray(items) || !items.length) return 0;
    await downloadSessionMarkReady;
    let recovered = 0;
    for (const item of items) {
      if (!item || item.id == null) continue;
      // Not ours to speak for: the user paused it, or it predates this browser session and the
      // new-session quiesce has already had its say.
      if (downloadStartedBeforeSession(item)) continue;
      const key = String(item.id);
      if (await isDownloadHandled(key)) continue;
      if (await getPendingDownload(key)) continue;
      scheduleDownloadGuardScan(item.id, item, 'recover', 0);
      recovered++;
    }
    return recovered;
  } catch (_) {
    return 0;
  }
}

// Register each namespace independently so one failure cannot suppress unrelated listeners (LIFE-04).
try {
  setTimeout(() => cleanupDownloadReviews(true), 1000);
  setTimeout(() => { recoverStrandedPausedDownloads().catch(() => {}); }, 1500);
  chrome.runtime.onStartup?.addListener(() => {
    // new browser session: stamp the boundary FIRST, then purge leftover reviews so
    // restored downloads can't re-pop. markBrowserSessionStart runs synchronously
    // enough that a (debounced) restore scan sees the new boundary.
    markBrowserSessionStart();
    setTimeout(() => { quiesceDownloadReviewsForNewSession(); cleanupDownloadReviews(true); }, 800);
  });
} catch (_) {}
try {
  chrome.tabs.onUpdated.addListener((_tabId, changeInfo, tab) => {
    if (changeInfo.status === 'complete' && reviewIdFromUrl(tab && (tab.url || tab.pendingUrl))) {
      cleanupDownloadReviews(true);
    }
  });
} catch (_) {}

try {
  if (globalThis.__WARDENONE_TEST__) {
    globalThis.__woDownloadTest = Object.freeze({
      DOWNLOAD_GRADE_META,
      DOWNLOAD_HASH_SOURCE,
      DL_WEIGHT,
      downloadLooksRisky,
      scoreDownload,
      applyDownloadMeta,
      downloadHashSourceMeta,
      normalizeDownloadHashSourceKind,
      normalizeDownloadRedirectRisk,
      buildDownloadReview,
      hardRemoveDownload,
      runDownloadGuardScan,
      getPendingDownload,
      shouldReviewDownload,
      handleDownloadCreated,
      handleDownloadChanged,
      handleDownloadDecision,
      cleanupDownloadReviews,
      EARLY_PAUSED,
    });
  }
} catch (_) {}

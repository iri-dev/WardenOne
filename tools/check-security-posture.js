/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const exists = (name) => fs.existsSync(path.join(root, name));

let failed = 0;
let warned = 0;

function ok(msg) { console.log('[ok] ' + msg); }
function warn(msg) { warned++; console.warn('[warn] ' + msg); }
function fail(msg) { failed++; console.error('[fail] ' + msg); }

function includesAll(text, needles) {
  return needles.every((n) => text.includes(n));
}

function scanDynamicCode(files) {
  const severe = [];
  const markup = [];
  const severePatterns = [
    { re: /\beval\s*\(/, label: 'eval(' },
    { re: /\bnew\s+Function\s*\(/, label: 'new Function(' },
    { re: /\bdocument\.write\s*\(/, label: 'document.write(' },
  ];
  const markupPatterns = [
    { re: /\.innerHTML\s*=/, label: 'innerHTML assignment' },
    { re: /\.outerHTML\s*=/, label: 'outerHTML assignment' },
    { re: /\.insertAdjacentHTML\s*\(/, label: 'insertAdjacentHTML(' },
  ];
  for (const file of files) {
    if (!exists(file)) continue;
    const text = read(file);
    for (const p of severePatterns) {
      if (p.re.test(text)) severe.push(file + ': ' + p.label);
    }
    for (const p of markupPatterns) {
      if (p.re.test(text)) markup.push(file + ': ' + p.label);
    }
  }
  return { severe, markup };
}

let manifest;
try {
  manifest = JSON.parse(read('manifest.json'));
  ok('manifest.json parses');
} catch (e) {
  fail('manifest.json does not parse: ' + e.message);
  manifest = {};
}

if (manifest.manifest_version === 3) ok('Manifest V3 service-worker model');
else fail('manifest_version is not 3');

const csp = String(manifest.content_security_policy && manifest.content_security_policy.extension_pages || '');
if (csp && !/'unsafe-eval'|'unsafe-inline'|http:|https:/i.test(csp)) ok('extension-page CSP blocks remote/inline/eval script');
else fail('extension-page CSP is missing or allows unsafe script sources');
if (/object-src\s+'none'/i.test(csp)) ok('CSP blocks plugin/object embedding');
else warn('CSP does not explicitly use object-src none');
if (/frame-ancestors\s+'none'/i.test(csp)) ok('CSP blocks extension pages from being framed');
else warn('CSP does not explicitly use frame-ancestors none');

if (!Object.prototype.hasOwnProperty.call(manifest, 'externally_connectable')) ok('no externally_connectable web-page messaging surface');
else warn('externally_connectable is present; review allowed origins carefully');

const permissions = new Set(manifest.permissions || []);
for (const perm of ['declarativeNetRequest', 'storage', 'webRequest', 'webNavigation', 'downloads', 'tabs']) {
  if (permissions.has(perm)) ok('permission present for core guard: ' + perm);
  else warn('core guard permission missing or renamed: ' + perm);
}
if ((manifest.host_permissions || []).includes('<all_urls>')) warn('<all_urls> host permission is powerful; keep sender checks and site allowlists tight');

const ruleResources = (manifest.declarative_net_request && manifest.declarative_net_request.rule_resources) || [];
if (ruleResources.length >= 3) ok('DNR rule resources configured: ' + ruleResources.length);
else warn('few DNR rule resources configured');
for (const rule of ruleResources) {
  if (rule && rule.path && exists(rule.path)) ok('DNR rule file exists: ' + rule.path);
  else fail('DNR rule file missing: ' + (rule && rule.path));
}

const bg = exists('background.js') ? read('background.js') : '';
const downloads = exists('background-downloads.js') ? read('background-downloads.js') : '';
const bridge = exists('bridge.js') ? read('bridge.js') : '';
if (includesAll(bg, ['messageSenderIsExtensionPage', 'messageSenderIsTab', 'TAB_CONTEXT_ALLOWED_MESSAGES', 'TAB_CONTEXT_RATE_LIMITS'])) {
  ok('background message handlers have sender-context gates and rate limits');
} else {
  fail('background message sender/rate-limit guard markers missing');
}
if (!/onMessageExternal/.test(bg)) ok('no runtime.onMessageExternal listener found');
else warn('runtime.onMessageExternal listener found; review external caller validation');
if (includesAll(bridge, ['safeBrowsingIntentAllowed', 'markTrustedSafeBrowsingEvent', 'No recent user intent for this reputation check'])) {
  ok('safe-browsing bridge relay is bound to recent user intent');
} else {
  fail('safe-browsing bridge relay is missing recent-user-intent gate');
}
if (includesAll(bg + '\n' + downloads, ['hardRemoveDownload', 'downloadHardBlockCritical', 'DOWNLOAD_HASH_SOURCE_KIND', 'url-refetch'])) {
  ok('Download Guard hard-block and URL-content hash metadata present');
} else {
  fail('Download Guard hard-block/hash-source markers missing');
}
if (bg.includes("importScripts('background-startup.js')") || bg.includes('importScripts("background-startup.js")')) ok('startup check module is imported');
else fail('background-startup.js import missing');
if (bg.includes("importScripts('background-memory.js')") || bg.includes('importScripts("background-memory.js")')) ok('Memory Shield module is imported');
else fail('background-memory.js import missing');
if (bg.includes("importScripts('background-downloads.js')") || bg.includes('importScripts("background-downloads.js")')) ok('Download Guard module is imported');
else fail('background-downloads.js import missing');

// Every script the extension actually loads, derived rather than typed. The old list was a
// hand-written allowlist of filenames, which meant a NEWLY ADDED content script was outside the
// dynamic-code scan by default -- and four already were: twitch-adblock.js (3,667 lines, MAIN
// world, all frames), twitch-rewind.js (ISOLATED, so it holds chrome.*), and the two lazily
// registered ones, search-junk.js and cryptominer-detect.js. None of them had a sink, so nothing
// was broken; but the scan is the control that keeps remotely-influenced data away from anything
// that executes, and a control with a silent blind spot is the thing worth fixing.
//
// content.min.js is deliberately excluded and covered a different way: build-content.js --check
// proves it rebuilds byte-exactly from src/content.js, which IS scanned, so a sink cannot reach
// the shipped artifact without first appearing in a file this list covers. Grepping minified text
// would only produce noise.
function declaredScripts() {
  const out = new Set();

  // Static content scripts, straight from the manifest.
  try {
    const manifest = JSON.parse(read('manifest.json'));
    for (const entry of manifest.content_scripts || []) {
      for (const file of entry.js || []) out.add(file);
    }
  } catch (e) {
    fail('could not read manifest content scripts: ' + e.message);
  }

  // Scripts registered at runtime instead of declared. These never appear in the manifest, so a
  // manifest-only derivation would reintroduce exactly the blind spot this replaces.
  try {
    const bgSrc = read('background.js');
    for (const m of bgSrc.matchAll(/js:\s*\[([^\]]*)\]/g)) {
      for (const q of m[1].matchAll(/['"]([^'"]+\.js)['"]/g)) out.add(q[1]);
    }
    for (const m of bgSrc.matchAll(/files:\s*\[([^\]]*)\]/g)) {
      for (const q of m[1].matchAll(/['"]([^'"]+\.js)['"]/g)) out.add(q[1]);
    }
  } catch (e) {
    fail('could not read background.js for registered scripts: ' + e.message);
  }

  return out;
}

// The extension pages and worker modules, which are not content scripts and so are not derivable.
const PAGE_AND_WORKER_JS = [
  'background.js',
  'background-startup.js',
  'background-memory.js',
  'background-downloads.js',
  'download-review.js',
  'popup.js',
  'history.js',
  'network.js',
  'onboarding.js',
  'cert-error.js',
  'safe-browsing-block.js',
  'redirect-warning.js',
  'src/content.js',
];

const declared = declaredScripts();
const readableJs = Array.from(new Set(
  PAGE_AND_WORKER_JS.concat(Array.from(declared)),
)).filter((f) => f !== 'content.min.js' && exists(f));

// The point of deriving the list is that nothing can quietly fall out of it, so say plainly when
// something does rather than scanning a shorter list without comment.
{
  const unscanned = Array.from(declared).filter((f) => f !== 'content.min.js' && !exists(f));
  if (unscanned.length) fail('declared script missing from disk, so unscanned: ' + unscanned.join(', '));
  else ok('dynamic-code scan covers every declared script (' + readableJs.length + ' files)');
}
;
const dynamic = scanDynamicCode(readableJs);
if (dynamic.severe.length) fail('dynamic code sinks found: ' + dynamic.severe.join('; '));
else ok('no eval/new Function/document.write sinks in readable JS files');
if (dynamic.markup.length) warn('markup sinks need static-only review: ' + dynamic.markup.join('; '));
else ok('no innerHTML/outerHTML/insertAdjacentHTML sinks in readable JS files');

if (exists('content.min.js') && !exists('content.min.js.map') && !exists('src/content.js')) {
  warn('content.min.js has no source map; security review remains harder than it should be');
}

if (failed) {
  console.error('[fail] security posture check failed with ' + failed + ' issue(s), ' + warned + ' warning(s)');
  process.exit(1);
}
console.log('[ok] security posture checks passed with ' + warned + ' warning(s)');

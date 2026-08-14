/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
const fs = require('fs');
const { spawnSync } = require('child_process');

const ROOT = process.cwd();
const failures = [];
const warnings = [];

function exists(file) {
  return fs.existsSync(file) && fs.statSync(file).isFile();
}

function read(file) {
  return fs.readFileSync(file, 'utf8');
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

function checkJson(file) {
  try {
    JSON.parse(read(file));
    console.log('[ok] json ' + file);
  } catch (e) {
    fail('Invalid JSON in ' + file + ': ' + e.message);
  }
}

function checkSyntax(file) {
  if (!exists(file)) {
    fail('Missing JS file: ' + file);
    return;
  }
  const res = spawnSync(process.execPath, ['--check', file], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    fail('Syntax check failed for ' + file + ': ' + (res.stderr || res.stdout || '').trim());
    return;
  }
  console.log('[ok] syntax ' + file);
}

function checkCommand(label, args) {
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    fail(label + ' failed: ' + (res.stderr || res.stdout || '').trim());
    return;
  }
  console.log('[ok] ' + label);
}

function extractImportScripts(file) {
  const source = read(file);
  const out = [];
  const re = /importScripts\s*\(([^)]*)\)/g;
  let match;
  while ((match = re.exec(source))) {
    const args = match[1];
    const q = /['"]([^'"]+)['"]/g;
    let item;
    while ((item = q.exec(args))) out.push(item[1]);
  }
  return out;
}

function checkImports(file) {
  const imports = extractImportScripts(file);
  for (const imported of imports) {
    if (!exists(imported)) fail(file + ' imports missing file: ' + imported);
    else console.log('[ok] import ' + file + ' -> ' + imported);
  }
}

function arrayJsonLength(file) {
  const parsed = JSON.parse(read(file));
  if (!Array.isArray(parsed)) throw new Error(file + ' is not a JSON array');
  return parsed.length;
}

function numberConstant(file, name) {
  const source = read(file);
  const match = source.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\d+)\\s*;'));
  if (!match) throw new Error('Missing constant ' + name + ' in ' + file);
  return Number(match[1]);
}

function checkRuleCount(constName, jsonFile) {
  try {
    const actual = arrayJsonLength(jsonFile);
    const declared = numberConstant('background.js', constName);
    if (actual !== declared) {
      fail(constName + ' is ' + declared + ' but ' + jsonFile + ' contains ' + actual + ' rules');
      return;
    }
    console.log('[ok] rule count ' + constName + ' = ' + actual);
  } catch (e) {
    fail(e.message);
  }
}

function lineCount(file) {
  return read(file).split(/\r?\n/).length;
}

function checkContentMinProvenance() {
  if (!exists('content.min.js')) {
    fail('Missing content.min.js');
    return;
  }
  const source = read('content.min.js');
  const lines = lineCount('content.min.js');
  const hasMap = /sourceMappingURL=/.test(source);
  const hasObviousSource = exists('src/content.js') || exists('content.js') || fs.existsSync('src');
  console.log('[info] content.min.js lines=' + lines + ' bytes=' + fs.statSync('content.min.js').size);
  if (lines <= 2 && !hasMap && !hasObviousSource) {
    warn('content.min.js is still a minified runtime artifact with no source map or src/ source tree. Keep changes minimal until original source/build is restored.');
  }
}

function checkContentBuild() {
  if (!exists('src/content.js')) {
    fail('Missing src/content.js source for content.min.js');
    return;
  }
  const res = spawnSync(process.execPath, ['tools/build-content.js', '--check'], { cwd: ROOT, encoding: 'utf8' });
  if (res.status !== 0) {
    fail('content source build check failed: ' + (res.stderr || res.stdout || '').trim());
    return;
  }
  console.log('[ok] content source rebuilds content.min.js exactly');
}

[
  'background.js',
  'background-startup.js',
  'background-memory.js',
  'background-downloads.js',
  'bridge.js',
  'popup.js',
  'onboarding.js',
  'download-review.js',
  'eyeshield.js',
  'twitch-adblock.js',
  'twitch-rewind.js',
  'twitch-vod-rewind.js',
  'cryptominer-detect.js',
  'search-junk.js',
  'content.min.js',
  'src/content.js',
  'tools/build-content.js',
  'tools/harden-static-dnr.js',
  'tools/check-security-posture.js',
  'tools/test-memory-shield.js',
  'tools/test-download-guard.js',
  'tools/test-dynamic-registrations.js',
  'tools/test-consent-reject.js',
  'tools/test-privacy-disclosure.js',
  'tools/test-engine-config-ownership.js',
  'tools/test-permission-chain-trust.js',
  'tools/test-warning-dialogs.js',
  'tools/test-phishing-false-positives.js',
  'tools/test-eyeshield-readability.js',
  'tools/test-protection-health.js',
  'tools/test-twitch-adblock.js',
  'tools/test-twitch-failopen.js',
  'tools/test-twitch-playlist-compatibility.js',
  'tools/test-twitch-rewind.js',
  'tools/test-twitch-vod-rewind.js',
  'tools/test-onboarding-bundles.js',
  'tools/serve-rewind-harness.js',
  'tools/test-runtime-idempotence.js',
  'tools/test-runtime-config-lifecycle.js',
  'tools/test-network-compatibility.js',
  'tools/test-smart-script-recovery.js',
  'tools/test-script-popup-shield.js',
  'tools/test-site-compatibility.js',
  'tools/test-streaming-compatibility.js',
  'tools/test-token-exfil-trust.js',
  'tools/test-oauth-guard.js',
  'tools/test-cryptominer-guard.js',
  'tools/test-safe-search.js',
  'tools/test-search-junk.js',
  'tools/test-insecure-login.js',
  'tools/test-session-score.js',
  'tools/test-settings-io.js',
  'tools/test-popup-config-merge.js',
  'tools/test-reputation-fetch.js',
  'tools/test-shared-dom-watcher.js',
  'tools/test-popup-contrast.js',
  'tools/test-popup-labels.js',
  'tools/test-message-rate-limits.js',
  'tools/test-repair-honesty.js',
  'tools/test-engine-teardown.js',
  'tools/test-bridge-host-lists.js',
  'tools/test-verification-compatibility.js',
  'tools/test-bridge-bounds.js',
  'tools/test-message-hardening.js',
  'tools/test-secret-hygiene.js',
  'tools/test-history-privacy.js',
  'tools/test-static-dnr-compatibility.js',
  'tools/test-dnr-budget.js',
  'tools/test-x-compatibility.js',
  'tools/test-behavioral-false-positives.js',
  // Suites that existed but were never referenced here. They cover engine test-shim isolation,
  // guard lifecycle and re-injection, JSON-prune stacking, page ownership of closed-shadow UI,
  // worker/state recovery, quota pruning, engine start-up and cosmetic-feed provenance -- all
  // regression areas created by earlier fixes in this audit, and all previously unenforced.
  'tools/test-cosmetic-provenance.js',
  'tools/test-engine-ambient.js',
  'tools/test-engine-startup.js',
  'tools/test-guard-lifecycle.js',
  'tools/test-json-prune-stacking.js',
  'tools/test-owned-ui.js',
  'tools/test-stale-state.js',
  'tools/test-storage-prune-ladder.js',
  // Shipped root scripts. Several of these were only ever parsed incidentally, by whichever
  // behavioural test happened to read them -- and a test that regex-reads a file has not parsed it.
  // A syntax error in any of them shipped without the gate noticing.
  'anti-redirect.js',
  'cert-error.js',
  'consent-reject.js',
  'domain-utils.js',
  'history.js',
  'network.js',
  'oauth-guard.js',
  'permission-chain.js',
  'redirect-warning.js',
  'safe-browsing-block.js',
  'yt-adblock.js',
].forEach(checkSyntax);

[
  'manifest.json',
  'rules.json',
  'rules-trackers.json',
  'rules-easyprivacy.json',
  'rules-adshield.json',
  'malware-hashes.json',
  'grabber-extra.json',
  'cryptominer-domains.json',
  'search-junk-domains.json',
  'supplemental-manifest.json',
].forEach(checkJson);

checkImports('background.js');
checkRuleCount('STATIC_RULE_COUNT', 'rules.json');
checkRuleCount('ADSHIELD_STATIC_RULE_COUNT', 'rules-adshield.json');
checkContentMinProvenance();
checkContentBuild();
checkCommand('security posture checks', ['tools/check-security-posture.js']);
checkCommand('memory shield tests', ['tools/test-memory-shield.js']);
checkCommand('static DNR hardening check', ['tools/harden-static-dnr.js', '--check']);
checkCommand('static DNR compatibility tests', ['tools/test-static-dnr-compatibility.js']);
checkCommand('DNR static rule budget', ['tools/test-dnr-budget.js']);
checkCommand('bridge payload bound tests', ['tools/test-bridge-bounds.js']);
checkCommand('bridge host list tests', ['tools/test-bridge-host-lists.js']);
checkCommand('hostile message hardening tests', ['tools/test-message-hardening.js']);
checkCommand('message rate limit tests', ['tools/test-message-rate-limits.js']);
checkCommand('secret hygiene tests', ['tools/test-secret-hygiene.js']);
checkCommand('history privacy tests', ['tools/test-history-privacy.js']);
checkCommand('runtime config lifecycle tests', ['tools/test-runtime-config-lifecycle.js']);
checkCommand('network compatibility tests', ['tools/test-network-compatibility.js']);
checkCommand('Smart Script Shield recovery tests', ['tools/test-smart-script-recovery.js']);
checkCommand('site compatibility tests', ['tools/test-site-compatibility.js']);
checkCommand('streaming compatibility tests', ['tools/test-streaming-compatibility.js']);
checkCommand('token destination trust tests', ['tools/test-token-exfil-trust.js']);
checkCommand('OAuth guard tests', ['tools/test-oauth-guard.js']);
checkCommand('cryptominer guard tests', ['tools/test-cryptominer-guard.js']);
checkCommand('SafeSearch enforcement tests', ['tools/test-safe-search.js']);
checkCommand('search-junk marker tests', ['tools/test-search-junk.js']);
checkCommand('session security scoring tests', ['tools/test-session-score.js']);
checkCommand('insecure sign-in guard tests', ['tools/test-insecure-login.js']);
checkCommand('settings export/import tests', ['tools/test-settings-io.js']);
checkCommand('popup config merge tests', ['tools/test-popup-config-merge.js']);
checkCommand('reputation fetch tests', ['tools/test-reputation-fetch.js']);
checkCommand('shared DOM watcher tests', ['tools/test-shared-dom-watcher.js']);
checkCommand('popup contrast tests', ['tools/test-popup-contrast.js']);
checkCommand('popup label tests', ['tools/test-popup-labels.js']);
checkCommand('verification compatibility tests', ['tools/test-verification-compatibility.js']);
checkCommand('download guard tests', ['tools/test-download-guard.js']);
checkCommand('dynamic registration tests', ['tools/test-dynamic-registrations.js']);
checkCommand('repair honesty tests', ['tools/test-repair-honesty.js']);
checkCommand('engine teardown tests', ['tools/test-engine-teardown.js']);
checkCommand('consent reject tests', ['tools/test-consent-reject.js']);
// Previously orphaned suites. All eight passed when run by hand, which was precisely the danger:
// the source was fine, so nothing drew attention to the fact that nothing was checking it.
checkCommand('engine ambient tests', ['tools/test-engine-ambient.js']);
checkCommand('engine start-up tests', ['tools/test-engine-startup.js']);
checkCommand('guard lifecycle tests', ['tools/test-guard-lifecycle.js']);
checkCommand('JSON-prune stacking tests', ['tools/test-json-prune-stacking.js']);
checkCommand('owned-UI tests', ['tools/test-owned-ui.js']);
checkCommand('stale-state tests', ['tools/test-stale-state.js']);
checkCommand('storage prune ladder tests', ['tools/test-storage-prune-ladder.js']);
checkCommand('cosmetic provenance tests', ['tools/test-cosmetic-provenance.js']);
checkCommand('permission-chain trust tests', ['tools/test-permission-chain-trust.js']);
checkCommand('warning dialog tests', ['tools/test-warning-dialogs.js']);
checkCommand('phishing false-positive tests', ['tools/test-phishing-false-positives.js']);
checkCommand('behavioural false-positive tests', ['tools/test-behavioral-false-positives.js']);
checkCommand('google cleanup tests', ['tools/test-google-cleanup.js']);
checkCommand('payment card guard tests', ['tools/test-payment-card-guard.js']);
checkCommand('clean copy tests', ['tools/test-clean-copy.js']);
checkCommand('IP privacy tests', ['tools/test-ip-privacy.js']);
checkCommand('location guard tests', ['tools/test-location-guard.js']);
checkCommand('supplemental list tests', ['tools/test-supplemental-lists.js']);
checkCommand('adult gate tests', ['tools/test-adult-gate.js']);
checkCommand('EyeShield readability tests', ['tools/test-eyeshield-readability.js']);
checkCommand('protection health tests', ['tools/test-protection-health.js']);
checkCommand('Twitch adblock tests', ['tools/test-twitch-adblock.js']);
checkCommand('Twitch fail-open tests', ['tools/test-twitch-failopen.js']);
checkCommand('Twitch playlist compatibility tests', ['tools/test-twitch-playlist-compatibility.js']);
checkCommand('Twitch rewind tests', ['tools/test-twitch-rewind.js']);
checkCommand('Twitch VOD rewind tests', ['tools/test-twitch-vod-rewind.js']);
checkCommand('onboarding bundle tests', ['tools/test-onboarding-bundles.js']);
checkCommand('runtime idempotence tests', ['tools/test-runtime-idempotence.js']);
checkCommand('anti redirect tests', ['tools/test-anti-redirect.js']);
checkCommand('script/ad popup shield tests', ['tools/test-script-popup-shield.js']);
checkCommand('X compatibility tests', ['tools/test-x-compatibility.js']);
checkCommand('YouTube adblock tests', ['tools/test-yt-adblock.js']);
checkCommand('YouTube prune tests', ['tools/test-yt-prune.js']);

// ---------------------------------------------------------------------------
// Coverage meta-checks (M15).
//
// Eight suites and eleven shipped scripts had drifted outside this gate. Nothing was failing --
// running the orphans by hand passed -- but a future regression in any of them would have left the
// official gate green, which is the whole problem: a suite nobody runs is worse than no suite,
// because it looks like coverage.
//
// Adding them to the lists above fixes today. These checks fix tomorrow: they read the filesystem
// and fail when anything is neither covered nor deliberately excluded, so the next file added
// cannot quietly escape. A hand-maintained list is what drifted; a second hand-maintained list
// would drift the same way.
// ---------------------------------------------------------------------------
const gateSource = read('tools/check-maintainability.js') || '';

// Suites that exist but are neither syntax-checked nor executed here.
{
  const onDisk = fs.readdirSync('tools')
    .filter((f) => /^test-.*\.js$/.test(f))
    .map((f) => 'tools/' + f);
  const orphans = onDisk.filter((f) => !gateSource.includes("'" + f + "'"));
  if (orphans.length) {
    fail('test suites not wired into the gate: ' + orphans.join(', '));
  } else {
    console.log('[ok] every tools/test-*.js is wired into the gate (' + onDisk.length + ' suites)');
  }
}

// Shipped root JavaScript that is never syntax-checked. content.min.js is generated and gets its
// own provenance and build checks; everything else must be parsed here.
{
  const GENERATED = new Set(['content.min.js']);
  const shipped = fs.readdirSync('.')
    .filter((f) => /\.js$/.test(f) && !GENERATED.has(f));
  const unchecked = shipped.filter((f) => !gateSource.includes("'" + f + "'"));
  if (unchecked.length) {
    fail('shipped scripts with no syntax check: ' + unchecked.join(', '));
  } else {
    console.log('[ok] every shipped root script is syntax-checked (' + shipped.length + ' files)');
  }
}

// Every content script the manifest actually loads must be one of the files above. A script can be
// shipped, listed in the manifest, and still never parsed here if it lives outside the repo root.
{
  let manifest = null;
  try { manifest = JSON.parse(read('manifest.json') || '{}'); } catch (_) {}
  const declared = new Set();
  for (const entry of (manifest && manifest.content_scripts) || []) {
    for (const file of entry.js || []) declared.add(file);
  }
  const missing = [...declared].filter((f) => f !== 'content.min.js' && !gateSource.includes("'" + f + "'"));
  if (missing.length) {
    fail('manifest content scripts with no syntax check: ' + missing.join(', '));
  } else {
    console.log('[ok] every manifest content script is syntax-checked (' + declared.size + ' declared)');
  }
}

console.log('[info] background.js lines=' + lineCount('background.js'));
console.log('[info] background-startup.js lines=' + lineCount('background-startup.js'));
console.log('[info] background-memory.js lines=' + lineCount('background-memory.js'));
console.log('[info] background-downloads.js lines=' + lineCount('background-downloads.js'));

warnings.forEach((message) => console.warn('[warn] ' + message));

if (failures.length) {
  failures.forEach((message) => console.error('[fail] ' + message));
  process.exit(1);
}

console.log('[ok] maintainability checks passed');

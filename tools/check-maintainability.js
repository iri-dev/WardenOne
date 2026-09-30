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

const requiredNodeMajor = Number(read('.node-version').trim());
if (!Number.isInteger(requiredNodeMajor) || Number(process.versions.node.split('.')[0]) !== requiredNodeMajor) {
  fail('Use Node ' + (Number.isInteger(requiredNodeMajor) ? requiredNodeMajor : 'from .node-version')
    + ' for this gate; running ' + process.version);
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
  'background-extension-watch.js',
  'background-extension-reputation.js',
  'background-memory.js',
  'background-downloads.js',
  'bridge.js',
  'popup.js',
  'popup-health.js',
  'popup-diagnostics.js',
  'popup-settings-search.js',
  'notifications.js',
  'notification-schema.js',
  'notification-manager.js',
  'offscreen.js',
  'extensions.js',
  'theme.js',
  'onboarding.js',
  'download-review.js',
  'eyeshield.js',
  'eyeshield-sites.js',
  'eyeshield-preload-dark.js',
  'eyeshield-preload-ultra.js',
  'eyeshield-preload-light.js',
  'twitch-adblock.js',
  'twitch-rewind.js',
  'twitch-vod-rewind.js',
  'cryptominer-detect.js',
  'search-junk.js',
  'search-loggers.js',
  'command-palette.js',
  'privacy-probe.js',
  'privacy-test.js',
  'mail-shield.js',
  'firewall.js',
  'content.min.js',
  'src/content.js',
  'tools/build-content.js',
  'tools/harden-static-dnr.js',
  'tools/check-security-posture.js',
  'tools/check-feeds.js',
  'tools/test-memory-shield.js',
  'tools/test-download-guard.js',
  'tools/test-extension-change-watch.js',
  'tools/test-extension-reputation.js',
  'tools/test-dynamic-registrations.js',
  'tools/test-consent-reject.js',
  'tools/test-consent-wall.js',
  'tools/test-protection-count.js',
  'tools/test-engine-watchdog.js',
  'tools/test-file-access-guard.js',
  'tools/test-speech-guard.js',
  'tools/test-media-shield-presence.js',
  'tools/test-tracker-frame-guard.js',
  'tools/test-transport-shield.js',
  'tools/test-dns-rebind-guard.js',
  'tools/test-ip-classifier-agreement.js',
  'tools/test-webgpu-shield.js',
  'tools/test-storage-access-guard.js',
  'tools/test-worker-realm-guard.js',
  'tools/test-keyboard-lock-guard.js',
  'tools/test-fingerprint-surfaces.js',
  'tools/test-payment-frame-origin.js',
  'tools/test-overlay-evidence.js',
  'tools/test-background-scope.js',
  'tools/test-toast-mutes.js',
  'tools/test-tracker-cookie-rule.js',
  'tools/test-known-limits.js',
  'tools/test-extension-verdicts.js',
  'tools/test-privacy-disclosure.js',
  'tools/test-pwned-password-check.js',
  'tools/test-header-shield.js',
  'tools/test-xss-behavior-guard.js',
  'tools/test-xss-sink-cost.js',
  'tools/bench-xss-sinks.js',
  'tools/test-xss-event-boundary.js',
  'tools/test-clickfix-guard.js',
  'tools/test-scam-lock.js',
  'tools/test-engine-config-ownership.js',
  'tools/test-engine-config-source.js',
  'tools/test-permission-chain-trust.js',
  'tools/test-optional-history-permission.js',
  'tools/test-warning-dialogs.js',
  'tools/test-phishing-false-positives.js',
  'tools/test-phishing-differential.js',
  'tools/test-phishing-path-intent.js',
  'tools/test-element-picker.js',
  'tools/test-engine-mutation-cost.js',
  'tools/test-youtube-compat.js',
  'tools/test-learned-grabber-scope.js',
  'tools/test-manual-check-toast.js',
  'tools/test-manual-check-journal.js',
  'tools/test-store-candidate.js',
  'tools/test-store-rights.js',
  'tools/test-blocked-site-list.js',
  'tools/test-user-filters.js',
  'tools/test-network-logger.js',
  'tools/test-file-shield.js',
  'tools/test-mail-shield.js',
  'tools/test-firewall.js',
  'tools/test-extension-check.js',
  'tools/test-badge-yield.js',
  'tools/test-media-scan-timing.js',
  'tools/test-hot-path-layout.js',
  'tools/test-user-blocklist.js',
  'tools/test-autofill-trap.js',
  'tools/test-search-result-warnings.js',
  'tools/test-link-ping-strip.js',
  'tools/test-history-url-clean.js',
  'tools/test-bounce-purge.js',
  'tools/test-media-capability-fp.js',
  'tools/test-keyboard-shortcuts.js',
  'tools/test-privacy-test.js',
  'tools/test-command-palette.js',
  'tools/test-copy-clean-link.js',
  'tools/test-eyeshield-visited.js',
  'tools/test-eyeshield-readability.js',
  'tools/test-eyeshield-yt-player.js',
  'tools/test-eyeshield-native-site-themes.js',
  'tools/test-eyeshield-preload-hint.js',
  'tools/test-protection-health.js',
  'tools/test-diagnostics-export.js',
  'tools/test-list-publisher-dates.js',
  'tools/test-health-extension-drop.js',
  'tools/test-twitch-adblock.js',
  'tools/test-spotify-adblock.js',
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
  'tools/test-frame-popup-backstop.js',
  'tools/test-site-compatibility.js',
  'tools/test-streaming-compatibility.js',
  'tools/test-token-exfil-trust.js',
  'tools/test-token-exfil-issued-links.js',
  'tools/test-oauth-guard.js',
  'tools/test-cryptominer-guard.js',
  'tools/test-miner-realms.js',
  'tools/test-cert-guard-toctou.js',
  'tools/test-state-serialization.js',
  'tools/test-cold-start-state.js',
  'tools/test-download-ownership.js',
  'tools/test-bounded-fetch.js',
  'tools/test-instrumentation-hygiene.js',
  'tools/test-source-inventory.js',
  'tools/test-blocker-teardown.js',
  'tools/build-source-inventory.js',
  'tools/build-psl.js',
  'tools/build-store-package.js',
  'tools/test-safe-search.js',
  'tools/test-search-junk.js',
  'tools/test-insecure-login.js',
  'tools/test-session-score.js',
  'tools/test-settings-io.js',
  'tools/test-popup-config-merge.js',
  'tools/test-reputation-fetch.js',
  'tools/test-keyed-provider-consent.js',
  'tools/test-request-self-identification.js',
  'tools/test-shared-dom-watcher.js',
  'tools/test-popup-contrast.js',
  'tools/test-phishing-confidence.js',
  'tools/test-popup-search.js',
  'tools/test-theme.js',
  'tools/test-popup-labels.js',
  'tools/test-message-rate-limits.js',
  'tools/test-repair-honesty.js',
  'tools/test-engine-teardown.js',
  'tools/test-bridge-host-lists.js',
  'tools/test-main-config-minimisation.js',
  'tools/test-verification-compatibility.js',
  'tools/test-bridge-bounds.js',
  'tools/test-message-hardening.js',
  'tools/test-secret-hygiene.js',
  'tools/test-history-privacy.js',
  'tools/test-privacy-data-erase.js',
  'tools/test-static-dnr-compatibility.js',
  'tools/test-dnr-budget.js',
  'tools/test-dnr-atomic-replace.js',
  'tools/test-listener-census.js',
  'tools/test-silent-mode-roundtrip.js',
  'tools/test-health-tab-evidence.js',
  'tools/test-rule-cap-honesty.js',
  'tools/test-cold-wake-writes.js',
  'tools/test-redirect-chain-mirror.js',
  'tools/test-feed-load-safety.js',
  'tools/test-nav-signal-forgery.js',
  'tools/test-redirect-interstitial-forgery.js',
  'tools/test-main-world-key-isolation.js',
  'tools/test-content-config-memo.js',
  'tools/test-logger-redaction.js',
  'tools/test-message-reachability.js',
  'tools/test-list-fetch-broker.js',
  'tools/test-history-retention.js',
  'tools/test-listener-registration.js',
  'tools/test-logger-batch-reset.js',
  'tools/test-x-compatibility.js',
  'tools/test-behavioral-false-positives.js',
  // Suites that existed but were never referenced here. They cover engine test-shim isolation,
  // guard lifecycle and re-injection, JSON-prune stacking, page ownership of closed-shadow UI,
  // worker/state recovery, quota pruning, engine start-up and cosmetic-feed provenance -- all
  // regression areas created by earlier fixes in this audit, and all previously unenforced.
  'tools/test-cosmetic-provenance.js',
  'tools/test-compat-host-scope.js',
  'tools/test-blocker-durability.js',
  'tools/test-warning-ownership.js',
  'tools/test-tracker-learner-trust.js',
  'tools/test-frame-scope-disclosure.js',
  'tools/test-frame-credential-guard.js',
  'tools/test-site-identity.js',
  'tools/test-tenant-isolation.js',
  'tools/test-tracker-learner-minimisation.js',
  'tools/test-store-profile.js',
  'tools/test-location-site-exceptions.js',
  'tools/test-on-leave-durability.js',
  'tools/test-search-junk-seed.js',
  'tools/test-text-scan-scheduler.js',
  'tools/test-fingerprint-realm.js',
  'tools/test-confirm-bait-linked-overlay.js',
  'tools/test-config-handshake-recovery.js',
  'tools/test-incognito-isolation.js',
  'tools/test-download-false-positives.js',
  'tools/test-cookie-cleaner.js',
  'tools/test-permission-sweep.js',
  'tools/test-default-agreement.js',
  'tools/test-device-access-guard.js',
  'tools/test-capability-guards.js',
  'tools/test-notification-guard.js',
  'tools/test-notification-center.js',
  'tools/test-system-notification-privacy.js',
  'tools/test-offscreen-lifecycle.js',
  'tools/test-fake-window-guard.js',
  'tools/test-fullscreen-guard.js',
  'tools/test-site-controls.js',
  'tools/test-toast-dedupe.js',
  'tools/test-download-links.js',
  'tools/test-health-honesty.js',
  'tools/test-eyeshield-fetch-scope.js',
  // Compares what the extension loads against what `git archive` ships. The staged store ZIP was
  // missing cosmetic-rules.json while every other check was green, because nothing compared them.
  'tools/test-package-completeness.js',
  'tools/test-engine-ambient.js',
  'tools/test-engine-startup.js',
  'tools/test-guard-lifecycle.js',
  'tools/test-json-prune-stacking.js',
  'tools/test-owned-ui.js',
  'tools/test-context-checks.js',
  'tools/test-stale-state.js',
  'tools/test-storage-prune-ladder.js',
  'tools/test-reconcile-one-list.js',
  'tools/test-reconcile-dnr-batch.js',
  'tools/test-detectability-budget.js',
  'tools/test-perf-profile.js',
  'tools/perf-profile.js',
  // Shipped root scripts. Several of these were only ever parsed incidentally, by whichever
  // behavioural test happened to read them -- and a test that regex-reads a file has not parsed it.
  // A syntax error in any of them shipped without the gate noticing.
  'anti-redirect.js',
  'fingerprint-realm.js',
  'cert-error.js',
  'consent-reject.js',
  'consent-wall.js',
  'domain-utils.js',
  'psl-private.js',
  'build-profile.js',
  'element-picker.js',
  'history.js',
  'hidden-elements.js',
  'logger.js',
  'file-shield.js',
  'network.js',
  'oauth-guard.js',
  'permission-chain.js',
  'redirect-warning.js',
  'safe-browsing-block.js',
  'yt-adblock.js',
  'spotify-adblock.js',
].forEach(checkSyntax);

[
  'manifest.json',
  'rules.json',
  'rules-trackers.json',
  'rules-easyprivacy.json',
  'rules-adshield.json',
  'rules-spotify-media.json',
  'malware-hashes.json',
  'grabber-extra.json',
  'cryptominer-domains.json',
  'search-junk-domains.json',
  'supplemental-manifest.json',
  'extension-reputation.json',
].forEach(checkJson);

checkImports('background.js');
checkRuleCount('STATIC_RULE_COUNT', 'rules.json');
checkRuleCount('ADSHIELD_STATIC_RULE_COUNT', 'rules-adshield.json');
checkContentMinProvenance();
checkContentBuild();
checkCommand('security posture checks', ['tools/check-security-posture.js']);
checkCommand('README document links', ['tools/check-readme-doc-links.js']);
checkCommand('README link staging tests', ['tools/test-readme-doc-links.js']);
checkCommand('repository hygiene', ['tools/check-repository-hygiene.js']);
checkCommand('repository hygiene tests', ['tools/test-repository-hygiene.js']);
checkCommand('package performance budget', ['tools/check-performance-budget.js']);
checkCommand('performance budget tests', ['tools/test-performance-budget.js']);
checkCommand('memory shield tests', ['tools/test-memory-shield.js']);
checkCommand('static DNR hardening check', ['tools/harden-static-dnr.js', '--check']);
/* The harness embeds a copy of the shipped toast block so it opens by double-click
   rather than needing a server. A copy can go stale, and nothing was checking this
   one -- so a toast added to the engine could be missing from the page used to test
   toast timings, with nothing to say so.

   Guarded on presence: both files are local-only and absent from a fresh clone,
   because the page and its builder only make sense as a pair and neither is
   shipped. CI has neither, so an unguarded check fails there for a file the repo
   is not supposed to contain -- which is exactly what happened when this was
   added without the guard. */
if (exists('tools/build-toast-harness.js') && exists('tools/toast-harness.html')) {
  checkCommand('toast harness matches the shipped toast block', ['tools/build-toast-harness.js', '--check']);
} else {
  console.log('[skip] toast harness is not present in this checkout');
}
checkCommand('static DNR compatibility tests', ['tools/test-static-dnr-compatibility.js']);
checkCommand('DNR static rule budget', ['tools/test-dnr-budget.js']);
checkCommand('DNR atomic rule replacement tests', ['tools/test-dnr-atomic-replace.js']);
checkCommand('tabs.onUpdated listener census', ['tools/test-listener-census.js']);
checkCommand('Silent mode round-trip tests', ['tools/test-silent-mode-roundtrip.js']);
checkCommand('protection health tab-evidence tests', ['tools/test-health-tab-evidence.js']);
checkCommand('rule cap honesty tests', ['tools/test-rule-cap-honesty.js']);
checkCommand('cold-wake write tests', ['tools/test-cold-wake-writes.js']);
checkCommand('redirect-chain mirror tests', ['tools/test-redirect-chain-mirror.js']);
checkCommand('feed load safety tests', ['tools/test-feed-load-safety.js']);
checkCommand('navigation signal forgery tests', ['tools/test-nav-signal-forgery.js']);
checkCommand('redirect interstitial forgery tests', ['tools/test-redirect-interstitial-forgery.js']);
checkCommand('MAIN-world key isolation and signed signal tests', ['tools/test-main-world-key-isolation.js']);
checkCommand('content config memo tests', ['tools/test-content-config-memo.js']);
checkCommand('logger redaction tests', ['tools/test-logger-redaction.js']);
checkCommand('message reachability tests', ['tools/test-message-reachability.js']);
checkCommand('list fetch broker tests', ['tools/test-list-fetch-broker.js']);
checkCommand('history retention tests', ['tools/test-history-retention.js']);
checkCommand('listener registration tests', ['tools/test-listener-registration.js']);
checkCommand('logger batch reset tests', ['tools/test-logger-batch-reset.js']);
checkCommand('bridge payload bound tests', ['tools/test-bridge-bounds.js']);
checkCommand('bridge host list tests', ['tools/test-bridge-host-lists.js']);
checkCommand('MAIN config minimisation tests', ['tools/test-main-config-minimisation.js']);
checkCommand('hostile message hardening tests', ['tools/test-message-hardening.js']);
checkCommand('message rate limit tests', ['tools/test-message-rate-limits.js']);
checkCommand('secret hygiene tests', ['tools/test-secret-hygiene.js']);
checkCommand('history privacy tests', ['tools/test-history-privacy.js']);
checkCommand('Header Shield tests', ['tools/test-header-shield.js']);
checkCommand('Fraud-vendor script tests', ['tools/test-fraud-vendor-scripts.js']);
checkCommand('Fake Window scan-cost tests', ['tools/test-fake-window-scan-cost.js']);
checkCommand('Eye Shield site-split tests', ['tools/test-eyeshield-site-split.js']);
checkCommand('Eye Shield preload-hint tests', ['tools/test-eyeshield-preload-hint.js']);
checkCommand('Engine allowlist honesty tests', ['tools/test-engine-allowlist-honesty.js']);
checkCommand('Logger reconnect tests', ['tools/test-logger-reconnect.js']);
checkCommand('Script Drift storage tests', ['tools/test-script-drift-storage.js']);
checkCommand('Permission justification tests', ['tools/test-permission-justification.js']);
checkCommand('Optional history permission tests', ['tools/test-optional-history-permission.js']);
checkCommand('XSS Behavior Guard tests', ['tools/test-xss-behavior-guard.js']);
checkCommand('XSS sink cost tests', ['tools/test-xss-sink-cost.js']);
checkCommand('XSS event-boundary tests', ['tools/test-xss-event-boundary.js']);
checkCommand('ClickFix guard tests', ['tools/test-clickfix-guard.js']);
checkCommand('Scam Lock tests', ['tools/test-scam-lock.js']);
checkCommand('runtime config lifecycle tests', ['tools/test-runtime-config-lifecycle.js']);
checkCommand('network compatibility tests', ['tools/test-network-compatibility.js']);
checkCommand('Smart Script Shield recovery tests', ['tools/test-smart-script-recovery.js']);
checkCommand('site compatibility tests', ['tools/test-site-compatibility.js']);
checkCommand('streaming compatibility tests', ['tools/test-streaming-compatibility.js']);
checkCommand('token destination trust tests', ['tools/test-token-exfil-trust.js']);
checkCommand('token guard issued-link tests', ['tools/test-token-exfil-issued-links.js']);
checkCommand('OAuth guard tests', ['tools/test-oauth-guard.js']);
checkCommand('cryptominer guard tests', ['tools/test-cryptominer-guard.js']);
checkCommand('miner MAIN/ISOLATED realm tests', ['tools/test-miner-realms.js']);
checkCommand('certificate guard navigation tests', ['tools/test-cert-guard-toctou.js']);
checkCommand('state serialization tests', ['tools/test-state-serialization.js']);
checkCommand('cold-start state tests', ['tools/test-cold-start-state.js']);
checkCommand('download ownership tests', ['tools/test-download-ownership.js']);
checkCommand('bounded fetch tests', ['tools/test-bounded-fetch.js']);
checkCommand('instrumentation hygiene tests', ['tools/test-instrumentation-hygiene.js']);
checkCommand('source inventory is current', ['tools/build-source-inventory.js', '--check']);
checkCommand('source inventory tests', ['tools/test-source-inventory.js']);
checkCommand('blocker teardown tests', ['tools/test-blocker-teardown.js']);
checkCommand('SafeSearch enforcement tests', ['tools/test-safe-search.js']);
checkCommand('search-junk marker tests', ['tools/test-search-junk.js']);
checkCommand('search-loggers.js is current against rules.json', ['tools/build-search-loggers.js', '--check']);
checkCommand('session security scoring tests', ['tools/test-session-score.js']);
checkCommand('insecure sign-in guard tests', ['tools/test-insecure-login.js']);
checkCommand('settings export/import tests', ['tools/test-settings-io.js']);
checkCommand('popup config merge tests', ['tools/test-popup-config-merge.js']);
checkCommand('reputation fetch tests', ['tools/test-reputation-fetch.js']);
checkCommand('keyed provider consent tests', ['tools/test-keyed-provider-consent.js']);
checkCommand('request self-identification tests', ['tools/test-request-self-identification.js']);
checkCommand('shared DOM watcher tests', ['tools/test-shared-dom-watcher.js']);
checkCommand('popup contrast tests', ['tools/test-popup-contrast.js']);
checkCommand('popup settings-search tests', ['tools/test-popup-search.js']);
checkCommand('shared extension theme tests', ['tools/test-theme.js']);
checkCommand('popup label tests', ['tools/test-popup-labels.js']);
checkCommand('verification compatibility tests', ['tools/test-verification-compatibility.js']);
checkCommand('download guard tests', ['tools/test-download-guard.js']);
checkCommand('extension change watcher tests', ['tools/test-extension-change-watch.js']);
checkCommand('extension reputation tests', ['tools/test-extension-reputation.js']);
checkCommand('dynamic registration tests', ['tools/test-dynamic-registrations.js']);
checkCommand('repair honesty tests', ['tools/test-repair-honesty.js']);
checkCommand('engine teardown tests', ['tools/test-engine-teardown.js']);
checkCommand('consent reject tests', ['tools/test-consent-reject.js']);
checkCommand('consent wall tests', ['tools/test-consent-wall.js']);
checkCommand('protection count tests', ['tools/test-protection-count.js']);
checkCommand('engine watchdog tests', ['tools/test-engine-watchdog.js']);
checkCommand('file access guard tests', ['tools/test-file-access-guard.js']);
checkCommand('speech guard tests', ['tools/test-speech-guard.js']);
checkCommand('Media Shield presence tests', ['tools/test-media-shield-presence.js']);
checkCommand('tracker frame guard tests', ['tools/test-tracker-frame-guard.js']);
checkCommand('transport shield tests', ['tools/test-transport-shield.js']);
checkCommand('DNS rebind guard tests', ['tools/test-dns-rebind-guard.js']);
checkCommand('IP classifier agreement tests', ['tools/test-ip-classifier-agreement.js']);
checkCommand('WebGPU shield tests', ['tools/test-webgpu-shield.js']);
checkCommand('storage access guard tests', ['tools/test-storage-access-guard.js']);
checkCommand('worker realm guard tests', ['tools/test-worker-realm-guard.js']);
checkCommand('keyboard lock guard tests', ['tools/test-keyboard-lock-guard.js']);
checkCommand('fingerprint surface tests', ['tools/test-fingerprint-surfaces.js']);
checkCommand('payment frame origin tests', ['tools/test-payment-frame-origin.js']);
checkCommand('overlay evidence tests', ['tools/test-overlay-evidence.js']);
checkCommand('background scope tests', ['tools/test-background-scope.js']);
checkCommand('toast mute tests', ['tools/test-toast-mutes.js']);
checkCommand('tracker cookie rule tests', ['tools/test-tracker-cookie-rule.js']);
checkCommand('known limit tripwires', ['tools/test-known-limits.js']);
checkCommand('extension verdict tests', ['tools/test-extension-verdicts.js']);
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
checkCommand('site-compatibility host scope tests', ['tools/test-compat-host-scope.js']);
checkCommand('blocker durability tests', ['tools/test-blocker-durability.js']);
checkCommand('warning ownership tests', ['tools/test-warning-ownership.js']);
checkCommand('tracker learner trust tests', ['tools/test-tracker-learner-trust.js']);
checkCommand('frame scope disclosure tests', ['tools/test-frame-scope-disclosure.js']);
checkCommand('frame credential guard tests', ['tools/test-frame-credential-guard.js']);
checkCommand('shared-host site identity tests', ['tools/test-site-identity.js']);
checkCommand('psl-private.js is well-formed and current', ['tools/build-psl.js', '--check']);
checkCommand('tenant isolation tests', ['tools/test-tenant-isolation.js']);
checkCommand('tracker learner minimisation tests', ['tools/test-tracker-learner-minimisation.js']);
checkCommand('the Store package profile, guards and record agree', ['tools/build-store-package.js', '--check']);
checkCommand('Store profile tests', ['tools/test-store-profile.js']);
checkCommand('location site exception tests', ['tools/test-location-site-exceptions.js']);
checkCommand('on-leave durability tests', ['tools/test-on-leave-durability.js']);
checkCommand('search-junk seed tests', ['tools/test-search-junk-seed.js']);
checkCommand('text-scan scheduler tests', ['tools/test-text-scan-scheduler.js']);
checkCommand('incognito isolation tests', ['tools/test-incognito-isolation.js']);
checkCommand('download false-positive tests', ['tools/test-download-false-positives.js']);
checkCommand('cookie cleaner tests', ['tools/test-cookie-cleaner.js']);
checkCommand('privacy cleaner wiring tests', ['tools/test-privacy-cleaner-wiring.js']);
checkCommand('privacy data inspection and erase tests', ['tools/test-privacy-data-erase.js']);
checkCommand('warning page secret tests', ['tools/test-warning-page-secrets.js']);
checkCommand('reconcile honesty tests', ['tools/test-reconcile-honesty.js']);
checkCommand('reconciler one-list tests', ['tools/test-reconcile-one-list.js']);
checkCommand('reconciler DNR batching tests', ['tools/test-reconcile-dnr-batch.js']);
checkCommand('detectability budget', ['tools/test-detectability-budget.js']);
// The release performance profile harness (PERF-12). Its browser-driving half needs Edge and minutes;
// the gate checks its statistics, pages, report and fail-closed rules, and that a profile of the
// candidate exists in docs/perf and was produced with the extension actually loaded.
checkCommand('performance profile harness', ['tools/test-perf-profile.js']);
checkCommand('frame ClickFix tests', ['tools/test-frame-clickfix.js']);
checkCommand('fingerprint realm tests', ['tools/test-fingerprint-realm.js']);
checkCommand('confirm-bait linked overlay tests', ['tools/test-confirm-bait-linked-overlay.js']);
checkCommand('config handshake recovery tests', ['tools/test-config-handshake-recovery.js']);
checkCommand('Store asset tests', ['tools/test-store-assets.js']);
checkCommand('frame-aware init tests', ['tools/test-frame-aware-init.js']);
checkCommand('user-rule honesty tests', ['tools/test-user-rules-honesty.js']);
checkCommand('URL minimisation tests', ['tools/test-url-minimisation.js']);
checkCommand('MAIN-world authority tests', ['tools/test-main-world-authority.js']);
checkCommand('tracker learner consent tests', ['tools/test-tracker-learner-consent.js']);
checkCommand('settings round-trip tests', ['tools/test-settings-roundtrip.js']);
checkCommand('master switch tests', ['tools/test-master-switch.js']);
checkCommand('site override scope tests', ['tools/test-site-override-scope.js']);
checkCommand('permission sweep tests', ['tools/test-permission-sweep.js']);
checkCommand('device access guard tests', ['tools/test-device-access-guard.js']);
checkCommand('notification guard tests', ['tools/test-notification-guard.js']);
checkCommand('Notification Centre tests', ['tools/test-notification-center.js']);
checkCommand('system notification privacy tests', ['tools/test-system-notification-privacy.js']);
checkCommand('offscreen document lifecycle tests', ['tools/test-offscreen-lifecycle.js']);
checkCommand('capability guard tests', ['tools/test-capability-guards.js']);
checkCommand('fake-window guard tests', ['tools/test-fake-window-guard.js']);
checkCommand('full-screen guard tests', ['tools/test-fullscreen-guard.js']);
checkCommand('site control tests', ['tools/test-site-controls.js']);
checkCommand('toast dedupe tests', ['tools/test-toast-dedupe.js']);
checkCommand('download link tests', ['tools/test-download-links.js']);
checkCommand('health honesty tests', ['tools/test-health-honesty.js']);
checkCommand('EyeShield fetch scope tests', ['tools/test-eyeshield-fetch-scope.js']);
checkCommand('engine config ownership tests', ['tools/test-engine-config-ownership.js']);
checkCommand('engine config source tests', ['tools/test-engine-config-source.js']);
checkCommand('content storage boundary tests', ['tools/test-content-storage-boundary.js']);
checkCommand('package completeness tests', ['tools/test-package-completeness.js']);
checkCommand('privacy disclosure contract', ['tools/test-privacy-disclosure.js']);
checkCommand('permission-chain trust tests', ['tools/test-permission-chain-trust.js']);
checkCommand('warning dialog tests', ['tools/test-warning-dialogs.js']);
checkCommand('warning accessibility tests', ['tools/test-warning-accessibility.js']);
checkCommand('phishing false-positive tests', ['tools/test-phishing-false-positives.js']);
checkCommand('phishing differential tests', ['tools/test-phishing-differential.js']);
checkCommand('phishing path-intent tests', ['tools/test-phishing-path-intent.js']);
checkCommand('behavioural false-positive tests', ['tools/test-behavioral-false-positives.js']);
checkCommand('google cleanup tests', ['tools/test-google-cleanup.js']);
checkCommand('payment card guard tests', ['tools/test-payment-card-guard.js']);
checkCommand('clean copy tests', ['tools/test-clean-copy.js']);
checkCommand('IP privacy tests', ['tools/test-ip-privacy.js']);
checkCommand('location guard tests', ['tools/test-location-guard.js']);
checkCommand('supplemental list tests', ['tools/test-supplemental-lists.js']);
checkCommand('list integrity enforcement tests', ['tools/test-list-integrity-enforcement.js']);
checkCommand('list publisher date tests', ['tools/test-list-publisher-dates.js']);
checkCommand('adult gate tests', ['tools/test-adult-gate.js']);
checkCommand('EyeShield readability tests', ['tools/test-eyeshield-readability.js']);
checkCommand('EyeShield YouTube player tests', ['tools/test-eyeshield-yt-player.js']);
checkCommand('EyeShield native site theme tests', ['tools/test-eyeshield-native-site-themes.js']);
checkCommand('EyeShield visited-link tests', ['tools/test-eyeshield-visited.js']);
checkCommand('phishing confidence tests', ['tools/test-phishing-confidence.js']);
checkCommand('default agreement tests', ['tools/test-default-agreement.js']);
checkCommand('pwned password check tests', ['tools/test-pwned-password-check.js']);
checkCommand('element picker tests', ['tools/test-element-picker.js']);
checkCommand('engine mutation cost tests', ['tools/test-engine-mutation-cost.js']);
checkCommand('YouTube compatibility-pause tests', ['tools/test-youtube-compat.js']);
checkCommand('learned grabber scope tests', ['tools/test-learned-grabber-scope.js']);
checkCommand('manual check toast tests', ['tools/test-manual-check-toast.js']);
checkCommand('manual check journal tests', ['tools/test-manual-check-journal.js']);
checkCommand('Store candidate attestation tests', ['tools/test-store-candidate.js']);
checkCommand('Store release gate tests', ['tools/test-store-release-gate.js']);
checkCommand('Store rights gate tests', ['tools/test-store-rights.js']);
checkCommand('blocked site list tests', ['tools/test-blocked-site-list.js']);
checkCommand('user filter rules and custom lists', ['tools/test-user-filters.js']);
checkCommand('network logger', ['tools/test-network-logger.js']);
checkCommand('file shield', ['tools/test-file-shield.js']);
checkCommand('mail shield', ['tools/test-mail-shield.js']);
checkCommand('site firewall', ['tools/test-firewall.js']);
checkCommand('check an extension', ['tools/test-extension-check.js']);
checkCommand('badge yields to page controls', ['tools/test-badge-yield.js']);
checkCommand('media scan timing', ['tools/test-media-scan-timing.js']);
checkCommand('hot path layout', ['tools/test-hot-path-layout.js']);
checkCommand('user blocklist', ['tools/test-user-blocklist.js']);
checkCommand('autofill trap', ['tools/test-autofill-trap.js']);
checkCommand('search-result warnings', ['tools/test-search-result-warnings.js']);
checkCommand('link ping strip', ['tools/test-link-ping-strip.js']);
checkCommand('history url clean', ['tools/test-history-url-clean.js']);
checkCommand('bounce purge', ['tools/test-bounce-purge.js']);
checkCommand('media capability fingerprinting', ['tools/test-media-capability-fp.js']);
checkCommand('keyboard shortcuts', ['tools/test-keyboard-shortcuts.js']);
checkCommand('privacy self-test', ['tools/test-privacy-test.js']);
checkCommand('command palette', ['tools/test-command-palette.js']);
checkCommand('copy clean link tests', ['tools/test-copy-clean-link.js']);
checkCommand('right-click context checks', ['tools/test-context-checks.js']);
checkCommand('protection health tests', ['tools/test-protection-health.js']);
checkCommand('diagnostics export tests', ['tools/test-diagnostics-export.js']);
checkCommand('health card extension-note tests', ['tools/test-health-extension-drop.js']);
checkCommand('Twitch adblock tests', ['tools/test-twitch-adblock.js']);
checkCommand('Spotify adblock tests', ['tools/test-spotify-adblock.js']);
checkCommand('Spotify media redirect tests', ['tools/test-spotify-media-dnr.js']);
checkCommand('Spotify silent media asset', ['tools/build-spotify-media.js', '--check']);
checkCommand('Twitch fail-open tests', ['tools/test-twitch-failopen.js']);
checkCommand('Twitch playlist compatibility tests', ['tools/test-twitch-playlist-compatibility.js']);
checkCommand('Twitch rewind tests', ['tools/test-twitch-rewind.js']);
checkCommand('Twitch VOD rewind tests', ['tools/test-twitch-vod-rewind.js']);
checkCommand('onboarding bundle tests', ['tools/test-onboarding-bundles.js']);
checkCommand('runtime idempotence tests', ['tools/test-runtime-idempotence.js']);
checkCommand('anti redirect tests', ['tools/test-anti-redirect.js']);
checkCommand('frame-driven redirect tests', ['tools/test-frame-redirect-guard.js']);
checkCommand('frame popup backstop tests', ['tools/test-frame-popup-backstop.js']);
checkCommand('beacon logging tests', ['tools/test-beacon-logging.js']);
checkCommand('clear-on-leave tests', ['tools/test-clear-on-leave.js']);
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

// Suites that exist but are never executed here. This used to accept a suite whose name appeared
// ANYWHERE in this file, and the syntax-check list above names every one of them -- so
// test-privacy-disclosure.js was syntax-checked from the day it was added and never run, and four
// of its checks went red unseen while the privacy policy and the code moved apart. Being named is
// not being run: a suite counts only when a checkCommand call executes it.
{
  const onDisk = fs.readdirSync('tools')
    .filter((f) => /^test-.*\.js$/.test(f))
    .map((f) => 'tools/' + f);
  const executed = new Set([...gateSource.matchAll(/checkCommand\([^\n]*?\[\s*'(tools\/test-[^']+\.js)'/g)].map((m) => m[1]));
  const orphans = onDisk.filter((f) => !executed.has(f));
  if (orphans.length) {
    fail('test suites the gate never runs: ' + orphans.join(', '));
  } else {
    console.log('[ok] every tools/test-*.js is run by the gate (' + onDisk.length + ' suites)');
  }
}

// Every tools/*.js must at least PARSE. Only the test suites were ever wired in, so both
// filter-list builders sat with their shebang on line 7 -- a hard SyntaxError, since Node strips
// one only at the very start of a file -- and no gate step ever ran them to find out. Compiled
// through Node's own CommonJS wrapper, which is what `node --check` does, and read from the
// directory so a tool added tomorrow is covered without anyone remembering to list it.
{
  const vm = require('vm');
  const files = fs.readdirSync('tools').filter((f) => /\.js$/.test(f)).map((f) => 'tools/' + f);
  const broken = [];
  for (const file of files) {
    const source = read(file);
    if (source === null || source === undefined) {
      broken.push(file + ': unreadable');
      continue;
    }
    try {
      new vm.Script('(function (exports, require, module, __filename, __dirname) {' +
        String(source).replace(/^#![^\n]*/, '') + '\n})', { filename: file });
    } catch (error) {
      broken.push(file + ': ' + String((error && error.message) || error));
    }
  }
  if (broken.length) {
    fail('tools that do not parse: ' + broken.join('; '));
  } else {
    console.log('[ok] every tools/*.js parses (' + files.length + ' files)');
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

// ---------------------------------------------------------------------------
// Source encoding hygiene (L24).
//
// background.js shipped for five commits with a UTF-8 BOM and six mojibake sequences: an em dash,
// an ellipsis, a middle dot and a combining-dot letter, each decoded as Windows-1252 and
// re-encoded. Five were in comments, but one was the middle dot in the separator that joins the
// reputation-provider summaries, so the corruption reached the UI. Nothing caught it. The file
// parsed, every suite passed, and the damage was invisible unless you looked at the bytes.
//
// Note for anyone extending this: do NOT paste an example of the corruption into this file. An
// earlier draft quoted the broken separator here and the check dutifully failed on its own
// documentation. Describe the sequences; never reproduce them.
//
// Detection is by construction rather than by a list of known-bad strings: a two-byte UTF-8
// sequence misread as Windows-1252 always lands as [U+00C0-U+00DF] followed by whatever CP1252
// maps 0x80-0xBF to. Building that second set from the codepage catches sequences nobody has seen
// yet, which a hardcoded list of the handful already encountered would not.
// ---------------------------------------------------------------------------
{
  // CP1252 high range 0x80-0xBF. 0x81/0x8D/0x8F/0x90/0x9D are unmapped and cannot appear.
  const CP1252_HIGH = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ'
    + '‘’“”•–—˜™š›œžŸ'
    + ' ¡¢£¤¥¦§¨©ª«¬­®¯'
    + '°±²³´µ¶·¸¹º»¼½¾¿';
  const MOJIBAKE = new RegExp('[\\u00C0-\\u00DF][' + CP1252_HIGH.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&') + ']');

  const files = fs.readdirSync('.').filter((f) => /\.(js|json|html|css|md)$/.test(f) && exists(f))
    .concat(fs.readdirSync('tools').filter((f) => /\.js$/.test(f)).map((f) => 'tools/' + f))
    .concat(exists('src/content.js') ? ['src/content.js'] : []);

  const offenders = [];
  for (const file of files) {
    const buf = fs.readFileSync(file);
    if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) { offenders.push(file + ' (UTF-8 BOM)'); continue; }
    const hit = MOJIBAKE.exec(buf.toString('utf8'));
    if (hit) offenders.push(file + ' (mojibake ' + JSON.stringify(hit[0]) + ')');
  }
  if (offenders.length) fail('source encoding: ' + offenders.join(', '));
  else console.log('[ok] no shipped text file carries a BOM or mojibake (' + files.length + ' files)');
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

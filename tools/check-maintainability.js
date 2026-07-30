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
  'content.min.js',
  'src/content.js',
  'tools/build-content.js',
  'tools/harden-static-dnr.js',
  'tools/check-security-posture.js',
  'tools/test-memory-shield.js',
  'tools/test-download-guard.js',
  'tools/test-dynamic-registrations.js',
  'tools/test-consent-reject.js',
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
  'tools/test-verification-compatibility.js',
  'tools/test-bridge-bounds.js',
  'tools/test-static-dnr-compatibility.js',
  'tools/test-dnr-budget.js',
  'tools/test-x-compatibility.js',
].forEach(checkSyntax);

[
  'manifest.json',
  'rules.json',
  'rules-trackers.json',
  'rules-easyprivacy.json',
  'rules-adshield.json',
  'malware-hashes.json',
  'grabber-extra.json',
  'supplemental-manifest.json',
].forEach(checkJson);

checkImports('background.js');
checkRuleCount('STATIC_RULE_COUNT', 'rules.json');
checkRuleCount('ADSHIELD_STATIC_RULE_COUNT', 'rules-adshield.json');
checkContentMinProvenance();
checkContentBuild();
checkCommand('memory shield tests', ['tools/test-memory-shield.js']);
checkCommand('static DNR hardening check', ['tools/harden-static-dnr.js', '--check']);
checkCommand('static DNR compatibility tests', ['tools/test-static-dnr-compatibility.js']);
checkCommand('DNR static rule budget', ['tools/test-dnr-budget.js']);
checkCommand('bridge payload bound tests', ['tools/test-bridge-bounds.js']);
checkCommand('runtime config lifecycle tests', ['tools/test-runtime-config-lifecycle.js']);
checkCommand('network compatibility tests', ['tools/test-network-compatibility.js']);
checkCommand('Smart Script Shield recovery tests', ['tools/test-smart-script-recovery.js']);
checkCommand('site compatibility tests', ['tools/test-site-compatibility.js']);
checkCommand('streaming compatibility tests', ['tools/test-streaming-compatibility.js']);
checkCommand('token destination trust tests', ['tools/test-token-exfil-trust.js']);
checkCommand('verification compatibility tests', ['tools/test-verification-compatibility.js']);
checkCommand('download guard tests', ['tools/test-download-guard.js']);
checkCommand('dynamic registration tests', ['tools/test-dynamic-registrations.js']);
checkCommand('consent reject tests', ['tools/test-consent-reject.js']);
checkCommand('phishing false-positive tests', ['tools/test-phishing-false-positives.js']);
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

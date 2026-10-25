/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Keep ordinary vendor downloads quiet without suppressing risky file-name, archive and host signals.
   Run: node tools/test-download-false-positives.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DL = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');
const DOMAIN_UTILS = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

// background-downloads.js is an importScripts sibling of background.js, so it closes over helpers
// declared there. Lift the real ones rather than stubbing: a stub that normalises hosts even
// slightly differently would move every publisher-match result in this suite.
function liftFn(source, name) {
  const start = source.indexOf('function ' + name + '(');
  if (start < 0) throw new Error(name + ' not found');
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}') { depth--; if (depth === 0) return source.slice(start, i + 1); }
  }
  throw new Error(name + ' braces unbalanced');
}
const BG_HELPERS = ['normalizeAllowlistHost', 'normalizeAllowlistHosts', 'isLocalOrPrivateHost',
  'normalizeIpLiteral', 'ipv4FromMappedIpv6', 'messageCleanHost', 'registrableDomain']
  .map((n) => { try { return liftFn(BG, n); } catch (_) { return ''; } })
  .filter(Boolean).join('\n');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// Everything from the top of the file down to the end of applyDownloadMeta, so the constants, the
// weight table, the publisher list and the scorer are the real ones rather than restated here.
const end = (() => {
  const start = DL.indexOf('function applyDownloadMeta(');
  let depth = 0;
  for (let i = DL.indexOf('{', start); i < DL.length; i++) {
    if (DL[i] === '{') depth++;
    else if (DL[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('applyDownloadMeta braces unbalanced');
})();

const sandbox = { console, Math, Date, Object, Array, Set, Map, Number, String, URL, JSON, RegExp, isNaN, parseInt, parseFloat };
vm.createContext(sandbox);
vm.runInContext(
  DOMAIN_UTILS + '\n' + BG_HELPERS + '\n'
  // The slice includes the module's top-level bootstrap, which touches worker globals this
  // sandbox has no reason to provide. Stub them rather than trimming the slice: cutting the file
  // at a convenient line is how a suite ends up testing a different program than it ships.
  + 'var BLOCKED_DOMAINS = new Set();\n'
  // The real one, from domain-utils.js above -- the whole point of the scorer is what it does per
  // registrable domain, so a stub here would be testing something else.
  + 'var regDomainBg = registrableDomain;\n'
  + 'var localGet = function () { return Promise.resolve({}); };\n'
  + 'var localSet = function () { return Promise.resolve(); };\n'
  + 'var queueHistory = function () {};\n'
  + 'var chrome = { runtime: { getManifest: function () { return {}; }, onMessage: { addListener: function () {} } },'
  + ' storage: { session: { get: function () { return Promise.resolve({}); }, set: function () { return Promise.resolve(); } } },'
  + ' downloads: { onCreated: { addListener: function () {} }, onChanged: { addListener: function () {} } },'
  + ' alarms: { create: function () {}, onAlarm: { addListener: function () {} } } };\n'
  + DL.slice(0, end) + '\n'
  + 'globalThis.__score = scoreDownload;'
  // Optional so this suite still RUNS against a tree without the split, and reports the grades
  // it produces instead of dying on a missing symbol. The grades are the evidence.
  + 'globalThis.__benign = typeof BENIGN_INSTALLER_HINT !== \"undefined\" ? BENIGN_INSTALLER_HINT : null;'
  + 'globalThis.__lure = typeof LURE_HINT !== \"undefined\" ? LURE_HINT : null;'
  + 'globalThis.__pub = isKnownPublisherDomain;',
  sandbox, { filename: 'background-downloads.js' });

const score = (url, name) => sandbox.__score(url, '', name, '', [], '', null);
const gradeOf = (url, name) => score(url, name).grade;

// Anti-vacuity: if the scorer silently returned a default for everything, every expectation below
// would agree with it. Prove it can still produce a bad grade before trusting the quiet ones.
check('the rig can still produce a critical grade',
  gradeOf('http://1.2.3.4/invoice.pdf.exe', 'invoice.pdf.exe') === 'F',
  'the scorer is not really running');

// ---------------------------------------------------------------------------
// 1. Safe files must be quiet. An unlisted-but-honest vendor shipping a normal installer.
// ---------------------------------------------------------------------------
{
  const SAFE = [
    ['https://smallvendor.example/downloads/MyApp-Setup-1.4.2.exe', 'MyApp-Setup-1.4.2.exe'],
    ['https://smallvendor.example/downloads/MyApp-installer.exe', 'MyApp-installer.exe'],
    ['https://smallvendor.example/dl/AppUpdate.exe', 'AppUpdate.exe'],
    ['https://smallvendor.example/dl/MyApp.exe', 'MyApp.exe'],
  ];
  for (const [url, name] of SAFE) {
    const g = gradeOf(url, name);
    check('an honest installer stays quiet: ' + name,
      score(url, name).action === 'allow', 'graded ' + g);
  }
}

// ---------------------------------------------------------------------------
// 2. Known publishers stay completely silent, including the newly added consumer vendors.
// ---------------------------------------------------------------------------
{
  const PUBLISHERS = [
    ['https://download.malwarebytes.com/MBSetup.exe', 'MBSetup.exe'],
    ['https://get.videolan.org/vlc/vlc-3.0.20-win64.exe', 'vlc-3.0.20-win64.exe'],
    ['https://desktop.telegram.org/tsetup.exe', 'tsetup.exe'],
    ['https://laptop-updates.brave.com/BraveBrowserSetup.exe', 'BraveBrowserSetup.exe'],
    ['https://download.blender.org/release/blender-4.1-windows-x64.msi', 'blender-4.1-windows-x64.msi'],
    ['https://us.download.nvidia.com/Windows/551.86-desktop-win10-win11-64bit-international-dch-whql.exe', '551.86-desktop-whql.exe'],
    ['https://downloads.slack-edge.com/SlackSetup.exe', 'SlackSetup.exe'],
    ['https://www.gimp.org/downloads/gimp-2.10-setup.exe', 'gimp-2.10-setup.exe'],
  ];
  for (const [url, name] of PUBLISHERS) {
    const g = gradeOf(url, name);
    check('a known publisher stays silent: ' + name, g === 'A' || g === 'B',
      'graded ' + g + ' -- a mainstream download would still interrupt the user');
  }
  check('the newly added vendors really are recognised',
    ['malwarebytes.com', 'brave.com', 'telegram.org', 'razer.com', 'libreoffice.org', 'proton.me']
      .every((d) => sandbox.__pub(d)));
}

// ---------------------------------------------------------------------------
// 3. The part that must NOT get quieter. This is the half a tuning change breaks silently.
// ---------------------------------------------------------------------------
{
  const BAD = [
    ['https://sketchy.example/dl/photoshop-2024-crack-keygen.exe', 'photoshop-2024-crack-keygen.exe'],
    ['https://sketchy.example/dl/office-activator.exe', 'office-activator.exe'],
    ['https://sketchy.example/dl/game-repack-pre-activated.exe', 'game-repack-pre-activated.exe'],
    ['https://sketchy.example/dl/windows-loader-nulled.exe', 'windows-loader-nulled.exe'],
    ['https://sketchy.example/dl/adobe-warez.zip', 'adobe-warez.zip'],
  ];
  for (const [url, name] of BAD) {
    const g = gradeOf(url, name);
    check('a crack/keygen name still surfaces: ' + name, g !== 'A' && g !== 'B',
      'graded ' + g + ' -- the tuning hollowed out real detection');
    check('a crack/keygen name requires review: ' + name, score(url, name).action === 'review');
  }

  // Disguise and transport tricks are independent of the naming change and must be untouched.
  // E, not F: F is reserved for a blocklist hit, a flagged redirect hop or Chrome saying the
  // file is known-bad. A disguised name on an otherwise unremarkable host earns 'Dangerous',
  // which is the warning that matters. Asserting F here would have been asserting my own guess.
  check('a double extension is still surfaced as dangerous',
    ['E', 'F'].includes(gradeOf('https://ok.example/invoice.pdf.exe', 'invoice.pdf.exe')));
  check('a raw-IP installer still scores', gradeOf('http://203.0.113.9/setup.exe', 'setup.exe') !== 'A');
  check('a crack from a KNOWN publisher host is still not waved through',
    gradeOf('https://github.com/x/y/releases/download/v1/game-crack-keygen.exe', 'game-crack-keygen.exe') !== 'A');
}

// ---------------------------------------------------------------------------
// 4. The split itself: the two word sets must not leak into each other.
// ---------------------------------------------------------------------------
{
  check('the installer/lure split exists', !!(sandbox.__benign && sandbox.__lure),
    'INSTALLER_HINT is still one conflated regex');
  for (const w of (sandbox.__benign ? ['setup', 'install', 'installer', 'update', 'updater'] : [])) {
    check('"' + w + '" counts as benign', sandbox.__benign.test(w) && !sandbox.__lure.test(w));
  }
  for (const w of (sandbox.__lure ? ['crack', 'keygen', 'activator', 'nulled', 'warez', 'serial-key', 'cracked', 'repack'] : [])) {
    check('"' + w + '" counts as a lure', sandbox.__lure.test(w) && !sandbox.__benign.test(w));
  }
}

// ---------------------------------------------------------------------------
// 5. Innocent names that merely CONTAIN a lure word.
//
// While the lure regex was an unanchored substring test, every one of these graded E "Dangerous":
// firecracker and nutcracker contain "crack", and bare "serial" is an ordinary English word that
// appears in the name of every serial-port utility ever shipped.
// ---------------------------------------------------------------------------
{
  for (const [url, name] of [
    ['https://smallvendor.example/dl/firecracker.exe', 'firecracker.exe'],
    ['https://smallvendor.example/dl/nutcracker-setup.exe', 'nutcracker-setup.exe'],
    ['https://smallvendor.example/dl/SerialMonitor.exe', 'SerialMonitor.exe'],
    ['https://smallvendor.example/dl/serial-port-monitor-setup.exe', 'serial-port-monitor-setup.exe'],
  ]) {
    const g = gradeOf(url, name);
    check('a name that merely contains a lure word is not treated as one: ' + name,
      score(url, name).action === 'allow',
      'graded ' + g + ' -- the lure regex is unanchored again');
  }
  check('but the piracy form still counts',
    ['D', 'E', 'F'].includes(gradeOf('https://sketchy.example/dl/adobe-serial-key.exe', 'adobe-serial-key.exe')));
}

// Retain source scoring while distinguishing weak clues from actionable delivery evidence.
{
  const ATTACKS = [
    ['cracked software', 'https://freewarez.click/dl/photoshop-crack-keygen.exe', 'photoshop-crack-keygen.exe'],
    ['KMS activator', 'https://activate-win.xyz/kmspico-setup.exe', 'kmspico-setup.exe'],
    ['double extension', 'https://invoices.example/Invoice.pdf.exe', 'Invoice.pdf.exe'],
    ['padding trick', 'https://files.example/report            .exe', 'report            .exe'],
    ['archive from an unusual TLD', 'https://share.top/invoice-docs.zip', 'invoice-docs.zip', false],
    ['7z from an unusual TLD', 'https://mail-attach.icu/statement.7z', 'statement.7z', false],
    ['disk image from an unusual TLD', 'https://delivery.cyou/order-details.iso', 'order-details.iso', false],
    ['macro doc from an unusual TLD', 'https://hr-forms.sbs/onboarding.docm', 'onboarding.docm', false],
    ['raw public IP executable', 'http://45.147.230.11/update.exe', 'update.exe'],
    ['punycode host', 'https://xn--pypal-4ve.com/login-tool.exe', 'login-tool.exe', false],
    ['.zip TLD', 'https://invoice.zip/statement.exe', 'statement.exe', false],
    ['LAN but disguised', 'http://192.168.1.20/Invoice.pdf.exe', 'Invoice.pdf.exe'],
    ['LAN but a crack', 'http://192.168.1.20/office-activator.exe', 'office-activator.exe'],
    ['crack on a known publisher host', 'https://github.com/a/b/releases/download/v1/game-crack.exe', 'game-crack.exe'],
    ['keygen on a shared CDN', 'https://d1.cloudfront.net/x/adobe-keygen.exe', 'adobe-keygen.exe'],
  ];
  for (const [what, url, name, review = true] of ATTACKS) {
    const g = gradeOf(url, name);
    check('source and file context still scores: ' + what, g !== 'A' && g !== 'B', 'graded ' + g);
    check('interruption follows evidence: ' + what,
      score(url, name).action === (review ? 'review' : 'allow'));
  }
}

if (failed) { console.error('\n' + failed + ' download false-positive check(s) failed'); process.exit(1); }
console.log('\nsafe installers are quiet and cracks still surface');

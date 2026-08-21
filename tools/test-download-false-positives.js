/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Does Download Guard scare people away from safe files?
 *
 * INSTALLER_HINT used to be one regex covering `setup`, `install` and `update` alongside `crack`,
 * `keygen`, `warez` and `nulled`, and every match added the same +3. So on any site not in the
 * publisher list, an ordinary installer scored executable(+3) + installer(+3) = 6, which is
 * grade E -- "Dangerous". `setup.exe` is the most common legitimate installer filename on
 * Windows. Both rebates that would have softened it were also withheld from anything
 * installer-named, so nothing could rescue it.
 *
 * That is a false-positive engine pointed at exactly the user who can least afford to be
 * frightened: someone installing their first program from a small vendor's own site. And it cut
 * both ways, because the words that genuinely mean trouble were diluted by sharing a bucket with
 * the word every honest installer uses.
 *
 * This suite pins BOTH directions. A tuning change that only proves the scary cases got quieter
 * is how a security feature gets hollowed out one reasonable-sounding step at a time.
 *
 * Run: node tools/test-download-false-positives.js
 */
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

// Everything from the top of the file down to the end of scoreDownload, so the constants, the
// weight table, the publisher list and the scorer are the real ones rather than restated here.
const end = (() => {
  const start = DL.indexOf('function scoreDownload(');
  let depth = 0;
  for (let i = DL.indexOf('{', start); i < DL.length; i++) {
    if (DL[i] === '{') depth++;
    else if (DL[i] === '}') { depth--; if (depth === 0) return i + 1; }
  }
  throw new Error('scoreDownload braces unbalanced');
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
    check('an honest installer is no worse than "Review Recommended": ' + name,
      g === 'A' || g === 'B' || g === 'C',
      'graded ' + g + ' -- a first-time user is told a safe file is dangerous');
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
      g === 'A' || g === 'B' || g === 'C',
      'graded ' + g + ' -- the lure regex is unanchored again');
  }
  check('but the piracy form still counts',
    ['D', 'E', 'F'].includes(gradeOf('https://sketchy.example/dl/adobe-serial-key.exe', 'adobe-serial-key.exe')));
}

// ---------------------------------------------------------------------------
// 6. The attack battery. Every row is a realistic delivery; none may go silent.
//
// This section exists because a false-positive fix DID hollow out detection once. Suppressing the
// throwaway-TLD charge whenever the score equalled the file-type baseline read as reasonable and
// silently exempted every archive -- a zip from a .top domain dropped to grade B and went quiet.
// Nothing else in this file noticed. Only running the attacks did.
// ---------------------------------------------------------------------------
{
  const ATTACKS = [
    ['cracked software', 'https://freewarez.click/dl/photoshop-crack-keygen.exe', 'photoshop-crack-keygen.exe'],
    ['KMS activator', 'https://activate-win.xyz/kmspico-setup.exe', 'kmspico-setup.exe'],
    ['double extension', 'https://invoices.example/Invoice.pdf.exe', 'Invoice.pdf.exe'],
    ['padding trick', 'https://files.example/report            .exe', 'report            .exe'],
    ['hidden-contents archive from a throwaway TLD', 'https://share.top/invoice-docs.zip', 'invoice-docs.zip'],
    ['encrypted archive from a throwaway TLD', 'https://mail-attach.icu/statement.7z', 'statement.7z'],
    ['ISO smuggling', 'https://delivery.cyou/order-details.iso', 'order-details.iso'],
    ['macro doc from a throwaway TLD', 'https://hr-forms.sbs/onboarding.docm', 'onboarding.docm'],
    ['raw public IP executable', 'http://45.147.230.11/update.exe', 'update.exe'],
    ['punycode lookalike', 'https://xn--pypal-4ve.com/login-tool.exe', 'login-tool.exe'],
    ['.zip TLD confusable', 'https://invoice.zip/statement.exe', 'statement.exe'],
    ['LAN but disguised', 'http://192.168.1.20/Invoice.pdf.exe', 'Invoice.pdf.exe'],
    ['LAN but a crack', 'http://192.168.1.20/office-activator.exe', 'office-activator.exe'],
    ['crack on a known publisher host', 'https://github.com/a/b/releases/download/v1/game-crack.exe', 'game-crack.exe'],
    ['keygen on a shared CDN', 'https://d1.cloudfront.net/x/adobe-keygen.exe', 'adobe-keygen.exe'],
  ];
  for (const [what, url, name] of ATTACKS) {
    const g = gradeOf(url, name);
    check('still surfaces: ' + what, g !== 'A' && g !== 'B',
      'graded ' + g + ' -- this delivery would reach the user with no warning at all');
  }
}

if (failed) { console.error('\n' + failed + ' download false-positive check(s) failed'); process.exit(1); }
console.log('\nsafe installers are quiet and cracks still surface');

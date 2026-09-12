/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The nine auxiliary content scripts used a bare boolean install guard. Chrome does not
 * re-inject into tabs that are already open when an extension updates, so a tab that outlives an
 * update keeps the old copy -- and with a boolean flag that was permanent: the new copy saw a
 * truthy flag and returned on line one. chrome.scripting.executeScript still resolved, which is
 * why Repair used to report success it had not earned (H1).
 *
 * They are now version-coupled: same version returns (or, for EyeShield, refreshes), an older
 * version is released and replaced. This file pins both halves of that -- the comparison, and the
 * release -- because a version-coupled guard WITHOUT a working dispose is worse than the boolean
 * was: it would layer a second complete copy into the page instead of declining to install.
 *
 * Run with:
 *   node tools/test-guard-lifecycle.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

// The three MAIN-world security guards follow a different contract since SEC-03: the page
// shares their world, so a published disposer was a page-callable kill switch and a
// version-compare guard was a way to install a second copy beside a live one. They refuse to
// install beside ANY copy, call no previous disposer, and keep their teardown private (a
// `const woDispose`, reachable only through a signed message from the isolated bridge). The
// ISOLATED guards, and the Twitch ad blocker whose world only Twitch shares, keep the
// version-coupled contract: a newer copy releases the older one and installs.
const GUARDS = [
  { file: 'anti-redirect.js', flag: '__wardenOneAntiRedirectHardener', dispose: '__wardenOneAntiRedirectDispose', main: true },
  { file: 'permission-chain.js', flag: '__wardenOnePermissionChainInstalled', dispose: '__wardenOnePermissionChainDispose', main: true },
  { file: 'eyeshield.js', flag: '__wardenOneEyeShieldInstalled', dispose: '__wardenOneEyeShieldDispose', refreshes: true },
  { file: 'oauth-guard.js', flag: '__wardenOneOAuthGuardInstalled', dispose: '__wardenOneOAuthGuardDispose' },
  { file: 'twitch-adblock.js', flag: '__wardenOneTwitchAdblockReady', dispose: '__wardenOneTwitchAdblockDispose', versionExpr: 'VERSION', worker: 'function twitchWorkerRuntime' },
  { file: 'twitch-rewind.js', flag: '__wardenOneTwitchRewindReady', dispose: '__wardenOneTwitchRewindDispose', topFrameOnly: true },
  { file: 'twitch-vod-rewind.js', flag: '__wardenOneVodRewind', dispose: '__wardenOneVodRewindDispose' },
  { file: 'cryptominer-detect.js', flag: '__wardenOneMinerWatch', dispose: '__wardenOneMinerWatchDispose', main: true },
  { file: 'search-junk.js', flag: '__wardenOneSearchJunk', dispose: '__wardenOneSearchJunkDispose' },
];

for (const g of GUARDS) g.disposeDecl = g.main ? 'const woDispose = () => {' : 'window.' + g.dispose + ' = () => {';

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

const sources = new Map();
for (const g of GUARDS) sources.set(g.file, fs.readFileSync(path.join(ROOT, g.file), 'utf8'));

// The region of twitch-adblock.js that is stringified into a Worker via toString(). Nothing in
// there may reference the helpers -- they do not exist inside a worker, and injecting a
// reference would break Twitch ad blocking outright rather than noisily.
function workerRange(src, marker) {
  const at = src.indexOf(marker);
  if (at < 0) return null;
  let depth = 0;
  for (let i = src.indexOf('{', at); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (depth === 0) return [at, i]; }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 1. Every guard compares a version instead of testing truthiness, and the version it
//    compares is the extension's. A constant that drifts from the manifest makes the whole
//    mechanism inert -- every tab would look same-version forever.
// ---------------------------------------------------------------------------
for (const g of GUARDS) {
  const src = sources.get(g.file);
  const v = g.versionExpr || 'WO_GUARD_VERSION';
  if (g.main) {
    check(g.file + ': guard refuses to install beside any copy, of any version',
      new RegExp('if \\(window\\.' + g.flag + '\\) return;').test(src));
    check(g.file + ': no version-compare path installs a second copy',
      !src.includes('if (window.' + g.flag + ' === ' + v + ')'));
    check(g.file + ': calls no previous disposer at install',
      !new RegExp('window\\.' + g.dispose + '\\(\\)').test(src));
  } else {
    check(g.file + ': guard compares a version',
      src.includes('if (window.' + g.flag + ' === ' + v + ')'));
    check(g.file + ': older copy is disposed before installing',
      new RegExp('if \\(window\\.' + g.flag + '\\) \\{[\\s\\S]{0,160}window\\.' + g.dispose + '\\(\\)').test(src));
    check(g.file + ': no bare-truthiness early return survives',
      !new RegExp('if \\(window\\.' + g.flag + '\\) return;').test(src));
  }
  check(g.file + ': flag is set to the version, not true',
    src.includes('window.' + g.flag + ' = ' + v + ';'));

  const decl = src.match(new RegExp('const ' + v + " = '([^']+)';"));
  check(g.file + ': version constant matches manifest (' + MANIFEST.version + ')',
    !!decl && decl[1] === MANIFEST.version, decl ? decl[1] : 'no constant found');
}

// ---------------------------------------------------------------------------
// 2. Each guard publishes a dispose, and it releases all four kinds of resource.
// ---------------------------------------------------------------------------
for (const g of GUARDS) {
  const src = sources.get(g.file);
  if (g.main) {
    check(g.file + ': keeps its teardown private (SEC-03)',
      src.includes(g.disposeDecl) && !src.includes('window.' + g.dispose));
    check(g.file + ': the teardown is reachable only through a signed dispose message',
      /kind === 'dispose'[\s\S]{0,120}woVerify\('dispose', '', /.test(src) && /woVerify\('dispose', '', [^)]*\)\) \{\s*woDispose\(\);/.test(src));
  } else {
    check(g.file + ': publishes dispose on window', src.includes('window.' + g.dispose + ' = () => {'));
  }
  check(g.file + ': dispose aborts the listener signal', src.includes('woAbort.abort()'));
  check(g.file + ': dispose clears pending timeouts',
    /woPending\.forEach\(\(id\) => \{ try \{ clearTimeout\(id\); \} catch \(_\) \{\} \}\);/.test(src));
  check(g.file + ': dispose drains the registry', /woKeep\.splice\(0, woKeep\.length\)/.test(src));
}

// ---------------------------------------------------------------------------
// 3. Nothing bypasses the helpers. A raw call is a resource dispose can never reach.
//    The one legitimate raw call of each kind lives inside the helper itself.
// ---------------------------------------------------------------------------
for (const g of GUARDS) {
  let src = sources.get(g.file);
  const wr = g.worker ? workerRange(src, g.worker) : null;
  if (g.worker) {
    check(g.file + ': the stringified worker region is still findable', !!wr);
    const body = src.slice(wr[0], wr[1]);
    check(g.file + ': no helper reference leaked into the worker',
      !/woOn\(|woTimeout\(|woInterval\(|woObserver\(/.test(body),
      'a worker cannot see them -- this would break Twitch ad blocking silently');
    // Exclude it from the raw-call counts below; its raw calls are correct.
    src = src.slice(0, wr[0]) + src.slice(wr[1]);
  }
  const raw = {
    '.addEventListener(': (src.match(/\.addEventListener\(/g) || []).length,
    'setInterval(': (src.match(/\bsetInterval\(/g) || []).length,
    'setTimeout(': (src.match(/\bsetTimeout\(/g) || []).length,
    'new MutationObserver(': (src.match(/new MutationObserver\(/g) || []).length,
  };
  // A raw call is normally a resource dispose can never reach, which is why exactly one is allowed
  // per kind: the one inside the helper. The focus trap on an owned overlay is the exception that
  // proves the rule -- it must be removable when THAT overlay closes, not when the whole bridge
  // tears down, so routing it through woOn would be the bug rather than the fix.
  //
  // So the invariant is pairing, not counting: an extra raw addEventListener is allowed only when a
  // matching removeEventListener exists to undo it. Anything unpaired is still a leak.
  for (const [call, n] of Object.entries(raw)) {
    if (call === '.addEventListener(' && n > 1) {
      const removals = (src.match(/\.removeEventListener\(/g) || []).length;
      check(g.file + ': every extra raw addEventListener has a matching removeEventListener',
        removals >= n - 1, n + ' added, ' + removals + ' removed');
      continue;
    }
    check(g.file + ': one raw ' + call + ' (the helper)', n === 1, n + ' found');
  }
}

// ---------------------------------------------------------------------------
// 4. The nine registries are the same code. Nine hand-maintained copies would drift; this
//    asserts they have not, so a fix to one is a fix to all.
// ---------------------------------------------------------------------------
// The shared core, with the Chrome-event extension removed.
//
// Two of these files -- bridge.js and eyeshield.js -- also register chrome.runtime.onMessage
// listeners, which are not DOM events, are not covered by the abort signal, and need
// removeListener by identity. They therefore carry MORE than the shared registry, legitimately.
// Comparing whole blocks would either fail or push us into adding an unused helper to the eight
// files that do not need one. So the core is what must be identical; the extension is checked on
// its own terms by the cross-file sweep below.
function sharedRegistryCore(src, g) {
  const dispose = g.dispose;
  const from = src.indexOf('  /* Everything this copy holds');
  const disposeAt = src.indexOf(g.disposeDecl);
  const to = src.indexOf('  };\n', disposeAt);
  assert(from >= 0 && to > from, 'could not find the registry block');
  let core = src.slice(from, to);
  const chromeAt = core.indexOf("  // Chrome's extension events are not DOM events");
  if (chromeAt >= 0) {
    const resumeAt = core.indexOf('  ' + g.disposeDecl, chromeAt);
    core = core.slice(0, chromeAt) + core.slice(resumeAt);
  }
  // The MAIN guards declare the teardown privately and explain why above it; the registry they
  // share with the others is everything but that declaration line and its comment.
  core = core.replace(/  \/\* Reachable only through a signed "dispose" message from the isolated bridge\. \*\/\n  const woDispose = \(\) => \{/, '  window.' + dispose + ' = () => {');
  core = core.replace(/    const chromeHeld = woChromeListeners[\s\S]*?\n    \}\n/, '');
  // Same reasoning as the Chrome listeners above, for the same reason: the bridge is the only
  // guard that puts UI on the page, so it is the only one whose dispose has warnings to tear down.
  // The drain is bridge-specific by nature and is asserted on its own in test-warning-dialogs.js;
  // what has to stay identical across all ten is the registry they share.
  core = core.replace(/    \/\* Before anything is torn down[\s\S]*?\n    \}\n/, '');
  return core.split(dispose).join('__DISPOSE__');
}

const registries = GUARDS.map((g) => sharedRegistryCore(sources.get(g.file), g));
check('all nine registry blocks are byte-identical',
  registries.every((r) => r === registries[0]),
  registries.map((r, i) => GUARDS[i].file + '=' + r.length).join(' '));

// ---------------------------------------------------------------------------
// 5. EyeShield is the one guard whose same-version path does something. The popup relies on a
//    re-injection refreshing the theme, so version-coupling must not have turned that into a
//    silent return.
// ---------------------------------------------------------------------------
{
  const src = sources.get('eyeshield.js');
  const same = src.indexOf('if (window.__wardenOneEyeShieldInstalled === WO_GUARD_VERSION)');
  const refresh = src.indexOf('__wardenOneEyeShieldRefresh()');
  const older = src.indexOf('if (window.__wardenOneEyeShieldInstalled) {');
  check('eyeshield: a same-version re-injection still refreshes',
    same >= 0 && refresh > same && older > refresh,
    'same=' + same + ' refresh=' + refresh + ' older=' + older);
}

// ---------------------------------------------------------------------------
// 6. Behaviour. Lift each guard's real preamble and prove the release, against Node's own
//    AbortController and EventTarget rather than a mock that would agree with the code.
// ---------------------------------------------------------------------------
for (const g of GUARDS) {
  const src = sources.get(g.file);
  const from = src.indexOf('  const woAbort = new AbortController();');
  const to = src.indexOf('  };\n', src.indexOf(g.disposeDecl)) + 5;
  assert(from >= 0 && to > from, 'could not lift the registry from ' + g.file);
  const lifted = src.slice(from, to);

  const win = {};
  const cleared = [];
  const sandbox = {
    window: win, AbortController, EventTarget, Event, Set, Object, Array,
    MutationObserver: class { disconnect() { this.gone = true; } },
    setInterval: () => 7,
    clearInterval: (id) => cleared.push(id),
    setTimeout: (fn, ms) => { void fn; void ms; return 99; },
    clearTimeout: (id) => cleared.push(id),
  };
  vm.createContext(sandbox);
  vm.runInContext(lifted, sandbox, { filename: g.file + ':lifted-registry' });

  // A listener, an observer, an interval and a timeout, then release everything.
  vm.runInContext('this.__t = new EventTarget(); this.__hits = 0;'
    + 'woOn(__t, "ping", function () { __hits++; });'
    + '__t.dispatchEvent(new Event("ping"));'
    + 'this.__obs = woObserver(function () {});'
    + 'woInterval(function () {}, 100);'
    + 'woTimeout(function () {}, 100);', sandbox);

  const liveHits = vm.runInContext('__hits', sandbox);
  const held = vm.runInContext('woKeep.length', sandbox);
  const pending = vm.runInContext('woPending.size', sandbox);

  const dispose = g.main
    ? () => vm.runInContext('woDispose()', sandbox)
    : () => { assert(typeof win[g.dispose] === 'function', g.file + ' did not publish ' + g.dispose); win[g.dispose](); };
  if (g.main) assert(typeof win[g.dispose] !== 'function', g.file + ' published ' + g.dispose + ' on window');
  dispose();
  vm.runInContext('__t.dispatchEvent(new Event("ping"))', sandbox);

  const ok = liveHits === 1
    && held === 2 && pending === 1
    && vm.runInContext('__hits', sandbox) === 1
    && vm.runInContext('__obs.gone', sandbox) === true
    && vm.runInContext('woKeep.length', sandbox) === 0
    && vm.runInContext('woPending.size', sandbox) === 0
    && cleared.includes(7) && cleared.includes(99);
  check(g.file + ': dispose releases listener, observer, interval and timeout',
    ok, 'liveHits=' + liveHits + ' held=' + held + ' pending=' + pending
      + ' hitsAfter=' + vm.runInContext('__hits', sandbox)
      + ' cleared=' + JSON.stringify(cleared));

  // Calling it twice must not throw or double-clear.
  const before = cleared.length;
  dispose();
  check(g.file + ': dispose is safe to call twice', cleared.length === before);
}

// ---------------------------------------------------------------------------
// 7. woTimeout must not leak. A self-rescheduling loop -- five of the nine have one -- would
//    otherwise grow the pending set forever, turning a teardown fix into a memory leak.
// ---------------------------------------------------------------------------
{
  const src = sources.get('twitch-rewind.js');
  const from = src.indexOf('  const woAbort = new AbortController();');
  const to = src.indexOf('  };\n', src.indexOf('window.__wardenOneTwitchRewindDispose = () => {')) + 5;
  const win = {};
  let seq = 0;
  const queue = [];
  const sandbox = {
    window: win, AbortController, Set, Object, Array,
    MutationObserver: class { disconnect() {} },
    setInterval: () => 0, clearInterval() {}, clearTimeout() {},
    setTimeout: (fn) => { seq++; queue.push(fn); return seq; },
  };
  vm.createContext(sandbox);
  vm.runInContext(src.slice(from, to), sandbox, { filename: 'twitch-rewind.js:leak-check' });

  // Simulate a poll that reschedules itself 50 times.
  vm.runInContext('this.__tick = function () { woTimeout(__tick, 10); }; __tick();', sandbox);
  for (let i = 0; i < 50 && queue.length; i++) queue.shift()();
  const size = vm.runInContext('woPending.size', sandbox);
  check('a self-rescheduling woTimeout loop does not grow the pending set',
    size <= 2, 'pending set holds ' + size + ' after 50 reschedules');

  // And `this` is forwarded, which three call sites depend on.
  vm.runInContext('this.__seenThis = "unset";'
    + 'this.__probe = { run: function () { __seenThis = (this === undefined) ? "undefined" : "kept"; } };'
    + 'woTimeout(__probe.run, 0);', sandbox);
  queue[queue.length - 1].call(sandbox.window);
  check('woTimeout forwards `this` as the host would',
    vm.runInContext('__seenThis', sandbox) === 'kept', vm.runInContext('__seenThis', sandbox));
}

// ---------------------------------------------------------------------------
// 8. Repair no longer injects into live documents. It used to mark every guard's flag stale and
//    re-execute the files, which depended on published disposers and on a version-compare
//    install path -- both gone from the MAIN guards (SEC-03) -- and it read a MAIN-world marker
//    back to decide it had worked. It now asks each tab's isolated bridge whether the engine
//    answers a signed challenge and reloads the tabs that fail; a reload is a fresh
//    document_start hand-off. This section pins that the old machinery stays gone.
// ---------------------------------------------------------------------------
{
  const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  check('repair no longer marks install flags stale', !bg.includes('markWardenOneCopiesStale'));
  check('repair no longer keeps a component table to re-execute', !bg.includes('REPAIR_COMPONENTS'));
  check('repair no longer writes a stale sentinel into the page', !bg.includes('WO_STALE_SENTINEL'));
  check('repair asks the bridge for a signed liveness answer', bg.includes("{ kind: 'wo-engine-status' }"));
  check('repair reloads a tab whose engine did not answer', /if \(status && status\.alive\) \{ live\+\+; continue; \}\s*try \{ await chrome\.tabs\.reload\(t\.id\); reloaded\+\+; \}/.test(bg));
  check('repair never executes a MAIN-world file into a live tab',
    !/executeScript\(\{ target, world: 'MAIN', files/.test(bg));
  check('repair leaves alone the tabs the engine is meant to skip',
    /engineExcludedByManifest\(url\) \|\| isMainWorldRepairExcludedUrl\(url\)/.test(bg) && /t\.discarded/.test(bg));
  const bridge = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
  check('the bridge answers the status question with the challenge, top frame only',
    /msg\.kind === 'wo-engine-status' && window === window\.top[\s\S]{0,200}alive = bridgeEngineSeen && engineAnswers\(\)/.test(bridge));
}

// ---------------------------------------------------------------------------
// 9. End to end on the real guard text: a stale flag must make the guard reinstall and
//    dispose the old copy, while a matching flag must still make it return.
// ---------------------------------------------------------------------------
for (const g of GUARDS.filter((x) => !x.refreshes && !x.versionExpr)) {
  const src = sources.get(g.file);
  const from = src.indexOf("  const WO_GUARD_VERSION = '");
  const to = src.indexOf('  window.' + g.flag + ' = WO_GUARD_VERSION;') + ('  window.' + g.flag + ' = WO_GUARD_VERSION;').length;
  assert(from >= 0 && to > from, 'could not lift the guard decision from ' + g.file);
  // Wrap in a function so `return` is legal outside a script body.
  const decision = 'this.__ran = false; (function () {\n' + src.slice(from, to)
    + '\n  __ran = true;\n})();';

  const cases = g.main
    ? [
      ['a matching flag returns early', MANIFEST.version, false, false],
      ['a flag of another version returns early too, and disposes nothing (SEC-03)', 'wo-stale', false, false],
      ['an unset flag installs cleanly', undefined, true, false],
    ]
    : [
      ['a matching flag still returns early', MANIFEST.version, false, false],
      ['a stale flag reinstalls and disposes the old copy', 'wo-stale', true, true],
      ['an unset flag installs cleanly', undefined, true, false],
    ];
  for (const [label, flagValue, expectRan, expectDisposed] of cases) {
    const win = {};
    let disposed = false;
    if (flagValue !== undefined) win[g.flag] = flagValue;
    win[g.dispose] = () => { disposed = true; };
    const sandbox = { window: win, top: win };
    sandbox.window.top = g.topFrameOnly ? win : win;
    vm.createContext(sandbox);
    vm.runInContext(decision, sandbox, { filename: g.file + ':guard-decision' });
    const ran = vm.runInContext('__ran', sandbox);
    check(g.file + ': ' + label,
      ran === expectRan && disposed === expectDisposed,
      'ran=' + ran + ' (want ' + expectRan + ') disposed=' + disposed + ' (want ' + expectDisposed + ')');
  }
}

// ---------------------------------------------------------------------------
// 10. bridge.js. It was already version-coupled, but it had no dispose -- so re-installing over
//     an orphan left its 36 listeners attached -- and its guard had a worse problem: the `return`
//     for the same-version case sat INSIDE the `typeof replay === 'function'` check. A bridge
//     whose replay had not been assigned yet (it is set 840 lines after the flag) or whose replay
//     a page had overwritten with a non-function fell through and installed a SECOND complete
//     bridge. A page could force that with window.__wardenOneBridgeReplay = 1.
// ---------------------------------------------------------------------------
{
  const bridge = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
  const decl = bridge.match(/const BRIDGE_VERSION = '([^']+)';/);
  check('bridge: version constant matches manifest',
    !!decl && decl[1] === MANIFEST.version, decl ? decl[1] : 'not found');
  check('bridge: publishes a dispose', bridge.includes('window.__wardenOneBridgeDispose = () => {'));
  check('bridge: disposes an older copy before installing',
    /if \(window\.__wardenOneBridgeVersion\) \{[\s\S]{0,400}window\.__wardenOneBridgeDispose\(\)/.test(bridge));

  // Chrome's extension events are counted too. They were the blind spot: this block only looked
  // at DOM .addEventListener, so it reported a complete registry while every Repair left two
  // chrome.runtime.onMessage listeners attached and added two more. They are not covered by the
  // abort signal and need removeListener by identity, so a raw addListener outside the helper is
  // a listener dispose can never reach.
  const strays = {
    '.addEventListener(': (bridge.match(/\.addEventListener\(/g) || []).length,
    'setInterval(': (bridge.match(/\bsetInterval\(/g) || []).length,
    'setTimeout(': (bridge.match(/\bsetTimeout\(/g) || []).length,
    'new MutationObserver(': (bridge.match(/new MutationObserver\(/g) || []).length,
    'chrome.runtime.onMessage.addListener(':
      (bridge.match(/chrome\.runtime\.onMessage\.addListener\(/g) || []).length,
  };
  // Same pairing rule as the guards loop above. The owned-overlay focus trap is a second raw
  // addEventListener on purpose: it has to come off when THAT overlay closes rather than when the
  // whole bridge tears down, so woOn would be the wrong home for it. Unpaired is still a leak.
  for (const [call, n] of Object.entries(strays)) {
    if (call === '.addEventListener(' && n > 1) {
      const removals = (bridge.match(/\.removeEventListener\(/g) || []).length;
      check('bridge: every extra raw addEventListener has a matching removeEventListener',
        removals >= n - 1, n + ' added, ' + removals + ' removed');
      continue;
    }
    check('bridge: one raw ' + call + ' (the helper)', n === 1, n + ' found');
  }
  check('bridge: Chrome listeners are registered for removal',
    /woChromeListeners\.push\(\[chrome\.runtime\.onMessage, fn\]\)/.test(bridge));
  check('bridge: dispose removes them by identity',
    /event\.removeListener\(fn\)/.test(bridge));

  // Its registry must be the same code as the other nine, making ten -- but bridge and eyeshield
  // legitimately carry MORE than the shared core, because they are the two that register Chrome
  // extension events. So the shared core is what has to match; the Chrome extension is compared
  // separately, by the checks above and the cross-file sweep below.
  const from = bridge.indexOf('  /* Everything this copy holds');
  const to = bridge.indexOf('  // Chrome\'s extension events are not DOM events');
  assert(from >= 0 && to > from, 'could not find the bridge registry');
  check('bridge: registry core is identical to the other nine',
    sharedRegistryCore(bridge, { dispose: '__wardenOneBridgeDispose', disposeDecl: 'window.__wardenOneBridgeDispose = () => {' }) === registries[0]);

  // Behaviour of the guard decision, which is where the defect was.
  const gFrom = bridge.indexOf("  const BRIDGE_VERSION = '");
  const gTo = bridge.indexOf('  window.__wardenOneBridgeVersion = BRIDGE_VERSION;')
    + '  window.__wardenOneBridgeVersion = BRIDGE_VERSION;'.length;
  assert(gFrom >= 0 && gTo > gFrom, 'could not lift the bridge guard');
  const decision = 'this.__ran = false; (function () {\n' + bridge.slice(gFrom, gTo)
    + '\n  __ran = true;\n})();';

  const cases = [
    ['same version, replay present: replays and stops',
      { v: MANIFEST.version, replay: 'fn' }, { ran: false, replayed: true, disposed: false }],
    // The regression that mattered: this used to fall through and install a second bridge.
    ['same version, replay missing: still stops',
      { v: MANIFEST.version, replay: null }, { ran: false, replayed: false, disposed: false }],
    ['same version, replay clobbered by the page: still stops',
      { v: MANIFEST.version, replay: 'number' }, { ran: false, replayed: false, disposed: false }],
    ['stale flag: disposes the old bridge and installs',
      { v: 'wo-stale', replay: 'fn' }, { ran: true, replayed: false, disposed: true }],
    ['no flag: installs cleanly',
      { v: undefined, replay: null }, { ran: true, replayed: false, disposed: false }],
  ];
  for (const [label, input, want] of cases) {
    const win = {};
    let replayed = false;
    let disposed = false;
    if (input.v !== undefined) win.__wardenOneBridgeVersion = input.v;
    if (input.replay === 'fn') win.__wardenOneBridgeReplay = () => { replayed = true; };
    else if (input.replay === 'number') win.__wardenOneBridgeReplay = 1;
    win.__wardenOneBridgeDispose = () => { disposed = true; };

    const sandbox = { window: win };
    vm.createContext(sandbox);
    vm.runInContext(decision, sandbox, { filename: 'bridge.js:guard-decision' });
    const ran = vm.runInContext('__ran', sandbox);
    check('bridge: ' + label,
      ran === want.ran && replayed === want.replayed && disposed === want.disposed,
      'ran=' + ran + '/' + want.ran + ' replayed=' + replayed + '/' + want.replayed
        + ' disposed=' + disposed + '/' + want.disposed);
  }
}

// ---------------------------------------------------------------------------
// 11. Cross-file sweep: anything that registers a Chrome extension event must also release it.
//
// This is the check that would have found the leak on its own. The blind spot was not that the
// bridge was missed, it was that nothing looked at chrome.*.addListener at all -- so eyeshield.js
// carried the identical bug, unnoticed, while the suite reported a complete registry. Repair
// reinstalls both files in every frame, so each run left listeners attached and added more.
// ---------------------------------------------------------------------------
{
  // Scoped to scripts that publish a dispose, which is what makes them reinstallable content
  // scripts. Extension pages -- popup.js, history.js, download-review.js -- also add Chrome
  // listeners, but their listeners die with the page, so requiring removal there would be noise.
  const injected = fs.readdirSync(ROOT)
    .filter((f) => f.endsWith('.js'))
    .filter((f) => fs.statSync(path.join(ROOT, f)).isFile())
    .filter((f) => /__wardenOne\w*Dispose = /.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));

  const offenders = [];
  for (const file of injected) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    const adds = (src.match(/chrome\.[a-zA-Z.]*\.addListener\(/g) || []).length;
    if (!adds) continue;
    if (!/removeListener\(/.test(src)) {
      offenders.push(file + ' (' + adds + ' addListener, no removeListener)');
    }
  }
  check('every injected script that adds a Chrome listener also removes one',
    offenders.length === 0, offenders.join('; '));
}

if (failures) {
  console.error('[fail] guard lifecycle tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] guard lifecycle tests passed');

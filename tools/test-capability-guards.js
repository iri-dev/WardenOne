/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Back-button traps, and three capabilities nothing else could see.
 *
 * Back trap: a page pushes a history entry, then pushes another every time you
 * press Back, so Back never leaves. Pushing history is NOT the tell -- every
 * single-page app does it constantly. The tell is pushing the same address you are
 * already on, immediately after a popstate, which is the moment Back fired. Most of
 * this file is that distinction.
 *
 * Capabilities: the native payment sheet (the card guard only watched form fields),
 * idle detection (presence tracking), and a site asking to install itself as an app
 * (an installed site opens with no address bar). None is blocked -- Chrome confirms
 * each one -- and the wrappers sit in front of APIs real sites use, so they have to
 * stay invisible.
 *
 * Run: node tools/test-capability-guards.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

function slice(start, end) {
  const from = CONTENT.indexOf(start);
  const to = CONTENT.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, 'missing shipped markers for ' + start);
  return CONTENT.slice(from, to).replace(/\s*$/, '');
}
/* Whole blocks, headers included, so the toggles are the real ones. */
const BACK_TRAP = slice('if(WO.backTrapGuard&&WO_TOP)try{', 'if(WO.capabilityGuard)try{');
const CAPABILITY = slice('if(WO.capabilityGuard)try{', 'if(WO.notificationAbuseGuard&&!trustedMediaHost)try{');

let passed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// Back-button trap
// ---------------------------------------------------------------------------
function backWorld(options) {
  const o = options || {};
  const logs = [];
  const listeners = Object.create(null);
  const pushed = [];
  let href = o.href || 'https://scary-alert.example/page';
  const clock = { now: 1000 };
  const moved = [];
  const history = {
    pushState(state, title, url) {
      pushed.push(url);
      if (url) href = String(url);
      return 'native-push';
    },
    /* The guard wraps these two as well, so the harness has to offer them to wrap. Both
       record rather than act: what matters is whether the call reached the real one. */
    go(delta) { moved.push(Number(delta) || 0); return 'native-go'; },
    forward() { moved.push(1); return 'native-forward'; },
  };
  const sandbox = {
    WO: { backTrapGuard: o.enabled !== false },
    WO_TOP: o.top !== false,
    history,
    location: { get href() { return href; } },
    log(type, detail) { logs.push({ type, detail }); },
    woOn(target, type, fn) { listeners[type] = fn; },
    Date: { now: () => clock.now },
    /* The guard resolves a push target against the current address before deciding, so the
       sandbox needs a real URL. Without it every push resolves to the fallback and the
       same-address test passes for the wrong reason. */
    URL,
    Object, Math, Number, String, Array,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(BACK_TRAP, sandbox, { filename: 'back-trap-slice.js' });
  return {
    logs,
    pushed,
    moved,
    back() { if (listeners.popstate) listeners.popstate(); },
    push(url) { return sandbox.history.pushState(null, '', url); },
    /* Any ordinary interaction vouches for the pushes that follow it. The guard listens for
       several; one stands in for all of them here. */
    gesture() { if (listeners.pointerdown) listeners.pointerdown(); },
    forward() { return sandbox.history.forward(); },
    go(n) { return sandbox.history.go(n); },
    advance(ms) { clock.now += ms; },
    setHref(v) { href = v; },
  };
}

{
  const w = backWorld();
  w.back(); w.push(null);
  w.back(); w.push(null);
  check('re-pushing the same address after Back, twice, is a trap',
    w.logs.length === 1 && w.logs[0].type === 'warned_back_trap', w.logs);
  const d = w.logs[0] && w.logs[0].detail;
  check('it tells you how to get out', d && /close the tab/i.test(d.action), d);
  check('it does not claim to have rewritten history',
    d && /not rewritten/i.test(d.outcome) && !/rewrote|undone|removed entries/i.test(d.outcome), d);
  /* The guard used to only warn, on the reasoning that unwinding somebody's history from
     underneath them is worse than the trap. That reasoning still holds and nothing here
     unwinds anything -- but declining to ADD an entry is a different act from removing one,
     and it is the entire trick. So the repeat push is refused and Back starts working. */
  check('and it says Back works now, rather than telling you to keep pressing',
    d && /Back works again/i.test(d.outcome), d);
}

/* ---------------------------------------------------------------------------
   The other two shapes a back-trap takes. Refusing the re-add closes the one that
   answers your Back; neither of these needs you to press Back at all.
   --------------------------------------------------------------------------- */
{
  /* Flooding. The page stacks entries while you read, so that Back has to be pressed once
     for each of them before it can leave. Nothing asked for any of them. */
  const w = backWorld();
  for (let i = 0; i < 20; i++) { w.advance(50); w.push('/step-' + i); }
  check('a flood of entries nobody asked for is cut off', w.pushed.length === 6, w.pushed.length);
  check('and it is reported as a back trap',
    w.logs.length === 1 && w.logs[0].type === 'warned_back_trap', w.logs);
  const flood = w.logs[0] && w.logs[0].detail;
  check('the notice says what this one actually did',
    !!flood && /without you doing anything/i.test(flood.why), flood && flood.why);
  check('and that Back is usable again',
    !!flood && /Back needs one press/i.test(flood.outcome), flood && flood.outcome);
}

{
  /* The half that matters more. An app you are using pushes constantly, and every one of
     those follows something you did -- which is exactly what the budget is keyed on. */
  const w = backWorld();
  for (let round = 0; round < 8; round++) {
    w.gesture();
    for (let i = 0; i < 5; i++) { w.advance(40); w.push('/r' + round + '-' + i); }
  }
  check('an app pushing after every interaction is never cut off', w.pushed.length === 40, w.pushed.length);
  check('and is never warned about', w.logs.length === 0, w.logs);
}

{
  /* A route normalised on load, before anyone has touched anything, still goes through. */
  const w = backWorld();
  w.push('/home'); w.push('/home?ready=1');
  check('a couple of pushes on load are ordinary, not a flood', w.pushed.length === 2);
  check('and raise nothing', w.logs.length === 0, w.logs);
}

{
  /* Forcing you forward. You press Back, the page immediately undoes it. */
  const w = backWorld();
  w.back();
  w.forward();
  check('being shoved forward the instant you press Back is refused', w.moved.length === 0, w.moved);
  const fwd = w.logs[0] && w.logs[0].detail;
  check('and is reported', w.logs.length === 1 && !!fwd && /sent you straight forward/i.test(fwd.why),
    fwd && fwd.why);
}

{
  const w = backWorld();
  w.back();
  w.go(1);
  check('history.go(1) right after Back is refused too', w.moved.length === 0, w.moved);
}

{
  /* Going BACK is never the thing being refused, however it is spelled. */
  const w = backWorld();
  w.back();
  w.go(-1);
  check('history.go(-1) is always allowed', w.moved.length === 1 && w.moved[0] === -1, w.moved);
}

{
  /* A Next button on a gallery is the same call and has every right to work. */
  const w = backWorld();
  w.forward();
  check('forward with no Back behind it is ordinary navigation', w.moved.length === 1, w.moved);
  w.back();
  w.advance(2000);
  w.forward();
  check('and forward long after a Back is not undoing it', w.moved.length === 2, w.moved);
  check('neither raised a warning', w.logs.length === 0, w.logs);
}

{
  /* One notice per page whichever way the page went about it. */
  const w = backWorld();
  for (let i = 0; i < 20; i++) { w.advance(50); w.push('/step-' + i); }
  w.back();
  w.forward();
  check('a page trying every shape is still only reported once', w.logs.length === 1, w.logs.length);
}

{
  /* The refusal itself: the trapping push must not reach the real pushState. */
  const w = backWorld();
  w.back(); w.push(null);
  check('the first re-push after Back is allowed through — one can be an app restoring a modal',
    w.pushed.length === 1, w.pushed);
  w.back(); w.push(null);
  check('the second is refused, so the page cannot re-arm the trap',
    w.pushed.length === 1, w.pushed);
  w.back(); w.push(null);
  w.back(); w.push(null);
  check('and every one after that is refused too', w.pushed.length === 1, w.pushed);
  check('the refusal is reported once, not once per push',
    w.logs.filter((l) => l.type === 'warned_back_trap').length === 1, w.logs.length);
  check('a refused push returns undefined, exactly as the real one does',
    w.push(null) === undefined);
}

{
  /* The half that matters more: ordinary pages must be untouched. */
  const w = backWorld();
  /* Deliberately under the gestureless budget, so this block tests the re-add rule on its own
     rather than colliding with the flood cap, which has its own tests above. */
  for (let i = 0; i < 4; i++) w.push('/page-' + i);
  check('a normal app moving between addresses is never refused', w.pushed.length === 4, w.pushed);
  w.back();
  w.push('/somewhere-else');
  check('and a different address right after Back is still allowed', w.pushed.length === 5, w.pushed);
}

{
  /* The window is measured from Back, not from the previous push, so a page that re-adds the
     address a long moment after you pressed Back is doing something else and is left alone.
     Pressing Back again restarts that window, which is why this advances before each push
     rather than between the two Backs. */
  const w = backWorld();
  w.back(); w.advance(2000); w.push(null);
  w.back(); w.advance(2000); w.push(null);
  check('a re-push that lands long after Back is not the trap pattern', w.pushed.length === 2, w.pushed);
}

{
  const w = backWorld();
  w.back(); w.push(null);
  check('one re-push could be an app restoring a modal, so it is not enough',
    w.logs.length === 0, w.logs);
}

{
  const w = backWorld();
  w.push('/a'); w.push('/b'); w.push('/c'); w.push('/d');
  check('an app pushing its own routes is not a trap', w.logs.length === 0, w.logs);
}

{
  const w = backWorld();
  w.back();
  w.advance(4000);
  w.push(null);
  w.back();
  w.advance(4000);
  w.push(null);
  check('a push long after Back is unrelated to it', w.logs.length === 0, w.logs);
}

{
  const w = backWorld();
  w.back(); w.push('/somewhere-else'); w.back(); w.push('/elsewhere-again');
  check('pushing a DIFFERENT address after Back is ordinary navigation',
    w.logs.length === 0, w.logs);
}

{
  const w = backWorld();
  for (let i = 0; i < 6; i++) { w.back(); w.push(null); }
  check('a trap is reported once, however many times it re-arms',
    w.logs.length === 1, w.logs);
}

{
  const w = backWorld();
  const out = w.push(null);
  check('pushState still reaches the browser and returns its result',
    out === 'native-push' && w.pushed.length === 1, { out, pushed: w.pushed });
}

{
  const w = backWorld({ top: false });
  w.back(); w.push(null); w.back(); w.push(null);
  check('a frame does not warn on the top page\'s behalf', w.logs.length === 0, w.logs);
}

{
  const w = backWorld({ enabled: false });
  w.back(); w.push(null); w.back(); w.push(null);
  check('turning the back-trap guard off silences it', w.logs.length === 0, w.logs);
}

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------
function capWorld(options) {
  const o = options || {};
  const logs = [];
  const listeners = Object.create(null);
  const shown = [];
  const started = [];

  function PaymentRequest(methodData, details) {
    this.__methods = methodData;
    this.__details = details;
  }
  PaymentRequest.prototype.show = function () { shown.push(this); return Promise.resolve('native-sheet'); };

  function IdleDetector() {}
  IdleDetector.prototype.start = function (opts) { started.push(opts); return Promise.resolve('native-idle'); };

  const registered = [];
  const swContainer = {
    register(url, opts) { registered.push({ url, opts }); return Promise.resolve({ scope: 'native-registration' }); },
  };
  const sandbox = {
    WO: { capabilityGuard: o.enabled !== false },
    PaymentRequest: o.noPayment ? undefined : PaymentRequest,
    IdleDetector: o.noIdle ? undefined : IdleDetector,
    navigator: o.noServiceWorker ? {} : { serviceWorker: swContainer },
    location: { href: 'https://shop.example/checkout/step-2' },
    URL,
    log(type, detail) { logs.push({ type, detail }); },
    woOn(target, type, fn) { listeners[type] = fn; },
    Object, Math, Number, String, Array, Promise, Date,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(CAPABILITY, sandbox, { filename: 'capability-slice.js' });
  return {
    logs, shown, started, sandbox, registered,
    registerWorker(url, opts) { return sandbox.navigator.serviceWorker.register(url, opts); },
    installPrompt(realPrompt) {
      const event = { prompt: realPrompt };
      if (listeners.beforeinstallprompt) listeners.beforeinstallprompt(event);
      return event;
    },
  };
}

{
  const w = capWorld();
  const request = new w.sandbox.PaymentRequest(
    [{ supportedMethods: 'basic-card' }, { supportedMethods: 'https://google.com/pay' }],
    { total: { label: 'SECRET ITEM', amount: { currency: 'GBP', value: '99.00' } } }
  );
  const out = request.show();
  check('opening the payment sheet is recorded',
    w.logs.length === 1 && w.logs[0].type === 'warned_payment_sheet', w.logs);
  check('the sheet still opens', w.shown.length === 1 && out instanceof Promise);
  const d = w.logs[0] && w.logs[0].detail;
  check('it records which payment methods were offered',
    d && /basic-card/.test(d.methods), d);
  check('but never the amount or what was being bought',
    !/SECRET ITEM|99\.00|GBP/.test(JSON.stringify(w.logs)), w.logs);
  check('it says nothing is paid without confirming', d && /unless you confirm/i.test(d.why), d);
}

{
  const w = capWorld();
  const detector = new w.sandbox.IdleDetector();
  const out = detector.start({ threshold: 60000 });
  check('starting idle detection is recorded',
    w.logs.length === 1 && w.logs[0].type === 'warned_idle_watch', w.logs);
  check('the watch still starts', w.started.length === 1 && out instanceof Promise);
  check('it names it as presence tracking',
    /presence tracking/i.test(w.logs[0].detail.why), w.logs[0].detail);
}

{
  const w = capWorld();
  let called = 0;
  const event = w.installPrompt(function () { called++; return Promise.resolve({ outcome: 'accepted' }); });
  check('merely being installable is not an event', w.logs.length === 0, w.logs);
  event.prompt();
  check('asking to install IS an event',
    w.logs.length === 1 && w.logs[0].type === 'warned_app_install_prompt', w.logs);
  check('and the prompt still reaches the browser', called === 1);
  check('it explains why a windowed app matters',
    /no address bar/i.test(w.logs[0].detail.why), w.logs[0].detail);
}

{
  const w = capWorld();
  const event = w.installPrompt(function () { return Promise.resolve(); });
  event.prompt();
  event.prompt();
  event.prompt();
  const first = w.logs.length;
  check('repeated prompts cannot flood the log', first <= 4, first);
}

{
  const w = capWorld({ noPayment: true, noIdle: true });
  check('a browser without these APIs simply has nothing wrapped', w.logs.length === 0, w.logs);
  const event = w.installPrompt(function () { return Promise.resolve(); });
  event.prompt();
  check('and the one it does have still works', w.logs.length === 1, w.logs);
}

{
  const w = capWorld();
  const before = w.sandbox.PaymentRequest;
  vm.runInContext(CAPABILITY, w.sandbox, { filename: 'capability-slice.js' });
  check('installing twice does not stack wrappers', w.sandbox.PaymentRequest === before);
}

{
  const w = capWorld({ enabled: false });
  new w.sandbox.PaymentRequest([{ supportedMethods: 'basic-card' }], {}).show();
  new w.sandbox.IdleDetector().start({});
  check('turning the capability guard off silences it', w.logs.length === 0, w.logs);
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------
{
  /* Service workers. The one thing a page can leave behind: once registered it outlives the
     tab and sits in front of every request to that origin on later visits. Ordinary -- it is
     how offline and push work -- so nothing is blocked; what was missing was any note that it
     had happened. It is also the reachable half of a limit already documented in this file: a
     notification raised from a worker's push event is created outside the page, where a content
     script cannot go, but the registration itself is right there. */
  {
    const w = capWorld();
    w.registerWorker('/sw.js');
    check('registering a service worker is recorded',
      w.logs.length === 1 && w.logs[0].type === 'warned_service_worker', w.logs);
    const d = w.logs[0] && w.logs[0].detail;
    check('and it says the thing that matters, that it outlives the tab',
      !!d && /stays after you close the tab/i.test(d.why), d && d.why);
    check('a default registration covers the whole site', !!d && d.matched === 'whole site', d);
    check('the registration still happens', w.registered.length === 1, w.registered);
  }

  {
    /* Scope is recorded as how much it covers, never as a path -- a path would put a page you
       visited into the log for no benefit. */
    const w = capWorld();
    w.registerWorker('/app/sw.js', { scope: '/app/' });
    const d = w.logs[0] && w.logs[0].detail;
    check('a narrower scope is recorded as narrower', !!d && d.matched === 'part of the site', d);
    const blob = JSON.stringify(w.logs);
    check('and neither the path nor the script is written down',
      blob.indexOf('/app/') < 0 && blob.indexOf('sw.js') < 0, blob.slice(0, 180));
  }

  {
    const w = capWorld({ enabled: false });
    w.registerWorker('/sw.js');
    check('with the guard off nothing is recorded', w.logs.length === 0, w.logs);
    check('and the registration is untouched', w.registered.length === 1, w.registered);
  }

  /* capabilityGuard blocks nothing at all -- Chrome confirms the payment sheet, the idle
     permission and the install prompt itself -- so a switch only implied there was protection
     to turn off. It is listed under "What WardenOne watches" and still answers to the master
     switch and the site allowlist, which is what gate() carries. */
  check('capabilityGuard ships on by default', /capabilityGuard:!0/.test(SOURCE));
  check('capabilityGuard is always on, still under the master switch and the allowlist',
    /capabilityGuard:gate\(!0\)/.test(SOURCE));
  check('capabilityGuard has no toggle', !/data-key="capabilityGuard"/.test(POPUP_HTML));
  check('capabilityGuard is still listed, so it is not watching invisibly',
    POPUP_HTML.includes('Browser capabilities') && POPUP_HTML.includes('What WardenOne watches'));

  /* backTrapGuard is the opposite case, and it changed sides. While it only warned it belonged
     with the watch-only guards. It now REFUSES a page's pushState and forward calls so Back
     keeps working -- that changes what the page can do and can affect a site that trips the
     heuristics, which is exactly the line that decides whether something gets a switch. So it
     has one again, on by default, and is counted among the switchable protections. */
  check('backTrapGuard ships on by default', /backTrapGuard:!0/.test(SOURCE));
  check('backTrapGuard honours its own toggle, not just the master switch',
    /backTrapGuard:gate\(cfg\.backTrapGuard\)/.test(SOURCE));
  check('backTrapGuard has a toggle, because it refuses things',
    /data-key="backTrapGuard"/.test(POPUP_HTML) && /'backTrapGuard'/.test(POPUP_JS));
  check('and it is not listed as watch-only, which would now be untrue',
    !new RegExp('row watch"[\\s\\S]{0,200}Back-button traps').test(POPUP_HTML));
  check('the watch-only section no longer claims four',
    !/These four only ever write/.test(POPUP_HTML) && /These three only ever write/.test(POPUP_HTML));
  for (const type of ['warned_back_trap', 'warned_payment_sheet', 'warned_idle_watch',
    'warned_app_install_prompt']) {
    check('Activity Center names ' + type, new RegExp(type + ": '").test(HISTORY));
    check('the in-page notice explains ' + type, new RegExp(type + ':\\{').test(SOURCE));
  }
  /* This used to forbid the string history.go outright. The back-trap guard now WRAPS go and
     forward so a page cannot shove you forward the instant you press Back -- which is the
     opposite of moving you: it declines a move the page asked for. The invariant worth holding
     was never "does not mention history.go", it is "never navigates you itself". */
  check('neither guard ever moves you itself',
    !/history\.back\(|\.go\(\s*-|location\.(?:assign|replace)\(|location\.href\s*=/.test(BACK_TRAP + CAPABILITY),
    'declining to ADD an entry is the fix; unwinding somebody history from underneath them would be worse than the trap');
  check('and neither cancels a page event or throws into the page',
    !/preventDefault|throw /.test(BACK_TRAP + CAPABILITY),
    'refusing a payment sheet would be worse than the thing being warned about');
}

if (process.exitCode) console.error('\ncapability guard checks failed');
else console.log('\n' + passed + ' capability guard checks passed.');

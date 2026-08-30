/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Push-notification abuse.
 *
 * The permission itself is watched by permission-chain.js, which records that a
 * prompt happened and how it was answered. This covers the two halves that wrapper
 * cannot speak to: the page talking you into clicking Allow, and what arrives
 * afterwards.
 *
 * Known limit, pinned below: a notification shown from a service worker's push
 * event is created in the worker, not the page, and a content script cannot reach
 * it. What is covered is everything the page itself raises.
 *
 * The wrapper sits on window.Notification, which real sites construct, so a good
 * part of this file is about it staying invisible -- and about requestPermission
 * being passed straight through, because wrapping it here too would report one
 * prompt twice.
 *
 * Run: node tools/test-notification-guard.js
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
const CHAIN = fs.readFileSync(path.join(ROOT, 'permission-chain.js'), 'utf8');

const START = 'if(WO.notificationAbuseGuard&&!trustedMediaHost)try{';
const END = 'if(WO.deviceAccessGuard)try{';
const from = CONTENT.indexOf(START);
const to = CONTENT.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the shipped notification guard markers are missing');
/* Whole block, header included, so the toggle and the media exemption are real. */
const GUARD = CONTENT.slice(from, to).replace(/\s*$/, '');

function run(options) {
  const o = options || {};
  const logs = [];
  const timers = [];
  const built = [];
  const shown = [];

  function RealNotification(title, opts) { built.push([title, opts]); this.title = title; }
  RealNotification.permission = o.permission === undefined ? 'default' : o.permission;
  RealNotification.maxActions = 2;
  RealNotification.requestPermission = function (...args) {
    RealNotification.__requested = (RealNotification.__requested || 0) + 1;
    return Promise.resolve('granted');
  };
  RealNotification.__isReal = true;

  function ServiceWorkerRegistration() {}
  ServiceWorkerRegistration.prototype.showNotification = function (title, opts) {
    shown.push([title, opts]);
    return Promise.resolve('native');
  };

  const sandbox = {
    WO: { notificationAbuseGuard: o.enabled !== false },
    WO_TOP: o.top !== false,
    trustedMediaHost: !!o.trustedMediaHost,
    Notification: RealNotification,
    ServiceWorkerRegistration,
    document: { body: { innerText: o.pageText || '' }, documentElement: {} },
    log(type, detail) { logs.push({ type, detail }); },
    __woObserver: () => ({ observe() {}, disconnect() {} }),
    setTimeout(fn) { timers.push(fn); return timers.length; },
    Object, Math, Number, String, Array, Promise, Date, Set, RegExp,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'notification-guard-slice.js' });
  while (timers.length) {
    const fn = timers.shift();
    if (typeof fn === 'function') fn();
  }
  return { logs, sandbox, built, shown, RealNotification, ServiceWorkerRegistration };
}

let passed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}
const types = (r) => r.logs.map((l) => l.type);

// ---------------------------------------------------------------------------
// Before: the page talking you into it
// ---------------------------------------------------------------------------
{
  for (const [wording, note] of [
    ['Click Allow to continue watching', 'the classic'],
    ['Press "Allow" if you are not a robot', 'fake robot check'],
    ['Tap ALLOW to download your file', 'download bait'],
    ['Allow notifications to continue', 'plain'],
  ]) {
    const r = run({ pageText: wording });
    check('coaxing is caught: ' + note, types(r).includes('warned_notification_bait'), { wording, logs: r.logs });
  }
}

{
  const r = run({ pageText: 'Click Allow to continue' });
  const d = r.logs[0] && r.logs[0].detail;
  check('it tells you what to click instead', d && /Choose Block/i.test(d.action), d);
  check('it does not claim to have changed the prompt', d && /left alone/i.test(d.outcome), d);
}

{
  const r = run({ pageText: 'Click Allow to continue', permission: 'granted' });
  check('once the site is already allowed the wording is just wording',
    !types(r).includes('warned_notification_bait'), r.logs);
}

{
  const r = run({ pageText: 'Click Allow to continue', permission: 'denied' });
  check('and once blocked there is nothing left to warn about',
    !types(r).includes('warned_notification_bait'), r.logs);
}

{
  const r = run({ pageText: 'We allow returns within 30 days. Cookies allow us to remember your basket.' });
  check('ordinary uses of the word "allow" are not bait', r.logs.length === 0, r.logs);
}

{
  const r = run({ pageText: 'Click Allow to continue', top: false });
  check('a frame does not warn on the top page\'s behalf', r.logs.length === 0, r.logs);
}

// ---------------------------------------------------------------------------
// After: what actually arrives
// ---------------------------------------------------------------------------
{
  for (const [title, body, shape] of [
    ['Warning', 'Virus detected on your computer. Click to remove.', 'fake malware alert'],
    ['Alert', 'Your PC is infected with 5 trojans', 'fake malware alert'],
    ['(3) new messages', '', 'fake unread-message badge'],
    ['Congratulations!', 'You have won a prize, claim your reward now', 'prize bait'],
    ['Your antivirus subscription has expired', '', 'fake expiry notice'],
    ['Update your Flash Player', '', 'fake update prompt'],
    ['Security alert', 'Immediate action required', 'urgency bait'],
  ]) {
    const r = run({ permission: 'granted' });
    new r.sandbox.Notification(title, { body });
    check('a ' + shape + ' is caught', types(r).includes('warned_notification_scam'), { title, body, logs: r.logs });
    if (r.logs.length) check('  and named as a ' + shape, r.logs[0].detail.shape === shape, r.logs[0].detail);
  }
}

{
  const r = run({ permission: 'granted' });
  new r.sandbox.Notification('Build finished', { body: 'Your deploy to staging succeeded' });
  check('an ordinary notification is left alone', r.logs.length === 0, r.logs);
}

{
  const r = run({ permission: 'granted' });
  r.ServiceWorkerRegistration.prototype.showNotification.call({}, 'Virus detected', { body: 'Scan now' });
  check('a notification raised through a registration is covered too',
    types(r).includes('warned_notification_scam'), r.logs);
}

{
  const r = run({ permission: 'granted' });
  new r.sandbox.Notification('Virus detected on your PC', {});
  new r.sandbox.Notification('Virus detected on your PC', {});
  new r.sandbox.Notification('Trojan found, remove now', {});
  check('the same shape is reported once, not once per notification',
    r.logs.filter((l) => l.type === 'warned_notification_scam').length === 1, r.logs);
}

// ---------------------------------------------------------------------------
// The wrapper sits on an API real sites construct
// ---------------------------------------------------------------------------
{
  const r = run({ permission: 'granted' });
  const made = new r.sandbox.Notification('Build finished', { body: 'ok' });
  check('the notification is still actually created', r.built.length === 1, r.built);
  check('and the page gets a real instance back', made instanceof r.RealNotification);
}

{
  const r = run({ permission: 'granted' });
  const out = r.ServiceWorkerRegistration.prototype.showNotification.call({}, 'Build finished', {});
  check('showNotification still returns what the browser returned',
    out && typeof out.then === 'function', out);
  check('and still reaches the browser', r.shown.length === 1, r.shown);
}

{
  const r = run({ permission: 'granted' });
  check('Notification.permission still reads through', r.sandbox.Notification.permission === 'granted');
  check('static properties are not lost', r.sandbox.Notification.maxActions === 2);
}

{
  const r = run({});
  r.sandbox.Notification.requestPermission();
  check('requestPermission still reaches the real one', r.RealNotification.__requested === 1);
  check('and asking is not logged here -- permission-chain.js owns that',
    r.logs.length === 0, r.logs);
  check('permission-chain still has its own wrapper', /__woPermChainRequest/.test(CHAIN));
}

{
  const r = run({ permission: 'granted' });
  const first = r.sandbox.Notification;
  vm.runInContext(GUARD, r.sandbox, { filename: 'notification-guard-slice.js' });
  check('installing twice does not stack wrappers', r.sandbox.Notification === first);
}

// ---------------------------------------------------------------------------
// Privacy, noise and the switch
// ---------------------------------------------------------------------------
{
  const r = run({ permission: 'granted' });
  new r.sandbox.Notification('Virus detected: SECRETPAYLOAD', { body: 'SECRETBODY here' });
  const serialized = JSON.stringify(r.logs);
  check('the notification wording never reaches the log',
    !/SECRETPAYLOAD|SECRETBODY/.test(serialized), serialized);
}

{
  const r = run({ permission: 'granted' });
  for (const t of ['Virus detected', '(1) new message', 'You have won a prize',
    'Your subscription expired', 'Update your Flash Player', 'Security alert']) {
    new r.sandbox.Notification(t, {});
  }
  check('a site cannot flood the log', r.logs.length <= 4, r.logs.length);
}

{
  const r = run({ trustedMediaHost: true, pageText: 'Click Allow to continue', permission: 'default' });
  check('the established media hosts are exempt', r.logs.length === 0, r.logs);
}

{
  const r = run({ enabled: false, pageText: 'Click Allow to continue' });
  new r.sandbox.Notification('Virus detected', {});
  check('turning the guard off silences it', r.logs.length === 0, r.logs);
}

// ---------------------------------------------------------------------------
// Wiring, and the limit stated honestly
// ---------------------------------------------------------------------------
{
  check('it ships on by default', /notificationAbuseGuard:!0/.test(SOURCE));
  check('the toggle is gated by the master switch',
    /notificationAbuseGuard:gate\(cfg\.notificationAbuseGuard\)/.test(SOURCE));
  check('the popup can turn it off', /data-key="notificationAbuseGuard"/.test(POPUP_HTML));
  check('Activity Center names both events',
    /warned_notification_bait: '/.test(HISTORY) && /warned_notification_scam: '/.test(HISTORY));
  check('the in-page notices explain themselves',
    /warned_notification_bait:\{/.test(SOURCE) && /warned_notification_scam:\{/.test(SOURCE));
  check('nothing is suppressed on the page\'s behalf',
    !/preventDefault|return null|throw /.test(GUARD),
    'silently swallowing a notification would be a worse surprise than the notification');
  check('the service-worker limit is written down where it will be read',
    // Whitespace-tolerant: the comment wraps, so a single-space pattern would
    // fail on wording that is actually present.
    /service worker's\s+push\s+event/i.test(SOURCE) && /cannot\s+reach\s+it/i.test(SOURCE),
    'a limit nobody records becomes a claim nobody checks');
  check('the popup says so too', /service worker/i.test(POPUP_HTML));
}

if (process.exitCode) console.error('\nnotification guard checks failed');
else console.log('\n' + passed + ' notification guard checks passed.');

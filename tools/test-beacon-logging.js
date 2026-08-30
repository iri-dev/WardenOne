/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * navigator.sendBeacon -- where the tracking pixel went.
 *
 * Checking three ad-heavy pages turned up not one 1x1 image between them; the
 * technique is gone. A single news front page fired fourteen beacons instead, to
 * doubleclick and an Akamai RUM endpoint among others. Those two are on the filter
 * lists and never reach the network, but a beacon to a host on NO list left no
 * trace anywhere -- there was no way to find out it had happened.
 *
 * So this records them. Never blocks: a beacon is also how ordinary sites report
 * crashes and page timings, and fourteen cards for one page view would be
 * unusable. The hook itself had no test at all before this file.
 *
 * Run: node tools/test-beacon-logging.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

const START = 'if(navigator.sendBeacon){\n        const realBeacon=navigator.sendBeacon.bind(navigator),';
const END = 'const ImgProto=HTMLImageElement.prototype,';
const from = SRC.indexOf(START);
const to = SRC.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the sendBeacon hook moved in src/content.js');
const SLICE = SRC.slice(from, to).replace(/try\{\s*$/, '');

let passed = 0;
let failed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

function world(options) {
  const o = options || {};
  const logs = [];
  const sent = [];
  const sandbox = {
    WO: { logThirdPartyBeacons: o.enabled !== false },
    navigator: { sendBeacon: (url, data) => { sent.push(String(url)); return true; } },
    location: { hostname: o.page || 'news.example.com', href: 'https://' + (o.page || 'news.example.com') + '/' },
    isGrabberURL: (u) => (/grabify|iplogger/i.test(String(u)) ? 'iplogger.org' : ''),
    log: (type, detail) => logs.push({ type, detail }),
    regDomain: (h) => String(h || '').replace(/^www\./, '').split('.').slice(-2).join('.'),
    URL, Set, String,
  };
  vm.createContext(sandbox);
  vm.runInContext(SLICE, sandbox, { filename: 'beacon-slice.js' });
  return { logs, sent, beacon: (url, data) => sandbox.navigator.sendBeacon(url, data) };
}

// ---------------------------------------------------------------------------
{
  const w = world();
  const out = w.beacon('https://stats.g.doubleclick.net/collect', 'x');
  check('a third-party beacon is recorded',
    w.logs.length === 1 && w.logs[0].type === 'detected_beacon', w.logs);
  check('it names the destination, not the payload',
    w.logs[0].detail.matched === 'doubleclick.net'
      && !/collect|x/.test(JSON.stringify(w.logs[0].detail.matched)), w.logs[0].detail);
  check('and it is still sent, because a beacon is not a threat',
    w.sent.length === 1 && out === true, { sent: w.sent, out });
  check('the record is quiet, so nothing appears on screen',
    w.logs[0].detail.quiet === true,
    'fourteen cards for one page view would be unusable');
}

{
  const w = world();
  w.beacon('https://news.example.com/telemetry', 'x');
  w.beacon('https://www.news.example.com/other', 'x');
  check('a site reporting to itself is not worth recording',
    w.logs.length === 0 && w.sent.length === 2, w.logs);
}

{
  const w = world();
  for (let i = 0; i < 6; i++) w.beacon('https://stats.g.doubleclick.net/collect?n=' + i, 'x');
  check('one entry per destination, however many times it fires',
    w.logs.length === 1, w.logs.length);
  check('and every one of them still goes', w.sent.length === 6, w.sent.length);
}

{
  const w = world();
  for (let i = 0; i < 30; i++) w.beacon('https://tracker' + i + '.example.net/p', 'x');
  check('a page that beacons to endless hosts cannot flood the log',
    w.logs.length <= 12, w.logs.length);
  check('but nothing is ever dropped from the network', w.sent.length === 30, w.sent.length);
}

/* The behaviour that was already there, which had no test at all. */
{
  const w = world();
  const out = w.beacon('https://iplogger.org/1234', 'x');
  check('a known IP-logger beacon is still blocked outright',
    out === false && w.sent.length === 0, { out, sent: w.sent });
  check('and reported as a block, not as a background report',
    w.logs.length === 1 && w.logs[0].type === 'blocked_grabber_beacon', w.logs);
  check('a blocked grabber is NOT quiet -- that one the user should see',
    w.logs[0].detail.quiet !== true, w.logs[0].detail);
}

{
  const w = world({ enabled: false });
  w.beacon('https://stats.g.doubleclick.net/collect', 'x');
  check('turning the recording off silences it', w.logs.length === 0, w.logs);
  check('and the beacon still goes, because this never blocked anything',
    w.sent.length === 1, w.sent);
}

{
  const w = world({ enabled: false });
  const out = w.beacon('https://iplogger.org/1234', 'x');
  check('turning recording off does not turn grabber blocking off',
    out === false && w.logs.length === 1 && w.logs[0].type === 'blocked_grabber_beacon',
    'they are different features sharing one hook');
}

{
  const w = world();
  const out = w.beacon('not a url at all', 'x');
  check('an unparseable destination is sent, not thrown over',
    out === true && w.sent.length === 1, { out, sent: w.sent });
}

// ---------------------------------------------------------------------------
{
  check('it ships on by default', /logThirdPartyBeacons:!0/.test(SRC));
  /* No toggle. Nothing is blocked and nothing is drawn on the page, so there was never any
     protection here to switch off -- a toggle only implied there was. It is listed under
     "What WardenOne watches" instead, and stays subject to the master switch and the site
     allowlist, which is what gate() carries. */
  check('it is always on, still under the master switch and the allowlist',
    /logThirdPartyBeacons:gate\(!0\)/.test(SRC));
  check('it has no toggle',
    !/data-key="logThirdPartyBeacons"/.test(POPUP_HTML) && !/'logThirdPartyBeacons'/.test(POPUP_JS));
  check('but it is still listed, so nothing is watching invisibly',
    /Background reports/.test(POPUP_HTML) && /What WardenOne watches/.test(POPUP_HTML));
  check('Activity Center names it', /detected_beacon: '/.test(HISTORY));
  check('the notice says plainly that nothing was blocked',
    /detected_beacon:\{[\s\S]{0,400}?not blocked/.test(SRC),
    'recording something the user cannot act on has to explain itself');
  check('nothing about a beacon is ever cancelled',
    !/detected_beacon[\s\S]{0,200}?return\s*!1/.test(SRC),
    'ordinary sites report crashes and page timings this way');
}

if (failed) { console.error('\n' + failed + ' beacon-logging check(s) failed'); process.exit(1); }
console.log('\n' + passed + ' beacon logging checks passed.');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* The tracker learner's network listener used a filter of 1,776 URL patterns, which Chrome tests one by one on every
   request (Round 6 performance, 2026-11-28: about 80 ms of the browser's main thread per news page). It now filters by
   type only and checks the host itself. Fuzzed against Chrome's meaning of the old patterns, it hears exactly the same
   requests. Run: node tools/test-tracker-observer-filter.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const box = { URL, Set, String, Object };
vm.createContext(box);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'tracker-network-data.js'), 'utf8') + ';this.D = WO_TRACKER_NETWORK_DATA;', box);
const start = BG.indexOf('let __trackerNetworkHosts = null;');
const end = BG.indexOf('function trackerNetworkListener(', start);
assert.ok(start > 0 && end > start, 'the tracker host check moved; update this test');
const types = /const TRACKER_NETWORK_TYPES = (\[[^\]]*\]);/.exec(BG);
assert.ok(types, 'TRACKER_NETWORK_TYPES moved; update this test');
vm.runInContext('const TRACKER_NETWORK_TYPES = ' + types[1] + ';\nvar noteTrackerNetworkRequest = () => {};\n' + BG.slice(start, BG.indexOf('\n', end)) + '\nthis.watched = trackerNetworkHostWatched; this.filter = trackerNetworkFilter; this.listener = trackerNetworkListener;', box);
const D = box.D;
let checks = 0;
const ok = (cond, label) => { assert.ok(cond, label); checks++; };

/* The filter Chrome sees: every http and https request of the four observed types, and no host list. */
const filter = box.filter();
ok(JSON.stringify(filter.urls) === JSON.stringify(['http://*/*', 'https://*/*']), 'the listener filter should carry no host patterns');
ok(JSON.stringify(filter.types) === JSON.stringify(['script', 'xmlhttprequest', 'image', 'ping']), 'the observed request types changed');

/* Chrome's meaning of the old patterns: '*://host/*' is that host exactly, '*://*.host/*' the host or any subdomain,
   and the '*' scheme is http or https. Ports and paths never mattered. */
const oldMatch = (url) => {
  let u; try { u = new URL(url); } catch (_) { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const h = u.hostname;
  if (D.cnameHosts.some((x) => x.toLowerCase() === h)) return true;
  return D.trackerHosts.concat(D.fingerprintHosts).some((x) => { x = x.toLowerCase(); return h === x || h.endsWith('.' + x); });
};
let seed = 1776;
const rand = (n) => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) % n; };
const pick = (a) => a[rand(a.length)];
const all = D.cnameHosts.concat(D.trackerHosts, D.fingerprintHosts);
const host = () => {
  const base = pick(all);
  switch (rand(8)) {
    case 0: return 'sub.' + base;
    case 1: return base.toUpperCase();
    case 2: return 'x' + base;
    case 3: return base.split('.').slice(1).join('.') || base;
    case 4: return base + '.evil.test';
    case 5: return pick(['example.com', 'cdn.example.net', 'news.test', 'localhost', '127.0.0.1']);
    default: return base;
  }
};
let same = 0, heard = 0;
for (let i = 0; i < 30000; i++) {
  const url = pick(['https://', 'http://', 'wss://', 'ftp://', 'HTTPS://']) + host() + pick(['', ':8443', ':80']) + pick(['/', '/t.js?id=1', '/pixel.gif']);
  const a = box.watched(url), b = oldMatch(url);
  assert.equal(a, b, 'the host check disagrees with the old patterns for ' + url);
  same++;
  if (a) heard++;
}
ok(heard > 5000,'the fuzz reached too few observed hosts to mean anything: ' + heard);
ok(box.watched('not a url') === false && box.watched('') === false, 'a malformed address is never observed');
checks += same > 0 ? 1 : 0;

/* The listener hands only watched requests to the learner, and every one of them. */
const calls = [];
vm.runInContext('noteTrackerNetworkRequest = (d) => { __calls.push(d.url); };', Object.assign(box, { __calls: calls }));
box.listener({ url: 'https://example.com/a.js' });
box.listener({ url: 'https://' + D.cnameHosts[0] + '/x' });
box.listener(null);
ok(calls.length === 1 && calls[0].includes(D.cnameHosts[0]), 'the listener must pass on exactly the watched requests');
ok(/void noteTrackerNetworkRequest\(details\)/.test(BG.slice(start, BG.indexOf('\n', end))), 'the listener no longer reaches the learner');

console.log('[ok] tracker observer filter: ' + same + ' fuzzed requests heard exactly as before (' + heard + ' observed), ' + checks + ' checks');

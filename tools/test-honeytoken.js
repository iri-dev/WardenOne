/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Honeytoken mode, run from the shipped content.min.js slice: a page reading the planted
 * sessionStorage decoy is reported, and WardenOne's own unload cleanup is not.
 *
 * Run: node tools/test-honeytoken.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const MIN = fs.readFileSync(path.join(__dirname, '..', 'content.min.js'), 'utf8');
const START = MIN.indexOf('if(WO.honeytokenMode&&WO_TOP)try{');
const END = MIN.indexOf('if(WO.scamLockGuard&&WO_TOP)try{', START);
if (START < 0 || END <= START) {
  console.error('FATAL: honeytoken markers not found in content.min.js');
  process.exit(1);
}
const SLICE = MIN.slice(START, END);

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); return; }
  fail++;
  console.log('  FAIL - ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : ''));
}

function makePage(existing) {
  const logs = [];
  const listeners = {};
  class Storage {
    constructor() { this.data = new Map(); }
    getItem(key) { return this.data.has(key) ? this.data.get(key) : null; }
    setItem(key, value) { this.data.set(key, String(value)); }
    removeItem(key) { this.data.delete(key); }
  }
  const sessionStorage = new Storage();
  for (const [key, value] of Object.entries(existing || {})) sessionStorage.setItem(key, value);
  const window = {
    sessionStorage,
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };
  const sandbox = {
    WO: { honeytokenMode: true },
    WO_TOP: true,
    window,
    Storage,
    log(type, detail) { logs.push({ type, detail }); },
    Math,
    Object,
    String,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(SLICE, sandbox);
  return {
    logs,
    storage: sessionStorage,
    reads: () => logs.filter((l) => l.type === 'warned_honeytoken_read'),
    leave: () => (listeners.pagehide || []).forEach((fn) => fn({ type: 'pagehide' })),
  };
}

const untouched = makePage();
check('the decoy token is planted', /^eyJ/.test(String(untouched.storage.data.get('access_token') || '')));
check('honeytoken mode reports it is active', untouched.logs.some((l) => l.type === 'honeytoken_mode_active'), untouched.logs);
untouched.leave();
check('leaving a page removes the decoy', !untouched.storage.data.has('access_token'), Array.from(untouched.storage.data.keys()));
check('leaving a page is not reported as the page reading the decoy', untouched.reads().length === 0, untouched.logs);

const page = makePage();
page.storage.getItem('access_token');
check('a page reading the decoy is still reported', page.reads().length === 1 && page.reads()[0].detail.where === 'sessionStorage',
  page.logs);
page.leave();
check('the cleanup after a real read adds no second report', page.reads().length === 1, page.logs);

const own = makePage({ access_token: 'the-sites-own-token' });
check('a page with its own token keeps it', own.storage.getItem('access_token') === 'the-sites-own-token');
own.leave();
check('its own token is never reported or removed', own.reads().length === 0 && own.storage.data.get('access_token') === 'the-sites-own-token',
  own.logs);

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

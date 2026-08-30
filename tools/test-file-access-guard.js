/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The File System Access API -- the one thing in this family nothing watched.
 *
 * WardenOne already recorded WebUSB, Web Serial, WebHID and Web Bluetooth. showDirectoryPicker
 * reaches further than any of them: read, or with mode readwrite write, over a whole folder tree
 * on the machine -- and the handle survives the visit, because a site can keep it in IndexedDB
 * and come back to it. "Pick your Downloads folder so we can scan it" is a shape scams already
 * use, and it left no trace anywhere.
 *
 * Nothing is blocked, for the same reason nothing is blocked for the device APIs: Chrome's own
 * picker is the real gate, and web editors, photo tools and IDEs use these properly every day.
 * The point is the record.
 *
 * Two things earn one, and the second matters more. Asking is loud -- a picker opens and you are
 * looking at it. A site that already holds a granted handle from an earlier visit is the quiet
 * case: queryPermission answers "granted" and it reads or writes with no prompt at all. So there
 * the ANSWER decides, not the call.
 *
 * The check this file exists for above all others: the folder is never named. Recording the path
 * would put the thing being protected into the log.
 *
 * Run: node tools/test-file-access-guard.js
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

/* The shipped block, header included, so the toggle it answers to is the real one. */
const START = 'if(WO.deviceAccessGuard)try{const FS_PICKERS=';
const END = '/* Browser-in-the-Browser.';
const from = CONTENT.indexOf(START);
const to = CONTENT.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the file-access guard moved in content.min.js');
const GUARD = CONTENT.slice(from, to);

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
}

function world(options) {
  const o = options || {};
  const logs = [];
  const called = [];
  /* A handle carries the folder's real name. It is here precisely so the test can prove the
     name never reaches the log. */
  const handleProto = {
    queryPermission() { called.push('queryPermission'); return Promise.resolve(o.permission || 'prompt'); },
  };
  const sandbox = {
    WO: { deviceAccessGuard: o.enabled !== false },
    log(type, detail) { logs.push({ type, detail }); },
    showDirectoryPicker(opts) { called.push('showDirectoryPicker'); return Promise.resolve({ name: 'Downloads', kind: 'directory' }); },
    showOpenFilePicker(opts) { called.push('showOpenFilePicker'); return Promise.resolve([{ name: 'tax-return.pdf' }]); },
    showSaveFilePicker(opts) { called.push('showSaveFilePicker'); return Promise.resolve({ name: 'invoice.pdf' }); },
    FileSystemHandle: function FileSystemHandle() {},
    Object, Promise, String, Number, Math, console,
  };
  sandbox.window = sandbox;
  sandbox.FileSystemHandle.prototype = handleProto;
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'file-access-slice.js' });
  return {
    logs,
    called,
    pick(name, opts) { return sandbox[name](opts); },
    query(opts) { return sandbox.FileSystemHandle.prototype.queryPermission.call({ name: 'Downloads' }, opts); },
  };
}

console.log('\nfile system access guard\n');

(async () => {
  {
    const w = world();
    await w.pick('showDirectoryPicker', { mode: 'readwrite' });
    check('asking for a folder is recorded', w.logs.length === 1 && w.logs[0].type === 'warned_file_request', w.logs);
    const d = w.logs[0] && w.logs[0].detail;
    check('read versus write is kept, because it is the difference that matters',
      !!d && d.mode === 'readwrite', d);
    check('and the notice says write, not just access', !!d && /read and write/i.test(d.why), d && d.why);
    check('a readwrite folder is High, whatever else it is', !!d && d.severity === 'High', d);
    check('the picker still runs — nothing is blocked', w.called.includes('showDirectoryPicker'), w.called);
    check('and the notice says so plainly', !!d && /not blocked/i.test(d.outcome), d && d.outcome);
  }

  {
    /* THE check. A handle knows the folder's name; the log must not. */
    const w = world();
    await w.pick('showDirectoryPicker', { mode: 'readwrite' });
    await w.pick('showOpenFilePicker');
    const blob = JSON.stringify(w.logs);
    check('the folder is never named in the record', !/Downloads/.test(blob), blob.slice(0, 160));
    check('nor is the file', !/tax-return/.test(blob), blob.slice(0, 160));
  }

  {
    const w = world();
    await w.pick('showOpenFilePicker');
    const d = w.logs[0] && w.logs[0].detail;
    check('reading one file is recorded but not treated as gravely as a folder',
      !!d && d.severity === 'Medium' && d.mode === 'read', d);
  }

  {
    /* The quiet one: a site that already holds a grant from a previous visit. */
    const w = world({ permission: 'granted' });
    await w.query({ mode: 'readwrite' });
    await new Promise((r) => setTimeout(r, 0));
    check('access still held from an earlier visit is recorded',
      w.logs.length === 1 && w.logs[0].type === 'warned_file_silent', w.logs);
    const d = w.logs[0] && w.logs[0].detail;
    check('and it says why that one is different — no prompt at all',
      !!d && /needs no prompt/i.test(d.why), d && d.why);
    check('it is always High, because nothing asks the user anything',
      !!d && d.severity === 'High', d);
    check('and it points at where to take the access back',
      !!d && /site settings/i.test(d.action), d && d.action);
  }

  {
    /* A handle the site does NOT have permission for is the ordinary case and says nothing. */
    const w = world({ permission: 'prompt' });
    await w.query({});
    await new Promise((r) => setTimeout(r, 0));
    check('a handle that is not granted raises nothing', w.logs.length === 0, w.logs);
    check('but the page still gets its own answer', w.called.includes('queryPermission'), w.called);
  }

  {
    /* An editor a person actually uses opens files all day. It must not fill the log. */
    const w = world();
    for (let i = 0; i < 12; i++) await w.pick('showOpenFilePicker');
    check('a working editor cannot flood the record', w.logs.length === 3, w.logs.length);
    check('and every one of its pickers still ran',
      w.called.filter((c) => c === 'showOpenFilePicker').length === 12, w.called.length);
  }

  {
    const w = world({ enabled: false });
    await w.pick('showDirectoryPicker', { mode: 'readwrite' });
    check('with the guard off it records nothing', w.logs.length === 0, w.logs);
    check('and still does not interfere', w.called.includes('showDirectoryPicker'), w.called);
  }

  {
    /* A page that has no File System Access API at all must not throw on the way past. */
    const bare = { WO: { deviceAccessGuard: true }, log() {}, Object, Promise, String, Number, Math, console };
    bare.window = bare;
    vm.createContext(bare);
    let threw = null;
    try { vm.runInContext(GUARD, bare, { filename: 'file-access-bare.js' }); } catch (e) { threw = String(e); }
    check('a browser without the API is handled without throwing', threw === null, threw);
  }

  /* ---- wiring --------------------------------------------------------------------- */

  check('the Activity Center names both events',
    /warned_file_request: '/.test(HISTORY) && /warned_file_silent: '/.test(HISTORY));
  check('the in-page notices explain themselves',
    /warned_file_request:\{/.test(SOURCE) && /warned_file_silent:\{/.test(SOURCE));
  check('it rides the same always-on guard as the device APIs, so there is no new switch',
    /if\(WO\.deviceAccessGuard\)try\{const FS_PICKERS=/.test(CONTENT));
  check('and the popup row says files as well as hardware',
    /Hardware and file access/.test(POPUP_HTML) && /folder/i.test(POPUP_HTML));
  check('nothing in the guard blocks or cancels on the page behalf',
    !/preventDefault|throw |return!1/.test(GUARD));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all file-access checks passed');
})();

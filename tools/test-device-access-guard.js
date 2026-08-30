/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WebUSB, Web Serial, WebHID and Web Bluetooth.
 *
 * These reach past the page and talk to hardware -- firmware, serial devices, raw
 * HID, which includes security keys. The permission chain watched camera,
 * microphone, notifications and clipboard-read and knew nothing about any of them.
 *
 * Chrome's device chooser is the real gate, so nothing here blocks: hardware
 * wallets, board flashers and stream decks are ordinary uses. What was missing was
 * the record. Two things get one -- asking, and reading back a device granted on an
 * earlier visit, which needs no prompt and is the only part that can happen while
 * you are not looking.
 *
 * The wrappers sit in front of APIs real sites depend on, so most of this file is
 * about them staying invisible: same return value, same rejection, same promise,
 * and no device details anywhere near the log.
 *
 * Run: node tools/test-device-access-guard.js
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

const START = 'if(WO.deviceAccessGuard)try{';
const END = 'if(WO.fakeWindowGuard&&WO_TOP&&!trustedMediaHost&&';
const from = CONTENT.indexOf(START);
const to = CONTENT.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the shipped device-access guard markers are missing');
/* Whole block, header included, so the toggle is the real one. */
const GUARD = CONTENT.slice(from, to).replace(/\s*$/, '');

function run(options) {
  const o = options || {};
  const logs = [];
  const calls = [];
  const navigator = {};
  for (const name of o.present || ['usb', 'serial', 'hid', 'bluetooth']) {
    const request = name === 'serial' ? 'requestPort' : 'requestDevice';
    const enumerate = name === 'serial' ? 'getPorts' : 'getDevices';
    navigator[name] = {
      [request](...args) {
        calls.push(name + '.' + request);
        if (o.requestRejects) return Promise.reject(new Error('user cancelled'));
        return Promise.resolve(o.requestResult === undefined ? { name: 'SECRET DEVICE NAME' } : o.requestResult);
      },
      [enumerate](...args) {
        calls.push(name + '.' + enumerate);
        if (o.enumerateRejects) return Promise.reject(new Error('nope'));
        const list = o.granted === undefined ? [] : o.granted;
        return Promise.resolve(list);
      },
    };
  }
  if (o.midi) {
    navigator.requestMIDIAccess = function (...args) {
      calls.push('requestMIDIAccess');
      return Promise.resolve({ __marker: 'midi-access' });
    };
  }
  const sandbox = {
    WO: { deviceAccessGuard: o.enabled !== false },
    navigator,
    log(type, detail) { logs.push({ type, detail }); },
    Object, Math, Number, String, Array, Promise, Date,
  };
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'device-guard-slice.js' });
  return { logs, calls, navigator, sandbox };
}

let passed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

(async () => {
  // -------------------------------------------------------------------------
  // Asking
  // -------------------------------------------------------------------------
  {
    const r = run({});
    await r.navigator.hid.requestDevice({ filters: [] });
    await settle();
    check('asking for a HID device is recorded', r.logs.length === 1, r.logs);
    if (r.logs.length) {
      const d = r.logs[0].detail;
      check('it is recorded as a request, not a silent read', r.logs[0].type === 'warned_device_request');
      check('raw HID is treated as high severity', d.severity === 'High', d);
      check('it says the chooser still decides', /nothing is connected unless you pick it/i.test(d.why), d.why);
      check('it does not claim to have blocked anything', /not blocked/i.test(d.outcome), d.outcome);
    }
  }

  {
    const r = run({});
    await r.navigator.bluetooth.requestDevice({ filters: [] });
    await settle();
    check('Bluetooth is recorded at a lower severity than raw HID',
      r.logs[0] && r.logs[0].detail.severity === 'Medium', r.logs);
  }

  {
    const r = run({});
    await r.navigator.serial.requestPort();
    await settle();
    check('Web Serial uses its own method name and is covered',
      r.logs.length === 1 && r.calls[0] === 'serial.requestPort', { logs: r.logs, calls: r.calls });
  }

  {
    const r = run({});
    await r.navigator.usb.requestDevice({ filters: [] });
    await settle();
    check('WebUSB is covered', r.logs.length === 1 && r.logs[0].detail.api === 'usb', r.logs);
  }

  /* MIDI is the fifth of this family and was missed, because it is a bare call on navigator
     rather than an object with a request and an enumerate on it. Two levels, and the gap is the
     point: plain access enumerates the music hardware attached to the machine, which is a
     fingerprint; sysex is the channel a device's own firmware listens on, so a page holding it
     is not playing notes, it is talking to the hardware. */
  {
    const r = run({ midi: true });
    await r.navigator.requestMIDIAccess({});
    await settle();
    check('plain MIDI access is recorded',
      r.logs.length === 1 && r.logs[0].detail.api === 'midi', r.logs);
    check('and sits alongside Bluetooth rather than raw HID',
      r.logs[0] && r.logs[0].detail.severity === 'Medium', r.logs);
  }

  {
    const r = run({ midi: true });
    await r.navigator.requestMIDIAccess({ sysex: true });
    await settle();
    check('sysex is recorded as its own thing',
      r.logs.length === 1 && r.logs[0].detail.api === 'midi-sysex', r.logs);
    check('and carries the severity raw HID does, because it reaches firmware',
      r.logs[0] && r.logs[0].detail.severity === 'High', r.logs);
  }

  {
    const r = run({ midi: true });
    const got = await r.navigator.requestMIDIAccess({});
    check('the MIDI access object is handed back untouched', got && got.__marker === 'midi-access');
  }

  {
    const r = run({ midi: true, enabled: false });
    await r.navigator.requestMIDIAccess({});
    await settle();
    check('with the guard off MIDI records nothing', r.logs.length === 0, r.logs);
  }

  // -------------------------------------------------------------------------
  // The quiet one: reading back a device granted on an earlier visit
  // -------------------------------------------------------------------------
  {
    const r = run({ granted: [{ name: 'SECRET DEVICE NAME' }, { name: 'another' }] });
    await r.navigator.hid.getDevices();
    await settle();
    check('reading back a previously granted device is recorded', r.logs.length === 1, r.logs);
    if (r.logs.length) {
      const d = r.logs[0].detail;
      check('it is recorded as the silent kind', r.logs[0].type === 'warned_device_silent');
      check('it carries how many, not which', d.devices === 2 && !('name' in d), d);
      check('it explains that no prompt was involved', /needs no prompt/i.test(d.why), d.why);
      check('it points at where to revoke', /site settings/i.test(d.action), d.action);
    }
  }

  {
    const r = run({ granted: [] });
    await r.navigator.usb.getDevices();
    await settle();
    check('an empty list is not an event -- nothing was ever granted', r.logs.length === 0, r.logs);
  }

  {
    const r = run({ granted: [{}] });
    await r.navigator.serial.getPorts();
    await settle();
    check('Web Serial enumeration uses its own method name too',
      r.logs.length === 1 && r.calls[0] === 'serial.getPorts', { logs: r.logs, calls: r.calls });
  }

  // -------------------------------------------------------------------------
  // The wrappers sit in front of APIs real sites depend on
  // -------------------------------------------------------------------------
  {
    const marker = { name: 'SECRET DEVICE NAME' };
    const r = run({ requestResult: marker });
    const got = await r.navigator.usb.requestDevice({ filters: [] });
    check('the chosen device is handed back untouched', got === marker);
  }

  {
    const r = run({ requestRejects: true });
    let threw = null;
    try { await r.navigator.usb.requestDevice({ filters: [] }); } catch (e) { threw = e; }
    check('cancelling still rejects, the way the page expects', !!threw && /cancelled/.test(threw.message));
  }

  {
    const r = run({ enumerateRejects: true });
    let threw = null;
    try { await r.navigator.hid.getDevices(); } catch (e) { threw = e; }
    await settle();
    check('a failing enumeration still rejects', !!threw);
    check('and a failure is not recorded as a silent read', r.logs.length === 0, r.logs);
  }

  {
    const r = run({ granted: [{}] });
    const promise = r.navigator.hid.getDevices();
    check('the page gets a real promise back, not a derived one',
      promise && typeof promise.then === 'function');
    const list = await promise;
    check('and the device list itself is unchanged', Array.isArray(list) && list.length === 1);
  }

  {
    const r = run({});
    const first = r.navigator.usb.requestDevice;
    vm.runInContext(GUARD, r.sandbox, { filename: 'device-guard-slice.js' });
    check('installing twice does not stack wrappers', r.navigator.usb.requestDevice === first);
  }

  {
    const r = run({ present: ['usb'] });
    check('an API the browser does not have is simply skipped',
      !r.navigator.hid && !!r.navigator.usb);
    await r.navigator.usb.requestDevice({});
    await settle();
    check('and the ones it does have still work', r.logs.length === 1, r.logs);
  }

  // -------------------------------------------------------------------------
  // Noise, privacy and the switch
  // -------------------------------------------------------------------------
  {
    const r = run({});
    for (let i = 0; i < 8; i++) await r.navigator.usb.requestDevice({});
    await settle();
    check('a site calling repeatedly cannot flood the log', r.logs.length <= 3, r.logs.length);
  }

  {
    const r = run({ granted: [{ name: 'SECRET DEVICE NAME' }] });
    await r.navigator.hid.requestDevice({});
    await r.navigator.hid.getDevices();
    await settle();
    const serialized = JSON.stringify(r.logs);
    check('no device name ever reaches the log', !/SECRET DEVICE NAME/.test(serialized), serialized);
    check('request and silent read are separate events',
      r.logs.length === 2 && r.logs[0].type !== r.logs[1].type, r.logs.map((l) => l.type));
  }

  {
    const r = run({ enabled: false, granted: [{}] });
    await r.navigator.hid.requestDevice({});
    await r.navigator.hid.getDevices();
    await settle();
    check('turning the guard off silences it', r.logs.length === 0, r.logs);
  }

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------
  {
    check('it ships on by default', /deviceAccessGuard:!0/.test(SOURCE));
    /* No toggle. Chrome's device chooser still decides and nothing here is blocked, so there
       was never any protection to switch off -- a toggle only implied there was. Listed under
       "What WardenOne watches" instead, and still subject to the master switch and the site
       allowlist, which is what gate() carries. */
    check('it is always on, still under the master switch and the allowlist',
      /deviceAccessGuard:gate\(!0\)/.test(SOURCE));
    check('it has no toggle', !/data-key="deviceAccessGuard"/.test(POPUP_HTML));
    /* The row now covers the File System Access API too -- showDirectoryPicker reaches
       further than any of the four device APIs here -- so the name says files as well. */
    check('but it is still listed, so nothing is watching invisibly',
      /Hardware and file access/.test(POPUP_HTML) && /What WardenOne watches/.test(POPUP_HTML));
    check('Activity Center names both events',
      /warned_device_request: '/.test(HISTORY) && /warned_device_silent: '/.test(HISTORY));
    check('the in-page notices explain themselves',
      /warned_device_request:\{/.test(SOURCE) && /warned_device_silent:\{/.test(SOURCE));
    check('all four surfaces are covered',
      /"usb"/.test(GUARD) && /"serial"/.test(GUARD) && /"hid"/.test(GUARD) && /"bluetooth"/.test(GUARD));
    check('nothing in the guard blocks or throws on the page\'s behalf',
      !/preventDefault|reject\(|throw /.test(GUARD),
      'the chooser is the gate; refusing here would break hardware wallets and flashers');
  }

  if (process.exitCode) console.error('\ndevice-access guard checks failed');
  else console.log('\n' + passed + ' device-access guard checks passed.');
})();

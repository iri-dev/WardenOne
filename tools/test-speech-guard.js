/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Speech recognition -- the way to the microphone that Media Shield could not see.
 *
 * Media Shield hooks getUserMedia. SpeechRecognition does not go through it: a page calls
 * start() and is listening, with the microphone guard reporting nothing at all. That is worse
 * than an API nobody covered, because "Block camera & microphone" is a promise about the
 * microphone, and there was a route to the microphone the switch did not close. The switch was
 * not telling the truth.
 *
 * Chrome's implementation is also not local -- the audio is sent away to be transcribed -- so
 * this is not only listening, it is listening somewhere else.
 *
 * Refusal is the interesting part. start() returns nothing whether it works or not, so throwing
 * would break pages that never expected an exception. What every page using this HAS written is
 * the path for someone clicking Block: an error event carrying "not-allowed", then end. So the
 * refusal takes that path, and costs a well-built page nothing it had not already handled.
 *
 * Run: node tools/test-speech-guard.js
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

const START = 'if(WO.mediaShield)try{const SR_HOSTS=';
const END = '/* Back-button trapping.';
const from = CONTENT.indexOf(START);
const to = CONTENT.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the speech guard moved in content.min.js');
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
  const started = [];
  /* A stand-in for the real constructor: start() is on the prototype, which is what the
     guard wraps, and instances carry the on* handlers a page assigns. */
  function SpeechRecognition() { this.onerror = null; this.onend = null; this._events = []; }
  SpeechRecognition.prototype.start = function start(...args) {
    started.push(args);
    if (o.startThrows) throw new Error('already started');
    return 'native-start';
  };
  SpeechRecognition.prototype.dispatchEvent = function dispatchEvent(e) { this._events.push(e.type); return true; };
  const sandbox = {
    WO: { mediaShield: o.mediaShield !== false, blockCameraMic: o.blockCameraMic !== false },
    trustedMediaHost: !!o.trusted,
    log(type, detail) { logs.push({ type, detail }); },
    SpeechRecognition,
    webkitSpeechRecognition: SpeechRecognition,
    Event: function Event(type) { this.type = type; },
    setTimeout, Object, String, Number, Math, console,
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'speech-guard-slice.js' });
  return { logs, started, sandbox, SpeechRecognition };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

console.log('\nspeech recognition guard\n');

(async () => {
  {
    /* The reported case: the microphone reached without getUserMedia. */
    const w = world();
    const rec = new w.SpeechRecognition();
    const seen = [];
    rec.onerror = (e) => seen.push('error:' + e.error);
    rec.onend = () => seen.push('end');
    rec.start();
    await settle();
    check('listening is refused while the microphone switch is on', w.started.length === 0, w.started);
    check('and it is recorded', w.logs.length === 1 && w.logs[0].type === 'blocked_speech_capture', w.logs);
    check('the page is denied the way the browser denies it',
      seen[0] === 'error:not-allowed' && seen[1] === 'end', seen);
    const d = w.logs[0] && w.logs[0].detail;
    check('the notice says why this one slipped past the microphone guard',
      !!d && /does not go through/i.test(d.why), d && d.why);
    check('and that the audio leaves the machine',
      !!d && /transcrib/i.test(d.why), d && d.why);
    check('it tells someone who actually wanted to dictate what to do',
      !!d && /allow camera and microphone/i.test(d.action), d && d.action);
  }

  {
    /* A page that listens on the events rather than the on* properties. */
    const w = world();
    const rec = new w.SpeechRecognition();
    rec.start();
    await settle();
    check('the denial is dispatched as real events too',
      rec._events.join(',') === 'error,end', rec._events);
  }

  {
    /* With the microphone switch off, this is a record and nothing more. */
    const w = world({ blockCameraMic: false });
    const rec = new w.SpeechRecognition();
    rec.start();
    await settle();
    check('with the switch off, listening is allowed', w.started.length === 1, w.started);
    check('but it is still written down', w.logs.length === 1 && w.logs[0].type === 'warned_speech_capture', w.logs);
    const d = w.logs[0] && w.logs[0].detail;
    check('and the notice does not claim to have blocked it',
      !!d && /not blocked/i.test(d.outcome), d && d.outcome);
  }

  {
    /* Exactly the exemption getUserMedia already has. A voice search on a trusted media
       host is the thing this must not break. */
    const w = world({ trusted: true });
    const rec = new w.SpeechRecognition();
    rec.start();
    await settle();
    check('a trusted media host is exempt, as it is for getUserMedia', w.started.length === 1, w.started);
    check('and is recorded as allowed rather than blocked',
      w.logs.length === 1 && w.logs[0].type === 'warned_speech_capture', w.logs);
  }

  {
    const w = world({ mediaShield: false });
    const rec = new w.SpeechRecognition();
    rec.start();
    await settle();
    check('with Media Shield off the guard does not run at all',
      w.started.length === 1 && w.logs.length === 0, { started: w.started, logs: w.logs });
  }

  {
    /* A dictation app starts and stops all day. It must not fill the log. */
    const w = world({ blockCameraMic: false });
    const rec = new w.SpeechRecognition();
    for (let i = 0; i < 10; i++) rec.start();
    await settle();
    check('a dictation app cannot flood the record', w.logs.length === 3, w.logs.length);
    check('and every one of its starts still ran', w.started.length === 10, w.started.length);
  }

  {
    /* The prefixed and unprefixed names are the same constructor in Chrome. Wrapping must
       not double-wrap it and log twice for one call. */
    const w = world({ blockCameraMic: false });
    const rec = new w.sandbox.webkitSpeechRecognition();
    rec.start();
    await settle();
    check('the prefixed name is covered without logging the same call twice',
      w.logs.length === 1, w.logs.length);
  }

  {
    /* The page's own error still surfaces when we are not refusing. */
    const w = world({ blockCameraMic: false, startThrows: true });
    const rec = new w.SpeechRecognition();
    let threw = null;
    try { rec.start(); } catch (e) { threw = String(e.message); }
    check('an error from the real start is not swallowed', /already started/.test(threw || ''), threw);
  }

  {
    /* A browser with no speech API must not throw on the way past. */
    const bare = { WO: { mediaShield: true, blockCameraMic: true }, trustedMediaHost: false, log() {}, setTimeout, Object, String, Number, Math, console };
    bare.window = bare;
    vm.createContext(bare);
    let threw = null;
    try { vm.runInContext(GUARD, bare, { filename: 'speech-bare.js' }); } catch (e) { threw = String(e); }
    check('a browser without the API is handled without throwing', threw === null, threw);
  }

  /* ---- wiring --------------------------------------------------------------------- */

  check('the Activity Center names both outcomes',
    /blocked_speech_capture: '/.test(HISTORY) && /warned_speech_capture: '/.test(HISTORY));
  check('the in-page notices explain themselves',
    /blocked_speech_capture:\{/.test(SOURCE) && /warned_speech_capture:\{/.test(SOURCE));
  check('it answers the same switch as the rest of the microphone guard, so the switch is now true',
    /!1!==WO\.blockCameraMic&&!trustedMediaHost/.test(GUARD));
  check('refusal never throws into the page, because start() returns nothing either way',
    !/throw /.test(GUARD));

  console.log('');
  if (failures) { console.log(failures + ' check(s) failed'); process.exit(1); }
  console.log('all speech-guard checks passed');
})();

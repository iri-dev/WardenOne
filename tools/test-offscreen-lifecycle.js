/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The offscreen audio document lives for a sound, not for the session.
 * Run: node tools/test-offscreen-lifecycle.js
 *
 * Notification sounds play in an offscreen document (the worker has no audio). The first sound
 * of a session created it and nothing ever closed it: chrome.offscreen.closeDocument appeared
 * nowhere in the package, so one extension document, its scripts and an open AudioContext sat
 * resident for the rest of the browser session in exchange for half a second of tone (LIFE-05).
 *
 * Now the worker closes the document once it has been idle for a short grace after the last
 * sound -- long enough that a burst of notifications shares one document and no tune is cut,
 * short enough to matter -- and the document releases its own AudioContext after the same kind
 * of idle, so it holds no audio graph while it waits. The creation hardening (shared in-flight
 * promise, the one retry for a listener that is not up yet) is kept exactly, because it matters
 * more once the document can legitimately be absent again. The shipped manager and the shipped
 * document are lifted and driven here with fake timers and a chrome.offscreen that keeps state.
 *
 * Control: WARDENONE_NOTIFICATION_MANAGER / WARDENONE_OFFSCREEN point at pre-fix copies.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const MANAGER = fs.readFileSync(process.env.WARDENONE_NOTIFICATION_MANAGER || path.join(ROOT, 'notification-manager.js'), 'utf8');
const OFFSCREEN = fs.readFileSync(process.env.WARDENONE_OFFSCREEN || path.join(ROOT, 'offscreen.js'), 'utf8');
const SCHEMA = fs.readFileSync(path.join(ROOT, 'notification-schema.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ---- fake timers ------------------------------------------------------------------------ */
function clock() {
  let now = 0;
  let seq = 0;
  const timers = new Map();
  const api = {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { at: now + Math.max(0, Number(ms) || 0), fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
    /* Advance in steps, running due timers in order and letting promise chains settle between them. */
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        const due = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at);
        if (!due.length) break;
        const [id, t] = due[0];
        timers.delete(id);
        now = Math.max(now, t.at);
        t.fn();
        for (let i = 0; i < 20; i++) await Promise.resolve();
      }
      now = target;
      for (let i = 0; i < 20; i++) await Promise.resolve();
    },
    pending: () => timers.size,
  };
  return api;
}

/* ---- the worker's manager against a chrome.offscreen that keeps state ------------------ */
function worker(opts) {
  const o = opts || {};
  const time = clock();
  const state = { exists: false, closing: false, creates: 0, closes: 0, messages: [], closeDelay: o.closeDelay || 0, sendDelay: o.sendDelay || 0, closeError: o.closeError || null };
  const ctx = {
    console, URL, Number, Math, String, Object, Promise, Array, Error, RegExp,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    INCOGNITO_CONTEXT: false,
    importScripts: () => {},
    localGet: async () => ({}),
    localSet: async () => {},
    wardenNotificationSoundIds: () => ['soft', 'warning', 'critical', 'chime'],
    chrome: {
      runtime: {
        lastError: null,
        getURL: (f) => 'chrome-extension://test/' + f,
        getContexts: async () => (state.exists ? [{ contextType: 'OFFSCREEN_DOCUMENT' }] : []),
        sendMessage: async (payload) => {
          /* A document that is being torn down no longer receives. */
          if (!state.exists || state.closing) throw new Error('Could not establish connection. Receiving end does not exist.');
          if (state.sendDelay) await new Promise((r) => time.setTimeout(r, state.sendDelay));
          state.messages.push(payload);
          return Object.prototype.hasOwnProperty.call(o, 'soundResponse') ? o.soundResponse : { ok: true };
        },
      },
      offscreen: {
        createDocument: async () => {
          if (state.exists) throw new Error('Only a single offscreen document may be created.');
          state.creates++;
          state.exists = true;
        },
        closeDocument: async () => {
          if (state.closeError) { const e = state.closeError; state.closeError = null; throw e; }
          state.closing = true;
          try {
            if (state.closeDelay) await new Promise((r) => time.setTimeout(r, state.closeDelay));
            if (!state.exists) throw new Error('No current offscreen document.');
            state.closes++;
            state.exists = false;
          } finally { state.closing = false; }
        },
      },
      notifications: { create: (id, options, cb) => cb() },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(MANAGER, ctx, { filename: 'notification-manager.js' });
  return {
    state, time, ctx,
    play: (sound) => ctx.playWardenNotificationSound(sound || 'soft', 0.5),
    idleMs: typeof ctx.WARDEN_OFFSCREEN_IDLE_MS === 'number' ? ctx.WARDEN_OFFSCREEN_IDLE_MS : NaN,
  };
}

/* ---- the offscreen document against a fake AudioContext --------------------------------- */
function documentRealm() {
  const time = clock();
  const contexts = [];
  function FakeAudioContext() {
    this.state = 'running';
    this.currentTime = 0;
    this.destination = {};
    this.oscillators = 0;
    contexts.push(this);
  }
  FakeAudioContext.prototype.createOscillator = function () {
    this.oscillators++;
    return { type: '', frequency: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {}, start() {}, stop() {} };
  };
  FakeAudioContext.prototype.createGain = function () {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {} }, connect() {} };
  };
  FakeAudioContext.prototype.createBiquadFilter = function () {
    return { type: '', frequency: { setValueAtTime() {} }, Q: { setValueAtTime() {} }, connect() {} };
  };
  FakeAudioContext.prototype.resume = async function () { this.state = 'running'; };
  FakeAudioContext.prototype.close = async function () { this.state = 'closed'; };
  let listener = null;
  const ctx = {
    console, Number, Math, String, Object, Promise, Array,
    setTimeout: time.setTimeout, clearTimeout: time.clearTimeout,
    AudioContext: FakeAudioContext,
    chrome: { runtime: { onMessage: { addListener: (fn) => { listener = fn; } } } },
  };
  vm.createContext(ctx);
  vm.runInContext(SCHEMA + '\n' + OFFSCREEN, ctx, { filename: 'offscreen.js' });
  return {
    time, contexts, ctx,
    play: (sound) => new Promise((resolve) => {
      const ret = listener({ target: 'wardenone-offscreen', type: 'play-notification-sound', sound, volume: 0.5 }, {}, resolve);
      if (ret !== true) resolve(null);
    }),
    live: () => contexts.filter((c) => c.state !== 'closed').length,
    current: () => ctx.wardenAudioContext,
  };
}

(async () => {
  /* ---- 1. one sound: create, play, and then close ---------------------------------------- */
  {
    const w = worker();
    check('the idle grace is a number the suite can read', Number.isFinite(w.idleMs) && w.idleMs > 0, String(w.idleMs));
    const grace = Number.isFinite(w.idleMs) ? w.idleMs : 3000;
    check('the grace outlasts the longest tune (3 notes, 0.14 s apart) with room to spare', grace >= 1000 && grace <= 15000, String(grace));
    const played = await w.play('soft');
    check('the sound plays', played === true && w.state.creates === 1 && w.state.messages.length === 1);
    check('the document is not closed while the tone could still be sounding', w.state.closes === 0 && w.state.exists === true);
    await w.time.advance(grace - 1);
    check('nor inside the grace', w.state.closes === 0);
    await w.time.advance(2);
    check('THE CARD: the document is closed once it has been idle for the grace', w.state.closes === 1 && w.state.exists === false,
      JSON.stringify({ closes: w.state.closes, exists: w.state.exists }));
    await w.time.advance(grace * 3);
    check('and closed once, not on a loop', w.state.closes === 1 && w.time.pending() === 0, w.time.pending() + ' timers still armed');
  }

  /* ---- 2. a burst shares one document and one close ------------------------------------- */
  {
    const w = worker();
    const grace = w.idleMs || 3000;
    for (let i = 0; i < 10; i++) {
      await w.play(i % 2 ? 'warning' : 'soft');
      await w.time.advance(Math.floor(grace / 5));   // well inside the grace, every time
    }
    check('ten sounds in quick succession all play', w.state.messages.length === 10);
    check('through one document', w.state.creates === 1, w.state.creates + ' creates');
    check('which is still open right after the last one', w.state.closes === 0 && w.state.exists);
    await w.time.advance(grace + 1);
    check('and closes once, after the last sound\'s grace, not once per sound', w.state.closes === 1 && w.state.creates === 1,
      JSON.stringify({ creates: w.state.creates, closes: w.state.closes }));
  }

  /* ---- 3. a sound inside the grace pushes the close back --------------------------------- */
  {
    const w = worker();
    const grace = w.idleMs || 3000;
    await w.play('soft');
    await w.time.advance(grace - 100);
    await w.play('chime');
    await w.time.advance(200);
    check('a sound 100 ms before the close would have fired keeps the document', w.state.closes === 0 && w.state.exists && w.state.creates === 1);
    await w.time.advance(grace);
    check('and the close follows the LAST sound', w.state.closes === 1);
  }

  /* ---- 4. a sound that arrives while the close is in flight is not lost ------------------- */
  {
    const w = worker({ closeDelay: 50 });
    const grace = w.idleMs || 3000;
    await w.play('soft');
    await w.time.advance(grace + 1);           // the close has started, and takes 50 ms
    check('the close is in flight', w.state.closes === 0 && w.state.exists === true);
    const pending = w.play('critical');
    await w.time.advance(500);
    const played = await pending;
    check('the sound that arrived mid-close still plays, in a fresh document', played === true && w.state.messages.length === 2 && w.state.creates === 2,
      JSON.stringify({ creates: w.state.creates, messages: w.state.messages.length, exists: w.state.exists }));
    await w.time.advance(grace + 1);
    check('and that document closes in its turn', w.state.closes === 2 && w.state.exists === false);
  }

  /* ---- 5. the close never cuts a sound that is still being sent -------------------------- */
  {
    const w = worker({ sendDelay: 10 });
    const grace = w.idleMs || 3000;
    const first = w.play('soft');              // its send takes 10 ms of fake time
    await w.time.advance(20);
    await first;
    await w.time.advance(grace - 25);
    const slow = w.play('warning');            // its send is in flight when the first sound's grace ends
    await w.time.advance(7);
    check('the grace timer firing during an in-flight send does not close the document under it', w.state.exists === true && w.state.closes === 0);
    await w.time.advance(10);                  // the slow send completes
    await slow;
    check('the second sound is heard', w.state.messages.length === 2);
    await w.time.advance(grace + 20);
    check('and the document closes after it', w.state.closes === 1);
  }

  /* ---- 6. a close that fails is not a failure of the sound ------------------------------- */
  {
    const w = worker({ closeError: new Error('No current offscreen document.') });
    const grace = w.idleMs || 3000;
    let threw = false;
    try { await w.play('soft'); await w.time.advance(grace + 1); } catch (_) { threw = true; }
    check('a close that throws is swallowed; the sound already played', !threw && w.state.messages.length === 1);
    const again = await w.play('soft');
    check('and the next sound is unaffected', again === true);
  }

  /* ---- 7. the creation hardening is intact ----------------------------------------------- */
  {
    const w = worker();
    /* Two sounds at once: one create, both heard. */
    w.state.exists = false;
    const both = await Promise.all([w.play('soft'), w.play('warning')]);
    check('two simultaneous sounds share one creation and both play', both.every((x) => x === true) && w.state.creates === 1 && w.state.messages.length === 2,
      JSON.stringify({ creates: w.state.creates, both }));
    check('the retry for a listener that is not up yet is still there', /Receiving end does not exist\|Could not establish connection/.test(MANAGER) && /setTimeout\(resolve, 150\)/.test(MANAGER));
  }

  /* ---- 8. playback failures reach the page instead of looking successful ----------------- */
  {
    const w = worker({ soundResponse: { ok: false, error: 'Audio is unavailable.' } });
    let message = '';
    try { await w.play('soft'); } catch (error) { message = String(error && error.message || error); }
    check('the worker rejects a sound the offscreen document could not play', /Audio is unavailable/.test(message));

    const d = documentRealm();
    d.ctx.AudioContext = undefined;
    const response = await d.play('soft');
    check('the offscreen document reports unavailable audio honestly', response && response.ok === false && /unavailable/i.test(response.error));
  }

  /* ---- 9. the document releases its AudioContext when idle ------------------------------- */
  {
    const d = documentRealm();
    const r = await d.play('critical');
    const critical = d.ctx.wardenNotificationSound('critical');
    const criticalVoices = critical.notes.length * critical.layers.length;
    check('the document plays every layer of the tune', r && r.ok === true && d.contexts.length === 1 && d.contexts[0].oscillators === criticalVoices,
      d.contexts[0].oscillators + ' oscillators for ' + criticalVoices + ' voices');
    check('the context is open while the tune sounds', d.live() === 1);
    await d.time.advance(400);
    check('and still open at the end of the longest tune (420 ms)', d.live() === 1);
    await d.time.advance(5000);
    check('THE SECOND HALF: the AudioContext is closed once the document is idle', d.live() === 0 && (!d.current() || d.current().state === 'closed'),
      d.live() + ' live, ' + (d.current() ? d.current().state : 'null'));
    const r2 = await d.play('soft');
    check('a later tune gets a fresh context', r2 && r2.ok === true && d.contexts.length === 2 && d.live() === 1);
    await d.time.advance(200);
    await d.play('soft');
    check('a burst shares one context', d.contexts.length === 2 && d.live() === 1);
    await d.time.advance(6000);
    check('which is released after the burst', d.live() === 0);
  }

  /* ---- 10. the wiring --------------------------------------------------------------------- */
  check('the manager has a close path', /chrome\.offscreen\.closeDocument\(\)/.test(MANAGER));
  check('the document has a release path', /function releaseAudioContextWhenIdle\(/.test(OFFSCREEN) && /context\.close\(\)/.test(OFFSCREEN) && /releaseAudioContextWhenIdle\(0\.04 \+ \(spec\.notes\.length - 1\) \* gap \+ length\)/.test(OFFSCREEN));
  check('the creation hardening is unchanged in shape', /wardenOffscreenCreating = chrome\.offscreen\.createDocument\(\{/.test(MANAGER) && /single offscreen document/i.test(MANAGER));

  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  console.log('  ok  ' + pass + ' checks: the offscreen document lives for a sound, not for the session');
})().catch((e) => { console.error(e); process.exit(1); });

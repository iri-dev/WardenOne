/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The four remaining 2026-era fingerprinting surfaces.
 * Run: node tools/test-fingerprint-surfaces.js
 *
 *   window.queryLocalFonts()             every font installed on the machine
 *   window.getScreenDetails()            every attached display, with geometry
 *   screen.isExtended                    multi-monitor, with no permission at all
 *   navigator.keyboard.getLayoutMap()    the keyboard layout, so country and language
 *   speechSynthesis.getVoices()          the OS, its version, and its language packs
 *
 * The rule these all follow is the one WebGPU taught: a new API that re-answers a
 * question an older, already-spoofed API answers must give the SAME answer.
 * Screen details are built from the numbers the Screen spoof reports, the layout
 * map matches the en-US the engine already claims, and devicePixelRatio is
 * deliberately left real because nothing spoofs window.devicePixelRatio and
 * inventing one here would contradict a number the page can read directly. A
 * contradiction is a sharper identifier than the truth it replaced.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* content.min.js is one line, so these are delimited by their own closing text
   rather than by a following marker. An earlier cut ran to the next feature and
   swept up half a try block, which fails as a syntax error — loudly, but for the
   wrong reason. */
function sliceThrough(startMarker, endMarker) {
  const from = CONTENT.indexOf(startMarker);
  assert(from > 0, 'missing marker: ' + startMarker);
  const to = CONTENT.indexOf(endMarker, from);
  assert(to > from, 'missing end marker: ' + endMarker);
  return CONTENT.slice(from, to + endMarker.length);
}

/* The three standalone guards as they ship. */
function standaloneSource() {
  return sliceThrough('try{"function"==typeof window.queryLocalFonts', '"getVoices")}}catch(_){}');
}

/* The screen half lives inside the Screen-spoof expression, so it is lifted
   alongside the screenW/screenH it is built from — that coupling is the point. */
function screenSource() {
  return sliceThrough('"function"==typeof window.getScreenDetails', ',"getScreenDetails"))');
}

function harness(opts) {
  opts = opts || {};
  const sandbox = {
    console, Promise, Map, Array, Object, String, Number, Boolean,
    DOMException: function DOMException(message, name) {
      const e = new Error(message); e.name = name || 'Error'; return e;
    },
    cloak: (fn) => fn,
    screenW: 1600,
    screenH: 900,
    navigator: {
      language: opts.language || 'en-US',
      keyboard: opts.noKeyboard ? undefined : { getLayoutMap() { return Promise.resolve(new Map([['KeyA', 'q']])); } },
    },
    window: {},
  };
  sandbox.window = sandbox;
  sandbox.devicePixelRatio = opts.dpr === undefined ? 1.5 : opts.dpr;
  if (opts.hasFonts !== false) sandbox.queryLocalFonts = function () { return Promise.resolve([{ family: 'Comic Sans MS' }]); };
  if (opts.hasScreenDetails !== false) sandbox.getScreenDetails = function () { return Promise.resolve({ screens: ['real1', 'real2'] }); };
  if (opts.voices !== null) {
    const voices = opts.voices || [
      { name: 'Microsoft Hazel Desktop', lang: 'en-GB' },
      { name: 'Google US English', lang: 'en-US' },
      { name: 'Microsoft Hedda', lang: 'de-DE' },
      { name: 'Kyoko', lang: 'ja-JP' },
    ];
    sandbox.speechSynthesis = { getVoices() { return voices.slice(); } };
  }
  vm.createContext(sandbox);
  /* Both halves, always. They are one feature, and loading only one is how the
     font checks came to fail against a sandbox that had never seen the guard. */
  vm.runInContext(screenSource(), sandbox, { filename: 'content.min.js' });
  vm.runInContext(standaloneSource(), sandbox, { filename: 'content.min.js' });
  return sandbox;
}

const pending = [];

// --- Local Font Access ------------------------------------------------------

pending.push((async function fontsAreRefusedTheWayAUserRefusesThem() {
  const s = harness();
  let err = null;
  try { await s.queryLocalFonts(); } catch (e) { err = e; }
  check('queryLocalFonts rejects', !!err);
  /* A curated list of twenty universal fonts would be a stranger answer than
     saying no: real machines have hundreds, so a tidy list is itself a signature.
     The most common real answer to this prompt is already a refusal. */
  check('it rejects with the error a declined permission produces',
    err && err.name === 'NotAllowedError', err && err.name);
  check('the message matches what Chrome says on Block',
    err && /Permission denied/.test(err.message), err && err.message);
}()));

// --- Window Management ------------------------------------------------------

pending.push((async function screenDetailsAgreeWithTheScreenSpoof() {
  const s = harness();
  const details = await s.getScreenDetails();
  check('one screen is reported', Array.isArray(details.screens) && details.screens.length === 1,
    JSON.stringify(details.screens && details.screens.length));
  const one = details.screens[0];
  /* The whole point: these are the numbers Screen.width and Screen.height were
     already rewritten to. Two different answers to one question would be worse
     than either answer alone. */
  check('its width matches the spoofed screen width', one.width === 1600, String(one.width));
  check('its height matches the spoofed screen height', one.height === 900, String(one.height));
  check('avail dimensions match too', one.availWidth === 1600 && one.availHeight === 900);
  check('colour depth matches the Screen spoof', one.colorDepth === 24 && one.pixelDepth === 24);
  check('the real display list is gone', JSON.stringify(details.screens).indexOf('real') < 0);
  check('currentScreen is the same screen', details.currentScreen === one);
  check('it reports as primary and not extended', one.isPrimary === true && one.isExtended === false);
  check('it is positioned at the origin', one.left === 0 && one.top === 0 && one.availLeft === 0);
  /* ScreenDetails is an EventTarget. A page that subscribes must not throw. */
  check('it behaves as an event target',
    typeof details.addEventListener === 'function' && typeof details.removeEventListener === 'function');
}()));

pending.push((async function devicePixelRatioIsDeliberatelyReal() {
  /* Nothing spoofs window.devicePixelRatio, so a made-up value here would
     contradict a number any page can read in one line. */
  for (const dpr of [1, 1.25, 2]) {
    const s = harness({ dpr });
    const details = await s.getScreenDetails();
    check('devicePixelRatio ' + dpr + ' is passed through, not invented',
      details.screens[0].devicePixelRatio === dpr, String(details.screens[0].devicePixelRatio));
  }
}()));

// --- keyboard layout --------------------------------------------------------

pending.push((async function theLayoutMapMatchesTheClaimedLanguage() {
  const s = harness();
  const map = await s.navigator.keyboard.getLayoutMap();
  check('a map is returned', map && typeof map.get === 'function');
  /* en-US is what navigator.language is masked to and what Header Shield sends
     as Accept-Language. A keyboard disagreeing with both would be the exact
     contradiction this layer exists to avoid. */
  check('QWERTY: KeyQ produces q', map.get('KeyQ') === 'q', String(map.get('KeyQ')));
  check('QWERTY: KeyA produces a, not the real layout', map.get('KeyA') === 'a', String(map.get('KeyA')));
  check('KeyZ produces z (not AZERTY/QWERTZ)', map.get('KeyZ') === 'z');
  check('punctuation is US', map.get('Semicolon') === ';' && map.get('Quote') === "'");
  check('digits are present', map.get('Digit1') === '1' && map.get('Digit0') === '0');
  check('it answers has() like a real layout map', map.has('KeyA') === true && map.has('KeyNope') === false);
  check('it is iterable and sized', map.size > 40 && typeof map.forEach === 'function', String(map.size));
}()));

// --- speech voices ----------------------------------------------------------

pending.push((async function voicesAreFilteredToTheClaimedLocale() {
  const s = harness();
  const voices = s.speechSynthesis.getVoices();
  /* "Microsoft Hazel Desktop" names the OS and the language pack in one string.
     Filtering to the claimed language removes that signal. */
  check('voices outside the claimed language are dropped',
    voices.every((v) => v.lang.slice(0, 2) === 'en'), JSON.stringify(voices.map((v) => v.lang)));
  check('German and Japanese packs are gone',
    !voices.some((v) => /Hedda|Kyoko/.test(v.name)), JSON.stringify(voices.map((v) => v.name)));
  check('English voices survive so speech still works', voices.length > 0);
}()));

pending.push((async function anEmptyResultIsNeverManufactured() {
  /* Emptying the list breaks every page that reads aloud, and is conspicuous
     besides — nearly every real browser has at least one voice. */
  const s = harness({ voices: [{ name: 'Kyoko', lang: 'ja-JP' }, { name: 'Hedda', lang: 'de-DE' }] });
  const voices = s.speechSynthesis.getVoices();
  check('when the filter would empty the list, the original is returned',
    voices.length === 2, JSON.stringify(voices.map((v) => v.name)));

  const none = harness({ voices: [] });
  check('an already-empty list is passed through without error',
    none.speechSynthesis.getVoices().length === 0);
}()));

pending.push((async function theFilterFollowsTheClaimedLanguage() {
  const s = harness({ language: 'de-DE' });
  const voices = s.speechSynthesis.getVoices();
  check('the filter tracks navigator.language rather than hardcoding English',
    voices.length === 1 && voices[0].lang === 'de-DE', JSON.stringify(voices.map((v) => v.lang)));
}()));

// --- absence is not an error ------------------------------------------------

pending.push((async function missingApisAreHandled() {
  let threw = false;
  try {
    const s = harness({ hasFonts: false, hasScreenDetails: false, noKeyboard: true, voices: null });
    } catch (_) { threw = true; }
  check('a browser missing all four APIs is handled without throwing', !threw);
}()));

// --- the free bit -----------------------------------------------------------

(function isExtendedIsAnsweredWithoutAPrompt() {
  /* This one needs no permission at all, which makes it the cheapest of the five
     to collect and the one most worth answering. */
  check('screen.isExtended is spoofed', /"isExtended",\s*!1/.test(SOURCE.replace(/\s+/g, ' ')),
    'no isExtended definition found');
  check('it is defined alongside the other Screen properties',
    SOURCE.indexOf('"isExtended"') > SOURCE.indexOf('"pixelDepth"'));
  check('it says one screen, matching getScreenDetails', /isExtended:!1/.test(CONTENT));
}());

// --- wiring -----------------------------------------------------------------

(function shippedAndGated() {
  ['queryLocalFonts', 'getScreenDetails', 'getLayoutMap', 'getVoices', 'isExtended'].forEach((n) => {
    check(n + ' is in the built engine', CONTENT.indexOf(n) > 0);
  });
  check('src and build agree',
    (SOURCE.match(/queryLocalFonts/g) || []).length === (CONTENT.match(/queryLocalFonts/g) || []).length);

  /* All four ride the existing anti-fingerprinting switch. One toggle per surface
     is how a settings page becomes a list nobody reads. */
  const noiseAt = SOURCE.indexOf('if(WO.antiFingerprintNoise||WO.antiFingerprint)');
  check('they live inside the existing fingerprint-noise feature',
    noiseAt > 0 && SOURCE.indexOf('window.queryLocalFonts=') > noiseAt);
  const popup = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
  check('no new toggle was added for any of them',
    !/data-key="(queryLocalFonts|localFonts|screenDetails|keyboardLayout|speechVoices)/i.test(popup));

  /* Every other patch in this engine hides behind Function.prototype.toString.
     One that does not is a tell. */
  ['queryLocalFonts', 'getScreenDetails', 'getLayoutMap', 'getVoices'].forEach((n) => {
    check(n + ' is cloaked', new RegExp('cloak\\(function ' + n + '\\b').test(SOURCE.replace(/\s+/g, ' ')));
  });
}());

// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('fingerprint surfaces: ' + pass + ' checks passed');
});

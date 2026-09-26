/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Media Shield lets the browser ask when the reader is there (COMPAT-01).
 * Run: node tools/test-media-shield-presence.js
 *      WARDENONE_CONTENT_MIN=<older content.min.js> node tools/test-media-shield-presence.js
 *
 * With "Block camera & microphone" on -- the default -- every getUserMedia call on a site outside
 * the four-host media list was refused with a made-up NotAllowedError before Chrome's own prompt
 * could appear. Teams, Discord, Zoom in the browser, voice recorders and document scanners failed
 * on every ordinary site and told the reader their OS permission was wrong. The switch's own copy
 * promised something else: "a site that wants the microphone has to ask when you are actually
 * there."
 *
 * Now the decision is presence and the browser's own record, not the hostname. A request made
 * within ten seconds of a trusted click or key goes to Chrome -- in the same task as the page's
 * call, so nothing about the browser's prompt changes -- and Chrome decides, with its prompt, its
 * indicator and its denial. A request with nobody at the page proceeds only if the reader has
 * already pressed Allow for this site in Chrome, read through the permissions reference taken at
 * document_start; everything else is refused as before. Screen capture keeps a stricter rule
 * (presence is the whole test; Chrome holds no standing grant for it), and speech recognition --
 * the other route to the microphone -- follows the same decision. The shipped content.min.js is
 * sliced and driven here against a fake navigator, in every one of those states.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT_PATH = process.env.WARDENONE_CONTENT_MIN ? path.resolve(process.env.WARDENONE_CONTENT_MIN) : path.join(ROOT, 'content.min.js');
const CONTENT = fs.readFileSync(CONTENT_PATH, 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' — ' + (typeof detail === 'string' ? detail : JSON.stringify(detail))));
}
let finished = false;
process.exitCode = 1;
process.on('exit', () => { if (!finished) console.log('  FAIL the suite stopped before it finished'); });

function slice(from, to, what) {
  const i = CONTENT.indexOf(from);
  const j = i >= 0 ? CONTENT.indexOf(to, i + from.length) : -1;
  if (i < 0 || j < 0) throw new Error(what + ' moved in content.min.js');
  return CONTENT.slice(i, j);
}
/* The two gesture functions, real: presence must be the shipped arithmetic and not this file's. */
function gestureFns() {
  const start = CONTENT.indexOf('function freshGesture(){');
  if (start < 0) throw new Error('freshGesture moved');
  const fresh = CONTENT.slice(start, CONTENT.indexOf('}', start) + 1);
  const p = CONTENT.indexOf('function recentPresence(ms){');
  const presence = p >= 0 ? CONTENT.slice(p, CONTENT.indexOf('}', p) + 1) : 'function recentPresence(ms){return Date.now()-lastGestureAt<ms}';
  return fresh + '\n' + presence;
}
/* The shield: from the shared decision when it exists, from the first block when it does not
   (the control run on the pre-fix build), so the same checks report the old behaviour. */
function shieldSlice() {
  const from = CONTENT.indexOf('const MEDIA_PRESENCE_MS=1e4,') >= 0 ? 'const MEDIA_PRESENCE_MS=1e4,' : 'if(WO.mediaShield)try{let mediaEventCount=0;';
  return slice(from, '/* Speech recognition,', 'the Media Shield block');
}
function speechSlice() {
  return slice('if(WO.mediaShield)try{const SR_HOSTS=', '/* Back-button trapping.', 'the speech guard');
}

/* Denials land on a setTimeout(0) scheduled after Chrome's record resolves, so settling has to
   outlast a timer created a microtask later than this one. */
const settle = () => new Promise((r) => setTimeout(r, 15));
const NOW = 1700000000000;

/* One page, with a fake navigator that records every call and answers permissions as told. */
function world(o) {
  o = o || {};
  const logs = [];
  const calls = { gum: [], gdm: [], legacy: [], query: [], posted: [], started: [] };
  const stream = { getTracks: () => [{ readyState: 'live', addEventListener() {} }] };
  const permissions = o.permissions === null ? undefined : {
    query(desc) {
      calls.query.push(desc && desc.name);
      if (o.queryThrows) throw new Error('permissions unavailable');
      if (o.queryRejects) return Promise.reject(new TypeError('bad name'));
      const states = o.granted || {};
      return Promise.resolve({ state: states[desc && desc.name] || 'prompt' });
    },
  };
  function SpeechRecognition() { this.onerror = null; this.onend = null; this._events = []; }
  SpeechRecognition.prototype.start = function start(...args) { calls.started.push(args); return 'native-start'; };
  SpeechRecognition.prototype.dispatchEvent = function dispatchEvent(e) { this._events.push(e.type); return true; };
  const sandbox = {
    WO: { mediaShield: true, blockCameraMic: o.blockCameraMic !== false, blockScreenCapture: o.blockScreenCapture !== false, blockAutoplayMedia: false, blockGeolocation: false },
    trustedMediaHost: !!o.trusted,
    log(type, detail) { logs.push({ type, detail }); },
    navigator: {
      mediaDevices: {
        getUserMedia(c) { calls.gum.push(c); return Promise.resolve(stream); },
        getDisplayMedia(c) { calls.gdm.push(c); return Promise.resolve(stream); },
      },
      getUserMedia(c, ok, err) { calls.legacy.push({ c, ok: typeof ok, err: typeof err }); if (typeof ok === 'function') ok(stream); },
      permissions,
    },
    location: { hostname: 'calls.example' },
    __woToken: 'tok',
    /* The report is signed in the shipped engine; here it goes out as it would with no key. The
       signature is tested in tools/test-main-world-key-isolation.js. */
    __woSignedNotice: (m) => { delete m.kind; return m; },
    __woInterval: () => 0,
    clearInterval() {},
    setTimeout, DOMException, Promise, Object, Date, String, Number, Math, Array, Error, console,
    SpeechRecognition, webkitSpeechRecognition: SpeechRecognition,
    Event: function Event(type) { this.type = type; },
  };
  sandbox.window = sandbox;
  sandbox.window.postMessage = (msg) => { calls.posted.push(msg); };
  vm.createContext(sandbox);
  const script = [
    'let lastGestureAt=0,gestureSpent=!1;const gestureWindowMs=()=>2400;',
    'globalThis.__setGesture=(at,spent)=>{lastGestureAt=at;gestureSpent=!!spent};',
    gestureFns(),
    shieldSlice(),
    o.speech ? speechSlice() : '',
  ].join('\n');
  vm.runInContext(script, sandbox, { filename: 'media-shield-slice.js' });
  const realNow = Date.now;
  return {
    logs, calls, sandbox,
    gesture(agoMs, spent) { sandbox.__setGesture(NOW - agoMs, spent); },
    nowIs() { Date.now = () => NOW; },
    restore() { Date.now = realNow; },
    types() { return logs.map((l) => l.type); },
    last() { return logs.length ? logs[logs.length - 1] : { type: '', detail: {} }; },
  };
}

async function run() {
  console.log('\nMedia Shield presence\n');

  /* ---- the reported case, both ways ------------------------------------------------------ */
  {
    const w = world();
    w.nowIs();
    try {
      let err = null;
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => { err = e; });
      check('nobody at the page, no standing permission: the microphone is refused', !!err && err.name === 'NotAllowedError' && /blocked by WardenOne/.test(err.message), err && err.message);
      check('...and the browser was never asked', w.calls.gum.length === 0);
      check('...and Chrome\'s record was consulted, through the reference taken at start', w.calls.query.includes('microphone'), w.calls.query);
      check('...and it is recorded as a block with the reason', w.last().type === 'blocked_media_capture' && /no recent user action/.test(w.last().detail.why), w.logs);
    } finally { w.restore(); }
  }
  {
    const w = world();
    w.nowIs();
    try {
      w.gesture(3000);
      const p = w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      check('three seconds after a click the call reaches the browser at once, in the same task', w.calls.gum.length === 1, w.calls.gum);
      check('...without a permissions round trip', w.calls.query.length === 0, w.calls.query);
      const stream = await p.catch(() => null);
      check('...and the page gets Chrome\'s stream', !!stream && typeof stream.getTracks === 'function');
      check('...recorded as a request, with the reason', w.last().type === 'warned_media_capture' && /recent user action/.test(w.last().detail.why) && w.last().detail.audio && w.last().detail.video, w.logs);
      check('...and the active-capture notice still goes out for Memory Shield', w.calls.posted.some((m) => m && m.source === 'wardenone-media' && m.active === true), w.calls.posted);
    } finally { w.restore(); }
  }

  /* ---- the window ------------------------------------------------------------------------ */
  {
    const w = world();
    w.nowIs();
    try {
      w.gesture(9900);
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      check('just inside ten seconds counts as present', w.calls.gum.length === 1);
      w.gesture(10100);
      let err = null;
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => { err = e; });
      check('just outside it does not', w.calls.gum.length === 1 && !!err && err.name === 'NotAllowedError');
      w.gesture(1000, true);
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      check('a gesture the navigation guards already spent still counts as presence', w.calls.gum.length === 2, w.calls.gum.length);
      check('the window is ten seconds in the source, not a navigation-guard constant', /const MEDIA_PRESENCE_MS=1e4,/.test(CONTENT));
    } finally { w.restore(); }
  }

  /* ---- the browser's own record ----------------------------------------------------------- */
  {
    const w = world({ granted: { microphone: 'granted', camera: 'granted' } });
    w.nowIs();
    try {
      const stream = await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch(() => null);
      check('a site the reader already allowed in Chrome proceeds with nobody at the page', !!stream && w.calls.gum.length === 1, w.calls);
      check('...both kinds were checked', w.calls.query.includes('microphone') && w.calls.query.includes('camera'), w.calls.query);
      check('...and it is written down as a request made without a click, not as a block', w.last().type === 'warned_hidden_media_capture', w.types());
    } finally { w.restore(); }
  }
  {
    const w = world({ granted: { microphone: 'granted' } });
    w.nowIs();
    try {
      let err = null;
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true, video: true }).catch((e) => { err = e; });
      check('microphone allowed but camera not: a request for both is refused', !!err && w.calls.gum.length === 0, err && err.message);
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      check('...while the microphone alone proceeds', w.calls.gum.length === 1);
    } finally { w.restore(); }
  }
  {
    const w = world({ granted: { microphone: 'denied' } });
    w.nowIs();
    try {
      let err = null;
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => { err = e; });
      check('denied in Chrome and nobody at the page: refused here too', !!err && w.calls.gum.length === 0);
    } finally { w.restore(); }
  }
  for (const [label, opts] of [['no Permissions API at all', { permissions: null }], ['a query that throws', { queryThrows: true }], ['a query that rejects', { queryRejects: true }]]) {
    const w = world(opts);
    w.nowIs();
    try {
      let err = null;
      await w.sandbox.navigator.mediaDevices.getUserMedia({ video: true }).catch((e) => { err = e; });
      check(label + ' reads as "prompt": refused with nobody at the page', !!err && err.name === 'NotAllowedError' && w.calls.gum.length === 0, err && err.message);
      w.gesture(500);
      await w.sandbox.navigator.mediaDevices.getUserMedia({ video: true }).catch(() => {});
      check(label + ': and still goes to the browser when the reader is there', w.calls.gum.length === 1);
    } finally { w.restore(); }
  }
  {
    /* A page that rewrites navigator.permissions.query after the shield installed. */
    const w = world();
    w.nowIs();
    try {
      w.sandbox.navigator.permissions.query = () => Promise.resolve({ state: 'granted' });
      let err = null;
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch((e) => { err = e; });
      check('a page cannot answer for the browser by replacing permissions.query later', !!err && w.calls.gum.length === 0 && w.calls.query.includes('microphone'), { err: err && err.message, query: w.calls.query });
    } finally { w.restore(); }
  }

  /* ---- the switch and the exemptions are what they were ---------------------------------- */
  {
    const w = world({ blockCameraMic: false });
    w.nowIs();
    try {
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      check('with the switch off the browser is asked, click or no click', w.calls.gum.length === 1 && w.calls.query.length === 0 && w.last().type === 'warned_hidden_media_capture', w.types());
    } finally { w.restore(); }
  }
  {
    const w = world({ trusted: true });
    w.nowIs();
    try {
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: true }).catch(() => {});
      check('a trusted media host is exempt, as before', w.calls.gum.length === 1 && w.calls.query.length === 0);
    } finally { w.restore(); }
  }
  {
    const w = world();
    w.nowIs();
    try {
      await w.sandbox.navigator.mediaDevices.getUserMedia({ audio: false, video: false }).catch(() => {});
      check('a request for neither kind is the browser\'s to reject, as before', w.calls.gum.length === 1);
    } finally { w.restore(); }
  }

  /* ---- screen capture: never pre-authorised ----------------------------------------------- */
  {
    const w = world({ granted: { camera: 'granted', microphone: 'granted' } });
    w.nowIs();
    try {
      let err = null;
      await w.sandbox.navigator.mediaDevices.getDisplayMedia({ video: true }).catch((e) => { err = e; });
      check('screen capture with nobody at the page is refused, whatever Chrome remembers for the camera', !!err && err.name === 'NotAllowedError' && w.calls.gdm.length === 0 && w.calls.query.length === 0, err && err.message);
      check('...and recorded as a block', w.last().type === 'blocked_screen_capture', w.types());
      w.gesture(2000);
      const p = w.sandbox.navigator.mediaDevices.getDisplayMedia({ video: true });
      check('after a click the picker call reaches the browser in the same task', w.calls.gdm.length === 1);
      await p.catch(() => {});
      check('...recorded as a request', w.types().slice(-1).join() === 'warned_screen_capture');
    } finally { w.restore(); }
  }
  {
    const w = world({ blockScreenCapture: false });
    w.nowIs();
    try {
      await w.sandbox.navigator.mediaDevices.getDisplayMedia({ video: true }).catch(() => {});
      check('with the screen switch off the browser is asked', w.calls.gdm.length === 1 && w.last().type === 'warned_hidden_screen_capture', w.types());
    } finally { w.restore(); }
  }

  /* ---- the legacy callback API takes the same decision ------------------------------------ */
  {
    const w = world();
    w.nowIs();
    try {
      let denied = null;
      w.sandbox.navigator.getUserMedia({ audio: true }, () => {}, (e) => { denied = e; });
      await settle();
      check('legacy getUserMedia with nobody at the page: the error callback gets the denial', !!denied && denied.name === 'NotAllowedError' && w.calls.legacy.length === 0, denied && denied.message);
      w.gesture(100);
      let got = null;
      w.sandbox.navigator.getUserMedia({ audio: true }, (s) => { got = s; }, () => {});
      check('legacy getUserMedia after a click reaches the browser at once', w.calls.legacy.length === 1 && !!got);
    } finally { w.restore(); }
  }
  {
    const w = world({ granted: { microphone: 'granted' } });
    w.nowIs();
    try {
      let got = null;
      w.sandbox.navigator.getUserMedia({ audio: true }, (s) => { got = s; }, () => {});
      await settle();
      check('legacy getUserMedia on an allowed site proceeds once Chrome\'s record is read', w.calls.legacy.length === 1 && !!got);
    } finally { w.restore(); }
  }

  /* ---- speech recognition, the other route to the microphone ------------------------------ */
  {
    const w = world({ speech: true });
    w.nowIs();
    try {
      const rec = new w.sandbox.SpeechRecognition();
      const seen = [];
      rec.onerror = (e) => seen.push('error:' + e.error);
      rec.onend = () => seen.push('end');
      rec.start();
      await settle();
      check('speech with nobody at the page and no standing permission is refused the browser\'s way', w.calls.started.length === 0 && seen.join() === 'error:not-allowed,end', seen);
      check('...and recorded as a block that says what to press', w.types().slice(-1).join() === 'blocked_speech_capture' && /page's own button/.test(w.logs[w.logs.length - 1].detail.action), w.logs.slice(-1));
      w.gesture(1500);
      const rec2 = new w.sandbox.SpeechRecognition();
      rec2.start();
      check('speech started after a click reaches the browser at once', w.calls.started.length === 1, w.calls.started);
      check('...recorded as a request', w.types().slice(-1).join() === 'warned_speech_capture');
    } finally { w.restore(); }
  }
  {
    const w = world({ speech: true, granted: { microphone: 'granted' } });
    w.nowIs();
    try {
      const rec = new w.sandbox.SpeechRecognition();
      rec.start();
      check('...on an allowed site the start waits for Chrome\'s record', w.calls.started.length === 0);
      await settle();
      check('...then proceeds', w.calls.started.length === 1 && w.types().slice(-1).join() === 'warned_speech_capture', w.types());
    } finally { w.restore(); }
  }

  /* ---- what the reader is told ------------------------------------------------------------- */
  check('only trusted events count as presence', /function markGesture\(e\)\{if\(e&&e\.isTrusted\)\{lastGestureAt=Date\.now\(\)/.test(CONTENT));
  check('the shield reads permissions through the reference taken at document_start', /__woRealPermissionQuery=\(\(\)=>\{try\{const p=navigator\.permissions;return p&&"function"==typeof p\.query\?p\.query\.bind\(p\):null/.test(CONTENT));
  check('the blocked toast says what happened and what to press', /blocked_media_capture:\{title:"Camera or mic blocked",why:"[^"]*no click or keypress[^"]*",action:"[^"]*site's own button[^"]*"/.test(CONTENT));
  const row = POPUP.slice(POPUP.indexOf('Block camera &amp; microphone'), POPUP.indexOf('data-key="blockCameraMic"'));
  check('the popup no longer promises to stop every prompt', row.length > 0 && !/Stops sites opening camera or microphone prompts/.test(row) && /Chrome/.test(row) && /already allowed/.test(row), row.slice(0, 200));
  const screenRow = POPUP.slice(POPUP.indexOf('Block screen capture</div>'), POPUP.indexOf('data-key="blockScreenCapture"'));
  check('the screen-capture row says the picker follows a click and nothing is remembered', /picker|choose/.test(screenRow) && /never|no .{0,8}always/.test(screenRow), screenRow.slice(0, 200));
  check('the README describes presence, not a hostname list', /Media Shield/.test(README) && /actually there|you are there|using the page/i.test(README.slice(README.indexOf('### Media Shield'), README.indexOf('### Media Shield') + 1500)));
  check('the source and the build agree on the decision', /function captureDecidedNow\(present\)\{\s*return!1===WO\.blockCameraMic\|\|trustedMediaHost\|\|!0===present\s*\}/.test(SOURCE) && /function captureDecidedNow\(present\)\{return!1===WO\.blockCameraMic\|\|trustedMediaHost\|\|!0===present\}/.test(CONTENT));
}

run().then(() => {
  finished = true;
  console.log('');
  if (failures.length) {
    for (const f of failures) console.log('  FAIL ' + f);
    console.log('\n' + failures.length + ' check(s) failed, ' + pass + ' passed');
    process.exit(1);
  }
  process.exitCode = 0;
  console.log('  ok  ' + pass + ' checks: the browser asks when the reader is there, and nothing asks when they are not');
}).catch((e) => { finished = true; console.error(e); process.exit(1); });

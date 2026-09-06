/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Media capability probing: MediaCapabilities and WebCodecs.
 *
 * A site can ask whether this machine decodes AV1 Main 10 at 4K60 smoothly and with
 * hardware. The answers describe the GPU and the decode stack, and a script that asks
 * forty such questions has a vector, not a playback decision.
 *
 * THE ONE RULE THAT CANNOT BEND: `supported` is never faked, in either direction. A page
 * told a codec is available will send it, and then nothing plays -- which is a worse
 * outcome than the fingerprinting this defends against. Only `smooth` and
 * `powerEfficient` are flattened, and WebCodecs -- whose only answer IS supported -- is
 * counted and never altered.
 *
 * Two halves, two switches, and neither may need the other:
 *   antiFingerprintNoise      -> flattens the answers
 *   fingerprintProbeDetection -> notices the enumeration
 *
 * Both are lifted out of content.min.js -- the built runtime, which is what a browser
 * actually loads -- and run for real.
 *
 * Run: node tools/test-media-capability-fp.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' -- ' + detail));
}

function sliceThrough(startMarker, endMarker) {
  const from = CONTENT.indexOf(startMarker);
  assert(from > 0, 'missing marker: ' + startMarker);
  const to = CONTENT.indexOf(endMarker, from);
  assert(to > from, 'missing end marker: ' + endMarker);
  return CONTENT.slice(from, to + endMarker.length);
}

const FLATTEN = sliceThrough('const mc=navigator.mediaCapabilities,flattenMediaInfo=info=>{',
  'mc&&(wrapMediaInfo("decodingInfo"),wrapMediaInfo("encodingInfo"))');
const DETECT = sliceThrough('const MEDIA_PROBE_BURST=12,MEDIA_PROBE_WINDOW_MS=1e4;',
  'wrapMediaProbe(c,"isConfigSupported")}catch(_){}');

/* ---- the flattening half --------------------------------------------------- */
function flattened(answer, opts) {
  const o = opts || {};
  const calls = [];
  const mediaCapabilities = {
    decodingInfo(config) {
      calls.push(config);
      if (o.rejects) return Promise.reject(new Error('bad config'));
      if (o.throws) throw new TypeError('not a config');
      if (o.notAPromise) return answer;
      return Promise.resolve(answer);
    },
    encodingInfo(config) { calls.push(config); return Promise.resolve(answer); },
  };
  const sandbox = {
    navigator: { mediaCapabilities },
    Object, Promise, String, Number, Boolean,
    cloak: (fn) => fn,
  };
  vm.createContext(sandbox);
  vm.runInContext(FLATTEN, sandbox, { filename: 'content.min.js:mediaflat' });
  return { mc: sandbox.navigator.mediaCapabilities, calls };
}

(async () => {
  /* THE cardinal rule, both directions. */
  {
    const r = flattened({ supported: true, smooth: true, powerEfficient: true });
    const out = await r.mc.decodingInfo({ type: 'file' });
    check('supported:true is passed straight through', out.supported === true,
      JSON.stringify(out));
  }
  {
    const r = flattened({ supported: false, smooth: false, powerEfficient: false });
    const out = await r.mc.decodingInfo({ type: 'file' });
    check('supported:false is passed straight through', out.supported === false,
      'inventing support is the one change that stops video playing at all');
  }
  {
    const r = flattened({ supported: true, smooth: true, powerEfficient: true });
    const out = await r.mc.decodingInfo({ type: 'file' });
    check('smooth is flattened', out.smooth === false, JSON.stringify(out));
    check('powerEfficient is flattened', out.powerEfficient === false, JSON.stringify(out));
  }
  {
    /* The example from the brief: the interesting part is the performance/power pair. */
    const r = flattened({ supported: true, smooth: true, powerEfficient: false });
    const out = await r.mc.decodingInfo({ type: 'file' });
    check('two machines that differ only in smooth now answer identically',
      JSON.stringify({ s: out.supported, m: out.smooth, p: out.powerEfficient })
      === JSON.stringify({ s: true, m: false, p: false }), JSON.stringify(out));
  }
  {
    const r = flattened({
      supported: true, smooth: true, powerEfficient: true,
      configuration: { video: { contentType: 'video/mp4' } }, keySystemAccess: 'x',
    });
    const out = await r.mc.decodingInfo({ type: 'media-source' });
    check('every other field survives', out.keySystemAccess === 'x'
      && out.configuration.video.contentType === 'video/mp4', JSON.stringify(out));
  }
  {
    const answer = { supported: true, smooth: true, powerEfficient: true };
    const r = flattened(answer);
    await r.mc.decodingInfo({ type: 'file' });
    check("the browser's own result object is not mutated",
      answer.smooth === true && answer.powerEfficient === true,
      'a page may already be holding it');
  }
  {
    const r = flattened({ supported: true }, { rejects: true });
    let threw = false;
    try { await r.mc.decodingInfo({ type: 'file' }); } catch (_) { threw = true; }
    check('a rejection reaches the page unchanged', threw,
      'swallowing it would leave a player waiting forever');
  }
  {
    const r = flattened({ supported: true }, { throws: true });
    let threw = false;
    try { r.mc.decodingInfo({ type: 'file' }); } catch (e) { threw = e instanceof TypeError; }
    check('a synchronous throw is not converted into something else', threw);
  }
  {
    const plain = { supported: true, smooth: true, powerEfficient: true };
    const r = flattened(plain, { notAPromise: true });
    const out = r.mc.decodingInfo({ type: 'file' });
    check('a non-promise return is handed back untouched', out === plain,
      'guessing at a shape the spec does not promise is how a wrapper breaks a page');
  }
  {
    const r = flattened({ supported: true, smooth: true, powerEfficient: true });
    const out = await r.mc.encodingInfo({ type: 'record' });
    check('encodingInfo is covered too', out.smooth === false && out.supported === true);
  }
  {
    const r = flattened({ supported: true, smooth: true, powerEfficient: true });
    const config = { type: 'file', video: { contentType: 'video/webm; codecs=av01' } };
    await r.mc.decodingInfo(config);
    check('the page\'s config reaches the browser unaltered', r.calls[0] === config,
      'this normalises the ANSWER; changing the question would change what plays');
  }

  /* ---- the detection half -------------------------------------------------- */
  function detector(opts) {
    const o = opts || {};
    const notes = [];
    let now = 1000;
    const decodingInfo = () => Promise.resolve({ supported: true });
    const isConfigSupported = () => Promise.resolve({ supported: true });
    const sandbox = {
      navigator: { mediaCapabilities: { decodingInfo, encodingInfo: decodingInfo } },
      window: {
        VideoDecoder: o.webcodecs ? { isConfigSupported } : undefined,
        VideoEncoder: o.webcodecs ? { isConfigSupported } : undefined,
        AudioDecoder: undefined, AudioEncoder: undefined,
      },
      noteFingerprint: (why) => notes.push(why),
      Date: { now: () => now },
      Object, Promise, String, Number, Boolean, Array,
    };
    vm.createContext(sandbox);
    vm.runInContext(DETECT, sandbox, { filename: 'content.min.js:mediadetect' });
    return {
      mc: sandbox.navigator.mediaCapabilities,
      win: sandbox.window,
      notes,
      advance(ms) { now += ms; },
    };
  }
  {
    const d = detector({});
    for (let i = 0; i < 8; i++) d.mc.decodingInfo({});
    check('a handful of probes is what a player does, and is not flagged',
      d.notes.length === 0, JSON.stringify(d.notes));
  }
  {
    const d = detector({});
    for (let i = 0; i < 12; i++) d.mc.decodingInfo({});
    check('a burst of probes is flagged', d.notes.length === 1, JSON.stringify(d.notes));
    check('and named as what it is', /codec capability enumeration/i.test(d.notes[0] || ''));
  }
  {
    const d = detector({});
    for (let i = 0; i < 60; i++) d.mc.decodingInfo({});
    check('it is noted once, not sixty times', d.notes.length === 1,
      'one behaviour must not spend the whole fingerprint budget');
  }
  {
    const d = detector({});
    /* A long-lived player probing occasionally over an hour must never reach the bar. */
    for (let i = 0; i < 40; i++) { d.mc.decodingInfo({}); d.advance(5000); }
    check('probes spread out over time are not a burst', d.notes.length === 0,
      JSON.stringify(d.notes));
  }
  {
    const d = detector({ webcodecs: true });
    for (let i = 0; i < 12; i++) d.win.VideoDecoder.isConfigSupported({});
    check('WebCodecs enumeration counts too', d.notes.length === 1, JSON.stringify(d.notes));
  }
  {
    const d = detector({ webcodecs: true });
    const answer = await d.win.VideoDecoder.isConfigSupported({});
    check('but WebCodecs answers are never altered', answer.supported === true,
      'isConfigSupported answers only the field nothing here may fake');
  }
  check('nothing in the detector rewrites a result',
    !/supported\s*:/.test(DETECT) && !/smooth/.test(DETECT),
    'counting and changing are two features with two switches');

  /* ---- two switches, neither needing the other ----------------------------- */
  check('flattening rides the noise shield',
    SOURCE.indexOf('const mc=navigator.mediaCapabilities,') > SOURCE.indexOf('if(WO.antiFingerprintNoise||WO.antiFingerprint)try{'));
  check('detection rides the probe-detection shield',
    /if\(!WO\.fingerprintProbeDetection\)return;/.test(SOURCE)
    && SOURCE.indexOf('MEDIA_PROBE_BURST') > SOURCE.indexOf('const noteFingerprint=why=>{'));
  check('neither half reads the other\'s switch',
    !/antiFingerprintNoise/.test(DETECT) && !/fingerprintProbeDetection/.test(FLATTEN),
    'they are two features with two switches, and one must not need the other on');

  /* ---- it stays part of the fingerprint layer ------------------------------ */
  check('no toggle of its own',
    !/data-key="[a-zA-Z]*(?:[Cc]odec|[Mm]edia[Cc]ap)[a-zA-Z]*"/.test(POPUP_HTML)
    && !/codecShield|mediaCapabilityGuard/i.test(SOURCE));
  check('no event kind of its own',
    !/warned_codec|warned_media_capability/.test(SOURCE),
    'it reports through the fingerprint signal that already existed');

  if (failures.length) {
    for (const f of failures) console.error('[fail] ' + f);
    console.error('media capability fingerprinting: ' + failures.length + ' failed');
    process.exit(1);
  }
  console.log('media capability fingerprinting: ' + pass + ' checks passed');
})();

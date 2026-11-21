/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* The default fingerprint shield (Round 5b, 2026-11-19). Before it, defaults changed no fingerprint value and even the
   opt-in noise left canvas pixels, rendered audio and WebGL pictures untouched, so the three heaviest image signals
   stayed exact. The noise engine runs here as it ships, against small fake browser APIs. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
let failed = 0, passed = 0;
function check(what, ok) { if (ok) passed++; else { failed++; console.error('FAIL - ' + what); } }

const begin = SRC.indexOf('function __woFingerprintNoise(');
const end = SRC.indexOf('/* FINGERPRINT-NOISE-END */');
if (begin < 0 || end < begin) { console.error('FAIL - the noise engine markers moved'); process.exit(1); }
const ENGINE = SRC.slice(begin, end);

/* WebGL read-back in the fake browser: an opaque gradient, so every pixel differs from the one beside it. */
const glv = (i) => (i % 4 === 3 ? 255 : (i * 7 + (i >> 2) * 3) & 255);

function realm(opts = {}) {
  let counter = opts.seed || 1;
  class ImageData { constructor(data, width, height) { this.data = data; this.width = width; this.height = height; } }
  class HTMLCanvasElement {
    constructor() { this.width = 300; this.height = 150; this.tainted = false; this._px = null; }
    get pixels() { const n = this.width * this.height * 4; if (!this._px || this._px.length !== n) this._px = new Uint8ClampedArray(n); return this._px; }
    getContext(type) { return type === '2d' ? (this._ctx || (this._ctx = new CanvasRenderingContext2D(this))) : null; }
    toDataURL() { if (this.tainted) { const e = new Error('Tainted canvases may not be exported.'); e.name = 'SecurityError'; throw e; } return 'data:' + Buffer.from(this.pixels).toString('base64'); }
    toBlob(callback) { callback(this.toDataURL()); }
  }
  class CanvasRenderingContext2D {
    constructor(canvas) { this.canvas = canvas; }
    getImageData(sx, sy, sw, sh) {
      if (this.canvas.tainted) { const e = new Error('tainted'); e.name = 'SecurityError'; throw e; }
      const out = new Uint8ClampedArray(sw * sh * 4), src = this.canvas.pixels, w = this.canvas.width;
      for (let y = 0; y < sh; y++) out.set(src.subarray(((sy + y) * w + sx) * 4, ((sy + y) * w + sx + sw) * 4), y * sw * 4);
      return new ImageData(out, sw, sh);
    }
    putImageData(img, dx, dy) { const w = this.canvas.width; for (let y = 0; y < img.height; y++) this.canvas.pixels.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), ((dy + y) * w + dx) * 4); }
    drawImage(source) { this.canvas.pixels.set(source.pixels.subarray(0, this.canvas.pixels.length)); if (source.tainted) this.canvas.tainted = true; }
  }
  const nativeLength = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), 'length').get;
  class WebGLRenderingContext { readPixels(x, y, width, height, format, type, pixels) { for (let i = 0, n = nativeLength.call(pixels); i < n; i++) pixels[i] = glv(i); } }
  class AudioBuffer {
    constructor(length) { this.length = length; this._ch = [new Float32Array(length).map((_, i) => Math.sin(i / 7))]; }
    getChannelData(channel) { return this._ch[channel]; }
    copyFromChannel(destination, channelNumber) { destination.set(this._ch[channelNumber].subarray(0, destination.length)); }
  }
  class EventTarget { addEventListener(type, fn) { (this._l || (this._l = {}))[type] = (this._l[type] || []).concat(fn); } }
  class OfflineAudioContext extends EventTarget {
    startRendering() { const buf = new AudioBuffer(5000); this._buf = buf; return Promise.resolve(buf); }
    fire() { for (const fn of (this._l && this._l.complete) || []) fn({ renderedBuffer: this._buf }); }
  }
  class Navigator {}
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get() { return opts.cores || 12; }, configurable: true, enumerable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get() { return opts.memory || 32; }, configurable: true, enumerable: true });
  class Screen {}
  for (const [k, v] of Object.entries({ width: 1920, height: 1080, availWidth: 1920, availHeight: 1040, availTop: 0, availLeft: 40 })) {
    Object.defineProperty(Screen.prototype, k, { get() { return v; }, configurable: true, enumerable: true });
  }
  class Document { createElement(tag) { return tag === 'canvas' ? new HTMLCanvasElement() : {}; } }
  const g = {
    console, Promise, Map, WeakMap, Set, WeakSet, Math, Object, String, Number, Uint8Array, Uint8ClampedArray, Uint32Array,
    Float32Array, Proxy, Reflect, Error, Symbol, JSON, Array,
    crypto: { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = (counter = Math.imul(counter, 1103515245) + 12345 >>> 0); return a; } },
    location: { hostname: opts.host || 'shop.example', origin: 'https://' + (opts.host || 'shop.example'), ancestorOrigins: [] },
    ImageData, HTMLCanvasElement, CanvasRenderingContext2D, WebGLRenderingContext, AudioBuffer, OfflineAudioContext, EventTarget,
    Navigator, Screen, Document,
  };
  g.window = g; g.navigator = new Navigator(); g.screen = new Screen(); g.document = new Document();
  vm.createContext(g);
  vm.runInContext(ENGINE + '\nthis.__noise = __woFingerprintNoise;', g, { filename: 'content.js:noise' });
  return g;
}
const painted = (g, w = 40, h = 10) => {
  const c = g.document.createElement('canvas'); c.width = w; c.height = h;
  const px = c.pixels; for (let i = 0; i < px.length; i += 4) { px[i] = (i * 7) & 255; px[i + 1] = (i * 13) & 255; px[i + 2] = (i * 3) & 255; px[i + 3] = i % 40 === 0 ? 0 : 255; }
  return c;
};

(async () => {
  const std = realm();
  const record = vm.runInContext('__noise(null, "standard")', std);
  check('the standard level says so in its record', record.noise === true && record.level === 'standard' && Number.isInteger(record.seed));
  const canvas = painted(std), before = Buffer.from(canvas.pixels);
  const read = vm.runInContext('(c) => c.getContext("2d").getImageData(0, 0, c.width, c.height)', std)(canvas);
  let changed = 0, worst = 0, alphaMoved = false, clearMoved = false, opaque = 0;
  for (let i = 0; i < read.data.length; i += 4) {
    if (before[i + 3]) opaque++;
    for (let ch = 0; ch < 4; ch++) {
      const d = Math.abs(read.data[i + ch] - before[i + ch]);
      if (d) { changed++; worst = Math.max(worst, d); if (ch === 3) alphaMoved = true; if (!before[i + 3]) clearMoved = true; }
    }
  }
  check('getImageData changes about one visible pixel in eight', changed >= opaque * 0.06 && changed <= opaque * 0.25);
  check('a colour moves by one step at most', worst === 1);
  check('alpha and fully transparent pixels are never touched', !alphaMoved && !clearMoved);
  check('the page reads the same picture twice', Buffer.from(vm.runInContext('(c) => c.getContext("2d").getImageData(0, 0, c.width, c.height)', std)(canvas).data).equals(Buffer.from(read.data)));
  const url = vm.runInContext('(c) => c.toDataURL()', std)(canvas);
  check('toDataURL exports the noised picture', url !== 'data:' + before.toString('base64'));
  check('toDataURL leaves the visible canvas alone', Buffer.from(canvas.pixels).equals(before));
  const other = realm({ seed: 99 });
  vm.runInContext('__noise(null, "standard")', other);
  check('another visit reads a different picture', vm.runInContext('(c) => c.toDataURL()', other)(painted(other)) !== url);
  const tainted = painted(std); tainted.tainted = true;
  let threw = null; try { vm.runInContext('(c) => c.toDataURL()', std)(tainted); } catch (e) { threw = e.name; }
  check('a tainted canvas still refuses to export', threw === 'SecurityError');
  /* Excalidraw's export grew 25 times when flat white was noised, because PNG could no longer compress it. */
  const sheet = (fill) => { const c = std.document.createElement('canvas'); c.width = 64; c.height = 16;
    for (let p = 0; p < 64 * 16; p++) { const v = fill(p % 64, p >> 6); c.pixels.set([v, v, 250, 255], p * 4); } return c; };
  const flat = sheet(() => 250), flatBefore = Buffer.from(flat.pixels);
  const flatRead = vm.runInContext('(c) => c.getContext("2d").getImageData(0, 0, c.width, c.height)', std)(flat);
  check('a flat colour reads back exactly', Buffer.from(flatRead.data).equals(flatBefore));
  check('a flat colour exports exactly', vm.runInContext('(c) => c.toDataURL()', std)(flat) === 'data:' + flatBefore.toString('base64'));
  const band = sheet((x, y) => (y >= 6 && y <= 9 && x >= 10 && x <= 50 ? (x * 37 + y * 11) & 255 : 250)), bandBefore = Buffer.from(band.pixels);
  const bandRead = vm.runInContext('(c) => c.getContext("2d").getImageData(0, 0, c.width, c.height)', std)(band);
  let inside = 0, outside = 0;
  for (let p = 0; p < 64 * 16; p++) {
    if (!Buffer.from(bandRead.data.subarray(p * 4, p * 4 + 4)).equals(bandBefore.subarray(p * 4, p * 4 + 4))) {
      const x = p % 64, y = p >> 6; if (y >= 6 && y <= 9 && x >= 9 && x <= 51) inside++; else outside++;
    }
  }
  check('only text and edges get noise, never the flat colour around them', inside > 0 && outside === 0);
  const gl = vm.runInContext('(() => { const p = new Uint8Array(32 * 32 * 4); new WebGLRenderingContext().readPixels(0, 0, 32, 32, 6408, 5121, p); return p; })()', std);
  check('the standard level leaves WebGL read-back exact', gl.every((v, i) => v === glv(i)));

  const ctx = vm.runInContext('new OfflineAudioContext()', std);
  const buf = await vm.runInContext('(c) => c.startRendering()', std)(ctx);
  const clean = new AudioBuffer5000();
  function AudioBuffer5000() { return Float32Array.from({ length: 5000 }, (_, i) => Math.fround(Math.sin(i / 7))); }
  const noisy = vm.runInContext('(b) => b.getChannelData(0)', std)(buf);
  let audioWorst = 0, audioChanged = 0;
  for (let i = 0; i < noisy.length; i++) { const d = Math.abs(noisy[i] - clean[i]); if (d) audioChanged++; audioWorst = Math.max(audioWorst, d); }
  check('rendered audio changes by an inaudible amount', audioChanged > 4000 && audioWorst < 1e-6);
  const again = Float32Array.from(vm.runInContext('(b) => b.getChannelData(0)', std)(buf));
  check('rendered audio is noised once, not on every read', Buffer.from(again.buffer).equals(Buffer.from(Float32Array.from(noisy).buffer)));
  const played = vm.runInContext('new AudioBuffer(5000)', std);
  check('audio a page decodes or plays keeps its samples', vm.runInContext('(b) => b.getChannelData(0)', std)(played).every((v, i) => v === clean[i]));
  const evented = vm.runInContext('new OfflineAudioContext()', std);
  vm.runInContext('(c) => c.startRendering()', std)(evented);
  evented.fire();
  check('a complete event marks the rendered buffer too', vm.runInContext('(b) => b.getChannelData(0)', std)(evented._buf).some((v, i) => v !== clean[i]));

  check('core count and memory are rounded to common buckets', std.navigator.hardwareConcurrency === 8 && std.navigator.deviceMemory === 8);
  const small = realm({ cores: 2, memory: 2 }); vm.runInContext('__noise(null, "standard")', small);
  check('small machines report the lower bucket', small.navigator.hardwareConcurrency === 4 && small.navigator.deviceMemory === 4);
  check('no own properties are added to navigator', Object.getOwnPropertyNames(std.navigator).length === 0);
  check('the screen work area is the whole screen', std.screen.availWidth === 1920 && std.screen.availHeight === 1080 && std.screen.availTop === 0 && std.screen.availLeft === 0);
  check('the screen size itself is left alone at the standard level', std.screen.width === 1920 && std.screen.height === 1080);
  const toString = vm.runInContext('Function.prototype.toString', std);
  for (const [expr, name, len] of [['CanvasRenderingContext2D.prototype.getImageData', 'getImageData', 4], ['HTMLCanvasElement.prototype.toDataURL', 'toDataURL', 0],
    ['HTMLCanvasElement.prototype.toBlob', 'toBlob', 1], ['AudioBuffer.prototype.getChannelData', 'getChannelData', 1],
    ['OfflineAudioContext.prototype.startRendering', 'startRendering', 0], ['Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get', 'get hardwareConcurrency', 0]]) {
    const fn = vm.runInContext(expr, std);
    check(name + ' looks native', toString.call(fn) === 'function ' + name + '() { [native code] }' && fn.length === len && !('prototype' in fn));
  }
  const child = realm({ seed: 7 });
  check('a child realm follows its parent to the standard level', vm.runInContext('__noise(' + JSON.stringify(record) + ')', child).level === 'standard');

  const max = realm({ seed: 5 });
  const maxRecord = vm.runInContext('__noise(null)', max);
  check('with no level the engine keeps the stronger level', maxRecord.level === 'max');
  const glMax = vm.runInContext('(() => { const p = new Uint8Array(32 * 32 * 4); new WebGLRenderingContext().readPixels(0, 0, 32, 32, 6408, 5121, p); return p; })()', max);
  check('the stronger level noises WebGL read-back by one step at most', glMax.some((v, i) => v !== glv(i)) && glMax.every((v, i) => Math.abs(v - glv(i)) <= 1));
  /* A blank iframe's readPixels gets an array the parent made, so the check must work across realms. */
  const readInto = vm.runInContext('(p, ...rest) => { new WebGLRenderingContext().readPixels(0, 0, 32, 32, 6408, 5121, p, ...rest); return p; }', max);
  const foreign = readInto(vm.runInNewContext('new Uint8Array(32 * 32 * 4)'));
  check('an array from another frame is noised too', foreign.some((v, i) => v !== glv(i)));
  const clamped = readInto(new Uint8ClampedArray(32 * 32 * 4));
  check('a clamped array is noised too', clamped.some((v, i) => v !== glv(i)));
  const offset = readInto(new Uint8Array(64 + 32 * 32 * 4 + 64), 64);
  check('only the pixels written at the offset are touched', offset.subarray(0, 64).every((v, i) => v === glv(i))
    && offset.subarray(64 + 4096).every((v, i) => v === glv(i + 64 + 4096)) && offset.subarray(64, 64 + 4096).some((v, i) => v !== glv(i + 64)));
  let lengthReads = 0;
  const shadowed = new Uint8Array(32 * 32 * 4);
  Object.defineProperty(shadowed, 'length', { get() { lengthReads++; return 1e9; } });
  readInto(shadowed);
  check('a shadowed length is never read', lengthReads === 0 && shadowed.some((v, i) => v !== glv(i)));
  let coerced = 0;
  const boxed = new Uint8Array(32 * 32 * 4);
  vm.runInContext('(p, w) => new WebGLRenderingContext().readPixels(0, 0, w, 32, 6408, 5121, p)', max)(boxed, { valueOf() { coerced++; return 32; } });
  check('a boxed width is not converted a second time', coerced === 0 && boxed.every((v, i) => v === glv(i)));

  /* The engine arms the standard level at page start, before it knows the settings, so it must be able to take it back
     completely on a site where the shield is off. */
  const prov = realm({ seed: 11, cores: 16 });
  const natives = vm.runInContext('({ gid: CanvasRenderingContext2D.prototype.getImageData, tdu: HTMLCanvasElement.prototype.toDataURL,'
    + ' gcd: AudioBuffer.prototype.getChannelData, hc: Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get,'
    + ' aw: Object.getOwnPropertyDescriptor(Screen.prototype, "availWidth").get })', prov);
  const ctl = { live: true };
  vm.runInContext('(c) => __noise(null, "standard", c)', prov)(ctl);
  const kept = vm.runInContext('CanvasRenderingContext2D.prototype.getImageData', prov);
  const provCanvas = painted(prov), provBefore = Buffer.from(provCanvas.pixels);
  const readKept = () => Buffer.from(kept.call(provCanvas.getContext('2d'), 0, 0, provCanvas.width, provCanvas.height).data);
  check('the early shield is armed until it is undone', !readKept().equals(provBefore) && prov.navigator.hardwareConcurrency === 8);
  check('the engine gets an undo for the standard level', typeof ctl.restore === 'function');
  ctl.restore();
  check('the undo puts back the browser\'s own functions', vm.runInContext('CanvasRenderingContext2D.prototype.getImageData', prov) === natives.gid
    && vm.runInContext('HTMLCanvasElement.prototype.toDataURL', prov) === natives.tdu && vm.runInContext('AudioBuffer.prototype.getChannelData', prov) === natives.gcd
    && vm.runInContext('Object.getOwnPropertyDescriptor(Navigator.prototype, "hardwareConcurrency").get', prov) === natives.hc
    && vm.runInContext('Object.getOwnPropertyDescriptor(Screen.prototype, "availWidth").get', prov) === natives.aw);
  check('after the undo the real values show', prov.navigator.hardwareConcurrency === 16 && prov.screen.availHeight === 1040 && prov.screen.availLeft === 40);
  check('a wrapper the page kept answers natively after the undo', readKept().equals(provBefore));
  const maxCtl = { live: true };
  vm.runInContext('(c) => __noise(null, "max", c)', realm({ seed: 12 }))(maxCtl);
  check('the stronger level is never armed early, so it offers no undo', maxCtl.restore === undefined);

  /* Wiring. */
  check('the engine defaults to the shield and gates it on the master switch', /fingerprintShield:!0,/.test(SRC) && /fingerprintShield:gate\(!1!==cfg\.fingerprintShield\)/.test(SRC));
  check('the engine picks the level from the settings', /__woFingerprintNoise\(__woInheritedRealm\(\),strongNoise\?"max":"standard"\)/.test(SRC));
  check('hosted editors pause the shield like the noise', /HOSTED_APP_COMPAT_PAUSED=\[[^\]]*"fingerprintShield"/.test(SRC));
  check('the worker turns the shield on by default', /\n  fingerprintShield: true,\n/.test(BG));
  /* Chrome clears registered scripts on install and update; the first pages after relaunch went unshielded for 1.5 to
     2.3 s until the settings pass registered them again (restart lab, 2026-11-19). */
  const wrapAt = BG.indexOf('SERIALIZED_STATE_APPLIERS.forEach'), primeAt = BG.indexOf("localGet('wardenone_config').then((res) => {\n  if (__privacyEraseInProgress || !res || res.unreadable) return;\n  return reconcileFingerprintEarlyInjection(res.wardenone_config || {});");
  check('the worker restores the early registration at startup, through the serialized queue', wrapAt > 0 && primeAt > wrapAt);
  const stateKey = BG.slice(BG.indexOf('function refreshExtensionState()'), BG.indexOf("].join('|');", BG.indexOf('function refreshExtensionState()')));
  check('turning the shield off reaches the settings pass', /cfg\.fingerprintShield !== false \? 1 : 0,/.test(stateKey));
  const start = BG.indexOf("const FINGERPRINT_OFF_SCRIPT_ID = 'wo-fingerprint-early-off';"), stop = BG.indexOf('async function reconcileFingerprintEarlyInjection(');
  const ctx2 = { Object, Set, URL, activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: h => String(h).toLowerCase(),
    FINGERPRINT_EARLY_SCRIPT_ID: 'wo-fingerprint-early', FINGERPRINT_STANDARD_SCRIPT_ID: 'wo-fingerprint-early-standard' };
  vm.createContext(ctx2);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'psl-private.js'), 'utf8'), ctx2);
  vm.runInContext(BG.slice(start, stop) + '\nthis.plan = fingerprintEarlyRegistrations;', ctx2);
  const plan = cfg => JSON.parse(JSON.stringify(ctx2.plan(cfg, ['*://*.excluded.example/*'])));
  const byId = (list, id) => list.find(e => e.id === id);
  const ids = list => list.map(e => e.id).sort().join(',');
  const HOSTED = ['*://docs.google.com/*', '*://drive.google.com/*', '*://*.okta.com/*', '*://*.shopify.com/*'];
  const d = plan({}), dStd = byId(d, 'wo-fingerprint-early-standard'), dOff = byId(d, 'wo-fingerprint-early-off');
  check('defaults register the standard script, in every frame, at document_start', ids(d) === 'wo-fingerprint-early-off,wo-fingerprint-early-standard'
    && dStd.js[0] === 'fingerprint-early-standard.js' && dStd.allFrames === true && dStd.runAt === 'document_start' && dStd.world === 'MAIN'
    && dStd.matches[0] === '<all_urls>' && dStd.excludeMatches.includes('*://*.excluded.example/*'));
  check('hosted editors and sign in providers keep the shield paused from the first moment', HOSTED.every(p => dStd.excludeMatches.includes(p) && dOff.matches.includes(p))
    && dOff.js[0] === 'fingerprint-early-off.js' && dOff.allFrames === true && dOff.runAt === 'document_start' && dOff.world === 'MAIN');
  check('the off script never runs where the engine itself does not', JSON.stringify(dOff.excludeMatches) === '["*://*.excluded.example/*"]');
  const strong = plan({ antiFingerprintNoise: true });
  check('the stronger noise everywhere replaces the standard script', ids(strong) === 'wo-fingerprint-early,wo-fingerprint-early-off'
    && byId(strong, 'wo-fingerprint-early').allFrames === true && HOSTED.every(p => byId(strong, 'wo-fingerprint-early').excludeMatches.includes(p)));
  const mixed = plan({ siteOverrides: { 'news.example': { antiFingerprintNoise: true }, 'shop.example': { fingerprintShield: false } }, allowlist: ['trusted.example'] });
  check('a site with the stronger noise gets only that script', JSON.stringify(byId(mixed, 'wo-fingerprint-early').matches) === '["*://*.news.example/*"]'
    && byId(mixed, 'wo-fingerprint-early-standard').excludeMatches.includes('*://*.news.example/*') && !byId(mixed, 'wo-fingerprint-early-off').matches.includes('*://*.news.example/*'));
  check('a site with the shield off and an allowlisted site get the off script instead', ['*://*.shop.example/*', '*://*.trusted.example/*']
    .every(p => byId(mixed, 'wo-fingerprint-early-standard').excludeMatches.includes(p) && byId(mixed, 'wo-fingerprint-early-off').matches.includes(p)));
  /* The allowlist's public-only host rule dropped site settings on local hosts, so the early script still fired there. */
  const local = plan({ siteOverrides: { 'myapp.local': { fingerprintShield: false }, '192.168.1.10': { fingerprintShield: false } } });
  check('a local site with the shield off gets the off script too', ['*://*.myapp.local/*', '*://192.168.1.10/*']
    .every(p => byId(local, 'wo-fingerprint-early-off').matches.includes(p) && byId(local, 'wo-fingerprint-early-standard').excludeMatches.includes(p)));
  const shieldOff = plan({ fingerprintShield: false }), allOff = plan({ enabled: false });
  check('turning the shield off registers only the off script, everywhere', ids(shieldOff) === 'wo-fingerprint-early-off'
    && JSON.stringify(shieldOff[0].matches) === '["<all_urls>"]');
  /* WardenOne off also settles the engine itself before page code runs (P3-1). */
  check('turning WardenOne off registers the two off scripts, everywhere', ids(allOff) === 'wo-engine-early-off,wo-fingerprint-early-off'
    && allOff.every(entry => JSON.stringify(entry.matches) === '["<all_urls>"]'));
  check('the off file only announces the undo', fs.readFileSync(path.join(ROOT, 'fingerprint-early-off.js'), 'utf8')
    .includes("document.dispatchEvent(new Event('wo-fingerprint-early-off'));"));
  /* The engine side: armed at page start, settled by an early event or the settings, never undone by a page. */
  const early = SRC.slice(SRC.indexOf('let __woFpProvisional=null;'), SRC.indexOf('const __woStartRuntime=()=>{'));
  check('the engine arms the standard level at page start, except on hosted apps', /wardenOneHostedAppHost\(location\.hostname\)\)\)\{\s*const ctl=\{live:!0\};\s*__woRealmRecord=__woFingerprintNoise\(__woInheritedRealm\(\),"standard",ctl\);/.test(early));
  check('an early event counts only before page code could have run', /__woFpEarly=\(\)=>"loading"===document\.readyState&&!__woAuth\.pageCouldHaveRun\(document\)/.test(early)
    && /"wo-fingerprint-early-off",\(\)=>\{\s*__woFpProvisional&&__woFpEarly\(\)&&\(__woFpUndo\(\),__woRealmSettled\(\)\)/.test(early)
    && /if\(__woFpProvisional\)\{\s*__woFpEarly\(\)&&__woFpMax\(__woFpUndo\(\)\);/.test(early));
  const apply = SRC.slice(SRC.indexOf('const applyFingerprintNoise=()=>{'), SRC.indexOf('applyFingerprintNoise();', SRC.indexOf('const applyFingerprintNoise=()=>{')));
  check('settings that turn the shield off undo the early arm', /if\(__woFpProvisional\)\{\s*if\(!\(strongNoise\|\|WO\.fingerprintShield\)\)\{\s*__woFpUndo\(\);/.test(apply));
  /* The engine's own early section and settings handler, run with stand-ins for the noise function and the page. */
  const engine = (opts = {}) => {
    const box = { calls: [], listeners: {}, pageRan: false, hosted: !!opts.hosted, seed: 0 };
    box.WO = opts.WO || {};
    const sandbox = { box, Object, Number, location: { hostname: opts.host || 'shop.example' }, document: { readyState: 'loading' } };
    vm.createContext(sandbox);
    vm.runInContext('let __woRealmRecord=null;const log=()=>{};'
      + 'const woOn=(t,type,fn)=>{box.listeners[type]=fn};const __woRealmSettled=()=>box.calls.push("settled");'
      + 'const __woInheritedRealm=()=>null;const wardenOneHostedAppHost=()=>box.hosted;'
      + 'const __woAuth={pageCouldHaveRun:()=>box.pageRan};'
      + 'function __woFingerprintNoise(inherited,level,ctl){box.calls.push("arm:"+level+(inherited&&inherited.seed!=null?":seed"+inherited.seed:"")+(ctl?":ctl":""));'
      + 'ctl&&(ctl.restore=()=>{ctl.live=!1;box.calls.push("restore")});return Object.freeze({v:1,noise:!0,seed:++box.seed,level})}'
      + early + 'const WO=box.WO;' + apply + 'box.apply=applyFingerprintNoise;box.record=()=>__woRealmRecord;', sandbox, { filename: 'content.js:early' });
    return box;
  };
  const fire = (box, type) => box.listeners[type]();
  let e = engine();
  check('the engine arms the standard level before anything else runs', e.calls[0] === 'arm:standard:ctl' && e.record().noise === true);
  fire(e, 'wo-fingerprint-early-off');
  check('the off script undoes it before page code runs', e.calls.includes('restore') && e.record() === null);
  e = engine(); e.pageRan = true; fire(e, 'wo-fingerprint-early-off');
  check('a page cannot fake the off event once its code could have run', !e.calls.includes('restore') && e.record().noise === true);
  e = engine(); fire(e, 'wo-fingerprint-early-on');
  check('the stronger script replaces the early arm and keeps its seed', e.calls.join() === 'arm:standard:ctl,settled,restore,arm:max:seed1,settled' && e.record().level === 'max');
  e = engine(); e.pageRan = true; fire(e, 'wo-fingerprint-early-on');
  check('a forged stronger event after page code ran changes nothing', e.calls.join() === 'arm:standard:ctl,settled');
  e = engine(); fire(e, 'wo-fingerprint-early-standard'); fire(e, 'wo-fingerprint-early-off');
  check('once the standard script confirms the shield, nothing can undo it early', !e.calls.includes('restore') && e.record().noise === true);
  e = engine({ hosted: true });
  check('hosted editors and sign in providers are never armed early', e.calls.length === 0 && e.record() === null);
  e = engine({ WO: { fingerprintShield: false } }); e.pageRan = true;
  check('after a restart, settings with the shield off undo the early arm', e.apply() === true && e.calls.includes('restore') && e.record().noise === false);
  e = engine({ WO: { fingerprintShield: true } }); e.pageRan = true;
  check('settings with the shield on keep the early arm', e.apply() === false && !e.calls.includes('restore') && e.record().noise === true);
  e = engine({ WO: { fingerprintShield: true, antiFingerprintNoise: true } }); e.pageRan = true;
  check('settings for the stronger level after page code ran keep the standard arm rather than unwrap it', e.apply() === false && !e.calls.includes('restore'));
  e = engine({ WO: { fingerprintShield: true, antiFingerprintNoise: true } });
  check('settings for the stronger level before page code ran raise it', e.apply() === true && e.record().level === 'max');
  const REALM_SRC = fs.readFileSync(path.join(ROOT, 'src', 'fingerprint-realm.js'), 'utf8');
  const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
  check('frames arm on either early event, before their settings arrive', REALM_SRC.includes("[['wo-fingerprint-early-on', 'max'], ['wo-fingerprint-early-standard', 'standard']]")
    && REALM_SRC.includes("if (!settled && document.readyState === 'loading') settle(true, false, adopt(), false, level);"));
  check('frames take the level from their signed settings', REALM_SRC.includes("config.frameNoiseLevel === 'standard' ? 'standard' : 'max'"));
  check('the bridge sends frames their level', BRIDGE.includes("'frameNoise', 'frameNoiseLevel',") && BRIDGE.includes('clean.frameNoiseLevel = bridgeFrameNoiseLevel(clean);'));
  check('the standard early file only announces the level', fs.readFileSync(path.join(ROOT, 'fingerprint-early-standard.js'), 'utf8')
    .includes("document.dispatchEvent(new Event('wo-fingerprint-early-standard'));"));

  if (failed) { console.error(failed + ' fingerprint shield check(s) failed'); process.exit(1); }
  console.log('[ok] fingerprint shield: ' + passed + ' checks (canvas, audio, WebGL level, hardware, screen, cloaking, registration)');
})().catch(e => { console.error(e); process.exit(1); });

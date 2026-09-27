/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Fingerprint noise in every realm a page can reach (SEC-05).
 *
 * The noise rewrites the prototypes of the realm it runs in. The engine runs in the top frame
 * only, so a child frame used to be a fresh realm with untouched prototypes -- a hidden
 * same-origin iframe handed the page a clean toDataURL that worked on a top-frame canvas, and a
 * third-party frame measured the real machine and posted the answer up. fingerprint-realm.js
 * runs the engine's own noise function in the frames the engine never reaches.
 *
 * What is pinned here:
 *   - the module is built from the engine's own text: the noise and the HMAC verifier in
 *     fingerprint-realm.js are byte for byte the ones in content.min.js;
 *   - the manifest gives the module the reach the engine lacks (all_frames, about:blank,
 *     origin fallback) and every exclusion the engine has, plus the captcha frames;
 *   - the engine publishes a realm record at document_start on a non-configurable accessor and
 *     settles it whichever way the switch points;
 *   - the shipped module, run in stub realms: a same-origin child adopts the parent's record
 *     synchronously and reproduces its seed (same cores and GPU); a child
 *     of a parent with noise off installs nothing, a cross-origin child waits for its bridge's
 *     signed verdict and refuses forged keys, replays and bad signatures, a top-level http(s)
 *     page is left to the engine, a top-level about:blank window adopts from its opener;
 *   - the bridge's verdict honours the switch, the pause and the per-site choice for both the
 *     frame's host and the page's top host;
 *   - the switch's description says where the noise runs and that workers are not covered.
 *
 * Run: node tools/test-fingerprint-realm.js
 * Control: point WARDENONE_REALM / WARDENONE_CONTENT_MIN / WARDENONE_CONTENT_SRC /
 *          WARDENONE_BRIDGE / WARDENONE_MANIFEST / WARDENONE_BACKGROUND / WARDENONE_POPUP /
 *          WARDENONE_README at pre-fix copies; the module does not exist there.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const nodeCrypto = require('crypto');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const readAt = (env, rel) => {
  const p = process.env[env] || path.join(ROOT, rel);
  try { return fs.readFileSync(p, 'utf8'); } catch (_) { return ''; }
};
const REALM = readAt('WARDENONE_REALM', 'fingerprint-realm.js');
const CONTENT = readAt('WARDENONE_CONTENT_MIN', 'content.min.js');
const SRC = readAt('WARDENONE_CONTENT_SRC', path.join('src', 'content.js'));
const BRIDGE = readAt('WARDENONE_BRIDGE', 'bridge.js');
const MANIFEST_TEXT = readAt('WARDENONE_MANIFEST', 'manifest.json');
const BG = readAt('WARDENONE_BACKGROUND', 'background.js');
const POPUP = readAt('WARDENONE_POPUP', 'popup.html');
const README = readAt('WARDENONE_README', 'README.md');
const DOMAIN = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const PSL = fs.existsSync(path.join(ROOT, 'psl-private.js')) ? fs.readFileSync(path.join(ROOT, 'psl-private.js'), 'utf8') : '';
const CONTROL = !!process.env.WARDENONE_REALM;

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' -- ' + detail));
}
function section(name, fn) {
  try { fn(); } catch (e) { failures.push(name + ' -- threw: ' + (e && e.message)); }
}

let manifest = null;
try { manifest = JSON.parse(MANIFEST_TEXT); } catch (_) { manifest = null; }
const entries = (manifest && manifest.content_scripts) || [];
const engineEntry = entries.find((e) => Array.isArray(e.js) && e.js.includes('content.min.js')) || null;
const realmEntry = entries.find((e) => Array.isArray(e.js) && e.js.includes('fingerprint-realm.js')) || null;

/* The build strips every newline and its indentation; a region copied out of src/content.js and
   built the same way is what both shipped files must contain. */
const built = (s) => String(s || '').replace(/\r?\n[ \t]*/g, '');
function region(name) {
  const a = SRC.indexOf('/* ' + name + '-BEGIN');
  const b = SRC.indexOf('/* ' + name + '-END */');
  if (a < 0 || b < a) return '';
  return built(SRC.slice(a, b + ('/* ' + name + '-END */').length));
}

/* ---- 1. one noise function, shipped twice, byte for byte ------------------------------------- */
section('build parity', () => {
  check('fingerprint-realm.js is shipped', REALM.length > 1000, REALM.length + ' bytes');
  let parses = false;
  try { new Function(REALM); parses = true; } catch (e) { parses = false; }
  check('fingerprint-realm.js parses', parses);
  check('it is marked as generated', /GENERATED/.test(REALM));
  check('no include placeholder is left in it', !/@wardenone-include/.test(REALM));
  const noise = region('FINGERPRINT-NOISE');
  const auth = region('AUTH');
  check('src/content.js marks the noise region', noise.length > 10000, noise.length + ' bytes');
  check('and the HMAC verifier region', auth.length > 1000, auth.length + ' bytes');
  check('the built engine carries the noise region verbatim', noise.length > 0 && CONTENT.indexOf(noise) > 0);
  check('the frame module carries the same bytes', noise.length > 0 && REALM.indexOf(noise) > 0,
    'a wrapper present in one realm and not the other is exactly the gap this closes');
  check('the verifier is the engine\'s own text too', auth.length > 0 && CONTENT.indexOf(auth) > 0 && REALM.indexOf(auth) > 0);
  check('the noise is declared once in each file',
    (CONTENT.match(/function __woFingerprintNoise\(inherited\)\{/g) || []).length === 1
      && (REALM.match(/function __woFingerprintNoise\(inherited\)\{/g) || []).length === 1);
  check('the region uses no engine helper (no WO, no log, no woOn)',
    noise.length > 0 && !/\bWO\./.test(noise) && !/\blog\(/.test(noise) && !/\bwoOn\(/.test(noise),
    'the same text runs in a realm that has none of them');
  if (!CONTROL) {
    const res = spawnSync(process.execPath, [path.join('tools', 'build-content.js'), '--check'], { cwd: ROOT, encoding: 'utf8' });
    check('build-content --check covers the module', res.status === 0 && /fingerprint-realm\.js rebuilds exactly/.test(res.stdout || ''),
      (res.stdout || '') + (res.stderr || ''));
  }
});

/* ---- 2. the two seeds --------------------------------------------------------------------- */
section('seed split', () => {
  const noise = region('FINGERPRINT-NOISE');
  check('canvas exports and readback are left native', !/noisyCanvasForRead|hashBytes=data=>|HTMLCanvasElement\.prototype\.toDataURL=function/.test(noise));
  /* The hardware draw is NOT on the per-load seed any more (COMPAT-11): a core count is a claim
     about the machine, so it is keyed on the top-level site and holds across reloads. */
  check('the hardware-profile draw is keyed on the site seed, not the per-load one', /woPick=\(arr,key\)=>arr\[Math\.floor\(makeRnd\(mixSite\(key\)\)/.test(noise)
    && /mixSite=str=>\{let h=\(_st\^2166136261\)>>>0/.test(noise) && !/mixShared/.test(noise));
  check('and the site seed is a hash of the site alone, with no per-load or per-reader input', /_st=\(\(\)=>\{let h=2166136261>>>0;const s="wo-site:"\+woSiteKey\(\);/.test(noise)
    && !/_st=[^,]*(?:_sc|_sk|woSeed|getRandomValues|Math\.random)/.test(noise));
  check('the text-metric noise stays on the private seed', /seededTiny=\(key,scale=0\.01\)=>\(makeRnd\(mixSeed\(key\)\)/.test(noise)
    && /mixSeed=str=>\{let h=\(_sk\^2166136261\)>>>0/.test(noise),
    'a page knows the font and the string, so a shared seed here would let it subtract the noise');
  check('and so does the geometry noise', /rectSeed=\(a,b,c,d\)=>\{let h=\(_sk\^2166136261\)>>>0/.test(noise));
  check('an inherited seed is taken only when it is a 32-bit integer',
    /_sc=inherited&&"object"==typeof inherited&&Number\.isInteger\(inherited\.seed\)&&inherited\.seed>=0&&inherited\.seed<=4294967295\?inherited\.seed>>>0:woSeed\(\)/.test(noise));
  check('the record carries the shared seed and nothing private', /return Object\.freeze\(\{v:1,noise:!0,seed:_sc\}\)/.test(noise)
    && !/seed:_sk/.test(noise));
});

/* ---- 3. the engine's half ----------------------------------------------------------------- */
section('engine', () => {
  const accessorAt = CONTENT.indexOf('Object.defineProperty(window,"__wardenOneRealm",{get:function(){return __woRealmRecord},configurable:!1,enumerable:!1})');
  check('the engine defines the realm record as a non-configurable accessor', accessorAt > 0);
  check('before any listener or runtime code, so a page cannot pin the name first',
    accessorAt > 0 && accessorAt < CONTENT.indexOf('woOn(') && accessorAt < CONTENT.indexOf('const __woStartRuntime='));
  check('the gate hands the record to the same function the frames run',
    /if\(WO\.antiFingerprintNoise\|\|WO\.antiFingerprint\)try\{__woRealmRecord=__woFingerprintNoise\(__woInheritedRealm\(\)\),log\("antifingerprint_active"/.test(CONTENT));
  /* A popup a page opens onto its own site is a second top-level realm the page can compare with
     the first. The engine there borrows the opener's seed -- and reads the opener it captured at
     document_start, because `opener` is replaceable. */
  const openerAt = CONTENT.indexOf('let __woOpenerAtStart=null;try{__woOpenerAtStart=window.opener||null}catch(_){}');
  check('the engine captures its opener at document_start', openerAt > 0 && openerAt < CONTENT.indexOf('woOn('));
  const inheritSrc = (() => {
    const a = CONTENT.indexOf('const __woInheritedRealm=()=>{');
    const b = CONTENT.indexOf('};', a);
    return a > 0 && b > a ? CONTENT.slice(a, b + 2) : '';
  })();
  check('and reads only that window\'s record', /__woOpenerAtStart&&__woOpenerAtStart\.__wardenOneRealm/.test(inheritSrc));
  const inherited = (opener) => {
    const ctx = { __woOpenerAtStart: opener, Number, Object };
    vm.createContext(ctx);
    return vm.runInContext(inheritSrc + '\n__woInheritedRealm()', ctx);
  };
  const good = Object.freeze({ v: 1, noise: true, seed: 12345 });
  check('a same-origin opener with noise on lends its seed', inherited({ __wardenOneRealm: good }) === good);
  check('an opener with noise off lends nothing -- the verdict is the page\'s own', inherited({ __wardenOneRealm: Object.freeze({ v: 1, noise: false }) }) === null);
  check('a record without an integer seed lends nothing', inherited({ __wardenOneRealm: { v: 1, noise: true, seed: 'x' } }) === null);
  check('a cross-origin opener throws and lends nothing', inherited(crossOrigin()) === null);
  check('no opener, nothing', inherited(null) === null);
  check('and settles an off record when the switch is off or the noise failed',
    /__woRealmRecord\|\|\(__woRealmRecord=Object\.freeze\(\{v:1,noise:!1\}\)\),__woRealmSettled\(\);/.test(CONTENT));
  check('settling tells the document, so a child that arrived early can catch up',
    /const __woRealmSettled=\(\)=>\{try\{document\.dispatchEvent\(new CustomEvent\("wo-realm-settled"\)\)\}catch\(_\)\{\}\};/.test(CONTENT));
  check('the engine still has no framed-only branch (tools/test-known-limits.js premise)',
    !/window\.top===window\.self/.test(SRC));
});

/* ---- 4. the manifest ---------------------------------------------------------------------- */
section('manifest', () => {
  check('the engine is still top-frame only -- the gap the module fills', !!engineEntry && engineEntry.all_frames === false);
  check('the frame module is declared', !!realmEntry);
  if (!realmEntry) return;
  check('in the page world, at document_start', realmEntry.world === 'MAIN' && realmEntry.run_at === 'document_start');
  check('in every frame, about:blank and srcdoc included, and inherited-origin frames',
    realmEntry.all_frames === true && realmEntry.match_about_blank === true && realmEntry.match_origin_as_fallback === true);
  check('on every URL', Array.isArray(realmEntry.matches) && realmEntry.matches.length === 1 && realmEntry.matches[0] === '<all_urls>');
  check('alone in its entry -- domain-utils.js declares top-level consts and cannot be loaded twice in one world',
    realmEntry.js.length === 1);
  const engineEx = (engineEntry && engineEntry.exclude_matches) || [];
  const realmEx = realmEntry.exclude_matches || [];
  const missing = engineEx.filter((p) => !realmEx.includes(p));
  check('it carries every exclusion the engine has (the login and captcha hosts)', engineEx.length > 20 && missing.length === 0,
    'missing: ' + missing.join(', '));
  ['https://www.google.com/recaptcha/*', 'https://*.arkoselabs.com/*', 'https://*.funcaptcha.com/*'].forEach((p) => {
    check('and the captcha frame ' + p, realmEx.includes(p), 'a captcha frame fingerprints to tell a person from a bot');
  });
  check('the worker\'s package integrity list names the module', /'anti-redirect\.js', 'fingerprint-realm\.js'/.test(BG));
});

/* ---- 5. the shipped module, in stub realms ------------------------------------------------- */
function eventTarget() {
  const map = new Map();
  return {
    addEventListener(type, fn) { if (!map.has(type)) map.set(type, []); map.get(type).push(fn); },
    removeEventListener(type, fn) { const l = map.get(type) || []; const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); },
    dispatchEvent(ev) { (map.get(ev.type) || []).slice().forEach((fn) => fn(ev)); return true; },
    count(type) { return (map.get(type) || []).length; },
  };
}
/* A parent, top or opener the module cannot read: every property access throws, as a
   cross-origin WindowProxy does. */
function crossOrigin() {
  return new Proxy({}, { get() { throw new Error('SecurityError: Blocked a frame from accessing a cross-origin frame.'); } });
}
/* A same-origin ancestor whose record can be set later. */
function ancestor(rec) {
  const doc = eventTarget();
  const w = { document: doc };
  let current = rec === undefined ? null : rec;
  Object.defineProperty(w, '__wardenOneRealm', { get() { return current; }, configurable: false });
  w.set = (r) => { current = r; doc.dispatchEvent({ type: 'wo-realm-settled' }); };
  return w;
}
const FIXTURE_PIXELS = (() => { const d = new Uint8ClampedArray(16 * 16 * 4); for (let i = 0; i < d.length; i++) d[i] = (i * 37) & 255; return d; })();

/* A browser-shaped realm: every class the noise touches unguarded is present, the rest is
   optional and skipped by the noise's own try/catch. `top`, `parent`, `opener` default to the
   realm itself (a top-level window). */
function realm(opts) {
  const o = opts || {};
  const ctx = {};
  ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
  ctx.console = { log() {}, warn() {}, error() {} };
  ctx.location = {
    protocol: o.protocol || 'https:',
    hostname: o.hostname === undefined ? 'frame.example.com' : o.hostname,
    href: o.href || 'https://frame.example.com/',
    origin: o.origin || 'https://frame.example.com',
    /* the top page's origin last, as the real property lists them */
    ancestorOrigins: o.ancestors || [],
  };
  ctx.top = 'top' in o ? o.top : ctx;
  ctx.parent = 'parent' in o ? o.parent : ctx;
  ctx.opener = 'opener' in o ? o.opener : null;
  const doc = eventTarget();
  doc.readyState = o.readyState || 'loading';
  doc.body = o.body === undefined ? null : o.body;
  doc.documentElement = { getElementsByTagName: () => [], attributes: [] };
  doc.createElement = (tag) => {
    if (tag === 'canvas') { const c = Object.create(ctx.HTMLCanvasElement.prototype); c.width = 0; c.height = 0; return c; }
    return {};
  };
  ctx.document = doc;
  const win = eventTarget();
  ctx.addEventListener = win.addEventListener; ctx.dispatchEvent = win.dispatchEvent; ctx.removeEventListener = win.removeEventListener;
  ctx.__win = win;
  class CustomEvent { constructor(type, init) { this.type = type; this.detail = init && init.detail; } }
  ctx.CustomEvent = CustomEvent; ctx.Event = CustomEvent;
  ctx.DOMException = class DOMException extends Error { constructor(m, n) { super(m); this.name = n; } };
  const pixels = o.pixels || FIXTURE_PIXELS;
  class CanvasRenderingContext2D {
    getImageData() { return { data: new Uint8ClampedArray(pixels) }; }
    putImageData(img) { this.__put = img; }
    drawImage() {}
    measureText(t) { return { width: 100 + String(t).length }; }
  }
  class HTMLCanvasElement {
    getContext(kind) { if (kind !== '2d') return null; this.__ctx = this.__ctx || new CanvasRenderingContext2D(); return this.__ctx; }
    toDataURL() { return 'data:clean:' + (this.__ctx && this.__ctx.__put ? Array.from(this.__ctx.__put.data).join(',') : 'none'); }
    toBlob(cb) { cb('blob'); }
  }
  ctx.HTMLCanvasElement = HTMLCanvasElement;
  ctx.CanvasRenderingContext2D = CanvasRenderingContext2D;
  class Element { getBoundingClientRect() { return { x: 1, y: 2, width: 3, height: 4 }; } getClientRects() { return []; } }
  ctx.Element = Element;
  class DOMRect { constructor(x, y, w, h) { this.x = x; this.y = y; this.width = w; this.height = h; } }
  ctx.DOMRect = DOMRect;
  class Navigator {}
  ctx.Navigator = Navigator;
  ctx.navigator = Object.create(Navigator.prototype);
  ctx.navigator.platform = o.platform === undefined ? 'Win32' : o.platform;
  ctx.navigator.userAgentData = { platform: o.uaPlatform === undefined ? 'Windows' : o.uaPlatform };
  Object.defineProperty(Navigator.prototype, 'hardwareConcurrency', { get() { return 20; }, configurable: true });
  Object.defineProperty(Navigator.prototype, 'deviceMemory', { get() { return 32; }, configurable: true });
  Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { get() { return o.touch === undefined ? 10 : o.touch; }, configurable: true, enumerable: true });
  Object.defineProperty(Navigator.prototype, 'mimeTypes', { get() { return { 'application/pdf': { type: 'application/pdf' } }; }, configurable: true, enumerable: true });
  Object.defineProperty(Navigator.prototype, 'plugins', { get() { return [{ name: 'Chrome PDF Viewer' }]; }, configurable: true, enumerable: true });
  const nativeConnection = { effectiveType: '3g', addEventListener() {}, removeEventListener() {} };
  Object.defineProperty(Navigator.prototype, 'connection', { get() { return nativeConnection; }, configurable: true, enumerable: true });
  ctx.__nativeConnection = nativeConnection;
  ctx.navigator.language = 'en-US';
  class Screen {}
  ctx.Screen = Screen;
  ctx.screen = Object.create(Screen.prototype);
  Object.defineProperty(Screen.prototype, 'width', { get() { return o.screenWidth || 2560; }, configurable: true, enumerable: true });
  Object.defineProperty(Screen.prototype, 'height', { get() { return o.screenHeight || 1440; }, configurable: true, enumerable: true });
  Object.defineProperty(Screen.prototype, 'availWidth', { get() { return o.availWidth || 2520; }, configurable: true, enumerable: true });
  Object.defineProperty(Screen.prototype, 'availHeight', { get() { return o.availHeight || 1400; }, configurable: true, enumerable: true });
  ctx.innerWidth = 1200; ctx.innerHeight = 800;
  const rand = o.rand || 0x12345678;
  ctx.crypto = { getRandomValues(a) { for (let i = 0; i < a.length; i++) a[i] = (rand + i * 7919) >>> 0; return a; } };
  ctx.setTimeout = setTimeout;
  ctx.__replays = 0;
  doc.addEventListener('wo-bridge-replay', () => { ctx.__replays++; });
  ctx.__settled = 0;
  doc.addEventListener('wo-realm-settled', () => { ctx.__settled++; });
  vm.createContext(ctx);
  ctx.__native = { toDataURL: HTMLCanvasElement.prototype.toDataURL, getImageData: CanvasRenderingContext2D.prototype.getImageData,
    getClientRects: Element.prototype.getClientRects };
  return ctx;
}
function run(ctx) {
  try { vm.runInContext(REALM, ctx, { filename: 'fingerprint-realm.js' }); } catch (e) { ctx.__threw = e; }
  return ctx;
}
const wrapped = (ctx) => ctx.navigator.hardwareConcurrency !== 20;
const accessor = (ctx) => Object.getOwnPropertyDescriptor(ctx, '__wardenOneRealm');
const draw = (ctx) => { const c = ctx.document.createElement('canvas'); c.width = 16; c.height = 16;
  c.getContext('2d').putImageData({ data: FIXTURE_PIXELS }, 0, 0); return c.toDataURL(); };
const hmac = (keyHex, text) => nodeCrypto.createHmac('sha256', Buffer.from(keyHex, 'hex')).update(String(text), 'utf8').digest('hex');
const KEY = 'a'.repeat(64);
const TOKEN = 'tok-1234';
const configMsg = (keyHex, token, seq, overrides) => ({
  source: 'wardenone', kind: 'config', token, overrides, seq,
  mac: hmac(keyHex, seq + '\nconfig\n' + JSON.stringify(overrides)),
});
/* Inside a vm context the sandbox object appears as the context's own global proxy, so a message
   "from this window" has to name that proxy, not the raw sandbox. */
const globalOf = (ctx) => vm.runInContext('this', ctx);
const post = (ctx, msg, source) => ctx.__win.dispatchEvent({ type: 'message', source: source === undefined ? globalOf(ctx) : source, data: msg });
const giveKey = (ctx, token, key) => ctx.document.dispatchEvent({ type: 'wo-key', detail: { token, key } });

section('same-origin child adopts synchronously', () => {
  const parent = ancestor(Object.freeze({ v: 1, noise: true, seed: 0xABCDEF01 }));
  const c = run(realm({ parent, top: parent }));
  check('the module runs in a child frame', !c.__threw, c.__threw && c.__threw.message);
  const d = accessor(c);
  check('it publishes its own record on a non-configurable accessor', !!d && d.configurable === false && typeof d.get === 'function');
  check('with the parent\'s seed', c.__wardenOneRealm && c.__wardenOneRealm.noise === true && c.__wardenOneRealm.seed === 0xABCDEF01,
    JSON.stringify(c.__wardenOneRealm));
  check('and the record is frozen', Object.isFrozen(c.__wardenOneRealm));
  check('Maximum Privacy runs before the page can borrow APIs', wrapped(c));
  check('toDataURL stays native', c.HTMLCanvasElement.prototype.toDataURL === c.__native.toDataURL);
  check('getImageData stays native', c.CanvasRenderingContext2D.prototype.getImageData === c.__native.getImageData);
  check('getClientRects retains its native collection contract', c.Element.prototype.getClientRects === c.__native.getClientRects);
  check('hardwareConcurrency is the profile draw, not the machine', [4, 8, 12, 16].includes(c.navigator.hardwareConcurrency) && c.navigator.hardwareConcurrency !== 20);
  check('deviceMemory too', [4, 8].includes(c.navigator.deviceMemory));
  check('the screen rounds down without claiming pixels the display lacks', c.screen.width === 2500 && c.screen.height === 1400, c.screen.width + 'x' + c.screen.height);
  check('the realm tells its document it settled', c.__settled === 1);
  check('and asked for no bridge replay -- it did not need one', c.__replays === 0);
  let redefined = false;
  try { Object.defineProperty(c, '__wardenOneRealm', { value: { v: 1, noise: false } }); redefined = true; } catch (_) { redefined = false; }
  check('the page cannot redefine the record', !redefined && c.__wardenOneRealm.noise === true);
  check('nor delete it', (() => { try { return !(delete c.__wardenOneRealm) || !!accessor(c); } catch (_) { return true; } })());
});

section('realms sharing a seed agree', () => {
  const parent = ancestor(Object.freeze({ v: 1, noise: true, seed: 0xABCDEF01 }));
  const a = run(realm({ parent, top: parent, rand: 0x1111 }));
  const b = run(realm({ parent, top: parent, rand: 0x2222 }));
  check('two frames adopting one record report the same cores and memory',
    a.navigator.hardwareConcurrency === b.navigator.hardwareConcurrency && a.navigator.deviceMemory === b.navigator.deviceMemory);
  const pa = draw(a), pb = draw(b);
  check('and identical native canvas exports despite different local randomness', pa === pb && pa === 'data:clean:' + Array.from(FIXTURE_PIXELS).join(','));
  check('user-authored pixels are not changed', pa === 'data:clean:' + Array.from(FIXTURE_PIXELS).join(','));
  const other = ancestor(Object.freeze({ v: 1, noise: true, seed: 0x00000001 }));
  const cOther = run(realm({ parent: other, top: other, rand: 0x1111 }));
  check('a different seed still keeps authored pixels', draw(cOther) === pa);
  check('and output is stable within a realm', draw(a) === pa);
});

/* COMPAT-11: the hardware tuple is a claim about the machine. It must be identical across reloads,
   tabs and frames of one site -- whatever the per-load randomness did -- and unrelated between
   sites, while canvas pixels remain native across loads. */
section('one site, one machine', () => {
  const tuple = (c) => JSON.stringify([c.navigator.hardwareConcurrency, c.navigator.deviceMemory, c.__woGpu]);
  /* A frame under a given top site, patched through the signed verdict path (no inherited seed),
     with its own per-load randomness. */
  const frameOn = (topOrigin, rand, hostname) => {
    const c = realm({ parent: crossOrigin(), top: crossOrigin(), rand, hostname: hostname || 'frame.example.com', ancestors: [topOrigin] });
    /* a WebGL prototype for the profile to patch, so the renderer string is part of the tuple */
    c.WebGLRenderingContext = class WebGLRenderingContext { getParameter(p) { return 'native-' + p; } };
    run(c);
    giveKey(c, TOKEN, KEY);
    post(c, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
    try { c.__woGpu = c.WebGLRenderingContext.prototype.getParameter.call({}, 37446); } catch (_) { c.__woGpu = 'n/a'; }
    return c;
  };
  const a1 = frameOn('https://shop.example.com', 0x1111);
  const a2 = frameOn('https://shop.example.com', 0x2222);
  const a3 = frameOn('https://www.example.com', 0x3333, 'other.example.com');
  check('the noise ran in each realm', wrapped(a1) && wrapped(a2) && wrapped(a3));
  check('a reload (new per-load randomness) shows the same cores, memory and GPU', tuple(a1) === tuple(a2), tuple(a1) + ' vs ' + tuple(a2));
  check('another subdomain of the same site, in another frame, shows the same machine', tuple(a1) === tuple(a3), tuple(a1) + ' vs ' + tuple(a3));
  check('while canvas exports stay identical across loads', draw(a1) === draw(a2));
  const sites = ['https://alpha.example', 'https://bravo.example', 'https://charlie.example', 'https://delta.example', 'https://echo.example', 'https://foxtrot.example', 'https://golf.example', 'https://hotel.example'];
  const tuples = new Set(sites.map((s) => tuple(frameOn(s, 0x4444))));
  check('different sites see different machines (eight sites, more than one tuple)', tuples.size >= 3, [...tuples].join(' | '));
  /* co.uk-style suffixes: two labels are not the site there. */
  const uk1 = frameOn('https://www.shop.co.uk', 0x5555);
  const uk2 = frameOn('https://login.shop.co.uk', 0x6666);
  check('www and login under one co.uk site agree', tuple(uk1) === tuple(uk2));
  check('the GPU string is part of what holds, and is a profile string, not the machine\'s', typeof a1.__woGpu === 'string' && /ANGLE \(/.test(a1.__woGpu) && a1.__woGpu === a2.__woGpu, a1.__woGpu);
  /* The site key itself, lifted from the built noise region and run against the cases above. */
  const noise = region('FINGERPRINT-NOISE');
  const keySrc = noise.slice(noise.indexOf('woSiteKey=()=>{'), noise.indexOf(',_st='));
  check('the site-key function was found in the region', keySrc.length > 100 && keySrc.length < 2000, keySrc.length);
  const keyFn = vm.runInNewContext('(function(location){ const ' + keySrc + '; return woSiteKey(); })', {});
  const keyOf = (hostname, ancestors) => keyFn({ hostname, origin: 'https://' + hostname, ancestorOrigins: ancestors || [] });
  check('the site key is the registrable domain of the top page', keyOf('www.example.com') === 'example.com' && keyOf('example.com') === 'example.com' && keyOf('a.b.c.example.org') === 'example.org');
  check('with the short public suffixes kept whole', keyOf('www.shop.co.uk') === 'shop.co.uk' && keyOf('news.bbc.co.uk') === 'bbc.co.uk' && keyOf('mail.example.com.au') === 'example.com.au' && keyOf('www.example.ac.jp') === 'example.ac.jp');
  check('a frame keys on the TOP site, not its own', keyOf('cdn.widgets.net', ['https://mid.example.org', 'https://www.example.com']) === 'example.com'
    && keyOf('cdn.widgets.net', ['https://www.example.com:8443']) === 'example.com');
  check('an about:blank child with no hostname still finds the top site', keyOf('', ['https://www.example.com']) === 'example.com');
  check('an address is a site of its own, whole', keyOf('127.0.0.1') === '127.0.0.1' && keyOf('10.0.0.7') === '10.0.0.7' && keyOf('[::1]') === '[::1]' && keyOf('localhost') === 'localhost');
  check('a bare or missing host does not throw', keyOf('') === '' && keyFn({}) === '' && keyFn(null) === '');
});

section('graphics identity follows the browser platform', () => {
  const make = (platform, uaPlatform) => {
    const parent = ancestor(Object.freeze({ v: 1, noise: true, seed: 0xABCDEF01 }));
    const c = realm({ parent, top: parent, platform, uaPlatform });
    c.WebGLRenderingContext = class WebGLRenderingContext { getParameter(p) { return 'native-' + platform + '-' + p; } };
    const nativeAdapter = { info: { vendor: 'native-' + platform }, requestDevice() { return Promise.resolve({}); } };
    const nativeRequest = () => Promise.resolve(nativeAdapter);
    c.navigator.gpu = { requestAdapter: nativeRequest };
    run(c);
    return { c, nativeAdapter, nativeRequest, gl: c.WebGLRenderingContext.prototype.getParameter.call({}, 37446) };
  };
  const windows = make('Win32', 'Windows');
  check('Windows receives a Direct3D renderer', /Direct3D11/.test(windows.gl));
  check('Windows WebGPU uses the same selected vendor', windows.c.navigator.gpu.requestAdapter !== windows.nativeRequest);
  for (const [platform, uaPlatform] of [['MacIntel', 'macOS'], ['Linux x86_64', 'Linux'], ['Unknown', 'Unknown'], ['Win32', 'macOS']]) {
    const v = make(platform, uaPlatform);
    check(platform + '/' + uaPlatform + ' retains native WebGL', v.gl === 'native-' + platform + '-37446', v.gl);
    check(platform + '/' + uaPlatform + ' retains native WebGPU', v.c.navigator.gpu.requestAdapter === v.nativeRequest);
  }
  const table = SRC.slice(SRC.indexOf('woGpu=woWindows?woPick(['), SRC.indexOf('],"gpu"):null'));
  check('every Windows profile uses a Windows graphics API', (table.match(/Direct3D11/g) || []).length === 5 && !/Metal|Vulkan/.test(table));
});

section('native capabilities remain usable under noise', () => {
  for (const [width, height, available] of [[1920, 1080, 1040], [1366, 768, 720], [1536, 864, 816], [2560, 1440, 1400]]) {
    const parent = ancestor(Object.freeze({ v: 1, noise: true, seed: 0xABCDEF01 }));
    const c = run(realm({ parent, top: parent, screenWidth: width, screenHeight: height, availWidth: width, availHeight: available }));
    check(width + 'x' + height + ' never overstates the real screen', c.screen.width <= width && c.screen.height <= height);
    check(width + 'x' + height + ' retains a smaller usable height', c.screen.availHeight < c.screen.height && c.screen.availHeight <= available);
    check(width + 'x' + height + ' retains a valid usable width', c.screen.availWidth <= c.screen.width);
  }
  const parent = ancestor(Object.freeze({ v: 1, noise: true, seed: 0xABCDEF01 }));
  const c = run(realm({ parent, top: parent }));
  check('touch capability remains nonzero on a touch device', c.navigator.maxTouchPoints === 10);
  check('PDF capability remains visible', !!c.navigator.mimeTypes['application/pdf'] && c.navigator.plugins.length > 0);
  check('connection is the native live object', c.navigator.connection === c.__nativeConnection && c.navigator.connection.effectiveType === '3g');
  check('native touch descriptor keeps its shape', Object.getOwnPropertyDescriptor(c.Navigator.prototype, 'maxTouchPoints').enumerable === true);
  check('patched screen descriptor keeps its native enumerability', Object.getOwnPropertyDescriptor(c.Screen.prototype, 'height').enumerable === true);
});

section('a parent with noise off', () => {
  const parent = ancestor(Object.freeze({ v: 1, noise: false }));
  const c = run(realm({ parent, top: parent }));
  check('installs nothing', !wrapped(c) && c.navigator.hardwareConcurrency === 20);
  check('and publishes an off record for its own children', c.__wardenOneRealm && c.__wardenOneRealm.noise === false && !('seed' in c.__wardenOneRealm));
  check('and still settles', c.__settled === 1);
});

section('the engine\'s realms are left alone', () => {
  const top = run(realm({}));
  check('a top-level https page defines nothing', !accessor(top) && !wrapped(top) && top.__replays === 0);
  const file = run(realm({ protocol: 'file:' }));
  check('nor does a top-level file: page', !accessor(file) && !wrapped(file));
  const twice = realm({ parent: ancestor(Object.freeze({ v: 1, noise: true, seed: 7 })), top: ancestor(null) });
  run(twice);
  const once = twice.HTMLCanvasElement.prototype.toDataURL;
  run(twice);
  check('a second injection into the same realm does nothing (no double wrap)', twice.HTMLCanvasElement.prototype.toDataURL === once && twice.__settled === 1);
});

section('a top-level about:blank window adopts from its opener', () => {
  const opener = ancestor(Object.freeze({ v: 1, noise: true, seed: 42 }));
  const w = run(realm({ protocol: 'about:', hostname: '', href: 'about:blank', origin: 'https://site.example.com', opener }));
  check('window.open("about:blank") is not the engine\'s realm, so the module acts there', !!accessor(w));
  check('and adopts the opener\'s seed', wrapped(w) && w.__wardenOneRealm.seed === 42);
  const waiting = run(realm({ protocol: 'about:', hostname: '', href: 'about:blank', origin: 'https://site.example.com', opener: ancestor(null) }));
  check('with no opener record yet it waits rather than deciding alone', !!accessor(waiting) && waiting.__wardenOneRealm === null && !wrapped(waiting));
});

section('late adoption', () => {
  const parent = ancestor(null);
  const c = run(realm({ parent, top: parent }));
  check('a child created before the parent decided waits', !!accessor(c) && c.__wardenOneRealm === null && !wrapped(c));
  check('and asks the bridge for a replay, in case it ran first', c.__replays === 1);
  check('and listens on the parent document', parent.document.count('wo-realm-settled') === 1);
  parent.set(Object.freeze({ v: 1, noise: true, seed: 99 }));
  check('when the parent settles, the child adopts', wrapped(c) && c.__wardenOneRealm.seed === 99 && c.__settled === 1);
  const p2 = ancestor(null);
  const c2 = run(realm({ parent: p2, top: p2 }));
  giveKey(c2, TOKEN, KEY);
  p2.set(Object.freeze({ v: 1, noise: true, seed: 5 }));
  post(c2, configMsg(KEY, TOKEN, 1, { frameNoise: false }));
  check('a parent that has settled outranks this frame\'s own verdict', wrapped(c2) && c2.__wardenOneRealm.seed === 5);
  const p3 = ancestor(null);
  const c3 = run(realm({ parent: p3, top: p3 }));
  giveKey(c3, TOKEN, KEY);
  p3.set(Object.freeze({ v: 1, noise: false }));
  post(c3, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
  check('in the off direction too', !wrapped(c3) && c3.__wardenOneRealm.noise === false);
  const p4 = ancestor(null);
  const c4 = run(realm({ parent: p4, top: p4 }));
  p4.document.dispatchEvent({ type: 'wo-realm-settled' });
  check('a settled event with no record behind it changes nothing', c4.__wardenOneRealm === null && !wrapped(c4));
  /* `parent` is replaceable. A same-origin page that created this frame can point the child's
     parent at an object of its own once appendChild returns; the child must keep reading the
     window it captured at document_start. */
  const p5 = ancestor(null);
  const c5 = run(realm({ parent: p5, top: p5 }));
  const forged = ancestor(Object.freeze({ v: 1, noise: false }));
  c5.parent = forged;
  c5.opener = forged;
  forged.document.dispatchEvent({ type: 'wo-realm-settled' });
  check('a replaced parent is not consulted', c5.__wardenOneRealm === null && !wrapped(c5));
  giveKey(c5, TOKEN, KEY);
  post(c5, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
  check('and the frame settles from the sources it captured, not the forgery', wrapped(c5) && c5.__wardenOneRealm.noise === true);
  const p6 = ancestor(null);
  const c6 = run(realm({ parent: p6, top: p6 }));
  c6.parent = ancestor(Object.freeze({ v: 1, noise: false }));
  p6.set(Object.freeze({ v: 1, noise: true, seed: 77 }));
  check('the captured parent settling still reaches the child', wrapped(c6) && c6.__wardenOneRealm.seed === 77);
});

section('a cross-origin child waits for its own signed verdict', () => {
  const mk = () => run(realm({ parent: crossOrigin(), top: crossOrigin() }));
  const c = mk();
  check('a cross-origin parent is not readable, so the child waits', !c.__threw && !!accessor(c) && c.__wardenOneRealm === null && !wrapped(c));
  giveKey(c, TOKEN, KEY);
  post(c, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
  check('a signed verdict of frameNoise:true installs the noise', wrapped(c) && c.__wardenOneRealm.noise === true);
  check('with a seed of this realm\'s own', Number.isInteger(c.__wardenOneRealm.seed));
  const off = mk();
  giveKey(off, TOKEN, KEY);
  post(off, configMsg(KEY, TOKEN, 1, { frameNoise: false, antiFingerprintNoise: true }));
  check('frameNoise:false settles off, whatever the raw switch says', !wrapped(off) && off.__wardenOneRealm.noise === false,
    'the verdict is the bridge\'s, resolved for both hosts; the raw switch is not consulted here');
  const noField = mk();
  giveKey(noField, TOKEN, KEY);
  post(noField, configMsg(KEY, TOKEN, 1, { antiFingerprintNoise: true }));
  check('a config without the verdict field settles off', !wrapped(noField) && noField.__wardenOneRealm.noise === false);
});

section('forged or replayed config is refused', () => {
  const mk = () => run(realm({ parent: crossOrigin(), top: crossOrigin() }));
  const bad = mk();
  giveKey(bad, TOKEN, KEY);
  const m = configMsg(KEY, TOKEN, 1, { frameNoise: true });
  m.mac = 'f'.repeat(64);
  post(bad, m);
  check('a bad signature is ignored', bad.__wardenOneRealm === null && !wrapped(bad));
  post(bad, configMsg('b'.repeat(64), TOKEN, 2, { frameNoise: true }));
  check('a config signed with a different key is ignored', bad.__wardenOneRealm === null);
  post(bad, configMsg(KEY, 'other-token', 3, { frameNoise: true }));
  check('a wrong token is ignored', bad.__wardenOneRealm === null);
  post(bad, configMsg(KEY, TOKEN, 0, { frameNoise: true }));
  check('a sequence that does not advance is ignored', bad.__wardenOneRealm === null);
  post(bad, configMsg(KEY, TOKEN, 4, { frameNoise: true }), { not: 'this window' });
  check('a message from another source is ignored', bad.__wardenOneRealm === null);
  post(bad, configMsg(KEY, TOKEN, 5, { frameNoise: true }));
  check('and a genuine one afterwards still counts', wrapped(bad) && bad.__wardenOneRealm.noise === true);

  const second = mk();
  giveKey(second, TOKEN, KEY);
  giveKey(second, 'tok-2', 'c'.repeat(64));
  post(second, configMsg('c'.repeat(64), 'tok-2', 1, { frameNoise: false }));
  check('a second key after the first is ignored -- the first key wins', second.__wardenOneRealm === null);
  post(second, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
  check('and the first key still verifies', wrapped(second));

  /* The about:blank shape: the body already exists at document_start, so the bridge never
     delivers a key there -- and a page dispatching its own must not be able to become the key. */
  const blank = run(realm({ parent: crossOrigin(), top: crossOrigin(), readyState: 'complete', body: {} }));
  giveKey(blank, TOKEN, KEY);
  post(blank, configMsg(KEY, TOKEN, 1, { frameNoise: false }));
  check('a key handed over after the page could have run is refused', blank.__wardenOneRealm === null && !wrapped(blank),
    'otherwise a page could sign a "noise off" for a child it created');
  const unkeyed = mk();
  post(unkeyed, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
  check('no key, no verdict', unkeyed.__wardenOneRealm === null && !wrapped(unkeyed));
  const oddKey = mk();
  giveKey(oddKey, TOKEN, '');
  giveKey(oddKey, '', KEY);
  giveKey(oddKey, TOKEN, 12345);
  post(oddKey, configMsg(KEY, TOKEN, 1, { frameNoise: true }));
  check('a malformed key event is not a key', oddKey.__wardenOneRealm === null);
});

section('the module claims nothing about workers', () => {
  check('it does not wrap Worker or re-serve worker sources', !/new Worker\(|importScripts|WorkerNavigator|createObjectURL/.test(REALM.replace(/\/\*[\s\S]*?\*\//g, '')));
});

/* ---- 6. the bridge's verdict -------------------------------------------------------------- */
function bridgeVerdict(o) {
  const a = BRIDGE.indexOf('  // ---- fingerprint noise in this frame (SEC-05)');
  const b = BRIDGE.indexOf('    } catch (_) { return false; }\n  }\n', a);
  if (a < 0 || b < 0) return null;
  const code = BRIDGE.slice(a, b + '    } catch (_) { return false; }\n  }\n'.length);
  const helpers = ['function bridgeCleanHost(value) {', 'function bridgeHostMatchesList(host, list) {', 'function bridgeSiteOverridesFor(config, host) {']
    .map((start) => {
      const s = BRIDGE.indexOf(start);
      if (s < 0) return '';
      const e = BRIDGE.indexOf('\n  }\n', s);
      return BRIDGE.slice(s, e + 4);
    }).join('\n');
  const ctx = { URL, Object, String, Array, Number, Boolean, RegExp, Math, JSON, console: { log() {} } };
  ctx.window = ctx; ctx.self = ctx;
  ctx.top = o.top === undefined ? {} : o.top;
  ctx.location = { hostname: o.hostname === undefined ? 'frame.example.com' : o.hostname, origin: o.origin || 'https://frame.example.com', ancestorOrigins: o.ancestors || [] };
  vm.createContext(ctx);
  if (PSL) vm.runInContext(PSL, ctx);
  vm.runInContext(DOMAIN, ctx);
  vm.runInContext(helpers + '\n' + code + '\nthis.verdict = bridgeFrameNoiseAllowed; this.topHost = bridgeTopHost; this.ownHost = bridgeOwnHost;', ctx);
  return ctx;
}
section('bridge verdict', () => {
  const on = { enabled: true, antiFingerprintNoise: true, allowlist: [], siteOverrides: {} };
  const inFrame = (o) => bridgeVerdict(Object.assign({ ancestors: ['https://page.example.org'] }, o || {}));
  const v = inFrame();
  check('the verdict code is in the bridge', !!v && typeof v.verdict === 'function');
  if (!v) return;
  check('the switch on, nothing paused: noise runs in the frame', v.verdict(on) === true);
  check('the switch off: it does not', v.verdict(Object.assign({}, on, { antiFingerprintNoise: false })) === false);
  check('the alias switch counts like the engine\'s gate', v.verdict(Object.assign({}, on, { antiFingerprintNoise: false, antiFingerprint: true })) === true);
  check('protection off entirely: no', v.verdict(Object.assign({}, on, { enabled: false })) === false);
  check('the frame\'s own host paused: no', v.verdict(Object.assign({}, on, { allowlist: ['frame.example.com'] })) === false);
  check('the page\'s top host paused: no -- the frame is part of the page', v.verdict(Object.assign({}, on, { allowlist: ['page.example.org'] })) === false);
  check('a pause on an unrelated host changes nothing', v.verdict(Object.assign({}, on, { allowlist: ['elsewhere.example.net'] })) === true);
  check('the top host\'s per-site switch off: no', v.verdict(Object.assign({}, on, { siteOverrides: { 'page.example.org': { antiFingerprintNoise: false } } })) === false);
  check('a per-site switch off elsewhere changes nothing', v.verdict(Object.assign({}, on, { siteOverrides: { 'other.example.org': { antiFingerprintNoise: false } } })) === true);
  check('the top host is read from the last ancestor origin', v.topHost() === 'page.example.org' && v.ownHost() === 'frame.example.com');
  const nested = inFrame({ ancestors: ['https://mid.example.net', 'https://www.page.example.org'] });
  check('through a cross-origin middle frame too, and www. is dropped', nested.topHost() === 'page.example.org');
  const opaque = inFrame({ ancestors: ['null'] });
  check('an opaque ancestor is unknown, and the frame\'s own host decides', opaque.topHost() === '' && opaque.verdict(on) === true
    && opaque.verdict(Object.assign({}, on, { allowlist: ['frame.example.com'] })) === false);
  const topLevel = bridgeVerdict({ hostname: 'site.example.com', origin: 'https://site.example.com' });
  topLevel.top = topLevel;
  check('a top-level window is its own top host', topLevel.topHost() === 'site.example.com');
  const blank = bridgeVerdict({ hostname: '', origin: 'https://site.example.com' });
  blank.top = blank;
  check('about:blank has no host of its own, so its inherited origin is used', blank.ownHost() === 'site.example.com'
    && blank.verdict(Object.assign({}, on, { allowlist: ['site.example.com'] })) === false);
  check('sendConfig decides while siteOverrides is still there to consult',
    BRIDGE.indexOf('clean.frameNoise = bridgeFrameNoiseAllowed(clean);') > 0
      && BRIDGE.indexOf('clean.frameNoise = bridgeFrameNoiseAllowed(clean);')
        < BRIDGE.indexOf('delete clean.siteOverrides;', BRIDGE.indexOf('  const sendConfig = (overrides) => {'))
      && BRIDGE.indexOf('clean.frameNoise = bridgeFrameNoiseAllowed(clean);') > BRIDGE.indexOf('clean.allowlist = sanitizeBridgeHostList(bridgeActiveAllowlist(clean), 1000);'),
    'the allowlist must be resolved before, and siteOverrides deleted after');
});

/* ---- 7. what the switch says --------------------------------------------------------------- */
section('copy', () => {
  const at = POPUP.indexOf('data-key="antiFingerprintNoise"');
  const row = at > 0 ? POPUP.slice(POPUP.lastIndexOf('<div class="row">', at), at) : '';
  check('the switch says it covers the page\'s frames', /frames?/i.test(row), row.slice(0, 200));
  check('and that workers are not covered', /worker/i.test(row));
  const readmeAt = README.indexOf('## Anti-fingerprinting');
  const section2 = readmeAt > 0 ? README.slice(readmeAt, README.indexOf('\n## ', readmeAt + 10)) : '';
  check('the README states the realm contract', /same-origin|frames?/i.test(section2) && /worker/i.test(section2));
});

/* ---- done ------------------------------------------------------------------------------------ */
if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('fingerprint realm: ' + pass + ' checks passed');

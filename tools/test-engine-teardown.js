'use strict';

// Chrome does not re-inject content scripts into open tabs when an extension updates, so a
// tab that outlives an update keeps its old engine. The version guard only stops a
// SAME-version re-run, which means a version bump used to leave two complete engines live
// in one MAIN world -- each with its own observers and timers, both charged for every DOM
// mutation, on exactly the long-lived tabs where it matters most.
//
// The engine now releases the previous instance's observers and timers before installing.
// It deliberately does NOT restore the patched prototypes: unwinding those in the wrong
// order can hand the page a half-restored API, which is worse than leaving a spare
// wrapper in the chain. What it releases is the expensive, stateful part.
//
// The release path itself needs a real browser to observe (the observer sites sit behind
// config and lifecycle gates a fake page cannot cheaply reproduce). What this file pins is
// the wiring, which is what would silently rot: every observer and timer must be created
// through a registering factory, and dispose must drain the registry.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

// ---------------------------------------------------------------------------
// 1. Every observer and timer goes through a factory that registers it. A raw
//    constructor anywhere else is a resource dispose can never reach.
// ---------------------------------------------------------------------------
const FACTORY_LINES = [
  'const __woObserver=(...a)=>__woHold(new MutationObserver(...a));',
  'const __woIntersection=(...a)=>__woHold(new IntersectionObserver(...a));',
  'const __woInterval=(...a)=>__woHold(setInterval(...a));',
];
for (const line of FACTORY_LINES) {
  check('factory present: ' + line.slice(6, line.indexOf('=(')), SRC.includes(line), line);
}

let body = SRC;
FACTORY_LINES.forEach((line) => { body = body.split(line).join(''); });
const raw = {
  'new MutationObserver(': body.split('new MutationObserver(').length - 1,
  'new IntersectionObserver(': body.split('new IntersectionObserver(').length - 1,
  'setInterval(': body.split('setInterval(').length - 1,
};
for (const [ctor, n] of Object.entries(raw)) {
  check('no raw ' + ctor + ' outside the factory', n === 0, n + ' remaining');
}
check('the factories are actually used',
  SRC.includes('__woObserver(') && SRC.includes('__woInterval('),
  'observer uses=' + (SRC.split('__woObserver(').length - 1) + ' interval uses=' + (SRC.split('__woInterval(').length - 1));

// Listeners on document/window go through woOn so one abort() releases all of them. A
// direct addEventListener on either target is a listener dispose cannot reach; the only
// legitimate one is inside woOn itself.
{
  const preambleEnd = SRC.indexOf('  const GRABBER_DOMAINS=');
  const engineBody = SRC.slice(preambleEnd);
  const strays = {
    'document.addEventListener(': engineBody.split('document.addEventListener(').length - 1,
    'window.addEventListener(': engineBody.split('window.addEventListener(').length - 1,
  };
  for (const [call, n] of Object.entries(strays)) {
    check('no direct ' + call + ' outside woOn', n === 0, n + ' remaining');
  }
  const routed = (engineBody.split('woOn(document,').length - 1)
    + (engineBody.split('woOn(window,').length - 1);
  check('woOn carries the engine listeners', routed > 50, routed + ' routed');
  check('woOn attaches the abort signal', /base\.signal=__woAbort\.signal/.test(SRC));
  check('dispose aborts the listener signal', /__woAbort\.abort\(\)/.test(SRC));
  // Options must be merged, not replaced: a capture or once listener has to keep behaving
  // that way, or the signal would silently change how the engine listens.
  check('woOn preserves caller options', /Object\.assign\(\{\s*\},\s*o\)/.test(SRC));
  check('woOn preserves the capture shorthand', /o===!0\?\{/.test(SRC));
}

// ---------------------------------------------------------------------------
// 2. Dispose drains the registry and handles both kinds of held resource.
// ---------------------------------------------------------------------------
check('dispose is published on window', /window\.__wardenOneDispose=\(\)=>/.test(SRC));
check('dispose drains the registry rather than iterating it in place',
  /__woKeep\.splice\(0,__woKeep\.length\)/.test(SRC));
check('dispose clears intervals', /clearInterval\(item\)/.test(SRC));
check('dispose disconnects observers', /item\.disconnect===\"function\"\)item\.disconnect\(\)/.test(SRC.replace(/\s+/g, '')) || /typeof item\.disconnect==="function"/.test(SRC));

// ---------------------------------------------------------------------------
// 3. The previous engine is disposed BEFORE this one installs anything, and before the
//    factories exist -- otherwise the new engine would register into a registry it is
//    about to hand to the old instance's dispose.
// ---------------------------------------------------------------------------
const callAt = SRC.indexOf('window.__wardenOneDispose()');
const keepAt = SRC.indexOf('const __woKeep=[]');
const factoryAt = SRC.indexOf('const __woObserver=');
check('the previous engine is disposed before the new registry is created',
  callAt > 0 && keepAt > callAt, 'dispose call at ' + callAt + ', registry at ' + keepAt);
check('...and before any factory exists', callAt > 0 && factoryAt > callAt,
  'dispose call at ' + callAt + ', factories at ' + factoryAt);
// A page can set window.__wardenOneDispose to anything, so the call must be typeof-checked
// AND wrapped -- a hostile value must not stop the engine installing.
check('the dispose call is typeof-guarded',
  SRC.includes('if(typeof window.__wardenOneDispose==="function")window.__wardenOneDispose()'));
check('...and wrapped in try/catch', /try\{\s*if\(typeof window\.__wardenOneDispose===/.test(SRC));

// ---------------------------------------------------------------------------
// 4. It survived the build. content.min.js is what actually ships.
// ---------------------------------------------------------------------------
check('the shipped runtime carries the teardown', MIN.includes('__wardenOneDispose') && MIN.includes('__woHold'));
check('the shipped runtime has no raw observer constructor',
  (MIN.split('new MutationObserver(').length - 1) === 1,
  (MIN.split('new MutationObserver(').length - 1) + ' occurrences (1 = the factory only)');

// ---------------------------------------------------------------------------
// 5. Behaviour: the registry/dispose contract in isolation, and the property that
//    matters most -- installing twice in one page must not throw.
// ---------------------------------------------------------------------------
{
  // Lift the real preamble rather than re-implementing it. It runs from the registry
  // through the dispose assignment, so the end marker is the const that follows it.
  const start = SRC.indexOf('  const __woKeep=[];');
  const end = SRC.indexOf('  const GRABBER_DOMAINS=', start);
  assert(start > 0 && end > start, 'could not lift the teardown preamble');
  const preamble = SRC.slice(start, end);
  assert(preamble.includes('window.__wardenOneDispose='), 'lifted preamble is missing the dispose assignment');

  const win = {};
  const cleared = [];
  // Node's real AbortController and EventTarget, deliberately: signal-based listener removal
  // is the spec behaviour the engine relies on, so proving it against the real
  // implementation is worth more than proving it against a mock that agrees with me.
  const ctx = vm.createContext({
    window: win, console, Object, Array, Number, String, Boolean,
    AbortController, EventTarget, Event,
    MutationObserver: class { disconnect() { this.gone = true; } },
    IntersectionObserver: class { disconnect() { this.gone = true; } },
    setInterval: () => 42,
    clearInterval: (id) => cleared.push(id),
  });
  vm.runInContext(preamble, ctx);

  const obs = vm.runInContext('__woObserver(function(){})', ctx);
  vm.runInContext('__woInterval(function(){}, 1000)', ctx);
  check('a factory-created observer is registered', vm.runInContext('__woKeep.length', ctx) === 2,
    'registry holds ' + vm.runInContext('__woKeep.length', ctx));

  // A listener registered through woOn on a real EventTarget, fired before and after dispose.
  vm.runInContext('this.__t=new EventTarget();this.__hits=0;'
    + 'woOn(__t,"ping",function(){__hits++});'
    + '__t.dispatchEvent(new Event("ping"));', ctx);
  const beforeDispose = vm.runInContext('__hits', ctx);
  check('a woOn listener fires while the engine is live', beforeDispose >= 1, 'hits=' + beforeDispose);

  // 40 of the 66 call sites pass options -- 26 capture, 13 once, 1 both -- so merging rather
  // than replacing is load-bearing. A replacing __woOpts would silently drop every one of
  // them, which no source-text check would notice. Assert on what addEventListener receives.
  vm.runInContext('this.__seen=[];this.__spy={addEventListener:function(t,f,o){__seen.push(o)}};'
    + 'woOn(__spy,"a",function(){});'          // no options
    + 'woOn(__spy,"b",function(){},!0);'       // capture shorthand
    + 'woOn(__spy,"c",function(){},{once:!0});'
    + 'woOn(__spy,"d",function(){},{capture:!0,once:!0});', ctx);
  const seen = vm.runInContext('JSON.stringify(__seen.map(function(o){'
    + 'return {capture:!!o.capture,once:!!o.once,signal:!!o.signal}}))', ctx);
  check('woOn merges every option shape and always adds the signal',
    seen === JSON.stringify([
      { capture: false, once: false, signal: true },
      { capture: true, once: false, signal: true },
      { capture: false, once: true, signal: true },
      { capture: true, once: true, signal: true },
    ]), seen);
  // once must still mean once: a merged signal must not turn it into a permanent listener.
  vm.runInContext('this.__onceHits=0;this.__t2=new EventTarget();'
    + 'woOn(__t2,"ping",function(){__onceHits++},{once:!0});'
    + '__t2.dispatchEvent(new Event("ping"));__t2.dispatchEvent(new Event("ping"));', ctx);
  check('a woOn once listener still fires exactly once',
    vm.runInContext('__onceHits', ctx) === 1, 'hits=' + vm.runInContext('__onceHits', ctx));

  win.__wardenOneDispose();
  check('dispose disconnected the observer', obs.gone === true);
  check('dispose cleared the interval', cleared.length === 1 && cleared[0] === 42, JSON.stringify(cleared));
  check('dispose empties the registry', vm.runInContext('__woKeep.length', ctx) === 0);

  vm.runInContext('__t.dispatchEvent(new Event("ping"))', ctx);
  check('dispose detached the woOn listener', vm.runInContext('__hits', ctx) === beforeDispose,
    'hits went ' + beforeDispose + ' -> ' + vm.runInContext('__hits', ctx));

  win.__wardenOneDispose();
  check('dispose is safe to call twice', cleared.length === 1, 'cleared ' + cleared.length + ' times');
}

if (failures) {
  console.error('[fail] engine teardown tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] engine teardown tests');

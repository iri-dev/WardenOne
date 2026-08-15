/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

// Most engine tests do not load the engine. They find a region of src/content.js by string
// marker, slice it out, and eval the slice in a hand-built sandbox. That keeps them fast and
// focused, but a lifted fragment can only reference what its sandbox provides -- so the
// moment the engine gains a shared helper and calls it from scattered places, every suite
// whose slice contains a call dies with "<helper> is not defined". It is not the engine that
// is wrong in that situation; the fragment simply cannot see it.
//
// This module is the one place that answers for those helpers. A suite that lifts engine
// source calls installEngineAmbient(sandbox) before running the slice, and the helpers
// resolve to shims that behave like the native they wrap, minus the bookkeeping the engine
// does for its own teardown. tools/test-engine-ambient.js asserts this list still covers
// every helper the engine declares, so adding one produces a clear failure here rather than
// a confusing one somewhere unrelated.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');

// The engine's ambient helpers live between the version guard and the first data table.
const PREAMBLE_START = 'if(window.__wardenOneReadyVersion===__WO_RUNTIME_VERSION)return;';
const PREAMBLE_END = '  const GRABBER_DOMAINS=';

function enginePreamble(src) {
  const source = src || fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
  const from = source.indexOf(PREAMBLE_START);
  const to = source.indexOf(PREAMBLE_END, from);
  if (from < 0 || to < 0) return '';
  return source.slice(from + PREAMBLE_START.length, to);
}

// Names the preamble declares. Parsed rather than listed so it cannot drift from the engine.
function declaredAmbientNames(src) {
  const pre = enginePreamble(src);
  const names = new Set();
  for (const m of pre.matchAll(/\b(?:const|let|var)\s+(__?wo[A-Za-z0-9_]*)\s*=/g)) names.add(m[1]);
  for (const m of pre.matchAll(/\b(?:const|let|var)\s+(woOn|woObserve)\b/g)) names.add(m[1]);
  return [...names];
}

// Shims. Each behaves like the thing the engine's helper wraps; none carry engine state, so a
// lifted fragment cannot accidentally depend on teardown bookkeeping that is not under test.
// Guarded with typeof so a sandbox that never provides MutationObserver only fails if a
// fragment actually constructs one.
const SHIMS = {
  __woKeep: 'var __woKeep=[];',
  __woHold: 'var __woHold=function(item){return item;};',
  __woObserver: 'var __woObserver=function(){'
    + 'if(typeof MutationObserver==="undefined")throw new Error("sandbox has no MutationObserver");'
    + 'return new MutationObserver.apply(null,arguments);};',
  __woIntersection: 'var __woIntersection=function(){'
    + 'if(typeof IntersectionObserver==="undefined")throw new Error("sandbox has no IntersectionObserver");'
    + 'return new IntersectionObserver(arguments[0],arguments[1]);};',
  __woInterval: 'var __woInterval=function(){'
    + 'if(typeof setInterval==="undefined")return 0;'
    + 'return setInterval.apply(null,arguments);};',
  __woAbort: 'var __woAbort={signal:undefined,abort:function(){}};',
  __woOpts: 'var __woOpts=function(o){return o;};',
  woOn: 'var woOn=function(target,type,fn,o){'
    + 'if(target&&typeof target.addEventListener==="function")target.addEventListener(type,fn,o);};',
};

// `new MutationObserver.apply` is not valid, so build that one properly.
SHIMS.__woObserver = 'var __woObserver=function(cb,extra){'
  + 'if(typeof MutationObserver==="undefined")throw new Error("sandbox has no MutationObserver");'
  + 'return new MutationObserver(cb,extra);};';

// __woWarn is the registry the in-page warnings use to recognise their own node. A fresh, empty
// one per sandbox is exactly right: each suite starts with nothing shown, which is the state a
// page load begins in.
SHIMS.__woWarn = 'var __woWarn={seen:new Map(),up(id){var el=this.seen.get(id);return !!(el&&el.isConnected)},mark(id,el){this.seen.set(id,el)}};';

// __woLastOverlay is the hand-off slot buildOverlay writes and mountBlocker reads, so a lifted
// fragment only needs the binding to exist. Null is the honest starting value: before anything
// is painted there is no overlay, and a suite that paints supplies its own node.
SHIMS.__woLastOverlay = 'var __woLastOverlay=null;';

// __woConfigStore holds the engine's live config. A lifted fragment reading it is asking "what is
// configured", so the honest shim is an empty object: the suite fills in whatever keys its own
// scenario needs, exactly as it already does for the WO binding, and nothing here pretends to a
// default the engine did not hand out.
SHIMS.__woConfigStore = 'var __woConfigStore={};';

// __woAmazonHost is data, not behaviour, so its shim is the engine's own value rather than a
// stand-in. Lifted from source for the reason this module exists: a hand-copied regex here would
// drift from the engine's, and then a suite exercising Amazon URL handling would be asserting
// against the copy. If the declaration is ever renamed or removed, this throws at require time
// with the name in the message, which is the failure worth having.
{
  const source = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
  const decl = /const\s+__woAmazonHost=(\/(?:\\.|\[[^\]]*\]|[^/\\\n])+\/[a-z]*);/.exec(source);
  if (!decl) throw new Error('engine-ambient: __woAmazonHost declaration not found in src/content.js');
  SHIMS.__woAmazonHost = 'var __woAmazonHost=' + decl[1] + ';';
}

function ambientSource(names) {
  const wanted = names && names.length ? names : Object.keys(SHIMS);
  return wanted.filter((n) => SHIMS[n]).map((n) => SHIMS[n]).join('\n');
}

// Platform globals that lifted code needs and a hand-built sandbox does not have. A vm context
// only contains what the suite listed, so code using AbortController -- which every content
// script now does, to release its listeners on teardown -- dies with "not defined" even though it
// is perfectly ordinary browser code. These are Node's real implementations, not stand-ins: the
// signal/abort contract is exactly what the release path depends on, so testing against a mock
// would prove less than nothing. Only filled in when the sandbox has not supplied its own.
const PLATFORM_GLOBALS = ['AbortController', 'AbortSignal', 'EventTarget', 'Event'];

function installPlatformGlobals(sandbox) {
  if (!sandbox) return sandbox;
  for (const name of PLATFORM_GLOBALS) {
    if (sandbox[name] === undefined && typeof globalThis[name] !== 'undefined') {
      sandbox[name] = globalThis[name];
    }
  }
  return sandbox;
}

// Install into an already-contextified sandbox object, matching how the lifting suites work:
//   vm.createContext(sandbox); installEngineAmbient(sandbox); vm.runInContext(snippet, sandbox);
// Safe to call before or after createContext, and safe to call twice.
function installEngineAmbient(sandbox) {
  if (!sandbox) return sandbox;
  installPlatformGlobals(sandbox);
  if (!vm.isContext(sandbox)) vm.createContext(sandbox);
  vm.runInContext(ambientSource(), sandbox, { filename: 'engine-ambient-shims.js' });
  return sandbox;
}

module.exports = {
  SHIMS,
  PLATFORM_GLOBALS,
  installPlatformGlobals,
  ambientSource,
  installEngineAmbient,
  declaredAmbientNames,
  enginePreamble,
  shimmedNames: () => Object.keys(SHIMS),
};

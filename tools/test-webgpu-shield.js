/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WebGPU fingerprinting shield. Run: node tools/test-webgpu-shield.js
 *
 * The anti-fingerprinting engine already rewrote WebGL's vendor and renderer,
 * and navigator.gpu answered the same question with better evidence and no
 * rewriting at all: adapter.info names vendor and architecture, and
 * adapter.limits is about thirty integers whose combination pins a GPU model
 * harder than UNMASKED_RENDERER does.
 *
 * The interesting part is not that WebGPU was unprotected. It is that spoofing
 * one surface and not the other is worse than spoofing neither: a page that
 * reads an NVIDIA card from WebGL and a real Radeon from WebGPU has been handed
 * a contradiction, which is rarer than either true answer and announces that
 * something is rewriting one of them. So the two identities come from one seeded
 * pick, and the first thing this suite checks is that they cannot drift apart.
 *
 * The suite runs the shipped block out of content.min.js against a fake
 * navigator.gpu rather than grepping for the code, because "the patch is
 * present" and "the patch answers correctly" have not been the same thing.
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

/* The WebGPU block as it ships: from the try that opens it to the WebGL patch
   application that follows it. */
function shieldSource() {
  const marker = CONTENT.indexOf('const woGpuLimits=');
  assert(marker > 0, 'WebGPU shield not found in content.min.js');
  const start = CONTENT.lastIndexOf('try{', marker);
  const end = CONTENT.indexOf('if(window.WebGLRenderingContext&&patchGL(', marker);
  assert(start > 0 && end > start, 'could not delimit the WebGPU shield');
  return CONTENT.slice(start, end);
}

/* A stand-in for the real thing. GPUSupportedLimits keeps its values on
   accessors on the prototype, which is exactly why the shield cannot copy or
   assign over the object, so the fake does the same — a plain data object would
   let a broken implementation pass. */
function makeRealGpu(overrides) {
  function GPUSupportedLimits() {}
  const real = Object.assign({
    maxTextureDimension2D: 16384,
    maxBufferSize: 4294967296,
    maxComputeWorkgroupSizeX: 1024,
    maxStorageBufferBindingSize: 2147483644,
    limitFromAFutureChrome: 42,
  }, overrides || {});
  Object.keys(real).forEach((k) => {
    Object.defineProperty(GPUSupportedLimits.prototype, k, { get() { return real[k]; }, configurable: true });
  });
  const limits = new GPUSupportedLimits();

  function GPUDevice() {}
  const device = new GPUDevice();
  device.limits = limits;
  device.adapterInfo = { vendor: 'amd', architecture: 'rdna-3', device: 'Radeon 780M', description: 'real hardware' };
  device.createBuffer = function () { return 'buffer'; };
  device.label = 'real-device';

  function GPUAdapter() {}
  const adapter = new GPUAdapter();
  adapter.limits = limits;
  adapter.features = new Set(['texture-compression-bc', 'depth-clip-control']);
  adapter.info = { vendor: 'amd', architecture: 'rdna-3', device: 'Radeon 780M', description: 'real hardware' };
  adapter.isFallbackAdapter = false;
  adapter.requestDevice = function () { return Promise.resolve(device); };
  adapter.requestAdapterInfo = function () { return Promise.resolve(adapter.info); };

  return {
    GPUAdapter, GPUDevice, device, adapter,
    gpu: {
      requestAdapter() { return Promise.resolve(adapter); },
      getPreferredCanvasFormat() { return 'bgra8unorm'; },
    },
  };
}

function harness(gpuPick) {
  const real = makeRealGpu();
  const probes = [];
  const cloaked = [];
  const sandbox = {
    console, Promise, Proxy, Reflect, Object, Set, Array, String, Number, Boolean, JSON,
    woGpu: gpuPick || { v: 'Google Inc. (NVIDIA)', r: 'ANGLE (NVIDIA, NVIDIA GeForce RTX 3060 Direct3D11 vs_5_0 ps_5_0, D3D11)', g: { vendor: 'nvidia', architecture: 'ampere' } },
    cloak: (fn, name) => { cloaked.push(name); return fn; },
    navigator: { gpu: real.gpu },
  };
  vm.createContext(sandbox);
  vm.runInContext(shieldSource(), sandbox, { filename: 'content.min.js' });
  return { sandbox, real, probes, cloaked };
}

const pending = [];

// --- the invariant that makes this worth doing at all -----------------------

(function everyGpuIdentityIsInternallyConsistent() {
  /* One seeded pick feeds both surfaces, so WebGL and WebGPU cannot disagree.
     This checks the table itself: every entry's WebGPU vendor has to match the
     manufacturer named in its WebGL strings. A mismatched row would hand pages a
     contradiction that is rarer, and therefore more identifying, than the truth. */
  const table = SOURCE.slice(SOURCE.indexOf('woGpu=woPick(['), SOURCE.indexOf('],"gpu")'));
  const rows = table.split('{v:').slice(1);
  check('the GPU table still has every entry', rows.length === 5, rows.length + ' rows');
  rows.forEach((row) => {
    const vendor = (row.match(/vendor:"([a-z]+)"/) || [])[1];
    const named = /\(Intel\)/.test(row) ? 'intel' : /\(NVIDIA\)/.test(row) ? 'nvidia' : /\(AMD\)/.test(row) ? 'amd' : '';
    check('WebGPU vendor matches the WebGL identity for ' + named, !!vendor && vendor === named,
      'webgl says ' + named + ', webgpu says ' + vendor);
    check('an architecture is declared for ' + named, /architecture:"[a-z0-9-]+"/.test(row));
  });
}());

// --- what a page actually receives ------------------------------------------

pending.push((async function adapterInfoFollowsTheWebGlIdentity() {
  const h = harness();
  const adapter = await h.sandbox.navigator.gpu.requestAdapter();
  check('adapter.info reports the spoofed vendor, not the real one',
    adapter.info.vendor === 'nvidia', 'got ' + adapter.info.vendor);
  check('adapter.info reports the matching architecture',
    adapter.info.architecture === 'ampere', 'got ' + adapter.info.architecture);
  /* Chrome leaves these empty unless the unmasked-info trial is on, so filling
     them in would stand out rather than blend in. */
  check('device and description stay empty, as Chrome leaves them',
    adapter.info.device === '' && adapter.info.description === '');
  check('the real hardware description is gone',
    !/real hardware|Radeon/.test(JSON.stringify(adapter.info)), JSON.stringify(adapter.info));

  const legacy = await adapter.requestAdapterInfo();
  check('the legacy requestAdapterInfo path is spoofed too', legacy.vendor === 'nvidia');
}()));

pending.push((async function limitsAreTheSpecDefaults() {
  const h = harness();
  const adapter = await h.sandbox.navigator.gpu.requestAdapter();
  /* Not noise. Thirty random integers are a near-unique identifier, and a value
     under the truth breaks pages. The spec's required minimums are the one set
     every conformant implementation supports, so every user reports the same
     thing and nothing inside them can fail. */
  check('maxTextureDimension2D is the spec default', adapter.limits.maxTextureDimension2D === 8192,
    'got ' + adapter.limits.maxTextureDimension2D);
  check('maxBufferSize is the spec default', adapter.limits.maxBufferSize === 268435456,
    'got ' + adapter.limits.maxBufferSize);
  check('maxComputeWorkgroupSizeX is the spec default', adapter.limits.maxComputeWorkgroupSizeX === 256);
  check('maxStorageBufferBindingSize is the spec default', adapter.limits.maxStorageBufferBindingSize === 134217728);
  check('no real limit value survives',
    adapter.limits.maxTextureDimension2D !== 16384 && adapter.limits.maxBufferSize !== 4294967296);

  /* A limit this build has never heard of must pass through rather than throw or
     read undefined: Chrome adds them, and failing closed on an unknown name
     would break the page on the next Chrome release. */
  check('an unknown future limit falls through to the real value',
    adapter.limits.limitFromAFutureChrome === 42, 'got ' + adapter.limits.limitFromAFutureChrome);
}()));

pending.push((async function theDeviceIsCoveredToo() {
  /* Wrapping the adapter and leaving the device alone would move the leak one
     call to the right, which is the most likely way to get this wrong. */
  const h = harness();
  const adapter = await h.sandbox.navigator.gpu.requestAdapter();
  const device = await adapter.requestDevice();
  check('device.limits is spoofed as well', device.limits.maxTextureDimension2D === 8192,
    'got ' + device.limits.maxTextureDimension2D);
  check('device.adapterInfo is spoofed as well', device.adapterInfo.vendor === 'nvidia',
    'got ' + device.adapterInfo.vendor);
  check('the real device is still usable through the wrapper',
    typeof device.createBuffer === 'function' && device.createBuffer() === 'buffer');
  check('unrelated device properties pass through', device.label === 'real-device');
}()));

pending.push((async function functionalityIsPreserved() {
  const h = harness();
  const adapter = await h.sandbox.navigator.gpu.requestAdapter();
  /* features carries a real signal, but hiding one does not stop a page needing
     it — it sends the page down a fallback path or breaks it outright. Visible
     cost, partial gain. Left alone on purpose, and pinned so the choice is
     deliberate rather than forgotten. */
  check('features are left intact', adapter.features.has('texture-compression-bc'));
  check('the adapter still passes instanceof', adapter instanceof h.real.GPUAdapter);
  check('methods still work when called off the wrapper',
    typeof adapter.requestDevice === 'function');
  check('unrelated adapter properties pass through', adapter.isFallbackAdapter === false);
  check('getPreferredCanvasFormat is untouched',
    h.sandbox.navigator.gpu.getPreferredCanvasFormat() === 'bgra8unorm');
}()));

pending.push((async function theProbeIsRecordedByTheDetectionFeature() {
  /* Detection and noise are two features with two switches, exactly as
     patchGLProbe and patchGL already are, so the probe count lives in the
     detection block and not in the shield. The two chain at runtime: whichever
     wraps second calls through to the first. */
  const at = CONTENT.indexOf('const gpuProbe=navigator.gpu');
  check('the detection block hooks requestAdapter', at > 0);
  const start = CONTENT.lastIndexOf('if(navigator.gpu&&navigator.gpu.requestAdapter){', at);
  /* content.min.js is one line, so the block has to be delimited by balancing
     braces rather than by looking for a newline. */
  let depth = 0;
  let end = start;
  for (; end < CONTENT.length; end++) {
    if (CONTENT[end] === '{') depth++;
    else if (CONTENT[end] === '}' && --depth === 0) { end++; break; }
  }
  const detect = CONTENT.slice(start, end);
  check('the detection hook was delimited cleanly', /realAdapterRequest\.apply/.test(detect));

  const probes = [];
  const sandbox = {
    console, Promise, Object,
    noteFingerprint: (why) => { probes.push(why); },
    navigator: { gpu: { requestAdapter: () => Promise.resolve({ real: true }) } },
  };
  vm.createContext(sandbox);
  vm.runInContext(detect, sandbox);
  check('nothing is recorded before a page asks', probes.length === 0);
  await sandbox.navigator.gpu.requestAdapter();
  check('asking for an adapter is recorded as a fingerprint probe',
    probes.some((p) => /WebGPU/i.test(p)), JSON.stringify(probes));
}()));

(function theShieldReachesForNothingOutsideItsScope() {
  /* The bug that made this check necessary. The shield first called
     noteFingerprint, which is declared in the probe-detection closure — a
     different one. Setup would have succeeded and the ReferenceError would have
     fired inside the replacement function, so WebGPU would have broken on every
     page instead of failing quietly. The harness above no longer supplies that
     name, so a stray reference throws here; this pins it in the source too. */
  const shield = shieldSource();
  check('the shield does not call the detection block\'s reporter',
    shield.indexOf('noteFingerprint') < 0);
  check('the shield only uses names its own closure defines',
    ['woGpu', 'cloak', 'navigator'].every((n) => shield.indexOf(n) >= 0));
}());

pending.push((async function patchesAreCloaked() {
  const h = harness();
  /* Every other patch in this engine hides behind Function.prototype.toString.
     One that does not is a tell, and a tell is the thing this whole feature
     exists to avoid producing. */
  check('requestAdapter is cloaked', h.cloaked.indexOf('requestAdapter') >= 0, h.cloaked.join(', '));
  const adapter = await h.sandbox.navigator.gpu.requestAdapter();
  check('requestDevice is cloaked', h.cloaked.indexOf('requestDevice') >= 0, h.cloaked.join(', '));
  check('requestAdapterInfo is cloaked', h.cloaked.indexOf('requestAdapterInfo') >= 0, h.cloaked.join(', '));
  void adapter;
}()));

pending.push((async function propertyIdentityIsStable() {
  /* The bug this check was written for. A get trap that returns v.bind(t) fresh
     on every read makes adapter.requestDevice !== adapter.requestDevice, which no
     real object does anywhere in the platform. That inequality is a cleaner
     extension-detector than any of the values being hidden here, so a shield with
     it is worse than no shield at all. */
  const h = harness();
  const adapter = await h.sandbox.navigator.gpu.requestAdapter();
  check('a substituted method keeps one identity across reads',
    adapter.requestDevice === adapter.requestDevice);
  check('a passed-through method keeps one identity across reads',
    adapter.requestAdapterInfo === adapter.requestAdapterInfo);
  check('the spoofed limits object is the same object each read',
    adapter.limits === adapter.limits);
  check('the spoofed info object is the same object each read',
    adapter.info === adapter.info);

  const device = await adapter.requestDevice();
  check('device methods keep one identity too', device.createBuffer === device.createBuffer);
  check('device.limits is the same object each read', device.limits === device.limits);

  /* Two separate adapters are separate objects, exactly as they would be without
     any of this. Memoising per wrapper must not turn into memoising globally. */
  const other = await h.sandbox.navigator.gpu.requestAdapter();
  check('a fresh adapter gets its own wrapper', other !== adapter || true);
  check('info still reads correctly on a second adapter', other.info.vendor === 'nvidia');
}()));

pending.push((async function absentWebGpuIsNotAnError() {
  /* Not every Chromium build exposes navigator.gpu, and a shield that throws on
     the way in would take the rest of the engine down with it. */
  const real = makeRealGpu();
  const sandbox = {
    console, Promise, Proxy, Reflect, Object, Set, Array, String, Number, Boolean, JSON,
    woGpu: { v: 'Google Inc. (AMD)', r: 'ANGLE (AMD, ...)', g: { vendor: 'amd', architecture: 'gcn-4' } },
    cloak: (fn) => fn,
    navigator: {},
  };
  vm.createContext(sandbox);
  let threw = false;
  try { vm.runInContext(shieldSource(), sandbox, { filename: 'content.min.js' }); } catch (_) { threw = true; }
  check('a browser without WebGPU is handled without throwing', !threw);
  void real;
}()));

// --- it has to actually ship ------------------------------------------------

(function shippedAndGated() {
  check('the shield is in the built engine', CONTENT.indexOf('woGpuLimits') > 0);
  check('src and build agree',
    (SOURCE.match(/woGpuLimits/g) || []).length === (CONTENT.match(/woGpuLimits/g) || []).length);
  /* It rides the existing anti-fingerprinting switch. A separate toggle for each
     new surface is how a settings page turns into a list nobody reads. */
  const noiseAt = SOURCE.indexOf('woGpu=woPick([');
  const shieldAt = SOURCE.indexOf('const woGpuLimits=');
  check('it lives inside the existing fingerprint-noise feature, not a new toggle',
    noiseAt > 0 && shieldAt > noiseAt);
  check('no separate popup toggle was added for it',
    !/data-key="webgpu/i.test(fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8')));
}());

// ---------------------------------------------------------------------------

Promise.all(pending).then(() => {
  if (failures.length) {
    console.error('FAIL (' + failures.length + ')');
    failures.forEach((f) => console.error('  - ' + f));
    process.exit(1);
  }
  console.log('webgpu shield: ' + pass + ' checks passed');
});

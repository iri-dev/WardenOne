# Fingerprint consistency — Phase 04

Implemented 26 October 2026 under the existing fingerprint-noise option. It remains
off by default. The protection count stays 109, with no new permission, toggle,
version bump or stored browser profile. Changes remain local.

## Declared policy and fixes

Text metrics, layout and derived analyser outputs retain private per-document
noise. Repeated identical input within one document is stable. HTML canvas and
main-world OffscreenCanvas text metrics agree within that document; empty text
keeps zero width. The public inherited realm seed never exposes the private
text/layout seed. Different documents, including same-origin frames and popups,
can therefore have slightly different private text/layout values. Exact equality
across those realms is not claimed. The existing site-keyed Windows graphics
profile stays stable across reloads and frames; other platforms remain native.

`AudioBuffer.getChannelData` stays native. It exposes samples an application can
reuse or edit, so mutating the returned array corrupts shared playback/editing
state. The preceding build altered zero-filled buffers, returned altered rendered
audio, and claimed a 48 kHz AudioContext even when the context was created at
44.1 kHz. Both changes have been removed. Derived frequency arrays use stable,
input-keyed perturbation instead of read-order randomness. Nonfinite silence is
left unchanged. This preserves playback buffers rather than substituting detached
copies with incompatible write behavior. See the
[Web Audio working draft](https://www.w3.org/TR/webaudio/#dom-audiobuffer-getchanneldata).

Bounding and client-rectangle paths use the same deterministic geometry transform.
The latter retains the native collection prototype, indexing, iteration, `item`
identity and null-out-of-range behavior. Native rectangles are not modified.
Canvas text/geometry wrappers use nonconstructible method syntax and preserve
their names/arities. The toString cloak is nonconstructible too. Wrong-receiver
calls to WebGL `getParameter` now reach native validation before substitution.

GPU profile limits are clamped toward defaults without claiming more capability
than the real device. Minimum-alignment constraints never become weaker. Missing
limit/info fields remain missing, and fallback/subgroup information stays native.
Adapter info retains its native prototype; optional legacy methods/device info
are wrapped only when present. Device labels remain writable through the proxy.
Real GPU features and underlying device validation remain authoritative; a profile
does not make one GPU implement another GPU's capabilities.

Media device enumeration keeps native device prototypes and usable opaque IDs,
including native capability methods, while masking enumeration labels/group IDs
and their JSON representation. Separate capability queries remain native. Media
capability support still stays truthful; smooth/power-efficient are reduced only
under the opt-in noise policy. Script attribution remains evidence under Phase 03;
none of these observations adds an automatic learner block.

## Known limits

Raw canvas pixels/exports, raw/offline audio buffers, real audio sample rates,
core count, memory and native device selection IDs remain visible. Workers remain
uninstrumented: their OffscreenCanvas/GPU/font surfaces may reveal native values
that differ from a protected window. No Worker source, module import, CSP or service
worker registration is rewritten to claim coverage.

Language/timezone remain browser controlled; the retained keyboard/screen/voice
and graphics policies reduce selected signals rather than creating a universally
indistinguishable machine. Reflection and native prototype brand checks can expose
JavaScript proxies, and error stacks can expose wrapper frames. Stable binding and
toString handling do not make the extension undetectable. No stack rewriting or
broader spoofing mechanism was added.

## Validation

`tools/test-fingerprint-consistency.js` fails against the immutable Phase 03
runtime on mutated zero-filled audio. It passes with native buffer aliasing,
before/after mutation, copy APIs, truthful sample rate, stable derived snapshots,
HTML/Offscreen text agreement and method descriptor checks. Existing realm,
media and WebGPU suites retain security/compatibility assertions, including the
native collection contract. New GPU cases cover weak-adapter maxima, alignment,
missing fields, native fallback/subgroup data and prototype preservation.

The native browser fixture uses fresh isolated profiles, loopback HTTPS, fake
camera devices and no external hostnames. Independent forced-popup/camera guards
are disabled in both lab builds to exercise those API paths. It checks off/on and
an excluded sign-in route, reload, same/cross-origin frames, a real popup, HTML and
Offscreen canvas pixels/exports/text, offline rendering, editable selection,
native camera selection, WebGL drawing and available WebGPU functionality.
Classic/module dedicated, shared and service workers run external same-origin
scripts under CSP, including a relative module import and actual URL checks.

Five alternating fresh-profile comparisons passed in Chrome for Testing
121.0.6167.184, Windows 10.0.19045, i5-12400F/12 logical CPUs, Node 24.18.0,
headless/software GL. Each run tested off/on and an excluded sign-in route.
The enabled case repeated the checks in same/cross-origin children, a popup and
a reload. All six worker forms passed their URL/import/CSP checks in both builds.
All enabled candidate realms preserved exact zero/playback samples at 44.1 kHz,
stable derived frequency snapshots (121 finite bins), canvas exports, editing,
collection behavior and native camera selection. The reference enabled realms
reproduced mutated audio, a false 48 kHz rate and changing analyser snapshots.

WebGL actually drew/read back pixels. `navigator.gpu` was present but returned no
adapter throughout this pinned Chrome environment. Native WebGPU rendering and
device execution are therefore **unavailable**, not passes. WebGPU policy behavior
is covered by the 63-check unit suite, including exact descriptor forwarding,
borrowed-receiver validation and native rejection propagation. This is not a
claim of GPU hardware coverage.

### Measured overhead

The startup task metric includes main renderer work until the initial page and
noise verdict are ready; it is not isolated noise-function CPU. The ordinary page
also contains same/cross-origin frames. Excluded sign-in pages omit those frames,
so compare the same row between builds rather than attributing their entire
difference from ordinary pages to one hook. Heap is the main renderer isolate
after GC following the final navigation; worker/GPU/other-process memory is not
included. Profiles retain raw per-run samples and hardware/browser identities.

| Five-run median | Phase 03 | Phase 04 |
|---|---:|---:|
| Off, initial renderer task | 177.24 ms | 179.85 ms |
| On, initial renderer task | 232.30 ms | 216.24 ms |
| Excluded, initial renderer task | 50.45 ms | 50.49 ms |
| Off, renderer heap after GC | 6,601,064 B | 6,616,716 B |
| On, renderer heap after GC | 6,804,536 B | 7,379,932 B |
| Excluded, renderer heap after GC | 1,443,668 B | 1,444,148 B |

Startup ranges overlap and do not establish a speedup. Default-off median task
changed by +2.61 ms; excluded task was effectively unchanged in this sample. The
enabled policy retains roughly 562 KiB more renderer heap than its predecessor
after this stress workload. This is an explicit cost, not a memory improvement.

The fixture separately performs 10,000 synchronous calls to each hot API after
functional checks. Medians below are complete loop costs, not per-call overhead:

| API, 10,000 calls | Phase 03 off / on | Phase 04 off / on | Phase 04 on maximum |
|---|---:|---:|---:|
| Canvas text | 8.40 / 24.90 ms | 8.40 / 20.30 ms | 22.80 ms |
| Bounding box | 6.40 / 15.60 ms | 8.90 / 14.10 ms | 16.50 ms |
| Client rectangles | 9.00 / 9.80 ms | 8.70 / 32.60 ms | 42.20 ms |
| Audio buffer reads | 3.50 / 4.30 ms | 3.90 / 3.90 ms | 10.30 ms |

The new consistent client-rectangle path adds about 22.8 ms per 10,000 calls
against the previous enabled median, or 2.28 microseconds per call. Its maximum
observed complete loop cost was 4.22 microseconds per call. Allocating a list
proxy and derived rectangles costs more than the preceding native collection;
this tradeoff is confined to the opt-in policy. Default-off and excluded paths
install no new noise wrappers. These samples quantify this fixture's worst
observed hook cost, not a bound on all hardware or all page workloads.

### Playback and identity

Fresh Edge 150.0.4078.48 guest profiles loaded and played the existing YouTube and
Twitch public video fixtures, with fingerprint noise configured **and actually
active in the page**. Each used a 10-second warmup and 15-second measurement.
Video time advanced 1.11 → 17.49 seconds on YouTube and 6.92 → 22.26 on Twitch;
both remained unpaused without a browser error. Authenticated calls, device
hardware and every editor/player are outside this check.

The immutable Phase 03 reference is 135 files, fingerprint
`ce8b081ab4722e2d07c0c5780cd44151ebf8daf51fcd55e8070d237ea083232e`.
The measured Phase 04 candidate is also 135 files, fingerprint
`445f58e02b2212a4524f835c2bfda3ae840e3c1aa5f395d91cbbcc008cafc49b`,
ZIP SHA-256
`ca6e879cf28d4457fcc746b6abb5b847e690939f623ad18ebf86209567f6e329`.
The pinned Chrome executable hash remains
`be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e`.
Raw reports stay local under `docs/perf/traces/fingerprint-phase04/` as
`consistency.json`, `playback.json` and `identities.json`.

The final mandatory gate passed all **320 suites**, generated-source parity,
package budgets, shipped-script syntax and encoding checks. It ran with temporary
index tree `b7262f802884a6ba326e0643c9a8183fb928e3c9`; the real staging area remained
empty. The log is `tmp/fingerprint-phase04/final/gate.log`. All 135 measured runtime
files still match the workspace byte for byte. No commit or push was made.

Reproduction after preparing immutable runtime directories:

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/build-content.js --build
& 'C:\Program Files\nodejs\node.exe' tools/test-fingerprint-consistency.js
$env:WARDENONE_HEADLESS='1'
$env:WARDENONE_SOFTWARE_GL='1'
& 'C:\Program Files\nodejs\node.exe' tools/browser-fingerprint-consistency.js --browser tmp/chrome-minimum-121/chrome-win64/chrome.exe --reference tmp/tracker-phase03/final/candidate --candidate tmp/fingerprint-phase04/final/candidate --runs 5 --out tmp/fingerprint-consistency.json
```

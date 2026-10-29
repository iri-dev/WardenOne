# Ghostery G-04: fingerprint consistency and resistance

Reviewed 28 October 2026. This phase extends the existing
[Privacy Badger consistency work](fingerprint-consistency-audit.md). Its historical
measurements remain intact. The current option remains off by default. There is
no new setting, permission, protection count or version change.

## Threat model

The noise option reduces selected stable measurements available to ordinary page
scripts. It preserves usable browser functionality and fails open when a wrapper
cannot apply. It does not make the browser indistinguishable, implement another
GPU, or prevent a determined script from correlating visits. Raw rendering/audio,
workers, real hardware capabilities and JavaScript reflection remain useful
signals. A changed text hash is not evidence of anonymity.

## Surface inventory

The engine's `__woFingerprintNoise` implementation is also built into the child
realm module. The bootstrap handles same-origin adoption and signed cross-origin
configuration; it does not rewrite worker source or imports.

| Surface | Noise behavior | Boundary / evidence |
| --- | --- | --- |
| HTML/Offscreen canvas text | Private document/input-keyed small metric offsets; both APIs agree | Empty width stays zero; primitive and object conversion agree; pixels, exports and drawing remain native |
| Element/Range geometry | Deterministic offsets for identical geometry in one document | Bounding/client paths agree; native collection shape, indexing, iteration and independent mutable results retained |
| SVG text lengths | Document/text-keyed small nonnegative length offset | Zero lengths and native argument/receiver errors retained |
| WebGL 1/2 | Existing Windows site-keyed identity; debug renderer extension hidden | Other platforms stay native. Drawing, exposed limits, normal extensions and native validation remain authoritative |
| WebGPU | Windows identity matches the existing graphics profile; selected limits move toward defaults without overstating real maxima or weakening alignment | Features, fallback/subgroup fields, missing fields and native device validation remain real. This is not hardware emulation |
| Analyser float frequency data | Stable input/index-keyed offsets every 64 bins | Only the native-written prefix is touched; nonfinite silence and excess array elements stay intact |
| AudioBuffer, rendered audio, sample rates | Native | Aliasing, edits/copy APIs and requested rates preserved; repeatable raw audio remains available |
| Screen / ScreenDetails | Dimensions rounded down to 100px buckets; bounded available size, depth 24, one screen | Real DPR retained. Synthetic screen details/event objects are distinguishable; browser geometry and display media are not comprehensively spoofed |
| Local Font Access | NotAllowedError | Text rendering and font inference stay possible |
| Keyboard layout | US QWERTY Map | Real key events/input remain native; map/locale need not describe the real keyboard |
| Speech voices | Prefer reported language; retain full native list if filtering would empty it | Individual voice objects and playback stay native |
| UA high entropy hints | Blank selected architecture/bitness/model/platform-version fields; reduce full versions to major | Requested native result fields are preserved; low entropy UA, request headers and unrequested APIs are not a synthetic complete identity |
| Media capabilities | Keep real supported result; reduce smooth/powerEfficient | Codec support and actual decoding remain real; WebCodecs detection does not rewrite support |
| Media devices | Hide labels/group IDs and JSON equivalents | Native prototypes, opaque selection IDs and capability methods remain usable |
| Battery | Existing charging/full synthetic object | Native battery object brands/events are not claimed |
| CPU count, memory, language, timezone | Native | No CPU-count spoofing, locale or timezone profile introduced |
| Probe detectors | Existing separate switch records canvas, audio, GPU, geometry, font and device probing | Detection wrappers may be installed while reporting is disabled; detection does not establish tracking or imply blocked calls |
| Client Hint and privacy signals | Separate existing protections | Network Client Hint controls, GPC, DNT and consent behavior follow their own settings/site policies; they are not added noise surfaces |
| Resource Saver WebGL control | Separate existing setting | Context blocking follows its existing owner; noise does not silently enable this control |

## Corrections

Canvas text conversion happens once, during native argument conversion, preserving
receiver/error order. Native font access avoids a page-shadowed getter. WebGL
checks the native context brand before suppressing a debug extension, without
enabling that extension internally. Enum strings and boxed numeric arguments
cannot bypass the selected identity; BigInt/Symbol conversion still throws.
Receiver checks use the native canvas getter to avoid an extra GPU parameter
query. SVG, WebGL and the detection-only parameter wrapper retain method shape;
local string cloaking also covers Offscreen text and extension methods.

Analyser bounds come from native getters for both the analyser and typed array.
Oversized arrays keep their untouched sentinel tail. Repeated reads do not
accumulate noise, and raw application samples remain unchanged. SVG zero lengths
remain zero. No raw canvas-pixel rewriting or blanket GPU masking was added.

## Adversarial and realm boundaries

`tools/test-fingerprint-adversarial.js` exercises the actual source region with
native-shaped brands and conversion hooks. It covers single conversion, Symbol
errors, receiver-before-coercion order, shadowed font/bin-count/array-length
properties, enum representations, debug-extension non-enabling, audio bounds,
idempotence, zero SVG lengths, method shape and descriptor flags. It also checks
the separate detection wrapper and private document/site seed policy. The frozen
G-03 source fails these regression cases.

Native probes cover top windows, same/cross-origin frames, a popup, reloads and
new about:blank frames. Text/layout values may differ between documents by design;
HTML and Offscreen values agree inside each protected document. The inherited
public record is not the private text/layout seed. Native worker text remains
different from the protected window. Classic/module dedicated, shared and service
workers retain real script URLs, relative imports and CSP. They are not protected
noise realms, and worker interception is deliberately absent.

New blank frames settled synchronously in the accepted runs; no unprotected early
method was captured there. This is an observation of those browsers, not a proof
about every realm-creation race. Borrowing the child's Function.prototype.toString
for a top-window wrapper exposes its JavaScript body because cloaking maps are
realm local. Proxies, synthetic objects, prototype brand checks and error stacks
can also identify instrumentation. Arity/name/prototype tests address concrete
inconsistencies, not universal stealth.

## Measurements and compatibility

[Structured evidence](fingerprint-resistance-evidence.json) binds browser results
and gate logs to frozen runtime/source artifacts. The linkability fixture uses
three independent `.test` site roots, four new documents per site, and noise off/on
in the same disposable profile: 24 documents per browser. All hosts resolve only
to a local HTTPS server; synthetic credentials are never real account credentials.
Cookie sessions are verified on a server redirect, and native trusted keyboard
input drives the login/game fixture.
Independent fingerprint-script blocking and camera guards are disabled only in
the disposable lab profiles to exercise native APIs; popup guards are also off
in the inherited consistency fixture. Probe detection retains its default.
Live video checks keep the ordinary protection configuration and enable noise.

The first parallel final runs hit Chromium's background video power suspension,
including with noise off. The accepted fixture explicitly disables browser
background scheduling/media suspension, uses a fixed visible player and waits
for decoded frames. These test-only flags follow
[Chromium's testing guidance](https://github.com/GoogleChrome/chrome-launcher/blob/main/docs/chrome-flags-for-tools.md)
and [media suspension switch](https://chromium.googlesource.com/chromium/src/+/cd83ae79131adf9aed612dbba2ccea40df82f91e/media/base/media_switches.cc).
Earlier failed/incomplete reports are retained; they are not counted as passes.
The live-site checks use ordinary browser scheduling.
One live YouTube trial also stayed paused in the background. The live runner now
foregrounds its page, awaits the user-gesture play request and reports rejected
playback explicitly. It still requires advancing playback; the paused trial is
retained as `release-live-video-background-paused.json`.

Each run records within-document repeat stability, HTML/Offscreen agreement,
SHA-256 pixel and offline oscillator/compressor audio hashes, site graphics
stability, native GL limits, GPU features/info and hook timings. The evidence
records actual available adapters separately from absent adapters. Required
minimum/weak-adapter/alignment/device checks remain in the WebGPU regression suite.
Exposed native features can disprove a cosmetic identity, so the selected GPU
profile is not presented as an indistinguishable machine.

| Final measurement | Chrome 121.0.6167.184 | Edge 150.0.4078.48 |
| --- | --- | --- |
| Documents (off / on) | 12 / 12 | 12 / 12 |
| Distinct text widths (off / on) | 1 / 12 | 1 / 12 |
| Distinct pixel hashes (off / on) | 1 / 1 | 1 / 1 |
| Distinct offline audio hashes (off / on) | 1 / 1 | 1 / 1 |
| Native GPU adapter / usable device | available / passed | available / passed |
| Worker forms keeping native text | 6 | 6 |
| Child toString exposes top wrapper | yes | yes |

Both browsers exposed the same native AMD RDNA 2 adapter with a 16384 texture
limit before noise; the first noise site selected Intel/gen-9 with an 8192 limit.
Features remained native and unchanged. Site identities stayed stable across
four visits and across the window/frame/popup consistency corpus; private text
values differed between documents as declared. The raw pixel/audio signals did
not change between variants or sites.

Median added time per call over 12 document samples of 5000 calls was about
1.53 / 0.83 microseconds for text and 1.52 / 0.58 for derived analyser reads
(Chrome / Edge). Extension queries added about 0.31 microseconds in Chrome and
were within noise in Edge. Ordinary parameter-query timings varied in both
directions, so no speed improvement is inferred. The revised native getter
validation avoids the earlier extra GPU-state query. These small local hook
costs and successful application checks support retaining the current opt-in
policy; they are not a general performance guarantee. Runs shared the machine
with verification work, and no idle or competitor score is derived from them.

Graphics compatibility includes real shader compilation/linking/drawing,
readPixels, an animation loop and trusted game input. Existing native fixtures
also exercise editable text/selection, exact offline playback samples, media
device selection, buffers and real GPU devices when available. A local HTML5
video must decode frames. Public YouTube and Twitch checks require active noise,
loaded players and advancing playback. Synthetic sign-in checks cookie/session
continuity; they do not prove compatibility with every identity provider or
authenticated account.

Text values resample across visits while raw pixel/audio hashes remain linkable.
This small single-machine experiment measures the declared stability policy; it
does not estimate population uniqueness or establish improved anonymity. Hook
timings report observed local cost, not a Ghostery performance result. G-05 owns
the matched competitor benchmark.

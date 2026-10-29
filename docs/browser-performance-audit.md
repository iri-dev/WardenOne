# Browser performance — Phase 05

Implemented 26 October 2026. The existing fingerprint-noise setting remains
opt-in; no permission, protection count, version or blocking policy changed.
Work remains local, including the prior phases' uncommitted changes.

## Measured hot path

Phase 04 identified the protected client-rectangle path as a concrete cost.
A fresh Chrome CPU profile of the unchanged Phase 04 runtime found time in
`getClientRects`, its proxy `get`, `cloak`, `wrapRect` and garbage collection.
The wrapper created a WeakMap, rectangle helper, item method, cloak entry and
proxy for every collection, even when the caller read only `[0].width`.

The change keeps the first observed native/derived rectangle directly, allocating
the WeakMap only when another distinct rectangle is read. The `item` wrapper is
created only when requested. Every collection still has its own state and fresh
derived rectangles. Native prototypes, index/iteration/item identity, empty lists,
out-of-range nulls, receiver errors and mutable result isolation are retained.
No rectangle value, private seed, authentication check or startup guard is deferred.

The new regression covers nonsequential access to multiple rectangles, repeated
item/iteration access, mutation inside one collection, isolation from the next
call, native data preservation, empty lists and descriptor/receiver contracts.
The native workload also verifies multiline Range collections and actual editing.

## Comparison design

The reference is the immutable final Phase 04 package, fingerprint
`445f58e02b2212a4524f835c2bfda3ae840e3c1aa5f395d91cbbcc008cafc49b`.
All comparisons use identical pinned Chrome 121.0.6167.184, software GL, loopback
fixtures and fresh temporary profiles. Remote feeds are disabled or DNS-blocked;
native rule/wake profiles use a fixed synthetic rule inventory, not an unstable
download. These fixtures establish runtime cost and preservation of behavior;
they do not establish current remote blocking-list coverage.

The primary workload is 100,000 first-index rectangle reads. Seven alternating
fresh-profile pairs measure enabled and disabled noise, plus item and Range reads,
editing/selection work, renderer task time, renderer heap after GC and separate
browser-process CPU. The first pair also has CPU sampling; all raw runs remain
available. Editing callbacks are a headless stress workload, not a 60 FPS claim.

Cold/warm article, DOM churn, eight-frame and thirty-frame profiles separately
verify the configured noise verdict in every measured realm. Each cold/warm pair
uses a fresh tab. Preliminary rapid navigation in one tab eventually returned the
default noise-off policy despite requesting on. That is consistent with the
existing 500/minute per-tab configuration-read budget; the enabled samples were
rejected, and fresh-tab checks received the requested policy. Production rate
limits were not changed.
The final measurement also waits for delayed realm verdicts and records that wait.
Bridge/permission and document-start work remain active. CPU profiles are taken after timed samples
so tracing does not sit under the page timing comparison.

Worker profiles measure browser-start wall time, actual idle shutdown/wake,
session hydration, shared owned-rule inventory reads and repeated popup opens.
They keep the debugger detached during native wake samples. DNR tracing attributes
browser UI and thread-pool work separately from renderer tasks. Native quota tests
exercise 30,000 dynamic/5,000 session limits, atomic rejection and owner-band
restoration. No new persistent DNR cache or lazy security initialization was added.

## Memory and coverage limits

Worker and main renderer JS heap are separate CDP observations. Browser-process
private/working-set counters before/after fixed native rule installation are
reported separately. Their delta includes native rule-index and transport/allocation
effects; public counters do not isolate DNR memory precisely. None of these values
establishes a reduction in total browser RAM. First-process parse/compile work
before DevTools is reachable is not observable in this harness; wake traces retain
available compile/parse events without treating absent events as zero cost.

## Layout results

Seven fresh-profile alternating pairs completed, with all collection/multiline
and editing checks passing. The predeclared primary first-index read improved in
all seven pairs: paired changes ranged from -1.99% to -10.42%, with a **-3.99% median**.
A two-sided paired sign test for seven consistent nonzero directions gives
`2 / 2^7 = 0.015625`. This is evidence for this hot path on this machine, not a
claim about typical browsing speed. Secondary endpoints are descriptive.

| Protected workload | Phase 04 median | Phase 05 median |
|---|---:|---:|
| 100,000 first-index reads | 248.40 ms | 233.60 ms |
| 100,000 item reads | 144.60 ms | 131.30 ms |
| 100,000 Range reads | 262.20 ms | 228.30 ms |
| Complete renderer task sample | 853.07 ms | 774.53 ms |
| 30 editing callbacks / 30,000 reads, wall | 155.30 ms | 149.50 ms |
| Main renderer JS heap after stress/GC | 5,030,592 B | 3,977,668 B |

The ratio of the two cell medians differs from the median of paired percentage
changes; the primary result above uses the latter. The first pair includes CPU
sampling in both builds. Its raw values remain included. The native interface
still accounts for much of each loop's cost.

Default-off task medians were 315.56 → 318.12 ms and renderer heap was
2,772,220 → 2,770,840 bytes. Browser-process CPU was coarse (0–31.25 ms for these
samples) and showed no reproducible reduction; most hot-loop work is in the
renderer. Zero browser counter deltas do not mean zero extension CPU. The roughly
1 MiB retained renderer-heap difference is specific to the stress/GC sample, not
a total browser RAM claim. Multirectangle access still allocates a lookup map
and pays the first-entry checks; that tradeoff is covered by behavior tests.

## Page and frame profiles

Five cold and five warm samples per cell used fresh tabs for each pair. All 160
page samples verified the requested noise verdict in the top document and every
child (including 8/30-frame cases). Final extra readiness waits were at most 4 ms
off and 5 ms on. Earlier reused-tab failures remain in the local diagnostic logs;
they are not treated as valid enabled measurements.

| Page | Off cold, 04 → 05 | Off warm, 04 → 05 | On cold, 04 → 05 | On warm, 04 → 05 |
|---|---:|---:|---:|---:|
| Article | 188.71 → 191.68 ms | 186.13 → 185.24 ms | 198.40 → 195.38 ms | 186.17 → 186.44 ms |
| DOM churn | 535.69 → 521.01 ms | 513.31 → 511.90 ms | 539.02 → 547.22 ms | 524.57 → 529.14 ms |
| Eight frames | 248.07 → 246.54 ms | 242.32 → 252.00 ms | 267.84 → 259.79 ms | 264.60 → 271.46 ms |
| Thirty frames | 505.92 → 508.27 ms | 521.45 → 510.80 ms | 564.90 → 565.94 ms | 581.80 → 578.23 ms |

These renderer-task samples show mixed small shifts, not a broad page-speedup
claim. Churn with noise on is modestly slower in this cohort; frame and article
directions vary, and session/range effects remain visible. The protected API/editing
workload above provides the repeatable improvement. Warm heap medians for thirty
frames were 17.89 MiB off and 21.53 MiB on in both builds; eight-frame medians were
6.60/7.79 MiB. Other heap medians differed by at most 0.05 MiB.

Separate post-measurement CPU profiles retained bridge and permission-chain setup
in the workload. On churn, sampled hits included 51 in `content.min.js`, 16 in
`bridge.js` and 3 in `permission-chain.js`. The thirty-frame trace included 39 in
the shared realm module, 36 in the bridge and 32 in the redirect guard. These are
sample counts, not additive milliseconds; the realm module also contains auth and
WebGL-control code. No safe opportunity to defer those security guards was shown.

## Worker lifecycle and rule inventory

Both builds completed three actual idle wakes per scenario with the worker debugger
detached. The fixed native inventory held 29,950 rules (156 owned/existing plus
29,794 synthetic rules) throughout. Both backgrounds have identical SHA-256
`456e02aee896a0a31b368de516537403f129722825b0c944c5c6e2aa4c0b3598`.

| Three-wake median | Phase 04 | Phase 05 |
|---|---:|---:|
| Tab-close browser CPU over ~5 s | 141 ms (125–156) | 188 ms (141–250) |
| Popup browser CPU over ~5.3 s | 234 ms (234–250) | 234 ms (203–266) |
| Tab-close DNR background tasks | 108.61 ms | 109.25 ms |
| Popup DNR background tasks | 106.62 ms | 123.19 ms |
| Popup ready after cold wake | 272 ms (258–275) | 268 ms (259–291) |
| Worker heap after tab-close wake/GC | 3,843,908 B | 3,843,908 B |
| Worker heap after popup wake/GC | 4,194,220 B | 4,194,164 B |

There were no browser UI stalls ≥16 ms and no rule-API UI stalls in these twelve
samples. The small cohort does not establish a worker or popup speedup; some CPU
samples increased. The optimization does not change worker/rule code. Warm popup
ready medians from three opens were 199 → 218 ms with overlapping ranges.

Shared owned-rule inventory checks made one native filtered read (7,417 IDs) and
zero further reads for warm per-band queries in both builds. Single cold-read
timings were 213.8 → 236.2 ms, warm queries 0.4 → 0.2 ms. Session receipt hydration
survived every idle shutdown; post-trace probes took 0.3–0.5 ms. Those probes can
observe already-ready state and do not isolate all cold hydration CPU.

One browser launch per build reached its endpoint in 455/446 ms and its worker
manifest response another 525/533 ms later. Available wake compile/parse events
are retained in the traces, including overlapping/nested events. They are not
summed into a fictitious exclusive parse/compile/initialization breakdown.

Worker JS heap after fixed rule installation was about 5.03 MB in both builds.
The same browser process's private bytes grew by about 8.04/8.82 MiB during native
rule seeding. This includes index/transport/allocation effects and is not an
isolated DNR memory measurement or a claimed memory improvement.

## Quotas, playback and measurement reliability

Three alternating native quota runs per build passed. Each reached 30,000 dynamic
and 5,000 session rules, rejected dynamic/session overflow and 5,001 unsafe dynamic
rules atomically, restored exact owner bands, and honored the latest rapid settings
generation. Unrelated appearance changes made zero DNR reads/writes. SafeSearch
changes used one session read and one write, with no dynamic I/O; complete observed
windows were 255–271 ms across the six runs.

Five full fingerprint-consistency pairs also passed: canvas/Offscreen exports,
text/layout, editable selections, exact audio buffers, frames/popup/reload, camera
selection and classic/module/shared/service worker CSP/import/URL behavior. Native
WebGL drawing passed. WebGPU adapters remained unavailable in pinned Chrome, as in
Phase 04; policy behavior retains the unit coverage rather than a hardware claim.

Fresh Edge 150.0.4078.48 guest playback checks used noise configured and actually
active in the page. YouTube advanced 1.17 → 16.15 seconds. The first Twitch attempt
did not start, despite the old harness exiting zero; it is retained as a failed
attempt, not counted as a playback pass. A fresh frozen-candidate retry advanced
0.40 → 15.69 seconds at ready state 4, unpaused. The first failure's cause is not
established by these samples. Each successful observation spans fifteen seconds;
it does not establish long-session/player-wide reliability or ad-block accuracy.

The live harness now marks a run incomplete and exits nonzero if readiness fails,
video never advances, or playback remains paused without ending. A new regression
checks those failure cases. This fixes false validation results; production player
behavior was not changed. `playback-initial.json`, `twitch-retry.json` and the
explicit combined `playback-validated.json` preserve that history.

## Reproduction and identity

Measured Phase 05 runtime: 135 files, fingerprint
`3d2e8c224860a92f0ccdbae3db56416ef1c2d729e189de972cb7028b38b29fa7`,
ZIP SHA-256
`bd188f7229ec4bc2d8b6e16b4144c99d6fe2ab32c72cb1e5fb7ec6b9921cd98c`.
Pinned Chrome executable SHA-256 remains
`be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e`.
Hardware: Windows 10.0.19045, i5-12400F/12 logical CPUs, Node 24.18.0, no CPU throttle.
Raw reports/traces stay local under `docs/perf/traces/performance-phase05/`.

The final maintainability gate passed all **322 suites**, generated-byte checks,
and shipped-script syntax checks. Its temporary-index tree is
`2ae3766fdda626d537855a1c783a9337a1eeee73`; the final audit text was completed
after that run. The gate log SHA-256 is
`31aa0499521ef01e5488fa7268336fed23ca6c9359d6ee96aec6f1ad3cf078e7`.
`identities.json` in the raw-report directory records report/tool hashes and
verifies all 135 frozen candidate files still match the local runtime byte for
byte. The real Git index remains unstaged.

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/browser-layout-performance.js --browser tmp/chrome-minimum-121/chrome-win64/chrome.exe --reference tmp/fingerprint-phase04/final/candidate --candidate tmp/performance-phase05/final/candidate --runs 7 --out tmp/layout.json
& 'C:\Program Files\nodejs\node.exe' tools/perf-profile.js --edge tmp/chrome-minimum-121/chrome-win64/chrome.exe --baseline tmp/fingerprint-phase04/final/candidate --candidate tmp/performance-phase05/final/candidate --variants base,on --offline --fingerprint-noise on --runs 5 --pages /article.html,/churn.html,/frames.html,/frames-heavy.html --out tmp/pages-on.json
& 'C:\Program Files\nodejs\node.exe' tools/browser-cold-wake.js --runs 3 --browser tmp/chrome-minimum-121/chrome-win64/chrome.exe --extension tmp/performance-phase05/final/candidate --synthetic-rules 29950 --out tmp/worker.json --trace-dir tmp/worker-traces
```

The runs set `WARDENONE_HEADLESS=1` and `WARDENONE_SOFTWARE_GL=1` for pinned Chrome;
live Edge playback uses the normal guest window with software GL. Repeat the page
command with `--fingerprint-noise off` for the disabled comparison. The near-quota
tool accepts `WARDENONE_BROWSER_PATH` and `WARDENONE_EXTENSION_DIR` for the same
immutable paths. No commit or push was requested or made.

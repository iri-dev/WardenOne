# Release performance profiles

CI also records the package footprint after each passing gate: staged-tree ZIP and unpacked bytes,
bundled DNR rules, manifest-injected scripts, and content and worker source bytes. The
limits in [`static-budget.json`](static-budget.json) are compared with the staged package
by `node tools/check-performance-budget.js`; CI keeps the measurements as a build
artifact for 90 days. A release ZIP archived from a commit includes its commit ID in the ZIP
comment, so its byte count can differ from the staged-tree metric; the published SHA-256 covers
the actual release ZIP. These are size and rule-count checks. The browser profile below
measures execution time and heap with the worker held awake; what a worker wake costs the browser
is measured separately, under [Cold worker wakes](#cold-worker-wakes).

Each `profile-<commit>.json` here is an enabled-versus-disabled measurement of that release
candidate in a real browser with the real extension loaded, produced by
`node tools/perf-profile.js`; the `.md` beside it is the readable summary, and the JSON keeps the
raw per-run values, the readiness evidence and the metadata (commit, browser and extension
versions, CPU, throttle, date). Raw DevTools traces from `--trace` land in `traces/`, which is
not tracked (tens of MB each).

The separate [YouTube memory review](youtube-memory-review-2026-10-01.md) records the owner's
1.2 GB Brave warning, controlled playback measurements, and what remains unproven.

## Iframe image logger observer (2026-10-11)

`node tools/perf-profile.js --paired-logger` measures the image logger warning switch with the
rest of WardenOne enabled in both states. The local fixture has eight child frames, each with
64 images. Each frame changes `src` and `srcset` and adds an image subtree in 12 batches. The
profiler alternates the switch within one browser profile, checks that the detector is active
or inactive in every frame, and records cold navigations and warm reloads. This avoids the
large between-session variation seen when comparing separate fresh browser profiles.

Median extra main-thread task time with the warning switch on, compared with off:

| Edge 150, i5-12400F | Before cache | With bounded URL cache |
| --- | ---: | ---: |
| Normal CPU, cold / warm (7 runs each) | +73 / +95 ms | +51 / +44 ms |
| 4x CPU throttle, cold / warm (5 runs each) | +472 / +469 ms | +191 / +209 ms |

The detector added no median long tasks in these runs. With the cache, median fixture completion
was 25/16 ms later at normal speed and 57/55 ms later at 4x throttle. The cache holds up to
64 URL classifications in isolated script memory and is cleared when the detector is disabled
or the frame's site changes. The [normal-speed baseline](image-frame-observer-paired-2026-10-11.md),
[normal-speed cached run](image-frame-observer-cached-2026-10-11.md),
[throttled baseline](image-frame-observer-paired-x4-2026-10-11.md), and
[throttled cached run](image-frame-observer-cached-x4-2026-10-11.md) include per-run JSON beside
each summary.

This is a synthetic image-heavy page with repeated local URLs. It confirms measurable work from
the observer and a reduction for this workload; it does not establish overhead on typical sites
or the same cache benefit when every image URL is unique. The before and after runs were in
separate browser sessions, so their within-session on/off differences are more reliable than
comparing absolute task times across the two builds.

## Iframe image selection checks (2026-10-12)

The [current-build normal-speed profile](image-frame-current-2026-10-12.md) and
[4x profile](image-frame-current-x4-2026-10-12.md) repeated the paired image fixture after the
frame-settings change, with 3,636 remote hosts loaded. A trace attributed about 19 ms across
eight frames to roughly 7,900 image load/error callbacks; most images had ordinary URLs and
did not need responsive selection checks. The detector now attaches its document-level
load/error handlers only after a candidate-bearing `srcset` appears or a `<picture>` image needs
selection monitoring. An existing or newly changed `<base>` is watched so relative responsive
sources remain detectable after base-URL changes. Ordinary `src` changes remain checked by the
source-attribute observer. A cheap URL hint rejects ordinary values before URL parsing, while
encoded and non-ASCII values use the full parser. The real browser image-warning test still
detects direct, responsive and cross-origin frame candidates.

The first before and after runs ([before](image-frame-current-2026-10-12.md),
[before 4x](image-frame-current-x4-2026-10-12.md), [changed](image-frame-conditional-final-2026-10-12.md),
[changed 4x](image-frame-conditional-final-x4-2026-10-12.md)) were taken while the machine was
busy. Several runs waited about 22 seconds for the fixture to finish, and the same stalls showed
up on other fixtures with no extension loaded. At 4x the stalled runs carried roughly 200 ms more
background work, enough to swing the result from +4 to +189 ms. Both builds were profiled again
later, interleaved on an otherwise idle machine, and no run stalled. Median extra main-thread task
time with the iframe warning switch on, compared with off:

| Eight image frames | Before (`7507f01`) | Conditional selection checks |
| --- | ---: | ---: |
| Normal CPU, cold / warm (7 runs) | +12 / +20 ms | +22 / +13 ms |
| 4x CPU, cold / warm (5 runs) | +184 / +123 ms | +96 / +72 ms |

At normal speed both builds cost 10-20 ms, and the difference between them is within the
run-to-run spread. At 4x the change roughly halves the detector's cost. The two builds ran in
separate browser sessions, so the comparison between columns is weaker than each column's own
on/off difference. The raw runs are in the [before](image-frame-quiet-head-2026-10-12.md),
[before 4x](image-frame-quiet-head-x4-2026-10-12.md), [changed](image-frame-quiet-2026-10-12.md)
and [changed 4x](image-frame-quiet-x4-2026-10-12.md) profiles.

The 2026-10-11 normal-speed figures above (+51 / +44 ms) were skewed. The remote lists arrived
part-way through that session and lifted every later run by about 170 ms, and more of the
switch-on runs came after them. At 4x that build measured about +190 ms, close to what `7507f01`
measures here.

A changed-build trace had no image load-handler calls on this ordinary-URL fixture, versus 7,933
before the change, and the added listener count fell from about 18 to 2. Mutation callbacks
still inspect added image subtrees and changed sources; this fixture generated 96 such callbacks
across the frames in the changed trace.

## Iframe image detector scans (2026-10-12)

The image fixture above changes images in place, so it barely touches two other paths the
detector runs in every child frame. The iframe warning is on by default, so those paths run in
the ad frames, embedded players and widgets of most pages.

- Every added element's subtree was queried. A frame that adds a container and then its
  children, one record each, scanned its deepest images once per added ancestor. Now only the
  outermost added nodes are scanned, because the nested ones are inside that scan, and added
  nodes without element children skip the subtree query.
- The base-URL watch above re-listed the frame's `<base>` elements with a whole-document query
  after every structural change, so a player rewriting its clock text walked its whole DOM on
  every update. The list is now refreshed only when a `<base>` is added or a watched one leaves
  the document. `document.baseURI` is still compared on every batch, and its hint test runs once
  per base change rather than once per image.
- The URL hint above missed one parser rule. The URL parser deletes tabs and newlines, so
  `ip<TAB>logger.example` loads from `iplogger.example` while containing neither marker. A value
  with a tab or newline is now also tested with them removed. `7507f01` parsed every URL, so this
  gap existed only in the hint.

`node tools/bench-frame-image-logger.js --compare <git-rev|file>` measures the detector alone. It
loads each version into a fresh same-origin frame on a cross-origin-isolated page and times the
DOM work there, observer callbacks included. "Floor" is a MutationObserver with the same options
that only walks its records, the price of observing at all. Median extra time per frame over no
detector, normal CPU / 4x CPU, 15 and 12 runs per cell
([normal](frame-image-logger-bench-2026-10-12.json), [4x](frame-image-logger-bench-x4-2026-10-12.json)).
"Before" is the detector as it was before this change, recorded as
`previous-frame-image-logger.js`:

| Frame shape | Floor | Before | After |
| --- | ---: | ---: | ---: |
| The image fixture: 64 images changing src/srcset, 12 rounds | +0.3 / +2.4 ms | +0.6 / +4.3 ms | +0.7 / +4.5 ms |
| A 1,093-element tree appended parent-first into 2,000 nodes, 6 times | +2.7 / +43.7 ms | +10.8 / +64.6 ms | +6.1 / +55.6 ms |
| 300 clock-text updates in a 3,000-node DOM | +0.5 / +2.2 ms | +4.8 / +23.7 ms | +0.5 / +2.3 ms |
| A lazy loader setting src and srcset on 300 images, 5 times | +3.6 / +9.3 ms | +5.3 / +26.2 ms | +3.3 / +19.1 ms |

The clock-update case falls to the floor, and the framework build loses about half of the
detector's own work. The lazy-loader difference is inside its run-to-run spread. The image fixture
does not move, because almost all of its cost is the observer itself, and the warning cannot drop
that without missing changed images. Paired whole-page profiles of that fixture agree
([before](image-frame-scan-previous-2026-10-12.md), [after](image-frame-scan-new-2026-10-12.md),
[before 4x](image-frame-scan-previous-x4-2026-10-12.md), [after 4x](image-frame-scan-new-x4-2026-10-12.md)).
At normal speed the switch cost +9 / +20 ms before and +16 / +1 ms after, cold / warm, both
within the spread. At 4x it cost +120 / +117 ms before and +99 / +66 ms after. The same "before"
build measured +96 / +72 ms in the session above, so that gap is not established either.

## Current page cost and consent scanning (2026-10-11)

The [current-build baseline](profile-current-baseline-2026-10-11.md) reruns the original article,
DOM-churn and eight-frame fixtures with the working tree at `fd160f9`. Edge 150 on an i5-12400F
measured five cold navigations and five warm reloads per variant. A browser trace attributed the
largest repeated churn cost to Consent Auto-Reject's page-wide scans: its generic fallback was
measuring ordinary controls before checking whether their labels could be reject actions.

The scanner now filters labels before visibility checks. On pages without a possible banner, its
short startup polls reuse that result until a relevant DOM mutation arrives. It still polls a
hidden named or obfuscated candidate for CSS-only reveals, and its later slow poll still runs.
The [optimized profile](profile-consent-poll-2026-10-11.md) used the same machine and five-run
method. Median extra main-thread task time with WardenOne on:

| Fixture | Baseline cold / warm | Optimized cold / warm |
| --- | ---: | ---: |
| Article | +153 / +130 ms | +134 / +112 ms |
| DOM churn | +567 / +559 ms | +317 / +307 ms |
| Eight frames | +396 / +413 ms | +374 / +366 ms |

The churn reduction is about 250 ms in this fixture. The frame difference is small relative to
between-session variation; frame startup remains expensive, with about 6.8 MB of extra top-page
heap after GC and roughly 370 ms of task-time overhead across eight frames. The traces show much
of that cost in per-frame configuration delivery and always-on guard startup, which this consent
change does not remove. These are synthetic pages and separate browser sessions, so the table is
evidence for this workload rather than a site-wide performance guarantee. The JSON files beside
both summaries retain every run and browser-readiness check.

## Remote lists, frame config and overlay sweeps (2026-10-12)

The profiles above were taken before WardenOne's remote supplemental lists had arrived. They
download in the first 10-40 seconds after install, and once they are in, every frame's signed
settings message grows from about 6 KB to about 56 KB, 50 KB of it adult-site hosts. A reader's
browser has them, so `perf-profile.js` now waits up to 90 seconds for them and records the host
count with the readiness evidence (3,636 hosts in these runs). Measured with them, the
2026-10-11 build cost the eight-frame page about +500 ms rather than the +374 ms in the table
above.

A CPU profile put most of that on the host lists. Each child frame fetched them, re-normalised
them with `new URL()`, signed them, and had anti-redirect and the fingerprint realm hash them,
but only the engine reads them, and the engine runs in the top frame alone. Child frames now
leave them out. On the top page they travel beside the settings under their own signature,
bound to the same sequence number, which only the engine checks, so the other in-page readers
hash a few kilobytes.

A per-feature ablation then turned one protection off at a time and alternated within one
browser session. On the DOM-churn page it attributed about 73 ms to the overlay cleaner, 65 ms to
Consent Auto-Reject's mutation filter and 49 ms to the page badge. The confirm-bait sweep cost
about 7 ms; most of its CPU-profile time was layout the frame would have done anyway. The overlay
cleaner now checks position before reading an element's text, asks about each candidate once
and reuses its check of shared parents within a sweep. Smaller changes remove a URL build per
added element in the IP-logger watch, ask the click-layer sweep's document-level conditions
once, skip `new URL()` for host names that are already canonical, and trim per-node work in the
consent filter. Each keeps the same answers, and the tests compare the new code with the old
form or with the URL parser.

`perf-profile.js --baseline <dir> --variants off,base,on` measured the change against a copy of
the tree from before it, which already had the consent-scan change above. The
[first profile](profile-frame-config-2026-10-12.md) ran off, baseline, changed; the
[second](profile-frame-config-swapped-2026-10-12.md) ran off, changed, baseline, so an
order effect would show as disagreement. Edge 150, i5-12400F, five runs per cell. Median extra
main-thread task time over the browser without WardenOne, cold navigation:

| Fixture | Baseline (first / second) | Changed (first / second) |
| --- | ---: | ---: |
| Article | +206 / +199 ms | +177 / +180 ms |
| DOM churn | +456 / +419 ms | +338 / +334 ms |
| Eight frames | +497 / +526 ms | +278 / +287 ms |

Warm reloads moved the same way, by 28-42 ms on the article, 73-104 ms on the churn page and
197-222 ms on the frames page. Heap after GC on the frames page fell by 1.76 MB in both
profiles. The top page's single long task, about 70-95 ms, is mostly the engine compiling and
starting, and this work does not change it. Per-frame cost is now mostly the in-page scripts
starting and checking a 5.7 KB signed settings message three times per frame. Hashing it in plain
JavaScript runs before V8 has optimised the code. A variant with the hash's rotations inlined was
only 15-20% faster in that state, so it was not worth changing seven security-critical copies.
These are synthetic pages, so the numbers are evidence for these shapes rather than a site-wide
guarantee. The JSON beside each summary keeps every run and readiness check.

## Current reprofile and child-frame settings (2026-10-12)

The [fresh profile](profile-2026-10-12-reprofile.md) measured commit `7507f01` before this
change, with all 3,636 remote hosts loaded. Five cold navigations and five warm reloads per
variant added a median 175/170 ms on the article, 332/330 ms on DOM churn, and 265/264 ms on
the eight-frame page. The old ~900 ms churn and ~60 ms per-frame findings describe earlier
builds; they are not the current baseline.

The trace still showed repeated signing and verification of the child-frame settings. Each
child received the top page's broad settings even though only its popup, credential, permission,
fingerprint and player guards run there. The bridge now signs only the fields those guards read
in a child. Projecting the default settings this way cuts the JSON from about 4.3 KB to
0.5 KB; the top frame still receives its full settings. The
[before/after profile](profile-2026-10-12-frame-prune.md)
and [reversed-order profile](profile-2026-10-12-frame-prune-swapped.md) retain the raw runs and
readiness checks. In the first comparison's frame trace, the combined anti-redirect and
fingerprint config handlers fell from 46 to 17 ms across eight frames, while the bridge's
config reply fell from 42 to 33 ms.

Whole-page task-time medians were noisy across browser sessions. With the baseline run first,
the changed build measured 31 ms *higher* on eight frames; with the order reversed it measured
75 ms *lower*. The unchanged article and churn workloads also swung substantially with order.
The traces establish less repeated settings work, but these runs do not establish a stable
whole-page speedup. The new projection preserves the signed settings used by frame guards and
removes fields that only the top-page engine reads.

## Quiet-machine reprofile (2026-10-12)

Later the same day, with nothing else running, the browser without WardenOne was itself 15-25%
faster than in the morning profiles above, and the five runs in each cell agreed to within a few
milliseconds. Two profiles of the working tree, the [first](profile-2026-10-12-current.md) off then
on and the [second](profile-2026-10-12-current-swapped.md) on then off, all 3,636 remote hosts
loaded. Edge 150, i5-12400F. Median extra main-thread task time over the browser without
WardenOne (first / second):

| Fixture | Cold | Warm |
| --- | ---: | ---: |
| Article | +134 / +136 ms | +117 / +117 ms |
| DOM churn | +242 / +250 ms | +234 / +232 ms |
| Eight frames | +167 / +165 ms | +156 / +157 ms |

These replace the +177 / +338 / +278 ms figures above as the current cost. Most of the drop is
the quieter machine rather than code. Profiled in the same session as a copy of `7507f01`
([first](profile-2026-10-12-current-vs-head.md), [reversed](profile-2026-10-12-current-vs-head-swapped.md)),
the article and churn pages measured within 10 ms of it in both orders. The eight-frame page
measured 39-41 ms lower cold and 36-40 ms lower warm in both orders, about 15%, with 0.3 MB less
heap after GC. That is the child-frame settings change; the morning comparison above was too
noisy to show it.

Script accounts for most of what remains: about 100 of the article's ~135 ms, 190-200 of the
churn page's ~245 ms and 120-125 of the frame page's ~165 ms. Each page still has one cold long
task, about 70 ms on the article, which is mostly the engine compiling and starting, and about
50 ms on the other two. Heap after GC is +2.3 MB on the article, +2.5 MB on the churn page and
+4.7 MB with eight frames. These are synthetic pages, so the numbers are evidence for these shapes
rather than a site-wide guarantee.

## Cold worker wakes

The worker stops after about thirty quiet seconds, and the next tab close, popup open or
navigation starts it again. Whatever a wake asks of Chrome is answered on the browser's UI
thread, the one that draws the tab strip and routes scrollbar drags. `node tools/browser-cold-wake.js`
waits for the remote lists to install, lets the worker sleep, then closes a tab and opens the
popup, each on a sleeping worker, and fails on any UI-thread stall answering a rule-API call or
on more than 300 ms of UI-thread stalls in all. It needs Edge and network access and takes about
three minutes, so it is not part of the gate.

Measured on 2026-10-01 (Edge 150, i5-12400F, 22,134 dynamic rules). Six appliers read every
dynamic rule on each wake to filter their own band; Chrome builds each reply on the UI thread in
170-270 ms and sends it as a ~21.8 MB message. Closing a tab on a sleeping worker froze the UI
thread six times, 1,123 ms in all; dragging the popup's scrollbar straight after opening it saw a
worst move of 500 ms to 5 s. With band-filtered reads (`getDynamicRulesInBand`) the same tab
close shows no rule-API stall (UI thread 226-252 ms busy over 5 s, against 1,260 ms) and the
popup drag's worst move is 66 ms. The harness above keeps a debugger attached to the worker,
which keeps it awake, so it cannot see any of this; `releaseWorker` in `perf-profile.js` lets
a tool measure a wake.

## How to read one

- **off** is the same browser with no extension; **on** is WardenOne loaded from the working tree.
  The profile is the *difference*, per page, per phase (cold = first navigation with the cache
  cleared, warm = a reload), over five runs: median, p90 and max.
- The pages are synthetic and local: an article with cross-site links and a sign-in form, a
  page that builds a deep DOM tree in-document the way frameworks do (the mutation-scan stress
  case), and a page with eight same-origin frames. They are meant to be *harder* than an
  ordinary page, not representative of one; the numbers are ceilings for those shapes, and a
  change between two profiles matters more than any absolute.
- Compare cells **within one profile**. Between browser sessions the frames page in particular
  moves by up to 2x (code-cache state for the per-frame scripts), while the five runs inside one
  session stay tight; the harness runs every variant in its own fresh session for that reason,
  and a cross-session comparison is only meaningful when the change is larger than that.
- **regress:mutation-dedup** is a deliberately broken copy of the extension -- the outermost-node
  dedup of the mutation scan undone -- and exists to prove the harness can see a known
  structural regression before its numbers are trusted as a gate. `--expect-regression` fails
  the run if it cannot.
- The harness fails closed: an "on" variant whose worker does not report the repository's version,
  or whose engine did not stamp its readiness marker in the page, refuses to measure; an "off"
  variant with the marker present refuses too. Chrome 152 no longer loads unpacked extensions
  from the command line, so the browser is Microsoft Edge, and its version is in every profile.

## 1.0.1 at 4cd3119 (2026-09-20)

Edge 150, i5-12400F, no CPU throttle, 5 runs per cell. Main-thread task time, cold, median:
article 43 ms off / 95 ms on (+52 ms); churn stress page 192 ms / 1,094 ms (+902 ms, one long
task of ~170 ms); eight frames 50 ms / 546 ms (+496 ms). Heap after GC: +0.8 MB on the article,
+2.5 MB on the churn page, +5.9 MB with eight frames. The known regression showed as 1,458 ms
against 1,094 ms on the churn page (+33%, long-task time 751 ms against 166 ms), so the harness
is sensitive enough to serve.

What the numbers say, beyond "it costs something": the per-frame cost is the standout. The
frames page adds roughly 60 ms of main-thread time per same-origin frame, which is the
all-frames MAIN-world scripts (`domain-utils.js`, `anti-redirect.js`, `fingerprint-realm.js`,
`permission-chain.js`) and the isolated bridge being evaluated in every frame; a page with many
frames pays it many times. That is a measurement, not a fix, and it is recorded here so the next
profile can be compared against it.

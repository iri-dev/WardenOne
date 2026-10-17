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

`node tools/perf-profile.js` measures the extension in a real browser. Per-run profiles,
machine metadata, video investigations and DevTools traces stay local; this page records
the conclusions needed to understand release performance decisions.

## Browser-process CPU while idle (2026-10-17)

On 2026-09-05, per-process sampling in Brave put WardenOne at about 34% of one core in the
browser process while idle (37.5% with every extension loaded, 0% with none), with no extension
script running. It was not re-measured after the band-filtered rule reads under
[Cold worker wakes](#cold-worker-wakes). It does not reproduce: idle with six restored tabs, the
browser process uses about 2% of a core with WardenOne and 0.5% without it.

**Method.** Edge 150.0.4078.48, i5-12400F (6 cores), Windows 10 19045, with other desktop apps
open. The build is `5a7b336`, exported with `git archive`, so an uncommitted worker change in the
tree at the time is not included. Each variant has its own disposable profile under `%TEMP%`.
WardenOne's profiles waited for the remote lists (22,136 dynamic rules, 3,636 remote hosts)
before any session. A session relaunches with `--restore-last-session` onto six tabs (Wikipedia,
MDN, GitHub, BBC News, Stack Overflow, the Guardian) and reads the browser process's cumulative
CPU time from `SystemInfo.getProcessInfo`:

- the first 30 s after launch (restore);
- the next 60 s (idle with the tabs);
- 60 s with only about:blank;
- 57 s browsing eight sites in one tab with wheel scrolling.

The window is off-screen with native occlusion detection disabled, so the active tab still paints.
Variants alternated within each round, and the second half of each round ran in reverse order.
*Control* is a minimal extension with one static `declarativeNetRequest` block rule and no
worker. It shows what Chrome charges any DNR blocker.

Browser process, % of one core, median of two sessions per variant in profiles that had already
browsed the sites at least four times (see the traps below):

| Window | Off | Control | WardenOne |
| --- | ---: | ---: | ---: |
| Idle, six restored tabs | 0.5 | 0.7 | 1.9 |
| Restore, first 30 s | 7.1 | 9.1 | 30.8 |
| Browsing, eight sites | 5.4 | 5.2 | 7.5 |

Across the three rounds that used a realistic restart (see the traps), idle with the tabs measured
0.4-0.5% off and 0.9-2.7% on (median 2.0%, seven sessions each). Idle on about:blank was 0.1% for
both (three sessions each, first round). The idle cost is under the 5% this re-check was set to
investigate, and the browser process is not doing continuous work for WardenOne, so the
2026-09-05 finding no longer holds for the current build.

**What the remaining cost is.** WardenOne's extra browser-process work is mostly Chrome reading
and rewriting its 22,136 dynamic rules:

- `getDynamicRules({ ruleIds })` reads and parses the whole dynamic-rule file before it filters.
  A call for a single id costs 114 ms of browser CPU with 22,136 rules and 1.1 ms with 136; an
  unfiltered call costs 284 ms.
- `updateDynamicRules` re-indexes the whole set, about 360 ms per write.
- A trace of one restore counted 23 such reads and 2 writes: 4.7 s, almost all of it on a
  browser thread-pool thread.
- A traced worker wake made 8 band reads back to back, about 1 s. The idle windows show the same
  thing. In every WardenOne session the worker went to sleep and then woke about a minute after
  launch, and that five-second sample was the only busy one: 17-26% of a core, about 1 s of CPU,
  with every other sample at 0.0-0.6%. With the remote lists removed, the same wake cost 1.3-1.4%,
  about 70 ms.

This runs off the UI thread, so it does not freeze the tab strip the way the unfiltered replies
did. It is still CPU, and it grows with the size of the remote lists. The bands now share one
read per wake and skip writes that change nothing. A wake's browser CPU fell from about 1.3 s to
0.47 s; the before and after are under [Cold worker wakes](#cold-worker-wakes). The tables in this
section were measured before that change.

Ablations in earlier, younger profiles (three sessions each) located the cost:

| Window | Off | WardenOne | AdShield static pack emptied | No remote lists |
| --- | ---: | ---: | ---: | ---: |
| Idle, six restored tabs | 0.4 | 2.6 | 2.4 | 0.5 |
| Restore, first 30 s | 6.6 | 32.6 | 32.3 | 19.7 |

Emptying the 28,024-rule AdShield pack, the bulk of the static rules, changed nothing. Removing
the always-on `onRuleMatchedDebug` listener, which only unpacked installs fire, changed nothing
either: restore / idle / browsing measured 30.5 / 1.9 / 7.3, against 30.8 / 1.9 / 7.5 with it.
Without the remote lists, idle fell to the no-extension level and the restore cost roughly
halved. The rest of the restore cost is request handling on the UI thread, about 2.5 s in the
traced restore. Every request there also made the trusted-header round trips
(`TrustedHeaderClient`) that Chrome adds once an extension has `modifyHeaders` rules. WardenOne
installs six by default as session rules, one of which sets a `DNT` header on every request. The
control, which has no such rules, added only 0.6 s of browser CPU over the same 30 s.

**Traps.**

- **A deep profile path silently loses the remote lists.** With the profile under a 165-character
  scratch path, all 27 sources downloaded but `updateDynamicRules` failed with "Internal error
  while updating dynamic rules.": Chrome's dynamic-rule file write exceeds the Windows path
  limit. Profiles directly under `%TEMP%`, as `perf-profile.js` creates them, are fine.
- **`--load-extension` fires `onInstalled` with reason `install` on every relaunch.** Onboarding
  reopens, and the install path downloads all 27 lists again and rewrites the 22k rules. A real
  unpacked install gets `onStartup` instead, which skips lists fetched in the past 12 hours. The
  first round measured this by mistake: 31% restore, and 66% of a core idle across all processes,
  most of it the onboarding animation below.
  Later rounds used a throwaway copy whose install handler takes the startup path and opens no
  onboarding.
- **Onboarding's background animation was expensive while visible.** With it as the active tab,
  Edge's GPU process used 66% of a core and its renderer 14%. With `prefers-reduced-motion:
  reduce` emulated, both fell to about 0. Most of the cost was the never-ending animation, which
  makes the browser draw a new frame on every refresh, rather than the blur. The motion now settles
  within a minute, after which the page uses no measurable CPU.
- **New profiles spike on first visits.** In a profile's first three or so browsing sessions, the
  browser process spiked to 40-65% on the BBC, MDN, Guardian and GitHub pages, with or without an
  extension. Without an extension, browsing measured 12-17% in the first three sessions and 5%
  afterwards. Early sessions made the control look 13 points more expensive than off while
  browsing; settled, it measured the same. Compare only profiles that have settled.
- `SystemInfo.getProcessInfo` reports Edge's GPU process as type `GPU`, not `gpu`, and its utility
  processes by service name.

The sampling and trace scripts were run from a scratch directory; they are not in `tools/`.

## IDN helper scope (2026-10-13)

The phishing detector's Unicode lookalike table now loads in the top-page engine and worker.
It was previously part of `domain-utils.js`, which is injected into both worlds of every child
frame. The shared helper shrank from 26,927 to 8,721 bytes, removing 18,206 bytes of script
source from each frame injection. The phishing differential and Unicode data checks still cover
encoded lookalikes and ordinary IDNs. The package budget permits one additional top-only script
entry; its script-byte and overall package limits are unchanged.

In two Edge 150 comparisons (three cold and three warm runs per build in each order), the
eight-frame fixture retained 0.01-0.03 MB less page JavaScript heap after GC with the new scope.
The article fixture showed no heap difference. Main-thread task time moved in both directions
between runs, so these measurements do not establish a page-level speedup. A separate Node V8
check across 80 fresh contexts retained 0.506 MB with the old shared helper and 0.163 MB with
the reduced one after GC. Neither heap measure is a Chrome Task Manager process MB estimate.

## Iframe image logger observer (2026-10-11)

`node tools/perf-profile.js --paired-logger` measures the image logger warning switch with the
rest of WardenOne enabled in both states. The local fixture has eight child frames, each with
64 images. Each frame changes `src` and `srcset` and adds an image subtree in 12 batches. The
profiler alternates the switch within one browser profile, checks that the detector is active
or inactive in every frame, and records cold navigations and warm reloads. This avoids the
large between-session variation seen when comparing separate fresh browser profiles.

Median extra main-thread task time with the warning switch on, compared with off:

| Edge 150, desktop test CPU | Before cache | With bounded URL cache |
| --- | ---: | ---: |
| Normal CPU, cold / warm (7 runs each) | +73 / +95 ms | +51 / +44 ms |
| 4x CPU throttle, cold / warm (5 runs each) | +472 / +469 ms | +191 / +209 ms |

The detector added no median long tasks in these runs. With the cache, median fixture completion
was 25/16 ms later at normal speed and 57/55 ms later at 4x throttle. The cache holds up to
64 URL classifications in isolated script memory and is cleared when the detector is disabled
or the frame's site changes. The normal-speed baseline,
normal-speed cached run,
throttled baseline, and
throttled cached run have per-run JSON retained locally
each summary.

This is a synthetic image-heavy page with repeated local URLs. It confirms measurable work from
the observer and a reduction for this workload; it does not establish overhead on typical sites
or the same cache benefit when every image URL is unique. The before and after runs were in
separate browser sessions, so their within-session on/off differences are more reliable than
comparing absolute task times across the two builds.

## Iframe image selection checks (2026-10-12)

The current-build normal-speed profile and
4x profile repeated the paired image fixture after the
frame-settings change, with 3,636 remote hosts loaded. A trace attributed about 19 ms across
eight frames to roughly 7,900 image load/error callbacks; most images had ordinary URLs and
did not need responsive selection checks. The detector now attaches its document-level
load/error handlers only after a candidate-bearing `srcset` appears or a `<picture>` image needs
selection monitoring. An existing or newly changed `<base>` is watched so relative responsive
sources remain detectable after base-URL changes. Ordinary `src` changes remain checked by the
source-attribute observer. A cheap URL hint rejects ordinary values before URL parsing, while
encoded and non-ASCII values use the full parser. The real browser image-warning test still
detects direct, responsive and cross-origin frame candidates.

The first before and after runs (before,
before 4x, changed,
changed 4x) were taken while the machine was
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
on/off difference. The raw runs are in the before,
before 4x, changed
and changed 4x profiles.

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
(normal, 4x).
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
(before, after,
before 4x, after 4x).
At normal speed the switch cost +9 / +20 ms before and +16 / +1 ms after, cold / warm, both
within the spread. At 4x it cost +120 / +117 ms before and +99 / +66 ms after. The same "before"
build measured +96 / +72 ms in the session above, so that gap is not established either.

## Current page cost and consent scanning (2026-10-11)

The current-build baseline reruns the original article,
DOM-churn and eight-frame fixtures with the working tree at `fd160f9`. Edge 150 on a desktop test CPU
measured five cold navigations and five warm reloads per variant. A browser trace attributed the
largest repeated churn cost to Consent Auto-Reject's page-wide scans: its generic fallback was
measuring ordinary controls before checking whether their labels could be reject actions.

The scanner now filters labels before visibility checks. On pages without a possible banner, its
short startup polls reuse that result until a relevant DOM mutation arrives. It still polls a
hidden named or obfuscated candidate for CSS-only reveals, and its later slow poll still runs.
The optimized profile used the same machine and five-run
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
evidence for this workload rather than a site-wide performance guarantee. Local JSON captures
retain every run and browser-readiness check.

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
first profile ran off, baseline, changed; the
second ran off, changed, baseline, so an
order effect would show as disagreement. Edge 150, desktop test CPU, five runs per cell. Median extra
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
guarantee. Local JSON captures keep every run and readiness check.

## Current reprofile and child-frame settings (2026-10-12)

The fresh profile measured commit `7507f01` before this
change, with all 3,636 remote hosts loaded. Five cold navigations and five warm reloads per
variant added a median 175/170 ms on the article, 332/330 ms on DOM churn, and 265/264 ms on
the eight-frame page. The old ~900 ms churn and ~60 ms per-frame findings describe earlier
builds; they are not the current baseline.

The trace still showed repeated signing and verification of the child-frame settings. Each
child received the top page's broad settings even though only its popup, credential, permission,
fingerprint and player guards run there. The bridge now signs only the fields those guards read
in a child. Projecting the default settings this way cuts the JSON from about 4.3 KB to
0.5 KB; the top frame still receives its full settings. The
before/after profile
and reversed-order profile retain the raw runs and
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
milliseconds. Two profiles of the working tree, the first off then
on and the second on then off, all 3,636 remote hosts
loaded. Edge 150, desktop test CPU. Median extra main-thread task time over the browser without
WardenOne (first / second):

| Fixture | Cold | Warm |
| --- | ---: | ---: |
| Article | +134 / +136 ms | +117 / +117 ms |
| DOM churn | +242 / +250 ms | +234 / +232 ms |
| Eight frames | +167 / +165 ms | +156 / +157 ms |

These replace the +177 / +338 / +278 ms figures above as the current cost. Most of the drop is
the quieter machine rather than code. Profiled in the same session as a copy of `7507f01`
(first, reversed),
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

### Frame startup attribution

A fresh single-run trace of the current working tree (Edge 150, eight-frame fixture, all 3,636
remote hosts loaded) separated script evaluation from later callbacks. Across the top page and
eight frames, `EvaluateScript` took 12.9 ms for `bridge.js`, 12.4 ms for `anti-redirect.js` and
1.3 ms for `fingerprint-realm.js`; top-frame `content.min.js` took 10.4 ms. Later `FunctionCall`
events attributed 24.8 ms to 26 `bridge.js` config replies and 13.6 ms to 63 anonymous
`anti-redirect.js` callbacks. The top-frame engine accounted for another 47.7 ms of callbacks.
The frame image detector took 0.5 ms to evaluate across nine frames, with less than 0.1 ms in
image-settlement callbacks on this quiet fixture. These are inclusive event durations from one
trace, not additive pieces of the measured 165 ms extension overhead or a causal estimate of
what removing a script would save.

The trace was captured with `node tools/perf-profile.js --variants on --runs 1 --trace
--trace-dir docs/perf/traces/f3-startup --out docs/perf/traces/f3-startup/profile.json`.
Raw traces stay local under the ignored `docs/perf/traces/` directory. The separate local
live-site review checked playback and page usability on YouTube, Twitch, Discord's login page
and a Wikimedia Commons gallery, but did not establish a repeatable whole-site CPU improvement.
Short, unpaired live-site traces also found the frame scripts running on YouTube: the bridge
evaluated for 13.7 ms and handled config replies for 14.9 ms, while the redirect guard evaluated
for 12.0 ms. The page showed two iframes at sampling time, but navigations caused eight bridge
evaluations across six frame IDs. Commons had no iframe at sampling time; its bridge and redirect
guard each took about 7.5 ms to evaluate. Both traces continued for five seconds after the
extension's ready marker, so their callback totals include page activity after startup. In
particular, repeated Consent Auto-Reject scans occupied much more time on these pages than the
frame image detector. These runs do not isolate a safe delay for any startup guard.
No guard has been deferred on this evidence: the MAIN-world redirect and fingerprint guards must
initialize before page scripts, and the trace does not show a safe later point for config handling.

### Consent polling on a real page

On Wikimedia Commons' featured mammals gallery, the consent scanner kept its 95 ms startup poll
active because a small offscreen "Cookie statement" footer item looked like a banner candidate.
The broad CookieYes `cky` selector also matched unrelated `sticky` classes. The scanner now
recognises CookieYes class tokens and keeps the rapid poll for visible or hidden banner candidates
with actionable consent controls, while ignoring small passive footer links. A compact named
banner with a reject button and a hidden banner that reveals through CSS both remain covered by
the consent regression test.

In a fresh Edge trace spanning page startup and five seconds after the extension's ready marker,
the scanner ran once for about 10 ms, versus 29 scans totalling about 249 ms in the earlier trace.
These are unpaired live-site traces, so the difference describes the scanner's work on this page,
not a controlled whole-page CPU improvement. The frame-config projection was also changed to
select child guard fields directly. A five-run synthetic frame profile measured 2.9 / 4.9 ms less
task time cold / warm, but the reverse-order run measured only 0.7 / 0.7 ms less; that difference
is too small to establish a reliable page-level speedup.

## Cold worker wakes

The worker stops after about thirty quiet seconds, and the next tab close, popup open or
navigation starts it again. Whatever a wake asks of Chrome is answered on the browser's UI
thread, the one that draws the tab strip and routes scrollbar drags. `node tools/browser-cold-wake.js`
waits for the remote lists to install, lets the worker sleep, then closes a tab and opens the
popup, each on a sleeping worker, and fails on any UI-thread stall answering a rule-API call or
on more than 300 ms of UI-thread stalls in all. It needs Edge and network access and takes about
three minutes, so it is not part of the gate.

Measured on 2026-10-01 (Edge 150, desktop test CPU, 22,134 dynamic rules). Six appliers read every
dynamic rule on each wake to filter their own band; Chrome builds each reply on the UI thread in
170-270 ms and sends it as a ~21.8 MB message. Closing a tab on a sleeping worker froze the UI
thread six times, 1,123 ms in all; dragging the popup's scrollbar straight after opening it saw a
worst move of 500 ms to 5 s. With band-filtered reads (`getDynamicRulesInBand`) the same tab
close shows no rule-API stall (UI thread 226-252 ms busy over 5 s, against 1,260 ms) and the
popup drag's worst move is 66 ms. The harness above keeps a debugger attached to the worker,
which keeps it awake, so it cannot see any of this; `releaseWorker` in `perf-profile.js` lets
a tool measure a wake.

The band filter moved the reply off the UI thread but not the work: Chrome parses the whole
dynamic-rule file before it applies `ruleIds`, about 110 ms of browser CPU per call with the lists
in, and a wake made eight calls. Since 2026-10-17 the bands share one read per wake, filtered to
all of WardenOne's own bands at once (about 7,100 ids, never the remote lists) and cut per band in
the worker. Every dynamic-rule write goes through `writeDynamicRules`, which drops the shared read.
Writes that would change nothing are skipped too: Chrome re-indexes every dynamic rule on any
write, even an empty one, and a browser start sent several (Force HTTPS's dynamic copy, Script
Shield's legacy cleanup, and the empty My Rules and firewall bands). A single unfiltered read was
the alternative. It costs 284 ms and returns the 22,000 list rules on the UI thread, which is the
stall this section is about, so it was not used. Measured on 2026-10-17 (Edge 150, 22,136 dynamic
rules, a sleeping worker woken by closing a tab, two wakes per build):

| Per wake | Before | After |
| --- | ---: | ---: |
| `getDynamicRules` calls | 8 | 1 |
| Rule-API task time, thread pool | 876-901 ms | 104-110 ms |
| Rule-API task time, UI thread | 66 ms | 9-10 ms |
| Browser CPU over the 6.3 s window | 1,305-1,323 ms | 460-483 ms |

`browser-cold-wake.js` still passes (no rule-API stall, 88 ms and 17 ms of UI-thread stalls).
`tools/test-dynamic-rule-reads.js` counts reads and writes in the gate. It runs the real appliers,
reconcile and queue against a modelled browser: one read and no writes per wake and per browser
start, against eight reads per wake and 19 reads with five writes per start before. A real
browser restart was not traced again, because `--load-extension` takes the install path on every
relaunch.

## Chrome over the DevTools pipe

Chrome 152 ignores `--load-extension`, so the browser tools reach a current Chrome only through a
launch override that starts it with `--remote-debugging-pipe --enable-unsafe-extension-debugging`
and sends `Extensions.loadUnpacked` down the pipe. That override must switch developer mode on
first, from a `chrome://extensions` tab with
`chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true })`. The setting lives
in Secure Preferences, so it cannot be written into the profile beforehand.

Without it, Chrome loads and runs the extension as UNPACKED with developer mode off, then disables
it (`unsupportedDeveloperExtension`) the first time it reloads: `chrome.runtime.reload()`,
Settings > Erase, the Reload button, or allowing it in incognito. The worker never comes back.
Every `chrome-extension://` tab turns into an `ERR_BLOCKED_BY_CLIENT` error page, but its target
URL still reads `chrome-extension://...`, so it looks as if only the worker is missing. A minimal
MV3 extension (a manifest and an empty worker) fails the same way. On 2026-10-17 this broke
`browser-settings-data.js`, `browser-config-race.js` and `browser-audit-highs.js` in Chrome
155.0.8059.82. With developer mode on first, all three pass. CI and Edge load with
`--load-extension`, which installs as COMMAND_LINE, and developer mode does not gate that.

It is not a product fault. A reader can only Load unpacked with developer mode on, and with it on
the worker came back every time. The test was a real install through the Load unpacked folder
picker (UNPACKED, saved in the profile, no pipe or unsafe flag), relaunched with only
`--remote-debugging-port`. The worker returned after the erase request Settings sends (twice),
after allowing WardenOne in incognito, after the Reload button, and after
`chrome.runtime.reload()`. Switching developer mode off disables that install at once, and it
stays disabled across restarts. That is Chrome's rule for unpacked extensions; WardenOne cannot
change it. An extension loaded over the pipe is also never saved to the profile, so it is gone
after a browser restart.

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
  from the command line, so the browser is Microsoft Edge, and its version is in every profile
  (for Chrome, see [Chrome over the DevTools pipe](#chrome-over-the-devtools-pipe)).

## 1.0.1 at 4cd3119 (2026-09-20)

Edge 150, desktop test CPU, no CPU throttle, 5 runs per cell. Main-thread task time, cold, median:
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

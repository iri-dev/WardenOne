# Release performance profiles

Each `profile-<commit>.json` here is an enabled-versus-disabled measurement of that release
candidate in a real browser with the real extension loaded, produced by
`node tools/perf-profile.js`; the `.md` beside it is the readable summary, and the JSON keeps the
raw per-run values, the readiness evidence and the metadata (commit, browser and extension
versions, CPU, throttle, date). Raw DevTools traces from `--trace` land in `traces/`, which is
not tracked (tens of MB each).

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

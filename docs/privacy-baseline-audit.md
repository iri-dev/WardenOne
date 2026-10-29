# Privacy engineering baseline — 2026-10-26

The WardenOne portion of roadmap Phase 00 has repeatable native-browser results.
Privacy Badger's runtime comparison remains **unscored**: the supplied source
archive does not initialize in the available browsers, and no compatible Firefox
or tested package is available locally. This is a compatibility limitation of
this experiment, not a measured protection failure or a competitive result.

This phase adds local measurement tools. The candidate retains the earlier
filter-compiler work described in [its audit](filter-compilation-audit.md).
No CNAME dataset, automatic outgoing-cookie policy, fingerprinting setting,
permission or version changed during baseline collection.

## Immutable inputs

Both WardenOne snapshots are version 1.0.2, MV3, with 129 packaged files. The
reference is commit `273c43a0051d6c3fe12c6871944ed7e8822d8af3`. The candidate
is uncommitted, based on that commit, captured as Git tree
`6cd6a587c4e240b32d6b6c158fff64c69608aa83`. A tree identifies its source
snapshot; it is not a candidate commit.

| Input | SHA-256 |
| --- | --- |
| Reference packaged-file fingerprint | `531507cda66c30cb4d86594a6012c7454f3e3a75f1ad4dcc4637247dc749ece8` |
| Candidate packaged-file fingerprint | `e7f03292f3e40ef9b5a24ccb847039dfdb3c95b180b0b6ed3f85ac8f1c74d343` |
| Reference ZIP | `d34d4722777b08fad4bfad61a6d562172e762f64d68699ce5424065bfd227843` |
| Candidate ZIP | `c2e6ee4363dd210c940d9f1f639562a143c58ee07c150a036dd18a273a5461b5` |
| Privacy Badger 2026.9.15 source ZIP | `8a969da530f62ec8cef8339d24dcbaab6e5e4afd7775e0236e6e239b42e82e67` |
| Privacy Badger extension-source fingerprint, 185 files | `bf7d9d67bbb6cbcea2d4bbac1c8c490f62c11fe1972ada6d39d48adb21791152` |
| Chrome for Testing executable | `be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e` |
| Native network/lifecycle harness | `8bb0e46fc3beac3410a14bd1ed08bc9efbcfe18b190cecc5a9fa2d9e17831e21` |
| Existing resource profiler | `5e776115526af51dba90e1aa50384cde525c3cb7344604f226827b63ab61ed90` |
| Baseline identity/status helper | `016c1c83cc47a45d682b8f496f56f5888b691689955a67e7549fca5988669664` |

The file fingerprint hashes a sorted JSON array of relative path, byte length
and file SHA-256. Browser-created `_metadata` and Git metadata are excluded;
symbolic links are rejected. Source fingerprints are verified before and after
the native lab. Preparing a second set of snapshots reproduced all three file
fingerprints exactly. The temporary Git index preserves the real index.

The competitor archive declares MV2. Unmodified, offline initialization probes
gave these results after a bounded wait:

| Browser | Observed initialization failure |
| --- | --- |
| Chrome for Testing 121.0.6167.184 | `browser is not defined` |
| Edge 150.0.4078.48 | `browser is not defined` |
| Brave 156.1.98.60 / Chromium 156.0.8078.48 | `browser.scripting` unavailable; content-script registration fails |

In each case `badger.INITIALIZED` stayed false and the action map stayed empty.
The 75,955-entry CNAME source loaded, but that alone does not establish an
operating blocker. It was neither modified nor copied into WardenOne.

## Method and controls

Windows 10.0.19045 x64, Intel i5-12400F, 12 logical processors, Node 24.18.0,
Chrome for Testing **121.0.6167.184**, CPU throttle 1. This pins a supported
Chromium baseline, not the current stable browser. Performance measurements ran
serially without the maintainability gate competing for CPU.

The native lab ran five fresh disposable profiles per build: extension off,
reference and candidate. Build order alternated each round. Each profile ran
the same six default request cases and fingerprint workload; each WardenOne
profile also ran header policies, native rule-write rejection, forced worker
termination and ordinary idle shutdown. Reports preserve all samples and
explicit statuses: blocked, stripped, detected-but-not-blocked, allowed,
unsupported or error. Missing server receipt only counts as blocked when a
matched native rule actually has a block action; an unexplained absence fails.

HTTPS fixture hostnames map to loopback; all other host resolution is refused.
The server records fixed synthetic Cookie/Set-Cookie values. Even the
`google-analytics.com` and `accounts.google.com` requests reach only this local
server. The public throwaway TLS fixture and certificate-error flag apply only
to disposable test profiles. Remote feeds are unavailable and explicitly
excluded from coverage and performance conclusions.

Chrome for Testing 121 blocks third-party cookies by default. The lab disables
`TrackingProtection3pcd` and sets cookie-friendly preferences in its disposable
profiles. Every extension-off request must both send the old cookie and store
the new cookie, preventing browser policy from being credited to WardenOne.
The initial cookie-confounded preflight is excluded from the final results.
The relevant test flag is documented in the
[Chromium developer announcement](https://groups.google.com/a/chromium.org/g/chromium-dev/c/EJFYTIS0tAk).

Native network probes run in a dedicated isolated world so a page-side fetch
wrapper cannot mask DNR/header behavior. This is the native enforcement lane;
it does not score page-wrapper interception. Rule IDs are resolved to their
installed action, and cookie results require server receipt and native cookie
storage inspection. Header priority and allow interactions follow the browser's
[DNR semantics](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

## Protection and compatibility observations

Every cell below represents five clean runs of the same case on each build.

| Case | Extension off | Reference | Candidate |
| --- | --- | --- | --- |
| Packaged tracker hostname | Allowed | Blocked, 5/5 | Blocked, 5/5 |
| Same-site API with old/new cookie | Allowed | Allowed | Allowed |
| Cross-site authentication cookie | Allowed | Allowed | Allowed |
| Unknown third-party host with cookies | Allowed | Allowed | Allowed |
| Declared known alias fixture | Allowed | Unsupported classification | Unsupported classification |
| Unknown same-site alias | Allowed | Allowed | Allowed |
| Automatic tracker cookie rule, supplied trusted fixture domain | Not applied | Incoming stripped; outgoing sent | Incoming stripped; outgoing sent |
| Manual firewall cookie strip for fixture tracker | Not applied | Outgoing stripped; request delivered | Outgoing stripped; request delivered |

The packaged tracker matched rule 2 in `trackers`; no server receipt occurred.
Authentication matched the existing `grabber_compat` allow rule 167 and retained
both cookie directions. These are controlled cookie-flow checks at default
settings, not completed real-account OAuth/SAML sign-ins.

The known-alias case declares `metrics.shop.wardenone-baseline.example.org` →
`tracker.wardenone-baseline.example.net`. It uses loopback address mapping,
not a real DNS CNAME chain, and installs no alias dataset. The adapter labels
classification unsupported; the separate network outcome is received, with
cookies intact. The same requested hostname can exercise a real trusted mapping
in Phase 01. No discovery or DNS-uncloaking success is claimed here.

The cookie-policy case supplies only the trusted-domain dependency to the
unmodified production `applyTrackerCookieRule()` owner in the disposable worker.
It does not test feed discovery and adds no tracker block rule. Session rule
900007 removes incoming Set-Cookie, while the server still receives
`baseline_old=fixed`, in all ten WardenOne runs. The manual policy uses the real
firewall page/message path; dynamic rule 950000 removes that outgoing cookie
without blocking delivery. These observations establish the Phase 02 gap.

At default settings, fingerprint noise is off. Repeated canvas reads agreed,
WebGL was available, and repeated AudioBuffer reads retained the application's
0.25 samples on every build/run. This is a limited API workload, not evidence
that fingerprinting scripts were detected or that an opt-in privacy profile is
coherent across frames, workers and reloads.

## Lifecycle and resource observations

Each WardenOne run rejected a malformed native session-rule replacement and
retained the complete prior rule set. Forced termination replaced the worker's
private heap while session DNR rules survived. Later header-policy requests
followed a fresh page navigation; this does not test existing-tab policy-context
recovery after forced termination.

For the ordinary-idle case, all extension pages and worker debugger sessions
were closed/detached. The worker stopped naturally after 35.2–42.3 seconds.
Closing a separate blank tab triggered a new worker target before the readiness
helper ran. The original page remained open and retained its edited input value.
Both builds passed 5/5. This avoids the debugger keeping the worker alive, as
described in Chrome's
[worker lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Five samples per cell, milliseconds, **median / p90 / max**:

| Measurement | Off | Reference | Candidate |
| --- | ---: | ---: | ---: |
| Browser launch to readiness, wall | 252 / 259 / 259 | 978 / 1117.6 / 1138 | 968 / 1079.2 / 1138 |
| Browser-process accumulated CPU at readiness | 406.25 / 437.5 / 437.5 | 1046.88 / 1137.5 / 1156.25 | 1031.25 / 1125 / 1156.25 |
| Forced termination and readiness, wall | — | 156 / 157.6 / 158 | 155 / 159 / 161 |
| Ordinary idle wake and readiness, wall | — | 72 / 114.2 / 115 | 113 / 113.6 / 114 |
| Browser CPU during ordinary wake | — | 93.75 / 112.5 / 125 | 31.25 / 96.88 / 109.38 |

Wake windows include DevTools readiness checks; startup CPU is browser-process
CPU, not extension-attributed CPU. Short CPU counters are quantized, so a zero
does not mean no work. Natural wake medians differ in this small sample; these
measurements establish a baseline and do not establish a speedup or regression.

Initial installed inventory was identical: 136 dynamic rules, 142 session rules
and eight enabled static rulesets. After the synthetic policies, local storage
was 12,996–13,011 bytes and session storage 1,449 bytes. These are fixture state,
not a user-data retention estimate. After the first request, worker V8 used heap
median/p90/max was 7.91/9.96/11.26 MiB for the reference and
7.91/9.97/11.29 MiB for the candidate, without forced GC. Unavailable extension
heap in the off build stays unavailable rather than becoming zero.

The existing `perf-profile.js` additionally measured five cold and five warm
navigations per workload/build, in separate fresh browser profiles per build.
Cold means first navigation with browser cache cleared; warm means reload.
The same bundled runtime fingerprints above apply. Main-thread task medians:

| Workload | Cold off / reference / candidate, ms | Warm off / reference / candidate, ms |
| --- | ---: | ---: |
| Neutral article | 39.94 / 179.08 / 161.95 | 36.60 / 163.39 / 163.56 |
| DOM churn | 286.52 / 607.92 / 571.18 | 275.50 / 540.99 / 558.63 |
| Eight child frames | 66.42 / 263.05 / 271.05 | 60.29 / 252.29 / 248.70 |
| Thirty child frames | 161.34 / 486.21 / 500.27 | 167.27 / 442.67 / 397.61 |

Cold page-target V8 heap after GC, median MiB:

| Workload | Off | Reference | Candidate |
| --- | ---: | ---: | ---: |
| Neutral article | 0.43 | 2.68 | 2.68 |
| DOM churn | 0.68 | 3.22 | 3.22 |
| Eight child frames | 1.85 | 6.72 | 6.72 |
| Thirty child frames | 5.55 | 17.67 | 17.69 |

Raw reports retain p90/max and each sample for these workloads. Task time is
renderer main-thread work; V8 heap is not total browser RAM or DNR rule memory.
The mixed timing changes and nearly equal heaps do not establish an optimization.
Full remote-feed load, hours-long sessions, account authentication and the full
fingerprint consistency matrix remain outside this baseline's measured scope.

## Reproduction and artifacts

Use Node from `.node-version`, the pinned browser executable and the source ZIP
whose hash is above. Choose a fresh ignored output directory; the preparation
tool refuses to overwrite snapshots. It captures the current candidate through
a separate Git index without creating a commit. Archive extraction validates
entry boundaries and bounds expanded size. Later development trees will have a
different candidate identity, which must be recorded with their results.

```powershell
$baselineRoot = 'tmp/privacy-baseline-new'
$baselineBrowser = 'tmp/chrome-minimum-121/chrome-win64/chrome.exe'
& 'C:\Program Files\nodejs\node.exe' tools/prepare-privacy-baseline.js --out $baselineRoot --reference 273c43a0051d6c3fe12c6871944ed7e8822d8af3 --privacy-badger "$env:USERPROFILE\Downloads\privacybadger-release-2026.9.15.zip" --browser $baselineBrowser
if ($LASTEXITCODE -ne 0) { throw 'Snapshot preparation failed' }
& 'C:\Program Files\nodejs\node.exe' tools/browser-privacy-baseline.js --snapshots "$baselineRoot/snapshots.json" --runs 5 --out "$baselineRoot/network.json"
if ($LASTEXITCODE -ne 0) { throw 'Native baseline failed' }
& 'C:\Program Files\nodejs\node.exe' tools/perf-profile.js --edge $baselineBrowser --offline --baseline "$baselineRoot/reference" --candidate "$baselineRoot/candidate" --variants off,base,on --runs 5 --pages /article-neutral.html,/churn.html,/frames.html,/frames-heavy.html --out "$baselineRoot/resources"
if ($LASTEXITCODE -ne 0) { throw 'Resource profile failed' }
```

The `base` profiler column is the reference; `on` is the candidate. The resource
profiler keeps its normal remote-feed readiness behavior unless `--offline` is
explicitly selected; offline coverage is labelled unavailable.

Local raw artifacts are ignored rather than packaged:

- `tmp/privacy-baseline-2026-10-26/`: immutable source/file inventories,
  compatibility-probe logs and reproduced snapshots.
- `docs/perf/traces/privacy-baseline-2026-10-26/network.json`: 15 complete native
  runs, headers, DNR actions, CPU/heap, lifecycle results and explicit statuses.
- `docs/perf/traces/privacy-baseline-2026-10-26/resources.json` and `.md`:
  existing profiler output, including raw samples, spread and readiness metadata.

The completed `network.json` SHA-256 is
`639136c49225ac72ee7c4d7aac2b97ffde572ab980a80e18006729bc7300e6c5`;
`resources.json` is
`aaae62f6c1b530a5c3fdb92e5635ffddbc75a8c630d7da1313d8ccaae70b9a08`.

The new gate suite verifies immutable identities, refusal of ambiguous blocking,
preservation of unavailable metrics and import safety. The existing profiler
suite verifies snapshot selection and offline launch behavior. Native browser
results remain separate from these deterministic tests.

The final maintainability gate passed all **314 suites**, including generated
content parity, syntax, package and compatibility checks. `git diff --check`
passed. The measured runtime snapshots still match their recorded fingerprints;
the work is local and uncommitted.

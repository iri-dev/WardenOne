# Tracker learner evidence — Phase 03

Implemented 26 October 2026 within the existing tracker learner. The count remains
109 protections and the release version is unchanged. No permission, external
lookup, remote hostname submission or separate switch was added. Work stays local.

## Evidence and enforcement boundary

The fixed evidence vocabulary distinguishes page claims, page API/path inference,
browser network observations, packaged tracker matches, local CNAME mappings and
known fingerprint libraries. A page cannot supply a privileged source, confidence
or canonical target. Unknown signals, plain resource discovery, malformed hosts,
protected authentication/payment/provider domains and established media exemptions
do not create evidence. Valid page behavior can still produce a mistaken suggestion.

A targeted `onBeforeRequest` observer matches actual HTTP(S) hostnames to local
data. It covers script, XHR, image and ping requests, retaining curated resource
type and initiator restrictions. Known fingerprint libraries use script/XHR only;
fraud and bot-check vendors do not gain fingerprint classification. Unknown hosts
are left to existing protections. CNAME aliases match exact hostnames and aggregate
against the validated canonical service; page-claimed mappings have no authority.

Frame attribution verifies the event's document ID, active lifecycle and initiator
origin using `webNavigation.getFrame`, then walks the current parent chain with
cycle/depth limits. It rechecks the top document after asynchronous classification.
Stale, opaque and unverifiable frame contexts are skipped. Page reports use the
browser-provided sender metadata through the same frame checks, rather than a
claimed top URL or `sender.tab.url`. See Chrome's
[webRequest fields](https://developer.chrome.com/docs/extensions/reference/api/webRequest)
and [webNavigation frame API](https://developer.chrome.com/docs/extensions/reference/api/webNavigation).

Browser observations plus a trusted local match are shown as **corroborated**;
page behavior is **inferred** and page claims are **unverified**. These describe
provenance, not a measured probability that a service is harmful. Proposals show
source, confidence, reason and day-coarse age. Three sites, three coalesced
observations and two actual browser sessions remain required. Every new learner
block still requires explicit approval. Independent existing list policies retain
their own authority.

New approval of a mapped canonical service covers its confirmed aliases. The UI
identifies that scope. Existing global approvals and per-site choices do not gain
alias authority during migration. Alias learner rules retain the existing narrow
image/XHR/ping/webtransport resource scope, excluding scripts and frames. New site
Allow covers learner-controlled aliases immediately; other protection owners can
still block a request. Policy changes are serialized with observations. Native
rejection or storage failure returns failure and restores the prior decision and
native band; an over-budget approval is rejected without silently truncating it.

## Repetition, privacy and storage

Signals are coalesced by site, tracker and signal within each day and browser
session. Network requests also coalesce while classification is in flight. Each
observation entry point and the shared observation queue admit at most 64 pending
jobs. Repeated proposals create one pending item and one history event; the popup
shows at most 60 proposals. Evidence counters have fixed keys and bounded values.

The durable cap remains 600 tracker domains, with 30-day expiry for unapproved
observations and ignored suggestions. Explicit blocks and per-site settings keep
their prior retention. Trusted observations may replace an unverified candidate
at capacity; page reports cannot displace an explicit decision. Session-only views
remain bounded to 40 sites × 12 tracker domains and survive worker suspension but
not a browser restart. Day rollover does not count another browser session.

Raw page tracker reports no longer create durable visited-site-to-tracker history
edges. Proposal history has no visited-site URL and uses day-coarse time. The
learner does not retain alias URLs, query tokens or visited site names in local
storage. Clear observations also clears source counters and session receipts while
preserving explicit decisions. This does not change independent Network Log or
other protection history settings.

## Sketch comparison and migration

`tools/bench-tracker-sketch.js` compares the actual Phase 02 functions with the new
128-bit implementation in the same Node realm. The fixed corpus contains 20,000
three-site groups across eight install salts: 160,000 cases per algorithm per run,
five alternating-order repeats. Hosts include validated IDNs and private-suffix
tenants. On every run, the old sketch missed 2,160 third-site counts (**1.35%**)
and the new sketch missed 120 (**0.075%**), an 18-fold reduction. Neither overcounted
duplicate sites. These are synthetic sketch rates, not real browsing prevalence.

An additional 800 groups deliberately selected to collide with the old sketch
missed 800/800 with 32 bits and 1/800 with 128 bits. That adversary knows the profile
salt; websites do not receive it. Both are compact probabilistic structures, not
cryptographic anonymization. A profile holder can test guessed site names, more
precisely with the wider sketch. No site names are stored in either format.

Marks take 34 rather than at most 10 JSON bytes, adding at most 14,400 bytes across
600 pre-threshold candidates. The new routine costs roughly 1.1 seconds versus
0.32 seconds for 160,000 synthetic three-site cases on this machine; it is slower
per operation, with the browser impact measured separately below. Marks disappear
when the three-site threshold is reached or candidacy ends. Valid numeric marks
retain their exact old algorithm until completion or expiry; migration never
rebuilds them from unavailable names or counts old sites a second time. Invalid
marks cannot preserve an unsupported distinct-site count.

The final valid-host report is
`docs/perf/traces/tracker-phase03/sketch.json`. Earlier scratch reports used
invalid punycode inputs or different VM realms for timing; those timings are not
the evidence above.

## Pinned proposal corpus

The versioned 22-case synthetic corpus includes eight positives and fourteen
negatives: CNAME tracking, known tracker feeds, fingerprint libraries, identifier
and beacon observations, plus federated login, payments, video/CDN hosts, shared
tenants, fake authority, essential analytics and anti-bot behavior.

| Proposal result | Phase 02 | Phase 03 |
|---|---:|---:|
| True positives / false negatives | 3 / 5 | 7 / 1 |
| False positives / true negatives | 5 / 9 | 2 / 12 |
| Precision | 37.5% | 77.78% |
| Recall | 37.5% | 87.5% |
| Automatic learner blocks | 0 | 0 |

The baseline lacks browser-network learning; those cases are explicitly recorded
as unsupported and count as missed proposals. The candidate still proposes two
ambiguous but essential page-behavior cases as **inferred** and misses one unlisted
tracker without page evidence. Approval remains necessary precisely because those
false suggestions remain possible. This is proposal calibration on a pinned small
corpus, not a claim of population accuracy or Privacy Badger superiority.

## Native browser and resource validation

Five alternating fresh-profile comparisons passed in Chrome for Testing
121.0.6167.184 on Windows 10.0.19045, i5-12400F/12 logical CPUs, Node 24.18.0,
headless with software GL. Each candidate run verified three real sites and two
browser sessions, redirect and cross-origin iframe attribution, repeat coalescing,
per-site opt-out, no rules before approval, popup source/confidence, Ignore,
explicit Block, a native learner-rule match plus absent server receipt after Block,
restored delivery after site Allow, private persistence and observer removal when
disabled. Approval installed eight learner rules, none covering scripts or frames.
Baseline isolated-world network learning is reported as unsupported.

The lab disables independent tracker/CNAME/cookie/fingerprint blocking in both
builds so requests can reach the observer. This is an evidence/enforcement test,
not the default blocking configuration. Requests originate in isolated fixture
worlds to distinguish real browser observations from MAIN-world page reports.

| Five-run median | Phase 02 | Phase 03 |
|---|---:|---:|
| Browser/worker startup | 1,252 ms | 1,270 ms |
| Worker heap after GC | 4,595,672 B | 4,699,108 B |
| 100 repeated tracker requests, wall time | 154 ms | 168 ms |
| Same burst, all-browser-process CPU | 93.75 ms | 187.5 ms |

The burst adds about 94 ms CPU and 14 ms wall time for 100 requests, despite one
coalesced observation. Process CPU ranges were 78.125–125 ms and 93.75–281.25 ms;
these include browser/page work and are not isolated worker CPU. Startup medians
include Chrome startup. The retained worker increment is about 101 KiB on this
five-run sample; single captures vary with worker compilation. The targeted
observer has 1,724 URL patterns, with bounded work queues and no blocking callback.

Separate five-run cold/warm offline page profiles kept default protections active,
with 20 CNAME rules and 21 bidirectional tracker-cookie rules verified in both
builds. The candidate observer was registered; the baseline had no such observer.

| Page | Cold task ms, Phase 02 → 03 | Warm task ms, Phase 02 → 03 |
|---|---:|---:|
| Article | 210.72 → 199.50 | 185.70 → 193.63 |
| DOM churn | 510.07 → 526.00 | 517.23 → 524.99 |
| Eight frames | 259.04 → 255.31 | 260.53 → 258.91 |
| Thirty frames | 479.15 → 483.72 | 513.42 → 490.11 |

Page heap medians changed by at most 0.05 MiB, with the 30-frame page varying
between roughly 16 and 18 MiB in both builds. The largest positive cold-task
median delta was 15.93 ms (+3.12%) on churn. These samples show a small bounded
cost acceptable for this change; they do not establish zero overhead or performance
on low-end devices. Worker CPU metrics are unsupported in this Chrome version and
remain null. Remote-feed coverage is not measured by the offline profile.

Fresh guest Edge 150.0.4078.48 profiles also loaded and played the existing public
YouTube and Twitch video fixtures, with the observer and all 21 default cookie
rules verified before navigation. Each had a 10-second warmup and 15-second
measurement. This covers public playback, not authenticated accounts, checkout,
every embed or every live stream. Privacy Badger's supplied MV2 package remains
incompatible with available Chromium; it was not scored, and the owner has no
compatible Firefox installation.

The immutable reference is the final Phase 02 runtime (133 files), fingerprint
`4a545725978d64fb7375b8039a69d684a9b3ee35174472d5e3f4ba605f0914ae`.
The tested Phase 03 runtime (135 files) is
`ce8b081ab4722e2d07c0c5780cd44151ebf8daf51fcd55e8070d237ea083232e`,
with ZIP SHA-256
`8b4df61e947acede6696a41158e1ebaa4ba68b5fbfeb65c4a26bfa84eae11de6`.
The pinned Chrome executable SHA-256 is
`be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e`.
Raw reports stay local under `docs/perf/traces/tracker-phase03/`:
`native.json`, `resources.json`, `playback.json`, `corpus.json`, `sketch.json`.

Unit coverage includes forged vocabulary/source/target, malformed data, stale
documents, mismatched origins, nested parents, IDN normalization, private tenant
boundaries, per-site/global disablement, storms, day rollover, capacity, legacy
scope/membership, native rejection and storage rollback. The new data parity and
regression suites are mandatory in the maintainability gate.

The final full gate passed all **319 suites**, source/generated parity, source
inventory, package budgets, shipped-script syntax and encoding checks. It ran
against temporary-index tree `a4a81f9be4a5635e10c201cc6d5130e8c01722e9`;
the real staging area remained empty. Its log is
`tmp/tracker-phase03/final/gate.log`. The measured runtime was also compared byte
for byte with the workspace; `identities.json` records report/tool hashes. No
commit, push or version change was made.

Reproduce the core comparisons after preparing immutable runtime directories:

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/bench-tracker-sketch.js 'tmp/tracker-cookies-phase02/final/candidate/background.js' 'tmp/sketch.json'
& 'C:\Program Files\nodejs\node.exe' tools/bench-tracker-evidence.js 'tmp/tracker-cookies-phase02/final/candidate/background.js' 'tmp/corpus.json'
$env:WARDENONE_HEADLESS='1'
$env:WARDENONE_SOFTWARE_GL='1'
& 'C:\Program Files\nodejs\node.exe' tools/browser-tracker-learning.js --browser tmp/chrome-minimum-121/chrome-win64/chrome.exe --reference tmp/tracker-cookies-phase02/final/candidate --candidate tmp/tracker-phase03/final/candidate --runs 5 --out tmp/native.json
& 'C:\Program Files\nodejs\node.exe' tools/perf-profile.js --edge tmp/chrome-minimum-121/chrome-win64/chrome.exe --baseline tmp/tracker-cookies-phase02/final/candidate --candidate tmp/tracker-phase03/final/candidate --cname-trackers --variants base,on --offline --runs 5 --pages /article.html,/churn.html,/frames.html,/frames-heavy.html --out tmp/resources.json
```

Rollback after a storage failure is best effort if the browser also rejects the
restorative native update; that compound failure is not covered by the success
claim above. Failed decisions return an error and remain available for retry.

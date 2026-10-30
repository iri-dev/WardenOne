# Default CNAME policy — 2026-10-26

This supersedes the default-off policy in `cname-toggle-audit.md`. The switch
remains independent and the protection count remains 109. No release version
changed. Work remains local.

The [catalog audit](cname-catalog-audit.md) later replaced the four-provider
dynamic block band described below with a packaged ruleset; the default and switch
behaviour here still hold.

## Classification boundary

Only exact aliases in the packaged AdGuard mapping qualify. A qualifying alias
must resolve within that mapping to a different site identity and one of these
reviewed dedicated tracking domains: `eulerian.net`, `ca-eulerian.net`,
`etracker.com`, `at-o.net`, `wt-eu02.net`, or `webtrekk.net`. Both the alias and
target must pass the existing tracker and media compatibility exemptions.
The native rule also constrains hostname label depth, so a listed hostname does
not grant authority to block its unlisted descendants.

The pinned source revision is `d519e17ee10e2d1c5b2762a78a8e11ec2b38ce5a`, dated
2026-10-20. Of 1,666 published aliases in the four selected provider files, 1,663
end at the reviewed tracking domains. Three records remain in the reproducible
source data but cannot produce a CNAME block or a curated log classification:

| Alias | Unreviewed/shared target |
| --- | --- |
| `ea.mnt.fr` | `e.emailretargeting.com` |
| `tr7593.pollin.de` | `hg0n5n.smoxycdn.net` |
| `web.marketing.jellybelly.com` | `wt-tracking-aws-us-842251896.us-east-1.elb.amazonaws.com` |

“Confirmed” here means an exact published alias plus a reviewed tracking target;
the extension does not claim to have verified the site's current DNS records.
Mapping changes arrive in reviewed builds. The offline source-parity gate checks
the snapshot, source hashes and license. Runtime loading accepts only the
extension's local JSON and validates metadata, hostnames, chains and size bounds.
It never submits visited hostnames to a resolver or adds a remote fallback.

Unknown aliases, same-site targets and unrecognized targets add no CNAME rule.
A failed initial load adds no rule. A failed replacement retains the previously
validated native rules and reports reconciliation failure; it creates no guessed
classification. Existing independent protections continue to decide requests.

## Compatibility and control

Login and payment hosts use `LOGIN_COMPAT_NEVER_BLOCK_DOMAINS`; media hosts use
the existing compatibility set. Exclusions apply to initiators, and the compiler
filters protected aliases and targets. CNAME rules do not block navigations,
frames, stylesheets, fonts or media resources.

Worker and popup defaults are true. A stored explicit false is preserved by
normal configuration merging, presets and Enable everything. Missing settings
receive the default; the older first-party heuristic switch has no authority
over this protection. Its own site exception disables only this policy.

Per-site exceptions and active permanent/temporary site pauses are included in
native excluded initiator domains. Once reconciliation succeeds, subsequent
requests in the already open page are exempt without navigation. The exclusion
budget accommodates the existing 1,000 pauses and 500 site overrides together.
Previously cancelled requests are not replayed.

## Validation

The complete maintainability gate passed all 315 suites, generated-file parity,
syntax, package footprint and Store profile checks. It ran with an isolated
`final.index` containing the complete local candidate; the real Git staging area
remained empty. Log: `tmp/cname-default-2026-10-26/gate-final.log`. All 133 current
runtime files matched the measured snapshot byte for byte. Later edits affected
only audit text and regression tests, not that runtime snapshot.

`tools/test-cname-protection.js` covers default-on behavior, stored off choices,
independent presets, unrecognized targets, protected aliases/targets, failed
initial classification, atomic replacement failure and the combined exception
limits. The generated popup/Settings defaults both agree with the worker.

Five fresh Chrome 121 profiles per build passed native network checks. Each
candidate installed 20 supported regex rules covering 1,663 aliases. The default
blocked the listed host; enabled-policy tests also blocked its trailing-dot
spelling and its WebSocket request;
unknown hosts, unlisted descendants, lookalikes and ordinary API requests passed.
Both real UI controls switched native enforcement off and on. Authentication and
Stripe fixture requests sent existing cookies and stored response cookies; pages
on either protected origin could request the listed alias. Own site exceptions
and full site pauses worked in the existing page without reloading. Rejected
native updates retained the previous rules, and direct alias navigation worked.
These are controlled fixture flows, not completed real logins or payments.

## Performance decision

Measurements used Chrome for Testing 121.0.6167.184 on Windows 10.0.19045,
an i5-12400F with 12 logical CPUs, Node 24.18.0, no CPU throttle and local
fixtures with external DNS disabled. Resource comparisons used the **same
immutable candidate** with only its CNAME setting changed: native readiness
confirmed 0 rules in `base` and 20 in `on`. Each cell contains five cold and
five warm navigations. The initial order was off then on.

| Workload | Cold task median, off/on (ms) | Warm task median, off/on (ms) | Cold page heap after GC, off/on (MiB) |
| --- | --- | --- | --- |
| Article | 174.86 / 164.83 | 171.24 / 155.50 | 2.80 / 2.80 |
| DOM churn | 495.17 / 476.99 | 494.28 / 477.25 | 3.21 / 3.21 |
| Eight frames | 212.50 / 200.87 | 205.02 / 196.40 | 6.71 / 6.71 |
| Thirty frames | 400.69 / 397.09 | 333.97 / 350.59 | 17.52 / 17.51 |

The thirty-frame warm result increased 16.62 ms (5.0%); its p90 increased from
426.75 to 469.33 ms. A second five-run comparison reversed the order, on then
off. Cold medians were 430.26 / 428.15 ms off/on; warm medians were 426.96 /
423.41 ms. Warm p90 was 431.24 / 436.96 ms. Both reports retain raw samples;
the heavy frame workload varies substantially. The first median increase did
not reproduce. Lower medians elsewhere do not establish a speed improvement.

Against the preceding opt-in candidate, fresh-browser native runs measured
default worker V8 heap medians of 6.748 / 7.043 MiB (about **0.295 MiB added**).
Startup to reconciled readiness was 961 / 1,074 ms (about **113 ms added**).
Allowed unknown/API/authentication/payment fixture requests had a 4 ms median
in both builds, with maxima 5 / 6 ms. Browser CPU deltas were quantized at zero
median, which cannot establish zero CPU cost.

The bounded cost is acceptable for default operation in this lab: 20 native
rules, no per-request DNS service, small worker heap growth, about a tenth of a
second of additional initial readiness, and no reproducible material increase
in steady-state fixture task medians. V8 heap is not total process RAM; this
does not measure worker CPU directly, every device, remote-feed coverage or all
real websites. DevTools holds the worker awake during resource profiling.

Live Edge 150.0.4078.48 checks used the current defaults with 20 native rules:
YouTube advanced 1.808 → 17.109 seconds and Twitch advanced 7.705 → 23.036
seconds. Both finished readyState 4, unpaused, without a browser error. This
single public-video smoke test does not cover every account or ad break.

## Reproduction and artifact identities

Frozen candidate: `tmp/cname-default-2026-10-26/candidate`, tree
`575103c8b975917e3552fa9fb07882a9bad07d85`, 133 runtime files, fingerprint
`2499f7630b7c0e5b5f809af08766f00ff9b878318ff9c34f9ebcee952c46d111`.
Candidate ZIP SHA-256:
`9b842ce5cd66707d3ca58d33170f531d8c39b7d20600e75aa0a5aebe460fb665`.
The native reference is the preceding opt-in candidate, fingerprint
`f10673594c5062a9e6c4a057d81fd954734fc07100f7ea5b7b02d76cd9246aec`.
Browser executable SHA-256:
`be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e`.

Local raw reports in `docs/perf/traces/cname-default-2026-10-26/`:

| Report | SHA-256 |
| --- | --- |
| `network.json` | `89df523877ea3cb70aa9fb69614330973b24822a390f7fbc509f26283af33e60` |
| `resources.json` | `28650ef8b4af2fe800de66c57eb6d8f5e5b67483dbb5249a60aa70854fbf9334` |
| `resources-heavy-reverse.json` | `9d3cbc6a10df97d3d973d42352334d726690975d9962af3ef72f0f3478ac23d3` |
| `playback.json` | `129209f9a0fe83fa39b1801bb8123bd827abffc6b08c2fb061d35bf05cc4dd0d` |

Run `tools/browser-cname-protection.js` with the frozen candidate and preceding
opt-in candidate, the pinned browser, `--runs 5`, and a new `--out` report.
Run `tools/perf-profile.js` with both `--baseline` and `--candidate` pointing to
the frozen candidate, plus `--baseline-cname-off --cname-trackers --variants
base,on --offline --runs 5 --pages
/article.html,/churn.html,/frames.html,/frames-heavy.html`. For the order check,
use `--variants on,base --pages /frames-heavy.html`. The live wrapper is
`tmp/cname-default-2026-10-26/live-playback.cjs`; it asserts the default without
changing either tracker setting. Raw reports and disposable snapshots stay local.

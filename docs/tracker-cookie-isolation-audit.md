# Bidirectional tracker-cookie isolation — Phase 02

For the 29 October service-cookie changes and repeated Privacy Badger comparison,
see [the current cookie audit](cookie-service-isolation-audit.md). The earlier
[dual-opponent rematch](dual-opponent-rematch-audit.md) records the initial gap.

Implemented 26 October 2026 under the existing **Block third-party cookies**
switch. The owner requested no separate toggle. Its default and stored choices
remain unchanged, and the protection count remains **109**. No version bump,
new permission, new dataset or external lookup was added. Work remains local.

## Policy boundary

The existing curated tracker response rule, session ID `900007`, now removes
outgoing `Cookie` and incoming `Set-Cookie` together. It uses the exact domain
scopes from the packaged tracker rules; a listed subdomain does not authorize
classifying its unlisted parent or siblings. Curated scopes retain Chromium's
third-party initiator classification. Confirmed CNAME aliases use the shared
Phase 01 resolver/compiler and exact requested-host matching, independently of
whether CNAME request blocking is enabled. Unknown aliases and unrecognized
canonical targets add no cookie-isolation rule.

CNAME header rules occupy the independently budgeted session band
`901000–901299`. They reuse the same two-direction action. Where an alias already
falls within a curated tracker scope, its CNAME rule is first-party-only; the
curated rule handles third-party requests. This prevents duplicate overlapping
header strips while covering same-site tracking aliases.

Both policies cover the security resource inventory excluding `main_frame`.
Top-level navigations remain untouched. Login, payment, CAPTCHA and media hosts
are excluded as both destinations and initiators. The existing passive rule for
unclassified third-party pixels/beacons remains response-only, with its original
two resource types. Ordinary cross-site scripts, frames and API requests gain no
new restriction solely because they are cross-site.

The passive policy retains its original login destination exemptions. Its new
exclusions are limited to explicit site exceptions and pauses; the broader
login/media initiator exemptions belong only to known-tracker isolation.

The cookie site's exception is now coordinated across page and worker behavior.
`siteOverrides[host].blockThirdPartyCookies = false` and active permanent/timed
site pauses exclude subsequent native requests without reloading. Turning the
global cookie switch off removes both native cookie owners and leaves other
protection settings independent. A resource blocked by another protection still
does not load; cookie isolation does not install a request allowance.

## Priorities, failure and data handling

Header priority 2000 exceeds automatic compatibility allows (capped at 1999),
while explicit tracker-site choices and firewall allowances retain precedence.
Chrome applies header rules only above matching `allow`/`allowAllRequests`
priorities; see the [DNR evaluation rules](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation).
Known sensitive hosts are explicitly excluded instead of relying on low-priority
header rules being accidentally suppressed.

Firewall `noop` removes that row's request decision for the selected resource
types; automatic cookie policy can still run. An explicit firewall allowance
suppresses it. Manual firewall cookie stripping retains its outgoing-only action
and higher priority, including when combined with a request allowance. No new
authority is granted to page messages or learner proposals; this policy uses
packaged curated scopes and confirmed local aliases, not unapproved observations.

Classification data and all planned rules are prepared before one atomic native
replacement. Empty/unavailable classification and rejected updates retain the
previous installed rules, return failure to the reconciler, and leave the policy
cache eligible for a bounded retry. A failed initial load installs no guessed
rule. Disabling removes only this owner's IDs. Cookie values are never added to
extension history or diagnostics. Network Log labels matched rules **Known
tracker cookie policy**; attribution alone does not prove a cookie was present.

## Validation

The regression in `tools/test-tracker-cookie-isolation.js` failed against the
preceding immutable candidate and passes against this implementation. It covers
both header directions, exact aliases, unknown targets, overlap prevention,
protected hosts, original passive exemptions, stored off choices, both data-load
failures, rejected native writes, successful retries and foreign-owner survival.
The atomic, priority, serialization, logging, quota and site-scope suites retain
their security assertions. The final full gate passed all **316 suites**, syntax,
generated-file parity, package footprint and Store profile checks. Its log is
`tmp/tracker-cookies-phase02/final/gate.log`. The isolated `final.index` contained
the complete candidate; the real Git staging area stayed empty. Every current
runtime file matched the measured snapshot byte for byte after verification.

Five fresh profiles per build passed native Chrome 121 checks. The reference sent
an existing cookie to `g.doubleclick.net` while suppressing its response cookie;
it sent and stored cookies on the same-site confirmed alias `a.trowow.de`. The
candidate loaded both resources while the server received neither existing
cookie and Chrome stored neither response cookie. Candidate profiles installed
21 policy rules: the upgraded curated rule and 20 alias rules.

Each candidate completed 33 scenarios; each reference completed ten. Negative
controls preserved ordinary API, same-site, unknown alias, unlisted parent,
authentication, payment and media cookie flows. A real image request to an
unknown host retained the prior response-only pixel policy; its new complete
per-site exception restored cookie flow. Both real popup/Settings controls
disabled and re-enabled the existing setting, with no separate toggle present.

Native checks also covered redirect cookie reuse, Header Shield coexistence,
authentication/payment/media initiators, explicit firewall allow, manual cookie
strip, firewall noop, a competing priority-1999 allowance, rejected native
replacement, immediate site exceptions and pauses, master off/on, top-level
navigation, and restoration after shutting down and restarting the same browser
profile. Server receipts, browser cookie storage, native matched IDs and negative
controls establish the result; installation alone is not counted as protection.

## Performance

The final runtime was compared with the preceding Phase 01 candidate on Chrome
for Testing 121.0.6167.184, Windows 10.0.19045, i5-12400F (12 logical CPUs),
Node 24.18.0, no CPU throttle. External DNS was disabled for synthetic workloads;
remote-feed coverage is not measured. Both builds had the original cookie switch
and CNAME protection enabled. Readiness confirmed response-only cookies in the
reference and bidirectional cookies plus 20 alias header rules in the candidate.
Measurements ran separately from the full gate and live playback.

Five cold and five warm navigations per workload, reference/candidate medians:

| Workload | Cold task time (ms) | Warm task time (ms) | Cold page heap after GC (MiB) |
| --- | --- | --- | --- |
| Article | 179.15 / 172.46 | 163.84 / 166.85 | 2.80 / 2.80 |
| DOM churn | 498.45 / 486.14 | 485.09 / 483.99 | 3.22 / 3.21 |
| Eight frames | 218.32 / 212.24 | 214.77 / 211.80 | 6.72 / 6.71 |
| Thirty frames | 436.19 / 432.33 | 353.42 / 364.66 | 17.66 / 17.68 |

The largest median increase was 11.24 ms (3.2%) on the variable thirty-frame warm
workload. Its p90 decreased from 476.61 to 460.22 ms, and maximum from 491.26 to
462.71 ms. Raw values and spreads remain in the report. Lower medians elsewhere
do not establish an optimization claim. Reference ran before candidate in this
resource comparison; the native clean-profile runs alternated build order.

Initial worker V8 heap after GC was 4,553,984 / 4,597,872 bytes, about **43 KiB
added**, one readiness capture per build. This is not total browser RAM. Five
native clean-profile runs measured startup-to-readiness medians of 1,066 /
1,133 ms (ranges 1,056–1,098 / 1,112–1,167 ms). Known-tracker fixture request
latency medians were 6 / 7 ms. Chrome 121 did not expose worker task CPU metrics;
page task time is not a measurement of extension-worker CPU.

The measured steady-state cost is small relative to the fixture spread, with
bounded native rule capacity and no new per-request JavaScript or network lookup.
This supports the existing-switch rollout in this lab; it is not a guarantee
about every site, device, account or remote feed.

Live Edge 150.0.4078.48 playback used the default policy with 21 bidirectional
rules, without changing either tracker setting. YouTube advanced 1.583 → 16.927
seconds; Twitch advanced 7.878 → 23.204 seconds. Both finished readyState 4,
unpaused, without browser errors. These guest public-video checks do not cover
every account or ad break; authentication/payment cases are controlled cookie
fixtures rather than completed real transactions.

## Artifact identities and reproduction

Final candidate: `tmp/tracker-cookies-phase02/final/candidate`, tree
`471635842c75c9a5b26347491298e617a376bd44`, 133 runtime files, fingerprint
`4a545725978d64fb7375b8039a69d684a9b3ee35174472d5e3f4ba605f0914ae`.
ZIP SHA-256:
`e4274b80ae96f86961e886a6b6dafccee2a804a451e1549a8cbfc619e9aef7ec`.
Reference: `tmp/cname-default-2026-10-26/candidate`, fingerprint
`2499f7630b7c0e5b5f809af08766f00ff9b878318ff9c34f9ebcee952c46d111`.
Both derive from base commit `273c43a0051d6c3fe12c6871944ed7e8822d8af3`;
the fingerprints identify the uncommitted implementations actually measured.
Pinned browser SHA-256:
`be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e`.

Local reports in `docs/perf/traces/tracker-cookies-phase02/`:

| File | SHA-256 |
| --- | --- |
| `final-network.json` | `91b752148198f6731578e3e4827be18a1c3233b3d4775d61b7599edddbf6b251` |
| `final-resources.json` | `884e17e380b5ab864c48f95da6db640953d0dafce64f100aa4f09e5735b995ee` |
| `final-playback.json` | `f8efda0a9e6e3965e52d54afa6f4ea8be6b1978cc423693c4762e0cab7d4e2ad` |

Use `tools/browser-tracker-cookies.js` with the reference/candidate directories,
pinned `--browser`, `--runs 5` and a new `--out` report. Resource profiles use
`tools/perf-profile.js --baseline <reference> --candidate <candidate>
--cname-trackers --variants base,on --offline --runs 5 --pages
/article.html,/churn.html,/frames.html,/frames-heavy.html`. The live wrapper
`tmp/tracker-cookies-phase02/live-playback.cjs` verifies the default bidirectional
policy without changing either tracker setting. Snapshots and raw reports stay local.

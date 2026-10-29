# CNAME tracker protection — Phase 01

The [dedicated toggle update](cname-toggle-audit.md) and later
[default policy audit](cname-default-policy-audit.md) supersede the original
control wiring described below. The original snapshots and performance
observations remain unchanged.

Implemented 2026-10-26. The optional **First-party trackers** setting now applies
local CNAME evidence to native request blocking. It stays off by default.
Network Log can show a known alias and canonical target while blocking is off;
the request's outcome remains a separate field. Behavioral learner approval and
the existing first-party page heuristic retain their roles.

## Source and coverage

The mapping selects the complete Eulerian, Etracker, Webtrekk and AT Internet
JSON files from
[AdGuard's CNAME repository](https://github.com/AdguardTeam/cname-trackers/tree/d519e17ee10e2d1c5b2762a78a8e11ec2b38ce5a/data/trackers).
The pinned revision is `d519e17ee10e2d1c5b2762a78a8e11ec2b38ce5a`, dated
2026-10-20T23:58:41Z. It supplies **1,666 exact aliases**. This is an initial
four-provider scope, not the complete upstream catalog or live DNS discovery.
Unknown aliases follow existing protections.

The upstream
[MIT license](https://github.com/AdguardTeam/cname-trackers/blob/d519e17ee10e2d1c5b2762a78a8e11ec2b38ce5a/LICENSE)
and copyright are retained in `licenses/AdGuard-CNAME-MIT.txt` and packaged
notices. `docs/source-licensing.json` records the source; the inventory and
offline notices are regenerated through their existing builder. No Privacy
Badger data is redistributed.

`docs/cname-source-snapshot.json.gz` retains each original input body, path,
SHA-256, revision, date and license. Its SHA-256 is
`4a4a3de59c6f0e2ec2c672401aa32822b5360e1669251acfbd3435145c6a40bd`.
The generated `cname-trackers.json` is 82,531 bytes, SHA-256
`080313299d9c96a6a9f67329029faefc3c4ba71b3e68f8b68d7ddb0006de2aca`.

The deterministic generator normalizes case, IDNA and a terminal dot. It rejects
malformed hosts, IPs, ports, wildcard/suffix keys, conflicting targets, cycles
and chains beyond eight hops. Registrable-site apex aliases are omitted rather
than broadening one alias into an entire site or shared tenant. None of the
selected source records required that omission. Input and output size, alias
count and rule count are bounded; an exceeded limit fails the update.

The browser reads only the packaged mapping. There is no per-site DNS query or
hostname upload. The weekly source-review workflow downloads the same four
paths independently of browsing, checks the pinned license text, regenerates
data/notices, tests them and produces a candidate artifact. It does not commit,
push or update an installed extension. Reviewed extension builds carry mapping
updates; the prior source snapshot permits an offline rollback.

## Enforcement and authority

`resolveKnownAlias(host)` returns the normalized requested host, resolved
canonical target, pinned source and curated confidence. Enforcement matches the
**requested alias**, including when it shares the initiating site's registrable
domain. It does not depend on DNR's third-party classification.

`requestDomains` normally includes descendants. The compiler groups aliases by
hostname label count and combines each bounded domain list with a small regex
requiring that same count. The conjunction preserves exact-host meaning without
a large hostname-alternation regex. Native tests confirm an unlisted child of
a known alias remains reachable. A child explicitly present in the mapping
gets its own exact match.

The current data compiles into **20 dynamic block rules**, in the owned
730000–730299 band. The reserved maximum is 300; no existing rule-family budget
was reduced. Shared filtered dynamic reads, compare-before-write and the
reconciliation write batch are reused. Each generated regex was accepted by
Chrome 121's native `isRegexSupported()`.

Rules require master protection, tracker blocking and the explicit first-party
tracker option. They cover script, image, XHR, ping, WebSocket and WebTransport
requests. Top-level navigation, frames, styles, fonts, objects and media are
outside this new rule family. Existing tracker/provider, login and media
compatibility boundaries constrain requested hosts and canonical targets;
protected login/media initiators are excluded.

The popup's first-party tracker override now controls both the page behavior
and this native band. A site's tracker-off override also exempts that initiator
from this band. Full site pauses and higher-priority explicit firewall/user
allows retain their existing authority. Exceptions add no new general allow
rule, so unrelated malware, tracker and ad rules retain their authority.

Trusted browser request URLs supply Network Log's CNAME classification. A
page-provided target is never used to build a mapping or install these rules.
Curated alias evidence does not approve a behavioral learner proposal.

Load/validation failure leaves existing enforced rules in place and returns a
failed reconciliation result. The normal degraded-state marker, retry bound
and health reporting name the CNAME component. A rejected native replacement
does not certify a new policy; a later valid change can retry it. Turning the
feature or master switch off can remove the owned rules without loading data.

## Browser evidence

The reference is the immutable Phase 00 candidate, based on commit
`273c43a0051d6c3fe12c6871944ed7e8822d8af3`, packaged-file fingerprint
`e7f03292f3e40ef9b5a24ccb847039dfdb3c95b180b0b6ed3f85ac8f1c74d343`.
The new, uncommitted candidate was captured as tree
`4e7fe9fa591f1ff8a793b31a9579231fd65f2df5`, with 133 packaged files:

| Identity | SHA-256 |
| --- | --- |
| Packaged-file fingerprint | `4136e4b142eed14080e825986c4f73216ef2952c3bd1cb2830c985e4ad765b76` |
| Candidate ZIP | `a9d9de7b51291b22e646badaef629ee7264a2a4b5ad90ce5e775cfe644b9edd3` |
| Background worker | `c648fa369fb9c7c7fd96b27a51466b9471af7ff92d71a6b5dc654b6805ef9e9a` |
| Shared CNAME compiler | `69df3c9793c3d7311fc0a8e3210edbcfd9c66be6921394fb535326d34b2e3e45` |
| CNAME rule owner | `aec28e2c094e61976b003d2ba420fbbcc4aa77bc5ae90c0b19828e74178442c9` |

The candidate also includes other local edits. These comparisons are regression
checks, not an isolation of every change's performance cost. Manifest version
1.0.2 and permissions are unchanged by Phase 01.

Native lab: Windows 10.0.19045 x64, i5-12400F, 12 logical processors, Chrome for
Testing 121.0.6167.184, executable SHA-256
`be8d93bd8687bd55bbf418665e3eb6ff6b265e66778babe8677c9289fce2305e`.
Five fresh profiles per build, alternating build order. Measurement runs were
serial. Fixture hosts resolve to loopback, with other DNS refused. The public
throwaway TLS fixture is limited to disposable profiles. Native network probes
use an isolated execution world, separating DNR from page fetch wrappers.

The positive case is the real source pair `a.trowow.de` →
`customer.etracker.com`, requested by `shop.trowow.de`. The fixture declares
this trusted source mapping but does not resolve today's public DNS chain. The
selected alias is absent from the packaged third-party domain lists, so an
existing rule cannot mask the CNAME result.

Every result below passed all five repetitions:

| Case | Reference | Candidate |
| --- | --- | --- |
| Known alias, first-party option off | Allowed | Allowed |
| Known alias, option on | Allowed | Blocked by CNAME band |
| Same alias with terminal dot | Allowed | Blocked by CNAME band |
| WebSocket upgrade to known alias | Reached server | Blocked by CNAME band |
| Unknown same-site alias | Allowed | Allowed |
| Unlisted child of known alias | Allowed | Allowed |
| Lookalike hostname | Allowed | Allowed |
| Same-site legitimate API | Allowed | Allowed |
| Cross-site authentication cookie | Sent and accepted | Sent and accepted |
| Known alias requested by protected authentication initiator | — | Allowed |
| Rejected replacement | — | Complete prior CNAME band preserved; alias still blocked |
| First-party tracker off for this site | — | Allowed |
| Tracker-off override for this site | — | Allowed by this band |
| Full site pause | — | Allowed |
| Master protection off | — | Allowed |
| Protection re-enabled | — | Blocked again |
| Direct navigation to known alias | — | Page loaded |

Blocking requires an absent server receipt plus native evidence from the CNAME
band. Installed actions are independently verified as block actions. Missing
receipt without that evidence is an error. The authentication fixture verifies
both sending a seeded cookie and storing a response cookie, with browser-level
third-party-cookie phaseout disabled only in these disposable test profiles.
It does not claim completed real-account OAuth/SAML authentication.
The WebSocket fixture deliberately rejects upgrades after recording them;
its allowed result means the attempt reached the server, not that an
application stream completed.

At corresponding points after forced GC, worker heap medians were 6.61 MiB
reference / 6.75 MiB candidate before opt-in, and 6.92 / 7.26 MiB after opt-in
and the shared request cases. Browser-launch readiness medians were 961 / 962 ms.
The opt-in configuration/reconciliation observation window was 178 / 292 ms;
it includes a fixed 100 ms observer wait. Browser-process CPU medians for that
window were 31.25 / 31.25 ms. Short Windows CPU counters are quantized; zero does
not mean no work. These are V8/browser-process observations, not total RAM or
extension-attributed CPU.

The existing resource profiler ran five cold and five warm navigations per
workload/build, with the first-party option enabled on both builds. Readiness
metadata confirms 20 native CNAME rules in the candidate; that capability is
unavailable in the reference. Remote feeds were unavailable, not counted as an
empty successful update. CPU throttle was 1 and background throttling disabled.
Main-thread task medians, milliseconds:

| Workload | Cold off / reference / candidate | Warm off / reference / candidate |
| --- | ---: | ---: |
| Neutral article | 31.76 / 146.88 / 145.86 | 31.46 / 144.91 / 141.26 |
| DOM churn | 244.40 / 470.13 / 486.89 | 244.04 / 472.67 / 473.13 |
| Eight child frames | 48.36 / 204.72 / 204.45 | 51.06 / 203.07 / 202.03 |
| Thirty child frames | 128.80 / 409.49 / 405.33 | 130.66 / 341.92 / 393.65 |

Cold page-target V8 heap medians were 2.68 / 2.68 MiB for the article,
3.22 / 3.17 for churn, 6.72 / 6.72 for eight frames and 17.52 / 17.55 for
thirty frames (reference / candidate). The large-frame task timings are bimodal;
raw samples, p90 and maxima remain in the report. The warm median increase is
visible and does not establish a CNAME-specific regression, given the other
candidate edits and the profiler's documented cross-session frame variability.
No CPU or RAM improvement is claimed.

Final package checks passed at 2,377,959 ZIP bytes, 11,125,312 unpacked bytes
and 28,369 static DNR rules. The new native rules use the dynamic band, leaving
the packaged static rule count unchanged. The Store profile passed 74 checks.

Live Edge 150.0.4078.48 playback with 20 CNAME rules active advanced YouTube from
1.48 to 16.81 seconds and Twitch from 7.95 to 23.32 seconds. Both successful
checks ended unpaused, readyState 4, without a browser error. The first Twitch
attempt advanced but ended paused; its cause was not established, so it was
retained and repeated in a fresh profile. `playback.json` records YouTube and
that paused attempt; `playback-twitch.json` records the successful retry.
These are short playback checks, not exhaustive ad-break or account coverage.

Completed network report SHA-256:
`3647ecfca72c27ea9970ad1e1c1141ab1588f06805ebbb58a43e9a587ffd1b01`.
Resource report SHA-256:
`183a64f297df4aac01d7207127f58e667ef551ac5a0a0a927f2cdc8569367b29`.

## Reproduction

Run from the repository root with the pinned browser and immutable unpacked
directories. Use the Phase 00 snapshot preparer to capture another candidate
without changing the real Git index. Data reproduction works offline:

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/build-cname-data.js --check
& 'C:\Program Files\nodejs\node.exe' tools/test-cname-protection.js
& 'C:\Program Files\nodejs\node.exe' tools/browser-cname-protection.js --browser 'tmp/chrome-minimum-121/chrome-win64/chrome.exe' --reference 'tmp/privacy-baseline-2026-10-26/candidate' --candidate 'tmp/cname-phase01/verified/candidate' --runs 5 --out 'docs/perf/traces/cname-phase01-2026-10-26/network.json'
& 'C:\Program Files\nodejs\node.exe' tools/perf-profile.js --edge 'tmp/chrome-minimum-121/chrome-win64/chrome.exe' --offline --first-party-trackers --baseline 'tmp/privacy-baseline-2026-10-26/candidate' --candidate 'tmp/cname-phase01/verified/candidate' --variants off,base,on --runs 5 --pages /article-neutral.html,/churn.html,/frames.html,/frames-heavy.html --out 'docs/perf/traces/cname-phase01-2026-10-26/resources'
```

`--refresh` explicitly downloads a new upstream revision. Review source changes,
license, scope, budgets and browser results before promoting its output. A failed
download, changed license or invalid data leaves existing local outputs intact.
Restoring the previous source snapshot and running `--build` regenerates the
previous mapping offline; regenerate the source inventory/notices afterwards.

Local raw network/resource reports and playback evidence are under
`docs/perf/traces/cname-phase01-2026-10-26/`; snapshots and gate logs are in
`tmp/cname-phase01/`. These directories are ignored and excluded from packages.
The 315-suite maintainability gate passed, including the mapping source-parity
check and existing security/compatibility coverage. Unit tests independently
exercise exact alias scope, normalized duplicates, spoofed hosts, chains,
cycles, protected hosts, source/license drift, opt-in controls, exceptions and
rejected-write retry. Earlier baseline comparator limitations remain unchanged.

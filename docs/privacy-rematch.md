# Phase 09 fixed-corpus rematch

For the later candidate's Round 10 release review, see
[privacy-badger-round10-release-audit.md](privacy-badger-round10-release-audit.md).

2026-10-27, Chrome 121.0.6167.184, fresh disposable profiles, offline loopback
TLS, software GL, no CPU throttle. Five alternating repetitions each for
extension-off, original WardenOne, candidate WardenOne and Privacy Badger.

The earlier Privacy Badger development archive could not initialize. The official
[EFF alternative installation package](https://www.eff.org/files/privacy_badger-chrome.crx),
linked by [Privacy Badger](https://privacybadger.org/), does initialize. Its
manifest is MV3, version **2026.9.15.2**, minimum Chrome 121. It installs 4,963
dynamic rules and keeps local learning off by default. It was extracted without
changing vendor code, settings or bundled data. Download origin and SHA-256 are
pinned; CRX cryptographic signature verification was not performed.

The GitHub [2026.9.15 source release](https://github.com/EFForg/privacybadger/releases/tag/release-2026.9.15)
is a different build label. Exact package/source correspondence has not been
established, so source quality is unscored. No source-line-count comparison is made.

## Corpus and scoring

`tools/browser-release-rematch.js` declares the corpus and acceptance rules before
running it. The four tracker cases are google-analytics.com, doubleclick.net,
0sbm.consobaby.co.uk and an api.fpjs.io script. The CNAME fixture is the first
lexically shared alias in the bundled lists (canonical target et2.eulerian.net).
The page is www.consobaby.co.uk. Six controls cover an unknown same-site alias,
same-site API, unknown third party, authentication, payment and ordinary script.

All names map to loopback; no live DNS CNAME chain or vendor tracking script runs.
The script response is harmless. A non-delivered request counts as blocked only
with native `ERR_BLOCKED_BY_CLIENT` evidence. Server receipt, sent/stored cookies
and browser errors are retained separately. Extension-off delivered and retained
both cookie directions for every case in every repetition. DNS, TLS and timeout
errors cannot earn blocking credit. Requests originate in an isolated CDP world
to measure network protection independently of page fetch wrappers.

| Round | Candidate WardenOne | Privacy Badger | Outcome |
| --- | --- | --- | --- |
| Tracker requests blocked before egress | 4/4 in each run | 4/4 in each run | Draw |
| Control requests blocked | 0/6 | 0/6 | Neither blocked a control |
| Delivered tracker cookies removed | No tracker requests delivered | No tracker requests delivered | Unscored |
| Tracker detection | Equivalent attribution not collected | Worker-owned tab data collected | Unscored |
| Editor, OAuth GET, SAML POST, playback | All four passed in every run | All four passed in every run | Draw, controlled fixtures |
| Forced worker recovery | Rules and request policy survived; private heap replaced | Same | Draw, one forced restart each |
| Privileged-message exploit | No matched page-reachable exploit demonstrated | Same | Unscored |
| Source quality | Matching source/runtime review available | Exact packaged-source provenance unresolved | Unscored |

Privacy Badger stripped outgoing/incoming cookies on the authentication and
payment control requests. WardenOne preserved those fixture cookies. Both
controlled login flows still completed. Those flows check callback parameters,
not session cookies, so they cannot establish whether stripping preserves real
sign-in or checkout. Privacy Badger achieved lower cookie exposure on these two
resource fixtures. WardenOne's exemptions establish no compatibility win here.
This is no claim about real Google or Stripe transactions.
Original WardenOne blocked 3/4 tracker cases; the candidate adds the confirmed
alias case. These results support that narrow change, not an overall product win.

## Resource observations

Readiness includes initial policy reconciliation. Heaps are JS heaps after GC;
WardenOne's bundled cosmetic cache is explicitly warm. Startup still costs more
than the original build with fewer protections. Each metric is checked against
its observed reference baseline and the fixed relative-variance formula in
[release-quality-audit.md](release-quality-audit.md). Performance is reported per
metric without a cross-product winner because feature scope differs.

Raw samples, medians, spread, budgets and exclusions are in the local review
artifacts. Final hashes and the resource table are appended after verification.

| Median | Extension off | Original WardenOne | Candidate WardenOne | Privacy Badger |
| --- | ---: | ---: | ---: | ---: |
| Startup wall, ms | 219.0 | 1104.0 | 1328.0 | 1911.0 |
| Browser CPU at ready, ms | 328.1 | 750.0 | 921.9 | 812.5 |
| Renderer JS heap, MiB | 0.90 | 3.03 | 3.03 | 1.04 |
| Worker JS heap, MiB | n/a | 7.22 | 7.93 | 13.75 |

All four candidate budget checks passed. Startup is 20.3% above the original build; that cost remains visible. The source,
package, browser and report hashes are in [privacy-rematch-identities.json](privacy-rematch-identities.json).
The tested candidate runtime fingerprint is `58da749fd6b6c6f80c402b3e8f5d59fbea0d0531900025170ff58e9060bd3d19`.
The official CRX SHA-256 is `8b9903bc23c13b7861590116390142a0cd09b2a32fcf7364ab4c9500241669a7`.

# CNAME tracker catalog — Phase 02 (2026-10-30)

This supersedes the enforcement scope in
[cname-default-policy-audit.md](cname-default-policy-audit.md). The switch, its
default and the protection count are unchanged. No release version changed. Work
remains local.

## Why

Privacy Badger 2026.9.15.2 ships 75,955 CNAME aliases. To compare enforcement
rather than list size, its Chromium build ran in a fresh Chrome 121.0.6167.184
profile with default settings and its installed rules were read back. Those rules
block **62,420** of its aliases, strip cookies from 2,103 and leave 11,432
untouched. WardenOne blocked 1,663. Both extensions take their aliases from the
same upstream, AdGuard's CNAME catalog.

## Source and selection

Every tracker-provider file (43) from
[AdguardTeam/cname-trackers](https://github.com/AdguardTeam/cname-trackers/tree/3a7f5b0cdf8f28b2f5b88db0e55d940869fe1473/data/trackers)
at revision `3a7f5b0cdf8f28b2f5b88db0e55d940869fe1473` (2026-10-26), 300,060
published aliases, MIT. The ads, click-through, microsite and mail-tracker
categories are not used: those aliases are navigated to rather than requested by
pages. `docs/cname-source-snapshot.json.gz` (2,577,759 bytes) keeps every input
body, path and SHA-256 for offline rebuilds.

`tools/build-cname-data.js` omits 40 malformed hosts, 17 registrable-site apex
aliases, 15 same-site aliases and 451 aliases whose host or target is a protected
login, payment, government, education, media or WardenOne-provider site. The
protected test mirrors the shipped `isProtectedTrackerDomain` and
`isMediaCompatDomain`; `tools/test-cname-catalog.js` runs the shipped functions
over the output.

When one provider lists at least 20 children under a parent that is not itself a
registrable site, that is wildcard DNS: the parent's children are matched by a
descendant regex, and the parent itself only if it is listed. 21 families remain
after nesting; `net.daraz.com` alone accounts for 40,113 crawled names.

Each provider has a reviewed treatment. A provider that appears upstream without
one fails the build.

| Treatment | Providers | Behaviour |
| --- | --- | --- |
| Block | 39, including Adobe, Stape (server-side Google Tag Manager), Criteo, INFOnline, EdgeTag, ProxyHog (PostHog), Ensighten | Blocked |
| Hosted | Act-On, NP6 | Blocked, except requests made by a page on the alias itself (landing pages and forms) |
| Cookies | LexisNexis Risk Solutions (ThreatMetrix), Commanders Act | `Cookie` and `Set-Cookie` removed; the request proceeds |

ThreatMetrix runs fraud checks during bank sign-in and checkout, so blocking it
can lock people out. Commanders Act is a tag and consent manager that WardenOne
does not block as a third party; Ensighten is blocked because WardenOne already
blocks `ensighten.com`.

`rules-cname.json` holds 23 static rules: **118,925 blocked entries** (118,904 exact
hosts and 21 families) and 1,423 cookie-only hosts.

## Enforcement

The `cname_trackers` static ruleset uses priority 900 for script, image, XHR, ping,
WebSocket and WebTransport requests. Navigations, frames, stylesheets, fonts and
media stay outside it. Each rule pins the hostname label count, so a listed alias
does not cover its unlisted subdomains. Login and media hosts are excluded as
initiators in the packaged rules. `refreshBlocklistRuleset` enables it with the
master switch and **Block CNAME-cloaked trackers**.

The 730000–730299 dynamic band no longer blocks. It holds site exceptions: for each
paused site or site with CNAME blocking off, one allow rule at priority 900 covers
the catalog hosts under that site. Allow wins a priority tie, and no other
protection's rules are outranked. An exception does not cover an alias on a
different registrable domain; pausing the site does. The computed band is cached in
session storage by catalog hash and site list, so a worker wake does not re-read
the catalog.

The reviewed four-provider mapping (`cname-trackers.json`, now 1,677 aliases at the
new revision) still drives Network Log's target display, the tracker learner and
alias cookie isolation. Network Log labels catalog blocks by ruleset.

## Compared with Privacy Badger

Outcome for each of Privacy Badger's 75,955 aliases:

| Privacy Badger | WardenOne blocks | WardenOne strips cookies | WardenOne leaves | Removed upstream since |
| --- | ---: | ---: | ---: | ---: |
| Blocks (62,420) | 55,801 | 1,357 | 294 | 4,968 |
| Strips cookies (2,103) | 1,741 | 19 | 14 | 329 |
| Leaves (11,432) | 10,411 | 11 | 28 | 982 |

WardenOne blocks **67,953** of Privacy Badger's own aliases against its 62,420,
plus 51,721 exact hosts Privacy Badger does not list. Where Privacy Badger blocks
and WardenOne does not:

- 1,357 ThreatMetrix aliases on banks and payment sites, by design;
- 294 government and education aliases, under the existing protected-site policy;
- 4,968 aliases AdGuard has since dropped, which Privacy Badger still carries.

Privacy Badger's rules also match every subdomain of a listed alias and include
frames. WardenOne matches the listed host only.

## Native evidence

`tools/browser-cname-protection.js` ran once per browser in a fresh profile with the
packaged files only. Real catalog hostnames resolve to a loopback HTTPS fixture.
"Blocked" means the server never saw the request and the browser reported a
`cname_trackers` match. Both browsers produced identical outcomes.

| Case | Host | Chrome 121.0.6167.184 | Edge 156.0.4314.50 |
| --- | --- | --- | --- |
| Listed alias | `a.trowow.de` | Blocked | Blocked |
| Same, trailing dot | `a.trowow.de.` | Blocked | Blocked |
| Child of a listed alias | `child.a.trowow.de` | Allowed | Allowed |
| Unlisted same-site host | `unlisted.trowow.de` | Allowed | Allowed |
| Server-side tag manager (Stape) | `0.avmarket.rs` | Blocked | Blocked |
| Wildcard family child | `x1.net.home24.de` | Blocked | Blocked |
| Wildcard family parent | `net.home24.de` | Allowed | Allowed |
| Cookie-only provider | `1bf86f4b.tictoc.ai` | Cookies removed both ways | Cookies removed both ways |
| Hosted provider, from another site | `12build.actonservice.com` | Blocked | Blocked |
| Hosted provider, from its own page | `12build.actonservice.com` | Allowed | Allowed |
| Requested by `accounts.google.com` | `a.trowow.de` | Allowed | Allowed |
| CNAME off for this site, open page | `a.trowow.de` | Allowed | Allowed |
| Another site during that exception | `0.avmarket.rs` | Blocked | Blocked |
| Site paused, open page | `a.trowow.de` | Allowed | Allowed |
| Pause lifted | `a.trowow.de` | Blocked | Blocked |
| Switch off, then on | `a.trowow.de` | Allowed, then blocked | Allowed, then blocked |
| Master off, then on | `a.trowow.de` | Allowed, then blocked | Allowed, then blocked |
| Direct navigation to an alias | `a.trowow.de` | Page loaded | Page loaded |

Live Edge 156.0.4314.50 playback with the ruleset confirmed active: YouTube advanced
1.02 → 16.62 seconds and Twitch 7.82 → 23.38 seconds, both unpaused at readyState 4
with no browser error. This is one short public-video check, not ad-break or
account coverage.

The CI browser suites for Settings data, DNR reconciliation, engine smoke and the
popup passed in Edge 156. In Chrome 121, Settings data and DNR reconciliation
passed; the popup suite passed four of five runs. The failing run stopped at the
popup's scroll-position restore check, which this change does not touch. That
result is recorded here rather than explained away.

## Cost

| Measure | Before | After |
| --- | ---: | ---: |
| Staged ZIP | 2,471,281 bytes | 3,495,935 bytes |
| Unpacked | 11,443,984 bytes | 14,743,797 bytes |
| Static DNR rules | 28,369 | 28,392 |
| Regex rules added | — | 23, all static |

The reviewed footprint limits in `docs/perf/static-budget.json` rose from
2,500,000 to 3,700,000 ZIP bytes and from 11,500,000 to 15,500,000 unpacked bytes.
Before this change the package was already within 30 KB of the old ZIP limit.

Browser-process private memory, Chrome 121, three fresh profiles: median 49.9 MiB
with the ruleset enabled and 46.1 MiB disabled, so about **3.8 MiB**. Re-enabling
returned to 50.0 MiB. The extension worker loads nothing for enforcement. It reads
the catalog only to build site exceptions, once per browser session while a paused
or excepted site exists. Worker heap after GC at the end of the native run was
8.42 MiB in Chrome and 8.74 MiB in Edge, after every scenario including exception
builds. These figures are not total RAM and were not compared with the previous
build in the same harness.

`build-cname-data.js --check` takes about 5 seconds and `test-cname-catalog.js`
about 4 seconds of gate time.

Local raw reports are in `docs/perf/traces/cname-catalog-2026-10-30/` (ignored):

| Report | SHA-256 |
| --- | --- |
| `cname-native-chrome121.json` | `e96d89d71b285d9d3916ecb3bbaf9effc44241dea80856dbb89f1c590e0296be` |
| `cname-native-edge.json` | `65f97712f54c7401c41da369455c7f98ab8cc0d7cee3c9ca3c58cf227f4abec3` |
| `playback.json` | `d5fa07e7b8314540295645c66dc9edd08fa01f11b3c1f7aca3a1ac9a753c95ca` |
| `privacy-badger-installed-rules.json` | `b6d2a3583b03019277a95fbb6b383ee469103f299b91c704469386ec41353af3` |

`rules-cname.json` is 3,290,245 bytes, SHA-256
`9c9dc664c6d1d984fd7388e16595ac5c71621e4b5ef0996cfc2923e87f2a34c5`. The source
snapshot's SHA-256 is
`23eb03698d2f98f396465fde2cfbc0c8044ffb09c49007636903993562e94519`.

## Reproduction

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/build-cname-data.js --check
& 'C:\Program Files\nodejs\node.exe' tools/build-cname-data.js --report
& 'C:\Program Files\nodejs\node.exe' tools/test-cname-catalog.js
& 'C:\Program Files\nodejs\node.exe' tools/test-cname-protection.js
& 'C:\Program Files\nodejs\node.exe' tools/browser-cname-protection.js --browser 'tmp/chrome-minimum-121/chrome-win64/chrome.exe' --extension <unpacked package> --out <report.json>
```

`--refresh` downloads the newest upstream revision and fails on a provider without
a reviewed treatment. Review the report before promoting it.

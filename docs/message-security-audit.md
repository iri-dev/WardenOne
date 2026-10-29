# Message and remote-input boundaries — Phase 07

Completed 27 October 2026. Runtime changes are confined to `background.js` and
`offscreen.js`. The version, permissions, settings and 109-protection count stay
unchanged. Work remains local, including the preceding phases.

## Changes supported by regressions

- A page-derived `detected_grabber_domain` report could call `learnDomain` and
  persist a block for the sending site. It now remains an observation. Existing
  curated enforcement, explicit user rules and historical learned-map reads remain.
- Both independent worker message listeners validate the tab identity and a
  bounded JSON envelope. Missing/foreign extension IDs, invalid tab/frame IDs,
  control keys, excessive nesting, oversized strings and large arrays fail before
  observation or capability dispatch. The activity listener never responds and
  cannot rely on a rejection from the separate router.
- Cookie compatibility changes, permission resets and opening browser site
  settings require the top document's exact scheme/host/port and a current browser
  document. Cross-origin child frames cannot name the top site to gain authority.
- Safe Browsing Continue also checks the live warning URL, document, tab and
  incognito context before consuming the warning record. Normal web documents use
  `webNavigation.getFrame`; extension warning documents use `runtime.getContexts`.
  Real Chrome 121 returns no webNavigation frame for its own extension page.
- Offscreen sound accepts only this extension's background worker, with no tab
  sender. Page and private UI requests must use the authorized worker route.
- Network and supplemental JSON feed traversal rejects malformed JSON, control
  keys, depth above 32 or more than 500,000 visited values. A failure rejects the
  whole source instead of publishing a partially collected list. ABP headers,
  ordinary text feeds, valid JSON and allowlist exclusion retain their behavior.

The first two regression runs failed against the Phase 06 runtime: one forged
report reached `learnDomain`; a deeply nested JSON source returned a partial list
instead of rejecting it. Logs: `tmp/security-phase07/baseline-boundaries.log` and
`baseline-remote.log`. The focused regressions now pass.

## Endpoint inventory

[`message-boundaries.json`](message-boundaries.json) records 165 transport sites
in 26 source/generated scripts, their policy, source counterpart and file hash.
It includes 14 direct runtime message registrations, one runtime connection,
three port receive sites, postMessage sites, DOM event channels and wrapper
registrations. Its 126 literal worker kinds include the logger port's `clear`.
The census includes embedded worker text and sender sites, so transport-site
counts are not counts of independently privileged receivers.

`tools/audit-message-boundaries.js --write` refreshes the inventory. The boundary
suite compares it with the live source and generated scripts. Lexical field lists
identify review locations; handler normalizers and delegated helper functions
define the accepted schema. The existing reachability suite separately scans all
worker imports and all shipped emitters. Build checks require byte-exact generated
content and fingerprint scripts. No external-message or external-connect listener
or `externally_connectable` manifest entry is present.

| Policy / surfaces | Permitted sender and provenance | Schema and capability | Rate / failure |
|---|---|---|---|
| Worker activity listener | Own extension ID, browser tab/frame metadata; body is an untrusted page observation | Bounded `rg-block {type,detail}` or `rg-tally {type,n,pageStart}`; sanitized history, badges, bounded inference; no persistent learned block | 300/minute per tab/kind; image candidates additionally 8/minute; invalid data ignored |
| Worker router | Own packaged private extension origin, excluding every WAR path; explicit tab exceptions below | Own string `kind`, control-key rejection, then handler-specific normalization; future kinds denied to tabs by default | Tab rate table below; private UI uses operation-specific serialization/state limits; rejected messages return an error |
| Logger worker/client (`background.js`, `logger.js`, `firewall.js`) | Private extension page; named `wardenone-logger` port | Bounded ring snapshots/deltas, `hello`, `entries`, `cleared`; incoming `clear` only resets this diagnostic ring | Ring/batch bounds, attach/detach lifecycle; wrong port/context disconnected; no web origin receives logs |
| Offscreen | Exact own worker URL/ID, no `sender.tab` | Fixed target/type, known tone and clamped volume; synthesized audio only | Worker notification batching/idle close; unauthorized ignored |
| Bridge DOM request/event input (`bridge.js`) | MAIN/page-originated input remains untrusted, including token holders | Narrow relay allowlist; host binding; signed monotonic mute/toast requests; bounded event projection; no config writes, downloads, firewall or subscription relay | Relay 20/minute/kind plus worker ceilings; invalid/unsigned/replayed requests discarded |
| Isolated content receive (`bridge`, Resource Saver, animated image saver, eyeshield, consent, mail, OAuth, Twitch rewind/VOD) | Extension-to-content delivery through Chrome; arbitrary pages cannot call `tabs.sendMessage` | Fixed UI/config/refresh kinds, typed projections and lifecycle handling; privileged callbacks return through worker authorization | Module-specific deduplication/bounds; unknown kinds ignored |
| MAIN guards (`src/content`, fingerprint realm, permission chain, redirect/miner guards, YouTube/Twitch/Spotify) | DOM/window input is page controlled; routing nonce is public | Signed config/reply protocol with replay tracking; dedicated player-worker protocols do not expose Chrome APIs; page claims remain non-authoritative at worker | Existing bridge authentication/rate/size tests; invalid messages ignored; no privileged API endpoint in MAIN |
| Private documents (`download-review`, logger/firewall and other UI emitters) | Packaged extension code; browser state supplies download/tab/extension identity | Review refresh/alive or typed worker requests; direct storage UI remains covered by config/import serialization tests | Per-feature bounds and transaction checks; unknown requests ignored/rejected |
| WAR (`ip-logger-warning.*`, Spotify silent media) | WAR is never private extension authority, even with own ID and extension URL | Only `grabber-navigation-status` reaches its exact warning/state check; media resource has no messaging capability | All other kinds return Not allowed; no settings/config response |
| External channels | None registered | No extension-to-extension or externally connected web API | No privileged dispatch |

Chrome sends a message to all listeners and accepts the first response. A router
rejection cannot protect a sibling listener's effects. Async handlers retain the
literal `return true` response convention supported on Chrome 121.
[Chrome messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging),
[browser-owned sender/context metadata](https://developer.chrome.com/docs/extensions/reference/api/runtime).

## Tab exceptions and schemas

Every tab request also has the common 512-value/depth-8/128-array-entry/48-object-key
limit, individual strings up to 8,192 characters and 65,536 total string characters.
Rates below are per tab, per kind, per 60 seconds. The cookie escape is separately
gated and is not a general addition to the tab allowlist.

| Kind(s) | Fields, capability and additional binding | Maximum |
|---|---|---:|
| `rg-block`, `rg-tally` | Typed observation/tally, sanitized detail; no page-authorized persistent blocking | 300 each |
| `content-config-get` | `need` selects a fixed least-privilege projection scoped to frame/top host; no API keys or arbitrary settings | 500 |
| `eyeshield-bootstrap`, `resource-saver-state`, `redirect-bootstrap-get` | Fixed feature snapshots derived from stored choices and sending document | 500 each |
| `search-result-check` | Bounded `hosts`; recognized search-engine sender; local verdicts only | 40 |
| `palette-run` | Known `command` plus original-tab, one-use, expiring `grant` opened through the trusted palette route | 30 |
| `mute-toast`, `toast-shown` | Known `type`, bounded duration for mute; site derived from sender, signed bridge request | 20 / 60 |
| `consent-accepted` | Typed cleared-storage report, sending-site scope and existing consent/cookie policy | 12 |
| `redirect-warning` | Sanitized `detail`; correlated tab/navigation warning record | 8 |
| `safe-browsing-check` | Public normalized URL <=2,048 characters and allowed `context`; configured provider policy; never creates a bypass | 45 |
| `domain-age`, `login-domain-age` | Normalized domain must match sender's host; login context checks/configuration apply | 12 / 8 |
| `permission-chain` | Typed permission/action/URL report; normalized sender-scoped correlation, no arbitrary permission mutation | 30 |
| `oauth-grant` | Bounded grant evidence; actual provider host and typed scoring helper | 8 |
| `script-drift-scan` | Bounded script URL records; public normalized script targets, scan cap and fetch byte/redirect limits | 6 |
| `smart-player-context`, `smart-player-intent` | Bounded evidence or no body; current tab, corroborated player state and trusted isolated control | 8 / 12 |
| `smart-script-status`, `smart-script-trust-site` | Sending-site state; trust is an isolated control, absent from MAIN relay | 4 / 2 |
| `set-site-permission` | Tab exception only for `key=cookies, setting=allow`; same top origin and current document; known permission enum | 3 |
| `open-site-settings`, `reset-site-permissions` | Same top origin and current browser document; reset uses known permission types | 2 each |
| `adshield-cosmetic` | Own `hostname`, boolean player flag; bounded compiled selectors, never arbitrary network rules | 12 |
| `hidden-add`, `hidden-remove`, `hidden-list` | Own hostname, normalized bounded selector where applicable; isolated picker/list, absent from MAIN relay | 30 / 30 / 60 |
| `wo-engine-check` | Isolated engine watchdog, bounded readiness/repair checks | 8 |
| `wo-nav-signal` | Typed signal/host/URL normalized against browser tab and redirect correlation | 180 |
| `warning-ui-compromised` | Sender-scoped warning-integrity report | 2 |
| `menu-opening` | Tab-derived context-menu information, no supplied cross-site authority | 60 |

The MAIN relay exposes cosmetic retrieval and signed, site-scoped notice actions.
Other isolated capabilities above are not automatically exposed by a DOM event.
Existing bridge, token, authenticated relay, trust-boundary and page-config tests
remain in the gate. HMAC authenticates the extension's bridge protocol; it does
not make a compromised page's behavioral claim a confirmed network verdict.

## Private capabilities and grants

The JSON inventory identifies every literal kind's reviewed handler and input
fields. Global clean/erase actions intentionally need no active web origin; their
authority comes from the private extension UI. Site permission/JavaScript controls
also read Chrome's active origin. Extension management accepts normalized exact
IDs and browser inventory, rather than a page's claimed extension object.
Download decisions use existing bounded review records, browser download state,
known decision enums, serialization and trust/review checks. User rules and
subscriptions use their established text/count/URL budgets, parser and atomic
store/rule transactions. No message supplies a native DNR rule object directly.

Warning Continue still requires its exact page path/query and original tab,
cryptographic handle, unexpired warning record, expected kind/context, normalized
public destination and matching current document. It consumes the record before
acknowledging one grant, stores an exact-URL digest and consumes the grant once.
Changed URL, replaced document, wrong frame/tab/incognito context, expiry, replay,
failed persistence/consumption and restart behavior have regression coverage.
Checks observe current browser state at authorization time; browser navigation and
settings APIs are separate operations, not an atomic browser transaction.

## Remote inputs

| Input | Existing boundary retained / Phase 07 addition | Failure behavior |
|---|---|---|
| Built-in network/security/cosmetic/supplemental feeds | Exact canonical allowlisted HTTPS URLs, omitted credentials, manual redirect rejection, 25-second deadline, streamed and declared byte caps (18/12/8 MiB by class), shared-body broker/concurrency cap; new JSON traversal limits | Source fails before compilation/publish; integrity rejection retains last-good installed rules |
| Remote hash data | Exact approved feed URL, 9 MiB class limit, validated hash/record parsing and update pipeline | Invalid update cannot become an accepted hash dataset |
| Custom subscriptions | User-approved public HTTPS/default-port URLs; at most four separately validated public HTTPS redirects; bounded bodies/time, line/filter count and compiled-rule allocation | Invalid/new rules are not committed; prior subscription/rules remain |
| Script Drift bodies | Normalized public script URL, bounded batch, at most three validated redirects, 3 MiB body cap, timeout; bounded projected indicators and baseline hashes | Failed fetch yields no guessed baseline/verdict |
| URL reputation providers / key tests | Fixed HTTPS provider routes, typed keys/input, redirect error, timeout and 1 MiB JSON cap; fixed result projections | Unknown/error remains a failed lookup, not a safe verdict or bypass |
| OpenPhish | Fixed URL, redirect rejection, byte/URL-count/deadline limits and validated cached entries | Failed fetch retains usable stored data; no partial successful refresh |
| RDAP / WhoisXML / store lookup / breach API | Normalized domain/exact extension ID, fixed initial services, timeout/body caps and projected result fields; RDAP registry and Web Store redirects retain their existing behavior | Errors return unavailable; no DNR authorization from the response body |
| Release/build update metadata | Fixed GitHub API/compare routes, no redirects/credentials, strict response URL, timeout/streamed caps, SHA format and expected release/compare fields | Quiet unknown/update-unavailable result; never downloads or executes code |
| Bundled data and extension reputation catalogue | Packaged extension URLs, typed catalogue/list/rule validators and build/license checks | Existing complete-load/recovery and rule-owner safeguards remain |

Content SHA-256, publisher-date/count drift checks and semantic sketches detect
changed or suspicious updates; they are not publisher signatures. A compromised
approved publisher can still supply plausible malicious data. Compilers retain
unsafe-target filtering, unsupported-rule rejection, rule-ID ownership, quotas
and atomic native replacement. Existing licensing, source inventories and
attribution records are unchanged. Custom subscriptions and RDAP/store flows do
not share the built-in feed rule that rejects every redirect.

## Validation and reproducibility

- Full maintainability gate passed: **324 suites**, all shipped scripts parse,
  generated builds match, and existing security/compatibility assertions remain.
  `tmp/security-phase07/gate-final.log` contains the result. A temporary Git index
  included local files without staging the real index.
- New `test-message-boundaries.js` drives both real worker listeners, asserts one
  rejection response and no history/badge effects for malformed payloads, exercises
  identity/origin/URL/port/document confusion, and checks offscreen authority.
  `test-remote-input-boundaries.js` checks atomic JSON rejection, valid formats,
  credential omission, redirect failure, lying Content-Length and streamed caps.
- Existing rate tests retain their per-tab budgets and double-listener regression.
  Frame ClickFix, logger, offscreen lifecycle (35 checks), grants, DNR allocation,
  firewall precedence, feed integrity/rollback, imports and recovery suites pass.
- **Chrome 121.0.6167.184** and **Edge 150.0.4078.48** each pass eight native boundary
  groups. The tests reject 93 message kinds from a real content sender outside
  their required context, exercise real malformed JSON transport, and verify
  ordinary projected configuration, popup health and top-level cookie controls.
  WAR cannot read config or invoke private actions. Actual network requests verify
  specific XHR allow/block wins over the competing All-column decision. Worker
  audio delivery succeeds while page/private-UI direct audio requests fail.
- The actual warning Continue UI also passes in both browsers: the exact original
  address loads once; repeated visits, other tenants, changed queries and redirect
  destinations are checked again. Native failure diagnostics first exposed the
  extension-frame API distinction; the corrected flow passes with document checks.

Native tests use disposable profiles, local servers and synthetic public hosts.
Provider verdicts are replaced only inside the test worker. Offscreen tests replace
`playTone` after loading the real endpoint, verifying authority/delivery rather
than audible output. They do not claim a real-provider reliability measurement or
a new playback benchmark. Media code did not change; its existing compatibility
coverage remains.

The tested runtime has 135 files, fingerprint
`af0a59203b98662f388d1b7270ffacf25e0284c7260bd71736b867d990020f9b`.
The Phase 06 reference remains
`b5ad4b7803fb0033089baa2b79db93e13c45c658d3b2c4701104cf8081c82751`.
Every candidate file was compared with its working-tree counterpart. Identities
and browser observations are in
[`perf/traces/security-phase07/`](perf/traces/security-phase07/identities.json).
Warning-flow logs are `tmp/security-phase07/{chrome,edge}-warning-r2.log`.

Reproduce with Node 24 from the repository root:

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/audit-message-boundaries.js
& 'C:\Program Files\nodejs\node.exe' tools/test-message-boundaries.js
& 'C:\Program Files\nodejs\node.exe' tools/test-remote-input-boundaries.js
& 'C:\Program Files\nodejs\node.exe' tools/browser-message-boundaries.js --extension tmp/security-phase07/candidate-r2 --out tmp/security-phase07/recheck.json
$env:WARDENONE_EXTENSION_DIR = Join-Path (Get-Location) 'tmp\security-phase07\candidate-r2'
& 'C:\Program Files\nodejs\node.exe' tools/browser-reputation-bypass.js
```

Browser DNR precedence is checked through real requests, not a custom rule
simulator. [Chrome rule evaluation](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation).

# Data minimisation and disclosure — Phase 08

Implemented 27 October 2026. Changes remain local. The version, permissions and
109-protection count are unchanged. Earlier phases' work is preserved.

## Changes

Settings → Clean-up & backup now offers normal retention, browser-session storage
or no saved **Activity and notification history**. Normal retention remains the
default for existing installations. The selected mode is a string preference,
not another protection toggle. It survives browser restart and settings backup;
changing it clears both histories and their pending journal. Existing notification
retention preferences still apply within normal mode.

`history-store.js` owns the storage choice and serializes its I/O. It reads the
stored choice before persistence; unreadable storage does not authorize a write,
and an unknown history-mode value saves nothing. Activity, Notification Centre,
Settings counts and popup summaries read the selected store. History off affects
recording, not the page guards, native rules or live warning UI.

History clearing now passes through the worker. It increments a generation,
discards buffered history and notifications, drains issued history I/O, and removes
both local/session copies plus the journal. An older writer cannot commit under
the new generation. The previous Activity and Settings controls only replaced
`wardenone_history` directly, leaving the pending journal and notification copy.

**Clear observations** additionally resets tracker observations and session views,
Script Drift baselines and Site Dashboard counts. Approved tracker blocks,
dismissals, per-site controls, firewall decisions and other user rules remain.
The learner invalidates older queued observation work. Script Drift checks its
generation after fetch/hash; tally writes use their own erasure generation.
Current pages can produce fresh observations after the operation finishes.

Full/site reset revokes history writers before erasing. Full reset clears browser
alarms as well as extension stores. Existing local-write filtering now also stops
writes while reset is active; delayed session mirrors and Forget Me/tally timers
cannot restore their old site records during the restart window. The existing
pending-download refusal, config reset lineage and native rule cleanup remain.

Extension pages also have DOM storage. Their common theme runtime clears local
and document-session caches when Chrome reports that the saved configuration was
removed during reset. This clears UI mirrors without affecting website storage.
Defaults can be recreated when the extension loads again.

## Storage inventory

[`storage-inventory.json`](storage-inventory.json) lists **101 registered keys**,
their owner, area, sensitivity, retention, item limit, erase/private behavior and
source locations. It includes a census of **56 DOM storage operations**, numerical
retention/cap constants and hashes of all 76 shipped root scripts. The warning
handle prefix is classified separately, rather than appearing as an unregistered
store in the privacy inspector. The inventory is generated from the live policy
and code; `test-storage-inventory.js` requires it to stay current.

The privacy inspector reports actual UTF-8 JSON bytes and oldest known timestamp.
There is no universal per-key byte budget; null item/age limits mean no guaranteed
global bound. Per-feature limits and browser storage quotas still apply. A cache
TTL describes reuse eligibility; expired physical entries are removed by that
feature's maintenance/read/write or reset. A suspended/closed browser cannot
promise a wall-clock deletion callback at the expiry instant.

| Dataset | Contents and limits | Lifetime and erasure |
|---|---|---|
| Settings, user rules and site controls | Switches, optional provider keys, explicit domains/selectors/firewall cells; individual parsers and rule-owner budgets bound their accepted input | Until changed; normal history clear keeps them; site erase prunes its site; full reset removes them subject to the explicitly chosen primitive-settings/key keep mode |
| Activity | Scheme/host, redacted route, bounded event details; latest 200 entries | Normal: 30-day eligibility, pruned on writes/startup/daily maintenance; session: memory-backed browser extension session; off: no stored entries; worker Clear removes journal and both histories |
| Notification Centre | Typed notice/host, bounded summary, up to 12 grouped samples; latest 300 | Normal: chosen 1/7/30 days or until cleared; session/off override persistence; its own Clear remains notification-only |
| History journal | Up to 100 pending sanitized events | Session only, removed after acknowledgement or clear; invalidated on a mode change/reset |
| Tracker learner | Up to 600 domain entries; salted 128-bit site sketches, source categories, coalesced counts and day-level times; current view up to 40 sites × 12 domains | Observations unseen for 30 days expire; approved decisions stay; Clear observations drops evidence and retains decisions; private worker never persists these observations |
| Script Drift | Up to 700 script URL digests and derived hash/indicator/host comparison fields | Unseen baselines expire after 30 days; live baselines may remain; Clear observations removes all, with delayed results revoked |
| Site Dashboard | Up to 300 sites of hourly counts, plus bounded per-tab session state | Seven-day hourly window; independent of Activity/notification mode; Clear observations drains/discards pending counts and removes stored copies; never persisted from private tabs |
| Domain age / WhoisXML age | Domain and registration result; 100 / 250 cached entries | Reuse for seven days; bounded on cache writes; site/full erase removes them; private results cannot write the normal profile cache |
| Safe Browsing | Up to 800 cached URL-verdict digests | Clean reuse 15 minutes, hit 5 minutes; cache maintenance/site/full erase |
| PhishTank | Up to 1,200 verdict entries | Clean reuse 20 minutes, hit six hours; cache maintenance/site/full erase |
| AbuseIPDB | Up to 1,200 IP verdict entries | Clean reuse 12 hours, warning/hit four hours; cache maintenance/site/full erase |
| URLhaus | Up to 1,200 URL/host verdict entries | Clean reuse one hour, hit 12 hours; cache maintenance/site/full erase |
| WhoisXML reputation / threat | Up to 800 entries per cache | Clean reuse 12 hours, warning/hit six hours; cache maintenance/site/full erase |
| Breach results | Checked domain and projected public breach metadata; no explicit global entry cap | Reuse 12 hours; site/full erase; no private persistent write |
| Public downloaded intelligence | Filter/cosmetic/domain/hash data and integrity/retry metadata, not a list of visited sites | Refresh/replacement or full reset; per-source byte caps and native owner budgets; deliberately retained by site erase |
| Warning hand-offs | Exact live destination under random `wardenone_warning:` handle, up to 40 records | Six-hour validity, Continue/tab-close/browser-close/record maintenance; intentional exact URL needed for the current action; not incident history |
| One-use grants | Exact-address digest, tab, handle/nonce state | Reputation grant at most 60 seconds and one use; palette grant and other fixed action windows; no surviving grant restored by erasure |
| Download reviews / handled records | Sanitized source route, filename, result/reasons and browser download ID; up to 25 reviews | Review validity two hours; handled-state validity 24 hours; browser-session handling rules and cleanup; active reviews must finish/cancel before full reset |
| Startup report / extension reviews | Flagged hosts/reasons, exact extension IDs, permission/version snapshots and bounded change timeline | Startup report valid 24 hours, private report only session; extension reviews remain until replaced/reviewed/erased; latest 60 alerts; no site title retained |
| Redirect / permission / cleanup mirrors | Bounded current-tab hosts, correlation counts, consent/service-worker timestamps and exact-action digests | Redirect correlation ten minutes; permission windows and cleanup mirrors expire under their feature limits; consent/SW sets up to 200 each and one day; Forget Me up to 400 records and one day; session only |
| Pending manual actions / block offers | The explicitly selected link/tab needed to resume an action, with bounded jobs and nonces | Fixed action validity (manual jobs ten minutes), completion/tab close/session end/reset; not copied into lasting incident history as a full URL |
| Recovery / config lineage | Feed failure categories/count/deadline, rule reconciliation markers, random save/reset IDs | Aggregate state has no visited-site URL; success/off/reset clears recovery; reset can recreate empty config lineage and public protection state |
| UI preferences and mirrors | Theme, density, favorites, section order, folded cards and last Settings page; config data is authoritative where mirrored | Until changed/reset; open extension documents clear their DOM caches on configuration removal; default UI values may be recreated |

`chrome.storage.sync` is not used for WardenOne records. The census finds no
extension-owned IndexedDB database or Cache Storage dataset. IndexedDB deletion,
storage inspection and probe operations act on website-origin data. MAIN guards
use small page/session markers, consent-ID cleanup, or inspect storage for exposed
tokens; Twitch's session marker coordinates the current player. These are not a
second extension browsing-history database. Volatile video clips, worker maps,
logger rings and parser caches are bounded by their existing feature contracts
and discarded with their document/worker. The JSON census identifies every DOM
operation's location, including generated content.

Chrome session storage survives worker suspension and is cleared on extension
reload/update/disable or browser restart. DOM storage and extension API storage
are distinct; content-script DOM storage belongs to the host page.
[Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/api/storage),
[extension storage contexts](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies).

## Redaction and exports

`safeUrlForLog` rejects non-web schemes and removes userinfo, query and fragment.
Route segments are retained only under the existing vocabulary/length rules;
everything after a sensitive reset/password/verification/invite/magic/recovery/
token/callback route is starred. Nested strings also scrub embedded web URLs,
known URL fields accept scheme-less input, and explicit password/token/secret/
authorization/API-key/cookie fields are dropped. Traversal still has field, depth,
string and total-output caps, skips getters/control keys and rejects cycles.

New incident records are sanitized before the Activity buffer and notification
copy. Older records are sanitized again when read/pruned; this does not rely on
every historical producer having used the current writer. Download review/log
formatters retain their shared redaction coverage. The Settings diagnostic export
contains aggregate counts/states rather than addresses, site names, history or
keys; its existing export tests remain. Explicit configuration backups intentionally
can contain the user's chosen site lists while excluding API keys.

Redaction is not a promise that arbitrary free prose can be identified as a secret.
Unlabelled short words/numbers outside recognized sensitive routes can remain.
Current warning/action hand-offs intentionally retain the destination in session
storage so the action can complete. They are separate from saved incident history.

## Network initiation and destinations

The MAIN background relay previously allowed a page to ask about its own domain's
age even with login-age checking off. It could therefore cause an RDAP request
without a direct user action. `domain-age` is now private-UI-only and absent from
the MAIN relay and tab allowlist. Its popup/manual-check actions still work.

The existing opt-in Login page age check now offers an isolated, closed-shadow
**Check domain age** button with the receiving service/domain stated. Password
visibility only displays the offer. Only a trusted click starts the lookup; a
synthetic page event cannot press that control. The worker still binds the request
to its sending host and applies its rate/URL/config validation. RDAP receives only
the registrable domain, with omitted credentials. An enabled WhoisXML age provider
retains its explicitly configured provider route. The popup, README, generated
Settings data and privacy policy describe the new behavior.

Other optional reputation protections keep their existing explicit enable/key
requirements. Those configured automatic protections can query while browsing;
they have not silently become manual-only features. `PRIVACY.md` names all **30
literal runtime destinations** plus user-selected subscriptions, registry redirects
and page-loaded script/player hosts. Its disclosure suite still scans every shipped
root script. A manual lookup is separate from enabling automatic provider checks.

Default protection matches, CNAME classification and tracker evidence use packaged
data and browser-owned network observations. No visited-host CNAME resolver or
new telemetry destination was introduced. DNS-rebinding detection continues to
use observed response IPs. Existing public feed/build/browser-version requests do
not include visited hostnames; script rechecks and Twitch operations retain their
documented page-origin scope.

## Validation

The final maintainability gate covers **327 suites**, generated output, packaged
sources and existing security/compatibility checks. New suites cover history modes,
per-key inventory and controlled network destinations. The history-mode suite
drives the real worker, inspects local/session writes and notification copies,
checks redaction, discards pending jobs, rejects a revoked generation, preserves a
firewall choice when clearing observations, inventories actual writes, and verifies
private/no-history persistence barriers plus delayed session-mirror suppression.
Existing history retry/recovery, 37 retention checks, notification, 26 on-leave
durability checks, grant, config/import, feed, media and erasure assertions remain.

Native runs use disposable Chrome **121.0.6167.184** and Edge **150.0.4078.48** profiles:

- Five history groups verify normal redaction, real session-backed Activity
  rendering, clear/off behavior, a genuine trusted click before RDAP, and mode
  persistence/session erasure across two browser restarts.
- A controlled worker fetch records exactly `https://rdap.org/domain/example.com`
  for the login fixture, after the click. It does not contact a public RDAP server.
  Unit tests also check credentials, query omission, disabled-provider silence and
  private cache isolation.
- Full erasure removes local/session/browser-DOM sentinels, a provider key and
  site exception while keeping the explicitly selected global switch. Deferred
  Forget Me/service-worker mirrors are seeded before erase. No sentinel returns
  after the reload window or a full browser restart.
- Eight message-boundary groups verify that all **97** kinds outside their tab
  context, including the new history actions, remain inaccessible to content
  senders. Private popup/cookie controls, native DNR precedence and worker audio
  still work. The web-accessible warning cannot read history/config or mutate it.

Browser tests wait for the actual document and writer/render completion rather
than a fixed startup sleep. Windows cleanup uses verified, uniquely named temp
paths and a native PowerShell fallback for failed directory removal; user browser
profiles are never used. These are functional/storage tests, not a new media
playback or provider-reliability benchmark.

The frozen 136-file candidate is
`dc1bfdc2d32845dfc3dd665915cdb7cea597ce65bf8c8e20bde97821c5a314f4`.
The untouched Phase 07 reference is
`af0a59203b98662f388d1b7270ffacf25e0284c7260bd71736b867d990020f9b`.
Identities, browser reports and validation hashes are in
[`perf/traces/privacy-phase08/`](perf/traces/privacy-phase08/identities.json).
Raw gate/test logs are under `tmp/privacy-phase08/`. The gate uses a temporary
Git index; the real index remains unstaged. No commit, push or version bump was made.

Reproduce from the repository root with Node 24:

```powershell
& 'C:\Program Files\nodejs\node.exe' tools/audit-storage.js
& 'C:\Program Files\nodejs\node.exe' tools/test-history-modes.js
& 'C:\Program Files\nodejs\node.exe' tools/test-private-network.js
$env:WARDENONE_EXTENSION_DIR = Join-Path (Get-Location) 'tmp\privacy-phase08\candidate-review'
& 'C:\Program Files\nodejs\node.exe' tools/browser-history-modes.js
& 'C:\Program Files\nodejs\node.exe' tools/browser-privacy-erase.js
```

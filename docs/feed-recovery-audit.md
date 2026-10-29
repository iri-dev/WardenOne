# Worker and packaged-feed recovery — Phase 06

Implemented 26 October 2026. Canonical changes are in `background.js`; this file is
shipped directly. No content-script source or generated engine output changed.
The version, permissions, protection count and existing settings are unchanged.
Work remains local, including earlier phases' uncommitted changes.

## Failure reproduced

The Phase 05 reference scheduled packaged-feed retries with worker-local timers
at 5/30/120 seconds. A regression run against that source passed its previous 42
checks but failed six new assertions: neither feed had a browser alarm or durable
recovery intent after a failed source read. Discarding the worker discarded both
retry callbacks. The baseline log is `tmp/recovery-phase06/baseline-feed-load.log`.

Review also found that reconciliation could run an enabled feed applier before
its sources loaded in the new worker. That empty in-memory set could replace the
last installed band even though the loader itself retained rules on failure.
Enabled appliers now require a complete load; explicit off still removes rules.
If only one grabber action is disabled during an unreadable cold load, that action's
band is removed while the other enabled bands retain their installed state.

## Recovery contract

Each feed owns one session key (`wardenone_feed_load_grabber` or
`wardenone_feed_load_miner`) and one named browser alarm. A checkpoint has a schema
version, bounded failure count, phase, retry time and up to three fixed failure
categories. It stores no visited hosts or copied feed lists. Checkpoints are
validated when read, and malformed/far-future records cannot indefinitely defer
loading. There are at most two records and two feed alarms. Restoring a worker
preserves an existing near-deadline alarm; it repairs an alarm left earlier or
later than its checkpoint by an interrupted scheduling update.

The alarm is armed before intent storage is acknowledged. A `loading` checkpoint
is acknowledged before reading sources or changing rules. It remains until every
required read and the native rule update succeed. Failure retries after 30 seconds,
2 minutes and 10 minutes; after those three rapid retries, one daily retry remains.
This cooldown survives worker restarts. Fresh input, a relevant setting change or
Repair starts a fresh attempt immediately. Success and feature off clear recovery
metadata and its alarm. Browser close clears session metadata; the next worker
performs a fresh load. Alarm existence is checked/restored on worker startup.

Retry callbacks join an existing load. Explicit newer requests queue per feed and
invalidate an older read before it publishes data. Native band appliers retain
their existing serialization. Every application reads current configuration;
unreadable settings retain installed rules. A rejected native update returns
failure, retains intent and leaves Chrome's previous atomic rule state installed.

A failed read retains the last complete in-memory sets in the same worker. A fresh
worker can reconstruct the membership actually covered by installed owned rules
while sources remain unavailable or backoff is pending. That reconstruction does
not mark the complete feed loaded and cannot authorize rebuilding from a subset.
Only a successful read replaces the full source sets. Existing source filtering,
domain exclusions, owner bands, quotas, priorities and site allowances are retained.

Protection Health reports pending feed recovery and offers Repair. Repair now
explicitly refreshes both feeds and checks their result. The privacy cleaner's
inventory includes both session records, and the privacy policy documents their
contents and lifetime. No external lookup or telemetry was added.

Settings reconciliation also arms `wardenone-reconcile` before its 150 ms debounce.
The browser alarm can apply the latest stored settings if the worker stops before
the pending reconciliation marker is written. Completed reconciliation clears it.
Existing interrupted-owner markers and bounded degraded-retry handling remain.

Chrome's supported minimum is 121. The implementation uses one-shot alarms no
sooner than 30 seconds, not a 5-second durable deadline or a newer persistence flag.
Alarms may run late and do not wake a sleeping device. Important alarms are restored
from checkpoint state because persistence across browser restarts is not guaranteed
on the minimum browser. [Chrome alarms documentation](https://developer.chrome.com/docs/extensions/reference/api/alarms),
[worker lifecycle and Chrome 120 minimum period](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

## Worker timer inventory

The review covers `background.js`, all `background-*.js` worker imports,
`notification-manager.js`, `config-lock.js` and `build-update.js`. No worker timers
were found in the other synchronous utility/data imports. Timer-like names in
scriptlet tables and script-text inspection are data, not scheduled worker jobs.

| Timer family | Classification | Recovery or reason to retain timer |
|---|---|---|
| Packaged grabber/miner retries | Critical data loading | Session intent plus named alarms; changed in this phase |
| Settings reconciliation debounce | Critical policy application | New alarm backstop; existing pending/degraded markers and read/diff/write reconciliation |
| DNR batch flush deadline | Critical reconciliation | Pending marker is acknowledged before owners run; fresh worker replays current desired settings; atomic per-store update |
| Remote list daily update and retry | Periodic/critical update | Existing daily alarm, 4/12/40 minute retry alarms, persisted retry count and last installed rules; not converted to timers |
| Startup security check fast path | Critical check with opportunistic fast path | Existing 2.5 second timer and 30 second alarm; session deduplication |
| Site pause expiry | Critical timed policy | Existing expiry alarm derived from stored pause deadlines and reconciled on startup |
| Memory maintenance | Periodic utility | Existing setting-controlled sweep alarm |
| Extension watch reconciliation/report delays and first-session scan | Periodic security review | Existing watch alarm, persisted baseline/reviews and session scan marker; deferred reports are reconstructed by scans |
| Download initial/follow-up scans | Critical scan | Browser download state, early browser-owned pause, saved reviews, download events and boot recovery; timers coalesce reads |
| Download review cleanup/orphan-paused recovery/new-session quiesce | Critical recovery | Repeated on every boot/startup from browser state and saved review/session boundaries; existing events also clean reviews; no exactly-once claim |
| Tab-limit enforcement debounce | Utility debounce | Current tabs/settings are queried on subsequent tab events; no security rule transaction is delayed |
| Badge writes/hydration fallback | Noncritical display persistence | Existing bounded write retries/session counts; unacknowledged coalesced counts may be lost |
| History buffer/journal/flush/hydration fallback | Noncritical evidence persistence | Existing bounded session journal/local acknowledgement; documented coalescing and replay limits retained |
| Redirect/permission session-mirror debounce | Bounded transient evidence | Restored session state merges with live events; unacknowledged event tail remains best effort |
| Content-config refresh and Resource Saver broadcasts | Page/UI delivery debounce | Settings are already stored; new document/config reads use current settings; repeated broadcasts improve delivery |
| Popup/overlay closing retries and pressed-download restoration checks | Tab interaction | Short-lived tab/navigation-bound actions; replaying later after restart could affect a different user action |
| Matched-rule event batching and network-log polling | Diagnostic batching | Native request enforcement is independent; existing quotas/caches remain |
| Grabber-image warning and targeted-ad notices | Noncritical notice/evidence | Native blocking is independent; delayed observations may be lost, never treated as confirmed blocks |
| Network-log flush | Noncritical diagnostic persistence | Existing bounded buffers/reset behavior; not an enforcement retry |
| Reputation cache prune/write debounce | Cache maintenance | Fresh paid lookup results are written immediately; only pruning/sorting is delayed |
| Forget Me tab-host mirror | Privacy state cache | Session host mirror plus current-tab seeding on boot; a closed tab's unacknowledged last host can be lost; no lossless-history guarantee |
| Site tally state/flush | Noncritical aggregate persistence | Existing session/local bounds; display statistics may lose an unacknowledged tail |
| Fetch/permission/message timeout races | Request deadline | Abort or settle one current request; do not represent future security work |
| List-parser zero-delay yield | Cooperative task scheduling | In-flight parsing only; published/installed last-good data and list refresh alarms are independent |
| Reload-after-site-change and reset/reload delays | UI/document transition | Durable settings/reset state already written; tab reload delivery is best effort |
| Notification batching, offscreen sound retry/idle close, badge restore | Noncritical UI/audio | Notifications' existing stored state is separate; missing a sound is not missed enforcement |
| Config write confirmation/retry | Bounded write confirmation | Existing serialized writes, stored lineage/reset epochs and storage-change overwrite repair; an unacknowledged UI operation is not a durable job |
| Build-update fetch timeout | Optional update notice | Timeout bounds the current check; installed protection is independent |

These classifications do not promise exactly-once handling of every event, UI save,
notice or evidence entry. The new durable jobs cover packaged-feed loading and the
reconciliation debounce. Existing download, history and configuration recovery
contracts remain separate; this phase does not enlarge their journals or retention.

## Verification

`tools/test-feed-load-safety.js` now uses shared browser-owned rules, session state,
alarms and a virtual clock across fresh VM worker realms. Its 84 checks include
failed packaged/stored reads, cold hydration, preservation during reconciliation,
missing-alarm restoration, backoff/cooldown, daily recovery, source changes,
superseded reads, duplicate alarm delivery, global/feature off, malformed records,
unreadable settings, checkpoint failures, rejected DNR updates and replay around
storage/rule acknowledgement and journal cleanup. The test uses the actual shipped
loaders, appliers and recovery controller. Existing compatibility exclusions and
legitimate shrink/empty-list behavior remain covered.

`tools/test-reconcile-honesty.js` checks the immediate debounce alarm, its cleanup
and pending feed health reporting. `tools/test-repair-honesty.js` verifies Repair
includes the packaged-feed result. Both remain in the existing maintainability gate.

The extended `tools/browser-worker-interruption.js` uses a disposable native browser
profile and page-side observations while stopping the extension worker. It retains
the previous session-rule interruption test, then tests each feed after a failed
read, after intent acknowledgement, during an unacknowledged native DNR replacement,
before checkpoint storage acknowledgement and after successful application before
journal cleanup. Both dynamic rules and an independent session rule are observed
before/after stopping the worker. Fresh worker heaps must discard injection markers,
load the latest stored inputs, compare actual rules and clear the checkpoint/alarm.
Separate cases check all three partial grabber off choices with unhydrated source
state, then await autonomous feed-alarm recovery and reconciliation-debounce
recovery without sending a manual wake message.

Fault injection stalls the extension-side promise boundary. It cannot prove the
exact instruction executing inside Chrome when termination occurs; a native atomic
replacement can already have committed before its acknowledgement is withheld.
The checks accept the last committed native state and verify repair afterward.
Stop detection uses lifecycle notifications as well as target observations because
Chromium can restart immediately and reuse a target ID; fresh-heap markers remain
mandatory. Temporary profiles are removed after browser shutdown.
If checkpoint storage itself is unavailable, its backoff cannot be acknowledged;
the alarm remains the recovery backstop. If alarm creation also fails, no durable
wake can be acknowledged. Failures remain visible and installed rules are retained. Browser
crashes before any browser-owned operation commits are not a lossless transaction.

## Final runtime and native results

The resource comparison uses the unchanged Phase 05 cold-wake tool (SHA-256
`28076900e28e6f215fb4b215beaf41640ecdad1bc98985302f1f94fe6c38f2cc`),
pinned Chrome 121, software GL, the same machine and fixed 29,950-rule inventory.
Remote feeds are disabled. The baseline's three samples per scenario were collected
earlier in Phase 05; the final candidate's six natural wakes were collected after
the gate and native interruption checks finished. These are separate cohorts,
not randomized alternating pairs, so CPU differences are descriptive.

| Cold-wake measure | Phase 05 | Phase 06 |
|---|---:|---:|
| UI stalls ≥16 ms, all six samples | 0 | 0 |
| Rule-API UI stalls ≥50 ms | 0 | 0 |
| Tab-close browser CPU, median (range), ~5 s window | 188 (141–250) ms | 234 (188–250) ms |
| Popup browser CPU, median (range), ~5.3 s window | 234 (203–266) ms | 250 (234–297) ms |
| Tab-close native rule tasks, UI/background median | 6.29/109.25 ms | 5.76/116.39 ms |
| Popup native rule tasks, UI/background median | 8.23/123.19 ms | 8.58/119.72 ms |
| Tab-close worker JS heap after GC, median | 3,843,908 B | 3,859,684 B |
| Popup worker JS heap after GC, median | 4,194,164 B | 4,211,516 B |
| Cold popup ready, median (range) | 268 (259–291) ms | 276 (273–293) ms |

The new worker retains about 15.4/16.9 KiB more JS heap in these steady cold-wake
samples. This is a measured cost for recovery state/code, not a memory improvement.
Session hydration succeeded in every sample; all 29,950 native rules remained.
Both builds shared one filtered inventory read of 7,417 owned IDs and zero warm
reads. Its single cold timing was 236.2 → 317 ms; warm was 0.2 → 0.3 ms. Browser-start
endpoint/worker-ready timings were 446/533 → 457/539 ms, one observation each.
None of those single timings establishes a causal regression or speedup.

The initial three warm popup samples were 218 (193–228) → 249 (236–382) ms, so a
targeted repeat used five alternating fresh-profile pairs, seven popup opens per
profile, the same native inventory and the unchanged `popupSample` helper. Every
first open is retained separately; each profile's principal warm value is the
median of the following six opens. Paired differences were +5, +5.5, +16, +3.5 and
−25.5 ms: median +5 ms, median paired percentage +2.74%. That repeat does not
reproduce a uniform 31 ms increase, and does not establish zero overhead. The
helper polls readiness every 25 ms; it records browser CPU and renderer task time
separately. No general browsing-speed claim follows from these popup observations.

Raw worker and popup reports retain medians, ranges, CPU traces and process-private
memory counters. Browser-process memory includes native DNR indexes, transport and
other allocations; it is not isolated DNR RAM or renderer JS heap. Process-private
differences do not establish lower total browser RAM. The earlier
`worker-candidate.json` profiles a pre-deadline-fix candidate and is diagnostic;
the final resource conclusions use only `worker-final.json`,
`resource-comparison.json`, `popup-ab.json` and `popup-comparison.json`.

The frozen Phase 06 runtime is `tmp/recovery-phase06/review/candidate`, 135 files,
fingerprint `b5ad4b7803fb0033089baa2b79db93e13c45c658d3b2c4701104cf8081c82751`.
The reference is the final Phase 05 runtime, fingerprint
`3d2e8c224860a92f0ccdbae3db56416ef1c2d729e189de972cb7028b38b29fa7`.
Only `background.js` differs among the 135 runtime files.

Final native reports `chromium.json` and `edge.json` each completed all **16 cases**
and profile cleanup on Chrome 121.0.6167.184 and Edge 150.0.4078.48 respectively.
The feed alarm recovered without a manual message about 30.9 seconds after forced
stop in both browsers. Reconciliation recovered about 29.9/22.7 seconds after stop;
those observations start after stopping the worker, not when the alarm was created.
The final near-deadline regression preserves an already scheduled wake and repairs
missing/mismatched backoff alarms. The earlier implementation failed that added
regression; `near-deadline-before.log` retains the failure.

The full maintainability gate passed **322 suites**, generated-output equality,
package budgets and shipped-script syntax checks. Its temporary-index tree is
`42dcb94bb6fad728d67c866c184bee88f4a3f2e7`. The lifecycle-aware native stop helper
was refined after this gate and independently syntax-checked and run in both
browsers; runtime source remained byte-identical. Final audit text was completed
after validation. The real Git index remains unstaged.

Exploratory outputs are retained separately. One early smoke run stopped on a
harness wait for an applied-state key absent on an ordinary wake. An earlier
Chromium run passed its recovery checks but encountered a temporary-profile
cleanup lock; that verified temporary directory was subsequently removed. A later
stop-detection timeout prompted the lifecycle-notification change above. These
incomplete runs are not counted among the final passes. The initial gate also
identified fragment fixtures needing the new readiness/health dependencies; their
previous assertions remain, and the storage registry still enumerates every key.

Raw logs/reports stay local in `tmp/recovery-phase06/` and
`docs/perf/traces/recovery-phase06/`. `identities.json` records exact report/tool
hashes, runtime identities and byte agreement with the working tree.

```powershell
$env:WARDENONE_HEADLESS='1'
$env:WARDENONE_SOFTWARE_GL='1'
& 'C:\Program Files\nodejs\node.exe' tools/browser-worker-interruption.js --extension tmp/recovery-phase06/review/candidate --browser tmp/chrome-minimum-121/chrome-win64/chrome.exe --out tmp/interruption.json
& 'C:\Program Files\nodejs\node.exe' tools/browser-cold-wake.js --runs 3 --browser tmp/chrome-minimum-121/chrome-win64/chrome.exe --extension tmp/recovery-phase06/review/candidate --synthetic-rules 29950 --out tmp/worker.json --trace-dir tmp/worker-traces
```

The local popup repeat script is retained as
`tmp/recovery-phase06/review/popup-ab.cjs`, with its hash in `identities.json`.

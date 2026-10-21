# Worker interruption audit

Reviewed 20 October 2026 against WardenOne's Chrome 121 minimum.

Ordinary idle shutdown and forced termination are different cases. Chrome normally
ends a worker after 30 seconds of inactivity; extension events and API calls reset
that timer. Global variables are discarded, so recovery from durable state is an
expected part of the MV3 lifecycle.
[Chrome lifecycle documentation](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle).

Each DNR update is atomic: an unsuccessful replacement leaves its store unchanged.
Dynamic rules persist across browser sessions, and session rules survive worker
restarts within the browser session. Reading rules does not remove or suspend them.
There is no transaction covering every owner and both stores together.
[Chrome DNR update semantics](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#method-updateDynamicRules).

## Concrete gaps corrected

- **Badge navigation reset:** `onBeforeNavigate` assigned directly to the count map,
  bypassing the ordered reset and persistence path. Hydration or a later restart
  could restore a previous page's count. It now uses `resetBadge()`.
- **Badge acknowledgement:** the last-written snapshot was recorded before storage
  acknowledged it, including when storage failed. Only successful writes now count
  as persisted; failed writes receive at most three automatic retries.
- **History during a write:** new entries could replace the session journal with
  only the new queue while an earlier batch was still being written to local
  storage. The session snapshot now includes both until the local write succeeds.
- **Interrupted reconciliation:** failure reporting happened after owners settled.
  Terminating a worker before that point left no failure marker. A separate session
  marker is now acknowledged before rule owners run and is cleared after the
  outcome has been handled. A new worker detects unfinished intent and reconciles
  the latest stored settings without the delay used for completed failures.

The pending marker stores a timestamp, not a second copy of settings or browsing
data. It belongs to the data-erasure inventory. Failure to store intent leaves
installed rules unchanged and reports an unapplied reconciliation.

## Verification and limits

The tests hold storage acknowledgements and history read/write callbacks open,
simulate failed storage writes, and create fresh worker realms over the same
session state. They cover navigation during badge hydration and new history
arriving while the earlier batch remains in flight.

`tools/browser-worker-interruption.js` also uses a real disposable Chromium profile.
It stalls the Header Shield owner, verifies durable pending intent, forcibly stops
the worker through DevTools, confirms its private heap was discarded, and wakes a
fresh worker. The new worker installs the latest strict-referrer rule and clears
pending intent. This passed on Chromium 155.0.8059.85 in Brave.

This does not promise lossless handling of arbitrary crashes. Badge and history
updates are still coalesced; termination before storage acknowledges them can lose
uncommitted display counts or log entries. The history journal keeps its existing
100-entry cap. A crash after a local history commit but before journal cleanup can
replay that batch. Recovery is not an exactly-once transaction.

The pending marker does not keep a worker alive or wake it by itself. A subsequent
extension event resumes unfinished work. Existing browser-owned DNR rules continue
to enforce their last committed state throughout that interval.

## Targeted ad Activity listener startup

The targeted `webRequest.onErrorOccurred` listener was attached from the
packaged tracker-file fetch callback. That violated MV3's synchronous listener
registration requirement. It now attaches during script evaluation with the
same eleven destination patterns and the same script/frame request types.
The gate compares that synchronous filter with the scoped tracker-rule data,
so a ruleset edit cannot silently leave the filter stale or broaden it.

`tools/test-targeted-ad-notices.js` failed before the fix because no error
listener existed before startup yielded. It now also creates two fresh worker
realms, withholds the rules fetch, delivers the first blocked-request event,
and verifies that evidence processing resumes once the file arrives. Existing
matched-rule attribution and unrelated-request checks remain in place. These
are simulated restarts, not native browser worker termination tests.

Source: [Chrome's synchronous listener registration requirement](https://developer.chrome.com/docs/extensions/develop/migrate/to-service-workers#register_listeners_synchronously).

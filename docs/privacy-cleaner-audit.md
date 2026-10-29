# Privacy Cleaner upgrade

The cleaner is implemented in `background-privacy-cleaner.js`, with controls in
`popup-privacy-cleaner.js`. Existing emergency logout, Forget Me and site-record
erasure keep their own scopes. This upgrade does not add a numbered protection.

The popup uses the existing expandable-row pattern. Common choices stay visible; technical choices,
scheduling, protected sites, history, preset management and reset controls use disclosures. All category IDs and worker
deletion boundaries remain intact. Previewing alone does not delete data: the review
screen displays risks before the separate confirmation action. Browser coverage checks
independent expansion, keyboard operation, light/dark layouts, preset saving and this two-step flow.
Real-click regression checks hold both page scroll and the clicked heading's viewport position
steady across outer and nested dropdowns. The main cleaner is default-open but user-collapsible.

## Deletion boundaries

- Settings, category flags, ranges, origins and presets are validated in the worker.
  Malformed protected origins stop cleaning. A revision prevents stale popup saves
  from overwriting newer choices. Page and web-accessible senders cannot invoke
  cleaner messages through the existing private-message gate.
- A manual run requires a single-use preview, valid for five minutes and bound to
  the saved configuration. Single-site runs also verify the active browser origin.
- Origin filters apply only to supported cache, cookies and storage. Global history,
  download records, form data, extension permission rules and WardenOne records run
  separately. Exclusion failure never falls back to unfiltered deletion.
- Cookie exclusions cover the registered domain. Storage exclusions are exact
  origins; scheme, subdomain and port must each be listed. Name-based cookie cleanup
  also preserves cookies overlapping protected hosts or protected top-level partitions.
  Only confirmed cookie removals increment the count. Matching cannot guarantee
  sign-in preservation, and removal can make consent banners return.
- Browser-history cleanup does not clear tracker observations or Script Drift.
  Each WardenOne record category is independent. Script Drift clearing invalidates
  old scans and drains existing writes before removing baselines.
- `contentSettings.clear` removes extension-owned rules. It does not revoke arbitrary
  browser grants. Download cleaning removes records, not files. Password deletion is
  absent. The cookie API has no reliable creation-age field; no older-than filter is
  offered. Recognized-cookie cleanup explicitly covers all ages.

## Scheduling and records

Scheduling and startup cleanup are disabled by default. Their independent selection
starts with browser cache only. A one-shot alarm is recreated on worker startup;
overdue work coalesces into one attempt. Monthly intervals clamp the next UTC calendar
date to the final day of a shorter month. Browser sleep or closure can delay execution.

The next due date and an interruption marker are saved before automatic deletion.
A worker restart reports an interrupted attempt without replaying it. In-process work
is serialized; startup and overdue cleanup coalesce. Full WardenOne erasure drains
cleaner work before clearing storage and alarms. Private workers do not clean or save
cleaner records. Optional OS notices use fixed text through the existing notification
preferences and contain no site names.

Results contain categories, source, time and success/failure. The UI shows at most 20
results from the last 30 days. Expired results are discarded during later state writes;
there is no exact deletion deadline for an idle profile. Counts or freed space are not
invented. Protected origins and presets remain local preferences and are removed by
full WardenOne reset.

## Verification

`tools/test-privacy-cleaner-wiring.js` exercises the shipped worker module, including
invalid settings, partial failures, revision conflicts, scope, alarms, interruption,
duplicate suppression, record separation and private context. Cookie and Script Drift
suites exercise the shipped classifier and concurrent erasure behavior.

`tools/browser-privacy-cleaner.js` uses a disposable Edge profile and two loopback-backed
origins. `privacy-cleaner-browser-evidence.json` records actual cookie, local storage,
IndexedDB and Cache Storage exclusions, preserved WardenOne observations, a native alarm,
and continued playback in both media fixtures. No personal browser profile is used.
The browser test also checks overdue work across a full profile restart. A startup-only
native event did not arrive in this command-line-loaded unpacked fixture, in either
headless or off-screen mode; startup callback behavior is verified in the worker
harness, rather than claimed as a native-event browser pass.

API references checked on 28 October 2026:
[browsingData](https://developer.chrome.com/docs/extensions/reference/api/browsingData),
[alarms](https://developer.chrome.com/docs/extensions/reference/api/alarms), and
[cookies](https://developer.chrome.com/docs/extensions/reference/api/cookies).

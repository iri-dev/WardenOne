# Firewall decision precedence

Reviewed 25 October 2026. The new noop is a row-level opt-out of All for a
specific request column. It is not a global firewall bypass or a replacement
for parent-domain, parent-site or temporary rules.

| Choice | Compiled behavior | Other protection rules |
| --- | --- | --- |
| Default | No separate cell decision; this row's All choice still applies | Apply with their existing authority |
| Block | Existing explicit block at 97,000 for All or 97,001 for a specific column | Existing priority relationships retained |
| Allow | Existing explicit allow at 97,000 or 97,001 | Can override lower security-list blocks; this is disclosed in the page |
| Noop | Removes this column's request types from the same row's compiled All rule | No allow is installed; other matching rules still decide |
| Cookie strip | Independent Cookie-header removal at 97,002 | Unchanged by noop; blocked requests never carry headers |
| Allow once | Existing session allow at 97,003 | Overrides stored firewall decisions and lower security-list blocks for its scope |

Typed user filters, explicit site pauses, automatic compatibility exceptions and
security rules retain their existing priorities. Noop does not add a rule,
change another owner's rules or increase any exception's authority. A separate
parent-domain row can still block a request whose child row contains noop.
The Frame column continues to mean subframes; All also covers main-frame and
request types with no dedicated column.

The compiler validates column/decision pairs, collects accepted cells in stable
order and enforces the existing 250-decision limit before computing exclusions.
Only accepted noops can narrow an All rule. Noops count toward that saved-state
limit even though they need no DNR ID; this prevents unlimited zero-rule entries.
An omitted legacy noop cannot change a compiled All rule. Ordinary matrices
retain their prior rule ordering, priorities, type coverage and IDs.

Cookie accepts Strip or Default. All accepts Allow, Block or Default. The other
four columns also accept Noop. Invalid combinations such as Script = Strip or
Cookie = Allow are refused before any browser or storage write. Settings backup
validation uses the same decision combinations and preserves noops.

Writes still apply the complete firewall band atomically before persisting the
matrix. On a browser refusal the prior matrix remains stored, and the UI redraws
it. A later storage failure reports that the applied change cannot survive a
restart; it is not labelled saved. Master-off, per-site/all-site reset and
session-allowance handling retain their previous paths.

Chrome's own rule evaluation gives a matching allow authority over lower
priority rules. Removing a manual decision with a high-priority allow would
therefore bypass security filtering. The implementation instead changes the
All rule's positive resource-type list. See
[Chrome rule evaluation and atomic DNR updates](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation).

`tools/test-firewall-semantics.js` covers every noop column and All verdict,
security/tracker/compatibility/user/session conflicts, independent cookie rules,
scope boundaries, parent rows, capacity, omitted cells and backup validation.
`tools/test-user-rules-honesty.js` drives the actual setters through failed
writes and retries. `tools/test-firewall.js` checks the default cycle and direct choices, accessible
state and refusal redraw alongside the existing undo coverage. Advanced cells
use direct selectors, so choosing noop submits one decision without cycling
through an Allow or another intermediate state.

`tools/browser-firewall.js` runs real script, image, subframe and credentialed XHR requests
in disposable Edge profiles. It seeds scoped synthetic security and tracker
rules, verifies block/noop/default/allow and temporary precedence, confirms
independent cookie stripping, simulates a rejected native write through the
real page, and checks the Settings backup cleaner. It fails on any incomplete
assertion and retains a completion flag and runtime source hashes. Local
reports and a UI screenshot are under
`docs/perf/traces/firewall-2026-10-25/`.

Final verification passed all 311 maintainability suites and 19 native checks
on Edge 150.0.4078.48. Live YouTube playback advanced from 0.52 to 16.01 seconds
and Twitch from 12.32 to 27.75 seconds, both unpaused at ready state 4. The full
gate used a disposable index of the working files; the real staging index was
not changed. The measured firewall runtime fingerprints still match the source.

The browser fixture disables unrelated external DNS and uses synthetic threats;
it does not measure real-feed detection accuracy, other extensions' rule
arbitration or full uBlock Origin inheritance semantics. Noop intentionally has
no All or Cookie variant. With Include noop unchecked the original cell cycle
is unchanged; stored noops are always visible and enable the option on page load.

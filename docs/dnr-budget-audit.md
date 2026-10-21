# DNR quota audit

Reviewed 20 October 2026 against the Chrome 121 minimum in `manifest.json`.

The reported 29,975 total mixed dynamic and session allocations. Chrome separates
those stores from version 120, and version 121 raises the dynamic quota to 30,000
while retaining a 5,000 sublimit for unsafe dynamic actions. Session rules have
their own 5,000 quota. These are allocation maxima, not installed-rule counts.

| Quota | Maximum allocation | Browser limit | Spare capacity |
| --- | ---: | ---: | ---: |
| Dynamic | 28,117 | 30,000 | 1,883 |
| Session | 1,987 | 5,000 | 3,013 |
| Unsafe dynamic, included above | 251 | 5,000 | 4,749 |

`background.js` now declares each quota separately. All existing feature caps
remain unchanged. Script Shield's allocation was understated: 32 recovered tabs
can each have one replacement block and eight exact-path allows, plus the blanket
block, for 289 session rules. The old allocation reserved 161. Its full-capacity
test now runs the actual planner instead of pinning that stale number.

The persistent HTTPS copy has an explicit dynamic allocation of one. The small
session reserve includes the session HTTPS copy, privacy/header rules, cookie and
location rules, and IP lookup blocks. Intranet and rebinding rules have separate
session allocations. Script Shield's obsolete dynamic rules are removed during
migration; they are not part of its current session allocation.

Unsafe dynamic capacity reserves every firewall slot for a `modifyHeaders`
cookie rule and one grabber navigation redirect. The remaining dynamic builders
emit `block`, `allow`, `allowAllRequests`, or `upgradeScheme` actions. Session
unsafe rules cannot exceed the separately checked total session allocation.

`tools/test-dnr-budget.js` enforces at least 1,000 spare rules for each checked
quota, requires all declared rule bands to be accounted for, and checks builder
caps against allocations. Mutated allocations that exceed a quota or leave only
25 spare rules fail the test. New features must declare their scope and account
for unsafe actions as well as total rules.

Chrome applies an individual update atomically: a rejected update leaves that
store unchanged. WardenOne's reconciler already retries a failed combined batch
as separate owner writes; its tests cover one owner's failure while another
succeeds. Reconcile failures are recorded for Protection Health and bounded
retries. Remote list failures return an error and retain the previous rule set.
This does not guarantee that every multi-feature refresh succeeds as a unit.

`tools/browser-dnr-reconcile.js` uses a disposable profile. It tests settings
reconciliation near the dynamic limit, then fills both stores independently to
30,000 dynamic and 5,000 session rules. It verifies that excess total rules and
5,001 unsafe dynamic replacements are rejected without removing existing rules.
The check passed on Chromium 155.0.8059.85 in Brave with both stores full and
settings toggles restoring their exact previous rule bands.

Source: [Chrome declarativeNetRequest quotas and update semantics](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-limits).

## Static package reserve

The eight declared rulesets contain 28,367 rules, all enabled by default. AdShield
contains 28,024; the other seven contain 343. This uses 94.6% of Chrome's 30,000
guaranteed static allocation and leaves 1,633 spare rules. The three regex rules
are already included in that total. No static rules have been removed.

The gate previously rejected totals above 30,000 but only warned about low
headroom. It now rejects packaged totals above 29,000, keeping at least 1,000
slots free. Both the working-tree DNR check and staged-package footprint check
count disabled packs too, since settings can enable them later. Fixtures cover
the exact boundary, one rule beyond it, over-quota totals and a disabled pack
that would consume the reserve.

Chrome's guarantee is not a per-extension hard ceiling: additional static rules
depend on the shared global allocation and can require runtime availability
checks. WardenOne's package budget avoids that dependency. The separate 1,000
regex-rule limit and compiled-regex complexity limits are not increased by this
reserve.

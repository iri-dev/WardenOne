# Filter and settings import boundary

Reviewed 20 October 2026.

The reported exceptions parsed as network allows. The former priority of 98,000
could suppress lower-priority security blocks, and the Settings confirmation showed
list counts without their contents.

## Scope and authority

Exceptions now need a host anchor (`||example.com^`) or an anchored HTTP(S) URL.
The host must extend beyond its public suffix. The worker uses both PSL sections
to reject registry suffixes, wildcard suffixes and shared-platform apexes. Every
exception also carries a `requestDomains` condition, so URL text cannot widen its
host scope.

| Source | Block priority | Exception priority |
| --- | ---: | ---: |
| Direct editor decision | 97,000 | 98,000 |
| Settings/filter file import | 899 | 900 |
| Subscription, including refreshes | 899 | 900 |

The external-source ceiling remains below Script Shield (1,000/1,900), packaged
logger blocks (1,000), logger navigation (1,500), and feed security blocks
(2,000/2,001/3,000). Exceptions still override external filter blocks. Imported
rules do not override an explicit manual block.

Imported line provenance is stored alongside the text in `wardenone_user_rules`.
An unchanged editor save, a subscription change and a new worker preserve it. A
newly edited line is a direct manual decision. Existing stored editor text has no
historical provenance, so scoped legacy lines retain manual authority; the new
anchor checks still reject its broad exceptions. All subscriptions receive the
ceiling when rebuilt, regardless of when they were added.

## Review before applying

Settings imports use a modal with a scrollable body and explicit Apply/Cancel
buttons. It shows every changed value, trusted host, firewall verdict, filter
line, subscription URL and enabled state, blocked site and hidden selector. File
text is assigned with `textContent`; list titles and selectors cannot create
markup. Cancel has initial focus, and no import writes occur before approval.

Importing remains a configuration operation: an approved file can change the
master switch or add trusted sites. These changes are visible in the review;
the rule ceiling does not revoke the owner's direct controls.

## Evidence

The parser and worker regression suites cover the supplied broad exceptions,
public/private/wildcard suffixes, actual security-rule precedence, cold worker
recovery, unchanged saves, and popup filter-file provenance. The Settings browser
suite verifies real entries beyond the former ten-item summary, inert markup,
no writes before approval, and unchanged trust/filter/firewall state on Cancel.
All 170 Settings checks passed in Edge 150 and Chrome 121. A native DNR
`testMatchOutcome` check in Edge 150 also confirmed that the packaged logger block
wins over an imported `@@||iplogger.icu^` exception at priority 900.

ICANN data comes from the same PSL snapshot as the existing private data:
`329834e40a8543f3ef6265db543b7af6c4185571`. The private section was compared
byte-for-byte with the previous generated data and is unchanged. The updated
builder validates both sections and prints additions/removals for review. The
full suffix data is worker-only. The later site-boundary correction also embeds
compact ICANN data in both content-script worlds; see `icann-boundary-audit.md`.

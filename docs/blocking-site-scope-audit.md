# Blocking scope

Context-menu blocks and automatic learned blocks use `siteIdentityBg`, including
the private Public Suffix List. A block on `alice.webflow.io` covers that tenant
and its descendants, without covering `bob.webflow.io`. Existing compatibility
vetoes still apply to automatic learning; explicit user blocks bypass them.

Activity's typed host and URL patterns keep the host/path supplied by the user.
They do not pass through the site-wide normalizers. A typed hostname covers
itself and its descendants, as the entry label states.

## Stored entries

`wardenone_learned` stores domain keys with `firstSeen`, `reason`, `hits`, and an
optional `userBlocked` flag. It contains no original source hostname. Once an old
normalizer saved `webflow.io`, there is no reliable way to recover the tenant.

Cold-start hydration checks each stored key with the current normalizer for its
entry type. Bare public suffixes are rejected and removed from the persisted map;
they are not rewritten into guessed tenant names. Valid tenant entries retain
their evidence, and live entries are merged with the restored entries. Changed
keys are persisted and the learned DNR band is reconciled. A failed persistence
attempt leaves the unsafe target unenforced and can retry on the next wake.
Page snapshots independently reject public suffixes before exposing learned data.

This cleanup does not infer intent for ordinary registered domains, change feed
data, or rewrite the separately stored typed host/path patterns. A withdrawn
platform-wide learned entry must be replaced with a specific tenant if needed.

`tools/test-blocking-site-scope.js` exercises the actual normalizers, stored-entry
restore, rule builder and page snapshot filter against the bundled PSL. It covers
unrelated tenants, wildcard and exception rules, literal patterns, legacy suffix
targets, restart stability, evidence merging and compatibility vetoes.

## Tracker Learner

The tracker normalizer uses the same site identity for observations, first-party
corroboration, proposals, approvals, status and DNR targets. Per-site rules also
normalize their initiator to that tenant. Ordinary subdomains remain one site;
unrelated hosting tenants do not share evidence or decisions.

Learner storage schema 3 removes bare public suffixes and opaque platform apexes
from tracker targets and per-site controls. No original tenant can be recovered
from a stored `webflow.io` key. Valid tenant approvals and proposal states survive;
session restoration validates its separate counts and site views with the same
normalizer, preserving once-per-session membership for valid entries.

The consent and minimisation suites cover observations through approval, migration,
worker restoration and both sides of per-site controls. The native media/security
fixture checks that unapproved tenants remain accessible, an approved Alice target
blocks only Alice, an obsolete apex rule is removed, and an Alice-only control
does not affect Bob. Evidence thresholds and user approval remain required.

# Public-suffix pause boundaries

Checked 2026-10-21 against the bundled PSL snapshot.

The page matcher already separated unrelated ICANN-suffix sites, but the worker
normalizer still accepted bare public suffixes. Native DNR domain matching does
not consult that matcher: a stored `co.uk` pause could therefore install a session
`allowAllRequests` rule for every descendant of that suffix.

Permanent and timed pause writes in Settings, the popup and the worker now validate
the changed lists against both complete PSL sections before storage. Normalization
also rejects public suffixes before active pauses or DNR rules are calculated, so
old or externally written entries cannot install broad exceptions. The next
allowlist rule update removes the previous band and installs the filtered entries
atomically. Rejected legacy entries remain visible in storage for removal.
Worker snapshots and popup relays also filter these entries before page scripts
receive them, including when the user changes an unrelated setting.

The full raw PSL is loaded in the worker; extension pages and content worlds use
the generated compact boundaries. It is not added to web-accessible resources. Wildcards and exception
rules follow the existing PSL lookup implementation, rather than a new suffix
table. Wildcard roots are also rejected because a domain-scoped exception there
would cover unrelated registrants below the wildcard. The [PSL specification](https://publicsuffix.org/list/) defines these
boundaries, including suffixes controlled by hosting platforms.

`tools/test-allowlist-public-suffixes.js` sweeps all 10,324 shipped rules and tests
`co.uk`, `com.au`, `github.io`, non-curated private suffixes, wildcard expansions,
IDNA and URL variants, timed pauses, valid tenants, and `www.ck`/Kawasaki exception
rules. It executes all three config writers and the actual DNR applier, checking
rejection before storage and atomic removal of legacy rules. The browser Settings
suite additionally exercises rejected inputs, valid tenant/exception saves, and
actual session rules after unsafe entries are injected directly into storage.

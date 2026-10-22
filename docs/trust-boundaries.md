# Trust boundaries

WardenOne uses separate authorities for ownership, user decisions, external lists
and browser state. A compatibility exception must not become a security verdict.

## Domain scope

`domain-utils.js` is the canonical source in the worker, extension pages and MAIN
world. The build copies it to `domain-utils-isolated.js` for the isolated world.
Both contain the complete ICANN and private Public Suffix List.

| Operation | Shared function | Scope |
| --- | --- | --- |
| Validate a site control or trusted host | `normalizeSiteHost` | Canonical host; rejects public suffixes and opaque provider roots |
| Create a manual, learned or tracker site target | `normalizeSiteTarget` | Tenant identity; opaque cloud hosts remain exact |
| Compare owners | `sameSiteIdentity` | Full public and private suffix boundaries |
| Apply a host exemption to descendants | `hostMatchesSite` | Descendants within the same owner only |
| Query registration metadata | `registrableDomain` | Registry lookup key; not a trust boundary |

The worker additionally rejects local/private addresses for remotely trusted
hosts. Host controls preserve a supplied subdomain; site controls deliberately
use the tenant identity. Neither may turn a platform suffix into a wildcard.

## Network authority

`network-policy.js` validates every dynamic and session write before it reaches
Chrome. Packaged static rules and the ad-list compiler use the same validator.
Only `writeDynamicRules` and `writeSessionRules` call the native write APIs.

Automatic exceptions have a maximum priority of 1,999. Security blocks start at
2,000; downloaded security rules use 3,000. This is a strict inequality because
Chrome resolves equal-priority allow/block conflicts in favour of allow.

Higher exceptions are reserved for named rule owners: explicit site pauses,
typed user filters, firewall decisions and user-approved tracker site controls.
The gate compares their bands with the worker's actual band definitions.
Subscribed/imported filter exceptions retain their lower compilation priority;
approving a list does not grant it the authority of a typed user exception.

Document exceptions must name a valid individual site. Bundled document
exceptions remain below the security tier for compatibility; automatic media and
login allowances permit only the matching request. Existing explicit user
overrides retain their intended scope and priority.

## Page configuration

The `AUTH` region in `src/content.js` owns the authentication implementation.
The build copies that region into the bridge and all MAIN consumers and refuses
drift. Each receiver uses a private document key, verifies the MAC and sequence,
and consumes the exact JSON snapshot it verified. Sequences advance only after
verification. Key delivery is accepted only before executable page content.

Twitch and YouTube use the shared configuration receiver. The engine, redirect,
permission, mining, Spotify and fingerprint guards use its snapshot verifier
alongside their other signed message kinds. Public handshakes, DOM events and
`window.__WO_CONFIG__` do not authorize those independent configuration listeners.
The engine's internal modules continue reading its private authenticated store.

## Browser failures

Chrome applies each DNR update atomically, but a full settings refresh spans
several browser APIs. WardenOne records pending reconciliation, serializes each
owner's changes and commits applied-state keys only after success. A rejected
combined rule batch falls back to individual owners so one failure cannot stop
unrelated protections from updating.

Failures propagate through the applier result to degraded Health and bounded
reconciliation retries, including after a cold wake. Infrastructure compatibility
uses the same reconciliation inventory. An incomplete shutdown stays eligible
for retry and shows `Needs review`; it is not reported as successfully off.

## Regression coverage

`tools/test-trust-boundaries.js` checks domain targets across UI imports, unrelated
tenants, exception authority, packaged rules, shared verifier use, forgery/replay
and rejected browser writes. The existing import, tracker, reconciliation and
shutdown suites execute their feature paths. Native Edge and minimum-version
Chrome media tests exercise real signed toggles, hostile page messages, child
frames, tenant-scoped rules, failed shutdown recovery and playback.

Chrome's precedence and atomic update contracts are documented in the
[declarativeNetRequest API](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest).

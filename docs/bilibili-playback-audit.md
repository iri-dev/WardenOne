# Bilibili playback investigation — 2026-10-20

The reported video was tested at
`https://www.bilibili.com/video/BV1qrkbYdEuS/` in isolated, signed-out browser
profiles. The extension used its default settings. No personal browser profile
or account was used.

## Cause

`api.bilibili.com/x/player/wbi/playurl` returned DASH audio/video URLs on
`upos-sz-mirrorcosov.bilivideo.com` and
`upos-hz-mirrorakam.akamaized.net`. Their `buvid` query value matched an identifier
in the page's storage, which made SessionShield classify the segment requests as
token exfiltration. The Activity Center recorded both destinations, and the
player remained at zero seconds with `readyState === 0`.

The response prefilter recognised sensitive parameter names and JWTs, but did
not recognise stored identifiers under ordinary parameter names. Consequently,
the guard missed the server-supplied URL evidence that its existing issued-link
policy was designed to use. The child-frame guard already scans candidates
without relying solely on sensitive parameter names.

The top-frame response prefilter now also checks the remembered identifier
prefixes used by request detection. Existing response-size, traversal and cache
limits remain in effect. The same correction applies when reading JSON, text,
XHR, playlists and DASH manifests. There is no new domain trust entry, media-host
exemption, configuration pause or network allow rule.

## Evidence

Observed playback positions, in seconds, on the linked 332-second video:

| Browser/build | First observation | Second observation | Result |
| --- | ---: | ---: | --- |
| Edge 150.0.4078.48, extension disabled | 17.55 | 29.58 | Playing |
| Edge 150.0.4078.48, extension before fix | 0 | 0 | Segment requests blocked |
| Edge 150.0.4078.48, extension with fix | 12.62 | 24.65 | Playing, ready state 4 |
| Brave executable 155.1.97.59, extension with fix | 12.17 | 24.22 | Playing, ready state 4 |

Both fixed live runs had no failed network requests or HTTP error responses
during the observation window and no `blocked_token_exfil` activity. These were
headless tests of this public video; they do not establish every quality level,
account state, live stream or regional variant.

`tools/test-token-exfil-issued-links.js` exercises the shipped detection code
through fetch JSON/text and XHR JSON/text readers. It checks that unissued
identifiers, changed hosts/paths, substituted or appended stored credentials,
JWTs, sensitive bodies, authorization headers and response echoes remain blocked.

`tools/browser-engine-smoke.js` checks the complete extension with native fetch,
XHR and beacon APIs against a local media fixture. Only the two API-issued GET
requests reach the fixture server; credential uploads and altered destinations
do not. It also verifies that a shipped tracker rule still blocks its request.

The rebuilt extension passed the full maintainability gate, including all 292
test suites, and the native browser smoke suite passed in Edge 150.0.4078.48.

## Privacy boundary

Recognising a provider-issued playback URL is not a promise that the provider
cannot track its viewers. Bilibili and its delivery providers still receive
network requests, including IP addresses, requested videos and identifiers in
those URLs. The existing network, fingerprinting and credential protections
remain enabled; this change neither removes those identifiers nor establishes
that all Bilibili telemetry is blocked.

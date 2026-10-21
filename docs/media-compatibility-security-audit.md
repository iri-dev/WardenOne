# Media compatibility and security rules — 2026-10-21

The session media band installed YouTube frame exemptions at priority 95,000
with `allowAllRequests`, plus destination/initiator resource exceptions at
90,000. Downloaded security rules use 3,000. Chrome carries a frame's
`allowAllRequests` priority into subsequent requests and descendant frames,
so an unrelated blocked destination could load from the allowed document.

The local HTTPS browser regression reproduced this before the fix: a request
from a YouTube-origin document to a harmless test host, explicitly blocked by
DNR, returned HTTP 200 and reached the fixture server. No malware was fetched.

## Rule boundary

The same media rule IDs now use request-specific `allow` actions at priority
1,900. Frame navigation exceptions still name the three YouTube domain families
and only match main/subframe requests. Resource exceptions retain their existing
destination, initiator and resource-type restrictions. X/Twitter exceptions
still exclude pings. None of these rules grants inherited frame authority.

The priority remains above ordinary ad/tracker blocks (1,000/1,100) and below
learned/feed security blocks (2,000/3,000). The applier atomically replaces the
entire media band, removing the legacy frame rules and obsolete edge-ad blocks.
Explicit user block priorities remain authoritative over compatibility.

These changes cover the media band. User-selected site trust and the separate
login/infrastructure exception policies retain their own authority; this is not
a claim that every automatic exception elsewhere has been audited.

## Verification

`tools/browser-media-security.js` runs real HTTPS documents through native DNR
with all fixture origins resolved to a loopback server. It verifies:

- a priority-1,000 host block stays effective from the video page and its
  cross-origin child frame;
- a priority-3,000 security rule still blocks a path on the media CDN itself;
- blocked requests never reach the server, while a harmless control request
  succeeds and a normal media resource plays;
- reintroducing the old frame exemption reproduces the bypass, and replacing it
  restores blocking in the already-loaded document without a reload.

The matrix includes YouTube, YouTube-nocookie, youtu.be and Twitch. It passed in
Edge 150.0.4078.48, Chrome 121.0.6167.184 and Brave's Chromium 155.0.8059.85.
The fixture uses public throwaway
TLS credentials in a disposable browser profile; production TLS is unchanged.
Both Windows CI browser jobs now run it.

Unit tests cover removal of an existing legacy exemption, request-only actions,
resource and initiator boundaries, security priority ordering, unchanged-state
deduplication and complete band removal when disabled.

A real YouTube watch page (`jNQXAC9IVRw`) loaded and advanced with no media error
in Edge. A live Twitch stream (`jynxzi`) also advanced; the initially selected
Monstercat channel reported that it was offline. These checks used default
extension settings in fresh profiles with the corrected rules.

The complete 292-suite maintainability gate passed with the updated workflow
inventory and staged package checks.

Source: [Chrome DNR rule evaluation and inherited frame allowances](https://developer.chrome.com/docs/extensions/reference/api/declarativeNetRequest#rule-evaluation).

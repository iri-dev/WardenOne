# Changelog

## 1.0.0 — 2026-07-29

First public-release hardening pass.

### Fixed

- Stopped "Suspicious site behavior" firing on everyday sites. Loading a
  cross-site asset before your first click and measuring the canvas is what
  every large site does, so those signals no longer raise a warning on their
  own; a site's own asset host (x.com to twimg.com, or any `assets.<same-site>`)
  counts as first-party; and the reputable-site list is now matched on the
  registrable domain, which both adds the sites people actually use and stops a
  lookalike like `google.com.<attacker>.cfd` being trusted for containing a
  brand name.
- Held the behavioural verdict until the domain-age answer arrives, so an
  established domain is no longer warned about because the lookup came back
  after the warning had already fired.
- Closed intermittent Twitch pre-roll and mid-roll leaks by starting a clean
  alternate stream from Twitch's current ad warning before the native media
  poll, bootstrapping replacement workers with the active V2 master, and
  recovering part-only ad deltas through a bounded complete or clean playlist.
- Neutralized Twitch's current GraphQL video/display creative response and the
  dated VAST fetch/XHR endpoints before a full-player pre-roll can render.
- Answered Twitch's current video-ad preflight with its recognized decline
  result so non-forced client ads leave through the player's normal reset path.
- Replaced the unreliable embed-only warm-up with a bounded popout/mobile-web
  race, and treated authoritative Twitch pre-roll metadata as an ad even when
  its media segment is misleadingly titled `live`.
- Kept Twitch master snapshots and ad warnings channel-scoped across rapid SPA
  switches, re-resolved late player mappings after low-latency retries, and
  neutralized worker-originated creative responses before they can render.
- Removed current Stream Display, squeezeback, companion, and independent video
  creatives while restoring the genuine live player to its full layout.
- Kept ad-time low-latency HLS transitions internally consistent and cleared
  intervention state during fail-open recovery to prevent black screens,
  repeated stalls, and error 2000/3000 loops.
- Kept Twitch playback continuous across background-tab ad transitions without
  weakening native hidden-tab safety checks, and excluded trusted media sites
  from the generic background-video throttle.
- Made Twitch worker replacement fail open when the original worker cannot be
  read, cleaned up terminated workers, reference-counted concurrent player
  interventions, and aimed stall recovery at the identified live video.
- Added bounded Twitch playback recovery for network/decode failures so ad
  interception fails open instead of leaving error 2000/3000, a black player,
  or a reload loop.
- Preserved Twitch low-latency HLS semantics and native playback requests while
  keeping confirmed ad-segment handling local to the browser.
- Split the popup guard from the full page engine so embedded players receive a
  small all-frame popup defence without the invasive top-frame feature bundle.
- Made the strict ad-popup shield the fresh-install default, while keeping
  explicit user opt-outs and login/OAuth flows intact.
- Prevented overlay cleanup, tracker learning, and network scriptlets from
  treating player frames, controls, or shared streaming infrastructure as ads.
- Made Verify & Repair follow the same frame boundaries as the manifest.
- Added a general player-safe mode for watch/embed routes: cosmetic rules,
  procedural removals, and every list-driven scriptlet now fail open while the
  dedicated popup guard stays active.
- Added failure-driven Smart Script Shield recovery for streaming players:
  after a fresh trusted player interaction, the failed script host family is
  retried under a tab-local replacement rule. If a second correlated failure
  survives that retry after a new player interaction, a bounded exact-script-path
  and initiator-scoped exception is used below site-control and security priority.
- Added bounded player detection for Video.js, JW Player, Plyr, Shaka, Clappr,
  DPlayer, and ArtPlayer, including delayed and single-page-app player startup.
- Made blocked player popups return a short-lived, non-navigable compatibility
  handle so ad-gated embeds continue loading instead of freezing on a spinner.
- Neutralized cross-site popup links layered over a player and preserved the
  underlying play/server-control activation.
- Kept hidden-autoplay protection away from media inside recognized player
  shells so zero-size initialization no longer pauses legitimate video.
- Fixed mixed-action consent dialogs so an unrelated account control no longer
  suppresses an otherwise explicit reject-all / accept-all choice.
- Refined sensitive-request detection so opaque verification responses and
  ordinary request identifiers remain functional while stored tokens, JWTs,
  credential-labelled fields, and authorization headers stay protected.
- Quieted behavioral and fingerprint notices only while a structurally visible
  browser-verification challenge is present; request protections remain active.

### Quality

- Added popup, streaming, Twitch fail-open, network-policy, and compatibility
  regressions to the maintainability suite.
- Ran the security posture check and the OAuth guard tests as part of the
  maintainability gate. Both existed but neither was executed, so a regression
  in the extension-page CSP, the permission set, the HTML-sink rules, or the
  consent-grant scoring could have landed without turning the gate red.
- Corrected and expanded third-party licensing and attribution notes.

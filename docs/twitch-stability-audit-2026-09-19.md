# Twitch playback stability audit — September 19, 2026

Live verification continued September 20.

## Conclusion

WardenOne's alternate-session approach is viable, but the existing implementation
was not reliably preserving playback. More ad markers and shorter retry timers
are insufficient. Session alignment, unnecessary handoffs, and request scheduling
all matter. Four defects were reproduced in the worker harness and fixed locally.
A subsequent live test exposed a fifth defect in primary-player recognition,
also reproduced and fixed in the page harness. This is not a claim of guaranteed
adless or uninterrupted playback.

The next substantial architectural improvement would be a bounded, shared segment
timeline: match native and alternate content by broadcast position, retain the
identity of already-served segments, and make source changes explicit to the
decoder. That is a larger change than offset correction and needs real media
validation, not just more synthetic playlist tests.

## Observed browser failure

On Brawlhalla in Brave, with the previously edited WardenOne module enabled:

- Twitch logged a short playhead stall near playback time 174.11 seconds.
- At playback time 645.31 seconds, the buffer ended at 645.38 seconds and the
  playhead stopped. A video error followed about eight seconds after `waiting`.
- Twitch displayed **“Your browser encountered an error while decoding the video.
  (Error #3000)”**. WardenOne still reported `blocked-clean` when inspected later.

This reproduces the user's symptom. It does not establish which individual
playlist or media segment caused that particular decoder error: the browser
tool could inspect the page but did not expose the player worker's network bodies.
“Clean fallback active” is not evidence that its media remains decodable.

The user reloaded the local extension, and the test tab was refreshed. Inspection
of the loaded source verified the warning guard, broadcast alignment, and parallel
refresh changes. **That build also failed**, near playback time 168.66 seconds.
The video reported `PIPELINE_ERROR_DECODE` approximately eleven seconds later,
and no recovery-state transition occurred during the stall.

After restarting the player through Twitch's own visible control, inspection
confirmed `video.srcObject instanceof MediaSourceHandle`, with empty `currentSrc`
and no `src` attribute. WardenOne's primary-player and recovery paths all required
a blob URL, so they did not recognize this actual player. The new page test
reproduced that exact missing-recovery condition before the fix. The fix assigns
a weakly held identity to each genuine browser MediaSourceHandle and includes it
in primary-player selection and intervention provenance. Replacing the handle
invalidates the old source's attribution.

On September 20 the user reloaded the extension again. Brawlhalla was offline,
so live verification moved to VGBootCamp. The freshly loaded module matched the
local file after CRLF normalization: 208,035 characters, FNV-1a diagnostic
fingerprint `40ff2ca8`. This confirms that MediaSourceHandle support and the
strict live-tag validation were included. The test player used a genuine
MediaSourceHandle, and the blocker reported a clean alternate active.
Passing synthetic checks and testing a different channel are not Brawlhalla
playback sign-off.

VGBootCamp's configured ad density was not verified. Blocker-state transitions
show that the alternate path was exercised; they do not establish the number or
duration of actual ad breaks. This run must not be described as a heavy-ad stress
test. The user specifically raised this distinction during verification.

The VGBootCamp run completed 635 seconds of instrumented playback at 1920×1080.
The playhead advanced 634.964 seconds, with eight blocker-state transitions and
no recorded `waiting`, `stalled`, `seeking`, media error, or recovery-cooldown
event. At completion the buffer was 4.72 seconds ahead; 39,565 video frames had
been counted, with six dropped. Temporary page listeners and the observer were
removed before navigating away. This is a positive bounded stability result,
not proof of performance on a heavy-ad channel or on Brawlhalla.

### Confirmed ad-break test: Symfuhny

Later on September 20, testing moved to Symfuhny, live with approximately 2,800
viewers. xQc was offline when checked, so his replay was not counted as a live
test. The loaded module again matched the local fingerprint above. The player
used its default quality selection and decoded 2560×1440 video.

A temporary, non-pausing debugger condition observed the extension's existing
worker-log receiver. It recorded only selected event categories and elapsed
times, never signed playlist URLs, tokens, or full log messages. Separate page
listeners recorded playback events and blocker/recovery state changes from
startup. This diagnostic did not alter the shipped blocker.

At 152.447 seconds, the worker began reporting confirmed ad playlists. It
reported 43 confirmed refreshes and 43 successful clean replacements during the
observed episode. These are playlist refresh counts, not counts of individual
ads or separate breaks. A visual inspection during replacement showed the
streamer's gameplay. The clean alternate remained active until 357.945 seconds,
when the blocker cleared its intervention state and returned to native media.
There was no post-startup `waiting`, `stalled`, `seeking`, media-error, or recovery
event during entry, alternate playback, or that return. Startup itself included
one `waiting` event lasting eight milliseconds before the initial `playing`.

At 393.956 seconds, after approximately 36 seconds back on native playback,
another interval of confirmed ad playlists began. It added 76 confirmed
refreshes with 76 clean replacements through 539.967 seconds. Further confirmed
ad delivery arrived before the next native return, so the alternate remained
active. The trace distinguishes ad-marked intervals separated by native
playback, but does not establish Twitch's campaign or individual-ad IDs.

The bounded run ended at 735.866 seconds (12 minutes 16 seconds), with 165
confirmed ad-marked refreshes and 165 successful clean replacements in total.
The playhead was at 736.145 seconds; playback was active at 2560×1440 with
1.888 seconds buffered ahead. The browser counted 44,175 video frames and seven
dropped frames. No post-startup `waiting`, `stalled`, `seeking`, media-error, or
recovery event occurred in the entire run. Two visual checks during intervention
showed gameplay. One complete ad-to-native return was observed; the test ended
while the later alternate was still active, so a second return was not verified.
The temporary debugger condition, event listeners, observer, and diagnostic
page object were removed after measurement. No further production-code change
was made for this test.

This confirms actual ad-path coverage on a second live channel. It does not
establish the channel's configured ads per hour or a universal fix for
Brawlhalla's earlier decoder failure.

## Reproduced defects and local fixes

| Defect | Playback consequence | Change and evidence |
| --- | --- | --- |
| An ad-service warning replaced an otherwise clean native playlist. | Ad requests or declined ads could trigger needless source changes. | Warnings still prewarm the alternate; warning-only clean media remains native. A new test failed before the fix and now preserves the exact native body. |
| Cross-session alignment assumed identical `PROGRAM-DATE-TIME` clocks. | The same broadcast content could receive the wrong media number, be skipped/repeated, or be rejected as stale. | Prefer `EXT-X-TWITCH-LIVE-SEQUENCE` when a broadcast anchor exists. Tests cover alternate clocks six seconds behind and eight seconds ahead, entry/exit, and tags on either side of `EXTINF`. |
| Converting a delta alternate to ordinary HLS removed `EXT-X-SKIP` without correcting its head. | A healthy advancing route appeared to regress or reused old numbers for different bytes. | Advance the ordinary playlist head by the skipped count. The test verifies that head 8997 plus four omitted entries yields first listed segment 9001. |
| An active alternate refresh started only after native media returned. | Native latency consumed the alternate's deadline and forced unnecessary fallback. | Refresh both sessions concurrently and share the prepared result. A 1000 ms native leg and 500 ms alternate leg now retain the clean route without adding the two delays. |
| Primary-player selection and recovery required a blob URL. | The real MediaSourceHandle player bypassed stall/decode recovery. | Recognize genuine worker-owned handles by object identity. The new test verifies stall recovery, resumption after progress, and isolation from a replacement handle. |

The parser does not carry live numbering across a discontinuity without a fresh
tag. Once a broadcast anchor exists, an unproven alternate is rejected rather than
matched using a potentially unrelated wall clock. An extra regression covers
discontinuities, empty tags, and non-integer syntax.

Earlier local changes remain: healthy alternate sessions renew their idle expiry;
native numbering survives temporary recovery and missing timestamps; translated
blocking cursors are removed; repeated intervention-linked failures back off.
These addressed genuine defects but did not prevent the observed Error #3000.

## Comparison with current alternatives

These are source reviews, not independent side-by-side browser benchmarks.

| Approach | Relevant finding | Implication for WardenOne |
| --- | --- | --- |
| [scamorza/TwitchAdBlock](https://github.com/scamorza/TwitchAdBlock/tree/a1453021869b43870e30fac4c384d09b60bef435) | Uses broadcast live sequence, a shared segment table, and one output clock. Its own documentation also acknowledges freezes and buffering, and includes player recovery. | The shared timeline is the strongest architectural reference found. This patch adopts broadcast alignment, not its entire implementation. Empty segment responses and wholesale recovery loops are not adopted. |
| [GosuDRM/TTV-AB](https://github.com/GosuDRM/TTV-AB/tree/27cf5fbec488a4a3f03a2a291d4dced538def2ed) | Separates clean-native playback, backup health, native return, and player recovery; offers diagnostic logs and lower-quality fallback choices. | Better end-to-end observability and coordinated recovery deserve further work. Its synthetic hold media and optional ad telemetry spoofing are not prerequisites for the fixes here. |
| [ryanbr/TwitchAdSolutions](https://github.com/ryanbr/TwitchAdSolutions/tree/e4dfb26755cb440f9ec6a2430a9b131fa1de062a) | Maintained successor reference for VAFT and alternative approaches. | Useful comparative source; maintenance alone does not establish superior playback reliability. |
| [TTV LOL PRO](https://github.com/younesaassila/ttv-lol-pro) | Uses HTTP proxies and describes blocking most livestream ads. | A materially different option, with a proxy availability/trust dependency. No third-party proxy routing was added to WardenOne. |
| [Original pixeltris project](https://github.com/pixeltris/TwitchAdSolutions) | Archived; its historical issues already describe freezing associated with replacing playlists. | Useful history and attribution, not sufficient evidence of today's best implementation. |

The current upstream designs reinforce the central finding: obtaining a clean
playlist is only part of the problem. The player must accept its media timeline
and recover when it cannot. No reviewed project's documentation establishes a
universal, maintenance-free solution. Installing a second Twitch blocker alongside
WardenOne would also confound testing because both may hook the same worker/fetch
paths; it is not the proposed fix.

## Remaining architectural limits

- Native requests still determine when the current handler can return. Parallel
  refresh eliminates serial latency; it does not make a permanently hung native
  request independent. A future bounded native-observation path needs explicit
  cancellation and generation handling.
- A numeric offset is not a complete segment ledger. Mixed timelines around an
  ad insertion, overlapping segment URI identity, discontinuity numbering, media
  timestamps, and initialization data need validation with actual media.
- Legacy playlists without broadcast anchors still use timestamp alignment. Some
  unalignable paths still reset to native numbering; this is not a general repair
  for an already-running decoder.
- Recovery currently changes interception, not the decoder itself. Once Twitch
  has torn down playback with Error #3000, passing native playlists alone may not
  restart it. A bounded, player-aware repair would need separate validation.
- Exact codec/container/rendition matching deliberately rejects incompatible
  alternates. A lower-quality route needs a coordinated player quality change;
  substituting arbitrary 360p bytes into a 1080p session is not a safe shortcut.
- This suite checks playlist behavior, request identity/cancellation, channel
  ownership, stale routes, and configuration races. It does not decode the media.

## Validation and scope

All five newly reproduced defects failed before their respective changes and
passed afterward. The playlist suite passed 81 tests; the page blocker suite passed
78, and fail-open passed 13 (172 blocker checks total). The additional page test
ensures a worker-owned primary stays visible and audible beside an independent
display-ad video. VOD rewind passed 51;
runtime idempotence, Twitch rewind safety, and streaming compatibility (23 checks)
also passed. Syntax and whitespace checks passed.

The repository contains substantial unrelated, unfinished local work. The full
maintainability gate was not certified; an earlier gate attempt stalled in the
unrelated message-rate-limit suite. No unrelated failure was repaired for this
audit. No version bump, commit, push, proxy installation, or remote-script
installation was performed. `src/content.js` was not edited for these changes.

### Publication follow-up

The user subsequently authorized committing and pushing all local work. During
pre-publication validation, the message-rate-limit suite passed its assertions
but remained alive because its simulated worker retained maintenance timers.
The harness now unreferences those worker timers while keeping its deferred
assertion timer referenced. The suite exits successfully without changing
production behavior. Generated scripts were rebuilt, and the full maintainability
gate then passed, including all 215 registered test suites, exact rebuild checks,
syntax, security, and encoding checks. This supersedes the earlier full-gate
limitation above; the live-playback coverage and limitations are unchanged.

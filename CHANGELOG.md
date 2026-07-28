# Changelog

## 1.0.0 — 2026-07-28

First public-release hardening pass.

### Fixed

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

### Quality

- Added popup, streaming, Twitch fail-open, network-policy, and compatibility
  regressions to the maintainability suite.
- Corrected and expanded third-party licensing and attribution notes.

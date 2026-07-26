# Credits & Attribution

WebWarden is built on the work of the open-source ad-blocking and privacy
community. Like every serious content blocker (uBlock Origin, AdGuard, Brave),
it stands on shared, openly-licensed filter lists and filtering techniques. We
gratefully credit the upstream projects below.

## YouTube ad blocking

- **AdGuard** — <https://adguard.com> · <https://github.com/AdguardTeam/AdguardFilters>

  WebWarden's YouTube engine (`yt-adblock.js`) is a clean re-implementation
  based on AdGuard's publicly published YouTube filter rules (JSON player-response
  pruning, SSAP/segment handling, and the bounded player-request recovery modes).
  The ad/anti-adblock DNR rules in `rules-adshield.json` are likewise derived from
  AdGuard / AdShield's public rules.

  AdGuard filter lists are distributed under the **GNU General Public License v3**.

## Twitch ad blocking

- **TwitchAdSolutions** (pixeltris) — <https://github.com/pixeltris/TwitchAdSolutions>

  WebWarden's Twitch stream ad blocker (`twitch-adblock.js`) is a smaller, clean
  re-implementation whose clean-stream strategy is informed by the project's VAFT
  and TTV-AB scripts: player-type substitution to obtain an ad-free HLS playlist,
  GQL access-token proxying, and HLS ad-segment gapping as a fallback. It uses no
  remote proxy and none of the upstream React/player-reload machinery.

  TwitchAdSolutions is distributed under the permissive **MIT License**.

## Trackers & privacy

- **EasyList & EasyPrivacy** — <https://easylist.to>

  The tracker- and privacy-blocking rules bundled as `rules-easyprivacy.json`
  and `rules-trackers.json` are derived from the EasyList project's community
  blocklists.

  EasyList / EasyPrivacy are distributed under the **GNU GPL v2** and
  **Creative Commons Attribution-ShareAlike 3.0 (CC BY-SA 3.0)**.

## Notes

- These lists are compiled into Chrome's Declarative Net Request (DNR) rule
  format for use in this Manifest V3 extension; the underlying rules and
  techniques remain the work of their respective authors.
- WebWarden's own code (the Twitch local-DVR/rewind engine, anti-fingerprinting,
  download/phishing guards, onboarding, UI, and integration glue) is original to
  this project.
- If you believe a source is missing or mis-attributed here, please open an
  issue so it can be corrected.

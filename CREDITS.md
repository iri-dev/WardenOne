# Credits & Attribution

WardenOne is built on the work of the open-source ad-blocking and privacy
community. Like every serious content blocker (uBlock Origin, AdGuard, Brave),
it stands on shared, openly-licensed filter lists and filtering techniques. We
gratefully credit the upstream projects below.

## YouTube ad blocking

- **AdGuard Filters** — <https://github.com/AdguardTeam/AdguardFilters>

  WardenOne's YouTube engine (`yt-adblock.js`) is a clean re-implementation
  based on AdGuard's publicly published YouTube filter rules (JSON player-response
  pruning, SSAP/segment handling, and the bounded player-request recovery modes).
  The ad/anti-adblock DNR rules in `rules-adshield.json` are likewise derived from
  publicly available AdGuard and EasyList-compatible filter rules.

  AdGuard Filters are distributed under the **GNU General Public License v3**.

## Twitch ad blocking

- **TwitchAdSolutions** (pixeltris) — <https://github.com/pixeltris/TwitchAdSolutions>

  WardenOne's Twitch stream ad blocker (`twitch-adblock.js`) is a smaller, clean
  re-implementation whose clean-stream strategy is informed by the project's VAFT
  and TTV-AB scripts: player-type substitution to obtain an ad-free HLS playlist,
  GQL access-token proxying, and HLS ad-segment gapping as a fallback. It uses no
  remote proxy and none of the upstream React/player-reload machinery.

  TwitchAdSolutions is distributed under the permissive **MIT License**:
  copyright © 2020–present TwitchAdSolutions Contributors. The upstream project
  was archived on 5 March 2026; the attribution and license remain applicable.

## Trackers & privacy

- **EasyList & EasyPrivacy** — <https://github.com/easylist/easylist> ·
  <https://easylist.to/pages/licence.html>

  The tracker- and privacy-blocking rules bundled as `rules-easyprivacy.json`
  and `rules-trackers.json` are derived from the EasyList project's community
  blocklists.

  Unless an individual file says otherwise, the EasyList repository is dual
  licensed under the **GNU GPL v3 or later** or the **Creative Commons
  Attribution-ShareAlike 3.0 or later (CC BY-SA 3.0+)**. WardenOne attributes
  the EasyList authors as the source of the compiled list material.

## Search-result copycats

- **uBlock-Origin-dev-filter** (quenhus) —
  <https://github.com/quenhus/uBlock-Origin-dev-filter> ·
  <https://github.com/quenhus/uBlock-Origin-dev-filter/blob/main/LICENSE>

  The domain list behind "Mark answer-scraper results" is fetched at runtime from
  this project's bare-domains output. It catalogues sites that republish Stack
  Exchange and GitHub content to outrank the original.

  WardenOne uses the domain list only. The project's uBlock-syntax outputs also
  carry cosmetic rules written against Google's DOM; those are not used, because
  the marker matches on result links rather than on Google's markup.

  Nothing from this list is blocked. Matching results are dimmed and labelled in
  place, and always keep a one-click way to view them.

## Notes

- These lists are compiled into Chrome's Declarative Net Request (DNR) rule
  format for use in this Manifest V3 extension; the underlying rules and
  techniques remain the work of their respective authors.
- WardenOne's compiled or adapted copies are distributed under this repository's
  GPLv3 license. Upstream copyright and attribution rights are retained.
- WardenOne's own code (the Twitch local-DVR/rewind engine, anti-fingerprinting,
  download/phishing guards, onboarding, UI, and integration glue) is original to
  this project.
- If you believe a source is missing or mis-attributed here, please open an
  issue so it can be corrected.

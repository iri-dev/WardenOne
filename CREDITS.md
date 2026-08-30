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
  and TTV-AB scripts: player-type substitution to obtain an ad-free HLS playlist
  and GQL access-token proxying. It uses no remote proxy and none of the upstream
  React/player-reload machinery.

  TwitchAdSolutions is distributed under the permissive **MIT License**:
  copyright © 2020–present TwitchAdSolutions Contributors. The upstream project
  was archived on 5 March 2026; the attribution and license remain applicable.

- **TwitchAdBlock** (scamorza), v2.0.5 — <https://github.com/scamorza/TwitchAdBlock/tree/v2.0.5>

  WardenOne adapts its current `mobile_feed/android` identity, ordered alternate
  session search, compatible-rendition probing, `PROGRAM-DATE-TIME`-anchored HLS
  sequence renumbering, Twitch AdManager decline, and mixed-batch-safe PiP token
  denial. WardenOne keeps its own worker lifecycle, fail-open circuit breaker,
  request preservation, and no-proxy policy; it does not use the upstream empty
  segment, React, reload, or recovery-loop paths.

  TwitchAdBlock is distributed under the **MIT License**:
  copyright © 2020–present TwitchAdSolutions Contributors; copyright ©
  2026–present TwitchAdBlock Contributors.

  Permission is hereby granted, free of charge, to any person obtaining a copy of
  this software and associated documentation files (the "Software"), to deal in
  the Software without restriction, including without limitation the rights to
  use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
  the Software, and to permit persons to whom the Software is furnished to do so,
  subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS
  FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
  COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER
  IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN
  CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

- **TTV-AB** (GosuDRM) — <https://github.com/GosuDRM/TTV-AB>

  WardenOne's two-second, warning-time verified-playlist handoff is informed by
  TTV-AB's fresh-backup cache and revalidation work. WardenOne independently
  implements the idea inside its existing fail-open worker and does not adopt
  TTV-AB's synthetic hold-media, player-rebuild, telemetry-spoofing, or recovery
  machinery.

  TTV-AB uses an **MIT-based license with an explicit repository-attribution
  requirement**. Copyright © 2025 GosuDRM. Original repository:
  <https://github.com/GosuDRM/TTV-AB>.

- **uBlock Origin uAssets** — <https://github.com/uBlockOrigin/uAssets>

  WardenOne adapts uAssets' narrowly content-scoped Twitch rule for the
  "allow ads / get Turbo" player overlay so that house promotion is hidden
  immediately, without unconditionally hiding generic player wrappers. The
  upstream rule was introduced in
  <https://github.com/uBlockOrigin/uAssets/commit/4464b7bdb7ab7a0b6272669e79c620a064abcd9f>.

  uBlock Origin uAssets is distributed under the **GNU General Public License
  v3**.

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

## Upstream source inventory

<!-- BEGIN GENERATED SOURCE INVENTORY -->

_Generated by `tools/build-source-inventory.js` from the source constants in `background.js`._
_Do not edit this block by hand; the release gate rebuilds and checks it._
_Machine-readable form, including per-source URLs: `docs/source-inventory.json`._

Every upstream list the default runtime can reach. **Licence column blank means the terms have
not yet been confirmed by a release owner** — that is a documentation gap being tracked, not a
claim that a licence is absent or that any use is or is not permitted.

| Project | Feeds | Files | Licence |
| --- | --- | --- | --- |
| [AdAway/adaway.github.io](https://github.com/AdAway/adaway.github.io) | Network-level ad filtering | 1 | _not yet verified_ |
| [blocklistproject/Lists](https://github.com/blocklistproject/Lists) | Supplemental domain lists; IP-logger and grabber domains; Tracking and telemetry domains | 3 | _not yet verified_ |
| [DandelionSprout/adfilt](https://github.com/DandelionSprout/adfilt) | Malware and phishing domains | 1 | _not yet verified_ |
| [Discord-AntiScam/scam-links](https://github.com/Discord-AntiScam/scam-links) | Web3 wallet drainers and social scams | 1 | _not yet verified_ |
| [durablenapkin/scamblocklist](https://github.com/durablenapkin/scamblocklist) | IP-logger and grabber domains | 1 | _not yet verified_ |
| [easylist-downloads.adblockplus.org/easylist-downloads.adblockplus.org](https://easylist-downloads.adblockplus.org/) | Network-level ad filtering; Cosmetic (element-hiding) filtering | 4 | _not yet verified_ |
| [easylist.to/easylist.to](https://easylist.to/) | Network-level ad filtering; Cosmetic (element-hiding) filtering | 2 | _not yet verified_ |
| [filters.adtidy.org/filters.adtidy.org](https://filters.adtidy.org/) | Cosmetic (element-hiding) filtering; Network-level ad filtering | 3 | _not yet verified_ |
| [flinteger/dnss-blocklists](https://github.com/flinteger/dnss-blocklists) | Malware and phishing domains | 1 | _not yet verified_ |
| [hagezi/dns-blocklists](https://github.com/hagezi/dns-blocklists) | Network-level ad filtering; Tracking and telemetry domains; Malware and phishing domains | 3 | _not yet verified_ |
| [malware-filter/malware-filter](https://gitlab.com/malware-filter) | Malware and phishing domains | 3 | _not yet verified_ |
| [manic-code/Emerging-Malicious-Domain-Blocklist](https://github.com/manic-code/Emerging-Malicious-Domain-Blocklist) | Malware and phishing domains | 1 | _not yet verified_ |
| [MetaMask/eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) | Web3 wallet drainers and social scams | 1 | _not yet verified_ |
| [mitchellkrogza/Phishing.Database](https://github.com/mitchellkrogza/Phishing.Database) | Malware and phishing domains | 1 | _not yet verified_ |
| [pgl.yoyo.org/pgl.yoyo.org](https://pgl.yoyo.org/) | Tracking and telemetry domains; Network-level ad filtering | 1 | _not yet verified_ |
| [phishdestroy/destroylist](https://github.com/phishdestroy/destroylist) | Web3 wallet drainers and social scams | 1 | _not yet verified_ |
| [phishing.army/phishing.army](https://phishing.army/) | Malware and phishing domains | 1 | _not yet verified_ |
| [quenhus/uBlock-Origin-dev-filter](https://github.com/quenhus/uBlock-Origin-dev-filter) | Supplemental domain lists | 1 | _not yet verified_ |
| [StevenBlack/hosts](https://github.com/StevenBlack/hosts) | Network-level ad filtering | 1 | _not yet verified_ |
| [TMAFE/anti-grabify](https://github.com/TMAFE/anti-grabify) | IP-logger and grabber domains; Supplemental domain lists | 1 | _not yet verified_ |
| [ublockorigin/uAssets](https://github.com/ublockorigin/uAssets) | Malware and phishing domains; Network-level ad filtering; Cosmetic (element-hiding) filtering | 5 | _not yet verified_ |

Rulesets compiled from the above and **redistributed inside the package**:

| File | Built by | From |
| --- | --- | --- |
| `rules-adshield.json` | `tools/build-adshield-dnr.js` | `ADSHIELD_NET_LISTS` |
| `rules-easyprivacy.json` | `tools/build-easyprivacy-dnr.js` | `ADSHIELD_NET_LISTS` |
| `cosmetic-rules.json` | `tools/build-cosmetics.js` | `ADSHIELD_COSMETIC_LISTS` |

<!-- END GENERATED SOURCE INVENTORY -->

## Installed-extension incident data

- **The Great Suspender security incident record** —
  <https://github.com/greatsuspender/thegreatsuspender/issues/1263>

  WardenOne's bundled `extension-reputation.json` contains a manually curated factual
  record for the exact legacy extension ID involved in this documented compromise.
  Its `all_versions` scope records that identity-wide history and the obsolete store
  identity; it does not claim that every released version contained the compromised
  code. No upstream code or list is copied. The record is deliberately labelled as a
  historical incident rather than a current malware verdict, a blanket claim that
  every unknown extension is clean, or an assumption that a display name proves identity.

- **Recognized official extension identities** —
  [uBlock Origin](https://github.com/gorhill/uBlock),
  [Bitwarden](https://bitwarden.com/help/getting-started-browserext/),
  [1Password](https://support.1password.com/getting-started-browser/),
  [MetaMask](https://github.com/MetaMask/metamask-extension),
  [React Developer Tools](https://github.com/facebook/react/tree/main/packages/react-devtools-extensions),
  [Dark Reader](https://darkreader.org/blog/attention/),
  [Privacy Badger](https://privacybadger.org/),
  [Vimium](https://vimium.github.io/),
  [Grammarly](https://support.grammarly.com/hc/en-us/articles/8343923417485-How-to-deploy-Grammarly-for-Chrome),
  [LastPass](https://community.lastpass.com/discussion/1954/anybody-ever-see-this-in-their-history-on-chrome-i-had-this-showing-today-when-my-screen-filled-with-sirens-and-warnings-to-call-a-number-it-shows-lass-pass-on-this-see-chrome-extension),
  [Dashlane](https://support.dashlane.com/hc/en-us/articles/16995550348050-Extension-deployment-using-macOS-and-Jamf),
  [Keeper](https://docs.keeper.io/enterprise-guide/deploying-keeper-to-end-users/keeper-fill/linux/json-policy-deployment-chrome),
  [Zotero Connector](https://chromewebstore.google.com/detail/zotero-connector/ekhagklcjbdpajgpjgmbionohlpdbjgc),
  [DuckDuckGo](https://duckduckgo.com/duckduckgo-help-pages/desktop/chrome),
  [Ghostery](https://www.ghostery.com/enterprise-privacy-solutions/documentation/chrome),
  [NordVPN](https://chromewebstore.google.com/detail/vpn-for-chrome-nordvpn-pr/fjoaledfpmneenckfbpdfhkmimnjocfa), and
  [Google Translate](https://chromewebstore.google.com/detail/google-translate/aapbdbdomjkkjkaonfhkkikfgjllcleb)

  The same local file records these projects' exact Chrome extension IDs as
  `recognized_identity`. That label supplies identity context only: it is deliberately
  not `known_safe`, does not override capability risk, and does not silence a later
  version or permission change.

- **Version-scoped historical extension incidents** —
  [MEGA 3.39.4](https://mega.nz/blog_47),
  [Web Developer 0.4.9](https://chrispederick.com/blog/2017/08/03/web-developer-for-chrome-compromised/), and
  [Copyfish 2.8.5](https://ui.vision/blog/chrome-extension-adware/)

  Each record is bound to the exact Chrome extension ID and the exact affected
  version named by the project or author. It does not label a repaired or current
  version malicious. The MEGA identity is independently confirmed by its
  [official Chrome listing](https://chromewebstore.google.com/detail/mega/bigefpfhnfcobdlfbedofhhaibnlghod),
  Web Developer by its [official repository](https://github.com/chrispederick/web-developer),
  and Copyfish by its [official repository](https://github.com/A9T9/Copyfish).

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

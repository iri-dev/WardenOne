# Credits & Attribution

WardenOne is built on the work of the ad-blocking and privacy community. It
uses upstream filter lists and filtering techniques credited below. The
respective maintainers retain ownership of their data. Published licenses and
separate written permissions provide the bases recorded below. Specific scope
exceptions, rather than generic verification labels, are documented in the
[source review](https://github.com/iri-dev/WardenOne/blob/main/docs/source-rights-review.md).
The extension includes offline attribution and license notices in
`THIRD_PARTY_NOTICES.html`, available from Settings → About WardenOne.

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

  The September 19 stability audit also consulted commit
  [`a145302`](https://github.com/scamorza/TwitchAdBlock/tree/a1453021869b43870e30fac4c384d09b60bef435).
  Its broadcast `EXT-X-TWITCH-LIVE-SEQUENCE` alignment informed WardenOne's
  preference for broadcast positions over timestamps from different sessions,
  including ending an inferred live sequence at a discontinuity. WardenOne
  implements this within its existing playlist adapter; it does not copy the
  upstream merged segment ledger or synthetic clock.

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

  Spotify's dedicated ad-media redirects adapt the `open.spotify.com` media
  rules in <https://github.com/uBlockOrigin/uAssets/blob/master/filters/filters-2020.txt>.
  `spotify-silent-1s.mp4` is an unmodified copy of uBlock Origin's
  [`noop-1s.mp4`](https://github.com/gorhill/uBlock/blob/master/src/web_accessible_resources/noop-1s.mp4),
  SHA-256 `a27edba0e34b2648a90a800ae94fdef3e39016d1b9bd6e54a31ede1f1cddfed0`.
  `tools/build-spotify-media.js --build` regenerates the tracked asset from the
  pinned upstream bytes, and the same bytes are inlined as a `data:` URL in
  `spotify-adblock.js` for the player-side swap below. WardenOne does not use
  the old `noop-0.1s.mp3` asset. uBlock Origin's list also carries media
  exceptions for podcast hosts that its other lists had blocked on the web
  player; WardenOne's single media allow for open.spotify.com is the same
  correction, applied by request type instead of host by host.

  uBlock Origin and uAssets are distributed under the **GNU General Public
  License v3**.

- **AdGuard Base filter** (AdGuard Team) —
  <https://github.com/AdguardTeam/AdguardFilters>

  The technique of handing Spotify's player a silent clip from inside the
  player -- recognising the loader's completion callback by the method it
  names, and replacing the media URL of any content object whose URI is
  `spotify:ad:` before that callback runs -- is the `open.spotify.com#%#`
  script rule in `BaseFilter/sections/specific.txt`. The same section
  established that ad audio must be matched by the `media` request type and
  never by XMLHttpRequest, because songs travel over fetch from the same CDN
  paths. WardenOne's `spotify-adblock.js` reimplements the idea in its own
  code (caching the recognition per callback, reading source through a
  captured `Function.prototype.toString`, and extending the swap to Spotify's
  manifest-delivered ads); no source was copied.

  AdGuard filters are distributed under the **GNU General Public License v3**.

- **Spotify Web Ads Remover** (tomer8007) —
  <https://github.com/tomer8007/spotify-web-ads-remover>

  The technique of observing Spotify Web Player state-machine responses to
  identify ad tracks was established by this extension (its
  `injected/ads_removal.js`). WardenOne uses that observation only to identify
  media to mute and seek; it does not rewrite responses, issue extra
  playback-state requests or change the account's server-side state. The
  implementation in `spotify-adblock.js` is WardenOne's own code; no source was
  copied.

  Spotify Web Ads Remover is distributed under the **GNU General Public
  License v3**.

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

## Unicode security data

- **Unicode Security Mechanisms, UTS #39** —
  <https://www.unicode.org/reports/tr39/> ·
  <https://www.unicode.org/Public/security/latest/confusables.txt>

  `domain-utils.js` contains a generated, compact subset of Unicode 18.0.0's
  confusable-character data for detecting internationalised domain labels that
  imitate WardenOne's protected ASCII brand names. The source version, date and
  SHA-256 are embedded beside the data, and `tools/build-idn-confusables.js`
  regenerates and validates it.

  The data is distributed under the **Unicode License V3**:

  Copyright © 1991–2026 Unicode, Inc.

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of data files and any associated documentation (the "Data Files") or software
  and any associated documentation (the "Software") to deal in the Data Files
  or Software without restriction, including without limitation the rights to
  use, copy, modify, merge, publish, distribute, and/or sell copies of the Data
  Files or Software, and to permit persons to whom the Data Files or Software
  are furnished to do so, provided that either (a) this copyright and permission
  notice appear with all copies of the Data Files or Software, or (b) this
  copyright and permission notice appear in associated Documentation.

  THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
  KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
  MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF THIRD
  PARTY RIGHTS. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN
  THIS NOTICE BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL
  DAMAGES, OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
  WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING
  OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA FILES OR
  SOFTWARE. Except as contained in this notice, the name of a copyright holder
  shall not be used in advertising or otherwise to promote the sale, use or
  other dealings in these Data Files or Software without prior written
  authorization of the copyright holder.

## Site identity

- **Public Suffix List** (Mozilla Foundation) — <https://publicsuffix.org/> ·
  <https://github.com/publicsuffix/list>

  The private section of the list — the shared-hosting and platform suffixes
  (github.io, webflow.io, `*.compute.amazonaws.com` and some 3,300 more) — is
  generated into `psl-private.js` by `tools/build-psl.js` and read by the
  service worker to decide which hosts belong to one owner. Two tenants of one
  platform are never one site for the token-exfiltration blocker, the
  forced-navigation warnings, the logger's party column or the Forget-Me wipe.
  The file records the list version it was built from, and the generator prints
  every added or removed suffix for review before an update ships.

  The Public Suffix List is distributed under the **Mozilla Public License 2.0**.

## Inputs to remotely fetched phishing lists

WardenOne fetches the Phishing Army and flinteger domain feeds at runtime. The
providers below contribute to those feeds; WardenOne does not contact them
directly for these lists or package their source data in the extension.

- **URLAbuse / NetSSR** — <https://urlabuse.com/> ·
  [CC BY 4.0 terms](https://urlabuse.com/public/html/terms.html). Phishing Army
  takes recent phishing reports, extracts domains, and includes them in its
  normalized feed; WardenOne imports that feed for local blocking. Credit does
  not imply URLAbuse endorsement.
- **Phishunt** — <https://phishunt.io/> ·
  [CC0 feed terms](https://phishunt.io/tos/). Phishing Army uses its public feed.
- **StalkPhish** — <https://stalkphish.com/>. Thomas Damonneville confirmed by
  email to Iris that WardenOne may use its open data through Phishing Army,
  provided the data is not resold. WardenOne fetches the Phishing Army feed at
  runtime and does not resell StalkPhish data.
- **UT1 blacklist** (Université Toulouse Capitole) —
  <https://dsi.ut-capitole.fr/blacklists/> ·
  [CC BY-SA 4.0 terms](https://dsi.ut-capitole.fr/blacklists/download/LICENSE.pdf).
  flinteger lists UT1 malware and phishing domains as inputs.
- **Mitchell Krog** —
  [Badd-Boyz-Hosts](https://github.com/mitchellkrogza/Badd-Boyz-Hosts) and
  [The Big List of Hacked Malware Web Sites](https://github.com/mitchellkrogza/The-Big-List-of-Hacked-Malware-Web-Sites),
  each with an MIT notice in its repository. flinteger lists both as inputs.
- **Hosh** — [adblock-nocoin-list](https://github.com/hoshsadiq/adblock-nocoin-list) ·
  [MIT notice](https://github.com/hoshsadiq/adblock-nocoin-list/blob/master/LICENSE).
  flinteger lists it as an input.

## Upstream source inventory

<!-- BEGIN GENERATED SOURCE INVENTORY -->

WardenOne uses independently maintained protection lists. Their maintainers retain ownership and credit.
Published licenses and written permissions are separate permission grants; no personal reply is needed when the applicable license covers the use.
The inventory records exact addresses, local processing, evidence and any specific scope exception.

[38 runtime feeds](https://github.com/iri-dev/WardenOne/blob/main/docs/source-inventory.json) · [Packaged notices](https://github.com/iri-dev/WardenOne/blob/main/THIRD_PARTY_NOTICES.html) · [Review and exceptions](https://github.com/iri-dev/WardenOne/blob/main/docs/source-rights-review.md)

| Source | Runtime feeds | License or permission |
| --- | --- | --- |
| [EasyList China](https://github.com/easylist/easylistchina) | 1 | GPL-3.0-or-later OR CC-BY-SA-3.0-or-later |
| [EasyList Dutch](https://github.com/easylist/easylistdutch) | 1 | GPL-3.0-or-later OR CC-BY-SA-3.0-or-later |
| [Fanboy’s Annoyance and Social Blocking lists](https://easylist.to/) | 2 | CC-BY-3.0 |
| [EasyList and EasyPrivacy](https://easylist.to/) | 2 | GPL-3.0-or-later OR CC-BY-SA-3.0-or-later |
| [malware-filter Phishing hosts](https://gitlab.com/malware-filter/phishing-filter) | 1 | CC-BY-SA-4.0; Specific upstream/use-scope exception — see source review |
| [malware-filter URLhaus hosts](https://gitlab.com/malware-filter/urlhaus-filter) | 1 | MIT OR CC0-1.0 |
| [malware-filter VN Badsite hosts](https://gitlab.com/malware-filter/vn-badsite-filter) | 1 | MIT OR CC0-1.0 |
| [Peter Lowe ad and tracking servers](https://pgl.yoyo.org/adservers/) | 1 | Written permission (2026-10) |
| [Phishing Army](https://phishing.army/) | 1 | Written permission (2026-10); Specific upstream/use-scope exception — see source review |
| [AdAway hosts](https://github.com/AdAway/adaway.github.io) | 1 | CC-BY-3.0 |
| [AdGuard Base, Tracking Protection and Mobile Ads filters](https://github.com/AdguardTeam/AdguardFilters) | 3 | GPL-3.0 |
| [Block List Project scam and tracking lists](https://github.com/blocklistproject/Lists) | 2 | Unlicense |
| [Dandelion Sprout Anti-Malware domains](https://github.com/DandelionSprout/adfilt) | 1 | LicenseRef-Dandelicence-1.4 |
| [Discord-AntiScam / DSP Project scam-links](https://github.com/Discord-AntiScam/scam-links) | 1 | Written permission (2026-10-15) |
| [Scam Blocklist](https://github.com/durablenapkin/scamblocklist) | 1 | MIT |
| [dnss-blocklists malicious domains](https://github.com/flinteger/dnss-blocklists) | 1 | Written permission (2026-10-16); Specific upstream/use-scope exception — see source review |
| [HaGeZi Light, Pro and Threat Intelligence Feed Medium](https://github.com/hagezi/dns-blocklists) | 3 | GPL-3.0 |
| [Emerging Malicious Domain Blocklist](https://github.com/manic-code/Emerging-Malicious-Domain-Blocklist) | 1 | MIT |
| [MetaMask eth-phishing-detect](https://github.com/MetaMask/eth-phishing-detect) | 1 | LicenseRef-DBAD-1.2 |
| [Phishing.Database](https://github.com/mitchellkrogza/Phishing.Database) | 1 | MIT |
| [OpenPhish Community Feed](https://openphish.com/) | 1 | LicenseRef-OpenPhish-Terms; Specific upstream/use-scope exception — see source review |
| [PhishDestroy Destroylist](https://github.com/phishdestroy/destroylist) | 1 | MIT |
| [uBlock-Origin-dev-filter domains](https://github.com/quenhus/uBlock-Origin-dev-filter) | 1 | Unlicense |
| [StevenBlack porn-only hosts](https://github.com/StevenBlack/hosts) | 1 | MIT AND CC-BY-4.0 |
| [StevenBlack unified hosts](https://github.com/StevenBlack/hosts) | 1 | MIT AND upstream terms |
| [Anti-Grabify](https://github.com/TMAFE/anti-grabify) | 1 | MPL-2.0 |
| [uBlock Origin uAssets](https://github.com/uBlockOrigin/uAssets) | 5 | GPL-3.0 |

Build-only inputs (not daily runtime downloads):

- [AdGuard Base, Tracking Protection and Mobile Ads filters](https://filters.adtidy.org/extension/ublock/filters/2.txt) → `cosmetic-rules.json` (GPL-3.0).
- [AdGuard Base, Tracking Protection and Mobile Ads filters](https://filters.adtidy.org/extension/ublock/filters/3.txt) → `cosmetic-rules.json` (GPL-3.0).
- [AdGuard Base, Tracking Protection and Mobile Ads filters](https://filters.adtidy.org/extension/ublock/filters/11.txt) → `cosmetic-rules.json` (GPL-3.0).
- [Public Suffix List private section](https://publicsuffix.org/list/public_suffix_list.dat) → `psl-private.js` (MPL-2.0).
- [Unicode confusables](https://www.unicode.org/Public/security/latest/confusables.txt) → `domain-utils.js` (Unicode-3.0).
- [uBlock Origin silent media](https://raw.githubusercontent.com/gorhill/uBlock/master/src/web_accessible_resources/noop-1s.mp4) → `spotify-silent-1s.mp4` (GPL-3.0).

Bundled and derived material:

| File | Provenance | Distribution terms |
| --- | --- | --- |
| `rules-adshield.json` | The EasyList authors; selected network rules plus WardenOne compatibility edits | CC-BY-SA-3.0 |
| `rules-easyprivacy.json` | The EasyList authors; EasyPrivacy plus WardenOne tracker rules | CC-BY-SA-3.0 |
| `cosmetic-rules.json` | EasyList, EasyPrivacy, uAssets, AdGuard and Fanboy Social | GPL-3.0; Fanboy CC-BY-3.0 attribution retained |
| `psl-private.js` | Public Suffix List private section | MPL-2.0 |
| `domain-utils.js` | WardenOne code with Unicode UTS #39 confusable subset | GPL-3.0-or-later with Unicode-3.0 data notice |
| `spotify-silent-1s.mp4` | uBlock Origin noop-1s.mp4 | GPL-3.0 |
| `rules.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `rules-trackers.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `grabber-extra.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `malware-hashes.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `cryptominer-domains.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `search-junk-domains.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `supplemental-manifest.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `extension-reputation.json` | WardenOne-maintained seed/curation; source is the shipped JSON | GPL-3.0-or-later (WardenOne curation; upstream notices retained) |
| `rules-grabber-compat.json` | WardenOne rules.json domain subset | GPL-3.0-or-later |
| `rules-grabber-malware-navigation.json` | WardenOne rules.json domain subset | GPL-3.0-or-later |
| `rules-grabber-navigation.json` | WardenOne rules.json domain subset | GPL-3.0-or-later |
| `rules-grabber-resources.json` | WardenOne rules.json domain subset | GPL-3.0-or-later |
| `rules-spotify-media.json` | uAssets Spotify media rules with WardenOne request-type compatibility changes | GPL-3.0 |

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

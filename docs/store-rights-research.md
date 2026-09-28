# Store input rights research — 2026-09-28

This is an evidence docket for CWS-06, covering all **37 fetched feeds** and **4 redistributed
files** in [`source-inventory.json`](source-inventory.json). The numbers below refer to that
inventory's order on this date. Links go to the exact feed and to its publisher's terms or
repository. A repository licence does not automatically establish rights to every upstream
record aggregated into a feed. Nor does a public download URL itself grant redistribution
rights. Terms can change, so the release owner must check them again for the candidate commit.

**Submission remains blocked.** This research makes no `licenceVerified` or `rightsReview`
assertion and does not remove an input. The release owner must decide whether each use is
permitted, document the exact licence and notices, then record the evidence and date in the
inventory as described in [`store-submission.md`](store-submission.md). No Store upload or
release is authorised by this document. EyeShield, Memory Shield and Tab Limit remain in the
proposed Store profile; Twitch Rewind remains in the full GitHub build.

## Fetched feeds

Every row is a separate runtime input. “Terms seen” reports the publisher's wording; it is
not a compatibility finding or a release approval.

| # | Exact input | Terms seen and decision still needed |
| ---: | --- | --- |
| 1 | [AdAway hosts](https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt) | The [feed header](https://github.com/AdAway/adaway.github.io/blob/master/hosts.txt) names CC BY 3.0; the site repository describes its website content as GPL. Confirm that the feed-specific CC notice controls these bytes and how attribution is delivered. |
| 2 | [Block List Project scam](https://raw.githubusercontent.com/blocklistproject/Lists/master/scam.txt) | The feed header says MIT, while the [repository README](https://github.com/blocklistproject/Lists/blob/main/README.md#license) and [LICENSE](https://github.com/blocklistproject/Lists/blob/main/LICENSE) say Unlicense. Resolve the discrepancy with the publisher before choosing terms. |
| 3 | [Block List Project tracking](https://raw.githubusercontent.com/blocklistproject/Lists/master/tracking.txt) | Same MIT header versus [Unlicense repository](https://github.com/blocklistproject/Lists/blob/main/LICENSE) conflict as #2. Resolve separately for this feed. |
| 4 | [DandelionSprout Anti-Malware domains](https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Alternate%20versions%20Anti-Malware%20List/AntiMalwareDomains.txt) | The repository uses the custom [Dandelicence](https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md), which also recognises third-party material and file-specific terms. Confirm the exact list's status and obligations. |
| 5 | [Discord-AntiScam scam links](https://raw.githubusercontent.com/Discord-AntiScam/scam-links/main/list.txt) | The [README](https://github.com/Discord-AntiScam/scam-links#accessing-the-database) invites programmatic fetching but the repository has no licence file or explicit redistribution grant. Seek written terms or permission. |
| 6 | [durablenapkin scamblocklist](https://raw.githubusercontent.com/durablenapkin/scamblocklist/master/hosts.txt) | The feed header and [repository licence](https://github.com/durablenapkin/scamblocklist/blob/master/LICENSE) say MIT. Confirm notice handling for this runtime use. |
| 7 | [EasyList China](https://easylist-downloads.adblockplus.org/easylistchina.txt) | Its header points to [easylist/easylistchina](https://github.com/easylist/easylistchina), which has no licence file. EasyList's [licence page](https://easylist.to/pages/licence.html) explicitly warns that externally hosted subscriptions may have other conditions. Seek this list's terms; do not apply EasyList's licence by association. |
| 8 | [EasyList Dutch](https://easylist-downloads.adblockplus.org/easylistdutch.txt) | EasyList's [About page](https://easylist.to/pages/about.html#copyright) identifies Dutch as dual licensed under GPL and CC BY-SA. Confirm the applicable version, attribution and any combined-list components. |
| 9 | [Fanboy Annoyance](https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt) | The live feed header declares CC BY 3.0. Confirm that attribution is sufficient for this exact subscription and record its terms revision. |
| 10 | [Fanboy Social](https://easylist-downloads.adblockplus.org/fanboy-social.txt) | The live feed header declares CC BY 3.0. Confirm attribution for runtime fetch and for the portion compiled into `cosmetic-rules.json`. |
| 11 | [EasyList](https://easylist.to/easylist/easylist.txt) | The publisher's [licence page](https://easylist.to/pages/licence.html) offers GPLv3-or-later or CC BY-SA 3.0-or-later for the EasyList repository. Select a compatible path, including for redistributed `rules-adshield.json` and `cosmetic-rules.json`. |
| 12 | [EasyPrivacy](https://easylist.to/easylist/easyprivacy.txt) | Same [dual-licence statement](https://easylist.to/pages/licence.html) as #11. Select a path and address both `rules-easyprivacy.json` and `cosmetic-rules.json`. |
| 13 | [AdGuard Mobile Ads](https://filters.adtidy.org/extension/ublock/filters/11.txt) | The feed header points to [AdGuardFilters GPLv3](https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE). Review runtime use and its compiled cosmetic rules. |
| 14 | [AdGuard Base + EasyList](https://filters.adtidy.org/extension/ublock/filters/2.txt) | The header points to [AdGuardFilters GPLv3](https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE) and explicitly names EasyList in the combined filter. Check the EasyList component's [terms](https://easylist.to/pages/licence.html) too. |
| 15 | [AdGuard Tracking Protection](https://filters.adtidy.org/extension/ublock/filters/3.txt) | The feed header points to [AdGuardFilters GPLv3](https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE). Review runtime use and its compiled cosmetic rules. |
| 16 | [flinteger malicious domains](https://raw.githubusercontent.com/flinteger/dnss-blocklists/release/blocklists/malicious.domains.txt) | The [repository](https://github.com/flinteger/dnss-blocklists) has no licence file; its README says it aggregates other sources. Obtain permission and the source chain before approving. |
| 17 | [HaGeZi Multi LIGHT](https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/light.txt) | Header points to [GPLv3](https://github.com/hagezi/dns-blocklists/blob/main/LICENSE). Review feed terms and the [project's source/credit disclosures](https://github.com/hagezi/dns-blocklists) for aggregated records. |
| 18 | [HaGeZi Multi PRO](https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/pro.txt) | Same [GPLv3 repository](https://github.com/hagezi/dns-blocklists/blob/main/LICENSE); evaluate this larger feed and its source chain separately. |
| 19 | [HaGeZi TIF medium](https://raw.githubusercontent.com/hagezi/dns-blocklists/main/adblock/tif.medium.txt) | Same [GPLv3 repository](https://github.com/hagezi/dns-blocklists/blob/main/LICENSE); evaluate the threat-intelligence source chain separately. |
| 20 | [malware-filter phishing hosts](https://malware-filter.gitlab.io/malware-filter/phishing-filter-hosts.txt) | The [publisher's licence section](https://gitlab.com/malware-filter/phishing-filter/-/blob/main/README.md#license) says **filters are CC BY-SA 4.0**, while its code is CC0/MIT. It names OpenPhish as a source; [OpenPhish's terms](https://openphish.com/terms.html) restrict third-party distribution and product use without written permission. Do not treat the code licence as the feed licence. |
| 21 | [malware-filter URLhaus hosts](https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-hosts.txt) | The [publisher](https://gitlab.com/malware-filter/urlhaus-filter/-/blob/main/README.md#license) states CC0/MIT for its output and CC0 for URLhaus. Verify that statement and notices for the exact output. |
| 22 | [malware-filter VN badsite hosts](https://malware-filter.gitlab.io/vn-badsite-filter/vn-badsite-filter-hosts.txt) | The [publisher](https://gitlab.com/malware-filter/vn-badsite-filter/-/blob/main/README.md#license) states CC0/MIT and CC0 for its upstream. Its README says updates stopped in May 2025; check both rights and whether a stale feed belongs in a future candidate. Preserve it meanwhile. |
| 23 | [manic-code malicious hosts](https://raw.githubusercontent.com/manic-code/Emerging-Malicious-Domain-Blocklist/main/hosts.txt) | Header and [LICENSE](https://github.com/manic-code/Emerging-Malicious-Domain-Blocklist/blob/main/LICENSE) say MIT. Header also says maintenance was ending; check current utility separately from rights. |
| 24 | [MetaMask phishing config](https://raw.githubusercontent.com/MetaMask/eth-phishing-detect/main/src/config.json) | Repository [LICENSE](https://github.com/MetaMask/eth-phishing-detect/blob/main/LICENSE) is the custom DBAD 1.2 text, with attribution and subjective conditions. The owner must assess compatibility for this data and obtain clarification if needed. |
| 25 | [Phishing.Database active domains](https://raw.githubusercontent.com/mitchellkrogza/Phishing.Database/master/phishing-domains-ACTIVE.txt) | Repository has moved to [Phishing-Database](https://github.com/Phishing-Database/Phishing.Database); its [LICENSE](https://github.com/Phishing-Database/Phishing.Database/blob/master/LICENSE) is MIT. Confirm the redirected feed belongs to the same licensed project and assess its data sources. |
| 26 | [Peter Lowe adservers](https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext) | The [publisher's home page](https://pgl.yoyo.org/) applies its [McRae licence](https://pgl.yoyo.org/license/) to everything; that text forbids use that could make money. Written permission or a clear owner decision is needed for a Store package. |
| 27 | [PhishDestroy active domains](https://raw.githubusercontent.com/phishdestroy/destroylist/main/rootlist/formats/primary_active/domains.txt) | [MIT licence](https://github.com/phishdestroy/destroylist/blob/main/LICENSE) and [README](https://github.com/phishdestroy/destroylist#-license) found. The project draws on community feeds; check upstream provenance and notices for this output. |
| 28 | [Phishing Army extended](https://phishing.army/download/phishing_army_blocklist_extended.txt) | [Publisher page](https://phishing.army/) and feed header state **CC BY-NC 4.0**. The publisher also names OpenPhish among its inputs. Resolve the noncommercial condition and upstream rights before approval. |
| 29 | [quenhus dev-copycat domains](https://raw.githubusercontent.com/quenhus/uBlock-Origin-dev-filter/main/dist/other_format/domains/all.txt) | Feed points to [Unlicense](https://github.com/quenhus/uBlock-Origin-dev-filter/blob/main/LICENSE). Confirm this generated output is covered. |
| 30 | [StevenBlack porn-only hosts](https://raw.githubusercontent.com/StevenBlack/hosts/master/alternates/porn-only/hosts) | Repository [licence](https://github.com/StevenBlack/hosts/blob/master/license.txt) is MIT, but the header identifies a merged feed; [README source table](https://github.com/StevenBlack/hosts/blob/master/readme.md) records separate upstream licences. Review the extension sources, especially `hostsVN Adult VN`, before approval. |
| 31 | [StevenBlack unified hosts](https://raw.githubusercontent.com/StevenBlack/hosts/master/hosts) | Same MIT repository and [multi-source README](https://github.com/StevenBlack/hosts/blob/master/readme.md) as #30. Review all included upstream terms and attribution, including AdAway's CC BY 3.0. |
| 32 | [TMAFE Anti-Grabify URLs](https://raw.githubusercontent.com/TMAFE/anti-grabify/master/url_list.txt) | [Repository README](https://github.com/TMAFE/anti-grabify#license) and [LICENSE](https://github.com/TMAFE/anti-grabify/blob/master/LICENSE) state MPL 2.0. Confirm the file-level notice path. |
| 33 | [uAssets badware](https://ublockorigin.github.io/uAssets/filters/badware.txt) | Feed header links to [uAssets GPLv3](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE). Confirm runtime terms and notices. |
| 34 | [uAssets filters](https://ublockorigin.github.io/uAssets/filters/filters.txt) | Same [GPLv3 licence](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE); also contributes to `cosmetic-rules.json`. |
| 35 | [uAssets privacy](https://ublockorigin.github.io/uAssets/filters/privacy.txt) | Same [GPLv3 licence](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE); also contributes to `cosmetic-rules.json`. |
| 36 | [uAssets quick fixes](https://ublockorigin.github.io/uAssets/filters/quick-fixes.txt) | Same [GPLv3 licence](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE); also contributes to `cosmetic-rules.json`. |
| 37 | [uAssets unbreak](https://ublockorigin.github.io/uAssets/filters/unbreak.txt) | Same [GPLv3 licence](https://github.com/uBlockOrigin/uAssets/blob/master/LICENSE); also contributes to `cosmetic-rules.json`. |

## Files redistributed in the package

The digests identify the **current local bytes**, not an approved Store artefact. If a file
changes, its rights and notice decision must be rechecked against the new bytes.

| # | File | Current SHA-256 | Review still needed |
| ---: | --- | --- | --- |
| 38 | `rules-adshield.json` | `1fd7fe18bf6b6f5bee602ff8a8e7514205185e62a4c824e184acae2ef0d57f77` | The [compiler](../tools/build-adshield-dnr.js) takes an EasyList network-filter file, so #11's licence and attribution apply to the input. The JSON carries no source snapshot identifier; establish the actual input revision before approval. |
| 39 | `rules-easyprivacy.json` | `6511869ab74a22ba16fcc4de1e1d492c1148d2f28653245aee3af37eb6515cab` | The [compiler](../tools/build-easyprivacy-dnr.js) takes EasyPrivacy plus local `rules-trackers.json`. Check #12's licence, the actual input revision and notices. |
| 40 | `cosmetic-rules.json` | `194518e2a597f72ae22dacc1bbb443b38284cf9626a1949cd9436641df38dbd5` | The JSON records ten input URLs and SHA-256 values from its **2026-08-13** build: #10–15 and #34–37. Check each actual source, combined-feed obligations, and required notices before redistribution. Its [compiler](../tools/build-cosmetics.js) may use a local feed cache. |
| 41 | `psl-private.js` | `c29116820416273db6f0d36dabe2ebca7130bc8d4b1bf4cc07ebc47f22eeb674` | Generated from the Public Suffix List private section, version `2026-09-17_19-09-53_UTC`. The [PSL repository](https://github.com/publicsuffix/list/blob/main/LICENSE) is MPL 2.0. Check that this modified derived file and the package carry the required source and licence notices. |

## Release-owner checklist for this docket

1. Resolve the explicit gaps first: #5, #7 and #16 lack clear list terms; #2–3 conflict;
   #4 and #24 use custom licences; #20 and #28 include OpenPhish data; #26 and #28 have
   noncommercial conditions. Written upstream permission may be needed. Do not infer it
   from use by another blocker or from WardenOne being free to download.
2. Trace aggregated feeds (#17–22, #27–28, #30–31) and combined filters (#14, #40) far
   enough to identify any stricter upstream conditions. The publisher's repository licence
   alone may cover only its own contributions.
3. For each accepted input, choose the licence path and approved use (`runtime-fetch` or
   `redistribution`), record a dated HTTPS evidence URL and terms revision, and place required
   notices in `NOTICE`, `CREDITS.md` or `LICENSE`. For bundled files, record their exact hash.
4. Recheck all evidence for the exact candidate commit and run
   `node tools/check-store-rights.js`. A passing gate is a prerequisite to submission, not a
   guarantee of Chrome Web Store approval.

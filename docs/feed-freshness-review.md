# Publisher-date review — 30 September 2026

`tools/check-feed-publishers.js` read the first 16 KB of each configured remote feed on
30 September 2026. Of 37 distinct feeds, 4 carried a publisher date over 30 days old, 24 had a
recent date, 9 had no parseable publisher date, and none failed the header fetch. A publisher
date describes the source's edition, not when WardenOne fetched it. An old date does not prove
that a list is broken, and an unknown date does not prove that it is old.

| Feed | Header date | Current evidence | Decision |
| --- | --- | --- | --- |
| [Block List Project scam](https://raw.githubusercontent.com/blocklistproject/Lists/master/scam.txt) | 18 July 2026 | The project's [28 September release](https://github.com/blocklistproject/Lists/releases/tag/v2026.09.28) reports no changes to its blocklists since the previous release. | Keep the accepted rules and continue checking; an unchanged edition is not a failed fetch. |
| [Block List Project tracking](https://raw.githubusercontent.com/blocklistproject/Lists/master/tracking.txt) | 18 July 2026 | Same publisher and release record. | Keep and monitor with the scam source. |
| [VN badsite hosts](https://malware-filter.gitlab.io/vn-badsite-filter/vn-badsite-filter-hosts.txt) | 11 April 2025 | The [publisher says](https://gitlab.com/malware-filter/vn-badsite-filter/-/raw/main/README.md) daily updates stopped in May 2025 after its upstream was deprecated; its other lists continue. | Keep the accepted rules for now. Compare unique domains and recycled-domain false-positive risk with current malware feeds before proposing any retirement or replacement. |
| [manic-code malicious domains](https://raw.githubusercontent.com/manic-code/Emerging-Malicious-Domain-Blocklist/main/hosts.txt) | 5 April 2023 | The [publisher's README](https://github.com/manic-code/Emerging-Malicious-Domain-Blocklist) says this list is an upstream for HaGeZi Multi lists. WardenOne also fetches current HaGeZi lists, but overlap has not been measured. | Keep for now. Measure unique contribution and false positives before deciding whether a newer feed covers it. |

WardenOne continues to fetch enabled sources daily, retains the last accepted copy when a fetch
fails, and does not disable rules because a publisher date is old. The next useful measurement is
the last time each accepted source's content hash actually changed; that would distinguish an old
header on changing content from a genuinely unchanged edition. Then compare old-source domains
against recently updated feeds and inspect any unique domains for false positives. Do not remove
or replace a source solely because it crossed 30 days; new upstream inputs also require the
existing [rights review](store-rights-research.md) before a Store candidate can use them.

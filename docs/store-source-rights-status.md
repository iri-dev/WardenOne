# Store source rights status

## Affirmative replies received

Iris has received **four yeses** for WardenOne's described use. The original
emails are in Iris's mailbox. No follow-up email to these four publishers is
needed now.

| Publisher | What the reply established | Recorded action |
| --- | --- | --- |
| Phishing Army (Andrea) | WardenOne may use the publisher's aggregation and formatting work on GitHub and in the Chrome Web Store; upstream data rights remain separate. | The extension uses the recommended canonical feed, and [CREDITS.md](../CREDITS.md) visibly links to Phishing Army. |
| Peter Lowe (pgl.yoyo.org) | Peter granted Iris permission for the requested WardenOne use. | The direct runtime feed is marked verified in [source-inventory.json](source-inventory.json). |
| DSP Project (akac) | The direct runtime download of `list.txt` is permitted; no specific notice is required. | The feed is marked verified in the source inventory. |
| flinteger | WardenOne is free to use the feed, provided it honours the project licence and upstream data licences. | The publisher's grant is recorded separately from review of its aggregate inputs. |

The remaining rights work is to inspect applicable source terms and notices for
aggregated data, plus process any replies from other publishers. That review is
WardenOne project work; it does not undo these four permissions.

## Phishing Army — October 2026

Andrea's email welcomes the described WardenOne use, including distribution via
GitHub and the Chrome Web Store, and recommends the
[canonical feed](https://phishing.army/download/phishing-army-domains.txt).
WardenOne already fetches that URL. Andrea asked for visible credit linking to
[Phishing Army](https://phishing.army/); the generated source table in
[CREDITS.md](../CREDITS.md) supplies it. Her email refers separately to the
[upstream provider list](https://github.com/drego85/PhishingArmyCore/blob/master/SOURCES.md),
reviewed below. WardenOne's About page links to CREDITS.md.

### Active Phishing Army providers reviewed — 16 October 2026

| Provider | Published basis or status | Next action |
| --- | --- | --- |
| [PhishTank](https://phishtank.org/terms.php) | Its terms say API data is available for commercial use without charge. | No personal permission request indicated by the published data terms. |
| [CERT Polska](https://cert.pl/lista-ostrzezen/) | Its list documentation describes use in compatible browser extensions and supplies the current v2 feed. | No new outreach indicated for WardenOne's runtime blocking use. |
| [Phishunt](https://phishunt.io/tos/) | Its feed and API data are published under CC0 1.0; credit is appreciated. | Credit it in CREDITS.md. Its own third-party inputs remain identifiable through its terms. |
| [URLAbuse / NetSSR](https://urlabuse.com/public/html/terms.html) | Its data is CC BY 4.0 with credit, a website link, and identification of changes. | Added a direct credit in CREDITS.md identifying Phishing Army's domain extraction and WardenOne's runtime use. |
| [OpenPhish](https://openphish.com/) | Iris has already requested permission; no reply is recorded. | Check the reply when it arrives. |
| [urlscan.io](https://urlscan.io/terms/) | Its terms restrict commercial use and systematic data collection without approval; its [FAQ](https://urlscan.io/docs/faq/) asks product integrators to contact it. | Iris has contacted urlscan.io; wait for its answer. |
| [PhishStats](https://www.phishstats.info/terms) | Its terms require written permission to redistribute raw feeds. | Iris has contacted PhishStats; check whether its answer covers Phishing Army's derived domain feed and WardenOne's runtime use. |
| [StalkPhish](https://github.com/drego85/PhishingArmyCore/blob/master/SOURCES.md) | Its API is a subscribed source in Phishing Army's documentation; applicable downstream terms were not established in this review. | Iris has contacted StalkPhish; check its answer. |
| [AntiPhish.org](https://github.com/drego85/PhishingArmyCore/blob/master/SOURCES.md) | Phishing Army reports authorization for its own use. | Iris has contacted AntiPhish.org; check whether its reply covers WardenOne. |

Phishing Army also inserts two harmless local test domains. They are the
operator's own indicators, not a tenth independent provider. The provider list
above is about rights, not a requirement to send nine new emails.

## Peter Lowe (pgl.yoyo.org) — October 2026

Peter replied to Iris's request, "Sure, you can have permission." The direct
[pgl.yoyo.org feed](https://pgl.yoyo.org/adservers/serverlist.php?hostformat=hosts&showintro=0&mimetype=plaintext)
is therefore recorded as permitted for the requested WardenOne use. Its project
link appears in [CREDITS.md](../CREDITS.md).

## DandelionSprout anti-malware domains — 15 October 2026

**DandelionSprout's personal permission is not a blocker.** WardenOne fetches the
[raw-domain feed](https://raw.githubusercontent.com/DandelionSprout/adfilt/master/Alternate%20versions%20Anti-Malware%20List/AntiMalwareDomains.txt)
at runtime. The publisher identifies the repository's [Dandelicence v1.4](https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md)
as the [licence for its lists](https://github.com/DandelionSprout/adfilt/blob/master/Wiki/General-info.md).
It expressly permits use and redistribution, with or without modification or
commercial purpose, subject to its conditions. The exact feed has no separate
file-specific licence notice. WardenOne already names and links to the project
in [CREDITS.md](../CREDITS.md). No individual permission request to DandelionSprout
is needed for its own contributions to this runtime use.

The repository's [Manifest V3 statement](https://github.com/DandelionSprout/adfilt)
declines support for MV3-based extensions; it does not change the licence grant.

**Separate review remains open:** the feed cites some third-party material, and
Dandelicence section 4 preserves applicable obligations for borrowed content.
Review that provenance and any notices before treating the *whole feed* as
cleared. This note resolves the need for a personal permission reply; it does
not set `licenceVerified` in `source-inventory.json` or clear the Store rights
gate for this feed or the package.

## DSP Project scam links — 15 October 2026

**Permission received for WardenOne's described use.** In an email to Iris on
15 October 2026, akac said WardenOne may use the DSP Project's
`list.txt`, including having users' browsers download it directly from the
repository. No specific credit or licence notice is required. The project's
[README](https://github.com/Discord-AntiScam/scam-links) identifies akac as a
maintainer and publishes that exact `list.txt` endpoint. This resolves the
personal-permission question for this source; it does not clear other feeds.

**Freshness needs a separate decision.** akac said the list is stale and should
not be a primary protection source. The latest GitHub commit touching `list.txt`
was [3 January 2026](https://github.com/Discord-AntiScam/scam-links/commit/a2cb026b9e71f3e698a2c2f8fae10eb4f06df1ff).
WardenOne places it alongside MetaMask and PhishDestroy in the token-and-scam
source group. Review its unique contribution and false-positive risk before a
Store release; the permission reply does not establish feed quality or recency.

## flinteger malicious aggregate — 16 October 2026

**Publisher permission received with upstream conditions.** Flinteger Code
replied to Iris that WardenOne is free to use the feed, provided it honours the
project licence and upstream data licences. WardenOne fetches
[`malicious.domains.txt`](https://github.com/flinteger/dnss-blocklists/blob/release/blocklists/malicious.domains.txt)
at runtime. The repository's
[`sources/malicious.json`](https://github.com/flinteger/dnss-blocklists/blob/release/sources/malicious.json)
names Phishing Army, OpenPhish, two Mitchell Krog lists, `immortal_domains`, a
Mandiant APT1 appendix mirror, UT1 malware and phishing lists, a ShallaList
spyware mirror, and adblock-nocoin-list. The repository currently has no
`LICENSE` file on `master` or `release`; GitHub reports no repository licence.

Mitchell Krog's [Badd-Boyz-Hosts](https://github.com/mitchellkrogza/Badd-Boyz-Hosts/blob/master/LICENSE.md)
and [hacked-malware list](https://github.com/mitchellkrogza/The-Big-List-of-Hacked-Malware-Web-Sites/blob/master/LICENSE.md),
and [adblock-nocoin-list](https://github.com/hoshsadiq/adblock-nocoin-list/blob/master/LICENSE),
publish MIT notices, which provide reusable terms without asking those three
publishers for personal permission. The
[UT1 source licence](https://dsi.ut-capitole.fr/blacklists/download/LICENSE.pdf)
is CC BY-SA 4.0. CREDITS.md now identifies these sources and links their terms.
WardenOne does not bundle flinteger's feed in the extension package; it is
downloaded by each user's browser at runtime. Review any later packaging or
redistribution change against the MIT notice and CC BY-SA conditions.
Andrea's grant covers Phishing Army's own contribution; OpenPhish has been
contacted. The three older inputs need a narrower decision: the
`immortal_domains` mirror has no reliable licence statement identified;
[Mandiant's 2013 APT1 report](https://www.mandiant.com/sites/default/files/2021-09/mandiant-apt1-report.pdf)
is publicly available, but that alone does not grant reuse rights for its
Appendix D compilation; and the `cbuijs/shallalist` mirror no longer has an
accessible repository licence. Before treating these inputs as ongoing
coverage, determine whether flinteger still ingests them and whether their
domains make a useful, current contribution. This is WardenOne review work,
not another permission request to flinteger.

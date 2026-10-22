# Third-party source review

Checked 19 October 2026 against the exact configured files and primary publisher
documents. This records the evidence and implementation for WardenOne’s current
use; it is not a blanket legal approval of every upstream service or future use.
HaGeZi's publisher-confirmation record was updated on 20 October 2026 from the
owner-supplied email screenshot; the original correspondence remains private.

## Scope and counts

There are **38 unique configured runtime feed URLs**, including optional
OpenPhish. Repeated use of one URL by multiple protection groups counts once;
the inventory retains every purpose and setting. There are **32 feeds covered
by published licenses**. Written publisher permission covers **seven feed URLs
from five publishers**, including HaGeZi's three already licensed lists.
**Four feeds have specific unresolved upstream/use-scope questions**. Two written
permissions resolve direct runtime feeds; Phishing Army and flinteger retain
their grants while the identified upstream questions remain. Thus **34 feeds
are resolved** for the documented use. Permission counts overlap with published
license coverage and are not additive to the resolved total.

The old runtime inventory also contained 38 distinct URLs; the estimate of 39
was not an additional source. Its host-based groupings merged unrelated
EasyList subscriptions and malware-filter projects. Those identities now follow
their actual publishers and files. Six additional build-only URLs are recorded:
three historical AdGuard CDN inputs embedded in `cosmetic-rules.json`, the
Public Suffix List, Unicode confusables and uBlock’s silent media. The historical
CDN URLs remain build provenance, not runtime download destinations.

All 19 bundled rule/data/media artifacts are recorded, including WardenOne’s
editable seed lists and derived logger rule packs. Source inspection covered
`background.js`, the other runtime fetch paths, build tools, embedded cosmetic
input records, manifest rulesets and both package profiles. Optional keyed APIs,
browser-version services, release metadata, test requests and page/user-derived
URLs are classified separately in `externalServices`; they are not counted as
community blocklist feeds.

The runtime normalizes, deduplicates and caps domain/URL/selector data into
local rules. Command-bearing cosmetic rules are compiled at build time. No
runtime raw feed is bundled or served to other users by WardenOne. The empty
`REMOTE_LIST_URL` and `SUPPLEMENTAL_MANIFEST_URL` constants generate no request;
the generator now detects either becoming nonempty. User-added HTTPS lists
have no predetermined publisher and remain subject to their own terms.

## Durable evidence and compliance

[`source-licensing.json`](source-licensing.json) is the maintained policy input.
It binds exact URLs to publisher identity, applicable license, evidence,
conditions, implementation, scoped permission and specific issue IDs. Evidence
includes a document hash where a public document was captured. A mutable URL
and its hash identify what was checked; they do not promise unchanged future
terms. [`source-inventory.json`](source-inventory.json), `CREDITS.md` and
`THIRD_PARTY_NOTICES.html` are generated from it and actual code/build inputs.

License identification, compliance implementation, written permission and
outreach are independent fields. Contact without a reply is never a grant.
`clarification-required` identifies an actual exception; it does not mean an
entire publisher lacks a license. Retired/unavailable sources are separate from
active feeds. A new, replaced, duplicated or stale URL fails inventory checks
until its policy entry is supplied or corrected.

Both the GitHub and Store packages retain `CREDITS.md`, the offline HTML notices
and `licenses/`. The Store builder previously excluded `CREDITS.md`; that
omission is fixed. Settings → About opens the local notices. They include
copyright/permission texts, original-source and license links, modification
descriptions, upstream attribution and the surviving scope exceptions. Merely
displaying the page makes no network request.

### File-specific findings

- **AdAway:** the [consumed hosts header](https://raw.githubusercontent.com/AdAway/adaway.github.io/master/hosts.txt)
  specifies CC BY 3.0 and credits Kicelo, Dominik Schuermann and upstream
  contributors. That attribution and local conversion description are included.
- **Block List Project and quenhus:** their own [Unlicense](https://github.com/blocklistproject/Lists/blob/master/LICENSE)
  and [Unlicense](https://github.com/quenhus/uBlock-Origin-dev-filter/blob/main/LICENSE)
  grants cover this use. Separate emails are unnecessary.
- **EasyList/EasyPrivacy:** the [published dual-license grant](https://easylist.to/pages/licence.html)
  permits selecting either license. WardenOne selects GPLv3 for cosmetic
  compilation and CC BY-SA 3.0 for the separate adapted DNR data files
  `rules-adshield.json` and `rules-easyprivacy.json`. Their adapters’ contributions
  are supplied under the same share-alike data terms. Code remains GPLv3-or-later.
  Original authors, sources, license links and conversion/supplementation notices
  accompany those data. No personal permission email is needed.
- **EasyList China and Dutch:** each [China](https://easylist-downloads.adblockplus.org/easylistchina.txt)
  / [Dutch](https://easylist-downloads.adblockplus.org/easylistdutch.txt) file’s
  own header explicitly refers to the EasyList license page. This conclusion
  does not rely on assuming every externally hosted regional subscription shares
  the main list’s license.
- **Fanboy:** both [Annoyance](https://easylist-downloads.adblockplus.org/fanboy-annoyance.txt)
  and [Social](https://easylist-downloads.adblockplus.org/fanboy-social.txt) headers
  expressly specify **CC BY 3.0**. The main EasyList dual license was not
  substituted. Attribution, license links and identification of compiled changes
  are included, including Social’s packaged contributions.
- **AdGuard:** all three exact `FiltersRegistry/filters/filter_{2,3,11}_*/filter.txt`
  headers identify [AdguardFilters GPLv3](https://github.com/AdguardTeam/AdguardFilters/blob/master/LICENSE).
  FiltersRegistry’s infrastructure LGPL license is not used to relicense the
  filter data. The historical Base CDN input also includes EasyList under its
  dual-license grant. The original GPL cosmetic source inputs and scripts are
  supplied. Existing AdGuard outreach is not a condition of relying on this grant.
- **HaGeZi:** Light, Pro and TIF Medium are the publisher’s published Lists.
  Its [README licensing statement](https://github.com/hagezi/dns-blocklists#readme)
  expressly covers the Lists as published with GPLv3. Its distinction for building
  directly on upstream data is retained; WardenOne does not query those upstream
  sources for these three downloads. Private local conversion creates no duty to
  publish user caches. GPL text and attribution accompany the extension.
- **Dandelion Sprout:** [Dandelicence 1.4](https://github.com/DandelionSprout/adfilt/blob/master/LICENSE.md)
  permits use and redistribution subject to its stated conditions. WardenOne
  directly downloads the domain file; it does not bundle it. The file’s explicitly
  borrowed uBlock Badware entries are credited under their GPL terms. Report and
  issue citations are not treated as incorporation of entire unrelated datasets.
  The anti-MV3 support statement is not a withdrawal of the license. The owner’s
  decision not to start a GitHub Discussion remains respected.
- **MetaMask:** the actual [DBAD 1.2 license](https://github.com/MetaMask/eth-phishing-detect/blob/main/LICENSE)
  is a custom permission grant, not MIT. Its text, original author credit and
  source link are included. WardenOne does not sell an unmodified renamed copy.
- **durablenapkin, manic-code, Phishing.Database and PhishDestroy:** the exact
  repositories publish MIT notices. Their complete copyright and permission
  texts are retained in `licenses/MIT-NOTICES.txt` and the HTML notices.
  PhishDestroy’s [Primary and Community feeds](https://github.com/phishdestroy/destroylist)
  are distinct. Its [external-source aggregator](https://github.com/phishdestroy/destroylist/blob/main/scripts/smart_aggregator.py)
  writes `community/blocklist.json`; WardenOne consumes `primary_active/domains.txt`.
  OpenPhish’s appearance among Community credits is not treated as proof that
  the consumed curated Primary feed imports that aggregate.
- **malicious-hash (Romain Marcoux):** the repository publishes an
  [MIT grant](https://github.com/romainmarcoux/malicious-hash/blob/main/LICENSE),
  retained in `licenses/MIT-NOTICES.txt`. Its README names MalwareBazaar,
  URLhaus and two public AlienVault OTX community pulses as inputs. abuse.ch’s
  [current terms](https://abuse.ch/terms-of-use/) make MalwareBazaar and URLhaus
  free for not-for-profit use, which covers WardenOne. The OTX portion creates
  MH-1 below. WardenOne downloads the SHA-256 file directly and stores 128-bit
  prefixes for local matching; it redistributes no hashes.
- **TMAFE:** [MPL 2.0](https://github.com/TMAFE/anti-grabify/blob/master/LICENSE)
  applies to Anti-Grabify. The original list link, MPL text and source-availability
  explanation are supplied. Downloading and locally parsing it does not relicense
  all WardenOne code or require emailing its author.
- **malware-filter:** [URLhaus](https://gitlab.com/malware-filter/urlhaus-filter#license)
  and [VN Badsite](https://gitlab.com/malware-filter/vn-badsite-filter#license)
  publish MIT/CC0 grants and identify URLhaus and ChongLuaDao data as CC0. The
  URLhaus grant covers both outputs WardenOne reads: the hosts list for DNR rules
  and the online-URL list, which Download Guard keeps only as local fingerprints. The
  [Phishing filter](https://gitlab.com/malware-filter/phishing-filter#license)
  distinguishes MIT/CC0 `src/` code from CC BY-SA 4.0 filter data. Its OpenPhish
  input creates OP-1 below; the public filter license is identified, not erased.
  No PUP or tracking-filter licenses are implicated. VN’s discontinued updates
  are a separate freshness issue, not a missing reuse grant.

### StevenBlack’s two different aggregates

The current [build manifest](https://raw.githubusercontent.com/StevenBlack/hosts/master/readmeData.json)
identifies **16 base inputs** and **six porn-only inputs**. All are enumerated,
with their original source URLs and distinct terms, in the policy/inventory.
The repository MIT license is not described as overriding them.

The base contains Steven Black, AdAway, four FadeMind `add.*` lists,
Mitchell Krog Badd-Boyz, hostsVN, KADhosts, minecraft-hosts, MVPS, Dan Pollock,
Tiuxo ads, FadeMind UncheckyAds, URLhaus and yoyo. Paused input updates do not
erase previously incorporated material. MVPS’s retained
[header](https://raw.githubusercontent.com/StevenBlack/hosts/master/data/mvps.org/hosts)
specifies **CC BY-NC-SA 4.0**. Dan Pollock’s
[own header](https://someonewhocares.org/hosts/zero/hosts) permits noncommercial
copying/distribution with attribution and original URL. KADhosts is CC BY-SA
4.0; Tiuxo is CC BY 4.0; MIT/CC0 and AdAway’s CC BY 3.0 apply to the other
identified portions. WardenOne’s documented scope is free, noncommercial direct
runtime download/local processing, with visible upstream credit. This record
does **not** authorize commercial deployments or bundling that aggregate as
MIT-only. Existing MVPS/Dan Pollock outreach need not be repeated for this scope.

The porn-only file explicitly says the unified hosts file was **not used**.
Its inputs are BigDargon adult, brijrajparmar27 pornography, Clefspeare13,
Sinfonietta pornography and snuff, and Tiuxo pornography. The source manifest
declares MIT and CC BY 4.0 for these inputs. The retained Clefspeare13 file still
identifies MIT, Niclas and Spirillen even though its original license URL is
now unavailable. Attribution preserves those identities. Base-list
noncommercial conditions are not incorrectly applied to this alternate.

### Source availability for bundled derivatives

`docs/filter-source-snapshot.json.gz` preserves the **exact ten original
cosmetic compiler inputs’ relevant source-form records and comments**, original
headers and the full-input hashes embedded in the packaged artifact. Unused
network records are omitted; a separate hash protects each supplied source
subset. The snapshot is compressed and source-only; it is excluded
from both extension packages. This is necessary corresponding-source material,
not a new runtime database. The existing full local cache matched every original input hash.
`tools/build-cosmetics.js --from-snapshot` rebuilds the current artifact without
network access; `--check` verifies the actual scriptlet/procedural output against
the snapshot. A fresh build writes a matching source snapshot.

The separate DNR data files retain editable JSON and their conversion scripts;
the CC BY-SA choice requires share-alike attribution/distribution, not an exact
historical upstream build archive. No claim is made that today’s DNR builder and
the cosmetic snapshot recreate their historical DNR bytes. Their compatibility
edits and supplemented data remain intact.

Public Suffix List material remains MPL-covered in `psl-private.js`; its source
form, version/commit and builder remain public. Unicode’s full notice is retained.
uBlock’s silent MP4 is unmodified, pinned by hash and reproducible by its builder;
its identical inline use remains credited. Earlier code/strategy attributions
and historical incident evidence in `CREDITS.md` are preserved.

## Specific exceptions, not a new outreach campaign

No feed, security permission or protection is removed by this review. The Store
rights gate blocks these **five exact feeds** instead of demanding personal
approval for every open license. The normal development gate validates their
documented status without falsely clearing the Store package.

| Issue | Affected exact input | Evidence and remaining question |
| --- | --- | --- |
| OP-1 | `openphish/public_feed/.../feed.txt`; malware-filter `phishing-filter-hosts.txt`; Phishing Army; flinteger malicious domains | [OpenPhish’s own repository](https://github.com/openphish/public_feed) refers to its [usage terms](https://openphish.com/terms.html). These restrict personal/research and commercial/product use and third-party disclosure/derivative sharing. Public availability or an aggregator’s license does not establish a grant for OpenPhish’s portion. A reply in the existing outreach thread can establish the relevant direct/indirect local security-use scope. This is a scope question, not a declaration that every personal direct download is unlawful. |
| PA-1 | Phishing Army and its inclusion in flinteger | The [current nine-provider manifest](https://github.com/drego85/PhishingArmyCore/blob/master/SOURCES.md) includes urlscan search results. [urlscan’s terms](https://urlscan.io/terms/) restrict copying, derivative/distribution use and systematic extraction; the available record does not establish the scope of its consent for this downstream domain feed. Iris already contacted urlscan. Andrea’s grant for Phishing Army’s own work remains intact. |
| FL-1 | flinteger `malicious.domains.txt` | Its [active inputs](https://github.com/flinteger/dnss-blocklists/blob/release/sources/malicious.json) include a Mandiant APT1 Appendix D mirror that still returns data; its [README](https://bitbucket.org/ethanr/dns-blacklists/raw/master/README.md) supplies no reuse grant for the report compilation. No publisher statement resolving that input’s rights was found. This is narrower than reopening flinteger’s own conditional permission. |
| MH-1 | romainmarcoux `malicious-hash/full-hash-sha256-aa.txt` | The [README](https://github.com/romainmarcoux/malicious-hash) lists two AlienVault OTX community pulses among its inputs. The [OTX EULA](https://www.levelblue.com/terms/otx-eula) makes OTX free for non-commercial use but prohibits republishing or distributing any portion of OTX, so the aggregator’s MIT grant does not establish rights to those hashes. The file does not mark each hash’s source, so the OTX portion cannot be removed locally. Resolved by an OTX-free file from the publisher (MalwareBazaar and URLhaus only) or a recorded OTX grant. Outreach to the publisher was drafted on 22 October 2026 for the owner to send through the LinkedIn contact his GitHub profile names. |

PhishStats restricts redistribution of **raw feeds**. WardenOne does not query
it or redistribute its raw feed; that clause alone is not asserted to prohibit
Phishing Army’s derived hostnames. Existing outreach can clarify that scope but
it is not a separate finding of incompatible use. PhishTank explicitly permits
commercial API data use; CERT Polska documents browser filtering; Phishunt is
CC0; URLAbuse is CC BY 4.0 with source/change attribution now included; AntiPhish
authorization is reported by Phishing Army. StalkPhish’s owner-confirmed
WardenOne permission covers its open data through Phishing Army without resale,
with its requested link retained.

flinteger’s other active inputs include two Mitchell Krog MIT lists, Hosh’s MIT
nocoin list and UT1 malware/phishing under
[CC BY-SA 4.0](https://dsi.ut-capitole.fr/blacklists/download/LICENSE.pdf).
They are credited with their terms. The `immortal_domains` and Shalla spyware
endpoints returned 404. The actual [`process.py`](https://github.com/flinteger/dnss-blocklists/blob/master/scripts/process.py)
skips failed downloads rather than reading old source files; those two dead
addresses are not made into new permission-email tasks. No reliable conclusion
about their historic presence in every older output is implied.

**Owner involvement:** check replies already received from OpenPhish and urlscan
for the narrow scopes above. Only those portions of a relevant reply are needed;
do not publish private correspondence. For FL-1, the existing flinteger thread
may already identify the input’s basis. Otherwise the practical release choice
is to resolve or replace that aggregate input/feed; no further publisher is
being added to an email list. Removing the entire feeds would reduce overlapping
phishing/malware coverage, so none is silently disabled here. A compliant release
must resolve these exceptions or explicitly replace/omit the affected feeds and
document the protection impact first.

## Website and documentation files

Public wording was updated in `CREDITS.md`, `NOTICE`, `README.md`, `PRIVACY.md`,
`permissions.html`, `site/src/pages/privacy.html` and `site/src/pages/faq.html`.
`CHANGELOG.md` records the user-visible changes. `site/sync-data.js` now supplies
the notices, license and web-adapted permissions page; `site/check.js` verifies
their local links. `site/README.md` explains the local working-tree preview.
The generated website copies remain local build output, ready for the owner’s
normal publication workflow.

`docs/store-source-rights-status.md` preserves the scoped permission summaries
and prior outreach decisions. The maintained policy is
`docs/source-licensing.json`; generated provenance is
`docs/source-inventory.json`. The extension’s dedicated notice is
`THIRD_PARTY_NOTICES.html`, with original license texts in `licenses/`.

## Maintenance

Run `node tools/build-source-inventory.js` after a source/policy change and
`node tools/check-maintainability.js` before distribution. Source tests reject
missing policy, URL drift, stale entries, collapsed permission scopes, missing
notices, undocumented manifest rule data and absent compiler source. The Store
rights gate additionally requires implemented conditions and matching artifact
hashes and continues to fail on the five documented feed exceptions.

No extra request or permission grant is inferred from outreach alone. No commit,
push, website publication or Store submission is part of this local review.

## Validation — 19 October 2026

- Full maintainability gate: **passed, 288 suites**, including source discovery,
  source snapshot/output agreement, Store profile and package inventory checks.
- Edge 150 Settings regression: **passed**, including the local About link,
  complete license notices, zero resource requests while displaying them and a
  narrow-window layout check.
- Live feed check: **38/38 complete downloads passed the runtime byte caps and
  timeouts**, with no feed URL added, removed or changed.
- Website build/check: **passed** for nine site routes plus copied notices and
  permissions links; 508 local links/assets and 235 disk-open links checked.
- Both actual ZIPs were built from a temporary index: **127 GitHub-profile files,
  126 Store-profile files**. Both retain all credit/license files. The real
  index and repository commits were unchanged.
- Store rights check: **intentionally blocked on the four listed feed
  exceptions**. The separate release freshness check also rejects the existing
  cosmetic artifact dated 13 August 2026 (67 days old; release limit 30 days).
  Its protection rules were preserved; the source snapshot is not represented
  as a live-list refresh or a cleared Store submission.

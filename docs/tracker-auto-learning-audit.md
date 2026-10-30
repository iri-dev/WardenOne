# Automatic tracker protection — 2026-10-30

An opt-in **Learning mode** of the **Local tracker learner**, beside the default
**Review suggestions**, with one learner on/off switch. It is registered in
`SECOND_LEVEL_OF` as a mode of `trackerLearner`, so the protection count stays at
110. It is off by default, outside both onboarding bundles and outside "Turn
everything on". No release version changed. Work remains local.

An earlier draft of this mode only removed cookies. It now blocks, because the owner
asked for hands-off protection that keeps what it learns. This document describes
the blocking design and the risk it accepts.

## Evidence

Privacy Badger learns trackers on its own; WardenOne's learner only proposed, and
for a reason (SEC-04). A page supplies almost everything the learner sees: page
claims, API and path observations, and which hosts get requested at all. A page
network could make an innocent domain look like a tracker on three sites. The
URL-identifier detector is no different, since a page writes its own URLs. Those
signals still only create suggestions, in either mode.

Automatic decisions rest on one signal pages cannot supply: the browser's own cookie
jar holds a cookie for the third-party site that

- is sent cross-site (`SameSite=None`) and unpartitioned;
- is persistent and lives at least 30 days;
- holds an ID-shaped value: 10–512 characters, at least 8 distinct characters
  and 40 estimated bits; digit-only values need 16 digits, which excludes
  millisecond timestamps;
- is not a load-balancer, bot-check or consent cookie (`AWSALB*`, `__cf*`,
  `ARRAffinity`, `BIGipServer`, Imperva and Akamai bot cookies, `*consent*`, TCF,
  CMP and similar names).

Only the third party's server, or its own frames, can set such a cookie. Its shape is
a tracking heuristic, not proof: the cookie may have a legitimate use, and it need not
have been sent with the observed request.

`WOLearner.identifyingCookie` judges cookies. `trackerSiteHasIdentifyingCookie` reads
`chrome.cookies.getAll` once per third-party site per worker lifetime and keeps only
yes or no, for at most 500 sites. Values are never stored or sent. The observer runs
only while the master switch, the learner and the automatic mode are all on. It
covers HTTPS script, image, XHR and ping requests. It skips same-site requests,
private windows, media hosts, and protected sign-in, payment, government, education
and WardenOne-provider sites.

## Promotion

An entry is learned automatically only if all of these hold:

- the existing proposal bar: 3 sites (salted sketch), 2 browser sessions, 3 hits;
- at least 3 coalesced cookie observations and 3 network observations;
- no per-site **Allow** for the domain anywhere;
- it is a candidate or a waiting suggestion, never one the reader dismissed or unblocked;
- fewer than 20 automatic decisions already made that day;
- fewer than 10,000 saved decisions (`TRACKER_LEARN_DECISIONS_MAX`).

Anything else stays a suggestion. If Chrome rejects the native update, the entry and
its Activity record stay as they were.

## Action and the risk it accepts

Automatic entries are marked `fullBlock`. They are grouped 100 domains per rule in the
learner band at priority 1800 and block third-party requests of every resource type
except page navigation, frames included. Paused sites and sites with the learner
turned off are excluded as initiators. A direct visit to the domain still loads.

The learner works per registrable site. A site that keeps a tracking cookie can also
serve a CDN, an embed or an API that other sites call, and an automatic block covers
those too. The safeguards are the protected-site exclusions, the per-site Allow
exclusion, the daily cap, and Unblock. An Unblock is durable and immediate.

Suggestions approved in review mode keep the narrower block: third-party image,
beacon, XHR/fetch and WebTransport requests at priority 1800 (**Block requests**).
Older cookie-only automatic entries need fresh browser evidence before they become
full blocks.

## Durability, history and Unblock

Learned blocks and unblock choices never expire, through restarts and long absences.
Observations still expire after 30 days unseen, capped at 600, and are kept apart from
the decisions so a year of blocks cannot crowd them out. At the decision limit,
existing decisions are kept and new automatic decisions pause.

| Control | Effect |
| --- | --- |
| **Unblock** (popup or history) | `unblocked`, kept durably; automatic learning never blocks it again |
| **Block again** | Back to a learned block |
| **Undo all automatic** | Every automatic block unblocked in one native update |
| Review suggestions mode | No new automatic decisions; saved blocks stay |
| Learner or WardenOne off | Learner rules paused; resuming restores them |

An unblocked domain gets a third-party allow rule at priority 1900. That lifts the
learner's own block and also WardenOne's packaged tracker and ad lists (priority 1000
and below) for that domain, so the site that needed it works. Malware rules (2000)
and explicit per-site blocks (2500) still win.

**Settings → Learned trackers** lists blocked, unblocked and suggested domains with
search, filters, pages of 25, first-learned and unblocked dates, and the stored
evidence. Every stored field is escaped before display; the one `innerHTML` sink is
listed in `tools/reviewed-markup-sinks.json`. The popup shows at most five entries.
Dates follow the browser's display language.

Activity records `auto_learned_tracker_domain` and the unblock events with the domain
and why, and no page URL.

## Known costs

- The learner store is one storage key, rewritten on each new coalesced observation.
  With thousands of saved decisions each write grows; this was not measured.
- While the mode is on, the observer does two URL parses and two site lookups for each
  third-party request. This was not measured on busy real pages.

## Verification

`tools/test-tracker-learner-auto.js` (in the gate) covers the cookie predicate, store
shape, promotion, page-only and benign-cookie negatives, same-site, protected and
allowed domains, native rejection, durability, Unblock, Block again, history paging
and the daily cap. `tools/test-tracker-evidence.js` now expects observations capped
apart from decisions. The full maintainability gate passed.

`tools/browser-tracker-auto-learning.js` passed in Chrome 121.0.6167.184 and Edge
156.0.4314.50, in fresh profiles with the packaged files only, against a loopback
fixture with a real `SameSite=None`, 400-day cookie:

- session one gathers evidence without acting;
- once learned, the tracker's requests never reach the server, for every embedded
  resource type, while a direct visit loads;
- a year-old block survives pruning and a browser restart;
- the mode persists; review mode keeps saved blocks; the learner switch pauses and
  restores them;
- history **Unblock** and **Block again** change real network behaviour;
- a 61-entry history searches and pages, stored evidence is escaped, and the popup
  stays at five entries;
- an Unblock survives restart and repeated observations;
- no site names or cookie values are stored.

`tools/browser-tracker-learning.js` (manual approval) passed in Chrome 121 after its
popup checks were updated for the compact rows. The CI browser suites for Settings
data, popup regression, Settings arrangement, config race and engine smoke passed in
both browsers, and DNR reconciliation passed in Edge. YouTube and Twitch playback
were not re-checked: the mode is off by default and adds no rules until it learns.

Local reports in `docs/perf/traces/tracker-auto-learning-2026-10-30/` (ignored):

| Report | SHA-256 |
| --- | --- |
| `auto-protection-chrome121.json` | `1cfedb2c381a59e17e3df869c4652b1e6e768f864df6155b0e9ae47b0a502938` |
| `auto-protection-edge.json` | `eb07d7efbc7f9745e03057a109c00796e80799252b427a5b008103a505bee26a` |
| `manual-learning.json` | `db726777a86e4b8692c3350908e5bf2ecc75fe7b0f939039bd9944877dd83efb` |

## Compared with Privacy Badger

Privacy Badger's local learning is also off by default. When on, it blocks what it
learns, also per base domain and including frames, unless the domain is on its list of
domains to cookie-block only. This mode does the same kind of blocking but acts only on
cookie evidence a page cannot fake, keeps blocks and unblocks durably, and shows them in
a searchable history. It does not learn from fingerprinting or local-storage use, and
it cannot see a tracker that sets no cross-site cookie. Those trackers still reach the
reader as suggestions.

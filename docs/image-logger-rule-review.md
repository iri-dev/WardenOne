# Image logger rule review

Reviewed 2026-10-09 for the packaged `grabbers` DNR ruleset.

| Rule | Evidence | Scope |
| --- | --- | --- |
| `iplogger.icu` | [The operator describes link tracking and invisible image trackers](https://iplogger.icu/file/faq). | Whole host, like the existing reviewed logger domains. |
| `tracker.iplocation.net` images | [The operator offers invisible pixels and records visitor IP, browser, and referrer](https://tracker.iplocation.net/). [AdGuard also lists this exact tracker host](https://github.com/AdguardTeam/AdguardFilters/blob/master/SpywareFilter/sections/tracking_servers_firstparty.txt). | Third-party image requests to the tracker host. The parent `iplocation.net` domain and same-site images are outside this rule. |
| `tracker.iplocation.net/t/<code>` and `/s/<code>` | [The operator displays both tracking and shortened link routes](https://tracker.iplocation.net/t/TLbBX). | Direct visits to these routes go to the warning page. Third-party embedded requests to the same routes are blocked. The dashboard and other tracker pages are outside the route rules. |

No rule uses image dimensions, a generic `/pixel` path, or a label match on an unrelated host. Those signals also occur in ordinary images and analytics. The route pattern is anchored to the exact tracker host and requires a nonempty alphanumeric code.

## Local browser load check

`tools/browser-image-logger-loads.js` maps the reviewed logger host and control hosts to a loopback HTTP server. An extension-off pass proves the logger images are reachable. With WardenOne enabled, the server receives none of the direct `<img>`, selected `srcset`, CSS background, or redirected logger image requests. Ordinary 1×1 tracking pixels, CSS images, `srcset`, and redirected images still arrive and render without IP-logger alerts. An unlisted logger-shaped image also arrives and renders, then records an unconfirmed warning. The test requires Chrome to report the packaged logger image rule as a real match. It runs in the Edge and minimum-version Chrome browser jobs.

The cross-origin frame fixture also loads CSS images. Its known logger background is blocked before
reaching the server. Its dynamically assigned background on an unlisted logger-shaped host reaches
the server and does not produce the image-element heuristic warning. This is a coverage boundary,
not evidence that the request was safe. The frame observer watches image elements and their
`src`/`srcset` changes; it does not inspect arbitrary CSS or CSSOM changes.

Before adding CSS inspection, measure the frequency of suspicious CSS-only image requests in a
reviewed site corpus and profile the proposed detector on pages with frequent style changes and
many frames. The current loopback fixture establishes behavior, not prevalence or acceptable CPU
cost. Unknown destinations cannot be blocked reliably from image dimensions or a generic pixel path.

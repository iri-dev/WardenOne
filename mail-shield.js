/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */

/*
 * Mail Shield — tracking pixels in webmail.
 *
 * A marketing email carries a 1x1 image with your address encoded in its URL.
 * Loading it tells the sender you opened the message, when, roughly where from,
 * and on what. Ordinary tracker blocking misses these for one specific reason:
 *
 *   THE PROVIDER PROXIES THE IMAGE. Gmail rewrites every remote <img> to
 *   ci3.googleusercontent.com, so at the network layer there is no tracker
 *   domain left to match. A domain blocklist has nothing to bite on.
 *
 * But the information is not gone -- it moved. Gmail keeps the original URL in
 * the FRAGMENT of the proxy URL it writes into the DOM:
 *
 *   https://ci3.googleusercontent.com/meips/AAAA=s0-d-e1-ft#https://click.example/o/abc123
 *                                                          ^ the real tracker
 *
 * A fragment is never sent to a server, which is exactly why the network layer
 * cannot see it and why this has to happen in the page. That is the whole
 * argument for this file existing: it is not that blocking is impossible, it is
 * that it has to be done one layer up.
 *
 * Three decisions worth keeping:
 *
 * 1. NEUTRALISE, DO NOT BLOCK. The pixel's source is replaced with a transparent
 *    1x1 data: URI rather than the request being refused. Refusing leaves broken
 *    image icons through a newsletter and makes the mail client look faulty. A
 *    same-size transparent substitute is invisible -- which also means a FALSE
 *    POSITIVE IS HARMLESS BY CONSTRUCTION: old HTML email uses 1x1 spacer GIFs
 *    for layout, and swapping one for another transparent 1x1 changes nothing.
 *
 * 2. DECIDE FROM THE MARKUP, NEVER FROM THE RENDERED SIZE. By the time an image
 *    has a measurable box it has already loaded, and the tracker has already
 *    fired. So the signals are declared attributes, inline style and URL shape.
 *
 * 3. LAZY ATTRIBUTES COUNT. Webmail commonly parks the real URL in data-src and
 *    swaps it in later. Cleaning src alone would be undone a moment later.
 *
 * PREVENTED versus CANCELLED, measured rather than assumed. Driving this against
 * a local server and watching the request log:
 *
 *   - a pixel parked in data-src never appears in the log at all. Prevented.
 *   - a pixel already in src when the client renders the message appears as
 *     net::ERR_ABORTED. The swap cancels it, but the fetch had already been
 *     started, so whether any bytes reached the server is a race no content
 *     script can settle. What does NOT go either way is the part that identifies
 *     you: the fragment is never transmitted, and the aborted URL carries no
 *     query string.
 *
 * Webmail defers remote images behind a "show images" step often enough that the
 * first case is the common one, but the honest claim is "stopped before it
 * finishes", not "nothing is ever sent".
 *
 * What it also cannot do: if a provider fully rewrites an image and keeps no
 * trace of where it came from, only the shape signals are left. And stopping the
 * browser from fetching a proxied image says nothing about whether the provider
 * already fetched it server-side -- that happens outside the browser and no
 * extension can see it. The popup copy says all of this.
 */
(() => {
  'use strict';
  if (window.__wardenOneMailShield) return;
  window.__wardenOneMailShield = true;

  const PIXEL = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
  const MARK = 'data-wo-mail-shield';

  /* Hosts that proxy remote email images, and how to get back to the original.
     Gmail appends the source after a '#'; the others are matched on shape alone
     because they keep nothing recoverable. */
  const PROXY_HOSTS = /(^|\.)(googleusercontent\.com|mail\.protonmail\.com|proton\.me)$/i;

  /* Senders of open-tracking pixels, by the host that serves them. Deliberately
     short and specific: a long list of "marketing" domains would start eating
     the images people actually want to see. */
  const TRACKER_HOSTS = new RegExp('(^|\\.)(' + [
    'list-manage\\.com', 'mailchimp\\.com', 'mcusercontent\\.com',
    'sendgrid\\.net', 'sendgrid\\.com', 'sparkpostmail\\.com', 'mailgun\\.org',
    'hubspotemail\\.net', 'hs-sites\\.com', 'hubspotlinks\\.com',
    'klaviyomail\\.com', 'iterable\\.com', 'braze\\.com', 'customeriomail\\.com',
    'exct\\.net', 'exacttarget\\.com', 'mailjet\\.com', 'sailthru\\.com',
    'omnisend\\.com', 'convertkit-mail\\.com', 'substackcdn\\.com',
    'mailtrack\\.io', 'bananatag\\.com', 'yesware\\.com', 'streak\\.com',
    'hubspot\\.com', 'getnotify\\.com', 'didtheyreadit\\.com',
    'emltrk\\.com', 'openrateapp\\.com', 'pixel\\.app',
  ].join('|') + ')$', 'i');

  /* Paths that only an open-beacon has. Each needs a query string as well: a
     bare /open on a CDN is a page, not a pixel. */
  const TRACKER_PATH = /(^|\/)(open|o|op|pixel|px|beacon|track|trk|wf\/open|imp|impression|read|seen)(\.(gif|png|jpg|jpeg|webp|aspx|php|ashx))?$/i;
  /* A per-recipient token: this is what makes the pixel identify YOU rather than
     just count opens. */
  const RECIPIENT_TOKEN = /[A-Za-z0-9+/=_-]{24,}/;

  const seen = new WeakSet();
  let removed = 0;
  let proxied = 0;
  let reportTimer = 0;

  function attrNum(el, name) {
    const raw = el.getAttribute(name);
    if (raw == null) return NaN;
    const n = parseInt(String(raw).replace(/px$/i, ''), 10);
    return Number.isFinite(n) ? n : NaN;
  }

  /* The declared size, not the rendered one. */
  function declaredTiny(img) {
    const w = attrNum(img, 'width');
    const h = attrNum(img, 'height');
    if (Number.isFinite(w) && Number.isFinite(h) && w <= 3 && h <= 3) return true;
    const style = String(img.getAttribute('style') || '');
    const sw = style.match(/(?:^|;)\s*width\s*:\s*(\d+(?:\.\d+)?)px/i);
    const sh = style.match(/(?:^|;)\s*height\s*:\s*(\d+(?:\.\d+)?)px/i);
    if (sw && sh && parseFloat(sw[1]) <= 3 && parseFloat(sh[1]) <= 3) return true;
    return false;
  }

  function declaredHidden(img) {
    const style = String(img.getAttribute('style') || '').toLowerCase();
    return /display\s*:\s*none/.test(style)
      || /visibility\s*:\s*hidden/.test(style)
      || /opacity\s*:\s*0(\s*;|\s*$|\.0)/.test(style);
  }

  /* Gmail keeps the source after a '#'. Everything before it is Google's. */
  function originalUrl(raw) {
    const url = String(raw || '');
    const hash = url.indexOf('#');
    if (hash > 0) {
      const tail = url.slice(hash + 1);
      if (/^https?:\/\/\S+$/i.test(tail)) return tail;
    }
    return url;
  }

  function parse(raw) {
    try { return new URL(String(raw), location.href); } catch (_) { return null; }
  }

  function classify(img) {
    /* Lazy attributes first: the real URL often lives there until the client
       decides to load it, and cleaning only src would be undone a moment later. */
    const raw = img.getAttribute('src')
      || img.getAttribute('data-src')
      || img.getAttribute('data-original-src')
      || img.getAttribute('data-lazy-src')
      || '';
    if (!raw) return null;
    /* Never touch what the page made itself, an attachment, or an inline image:
       none of those reach a third party. Strictly this is already covered by the
       http(s)-only check below -- it is kept because it states the intent at the
       point someone would look for it, and because widening that check later
       should not silently start rewriting attachments. */
    if (/^(data:|blob:|cid:|about:)/i.test(raw)) return null;

    const source = originalUrl(raw);
    const u = parse(source);
    if (!u || !/^https?:$/i.test(u.protocol)) return null;
    const wasProxied = source !== raw;

    if (declaredTiny(img)) return { why: 'a 1x1 image, which no one can see', u, wasProxied };
    if (declaredHidden(img)) return { why: 'an image deliberately hidden from view', u, wasProxied };
    if (TRACKER_HOSTS.test(u.hostname)) return { why: 'served by a known open-tracking service', u, wasProxied };

    const path = u.pathname.replace(/\.[a-z0-9]+$/i, '');
    if (TRACKER_PATH.test(u.pathname) && u.search && RECIPIENT_TOKEN.test(u.search + path)) {
      return { why: 'an open-beacon carrying an identifier for you', u, wasProxied };
    }
    return null;
  }

  function neutralise(img, verdict) {
    if (img.getAttribute(MARK)) return false;
    try {
      img.setAttribute(MARK, verdict.wasProxied ? 'proxied' : 'direct');
      /* Order matters: clear the lazy attributes first, or the client swaps the
         real URL back in after we have cleaned src. */
      for (const attr of ['srcset', 'data-src', 'data-original-src', 'data-lazy-src', 'data-srcset']) {
        if (img.hasAttribute(attr)) img.setAttribute(attr, PIXEL);
      }
      img.setAttribute('src', PIXEL);
      /* Same declared size, so a spacer GIF keeps spacing exactly as before. */
      img.setAttribute('alt', img.getAttribute('alt') || '');
      img.title = 'Tracking pixel neutralised by WardenOne — ' + verdict.why;
    } catch (_) { return false; }
    removed++;
    if (verdict.wasProxied) proxied++;
    scheduleReport(verdict);
    return true;
  }

  let lastWhy = '';
  function scheduleReport(verdict) {
    lastWhy = verdict.why;
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = 0;
      try {
        chrome.runtime.sendMessage({
          kind: 'rg-block',
          type: 'blocked_beacon',
          detail: {
            matched: removed + ' email tracking pixel' + (removed === 1 ? '' : 's'),
            why: 'stopped ' + removed + ' tracking pixel' + (removed === 1 ? '' : 's')
              + ' in webmail — ' + lastWhy
              + (proxied ? ' (' + proxied + ' recovered from behind the provider proxy)' : ''),
          },
        }, () => { void chrome.runtime.lastError; });
      } catch (_) {}
    }, 900);
  }

  function sweep(root) {
    let node = root;
    if (!node || node.nodeType !== 1) return;
    const images = node.tagName === 'IMG' ? [node] : node.querySelectorAll('img');
    for (const img of images) {
      if (seen.has(img)) continue;
      seen.add(img);
      const verdict = classify(img);
      if (verdict) neutralise(img, verdict);
    }
  }

  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === 'attributes' && r.target && r.target.tagName === 'IMG') {
        /* The client swapping a lazy URL into src. seen-ness does not apply:
           this is a new URL on an element already looked at. */
        const verdict = classify(r.target);
        if (verdict) neutralise(r.target, verdict);
        continue;
      }
      for (const added of (r.addedNodes || [])) sweep(added);
    }
  });

  function start() {
    if (document.documentElement) {
      sweep(document.documentElement);
      observer.observe(document.documentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['src', 'data-src', 'data-original-src', 'data-lazy-src', 'srcset'],
      });
    }
  }

  /* Off unless the toggle says otherwise, asked once. A mail client is the last
     place to act on a stale assumption about what the reader wanted. */
  try {
    chrome.runtime.sendMessage({ kind: 'content-config-get' }, (res) => {
      void chrome.runtime.lastError;
      const cfg = (res && res.config) || {};
      if (cfg.enabled === false || cfg.mailTrackingShield === false) return;
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', start, { once: true });
        start();
      } else start();
    });
  } catch (_) {}

  /* For the tests, and for anyone reading the page in a console. */
  window.__wardenOneMailShieldApi = { classify, originalUrl, declaredTiny, declaredHidden, count: () => removed };
})();

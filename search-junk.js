/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Search-result marking. Two independent passes over the same results page, each with
 * its own toggle, sharing one engine table and one way of finding a result block.
 *
 *   1. Search-junk marker  (flagSearchJunk,    OFF by default) -- scraper sites, below.
 *   2. Search-result warnings (warnSearchResults, ON by default) -- results WardenOne
 *      already knows something bad about, warned BEFORE the click rather than blocked
 *      after the navigation.
 *
 * The warning pass never says a result is safe. There is no green badge and no "checked"
 * mark, because the lists behind it cover a rounding error of the web and a tick beside
 * an unexamined result is worse than nothing: it spends trust that was not earned. A
 * result with nothing against it gets no mark at all.
 *
 * It also never hides or reorders anything -- it adds a line above the result and leaves
 * the result intact. Every verdict comes from the background out of lists already on the
 * machine; no result URL is ever sent anywhere to paint a badge. For a deeper answer
 * about one link there is right-click -> Check this link, which is allowed to ask the
 * network because the reader asked it to.
 *
 *
 * Marks search results from sites that rank by republishing other people's work
 * -- Stack Exchange and GitHub scrapers, mostly. It DIMS AND LABELS them. It does
 * not remove them, and that is deliberate:
 *
 *   Ad blocking fails visibly. Block a real image and you see a gap and know
 *   something happened. Search filtering fails INVISIBLY. Hide the one result
 *   that actually answered the question and you never learn it existed -- you
 *   just think the web got worse. That is a worse failure than the problem, and
 *   it is unreportable, so every match keeps a one-click "show anyway".
 *
 * Registered only while the toggle is on, and only on the search engines below.
 *
 * Why it anchors on links rather than result-block classes: Google randomises its
 * class names and reshuffles its DOM constantly. A selector like "div.g" is a
 * maintenance treadmill. A result's LINK, though, has to contain the destination
 * host or the result would not work -- so the host is read from the anchor and the
 * block is found by walking up to the nearest ancestor that looks like one. If
 * that walk fails the result is simply left alone.
 */
(function () {
  'use strict';
  const WO_GUARD_VERSION = '1.0.1';
  /* Chrome does not re-inject into tabs that are already open when the extension updates, so a
     tab that outlives an update keeps this script's old copy. A bare boolean flag made that
     permanent -- the new copy saw a truthy flag and returned, so Repair could never re-arm the
     tab, only report honestly that it could not. Comparing versions lets a newer copy replace an
     older one, and it must release the old one's listeners, observers and timers first or both
     copies stay live and are charged for the same work. */
  if (window.__wardenOneSearchJunk === WO_GUARD_VERSION) return;
  if (window.__wardenOneSearchJunk) {
    try {
      if (typeof window.__wardenOneSearchJunkDispose === 'function') window.__wardenOneSearchJunkDispose();
    } catch (_) {}
  }
  window.__wardenOneSearchJunk = WO_GUARD_VERSION;

  /* Everything this copy holds, so the next one can let it go. Listeners ride a single abort
     signal; observers and intervals are collected; timeouts remove their own id when they fire,
     so a self-rescheduling loop cannot grow this set without bound. */
  const woAbort = new AbortController();
  const woKeep = [];
  const woPending = new Set();
  const woHold = (item) => { woKeep.push(item); return item; };
  const woOn = (target, type, fn, opts) => {
    const base = (opts && typeof opts === 'object')
      ? Object.assign({}, opts)
      : (opts === true ? { capture: true } : {});
    base.signal = woAbort.signal;
    try { target.addEventListener(type, fn, base); } catch (_) {}
  };
  const woObserver = (...a) => woHold(new MutationObserver(...a));
  const woInterval = (...a) => woHold(setInterval(...a));
  /* A normal function, not an arrow: three call sites pass function-keyword callbacks, and
     forwarding `this` keeps them behaving exactly as the host would call them. */
  const woTimeout = (fn, ms, ...rest) => {
    let id;
    id = setTimeout(function (...a) {
      woPending.delete(id);
      return typeof fn === 'function' ? fn.apply(this, a) : undefined;
    }, ms, ...rest);
    woPending.add(id);
    return id;
  };
  window.__wardenOneSearchJunkDispose = () => {
    try { woAbort.abort(); } catch (_) {}
    woPending.forEach((id) => { try { clearTimeout(id); } catch (_) {} });
    woPending.clear();
    const held = woKeep.splice(0, woKeep.length);
    for (const item of held) {
      try {
        if (item && typeof item.disconnect === 'function') item.disconnect();
        else clearInterval(item);
      } catch (_) {}
    }
  };
  if (window.top !== window) return;

  var MARK_ATTR = 'data-wo-junk';
  var WARN_ATTR = 'data-wo-risk';
  var WARN_LABEL_ATTR = 'data-wo-risk-label';
  var RETRY_NOT_READY_MS = 2500;
  var MAX_NOT_READY_RETRIES = 12;
  var STYLE_ID = 'wo-search-junk-style';
  var MAX_MARKS = 60;          /* a results page has ~10; this is a runaway guard */
  var MAX_SCAN_LINKS = 400;    /* links looked at per pass, counted apart from either cap */
  /* Short: the scan is a walk over the result links, and 300 ms here was most of the wait
     between results appearing and the line appearing. */
  var RESCAN_DEBOUNCE_MS = 80;

  var hosts = Object.create(null);
  var marked = 0;
  var warned = 0;
  var rescanTimer = 0;
  /* Which passes this page is running. Both default off here; the config reply below
     turns on whichever the reader has enabled, and the script is only registered at all
     when at least one of them is. */
  var doJunk = false;
  var doWarn = false;
  /* host -> verdict, or host -> null once the background has answered and had nothing
     against it. Null is a real entry on purpose: without it, a host with no verdict is
     asked about again on every rescan, and a results page rescans a lot. */
  var verdicts = Object.create(null);
  var notReadyRetries = 0;
  /* The packaged IP-logger list, from search-loggers.js -- generated from the ruleset
     (block rules for whole domains, nothing else: the file also carries allow rules for
     Google and the login hosts) and registered right in front of this script. The worker's
     answer is the whole picture, but waking it takes most of a second, and a logger link is
     the one result nobody should have to wait to be told about. There is no other way to
     have the list in time: a content script cannot fetch a packaged file, and it is kept
     out of extension storage -- the worker hands pages a bounded snapshot instead. */
  var loggerHosts = Object.create(null);
  var LOGGER_LABEL = 'IP logger \u2014 opening it reveals your address';
  function addPackagedLoggers(list) {
    for (var i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
      var v = String(list[i] || '').trim().toLowerCase();
      if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v)) loggerHosts[v] = true;
    }
  }
  function packagedLogger(clean) {
    if (loggerHosts[clean]) return true;
    var reg = registrable(clean);
    return !!(reg && loggerHosts[reg]);
  }
  var asking = false;

  /* Engines we understand well enough to find a result block on. The container is
     where results live; the block hints are tried in order when walking up from a
     link. Everything is a fallback chain -- an unknown layout marks nothing rather
     than mangling the page. */
  var ENGINES = [
    { test: /(^|\.)google\./, container: '#search, #rso, #main', blocks: ['div[data-hveid]', 'div[data-sokoban-container]', '.MjjYud', '.g'] },
    { test: /(^|\.)bing\.com$/, container: '#b_results', blocks: ['li.b_algo', 'li[class*="b_alg"]'] },
    { test: /(^|\.)duckduckgo\.com$/, container: '#links, [data-testid="mainline"]', blocks: ['article[data-testid="result"]', 'li[data-layout="organic"]', '.result'] },
    { test: /(^|\.)search\.brave\.com$/, container: '#results', blocks: ['.snippet[data-type="web"]', '.snippet'] },
    { test: /\.search\.yahoo\.com$/, container: '#web, #results', blocks: ['li div.algo', 'div.algo'] },
  ];

  var host = String(location.hostname || '').toLowerCase();
  /* registrable() is a function declaration further down, so it is hoisted. */
  var engineBase = registrable(host);
  var engine = null;
  for (var i = 0; i < ENGINES.length; i++) {
    if (ENGINES[i].test.test(host)) { engine = ENGINES[i]; break; }
  }
  if (!engine) return;

  function registrable(h) {
    var parts = String(h || '').toLowerCase().replace(/^www\./, '').split('.').filter(Boolean);
    if (parts.length <= 2) return parts.join('.');
    var last2 = parts.slice(-2).join('.');
    return /^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(last2) ? parts.slice(-3).join('.') : last2;
  }

  function isJunkHost(h) {
    var clean = String(h || '').toLowerCase().replace(/^www\./, '');
    if (!clean) return false;
    if (hosts[clean]) return true;
    var reg = registrable(clean);
    return !!(reg && hosts[reg]);
  }

  function addHosts(list) {
    for (var i = 0; i < (Array.isArray(list) ? list.length : 0); i++) {
      var v = String(list[i] || '').trim().toLowerCase().replace(/^\*?\.?/, '').replace(/\/.*$/, '');
      if (!/^[a-z0-9.-]+\.[a-z]{2,}$/.test(v) || v.indexOf('..') >= 0) continue;
      hosts[v] = true;
    }
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var css = '[' + MARK_ATTR + '="1"]{opacity:.42;filter:grayscale(.65);transition:opacity .15s ease;}'
      + '[' + MARK_ATTR + '="1"]:hover{opacity:.72;}'
      + '[' + MARK_ATTR + '="0"]{opacity:1;filter:none;}'
      + '.wo-junk-tag{display:inline-flex;align-items:center;gap:6px;margin:4px 0 6px;padding:2px 8px;'
      + 'border-radius:999px;border:1px solid rgba(128,128,128,.45);font:500 11px/1.6 system-ui,sans-serif;'
      + 'color:#8a6d3b;background:rgba(255,193,7,.12);}'
      + '.wo-junk-tag button{all:unset;cursor:pointer;text-decoration:underline;font-weight:600;color:inherit;}'
      /* A rule down the side and a line above it. Deliberately NOT dimmed the way a
         scraper result is: dimming is for "you probably do not want this", and a
         warning has to stay perfectly readable to be acted on. Nothing is hidden and
         the link still works -- the reader is told, not overruled. */
      /* The line itself is generated content, read off an attribute on the result block,
         rather than a node placed inside it. Bing sweeps foreign nodes out of its result
         items within seconds -- the attribute stayed, the line went, and five marked
         results showed nothing -- and a pseudo-element is not a node anything can remove.
         attr() is text: a domain that reached a feed cannot put markup on the page. */
      /* No box and no colour of its own: the symbol carries the warning, the words say what
         it is, and the page's own text colour keeps it readable on a light page and a dark
         one alike (the page's theme is not the OS theme, so nothing here may key on
         prefers-color-scheme). */
      + '[' + WARN_LABEL_ATTR + ']::before{content:attr(' + WARN_LABEL_ATTR + ');display:block;'
      + 'margin:0 0 4px;padding:0;font:600 11.5px/1.5 system-ui,sans-serif;color:inherit;'
      + 'opacity:.92;max-width:100%;white-space:normal;}';
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
  }

  /* Where the click actually lands. Bing, Yahoo and DuckDuckGo's HTML page hand out
     links through their own redirector, and Google still does on some layouts, so the
     anchor's host is the engine's and says nothing about the result. Only the engine's
     own wrapper is unwrapped -- a result that happens to link to another site's
     redirector is left as the host it names. */
  function resultUrlOf(link) {
    var href = String(link.href || '');
    var url;
    try { url = new URL(href); } catch (_) { return href; }
    var h = url.hostname.toLowerCase();
    var p = url.pathname;
    try {
      if (/(^|\.)bing\.com$/.test(h) && /^\/ck\/a/.test(p)) {
        var u = url.searchParams.get('u') || '';
        if (/^a1/.test(u)) {
          var b64 = u.slice(2).replace(/-/g, '+').replace(/_/g, '/');
          while (b64.length % 4) b64 += '=';
          var decoded = atob(b64);
          if (/^https?:\/\//i.test(decoded)) return decoded;
        }
      } else if (/(^|\.)google\./.test(h) && p === '/url') {
        var q = url.searchParams.get('q') || url.searchParams.get('url') || '';
        if (/^https?:\/\//i.test(q)) return q;
      } else if (/(^|\.)duckduckgo\.com$/.test(h) && /^\/l\//.test(p)) {
        var d = url.searchParams.get('uddg') || '';
        if (/^https?:\/\//i.test(d)) return d;
      } else if (/(^|\.)yahoo\.com$/.test(h)) {
        var m = /\/RU=([^/]+)\//.exec(p);
        if (m) {
          var y = decodeURIComponent(m[1]);
          if (/^https?:\/\//i.test(y)) return y;
        }
      }
    } catch (_) {}
    return href;
  }

  /* Every results container the engine table names, in document order, minus any that
     sits inside another. querySelector took the first element to match and stopped:
     DuckDuckGo renders an empty [data-testid="mainline"] before the one its results
     live in, so the first match had no links, nothing was ever asked about, and the
     page looked clean. */
  function resultRoots() {
    var roots = [];
    var sels = engine.container.split(',');
    for (var i = 0; i < sels.length; i++) {
      var found;
      try { found = document.querySelectorAll(sels[i].trim()); } catch (_) { found = []; }
      for (var k = 0; k < found.length; k++) {
        if (roots.indexOf(found[k]) < 0) roots.push(found[k]);
      }
    }
    return roots.filter(function (node) {
      for (var i = 0; i < roots.length; i++) {
        if (roots[i] !== node && roots[i].contains(node)) return false;
      }
      return true;
    });
  }

  function findBlock(link, root) {
    for (var i = 0; i < engine.blocks.length; i++) {
      var node = link.closest(engine.blocks[i]);
      /* Must be a block INSIDE the results area, and not the results area itself --
         otherwise a bad selector match dims the whole page. */
      if (node && node !== root && root.contains(node) && node.querySelector('h3, h2, a[href]')) return node;
    }
    return null;
  }

  function tag(block, hostname) {
    var strip = document.createElement('div');
    strip.className = 'wo-junk-tag';
    strip.appendChild(document.createTextNode('Reposts other people’s answers · ' + hostname));
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Show anyway';
    woOn(btn, 'click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      block.setAttribute(MARK_ATTR, '0');
      strip.remove();
    });
    strip.appendChild(btn);
    block.insertBefore(strip, block.firstChild);
  }

  /* The warning line. Text only -- no link, no button, nothing that could be clicked by
     accident on the way to the result. "Show anyway" would make no sense here either:
     nothing has been taken away to show. */
  function warnTag(block, verdict, hostname) {
    /* Every one of these strings is built in the background from list data. They go into
       an attribute the stylesheet reads back as text, never into markup. */
    var label = (verdict.level === 'malicious' ? '\u26D4\uFE0F ' : '\u26A0\uFE0F ')
      + String(verdict.label || 'WardenOne has a warning about this site')
      + ' \u00B7 ' + String(hostname);
    block.setAttribute(WARN_ATTR, verdict.level === 'malicious' ? 'malicious' : 'warn');
    block.setAttribute(WARN_LABEL_ATTR, label);
  }

  /* Ask about the hosts on the page that have not been asked about yet. One message per
     batch, and only for hosts with no answer on file, so a page that rescans twenty
     times still asks once per host. Nothing leaves the machine to answer it. */
  function requestVerdicts(pending) {
    if (asking || !pending.length) return;
    asking = true;
    try {
      chrome.runtime.sendMessage({ kind: 'search-result-check', hosts: pending }, function (reply) {
        asking = false;
        try { void chrome.runtime.lastError; } catch (_) {}
        if (chrome.runtime.lastError) return;
        /* Record every host that was asked about, answered or not. A host the background
           had nothing against is stored as null -- that is what stops it being asked
           again -- and null is never rendered, so "no answer" can never become a mark. */
        var got = (reply && reply.ok && reply.verdicts) || {};
        /* A worker still loading its lists -- woken from idle, or right after an install --
           answers with what it has and says the rest is not in yet. What it has is drawn now;
           a host it had nothing against is not recorded as clean, so the page asks about it
           again in a moment. Caching that "nothing" would keep the page quiet for good. */
        var partial = !!(reply && reply.ok && reply.ready === false);
        for (var i = 0; i < pending.length; i++) {
          var key = pending[i];
          if (Object.prototype.hasOwnProperty.call(got, key)) verdicts[key] = got[key];
          else if (!partial) verdicts[key] = null;
        }
        if (partial && notReadyRetries++ < MAX_NOT_READY_RETRIES) woTimeout(scan, RETRY_NOT_READY_MS);
        /* Drawn on the answer itself. The page is already built -- that is what produced the
           question -- so a debounce here was pure waiting. */
        if (reply && reply.ok) scan(partial);
      });
    } catch (_) { asking = false; }
  }

  /* drawOnly: draw what is known and ask nothing -- the pass made on a partial answer,
     where asking again at once would only get the same partial answer again. */
  function scan(drawOnly) {
    var roots = resultRoots();
    var pending = [];
    var looked = 0;
    for (var r = 0; r < roots.length; r++) looked = scanRoot(roots[r], pending, looked);
    if (pending.length && drawOnly !== true) requestVerdicts(pending);
  }

  function scanRoot(root, pending, looked) {
    /* Every anchor, with the href resolved: a result that links through the engine's own
       redirector is often a relative /url?q=... and would not match a scheme prefix. */
    var links = root.querySelectorAll('a[href]');
    /* The link walk is bounded on its own rather than on either pass's counter. It used
       to stop at MAX_MARKS, which was fine while there was one pass and wrong the moment
       there were two: a page with sixty scraper results would have silenced every
       warning below them, and the missing warnings would have looked like an all-clear. */
    for (var j = 0; j < links.length && looked < MAX_SCAN_LINKS; j++) {
      looked++;
      var link = links[j];
      var hostname = '';
      /* A javascript:, mailto: or data: address has no host and is skipped below. */
      try { hostname = new URL(resultUrlOf(link)).hostname; } catch (_) { continue; }
      var clean = String(hostname).replace(/^www\./, '').toLowerCase();

      /* The engine's own links -- its tabs, its "people also search for", its video
         carousel -- are not results, and the engine is never asked about itself. */
      if (clean === host || host.endsWith('.' + clean) || clean.endsWith('.' + engineBase)) continue;
      if (doWarn && clean && warned < MAX_MARKS) {
        if (!Object.prototype.hasOwnProperty.call(verdicts, clean) && packagedLogger(clean)) {
          verdicts[clean] = { level: 'malicious', label: LOGGER_LABEL, detail: clean };
        }
        if (!Object.prototype.hasOwnProperty.call(verdicts, clean)) {
          if (pending.indexOf(clean) < 0 && pending.length < MAX_MARKS) pending.push(clean);
        } else if (verdicts[clean]) {
          var riskBlock = findBlock(link, root);
          /* One line per result. Google nests a block per sitelink inside the result's
             block, each with its own data-hveid, so a result with six sitelinks would
             carry seven lines: a block inside one already marked is left alone, and a
             block marked after its inner ones takes them over. */
          if (riskBlock && !riskBlock.hasAttribute(WARN_ATTR) && !riskBlock.parentElement.closest('[' + WARN_ATTR + ']')) {
            ensureStyle();
            var inner = riskBlock.querySelectorAll('[' + WARN_ATTR + ']');
            for (var k = 0; k < inner.length; k++) {
              inner[k].removeAttribute(WARN_ATTR);
              inner[k].removeAttribute(WARN_LABEL_ATTR);
            }
            warnTag(riskBlock, verdicts[clean], clean);
            warned++;
          }
        }
      }

      if (!doJunk || marked >= MAX_MARKS) continue;
      if (!isJunkHost(hostname)) continue;
      var block = findBlock(link, root);
      if (!block || block.hasAttribute(MARK_ATTR)) continue;
      ensureStyle();
      block.setAttribute(MARK_ATTR, '1');
      tag(block, clean);
      marked++;
    }
    return looked;
  }

  function scheduleScan() {
    if (rescanTimer) return;
    rescanTimer = woTimeout(function () { rescanTimer = 0; scan(); }, RESCAN_DEBOUNCE_MS);
  }

  function start() {
    scan();
    /* Results arrive late and change on "more results"/instant updates. */
    try {
      var obs = woObserver(scheduleScan);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    try { woOn(window, 'popstate', scheduleScan); } catch (_) {}
  }

  var begun = false;
  function begin() {
    if (begun) return;
    begun = true;
    if (document.readyState === 'loading') {
      woOn(document, 'DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  }

  /* Every line drawn so far, taken back: the snapshot said this engine is paused or the
     pass was switched off since the registration was made. */
  function clearMarks() {
    var marks = document.querySelectorAll('[' + WARN_ATTR + ']');
    for (var i = 0; i < marks.length; i++) {
      marks[i].removeAttribute(WARN_ATTR);
      marks[i].removeAttribute(WARN_LABEL_ATTR);
    }
  }

  function allowlisted(cfg) {
    var allow = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];
    for (var i = 0; i < allow.length; i++) {
      var a = String(allow[i] || '').replace(/^www\./, '').toLowerCase();
      if (a && (host === a || host.endsWith('.' + a))) return true;
    }
    return false;
  }

  /* The warning pass does not wait to be told it is wanted. Asking the worker meant a
     round trip that, on a worker asleep after 30 s of idling, came AFTER the results were
     on screen; and the page is kept out of extension storage. So the worker puts the answer
     in the registration: it registers this script only while WardenOne is on and a pass is
     wanted, and puts search-loggers.js in front of it only while the warning pass is on.
     The list being here is the switch. Known loggers are named at once; the rest is asked. */
  doWarn = typeof WO_SEARCH_LOGGERS !== 'undefined' && Array.isArray(WO_SEARCH_LOGGERS);
  if (doWarn) {
    addPackagedLoggers(WO_SEARCH_LOGGERS);
    begin();
  }

  /* The snapshot still comes, for the scraper pass -- its lists live only in the worker --
     and it is the one reading of the allowlist. If it says this engine is paused, or that
     the warning pass went off after the registration was made, the pass stops and takes
     its lines back; it can only ever turn the pass off, never on. */
  chrome.runtime.sendMessage({ kind: 'content-config-get', need: ['overrides', 'searchJunk'] }, function (response) {
    try { void chrome.runtime.lastError; } catch (_) {}
    if (chrome.runtime.lastError || !response || !response.ok) return;
    var cfg = response.overrides && typeof response.overrides === 'object' ? response.overrides : {};
    var off = cfg.enabled === false || allowlisted(cfg);
    if (doWarn && (off || cfg.warnSearchResults === false)) { doWarn = false; clearMarks(); }
    if (off || cfg.flagSearchJunk !== true) return;
    doJunk = true;
    addHosts(response.searchJunkDomains);
    var aux = response.supplemental;
    addHosts(aux && aux.searchJunkDomainsExtra);
    fetch(chrome.runtime.getURL('search-junk-domains.json'), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) { addHosts(data && data.scraperHosts); })
      .catch(function () {})
      .then(function () {
        /* The scraper list being empty used to end the script. It cannot now: the
           warning pass has its own reason to run and does not use that list at all. */
        if (!Object.keys(hosts).length) { doJunk = false; return; }
        if (begun) scheduleScan(); else begin();
      });
  });
})();

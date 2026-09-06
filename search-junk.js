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
  var STYLE_ID = 'wo-search-junk-style';
  var MAX_MARKS = 60;          /* a results page has ~10; this is a runaway guard */
  var MAX_SCAN_LINKS = 400;    /* links looked at per pass, counted apart from either cap */
  var RESCAN_DEBOUNCE_MS = 300;

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
      + '[' + WARN_ATTR + ']{border-inline-start:3px solid transparent;padding-inline-start:9px;}'
      + '[' + WARN_ATTR + '="malicious"]{border-inline-start-color:#c0392b;}'
      + '[' + WARN_ATTR + '="warn"]{border-inline-start-color:#c98a1b;}'
      + '.wo-risk-tag{display:flex;align-items:baseline;gap:6px;margin:4px 0 6px;padding:3px 9px;'
      + 'border-radius:8px;font:600 11.5px/1.55 system-ui,sans-serif;max-width:44em;}'
      + '.wo-risk-tag .wo-risk-why{font-weight:400;opacity:.85;}'
      + '.wo-risk-malicious{color:#8c1d13;background:rgba(192,57,43,.13);'
      + 'border:1px solid rgba(192,57,43,.32);}'
      + '.wo-risk-warn{color:#7a5310;background:rgba(201,138,27,.13);'
      + 'border:1px solid rgba(201,138,27,.32);}'
      + '@media (prefers-color-scheme:dark){'
      + '.wo-risk-malicious{color:#ffb4a8;background:rgba(192,57,43,.2);}'
      + '.wo-risk-warn{color:#f2cc84;background:rgba(201,138,27,.18);}}';
    var el = document.createElement('style');
    el.id = STYLE_ID;
    el.textContent = css;
    (document.head || document.documentElement).appendChild(el);
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
    var strip = document.createElement('div');
    strip.className = 'wo-risk-tag ' + (verdict.level === 'malicious' ? 'wo-risk-malicious' : 'wo-risk-warn');
    var mark = document.createElement('span');
    mark.setAttribute('aria-hidden', 'true');
    mark.textContent = verdict.level === 'malicious' ? '⛔' : '⚠';
    strip.appendChild(mark);
    var text = document.createElement('span');
    /* textContent throughout: every one of these strings is built in the background from
       list data, and building this line with innerHTML would let a domain that got onto
       a feed put markup on a Google results page. */
    text.textContent = String(verdict.label || 'WardenOne has a warning about this site');
    strip.appendChild(text);
    var why = document.createElement('span');
    why.className = 'wo-risk-why';
    why.textContent = '· ' + String(hostname);
    strip.appendChild(why);
    block.insertBefore(strip, block.firstChild);
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
        for (var i = 0; i < pending.length; i++) {
          var key = pending[i];
          verdicts[key] = Object.prototype.hasOwnProperty.call(got, key) ? got[key] : null;
        }
        if (reply && reply.ok) scheduleScan();
      });
    } catch (_) { asking = false; }
  }

  function scan() {
    var root = null;
    var sels = engine.container.split(',');
    for (var i = 0; i < sels.length && !root; i++) root = document.querySelector(sels[i].trim());
    if (!root) return;

    var links = root.querySelectorAll('a[href^="http"]');
    var pending = [];
    /* The link walk is bounded on its own rather than on either pass's counter. It used
       to stop at MAX_MARKS, which was fine while there was one pass and wrong the moment
       there were two: a page with sixty scraper results would have silenced every
       warning below them, and the missing warnings would have looked like an all-clear. */
    for (var j = 0; j < links.length && j < MAX_SCAN_LINKS; j++) {
      var link = links[j];
      var hostname = '';
      try { hostname = new URL(link.href).hostname; } catch (_) { continue; }
      var clean = String(hostname).replace(/^www\./, '').toLowerCase();

      if (doWarn && clean && warned < MAX_MARKS) {
        if (!Object.prototype.hasOwnProperty.call(verdicts, clean)) {
          if (pending.indexOf(clean) < 0 && pending.length < MAX_MARKS) pending.push(clean);
        } else if (verdicts[clean]) {
          var riskBlock = findBlock(link, root);
          if (riskBlock && !riskBlock.hasAttribute(WARN_ATTR)) {
            ensureStyle();
            riskBlock.setAttribute(WARN_ATTR, verdicts[clean].level === 'malicious' ? 'malicious' : 'warn');
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
    if (pending.length) requestVerdicts(pending);
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

  chrome.runtime.sendMessage({ kind: 'content-config-get' }, function (response) {
    try { void chrome.runtime.lastError; } catch (_) {}
    if (chrome.runtime.lastError || !response || !response.ok) return;
    var cfg = response.overrides || {};
    if (cfg.enabled === false) return;
    doJunk = cfg.flagSearchJunk === true;
    doWarn = cfg.warnSearchResults !== false;
    if (!doJunk && !doWarn) return;
    /* An allowlisted search engine is left completely alone. */
    var allow = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];
    for (var i = 0; i < allow.length; i++) {
      var a = String(allow[i] || '').replace(/^www\./, '').toLowerCase();
      if (a && (host === a || host.endsWith('.' + a))) return;
    }

    var begin = function () {
      if (document.readyState === 'loading') {
        woOn(document, 'DOMContentLoaded', start, { once: true });
      } else {
        start();
      }
    };

    if (!doJunk) { begin(); return; }

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
        if (!Object.keys(hosts).length) doJunk = false;
        if (!doJunk && !doWarn) return;
        begin();
      });
  });
})();

/*
 * Search-junk marker (toggle: flagSearchJunk, OFF by default).
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
  if (window.__wardenOneSearchJunk) return;
  window.__wardenOneSearchJunk = true;
  if (window.top !== window) return;

  var MARK_ATTR = 'data-wo-junk';
  var STYLE_ID = 'wo-search-junk-style';
  var MAX_MARKS = 60;          /* a results page has ~10; this is a runaway guard */
  var RESCAN_DEBOUNCE_MS = 300;

  var hosts = Object.create(null);
  var marked = 0;
  var rescanTimer = 0;

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
      + '.wo-junk-tag button{all:unset;cursor:pointer;text-decoration:underline;font-weight:600;color:inherit;}';
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
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      block.setAttribute(MARK_ATTR, '0');
      strip.remove();
    });
    strip.appendChild(btn);
    block.insertBefore(strip, block.firstChild);
  }

  function scan() {
    if (marked >= MAX_MARKS) return;
    var root = null;
    var sels = engine.container.split(',');
    for (var i = 0; i < sels.length && !root; i++) root = document.querySelector(sels[i].trim());
    if (!root) return;

    var links = root.querySelectorAll('a[href^="http"]');
    for (var j = 0; j < links.length && marked < MAX_MARKS; j++) {
      var link = links[j];
      var hostname = '';
      try { hostname = new URL(link.href).hostname; } catch (_) { continue; }
      if (!isJunkHost(hostname)) continue;
      var block = findBlock(link, root);
      if (!block || block.hasAttribute(MARK_ATTR)) continue;
      ensureStyle();
      block.setAttribute(MARK_ATTR, '1');
      tag(block, String(hostname).replace(/^www\./, ''));
      marked++;
    }
  }

  function scheduleScan() {
    if (rescanTimer) return;
    rescanTimer = setTimeout(function () { rescanTimer = 0; scan(); }, RESCAN_DEBOUNCE_MS);
  }

  function start() {
    scan();
    /* Results arrive late and change on "more results"/instant updates. */
    try {
      var obs = new MutationObserver(scheduleScan);
      obs.observe(document.documentElement, { childList: true, subtree: true });
    } catch (_) {}
    try { window.addEventListener('popstate', scheduleScan); } catch (_) {}
  }

  chrome.storage.local.get(['wardenone_config', 'wardenone_search_junk_domains', 'wardenone_aux_lists'], function (store) {
    try { void chrome.runtime.lastError; } catch (_) {}
    var cfg = (store && store.wardenone_config) || {};
    if (cfg.enabled === false || cfg.flagSearchJunk !== true) return;
    /* An allowlisted search engine is left completely alone. */
    var allow = Array.isArray(cfg.allowlist) ? cfg.allowlist : [];
    for (var i = 0; i < allow.length; i++) {
      var a = String(allow[i] || '').replace(/^www\./, '').toLowerCase();
      if (a && (host === a || host.endsWith('.' + a))) return;
    }

    var extra = store && store.wardenone_search_junk_domains;
    addHosts(Array.isArray(extra) ? extra : (extra && extra.scraperHosts));
    var aux = store && store.wardenone_aux_lists;
    addHosts(aux && aux.searchJunkDomainsExtra);

    fetch(chrome.runtime.getURL('search-junk-domains.json'), { cache: 'no-store' })
      .then(function (r) { return r.json(); })
      .then(function (data) { addHosts(data && data.scraperHosts); })
      .catch(function () {})
      .then(function () {
        if (!Object.keys(hosts).length) return;
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', start, { once: true });
        } else {
          start();
        }
      });
  });
})();

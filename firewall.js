/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The per-site firewall.

   A decision matrix for one site: every domain the page loads, and what each of
   them is allowed to do there. Dynamic filtering rather than another blocklist --
   the rules are the reader's, they apply to one site, and they beat everything
   WardenOne would otherwise decide.

   Two things make it usable rather than merely powerful:

   1. THE ROWS ARE WHAT THIS PAGE ACTUALLY LOADED, not a guess. It listens on the
      same capture the network logger uses, so a row exists because a request
      happened, and each row already knows whether WardenOne blocked it and which
      list decided. The reader is overriding something specific, not filling in a
      blank grid.
   2. UNDO IS ALWAYS ONE CLICK. A matrix that can switch off a site's own CDN can
      break that site completely; the answer is not to hide the danger but to
      make walking it back trivial and obvious.

   Nothing here is guesswork about what a domain is "for". A cell says what
   happened and what the reader chose, and nothing else. */
'use strict';

const $ = (id) => document.getElementById(id);

const COLUMNS = [
  ['script', 'Script'],
  ['xhr', 'XHR'],
  ['frame', 'Frame'],
  ['media', 'Media'],
  ['cookie', 'Cookie'],
  ['all', 'All'],
];
/* Which column a captured request type belongs to, so the matrix can show what
   each domain has actually been doing. */
const TYPE_COLUMN = {
  script: 'script',
  xmlhttprequest: 'xhr', websocket: 'xhr',
  sub_frame: 'frame', main_frame: 'frame',
  media: 'media', image: 'media', font: 'media',
};

const params = new URLSearchParams(location.search);
const TAB_ID = Number(params.get('tab'));
let SITE = String(params.get('site') || '').toLowerCase().replace(/^www\./, '');

/* domain -> { seen: Set(column), blocked: Set(column), sources: Set(string), requests: n } */
const OBSERVED = new Map();
let RULES = {};
let renderTimer = 0;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

function registrable(host) {
  const parts = String(host || '').split('.');
  if (parts.length <= 2) return String(host || '');
  const tail = parts.slice(-2).join('.');
  /* Good enough to group by for display; the rules themselves always use the
     exact host the reader clicked, never a guessed parent. */
  if (/^(co|com|org|net|gov|ac|edu)\.[a-z]{2}$/.test(tail) && parts.length >= 3) return parts.slice(-3).join('.');
  return tail;
}

/* ---- the live capture --------------------------------------------------- */
const port = chrome.runtime.connect({ name: 'wardenone-logger' });
port.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.kind === 'hello' || msg.kind === 'entries') ingest(msg.entries || []);
  if (msg.kind === 'cleared') { OBSERVED.clear(); scheduleRender(); }
});
port.onDisconnect.addListener(() => {
  $('capture-state').textContent = 'Capture stopped. Reload this page to start again.';
});

function ingest(list) {
  for (const e of list) {
    if (!e || !e.host) continue;
    if (Number.isFinite(TAB_ID) && e.tabId !== TAB_ID) continue;
    const row = OBSERVED.get(e.host) || { seen: new Set(), blocked: new Set(), sources: new Set(), requests: 0 };
    const column = TYPE_COLUMN[e.type] || 'all';
    row.seen.add(column);
    row.requests++;
    if (e.action === 'blocked') {
      row.blocked.add(column);
      if (e.source) row.sources.add(e.source);
    }
    OBSERVED.set(e.host, row);
  }
  scheduleRender();
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 120);
}

/* ---- decisions ---------------------------------------------------------- */
function decisionOf(domain, column) {
  const forDomain = RULES[domain];
  return (forDomain && forDomain[column]) || 'default';
}

function cycle(column, current) {
  /* The cookie column is not a block, so it has its own two states. */
  if (column === 'cookie') return current === 'strip' ? 'default' : 'strip';
  if (current === 'default') return 'allow';
  if (current === 'allow') return 'block';
  return 'default';
}

function setCell(domain, column, verdict, cell) {
  cell.disabled = true;
  chrome.runtime.sendMessage({ kind: 'firewall-set', site: SITE, domain, column, verdict }, (res) => {
    void chrome.runtime.lastError;
    cell.disabled = false;
    if (!res || !res.ok) {
      $('status').textContent = (res && res.error) || 'That could not be saved.';
      return;
    }
    RULES = res.rules || {};
    $('status').textContent = 'Saved. Reload ' + SITE + ' for it to take effect.';
    render();
  });
}

/* ---- rendering ---------------------------------------------------------- */
function render() {
  $('site-name').textContent = SITE || '(no site)';
  const domains = [...new Set([...OBSERVED.keys(), ...Object.keys(RULES), ...MANUAL])];
  /* First-party last: the rows worth acting on are the third parties, and a
     site's own domain at the top is the one people mis-click. */
  const base = registrable(SITE);
  domains.sort((a, b) => {
    const fa = registrable(a) === base ? 1 : 0;
    const fb = registrable(b) === base ? 1 : 0;
    if (fa !== fb) return fa - fb;
    const ra = OBSERVED.get(a);
    const rb = OBSERVED.get(b);
    return ((rb && rb.requests) || 0) - ((ra && ra.requests) || 0);
  });

  const body = $('rows');
  body.textContent = '';
  let decided = 0;
  for (const domain of domains) {
    const row = OBSERVED.get(domain) || { seen: new Set(), blocked: new Set(), sources: new Set(), requests: 0 };
    const tr = el('tr', registrable(domain) === base ? 'is-first-party' : '');

    const name = el('td', 'fw-domain');
    name.appendChild(el('div', null, domain));
    const note = el('div', 'fw-note-sm');
    if (registrable(domain) === base) note.textContent = 'this site';
    else if (row.sources.size) note.textContent = 'blocked by ' + [...row.sources].join(', ');
    else if (row.requests) note.textContent = row.requests + ' request' + (row.requests === 1 ? '' : 's');
    else note.textContent = MANUAL.has(domain) ? 'added by you — not seen this visit' : 'no requests seen this visit';
    name.appendChild(note);
    tr.appendChild(name);

    for (const [column, label] of COLUMNS) {
      const td = el('td', 'fw-cell');
      const verdict = decisionOf(domain, column);
      if (verdict !== 'default') decided++;
      const button = el('button', 'fw-btn is-' + verdict);
      button.type = 'button';
      button.textContent = verdict === 'allow' ? 'allow'
        : verdict === 'block' ? 'block'
          : verdict === 'strip' ? 'strip'
            : (column !== 'cookie' && row.blocked.has(column)) ? '· blocked'
              : (column !== 'cookie' && row.seen.has(column)) ? '· loaded'
                : '—';
      button.title = verdict === 'default'
        ? label + ': whatever WardenOne decides. Click to set your own rule.'
        : label + ': ' + verdict + ', because you said so here.';
      button.addEventListener('click', () => setCell(domain, column, cycle(column, verdict), button));
      td.appendChild(button);
      tr.appendChild(td);
    }
    body.appendChild(tr);
  }

  $('empty').hidden = domains.length > 0;
  $('count').textContent = domains.length + ' domain' + (domains.length === 1 ? '' : 's')
    + (decided ? ', ' + decided + ' rule' + (decided === 1 ? '' : 's') + ' of yours' : ', none of your rules yet');
  $('reset-site').disabled = decided === 0;
}

/* ---- controls ----------------------------------------------------------- */
$('reload').addEventListener('click', () => {
  if (!Number.isFinite(TAB_ID)) return;
  OBSERVED.clear();
  render();
  $('capture-state').textContent = 'Reloading ' + SITE + ' and watching what it loads…';
  try { chrome.tabs.reload(TAB_ID, { bypassCache: true }); } catch (_) {}
});

/* A domain typed in by hand. It joins the matrix as a row with no decisions, so
   nothing changes until a cell is clicked -- adding is not itself a rule. */
const MANUAL = new Set();
$('add').addEventListener('click', addTyped);
$('add-domain').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') addTyped(); });
function addTyped() {
  const field = $('add-domain');
  let host = String(field.value || '').trim().toLowerCase();
  /* Paste a URL and mean the host. */
  try { if (host.includes('://')) host = new URL(host).hostname.toLowerCase(); } catch (_) {}
  host = host.replace(/^www\./, '').split('/')[0];
  if (!host || !host.includes('.') || !/^[a-z0-9.-]+$/.test(host)) {
    $('status').textContent = 'That does not look like a domain.';
    return;
  }
  MANUAL.add(host);
  field.value = '';
  $('status').textContent = host + ' added. It has no rules until you click a cell.';
  render();
}
function reset(all) {
  chrome.runtime.sendMessage({ kind: 'firewall-reset', site: SITE, all: all === true }, (res) => {
    void chrome.runtime.lastError;
    if (!res || !res.ok) { $('status').textContent = (res && res.error) || 'Nothing was reset.'; return; }
    RULES = {};
    $('status').textContent = all
      ? 'Every firewall rule on every site has been removed.'
      : 'Your rules for ' + SITE + ' have been removed. Reload the site.';
    render();
  });
}
$('reset-site').addEventListener('click', () => reset(false));
$('reset-all').addEventListener('click', () => reset(true));

/* ---- start -------------------------------------------------------------- */
function load() {
  chrome.runtime.sendMessage({ kind: 'firewall-get', site: SITE }, (res) => {
    void chrome.runtime.lastError;
    if (res && res.ok) {
      SITE = res.site || SITE;
      RULES = res.rules || {};
      $('all-sites').textContent = res.sites
        ? 'You have rules on ' + res.sites + ' site' + (res.sites === 1 ? '' : 's') + '.'
        : 'No firewall rules anywhere yet.';
    }
    $('capture-state').textContent = 'Watching. Reload the site to see everything it loads.';
    render();
  });
}
load();

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The network / filtering logger.

   Capture lives in the worker and only runs while this page holds its port open,
   so closing the tab is what stops it. Everything here is presentation plus the
   four actions -- and every action writes a rule into My Rules rather than into
   some private store, so anything this page does to your filtering is visible,
   editable and removable in one place. */
'use strict';

const $ = (id) => document.getElementById(id);

let ENTRIES = [];                 // newest last, keyed by id
const BY_ID = new Map();
let actionFilter = 'all';
let typeFilter = 'all';
let query = '';
let paused = false;
let openId = null;
let renderTimer = 0;

const TYPE_LABEL = {
  main_frame: 'page', sub_frame: 'frame', stylesheet: 'css', script: 'script',
  image: 'image', font: 'font', object: 'object', xmlhttprequest: 'xhr',
  ping: 'ping', csp_report: 'csp', media: 'media', websocket: 'socket', other: 'other',
};
/* The chips group the long tail rather than listing thirteen types nobody
   filters by. "Other" means everything not given its own chip. */
const NAMED_TYPES = new Set(['script', 'xmlhttprequest', 'sub_frame', 'image', 'media', 'websocket']);

const port = chrome.runtime.connect({ name: 'wardenone-logger' });

port.onMessage.addListener((msg) => {
  if (!msg) return;
  if (msg.kind === 'hello') {
    $('cap').textContent = String(msg.max || 1000);
    $('capture-state').textContent = 'Recording. Capture stops when you close this tab.';
    $('exact-note').textContent = msg.exactRules
      ? 'Rule attribution is exact: Chrome reports the matched rule id for this build.'
      : 'Chrome only reports the matched rule for an unpacked build, so rules are shown as '
        + '"blocked by a network rule" here. Load WardenOne unpacked to see exactly which rule and list matched.';
    ingest(msg.entries || []);
    return;
  }
  if (msg.kind === 'entries') { if (!paused) ingest(msg.entries || []); return; }
  if (msg.kind === 'cleared') { ENTRIES = []; BY_ID.clear(); openId = null; scheduleRender(); }
});
port.onDisconnect.addListener(() => {
  $('capture-state').textContent = 'Capture stopped. Reload this page to start again.';
});

/* Entries arrive twice -- once when the request starts, once when it settles --
   so merging by id in place is what stops a request appearing as two rows. */
function ingest(list) {
  for (const e of list) {
    const seen = BY_ID.get(e.id);
    if (seen) Object.assign(seen, e);
    else { BY_ID.set(e.id, e); ENTRIES.push(e); }
  }
  scheduleRender();
}

function scheduleRender() {
  if (renderTimer) return;
  renderTimer = setTimeout(() => { renderTimer = 0; render(); }, 90);
}

function matches(e) {
  if (actionFilter !== 'all' && e.action !== actionFilter) return false;
  if (typeFilter !== 'all') {
    if (typeFilter === 'other') { if (NAMED_TYPES.has(e.type)) return false; }
    else if (e.type !== typeFilter) return false;
  }
  if (query) {
    const hay = (e.url + ' ' + e.host + ' ' + (e.page || '') + ' ' + (e.source || '') + ' ' + (e.rule || '')).toLowerCase();
    if (!hay.includes(query)) return false;
  }
  return true;
}

function badge(e) {
  const span = document.createElement('span');
  span.className = 'log-badge log-' + (e.action === 'pending' ? 'pending' : e.action);
  span.textContent = e.action === 'pending' ? '…' : e.action;
  return span;
}

function render() {
  const body = $('rows');
  const shown = ENTRIES.filter(matches);
  /* Newest first, and capped: the buffer holds a thousand and painting them all
     on every batch would make the logger the slowest thing on the machine. */
  const visible = shown.slice(-400).reverse();

  body.textContent = '';
  for (const e of visible) {
    const tr = document.createElement('tr');
    tr.className = 'log-row' + (e.id === openId ? ' is-open' : '');
    tr.tabIndex = 0;

    const c1 = document.createElement('td'); c1.appendChild(badge(e));
    const c2 = document.createElement('td'); c2.className = 'log-dim'; c2.textContent = TYPE_LABEL[e.type] || e.type;
    const c3 = document.createElement('td'); c3.className = 'log-dim';
    c3.textContent = e.party === 'third' ? '3rd' : e.party === 'first' ? '1st' : '—';
    const c4 = document.createElement('td');
    const host = document.createElement('div'); host.textContent = e.host || '(no host)';
    const url = document.createElement('div'); url.className = 'log-url log-dim';
    url.textContent = e.url.length > 120 ? e.url.slice(0, 120) + '…' : e.url;
    c4.appendChild(host); c4.appendChild(url);
    const c5 = document.createElement('td'); c5.className = 'log-dim';
    c5.textContent = e.source || (e.action === 'blocked' ? 'a network rule' : '');

    tr.append(c1, c2, c3, c4, c5);
    const toggle = () => { openId = openId === e.id ? null : e.id; render(); };
    tr.addEventListener('click', toggle);
    tr.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); toggle(); } });
    body.appendChild(tr);

    if (e.id === openId) body.appendChild(detailRow(e));
  }

  $('empty').style.display = visible.length ? 'none' : '';
  $('count').textContent = shown.length === ENTRIES.length
    ? ENTRIES.length + ' requests'
    : shown.length + ' of ' + ENTRIES.length;
  $('m-total').textContent = String(ENTRIES.length);
  $('m-blocked').textContent = String(ENTRIES.filter((x) => x.action === 'blocked').length);
  $('m-allowed').textContent = String(ENTRIES.filter((x) => x.action === 'allowed').length);
}

function detailRow(e) {
  const tr = document.createElement('tr');
  tr.className = 'log-detail';
  const td = document.createElement('td');
  td.colSpan = 5;

  const dl = document.createElement('dl');
  const add = (k, v) => {
    if (!v && v !== 0) return;
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = String(v);
    dl.append(dt, dd);
  };
  add('Outcome', e.action === 'blocked' ? 'Blocked by WardenOne'
    : e.action === 'allowed' ? 'Allowed through' + (e.status ? ' (HTTP ' + e.status + ')' : '')
    : e.action === 'failed' ? 'Failed: ' + (e.error || 'the network refused it')
    : 'Still in flight');
  add('Method', e.method);
  add('Type', TYPE_LABEL[e.type] || e.type);
  add('Party', e.party === 'third' ? 'Third-party' : e.party === 'first' ? 'First-party' : 'Unknown');
  add('Page', e.page);
  add('URL', e.url + (e.redacted ? '   (secrets removed)' : ''));
  if (e.action === 'blocked') {
    add('Rule', e.rule ? '#' + e.rule : 'not reported by Chrome in a packed build');
    add('From', e.source || 'a network rule');
  }
  add('At', new Date(e.at).toLocaleTimeString());
  td.appendChild(dl);

  /* Every action writes into My Rules. One place, visible and reversible --
     rather than three hidden stores the reader would have to go hunting in. */
  const actions = document.createElement('div');
  actions.className = 'log-actions';
  const domain = e.host || '';
  const mk = (label, rule, title) => {
    if (!rule) return;
    const b = document.createElement('button');
    b.className = 'btn'; b.type = 'button'; b.textContent = label; b.title = title || '';
    b.addEventListener('click', (ev) => { ev.stopPropagation(); addRule(rule, b); });
    actions.appendChild(b);
  };
  mk('Block this domain', domain && '||' + domain + '^', 'Adds ||' + domain + '^ to My rules');
  mk('Allow this domain', domain && '@@||' + domain + '^', 'Adds @@||' + domain + '^ to My rules');
  let pathRule = '';
  try {
    const u = new URL(e.url);
    if (u.pathname && u.pathname !== '/') pathRule = '||' + u.hostname.replace(/^www\./, '') + u.pathname;
  } catch (_) {}
  mk('Block this path', pathRule, 'Adds ' + pathRule + ' to My rules');

  const copy = document.createElement('button');
  copy.className = 'btn'; copy.type = 'button'; copy.textContent = 'Copy URL';
  copy.addEventListener('click', async (ev) => {
    ev.stopPropagation();
    try { await navigator.clipboard.writeText(e.url); copy.textContent = 'Copied'; }
    catch (_) { copy.textContent = 'Could not copy'; }
    setTimeout(() => { copy.textContent = 'Copy URL'; }, 1400);
  });
  actions.appendChild(copy);

  const status = document.createElement('div');
  status.className = 'log-note';
  status.style.marginTop = '8px';
  status.id = 'rule-status';
  td.appendChild(actions);
  td.appendChild(status);
  tr.appendChild(td);
  return tr;
}

function addRule(rule, button) {
  const status = $('rule-status');
  button.disabled = true;
  chrome.runtime.sendMessage({ kind: 'user-rules-get' }, (res) => {
    void chrome.runtime.lastError;
    const text = (res && res.ok && res.text) || '';
    if (text.split(/\r?\n/).some((l) => l.trim() === rule)) {
      if (status) status.textContent = 'That rule is already in My rules.';
      button.disabled = false;
      return;
    }
    const next = text.replace(/\s*$/, '') + (text.trim() ? '\n' : '') + rule + '\n';
    chrome.runtime.sendMessage({ kind: 'user-rules-set', text: next }, (r) => {
      void chrome.runtime.lastError;
      button.disabled = false;
      if (!r || !r.ok) { if (status) status.textContent = 'Could not save: ' + ((r && r.error) || 'unknown error'); return; }
      if (status) status.textContent = 'Added ' + rule + ' to My rules. Reload the page for it to take effect.';
    });
  });
}

/* ---- controls ---- */
$('action-filters').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-action]');
  if (!b) return;
  actionFilter = b.dataset.action;
  [...$('action-filters').children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
  render();
});
$('type-filters').addEventListener('click', (ev) => {
  const b = ev.target.closest('[data-type]');
  if (!b) return;
  typeFilter = b.dataset.type;
  [...$('type-filters').children].forEach((c) => c.setAttribute('aria-pressed', String(c === b)));
  render();
});
$('search').addEventListener('input', (ev) => { query = ev.target.value.trim().toLowerCase(); scheduleRender(); });
$('pause').addEventListener('click', () => {
  paused = !paused;
  $('pause').textContent = paused ? 'Resume' : 'Pause';
  $('capture-state').textContent = paused
    ? 'Paused. Requests are still being captured, just not shown.'
    : 'Recording. Capture stops when you close this tab.';
});
$('clear').addEventListener('click', () => {
  ENTRIES = []; BY_ID.clear(); openId = null;
  try { port.postMessage({ kind: 'clear' }); } catch (_) {}
  render();
});
$('export').addEventListener('click', () => {
  /* The one moment anything reaches disk, and only because it was asked for.
     Already-redacted values are what get written. */
  const rows = ENTRIES.filter(matches).map((e) => ({
    at: new Date(e.at).toISOString(), action: e.action, method: e.method, type: e.type,
    party: e.party, page: e.page, url: e.url, rule: e.rule || '', source: e.source || '',
  }));
  const blob = new Blob([JSON.stringify(rows, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'wardenone-network-log.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
});

render();

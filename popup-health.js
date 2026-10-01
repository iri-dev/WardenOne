/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
function fmtAgo(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + ' min ago';
  if (s < 86400) return Math.floor(s / 3600) + ' h ago';
  return Math.floor(s / 86400) + ' d ago';
}
// Use compact time labels in the narrow health tiles; prose keeps fmtAgo.
function fmtAgoShort(ts) {
  if (!ts) return 'never';
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}
function fmtCount(n) {
  return Number(n || 0).toLocaleString();
}
function healthNote(text, severity) {
  const row = document.createElement('div');
  row.className = 'health-note' + (severity === 'danger' ? ' is-danger' : severity === 'warn' ? ' is-warn' : '');
  const dot = document.createElement('span');
  dot.className = 'health-note-dot';
  dot.setAttribute('aria-hidden', 'true');
  const body = document.createElement('span');
  body.textContent = text;
  row.appendChild(dot);
  row.appendChild(body);
  return row;
}
/* Preserve the extension note's open state across health redraws. */
let healthExtensionDropOpen = false;
function healthExtensionDrop(item) {
  const severity = String(item.severity || 'warn');
  const alerts = Array.isArray(item.alerts) ? item.alerts : [];
  const drop = document.createElement('details');
  drop.className = 'health-note health-drop' + (severity === 'danger' ? ' is-danger' : ' is-warn');
  drop.open = healthExtensionDropOpen;
  drop.addEventListener('toggle', () => { healthExtensionDropOpen = drop.open; });
  const head = document.createElement('summary');
  head.className = 'health-drop-summary';
  const dot = document.createElement('span');
  dot.className = 'health-note-dot';
  dot.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.className = 'health-drop-text';
  text.textContent = String(item.text || '');
  const chev = document.createElement('span');
  chev.className = 'health-drop-chev';
  chev.setAttribute('aria-hidden', 'true');
  head.appendChild(dot);
  head.appendChild(text);
  head.appendChild(chev);
  drop.appendChild(head);
  const body = document.createElement('div');
  body.className = 'health-drop-body';
  alerts.forEach((a) => {
    const level = String(a.severity || 'medium');
    const card = document.createElement('div');
    card.className = 'health-drop-card' + (level === 'high' || level === 'critical' ? ' is-danger' : '');
    const top = document.createElement('div');
    top.className = 'health-drop-top';
    const name = document.createElement('span');
    name.className = 'health-drop-name';
    name.textContent = String(a.name || '(unknown extension)') + (a.enabled === false ? ' (disabled)' : '');
    name.title = String(a.name || '');
    const badge = document.createElement('span');
    badge.className = 'health-drop-badge';
    badge.textContent = level.replace(/^./, (c) => c.toUpperCase()) + (a.when ? ' · ' + fmtAlertAge(a.when) : '');
    top.appendChild(name);
    top.appendChild(badge);
    card.appendChild(top);
    const summary = document.createElement('div');
    summary.className = 'health-drop-line';
    summary.textContent = String(a.summary || 'Extension changed');
    card.appendChild(summary);
    if (a.fromVersion && a.toVersion && a.fromVersion !== a.toVersion) {
      const version = document.createElement('div');
      version.className = 'health-drop-line is-soft';
      version.textContent = 'Version ' + a.fromVersion + ' → ' + a.toVersion;
      card.appendChild(version);
    }
    (Array.isArray(a.reasons) ? a.reasons : []).forEach((reason) => {
      const why = document.createElement('div');
      why.className = 'health-drop-line is-soft';
      why.textContent = '• ' + reason;
      card.appendChild(why);
    });
    body.appendChild(card);
  });
  const more = Number(item.total || 0) - alerts.length;
  if (more > 0) {
    const rest = document.createElement('div');
    rest.className = 'health-drop-line is-soft';
    rest.textContent = '+ ' + more + ' more in the Security Centre.';
    body.appendChild(rest);
  }
  const actions = document.createElement('div');
  actions.className = 'health-drop-actions';
  const ack = document.createElement('button');
  ack.type = 'button';
  ack.className = 'btn';
  ack.textContent = Number(item.total || alerts.length) > 1 ? 'Mark all reviewed' : 'Mark reviewed';
  ack.addEventListener('click', () => {
    ack.disabled = true;
    ack.textContent = 'Saving…';
    chrome.runtime.sendMessage({ kind: 'ack-extension-alerts' }, (res) => {
      void chrome.runtime.lastError;
      if (!res || !res.ok) {
        ack.disabled = false;
        ack.textContent = 'Couldn\'t save. Try again';
        return;
      }
      healthExtensionDropOpen = false;
      renderProtectionHealth();
      if (typeof loadExtensionAlerts === 'function') loadExtensionAlerts();
    });
  });
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn';
  open.textContent = 'Open Security Centre';
  open.addEventListener('click', openExtensionSecurityCentre);
  actions.appendChild(ack);
  actions.appendChild(open);
  body.appendChild(actions);
  drop.appendChild(body);
  return drop;
}
function renderProtectionHealth() {
  const panel = $('protection-health-panel');
  if (!panel) return;
  const title = $('health-status-title');
  const detail = $('health-status-detail');
  const chip = $('health-status-chip');
  const active = $('health-active-count');
  const blocked = $('health-blocked-count');
  const lists = $('health-list-updated');
  const issues = $('health-issues');
  const tabLine = $('health-tab-line');
  const setLevel = (level) => {
    panel.classList.toggle('is-warning', level === 'warning');
    panel.classList.toggle('is-danger', level === 'danger');
  };
  // Ask the worker about this tab's engine, not just its configured switches.
  const ask = (tabId) => chrome.runtime.sendMessage({ kind: 'protection-health', tabId }, (res) => {
    const err = chrome.runtime.lastError && chrome.runtime.lastError.message;
    if (err || !res || !res.ok) {
      setLevel('warning');
      if (title) title.textContent = 'Protection status unavailable';
      if (detail) detail.textContent = 'Could not check right now. Reopen the popup or use Verify & Repair.';
      if (chip) chip.textContent = 'Retry';
      if (active) active.textContent = '-';
      if (blocked) blocked.textContent = '-';
      if (lists) lists.textContent = '-';
      if (tabLine) tabLine.textContent = '';
      if (issues) { issues.textContent = ''; issues.classList.add('is-visible'); issues.appendChild(healthNote('Could not read local protection health: ' + (err || 'unknown error'), 'danger')); }
      return;
    }
    const level = res.level === 'danger' ? 'danger' : res.level === 'warning' ? 'warning' : 'ok';
    const items = Array.isArray(res.needsAttention) ? res.needsAttention : [];
    setLevel(level);
    if (title) title.textContent = res.status || 'Protections on';
    if (detail) detail.textContent = res.detail || 'Protection status is not confirmed yet.';
    if (chip) chip.textContent = level === 'danger' ? 'Review' : level === 'warning' ? 'Check' : (items.length ? 'Notes' : 'Open');
    if (active) {
      active.textContent = fmtCount(res.configuredShields || 0) + '/' + fmtCount(res.totalShields || 0);
      active.title = 'Switched on in settings. This page\'s result is shown below.';
    }
    if (tabLine) {
      const tab = res.tab || {};
      const state = String(tab.state || 'unknown');
      tabLine.textContent = String(tab.text || '');
      tabLine.className = 'health-tab' + (state === 'failed' ? ' is-warn' : state === 'verified' ? ' is-ok' : '');
    }
    if (blocked) blocked.textContent = fmtCount(res.blocked24h || 0);
    if (lists) {
      const list = res.list || {};
      lists.textContent = list.updated ? fmtAgoShort(list.updated) : 'Built-in';
      const enforced = Number(list.active || 0) || Number(list.total || 0);
      const publisher = list.publisher || {};
      lists.title = (enforced ? ('Blocking ' + fmtCount(enforced) + ' domains' + (list.auxTotal ? ' plus ' + fmtCount(list.auxTotal) + ' page-list entries' : '')) : 'Built-in rules active')
        + '. Last fetched by WardenOne; publisher dates: ' + Number(publisher.dated || 0) + ' known, '
        + Number(publisher.stale || 0) + ' over 30 days old, ' + Number(publisher.unknown || 0) + ' unknown.';
    }
    if (issues) {
      issues.textContent = '';
      issues.classList.toggle('is-visible', items.length > 0);
      items.forEach((item) => {
        const severity = item && item.severity ? String(item.severity) : 'info';
        const text = item && item.text ? item.text : String(item || '');
        if (item && item.kind === 'extension-alerts' && Array.isArray(item.alerts) && item.alerts.length) {
          issues.appendChild(healthExtensionDrop(item));
          return;
        }
        issues.appendChild(healthNote(text, severity));
      });
    }
  });
  try {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      void chrome.runtime.lastError;
      const tab = tabs && tabs[0];
      ask(tab && typeof tab.id === 'number' ? tab.id : -1);
    });
  } catch (_) { ask(-1); }
}
function listMetaCount(meta) {
  return Number((meta && (meta.totalCount || meta.count)) || 0);
}
function listMetaActiveCount(meta) {
  return Number((meta && (meta.activeCount || meta.activeRuleCount)) || 0);
}
function renderListPublishers(...groups) {
  const details = $('list-publisher-details');
  const summary = $('list-publisher-summary');
  const rows = $('list-publisher-rows');
  if (!details || !summary || !rows) return { recent: 0, stale: 0, unknown: 0 };
  const byUrl = new Map();
  for (const group of groups) {
    for (const entry of (Array.isArray(group) ? group : [])) {
      if (!entry || !entry.url) continue;
      const prior = byUrl.get(entry.url);
      if (!prior || Number(entry.fetchedAt || 0) >= Number(prior.fetchedAt || 0)) byUrl.set(entry.url, entry);
    }
  }
  const entries = Array.from(byUrl.values());
  details.hidden = !entries.length;
  const staleAfter = 30 * 24 * 60 * 60 * 1000;
  const isStale = (entry) => Number(entry.publishedAt || 0) > 0 && Date.now() - Number(entry.publishedAt) > staleAfter;
  const counts = {
    recent: entries.filter((entry) => Number(entry.publishedAt || 0) > 0 && !isStale(entry)).length,
    stale: entries.filter(isStale).length,
    unknown: entries.filter((entry) => !Number(entry.publishedAt || 0)).length,
  };
  summary.textContent = 'Publisher dates · ' + counts.recent + ' recent · ' + counts.stale + ' old · ' + counts.unknown + ' unknown';
  rows.textContent = '';
  entries.sort((a, b) => Number(isStale(b)) - Number(isStale(a))
    || Number(!b.publishedAt) - Number(!a.publishedAt)
    || String(a.url).localeCompare(String(b.url)));
  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'list-publisher-row';
    const name = document.createElement('div');
    name.className = 'list-publisher-name';
    let sourceName = String(entry.url);
    try { const url = new URL(sourceName); sourceName = url.hostname + url.pathname; } catch (_) {}
    name.textContent = entry.label ? entry.label + ' · ' + sourceName : sourceName;
    name.title = String(entry.url);
    const date = document.createElement('div');
    date.className = 'list-publisher-date' + (isStale(entry) ? ' is-stale' : !entry.publishedAt ? ' is-unknown' : '');
    const publishedAt = Number(entry.publishedAt) || 0;
    date.textContent = publishedAt
      ? 'Publisher: ' + new Date(publishedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) + ' (' + fmtAgo(publishedAt) + ')'
      : 'publisher date unknown';
    if (publishedAt) date.title = new Date(publishedAt).toISOString();
    const fetched = document.createElement('div');
    fetched.className = 'list-publisher-fetch';
    fetched.textContent = (entry.fetchedAt ? 'WardenOne fetched ' + fmtAgo(entry.fetchedAt) : 'WardenOne has not fetched this feed')
      + (entry.fetchFailed ? ' · latest fetch failed' : '');
    row.append(name, date, fetched);
    rows.appendChild(row);
  }
  return counts;
}
function renderListMeta() {
  chrome.storage.local.get(['wardenone_list_meta', 'wardenone_aux_list_meta', 'wardenone_adshield_cosmetic_publishers'], (x) => {
    const meta = x && x.wardenone_list_meta;
    const auxMeta = x && x.wardenone_aux_list_meta;
    const statusEl = $('list-status');
    const updEl = $('list-updated');
    const count = listMetaCount(meta);
    const activeCount = listMetaActiveCount(meta);
    if (count) {
      // Show enforced domains first, with the larger known total as context.
      if (activeCount && activeCount < count) {
        statusEl.textContent = 'Blocking ' + fmtCount(activeCount) + ' domains';
      } else {
        statusEl.textContent = 'Blocking ' + fmtCount(count) + ' domains';
      }
      let line = 'Fetched ' + fmtAgo(meta.updated);
      if (activeCount && activeCount < count) line += ' - ' + fmtCount(count) + ' known in feeds';
      // Surface partial feed coverage.
      const s = meta.sources;
      if (s && typeof s.total === 'number') {
        line += ' - ' + s.succeeded + '/' + s.total + ' feeds';
        if (s.failed > 0) line += ' (' + s.failed + ' unreachable)';
      }
      /* Name failed feeds and their reasons so the reader can fix the source. */
      const failedList = (s && Array.isArray(s.failures)) ? s.failures : [];
      const failEl = $('list-failures');
      if (failEl) {
        failEl.textContent = '';
        failEl.hidden = failedList.length === 0;
        for (const f of failedList) {
          const row = document.createElement('div');
          row.className = 'list-failure';
          let host = String(f.url || '');
          try { host = new URL(host).hostname + new URL(host).pathname; } catch (_) { /* keep the raw string */ }
          const name = document.createElement('span');
          name.className = 'list-failure-url';
          name.textContent = host.length > 58 ? host.slice(0, 58) + '…' : host;
          const why = document.createElement('span');
          why.className = 'list-failure-why';
          why.textContent = f.error || 'failed';
          row.append(name, why);
          failEl.appendChild(row);
        }
      }
      renderListPublishers(meta.publisherSources, auxMeta && auxMeta.publisherSources, x && x.wardenone_adshield_cosmetic_publishers);
      const age = meta.updated ? Date.now() - Number(meta.updated) : 0;
      if (age > 7 * 24 * 60 * 60 * 1000) {
        line += ' - stale';
        updEl.style.color = 'var(--wo-danger)';
      } else if (age > 72 * 60 * 60 * 1000) {
        line += ' - getting stale';
        updEl.style.color = 'var(--wo-warning)';
      } else {
        updEl.style.color = '';
      }
      const activeAdShield = Number(meta.activeDomainRuleCounts && meta.activeDomainRuleCounts.adshield);
      if (activeAdShield) line += ' - AdShield ' + fmtCount(activeAdShield);
      const auxCounts = (auxMeta && auxMeta.counts) || {};
      const auxTotal = Number(auxCounts.adultDomainsExtra || 0) + Number(auxCounts.grabberDomainsExtra || 0) + Number(auxCounts.trustedPaymentHostsExtra || 0);
      if (auxTotal) line += ' - page lists +' + fmtCount(auxTotal);
      updEl.textContent = line;
    } else {
      statusEl.textContent = 'Blocking ' + fmtCount(162) + ' domains (built-in)';
      updEl.textContent = 'Auto-update runs daily - tap to fetch more';
      updEl.style.color = '';
      renderListPublishers(auxMeta && auxMeta.publisherSources, x && x.wardenone_adshield_cosmetic_publishers);
    }
  });
}

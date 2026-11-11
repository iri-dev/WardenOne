/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
(() => {
  const id = new URL(location.href).searchParams.get('id');
  const get = name => document.getElementById(name);
  let report = null, sourceTabId = null, timer = null, stopped = false, previous = '';
  function fail(message) {
    report = null; get('copy').disabled = true;
    get('summary').dataset.state = 'partial'; get('verdict').textContent = 'The check could not finish';
    get('scope').textContent = message;
    get('checks').textContent = 'No completed result is available. Start a new check from the original page.';
    get('retry').disabled = true;
  }
  function findings(parent, rows) {
    parent.replaceChildren();
    for (const item of (Array.isArray(rows) ? rows : []).slice(0, 24)) {
      const row = document.createElement('div'); row.className = 'finding';
      row.dataset.level = ['danger', 'caution', 'info', 'unavailable', 'pending'].includes(item.level) ? item.level : 'info';
      const title = document.createElement('h3'); title.textContent = String(item.title || '').slice(0, 160);
      if (item.cached) { const tag = document.createElement('span'); tag.className = 'tag'; tag.textContent = 'Cached'; title.appendChild(tag); }
      const detail = document.createElement('p'); detail.className = 'detail'; detail.textContent = String(item.detail || '').slice(0, 1000);
      row.append(title, detail); parent.appendChild(row);
    }
  }
  function render(value) {
    report = value.report; sourceTabId = value.sourceTabId;
    get('summary').dataset.state = report.state; get('verdict').textContent = report.summary;
    get('scope').textContent = report.note;
    const addresses = get('addresses'); addresses.replaceChildren();
    for (const [name, text] of [['Destination', report.target], ['Page where you clicked', report.page],
      ['Page title', report.pageTitle], ['Embedded frame', report.frame && report.frame !== report.page ? report.frame : '']]) {
      if (!text) continue;
      const term = document.createElement('dt'); term.textContent = name;
      const description = document.createElement('dd');
      const content = document.createElement(name === 'Page title' ? 'span' : 'code'); content.textContent = text;
      description.appendChild(content); addresses.append(term, description);
    }
    get('relation').textContent = report.relation;
    findings(get('facts'), report.facts); findings(get('checks'), report.checks);
    get('back').hidden = !Number.isInteger(sourceTabId);
    get('retry').disabled = report.checking === true || report.state === 'checking' || !report.target;
    get('copy').disabled = false;
    document.title = (report.host ? report.host + ' — ' : '') + 'Link check — WardenOne';
  }
  async function update(retry = false) {
    if (stopped) return;
    clearTimeout(timer);
    try {
      const message = retry ? { kind: 'manual-link-check-retry', id } : { kind: 'manual-link-check-read', id };
      const value = await chrome.runtime.sendMessage(message);
      if (stopped) return;
      if (!value?.ok || !value.report || typeof value.report.summary !== 'string') { fail(value?.error || 'WardenOne did not return a result. Please start the check again.'); return; }
      const serialized = JSON.stringify(value);
      if (serialized !== previous) { previous = serialized; render(value); }
      if (value.report.checking === true || value.report.state === 'checking') timer = setTimeout(update, 350);
    } catch (_) { if (!stopped) fail('WardenOne disconnected or restarted. Please run Check this link again from the original page.'); }
  }
  get('retry').addEventListener('click', () => { get('retry').disabled = true; void update(true); });
  get('back').addEventListener('click', async () => {
    try { await chrome.tabs.update(sourceTabId, { active: true }); }
    catch (_) { get('status').textContent = 'The source tab is no longer available. This report still describes the address you checked.'; }
  });
  get('copy').addEventListener('click', async () => {
    if (!report) return;
    const text = [report.summary, 'Destination: ' + report.target, 'Source page: ' + report.page, report.relation,
      ...report.facts.concat(report.checks).map(item => item.title + ': ' + item.detail), report.note].join('\n');
    try { await navigator.clipboard.writeText(text); get('status').textContent = 'Results copied.'; }
    catch (_) { get('status').textContent = 'The clipboard was unavailable. You can select and copy the result text.'; }
  });
  addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
  if (!/^[a-f0-9-]{36}$/.test(id || '')) fail('Open this view using Check this link in WardenOne’s right-click menu.');
  else void update();
})();

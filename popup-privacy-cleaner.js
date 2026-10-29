/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

(() => {
  const el = id => document.getElementById(id);
  const fields = { cache: 'cl-cache', cacheStorage: 'cl-cache-storage', consentCookies: 'cl-consent', cookies: 'cl-cookies',
    history: 'cl-history', downloads: 'cl-downloads', storage: 'cl-storage', fileSystems: 'cl-files',
    serviceWorkers: 'cl-sw', formData: 'cl-form', sitePermissions: 'cl-perms', securityHistory: 'cl-security',
    trackerLearning: 'cl-learning', scriptDrift: 'cl-drift' };
  let config, definitions, siteOrigin = '', automaticTypes, preparedPreview = null;
  function closePreview() {
    preparedPreview = null; el('cl-preview').hidden = true; el('cl-choices').hidden = false;
  }
  document.querySelectorAll('#privacy-cleaner .cleaner-info').forEach(button => button.addEventListener('click', () => {
    const open = button.getAttribute('aria-expanded') !== 'true';
    document.querySelectorAll('#privacy-cleaner .cleaner-info').forEach(item => {
      const expanded = item === button && open;
      item.setAttribute('aria-expanded', String(expanded)); el(item.getAttribute('aria-controls')).hidden = !expanded;
    });
  }));
  const message = value => new Promise((resolve, reject) => chrome.runtime.sendMessage(value, result => {
    const error = chrome.runtime.lastError;
    if (error || !result || (!result.ok && !result.completed)) reject(Error(error ? error.message : result && result.error || 'WardenOne did not respond.'));
    else resolve(result);
  }));
  const status = (text, failed = false) => {
    el('cl-result').textContent = text; el('cl-result').style.display = 'block';
    el('cl-result').style.color = failed ? 'var(--wo-popup-soft-danger)' : 'var(--ink-soft)';
  };
  const selected = () => Object.fromEntries(Object.entries(fields).map(([key, id]) => [key, el(id).checked]));
  function applyTypes(value) {
    for (const [key, id] of Object.entries(fields)) el(id).checked = value[key] === true && !el(id).disabled;
    selectionText();
  }
  const labels = value => Object.keys(value).filter(key => value[key]).map(key => definitions[key].label).join(', ') || 'Nothing selected';
  const range = () => el('cl-since').selectedOptions[0].textContent;
  function summary(preview) {
    return preview.labels.join(', ') + '\n\nScope: ' + (preview.origin || 'All websites') + '\nTime range: ' + range()
      + '\nProtected origins: ' + (preview.protectedOrigins.join(', ') || 'None')
      + (preview.warnings.length ? '\n\n' + preview.warnings.join('\n\n') : '')
      + '\n\nChrome reports category completion, not exact item counts or freed space.';
  }
  function history(items) {
    el('cl-summary-history').textContent = items.length + (items.length === 1 ? ' run' : ' runs');
    const list = el('cl-history-list'); list.replaceChildren();
    if (!items.length) { list.textContent = 'No cleanups recorded in the last 30 days.'; return; }
    for (const item of items) {
      const row = document.createElement('details'); row.className = 'cleaner-history-item';
      const heading = document.createElement('summary');
      const title = document.createElement('span');
      title.textContent = (item.ok ? 'Completed' : 'Incomplete') + ' · ' + item.source;
      title.className = item.ok ? 'cleaner-history-success' : 'cleaner-history-failure';
      const date = document.createElement('span'); date.className = 'cleaner-history-date';
      date.textContent = new Date(item.at).toLocaleString();
      heading.append(title, date); row.appendChild(heading);
      const detail = document.createElement('p'); detail.className = 'cleaner-help';
      detail.textContent = (item.completed.length ? 'Completed: ' + item.completed.join(', ') + '.' : '')
        + (item.failed.length ? '\nFailed or unverified: ' + item.failed.join(', ') + '.' : '');
      row.appendChild(detail);
      list.appendChild(row);
    }
  }
  function selectionText() {
    const common = ['cache', 'cookies', 'history', 'storage'];
    const count = Object.keys(fields).filter(key => !common.includes(key) && el(fields[key]).checked).length;
    el('cl-advanced-count').textContent = count ? count + ' selected' : '';
    el('cl-summary-now').textContent = Object.values(selected()).filter(Boolean).length + ' selected';
    el('cl-preserved-note').textContent = el('cl-scope').value === 'site'
      ? 'Single-site cleanup; protected sites stay excluded.' : 'Protected sites are preserved where supported.';
  }
  function scopeChanged() {
    const site = el('cl-scope').value === 'site';
    for (const [key, id] of Object.entries(fields)) {
      el(id).disabled = site && !definitions[key].site;
      if (el(id).disabled) el(id).checked = false;
    }
    el('cl-scope-note').textContent = site ? (siteOrigin ? 'Only ' + siteOrigin + '. Cookie removal can affect sibling subdomains.' : 'Open an HTTP or HTTPS website first.')
      : 'Protected website origins are excluded from supported data. History, form data and WardenOne records are global.';
    el('cl-mode').value = 'custom';
    selectionText();
  }
  function presetOptions() {
    for (const option of [...el('cl-mode').options]) if (option.value.startsWith('saved:')) option.remove();
    config.presets.forEach((preset, index) => {
      const option = document.createElement('option'); option.value = 'saved:' + index; option.textContent = preset.name;
      el('cl-mode').appendChild(option);
    });
  }
  function scheduleText() {
    if (!definitions || !automaticTypes) return;
    const keys = Object.keys(automaticTypes).filter(key => automaticTypes[key]);
    const full = labels(automaticTypes);
    el('cl-auto-count').textContent = keys.length + ' selected';
    el('cl-auto-categories').textContent = keys.length ? keys.slice(0, 2).map(key => definitions[key].label).join(', ')
      + (keys.length > 2 ? ' +' + (keys.length - 2) + ' more' : '') : 'Nothing selected';
    el('cl-auto-categories').title = full;
    document.querySelectorAll('#cl-auto-options-list input').forEach(input => { input.checked = automaticTypes[input.dataset.category] === true; });
    const destructive = keys.some(key => key !== 'cache');
    el('cl-auto-warning').hidden = !destructive || (!el('cl-auto-enabled').checked && !el('cl-auto-startup').checked);
    el('cl-auto-warning').textContent = 'Selected data will be erased automatically. Cookies or website data can sign you out; review the categories before saving.';
  }
  function automaticChoices() {
    const list = el('cl-auto-options-list'); list.replaceChildren();
    for (const [key, id] of Object.entries(fields)) {
      const label = document.createElement('label'); label.className = 'ck cleaner-check';
      const input = document.createElement('input'); input.type = 'checkbox'; input.dataset.category = key;
      input.addEventListener('change', () => { automaticTypes[key] = input.checked; scheduleText(); });
      const text = document.createElement('span'); text.textContent = el(id).closest('label').textContent.trim();
      label.append(input, text); list.appendChild(label);
    }
  }
  function presetTypes(mode) {
    return mode === 'quick' ? { cache: true } : mode === 'balanced' ? { cache: true, history: true, downloads: true }
      : Object.fromEntries(Object.keys(fields).filter(key => definitions[key].browser).map(key => [key, true]));
  }
  function currentPreset() {
    const matches = value => Object.keys(fields).every(key => (value[key] === true) === el(fields[key]).checked);
    const saved = config.presets.findIndex(item => item.sinceMs === Number(el('cl-since').value) && matches(item.types));
    el('cl-mode').value = saved >= 0 ? 'saved:' + saved : ['quick', 'balanced', 'deep'].find(mode => matches(presetTypes(mode))) || 'custom';
  }
  function savedSummaries() {
    el('cl-summary-protected').textContent = config.protectedOrigins.length + ' saved';
    el('cl-summary-auto').textContent = config.automatic.enabled
      ? config.automatic.frequency[0].toUpperCase() + config.automatic.frequency.slice(1)
      : config.automatic.onStartup ? 'Startup' : 'Off';
  }
  async function refresh() {
    const response = await message({ kind: 'privacy-cleaner-get' });
    config = response.config; definitions = response.definitions;
    automaticTypes = { ...config.automatic.types };
    applyTypes(config.manualTypes); el('cl-since').value = String(config.sinceMs);
    el('cl-protected').value = config.protectedOrigins.join('\n');
    el('cl-auto-enabled').checked = config.automatic.enabled;
    el('cl-auto-frequency').value = config.automatic.frequency;
    el('cl-auto-startup').checked = config.automatic.onStartup;
    el('cl-auto-notify').checked = config.automatic.notify;
    el('cl-auto-range').value = String(config.automatic.sinceMs);
    el('cl-next-run').textContent = response.nextRun ? 'Next cleanup due: ' + new Date(response.nextRun).toLocaleString() : 'Scheduled cleaning is off.';
    history(response.history); presetOptions(); currentPreset(); automaticChoices(); scheduleText(); savedSummaries();
    el('cl-run').disabled = false;
  }
  el('cl-scope').addEventListener('change', () => { if (definitions) scopeChanged(); });
  el('cl-open-permissions').addEventListener('click', () => { chrome.tabs.create({ url: 'chrome://settings/content' }); });
  for (const id of Object.values(fields)) el(id).addEventListener('change', () => { el('cl-mode').value = 'custom'; selectionText(); });
  for (const id of ['cl-auto-enabled', 'cl-auto-startup']) el(id).addEventListener('change', scheduleText);
  el('cl-mode').addEventListener('change', () => {
    const mode = el('cl-mode').value;
    if (mode === 'custom') return;
    const saved = mode.startsWith('saved:') && config.presets[Number(mode.slice(6))];
    if (saved) { applyTypes(saved.types); el('cl-since').value = String(saved.sinceMs); return; }
    applyTypes(presetTypes(mode));
  });
  el('cl-save-preset').addEventListener('click', async () => {
    try {
      const name = el('cl-preset-name').value.trim();
      if (!name) throw Error('Give the preset a name.');
      const presets = config.presets.filter(item => item.name !== name);
      presets.push({ name, types: selected(), sinceMs: Number(el('cl-since').value) });
      const result = await message({ kind: 'privacy-cleaner-save', settings: { ...config, presets } });
      config = result.config; presetOptions(); currentPreset(); status('Preset saved. Automatic cleaning keeps its own selection.');
    } catch (error) { status(error.message, true); }
  });
  el('cl-delete-preset').addEventListener('click', async () => {
    try {
      const value = el('cl-mode').value;
      if (!value.startsWith('saved:')) throw Error('Select a saved preset first.');
      const result = await message({ kind: 'privacy-cleaner-save', settings: { ...config, presets: config.presets.filter((_, i) => i !== Number(value.slice(6))) } });
      config = result.config; presetOptions(); el('cl-mode').value = 'custom'; status('Preset removed.');
    } catch (error) { status(error.message, true); }
  });
  el('cl-protect-current').addEventListener('click', () => {
    if (!siteOrigin) { status('Open an HTTP or HTTPS website first.', true); return; }
    el('cl-protected').value = [...new Set([...el('cl-protected').value.split(/\r?\n/).filter(Boolean), siteOrigin])].join('\n');
  });
  el('cl-save-protected').addEventListener('click', async () => {
    try {
      const protectedOrigins = el('cl-protected').value.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
      const result = await message({ kind: 'privacy-cleaner-save', settings: { ...config, protectedOrigins } });
      config = result.config; savedSummaries(); el('cl-protected').value = config.protectedOrigins.join('\n'); status('Protected websites saved.');
    } catch (error) { status(error.message, true); }
  });
  el('cl-auto-use-selection').addEventListener('click', () => { automaticTypes = selected(); scheduleText(); });
  el('cl-save-auto').addEventListener('click', async () => {
    try {
      const automatic = { enabled: el('cl-auto-enabled').checked, frequency: el('cl-auto-frequency').value,
        onStartup: el('cl-auto-startup').checked, notify: el('cl-auto-notify').checked, types: automaticTypes, sinceMs: Number(el('cl-auto-range').value) };
      if (automatic.enabled || automatic.onStartup) {
        const preview = await message({ kind: 'clean-browser-preview', request: { types: automatic.types, sinceMs: automatic.sinceMs, scope: 'all' } });
        const details = preview.labels.join(', ') + '\nTime range: ' + el('cl-auto-range').selectedOptions[0].textContent
          + '\n' + (automatic.enabled ? automatic.frequency + ' cleanup. ' : '') + (automatic.onStartup ? 'Also clean on browser startup. ' : '')
          + '\nProtected origins: ' + (preview.protectedOrigins.join(', ') || 'None') + '\n\n' + preview.warnings.join('\n\n');
        if (!confirm('Enable automatic privacy cleaning?\n\n' + details + '\n\nThese deletions cannot be undone.')) return;
      }
      const result = await message({ kind: 'privacy-cleaner-save', settings: { ...config, automatic } });
      config = result.config;
      savedSummaries();
      el('cl-next-run').textContent = result.nextRun ? 'Next cleanup due: ' + new Date(result.nextRun).toLocaleString() : 'Scheduled cleaning is off.';
      status('Automatic cleaning settings saved.');
    } catch (error) { status(error.message, true); }
  });
  function showPreview(preview) {
    preparedPreview = preview;
    const panel = el('cl-preview'); panel.replaceChildren();
    const title = document.createElement('div'); title.className = 'name'; title.textContent = 'Review cleanup';
    panel.appendChild(title);
    for (const [label, value] of [['Remove', preview.labels.join(', ')], ['Scope', preview.origin || 'All websites'], ['Time range', range()]]) {
      const line = document.createElement('p'); line.className = 'cleaner-review-line';
      const name = document.createElement('strong'); name.textContent = label + ': ';
      line.append(name, document.createTextNode(value)); panel.appendChild(line);
    }
    for (const warning of preview.warnings) {
      const line = document.createElement('p'); line.className = 'cleaner-warning'; line.textContent = warning; panel.appendChild(line);
    }
    const protectedSites = document.createElement('details'); protectedSites.className = 'cleaner-disclosure';
    const heading = document.createElement('summary'); heading.textContent = 'Protected websites (' + preview.protectedOrigins.length + ')';
    const sites = document.createElement('p'); sites.className = 'cleaner-help'; sites.textContent = preview.protectedOrigins.join(', ') || 'None saved.';
    protectedSites.append(heading, sites); panel.appendChild(protectedSites);
    const note = document.createElement('p'); note.className = 'desc cleaner-selection';
    note.textContent = 'Deletion cannot be undone. Exact item counts and freed space are unavailable.'; panel.appendChild(note);
    const actions = document.createElement('div'); actions.className = 'cleaner-actions';
    const back = document.createElement('button'); back.type = 'button'; back.className = 'btn cleaner-small'; back.id = 'cl-cancel-preview'; back.textContent = 'Back';
    back.addEventListener('click', () => { closePreview(); el('cl-run').focus(); });
    const clean = document.createElement('button'); clean.type = 'button'; clean.className = 'btn soft-danger cleaner-small'; clean.id = 'cl-confirm-clean'; clean.textContent = 'Clean selected';
    clean.addEventListener('click', confirmCleanup);
    actions.append(back, clean); panel.appendChild(actions);
    el('cl-choices').hidden = true; panel.hidden = false; panel.focus({ preventScroll: true });
  }
  async function confirmCleanup() {
    const preview = preparedPreview;
    if (!preview || !confirm('Review cleanup\n\n' + summary(preview) + '\n\nClean selected? This cannot be undone.')) return;
    const button = el('cl-confirm-clean'); button.disabled = true; button.textContent = 'Cleaning…';
    try {
      const result = await message({ kind: 'clean-browser', previewId: preview.previewId });
      const parts = [];
      if (result.completed.length) parts.push('Completed: ' + result.completed.join(', ') + '.');
      if (result.failed.length) parts.push('Failed or unverified: ' + result.failed.join(', ') + '.');
      if (result.consent) parts.push('Verified cookie removals: ' + result.consent.removed + '; cookies retained: ' + result.consent.kept + '.');
      parts.push(result.protectedCount + ' protected origin(s) excluded from supported data.');
      closePreview(); status(parts.join(' '), !result.ok);
      history((await message({ kind: 'privacy-cleaner-get' })).history);
    } catch (error) { closePreview(); status(error.message, true); }
  }
  el('cl-run').addEventListener('click', async () => {
    const button = el('cl-run'); button.disabled = true;
    try {
      const choices = selected(), sinceMs = Number(el('cl-since').value);
      const saved = await message({ kind: 'privacy-cleaner-save', settings: { ...config, manualTypes: choices, sinceMs } });
      config = saved.config;
      const preview = await message({ kind: 'clean-browser-preview', request: { types: choices, sinceMs, scope: el('cl-scope').value, origin: siteOrigin } });
      el('cl-result').style.display = 'none'; showPreview(preview);
    } catch (error) { status(error.message, true); }
    finally { button.disabled = false; button.textContent = 'Preview cleaning'; }
  });
  el('cl-clear-history').addEventListener('click', async () => {
    try { await message({ kind: 'privacy-cleaner-clear-history' }); history([]); }
    catch (error) { status(error.message, true); }
  });
  chrome.tabs.query({ active: true, lastFocusedWindow: true }, tabs => {
    void chrome.runtime.lastError;
    try { const url = new URL(tabs[0].url); if (/^https?:$/.test(url.protocol)) siteOrigin = url.origin; } catch (_) {}
    el('cl-site-option').textContent = siteOrigin ? 'Current website' : 'Current website (unavailable)';
  });
  refresh().catch(error => { status(error.message, true); });
})();

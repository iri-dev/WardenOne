/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';

var WO_CLEANER = (() => {
  const SETTINGS_KEY = 'wardenone_cleaner_settings';
  const STATE_KEY = 'wardenone_cleaner_state';
  const ALARM = 'wardenone-privacy-cleaning';
  const ranges = [0, 3600000, 86400000, 604800000, 2592000000];
  const definitions = {
    cache: { label: 'Browser cache', browser: ['cache'], site: true },
    cacheStorage: { label: 'Website caches (offline resources)', browser: ['cacheStorage'], site: true, risk: true },
    consentCookies: { label: 'Recognized consent and tracking cookies', site: true, risk: true },
    cookies: { label: 'All cookies and sign-ins', browser: ['cookies'], site: true, risk: true },
    history: { label: 'Browsing history', browser: ['history'] },
    downloads: { label: 'Download records', browser: ['downloads'] },
    storage: { label: 'Local storage and IndexedDB', browser: ['localStorage', 'indexedDB'], site: true, risk: true },
    fileSystems: { label: 'Website file system data', browser: ['fileSystems'], site: true, risk: true },
    serviceWorkers: { label: 'Service workers', browser: ['serviceWorkers'], site: true, risk: true },
    formData: { label: 'Saved form data', browser: ['formData'], risk: true },
    sitePermissions: { label: 'WardenOne permission rules' },
    securityHistory: { label: 'WardenOne activity and notifications' },
    trackerLearning: { label: 'Tracker learning observations' },
    scriptDrift: { label: 'Script Drift baselines' },
  };
  const loadedAt = Date.now();
  let queue = Promise.resolve(), busy = false, paused = false, recoveredThisLoad = false;
  const previews = new Map();
  const serial = task => {
    const result = queue.then(task);
    queue = result.catch(() => {});
    return result;
  };
  const available = () => {
    if (INCOGNITO_CONTEXT) throw Error('Use Privacy Cleaner in a normal browser window.');
    if (paused || (typeof __privacyEraseInProgress !== 'undefined' && __privacyEraseInProgress)) throw Error('WardenOne data reset is running.');
  };
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  function keys(value, allowed) {
    if (!object(value) || Object.keys(value).some(key => !allowed.includes(key))) throw Error('Invalid cleaner settings.');
  }
  function types(value) {
    keys(value, Object.keys(definitions));
    if (Object.values(value).some(flag => typeof flag !== 'boolean')) throw Error('Cleaner choices must be on or off.');
    return Object.fromEntries(Object.keys(definitions).map(key => [key, value[key] === true]));
  }
  function origin(value) {
    if (typeof value !== 'string' || value.length > 2048) throw Error('Enter an HTTP or HTTPS website.');
    let url;
    try { url = new URL(value); } catch (_) { throw Error('Enter a complete website address, such as https://example.com.'); }
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      throw Error('Use a website origin without a path, password, query or fragment.');
    }
    return url.origin;
  }
  function settings(raw) {
    if (raw === undefined) return { version: 1, revision: 'initial', protectedOrigins: [], presets: [], manualTypes: types({ cache: true }), sinceMs: 0,
      automatic: { enabled: false, frequency: 'daily', onStartup: false, notify: false, types: types({ cache: true }), sinceMs: 0 } };
    keys(raw, ['version', 'revision', 'protectedOrigins', 'presets', 'manualTypes', 'sinceMs', 'automatic']);
    if (raw.version !== 1 || typeof raw.revision !== 'string' || raw.revision.length > 40 || !Array.isArray(raw.protectedOrigins) || raw.protectedOrigins.length > 100 || !ranges.includes(raw.sinceMs)) throw Error('Invalid cleaner settings.');
    keys(raw.automatic, ['enabled', 'frequency', 'onStartup', 'notify', 'types', 'sinceMs']);
    const a = raw.automatic;
    if (![a.enabled, a.onStartup, a.notify].every(v => typeof v === 'boolean') || !['daily', 'weekly', 'monthly'].includes(a.frequency) || !ranges.includes(a.sinceMs)) throw Error('Invalid automatic cleaning settings.');
    const automaticTypes = types(a.types);
    if ((a.enabled || a.onStartup) && !Object.values(automaticTypes).some(Boolean)) throw Error('Choose data for automatic cleaning.');
    if (!Array.isArray(raw.presets) || raw.presets.length > 8) throw Error('Keep at most eight custom presets.');
    const presets = raw.presets.map(item => {
      keys(item, ['name', 'types', 'sinceMs']);
      if (typeof item.name !== 'string' || !item.name.trim() || item.name.length > 40 || !ranges.includes(item.sinceMs)) throw Error('Use a preset name of 1–40 characters and a valid time range.');
      return { name: item.name.trim(), types: types(item.types), sinceMs: item.sinceMs };
    });
    if (new Set(presets.map(item => item.name)).size !== presets.length) throw Error('Preset names must be unique.');
    return { version: 1, revision: raw.revision, protectedOrigins: [...new Set(raw.protectedOrigins.map(origin))], presets, manualTypes: types(raw.manualTypes), sinceMs: raw.sinceMs,
      automatic: { enabled: a.enabled, frequency: a.frequency, onStartup: a.onStartup, notify: a.notify, types: automaticTypes, sinceMs: a.sinceMs } };
  }
  async function read() {
    const stored = await chrome.storage.local.get(SETTINGS_KEY);
    return settings(stored[SETTINGS_KEY]);
  }
  async function state() {
    const stored = await chrome.storage.local.get(STATE_KEY);
    const raw = stored[STATE_KEY];
    if (raw === undefined) return { nextRun: 0, history: [], pending: null };
    if (!object(raw) || !Number.isFinite(raw.nextRun) || raw.nextRun < 0 || !Array.isArray(raw.history) || raw.history.length > 20) throw Error('Cleaner schedule state is invalid. Save the schedule again to reset it.');
    const stamp = item => object(item) && Number.isFinite(item.at) && item.at > 0 && item.at <= Date.now()
      && ['manual', 'scheduled', 'startup'].includes(item.source) && ['all', 'site'].includes(item.scope);
    const labels = items => Array.isArray(items) && items.length <= 15 && items.every(item => typeof item === 'string' && item.length <= 160);
    if (raw.history.some(item => !stamp(item) || typeof item.ok !== 'boolean' || !labels(item.completed) || !labels(item.failed))
      || (raw.pending && !stamp(raw.pending))) throw Error('Cleaner results are invalid. Save the schedule again to reset them.');
    const history = raw.history.filter(item => item.at > Date.now() - 30 * 86400000).map(item => ({
      at: item.at, source: item.source, scope: item.scope, ok: item.ok,
      completed: item.completed, failed: item.failed,
    }));
    return { nextRun: raw.nextRun, history, pending: raw.pending ? { at: raw.pending.at, source: raw.pending.source, scope: raw.pending.scope } : null };
  }
  function nextDate(now, frequency) {
    const date = new Date(now);
    if (frequency === 'monthly') {
      const day = date.getUTCDate();
      date.setUTCDate(1); date.setUTCMonth(date.getUTCMonth() + 1);
      const last = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0)).getUTCDate();
      date.setUTCDate(Math.min(day, last));
      return date.getTime();
    }
    return now + (frequency === 'weekly' ? 7 : 1) * 86400000;
  }
  async function alarm(config, current) {
    if (!config.automatic.enabled) { await chrome.alarms.clear(ALARM); return; }
    const existing = await chrome.alarms.get(ALARM);
    if (!existing || existing.scheduledTime !== current.nextRun) await chrome.alarms.create(ALARM, { when: Math.max(Date.now() + 1000, current.nextRun) });
  }
  async function get() {
    available();
    const config = await read(), current = await state();
    return { ok: true, config, history: current.history, nextRun: config.automatic.enabled ? current.nextRun : 0, definitions };
  }
  function save(raw) {
    return serial(async () => {
      available();
      const config = settings(raw);
      const old = await read().catch(() => null);
      if (old && old.revision !== config.revision) throw Error('Cleaner settings changed in another window. Reopen the popup before saving.');
      config.revision = crypto.randomUUID();
      const current = await state().catch(() => ({ nextRun: 0, history: [], pending: null }));
      if (!old || JSON.stringify(old.automatic) !== JSON.stringify(config.automatic) || !current.nextRun) {
        current.nextRun = config.automatic.enabled ? nextDate(Date.now(), config.automatic.frequency) : 0;
      }
      await chrome.storage.local.set({ [SETTINGS_KEY]: config, [STATE_KEY]: current });
      previews.clear();
      await alarm(config, current);
      return get();
    });
  }
  async function plan(request, config) {
    keys(request, ['types', 'sinceMs', 'scope', 'origin']);
    const selected = types(request.types);
    if (!Object.values(selected).some(Boolean) || !ranges.includes(request.sinceMs) || !['all', 'site'].includes(request.scope)) throw Error('Choose valid data, scope and time range.');
    const target = request.scope === 'site' ? origin(request.origin) : '';
    if (target) {
      if (!await activeTabMatchesOrigin(target)) throw Error('Open the selected website first.');
      if (Object.keys(selected).some(key => selected[key] && !definitions[key].site)) throw Error('This category can only be cleaned across the browser.');
      const targetHost = new URL(target).hostname;
      if (config.protectedOrigins.some(site => site === target || (selected.cookies && regDomainBg(new URL(site).hostname) === regDomainBg(targetHost)))) throw Error('This website is protected. Remove its protection before cleaning it.');
    }
    const warnings = [];
    if (selected.cookies) warnings.push('Cookie deletion may sign you out. Site cookie deletion affects the whole registered domain, including sibling subdomains.');
    if (selected.consentCookies && !selected.cookies) warnings.push('Cookie names identify known consent and tracking cookies only. Sign-ins cannot be guaranteed; consent banners may return. This sweep covers all cookie ages.');
    if (['storage', 'cacheStorage', 'fileSystems', 'serviceWorkers'].some(key => selected[key])) warnings.push('Website data or offline resources may be lost; websites may need to reload or sign in again.');
    const global = Object.keys(selected).filter(key => selected[key] && !definitions[key].site);
    if (global.length) warnings.push('Protected websites cannot be excluded from: ' + global.map(key => definitions[key].label).join(', ') + '.');
    if (selected.sitePermissions) warnings.push('Only WardenOne-created permission rules are removed. Browser-granted permissions remain in Chrome site settings.');
    if (selected.downloads) warnings.push('Download records are removed; downloaded files stay on disk.');
    if (selected.securityHistory || selected.trackerLearning || selected.scriptDrift || selected.sitePermissions) warnings.push('WardenOne records and permission rules are cleared for all time. Approved tracker blocks and firewall choices stay.');
    return { types: selected, sinceMs: request.sinceMs, scope: request.scope, origin: target, warnings,
      labels: Object.keys(selected).filter(key => selected[key]).map(key => definitions[key].label), protectedOrigins: config.protectedOrigins };
  }
  async function preview(request) {
    available();
    const config = await read(), prepared = await plan(request, config);
    for (const [key, item] of previews) if (item.until < Date.now()) previews.delete(key);
    if (previews.size >= 8) previews.delete(previews.keys().next().value);
    const id = crypto.randomUUID();
    previews.set(id, { request, config: JSON.stringify(config), until: Date.now() + 5 * 60000 });
    return { ok: true, previewId: id, ...prepared };
  }
  async function perform(prepared, source, current) {
    const report = { at: Date.now(), source, scope: prepared.scope, sinceMs: prepared.sinceMs,
      completed: [], failed: [], protectedCount: prepared.protectedOrigins.length, consent: null };
    current.pending = { at: report.at, source, scope: prepared.scope };
    // Persist before deletion: a terminated worker must report uncertainty instead of replaying a wipe.
    await chrome.storage.local.set({ [STATE_KEY]: current });
    const operation = async (label, action) => {
      try { available(); await action(); report.completed.push(label); }
      catch (_) { report.failed.push(label); }
    };
    for (const [key, definition] of Object.entries(definitions)) {
      if (!prepared.types[key] || (key === 'consentCookies' && prepared.types.cookies)) continue;
      await operation(definition.label, async () => {
        if (definition.browser) {
          const options = { since: prepared.sinceMs ? Date.now() - prepared.sinceMs : 0 };
          if (definition.site) {
            if (prepared.origin) options.origins = [prepared.origin];
            else if (prepared.protectedOrigins.length) options.excludeOrigins = prepared.protectedOrigins;
          }
          await chrome.browsingData.remove(options, Object.fromEntries(definition.browser.map(type => [type, true])));
        } else if (key === 'consentCookies') {
          report.consent = await cleanConsentAndTrackingCookies({ origin: prepared.origin, protectedOrigins: prepared.protectedOrigins });
          if (report.consent.failed) throw Error('Some cookies could not be removed.');
        } else if (key === 'sitePermissions') {
          const result = await resetSensitiveSitePermissionsGlobally();
          if (result.failed.length || !result.reset.length) throw Error('Permission rules could not all be cleared.');
        } else if (key === 'securityHistory') {
          const result = await clearProtectionHistory(false);
          if (!result.ok) throw Error(result.error);
        } else if (key === 'trackerLearning') await clearTrackerLearnerObservations();
        else if (key === 'scriptDrift') await clearScriptDriftBaselines();
      });
    }
    report.ok = report.failed.length === 0;
    available();
    current.pending = null;
    current.history = [report, ...current.history].slice(0, 20);
    try { await chrome.storage.local.set({ [STATE_KEY]: current }); }
    catch (_) { report.ok = false; report.failed.push('Saving cleanup history'); }
    return report;
  }
  function run(id) {
    if (busy) return Promise.reject(Error('A cleanup is already running.'));
    busy = true;
    return serial(async () => {
      available();
      const saved = previews.get(id); previews.delete(id);
      if (!saved || saved.until < Date.now()) throw Error('Preview expired. Review the cleanup again.');
      const config = await read();
      if (saved.config !== JSON.stringify(config)) throw Error('Cleaner settings changed. Review the cleanup again.');
      return perform(await plan(saved.request, config), 'manual', await state());
    }).finally(() => { busy = false; });
  }
  function wake(startup = false) {
    return serial(async () => {
      if (INCOGNITO_CONTEXT || paused) return;
      available();
      const config = await read(), current = await state();
      let changed = false;
      if (current.pending) {
        current.history.unshift({ ...current.pending, ok: false, completed: [], failed: ['Cleanup interrupted; some data may already have been removed.'] });
        current.history = current.history.slice(0, 20); current.pending = null; changed = true; recoveredThisLoad = true;
      }
      const due = config.automatic.enabled && current.nextRun > 0 && current.nextRun <= Date.now();
      if (config.automatic.enabled && (!current.nextRun || due)) { current.nextRun = nextDate(Date.now(), config.automatic.frequency); changed = true; }
      if (changed) await chrome.storage.local.set({ [STATE_KEY]: current });
      await alarm(config, current);
      const cleanedSinceLoad = current.history.some(item => item.source !== 'manual' && item.at >= loadedAt);
      if (!due && !(startup && config.automatic.onStartup && !cleanedSinceLoad && !recoveredThisLoad)) return;
      busy = true;
      try {
        const result = await perform(await plan({ types: config.automatic.types, sinceMs: config.automatic.sinceMs, scope: 'all' }, config), startup ? 'startup' : 'scheduled', current);
        if (config.automatic.notify) await showWardenSystemNotification('wo-privacy-cleaning', {}, 'privacy_cleaning').catch(() => {});
        return result;
      } finally { busy = false; }
    });
  }
  chrome.alarms.onAlarm.addListener(event => {
    if (event.name === ALARM) void wake().catch(() => {});
  });
  chrome.runtime.onStartup.addListener(() => { void wake(true).catch(() => {}); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[SETTINGS_KEY] && !changes[SETTINGS_KEY].newValue) {
      previews.clear(); void chrome.alarms.clear(ALARM);
    }
  });
  // Check overdue work after cold starts too; alarms may disappear across browser updates.
  void Promise.resolve().then(() => wake()).catch(() => {});
  return { get, save, preview, run, wake, settings, plan, nextDate,
    clearHistory: () => serial(async () => {
      available(); const current = await state(); current.history = [];
      await chrome.storage.local.set({ [STATE_KEY]: current }); return { ok: true };
    }),
    pauseAndDrain: () => { paused = true; previews.clear(); return queue; }, resume: () => { paused = false; } };
})();

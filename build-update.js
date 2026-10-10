/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const WO_BUILD_UPDATE = (() => {
  const RELEASE_API = 'https://api.github.com/repos/iri-dev/WardenOne/releases/latest';
  const RELEASE_PAGE = 'https://github.com/iri-dev/WardenOne/releases/latest';
  const CACHE_KEY = 'wardenone_build_update_v1';
  const SUCCESS_AGE_MS = 6 * 60 * 60 * 1000;
  const FAILURE_AGE_MS = 10 * 60 * 1000;
  const TIMEOUT_MS = 8000;
  const SHA = /^[0-9a-f]{40}$/;
  const STATES = new Set(['current', 'update', 'ahead', 'different', 'unknown']);
  let pending = null;
  let aboutRequest = 0;

  function installedCommit() {
    const commit = typeof woSourceCommit === 'function' ? woSourceCommit() : '';
    return SHA.test(commit) ? commit : '';
  }

  function buildProfile() {
    return typeof WARDENONE_BUILD === 'object' && WARDENONE_BUILD
      ? WARDENONE_BUILD.profile : '';
  }

  async function fetchJson(url, limit) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
        redirect: 'error', headers: { Accept: 'application/vnd.github+json' },
        signal: controller.signal,
      });
      const length = Number(response.headers.get('content-length') || 0);
      if (!response.ok || response.url !== url || length > limit) throw new Error('release check unavailable');
      let body = '';
      if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let bytes = 0;
        try {
          while (true) {
            const part = await reader.read();
            if (part.done) break;
            bytes += part.value.byteLength;
            if (bytes > limit) throw new Error('release response too large');
            body += decoder.decode(part.value, { stream: true });
          }
          body += decoder.decode();
        } finally { reader.releaseLock(); }
      } else {
        body = await response.text();
        if (body.length > limit) throw new Error('release response too large');
      }
      return JSON.parse(body);
    } finally { clearTimeout(timeout); }
  }

  function releaseCommit(data) {
    if (!data || data.draft !== false || data.prerelease !== false
      || typeof data.tag_name !== 'string' || !/^build-[0-9a-f]{40}$/.test(data.tag_name)) {
      throw new Error('unrecognised release');
    }
    const commit = data.tag_name.slice(6);
    if (data.target_commitish !== commit || !Number.isFinite(Date.parse(data.published_at))) {
      throw new Error('release identity does not match');
    }
    const assets = Array.isArray(data.assets) ? data.assets : [];
    for (const name of ['WardenOne-latest.zip', 'WardenOne-latest.zip.sha256']) {
      if (!assets.some((asset) => asset && asset.name === name
        && asset.state === 'uploaded' && Number.isSafeInteger(asset.size) && asset.size > 0)) {
        throw new Error('release is incomplete');
      }
    }
    return commit;
  }

  function compareCommits(data, installed, latest) {
    if (!data || data.base_commit?.sha !== installed
      || !Number.isSafeInteger(data.ahead_by) || !Number.isSafeInteger(data.behind_by)
      || data.ahead_by < 0 || data.behind_by < 0) return 'unknown';
    if (data.status === 'ahead' && data.ahead_by > 0 && data.behind_by === 0
      && data.merge_base_commit?.sha === installed) return 'update';
    if (data.status === 'behind' && data.behind_by > 0 && data.ahead_by === 0
      && data.merge_base_commit?.sha === latest) return 'ahead';
    if (data.status === 'diverged' && data.ahead_by > 0 && data.behind_by > 0) return 'different';
    return 'unknown';
  }

  function cachedResult(value, installed, now) {
    if (!value || value.installed !== installed || !STATES.has(value.state)
      || !Number.isSafeInteger(value.at) || value.at > now || value.at < 0
      || (value.latest && !SHA.test(value.latest))) return null;
    const age = value.state === 'unknown' ? FAILURE_AGE_MS : SUCCESS_AGE_MS;
    if (now - value.at >= age || (value.state !== 'unknown' && !value.latest)) return null;
    return { state: value.state, installed, latest: value.latest || '' };
  }

  async function checkNetwork(installed) {
    let result = { state: 'unknown', installed, latest: '' };
    try {
      const latest = releaseCommit(await fetchJson(RELEASE_API, 120000));
      result = { state: 'unknown', installed, latest };
      if (latest === installed) result.state = 'current';
      else {
        const url = 'https://api.github.com/repos/iri-dev/WardenOne/compare/'
          + installed + '...' + latest + '?per_page=1';
        result.state = compareCommits(await fetchJson(url, 750000), installed, latest);
      }
    } catch (_) {}
    try {
      await chrome.storage?.session?.set({ [CACHE_KEY]: { ...result, at: Date.now() } });
    } catch (_) {}
    return result;
  }

  async function check(force = false) {
    if (buildProfile() !== 'full') return { state: 'store', installed: '', latest: '' };
    const installed = installedCommit();
    if (!installed) return { state: 'local', installed: '', latest: '' };
    if (pending) return pending;
    pending = (async () => {
      if (!force) {
        try {
          const stored = (await chrome.storage?.session?.get(CACHE_KEY))?.[CACHE_KEY];
          const cached = cachedResult(stored, installed, Date.now());
          if (cached) return cached;
        } catch (_) {}
      }
      return checkNetwork(installed);
    })();
    try { return await pending; } finally { pending = null; }
  }

  function wording(result) {
    const ids = result.installed && result.latest
      ? 'Installed ' + result.installed.slice(0, 7) + ' · Latest ' + result.latest.slice(0, 7) + '.' : '';
    switch (result.state) {
      case 'update': return { title: 'WardenOne update available', detail: ids + ' Install the latest official build to receive its fixes.' };
      case 'current': return { title: 'WardenOne build is current', detail: ids + ' This matches the latest published GitHub build checked.' };
      case 'ahead': return { title: 'This build is ahead of the public release', detail: ids + ' Keep this local build if you are testing new work.' };
      case 'different': return { title: 'Build order cannot be determined', detail: ids + ' This copy and the official release have different histories.' };
      case 'store': return { title: 'Browser-managed build', detail: 'This package is not the GitHub ZIP. Check for updates through your browser.' };
      case 'local': return { title: 'Local source copy', detail: 'This copy has no packaged build ID, so WardenOne cannot compare it with GitHub releases.' };
      default: return { title: 'Could not check WardenOne updates', detail: 'The official release or build comparison was unavailable. Try again later.' };
    }
  }

  async function renderPopup() {
    const banner = document.getElementById('wo-build-update');
    if (!banner) return;
    document.getElementById('wo-build-update-open').onclick = () => {
      chrome.tabs.create({ url: chrome.runtime.getURL('settings.html#page=about') });
    };
    const result = await check();
    banner.hidden = result.state !== 'update';
    if (result.state === 'update') {
      document.getElementById('wo-build-update-detail').textContent = wording(result).detail;
    }
  }

  async function renderAbout(force = false) {
    const status = document.getElementById('wo-build-status');
    const detail = document.getElementById('wo-build-detail');
    const refresh = document.getElementById('wo-build-check');
    if (!status || !detail || !refresh) return;
    const request = ++aboutRequest;
    status.textContent = 'Checking the official WardenOne release…';
    detail.textContent = '';
    refresh.disabled = true;
    refresh.onclick = () => { void renderAbout(true); };
    const result = await check(force);
    if (request !== aboutRequest || !status.isConnected) return;
    const copy = wording(result);
    status.textContent = copy.title;
    status.dataset.state = result.state;
    detail.textContent = copy.detail;
    refresh.disabled = result.state === 'local' || result.state === 'store';
  }

  return Object.freeze({ check, renderPopup, renderAbout, wording, releaseCommit, compareCommits,
    get releasePage() { return RELEASE_PAGE; } });
})();

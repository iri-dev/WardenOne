/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

/* Load only in ISOLATED: page prototypes must not capture controls that change protection settings. */
var WardenBadgeControls = typeof window === 'object' && window !== window.top ? null : Object.freeze({
  create({ document, registry, send, site, onActivity = () => {}, reloadPage = () => document.location.reload() }) {
    const records = new Map(), paused = new Set(), pending = new Set(), globalOff = new Set(), resumable = new Set();
    const beaconStates = new Map();
    let masterOff = false;
    let pauseConfigKey = null;
    let host = null, root = null, status = '', needsReload = false, snapshot = null;
    let loading = false, unavailable = false, reconnect = false, fetchedAt = 0;
    let beaconReadFailed = false;
    let beaconLoading = false, beaconVersion = 0, beaconMutating = 0;
    let theme = 'light';
    const observationTitles = { detected_beacon: 'Third-party beacon', detected_thirdparty_tracker: 'Third-party tracker request' };
    const palettes = {
      light: '--wo-surface:#fffafd;--wo-surface-alt:#f4ebfb;--wo-text:#33223f;--wo-text-soft:#5f476f;--wo-line:#ddcce9;--wo-brand-text:#6f2f8a;--wo-control-hover:#d9c3e9;--wo-focus:#8b43ad;--wo-violet:#783593;--wo-on-brand:#ffffff;--wo-success:#17633a;--wo-shadow-soft:0 6px 24px rgba(72,38,96,.13);',
      dark: '--wo-surface:#25162f;--wo-surface-alt:#2c1a37;--wo-text:#fbf6fe;--wo-text-soft:#dcc9e5;--wo-line:#51325f;--wo-brand-text:#e1b0f3;--wo-control-hover:#513362;--wo-focus:#dda7f2;--wo-violet:#7a3996;--wo-on-brand:#ffffff;--wo-success:#93e1b0;--wo-shadow-soft:0 8px 28px rgba(0,0,0,.3);',
    };
    function themeSheet() {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':host{' + palettes[theme] + '}.panel{color-scheme:' + theme + '}');
      return sheet;
    }
    function setTheme(value) {
      if (value !== 'light' && value !== 'dark') return false;
      theme = value;
      if (root) root.adoptedStyleSheets = [root.adoptedStyleSheets[0], themeSheet()];
      return true;
    }

    function element(tag, className, text) {
      const node = document.createElement(tag);
      if (className) node.className = className;
      if (text !== undefined && text !== '') node.textContent = String(text);
      return node;
    }
    function icon(node, kind) {
      const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '1.8');
      svg.setAttribute('stroke-linecap', 'round'); svg.setAttribute('stroke-linejoin', 'round');
      svg.setAttribute('aria-hidden', 'true');
      path.setAttribute('d', kind === 'review' ? 'M4 7h16M4 17h16M8 4v6M16 14v6'
        : kind === 'shield' ? 'M12 3 5 6v6c0 4 3 7 7 9 4-2 7-5 7-9V6l-7-3Zm-3 9 2 2 4-4'
          : kind === 'close' ? 'm6 6 12 12M18 6 6 18'
            : kind === 'locked' ? 'M8 10V7a4 4 0 0 1 8 0v3M6 10h12v11H6V10Zm6 4v3'
              : 'M8 10V7a4 4 0 0 1 7.5-2M6 10h12v11H6V10Zm6 4v3');
      svg.appendChild(path); node.appendChild(svg);
    }
    function button(label, callback, className) {
      const node = element('button', className);
      node.type = 'button'; node.title = label; node.setAttribute('aria-label', label);
      node.addEventListener('click', event => {
        if (!event.isTrusted || node.disabled) return;
        event.preventDefault(); event.stopPropagation(); callback();
      });
      return node;
    }
    function close() { if (host) host.remove(); host = null; root = null; }
    function request(message, callback, onSlow) {
      let finished = false;
      const finish = result => { if (!finished) { finished = true; clearTimeout(timer); clearTimeout(slowTimer); callback(result); } };
      const slowTimer = onSlow ? setTimeout(() => { if (!finished) onSlow(); }, 8000) : null;
      const timer = setTimeout(() => finish(onSlow ? { ok: false, error: 'The browser has not confirmed this change. Reopen the badge to check its saved state.' } : { ok: false }), onSlow ? 60000 : 8000);
      try { send(message, finish); } catch (_) { finish({ ok: false, reloadRequired: true }); }
    }
    function failedAction(result, fallback) {
      if (result?.reloadRequired === true) {
        reconnect = true; needsReload = true;
        return 'Refresh this page to reconnect WardenOne.';
      }
      return typeof result?.error === 'string' && result.error.length <= 200 ? result.error : fallback;
    }
    function observationHost(value) {
      if (typeof value !== 'string' || value.length > 253) return '';
      const host = value.toLowerCase();
      return /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(host) ? host : '';
    }
    function record(type, count, kind, destinations) {
      if (typeof type !== 'string' || !/^[a-z][a-z0-9_]{0,95}$/.test(type)) return;
      if (!records.has(type) && records.size >= 128) return;
      const previous = records.get(type);
      const hosts = new Set(previous?.destinations || []);
      if (Object.hasOwn(observationTitles, type) && Array.isArray(destinations)) for (const value of destinations.slice(0, 5)) {
        const host = observationHost(value); if (host && hosts.size < 5) hosts.add(host);
      }
      records.set(type, { count: Math.min(999999, Math.max(previous?.count || 0, count)),
        destinations: [...hosts],
        kind: kind || previous?.kind || (/^(blocked_|cleaned_|stripped_|purged_)|_blocked$|^(youtube_ads_removed|consent_rejected|google_search_cleanup)$/.test(type) ? 'action' : 'noticed') });
    }
    function adoptBeaconStates(values) {
      if (!Array.isArray(values)) return;
      beaconStates.clear();
      for (const value of values.slice(0, 250)) {
        const host = observationHost(value?.host);
        if (!host || typeof value.blocked !== 'boolean') continue;
        beaconStates.set(host, { blocked: value.blocked, saved: value.saved === true,
          recommendation: ['keep', 'block'].includes(value.recommendation) ? value.recommendation : 'unknown',
          reason: typeof value.reason === 'string' && value.reason.length <= 160 ? value.reason : 'No recommendation: tracking is not confirmed.' });
      }
      if (beaconStates.size) record('detected_beacon', 0, 'noticed');
    }
    function refreshBeaconState() {
      if (beaconLoading || beaconMutating || reconnect) return;
      beaconLoading = true;
      const version = beaconVersion, destinations = (records.get('detected_beacon')?.destinations || []).slice(0, 5);
      request({ kind: 'badge-beacon-state', destinations }, result => {
        beaconLoading = false;
        if (version !== beaconVersion) { if (root) refreshBeaconState(); return; }
        if (result?.ok === true && Array.isArray(result.beacons)) {
          adoptBeaconStates(result.beacons); beaconReadFailed = false;
        } else {
          beaconReadFailed = true; needsReload = true;
          status = failedAction(result, 'Saved beacon rules could not be read. Reload to retry.');
        }
        render();
      });
    }
    function setBeacon(host) {
      const state = beaconStates.get(host);
      if (!state) { refreshBeaconState(); return; }
      if (pending.has(host) || reconnect || masterOff && !state.blocked) return;
      pending.add(host); beaconVersion++; beaconMutating++; status = 'Applying beacon rule…'; render();
      request({ kind: 'badge-beacon-set', destination: host, blocked: !state.blocked }, result => {
        pending.delete(host); beaconVersion++; beaconMutating--;
        if (result?.ok === true && result.host === host && typeof result.blocked === 'boolean') {
          adoptBeaconStates(result.beacons);
          beaconStates.set(host, { ...state, saved: true, blocked: result.blocked });
          fetchedAt = 0;
          status = result.blocked ? 'Beacon block saved for this site. Future requests will be blocked.' : 'Beacon block removed. Other protections still apply.';
        } else status = failedAction(result, 'Could not save this beacon rule. Try again.');
        render();
      }, () => { status = 'Your browser is still applying the beacon rule. You can keep browsing.'; render(); });
    }
    function update(value) {
      if (!value || value.ok !== true || !value.current || !Number.isFinite(value.current.total)
          || value.current.total < 0 || value.current.total > 1000000000) return false;
      snapshot = value; fetchedAt = Date.now(); unavailable = false; reconnect = false;
      for (const entry of (value.events || []).slice(0, 128)) record(entry.type, Number(entry.count) || 0, entry.kind, entry.destinations);
      onActivity(value);
      render();
      if (root && (records.get('detected_beacon')?.destinations || []).some(host => !beaconStates.has(host))) {
        beaconVersion++; refreshBeaconState();
      }
      return true;
    }
    function refresh(force = false) {
      if (loading || !force && snapshot && Date.now() - fetchedAt < 15000) return;
      loading = true; render();
      request({ kind: 'badge-activity' }, result => {
        loading = false;
        if (!update(result)) { unavailable = true; reconnect = reconnect || result?.reloadRequired === true; needsReload = needsReload || reconnect; render(); }
      });
    }
    function configure(value) {
      if (!value || typeof value !== 'object' || !registry) return;
      const supported = new Set(registry.eventIds().flatMap(type => registry.pauseKeysFor(type)));
      if (typeof value.global?.enabled === 'boolean') masterOff = value.global.enabled === false;
      for (const key of supported) if (typeof value.global?.[key] === 'boolean') {
        if (value.global[key]) globalOff.delete(key); else globalOff.add(key);
      }
      if (typeof value.global?.scriptletEngine === 'boolean' && /(^|\.)youtube(-nocookie)?\.com$/i.test(site))
        record('youtube_ads_removed', 0, 'action');
      if (Array.isArray(value.paused) && Array.isArray(value.local)) {
        const key = value.paused.filter(key => supported.has(key)).sort().join('|');
        if (pauseConfigKey !== null && pauseConfigKey !== key) {
          status = 'Site protections changed. Reload to apply.'; needsReload = true;
        }
        pauseConfigKey = key;
        paused.clear(); resumable.clear();
        for (const key of value.paused) if (supported.has(key)) paused.add(key);
        for (const key of value.local) if (paused.has(key)) resumable.add(key);
        for (const key of paused) {
          const type = registry.eventsFor(key).find(id => registry.pauseKeysFor(id).includes(key));
          if (type) record(type, 0, 'action');
        }
      }
      render();
    }
    function pause(type, key) {
      if (pending.has(key) || masterOff || globalOff.has(key)) return;
      const resume = paused.has(key);
      if (resume && !resumable.has(key)) return;
      pending.add(key); status = ''; render();
      request(resume ? { kind: 'badge-rule-resume', type } : { kind: 'badge-rule-pause', type }, result => {
        pending.delete(key);
        if (result && result.ok === true && result.key === key) {
          if (resume) { paused.delete(key); resumable.delete(key); }
          else { paused.add(key); resumable.add(key); }
          needsReload = true;
          status = resume ? 'Site exception removed. Reload to restore protection.' : registry.pauseScopeFor(type) === 'page-part'
            ? 'Page checks paused. Network rules can still apply. Reload to apply.' : 'Paused for this site. Reload to apply.';
        } else status = failedAction(result, resume ? 'Could not restore this protection. Open its settings to review it.' : 'Could not pause this protection. Open its settings to review it.');
        render();
      });
    }
    function review(type) {
      request({ kind: 'badge-rule-settings', type }, result => {
        if (!result || result.ok !== true) { status = failedAction(result, 'Could not open settings. Open WardenOne Options and search for ' + type + '.'); render(); }
      });
    }
    function render() {
      if (!root) return;
      root.replaceChildren();
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(':host{all:initial}.panel{font:12px/1.45 system-ui,sans-serif;color:var(--wo-text);background:var(--wo-surface);border:1px solid var(--wo-line);border-radius:13px;box-shadow:var(--wo-shadow-soft);width:min(360px,calc(100vw - 24px));max-height:calc(100vh - 76px);overflow:auto;padding:8px 12px;box-sizing:border-box;pointer-events:auto}.head,.brand,.row,.footer{display:flex;align-items:center;gap:6px}.head,.footer{justify-content:space-between}.head{gap:10px;margin-bottom:4px}.head .summary{margin:0;text-align:right}.head .brand{flex:1;min-width:0;font-size:11px}.head .brand span{overflow-wrap:anywhere}.brand{font-size:12px;font-weight:700}.brand svg{color:var(--wo-brand-text);width:17px;height:17px}.site,.summary,.note,.status{color:var(--wo-text-soft);font-size:10px;margin:4px 0 7px;overflow-wrap:anywhere}.site{margin-top:0}.summary{color:var(--wo-text-soft)}.rules{max-height:206px;overflow:auto}.row{border-top:1px solid var(--wo-line);padding:7px 0}.name{flex:1;min-width:0}.name code{display:block;font-size:10px;color:var(--wo-text-soft);overflow-wrap:anywhere;margin-top:0}.count{color:var(--wo-text-soft);min-width:12px;text-align:right;font-size:10px}button{font:inherit;cursor:pointer;border:1px solid var(--wo-line);border-radius:7px;color:var(--wo-brand-text);background:var(--wo-surface-alt);min-width:26px;min-height:26px;display:inline-flex;align-items:center;justify-content:center;padding:4px}button:disabled{opacity:.55;cursor:default}button:hover:not(:disabled){background:var(--wo-control-hover)}button:focus-visible{outline:3px solid var(--wo-focus);outline-offset:2px}svg{width:14px;height:14px;pointer-events:none}.reload{background:var(--wo-violet);color:var(--wo-on-brand);padding:5px 10px}.status:empty{margin:0}.paused{flex-basis:100%;font-size:9px;color:var(--wo-success);display:block;margin-top:2px}.footer{border-top:1px solid var(--wo-line);padding-top:6px;margin-top:3px}.link{background:transparent;border:0;font-size:10px;padding:2px;min-height:24px}.status{margin-top:7px}.panel{background:linear-gradient(150deg,var(--wo-surface),var(--wo-surface-alt));border-color:var(--wo-line);box-shadow:var(--wo-shadow-soft)}.rule-title{display:block;font-weight:600}.rule-link{display:flex;justify-content:flex-start;align-items:baseline;gap:8px;flex-wrap:wrap;border:0;background:transparent;color:inherit;min-width:0;min-height:0;padding:4px 5px;margin:-4px -5px;text-align:left;align-self:stretch}.rule-link:hover:not(:disabled){background:var(--wo-control-hover)}.rule-link:focus-visible{outline-offset:0}.panel{padding:6px 12px}.head{margin-bottom:2px}.row{padding:5px 0}.note,.status{margin:2px 0 4px}.footer{padding-top:4px;margin-top:2px}.beacon-heading{display:flex;align-items:baseline;gap:7px;flex-wrap:wrap}.beacon-heading code{font-size:9px}.beacon-line{display:flex;align-items:center;gap:6px;margin-top:4px}.beacon-info{flex:1;min-width:0}.beacon-hint{font-size:9px;color:var(--wo-text-soft)}.beacon-btn{font-size:10px;min-height:22px;padding:2px 6px}.panel,.rules{scrollbar-width:thin;scrollbar-color:var(--wo-brand-text) var(--wo-surface-alt)}.rules{max-height:190px;scrollbar-gutter:stable;padding-inline-end:8px}');
      root.adoptedStyleSheets = [sheet, themeSheet()];
      const panel = element('section', 'panel');
      panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', 'WardenOne protection controls');
      const head = element('div', 'head'), brand = element('div', 'brand');
      icon(brand, 'shield'); brand.appendChild(element('span', '', snapshot?.site || site)); head.appendChild(brand);
      const dismiss = button('Close protection controls', close); icon(dismiss, 'close'); panel.appendChild(head);
      const current = snapshot?.current;
      const partial = !!current && !current.networkAvailable;
      const beaconCount = records.get('detected_beacon')?.count || 0;
      if (current || beaconCount) {
        const summary = element('span', 'summary', current?.total ? current.total + (partial ? '+' : '') + ' blocked' : beaconCount ? beaconCount + (beaconCount === 1 ? ' beacon' : ' beacons') : 'Guard active');
        summary.title = current ? 'This page: ' + current.trackers + ' trackers · ' + current.ads + ' ads · ' + current.other + ' other actions. Recorded beacons are not counted as blocks.' : 'Recorded beacon attempts. Network counts update separately.';
        head.appendChild(summary);
      }
      head.appendChild(dismiss);
      if (unavailable && !snapshot) panel.appendChild(element('p', 'note', reconnect ? 'Refresh this page to reconnect WardenOne.' : 'Network counts are unavailable. Page events appear below as they occur.'));
      else if (partial) panel.appendChild(element('p', 'note', 'Recent network counts are unavailable.'));
      const actions = [...records].filter(([type, entry]) => entry.kind !== 'noticed' || registry?.canReview(type) || Object.hasOwn(observationTitles, type));
      if (beaconStates.size && !actions.some(([type]) => type === 'detected_beacon'))
        actions.push(['detected_beacon', { count: 0, kind: 'noticed', destinations: [] }]);
      const rules = element('div', 'rules');
      for (const [type, entry] of actions) {
        const keys = registry ? registry.keysFor(type) : [], pauseKeys = registry ? registry.pauseKeysFor(type) : [];
        const key = pauseKeys.length === 1 ? pauseKeys[0] : '';
        const row = element('div', 'row');
        if (entry.kind === 'noticed' && Object.hasOwn(observationTitles, type)) {
          const name = element('div', 'name');
          const heading = element('div', 'beacon-heading');
          heading.appendChild(element('span', 'rule-title', observationTitles[type])); heading.appendChild(element('code', '', type)); name.appendChild(heading);
          if (type === 'detected_beacon') {
            const destinations = [...new Set([...entry.destinations, ...beaconStates.keys()])];
            for (const host of destinations) {
              const state = beaconStates.get(host), line = element('div', 'beacon-line'), info = element('div', 'beacon-info');
              info.appendChild(element('code', '', host));
              const hint = element('span', 'beacon-hint', state?.blocked ? 'Saved block for this site' : state?.saved ? 'Unblocked · saved' : 'Recorded');
              hint.title = 'Applies to beacon/ping requests only. Other protections still apply.'; info.appendChild(hint);
              const recommendation = element('span', 'beacon-hint', state?.recommendation === 'keep' ? ' · Not recommended' : state?.recommendation === 'block' ? ' · Recommended' : state ? ' · No recommendation' : ' · Not assessed');
              recommendation.title = state?.reason || 'Check saved rules before changing this destination.'; info.appendChild(recommendation);
              const toggle = button((state?.blocked ? 'Unblock' : 'Block') + ' beacons to ' + host + ' on this site', () => setBeacon(host), 'beacon-btn');
              toggle.textContent = state ? state.blocked ? 'Unblock' : 'Block' : 'Check';
              toggle.setAttribute('aria-pressed', state?.blocked ? 'true' : 'false');
              toggle.title = (state?.reason || 'Check saved rules.') + ' Beacon/ping requests only; saved for this site.';
              toggle.disabled = pending.has(host) || reconnect || beaconReadFailed || masterOff && !state?.blocked;
              line.appendChild(info); line.appendChild(toggle); name.appendChild(line);
            }
            if (!destinations.length) name.appendChild(element('span', 'note', 'Destination was not retained for this event.'));
          } else {
            name.appendChild(element('p', 'note', entry.destinations.length ? 'To ' + entry.destinations.join(', ') : 'Destination was not retained for this event.'));
            name.appendChild(element('span', 'note', 'Recorded only; this check did not stop the request.'));
          }
          row.appendChild(name);
          if (entry.count) { const count = element('span', 'count', entry.count); count.setAttribute('aria-label', entry.count + ' recorded events'); row.appendChild(count); }
          rules.appendChild(row); continue;
        }
        const title = type === 'youtube_ads_removed' ? 'YouTube ad blocking'
          : keys.length === 1 ? registry.settingLabel(keys[0]) : type.replace(/_/g, ' ').replace(/^./, first => first.toUpperCase());
        const name = registry?.canReview(type) ? button('Open settings for ' + type, () => review(type), 'name rule-link') : element('div', 'name');
        name.appendChild(element('span', 'rule-title', title));
        const code = element('code', '', type); name.appendChild(code);
        if (key && paused.has(key)) name.appendChild(element('span', 'paused', 'Paused for this site'));
        if (key && (masterOff || globalOff.has(key))) name.appendChild(element('span', 'paused', 'Off in WardenOne settings'));
        row.appendChild(name); if (entry.count) row.appendChild(element('span', 'count', entry.count));
        if (key) {
          const off = paused.has(key) || masterOff || globalOff.has(key);
          const label = (off ? 'Restore ' : 'Pause ') + (!off && registry.pauseScopeFor(type) === 'page-part' ? 'page checks for ' : '') + registry.settingLabel(key) + ' on this site';
          const allow = button(label, () => pause(type, key));
          allow.setAttribute('aria-pressed', off ? 'true' : 'false');
          allow.disabled = pending.has(key) || reconnect || masterOff || globalOff.has(key) || off && !resumable.has(key);
          if (off && !resumable.has(key)) allow.title = 'Paused by a wider site exception. Review this rule in settings.';
          icon(allow, off || masterOff || globalOff.has(key) ? 'unlocked' : 'locked');
          row.appendChild(allow);
        }
        if (!key && registry?.canReview(type)) {
          const settings = button('Find ' + type + ' in settings', () => review(type));
          icon(settings, 'review'); row.appendChild(settings);
        }
        rules.appendChild(row);
      }
      panel.appendChild(rules);
      if (!actions.length && current) panel.appendChild(element('p', 'note', current.total
        ? 'See Activity for network rule details.' : partial ? 'No page blocks recorded.' : 'No blocks on this page.'));
      if (!actions.length && !current) panel.appendChild(element('p', 'note', 'Page events appear here as they occur.'));
      const footer = element('div', 'footer');
      const activity = button('Open Activity Centre', () => request({ kind: 'badge-open-activity' }, result => {
        if (!result || result.ok !== true) { needsReload = true; status = failedAction(result, 'Refresh this page to reconnect WardenOne, then open Activity.'); render(); }
      }), 'link'); activity.textContent = 'Activity & history'; activity.disabled = reconnect; footer.appendChild(activity);
      if (records.has('detected_beacon') || beaconStates.size) {
        const manage = button('Manage saved beacon blocks', () => request({ kind: 'badge-beacon-settings' }, result => {
          if (!result?.ok) { status = failedAction(result, 'Could not open saved blocks.'); render(); }
        }), 'link'); manage.textContent = 'Saved blocks'; manage.disabled = reconnect; footer.appendChild(manage);
      }
      const live = element('p', 'status', status); live.setAttribute('role', 'status'); live.setAttribute('aria-live', 'polite'); panel.appendChild(live);
      if (needsReload) {
        const reload = button('Reload page to apply paused protections', () => {
          reload.disabled = true;
          const localReload = () => { try { reloadPage(); } catch (_) { status = 'Reload this page with your browser to apply the change.'; render(); } };
          if (reconnect) { localReload(); return; }
          request({ kind: 'badge-rule-reload' }, result => { if (!result || result.ok !== true) localReload(); });
        }, 'reload'); reload.textContent = 'Reload'; footer.appendChild(reload);
      }
      panel.appendChild(footer);
      panel.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } });
      root.appendChild(panel);
    }
    return Object.freeze({
      observe(type, amount = 1, destination) {
        if (typeof type !== 'string' || !(registry && registry.has(type)) && !/^(?:blocked_|detected_|gated_|warned_)[a-z0-9_]{1,80}$/.test(type)) return;
        const beacon = type === 'detected_beacon' ? observationHost(destination) : '';
        const newBeacon = beacon && !(records.get(type)?.destinations || []).includes(beacon);
        const n = type === 'youtube_ads_removed' ? Math.max(1, Math.min(20, Math.floor(Number(amount) || 1))) : 1;
        record(type, (records.get(type)?.count || 0) + n, undefined, [destination]);
        if (root && (records.get(type)?.kind !== 'noticed' || registry?.canReview(type) || Object.hasOwn(observationTitles, type))) render();
        if (root && newBeacon && records.get(type)?.destinations.includes(beacon)) { beaconVersion++; refreshBeaconState(); }
      },
      update,
      configure,
      setTheme,
      toggle() {
        if (host && host.isConnected) { close(); return false; }
        host = document.createElement('div'); host.id = 'wo-badge-controls';
        host.style.cssText = 'all:initial!important;position:fixed!important;bottom:52px!important;right:16px!important;width:0!important;height:0!important;z-index:2147483647!important;pointer-events:none!important;';
        root = host.attachShadow({ mode: 'closed' });
        host.style.setProperty('width', 'max-content', 'important'); host.style.setProperty('height', 'auto', 'important');
        (document.body || document.documentElement).appendChild(host); render(); refresh(); refreshBeaconState(); return true;
      },
      close,
    });
  },
});

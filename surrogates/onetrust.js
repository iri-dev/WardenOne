/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Answers OneTrust locally until the person opens the site's own preference center. */
(() => {
  const existing = window.OneTrust;
  if (existing && (existing.__wardenOne || typeof existing.IsAlertBoxClosed === 'function')) return;

  const NECESSARY = 'C0001';
  const STANDARD = ['C0001', 'C0002', 'C0003', 'C0004', 'C0005'];
  const YEAR = 365 * 24 * 60 * 60;
  const source = document.currentScript;
  const settingsControl = '#ot-sdk-btn, .ot-sdk-show-settings, .optanon-show-settings';

  function readCookie(name) {
    const hit = String(document.cookie || '').split('; ').find(part => part.startsWith(name + '='));
    return hit === undefined ? null : hit.slice(name.length + 1);
  }
  function parseConsent(raw) {
    const out = {};
    for (const part of String(raw || '').split('&')) {
      const at = part.indexOf('=');
      if (at < 1) continue;
      try { out[part.slice(0, at)] = decodeURIComponent(part.slice(at + 1).replace(/\+/g, ' ')); }
      catch (_) { out[part.slice(0, at)] = part.slice(at + 1); }
    }
    return out;
  }
  function parseGroups(text) {
    return String(text || '').split(',').map(row => row.split(':'))
      .filter(([id, on]) => /^[A-Za-z0-9_-]{1,40}$/.test(id || '') && (on === '0' || on === '1'));
  }
  /* The widest domain the browser accepts a cookie on is the site's own registrable domain: a public suffix is refused. */
  function siteDomain() {
    const parts = location.hostname.split('.');
    for (let i = parts.length - 2; i >= 0; i--) {
      const domain = parts.slice(i).join('.');
      document.cookie = '__wo_ot_probe=1; path=/; domain=.' + domain;
      if (readCookie('__wo_ot_probe') === '1') {
        document.cookie = '__wo_ot_probe=; path=/; domain=.' + domain + '; max-age=0';
        return domain;
      }
    }
    return '';
  }
  function saveConsent(rows) {
    const domain = siteDomain();
    const scope = '; path=/' + (domain ? '; domain=.' + domain : '') + '; max-age=' + YEAR + '; SameSite=Lax'
      + (location.protocol === 'https:' ? '; Secure' : '');
    const gpc = navigator.globalPrivacyControl === true ? '1' : '0';
    const fields = [['isGpcEnabled', gpc], ['datestamp', new Date().toString()], ['isIABGlobal', 'false'], ['hosts', ''],
      ['landingPath', 'NotLandingPage'], ['groups', rows.map(row => row.join(':')).join(',')], ['AwaitingReconsent', 'false'],
      ['interactionCount', '1'], ['isAnonUser', '1'], ['browserGpcFlag', gpc]];
    document.cookie = 'OptanonConsent=' + fields.map(([key, value]) => key + '=' + encodeURIComponent(value)).join('&') + scope;
    document.cookie = 'OptanonAlertBoxClosed=' + new Date().toISOString() + scope;
    return readCookie('OptanonAlertBoxClosed') !== null;
  }

  const stored = parseConsent(readCookie('OptanonConsent'));
  const storedRows = parseGroups(stored.groups);
  const alreadyChosen = readCookie('OptanonAlertBoxClosed') !== null && storedRows.length > 0;
  let rows;
  let refused = false;
  if (alreadyChosen) {
    rows = storedRows;
  } else {
    /* An unanswered cookie from an earlier visit names this site's own groups. When some are on and some off, the ones
       on are always active, and Reject All keeps those too; when all are on, that was implied consent. */
    const mixed = storedRows.some(([, on]) => on === '1') && storedRows.some(([, on]) => on === '0');
    rows = storedRows.length
      ? storedRows.map(([id, on]) => [id, id === NECESSARY || (mixed && on === '1') ? '1' : '0'])
      : STANDARD.map(id => [id, id === NECESSARY ? '1' : '0']);
    refused = saveConsent(rows);
  }

  let active = [];
  let activeText = ',';
  const listeners = [];
  function publish() {
    active = rows.filter(([, on]) => on === '1').map(([id]) => id);
    activeText = ',' + active.join(',') + (active.length ? ',' : '');
    window.OnetrustActiveGroups = activeText;
    window.OptanonActiveGroups = activeText;
  }
  function announce() {
    try { window.dispatchEvent(new CustomEvent('OneTrustGroupsUpdated', { detail: active.slice() })); } catch (_) {}
    try {
      const layer = (window.dataLayer = window.dataLayer || []);
      layer.push({ event: 'OneTrustLoaded', OnetrustActiveGroups: activeText });
      layer.push({ event: 'OptanonLoaded', OptanonActiveGroups: activeText });
      layer.push({ event: 'OneTrustGroupsUpdated', OnetrustActiveGroups: activeText });
    } catch (_) {}
    if (typeof window.OptanonWrapper === 'function') { try { window.OptanonWrapper(); } catch (_) {} }
  }
  function insertWhenActive(groupId, insert, callback) {
    if (groupId && !active.includes(String(groupId))) return;
    try { insert(); } catch (_) {}
    if (typeof callback === 'function') { try { callback(); } catch (_) {} }
  }
  /* Accepting needs the person's own click: a page script calling AllowAll on load is not a choice. */
  function allowAll() {
    if (!(navigator.userActivation && navigator.userActivation.isActive)) return;
    rows = rows.map(([id]) => [id, '1']);
    saveConsent(rows);
    publish();
    announce();
    for (const fn of listeners) { try { fn({ detail: active.slice() }); } catch (_) {} }
  }

  let openingPreferences = false;
  function openPreferences() {
    if (!source || openingPreferences || window.OneTrust !== api || !navigator.userActivation?.isActive) return;
    openingPreferences = true;
    const ready = () => {
      clearTimeout(replyTimeout);
      const script = document.createElement('script');
      const failed = () => {
        clearTimeout(loadTimeout);
        script.remove();
        if (!window.OneTrust) window.OneTrust = api;
        if (!window.Optanon) window.Optanon = window.OneTrust;
        openingPreferences = false;
      };
      const loadTimeout = setTimeout(failed, 10000);
      let nextOpen = 0;
      const openWhenReady = () => {
        if (!openingPreferences) return;
        const sdk = window.OneTrust;
        const panel = document.getElementById('onetrust-pc-sdk');
        if (panel?.getClientRects().length && !panel.closest('[aria-hidden="true"]')
            && getComputedStyle(panel).visibility === 'visible') {
          clearTimeout(loadTimeout);
          openingPreferences = false;
          return;
        }
        /* Some sites need to renew the refusal against their own category IDs before the panel can stay open. */
        try {
          if (sdk && !sdk.__wardenOne && typeof sdk.ToggleInfoDisplay === 'function'
              && sdk.IsAlertBoxClosed?.() === true && Date.now() >= nextOpen) {
            nextOpen = Date.now() + 500;
            sdk.ToggleInfoDisplay();
          }
        } catch (_) {}
        setTimeout(openWhenReady, 100);
      };
      try {
        for (const { name, value } of source.attributes) {
          if (name !== 'id') script.setAttribute(name, value);
        }
        script.nonce = source.nonce;
        script.addEventListener('load', openWhenReady, { once: true });
        script.addEventListener('error', failed, { once: true });
        window.OneTrust = undefined;
        if (window.Optanon === api) window.Optanon = undefined;
        (document.head || document.documentElement).append(script);
      } catch (_) { failed(); }
    };
    source.addEventListener('wardenone-onetrust-preferences-ready', ready, { once: true });
    const replyTimeout = setTimeout(() => {
      source.removeEventListener('wardenone-onetrust-preferences-ready', ready);
      openingPreferences = false;
    }, 5000);
    /* The isolated listener sees the trusted click before the request crosses worlds. */
    setTimeout(() => source.dispatchEvent(new Event('wardenone-onetrust-preferences', { bubbles: true })), 0);
  }

  const api = {
    __wardenOne: true,
    IsAlertBoxClosed: () => true,
    IsAlertBoxClosedAndValid: () => true,
    AllowAll: allowAll,
    ToggleInfoDisplay: openPreferences,
    OnConsentChanged: (fn) => { if (typeof fn === 'function') listeners.push(fn); },
    GetDomainData: () => ({
      ConsentModel: { Name: 'opt-in' },
      Groups: rows.map(([id, on]) => ({ CustomGroupId: id, OptanonGroupId: id, GroupName: id, Status: on === '1' ? 'active' : 'inactive',
        FirstPartyCookies: [], Hosts: [], SubGroups: [] })),
    }),
    getGeolocationData: () => ({ country: '', state: '', stateName: '', continent: '' }),
    InsertScript: (url, selector, callback, options, groupId) => insertWhenActive(groupId, () => {
      const script = document.createElement('script');
      script.src = String(url);
      script.async = true;
      (document.querySelector(selector) || document.head || document.documentElement).appendChild(script);
    }, callback),
  };
  /* InsertHtml holds markup for optional groups, which a refusal leaves off, so it inserts nothing. */
  for (const name of ['InsertHtml', 'RejectAll', 'Close', 'LoadBanner', 'Init', 'InitializeBanner', 'changeLanguage',
    'setGeoLocation', 'useGeoLocationService', 'testLog', 'BlockGoogleAnalytics', 'ReconsentGroups', 'UpdateConsent',
    'setConsentProfile', 'setDataSubjectIdV2', 'initializeCookiePolicyHtml', 'getCSS', 'getHtml', 'TriggerGoogleAnalyticsEvent']) {
    api[name] = () => {};
  }

  publish();
  window.OneTrust = api;
  window.Optanon = api;
  if (source) document.addEventListener('click', event => {
    if (event.isTrusted && event.composedPath().some(el => el.matches?.(settingsControl))) openPreferences();
  }, true);
  if (refused && typeof window.gtag === 'function') {
    try { window.gtag('consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }); } catch (_) {}
  }
  /* OneTrust calls the site's OptanonWrapper once its SDK has loaded, after the page has parsed; sites define it after
     the stub tag, so the answer waits for the same moment. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(announce, 0), { once: true });
  else setTimeout(announce, 0);
  if (refused) { try { document.dispatchEvent(new Event('wardenone-onetrust-answered')); } catch (_) {} }
})();

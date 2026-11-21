/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Stands in for OneTrust's otSDKStub.js while automatic cookie refusal is on. It saves a refusal in OneTrust's own
   cookies and answers the calls a site makes, so the banner, its settings files, logos and the geolocation lookup are
   never fetched. A choice the person already made is kept as it is. */
(() => {
  const existing = window.OneTrust;
  if (existing && (existing.__wardenOne || typeof existing.IsAlertBoxClosed === 'function')) return;

  const NECESSARY = 'C0001';
  const STANDARD = ['C0001', 'C0002', 'C0003', 'C0004', 'C0005'];
  const YEAR = 365 * 24 * 60 * 60;

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

  const api = {
    __wardenOne: true,
    IsAlertBoxClosed: () => true,
    IsAlertBoxClosedAndValid: () => true,
    AllowAll: allowAll,
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
  for (const name of ['InsertHtml', 'RejectAll', 'Close', 'ToggleInfoDisplay', 'LoadBanner', 'Init', 'InitializeBanner', 'changeLanguage',
    'setGeoLocation', 'useGeoLocationService', 'testLog', 'BlockGoogleAnalytics', 'ReconsentGroups', 'UpdateConsent',
    'setConsentProfile', 'setDataSubjectIdV2', 'initializeCookiePolicyHtml', 'getCSS', 'getHtml', 'TriggerGoogleAnalyticsEvent']) {
    api[name] = () => {};
  }

  publish();
  window.OneTrust = api;
  window.Optanon = api;
  if (refused && typeof window.gtag === 'function') {
    try { window.gtag('consent', 'update', { ad_storage: 'denied', analytics_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied' }); } catch (_) {}
  }
  /* OneTrust calls the site's OptanonWrapper once its SDK has loaded, after the page has parsed; sites define it after
     the stub tag, so the answer waits for the same moment. */
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => setTimeout(announce, 0), { once: true });
  else setTimeout(announce, 0);
  if (refused) { try { document.dispatchEvent(new Event('wardenone-onetrust-answered')); } catch (_) {} }
})();

/*
 * WebWarden -- startup security check module (MV3 service worker)
 * Loaded synchronously from background.js with importScripts().
 *
 * Shared globals provided by background.js/domain-utils.js:
 *   DEFAULT_CONFIG, localGet, regDomainBg, BLOCKED_DOMAINS, EXT_BASELINE_KEY,
 *   snapshotExtensionBaseline
 * Shared globals exposed for background.js message handlers:
 *   STARTUP_REPORT_KEY, runStartupCheck(), loginRiskVerdict()
 */

/* global chrome, DEFAULT_CONFIG, localGet, regDomainBg, BLOCKED_DOMAINS, EXT_BASELINE_KEY, snapshotExtensionBaseline */
/* ===========================================================================
 * STARTUP SECURITY CHECK
 * ---------------------------------------------------------------------------
 * When Chrome starts, sweep for things that suggest a problem carried over from
 * last session or happened while you were away:
 *   - Restored/open tabs sitting on a blocklisted or look-alike domain
 *   - Extensions that appeared since our last baseline (recently installed)
 * We summarise findings into a report the popup shows, and badge if anything is
 * notable. HONEST SCOPE: this surfaces things to review -- it doesn't auto-close
 * tabs or delete anything (that stays your decision, or the Recovery actions).
 * ========================================================================== */
var STARTUP_REPORT_KEY = 'webwarden_startup_report';

async function startupCheckEnabled() {
  try {
    const s = await localGet('webwarden_config');
    const cfg = (s && s.webwarden_config) || {};
    return cfg.enabled !== false && cfg.startupCheck !== false;
  } catch (_) { return false; }
}

async function extensionUiAllowed() {
  try {
    const s = await localGet('webwarden_config');
    const cfg = Object.assign({}, DEFAULT_CONFIG, (s && s.webwarden_config) || {});
    return cfg.enabled !== false && cfg.silentMode !== true;
  } catch (_) { return true; }
}

var LOGIN_BRAND_PROFILES = [
  { label: 'PayPal', token: 'paypal', domains: ['paypal.com', 'paypal.me', 'paypalobjects.com'] },
  { label: 'Google', token: 'google', domains: ['google.com', 'google.co.uk', 'g.co', 'goo.gle', 'withgoogle.com', 'googleblog.com', 'accounts.google.com', 'googleapis.com', 'gstatic.com', 'googleusercontent.com', 'googlemail.com', 'youtube.com', 'gmail.com'] },
  { label: 'Microsoft', token: 'microsoft', domains: ['microsoft.com', 'microsoft365.com', 'live.com', 'outlook.com', 'office.com', 'office365.com', 'microsoftonline.com', 'sharepoint.com', 'onmicrosoft.com', 'msftauth.net', 'msauth.net', 'azure.com', 'azureedge.net', 'aka.ms', 'windows.com', 'xbox.com'] },
  { label: 'Apple', token: 'apple', domains: ['apple.com', 'icloud.com'] },
  { label: 'Amazon', token: 'amazon', domains: ['amazon.com', 'amazon.co.uk', 'amazon.ca', 'amazon.de', 'amazon.in', 'amazon.co.jp', 'amazon.com.au', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazonaws.com', 'amzn.com', 'amzn.to', 'amazonpay.com'] },
  { label: 'Facebook', token: 'facebook', domains: ['facebook.com', 'fb.com', 'fb.me', 'messenger.com', 'meta.com', 'facebookmail.com', 'fbcdn.net'] },
  { label: 'Instagram', token: 'instagram', domains: ['instagram.com'] },
  { label: 'Netflix', token: 'netflix', domains: ['netflix.com'] },
  { label: 'Discord', token: 'discord', domains: ['discord.com', 'discordapp.com'] },
  { label: 'Steam', token: 'steam', domains: ['steampowered.com', 'steamcommunity.com'] },
  { label: 'Coinbase', token: 'coinbase', domains: ['coinbase.com'] },
  { label: 'Binance', token: 'binance', domains: ['binance.com'] },
  { label: 'MetaMask', token: 'metamask', domains: ['metamask.io'] },
  { label: 'GitHub', token: 'github', domains: ['github.com', 'githubusercontent.com', 'githubassets.com', 'github.io'] },
  { label: 'Dropbox', token: 'dropbox', domains: ['dropbox.com', 'dropboxusercontent.com'] },
  { label: '1Password', token: '1password', domains: ['1password.com'] },
  { label: 'Bitwarden', token: 'bitwarden', domains: ['bitwarden.com'] },
  { label: 'Proton', token: 'proton', domains: ['proton.me', 'protonvpn.com'] },
  { label: 'Bank of America', token: 'bankofamerica', domains: ['bankofamerica.com', 'bofa.com'] },
  { label: 'Chase', token: 'chase', domains: ['chase.com', 'jpmorganchase.com'] },
  { label: 'Wells Fargo', token: 'wellsfargo', domains: ['wellsfargo.com'] },
];

function loginHostMatchesOfficialBrand(host, profile) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  return (profile.domains || []).some((d) => h === d || h.endsWith('.' + d));
}

function normalizeBrandish(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[@]/g, 'a')
    .replace(/[0]/g, 'o')
    .replace(/[1!]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[7]/g, 't')
    .replace(/[^a-z0-9]/g, '');
}

function editDistanceWithin(a, b, limit) {
  a = String(a || '');
  b = String(b || '');
  if (Math.abs(a.length - b.length) > limit) return false;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let last = prev[0];
    prev[0] = i;
    let rowMin = prev[0];
    for (let j = 1; j <= b.length; j++) {
      const old = prev[j];
      prev[j] = a[i - 1] === b[j - 1] ? last : Math.min(last, prev[j - 1], prev[j]) + 1;
      last = old;
      rowMin = Math.min(rowMin, prev[j]);
    }
    if (rowMin > limit) return false;
  }
  return prev[b.length] > 0 && prev[b.length] <= limit;
}

function loginBrandRiskForHost(host, url) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const rd = regDomainBg(h);
  if (!rd) return null;
  const core = rd.split('.')[0] || '';
  const compact = normalizeBrandish(core);
  const fullCompact = normalizeBrandish(rd);
  const urlText = String(url || '') + ' ' + h;
  const authish = /(login|logon|signin|sign-in|verify|verification|account|secure|password|passwd|mfa|2fa|oauth|session|billing|invoice|payment|wallet|bank|recover|confirm|unlock|update)/i.test(urlText);
  for (const profile of LOGIN_BRAND_PROFILES) {
    if (loginHostMatchesOfficialBrand(h, profile)) continue;
    const brand = normalizeBrandish(profile.token);
    const containsBrand = fullCompact.includes(brand);
    const closeBrand = editDistanceWithin(compact, brand, brand.length > 6 ? 2 : 1);
    if (containsBrand || closeBrand) {
      return {
        brand: profile.label,
        matched: rd,
        reason: (containsBrand ? 'contains ' : 'resembles ') + profile.label + ' but is not an official ' + profile.label + ' domain',
        authish,
      };
    }
  }
  return null;
}

function loginRiskVerdict(host, url, age, maxDays) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const rd = regDomainBg(h) || h;
  const reasons = [];
  const brand = loginBrandRiskForHost(h, url);
  if (brand) reasons.push(brand.reason);
  if (/(^|\.)xn--/i.test(h)) reasons.push('domain uses punycode/homograph encoding');
  const ageDays = age && typeof age.ageDays === 'number' ? age.ageDays : null;
  const isNew = typeof ageDays === 'number' && ageDays < maxDays;
  if (isNew) reasons.push('domain is only ' + ageDays + ' day(s) old');
  return {
    risky: reasons.length > 0,
    hardBlock: reasons.length > 0,
    isNew,
    ageDays,
    brand: (brand && brand.brand) || '',
    matched: (brand && brand.matched) || rd,
    reasons,
  };
}

function looksLikeLookalikeHost(host) {
  // lightweight reuse of the punycode + digit-substitution heuristics
  const h = regDomainBg(host);
  if (!h) return false;
  if (/(^|\.)xn--/i.test(h)) return true; // homograph/punycode
  if (loginBrandRiskForHost(h, '')) return true;
  // brand with digit substitution (paypa1, g00gle, micros0ft, amaz0n)
  const BRANDS = ['paypal', 'google', 'microsoft', 'amazon', 'apple', 'facebook', 'netflix', 'coinbase', 'binance', 'instagram'];
  const core = h.split('.')[0];
  for (const b of BRANDS) {
    if (core === b) return false; // exact brand word handled by real-domain check elsewhere
    // same length, <=2 char differences, looks like the brand
    if (Math.abs(core.length - b.length) <= 1) {
      let diff = 0; const n = Math.max(core.length, b.length);
      for (let i = 0; i < n; i++) if (core[i] !== b[i]) diff++;
      if (diff > 0 && diff <= 2 && /[0-9]/.test(core)) return true;
    }
  }
  return false;
}

async function runStartupCheck(reason, opts = {}) {
  if (!opts.force && !(await startupCheckEnabled())) return null;
  // The startup fast-path (setTimeout) and its backstop (alarm) can both fire for a
  // single browser start. If a startup sweep already ran in the last 2 minutes, reuse
  // it instead of repeating the work and re-notifying. Reads storage so it holds even
  // if the worker was torn down and restarted between the two triggers.
  if (!opts.force && (reason || 'startup') === 'startup') {
    try {
      const prev = await localGet(STARTUP_REPORT_KEY);
      const rep = prev && prev[STARTUP_REPORT_KEY];
      if (rep && typeof rep.when === 'number' && (Date.now() - rep.when) < 120000) return rep;
    } catch (_) {}
  }
  const findings = { tabs: [], extensions: [], downloads: [], when: Date.now(), reason: reason || 'startup' };
  // 1) open/restored tabs on risky domains
  try {
    const tabs = await new Promise((r) => { try { chrome.tabs.query({}, (t) => r(t || [])); } catch { r([]); } });
    for (const t of tabs) {
      const url = t.url || '';
      if (!/^https?:/i.test(url)) continue;
      let host = '';
      try { host = new URL(url).hostname; } catch (_) { continue; }
      const rd = regDomainBg(host);
      const blocked = rd && (BLOCKED_DOMAINS.has(rd) || BLOCKED_DOMAINS.has(host));
      const lookalike = looksLikeLookalikeHost(host);
      if (blocked || lookalike) {
        findings.tabs.push({ id: t.id, title: (t.title || '').slice(0, 80), host: rd, why: blocked ? 'on a known malware/scam blocklist' : 'a look-alike of a real brand domain' });
      }
    }
  } catch (_) {}
  // 2) extensions that appeared since our baseline
  try {
    const store = await localGet(EXT_BASELINE_KEY);
    const baseline = (store && store[EXT_BASELINE_KEY]) || {};
    const all = await chrome.management.getAll();
    for (const e of all) {
      if (e.type !== 'extension' || e.id === chrome.runtime.id) continue;
      const isNew = !Object.prototype.hasOwnProperty.call(baseline, e.id);
      if (isNew) {
        const perms = (e.permissions || []).concat(e.hostPermissions || []);
        const allSites = (e.hostPermissions || []).some((h) => h === '<all_urls>' || h === '*://*/*' || h === 'http://*/*' || h === 'https://*/*');
        const risky = allSites || (e.permissions || []).some((p) => ['tabs', 'history', 'cookies', 'webRequest', 'proxy', 'debugger', 'nativeMessaging', 'clipboardRead', 'management'].includes(p));
        findings.extensions.push({ id: e.id, name: (e.name || '').slice(0, 80), enabled: e.enabled, allSites: !!allSites, risky: !!risky });
      }
    }
  } catch (_) {}
  // Downloads are intentionally NOT scanned at startup any more. The Download Guard
  //    already reviews risky downloads live as they happen (and logs them to Activity),
  //    so re-scanning old download entries on every launch just re-nagged about the same
  //    files. findings.downloads stays empty only for old-report/schema compatibility.

  const total = findings.tabs.length + findings.extensions.length;
  findings.total = total;
  try { await localSet({ [STARTUP_REPORT_KEY]: findings }); } catch (_) {}
  if (total > 0 && await extensionUiAllowed()) {
    try { chrome.action.setBadgeText({ text: String(total > 9 ? '9+' : total) }); chrome.action.setBadgeBackgroundColor({ color: '#c0392b' }); } catch (_) {}
    try {
      chrome.notifications.create('ww-startup-' + Date.now(), {
        type: 'basic', iconUrl: 'icons/icon128.png',
        title: 'WebWarden startup check', priority: 1,
        message: total + ' thing' + (total === 1 ? '' : 's') + ' to review: ' +
          [findings.tabs.length ? findings.tabs.length + ' tab(s)' : '', findings.extensions.length ? findings.extensions.length + ' new extension(s)' : ''].filter(Boolean).join(', '),
      });
    } catch (_) {}
  }
  // refresh the extension baseline so "new" is relative to now going forward
  try { await snapshotExtensionBaseline(); } catch (_) {}
  return findings;
}

// run shortly after startup (give tabs/extensions time to settle)
try {
  chrome.runtime.onStartup?.addListener(() => {
    // Fast path runs shortly after startup; the alarm is a backstop in case the MV3
    // worker is torn down before the setTimeout fires (it would otherwise be lost).
    setTimeout(() => runStartupCheck('startup'), 2500);
    try { chrome.alarms.create('webwarden-startup-check', { delayInMinutes: 0.5 }); } catch (_) {}
  });
} catch (_) {}

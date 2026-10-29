/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
var WOConsentState = (() => {
  const profiles = Object.freeze([
    Object.freeze({ id: 'onetrust', name: 'OneTrust', cookie: 'OptanonConsent', container: '#onetrust-banner-sdk,#onetrust-pc-sdk',
      reject: '#onetrust-reject-all-handler,.ot-pc-refuse-all-handler', settings: '#onetrust-pc-btn-handler', save: '.save-preference-btn-handler' }),
    Object.freeze({ id: 'cookiebot', name: 'Cookiebot', cookie: 'CookieConsent', container: '#CybotCookiebotDialog,#CybotCookiebotDialogDetail',
      reject: '#CybotCookiebotDialogBodyButtonDecline,#CybotCookiebotDialogBodyLevelButtonLevelOptinDeclineAll',
      settings: '#CybotCookiebotDialogBodyLevelButtonCustomize', save: '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowallSelection' }),
    Object.freeze({ id: 'trustarc', name: 'TrustArc', cookie: 'notice_gdpr_prefs', container: '#truste-consent-track,#truste-consent-content,#truste-consent-manager',
      reject: '#truste-consent-required,#truste-consent-button-reject,.truste-button2', settings: '#truste-show-consent', save: '#truste-consent-button' }),
  ]);
  function cookie(text, name) {
    if (typeof text !== 'string' || text.length > 32768) return '';
    const values = text.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
    if (values.length !== 1) return '';
    let value = values[0].slice(name.length + 1);
    if (value.length > 4096) return '';
    try { value = decodeURIComponent(value); } catch (_) { return ''; }
    return value.length <= 4096 ? value : '';
  }
  function rejected(id, value) {
    if (typeof value !== 'string' || !value || value.length > 4096) return false;
    if (id === 'onetrust') {
      const fields = new URLSearchParams(value), groups = fields.getAll('groups');
      if (groups.length !== 1) return false;
      const rows = groups[0].split(','), seen = new Set(); let optional = 0, required = false;
      for (const row of rows) {
        const m = /^(C\d{4}):([01])$/.exec(row);
        if (!m || seen.has(m[1])) return false;
        seen.add(m[1]);
        if (m[1] === 'C0001') required = m[2] === '1';
        else { optional++; if (m[2] !== '0') return false; }
      }
      return required && optional > 0;
    }
    if (id === 'cookiebot') {
      if (!/^\{[\s\S]*\}$/.test(value)) return false;
      const fields = [], flags = new Map(), names = new Set(); let part = '', quote = '', escaped = false;
      for (const c of value.slice(1, -1)) {
        if (quote) {
          part += c;
          if (escaped) escaped = false;
          else if (c === '\\') escaped = true;
          else if (c === quote) quote = '';
        } else if (c === '"' || c === "'") { quote = c; part += c; }
        else if (c === ',') { fields.push(part); part = ''; }
        else part += c;
      }
      if (quote || escaped) return false;
      fields.push(part);
      for (const field of fields) {
        const match = /^\s*(?:"([\w]+)"|'([\w]+)'|([\w]+))\s*:\s*(true|false|-?\d+(?:\.\d+)?|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*')\s*$/.exec(field);
        if (!match) return false;
        const key = match[1] || match[2] || match[3];
        if (names.has(key)) return false; names.add(key);
        if (['necessary', 'preferences', 'statistics', 'marketing'].includes(key)) {
          if (!/^(true|false)$/.test(match[4])) return false;
          flags.set(key, match[4] === 'true');
        }
      }
      return flags.size === 4 && flags.get('necessary') === true && ['preferences', 'statistics', 'marketing'].every(k => flags.get(k) === false);
    }
    // TrustArc category numbers are site-configurable; only the explicit required-only GDPR state is recognized.
    return id === 'trustarc' && /^0(?:::(?:expressed|implied),(?:eu|us))?$/.test(value);
  }
  function verify(profile, before, after) {
    return !!profile && !!after && after !== before && rejected(profile.id, after);
  }
  return Object.freeze({ profiles, cookie, rejected, verify });
})();
if (typeof module !== 'undefined') module.exports = WOConsentState;

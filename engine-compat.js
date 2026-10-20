/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Manifest globs cross query strings. Variable tenant paths need pathname-only
 * matching, shared by engine startup and the worker's coverage checks. */
function wardenOneHostedAppHost(host) {
  return /^(?:(?:docs|drive)\.google\.com|(?:[a-z0-9-]+\.)*(?:okta|auth0|onelogin|duosecurity|pingone|b2clogin|ciamlogin|amazoncognito|shopify)\.com)$/i.test(String(host || ''));
}

function wardenOneEngineLoginUrl(rawUrl) {
  try {
    const url = new URL(String(rawUrl || ''));
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    const path = url.pathname;
    if (/(^|\.)okta\.com$/.test(host)) return /^\/app\/[^/]+\/[^/]+\/sso(?:\/|$)/i.test(path);
    if (/(^|\.)pingone\.com$/.test(host)) return /^\/[^/]+\/(?:as|flows|davinci)(?:\/|$)/i.test(path);
    if (/(^|\.)b2clogin\.com$/.test(host)) {
      return /^\/[^/]+(?:\/[^/]+)?\/(?:oauth2|samlp|SelfAsserted|api\/(?:CombinedSigninAndSignup|SelfAsserted|Phonefactor|Confirmed))(?:\/|$)/i.test(path);
    }
    if (/(^|\.)ciamlogin\.com$/.test(host)) return /^\/[^/]+\/(?:oauth2|login|SAS|kmsi|GetCredentialType)(?:\/|$)/i.test(path);
    return false;
  } catch (_) { return false; }
}

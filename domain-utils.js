/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne -- shared registrable-domain (eTLD+1) helpers.
 * ======================================================
 * Loaded by BOTH the background service worker (via importScripts) and the popup/options
 * pages (via a <script> tag) so the two can never disagree about what "this site" is for
 * Forget-Me, allowlisting, and breach lookups. This is the single source of truth -- do
 * NOT re-implement the algorithm in popup.js or background.js.
 *
 * Browser extensions do not get a platform eTLD+1 API. The ICANN half is handled by
 * the common country-code second-level rule below; the security-sensitive private half
 * is explicit. On a shared host, the tenant label is part of the site identity, so
 * alice.github.io and attacker.github.io can never share trust, cookies or allowlists.
 * Opaque cloud infrastructure is stricter still: every hostname is its own identity.
 */

const WARDENONE_PRIVATE_SUFFIXES = Object.freeze([
  'appspot.com', 'azurewebsites.net', 'blogspot.com', 'firebaseapp.com', 'fly.dev',
  'github.io', 'gitlab.io', 'glitch.me', 'herokuapp.com', 'myshopify.com',
  'netlify.app', 'notion.site', 'onrender.com', 'pages.dev', 'railway.app',
  'readthedocs.io', 'repl.co', 'replit.app', 'surge.sh', 'tumblr.com',
  'vercel.app', 'vercel.sh', 'web.app', 'wixsite.com', 'workers.dev', 'wordpress.com',
]);

/* These providers have service-specific labels between the customer and the public
 * suffix (bucket.s3.region.amazonaws.com, account.blob.core.windows.net, and so on).
 * Guessing which label owns which would merge customers again. Exact-host identity is
 * conservative, compatible with host-scoped controls, and never widens trust. */
const WARDENONE_OPAQUE_TENANT_SUFFIXES = Object.freeze([
  'amazonaws.com', 'blob.core.windows.net', 'cloudfront.net', 'googleusercontent.com',
  'storage.googleapis.com',
]);

function regDomain(host) {
  let value = String(host || '').trim().toLowerCase().replace(/\.+$/, '');
  try {
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = new URL(value).hostname.toLowerCase();
  } catch (_) {}
  if (value[0] !== '[' && (value.match(/:/g) || []).length === 1) value = value.replace(/:\d+$/, '');
  return value.replace(/^www\./, '');
}

function wardenOneSuffixMatch(host, suffixes) {
  const h = regDomain(host);
  let found = '';
  for (const suffix of suffixes) {
    if ((h === suffix || h.endsWith('.' + suffix)) && suffix.length > found.length) found = suffix;
  }
  return found;
}

function sharedTenantSuffix(host) {
  return wardenOneSuffixMatch(host, WARDENONE_PRIVATE_SUFFIXES)
    || wardenOneSuffixMatch(host, WARDENONE_OPAQUE_TENANT_SUFFIXES);
}

function isSharedTenantHost(host) {
  const h = regDomain(host);
  const suffix = sharedTenantSuffix(h);
  return !!(suffix && h !== suffix);
}

function registrableDomain(host) {
  const h = regDomain(host);
  if (!h || h === 'localhost' || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(h) || h.includes(':')) return h;
  const opaque = wardenOneSuffixMatch(h, WARDENONE_OPAQUE_TENANT_SUFFIXES);
  if (opaque) return h;
  const privateSuffix = wardenOneSuffixMatch(h, WARDENONE_PRIVATE_SUFFIXES);
  if (privateSuffix) {
    if (h === privateSuffix) return h;
    const hostParts = h.split('.');
    const suffixParts = privateSuffix.split('.');
    return hostParts.slice(-(suffixParts.length + 1)).join('.');
  }
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const last2 = parts.slice(-2).join('.');
  const multi = /^(co|com|org|net|gov|ac|edu|gob|gouv)\.[a-z]{2}$/;
  return multi.test(last2) ? parts.slice(-3).join('.') : last2;
}

function sameSiteDomain(a, b) {
  const left = registrableDomain(a);
  const right = registrableDomain(b);
  return !!(left && right && left === right);
}

/* Directional host-list matching. Ordinary entries cover their subdomains, as
 * users expect. A private platform apex (github.io) covers only itself rather
 * than every tenant, and opaque infrastructure entries are exact-host only. */
function hostMatchesSite(host, candidate) {
  const h = regDomain(host);
  const d = regDomain(candidate);
  if (!h || !d) return false;
  const opaque = wardenOneSuffixMatch(h, WARDENONE_OPAQUE_TENANT_SUFFIXES)
    || wardenOneSuffixMatch(d, WARDENONE_OPAQUE_TENANT_SUFFIXES);
  if (opaque) return h === d;
  const privateSuffix = wardenOneSuffixMatch(h, WARDENONE_PRIVATE_SUFFIXES)
    || wardenOneSuffixMatch(d, WARDENONE_PRIVATE_SUFFIXES);
  if (privateSuffix && d === privateSuffix) return h === d;
  return h === d || h.endsWith('.' + d);
}

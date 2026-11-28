/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Every named site exception, lifted from the shipped code itself so docs/compat-exceptions.json can be held to it.
   Each lifter returns the exception's current value: a sorted host list, a regex as source and flags, or plain data. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..', '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

/* The balanced bracket, string or regex starting at `at`, skipping strings, comments and regex literals inside. */
function balanced(src, at) {
  const opener = src[at];
  if (opener === '/') return src.slice(at, regexEnd(src, at));
  const stack = [opener];
  let prev = opener;
  let i = at + 1;
  while (i < src.length && stack.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === '`') { i = stringEnd(src, i); prev = c; continue; }
    if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; continue; }
    if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && /[(,=:[!&|?{};]/.test(prev)) { i = regexEnd(src, i); prev = '/'; continue; }
    if ('([{'.includes(c)) stack.push(c);
    else if (')]}'.includes(c)) stack.pop();
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return src.slice(at, i);
}
function stringEnd(src, i) {
  const q = src[i];
  for (let j = i + 1; j < src.length; j++) {
    if (src[j] === '\\') { j++; continue; }
    if (src[j] === q) return j + 1;
  }
  throw new Error('unterminated string at ' + i);
}
function regexEnd(src, i) {
  let inClass = false;
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === '\\') { j++; continue; }
    if (c === '[') inClass = true;
    else if (c === ']') inClass = false;
    else if (c === '/' && !inClass) { let k = j + 1; while (/[a-z]/.test(src[k] || '')) k++; return k; }
  }
  throw new Error('unterminated regex at ' + i);
}

/* The value after `marker` (which ends just before the expression's first bracket, quote or slash). */
function after(src, marker, file) {
  const at = src.indexOf(marker);
  if (at < 0) throw new Error(file + ' no longer has: ' + marker);
  if (src.indexOf(marker, at + 1) >= 0) throw new Error(file + ' has more than one: ' + marker);
  let i = at + marker.length;
  while (/\s/.test(src[i])) i++;
  return balanced(src, i);
}
const evaluate = (code, context) => vm.runInNewContext('(' + code + ')', Object.assign({ Set, Object, Array }, context || {}));
const hosts = (value) => [...new Set(Array.from(value, String))].sort();
const pattern = (re) => ({ source: re.source, flags: re.flags });

function lift() {
  const bg = read('background.js');
  const engine = read('content.min.js');
  const consent = read('consent-reject.js');
  const idn = read('idn-utils.js');
  const login = evaluate(after(bg, 'const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS =', 'background.js'));
  const remoteBody = after(bg, 'function remoteListBlockAllowed(host, pattern, sourceKind, sourceUrl)', 'background.js');
  const feedExclusions = [];
  for (const m of remoteBody.matchAll(/sourceUrl === '([^']+)'\s*&& \(([^)]*)\)\) return false;/g)) {
    feedExclusions.push({ source: m[1], hosts: hosts([...m[2].matchAll(/host === '([^']+)'/g)].map((x) => x[1])) });
  }
  const appsAt = bg.indexOf('LOGIN_COMPAT_NEVER_BLOCK_DOMAINS.forEach((domain) => NEVER_BLOCK_DOMAINS.add(domain));\n[');
  if (appsAt < 0) throw new Error('background.js: the apps list after the login never-block copy moved');
  const apps = evaluate(balanced(bg, bg.indexOf('\n[', appsAt) + 1));
  const invite = after(bg, 'function knownInviteRedirect(fromUrl, toUrl)', 'background.js');
  const downloadReturn = after(bg, 'function downloadSiteBlockedUrl(raw)', 'background.js');
  const consentIf = consent.slice(consent.indexOf('const compatibilityHost'), consent.indexOf('return;', consent.indexOf('const compatibilityHost')));
  const trustCode = after(engine, 'TOKEN_EXFIL_TRUST_POLICY=', 'content.min.js');
  const trust = Object.fromEntries(['globalDestinations', 'managedBackends', 'families'].map((k) => [k, evaluate(after(trustCode, k + '=', 'the token trust policy'))]));
  const engineRe = (name) => pattern(evaluate(after(engine, name + '=', 'content.min.js')));
  return {
    'never-block-core': hosts(evaluate(after(bg, 'const NEVER_BLOCK_DOMAINS = new Set(', 'background.js'))),
    'never-block-apps': hosts(apps),
    'login-compat-hosts': hosts(login),
    'consent-managers': hosts(evaluate(after(bg, 'const CONSENT_MANAGER_HOSTS =', 'background.js'))),
    'onetrust-answer-pauses': hosts(evaluate(after(bg, 'const ONETRUST_ANSWER_PAUSED_DOMAINS =', 'background.js'))),
    'badger-site-fixes': require('../build-badger-dnr.js').WARDENONE_SITEFIXES,
    'adobe-fonts': hosts([...bg.matchAll(/^NEVER_BLOCK_DOMAINS\.add\('([^']+)'\);/gm)].map((m) => m[1])),
    'login-compat-filters': evaluate(after(bg, 'const LOGIN_COMPAT_FILTERS =', 'background.js')),
    'tracker-protected': hosts(evaluate(after(bg, 'const TRACKER_PROTECTED_DOMAINS = new Set(', 'background.js'))),
    'media-compat': hosts(evaluate(after(bg, 'const MEDIA_COMPAT_DOMAINS = new Set(', 'background.js'))),
    'x-app-compat': hosts(evaluate(after(bg, 'const X_APP_COMPAT_DOMAINS = new Set(', 'background.js'))),
    'chatgpt-compat': hosts(evaluate(after(bg, 'const CHATGPT_COMPAT_DOMAINS =', 'background.js'))),
    'path-tenant-hosts': {
      hosts: hosts(evaluate(after(bg, 'const PATH_TENANT_HOSTS = new Set(', 'background.js'))),
      pattern: pattern(evaluate(after(bg, 'const PATH_TENANT_HOST_RE =', 'background.js'))),
    },
    'fingerprint-hosted-apps': evaluate(after(bg, 'const FINGERPRINT_HOSTED_APP_MATCHES =', 'background.js')).slice().sort(),
    'consent-reject-exclude': {
      matches: evaluate(after(bg, 'const CONSENT_REJECT_EXCLUDE_MATCHES =', 'background.js')).slice().sort(),
      pattern: pattern(evaluate(after(bg, 'const CONSENT_REJECT_EXCLUDE_RE =', 'background.js'))),
    },
    'resolver-ips': hosts(evaluate(after(bg, 'const FEED_NEVER_BLOCK_IPS = new Set(', 'background.js'))),
    'feed-false-positives': hosts(evaluate(after(bg, 'const FEED_FALSE_POSITIVE_DOMAINS = new Set(', 'background.js'))),
    'feed-entry-exclusions': feedExclusions,
    'google-search-sponsored': {
      initiators: hosts(evaluate(after(bg, 'const GOOGLE_SEARCH_INITIATOR_DOMAINS =', 'background.js'))),
      sponsored: hosts(evaluate(after(bg, 'const GOOGLE_SEARCH_SPONSORED_DOMAINS =', 'background.js'))),
      paths: evaluate(after(bg, 'const GOOGLE_SEARCH_SPONSORED_PATH_FILTERS =', 'background.js')),
    },
    'pinned-redirects': evaluate(after(bg, 'const PINNED_REDIRECT_RULES =', 'background.js')),
    'invite-redirect': hosts([...invite.matchAll(/hostname [!=]== '([^']+)'/g)].map((m) => m[1])),
    'download-return-host': hosts([...downloadReturn.matchAll(/host === '([^']+)'/g)].map((m) => m[1])),
    'trusted-media-hosts': engineRe('trustedMediaHost'),
    'discord-app': engineRe('discordAppHost'),
    'conversation-hosts': engineRe('conversationHost'),
    'webrtc-compat': pattern(evaluate(after(engine, 'webrtcCompatHost=trustedMediaHost||', 'content.min.js'))),
    'search-results-hosts': engineRe('searchResultsHost'),
    'youtube-pauses': {
      pattern: pattern(evaluate(after(engine, 'youtube=', 'content.min.js'))),
      paused: evaluate(after(engine, 'const YT_COMPAT_PAUSED=', 'content.min.js')),
    },
    'hosted-app-pauses': {
      pattern: engineRe('HOSTED_APP_COMPAT_HOST'),
      paused: evaluate(after(engine, 'HOSTED_APP_COMPAT_PAUSED=', 'content.min.js')),
    },
    'education-pauses': {
      pattern: engineRe('EDU_COMPAT_HOST'),
      paused: evaluate(after(engine, 'EDU_COMPAT_PAUSED=', 'content.min.js')),
    },
    'token-exfil-trust': JSON.parse(JSON.stringify(trust)),
    'consent-reject-compat': {
      allowlist: hosts(evaluate(after(consent, 'const COMPAT_ALLOWLIST =', 'consent-reject.js'))),
      patterns: [...consentIf.matchAll(/(\/(?:\\.|\[[^\]]*\]|[^/\n])+\/[a-z]*)\.test\(compatibilityHost\)/g)].map((m) => pattern(evaluate(m[1]))),
    },
    'brand-country-sites': JSON.parse(JSON.stringify(evaluate(after(idn, 'const WARDENONE_BRAND_COUNTRY_SITES = Object.freeze(', 'idn-utils.js')))),
  };
}

/* The never-block set as the worker builds it, to prove the registered pieces add up to exactly that. */
function neverBlockRuntime() {
  const bg = read('background.js');
  const from = bg.indexOf('const NEVER_BLOCK_DOMAINS = new Set(');
  const to = bg.indexOf("NEVER_BLOCK_DOMAINS.add('use.typekit.net');");
  if (from < 0 || to < from) throw new Error('background.js: the never-block assembly moved');
  const login = after(bg, 'const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS =', 'background.js');
  const context = vm.createContext({ Set });
  vm.runInContext('const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = ' + login + ';\n' + bg.slice(from, to + "NEVER_BLOCK_DOMAINS.add('use.typekit.net');".length)
    + '\nthis.out = [...NEVER_BLOCK_DOMAINS];', context);
  return hosts(context.out);
}

module.exports = { lift, neverBlockRuntime, balanced };

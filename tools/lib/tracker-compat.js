/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* The shipped isProtectedTrackerDomain and isMediaCompatDomain, sliced out of background.js, so
   packaged tracker catalogs are judged by the worker's own code rather than a builder's mirror. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..', '..');

function shippedTrackerCompat() {
  const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
  const take = (pattern, name) => {
    const match = source.match(pattern);
    if (!match) throw new Error('Missing ' + name + ' in background.js');
    return match[0];
  };
  const fn = name => {
    const start = source.indexOf('\nfunction ' + name + '(');
    if (start < 0) throw new Error('Missing function ' + name + ' in background.js');
    return source.slice(start, source.indexOf('\n}\n', start) + 3);
  };
  const script = [
    'function registrableDomainBg(host) { return registrableDomain(host); }',
    take(/const LOGIN_COMPAT_NEVER_BLOCK_DOMAINS = \[[\s\S]*?\];/, 'login hosts'),
    take(/const TRACKER_PROTECTED_DOMAINS = new Set\(\[[\s\S]*?\]\);\nLOGIN_COMPAT_NEVER_BLOCK_DOMAINS\.forEach[^\n]*/, 'protected sites'),
    take(/const MEDIA_COMPAT_DOMAINS = new Set\(\[[\s\S]*?\]\);\nconst MEDIA_COMPAT_SUFFIXES[^\n]*/, 'media hosts'),
    'let __ownProviderDomains = null;',
    ...['ownProviderDomains', 'normalizeTrackerDomain', 'isProtectedTrackerDomain', 'isMediaCompatDomainLowercase', 'isMediaCompatDomain'].map(fn),
    'this.api = { isProtectedTrackerDomain, isMediaCompatDomain, login: LOGIN_COMPAT_NEVER_BLOCK_DOMAINS, media: [...MEDIA_COMPAT_DOMAINS] };',
  ].join('\n');
  const context = vm.createContext({ URL, console });
  for (const file of ['domain-utils.js', 'psl-private.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
  vm.runInContext(script, context);
  return context.api;
}

module.exports = { shippedTrackerCompat };

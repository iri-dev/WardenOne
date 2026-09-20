/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Generates psl-private.js from the Public Suffix List (SEC-07).
 *
 * "Which hosts belong to one owner" is a security boundary: the token-exfiltration blocker, the
 * forced-navigation interstitials and the Forget-Me wipe all ask it. domain-utils.js answered
 * with a hand-written table of 26 shared-hosting suffixes, and every platform the table did not
 * name collapsed to its last two labels -- so alice.webflow.io and attacker.webflow.io were one
 * site, and a token sent from one tenant to the other was "same party". A changing global list
 * cannot be a shortlist somebody remembers to extend; it has to be the list itself, generated,
 * versioned and reviewed when it changes.
 *
 * This writes the PRIVATE section of the list (the platform half: github.io, webflow.io,
 * *.compute.amazonaws.com ...) as one string constant. The ICANN half stays on the country-code
 * rule in domain-utils.js, deliberately: adding private rules can only ever make a site identity
 * narrower, and narrower is the safe direction for a trust record. Rules are stored in punycode,
 * because that is how hostnames arrive from the URL parser.
 *
 * Only the service worker imports the file (69 KB is nothing there and far too much to inject
 * into every frame); frames are told their own site by the worker. See siteIdentity() in
 * domain-utils.js.
 *
 *   node tools/build-psl.js                  # fetch the current list, rewrite psl-private.js,
 *                                            # print what changed for review
 *   node tools/build-psl.js --from list.dat  # build from a downloaded copy instead
 *   node tools/build-psl.js --check          # gate: the shipped file is well-formed and current
 *                                            # enough (no network)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'psl-private.js');
const SOURCE_URL = 'https://publicsuffix.org/list/public_suffix_list.dat';
const BEGIN = '// ===BEGIN PRIVATE DOMAINS===';
const END = '// ===END PRIVATE DOMAINS===';
// A shipped list older than this fails --check: the point of generating it is that it stays
// current, and a stale copy is the hand-maintained table again with extra steps.
const MAX_AGE_DAYS = 400;
// Suffixes the check insists on. If any of these is missing the file was built from the wrong
// section, or the parse silently threw everything away.
const MUST_CONTAIN = ['github.io', 'webflow.io', 'netlify.app', 'pages.dev', 'vercel.app', 'herokuapp.com'];

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => { const at = args.indexOf(name); return at >= 0 ? args[at + 1] : ''; };

function toAscii(label) {
  // The URL parser is the one IDNA implementation every context here agrees with.
  try { return new URL('http://' + label + '/').hostname; } catch (_) { return ''; }
}

function parsePrivateRules(text) {
  const lines = String(text || '').split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === BEGIN);
  const end = lines.findIndex((l) => l.trim() === END);
  if (start < 0 || end < 0 || end <= start) throw new Error('private-domains section markers not found');
  const versionLine = lines.find((l) => /^\/\/ VERSION:/.test(l.trim()));
  const version = versionLine ? versionLine.replace(/^\/\/ VERSION:\s*/, '').trim() : '';
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_UTC$/.test(version)) throw new Error('no VERSION stamp in the list header: ' + JSON.stringify(version));
  const rules = new Set();
  for (const raw of lines.slice(start + 1, end)) {
    const line = raw.trim();
    if (!line || line.startsWith('//')) continue;
    let prefix = '';
    let body = line;
    if (body.startsWith('!')) { prefix = '!'; body = body.slice(1); }
    else if (body.startsWith('*.')) { prefix = '*.'; body = body.slice(2); }
    const ascii = toAscii(body.toLowerCase());
    if (!ascii || !/^[a-z0-9.-]+$/.test(ascii) || ascii.includes('..')) throw new Error('rule did not survive normalisation: ' + line);
    rules.add(prefix + ascii);
  }
  if (rules.size < 1000) throw new Error('only ' + rules.size + ' private rules parsed; the section markers or format changed');
  return { version, rules: Array.from(rules).sort() };
}

function render(version, rules) {
  return [
    '/* WardenOne — Copyright (C) 2026 iri',
    '   Licensed under the GNU General Public License v3 or later. See LICENSE.',
    '   Official source: https://github.com/iri-dev/WardenOne',
    '   Upstream filter-list attribution: CREDITS.md',
    '   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,',
    '   with the date, and to keep these notices intact. */',
    '/* GENERATED by tools/build-psl.js -- do not edit by hand.',
    '   The private section of the Public Suffix List (https://publicsuffix.org, Mozilla Foundation,',
    '   MPL-2.0), one rule per line, in punycode, sorted. Read by siteIdentity() in domain-utils.js so',
    '   two tenants of one platform are never the same site. Service worker only; frames are told',
    '   their own site by the worker (SEC-07). To update: node tools/build-psl.js, then review the',
    '   printed additions and removals before committing. */',
    "const WARDENONE_PSL_VERSION = '" + version + "';",
    'const WARDENONE_PSL_PRIVATE_RULES = [',
    ...rules.map((r) => "  '" + r + "',"),
    "].join('\\n');",
    '',
  ].join('\n');
}

function readShipped() {
  if (!fs.existsSync(OUT)) return null;
  const text = fs.readFileSync(OUT, 'utf8');
  const version = (text.match(/^const WARDENONE_PSL_VERSION = '([^']*)';$/m) || [])[1] || '';
  const body = text.slice(text.indexOf('const WARDENONE_PSL_PRIVATE_RULES = [') , text.indexOf("].join('\\n');"));
  const rules = [];
  for (const line of body.split('\n')) {
    const m = line.match(/^  '([^']+)',$/);
    if (m) rules.push(m[1]);
  }
  return { text, version, rules };
}

function versionDate(version) {
  const m = /^(\d{4})-(\d{2})-(\d{2})_/.exec(version || '');
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : NaN;
}

function check() {
  const shipped = readShipped();
  const problems = [];
  if (!shipped) { console.error('psl-private.js is missing; run node tools/build-psl.js'); process.exit(1); }
  if (!/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_UTC$/.test(shipped.version)) problems.push('version stamp is malformed: ' + JSON.stringify(shipped.version));
  const age = (Date.now() - versionDate(shipped.version)) / 86400000;
  if (!(age < MAX_AGE_DAYS)) problems.push('shipped list is ' + Math.round(age) + ' days old (limit ' + MAX_AGE_DAYS + '); run node tools/build-psl.js');
  if (shipped.rules.length < 1000) problems.push('only ' + shipped.rules.length + ' rules in the shipped file');
  const sorted = shipped.rules.slice().sort();
  if (sorted.some((r, i) => r !== shipped.rules[i])) problems.push('rules are not sorted; the file was edited by hand');
  if (new Set(shipped.rules).size !== shipped.rules.length) problems.push('duplicate rules');
  for (const r of shipped.rules) {
    const body = r.replace(/^(!|\*\.)/, '');
    if (!/^[a-z0-9.-]+$/.test(body) || body.includes('..') || body.startsWith('.') || body.endsWith('.')) { problems.push('rule is not a punycode hostname: ' + r); break; }
    if (/[^\x00-\x7f]/.test(r)) { problems.push('rule is not ASCII: ' + r); break; }
  }
  for (const s of MUST_CONTAIN) if (!shipped.rules.includes(s)) problems.push('expected private suffix missing: ' + s);
  if (shipped.text !== render(shipped.version, shipped.rules)) problems.push('file body differs from what the generator renders for its own rules; regenerate it');
  if (problems.length) {
    for (const p of problems) console.error('psl-private.js: ' + p);
    process.exit(1);
  }
  console.log('psl-private.js ok: ' + shipped.rules.length + ' private rules, list version ' + shipped.version + ', ' + Math.round(age) + ' days old');
}

async function fetchList() {
  const res = await fetch(SOURCE_URL, { headers: { 'user-agent': 'WardenOne build (tools/build-psl.js)' } });
  if (!res.ok) throw new Error('fetch failed: HTTP ' + res.status);
  return res.text();
}

async function build() {
  const from = option('--from');
  const text = from ? fs.readFileSync(path.resolve(from), 'utf8') : await fetchList();
  const parsed = parsePrivateRules(text);
  const prior = readShipped();
  const next = render(parsed.version, parsed.rules);
  if (prior) {
    const before = new Set(prior.rules);
    const after = new Set(parsed.rules);
    const added = parsed.rules.filter((r) => !before.has(r));
    const removed = prior.rules.filter((r) => !after.has(r));
    console.log('list version ' + (prior.version || '(none)') + ' -> ' + parsed.version);
    console.log('rules ' + prior.rules.length + ' -> ' + parsed.rules.length + ' (' + added.length + ' added, ' + removed.length + ' removed)');
    // Every change is printed, not summarised: a removed suffix widens a site boundary, which is
    // the one direction this file must never move without somebody reading it.
    for (const r of added) console.log('  + ' + r);
    for (const r of removed) console.log('  - ' + r);
    if (prior.text === next) { console.log('psl-private.js is already current'); return; }
  }
  fs.writeFileSync(OUT, next);
  console.log('wrote ' + path.relative(ROOT, OUT) + ' (' + parsed.rules.length + ' rules, ' + next.length + ' bytes)');
}

if (flag('--check')) check();
else build().catch((err) => { console.error('build-psl: ' + (err && err.message || err)); process.exit(1); });

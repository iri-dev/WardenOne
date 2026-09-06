/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * "Check an extension before you install it."
 *
 * The Security Centre answers what is installed and whether it changed. This
 * answers the question that comes first, using the same bundled exact-ID
 * catalogue, for something that is not installed yet.
 *
 * Three things this suite exists to hold:
 *
 * 1. AN ID IS EXACT OR IT IS NOTHING. A one-character slip is a DIFFERENT
 *    extension, so a near-miss must be refused rather than helpfully corrected,
 *    and a lookalike host must never yield an ID.
 * 2. "NOT IN THE CATALOGUE" MUST NEVER READ AS "SAFE". The catalogue is a few
 *    hundred identities against a store of hundreds of thousands, so the ordinary
 *    answer is no record, and that is the answer most likely to be misread.
 * 3. NOTHING LEAVES THE MACHINE UNTIL ASKED. The local half is a lookup in a
 *    bundled file; telling Google which extension someone is considering is a
 *    separate, deliberate press.
 *
 * Run: node tools/test-extension-check.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const REP_SRC = fs.readFileSync('background-extension-reputation.js', 'utf8');
const DB = JSON.parse(fs.readFileSync('extension-reputation.json', 'utf8'));
const HTML = fs.readFileSync('extensions.html', 'utf8');
const JS = fs.readFileSync('extensions.js', 'utf8');
const THEME_CSS = fs.readFileSync('theme.css', 'utf8');
/* Copy is wrapped across string concatenations, so a sentence matched literally
   fails the moment it crosses a `' + '` seam. */
const JS_COPY = JS.split(/'\s*\+\s*'/).join('');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- the reference parser, run for real --------------------------------- */
const parserSrc = BG.slice(BG.indexOf('function parseExtensionReference'),
  BG.indexOf('async function installedExtensionById'));
check('the parser is where the slice expects it', parserSrc.length > 0);
/* The parser's notion of an ID must be the REAL one, read out of the file that
   declares it. Hard-coding the pattern here meant every shape assertion below
   was testing a copy living in this file: the real definition could have been
   loosened to accept 20-to-40 letters and they would all still have passed. */
const idReSrc = (REP_SRC.match(/var EXTENSION_ID_RE = \/(.+?)\/;/) || [])[1];
check('the real ID shape was found where the parser gets it', !!idReSrc,
  'background-extension-reputation.js declares it; background.js only uses it');
const box = {
  String, Object, Array, URL, RegExp, console,
  EXTENSION_ID_RE: new RegExp(idReSrc || 'never-matches-so-the-check-above-fails'),
};
vm.createContext(box);
vm.runInContext(parserSrc + ';globalThis.parse = parseExtensionReference;', box,
  { filename: 'background.js:parseExtensionReference' });
const parse = box.parse;

const UBO_LITE = 'ddkjiahejlhfcafbddmgiahcphecmpfh';
check('a bare ID is accepted', parse(UBO_LITE).id === UBO_LITE);
check('an ID is case-normalised', parse(UBO_LITE.toUpperCase()).id === UBO_LITE);
check('the modern store URL yields the ID',
  parse('https://chromewebstore.google.com/detail/ublock-origin-lite/' + UBO_LITE).id === UBO_LITE);
check('and its slug becomes a name hint',
  parse('https://chromewebstore.google.com/detail/ublock-origin-lite/' + UBO_LITE).slugName === 'ublock origin lite',
  'the slug is what lets a pasted link corroborate a catalogue record');
check('the legacy /webstore/detail URL still works',
  parse('https://chrome.google.com/webstore/detail/ublock-origin/cjpalhdlnbpafiamejdnhcphjbkeiagm').id
    === 'cjpalhdlnbpafiamejdnhcphjbkeiagm');
check('a query string does not break it',
  parse('https://chromewebstore.google.com/detail/x/' + UBO_LITE + '?hl=en').id === UBO_LITE);
check('a locale segment is not mistaken for the name',
  parse('https://chromewebstore.google.com/detail/en/' + UBO_LITE).slugName === '');

/* Anything that is not exactly an ID must be refused, not repaired. */
for (const bad of [
  ['a lookalike host', 'https://evil.example/detail/x/' + UBO_LITE],
  ['a subdomain trick', 'https://chromewebstore.google.com.evil.test/detail/x/' + UBO_LITE],
  ['letters outside a-p', 'zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz'],
  ['31 characters', UBO_LITE.slice(0, 31)],
  ['33 characters', UBO_LITE + 'a'],
  ['prose', 'ublock origin lite'],
  ['empty', ''],
  ['a store link with no ID', 'https://chromewebstore.google.com/category/extensions'],
]) {
  check('refused: ' + bad[0], parse(bad[1]).id === '', 'got ' + parse(bad[1]).id);
  check('and says why: ' + bad[0], !!parse(bad[1]).error);
}

/* ---- the catalogue lookup, run against the real database ---------------- */
const repBox = { JSON, String, Object, Array, Number, Math, Date, console, RegExp, Set, Map,
  isNaN, parseInt, parseFloat };
repBox.self = repBox;
vm.createContext(repBox);
try { vm.runInContext(REP_SRC, repBox, { filename: 'background-extension-reputation.js' }); } catch (_) { /* chrome APIs absent */ }
const lookup = repBox.lookupExtensionReputation;
check('the real lookup is available', typeof lookup === 'function');

if (typeof lookup === 'function') {
  const entries = DB.entries;
  const database = { entries, capabilityProfiles: DB.capabilityProfiles, entryCandidates: {} };
  for (const key of Object.keys(entries)) database.entryCandidates[key] = [entries[key]];
  const incidentId = Object.keys(entries).find((k) => entries[k].status === 'historical_incident');
  const listingId = Object.keys(entries).find((k) => entries[k].status === 'catalogued_listing');
  check('the catalogue still holds a documented incident', !!incidentId);
  check('and a catalogued listing', !!listingId);

  /* The property the whole design rests on. */
  check('a documented incident fires on the ID alone',
    lookup({ id: incidentId, name: '' }, database).status === 'historical_incident',
    'a pre-install check has no name to offer, and this is the answer that matters most');
  check('and cannot be shed by renaming the copy',
    lookup({ id: incidentId, name: 'Something Entirely Different' }, database).status === 'historical_incident');

  /* And the property that keeps a wrong ID from becoming a false reassurance. */
  const bare = lookup({ id: listingId, name: '' }, database);
  check('recognition is withheld when no name corroborates it',
    bare.status === 'no_record' && bare.nameMismatch === true,
    'a wrong ID must fail as a missing reassurance, never a false one');
  check('and granted once the name matches',
    lookup({ id: listingId, name: entries[listingId].name }, database).status === 'catalogued_listing',
    'which is exactly what asking the Web Store for the name unlocks');
}

/* ---- what the page says about a miss ------------------------------------ */
check('a miss is described as unexamined, not cleared',
  /means unexamined, not examined and cleared/.test(JS_COPY),
  'the catalogue is a few hundred identities against a store of hundreds of thousands');
/* Scoped to this panel, and to AFFIRMATIVE claims. The first version banned the
   phrase "is safe" anywhere in the file and so was failed by the page's existing
   -- and correct -- copy saying "not that it is safe". Negating a claim is the
   opposite of making it. */
const panelSrc = JS_COPY.slice(JS_COPY.indexOf('Check an extension before installing it'));
check('the panel never claims an extension is safe',
  !/(?<!not that it )\bis safe\b/i.test(panelSrc)
    && !/\blooks safe\b|\bsafe to install\b|\bknown clean\b/i.test(panelSrc),
  'the catalogue can record an incident; it can never certify an absence of one');
check('a withheld recognition is distinguished from no record at all',
  /cannot confirm it is this extension/.test(JS_COPY) && /recognition is withheld on purpose/.test(JS_COPY),
  'those two are different answers and only one is fixed by pasting the store link');
/* BOTH branches, counted. The presence-only version passed when one of the two
   was deleted, because the other still matched. */
check('the permission limit is stated whether or not the extension is installed',
  (JS_COPY.match(/Chrome does not expose them/g) || []).length === 2,
  'an uninstalled extension will not tell anyone what it would ask for');
check('a missing listing does not claim to know which of two things happened',
  /removed, or this ID never existed/.test(JS_COPY),
  'from outside, a removed extension and one that never existed look identical');

/* ---- nothing leaves without a press ------------------------------------- */
/* Both ends asserted. slice(start, -1) is not an error in JavaScript -- it
   quietly means "to the second-to-last character", so a deleted end anchor turns
   this into a scan of the whole rest of the file. */
const describeStart = BG.indexOf('async function describeExtensionById');
const describeEnd = BG.indexOf('const WEB_STORE_FETCH_TIMEOUT_MS');
check('the local check is where the slice expects it',
  describeStart > 0 && describeEnd > describeStart);
check('the local check makes no network request',
  !/fetch\(/.test(BG.slice(describeStart, describeEnd)),
  'the catalogue is a bundled file; answering from it must not phone anyone');
check('the name the store gives is fed back into the catalogue lookup',
  BG.includes('describeExtensionById(parsed.id, parsed.slugName, listing.name)'),
  'that is the entire point of asking: a bare ID can never corroborate a catalogue record');
check('the store lookup is a separate, explicit kind',
  BG.includes("msg.kind === 'extension-check-store'") && /id="check-store"/.test(HTML));
check('and the page says what it sends before sending it',
  /Sends only this extension ID to Google/.test(HTML));
/* Sliced to the function. Running the slice to the end of the file instead found
   seven other credentials:'omit' further down and passed with this one deleted --
   the same open-ended-slice mistake this project keeps making. */
const storeFn = BG.slice(BG.indexOf('async function fetchWebStoreListing'),
  BG.indexOf('// ---- Per-site firewall ---'));
check('the store function is where the slice expects it', storeFn.length > 0);
check('the store request carries no credentials', /credentials: 'omit'/.test(storeFn));
check('the store response is read under a byte cap',
  /readResponseTextWithByteLimit\(res, WEB_STORE_MAX_BYTES\)/.test(storeFn));
check('and under a timeout', /WEB_STORE_FETCH_TIMEOUT_MS/.test(storeFn));

/* ---- privileged --------------------------------------------------------- */
for (const kind of ['extension-check', 'extension-check-store']) {
  check(kind + ' is handled', BG.includes("msg.kind === '" + kind + "'"));
  check(kind + ' is not reachable from a web page',
    !new RegExp("TAB_CONTEXT_ALLOWED_MESSAGES = new Set\\(\\[[^\\]]*'" + kind + "'").test(BG),
    'a page could otherwise ask WardenOne which extensions the reader has, one ID at a time');
}
check('there is only one definition of what an extension ID is',
  (BG.match(/EXTENSION_ID_RE = /g) || []).length === 0,
  'a second copy in the shared worker scope threw at load and took the whole service worker with it');

/* ---- the verdict is visibly a verdict ------------------------------------ */
/* The three verdict classes are the only thing separating "documented incident"
   from "no record" at a glance. A rule quietly going missing, or naming a custom
   property that does not exist -- which invalidates the whole declaration with
   no error anywhere -- would render the worst answer in the same colour as the
   most ordinary one. */
for (const cls of ['is-incident', 'is-known', 'is-unknown']) {
  check('the ' + cls + ' verdict has a colour rule',
    new RegExp('\\.check-verdict\\.' + cls + '\\s*\\{[^}]*color:').test(HTML),
    'assigned by extensions.js; if nothing styles it the verdict reads as neutral');
}
const verdictVars = HTML.match(/\.check-verdict\.is-[a-z]+\s*\{[^}]*\}/g) || [];
for (const rule of verdictVars) {
  for (const name of (rule.match(/var\(\s*(--[a-z0-9-]+)/gi) || [])) {
    const prop = name.replace(/^var\(\s*/i, '');
    check('the verdict colour ' + prop + ' is a real custom property',
      new RegExp('\\' + prop + '\\s*:').test(HTML) || new RegExp('\\' + prop + '\\s*:').test(THEME_CSS),
      'an undefined custom property silently voids the declaration it appears in');
  }
}

/* ---- it lives in the Security Centre ------------------------------------ */
check('the panel is on the extensions page',
  /id="check-input"/.test(HTML) && /id="check-go"/.test(HTML) && /id="check-result"/.test(HTML));
check('it accepts a link or an ID', /Chrome Web Store link or/.test(HTML));

if (failed) {
  console.error('extension check: ' + failed + ' failed');
  process.exit(1);
}
console.log('extension check: all checks passed');

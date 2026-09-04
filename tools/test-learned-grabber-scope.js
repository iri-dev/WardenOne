/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Blocking a site by hand must not make the engine call it an IP logger.
 *
 * The learned map is shipped to the page for one purpose: the bridge turns it
 * into learnedGrabberDomains, the engine merges that into grabberDomains, and a
 * match raises a full-screen "Known IP-logger detected -- this domain (x) is a
 * known IP-grabber / logger service".
 *
 * Two unrelated kinds of entry live in that map:
 *   - learnDomain() writes the grabber kind. It has ONE caller, which always
 *     passes 'known IP-grabber behavior'.
 *   - the right-click "Block this site" writes { userBlocked: true, reason:
 *     'you blocked this site' }.
 *
 * Both were shipped, so blocking twitch.tv by hand and then loading it produced
 * "twitch.tv is a known IP-grabber / logger service" -- an accusation invented
 * out of the reader's own decision. Reported from a real block/unblock cycle.
 *
 * Run: node tools/test-learned-grabber-scope.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const BRIDGE = fs.readFileSync('bridge.js', 'utf8');
const MIN = fs.readFileSync('content.min.js', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- the real function, lifted from the shipped background --------------- */
const s = BG.indexOf('function sanitizeLearnedForContent(raw) {');
const e = BG.indexOf('function sanitizeSearchJunkForContent(', s);
check('sanitizeLearnedForContent is where the slice expects it', s >= 0 && e > s);
if (s < 0 || e < s) { console.error('learned grabber scope: cannot continue'); process.exit(2); }
const box = { String, Object, Array };
vm.createContext(box);
vm.runInContext(BG.slice(s, e) + ';globalThis.f=sanitizeLearnedForContent;', box,
  { filename: 'background.js:sanitizeLearnedForContent' });
const shipped = box.f;

/* The two entry shapes, exactly as the two writers produce them. */
const grabberEntry = { firstSeen: 1, reason: 'known IP-grabber behavior', hits: 1 };
const userBlockEntry = { firstSeen: 1, reason: 'you blocked this site', hits: 1, userBlocked: true };

/* ---- the reported bug --------------------------------------------------- */
{
  const out = shipped({ 'twitch.tv': userBlockEntry });
  check('a site blocked by hand is not shipped as a grabber domain',
    out['twitch.tv'] === undefined,
    'this is what made blocking twitch.tv accuse it of being an IP logger');
  check('and nothing else leaks through with it', Object.keys(out).length === 0);
}

/* ---- and the protection it must not break ------------------------------- */
{
  const out = shipped({ 'grabify.link': grabberEntry });
  check('a genuinely learned grabber is still shipped', out['grabify.link'] === true,
    'the warning has to keep working for real IP loggers');
}

/* Mixed map: the whole point is that one kind is dropped and the other is not. */
{
  const out = shipped({
    'grabify.link': grabberEntry,
    'twitch.tv': userBlockEntry,
    'iplogger.org': grabberEntry,
    'example.com': userBlockEntry,
  });
  check('a mixed map keeps only the grabber entries',
    out['grabify.link'] === true && out['iplogger.org'] === true
      && out['twitch.tv'] === undefined && out['example.com'] === undefined,
    'got ' + JSON.stringify(out));
}

/* A domain learned as a grabber and later blocked by hand becomes userBlocked,
   so it drops out. That costs nothing -- it is blocked, so no page loads to
   warn on -- but pin it so the behaviour is a decision rather than a surprise. */
{
  const both = Object.assign({}, grabberEntry, { userBlocked: true });
  check('a grabber the reader also blocked drops out too',
    shipped({ 'grabify.link': both })['grabify.link'] === undefined);
}

/* Shapes the old code accepted must still be handled: the map is read straight
   out of storage, so it can hold anything a previous version wrote. */
{
  check('a legacy `true` value is still shipped',
    shipped({ 'grabify.link': true })['grabify.link'] === true,
    'older builds stored a bare boolean; dropping those would lose real grabbers');
  check('a null entry does not throw', shipped({ 'grabify.link': null })['grabify.link'] === true);
  check('userBlocked must be exactly true, not merely truthy',
    shipped({ 'a.com': { userBlocked: 1 } })['a.com'] === true,
    'the writer sets a real boolean; loose matching would drop real grabbers');
  check('a non-object source is handled', Object.keys(shipped(null)).length === 0);
  check('a malformed host is still rejected',
    shipped({ 'https://sub.example.com/p': grabberEntry })['https://sub.example.com/p'] === undefined);
}

/* ---- the chain this sits in, so the fix cannot be bypassed --------------- */
check('the block path is what sets userBlocked',
  /reason: 'you blocked this site',\s*hits: 1,\s*userBlocked: true,/.test(BG),
  'the filter keys on that flag');
/* Comments discuss learnDomain by name, so strip them before counting or this
   check measures the prose rather than the code. */
const BG_CODE = BG.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const learnCalls = (BG_CODE.match(/learnDomain\(/g) || []).length;
check('learnDomain still has exactly one caller, and it is the grabber one',
  learnCalls === 2 && /learnDomain\(tabHost, 'known IP-grabber behavior'\)/.test(BG_CODE),
  'found ' + learnCalls + ' (1 definition + callers); a caller writing a '
    + 'non-grabber reason would need this filter widened');
check('the bridge still derives grabber domains from the learned map',
  /learnedGrabberDomains = sanitizeBridgeHostList\(\s*Object\.keys\(learned \|\| \{\}\)/.test(BRIDGE),
  'if this moves, the filter above has to move with it');
check('and that list still feeds grabberDomains in the engine',
  /learnedGrabberDomains,/.test(BRIDGE)
    && /grabberDomains:masterOn&&\(cfg\.warnGrabberDomains\|\|cfg\.blockGrabberResources\)/.test(MIN));
check('the warning the bug produced is still the one at stake',
  /Known IP-logger detected/.test(MIN));

if (failed) {
  console.error('learned grabber scope: ' + failed + ' failed');
  process.exit(1);
}
console.log('learned grabber scope: all checks passed');

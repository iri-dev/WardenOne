/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The blocked-sites list has to show your own blocks, and let you undo them.
 *
 * Sites blocked from the right-click menu land in the same LEARNED map as the
 * ones WardenOne flags by behaviour, and the Activity Centre renders that map.
 * Two things were wrong with it:
 *
 * 1. Remove did nothing for most hand-blocked sites. remove-learned normalised
 *    the domain through normalizeLearnedDomain, which returns '' for every
 *    never-block domain -- twitch.tv, youtube.com, google.com, github.com and
 *    thirty-odd more. That veto is correct when deciding what may be BLOCKED and
 *    wrong when undoing one, and those are exactly the sites people block by
 *    hand. The row appeared in the list and its button silently did nothing.
 *
 * 2. The panel called every entry "Auto-blocked / Learned bad sites", which
 *    presents the reader's own decision back to them as something WardenOne
 *    worked out about the site.
 *
 * Run: node tools/test-blocked-site-list.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const HISTORY_JS = fs.readFileSync('history.js', 'utf8');
const HISTORY_HTML = fs.readFileSync('history.html', 'utf8');
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- the veto really does refuse these hosts ---------------------------- *
 * Runs the shipped normalizeLearnedDomain with its real never-block set, so the
 * fix below is a fix for a demonstrated problem.
 *
 * normalizeLearnedDomain is declared thousands of lines BEFORE the set it
   consults, and the set is grown by two load-time forEach loops after its
   literal -- slicing the literal alone gives a WRONG answer. So each region is
   lifted separately, in dependency order, and the size is asserted below. */
const setStart = BG.indexOf('const NEVER_BLOCK_DOMAINS');
const isNeverStart = BG.indexOf('function isNeverBlockDomain(domain) {');
const CLOSE = String.fromCharCode(10) + '}';
const isNeverEnd = BG.indexOf(CLOSE, isNeverStart) + 2;
const fnStart = BG.indexOf('function normalizeLearnedDomain(value) {');
const fnEnd = BG.indexOf(CLOSE, fnStart) + 2;
check('the never-block set and both functions are present',
  setStart >= 0 && isNeverStart > setStart && fnStart >= 0 && fnEnd > fnStart);
if (setStart < 0 || isNeverStart < 0 || fnStart < 0) {
  console.error('blocked site list: cannot continue');
  process.exit(2);
}

const box = {
  String, Object, Set, RegExp, console,
  LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: [],
  WARDENONE_PRIVATE_SUFFIXES: [],
  WARDENONE_OPAQUE_TENANT_SUFFIXES: [],
  normalizeAllowlistHost: (v) => String(v || '').trim().toLowerCase().replace(/^www\./, ''),
  registrableDomainBg: (h) => {
    const p = String(h || '').split('.');
    return p.length > 2 ? p.slice(-2).join('.') : String(h || '');
  },
  X_APP_COMPAT_DOMAINS: new Set(),
};
vm.createContext(box);
vm.runInContext(
  BG.slice(setStart, isNeverEnd) + String.fromCharCode(10) + BG.slice(fnStart, fnEnd)
    + ';globalThis.norm=normalizeLearnedDomain;globalThis.never=NEVER_BLOCK_DOMAINS;',
  box, { filename: 'background.js:never-block' });

check('the never-block set really is grown past its literal',
  box.never.size > 10 && box.never.has('youtube.com'),
  'size ' + box.never.size + '; a naive Set-literal slice gives the wrong answer here');
check('the veto refuses twitch.tv, which is what made Remove silent',
  box.norm('twitch.tv') === '',
  'if this returns a domain the bug is gone and the fallback can be reconsidered');
check('an ordinary domain still normalises', box.norm('evil.example') === 'evil.example');

/* ---- so removal keys on the map, not the normaliser --------------------- */
const rm = BG.slice(BG.indexOf("msg.kind === 'remove-learned'"), BG.indexOf("msg.kind === 'clear-learned'"));
check('removal looks for the key that is actually in the map first',
  /const key = Object\.prototype\.hasOwnProperty\.call\(LEARNED, raw\)/.test(rm),
  'normalising first is what dropped twitch.tv on the floor');
check('and still falls back to the normaliser for anything else',
  /: normalizeLearnedDomain\(msg\.domain\);/.test(rm),
  'a row written by an older build may not match its key verbatim');
check('the raw key is lowercased and www-stripped the way the map keys are',
  /\.trim\(\)\.toLowerCase\(\)\.replace\(\/\^www\\\.\/, ''\)/.test(rm));
check('it only deletes a key that exists',
  /if \(key && Object\.prototype\.hasOwnProperty\.call\(LEARNED, key\)\) delete LEARNED\[key\]/.test(rm));

/* Simulate both routes against a map holding a hand-blocked never-block domain
   and an auto-learned one, to prove the shipped shape removes both. */
{
  const LEARNED = { 'twitch.tv': { userBlocked: true }, 'evil.example': { reason: 'x' } };
  const remove = (domain) => {
    const raw = String(domain || '').trim().toLowerCase().replace(/^www\./, '');
    const key = Object.prototype.hasOwnProperty.call(LEARNED, raw) ? raw : box.norm(domain);
    if (key && Object.prototype.hasOwnProperty.call(LEARNED, key)) delete LEARNED[key];
  };
  remove('twitch.tv');
  check('a hand-blocked never-block domain can be removed', !('twitch.tv' in LEARNED),
    'this is the reported bug');
  remove('evil.example');
  check('an auto-learned domain can still be removed', !('evil.example' in LEARNED));
  /* Negative control: the old shape, to show the difference is the fix. */
  const OLD = { 'twitch.tv': { userBlocked: true } };
  const d = box.norm('twitch.tv');
  if (d) delete OLD[d];
  check('the OLD shape really did leave it behind', 'twitch.tv' in OLD,
    'if this fails the veto changed and this whole file needs rereading');
}

/* ---- the list has to say which kind each row is ------------------------- */
check('the list ships the userBlocked flag to the page',
  /userBlocked: LEARNED\[d\]\.userBlocked === true,/.test(BG),
  'without it the page cannot tell a hand block from a detection');
check('a hand-blocked row says the reader did it',
  /it\.userBlocked\s*\n?\s*\? 'You blocked this site - '/.test(HISTORY_JS),
  '"seen 1x" reads like a detection count for something that was a decision');
check('and its button says Unblock rather than Remove',
  /btn\.textContent = it\.userBlocked \? 'Unblock' : 'Remove';/.test(HISTORY_JS));
check('the in-progress label matches the action',
  /it\.userBlocked \? 'Unblocking\.\.\.' : 'Removing\.\.\.'/.test(HISTORY_JS));

/* ---- and the panel must not credit your decision to WardenOne ----------- */
check('the panel is no longer titled as automatic-only',
  !/Auto-blocked<\/span><h2>Learned bad sites<\/h2>/.test(HISTORY_HTML),
  'that heading described every row as something WardenOne worked out');
check('it is titled for what it is',
  /<h2>Blocked sites<\/h2>/.test(HISTORY_HTML));
check('the note names both kinds',
  /ones you blocked yourself from the right-click menu/.test(HISTORY_HTML)
    && /WardenOne flagged by behavior/.test(HISTORY_HTML));
check('the empty state no longer says these only come from browsing',
  !/None yet - WardenOne learns these as you browse\./.test(HISTORY_HTML)
    && !/None yet - WardenOne learns these as you browse\./.test(HISTORY_JS));
check('clearing everything warns that it includes your own blocks',
  /including the ones you blocked yourself/.test(HISTORY_JS));

if (failed) {
  console.error('blocked site list: ' + failed + ' failed');
  process.exit(1);
}
console.log('blocked site list: all checks passed');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What WardenOne does on university and school sites, and whether it says so.
 *
 * The manifest used to keep the whole page engine off every page under eight education suffixes
 * (and UCAS), so a course page or a library catalogue got no phishing, skimmer, scam-lock or
 * form-trap checks at all. The engine now runs there and pauses a named list, EDU_COMPAT_PAUSED:
 * the protections that can break signing in, a class or an exam. The rule is the YouTube one --
 * name what is paused, never what survives -- and one more: only names the engine itself reads,
 * so the list never claims to pause something another script still does.
 *
 * The fingerprint realm stays out of these sites in the manifest, since identity providers read
 * browser signals to decide when to ask for a second sign-in step.
 *
 * tools/test-engine-config-ownership.js boots the real config chain for university hosts and
 * look-alikes; this file pins the list, the popup's copy of it and the manifest.
 *
 * Run: node tools/test-education-compat.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync('src/content.js', 'utf8');
const MIN = fs.readFileSync('content.min.js', 'utf8');
const POPUP = fs.readFileSync('popup.js', 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
let failed = 0;
let checks = 0;

function check(what, ok, why) {
  checks++;
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- the shipped list and host test ------------------------------------------- */
const a = MIN.indexOf('EDU_COMPAT_HOST=');
const b = MIN.indexOf('],WO={}', a);
check('the education list is in the shipped engine', a >= 0 && b > a);
if (a < 0 || b < a) { console.error('education compat: cannot continue'); process.exit(2); }
const box = {};
vm.createContext(box);
vm.runInContext('const ' + MIN.slice(a, b + 1) + ';globalThis.L=EDU_COMPAT_PAUSED;globalThis.H=EDU_COMPAT_HOST;', box,
  { filename: 'content.min.js:edu-compat' });
const PAUSED = box.L;
const HOST = box.H;
check('it is a non-empty list of names', Array.isArray(PAUSED) && PAUSED.length > 0);
check('no name is listed twice', new Set(PAUSED).size === PAUSED.length);

/* ---- every name is a real setting the engine reads ------------------------------ */
const region = SRC.slice(SRC.indexOf('enabled:!0'), SRC.indexOf('enabled:!0') + 14000);
const defaults = {};
for (const m of region.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*):(!0|!1),?$/gm)) defaults[m[1]] = m[2] === '!0';
check('the defaults block was found', Object.keys(defaults).length > 50, Object.keys(defaults).length + ' keys');
const unknown = PAUSED.filter((k) => typeof defaults[k] !== 'boolean');
check('every paused name is a real boolean setting', unknown.length === 0, 'unknown: ' + unknown.join(', '));
const unread = PAUSED.filter((k) => !new RegExp('WO\\.' + k + '\\b|WO\\["' + k + '"\\]').test(SRC));
check('every paused name is one the engine reads, so pausing it does something', unread.length === 0,
  'not read by the engine (another script runs it, so listing it would claim a pause that is not there): ' + unread.join(', '));
const defaultOn = PAUSED.filter((k) => defaults[k] === true);
check('the list is not padding: most of it is on by default', defaultOn.length >= PAUSED.length - 2,
  defaultOn.length + ' of ' + PAUSED.length);

/* What still runs on a university site with the default install. */
const survivors = Object.keys(defaults).filter((k) => defaults[k] === true && !PAUSED.includes(k));
for (const k of ['detectPhishing', 'detectSkimmers', 'paymentCardGuard', 'formTrapDetector', 'scamLockGuard', 'commandPasteGuard', 'cleanCopyLinks', 'stripTrackingParams']) {
  check(k + ' still runs on university sites', survivors.includes(k));
}

/* ---- the host test ------------------------------------------------------------- */
for (const host of ['ox.ac.uk', 'cs.stanford.edu', 'unimelb.edu.au', 'auckland.ac.nz', 'uct.ac.za', 'iitb.ac.in', 'nus.edu.sg', 'hku.edu.hk', 'ucas.com', 'www.ucas.com']) {
  check(host + ' is a university site', HOST.test(host));
}
for (const host of ['edu.example.com', 'ac.uk.example.com', 'notedu', 'example.education', 'stanford.edu.attacker.net', 'myedu.com', 'ucas.com.evil.net']) {
  check(host + ' is not', !HOST.test(host));
}

/* ---- the popup says what is paused, from the same list -------------------------- */
const setAt = POPUP.indexOf('const SITE_DASH_EDU_PAUSED = new Set([');
const setEnd = POPUP.indexOf(']);', setAt);
check('the popup carries the education list', setAt >= 0 && setEnd > setAt);
const popupList = Array.from(POPUP.slice(setAt, setEnd).matchAll(/'([A-Za-z]+)'/g)).map((m) => m[1]);
check('the popup lists exactly what the engine pauses',
  popupList.length === PAUSED.length && popupList.every((k) => PAUSED.includes(k)),
  'popup: ' + popupList.join(',') + ' / engine: ' + PAUSED.join(','));
const partlyList = (/const SITE_DASH_EDU_PARTLY = new Set\(\[([^\]]*)\]\)/.exec(POPUP) || [])[1] || '';
const partly = Array.from(partlyList.matchAll(/'([A-Za-z]+)'/g)).map((m) => m[1]);
check('the popup names what is only partly paused', partly.length > 0);
check('what the popup calls partly paused is on the list', partly.every((k) => PAUSED.includes(k)));
check('and is partly run elsewhere, which is why', partly.every((k) => fs.readFileSync('anti-redirect.js', 'utf8').includes(k)));
const popupHost = /function siteDashIsEducation\(host\) \{\s*return (\/[^\n]+\/i)\.test/.exec(POPUP);
check('the popup recognises university sites with the engine\'s own test', !!popupHost && popupHost[1] === HOST.toString(),
  popupHost ? popupHost[1] + ' vs ' + HOST : 'not found');
check('the popup says why', /Paused' \+ ' here so sign-in and classes work'|here so sign-in and classes work/.test(POPUP));

/* ---- the manifest: the engine runs there, the fingerprint realm does not -------- */
const SUFFIX_PATTERNS = HOST.source.replace(/^\(\^\|\\\.\)\(|\)\$$/g, '').split('|').map((s) => 'https://*.' + s.replace(/\\\./g, '.') + '/*');
check('the host test parses into its suffixes', SUFFIX_PATTERNS.length >= 9, SUFFIX_PATTERNS.join(' '));
const engine = MANIFEST.content_scripts.find((e) => e.js.includes('content.min.js'));
const realm = MANIFEST.content_scripts.find((e) => e.js.includes('fingerprint-realm.js'));
check('the engine is no longer kept off university sites',
  !SUFFIX_PATTERNS.some((p) => (engine.exclude_matches || []).includes(p)),
  (engine.exclude_matches || []).filter((p) => SUFFIX_PATTERNS.includes(p)).join(' '));
check('the fingerprint realm still is, on exactly the suffixes the engine pauses for',
  SUFFIX_PATTERNS.every((p) => (realm.exclude_matches || []).includes(p)),
  SUFFIX_PATTERNS.filter((p) => !(realm.exclude_matches || []).includes(p)).join(' '));

if (failed) {
  console.error('education compat: ' + failed + ' of ' + checks + ' failed');
  process.exit(1);
}
console.log('education compat: all ' + checks + ' checks passed (' + PAUSED.length + ' paused by name, '
  + survivors.length + ' default-on protections running on university sites)');

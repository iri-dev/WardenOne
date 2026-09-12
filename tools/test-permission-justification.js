/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Every permission in the manifest must be used by shipped code and explained to the reader.
 *
 * tabGroups was declared for long enough to reach a release candidate while nothing called
 * chrome.tabGroups at all -- Memory Shield reads tab.groupId, which belongs to chrome.tabs,
 * and background-memory.js says so in its own comment. The cost was not theoretical: it put
 * "View and manage your tab groups" in the install warning of a privacy extension, for an
 * API it never touched. Three more permissions -- declarativeNetRequestFeedback,
 * contextMenus and offscreen -- were declared and left off the permissions page, which
 * promises to show why each permission exists (CWS-02).
 *
 * Both halves are asserted here, in both directions, so the next permission added has to
 * arrive with a caller and an explanation, and one that is removed cannot leave a stale
 * row behind.
 *
 * Run: node tools/test-permission-justification.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const PERMS_HTML = fs.readFileSync(path.join(ROOT, 'permissions.html'), 'utf8');

let failures = 0;
function check(label, condition, extra) {
  if (condition) { console.log('  ok  ' + label); return; }
  failures++;
  console.log('  FAIL ' + label + (extra ? ' :: ' + extra : ''));
}

/* Every root script that actually ships. src/ and tools/ are export-ignored, and
   content.min.js is generated from src/content.js, so reading both would double-count. */
const shipped = fs.readdirSync(ROOT)
  .filter((f) => /\.js$/.test(f))
  .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8'));

/* Comments are stripped before anything is matched. background-memory.js explains that
   "nothing below calls chrome.tabGroups." -- and the full stop ending that sentence made
   a search for a call to chrome.tabGroups match the very comment saying there isn't one.
   An assertion about code has to read code. */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
}
const CODE = shipped.map(stripComments).join('\n');

/* Permissions with no chrome.<namespace> of their own. Each needs a reason recorded here
   rather than a silent pass, because "it has no namespace" is exactly how an unused
   permission hides. */
const NO_NAMESPACE = {
  activeTab: 'grants temporary host access on user invocation; there is no chrome.activeTab',
  declarativeNetRequestFeedback: 'gates declarativeNetRequest.getMatchedRules and onRuleMatchedDebug',
  webRequest: 'observational listeners live on chrome.webRequest, checked below',
};

/* ---- every declared permission is used ------------------------------------------- */

const unused = [];
for (const perm of MANIFEST.permissions) {
  if (NO_NAMESPACE[perm]) continue;
  /* A real call, not a mention. Optional chaining counts: most of these namespaces are
     reached as chrome.webNavigation?.onCommitted, and a matcher that only accepted a bare
     dot reported a permission used six times over as never called. */
  const called = new RegExp('chrome\\.' + perm + '\\s*\\??\\s*(?:\\.|\\[)').test(CODE)
    /* some namespaces are reached through a local binding, e.g. contentSettings */
    || new RegExp('=\\s*chrome\\.' + perm + '\\b').test(CODE);
  if (!called) unused.push(perm);
}
check('every declared permission has a caller in shipped code', unused.length === 0,
  unused.join(', ') + ' -- declared, warned about at install, and never called');

/* the two that are reached indirectly, asserted by their real call sites so this file
   cannot quietly excuse a permission that stopped being used */
check('declarativeNetRequestFeedback is actually consumed',
  /declarativeNetRequest\.getMatchedRules\s*\(/.test(CODE)
  && /declarativeNetRequest\.onRuleMatchedDebug/.test(CODE),
  'if the Logger stops using both, the permission should go with them');
check('webRequest is actually consumed', /chrome\.webRequest\.[A-Za-z]/.test(CODE));

/* tabGroups specifically: the one that was declared while nothing called it. */
check('tabGroups is not declared', !MANIFEST.permissions.includes('tabGroups'),
  'nothing calls chrome.tabGroups; tab.groupId comes from chrome.tabs');
check('and nothing calls it either', !/chrome\.tabGroups\s*\./.test(CODE),
  'if this ever becomes true the permission has to come back with it');

/* ---- every declared permission is explained -------------------------------------- */

const unexplained = MANIFEST.permissions.filter((p) => !PERMS_HTML.includes('<code>' + p + '</code>'));
check('every declared permission has a row on the permissions page', unexplained.length === 0,
  unexplained.join(', ') + ' -- the page promises why each permission exists');

/* ---- and nothing is explained that is not declared -------------------------------- */

const rows = [...PERMS_HTML.matchAll(/<div class="perm-id"><code>([a-zA-Z]+)<\/code>/g)].map((m) => m[1]);
const declared = new Set(MANIFEST.permissions);
const stale = rows.filter((r) => !declared.has(r));
check('the page explains no permission the manifest no longer asks for', stale.length === 0,
  stale.join(', ') + ' -- a row outliving its permission tells the reader WardenOne wants more than it does');

/* ---- the numbers the page prints are the manifest's ------------------------------ */

/* The page said "16 browser permissions" while the manifest declared 19, then 18: the number was
   typed once and never looked at again, and it was photographed for the Store listing that way
   (CWS-04). It is pinned to the manifest here, in both counters. */
const stat = (label) => Number((new RegExp('<strong>(\\d+)</strong><span>' + label + '</span>').exec(PERMS_HTML) || [])[1]);
check('the page counts as many browser permissions as the manifest declares',
  stat('browser permissions') === MANIFEST.permissions.length,
  'page says ' + stat('browser permissions') + ', manifest declares ' + MANIFEST.permissions.length);
check('and as many host scopes',
  stat('host scopes') === (MANIFEST.host_permissions || []).length,
  'page says ' + stat('host scopes') + ', manifest declares ' + (MANIFEST.host_permissions || []).length);

/* ---- host permissions are not quietly widened ------------------------------------ */

check('no optional permissions are declared without being explained',
  !MANIFEST.optional_permissions || MANIFEST.optional_permissions.every(
    (p) => PERMS_HTML.includes('<code>' + p + '</code>')));

console.log('');
if (failures) {
  console.log(failures + ' check(s) failed');
  process.exit(1);
}
console.log('all permission-justification checks passed');

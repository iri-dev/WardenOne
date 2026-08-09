/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

/*
 * Insecure sign-in guard.
 *
 * Warns before a password is typed into an unencrypted page. The whole feature
 * lives or dies on one regex: which hosts count as "local network" and are
 * therefore left alone. Get it too narrow and the guard nags on every router,
 * NAS and printer admin page, where http is normal and there is no https to
 * offer -- that is how a real warning trains people to dismiss warnings.
 *
 * So the exclusion list is pulled out of src/content.js and run against actual
 * addresses rather than eyeballed.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src/content.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');

let passed = 0;
function check(name, cond, extra) {
  assert(cond, name + (extra ? ' :: ' + extra : ''));
  console.log('  ok  - ' + name);
  passed++;
}

/* ---- the exclusion regex, executed ---- */
const m = CONTENT.match(/isLocalNetworkHost=(\/(?:[^/\\\n]|\\.)+\/[a-z]*)\.test\(host\)/);
assert(m, 'could not find isLocalNetworkHost in src/content.js');
const LOCAL = eval(m[1]);

const LEAVE_ALONE = [
  ['localhost', 'loopback by name'],
  ['127.0.0.1', 'loopback'],
  ['::1', 'loopback v6'],
  ['192.168.1.1', 'the router everyone has'],
  ['192.168.0.254', 'router, other vendor'],
  ['10.0.0.138', 'private class A'],
  ['172.16.4.2', 'private class B, low end'],
  ['172.31.255.9', 'private class B, high end'],
  ['169.254.1.5', 'link-local'],
  ['nas', 'dotless intranet name'],
  ['printer.local', 'mDNS'],
  ['git.internal', 'internal suffix'],
];
const MUST_WARN = [
  ['example.com', 'ordinary site'],
  ['mail.example.co.uk', 'ordinary site'],
  ['172.32.0.1', 'just OUTSIDE the private class B range'],
  ['172.15.0.1', 'just BELOW the private class B range'],
  ['11.0.0.1', 'public, adjacent to private class A'],
  ['193.168.1.1', 'public, one digit off the router range'],
  ['192.169.1.1', 'public, one digit off the router range'],
  ['evil-192.168.1.1.attacker.com', 'private address as a subdomain label'],
];

let bad = [];
LEAVE_ALONE.forEach(([h, why]) => { if (!LOCAL.test(h)) bad.push(h + ' (' + why + ') would nag'); });
check('every local-network address is left alone', bad.length === 0, bad.join('; '));

bad = [];
MUST_WARN.forEach(([h, why]) => { if (LOCAL.test(h)) bad.push(h + ' (' + why + ') would be skipped'); });
check('no public address is mistaken for local', bad.length === 0, bad.join('; '));

/* ---- behaviour ---- */
const block = CONTENT.slice(CONTENT.indexOf('if(WO.insecureLoginGuard!==!1)'), CONTENT.indexOf('if(WO.pasteProtection)'));
check('it fires on password fields only',
  /"password"!==String\(el\.type\|\|""\)\.toLowerCase\(\)/.test(block));
check('it warns on focus, before anything is typed', /"focusin"/.test(block));
check('it also catches an https page whose form posts to http',
  /formDowngrades/.test(block) && /"http:"===new URL\(action,location\.href\)\.protocol/.test(block));
check('it offers the secure version of the page',
  /u\.protocol="https:"/.test(block) && /location\.replace/.test(block));
check('it warns once per page rather than on every focus',
  /if\(insecureWarned\)return/.test(block));
check('it never blocks the sign-in, only warns',
  !/preventDefault|\.disabled\s*=\s*!0|stopImmediatePropagation/.test(block),
  'this has to fail open -- a wrong guess must not lock someone out of their account');
/* A warning with no way through is one people learn to route around, and we can
   be wrong: an internal site on a plain hostname, a captive portal, a device we
   did not recognise as local. The way through must exist AND must say plainly
   that it is a bad idea. */
check('there is always a way to continue', /Continue anyway/.test(block));
check('continuing is labelled as not recommended', /Continue anyway\s+-\s+not recommended/.test(block),
  'the escape hatch must not read as a neutral choice');
check('the secure option is the primary button, not the escape hatch',
  /mkBtn\("Try the secure version",\s*!0\)/.test(block)
    && /mkBtn\("Continue anyway\s+-\s+not recommended",\s*!1\)/.test(block));
check('it says what to do if they continue anyway',
  /avoid reusing this password anywhere else/.test(block));
check('it is recorded in the activity log', /log\("warned_insecure_login"/.test(block));

/* ---- wiring ---- */
check('defaults ON in background', /insecureLoginGuard: true/.test(BG));
check('defaults ON in popup', /insecureLoginGuard: true/.test(POPUP_JS));
check('the popup exposes a toggle', /data-key="insecureLoginGuard"/.test(POPUP_HTML));
check('the popup says local logins are exempt', /local-network logins are left alone/i.test(POPUP_HTML));
check('it counts toward the protection health score',
  /'insecureLoginGuard'/.test(BG.slice(BG.indexOf('HEALTH_SHIELD_KEYS'))));
check('the activity log has a label for it', /warned_insecure_login:/.test(HISTORY));

/* ---- the guard is only meaningful if it survives the build ---- */
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
check('the guard is present in the built runtime, not just the source',
  /warned_insecure_login/.test(MIN) && /insecureLoginGuard/.test(MIN));

console.log('\n' + passed + ' passed, 0 failed');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Hyperlink auditing: <a ping> removal, inside Link Cleanup.
 *
 * <a href="https://example.com" ping="https://tracker.example/click"> sends a request to
 * the ping URL when the link is clicked. The link looks and behaves completely normally.
 *
 * Two things have to hold, and they pull in opposite directions:
 *   - the ping goes, ALWAYS -- including to the site's own domain and to hosts no
 *     blocklist knows, which is the whole reason the network layer was not enough; and
 *   - href is untouched, so the click still lands where the reader could see it would.
 *
 * It also must not become its own feature: no toggle, no panel, no protection-count
 * entry. It rides the Link Cleanup switch that was already there.
 *
 * The real scrubber is lifted out of src/content.js and run against a small DOM.
 *
 * Run: node tools/test-link-ping-strip.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const HISTORY_JS = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

/* ---- the scrubber, run for real ------------------------------------------- */
const start = SRC.indexOf('let pingStripCount=0;');
const end = SRC.indexOf('sweepDomLinks=root=>{', start);
check('the scrubber is where the slice expects it', start > 0 && end > start);
/* The slice stops mid-declaration-list (scrubDomLink and sweepDomLinks share one
   `const`), so the dangling comma becomes a terminator. */
const BLOCK = SRC.slice(start, end).replace(/,\s*$/, ';');

/* An element that answers only what the scrubber asks it. Nothing here measures or
   lays out -- if the scrubber ever starts wanting geometry on a click path, this
   harness will throw and say so. */
function makeEl(tag, attrs) {
  const a = Object.assign({}, attrs || {});
  return {
    tagName: tag,
    __attrs: a,
    hasAttribute(n) { return Object.prototype.hasOwnProperty.call(a, n); },
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(a, n) ? a[n] : null; },
    setAttribute(n, v) { a[n] = String(v); },
    removeAttribute(n) { delete a[n]; },
  };
}

function run(world) {
  const logs = [];
  const sandbox = {
    String, Number, Boolean, Object, Math, Date, RegExp, console,
    WO: Object.assign({ unshimLinks: true, stripTrackingParams: true }, world.WO || {}),
    /* Present so the same-site case below can actually be same-site. Without it, code
       that tried to compare the ping against the page's own host would throw into the
       scrubber's catch and strip anyway -- and the check would pass for the wrong
       reason, which is worse than failing. */
    location: { href: 'https://shop.example/p/1', hostname: 'shop.example', protocol: 'https:' },
    URL,
    log: (type, detail) => logs.push({ type, detail }),
    /* Link cleanup's other half. Held to identity so this suite can only ever fail on
       the ping behaviour, never on redirect unwrapping changing somewhere else. */
    stripTracking: (href) => href,
  };
  vm.createContext(sandbox);
  vm.runInContext(BLOCK + ';globalThis.__strip = stripPingAttr;globalThis.__scrub = scrubDomLink;',
    sandbox, { filename: 'src/content.js:pingstrip' });
  return { scrub: sandbox.__scrub, strip: sandbox.__strip, logs };
}

/* ---- the ping goes, always ------------------------------------------------ */
{
  const { scrub } = run({});
  const el = makeEl('A', { href: 'https://example.com/', ping: 'https://tracker.example/click' });
  scrub(el);
  check('the ping attribute is removed', !el.hasAttribute('ping'));
  check('and the destination is left exactly as it was',
    el.getAttribute('href') === 'https://example.com/',
    'got ' + el.getAttribute('href') + '; the reader clicked what they could see');
}
{
  /* The case a blocklist cannot reach, and the reason this exists at all. */
  const { scrub } = run({});
  const el = makeEl('A', { href: 'https://shop.example/p/1', ping: 'https://shop.example/click' });
  scrub(el);
  check('a ping to the site\'s OWN domain is removed too', !el.hasAttribute('ping'),
    'a first-party beacon is on no blocklist, which is exactly why the network layer '
    + 'could not be the whole answer');
}
{
  const { scrub } = run({});
  const el = makeEl('AREA', { href: 'https://example.com/', ping: 'https://tracker.example/x' });
  scrub(el);
  check('<area ping> is covered as well as <a ping>', !el.hasAttribute('ping'),
    'the attribute is legal on both, and a map link is still a link');
}
{
  /* A ping with no href at all: a beacon wearing a link's clothes. The old early
     return on a missing href would have walked straight past it. */
  const { scrub } = run({});
  const el = makeEl('A', { ping: 'https://tracker.example/click' });
  scrub(el);
  check('a ping-only anchor is still stripped', !el.hasAttribute('ping'));
}
check('and the sweep selector actually looks for those',
  /a\[href\],area\[href\],form\[action\],a\[ping\],area\[ping\]/.test(SRC),
  'a[href] alone never visits an anchor that has only a ping');
{
  const { scrub } = run({});
  const el = makeEl('A', { href: 'https://example.com/' });
  scrub(el);
  check('a link with no ping is left alone', el.getAttribute('href') === 'https://example.com/'
    && !el.hasAttribute('ping'));
}
{
  const { scrub } = run({});
  const form = makeEl('FORM', { action: 'https://example.com/go', ping: 'https://t.example/x' });
  scrub(form);
  check('a form keeps its action', form.getAttribute('action') === 'https://example.com/go');
}

/* ---- it is recorded, quietly ---------------------------------------------- */
{
  const { scrub, logs } = run({});
  scrub(makeEl('A', { href: 'https://example.com/', ping: 'https://tracker.example/click' }));
  /* Indexed through a fallback on purpose. A test that throws on logs[0] cannot report
     the four failures above it -- it just dies, and a dead test looks exactly like a
     broken check rather than like the bug it actually found. */
  const first = logs[0] || {};
  check('the removal is recorded', logs.length === 1 && first.type === 'stripped_link_ping');
  check('and records nothing about the link itself',
    JSON.stringify(first.detail) === '{}',
    'which link the reader clicked is not something to write down');
}
{
  const { strip, logs } = run({});
  for (let i = 0; i < 40; i++) strip(makeEl('A', { ping: 'https://t.example/' + i }));
  check('logging is capped', logs.length <= 20,
    'a page of a hundred links would otherwise fill the history with one event type');
  check('but stripping keeps going past the cap', logs.length === 20);
}
check('it is named in Activity rather than shown as a raw type',
  /stripped_link_ping: 'Click-tracking beacon removed'/.test(HISTORY_JS));
check('it raises no toast', !/toast\([^)]*stripped_link_ping/.test(SRC),
  'this is the small quiet kind of fix, not an announcement');

/* ---- the late-add case ----------------------------------------------------- */
check('a ping added after the sweep is caught at the click',
  /for\(const ev of\["mousedown","click"\]\)woOn\(document,/.test(SRC)
  && /a\[ping\],area\[ping\]/.test(SRC),
  'the shared observer is childList-only, so an attribute set on an existing link is '
  + 'invisible to the sweep');
check('both click listeners are passive and capture',
  /capture:!0,\s*passive:!0\s*\}\)\s*\}\s*catch\(_\)\{[\s\S]{0,40}\}\s*\/\* Assembles the/.test(SRC)
  || /stripPingOnClick[\s\S]{0,400}capture:!0,\s*passive:!0/.test(SRC),
  'a click path must not be able to block or be blamed for a slow frame');
check('the click path does not measure anything',
  !/stripPingOnClick[\s\S]{0,400}(getBoundingClientRect|offsetWidth|offsetHeight|getComputedStyle|innerText|elementFromPoint)/.test(SRC),
  'a forced layout on a pointer path is the mistake this file has already made three times');

/* ---- merged, not a new feature -------------------------------------------- */
check('there is no toggle of its own',
  !/pingGuard|stripLinkPing|hyperlinkAuditing|blockPing/i.test(BG)
  && !/data-key="[a-zA-Z]*[Pp]ing[a-zA-Z]*"/.test(POPUP_HTML),
  'it was asked for as part of Link Cleanup, not as its own panel');
check('and no entry in the protection count',
  !/'stripLinkPing'|'pingGuard'/.test(BG.match(/const HEALTH_SHIELD_KEYS = \[[\s\S]*?\];/)[0]));
check('it rides the existing Link Cleanup gate',
  /if\(!WO\.unshimLinks&&!WO\.stripTrackingParams\)return;\s*const t=e&&e\.target;/.test(SRC)
  || /stripPingOnClick=e=>\{[\s\S]{0,120}!WO\.unshimLinks&&!WO\.stripTrackingParams/.test(SRC),
  'turning Link Cleanup off has to turn this off too, or the switch is lying');
check('the popup copy says what it now also does', /ping<\/code> attributes/.test(POPUP_HTML));
check('and says the destination is untouched',
  /still goes exactly where it says/.test(POPUP_HTML));

/* ---- the network half was already there and is still there ---------------- */
check('ping is a filtered resource type for trackers',
  /const TRACKER_RESOURCE_TYPES = \[[^\]]*'ping'/.test(BG),
  'the two halves are complementary; losing this one would quietly narrow coverage');
check('and for security lists', /'xmlhttprequest', 'ping', 'csp_report'/.test(BG));

/* ---- shipped ------------------------------------------------------------- */
check('the built runtime carries it', /removeAttribute\("ping"\)/.test(MIN),
  'src/content.js is not what the browser loads');

if (failed) {
  console.error('link ping strip: ' + failed + ' failed');
  process.exit(1);
}
console.log('link ping strip: all checks passed');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Mail Shield — email tracking pixels in webmail.
 *
 * The whole feature turns on one fact: Gmail proxies remote images through
 * googleusercontent.com, so at the NETWORK layer there is no tracker domain left
 * to block — but it keeps the original URL in the FRAGMENT of the proxy URL it
 * writes into the DOM. A fragment is never sent to a server, which is why a
 * blocklist cannot see it and why this has to happen in the page.
 *
 * The classifier is lifted out of mail-shield.js and run against real markup
 * shapes, with a fake DOM element, so the rules are exercised rather than
 * described.
 *
 * The two properties that matter:
 *
 * 1. IT MUST NOT EAT REAL IMAGES. A newsletter's photographs, logos and product
 *    shots have to come through untouched. Every rule here is narrow on purpose,
 *    and the negative cases below are the point of the suite.
 * 2. A WRONG GUESS MUST BE HARMLESS. The pixel is replaced with a transparent
 *    image of the same declared size rather than blocked, so even a mistake is
 *    invisible instead of leaving a broken-image icon in someone's mail.
 *
 * Run: node tools/test-mail-shield.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SRC = fs.readFileSync('mail-shield.js', 'utf8');
const BG = fs.readFileSync('background.js', 'utf8');
const POPUP = fs.readFileSync('popup.html', 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* ---- lift the classifier ------------------------------------------------ */
const box = { URL, RegExp, String, Number, Array, Object, Math, WeakSet, Set, console, setTimeout };
box.location = { href: 'https://mail.google.com/mail/u/0/' };
box.window = {};
box.document = { readyState: 'complete', documentElement: null, addEventListener: () => {} };
box.chrome = { runtime: { sendMessage: () => {}, lastError: null } };
box.MutationObserver = function () { this.observe = () => {}; this.disconnect = () => {}; };
vm.createContext(box);
vm.runInContext(SRC, box, { filename: 'mail-shield.js' });
const api = box.window.__wardenOneMailShieldApi;
check('the classifier is reachable for testing', !!api);

/* A stand-in for an <img>: attributes are all the classifier reads, which is the
   point — it never touches the rendered box. */
function img(attrs) {
  const map = new Map(Object.entries(attrs || {}));
  return {
    tagName: 'IMG',
    getAttribute: (n) => (map.has(n) ? String(map.get(n)) : null),
    hasAttribute: (n) => map.has(n),
    setAttribute: (n, v) => map.set(n, v),
    __map: map,
  };
}
const verdict = (attrs) => api.classify(img(attrs));

/* ---- the fact the feature rests on -------------------------------------- */
const GMAIL_PROXY = 'https://ci3.googleusercontent.com/meips/ADKq_NabcDEF=s0-d-e1-ft'
  + '#https://click.marketing.example/o/eJx1kMtuwjAQRX_F';
check('the original URL is recovered from a Gmail proxy link',
  api.originalUrl(GMAIL_PROXY) === 'https://click.marketing.example/o/eJx1kMtuwjAQRX_F',
  api.originalUrl(GMAIL_PROXY));
check('a plain URL is returned unchanged',
  api.originalUrl('https://example.com/a.png') === 'https://example.com/a.png');
check('an ordinary anchor fragment is not mistaken for a proxied URL',
  api.originalUrl('https://example.com/a.png#top') === 'https://example.com/a.png#top',
  'only a fragment that is itself a URL is a recovered source');

/* ---- what must be caught ------------------------------------------------ */
const tiny = verdict({ src: 'https://track.example/pixel.gif?u=abc', width: '1', height: '1' });
check('a 1x1 image is caught', !!tiny && /1x1/.test(tiny.why), JSON.stringify(tiny));
check('a 1x1 declared in inline style is caught',
  !!verdict({ src: 'https://track.example/a.gif', style: 'width:1px;height:1px;border:0' }));
check('a hidden image is caught',
  !!verdict({ src: 'https://track.example/a.gif', style: 'display:none' }));
check('an image at opacity 0 is caught',
  !!verdict({ src: 'https://track.example/a.gif', style: 'opacity:0' }));
check('a known open-tracking host is caught even at a normal size',
  !!verdict({ src: 'https://x.list-manage.com/track/open.php?u=9f&id=3a', width: '600', height: '200' }),
  'these hosts serve nothing but beacons');
check('an open-beacon path with a recipient token is caught',
  !!verdict({ src: 'https://mail.example/wf/open?upn=dGhpcy1pcy1hLXJlY2lwaWVudC10b2tlbg' }));

/* The case the whole feature exists for. */
const proxied = verdict({ src: GMAIL_PROXY, width: '1', height: '1' });
check('a Gmail-proxied tracker is caught', !!proxied);
check('and is recorded as having been proxied', !!proxied && proxied.wasProxied === true);
check('and the tracker host is recovered, not googleusercontent',
  !!proxied && proxied.u.hostname === 'click.marketing.example', proxied && proxied.u.hostname);

/* ---- what must NOT be caught: the point of the suite -------------------- */
const keep = [
  ['a newsletter photograph', { src: 'https://cdn.example.com/img/hero-2026.jpg', width: '600', height: '320' }],
  ['a logo with no dimensions', { src: 'https://cdn.example.com/logo.png' }],
  ['a product shot behind a proxy', { src: 'https://ci3.googleusercontent.com/meips/AAA=s0-d-e1-ft#https://shop.example/img/shoe.jpg', width: '400', height: '400' }],
  ['an inline attachment', { src: 'cid:part1.abc@mail', width: '1', height: '1' }],
  ['an image the client drew itself', { src: 'data:image/png;base64,iVBORw0KGgo=', width: '1', height: '1' }],
  ['a blob the composer made', { src: 'blob:https://mail.google.com/1234', width: '1', height: '1' }],
  ['an image with no source at all', {}],
  ['a normal image on a path that merely contains "open"',
    { src: 'https://cdn.example.com/open-day/photo.jpg', width: '800', height: '600' }],
  ['a beacon-shaped path with no recipient token',
    { src: 'https://cdn.example.com/pixel.gif?v=2', width: '300', height: '250' }],
  ['a 4x4 spacer, which is above the threshold', { src: 'https://x.example/s.gif', width: '4', height: '4' }],
];
for (const [name, attrs] of keep) {
  const v = verdict(attrs);
  check('left alone: ' + name, v === null, v && v.why);
}
/* A tall thin divider is 1px in ONE dimension and is a real design element. */
check('a 1px-tall divider rule is left alone',
  verdict({ src: 'https://cdn.example.com/rule.gif', width: '600', height: '1' }) === null,
  'both dimensions have to be tiny, or every horizontal rule in every newsletter goes');

/* ---- lazy attributes ---------------------------------------------------- */
check('a tracker parked in data-src is caught',
  !!verdict({ 'data-src': 'https://x.list-manage.com/track/open.php?u=1', width: '1', height: '1' }),
  'webmail parks the real URL there and swaps it in later');
/* Sliced to neutralise(). The first version compared indexes across the whole
   file, so the 'data-lazy-src' it anchored on was the one in classify() far
   above -- the ordering check stayed true however neutralise() was rewritten. */
const neutraliseFn = SRC.slice(SRC.indexOf('function neutralise('), SRC.indexOf('let lastWhy'));
check('the neutraliser body is where the slice expects it', neutraliseFn.length > 0);
check('the neutraliser clears the lazy attributes too',
  /for \(const attr of \['srcset', 'data-src'/.test(neutraliseFn));
check('and clears them BEFORE src',
  neutraliseFn.indexOf('data-lazy-src') < neutraliseFn.indexOf("img.setAttribute('src', PIXEL)"),
  'cleaning src first lets the client swap the real URL back in afterwards');

/* ---- neutralise, do not block ------------------------------------------- */
check('the replacement is a transparent pixel, not a removal',
  /const PIXEL = 'data:image\/gif;base64,/.test(SRC) && !/\.remove\(\)/.test(SRC),
  'a refused request leaves broken-image icons through a newsletter');
check('a wrong guess is harmless by construction',
  /FALSE\s*\n?\s*\*?\s*POSITIVE IS HARMLESS BY CONSTRUCTION/i.test(SRC)
    || /spacer GIFs/i.test(SRC),
  'the substitute is the same declared size, so even a mistake is invisible');
check('the decision is made from markup, never the rendered box',
  !/getBoundingClientRect|offsetWidth|naturalWidth|getComputedStyle/.test(SRC),
  'a measurable box means it already loaded, and the tracker already fired');

/* ---- wiring ------------------------------------------------------------- */
check('it is registered only for webmail, not every site',
  /const MAIL_SHIELD_MATCHES = \[/.test(BG) && !/id: MAIL_SHIELD_SCRIPT_ID,[\s\S]{0,120}<all_urls>/.test(BG),
  'reading every <img> on the web to find the few in an inbox is a cost paid for nothing');
for (const host of ['mail.google.com', 'outlook.live.com', 'mail.proton.me', 'mail.yahoo.com']) {
  check('covers ' + host, BG.includes("'*://" + host + "/*'"));
}
check('it runs in subframes, because the reading pane is one',
  /id: MAIL_SHIELD_SCRIPT_ID,[\s\S]{0,600}allFrames: true/.test(BG));
check('it can be turned off',
  /function mailShieldActive\(cfg\)/.test(BG) && /cfg\.mailTrackingShield !== false/.test(BG)
    && /data-key="mailTrackingShield"/.test(POPUP));
check('turning it off unregisters the script',
  /if \(!want && have\) \{[\s\S]{0,200}MAIL_SHIELD_SCRIPT_ID/.test(BG),
  'a disabled feature that still injects is not disabled');
check('it counts as a protection in the health total',
  /'mailTrackingShield'/.test(BG.slice(BG.indexOf('const HEALTH_SHIELD_KEYS'), BG.indexOf('const HEALTH_SHIELD_KEYS') + 4000)));
check('the page asks whether it is switched on before doing anything',
  /kind: 'content-config-get'/.test(SRC) && /cfg\.mailTrackingShield === false/.test(SRC));
check('it needs no permission the extension does not already have',
  !/optional_permissions|declarativeNetRequest/.test(SRC)
    && (MANIFEST.permissions || []).includes('scripting'));

/* ---- honesty ------------------------------------------------------------ */
const popupRow = POPUP.slice(POPUP.indexOf('Stop email tracking pixels'),
  POPUP.indexOf('data-key="mailTrackingShield"')).replace(/\s+/g, ' ');
check('the popup names the providers it works in', /Gmail, Outlook, Proton/.test(popupRow));
check('the popup does not promise to stop all email tracking',
  !/all (email )?tracking|every tracker|completely/i.test(popupRow), popupRow.slice(0, 120));
check('the popup admits the limit when a provider leaves no trace',
  /leaves no trace of the source/.test(popupRow));
/* Measured against a local server: a data-src pixel never reaches the log, one
   already in src shows as ERR_ABORTED. Claiming nothing is ever requested would
   be wrong for the second case. */
check('the file records the prevented-versus-cancelled distinction',
  /PREVENTED versus CANCELLED/.test(SRC) && /ERR_ABORTED/.test(SRC));
check('the popup does not claim nothing is requested',
  !/nothing is requested/.test(popupRow) && /cancelled mid-flight/.test(popupRow), popupRow.slice(0,140));
check('the popup admits a provider may have fetched it server-side',
  /outside what any extension can see/.test(popupRow),
  'stopping the browser fetching a proxied image says nothing about the provider fetching it');

if (failed) {
  console.error('mail shield: ' + failed + ' failed');
  process.exit(1);
}
console.log('mail shield: all checks passed');

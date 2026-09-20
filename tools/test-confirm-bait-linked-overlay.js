/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The confirm-bait guard and a hover overlay that lives inside a link.
 *
 * On YouTube, scrolling past a Mix or a playlist made the badge count a block, with nothing
 * shown. The confirm-bait sweep in anti-redirect.js judges an overlay on shape: an absolutely
 * positioned box, short text, no subject, one to four controls, one of them an affirmative word
 * with no href of its own. A Mix thumbnail carries exactly that box -- YouTube's own stylesheet
 * gives .ytThumbnailHoverOverlayViewModelHost position:absolute, top:0, left:0, width and height
 * 100%, opacity 0 until hovered -- and its only text is "Play all", which matches the guard's
 * affirmative list. The leaf saying "Play all" has no href because the WHOLE card is the link:
 * the lockup renders its content image inside <a href="/watch?v=...&list=RD...">. So the box was
 * removed on sight and reported as blocked_confirm_bait, a quiet event that still bumps the badge.
 *
 * The rail now asks whether the affirmative control goes somewhere on itself OR through the link
 * it sits inside. This suite drives the shipped confirmBaitOverlay with the YouTube shapes (new
 * lockup and classic renderer), the same shapes with the link taken away (still bait), and the
 * dialogs the guard exists for (still bait).
 *
 * Run: node tools/test-confirm-bait-linked-overlay.js
 * Control: WARDENONE_ANTI_REDIRECT=<pre-fix anti-redirect.js> -- the two YouTube cases fail there.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const GUARD = fs.readFileSync(process.env.WARDENONE_ANTI_REDIRECT || path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail === undefined ? '' : ' -- ' + detail));
}

/* The real shipped function, lifted the way tools/test-frame-redirect-guard.js lifts it. */
const a = GUARD.indexOf('const BAIT_CONTROL');
const b = GUARD.indexOf('function confirmBaitEnabled');
const baitSrc = a > 0 && b > a ? GUARD.slice(a, b) : '';
let isBaitBox = null;
try { isBaitBox = vm.runInNewContext(baitSrc + ';confirmBaitOverlay', {}); } catch (e) { isBaitBox = null; }
check('the shipped confirmBaitOverlay lifts', typeof isBaitBox === 'function');

/* A tiny element model: enough tree for querySelector/querySelectorAll/parentElement, the
   attributes the guard reads, and innerText computed from the leaves (the way a real element
   reports the text of everything under it). */
function el(tag, attrs, children, text) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    attrs: attrs || {},
    children: children || [],
    ownText: text || '',
    parentElement: null,
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(this.attrs, k) ? this.attrs[k] : null; },
    get innerText() {
      const parts = [this.ownText];
      this.children.forEach((c) => parts.push(c.innerText));
      return parts.filter(Boolean).join(' ');
    },
    get value() { return this.attrs.value || ''; },
    all() { const out = []; const walk = (n) => n.children.forEach((c) => { out.push(c); walk(c); }); walk(this); return out; },
    matches(sel) {
      return sel.split(',').some((one) => {
        const s = one.trim();
        if (s === '*') return true;
        const m = /^([a-z]*)(?:\[([a-z-]+)(?:="([^"]*)")?\])?(?::not\(\[type\]\))?$/i.exec(s);
        if (!m) return false;
        const tag = m[1], attr = m[2], val = m[3];
        if (tag && this.tagName !== tag.toUpperCase()) return false;
        if (attr) {
          const have = this.getAttribute(attr);
          if (have === null) return false;
          if (val !== undefined && have !== val) return false;
        }
        if (/:not\(\[type\]\)/.test(s) && this.getAttribute('type') !== null) return false;
        return true;
      });
    },
    querySelectorAll(sel) { return this.all().filter((n) => n.matches(sel)); },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
  };
  node.children.forEach((c) => { c.parentElement = node; });
  return node;
}
const div = (cls, children, text) => el('div', { class: cls }, children, text);

/* ---- the YouTube shapes, from the live page data and stylesheet ------------------------------ */
// New lockup: <a href=/watch?...&list=RD...> > yt-collection-thumbnail-view-model > yt-thumbnail-view-model
//   > yt-thumbnail-hover-overlay-view-model.ytThumbnailHoverOverlayViewModelHost (position:absolute, 100%)
//     > .ytThumbnailHoverOverlayViewModelScrim > .ytThumbnailHoverOverlayViewModelStyleCover
//       > yt-icon (PLAY_ALL, no text) + .ytThumbnailHoverOverlayViewModelText "Play all"
function mixLockup(href) {
  const text = div('ytThumbnailHoverOverlayViewModelText', [], 'Play all');
  const icon = el('yt-icon', { class: 'ytThumbnailHoverOverlayViewModelIcon' }, [el('span', {}, [el('svg', {}, [el('path', {}, [])])])]);
  const cover = div('ytThumbnailHoverOverlayViewModelStyleCover', [icon, text]);
  const scrim = div('ytThumbnailHoverOverlayViewModelScrim', [cover]);
  const host = el('yt-thumbnail-hover-overlay-view-model', { class: 'ytThumbnailHoverOverlayViewModelHost' }, [scrim]);
  const badge = el('yt-thumbnail-overlay-badge-view-model', {}, [el('yt-thumbnail-badge-view-model', {}, [], 'Mix')]);
  const thumb = el('yt-thumbnail-view-model', { class: 'ytThumbnailViewModelHost' }, [el('img', { src: 'https://i.ytimg.com/vi/N1oTjLDEzys/hqdefault.jpg' }, []), badge, host]);
  const collection = el('yt-collection-thumbnail-view-model', {}, [thumb]);
  const link = href === null
    ? div('yt-lockup-view-model__content-image', [collection])
    : el('a', Object.assign({ class: 'yt-lockup-view-model__content-image' }, href === undefined ? {} : { href }), [collection]);
  el('yt-lockup-view-model', {}, [link]);
  return { host, link };
}
// Classic renderer: <a id=thumbnail href=/watch?...> > #overlays > ytd-thumbnail-overlay-hover-text-renderer
//   (position:absolute; inset:0) > yt-icon + yt-formatted-string#hover-text "Play all"
function classicPlaylist(href) {
  const text = el('yt-formatted-string', { id: 'hover-text' }, [], 'Play all');
  const overlay = el('ytd-thumbnail-overlay-hover-text-renderer', { class: 'style-scope ytd-thumbnail' }, [el('yt-icon', {}, []), text]);
  const overlays = el('div', { id: 'overlays' }, [el('ytd-thumbnail-overlay-side-panel-renderer', {}, [el('yt-formatted-string', {}, [], 'Mix')]), overlay]);
  const link = el('a', href === undefined ? { id: 'thumbnail' } : { id: 'thumbnail', href }, [el('yt-image', {}, [el('img', {}, [])]), overlays]);
  el('ytd-thumbnail', {}, [link]);
  return { overlay, link };
}

if (isBaitBox) {
  const mix = mixLockup('/watch?v=N1oTjLDEzys&list=RDATfcbG9maQ&start_radio=1');
  check('a YouTube Mix hover overlay inside the lockup\'s link is not bait', isBaitBox(mix.host) === false,
    'the click goes where the link says; the box was being removed and counted as a block');
  const classic = classicPlaylist('/watch?v=abc&list=PLxyz');
  check('the classic playlist hover text inside its thumbnail link is not bait', isBaitBox(classic.overlay) === false);

  /* The same boxes with the link taken away are the shape the guard exists for: a box that
     appears over the page, says nothing, and offers one affirmative word that leads nowhere. */
  const noLink = mixLockup(null);
  check('the same overlay with no link around it is still bait', isBaitBox(noLink.host) === true,
    'a "Play all" box that goes nowhere is a click collector');
  const emptyHref = mixLockup('');
  check('an enclosing <a> with an empty href is not a destination', isBaitBox(emptyHref.host) === true);
  const noHref = mixLockup(undefined);
  check('nor is an <a> with no href at all', isBaitBox(noHref.host) === true);
  const classicNoLink = classicPlaylist(undefined);
  check('classic shape, link without href: still bait', isBaitBox(classicNoLink.overlay) === true);

  /* The dialogs it was built for, as plain boxes appended to the page (no link anywhere above). */
  const dialog = (text, labels) => {
    const buttons = labels.map((l) => el('button', {}, [], l));
    const box = div('modal', [div('title', [], text)].concat(buttons));
    el('body', {}, [box]);
    return box;
  };
  check('bait: "Please confirm to continue" is still removed', isBaitBox(dialog('Attention Please confirm to continue', ['Cancel', 'Continue'])) === true);
  check('bait: "The file is ready to download" is still removed', isBaitBox(dialog('Attention The file is ready to download', ['Cancel', 'Download'])) === true);
  check('bait: "Your stream is ready" is still removed', isBaitBox(dialog('Your stream is ready', ['Get Access'])) === true);
  check('a cookie banner is still left alone', isBaitBox(dialog('We use cookies to improve your experience', ['Accept', 'Decline'])) === false);
  const linkedControl = div('modal', [div('t', [], 'Watch the trailer now'), el('a', { href: '/watch/44' }, [], 'Watch')]);
  el('body', {}, [linkedControl]);
  check('a control with its own destination is still left alone (unchanged rule)', isBaitBox(linkedControl) === false);
  /* A bait dialog appended inside the page's <a> wrapper is a link now: the click navigates to a
     stated destination and the navigation guards judge it as they judge any link. Recorded here
     so the trade is visible, not so it can be relied on. */
  const wrapped = div('modal', [div('t', [], 'Please confirm to continue'), el('button', {}, [], 'Continue')]);
  el('a', { href: 'https://ads.example/go' }, [wrapped]);
  check('a dialog inside a real link is judged a link, not bait', isBaitBox(wrapped) === false);
}

/* ---- the shape of the fix, pinned in the source ---------------------------------------------- */
check('the guard records whether each control sits inside a link',
  /linked: insideLink\(node\)/.test(GUARD) && /function insideLink\(node\)/.test(GUARD));
check('the enclosing-link walk asks for a non-empty href on an <a>',
  /toLowerCase\(\) === 'a' && el\.getAttribute && el\.getAttribute\('href'\)\) return true;/.test(GUARD));
check('the final rail reads both', /return !affirmative\.some\(\(c\) => c\.href \|\| c\.linked\);/.test(GUARD));
check('the walk is bounded', /depth < 40/.test(GUARD));
check('the quiet block still counts as a block in the worker -- the fix is the false positive, not the badge',
  /NO_BADGE_TYPES = new Set\(\[/.test(BG) && !/'blocked_confirm_bait'/.test(BG.slice(BG.indexOf('NO_BADGE_TYPES = new Set(['), BG.indexOf('NO_BADGE_TYPES = new Set([') + 400)));

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('confirm-bait linked overlay: ' + pass + ' checks passed');

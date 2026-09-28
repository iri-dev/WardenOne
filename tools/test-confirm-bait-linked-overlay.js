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
 * Twitch, later: pausing a stream and resuming it left a blank page and a badge reading "1
 * blocked". Turbo and subscriber viewers get a Stream Rewind callout when they pause -- a New
 * pill, the title, one sentence and a dismiss button labelled Close (Twitch's own
 * DVROnboardingCallout) -- and the only button had no visible text, so the controls list came
 * back empty, the leaf fallback took the title for the button, and "Stream Rewind" matched the
 * affirmative list -- as it did for the player overlay around it, whose icon buttons left "LIVE"
 * and the title to stand in for controls. The sweep removed a node React still owned. Two changes,
 * both checked here: a box whose controls are icons is not read through the leaf fallback, and
 * the sweep does not run on the media apps the main engine already treats as trustedMediaHost.
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
  check('a short role picker has the bait shape the Discord exemption must preserve',
    isBaitBox(dialog('Choose your roles', ['Continue'])) === true);
  check('a short pronoun picker has the bait shape the Discord exemption must preserve',
    isBaitBox(dialog('Pick your pronouns', ['Next'])) === true);
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

  /* ---- Twitch's Stream Rewind callout, from its DVROnboardingCallout component ----------------- */
  // Layout(relative, .dvrOnboardingCallout) > Layout(absolute, bottom-right, maxWidth 400) >
  //   Callout: graphic <img alt="MIDI Controller">, New pill, title, description, dismiss button.
  const rewindCallout = (description, closeAttrs) => {
    const close = el('button', closeAttrs, [el('svg', {}, [el('path', {}, [])])]);
    const callout = div('callout', [
      div('graphic', [el('img', { alt: 'MIDI Controller', src: 'savvy-onboarding-callout.png' }, [])]),
      div('content', [div('pill', [], 'New'), el('p', {}, [], 'Stream Rewind'), el('p', {}, [], description)]),
      close]);
    const box = div('absolute', [callout]);
    el('body', {}, [div('dvrOnboardingCallout--wqPzY', [box])]);
    return box;
  };
  const SUB = 'As a channel subscriber, you can pause and rewind this stream to catch up on any missed moments.';
  const TURBO = 'As a Turbo subscriber, you can pause and rewind this stream to catch up on any missed moments.';
  check('Twitch\'s Stream Rewind callout is not bait', isBaitBox(rewindCallout(SUB, { 'aria-label': 'Close' })) === false,
    'its only control is the dismiss icon; the title is not a button');
  check('nor is the Turbo wording of it', isBaitBox(rewindCallout(TURBO, { 'aria-label': 'Close' })) === false);
  check('nor with an unlabelled dismiss icon: an icon is still a control, and the title still is not',
    isBaitBox(rewindCallout(SUB, {})) === false);
  /* The player overlay the callout sits in: every control an icon, the only words LIVE and the
     callout's. This box was bait too, and it is the one whose removal takes the controls with it. */
  const icon = (label) => el('button', { 'aria-label': label }, [el('svg', {}, [])]);
  const playerOverlay = div('player-overlay', [rewindCallout(SUB, { 'aria-label': 'Close' }),
    div('controls', [icon('Play (space/k)'), icon('Mute (m)'), div('live', [], 'LIVE')])]);
  el('body', {}, [div('video-player', [playerOverlay])]);
  check('the player overlay around it is not bait either', isBaitBox(playerOverlay) === false,
    'a player whose buttons are icons has told us its controls; LIVE and a title are not among them');
  /* The fallback is unchanged where it was needed: a box with no controls at all. */
  const divBait = div('modal', [div('t', [], 'Attention'), div('msg', [], 'Please confirm to continue'), div('btn', [], 'Continue')]);
  el('body', {}, [divBait]);
  check('a dialog built only of divs is still read through its leaves, and is still bait', isBaitBox(divBait) === true);
  /* The trade, recorded so it is visible: a box whose only button is an icon is no longer judged
     on the words beside it, so a div saying "Continue" next to an icon button reads as a message. */
  const iconBesideDiv = div('modal', [div('t', [], 'Attention'), div('btn', [], 'Continue'), icon('Close')]);
  el('body', {}, [iconBesideDiv]);
  check('an icon button beside a "Continue" div: the icon is the control, so the div is not', isBaitBox(iconBesideDiv) === false);
}

/* ---- the sweep stays off the media apps ------------------------------------------------------- */
const CONTENT_SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const engineList = (CONTENT_SRC.match(/trustedMediaHost=(\/.+?\/i)\.test\(location\.hostname\)/) || [])[1] || '';
const guardList = (GUARD.match(/return (\/.+?\/i)\.test\(location\.hostname\);\s*\} catch \(_\) \{\s*return false;\s*\}\s*\}\(\)\);/) || [])[1] || '';
check('the media-app list is read from both files', !!engineList && !!guardList);
check('it is the same list the main engine exempts as trustedMediaHost', engineList === guardList,
  'anti-redirect.js cannot reach the engine\'s copy, so the two must be kept identical');
const mediaDecl = (GUARD.match(/const MEDIA_APP_HOST = \(function \(\) \{[\s\S]*?\}\(\)\);/) || [])[0] || '';
const mediaApp = (hostname) => vm.runInNewContext(mediaDecl + '\nMEDIA_APP_HOST', { location: { hostname } });
if (mediaDecl) {
  for (const host of ['www.twitch.tv', 'player.twitch.tv', 'm.twitch.tv', 'www.youtube.com', 'open.spotify.com', 'x.com']) {
    check(host + ' is a media app', mediaApp(host) === true);
  }
  /* Twitch Extensions and ad frames run on their own hosts, so the sweep still runs inside them. */
  for (const host of ['supervisor.ext-twitch.tv', 'abc123.ext-twitch.tv', 'example.com', 'twitch.tv.evil.example', 'nottwitch.tv']) {
    check(host + ' is not', mediaApp(host) === false);
  }
}
check('the bait test is switched off there', /function confirmBaitEnabled\(\) \{\s*if \(MEDIA_APP_HOST \|\| DISCORD_APP_HOST\) return false;/.test(GUARD));
check('and the sweep is never installed there', /function installConfirmBaitSweep\(\) \{[\s\S]{0,300}?if \(baitInstalled \|\| MEDIA_APP_HOST \|\| DISCORD_APP_HOST\) return;/.test(GUARD));
check('nor is a click there warned about as a fake confirm box',
  /if \(!overlay\) signal\('gesture'\);[\s\S]{0,160}?else if \(!MEDIA_APP_HOST && !DISCORD_APP_HOST && confirmBaitOverlay\(overlay\)\) \{/.test(GUARD));

/* Discord's own app dialogs must survive both removers. The host check is exact;
   third-party frames and lookalike hosts still receive the normal bait check. */
const discordDecl = (GUARD.match(/const DISCORD_APP_HOST = \(function \(\) \{[\s\S]*?\}\(\)\);/) || [])[0] || '';
const gateSrc = GUARD.slice(GUARD.indexOf('function confirmBaitEnabled()'), GUARD.indexOf('const BAIT_REMOVE_CAP'));
const baitEnabledOn = (hostname) => vm.runInNewContext(mediaDecl + '\n' + discordDecl + '\n'
  + 'function cfg(){return {enabled:true,blockPopupTricks:true}} function hostAllowedByUser(){return false}'
  + gateSrc + '\nconfirmBaitEnabled()', { location: { hostname } });
check('Discord app host and bait gate lift for behavioural checks', !!discordDecl && gateSrc.includes('function confirmBaitEnabled'));
for (const host of ['discord.com', 'discordapp.com', 'canary.discord.com', 'ptb.discord.com']) {
  check(host + ' keeps its own onboarding dialogs', baitEnabledOn(host) === false);
}
for (const host of ['discord.com.evil.test', 'support.discord.com', 'frame.example.test']) {
  check(host + ' does not receive the app-dialog exception', baitEnabledOn(host) === true);
}
const engineDiscord = (CONTENT_SRC.match(/discordAppHost=(\/\^.+?\/i)\.test\(location\.hostname\)/) || [])[1] || '';
const guardDiscord = (discordDecl.match(/return (\/\^.+?\/i)\.test\(location\.hostname\)/) || [])[1] || '';
check('both Discord app scripts match the same exact hosts', !!engineDiscord && engineDiscord === guardDiscord);
const engineHost = engineDiscord ? vm.runInNewContext(engineDiscord) : null;
const overlayGateLine = CONTENT_SRC.split('\n').find((line) => line.includes('if(WO.removeOverlays&&!trustedMediaHost&&')) || '';
const overlayGate = overlayGateLine.trim().replace(/^if\(/, '').replace(/\)\{$/, '');
check('the main overlay cleaner has an exact Discord app gate', !!engineHost && overlayGate.includes('!discordAppHost'));
const overlayEnabledOn = (hostname) => vm.runInNewContext(overlayGate, {
  WO: { removeOverlays: true, blockSearchAiAnswers: false, blockSponsoredSearchResults: false, googleSearchResultCleanup: false },
  trustedMediaHost: false,
  discordAppHost: engineHost.test(hostname),
  location: { hostname },
  isGoogleSearchResults: () => false,
});
check('the main overlay cleaner leaves Discord onboarding alone', overlayEnabledOn('discord.com') === false);
check('the main overlay cleaner still runs on unrelated pages', overlayEnabledOn('example.test') === true);
check('a lookalike Discord host is not exempt', overlayEnabledOn('discord.com.evil.test') === true);

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

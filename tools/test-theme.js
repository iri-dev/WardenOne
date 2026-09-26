/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const css = read('theme.css');
/* WARDENONE_THEME points a control run at a pre-fix copy of the controller. */
const source = process.env.WARDENONE_THEME ? fs.readFileSync(process.env.WARDENONE_THEME, 'utf8') : read('theme.js');
/* Read off disk rather than listed here. notifications.html shipped with a broken
   dark mode for exactly as long as this was a hand-written list: the page was
   never added to it, so nothing noticed that it never declared a page name, and
   with no name none of theme.css's dark rules could reach it -- the rows stayed
   pale while the text went light, and every setting label went white on white.
   Any page that loads the shared theme is now covered the day it is created. */
const pages = fs.readdirSync(ROOT)
  .filter((file) => file.endsWith('.html'))
  .filter((file) => /<link rel="stylesheet" href="theme\.css">/.test(read(file)))
  .sort();
assert(pages.length >= 12, 'the theme page scan found only ' + pages.length + ' pages');
for (const expected of ['popup.html', 'history.html', 'notifications.html', 'onboarding.html']) {
  assert(pages.includes(expected), 'the theme page scan stopped finding ' + expected);
}

for (const page of pages) {
  const html = read(page);
  assert(new RegExp('<html[^>]+data-wardenone-page="[^"]+"').test(html), page + ' must identify itself to the shared theme');
  assert(/<link rel="stylesheet" href="theme\.css">/.test(html), page + ' must load theme.css');
  assert(/<script src="theme\.js"><\/script>/.test(html), page + ' must load theme.js');
  assert(html.indexOf('theme.css') < html.indexOf('theme.js'), page + ' must load the palette before the controller');
}


/* ---- the shared guide shell ---------------------------------------------- *
 * The DNS, permissions and API-key guides established what a WardenOne page
 * looks like: a dark topbar with the brand and section links, a hero carrying an
 * eyebrow, one headline, a lead and a summary card, then titled sections, then a
 * footer. guide-shell.css is that layout extracted. Activity, the notification
 * centre and the zapped-element manager each grew their own layout first and
 * each looked like a dialog that had kept growing; they are on the shell now.
 * Checked by reading which pages load it, so a fourth is covered automatically. */
const shellCss = read('guide-shell.css');
assert(/\.guide-hero::after\s*\{[\s\S]*?linear-gradient\(180deg, rgba\(236, 224, 247, 0\)/.test(shellCss),
  'the hero ends at a hard edge instead of fading into the page');
assert(/\.guide-brand::after\s*\{[\s\S]*?width: 1px/.test(shellCss),
  'the topbar has no hairline between the brand and the links');
/* Only the hero eyebrow carries the live dot; a kicker on every section head
   would make the page look like it is reporting six separate things. */
assert(/\.guide-eyebrow::before \{/.test(shellCss) && !/\.guide-kicker::before/.test(shellCss),
  'the section kickers have been given the hero eyebrow dot');
const shellPages = pages.filter((file) => /<link rel="stylesheet" href="guide-shell\.css">/.test(read(file)));
assert(shellPages.length >= 3,
  'only ' + shellPages.length + ' pages use the shared shell: ' + shellPages.join(', '));
for (const expected of ['history.html', 'notifications.html', 'hidden-elements.html']) {
  assert(shellPages.includes(expected), expected + ' no longer uses the shared guide shell');
}

for (const page of shellPages) {
  const html = read(page);
  const name = (html.match(/<html[^>]+data-wardenone-page="([^"]+)"/) || [])[1];
  assert(name, page + ' declares no page name');
  /* The shell styles itself through a page-name list. A page that loads the
     sheet but is not in that list gets the markup and none of the layout. */
  assert(shellCss.includes('data-wardenone-page="' + name + '"'),
    page + ' loads guide-shell.css but the sheet has no rules scoped to "' + name + '"');
  /* And scoped to the right ELEMENT. The check above passes on a selector that
     stops at the attribute -- which targets <html>, not what was meant -- and
     that is precisely how history.html and hidden-elements.html shipped without
     the body reset or the border-box reset: inset by the browser's default 8px
     body margin, with padding growing every control past its drawn size. Nothing
     caught it because the page name was still "mentioned" in the sheet. */
  for (const [suffix, what] of [['*', 'the border-box reset'], ['body', 'the body reset']]) {
    assert(shellCss.includes(':root[data-wardenone-page="' + name + '"] ' + suffix),
      page + ' never receives ' + what + ': guide-shell.css has no'
        + ' :root[data-wardenone-page="' + name + '"] ' + suffix + ' selector'
        + ' (a selector ending at the attribute styles <html> instead)');
  }
  /* The landmarks. Missing any one of them means the page has drifted back to a
     layout of its own rather than the one the guides established.

     Matched as whole class tokens, not substrings: a substring test for
     guide-topbar is satisfied by guide-topbar-inner, so renaming the topbar
     away left this passing with no topbar on the page. */
  const classTokens = new Set();
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    m[1].split(/\s+/).filter(Boolean).forEach((token) => classTokens.add(token));
  }
  for (const landmark of ['guide-topbar', 'guide-brand', 'guide-nav', 'guide-hero',
    'guide-eyebrow', 'guide-lead', 'guide-section', 'guide-section-head', 'guide-footer']) {
    assert(classTokens.has(landmark), page + ' is missing the shell landmark .' + landmark);
  }
  /* One headline per page, in the hero, the way every guide does it. */
  assert((html.match(/<h1[\s>]/g) || []).length === 1,
    page + ' should have exactly one <h1>, in its hero');
  assert(/guide-credit">Developer <strong>iri\.dev<\/strong>/.test(html),
    page + ' is missing the shared developer credit');
  /* The pieces that were missing and made these read as a different product:
     no buttons in the hero at all, and a hero that stopped at a hard line
     instead of fading into the page. */
  assert(html.includes('guide-hero-actions'), page + ' has no action buttons in its hero');
  /* Counted inside the hero, not across the page. The page-wide count read as
     the same thing only because no page had a primary button anywhere else; the
     moment one did (File Shield's "Choose a file") a correct page failed an
     assertion whose own message says "hero". */
  const heroActions = (html.match(/<div class="guide-hero-actions">([\s\S]*?)<\/div>/) || ['', ''])[1];
  assert((heroActions.match(/class="guide-btn primary"/g) || []).length === 1,
    page + ' should offer exactly one primary hero action');
}

const popupHtml = read('popup.html');
const popupSource = read('popup.js');
const onboardingHtml = read('onboarding.html');
const pageStyle = (page) => {
  const html = read(page);
  const match = html.match(/<style>([\s\S]*?)<\/style>/);
  if (match) return match[1];
  const shared = /<link rel="stylesheet" href="guide-shell\.css">/.test(html);
  assert(shared, page + ' must load its page-specific or shared guide stylesheet');
  return read('guide-shell.css');
};
/* Light is the default -- WardenOne was designed light-first, and that is the decision, not an
   oversight -- and System is a choice offered beside Light and Dark everywhere they are offered
   (BUG-11: the dark-mode commit shipped a two-state switch, so a reader who wanted the pages to
   follow a dark operating system had no way to ask). The markup's initial selection and the
   controller's default must agree, or the first paint shows one choice and the storage read
   another. */
assert((popupHtml.match(/data-wardenone-theme="system"/g) || []).length >= 2, 'popup must offer System in the header and Interface section');
assert(/data-wardenone-theme="system"/.test(onboardingHtml), 'onboarding must offer System');
assert.strictEqual((popupHtml.match(/data-wardenone-theme="light"[^>]*aria-pressed="true"/g) || []).length, 2, 'the popup markup must show Light as the initial selection in both places');
assert.strictEqual((onboardingHtml.match(/data-wardenone-theme="light"[^>]*aria-pressed="true"/g) || []).length, 1, 'the onboarding markup must show Light as the initial selection');
for (const [name, html] of [['popup', popupHtml], ['onboarding', onboardingHtml]]) {
  assert(!/data-wardenone-theme="(?:system|dark)"[^>]*aria-pressed="true"/.test(html), name + ' must not mark System or Dark as the initial selection');
  assert(!/data-wardenone-theme-status>(?!Light theme<)/.test(html), name + ' status text must start out saying Light theme');
}
assert((popupHtml.match(/data-wardenone-theme="light"/g) || []).length >= 2, 'popup must offer Light in the header and Interface section');
assert((popupHtml.match(/data-wardenone-theme="dark"/g) || []).length >= 2, 'popup must offer Dark in the header and Interface section');
assert(/<h2>Interface<\/h2>[\s\S]*?data-wardenone-theme="light"[\s\S]*?data-wardenone-theme="dark"/.test(popupHtml), 'popup theme controls must live in Interface');
assert(/wo-theme-quick[\s\S]*?data-wardenone-theme="light"[\s\S]*?data-wardenone-theme="dark"/.test(popupHtml), 'popup header must include quick Light/Dark controls');
assert(/onboarding-theme[\s\S]*?data-wardenone-theme="light"[\s\S]*?data-wardenone-theme="dark"/.test(onboardingHtml), 'onboarding must let the user choose Light or Dark');
assert(/wardenone_theme/.test(source), 'theme preference must use a dedicated local key');
assert(/matchMedia\('\(prefers-color-scheme: dark\)'\)/.test(source), 'theme controller must resolve System through the colour-scheme query');
assert(/const DEFAULT_THEME = 'light'/.test(source) && /let selected = DEFAULT_THEME/.test(source), 'Light must be the default; System is offered, never assumed');
assert(/THEMES = new Set\(\['light', 'dark', 'system'\]\)/.test(source), 'the controller must know all three values');
/* The palette is attribute-driven, resolved by the controller before first paint. A media block
   in the CSS would be a second, competing resolution -- and a page that only defined its dark
   palette inside one would lose it the moment the reader chose Dark on a light system. */
assert(!/@media\s*\(\s*prefers-color-scheme/.test(css), 'theme.css must not define its palette inside a prefers-color-scheme block');
for (const page of pages) {
  assert(!/@media\s*\(\s*prefers-color-scheme/.test(read(page)), page + ' must not define a palette inside a prefers-color-scheme block; the controller resolves the theme');
}
assert(/:root\s*\{\s*color-scheme:\s*light;/.test(css) && /:root\[data-wardenone-theme-resolved="dark"\]\s*\{\s*color-scheme:\s*dark;/.test(css),
  'color-scheme must follow the resolved theme on the root so form controls and scrollbars follow');
assert(/chrome\.storage\.local\.get/.test(source) && /chrome\.storage\.local\.set/.test(source), 'theme preference must persist in local extension storage');
assert(/chrome\.storage\.onChanged/.test(source), 'open extension pages must synchronize theme changes');
assert(/--wo-page-background:\s*var\(--wo-bg\)/.test(darkBlockSource(css)), 'dark page background must be flat without ambient gradients');
assert(/--bg:\s*#ece0f7/.test(popupHtml) && /radial-gradient\(125% 80% at 0% 0%, #e3cdf4/.test(popupHtml), 'popup must retain its original light palette and background');
assert(/onboarding[^}]+dark[^}]+\.cover-frame\s*\{\s*--cover-bg:\s*var\(--wo-surface-raised\)/.test(css), 'dark onboarding cover scroller must replace its light paper background');
assert(/cover-frame::before[\s\S]*?rgba\(48,\s*32,\s*58,\s*0\)[\s\S]*?cover-frame::after[\s\S]*?rgba\(48,\s*32,\s*58,\s*0\)/.test(css), 'dark onboarding cover fades must not retain the light paper RGB');

const originalLightSignatures = {
  'history.html': [
    /--guide-paper:\s*var\(--wo-surface-raised, #fff\);[\s\S]*?--guide-mist:\s*var\(--wo-surface-muted, #f2def2\);/,
    /* The house topbar, as the DNS, permissions and API-key guides draw it. This
       used to pin a flat 112deg dark gradient, which is what made these pages
       look like a different product beside those three. */
    /\.guide-topbar\s*\{[\s\S]*?linear-gradient\(135deg, rgba\(91, 56, 122, \.96\), rgba\(142, 67, 169, \.92\) 52%, rgba\(218, 100, 166, \.88\)\)/,
    /\.guide-nav a::after\s*\{[\s\S]*?linear-gradient\(90deg, #b06fd6, #df6ca9\)/,
    /\.guide-credit::before\s*\{[\s\S]*?background: #49c879/,
    /\.activity-grid\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1\.35fr\) minmax\(340px, \.65fr\)/,
  ],
  'network.html': [
    /--paper: #fff;[\s\S]*?--paper-soft: #fbf6fe;[\s\S]*?--mist: #f2def2;[\s\S]*?--mist-strong: #dec5ed;/,
    /\.btn:hover \{ transform: translateY\(-1px\); background: rgba\(242, 222, 242, \.3\); \}/,
    /\.result\.on \{ background: #e4f5ec;[\s\S]*?\.result\.off \{ background: #f7e6d6;[\s\S]*?\.result\.err \{ background: #f6dced;/,
  ],
  'permissions.html': [
    /--paper: #fff;[\s\S]*?--paper-soft: #fbf6fe;[\s\S]*?--mist: #f2def2;[\s\S]*?--mist-strong: #dec5ed;/,
    /\.perm-row:nth-child\(even\) \{ background: rgba\(255, 255, 255, \.24\); \}/,
    /linear-gradient\(180deg, rgba\(248, 240, 253, \.82\), rgba\(243, 235, 249, \.74\)\)/,
  ],
  'api-keys.html': [
    /--paper: #fff;[\s\S]*?--paper-soft: #fbf6fe;[\s\S]*?--mist: #f2def2;[\s\S]*?--mist-strong: #dec5ed;/,
    /\.perm-row:nth-child\(even\) \{ background: rgba\(255, 255, 255, \.24\); \}/,
    /linear-gradient\(180deg, rgba\(248, 240, 253, \.82\), rgba\(243, 235, 249, \.74\)\)/,
  ],
  'download-review.html': [
    /--bg: #efe2f7;[\s\S]*?--panel: #fbf6fe;[\s\S]*?--panel-2: #f4ebfb;/,
    /radial-gradient\(110% 75% at 0% 0%, #e3cdf4[\s\S]*?linear-gradient\(180deg, var\(--bg\), #ead8f5\)/,
    /\.panel \{[\s\S]*?background: rgba\(255,255,255,\.48\);/,
  ],
  'cert-error.html': [
    /--bg:#ece0f7;--card:#f7f0fc;--card-2:#f1e7fa;/,
    /radial-gradient\(85% 55% at 0% 0%, #e6d2f6[\s\S]*?linear-gradient\(180deg,#ece0f7 0%,#e8daf5 100%\)/,
    /border:1px solid rgba\(255,255,255,\.68\)[\s\S]*?box-shadow:0 18px 54px rgba\(80,30,110,\.18\)/,
  ],
  'safe-browsing-block.html': [
    /--bg:#ece0f7;--card:#f7f0fc;--card-2:#f1e7fa;/,
    /button\.danger\{background:transparent;color:#a8305f;border:1\.5px solid #e2a8c2\}/,
    /button\.danger:not\(:disabled\):hover\{background:#fdeef4\}/,
  ],
  'redirect-warning.html': [
    /--bg: #ece0f7;[\s\S]*?--bg-2: #f7e5f2;[\s\S]*?--paper: #fffafd;[\s\S]*?--paper-soft: #f7effb;/,
    /linear-gradient\(135deg, #6a3a86 0%, #9a55b5 50%, #d65f9a 100%\)/,
    /button\.continue \{ color: var\(--ink-soft\); background: rgba\(255,255,255,\.62\); \}/,
  ],
};
for (const [page, signatures] of Object.entries(originalLightSignatures)) {
  const styles = pageStyle(page);
  for (const signature of signatures) {
    assert(signature.test(styles), page + ' must retain the established light-mode colors and surfaces');
  }
}

/* Also derived. A page added to theme.css but not to this list would be free to
   ship a light-mode override that leaks into dark, which is the same failure the
   page scan above exists to stop. popup is the one deliberate exception: it
   carries three overrides that apply in both themes. */
const themedPageNames = [...new Set([...css.matchAll(/data-wardenone-page="([^"]+)"/g)].map((m) => m[1]))];
assert(themedPageNames.length >= 10, 'theme.css names only ' + themedPageNames.length + ' pages');
assert(themedPageNames.includes('notifications'), 'theme.css has no rules for the notification centre');
const lightLeakExempt = new Set(['popup']);
for (const name of themedPageNames) {
  if (lightLeakExempt.has(name)) continue;
  const escaped = name.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  const unscoped = new RegExp(
    ':root\\[data-wardenone-page="' + escaped + '"\\](?!\\[data-wardenone-theme-resolved="dark"\\])', 'g');
  assert(!unscoped.test(css),
    name + ': page-specific surface overrides must be scoped to dark mode');
}
/* The exemption has to stay a real one. If popup's unscoped rules ever go away,
   this list should shrink rather than sit here excusing nothing. */
assert(/:root\[data-wardenone-page="popup"\](?!\[data-wardenone-theme-resolved="dark"\])/.test(css),
  'popup no longer needs its light-leak exemption -- drop it from lightLeakExempt');

/* The notification centre's rows come from the activity page's stylesheet, fills
   and all, so its dark mode needs the same overrides history's does. */
for (const selector of ['.row', '.row:nth-child(even)', '.rulehead', '.settings-nav', '.item', '.day']) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\-]/g, '\\$&');
  assert(new RegExp(':root\\[data-wardenone-page="notifications"\\]\\[data-wardenone-theme-resolved="dark"\\] '
    + escaped + '\\s*\\{').test(css),
    'the notification centre has no dark fill for ' + selector);
}

function darkBlockSource(stylesheet) {
  const match = stylesheet.match(/:root\[data-wardenone-theme-resolved="dark"\]\s*\{([\s\S]*?)\n\}/);
  return match ? match[1] : '';
}

function tokens(block) {
  const out = {};
  for (const match of block.matchAll(/(--wo-[\w-]+)\s*:\s*(#[0-9a-fA-F]{6})\s*;/g)) out[match[1]] = match[2].toLowerCase();
  return out;
}

const lightBlock = css.match(/:root\s*\{([\s\S]*?)\n\}/);
const darkBlock = css.match(/:root\[data-wardenone-theme-resolved="dark"\]\s*\{([\s\S]*?)\n\}/);
assert(lightBlock && darkBlock, 'theme.css must define light and dark palettes');
const light = tokens(lightBlock[1]);
const dark = Object.assign({}, light, tokens(darkBlock[1]));

function luminance(hex) {
  const rgb = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((value) => value <= .03928 ? value / 12.92 : Math.pow((value + .055) / 1.055, 2.4));
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
}
function contrast(a, b) {
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
function clears(palette, foreground, background, minimum, label) {
  assert(palette[foreground], label + ' missing ' + foreground);
  assert(palette[background], label + ' missing ' + background);
  const ratio = contrast(palette[foreground], palette[background]);
  assert(ratio >= minimum, label + ' ' + foreground + ' on ' + background + ' is only ' + ratio.toFixed(2) + ':1');
}

for (const [name, palette] of [['light', light], ['dark', dark]]) {
  clears(palette, '--wo-text', '--wo-bg', 4.5, name);
  clears(palette, '--wo-text-soft', '--wo-surface', 4.5, name);
  clears(palette, '--wo-text-faint', '--wo-surface-alt', 4.5, name);
  clears(palette, '--wo-brand-text', '--wo-surface', 4.5, name);
  clears(palette, '--wo-success', '--wo-success-bg', 4.5, name);
  clears(palette, '--wo-warning', '--wo-warning-bg', 4.5, name);
  clears(palette, '--wo-danger', '--wo-danger-bg', 4.5, name);
  for (const fill of ['--wo-violet', '--wo-pink', '--wo-success-solid', '--wo-warning-solid', '--wo-danger-solid', '--wo-critical-solid']) {
    clears(palette, '--wo-on-brand', fill, 4.5, name);
  }
}

assert(/dark"\] button:disabled[\s\S]*?color:\s*var\(--wo-text-faint\)[\s\S]*?opacity:\s*1/.test(css), 'dark disabled buttons need an explicit readable state');
assert(/dark"\] input:disabled[\s\S]*?opacity:\s*\.72/.test(css), 'dark disabled form controls need an explicit readable state');
assert(/--wo-warning-bg/.test(css) && /--wo-danger-bg/.test(css) && /--wo-success-bg/.test(css), 'status surfaces must use semantic palette variables');
assert(/id="ss-clear"[^>]+border:1px solid #f0c8da;color:#973c69/.test(popupHtml), 'light emergency action must retain the original WardenOne styling');
assert(/id="ss-panic"[^>]+linear-gradient\(135deg,#d65a7a,#c0392b\);color:#fff/.test(popupHtml), 'light panic action must retain the original WardenOne gradient');
assert(/dark"\] #ss-panic[\s\S]*?--wo-danger-solid/.test(css), 'dark panic action must use the dark semantic palette');
assert(/popup"\]\[data-wardenone-theme-resolved="light"\][\s\S]*?--wo-success:\s*#1f693d[\s\S]*?--wo-warning:\s*#80531d[\s\S]*?--wo-danger:\s*#a93226/.test(css), 'light popup status colors must retain the original palette');
assert(/--wo-popup-soft-danger:\s*#973c69[\s\S]*?--wo-popup-soft-danger-line:\s*#f0c8da/.test(css), 'light popup secondary danger controls must retain the original rose palette');
assert(/popup"\]\[data-wardenone-theme-resolved="light"\][\s\S]*?color-scheme:\s*normal/.test(css), 'light popup must retain the browser scrollbar treatment used by the original UI');
assert(/--wo-popup-mode-gradient:\s*linear-gradient\(135deg,\s*#b06ad4,\s*#e07ab0\)/.test(css), 'light popup memory mode must retain the original lilac-pink gradient');
assert(/--wo-popup-interface-gradient:\s*linear-gradient\(135deg,\s*#9e61d1,\s*#dd72aa\)/.test(css), 'light Interface theme selection must match the established EyeShield active gradient');
assert(/\.wo-interface-theme-options \.wo-theme-option\[aria-pressed="true"\][\s\S]*?var\(--wo-popup-interface-gradient\)/.test(css), 'Interface theme controls must use their page-specific active gradient');
assert(/b\.style\.background\s*=\s*on\s*\?\s*'var\(--wo-popup-mode-gradient\)'/.test(popupSource), 'memory mode selection must use its theme-aware original gradient');
assert(/A:\s*'var\(--wo-popup-grade-a\)'[\s\S]*?F:\s*'var\(--wo-popup-grade-f\)'/.test(popupSource), 'runtime score grades must use theme-aware popup colors');
assert(/wo-popup-soft-danger-line/.test(popupSource) && /wo-popup-soft-danger-bg/.test(popupSource), 'runtime light danger controls must use the original rose palette through theme tokens');

class Control {
  constructor(theme) { this.theme = theme; this.attrs = { 'data-wardenone-theme': theme }; this.listeners = {}; }
  getAttribute(name) { return this.attrs[name] || null; }
  setAttribute(name, value) { this.attrs[name] = String(value); }
  addEventListener(name, fn) { this.listeners[name] = fn; }
  click() { this.listeners.click(); }
}

/* A page with a fake DOM, a fake colour-scheme query and a fake storage. `run` builds one. */
function themePage(opts) {
  const o = opts || {};
  /* The root records listeners like a control would, so a scenario can prove it never became one. */
  const root = {
    attrs: {}, listeners: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] || null; },
    addEventListener(name, fn) { this.listeners[name] = fn; },
  };
  /* Two groups in the markup's order (the popup header, then Interface): Light, Dark, System. */
  const controls = ['light', 'dark', 'system', 'light', 'dark', 'system'].map((theme) => new Control(theme));
  const statuses = [{ textContent: '' }, { textContent: '' }];
  const state = { saved: null, storageListener: null, mediaListener: null, mirror: Object.assign({}, o.mirror || {}), root, controls, statuses };
  /* The control pressed in each group, so a scenario reads "both groups show Light". */
  state.pressed = () => [controls.slice(0, 3), controls.slice(3)].map((group) => group.filter((c) => c.attrs['aria-pressed'] === 'true').map((c) => c.theme).join(',') || 'none');
  state.click = (theme) => controls.find((c) => c.theme === theme).click();
  const query = { matches: !!o.dark, addEventListener(name, fn) { state.mediaListener = fn; } };
  state.query = query;
  const context = {
    Set,
    matchMedia(q) { assert.strictEqual(q, '(prefers-color-scheme: dark)'); return query; },
    localStorage: {
      getItem(k) { return Object.prototype.hasOwnProperty.call(state.mirror, k) ? state.mirror[k] : null; },
      setItem(k, v) { state.mirror[k] = String(v); },
    },
    document: {
      documentElement: root,
      readyState: 'complete',
      querySelectorAll(selector) {
        /* As in a real document: once applyTheme has written the choice onto <html>, the
           attribute selector matches the root too, ahead of the buttons. */
        if (selector === '[data-wardenone-theme]') return root.attrs['data-wardenone-theme'] ? [root].concat(controls) : controls;
        if (selector === '[data-wardenone-theme-status]') return statuses;
        return [];
      },
      addEventListener() {},
    },
    window: {},
    chrome: {
      runtime: {},
      storage: {
        local: {
          get(key, callback) {
            assert.strictEqual(key, 'wardenone_theme');
            state.beforeStorage = { theme: root.attrs['data-wardenone-theme'], resolved: root.attrs['data-wardenone-theme-resolved'] };
            callback(o.stored === undefined ? {} : { wardenone_theme: o.stored });
          },
          set(value) { state.saved = value; },
        },
        onChanged: { addListener(fn) { state.storageListener = fn; } },
      },
    },
  };
  vm.runInNewContext(source, context, { filename: 'theme.js' });
  return state;
}

/* THE DEFAULT: nothing stored is Light, on a light machine and on a dark one. The dark machine
   is the case that matters -- Light is the design the reader meets first, and following the
   operating system is something they choose, so the page must not resolve through the query
   until they do. */
{
  const t = themePage({ dark: true });
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'light', 'with nothing stored the choice is Light');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'and it resolves light even on a dark machine');
  assert.strictEqual(t.beforeStorage.resolved, 'light', 'light from the first paint, before the stored preference has even been read');
  assert.deepStrictEqual(t.pressed(), ['light', 'light'], 'the Light control is selected in both places');
  assert.strictEqual(t.statuses[0].textContent, 'Light theme');
  assert.strictEqual(t.statuses[1].textContent, 'Light theme');
  /* The machine switches mid-session; nothing moves, because nothing is following it. */
  t.query.matches = false;
  t.mediaListener();
  t.query.matches = true;
  t.mediaListener();
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'the default does not follow the machine');
  assert.strictEqual(t.saved, null, 'and nothing is written to storage on a plain load');
}
{
  const t = themePage({ dark: false });
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'a light machine is light too');
  assert.deepStrictEqual(t.pressed(), ['light', 'light']);
}

/* <html> carries data-wardenone-theme as well, and the bare attribute selector used to take it
   for a control: aria-pressed="true" on the root, and a click listener that re-saved the current
   theme on every click anywhere in the page -- turning "no choice yet" into a stored one. */
{
  const t = themePage({ dark: true });
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'light', 'the root carries the choice (the fake selector returns it, as a document would)');
  assert(!('aria-pressed' in t.root.attrs), 'the root must not be marked pressed');
  assert(!t.root.listeners.click, 'the root must not get a click listener');
  assert.strictEqual(t.saved, null, 'so a click elsewhere on the page writes nothing');
  t.click('dark');
  assert(!('aria-pressed' in t.root.attrs), 'and still not after a choice re-syncs the controls');
}

/* SYSTEM, ONCE CHOSEN: resolves through the query, follows a mid-session switch, and the status
   says what it resolved to. */
{
  const t = themePage({ dark: true, stored: 'system' });
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'system', 'a stored System is the choice');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark', 'and on a dark machine it resolves to dark');
  assert.deepStrictEqual(t.pressed(), ['system', 'system'], 'the System control is selected in both places');
  assert(/^System theme/.test(t.statuses[0].textContent) && /dark/.test(t.statuses[0].textContent), 'the status says System and what it resolved to: ' + t.statuses[0].textContent);
  t.query.matches = false;
  t.mediaListener();
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'a machine that turns light mid-session turns the page light');
  assert(/light/.test(t.statuses[0].textContent), 'and the status follows: ' + t.statuses[0].textContent);
  t.query.matches = true;
  t.mediaListener();
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark', 'and back');
}
{
  const t = themePage({ dark: false, stored: 'system' });
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'System on a light machine resolves to light');
}

/* An explicit choice wins in both directions and does not move with the machine. */
{
  const t = themePage({ dark: true, stored: 'light' });
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'light', 'a stored Light holds on a dark machine');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light');
  assert.deepStrictEqual(t.pressed(), ['light', 'light'], 'stored Light is selected in both places');
  t.query.matches = false;
  t.mediaListener();
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'a machine change does not move an explicit choice');
  assert.strictEqual(t.statuses[0].textContent, 'Light theme');
}
{
  const t = themePage({ dark: false, stored: 'dark' });
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark', 'a stored Dark holds on a light machine');
  assert.deepStrictEqual(t.pressed(), ['dark', 'dark'], 'stored Dark is selected in both places');
  assert.strictEqual(t.statuses[0].textContent, 'Dark theme');
  t.query.matches = true;
  t.mediaListener();
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark', 'a machine change does not move an explicit Dark either');
}

/* The controls: Dark persists, System persists and resolves again, Light persists as a choice. */
{
  const t = themePage({ dark: true });
  t.click('dark');
  assert(t.saved && t.saved.wardenone_theme === 'dark', 'clicking Dark must persist locally');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark');
  assert.deepStrictEqual(t.pressed(), ['dark', 'dark'], 'duplicate controls must stay synchronized');
  assert.strictEqual(t.statuses[0].textContent, 'Dark theme');
  assert.strictEqual(t.mirror.wardenone_theme, 'dark', 'the choice is mirrored for the next page\'s first paint');
  t.click('system');
  assert(t.saved && t.saved.wardenone_theme === 'system', 'clicking System must persist System, not a resolved value');
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'system');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark', 'and resolve from the machine');
  assert.strictEqual(t.mirror.wardenone_theme, 'system');
  t.click('light');
  assert(t.saved && t.saved.wardenone_theme === 'light', 'clicking Light must persist Light explicitly, not clear the choice');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light');
  assert.deepStrictEqual(t.pressed(), ['light', 'light']);
  t.query.matches = false;
  t.mediaListener();
  t.query.matches = true;
  t.mediaListener();
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'a chosen Light no longer follows the machine');
  /* Another open page changes the stored value; this one follows. */
  t.storageListener({ wardenone_theme: { newValue: 'dark' } }, 'local');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark', 'open pages must react to a stored Dark change');
  t.storageListener({ wardenone_theme: { newValue: 'system' } }, 'local');
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'system', 'and to a stored System change');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark');
  t.storageListener({ wardenone_theme: { newValue: 'light' } }, 'local');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'and to a stored Light change');
  t.storageListener({ wardenone_theme: { newValue: 'sepia' } }, 'local');
  assert.strictEqual(t.root.attrs['data-wardenone-theme'], 'light', 'an unknown value means the Light default, never a resolved guess');
  assert.deepStrictEqual(t.pressed(), ['light', 'light']);
}

/* The mirror: a reader who chose Dark, or System on a dark machine, sees dark from the first
   paint instead of a light flash while storage is read. */
{
  const t = themePage({ dark: false, stored: 'dark', mirror: { wardenone_theme: 'dark' } });
  assert.strictEqual(t.beforeStorage.resolved, 'dark', 'the mirrored choice is applied before the stored one is read');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'dark');
}
{
  const t = themePage({ dark: true, stored: 'system', mirror: { wardenone_theme: 'system' } });
  assert.strictEqual(t.beforeStorage.theme, 'system', 'a mirrored System is applied before storage answers');
  assert.strictEqual(t.beforeStorage.resolved, 'dark', 'and resolves through the machine from the first paint');
}
{
  /* A stale mirror is corrected by the stored value once it lands. */
  const t = themePage({ dark: true, stored: 'light', mirror: { wardenone_theme: 'dark' } });
  assert.strictEqual(t.beforeStorage.resolved, 'dark');
  assert.strictEqual(t.root.attrs['data-wardenone-theme-resolved'], 'light', 'storage is the authority');
  assert.strictEqual(t.mirror.wardenone_theme, 'light', 'and the mirror is corrected');
}
{
  /* A mirror holding an unknown value is treated as no mirror: the Light default paints. */
  const t = themePage({ dark: true, mirror: { wardenone_theme: 'sepia' } });
  assert.strictEqual(t.beforeStorage.resolved, 'light');
  assert.strictEqual(t.mirror.wardenone_theme, 'light', 'and the mirror is rewritten to the default');
}
{
  /* No matchMedia at all (an unusual embedding): a chosen System means light, and nothing throws. */
  const context = {
    Set,
    document: { documentElement: { attrs: {}, setAttribute(n, v) { this.attrs[n] = String(v); } }, readyState: 'complete', querySelectorAll() { return []; }, addEventListener() {} },
    window: {}, chrome: { runtime: {}, storage: { local: { get(k, cb) { cb({ wardenone_theme: 'system' }); }, set() {} }, onChanged: { addListener() {} } } },
  };
  vm.runInNewContext(source, context, { filename: 'theme.js' });
  assert.strictEqual(context.document.documentElement.attrs['data-wardenone-theme'], 'system');
  assert.strictEqual(context.document.documentElement.attrs['data-wardenone-theme-resolved'], 'light', 'without a colour-scheme query System resolves to light');
}

console.log('[ok] shared extension theme tests');

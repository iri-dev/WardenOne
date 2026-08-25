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
const source = read('theme.js');
const pages = [
  'popup.html', 'history.html', 'network.html', 'onboarding.html', 'permissions.html',
  'api-keys.html', 'download-review.html', 'cert-error.html',
  'safe-browsing-block.html', 'redirect-warning.html',
];

for (const page of pages) {
  const html = read(page);
  assert(new RegExp('<html[^>]+data-wardenone-page="[^"]+"').test(html), page + ' must identify itself to the shared theme');
  assert(/<link rel="stylesheet" href="theme\.css">/.test(html), page + ' must load theme.css');
  assert(/<script src="theme\.js"><\/script>/.test(html), page + ' must load theme.js');
  assert(html.indexOf('theme.css') < html.indexOf('theme.js'), page + ' must load the palette before the controller');
}

const popupHtml = read('popup.html');
const popupSource = read('popup.js');
const onboardingHtml = read('onboarding.html');
assert(!/data-wardenone-theme="system"/.test(popupHtml + onboardingHtml), 'theme controls must not offer System');
assert((popupHtml.match(/data-wardenone-theme="light"/g) || []).length >= 2, 'popup must offer Light in the header and Interface section');
assert((popupHtml.match(/data-wardenone-theme="dark"/g) || []).length >= 2, 'popup must offer Dark in the header and Interface section');
assert(/<h2>Interface<\/h2>[\s\S]*?data-wardenone-theme="light"[\s\S]*?data-wardenone-theme="dark"/.test(popupHtml), 'popup theme controls must live in Interface');
assert(/wo-theme-quick[\s\S]*?data-wardenone-theme="light"[\s\S]*?data-wardenone-theme="dark"/.test(popupHtml), 'popup header must include quick Light/Dark controls');
assert(/onboarding-theme[\s\S]*?data-wardenone-theme="light"[\s\S]*?data-wardenone-theme="dark"/.test(onboardingHtml), 'onboarding must let the user choose Light or Dark');
assert(/wardenone_theme/.test(source), 'theme preference must use a dedicated local key');
assert(!/prefers-color-scheme/.test(source), 'theme controller must expose only Light and Dark');
assert(/chrome\.storage\.local\.get/.test(source) && /chrome\.storage\.local\.set/.test(source), 'theme preference must persist in local extension storage');
assert(/chrome\.storage\.onChanged/.test(source), 'open extension pages must synchronize theme changes');
assert(/--wo-page-background:\s*var\(--wo-bg\)/.test(darkBlockSource(css)), 'dark page background must be flat without ambient gradients');
assert(/--bg:\s*#ece0f7/.test(popupHtml) && /radial-gradient\(125% 80% at 0% 0%, #e3cdf4/.test(popupHtml), 'popup must retain its original light palette and background');
assert(/onboarding[^}]+dark[^}]+\.cover-frame\s*\{\s*--cover-bg:\s*var\(--wo-surface-raised\)/.test(css), 'dark onboarding cover scroller must replace its light paper background');
assert(/cover-frame::before[\s\S]*?rgba\(48,\s*32,\s*58,\s*0\)[\s\S]*?cover-frame::after[\s\S]*?rgba\(48,\s*32,\s*58,\s*0\)/.test(css), 'dark onboarding cover fades must not retain the light paper RGB');

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

const root = { attrs: {}, setAttribute(name, value) { this.attrs[name] = String(value); } };
const controls = ['light', 'dark', 'light', 'dark'].map((theme) => new Control(theme));
const statuses = [{ textContent: '' }, { textContent: '' }];
let saved = null;
let storageListener = null;
const context = {
  Set,
  document: {
    documentElement: root,
    readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '[data-wardenone-theme]') return controls;
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
        get(key, callback) { assert.strictEqual(key, 'wardenone_theme'); callback({ wardenone_theme: 'dark' }); },
        set(value) { saved = value; },
      },
      onChanged: { addListener(fn) { storageListener = fn; } },
    },
  },
};
vm.runInNewContext(source, context, { filename: 'theme.js' });
assert.strictEqual(root.attrs['data-wardenone-theme'], 'dark', 'stored preference must win after loading');
assert.strictEqual(root.attrs['data-wardenone-theme-resolved'], 'dark');
assert.strictEqual(controls[1].attrs['aria-pressed'], 'true', 'stored Dark header control must be selected');
assert.strictEqual(controls[3].attrs['aria-pressed'], 'true', 'stored Dark Interface control must be selected');

controls[0].click();
assert(saved && saved.wardenone_theme === 'light', 'clicking Light must persist locally');
assert.strictEqual(root.attrs['data-wardenone-theme-resolved'], 'light');
assert.strictEqual(controls[0].attrs['aria-pressed'], 'true');
assert.strictEqual(controls[2].attrs['aria-pressed'], 'true', 'duplicate controls must stay synchronized');
assert.strictEqual(statuses[0].textContent, 'Light theme');

storageListener({ wardenone_theme: { newValue: 'dark' } }, 'local');
assert.strictEqual(root.attrs['data-wardenone-theme-resolved'], 'dark', 'open pages must react to a stored Dark change');
storageListener({ wardenone_theme: { newValue: 'system' } }, 'local');
assert.strictEqual(root.attrs['data-wardenone-theme-resolved'], 'light', 'retired System values must safely migrate to Light');

console.log('[ok] shared extension theme tests');

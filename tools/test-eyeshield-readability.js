/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Regression checks for EyeShield's computed readability guard.
 * Run: node tools/test-eyeshield-readability.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');

const source = fs.readFileSync('eyeshield.js', 'utf8');

function assert(condition, message) {
  if (!condition) {
    console.error('[fail] ' + message);
    process.exit(1);
  }
}

function sliceBetween(startNeedle, endNeedle) {
  const start = source.indexOf(startNeedle);
  assert(start >= 0, 'missing ' + startNeedle);
  const end = source.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, 'missing ' + endNeedle + ' after ' + startNeedle);
  return source.slice(start, end);
}

const scheduleBlock = sliceBetween('function scheduleContrastGuard', 'function ewClearContrastFixNode');
const contrastBlock = sliceBetween('function contrastGuard', '// Incrementally theme shadow roots');
const colorBlock = sliceBetween('  const SKIP_VAL =', '  function roleForProp');
const replaceColors = vm.runInNewContext(
  '(function () {\n' + colorBlock + '\nreturn replaceColors;\n})()',
  Object.create(null),
  { filename: 'eyeshield.js:replaceColors' },
);

assert(/readability-guard-v2/.test(source), 'EyeShield version should include readability-guard-v2 marker');
assert(!/isManagedThemeHost\(\)[^;\n]*return/.test(scheduleBlock), 'contrast guard must not skip all managed theme hosts');
assert(/function ewTextPaint/.test(source), 'contrast guard should inspect actual text paint');
assert(/getPropertyValue\('-webkit-text-fill-color'\)/.test(source), 'contrast guard should read -webkit-text-fill-color');
assert(/ewContrastThreshold/.test(source), 'contrast guard should use text-size-aware thresholds');
assert(/largeText \? 3 : 4\.5/.test(source), 'normal text should require 4.5:1 contrast');
assert(/EW_CONTRAST_FIELD_SEL/.test(source), 'contrast guard should include form controls and editable fields');
assert(/__ewContrastOriginals = new WeakMap/.test(source), 'contrast guard should preserve original inline paint');
assert(/ewClearContrastFixNode/.test(source), 'contrast guard should have a per-node restore path');
assert(/style\.setProperty\('-webkit-text-fill-color', 'currentColor', 'important'\)/.test(contrastBlock), 'contrast fixes should override text fill');
assert(/style\.setProperty\('text-shadow', 'none', 'important'\)/.test(contrastBlock), 'contrast fixes should neutralize low-contrast text shadow');
assert(/scheduleContrastGuard\(activeRemap\);/.test(source), 'late DOM rebuilds should re-run the readability guard');

const quotedUrl = 'url("/assets/white#fff-red.svg?fill=rgb(1,2,3)")';
const mixed = 'linear-gradient(#fff, red, rgb(1, 2, 3)), ' + quotedUrl + ' "blue #000"';
const mixedOut = replaceColors(mixed, 'dark', 'bg');
assert(mixedOut !== mixed, 'actual color tokens outside literals should still be transformed');
assert(mixedOut.includes(quotedUrl), 'quoted url(...) must remain byte-for-byte unchanged');
assert(mixedOut.endsWith(' "blue #000"'), 'double-quoted CSS strings must remain byte-for-byte unchanged');

const bareUrl = 'url(/img/white.png#fff?color=red&fallback=rgb(1,2,3))';
assert(replaceColors(bareUrl, 'ultra', 'fg') === bareUrl, 'unquoted url(...) must remain byte-for-byte unchanged');

const spacedUpperUrl = 'URL(  \'data:image/svg+xml,<svg fill="#fff">red</svg>\'  )';
assert(replaceColors(spacedUpperUrl, 'light', 'bg') === spacedUpperUrl, 'case-insensitive URL functions and their spacing must remain unchanged');

const strings = '"say \\"red\\" and #fff" \'blue rgb(1,2,3)\' #fff';
const stringsOut = replaceColors(strings, 'dark', 'fg');
assert(stringsOut.startsWith('"say \\"red\\" and #fff" \'blue rgb(1,2,3)\' '), 'escaped and single-quoted strings must remain unchanged');
assert(stringsOut !== strings, 'a color following quoted strings should still transform');

const nestedUrl = "url(data:image/svg+xml,<svg fill='%23fff'><text>(red)</text></svg>)";
assert(replaceColors(nestedUrl, 'dark', 'bg') === nestedUrl, 'parentheses inside a data URL must not expose URL contents to color replacement');

const escapedCloseUrl = 'url(/asset/red\\)#fff.svg)';
assert(replaceColors(escapedCloseUrl, 'dark', 'fg') === escapedCloseUrl, 'escaped closing parentheses inside URL values must remain unchanged');

const notAUrl = 'myurl(#fff) red';
assert(replaceColors(notAUrl, 'dark', 'fg') !== notAUrl, 'url text inside a longer function name must not suppress real color transforms');

console.log('[ok] EyeShield readability guard checks passed');

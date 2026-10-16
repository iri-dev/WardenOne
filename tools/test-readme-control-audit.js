/* Keep the README audit inventory aligned with the shipped controls and Settings pages. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const background = read('background.js');
const settings = read('settings.js');
const settingsData = vm.runInNewContext(read('settings-data.js') + '\nSETTINGS_DATA');
const readme = read('README.md');
const audit = read('docs/readme-control-audit.md');

function registry(name) {
  const at = background.indexOf('const ' + name + ' = ');
  assert(at >= 0, name + ' missing');
  const start = background.indexOf('=', at) + 1;
  let depth = 0;
  let opened = false;
  for (let i = start; i < background.length; i++) {
    const char = background[i];
    if (char === '[' || char === '{') { depth++; opened = true; }
    else if (char === ']' || char === '}') {
      depth--;
      if (opened && depth === 0) return vm.runInNewContext('(' + background.slice(start, i + 1) + ')');
    }
  }
  throw new Error(name + ' did not close');
}

function section(start, end) {
  const from = audit.indexOf(start);
  const to = audit.indexOf(end, from + start.length);
  assert(from >= 0 && to > from, 'audit section missing: ' + start);
  return audit.slice(from + start.length, to);
}

function inventoryRows(source) {
  return [...source.matchAll(/^\| `([^`]+)` \| ([^|]+) \| /gm)]
    .map((match) => ({ key: match[1], label: match[2].trim() }));
}

function sameKeys(actual, expected, name) {
  const actualKeys = actual.map((row) => row.key);
  assert.strictEqual(new Set(actualKeys).size, actualKeys.length, name + ' contains duplicates');
  assert.deepStrictEqual(actualKeys.slice().sort(), [...new Set(expected)].sort(), name + ' drifted from source');
}

const shields = registry('HEALTH_SHIELD_KEYS');
const watch = registry('WATCH_ONLY_GUARDS');
const kinds = registry('CONTROL_KINDS');
const second = Object.keys(registry('SECOND_LEVEL_OF'));
const classified = shields.concat(watch, ...Object.values(kinds), second);
const sourceRows = settingsData.sections.flatMap((item) => item.rows)
  .concat(settingsData.carried.flatMap((item) => item.rows));
const customPopup = [...new Set(sourceRows.map((row) => row.key))]
  .filter((key) => !classified.includes(key));
const documented = inventoryRows(section('## Switch and control inventory', '## Settings mode and value controls'));
sameKeys(documented, classified.concat(customPopup), 'switch and popup inventory');

const labels = new Map();
for (const row of sourceRows) if (!labels.has(row.key)) labels.set(row.key, row.name);
for (const [key, label] of Object.entries({
  logThirdPartyBeacons: 'Background reports',
  deviceAccessGuard: 'Hardware and file access',
  capabilityGuard: 'Browser capabilities',
})) labels.set(key, label);
for (const row of documented) assert.strictEqual(row.label, labels.get(row.key), row.key + ' label drifted');

const pagesSource = settings.slice(settings.indexOf('const PAGES = ['), settings.indexOf('const NAV_LABELS ='));
const settingsControls = [...new Set([...pagesSource.matchAll(/\b(?:choice|pick|flag|slider|num)\('([^']+)'/g)]
  .map((match) => match[1]))];
sameKeys(inventoryRows(section('## Settings mode and value controls', '## Other user-facing features and surfaces')),
  settingsControls, 'Settings mode and value inventory');

const pageIds = [...pagesSource.matchAll(/^  \{ id: '([^']+)', title:/gm)].map((match) => match[1]);
sameKeys(inventoryRows(section('## Settings navigation cross-check', '## Verification')),
  pageIds, 'Settings navigation inventory');

const slug = (heading) => heading.toLowerCase()
  .replace(/[^\p{L}\p{N} _-]/gu, '').replace(/ /g, '-');
const anchors = new Set([...readme.matchAll(/^#{1,6} (.+)$/gm)].map((match) => slug(match[1])));
for (const match of audit.matchAll(/\.\.\/README\.md#([^\s)]+)/g)) {
  assert(anchors.has(match[1]), 'README heading missing for #' + match[1]);
}

console.log('README control audit: ' + documented.length + ' registry/popup entries, '
  + settingsControls.length + ' Settings controls, ' + pageIds.length + ' Settings pages');

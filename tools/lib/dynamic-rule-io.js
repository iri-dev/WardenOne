/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Lift worker dynamic-rule reads/writes into VM harnesses. prelude(source, bands) substitutes modeled [first id, size]
   bands; without them, reads filter independently. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const BACKGROUND_PATH = path.join(__dirname, '..', '..', 'background.js');

function prelude(source, bands) {
  const src = source || fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const start = src.indexOf('async function getDynamicRulesInBand(');
  const end = src.indexOf('\nconst MEDIA_COMPAT_RULE_BASE', start);
  assert(start >= 0 && end > start, 'cannot find the dynamic-rule read in background.js');
  let block = src.slice(start, end);
  /* A pre-fix copy, for a control run, wrote to Chrome directly. */
  if (!/^function writeDynamicRules\(/m.test(block)) {
    block += '\nfunction writeDynamicRules(change) { return chrome.declarativeNetRequest.updateDynamicRules(change); }';
  }
  const policy = fs.readFileSync(path.join(__dirname, '..', '..', 'network-policy.js'), 'utf8');
  return policy + '\nfunction ownDynamicRuleBands() { return ' + JSON.stringify(bands || []) + '; }\n' + block + '\n';
}

function installSessionIo(context, source) {
  const src = source || fs.readFileSync(BACKGROUND_PATH, 'utf8');
  const start = src.indexOf('function writeSessionRules(change) {');
  const end = src.indexOf('\n}', start);
  assert(start >= 0 && end > start);
  context.WONetworkPolicy = require('./network-policy.js');
  vm.runInContext(src.slice(start, end + 2), context);
}

module.exports = { prelude, installSessionIo };

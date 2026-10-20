/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'network.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'network.html'), 'utf8');

function element() {
  let text = '';
  const children = [];
  return {
    style: {}, className: '', disabled: false,
    classList: { remove() {} }, addEventListener() {},
    appendChild(child) { children.push(child); },
    set textContent(value) { text = value; children.length = 0; },
    get textContent() { return text + children.map((child) => child.textContent).join('\n'); },
  };
}

async function run() {
  for (const test of [
    { name: 'both categories', adult: 'all', malware: true, state: 'on', note: /Both categories appear filtered/ },
    { name: 'some adult probes', adult: 'some', state: 'warn', note: /Some filtering is active but not complete/ },
    { name: 'adult only', adult: 'all', state: 'warn', note: /Some filtering is active but not complete/ },
    { name: 'malware only', malware: true, state: 'warn', note: /Some filtering is active but not complete/ },
    { name: 'neither category', state: 'off', note: /No filtering detected/ },
    { name: 'unreachable control', controlFails: true, state: 'err', note: /Could not reach control sites/ },
  ]) {
    const nodes = new Map(['run', 'result', 'back'].map((id) => [id, element()]));
    const calls = [];
    const context = {
      document: {
        getElementById: (id) => nodes.get(id), createElement: element,
        createTextNode: (text) => ({ textContent: text }),
      },
      setTimeout, clearTimeout, AbortController,
      fetch(url) {
        calls.push(url);
        const { TESTS, CONTROLS } = context.domains;
        const blocked = (test.controlFails && url === CONTROLS[0])
          || (test.adult === 'all' && TESTS.adult.includes(url))
          || (test.adult === 'some' && url === TESTS.adult[0])
          || (test.malware && TESTS.malware.includes(url));
        return blocked ? Promise.reject(new Error('fixture blocked')) : Promise.resolve({});
      },
    };
    vm.runInNewContext(source + '\nthis.run = runTest; this.domains = { TESTS, CONTROLS };', context);
    await context.run();
    const result = nodes.get('result');
    assert.equal(result.className, 'result ' + test.state + ' show', test.name);
    assert.match(result.textContent, test.note, test.name);
    assert.equal(nodes.get('run').disabled, false, test.name + ' permits another run');
    if (test.controlFails) {
      assert(calls.every((url) => context.domains.CONTROLS.includes(url)), 'failed controls skip category probes');
    } else {
      assert.match(result.textContent, /heuristic, not proof/, 'the result keeps its accuracy caveat');
    }
  }
  const styles = ['on', 'warn', 'off', 'err'].map((state) => {
    const rule = html.match(new RegExp('\\.result\\.' + state + ' \\{([^}]+)\\}'));
    assert(rule, state + ' has a visible result style');
    return rule[1];
  });
  assert.equal(new Set(styles).size, styles.length, 'full, partial, absent and unavailable results have distinct styles');
  console.log('[ok] DNS filtering result states and control failures');
}

run().catch((error) => { console.error(error); process.exitCode = 1; });

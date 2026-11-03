/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'download-site-blocked.html'), 'utf8');
const source = fs.readFileSync(path.join(root, 'download-site-blocked.js'), 'utf8');

function build({ throwMessage = false } = {}) {
  const elements = {
    back: { textContent: 'Back to download page', disabled: false, addEventListener(type, callback) { this[type] = callback; } },
    'return-status': { textContent: '' },
  };
  const messages = [], callbacks = [], timers = new Map();
  let timerId = 0;
  const runtime = {
    lastError: null,
    sendMessage(message, callback) {
      if (throwMessage) throw new Error('worker unavailable');
      messages.push(message);
      callbacks.push(callback);
    },
  };
  const context = {
    document: { getElementById: id => elements[id] }, chrome: { runtime },
    location: new Proxy({}, { get() { throw new Error('the public page must not read or navigate to caller-supplied addresses'); } }),
    setTimeout(callback) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id) { timers.delete(id); },
  };
  vm.runInNewContext(source, context);
  return {
    elements, messages, timers, runtime,
    click(trusted = true) { elements.back.click({ isTrusted: trusted }); },
    reply(result, error) { runtime.lastError = error; callbacks.shift()(result); runtime.lastError = null; },
    timeout() { const pending = [...timers.values()]; timers.clear(); pending.forEach(callback => callback()); },
  };
}

let passed = 0;
function check(name, run) { run(); passed++; console.log('[ok] ' + name); }

check('the warning loads the shared theme and identifies the fake ad and retry step', () => {
  assert.match(html, /data-wardenone-page="download-site-blocked"/);
  assert.match(html, /<link rel="stylesheet" href="theme\.css">/);
  assert.match(html, /<script src="theme\.js"><\/script>/);
  assert.match(html, /background:var\(--wo-page-background\)/);
  assert.match(html, /Fake download ad blocked/);
  assert.match(html, /click the same download button again to try opening the intended file host/);
  assert.match(html, /<button[^>]+id="back"/);
  assert.ok(!html.includes('about:blank'));
  assert.ok(!/<form|<iframe|https?:\/\//i.test(html));
});
check('only an explicit trusted click requests a return, with no caller URL or tab ID', () => {
  const t = build(); t.click(false); assert.equal(t.messages.length, 0);
  t.click(); t.click();
  assert.equal(t.messages.length, 1);
  assert.equal(JSON.stringify(t.messages[0]), '{"kind":"download-site-return"}');
  assert.equal(t.elements.back.disabled, true);
  assert.equal(t.elements.back.textContent, 'Returning…');
});
check('a completed return clears its timer without navigating the page itself', () => {
  const t = build(); t.click(); t.reply({ ok: true });
  assert.equal(t.timers.size, 0);
  assert.equal(t.elements['return-status'].textContent, '');
});
for (const [name, result, error] of [
  ['missing source', { ok: false }, null], ['missing response', undefined, null],
  ['runtime error', { ok: true }, { message: 'port closed' }],
  ['untrusted response data', { ok: false, error: '<script>https://evil.example</script>' }, null],
]) {
  check(name + ' keeps the warning open and explains how to return manually', () => {
    const t = build(); t.click(); t.reply(result, error);
    assert.equal(t.elements.back.disabled, false);
    assert.match(t.elements['return-status'].textContent, /browser’s tabs/);
    assert.match(t.elements['return-status'].textContent, /original download button again/);
    assert.ok(!t.elements['return-status'].textContent.includes('evil.example'));
    assert.equal(t.timers.size, 0);
  });
}
for (const mode of ['timeout', 'throw']) {
  check(mode + ' unlocks retry without replacing the warning with a blank page', () => {
    const t = build({ throwMessage: mode === 'throw' }); t.click();
    if (mode === 'timeout') t.timeout();
    assert.equal(t.elements.back.disabled, false);
    assert.match(t.elements['return-status'].textContent, /could not find the original page/);
  });
}

console.log(passed + ' download-site page checks passed');

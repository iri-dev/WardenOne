/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

async function run() {
  const html = read('safe-browsing-block.html');
  assert.match(html, /<h2 id="escape-title" tabindex="-1">Before you continue<\/h2>/);
  assert.match(html, /id="escape-ready"[^>]*role="status"[^>]*aria-live="polite"/);
  const nodes = new Map();
  let active = null;
  function node(id) {
    const attrs = new Set();
    return {
      id, textContent: '', hidden: false, disabled: id === 'proceed', handlers: {},
      setAttribute(name) { attrs.add(name); if (name === 'disabled') this.disabled = true; },
      removeAttribute(name) { attrs.delete(name); if (name === 'disabled') this.disabled = false; },
      hasAttribute(name) { return attrs.has(name) || (name === 'disabled' && this.disabled); },
      addEventListener(kind, fn) { this.handlers[kind] = fn; },
      focus() { active = this; },
    };
  }
  for (const id of ['site', 'provider', 'reason', 'back', 'activity', 'wrong', 'escape', 'proceed', 'foot', 'escape-host', 'escape-title', 'escape-ready', 'report']) nodes.set(id, node(id));
  nodes.get('escape').hidden = true;
  let tick;
  const sandbox = {
    URL, URLSearchParams,
    location: { search: '?w=' + 'a'.repeat(32) },
    history: { length: 2 },
    document: { getElementById: (id) => nodes.get(id) || null },
    chrome: {
      runtime: { lastError: null },
      storage: { session: { get(key, cb) { cb({ [key]: {
        kind: 'safe-browsing', url: 'https://blocked.example.test/', shown: 'blocked.example.test/',
        provider: 'URL reputation', threats: 'MALWARE',
      } }); } } },
    },
    setInterval(fn) { tick = fn; return 1; },
    clearInterval() {},
    setTimeout() {},
  };
  vm.runInNewContext(read('safe-browsing-block.js'), sandbox);
  await new Promise((resolve) => setImmediate(resolve));
  nodes.get('wrong').handlers.click();
  assert.equal(nodes.get('escape').hidden, false);
  assert.equal(active && active.id, 'escape-title', 'revealed content receives focus before trigger is disabled');
  assert.equal(nodes.get('wrong').disabled, true);
  assert.equal(nodes.get('proceed').disabled, true);
  for (let i = 0; i < 5; i++) tick();
  assert.equal(nodes.get('proceed').disabled, false);
  assert.match(nodes.get('escape-ready').textContent, /now available/);

  const popup = read('popup.html');
  const popupScript = read('popup.js');
  assert.match(popup, /body\s*\{\s*width:\s*348px;/);
  assert.match(popup, /html\.wo-popup-tab body\s*\{\s*width:\s*min\(348px,\s*100%\)/);
  assert.match(popupScript, /chrome\.tabs\.getCurrent\(\(tab\) =>/);
  assert(popup.includes('<summary>More reading controls</summary>'), 'EyeShield keeps the compact reading controls');
  assert(popup.includes('id="eyeshield-scope-button" aria-haspopup="menu"')
    && popup.includes('id="eyeshield-scope-menu" role="menu"'), 'EyeShield scope is announced as a menu');
  assert(popup.includes('id="eyeshield-site-status" role="status" aria-live="polite"'), 'EyeShield autosave is announced');
  assert.match(popupScript, /range\.setAttribute\('aria-valuetext', brightness \+ '%'/);
  assert.match(popupScript, /range\.setAttribute\('aria-valuetext', pct \+ '%'/);
  const download = read('download-review.html');
  assert.doesNotMatch(download, /min-width:\s*360px/);
  assert.match(download, /id="status"[^>]*role="status"/);
  console.log('warning focus, announcement and EyeShield value contracts pass');
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'bridge.js'), 'utf8');
const start = source.indexOf('      const laOffer = () => {');
const end = source.indexOf('      if (document.readyState ===', start);
assert(start > 0 && end > start);
const block = source.slice(start, end);

function run(host, saved, incognito = false) {
  const buttons = [];
  const writes = [];
  const nodes = [];
  let mounts = 0;
  let lookups = 0;
  let statusReads = 0;
  const document = {
    createElement() {
      const element = { attrs: {}, setAttribute(key, value) { this.attrs[key] = value; }, appendChild() {}, textContent: '' };
      nodes.push(element);
      return element;
    },
  };
  const chrome = {
    extension: { inIncognitoContext: incognito },
    runtime: { lastError: null, sendMessage(message, callback) {
      if (message.kind === 'login-domain-age') { lookups++; return; }
      if (message.kind !== 'login-age-choice') throw Error('Unexpected message');
      if (message.action === 'status') {
        statusReads++;
        const at = saved && saved[host];
        callback({ ok: true, dismissed: Number.isFinite(at) && at > 0 && at <= Date.now() });
      } else if (message.action === 'dismiss') {
        writes.push({ ...saved, [host]: Date.now() });
        callback({ ok: true });
      }
    } },
  };
  const context = { chrome, document, location: { hostname: host, href: 'https://' + host + '/login' },
    Date, Number, Object, Array,
    loginAgeGuardOn: () => true, laVisiblePassword: () => true,
    woOwnedOverlay: () => ({ root: () => ({ appendChild() {} }), mount() { mounts++; }, destroy() {} }),
    WO_MODAL: { panel: () => 'all:initial!important;', button: () => '' },
    woOn(element, _type, callback) { buttons.push({ element, callback }); },
  };
  const check = vm.runInNewContext(`(() => {
    let laChecked = false, laShown = false;
    const laInterstitial = () => {};
    ${block}
    return laCheck;
  })()`, context);
  check();
  return { buttons, writes, mounts, lookups, statusReads, nodes };
}

const fresh = run('gamebanana.com', {});
assert.equal(fresh.mounts, 1);
assert.equal(fresh.lookups, 0, 'opening the offer never sends a domain lookup');
assert.equal(fresh.statusReads, 1);
const box = fresh.nodes.find(node => node.attrs.style?.includes('bottom:16px'));
assert(box && box.attrs.style.indexOf('all:initial') < box.attrs.style.indexOf('position:fixed'),
  'the CSS reset must come before the fixed position');
const never = fresh.buttons.find(({ element }) => element.textContent === 'Don’t ask again here');
assert(never);
never.callback({ isTrusted: true });
assert(Number.isFinite(fresh.writes[0]['gamebanana.com']));
assert.equal(run('gamebanana.com', fresh.writes[0]).mounts, 0, 'the chosen host stays quiet');
assert.equal(run('login.gamebanana.com', fresh.writes[0]).mounts, 1, 'another host does not inherit the choice');
assert.equal(run('gamebanana.com', { 'gamebanana.com': 'invalid' }).mounts, 1, 'invalid storage is ignored');
const privateRun = run('gamebanana.com', {}, true);
assert.equal(privateRun.mounts, 1);
assert(!privateRun.buttons.some(({ element }) => element.textContent === 'Don’t ask again here'));
assert.equal(privateRun.writes.length, 0, 'private browsing leaves no persistent site choice');
assert.equal(privateRun.statusReads, 0);
console.log('[ok] login age offer remembers only the chosen host without a lookup');

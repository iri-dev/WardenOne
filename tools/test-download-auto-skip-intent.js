/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const vm = require('vm');
const { h, makeDocument } = require('./lib/mini-dom.js');
const source = fs.readFileSync('src/content.js', 'utf8');
function lift(name) {
  const match = source.match(new RegExp(name + '=(\\/(?:\\\\.|[^\\/])*\\/[a-z]*)'));
  assert(match, name);
  return vm.runInNewContext(match[1]);
}
function world() {
  const requested = 'https://catalog.example/download/game-42-download';
  const sponsor = 'https://cdn.example/avast_secure_browser_setup.exe';
  const original = h('a', { href: requested }, ['Download for Windows']);
  const installer = h('a', { href: sponsor, id: 'download-partner-custom', target: '_blank' }, ['Download Now']);
  const restart = h('a', { href: sponsor, id: 'download-partner-restart', target: '_blank' }, ['click here']);
  const cancel = h('a', { href: '#', class: 'box-c2l-cancel-action' }, ['No thanks, I will continue downloading']);
  const offer = h('div', { id: 'download-modal', class: 'box-c2l-offer', 'data-campaign-id': '1299' },
    ['Sponsored download offer', restart, installer, cancel]);
  const modal = h('div', { id: 'box-c2l-modal' }, [offer]);
  const document = makeDocument('https://catalog.example/download/game', [original, modal]);
  modal.testHidden = true;
  const hidden = element => { for (let node = element; node && node.nodeType === 1; node = node.parentElement) if (node.testHidden) return true; return false; };
  for (const element of document.documentElement.descendants()) element.getBoundingClientRect = () =>
    ({ width: hidden(element) ? 0 : 400, height: hidden(element) ? 0 : 240 });
  const timers = [];
  let click;
  const box = {
    URL, Date, document, location: new URL(document.URL), autoSkipIntent: null,
    WO: { autoSkipDownloadAds: true }, overlayCleanerOn: () => true,
    AD_SIGNAL: lift('AD_SIGNAL'), AUTO_SKIP_AD_HINT: lift('AUTO_SKIP_AD_HINT'),
    getComputedStyle: element => ({ display: hidden(element) ? 'none' : 'block', visibility: 'visible', opacity: '1' }),
    setTimeout: fn => timers.push(fn), log() {}, start() {},
    woOn: (_target, _event, fn) => { click = fn; },
  };
  vm.createContext(box);
  const start = source.indexOf('SAFE_DOWNLOAD_URL=u=>{');
  const end = source.indexOf('start=()=>{', start);
  vm.runInContext('const ' + source.slice(start, end).replace(/,\s*$/, ';')
    + 'globalThis.api={findDownloadUrl,tryAutoSkip,autoSkipRequestedUrl};', box);
  const handlerStart = source.indexOf('woOn(document,"click",event=>{', end);
  const handlerEnd = source.indexOf('const restoreCleanerChanges=', handlerStart);
  vm.runInContext(source.slice(handlerStart, handlerEnd), box);
  const press = (element = original, extra = {}) => click({ isTrusted: true, button: 0, target: element, ...extra });
  const flush = () => { while (timers.length) timers.shift()(); };
  return { box, modal, offer, original, installer, requested, sponsor, press, flush };
}

for (const visible of [false, true]) {
  const w = world(); w.modal.testHidden = !visible;
  assert.equal(w.box.api.tryAutoSkip(), false, 'loading sponsor markup does not create a download request');
  w.flush();
  assert.equal(w.box.location.href, 'https://catalog.example/download/game');
  assert.equal(w.modal.isConnected, true, 'no unrequested navigation or wholesale campaign removal');
}
for (const change of [
  w => w.press(w.original, { isTrusted: false }),
  w => w.press(w.original, { ctrlKey: true }),
  w => w.press(w.installer),
  w => { w.original.textContent = 'Play video'; w.press(); },
]) {
  const w = world(); change(w); w.modal.testHidden = false;
  w.modal.setAttribute('data-download-url', w.sponsor);
  assert.equal(w.box.api.tryAutoSkip(), false, 'no synthetic, modified, sponsor or unrelated control authorizes auto-skip');
  w.flush(); assert.equal(w.box.location.href, 'https://catalog.example/download/game');
}
{
  const w = world(); w.press();
  w.modal.setAttribute('data-download-url', w.requested);
  assert.equal(w.box.api.findDownloadUrl(), null, 'a hidden modal cannot trigger a continuation');
  w.modal.testHidden = false;
  assert.equal(w.box.api.tryAutoSkip(), true);
  w.flush();
  assert.equal(w.box.location.href, w.requested, 'explicit original target wins over the first sponsor installer link');
  assert.equal(w.modal.isConnected, false);
  assert.equal(w.box.autoSkipIntent, null, 'the request is consumed');
}
{
  const w = world(); w.press(); w.modal.testHidden = false;
  w.modal.setAttribute('data-download-url', w.sponsor);
  assert.equal(w.box.api.tryAutoSkip(), false, 'mismatching metadata cannot replace the requested target');
  assert.equal(w.box.location.href, 'https://catalog.example/download/game');
}
{
  const w = world(); w.press(); w.modal.testHidden = false;
  w.modal.setAttribute('data-download-url', w.requested);
  assert.equal(w.box.api.tryAutoSkip(), true);
  w.box.WO.autoSkipDownloadAds = false; w.flush();
  assert.equal(w.box.location.href, 'https://catalog.example/download/game', 'a disabled feature cannot complete a scheduled navigation');
}
console.log('[ok] hidden sponsor offers never auto-download; continuations require the matching visible trusted request');

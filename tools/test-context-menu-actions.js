/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const background = fs.readFileSync('background.js', 'utf8');
function functionSource(signature) {
  const start = background.indexOf(signature);
  assert(start >= 0, signature);
  const end = background.indexOf('\n}\n', start);
  return background.slice(start, end + 3);
}
async function main() {
  const copied = [], notices = [], calls = [];
  let failCopy = false, starts = 0, closes = 0;
  const box = {
    URL, String, Date, Object, console,
    setTimeout: resolve => { resolve(); return 1; }, clearTimeout() {},
    wardenOffscreenIdleTimer: 0, wardenOffscreenBusy: 0,
    ensureWardenOffscreenDocument: async () => { starts++; },
    sendWardenOffscreenMessage: async payload => {
      copied.push(payload);
      if (failCopy) throw Error('Clipboard unavailable');
      return { ok: true };
    },
    scheduleWardenOffscreenClose: () => { closes++; },
    wardenManualNotice: async (...args) => { notices.push(args); },
    wardenTabActionNoticeTarget: async () => ({ id: 7, url: 'https://page.example/' }),
    tabsGet: async id => ({ id, url: 'https://page.example/' }),
    chrome: { scripting: { executeScript: async opts => {
      calls.push(opts.target);
      return [{ result: { selectionText: 'example.com', srcUrl: 'https://cdn.example/image.png', mediaType: 'image' } }];
    } } },
    startElementTool() {}, runWardenLinkCheck() {}, copyWardenCleanLink() {},
    runWardenManualCheck: async (text, tab) => { calls.push({ text, tab }); },
    checkWardenMedia: async (info, tab) => { calls.push({ info, tab }); },
    describeWardenFrame() {}, toggleWardenNeverSleep() {}, toggleWardenSiteBlock() {},
    runWardenTabSleep: async () => { throw Error('Discard failed'); },
    runWardenTabClose: async () => { throw Error('Remove failed'); },
  };
  vm.createContext(box);
  const ids = [...background.matchAll(/^const (WO_MENU_[A-Z_]+) = '([^']+)';/gm)].map(match => match[0]).join('\n');
  vm.runInContext(ids + '\n' + functionSource('async function wardenWriteClipboard(')
    + '\n' + functionSource('async function wardenMenuTargetTab(')
    + '\n' + functionSource('async function runWardenMenuAction('), box);
  assert.equal((await box.wardenMenuTargetTab({ id: 7 })).url, 'https://page.example/');
  assert(await box.wardenWriteClipboard('https://example.com/'));
  assert.equal(copied[0].type, 'copy-clean-link');
  assert.equal(starts, 1); assert.equal(closes, 1); assert.equal(box.wardenOffscreenBusy, 0);
  failCopy = true;
  assert.equal(await box.wardenWriteClipboard('https://example.com/'), false);
  assert.equal(closes, 2); assert.equal(box.wardenOffscreenBusy, 0);
  for (const text of ['about:blank', 'javascript:alert(1)', 'https://' + 'a'.repeat(65536)]) {
    assert.equal(await box.wardenWriteClipboard(text), false);
  }
  assert.equal(copied.length, 2, 'invalid clipboard payloads never leave the worker');
  for (const [id, error] of [['wardenone-sleep-tab', 'Discard failed'], ['wardenone-close-tab', 'Remove failed']]) {
    await box.runWardenMenuAction({ menuItemId: id }, null);
    assert.equal(notices.at(-1)[1], error);
    assert.equal(notices.at(-1)[2].id, 7, 'exceptions are explained in the resolved target tab');
  }
  await box.runWardenMenuAction({ menuItemId: 'wardenone-check-selection', frameId: 5 }, null);
  assert.equal(calls.at(-1).text, 'example.com');
  assert.equal(calls.at(-2).frameIds[0], 5, 'selection recovery stays in the clicked frame');
  await box.runWardenMenuAction({ menuItemId: 'wardenone-check-selection', selectionText: 'native.example', frameId: 3 }, null);
  assert.equal(calls.at(-1).text, 'native.example', 'Chrome selection wins over captured context');
  await box.runWardenMenuAction({ menuItemId: 'wardenone-check-media', frameId: 4 }, null);
  assert.equal(calls.at(-1).info.srcUrl, 'https://cdn.example/image.png');

  let listener, response, value = '', removes = 0;
  const sender = { id: 'extension', url: 'chrome-extension://extension/background.js' };
  const offscreen = { console, String, Number, Math, Array, Object, setTimeout, clearTimeout,
    chrome: { runtime: { id: 'extension', getURL: file => 'chrome-extension://extension/' + file,
      onMessage: { addListener: fn => { listener = fn; } } } },
    document: { body: { appendChild() {} }, execCommand: () => true,
      createElement: () => ({ set value(text) { value = text; }, select() {}, remove() { removes++; } }) },
  };
  vm.createContext(offscreen);
  vm.runInContext(fs.readFileSync('offscreen.js', 'utf8'), offscreen);
  const message = { target: 'wardenone-offscreen', type: 'copy-clean-link', text: 'https://example.com/' };
  for (const untrusted of [{}, { ...sender, tab: { id: 1 } }, { ...sender, url: 'chrome-extension://extension/popup.html' }]) {
    listener(message, untrusted, result => { response = result; });
    assert.equal(response, undefined, 'only the service worker can request offscreen writes');
  }
  listener(message, sender, result => { response = result; });
  assert.equal(response.ok, true); assert.equal(value, message.text); assert.equal(removes, 1);
  listener({ ...message, text: 'about:blank' }, sender, result => { response = result; });
  assert.equal(response.ok, false); assert.equal(removes, 1);
  console.log('[ok] menu exceptions, frame context recovery and clipboard trust boundaries');
}
main().catch(error => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const parentHost = 'site.wardenone-memory.example';
const editorHost = 'editor.wardenone-memory.example';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const serverPort = await profile.freePort();
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    const body = req.url.startsWith('/forms')
      ? `<form><input id="prefilled" value="Important draft"><textarea id="textarea">Important draft</textarea>
        <input id="empty"><div id="plain" contenteditable="plaintext-only" data-test-editor></div>
        <div id="plain-uppercase" contenteditable="PLAINTEXT-ONLY" data-test-editor></div>
        <div id="rich" contenteditable="TRUE" data-test-editor></div>
        <div id="bare" contenteditable data-test-editor></div>
        <div id="readonly" contenteditable="false">Read-only</div>
        <div id="invalid" contenteditable="invalid">Read-only</div></form>`
      : req.url.startsWith('/parent')
      ? `<textarea></textarea><iframe src="http://${parentHost}:${serverPort}/inner"></iframe>`
      : req.url.startsWith('/inner')
        ? `<iframe src="http://${editorHost}:${serverPort}/editor"></iframe>`
        : '<textarea aria-label="Draft"></textarea>';
    res.end('<!doctype html><title>Memory frame fixture</title>' + body);
  });
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-memory-frames-'));
  const port = await profile.freePort();
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      [`--host-resolver-rules=MAP ${parentHost} 127.0.0.1, MAP ${editorHost} 127.0.0.1`]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    console.log('[info] browser: ' + browser.Browser);
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = extension.attachedSession;
    const evaluate = async (expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, worker);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails).slice(0, 1200));
      return result.result.value;
    };
    const until = async (fn, label) => {
      let last;
      for (const deadline = Date.now() + 20000; Date.now() < deadline; await sleep(150)) {
        try { last = await fn(); if (last) return last; } catch (error) { last = String(error); }
      }
      throw new Error('Timed out waiting for ' + label + ': ' + JSON.stringify(last));
    };
    const config = (changes) => evaluate(`updateStoredConfig((cfg) => { Object.assign(cfg, ${JSON.stringify(changes)}); }).then(() => true)`);
    await config({ memoryShield: true, memoryNeverForms: true, memoryNeverSleepHosts: [],
      tabLimitGuard: false, tabLimitMax: 2, tabLimitClose: true, tabLimitWarn: false });
    const url = `http://${parentHost}:${serverPort}/parent`;
    const window = await evaluate(`chrome.windows.create({url:${JSON.stringify(url)}}).then(w=>({id:w.id,tabId:w.tabs[0].id}))`);
    await evaluate(`Promise.all([chrome.tabs.create({windowId:${window.id},url:'about:blank',pinned:true,active:true}),
      chrome.tabs.create({windowId:${window.id},url:'about:blank',pinned:true,active:false})])`);
    const live = (id) => evaluate(`tabLiveState(${id})`);
    const frames = (id) => evaluate(`chrome.webNavigation.getAllFrames({tabId:${id}})`);
    const ready = async (id) => until(async () => {
      const list = await frames(id);
      if (!list || list.length !== 3 || !list.some((frame) => frame.url.includes(editorHost))) return false;
      const state = await live(id);
      return state.ok ? list : false;
    }, 'three checked frame documents');
    const documents = await ready(window.tabId);
    const editor = documents.find((frame) => frame.url.includes(editorHost));
    const edit = (value) => evaluate(`chrome.scripting.executeScript({target:{tabId:${window.tabId},documentIds:[${JSON.stringify(editor.documentId)}]},
      func:(value)=>{const field=document.querySelector('textarea');field.value=value;field.dispatchEvent(new Event('input',{bubbles:true}));return field.value;},
      args:[${JSON.stringify(value)}]}).then(items=>items[0].result)`);
    const draft = 'Unsaved iframe draft';
    assert.equal(await edit(draft), draft);
    const top = await evaluate(`chrome.tabs.sendMessage(${window.tabId},{kind:'memory-form-check'},{frameId:0})`);
    assert.equal(top.formDirty, false, 'the main document is clean');
    const child = await evaluate(`chrome.tabs.sendMessage(${window.tabId},{kind:'memory-form-check'},
      {frameId:${editor.frameId},documentId:${JSON.stringify(editor.documentId)}})`);
    assert.equal(child.formDirty, true, 'the cross-origin editor has unsaved work');
    const dirty = await live(window.tabId);
    assert.equal(dirty.ok, true);
    assert.equal(dirty.formDirty, true, 'the frame replies are aggregated');
    const sweep = await evaluate(`getMemoryConfig().then(cfg=>memorySweep('frame-regression',{...cfg,_minutes:0}))`);
    assert.equal(sweep.slept, 0, 'the automatic sweep preserves the draft');
    await config({ tabLimitGuard: true });
    await evaluate(`enforceTabLimit(${window.id}).then(()=>true)`);
    const kept = await evaluate(`chrome.tabs.get(${window.tabId}).then(tab=>({discarded:tab.discarded,active:tab.active}))`);
    assert.equal(kept.active, false, 'the fixture is eligible as an inactive tab');
    assert.equal(kept.discarded, false, 'the protected tab was not discarded');
    assert.equal(await evaluate(`chrome.scripting.executeScript({target:{tabId:${window.tabId},documentIds:[${JSON.stringify(editor.documentId)}]},
      func:()=>document.querySelector('textarea').value}).then(items=>items[0].result)`), draft);
    console.log('[ok] a clean main frame cannot hide a nested cross-origin draft from automatic discard or Tab Limit close');

    await edit('');
    assert.equal((await live(window.tabId)).formDirty, false);
    await evaluate(`enforceTabLimit(${window.id}).then(()=>true)`);
    assert.equal(await evaluate(`chrome.tabs.get(${window.tabId}).then(()=>false,()=>true)`), true,
      'a verified-clean tab can still be closed');
    await config({ tabLimitGuard: false });
    const cleanId = await evaluate(`chrome.tabs.create({windowId:${window.id},url:${JSON.stringify(url)},active:false}).then(tab=>tab.id)`);
    await ready(cleanId);
    const slept = await evaluate(`getMemoryConfig().then(cfg=>memorySweep('frame-regression',{...cfg,_minutes:0}))`);
    assert.equal(slept.slept, 1, 'a verified-clean framed tab can still be discarded');
    const sleeping = await evaluate(`chrome.tabs.query({windowId:${window.id}}).then(tabs=>tabs.some(tab=>tab.url===${JSON.stringify(url)}&&tab.discarded))`);
    assert.equal(sleeping, true);
    console.log('[ok] clearing the draft permits Tab Limit close; all-clean framed pages can still sleep');

    const formUrl = `http://${parentHost}:${serverPort}/forms`;
    const formId = await evaluate(`chrome.tabs.create({windowId:${window.id},url:${JSON.stringify(formUrl)},active:false}).then(tab=>tab.id)`);
    await until(async () => (await live(formId)).ok, 'the form-check bridge');
    const changeForm = (change) => evaluate(`chrome.scripting.executeScript({target:{tabId:${formId}},
      func:({id,values=[]})=>{
        document.querySelector('form').reset();
        document.querySelectorAll('[data-test-editor]').forEach(el=>{el.textContent='';});
        const field=id&&document.getElementById(id);
        if(!field)return {};
        for(const value of values){
          if(field instanceof HTMLInputElement||field instanceof HTMLTextAreaElement)field.value=value;
          else field.textContent=value;
          field.dispatchEvent(new Event('input',{bubbles:true}));
        }
        return {value:field.value,defaultValue:field.defaultValue,editable:field.isContentEditable,text:field.textContent};
      },args:[${JSON.stringify(change)}]}).then(items=>items[0].result)`);
    for (const scenario of [
      { label: 'cleared prefilled input', id: 'prefilled', values: [''], dirty: true, defaultValue: 'Important draft' },
      { label: 'cleared prefilled textarea', id: 'textarea', values: [''], dirty: true, defaultValue: 'Important draft' },
      { label: 'untouched prefilled fields', dirty: false },
      { label: 'input edit restored to its default', id: 'prefilled', values: ['', 'Important draft'], dirty: false },
      { label: 'textarea edit restored to its default', id: 'textarea', values: ['', 'Important draft'], dirty: false },
      { label: 'originally empty input typed then cleared', id: 'empty', values: ['Draft', ''], dirty: false },
      { label: 'plaintext-only editor', id: 'plain', values: ['Plain draft'], dirty: true, editable: true },
      { label: 'uppercase plaintext-only editor', id: 'plain-uppercase', values: ['Plain draft'], dirty: true, editable: true },
      { label: 'uppercase true editor', id: 'rich', values: ['Rich draft'], dirty: true, editable: true },
      { label: 'empty-attribute editor', id: 'bare', values: ['Draft'], dirty: true, editable: true },
      { label: 'non-editable false attribute', id: 'readonly', values: ['Read-only'], dirty: false, editable: false },
      { label: 'non-editable invalid attribute', id: 'invalid', values: ['Read-only'], dirty: false, editable: false },
    ]) {
      const field = await changeForm(scenario);
      if (scenario.defaultValue !== undefined) {
        assert.equal(field.value, '', scenario.label);
        assert.equal(field.defaultValue, scenario.defaultValue, scenario.label + ': editing preserves the DOM default');
      }
      if (scenario.editable !== undefined) assert.equal(field.editable, scenario.editable, scenario.label);
      const state = await live(formId);
      assert.equal(state.ok, true, scenario.label);
      assert.equal(state.formDirty, scenario.dirty, scenario.label);
    }
    await changeForm({ id: 'prefilled', values: [''] });
    const protectedForm = await evaluate(`getMemoryConfig().then(cfg=>memorySweep('form-regression',{...cfg,_minutes:0}))`);
    assert.equal(protectedForm.slept, 0, 'clearing a prefilled field protects the tab from automatic discard');
    await config({ tabLimitGuard: true });
    await evaluate(`enforceTabLimit(${window.id}).then(()=>true)`);
    assert.equal(await evaluate(`chrome.tabs.get(${formId}).then(tab=>tab.discarded)`), false,
      'clearing a prefilled field protects the tab from Tab Limit close');
    console.log('[ok] real DOM edits: cleared defaults and valid editable variants protect the tab; restored and read-only fields stay eligible');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-memory-frames-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}

profile.mustFinish(run, 'browser-memory-frames').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

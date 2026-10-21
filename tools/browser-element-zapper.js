/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const host = 'zapper.wardenone-audit.net';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-zapper-'));
  const port = await profile.freePort();
  let cdp, server;
  try {
    server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Zapper regression</title><style>body{margin:20px}section{width:200px;height:80px;margin-bottom:20px;background:#ddd}</style><section id="first">First</section><section id="second">Second</section><div class="own-filter">User filter</div><div class="subscribed-filter">Subscribed filter</div><div data-zap="quoted">Quoted attribute</div>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP ' + host + ' 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const extension = await profile.extensionReady(cdp, port, JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const worker = extension.attachedSession;
    const evaluate = async (session, expression) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const until = async (session, expression) => {
      for (const deadline = Date.now() + 10000; Date.now() < deadline; await sleep(50)) {
        if (await evaluate(session, expression)) return;
      }
      throw new Error('Timed out: ' + expression);
    };
    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{enabled:true,elementZapper:true})).then(()=>true)');
    const filters = await evaluate(worker, `commitUserFilters({own:'##.own-filter',storeOwn:true,storeLists:true,lists:[{
      id:'cl_zapper_fixture',url:'https://lists.wardenone.example/zapper.txt',enabled:true,
      text:'##.subscribed-filter',updatedAt:Date.now()
    }]}).then(r=>({ok:r.ok}))`);
    assert(filters.ok, 'the user and subscribed cosmetic fixtures are saved');
    const url = 'http://' + host + ':' + server.address().port + '/';
    const { targetId } = await cdp.send('Target.createTarget', { url });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page);
    await cdp.send('Page.enable', {}, page);
    await cdp.send('DOM.enable', {}, page);
    await until(page, "document.readyState==='complete'&&!!document.getElementById('second')");
    const tabId = await evaluate(worker, `chrome.tabs.query({}).then(ts=>ts.find(t=>t.url===${JSON.stringify(url)}).id)`);
    const filterState = `({hidden:['.own-filter','.subscribed-filter'].map(s=>getComputedStyle(document.querySelector(s)).display==='none'),
      handSheets:document.querySelectorAll('style#wo-user-hidden').length,
      filterSheets:document.querySelectorAll('style#wo-user-filter-hidden').length,
      firstVisible:getComputedStyle(document.getElementById('first')).display!=='none',
      secondVisible:getComputedStyle(document.getElementById('second')).display!=='none'})`;
    const ownership = [];
    for (const initial of [[], ['#first']]) {
      await evaluate(worker, `chrome.storage.local.set({wardenone_hidden_elements:{[${JSON.stringify(host)}]:${JSON.stringify(initial)}}}).then(()=>true)`);
      await cdp.send('Page.reload', {}, page);
      await until(page, "document.readyState==='complete'&&['.own-filter','.subscribed-filter'].every(s=>getComputedStyle(document.querySelector(s)).display==='none')");
      await evaluate(worker, `addHiddenElement(${JSON.stringify(host)},'#second').then(r=>r.ok)`);
      await until(page, `document.querySelector('style[data-wardenone-user-hidden="true"]')?.textContent.includes('#second')`);
      ownership.push({initial,stage:'add',state:await evaluate(page, filterState)});
      await evaluate(worker, `removeHiddenElement(${JSON.stringify(host)},'#second').then(r=>r.ok)`);
      await until(page, `!document.querySelector('style[data-wardenone-user-hidden="true"]')?.textContent.includes('#second')`);
      ownership.push({initial,stage:'remove',state:await evaluate(page, filterState)});
      if (initial.length) {
        await evaluate(worker, `removeHiddenElement(${JSON.stringify(host)},'#first').then(r=>r.ok)`);
        await until(page, `!document.querySelector('style[data-wardenone-user-hidden="true"]')?.textContent.includes('#first')`);
        ownership.push({initial,stage:'clear',state:await evaluate(page, filterState)});
      }
    }
    assert(ownership.every(row=>row.state.hidden.every(Boolean) && row.state.handSheets===1
      && row.state.filterSheets===1 && row.state.firstVisible===(row.initial.length===0 || row.stage==='clear')
      && row.state.secondVisible===(row.stage!=='add')), 'independent sheet ownership: ' + JSON.stringify(ownership));
    console.log('[ok] list hiding survives hand-rule add/remove with empty and preloaded Zapper rules');
    for (const malformed of ['a[href=', 'a[title="unfinished', "a[title='unfinished", 'a:not(', 'a:-abp-contains(x)']) {
      const selectors = ['#first', malformed, '[data-zap="quoted"]', '#second'];
      await evaluate(worker, `chrome.storage.local.set({wardenone_hidden_elements:{[${JSON.stringify(host)}]:${JSON.stringify(selectors)}}}).then(()=>true)`);
      await cdp.send('Page.reload', {}, page);
      await until(page, `document.readyState==='complete'&&document.querySelector('style[data-wardenone-user-hidden="true"]')?.textContent.includes('#second')`);
      const state = await evaluate(page, `({
        first:getComputedStyle(document.getElementById('first')).display,
        second:getComputedStyle(document.getElementById('second')).display,
        quoted:getComputedStyle(document.querySelector('[data-zap="quoted"]')).display,
        rules:document.querySelector('style[data-wardenone-user-hidden="true"]').sheet.cssRules.length
      })`);
      assert.deepEqual(state, { first:'none', second:'none', quoted:'none', rules:3 },
        'a malformed hand-hidden selector is isolated: ' + malformed);
    }
    console.log('[ok] malformed selectors cannot swallow adjacent hidden rules; quoted attributes remain supported');
    const saved = (count) => `chrome.storage.local.get('wardenone_hidden_elements').then(x=>(x.wardenone_hidden_elements?.[${JSON.stringify(host)}]||[]).length===${count})`;
    const click = async (point) => {
      await cdp.send('Page.bringToFront', {}, page);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', button: 'none', buttons: 0, ...point }, page);
      await sleep(30);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', button: 'left', buttons: 1, clickCount: 1, ...point }, page);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', button: 'left', buttons: 0, clickCount: 1, ...point }, page);
    };
    const select = async (id) => {
      const point = await evaluate(page, `(()=>{const b=document.getElementById(${JSON.stringify(id)}).getBoundingClientRect();return {x:b.x+20,y:b.y+20}})()`);
      await click(point);
      await until(page, `getComputedStyle(document.getElementById(${JSON.stringify(id)})).display==='none'`);
    };
    const button = async (text) => {
      // CDP can inspect the closed shadow root without weakening the tool's page boundary.
      let node;
      for (const deadline = Date.now() + 5000; !node && Date.now() < deadline; await sleep(50)) {
        const { nodes } = await cdp.send('DOM.getFlattenedDocument', { depth: -1, pierce: true }, page);
        /* The save reply replaces the buttons; wait before measuring or pressing one. */
        if (nodes.some((n) => n.nodeValue === 'Saved for this site. It will stay gone after a reload.')) {
          node = nodes.find((n) => n.nodeName === 'BUTTON' && nodes.some((child) => child.parentId === n.nodeId && child.nodeValue === text));
        }
      }
      assert(node, text + ' button exists after the save reply');
      const { object } = await cdp.send('DOM.resolveNode', { nodeId: node.nodeId }, page);
      await cdp.send('Runtime.callFunctionOn', { objectId: object.objectId, functionDeclaration: `function () {
        globalThis.__woZapperClick = null;
        this.addEventListener('click', (event) => {
          globalThis.__woZapperClick = { text: this.textContent, trusted: event.isTrusted };
        }, { once: true });
      }` }, page);
      await cdp.send('Runtime.releaseObject', { objectId: object.objectId }, page);
      const { model } = await cdp.send('DOM.getBoxModel', { nodeId: node.nodeId }, page);
      await click({ x: (model.content[0] + model.content[2]) / 2, y: (model.content[1] + model.content[5]) / 2 });
      await until(page, `globalThis.__woZapperClick?.text===${JSON.stringify(text)}&&globalThis.__woZapperClick.trusted`);
    };
    const key = async (key, code, windowsVirtualKeyCode, modifiers = 0) => {
      for (const type of ['keyDown', 'keyUp']) await cdp.send('Input.dispatchKeyEvent', { type, key, code, windowsVirtualKeyCode, modifiers }, page);
    };
    for (const finish of ['Done', 'Escape']) {
      await evaluate(worker, "chrome.storage.local.remove('wardenone_hidden_elements').then(()=>true)");
      await cdp.send('Page.reload', {}, page);
      await until(page, "document.readyState==='complete'&&!!document.getElementById('second')&&getComputedStyle(document.getElementById('first')).display!=='none'");
      await evaluate(worker, `chrome.scripting.executeScript({target:{tabId:${tabId}},files:['element-picker.js']}).then(()=>true)`);
      await select('first');
      await until(worker, saved(1));
      assert(await evaluate(page, "!!document.getElementById('wo-picker-root')"), 'selection continues after the first item');
      await select('second');
      await until(worker, saved(2));
      if (finish === 'Done') {
        await button('Undo last');
        await until(worker, saved(1));
        await until(page, "getComputedStyle(document.getElementById('second')).display!=='none'");
        await select('second');
        await until(worker, saved(2));
        await button('Done');
      } else {
        await key('Escape', 'Escape', 27);
      }
      await until(page, "!document.getElementById('wo-picker-root')");
      /* Refresh can replace temporary picker marks with saved stylesheet rules. */
      await until(page, "['first','second'].every(id=>getComputedStyle(document.getElementById(id)).display==='none')");
      await key('z', 'KeyZ', 90, 2);
      await until(worker, saved(1));
      await until(page, "getComputedStyle(document.getElementById('second')).display!=='none'");
      await cdp.send('Page.reload', {}, page);
      await until(page, "document.readyState==='complete'&&!!document.getElementById('second')&&getComputedStyle(document.getElementById('first')).display==='none'");
      assert(await evaluate(page, "getComputedStyle(document.getElementById('second')).display!=='none'"), 'undone element remains visible after reload');
      console.log('[ok] two Zapper selections, ' + finish + ', post-finish Ctrl+Z and reload persistence in ' + browser.Browser);
    }
    await evaluate(worker, 'updateStoredConfig(cfg=>Object.assign(cfg,{adShield:false})).then(()=>true)');
    await cdp.send('Page.reload', {}, page);
    await until(page, "document.readyState==='complete'&&getComputedStyle(document.getElementById('first')).display==='none'");
    await evaluate(worker, `removeHiddenElement(${JSON.stringify(host)},'#first').then(r=>r.ok)`);
    await until(page, "getComputedStyle(document.getElementById('first')).display!=='none'");
    console.log('[ok] saved Zapper rules and undo still work with AdShield disabled');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (server) await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) !== path.resolve(os.tmpdir()) || !path.basename(resolved).startsWith('wo-zapper-')) throw new Error('Unexpected temporary profile');
    fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
profile.mustFinish(run, 'browser-element-zapper').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

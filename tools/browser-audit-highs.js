/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

/* AUD26-001/005/007: native media selection and deterministically delayed writes.
   All profiles, domains and media devices in this test are disposable or synthetic. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const profile = require('./perf-profile.js');
const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-audit-highs-'));
  const port = await profile.freePort();
  let cdp, server;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    let extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const evaluate = async (session, expression, contextId) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true,
        userGesture: true, ...(contextId ? { contextId } : {}) }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
    const attach = async (targetId) => {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    };
    const open = async (url, browserContextId) => {
      const { targetId } = await cdp.send('Target.createTarget', { url, ...(browserContextId ? { browserContextId } : {}) });
      return attach(targetId);
    };
    const until = async (session, expression) => {
      for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(100)) {
        if (await evaluate(session, expression)) return;
      }
      throw new Error('Timed out: ' + expression);
    };
    const settings = async (contextId) => {
      const session = await open(`chrome-extension://${extension.id}/settings.html`, contextId);
      await until(session, "typeof loaded !== 'undefined' && loaded === true");
      return session;
    };
    const send = (session, message) => evaluate(session, `chrome.runtime.sendMessage(${JSON.stringify(message)})`);
    let page = await settings();

    for (const older of [
      { kind: 'set-script-shield-mode', mode: 'normal' },
      { kind: 'set-javascript-state', scope: 'global', block: false },
    ]) {
      assert.equal((await send(page, { kind: 'set-script-shield-mode', mode: 'smart' })).ok, true);
      await evaluate(extension.attachedSession, `(() => {
        const area = chrome.storage.local, original = area.set.bind(area);
        area.set = (items, ...args) => {
          if (items.wardenone_script_shield_mode === 'normal') {
            area.set = original;
            globalThis.__releaseMode = () => original(items, ...args);
            return;
          }
          return original(items, ...args);
        };
      })()`);
      await evaluate(page, `globalThis.__olderMode = chrome.runtime.sendMessage(${JSON.stringify(older)}); true`);
      await until(extension.attachedSession, "typeof __releaseMode === 'function'");
      await evaluate(page, `globalThis.__newerDone = false;
        globalThis.__newerMode = chrome.runtime.sendMessage({kind:'set-script-shield-mode',mode:'smart'})
          .then(r => { __newerDone = true; return r; }); true`);
      await sleep(150);
      assert.equal(await evaluate(page, '__newerDone'), false);
      await evaluate(extension.attachedSession, '__releaseMode(); delete globalThis.__releaseMode; true');
      assert.equal((await evaluate(page, '__olderMode')).mode, 'normal');
      assert.equal((await evaluate(page, '__newerMode')).mode, 'smart');
      const applied = await evaluate(extension.attachedSession, `Promise.all([
        chrome.storage.local.get('wardenone_script_shield_mode'), chrome.declarativeNetRequest.getSessionRules()
      ]).then(([s,rules])=>({mode:s.wardenone_script_shield_mode, smart:rules.some(r=>r.id>=930000&&r.id<=930160)}))`);
      assert.deepEqual(applied, { mode: 'smart', smart: true });
    }
    assert.equal((await send(page, { kind: 'set-script-shield-mode', mode: 'normal' })).ok, true);
    console.log('[ok] newer Smart mode survives paused Normal and legacy global writes');

    const extensions = await open('chrome://extensions/');
    await until(extensions, '!!(chrome.developerPrivate && chrome.developerPrivate.updateExtensionConfiguration)');
    assert.equal(await evaluate(extensions, `new Promise(r=>chrome.developerPrivate.updateExtensionConfiguration(
      {extensionId:${JSON.stringify(extension.id)},incognitoAccess:true},()=>r(chrome.runtime.lastError?.message||'allowed')))`), 'allowed');
    await sleep(1500);
    extension = await profile.extensionReady(cdp, port, version);

    for (const privateSave of [false, true]) {
      page = await settings();
      const { browserContextId } = await cdp.send('Target.createBrowserContext', {});
      const writer = privateSave ? await settings(browserContextId) : page;
      assert.equal(await evaluate(writer, 'chrome.extension.inIncognitoContext'), privateSave);
      await evaluate(page, `writeConfig({deAmp:false,allowlist:['erase-audit.net','keep-audit.net'],
        siteOverrides:{'erase-audit.net':{adShield:false},'keep-audit.net':{adShield:true}}}).then(()=>true)`);
      await evaluate(writer, `(() => {
        const area = chrome.storage.local, original = area.set.bind(area);
        area.set = (items, ...args) => {
          if (items.wardenone_config?.deAmp === true) {
            area.set = original;
            globalThis.__staleConfig = items;
            globalThis.__releaseSave = () => original(items, ...args);
            return;
          }
          return original(items, ...args);
        };
        globalThis.__saved = writeConfig({deAmp:true}); return true;
      })()`);
      await until(writer, "typeof __releaseSave === 'function'");
      const stale = await evaluate(writer, '__staleConfig');
      await evaluate(page, `globalThis.__erased = false;
        globalThis.__erase = chrome.runtime.sendMessage({kind:'privacy-data-erase-site',host:'erase-audit.net'})
          .then(r=>{__erased=true;return r;}); true`);
      if (privateSave) assert.equal((await evaluate(page, '__erase')).ok, true);
      else {
        await sleep(150);
        assert.equal(await evaluate(page, '__erased'), false, 'regular save holds the config lock');
      }
      await evaluate(writer, '__releaseSave(); true');
      if (!privateSave) assert.equal((await evaluate(page, '__erase')).ok, true);
      await sleep(2200);
      extension = await profile.extensionReady(cdp, port, version);
      page = await settings();
      const configState = `chrome.storage.local.get('wardenone_config').then(({wardenone_config:c})=>({
        erased:!c.allowlist.includes('erase-audit.net')&&!c.siteOverrides['erase-audit.net'],
        kept:c.allowlist.includes('keep-audit.net')&&c.siteOverrides['keep-audit.net'].adShield,
        deAmp:c.deAmp}))`;
      const expected = { erased: true, kept: true, deAmp: true };
      const settled = `(${configState}).then(s=>s.erased&&s.kept&&s.deAmp)`;
      await until(page, settled);
      assert.deepEqual(await evaluate(page, configState), expected, 'erase after ' + (privateSave ? 'private' : 'regular') + ' save');
      if (privateSave) {
        const { browserContextId: lateContext } = await cdp.send('Target.createBrowserContext', {});
        const latePage = await settings(lateContext);
        await evaluate(latePage, `chrome.storage.local.set(${JSON.stringify(stale)})`);
        await until(page, settled);
        await sleep(1300);
        assert.deepEqual(await evaluate(page, configState), expected, 'late private replay after reload');
      }
    }
    console.log('[ok] site erase survives regular/private pending saves and stale replay after reload');

    await evaluate(page, `writeConfig({
      antiFingerprintNoise:true,antiFingerprint:false,blockCameraMic:false,mediaShield:false,
      capabilityGuard:false,deviceAccessGuard:false,blockSuspiciousWebRTC:false}).then(()=>true)`);
    server = http.createServer((_request, response) => {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html><title>Media selection regression</title><p>Fake camera and microphone</p>');
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const media = await open('http://localhost:' + server.address().port + '/');
    await cdp.send('Page.enable', {}, media);
    await until(media, '!!(window.__wardenOneRealm && window.__wardenOneRealm.noise)');
    const { frameTree } = await cdp.send('Page.getFrameTree', {}, media);
    const { executionContextId } = await cdp.send('Page.createIsolatedWorld', { frameId: frameTree.frame.id, worldName: 'native-media-baseline' }, media);
    await evaluate(media, `navigator.mediaDevices.getUserMedia({video:true,audio:true})
      .then(s=>{s.getTracks().forEach(t=>t.stop());return true})`, executionContextId);
    const native = await evaluate(media, `navigator.mediaDevices.enumerateDevices().then(ds=>ds.map(d=>({kind:d.kind,deviceId:d.deviceId})))`, executionContextId);
    const visible = await evaluate(media, `navigator.mediaDevices.enumerateDevices().then(ds=>ds.map(d=>d.toJSON()))`);
    assert.deepEqual(visible.map(({ kind, deviceId }) => ({ kind, deviceId })), native);
    assert(visible.every((d) => d.label === '' && d.groupId === ''), 'descriptive hardware metadata stays hidden');
    for (const [kind, constraint] of [['videoinput', 'video'], ['audioinput', 'audio']]) {
      const device = visible.find((d) => d.kind === kind && d.deviceId !== 'default');
      assert(device, 'fake ' + kind + ' available');
      assert.equal(await evaluate(media, `navigator.mediaDevices.getUserMedia({${constraint}:{deviceId:{exact:${JSON.stringify(device.deviceId)}}}})
        .then(s=>{s.getTracks().forEach(t=>t.stop());return true})`), true);
    }
    console.log('[ok] native exact camera and microphone selection works with fingerprint noise in ' + browser.Browser);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (server) await new Promise((resolve) => server.close(resolve));
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-audit-highs-/.test(path.basename(resolved))) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
profile.mustFinish(run, 'browser-audit-highs').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

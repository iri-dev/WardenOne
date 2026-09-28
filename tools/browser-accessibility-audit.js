/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Manual Edge check of the actual extension pages. Run with Node 22+ on Windows.
   This uses Chromium's accessibility tree, keyboard input, a 320 CSS px viewport,
   and forced-colors emulation. It cannot verify spoken output from Narrator/NVDA. */
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-a11y-'));
  let cdp;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs?.(cdp, port, extension.id);
    const { sessionId: worker } = await cdp.send('Target.attachToTarget', {
      targetId: extension.workerTargetId, flatten: true,
    });
    await cdp.send('Runtime.enable', {}, worker);
    const handle = 'a'.repeat(32);
    const records = {
      redirect: { kind: 'redirect', url: 'https://destination.example.test/path', shown: 'destination.example.test/path', sourceUrl: 'https://source.example.test/', sourceShown: 'source.example.test/', why: 'Unexpected destination' },
      'safe-browsing': { kind: 'safe-browsing', url: 'https://blocked.example.test/', shown: 'blocked.example.test/', provider: 'URL reputation', threats: 'MALWARE' },
      trust: { kind: 'trust', url: 'https://cert.example.test/', shown: 'cert.example.test/', problem: 'Invalid certificate', why: 'Trust failed', risk: 'Information could be intercepted' },
    };
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Page.enable', {}, sessionId);
    await cdp.send('Runtime.enable', {}, sessionId);
    await cdp.send('Accessibility.enable', {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: 320, height: 800, deviceScaleFactor: 1, mobile: false,
    }, sessionId);

    async function evalValue(expression) {
      const response = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
      return response.result && response.result.value;
    }
    async function open(page, record, selector) {
      if (record) {
        const key = 'wardenone_warning:' + handle;
        const expression = `new Promise((resolve,reject)=>chrome.storage.session.set(${JSON.stringify({ [key]: record })},()=>chrome.runtime.lastError?reject(chrome.runtime.lastError.message):resolve(true)))`;
        const response = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, worker);
        assert.equal(response.result && response.result.value, true, 'warning record written');
      }
      await cdp.send('Page.navigate', { url: 'chrome-extension://' + extension.id + '/' + page + (record ? '?w=' + handle : '') }, sessionId);
      for (let i = 0; i < 30; i++) {
        await sleep(100);
        const ready = await evalValue('document.readyState === "complete" && !!document.querySelector(' + JSON.stringify(selector || 'main') + ')');
        if (ready) { await sleep(100); return; }
      }
      throw new Error(page + ' did not load');
    }
    async function snapshot(page, record) {
      await open(page, record);
      const tree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
      const nodes = (tree.nodes || []).filter((n) => !n.ignored).map((n) => ({
        role: n.role && n.role.value, name: n.name && n.name.value,
      }));
      assert(nodes.some((n) => n.role === 'main'), page + ' needs a main landmark');
      assert(nodes.some((n) => n.role === 'heading' && n.name), page + ' needs a named heading');
      assert(nodes.some((n) => n.role === 'button' && /Go back|Cancel Download/.test(n.name || '')), page + ' needs a safe action');
      const layout = await evalValue(`(() => ({width:document.documentElement.clientWidth,
        scroll:document.documentElement.scrollWidth,
        buttons:[...document.querySelectorAll('button:not([hidden])')].filter(b=>getComputedStyle(b).display!=='none').map(b=>({text:b.textContent.trim(),left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))}))()`);
      assert(layout.scroll <= layout.width + 1, page + ' scrolls horizontally at 320 CSS px: ' + JSON.stringify(layout));
      assert(layout.buttons.every((b) => b.left >= -1 && b.right <= 321), page + ' has an unreachable button at 320 CSS px');
      await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }, sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
      const focus = await evalValue(`(() => {const e=document.activeElement;const s=getComputedStyle(e);
        return {id:e.id,text:e.textContent.trim(),outline:s.outlineStyle,visibility:s.visibility,display:s.display}})()`);
      assert(focus.outline !== 'none', page + ' lacks visible forced-colors focus');
      await cdp.send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
      console.log('[ok] ' + page + ': named heading, safe action, 320px reflow, forced-colors focus (' + focus.id + ')');
      return { nodes, focus };
    }

    await snapshot('redirect-warning.html', records.redirect);
    await snapshot('cert-error.html', records.trust);
    await snapshot('safe-browsing-block.html', records['safe-browsing']);
    const before = await evalValue('document.activeElement.id');
    assert.equal(before, 'back');
    await evalValue('document.getElementById("wrong").focus();document.getElementById("wrong").click()');
    const reveal = await evalValue('({focus:document.activeElement.id,shown:!document.getElementById("escape").hidden,disabled:document.getElementById("proceed").disabled})');
    assert.deepEqual(reveal, { focus: 'escape-title', shown: true, disabled: true });
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    assert.equal(await evalValue('document.activeElement.id'), 'report', 'Tab reaches false-positive report');
    let ready;
    for (let i = 0; i < 75; i++) {
      await sleep(200);
      ready = await evalValue('({message:document.getElementById("escape-ready").textContent,disabled:document.getElementById("proceed").disabled})');
      if (!ready.disabled) break;
    }
    assert.equal(ready.disabled, false);
    assert.match(ready.message, /now available/);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 }, sessionId);
    assert.equal(await evalValue('document.activeElement.id'), 'proceed', 'Tab reaches enabled continue');
    console.log('[ok] safe-browsing disclosure moves focus to heading and announces when continue is available');
    const review = { id: 'a11y-review', createdAt: Date.now(), grade: 'E', status: 'Dangerous',
      score: 8, file: 'example-installer.exe', source: 'https://downloads.example.test/',
      mime: 'application/octet-stream', reasons: ['The source has a dangerous reputation.'],
      recommendation: 'Cancel this download unless you have verified the source.', paused: true };
    const seeded = await cdp.send('Runtime.evaluate', {
      expression: `new Promise((resolve,reject)=>chrome.storage.local.set(${JSON.stringify({ wardenone_pending_downloads: { [review.id]: review } })},()=>chrome.runtime.lastError?reject(chrome.runtime.lastError.message):resolve(true)))`,
      awaitPromise: true, returnByValue: true,
    }, worker);
    assert.equal(seeded.result && seeded.result.value, true);
    await snapshot('download-review.html?id=' + review.id);
    for (let i = 0; i < 20; i++) {
      if (await evalValue('document.getElementById("status").textContent === "E - Dangerous"')) break;
      await sleep(100);
    }
    assert.equal(await evalValue('document.getElementById("status").textContent'), 'E - Dangerous');
    const reviewTree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const axNodes = new Map((reviewTree.nodes || []).map((n) => [n.nodeId, n]));
    const axText = (n) => (n.name && n.name.value || '') + ' ' + (n.childIds || []).map((id) => axNodes.get(id)).filter(Boolean).map(axText).join(' ');
    assert((reviewTree.nodes || []).some((n) => !n.ignored && n.role && n.role.value === 'status'
      && /E - Dangerous/.test(axText(n))), 'Download Guard verdict needs text inside its status region');
    console.log('[ok] Download Guard loaded a real pending review and exposed its verdict');
    await open('popup.html', null, '#eyeshield-panel');
    for (let i = 0; i < 30; i++) {
      if (await evalValue('document.documentElement.classList.contains("wo-popup-tab")')) break;
      await sleep(100);
    }
    const eye = await evalValue(`(() => ({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
      tab:document.documentElement.classList.contains('wo-popup-tab'),
      sliders:[...document.querySelectorAll('#eyeshield-panel input[type="range"]')].map(e=>({name:e.labels&&e.labels[0]&&e.labels[0].textContent.trim(),value:e.getAttribute('aria-valuetext')}))}))()`);
    assert(eye.tab, 'popup tab did not enter responsive layout: ' + JSON.stringify(eye));
    assert(eye.scroll <= eye.width + 1, 'popup scrolls horizontally at 320 CSS px: ' + JSON.stringify(eye));
    assert.equal(eye.sliders.length, 5);
    assert(eye.sliders.every((s) => s.name && /^\d+%$/.test(s.value)), 'EyeShield sliders need spoken labels and percentages');
    const eyeTree = await cdp.send('Accessibility.getFullAXTree', {}, sessionId);
    const sliders = (eyeTree.nodes || []).filter((n) => !n.ignored && n.role && n.role.value === 'slider');
    assert(sliders.some((n) => /brightness/i.test(n.name && n.name.value || '')), 'EyeShield brightness needs an accessible slider name');
    await cdp.send('Emulation.setEmulatedMedia', { features: [{ name: 'forced-colors', value: 'active' }] }, sessionId);
    const eyeFocus = await evalValue(`(() => {const e=document.getElementById('eyeshield-brightness');e.focus();
      const s=getComputedStyle(e);return {outline:s.outlineStyle,disabled:e.disabled}})()`);
    assert.equal(eyeFocus.disabled, false);
    assert.notEqual(eyeFocus.outline, 'none', 'EyeShield slider needs a forced-colors focus ring');
    await cdp.send('Emulation.setEmulatedMedia', { features: [] }, sessionId);
    console.log('[ok] EyeShield: named sliders with percentage values, 320px reflow, forced-colors focus');
    await cdp.send('Emulation.clearDeviceMetricsOverride', {}, sessionId);
    async function setZoom(factor) {
      const url = await evalValue('location.href');
      const response = await cdp.send('Runtime.evaluate', {
        expression: `new Promise(resolve=>chrome.tabs.query({},tabs=>{const tab=tabs.find(t=>t.url===${JSON.stringify(url)});if(!tab){resolve({ok:false,error:'tab not found'});return;}chrome.tabs.setZoom(tab.id,${factor},()=>{const error=chrome.runtime.lastError&&chrome.runtime.lastError.message;if(error){resolve({ok:false,error});return;}chrome.tabs.getZoom(tab.id,z=>resolve({ok:!chrome.runtime.lastError,error:chrome.runtime.lastError&&chrome.runtime.lastError.message,tab:tab.id,actual:z}));});}))`,
        awaitPromise: true, returnByValue: true,
      }, worker);
      const outcome = response.result && response.result.value;
      assert(outcome && outcome.ok, 'could not apply browser zoom: ' + JSON.stringify(outcome));
      assert(Math.abs(outcome.actual - factor) < 0.01, 'browser reported a different zoom factor');
      for (let i = 0; i < 30; i++) {
        await sleep(100);
        const width = await evalValue('document.documentElement.clientWidth');
        if ((factor === 4 && width <= 320) || (factor === 1 && width > 320)) return;
      }
      throw new Error('browser zoom did not reach the page viewport');
    }
    await setZoom(4);
    const zoomedEye = await evalValue('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,zoom:window.devicePixelRatio})');
    assert(zoomedEye.width <= 320 && zoomedEye.scroll <= zoomedEye.width + 1,
      'EyeShield popup fails at 400% browser zoom: ' + JSON.stringify(zoomedEye));
    await setZoom(1);
    await open('safe-browsing-block.html', records['safe-browsing']);
    await setZoom(4);
    const zoomedWarning = await evalValue('({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,zoom:window.devicePixelRatio})');
    assert(zoomedWarning.width <= 320 && zoomedWarning.scroll <= zoomedWarning.width + 1,
      'Safe Browsing fails at 400% browser zoom: ' + JSON.stringify(zoomedWarning));
    console.log('[ok] actual 400% browser zoom: EyeShield and Safe Browsing reflow without horizontal scrolling');
    const beforePopup = await cdp.send('Target.getTargets');
    const priorTargets = new Set((beforePopup.targetInfos || []).map((t) => t.targetId));
    const opened = await cdp.send('Runtime.evaluate', {
      expression: 'chrome.windows.getAll().then(windows=>chrome.windows.update(windows[0].id,{focused:true}).then(()=>chrome.action.openPopup({windowId:windows[0].id}))).then(()=>({ok:true}),e=>({ok:false,error:String(e)}))',
      awaitPromise: true, returnByValue: true,
    }, worker);
    assert(opened.result && opened.result.value && opened.result.value.ok,
      'could not open action popup: ' + JSON.stringify(opened.result && opened.result.value));
    let popupTarget;
    for (let i = 0; i < 30; i++) {
      const targets = await cdp.send('Target.getTargets');
      popupTarget = (targets.targetInfos || []).find((t) => !priorTargets.has(t.targetId)
        && t.url === 'chrome-extension://' + extension.id + '/popup.html');
      if (popupTarget) break;
      await sleep(100);
    }
    assert(popupTarget, 'action popup target did not appear');
    const { sessionId: popupSession } = await cdp.send('Target.attachToTarget', {
      targetId: popupTarget.targetId, flatten: true,
    });
    await cdp.send('Runtime.enable', {}, popupSession);
    const actionLayout = await cdp.send('Runtime.evaluate', {
      expression: `({width:document.documentElement.clientWidth,scroll:document.documentElement.scrollWidth,
        body:Math.round(document.body.getBoundingClientRect().width),tab:document.documentElement.classList.contains('wo-popup-tab'),
        footer:[...document.querySelectorAll('.foot .nav-btn')].map(e=>Math.round(e.getBoundingClientRect().top))})`,
      returnByValue: true,
    }, popupSession);
    const action = actionLayout.result && actionLayout.result.value;
    if (action && action.scroll > action.width + 1) {
      const overflow = await cdp.send('Runtime.evaluate', {
        expression: `[...document.querySelectorAll('body *')].map(e=>({id:e.id,tag:e.tagName,right:Math.round(e.getBoundingClientRect().right),width:Math.round(e.getBoundingClientRect().width)})).filter(x=>x.right>document.documentElement.clientWidth+1).sort((a,b)=>b.right-a.right).slice(0,10)`,
        returnByValue: true,
      }, popupSession);
      console.log('action overflow ' + JSON.stringify(overflow.result && overflow.result.value));
    }
    assert(action && !action.tab && action.body >= 347 && action.body <= 349
      && action.scroll <= action.width + 1 && action.footer.length === 3
      && action.footer.every((top) => top === action.footer[0]),
    'toolbar popup collapsed, overflows or stacks its footer: ' + JSON.stringify(action));
    console.log('[ok] real toolbar popup keeps its 348px width without horizontal scrolling');
    for (let i = 0; i < 40; i++) {
      const state = await cdp.send('Runtime.evaluate', {
        expression: `({title:document.getElementById('health-status-title').textContent,
          publishers:document.getElementById('list-publisher-summary').textContent})`,
        returnByValue: true,
      }, popupSession);
      const value = state.result && state.result.value;
      if (value && value.title !== 'Checking protection') {
        if (/\b[1-9]\d* old\b/.test(value.publishers)) {
          assert.notEqual(value.title, 'Check setup', 'old publisher dates must not create a setup warning');
        }
        break;
      }
      await sleep(100);
    }
    if (process.env.WARDENONE_CAPTURE_POPUP) {
      await cdp.send('Runtime.evaluate', { expression: 'document.scrollingElement.scrollTop=0;document.body.scrollTop=0' }, popupSession);
      await sleep(100);
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: true, clip: { x: 0, y: 0, width: 348, height: 600, scale: 1 },
      }, popupSession);
      fs.writeFileSync(path.resolve(process.env.WARDENONE_CAPTURE_POPUP), Buffer.from(shot.data, 'base64'));
    }
    console.log('Real browser accessibility audit passed; spoken screen-reader output requires a separate Narrator/NVDA pass.');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port); cdp.close(); }
    const profileDir = path.resolve(dir);
    if (path.dirname(profileDir) === path.resolve(os.tmpdir()) && path.basename(profileDir).startsWith('wo-a11y-')) {
      fs.rmSync(profileDir, { recursive: true, force: true });
    }
  }
}

run().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

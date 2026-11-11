/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */

/* H-01 in a real browser. A same-origin parent or opener can reach a child's new document in the
   gap between commit and the first body bytes, before WardenOne's start-up scripts run, and hear
   the bridge hand its key to the page's own guards. This makes the gap reliable with a stalled
   body, checks the key is heard, then forges a signed request with it: the bridge must refuse it.
   Run: node tools/browser-key-handoff.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');

const root = path.resolve(__dirname, '..');
const host = 'keyhandoff.wardenone-audit.net';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function authBlock() {
  const src = fs.readFileSync(path.join(root, 'bridge.js'), 'utf8');
  const a = src.indexOf('const __woAuth=(function(){');
  const b = src.indexOf('})();', src.indexOf('return{hmac:hmac,same:same', a));
  if (a < 0 || b < 0) throw new Error('no __woAuth in bridge.js');
  return src.slice(a, b + 5);
}

/* The attacker: watches each new document of its child, then signs as the engine. Chrome clears
   listeners on a reused blank window, so the window hook alone hears only the blank page's key. */
const ATTACK = `<script>${authBlock()}
window.__probe = { keys: { frame: [], popup: [] }, messages: { frame: [], popup: [] } };
function listenOn(target, name) {
  target.addEventListener('wo-key', (e) => {
    __probe.seen = (__probe.seen || []).concat(name + ':' + typeof e.detail);
    try { const d = e.detail; if (d && d.key) __probe.keys[name].push({ token: d.token, key: d.key }); } catch (_) {}
  }, true);
}
function listenMessages(win, name) {
  win.addEventListener('message', (e) => { try { __probe.messages[name].push(JSON.parse(JSON.stringify(e.data))); } catch (_) {} }, true);
}
function pollDocuments(getWin, name) {
  let last = null, until = Date.now() + 8000;
  const channel = new MessageChannel();
  channel.port1.onmessage = () => {
    try { const doc = getWin().document; if (doc && doc !== last) { last = doc; listenOn(doc, name); listenMessages(getWin(), name); __probe.docs = (__probe.docs || 0) + 1; } } catch (_) {}
    if (Date.now() < until) channel.port2.postMessage(0);
  };
  channel.port2.postMessage(0);
}
function hook(win, name) {
  listenOn(win, name);
  listenMessages(win, name);
}
window.__targets = {};
window.startFrame = () => {
  const frame = document.createElement('iframe');
  document.body.appendChild(frame);
  hook(frame.contentWindow, 'frame');
  __targets.frame = frame.contentWindow;
  pollDocuments(() => frame.contentWindow, 'frame');
  frame.src = '/child';
};
window.startPopup = () => {
  const win = window.open('/child', 'wo-key-popup', 'popup,width=400,height=300');
  if (!win) return false;
  hook(win, 'popup');
  pollDocuments(() => win, 'popup');
  __targets.popup = win;
  return true;
};
window.forge = (name) => {
  const caught = __probe.keys[name][__probe.keys[name].length - 1];
  if (!caught) return { caught: false };
  const pads = __woAuth.key(caught.key);
  const config = __probe.messages[name].find((m) => m && m.source === 'wardenone' && m.kind === 'config' && m.token === caught.token);
  const signsLikeTheBridge = !!config && __woAuth.same(config.mac, __woAuth.hmac(pads, config.seq + '\\nconfig\\n' + JSON.stringify(config.overrides)));
  const doc = __targets[name].document;
  const send = (id, message) => doc.dispatchEvent(new CustomEvent('wo-background-message', { detail: { token: caught.token, id, message } }));
  const body = { kind: 'toast-shown', type: 'blocked_popup' };
  const rseq = 1000;
  send('forged-' + name, Object.assign({}, body, { rseq, rmac: __woAuth.hmac(pads, 'bg-request\\n' + rseq + '\\n' + __woAuth.canon(body, 0)) }));
  send('control-' + name, { kind: 'adult-arrival' });
  return { caught: true, signsLikeTheBridge };
};
window.forgeMute = (name, rseq) => {
  const caught = __probe.keys[name][__probe.keys[name].length - 1];
  const pads = __woAuth.key(caught.key);
  const body = { kind: 'mute-toast', type: 'blocked_popup', minutes: 60 };
  __targets[name].document.dispatchEvent(new CustomEvent('wo-background-message', { detail: { token: caught.token, id: 'mute-' + rseq,
    message: Object.assign({}, body, { rseq, rmac: __woAuth.hmac(pads, 'bg-request\\n' + rseq + '\\n' + __woAuth.canon(body, 0)) }) } }));
  return true;
};
window.confirmShown = (name) => !!__targets[name].document.getElementById('wo-owned-mute-confirm');
window.replies = (name) =>__probe.messages[name].filter((m) => m && m.source === 'wardenone-bg-response').map((m) => m.id);
</script><button id="go" style="position:fixed;left:0;top:0;width:200px;height:80px" onclick="window.__opened = startPopup()">open</button>`;

const PAGES = {
  '/attack': ATTACK,
  '/child': '<p>child page</p>',
};

async function run() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-keyhandoff-'));
  const port = await profile.freePort();
  let cdp, server, browser;
  try {
    server = http.createServer((request, response) => {
      const route = new URL(request.url, 'http://x').pathname;
      const body = PAGES[route];
      response.setHeader('Content-Type', 'text/html');
      const page = '<!doctype html><title>Key hand-off fixture</title>' + (body || 'no fixture');
      /* The child's headers arrive first and its body later, which is the gap the attack needs. */
      if (route !== '/child') { response.end(page); return; }
      response.flushHeaders();
      setTimeout(() => response.end(page), 1500);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=MAP ' + host + ' 127.0.0.1']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const extension = await profile.extensionReady(cdp, port, manifest.version);
    await profile.closeExtensionTabs(cdp, port, extension.id);

    const evaluate = async (session, expression, userGesture = false) => {
      const result = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture }, session);
      if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };

    /* The popup guard would close the attacker's popup before it loads; the opener case is what is measured. */
    await evaluate(extension.attachedSession, 'updateStoredConfig(cfg=>Object.assign(cfg,{blockForcedPopups:false,strictPopupShield:false,blockPopupTricks:false})).then(()=>true)');
    await sleep(1000);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'http://' + host + ':' + server.address().port + '/attack' });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    await cdp.send('Runtime.enable', {}, page);
    /* A new tab is a finished about:blank first, so wait for the fixture itself. */
    let loaded = false;
    for (const deadline = Date.now() + 15000; !loaded && Date.now() < deadline; await sleep(100)) {
      loaded = await evaluate(page, "location.pathname==='/attack'&&document.readyState==='complete'&&typeof startFrame==='function'").catch(() => false);
    }
    if (!loaded) throw new Error('the attack fixture never loaded');

    await evaluate(page, 'startFrame()');
    /* A real click, so the popup is one a person opened and no popup guard has a reason to close it. */
    for (const type of ['mousePressed', 'mouseReleased']) {
      await cdp.send('Input.dispatchMouseEvent', { type, x: 100, y: 40, button: 'left', clickCount: 1 }, page);
    }
    await sleep(300);
    const opened = await evaluate(page, 'window.__opened === true');
    await sleep(6000);

    const results = {};
    for (const name of opened ? ['frame', 'popup'] : ['frame']) {
      const forged = await evaluate(page, `forge(${JSON.stringify(name)})`);
      await sleep(1500);
      results[name] = Object.assign(forged, { replies: await evaluate(page, `replies(${JSON.stringify(name)})`) });
    }
    if (process.env.WO_DEBUG) {
      console.log(JSON.stringify(results, null, 2));
      console.log(await evaluate(page, "JSON.stringify({frameMsgs: __probe.messages.frame.map(m=>m&&m.source+':'+m.kind), popupMsgs: __probe.messages.popup.map(m=>m&&m.source+':'+m.kind), frameHref: __targets.frame.location.href, seen: __probe.seen, docs: __probe.docs, popupHref: __targets.popup && __targets.popup.location.href, popupClosed: __targets.popup && __targets.popup.closed, popupOpener: (() => { try { return __targets.popup.opener === window; } catch (e) { return String(e); } })()})"));
    }

    for (const [name, r] of Object.entries(results)) {
      /* The stalled body makes the overhearing reliable; a run that heard nothing proved nothing. */
      assert(r.caught, name + ': the probe did not hear the key, so this run measured nothing');
      console.log('[info] ' + name + ': a same-origin ' + (name === 'frame' ? 'parent' : 'opener') + ' heard the key');
      assert(r.signsLikeTheBridge, name + ': the probe reproduces the bridge signature, so a refusal below is the bridge refusing');
      assert(r.replies.includes('control-' + name), name + ': an unsigned request still gets its answer, so the channel works');
      assert(!r.replies.includes('forged-' + name), name + ': a request signed with an overheard key is not relayed');
    }
    assert(opened, 'the attacker popup opened');

    /* A notice mute in a popup the site opened for itself: the page signs it with the overheard
       key, so WardenOne asks on its own button, and only a real click there saves the mute. */
    const targets = (await cdp.send('Target.getTargets')).targetInfos;
    const popupTarget = targets.find((t) => t.type === 'page' && /\/child$/.test(t.url) && t.openerId === targetId)
      || targets.find((t) => t.type === 'page' && /\/child$/.test(t.url));
    assert(popupTarget, 'the popup is a page CDP can reach');
    const { sessionId: popup } = await cdp.send('Target.attachToTarget', { targetId: popupTarget.targetId, flatten: true });
    await cdp.send('DOM.enable', {}, popup);
    await evaluate(page, 'forgeMute("popup", 2000)');
    await sleep(800);
    assert(!(await evaluate(page, 'confirmShown("popup")')), 'a mute with no click behind it does not even ask');
    const click = async (x, y) => {
      for (const type of ['mousePressed', 'mouseReleased']) await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 }, popup);
    };
    await click(20, 120);
    await evaluate(page, 'forgeMute("popup", 2001)');
    await sleep(800);
    assert(await evaluate(page, 'confirmShown("popup")'), 'during a real click the mute is asked about on WardenOne\'s own card');
    assert(!(await evaluate(page, 'replies("popup")')).includes('mute-2001'), 'and nothing is saved before the reader answers');
    const pageClicks = await evaluate(page, `(() => { const host = __targets.popup.document.getElementById('wo-owned-mute-confirm');
      return { shadow: host.shadowRoot === null }; })()`);
    assert(pageClicks.shadow, "the page cannot reach the card's buttons");
    const { root: doc } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true }, popup);
    const findButton = (node) => {
      if (!node) return null;
      if (node.nodeName === 'BUTTON' && (node.children || []).some((c) => c.nodeValue === 'Hide them')) return node;
      for (const child of [].concat(node.children || [], node.shadowRoots || [], node.contentDocument || [])) {
        const hit = findButton(child);
        if (hit) return hit;
      }
      return null;
    };
    const hide = findButton(doc);
    assert(hide, 'the card offers Hide them');
    const { model } = await cdp.send('DOM.getBoxModel', { backendNodeId: hide.backendNodeId }, popup);
    const [x1, y1, , , x3, y3] = model.content;
    await click((x1 + x3) / 2, (y1 + y3) / 2);
    await sleep(1200);
    const after = await evaluate(page, 'replies("popup")');
    assert(after.includes('mute-2001'), "the reader's own click on Hide them saves the mute: " + JSON.stringify(after));
    assert(!(await evaluate(page, 'confirmShown("popup")')), 'and the card goes away');
    console.log('[ok] key hand-off: an overheard key cannot sign a relayed request, and a mute it signs needs the reader\'s own click');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
    await sleep(2000); cleanupProfile(dir, 'wo-keyhandoff-');
  }
}

profile.mustFinish(run, 'browser-key-handoff').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

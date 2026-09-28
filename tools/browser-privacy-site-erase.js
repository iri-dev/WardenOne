/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

/* Manual PRIV-11 check with a disposable Edge profile and two distinct sites. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const ROOT = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function run() {
  let port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-site-erase-'));
  let cdp = null;
  try {
    const browser = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8')).version;
    let extension = await profile.extensionReady(cdp, port, version);
    console.log('[site erase] extension ready');
    const attachPopup = async () => {
      const { targetId } = await cdp.send('Target.createTarget', { url: 'chrome-extension://' + extension.id + '/popup.html' });
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      let ready = null;
      for (let i = 0; i < 40; i++) {
        await sleep(250);
        const probe = await cdp.send('Runtime.evaluate', {
          expression: `({href:location.href,storage:!!(globalThis.chrome&&chrome.storage&&chrome.storage.local)})`,
          returnByValue: true,
        }, sessionId);
        ready = probe.result && probe.result.value;
        if (ready && ready.storage) return sessionId;
      }
      throw new Error('Extension popup did not become ready: ' + JSON.stringify(ready));
    };
    const evaluate = async (sessionId, expression) => {
      const value = await cdp.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId);
      if (value.exceptionDetails) throw new Error((value.exceptionDetails.exception && value.exceptionDetails.exception.description) || value.exceptionDetails.text);
      return value.result && value.result.value;
    };
    let page = await attachPopup();
    console.log('[site erase] popup ready');
    await evaluate(page, `chrome.storage.local.set({
      wardenone_history:[{url:'https://erase-sentinel.example/one',at:Date.now()},
        {url:'https://keep-sentinel.example/two',at:Date.now()}],
      wardenone_safe_browsing_cache:{opaqueHash:{hit:true}},
      wardenone_blocklist:['erase-sentinel.example','keep-sentinel.example'],
      wardenone_cryptominer_domains:{minerHosts:['erase-sentinel.example','public-sentinel.example'],poolHosts:[]},
      wardenone_user_rules:{text:'||erase-sentinel.example^\\n||keep-sentinel.example^',updatedAt:Date.now()},
      wardenone_unusual_record:{items:[{site:'erase-sentinel.example'},{site:'keep-sentinel.example'}]},
      wardenone_config:{enabled:false,downloadSafeBrowsingKey:'site-erase-secret',
        allowlist:['erase-sentinel.example','keep-sentinel.example'],
        siteOverrides:{'erase-sentinel.example':{adShield:false},'keep-sentinel.example':{adShield:true}}}})`);
    await evaluate(page, `chrome.storage.session.set({wardenone_erase_site_sentinel:{hosts:['erase-sentinel.example','keep-sentinel.example']}})`);
    console.log('[site erase] records seeded');
    const plan = await evaluate(page, `new Promise(r=>chrome.runtime.sendMessage({kind:'privacy-data-erase-site',host:'erase-sentinel.example',dryRun:true},r))`);
    if (!plan || !plan.ok || !plan.affected.some((item) => item.key === 'wardenone_history')) throw new Error('Site erase preview failed: ' + JSON.stringify(plan));
    console.log('[site erase] preview ready');
    const erased = await evaluate(page, `new Promise(r=>chrome.runtime.sendMessage({kind:'privacy-data-erase-site',host:'erase-sentinel.example'},r))`);
    if (!erased || !erased.ok) throw new Error('Site erase failed: ' + JSON.stringify(erased));
    console.log('[site erase] erase acknowledged');
    await sleep(1600);
    /* Keep the extension ID across runtime.reload. Attaching to the worker while
       it is shutting down can leave a DevTools command without a reply. */
    page = await attachPopup();
    console.log('[site erase] reloaded popup ready');
    const after = await evaluate(page, `Promise.all([chrome.storage.local.get(null),chrome.storage.session.get(null)]).then(([l,s])=>({
      gone:!JSON.stringify(Object.entries(l).filter(([key])=>key!=='wardenone_cryptominer_domains')).includes('erase-sentinel.example')
        &&!JSON.stringify(s).includes('erase-sentinel.example'),
      kept:JSON.stringify(l).includes('keep-sentinel.example'),
      sessionKept:JSON.stringify(s).includes('keep-sentinel.example'),
      key:l.wardenone_config&&l.wardenone_config.downloadSafeBrowsingKey,
      enabled:l.wardenone_config&&l.wardenone_config.enabled,
      publicList:!!(l.wardenone_cryptominer_domains&&Array.isArray(l.wardenone_cryptominer_domains.minerHosts)
        &&l.wardenone_cryptominer_domains.minerHosts.includes('erase-sentinel.example')),
      userBlocklist:l.wardenone_blocklist,
      userRules:l.wardenone_user_rules&&l.wardenone_user_rules.text,
      cache:!!l.wardenone_safe_browsing_cache}))`);
    if (!after || !after.gone || !after.kept || after.key !== 'site-erase-secret' || after.enabled !== false || after.cache
      || !after.publicList || !Array.isArray(after.userBlocklist) || after.userBlocklist.join(',') !== 'keep-sentinel.example'
      || after.userRules !== '||keep-sentinel.example^') {
      throw new Error('Site erase changed or kept the wrong records: ' + JSON.stringify(after));
    }
    console.log('[ok] site erase removed target and shared cache, preserved the other site and global configuration');
    await profile.killBrowser(cdp, port);
    cdp.close();
    cdp = null;
    port = await profile.freePort();
    const restarted = await profile.launch(profile.edgePath(), 'on', ROOT, port, dir);
    cdp = new profile.Cdp(restarted.webSocketDebuggerUrl);
    await cdp.connect();
    extension = await profile.extensionReady(cdp, port, version);
    page = await attachPopup();
    const durable = await evaluate(page, `chrome.storage.local.get(null).then(l=>({
      gone:!JSON.stringify(Object.entries(l).filter(([key])=>key!=='wardenone_cryptominer_domains')).includes('erase-sentinel.example'),
      kept:JSON.stringify(l).includes('keep-sentinel.example'),
      key:l.wardenone_config&&l.wardenone_config.downloadSafeBrowsingKey}))`);
    if (!durable || !durable.gone || !durable.kept || durable.key !== 'site-erase-secret') {
      throw new Error('Site erase did not survive a browser restart: ' + JSON.stringify(durable));
    }
    console.log('[ok] site erase remains effective after a full browser restart');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const tempRoot = path.resolve(os.tmpdir()) + path.sep;
    if (!path.resolve(dir).startsWith(tempRoot)) throw new Error('Refusing to remove a profile outside temp');
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

if (require.main === module) run().catch((error) => { console.error(error); process.exitCode = 1; });

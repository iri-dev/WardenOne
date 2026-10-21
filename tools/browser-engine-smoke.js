/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Check real-page startup, config changes, signed tally relay and network blocking in a local browser fixture.
   Runs with Edge and minimum-supported Chrome in CI; requires host-resolver rules.
   Run: node tools/browser-engine-smoke.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const PAGE_HOST = 'shop.wardenone-smoke.example';
const CONTROL_HOST = 'cdn.wardenone-smoke.example';
const DEVICE_FIXTURE = '0123456789abcdef0123456789abcdef';

/* Domains the shipped tracker list blocks outright for a script's fetch, wherever it is loaded:
   a block rule naming the domain, for every resource type or for xmlhttprequest, and with no
   initiator, method or first-party condition that would leave this page out. */
function listedTrackers() {
  const out = [];
  const rules = JSON.parse(fs.readFileSync(path.join(root, 'rules-trackers.json'), 'utf8'));
  for (const rule of rules) {
    const c = rule.condition || {};
    if (!rule.action || rule.action.type !== 'block') continue;
    if (c.initiatorDomains || c.excludedInitiatorDomains || c.requestMethods || c.excludedRequestMethods || c.domainType === 'firstParty') continue;
    if (c.resourceTypes && !c.resourceTypes.includes('xmlhttprequest')) continue;
    if (c.excludedResourceTypes && c.excludedResourceTypes.includes('xmlhttprequest')) continue;
    const domains = Array.isArray(c.requestDomains) ? c.requestDomains
      : (/^\|\|([a-z0-9.-]+\.[a-z]{2,})\^?$/.exec(c.urlFilter || '') || []).slice(1);
    for (const d of domains) if (/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d) && !out.includes(d)) out.push(d);
    if (out.length >= 5) break;
  }
  return out;
}

async function run() {
  const trackers = listedTrackers();
  assert(trackers.length >= 3, 'the tracker list names domains to test against');
  const hits = [];
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    hits.push(host + req.url);
    if (req.url.startsWith('/issued-media')) {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ file: `http://${CONTROL_HOST}:${serverPort}/segment.m4s?buvid=${DEVICE_FIXTURE}` }));
      return;
    }
    if (req.url === '/icann-frame') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end('<!doctype html><title>ICANN frame</title><p>Frame.</p>');
      return;
    }
    if (req.url.startsWith('/page')) {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      res.end('<!doctype html><title>Smoke</title><a id="tracked" href="/next" ping="/ping-beacon">Next</a><p>A page.</p>'
        + '<iframe src="http://frame.x.or.jp:' + serverPort + '/icann-frame" title="ICANN boundary fixture"></iframe>');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
    res.end('ok');
  });
  const serverPort = await profile.freePort();
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-engine-smoke-'));
  const mapped = [PAGE_HOST, CONTROL_HOST, 'frame.x.or.jp'].concat(trackers).map((h) => 'MAP ' + h + ' 127.0.0.1').join(', ');
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'on', root, port, dir,
      ['--host-resolver-rules=' + mapped]);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
    const extension = await profile.extensionReady(cdp, port, version);
    await profile.closeExtensionTabs(cdp, port, extension.id);
    const attach = async (targetId) => {
      const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
      await cdp.send('Runtime.enable', {}, sessionId);
      return sessionId;
    };
    const evaluate = async (sessionId, expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId);
      if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ' -> ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    const until = async (sessionId, expression, label, ms) => {
      for (const deadline = Date.now() + (ms || 15000); Date.now() < deadline; await sleep(100)) {
        try { if (await evaluate(sessionId, expression)) return; } catch (_) {}
      }
      throw new Error('Timed out waiting for ' + label);
    };
    const { targetInfos } = await cdp.send('Target.getTargets');
    const workerTarget = targetInfos.find((t) => t.type === 'service_worker' && t.url === `chrome-extension://${extension.id}/background.js`);
    assert(workerTarget, 'the WardenOne service worker');
    const worker = await attach(workerTarget.targetId);
    const { targetId: settingsId } = await cdp.send('Target.createTarget', { url: `chrome-extension://${extension.id}/settings.html` });
    const settings = await attach(settingsId);
    await until(settings, "typeof loaded !== 'undefined' && loaded === true", 'Settings to load');

    const pageUrl = `http://${PAGE_HOST}:${serverPort}/page`;
    const { targetId: pageId } = await cdp.send('Target.createTarget', { url: pageUrl });
    const page = await attach(pageId);
    await until(page, "document.readyState === 'complete'", 'the page to load');

    /* 1. The engine starts in the page's own world. */
    await until(page, `window.__wardenOneReadyVersion === ${JSON.stringify(version)}`, 'the page engine to start, at ' + version);

    /* 2. It acts on the config it was handed: the tracking ping on the link goes. */
    await until(page, "!document.getElementById('tracked').hasAttribute('ping')", 'the engine to strip the link\'s tracking ping');

    /* 3. Its signed report crosses the bridge to the worker. */
    const tabId = await evaluate(worker, `chrome.tabs.query({}).then((tabs) => (tabs.find((t) => String(t.url || '').startsWith(${JSON.stringify(pageUrl)})) || {}).id)`);
    assert(Number.isInteger(tabId), 'the page has a tab');
    const boundaryProbe = `(() => {
      const suffixes = ['or.jp','web.id','me.uk','ltd.uk','sch.uk','nhs.uk','or.kr','pe.kr','id.au','k12.ca.us'];
      return suffixes.every((s) => registrableDomain('x.' + s) === 'x.' + s
        && !sameSiteDomain('x.' + s, 'y.' + s) && !hostMatchesSite('x.' + s, s));
    })`;
    assert.equal(await evaluate(worker, boundaryProbe + '()'), true, 'worker uses ICANN boundaries');
    for (const world of ['MAIN', 'ISOLATED']) {
      const results = await evaluate(worker, `chrome.scripting.executeScript({
        target: {tabId: ${tabId}, allFrames: true}, world: ${JSON.stringify(world)}, func: ${boundaryProbe}
      }).then((rows) => rows.map((row) => row.result))`);
      assert(results.length >= 2 && results.every((result) => result === true), world + ' has ICANN data in the page and its cross-site frame');
    }
    const tallied = `chrome.runtime.sendMessage({ kind: 'site-dashboard', tabId: ${tabId} }).then((d) => JSON.stringify(d || {}).includes('stripped_link_ping'))`;
    await until(settings, tallied, 'the worker to count the stripped ping for the Site Dashboard');
    /* 4. An unlisted host loads, while a listed one is blocked. Edge can stop known trackers
       before DNR records a match, so testMatchOutcome also checks the shipped rule itself. */
    await until(worker, "chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => ids.includes('trackers'))", 'the shipped tracker ruleset to activate');
    const probe = async (host) => evaluate(page, `fetch('http://${host}:${serverPort}/probe-' + Date.now()).then((r) => 'loaded ' + r.status, (e) => 'blocked')`);
    assert.equal(await probe(CONTROL_HOST), 'loaded 200', 'an unlisted host still loads, so the test can tell a block from a broken page');
    let blocked = '';
    let matchedRule;
    for (const tracker of trackers) {
      const outcome = await evaluate(worker, `chrome.declarativeNetRequest.testMatchOutcome({ url: 'http://${tracker}:${serverPort}/probe-rule', initiator: ${JSON.stringify(pageUrl)}, type: 'xmlhttprequest', tabId: ${tabId} }).then((r) => r.matchedRules)`);
      const rule = outcome.find((item) => item.rulesetId === 'trackers');
      if (!rule || (await probe(tracker)) !== 'blocked') continue;
      blocked = tracker;
      matchedRule = rule;
      break;
    }
    assert(blocked, 'a listed tracker was blocked by the browser and matched by the shipped ruleset: tried ' + trackers.join(', '));
    assert(!hits.some((h) => h.startsWith(blocked + '/')), 'the blocked request never reached the server');

    const issuedProbe = await evaluate(page, `(async () => {
      const token=${JSON.stringify(DEVICE_FIXTURE)};
      localStorage.setItem('wo-device-fixture',token);
      const url='http://${CONTROL_HOST}:${serverPort}/segment.m4s?buvid='+token;
      const fetchResult=async (url,init)=>fetch(url,init).then(r=>'loaded '+r.status,e=>e.name);
      const before=await fetchResult(url);
      const issued=await fetch('/issued-media').then(r=>r.json());
      const after=await fetchResult(issued.file);
      const foreign=await fetchResult(issued.file.replace('/segment.m4s','/collect'));
      const header=await fetchResult(issued.file,{headers:{Authorization:'Bearer '+token}});
      const body=await fetchResult(issued.file,{method:'POST',body:'session='+token});
      const beacon=navigator.sendBeacon(issued.file,'session='+token);
      const xhr=await new Promise(resolve=>{
        const x=new XMLHttpRequest();x.open('GET','/issued-media?reader=xhr');x.responseType='json';
        x.onload=()=>{const media=new XMLHttpRequest();media.open('GET',x.response.file);
          media.onload=()=>resolve(media.status);media.onerror=()=>resolve(0);media.send();};
        x.onerror=()=>resolve(0);x.send();
      });
      localStorage.removeItem('wo-device-fixture');
      return {before,after,foreign,header,body,beacon,xhr};
    })()`);
    assert.deepEqual(issuedProbe, {
      before: 'SecurityError', after: 'loaded 200', foreign: 'SecurityError',
      header: 'SecurityError', body: 'SecurityError', beacon: false, xhr: 200,
    }, 'native fetch/XHR recognise issued device identifiers while credentials and changed paths stay blocked');
    assert.equal(hits.filter((h) => h.startsWith(CONTROL_HOST + '/segment.m4s')).length, 2,
      'only the two issued GET requests reached the media fixture');
    assert(!hits.some((h) => h.startsWith(CONTROL_HOST + '/collect')), 'the altered destination never left the browser');

    /* Check Chrome's packaged DNR matcher, including priority against the media allow. */
    await until(worker, "chrome.declarativeNetRequest.getEnabledRulesets().then((ids) => ids.includes('spotify_media'))",
      'the Spotify media ruleset to activate');
    const spotifyCases = [
      ['music', 'https://audio-fa.scdn.co/audio/song', 11],
      ['music mp3', 'https://audio-fa.scdn.co/mp3/song', 11],
      ['preview', 'https://audio.spotifycdn.com/audio/preview.mp3', 11],
      ['podcast', 'https://chtbl.com/track/podcast.mp3', 11],
      ['podcast CDN', 'https://media.akamaized.net/audio/episode.mp3', 11],
      ['ad path', 'https://audio-fa.scdn.co/mp3-ad/creative.mp3', 3],
      ['ad host', 'https://adstudio-assets.scdn.co/creative.mp4', 9],
    ];
    for (const [label, url, ruleId] of spotifyCases) {
      const outcome = await evaluate(worker, `chrome.declarativeNetRequest.testMatchOutcome({
        url: ${JSON.stringify(url)}, initiator: 'https://open.spotify.com/', type: 'media'
      }).then((r) => r.matchedRules)`);
      assert(outcome.some((rule) => rule.rulesetId === 'spotify_media' && rule.ruleId === ruleId),
        label + ' selected Spotify rule ' + ruleId + ': ' + JSON.stringify(outcome));
      assert(!outcome.some((rule) => rule.rulesetId === 'spotify_media' && rule.ruleId !== ruleId),
        label + ' matched another Spotify rule: ' + JSON.stringify(outcome));
    }

    /* 2b. The config the engine acts on is the one the bridge delivers, not its built-in defaults:
       switched off in Settings, the change reaches this open page, and a tracked link added after it
       keeps its ping; switched back on, the next one loses it. Done on the open page because at a
       page's start the engine falls back to its defaults if the worker has not answered within
       1.5 s, which a fresh load can lose to. */
    const addLink = (id) => evaluate(page, `(() => { const a = document.createElement('a'); a.id = ${JSON.stringify(id)}; a.href = '/next'; a.setAttribute('ping', '/ping-beacon'); a.textContent = 'More'; document.body.appendChild(a); return true; })()`);
    const kept = (id) => evaluate(page, `document.getElementById(${JSON.stringify(id)}).hasAttribute('ping')`);
    await evaluate(settings, "writeConfig({ unshimLinks: false }).then(() => true)");
    await until(page, 'window.__WO_CONFIG__ && window.__WO_CONFIG__.unshimLinks === false', 'the off switch to reach the page');
    await addLink('added-off');
    await sleep(800);
    assert(await kept('added-off'), 'with the switch off in Settings the engine still stripped a new link\'s ping, so the change never reached it');
    await evaluate(settings, "writeConfig({ unshimLinks: true }).then(() => true)");
    await until(page, 'window.__WO_CONFIG__ && window.__WO_CONFIG__.unshimLinks === true', 'the on switch to reach the page');
    await addLink('added-on');
    await until(page, "!document.getElementById('added-on').hasAttribute('ping')", 'the switch turned back on to reach the page');

    const contentSource = fs.readFileSync(path.join(root, 'src/content.js'), 'utf8');
    const compilerStart = contentSource.indexOf('function userCosmeticCss(');
    const compilerEnd = contentSource.indexOf('      const host=location.hostname,', compilerStart);
    assert(compilerStart > 0 && compilerEnd > compilerStart, 'the shipped user cosmetic compiler is available');
    const compiler = contentSource.slice(compilerStart, compilerEnd);
    const cssProbe = await evaluate(page, `(() => {
      ${compiler}
      const first=document.createElement('div'),last=document.createElement('div'),sheet=document.createElement('style');
      first.id='wo-cosmetic-first';last.id='wo-cosmetic-last';
      first.textContent='First';last.textContent='Last';document.body.append(first,last,sheet);
      const valid=['#wo-cosmetic-first','#wo-cosmetic-last'];
      sheet.textContent=valid.concat('a:-abp-contains(x)').join(',')+'{display:none!important;}';
      const controlVisible=valid.every((s)=>getComputedStyle(document.querySelector(s)).display!=='none');
      const failures=[];
      for(const invalid of ['a[href=','a:-abp-contains(x)',':unknown-pseudo','[data-x="unterminated',':is(','div/*']){
        const compiled=userCosmeticCss([valid[0],invalid,valid[1]]);
        sheet.textContent=compiled;
        if(compiled!==userCosmeticCss(valid))failures.push('accepted malformed selector: '+invalid);
        if(!valid.every((s)=>getComputedStyle(document.querySelector(s)).display==='none'))failures.push(invalid);
      }
      const normalized=userCosmeticCss(['#wo-cosmetic-first, #wo-cosmetic-last','article:has(.promo)','div::before','[data-x=","]']);
      const rejected=userCosmeticCss(['div{color:red}', '@import url(x)', '<style>', 'div;body']);
      const capped=userCosmeticCss(Array.from({length:5001},(_,i)=>'#cosmetic-cap-'+i));
      sheet.textContent=capped;
      const empty=userCosmeticCss([])===''&&userCosmeticCss(null)==='';
      const result={controlVisible,failures,normalized,rejected,empty,cap:!capped.includes('#cosmetic-cap-5000')
        &&sheet.sheet.cssRules.length===1&&sheet.sheet.cssRules[0].selectorText.split(',').length===5000};
      first.remove();last.remove();sheet.remove();return result;
    })()`);
    assert(cssProbe.controlVisible, 'the native CSS control reproduces a poisoned selector list');
    assert.deepEqual(cssProbe.failures, [], 'each malformed selector is isolated by the browser parser');
    assert(cssProbe.normalized.includes('article:has(.promo)') && cssProbe.normalized.includes('div::before')
      && cssProbe.normalized.includes('#wo-cosmetic-first, #wo-cosmetic-last'), 'native selector lists, :has and pseudo-elements survive');
    assert(cssProbe.rejected === '' && cssProbe.empty && cssProbe.cap, 'CSS injection characters and the selector cap stay enforced');
    const savedRules = await evaluate(settings, `chrome.runtime.sendMessage({kind:'user-rules-set',source:'settings-import',text:
      '##.wo-user-first\\n##a[href=\\n##.wo-user-last\\n##a:-abp-contains(x)'} )`);
    assert(savedRules.ok && savedRules.errors.some((error)=>/procedural/.test(error.why)), 'unsupported list operators are reported');
    await evaluate(worker, `chrome.storage.local.set({wardenone_custom_lists:[{
      id:'cl_cosmetic_fixture',url:'https://lists.wardenone.example/cosmetic.txt',title:'Cosmetic fixture',enabled:true,
      text:'##.wo-list-first\\n##a:-abp-contains(x)\\n##a[href=\\n##.wo-list-last',updatedAt:Date.now()
    }]}).then(()=>{invalidateUserFilters();return true})`);
    await cdp.send('Page.navigate', { url: pageUrl + '?cosmetic-fixture' }, page);
    await until(page, `window.__wardenOneReadyVersion===${JSON.stringify(version)}`, 'engine after cosmetic save');
    await evaluate(page, `['wo-user-first','wo-user-last','wo-list-first','wo-list-last'].forEach((name)=>{
      const node=document.createElement('div');node.className=name;node.textContent=name;document.body.appendChild(node)
    })`);
    await until(page, `['wo-user-first','wo-user-last','wo-list-first','wo-list-last'].every((name)=>
      getComputedStyle(document.querySelector('.'+name)).display==='none')`, 'valid imported and subscribed cosmetics');
    await evaluate(settings, "chrome.runtime.sendMessage({kind:'user-rules-set',text:''})");
    await evaluate(worker, 'chrome.storage.local.remove("wardenone_custom_lists").then(()=>{invalidateUserFilters();return true})');
    console.log('[ok] native CSS isolation and imported/subscribed user cosmetics');

    /* Fulfilled HTTPS documents exercise Chrome's real manifest matcher without visiting accounts. */
    await evaluate(settings, 'writeConfig({antiFingerprintNoise:true,antiFingerprint:true,commandPasteGuard:true}).then(()=>true)');
    const fixture = '<!doctype html><title>Hosted content fixture</title><div id="editor" contenteditable="true">Draft</div>'
      + '<form id="normal-form"><input name="answer" value="Example"><button id="send" type="submit">Send</button></form>'
      + '<a id="hosted-tracked" href="/next" ping="/beacon">Next</a><script>window.fixtureSubmitted=0;'
      + 'document.getElementById("normal-form").addEventListener("submit",e=>{e.preventDefault();window.fixtureSubmitted++;'
      + 'window.fixtureSubmitter=e.submitter&&e.submitter.id});window.hostedFixture=true;</script>';
    const { targetId: hostedId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const hosted = await attach(hostedId);
    await cdp.send('Page.enable', {}, hosted);
    await cdp.send('Page.bringToFront', {}, hosted);
    const stopFixtures = cdp.on((message) => {
      if (message.sessionId !== hosted || message.method !== 'Fetch.requestPaused') return;
      void cdp.send('Fetch.fulfillRequest', {
        requestId: message.params.requestId, responseCode: 200,
        responseHeaders: [{ name: 'Content-Type', value: 'text/html; charset=utf-8' }],
        body: Buffer.from(fixture).toString('base64'),
      }, hosted).catch(() => {});
    });
    try {
      await cdp.send('Fetch.enable', { patterns: [{ urlPattern: 'https://*/*', resourceType: 'Document', requestStage: 'Request' }] }, hosted);
      const protectedPages = [
        'https://docs.google.com/forms/d/e/fixture/viewform',
        'https://docs.google.com/document/d/fixture/edit',
        'https://drive.google.com/file/d/fixture/view',
        ...['okta.com','auth0.com','onelogin.com','duosecurity.com','pingone.com','b2clogin.com','ciamlogin.com','amazoncognito.com','shopify.com']
          .map((domain) => 'https://tenant.' + domain + '/content/shared-page'),
        'https://tenant.b2clogin.com/content/page?next=/login/oauth2/authorize',
      ];
      const loginPages = [
        'https://tenant.okta.com/login/login.htm', 'https://tenant.auth0.com/u/login/identifier',
        'https://tenant.onelogin.com/oidc/2/auth', 'https://api-fixture.duosecurity.com/frame/v4/auth',
        'https://auth.pingone.com/environment/as/authorize',
        'https://tenant.b2clogin.com/tenant.onmicrosoft.com/policy/oauth2/v2.0/authorize',
        'https://tenant.ciamlogin.com/tenant/oauth2/v2.0/authorize',
        'https://pool.auth.eu-west-2.amazoncognito.com/login',
        'https://admin.shopify.com/authentication/login',
      ];
      for (const [protectedPage, urls] of [[true, protectedPages], [false, loginPages]]) {
        for (const url of urls) {
          await cdp.send('Page.navigate', { url }, hosted);
          await until(hosted, 'window.hostedFixture===true && location.href===' + JSON.stringify(url), 'hosted fixture ' + url);
          if (!protectedPage) {
            await sleep(400);
            assert.equal(await evaluate(hosted, '!!window.__wardenOneReadyVersion || !!window.__wardenOnePermissionChainInstalled'), false, 'login hooks stay absent: ' + url);
            continue;
          }
          await until(hosted, 'window.__wardenOneReadyVersion===' + JSON.stringify(version), 'hosted engine ' + url);
          await until(hosted, '!document.getElementById("hosted-tracked").hasAttribute("ping")', 'page guard on ' + url);
          assert.equal(await evaluate(hosted, 'window.__wardenOneRealm && window.__wardenOneRealm.noise'), false, 'hosted browser signals stay native: ' + url);
          const formWorks = await evaluate(hosted, '(() => {document.getElementById("editor").textContent="Edited";'
            + 'document.getElementById("normal-form").requestSubmit(document.getElementById("send"));'
            + 'return fixtureSubmitted===1&&fixtureSubmitter==="send"&&document.getElementById("editor").textContent==="Edited"})()');
          assert.equal(formWorks, true, 'editing and form submitters survive: ' + url);
          if (url.includes('/forms/')) {
            await evaluate(hosted, '(() => {const p=document.createElement("div");p.textContent="Verify you are human. Press Win+R, then press Ctrl+V and press Enter to complete verification.";document.body.appendChild(p)})()');
            await until(hosted, '!!document.getElementById("wo-cmd-warn")', 'ClickFix warning on a hosted form');
          }
        }
      }
      console.log('[ok] HTTPS engine coverage: ' + protectedPages.length + ' protected content pages and ' + loginPages.length + ' untouched login routes');
    } finally {
      stopFixtures();
      await cdp.send('Target.closeTarget', { targetId: hostedId }).catch(() => {});
    }

    console.log('[ok] the page engine, the bridge, Spotify media rules and a shipped network rule work in ' + browser.Browser
      + ' (blocked ' + blocked + ', ruleset ' + matchedRule.rulesetId + ')');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-engine-smoke-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
profile.mustFinish(run, 'browser-engine-smoke').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

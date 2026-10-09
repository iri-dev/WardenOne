/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Reproduces Playmogo's ad overlays, frame hijack, and tab redirect against a
   browser player fixture. --control confirms the local traps trigger;
   WARDENONE_HEADLESS=1 permits input on a locked desktop. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

const root = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CONTROL = process.argv.includes('--control');
const SITE = 'watch.wo-player-test.example';
/* Neutral names, so a shipped filter list cannot be what stops them. */
const ELSEWHERE = 'pages.wo-elsewhere-test.example';
const MEDIA_SECONDS = 20;

function playerPage(port) {
  const away = (p) => `http://${ELSEWHERE}:${port}${p}`;
  return `<!doctype html><title>Player</title><body style="margin:0;background:#000">
<div class="video-js" id="video_player" style="position:relative;width:880px;height:495px;background:#111">
  <video id="v" style="position:absolute;left:0;top:0;width:880px;height:495px"></video>
  <button id="play" class="vjs-big-play-button" type="button" style="position:absolute;left:380px;top:207px;width:120px;height:80px;z-index:10">Play</button>
  <a id="visible" href="${away('/mirror/watch')}" style="position:absolute;left:12px;top:12px;z-index:10;background:#fff;color:#000;padding:6px;font:16px sans-serif">Watch on the mirror</a>
  <button id="server" type="button" style="position:absolute;right:12px;top:12px;z-index:10;background:#fff;color:#000;padding:6px;font:16px sans-serif">Switch server</button>
  <div class="vjs-control-bar" style="position:absolute;left:0;bottom:0;width:100%;height:40px;z-index:10;background:#222">
    <div class="vjs-progress-control vjs-control" style="position:absolute;left:40px;right:40px;top:0;bottom:0">
      <div id="rail" class="vjs-progress-holder vjs-slider" role="slider" tabindex="0" aria-label="Progress Bar"
           style="position:absolute;left:0;right:0;top:14px;height:12px;background:#666"></div>
    </div>
  </div>
</div>
<script>
  window.__seeks = 0; window.__playPresses = 0; window.__adPresses = 0;
  const v = document.getElementById('v');
  /* This fixture tests input delivery. Resource Saver's browser suite checks actual playback. */
  let seekPosition = 0;
  Object.defineProperties(v, {
    duration: { configurable: true, get: () => ${MEDIA_SECONDS} },
    currentTime: { configurable: true, get: () => seekPosition, set: (value) => { seekPosition = Number(value) || 0; } },
  });
  const rail = document.getElementById('rail');
  /* The player: like video.js, the timeline seeks on the press itself. */
  rail.addEventListener('mousedown', (e) => {
    const r = rail.getBoundingClientRect();
    v.currentTime = v.duration * Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    window.__seeks++;
  });
  document.getElementById('play').addEventListener('click', () => { window.__playPresses++; });
  /* The site's own server switch, a visible button over the video that moves the player from
     script rather than through a link. */
  document.getElementById('server').addEventListener('click', () => { location.assign('${away('/embed/server2')}'); });
  /* The ad layers, appended to <body> after the player the way the networks do it. */
  setTimeout(() => {
    const cover = document.createElement('div');
    cover.id = 'khz2y9w';
    cover.style.cssText = 'position:fixed;inset:0;z-index:2147483647;background:black;opacity:0.01';
    const link = document.createElement('a');
    link.id = 'lkf8s';
    link.href = '${away('/4/52106d0b?sub3=invoke_layer')}';
    link.target = '_blank';
    link.style.cssText = 'display:block;height:100%';
    link.addEventListener('click', () => { window.__adPresses++; });
    cover.appendChild(link);
    document.body.appendChild(cover);
    const square = document.createElement('div');
    square.id = 'square';
    square.style.cssText = 'height:120px;width:120px;z-index:2147483647;cursor:pointer;top:187px;left:380px;position:fixed;display:block';
    square.addEventListener('click', () => { window.__adPresses++; window.open('${away('/pop/square')}', '_blank'); });
    document.body.appendChild(square);
  }, 200);
  /* The press harvester (dd.gillyspencie.com): at the top of the document, ahead of the player,
     it cancels and stops every mousedown and click until its advert has been shown. */
  const harvest = (e) => { if (e.target && e.target.id === 'visible') return; e.preventDefault(); e.stopImmediatePropagation(); };
  document.addEventListener('mousedown', harvest, true);
  /* The hijack: a press on the video opens the advert and then sends this frame after it. */
  document.addEventListener('click', (e) => {
    if (e.target && e.target.id === 'visible') return;
    window.open('${away('/pop/document')}', '_blank');
    setTimeout(() => { location.href = '${away('/lp/landing')}'; }, 400);
    harvest(e);
  }, true);
  /* The tab redirect (cdn.tsyndicate.com engine.js): the press on play sends the whole tab away. */
  document.getElementById('play').addEventListener('click', () => {
    setTimeout(() => { top.location.href = '${away('/direct/click')}'; }, 200);
  });
</script></body>`;
}

/* The page around the player. It carries the empty interstitial shell an advert left on <html>:
   fixed, inset 0, the highest z-index, nothing inside but empty boxes and a style sheet. Its own
   handler would send the player frame to the advert from the page. */
function pageAround(port) {
  return `<!doctype html><title>Video</title><body style="margin:0">
<iframe id="f" src="/e/7qftyd95nnrj" width="880" height="495" style="border:0;display:block" allowfullscreen></iframe>
<script>
  setTimeout(() => {
    const shell = document.createElement('div');
    shell.id = 'shell';
    shell.setAttribute('data-shb', '1');
    shell.style.cssText = 'inset:0;z-index:2147483647;position:fixed;display:block;overflow:hidden';
    shell.innerHTML = '<div class="D1BnW" style="width:100vw;height:100dvh"><div class="notranslate" style="width:inherit;height:inherit;overflow:hidden"></div></div><style>.D1BnW{position:relative}</style>';
    shell.addEventListener('click', () => { window.__shellPresses = (window.__shellPresses || 0) + 1; document.getElementById('f').src = 'http://${ELSEWHERE}:${port}/lp/from-page'; });
    document.documentElement.appendChild(shell);
  }, 150);
</script></body>`;
}

async function run() {
  const hits = [];
  let serverPort = 0;
  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    hits.push(host + req.url);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    if (host === SITE && req.url.startsWith('/d/')) { res.end(pageAround(serverPort)); return; }
    if (host === SITE && req.url.startsWith('/e/')) { res.end(playerPage(serverPort)); return; }
    res.end('<!doctype html><title>Elsewhere</title><p>Somewhere else.</p>');
  });
  serverPort = await profile.freePort();
  await new Promise((resolve) => server.listen(serverPort, '127.0.0.1', resolve));
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-player-layers-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), CONTROL ? 'off' : 'on', root, port, dir,
      ['--host-resolver-rules=MAP ' + SITE + ' 127.0.0.1, MAP ' + ELSEWHERE + ' 127.0.0.1', '--autoplay-policy=no-user-gesture-required']);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    if (!CONTROL) {
      const version = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8')).version;
      const extension = await profile.extensionReady(cdp, port, version);
      await profile.closeExtensionTabs(cdp, port, extension.id);
    }
    const pages = new Map();
    await cdp.send('Target.setDiscoverTargets', { discover: true });
    cdp.on((msg) => {
      const info = msg.params && msg.params.targetInfo;
      if (msg.method === 'Target.targetCreated' && info && info.type === 'page') pages.set(info.targetId, info.url);
      if (msg.method === 'Target.targetInfoChanged' && info && info.type === 'page' && pages.has(info.targetId)) pages.set(info.targetId, info.url);
      if (msg.method === 'Target.targetDestroyed') pages.delete(msg.params.targetId);
    });
    const { targetId: pageId } = await cdp.send('Target.createTarget', { url: `http://${SITE}:${serverPort}/d/7qftyd95nnrj` });
    const { sessionId: page } = await cdp.send('Target.attachToTarget', { targetId: pageId, flatten: true });
    await cdp.send('Runtime.enable', {}, page);
    await cdp.send('Page.enable', {}, page);
    /* A tab behind the browser's start tab is not hit-tested, so pressed input would go nowhere. */
    await cdp.send('Page.bringToFront', {}, page);
    const evaluate = async (expression) => {
      const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, page);
      if (r.exceptionDetails) throw new Error(expression.slice(0, 80) + ' -> ' + JSON.stringify(r.exceptionDetails).slice(0, 400));
      return r.result.value;
    };
    /* The player frame is same-origin with the page, so the page's own world can read it. */
    const inPlayer = (body) => evaluate(`(() => { try { const w = document.getElementById('f').contentWindow; const d = w.document; return (${body}); } catch (e) { return 'unreadable: ' + e.message; } })()`);
    const until = async (body, label, ms) => {
      let last;
      for (const deadline = Date.now() + (ms || 15000); Date.now() < deadline; await sleep(100)) {
        try { last = await inPlayer(body); if (last === true) return; } catch (_) {}
      }
      throw new Error('Timed out waiting for ' + label + ' (last: ' + JSON.stringify(last) + ')');
    };
    const press = async (x, y) => {
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'none', buttons: 0 }, page);
      await sleep(60);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 }, page);
      await sleep(60);
      await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 }, page);
      await sleep(60);
    };
    const strays = () => [...pages.entries()].filter(([id]) => id !== pageId).map(([, url]) => url)
      .filter((url) => !/^(about:blank|chrome-extension:|edge:|chrome:)/.test(url) || url === 'about:blank#popup');
    const awayHits = () => hits.filter((h) => h.startsWith(ELSEWHERE + '/') && !/\/favicon\.ico$/.test(h));

    /* Each half reports its own state so a stalled fixture points to the missing piece. */
    const loading = "(() => { const v = d.getElementById('v'); return { square: !!d.getElementById('square'), cover: !!d.getElementById('khz2y9w'),"
      + " video: !!v, duration: v && v.duration, seeks: w.__seeks, path: w.location.pathname }; })()";
    let loaded;
    for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(100)) {
      loaded = await inPlayer(loading).catch((error) => 'unreadable: ' + error.message);
      if (loaded && loaded.square && loaded.cover && loaded.video && loaded.duration === MEDIA_SECONDS) break;
    }
    if (!loaded || !loaded.square || !loaded.cover || !loaded.video || loaded.duration !== MEDIA_SECONDS) {
      assert.fail('the player and ad layers to arrive: ' + JSON.stringify({ loaded, browser: browser.Browser, requests: hits.slice(-12) }));
    }
    const duration = await inPlayer("w.document.getElementById('v').duration");
    assert.equal(duration, MEDIA_SECONDS, 'the timeline has the expected duration');
    const tabsAtStart = pages.size;

    /* 1. The layer and the square are click-through before anyone presses. */
    const disarmed = "['khz2y9w', 'lkf8s', 'square'].every((id) => w.getComputedStyle(d.getElementById(id)).pointerEvents === 'none')";
    if (CONTROL) {
      assert.equal(await inPlayer(disarmed), false, 'control: without WardenOne the layers still catch presses');
    } else {
      await until(disarmed, 'the invisible ad layer and the empty square to be made click-through', 5000);
      for (const deadline = Date.now() + 5000; Date.now() < deadline; await sleep(100)) {
        if (await evaluate("!!document.getElementById('shell') && getComputedStyle(document.getElementById('shell')).pointerEvents === 'none'")) break;
      }
      assert.equal(await evaluate("getComputedStyle(document.getElementById('shell')).pointerEvents"), 'none',
        'the empty interstitial shell the page laid over the player frame is click-through');
    }

    /* 2. The first press on the timeline is a seek. Every navigation the player frame starts is
          noted on the page, which outlives the frame if it leaves, so a frame that got away says
          how: listening after WardenOne's guard, this sees whether the guard cancelled it. */
    if (!CONTROL) {
      await inPlayer("(w.navigation.addEventListener('navigate', (e) => { (window.__woFrameNavigations = window.__woFrameNavigations || []).push({"
        + " at: Date.now(), url: e.destination && e.destination.url, type: e.navigationType, cancelable: e.cancelable,"
        + " cancelled: e.defaultPrevented, userInitiated: e.userInitiated, activation: !!(w.navigator.userActivation && w.navigator.userActivation.isActive),"
        + " playerPressAt: Number(w.__wardenOnePlayerPressAt) || 0 }); }), true)");
    }
    const rail = await inPlayer("(() => { const r = d.getElementById('rail').getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; })()");
    const pressedAt = await evaluate('Date.now()');
    await press(rail[0] + rail[2] * 0.75, rail[1] + rail[3] / 2);
    await sleep(1500);
    const seek = await inPlayer("({ seeks: w.__seeks, at: w.document.getElementById('v').currentTime, adPresses: w.__adPresses, where: w.location.pathname })");
    const frameStory = async () => JSON.stringify({ seek, rail, pressedAt, browser: browser.Browser,
      navigations: await evaluate('window.__woFrameNavigations || []'), awayHits: awayHits() });
    if (CONTROL) {
      /* Either the frame has already been sent away (and is unreadable) or the press hit the layer. */
      assert(typeof seek === 'string' || seek.seeks === 0, 'control: without WardenOne the timeline press never reached the timeline: ' + JSON.stringify(seek));
      assert(awayHits().length > 0, 'control: without WardenOne the press reached the advert: '
        + JSON.stringify({ seek, hits: hits.slice(-8), tabs: [...pages.values()] }));
      console.log('[ok] control: without WardenOne the page reproduces the tricks (' + awayHits().length + ' advert requests, ' + strays().length + ' advert tabs)');
      return;
    }
    if (typeof seek === 'string' || seek.seeks !== 1) assert.fail('the first press on the timeline reached it: ' + await frameStory());
    assert(Math.abs(seek.at - MEDIA_SECONDS * 0.75) < 0.5, 'and seeked to where it was pressed: ' + JSON.stringify(seek));
    assert.equal(seek.adPresses, 0, 'no press reached the advert link or square: ' + JSON.stringify(seek));

    /* 2b. Monetag re-arms its layer after a click. Done here from the page's own world on the same
           DOM nodes, both ways a script would: a CSSOM write, and a cssText rewrite that drops
           WardenOne's declaration. The next press on the timeline must still be a seek. */
    await inPlayer("(() => { d.getElementById('khz2y9w').style.pointerEvents = 'auto';"
      + " d.getElementById('lkf8s').style.cssText = 'display:block;height:100%'; return true; })()");
    await until("['khz2y9w', 'lkf8s'].every((id) => w.getComputedStyle(d.getElementById(id)).pointerEvents === 'none')",
      'the re-armed layer to be made click-through again', 3000);
    await press(rail[0] + rail[2] * 0.25, rail[1] + rail[3] / 2);
    await sleep(1200);
    const reseek = await inPlayer("({ seeks: w.__seeks, at: w.document.getElementById('v').currentTime, adPresses: w.__adPresses, where: w.location.pathname })");
    if (typeof reseek === 'string' || reseek.seeks !== 2) assert.fail('a press after the layer was re-armed still reached the timeline: ' + JSON.stringify(reseek));
    assert(Math.abs(reseek.at - MEDIA_SECONDS * 0.25) < 0.5, 'and seeked to where it was pressed: ' + JSON.stringify(reseek));
    assert.equal(reseek.adPresses, 0, 'the re-armed layer did not take the press: ' + JSON.stringify(reseek));

    /* 3. The play button gets its press, through the harvester and past the square above it, and
          the redirect of the whole tab that the press sets off is stopped before the tab leaves. */
    await press(440, 247);
    await sleep(1500);
    const play = await inPlayer("({ play: w.__playPresses, adPresses: w.__adPresses, where: w.location.pathname })");
    if (typeof play === 'string' || play.play !== 1) {
      assert.fail('the press on the big play button reached it: ' + JSON.stringify(play) + ' ' + await frameStory());
    }
    assert.equal(play.adPresses, 0, 'the square over the play button did not take it: ' + JSON.stringify(play));
    assert.equal(await evaluate('location.pathname'), '/d/7qftyd95nnrj', 'the tab is still on the video page');
    assert.equal(await evaluate('window.__shellPresses || 0'), 0, 'no press landed on the page\'s shell');

    /* 4. The frame stayed, and nothing reached the advert by any route: no tab survives and the
          page's own window.open and location.href attempts were stopped. */
    assert.equal(play.where, '/e/7qftyd95nnrj', 'the player frame is still the player');
    await sleep(800);
    assert.deepEqual(awayHits(), [], 'nothing reached the advert host');
    assert.equal(pages.size, tabsAtStart, 'no advert tab survived: ' + JSON.stringify(strays()));

    /* 5. A visible link the reader presses in the player still goes where it says. */
    const link = await inPlayer("(() => { const r = d.getElementById('visible').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    await press(link[0], link[1]);
    for (const deadline = Date.now() + 8000; Date.now() < deadline && !awayHits().length; await sleep(100));
    assert.deepEqual(awayHits(), [ELSEWHERE + '/mirror/watch'], 'a visible link pressed in the player still navigates');

    /* 6. So does the site's own "Switch server" button over the video, which moves the player
          with location.assign. On a fresh load, so the ad layers, the harvester and the
          hijack timer are all back in place around it. */
    await cdp.send('Page.reload', { ignoreCache: true }, page);
    for (const deadline = Date.now() + 15000; Date.now() < deadline; await sleep(100)) {
      const again = await inPlayer(loading).catch(() => null);
      if (again && again.square && again.video && again.duration === MEDIA_SECONDS && again.path === '/e/7qftyd95nnrj') break;
    }
    await until(disarmed, 'the layers on the reloaded player to be made click-through', 5000);
    const hitsBefore = awayHits().length;
    const serverButton = await inPlayer("(() => { const r = d.getElementById('server').getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; })()");
    await press(serverButton[0], serverButton[1]);
    for (const deadline = Date.now() + 8000; Date.now() < deadline && awayHits().length === hitsBefore; await sleep(100));
    await sleep(800);
    const afterSwitch = awayHits().slice(hitsBefore);
    assert.deepEqual(afterSwitch, [ELSEWHERE + '/embed/server2'],
      'the server switch button over the video moved the player, and nothing else went anywhere: ' + JSON.stringify({ afterSwitch, story: await frameStory() }));

    console.log('[ok] an embedded player\'s ad layers, page shell, press harvester, frame hijack and tab redirect are all stopped in '
      + browser.Browser + ', while the timeline, the play button, a real link and a server switch keep working');
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    server.close();
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-player-layers-/.test(path.basename(resolved))) {
      try { fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 }); } catch (_) {}
    }
  }
}
profile.mustFinish(run, 'browser-player-ad-layers').catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

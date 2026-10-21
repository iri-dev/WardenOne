/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const profile = require('./perf-profile.js');

async function run() {
  const port = await profile.freePort();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-runtime-smoke-'));
  let cdp;
  try {
    const browser = await profile.launch(process.env.WARDENONE_BROWSER_PATH || profile.edgePath(), 'off', '', port, dir);
    cdp = new profile.Cdp(browser.webSocketDebuggerUrl);
    await cdp.connect();
    const info = await cdp.send('SystemInfo.getInfo');
    console.log(JSON.stringify({ browser: browser.Browser, devices: info.gpu.devices,
      renderer: info.gpu.auxAttributes.glRenderer, crashes: info.gpu.auxAttributes.processCrashCount,
      sandboxed: info.gpu.auxAttributes.sandboxed, features: info.gpu.featureStatus }));
    if (process.env.CHROME_MINIMUM_VERSION) assert.equal(browser.Browser, 'Chrome/' + process.env.CHROME_MINIMUM_VERSION);
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const result = await cdp.send('Runtime.evaluate', { expression: `(() => {
      const canvas=document.createElement('canvas'); canvas.width=canvas.height=2;
      const ctx=canvas.getContext('2d'); ctx.fillStyle='#ff0000'; ctx.fillRect(0,0,2,2);
      const image=Array.from(ctx.getImageData(0,0,1,1).data);
      const surface=document.createElement('canvas'); surface.width=surface.height=2;
      const gl=surface.getContext('webgl',{preserveDrawingBuffer:true});
      if(!gl) throw new Error('WebGL context unavailable');
      gl.clearColor(0,1,0,1); gl.clear(gl.COLOR_BUFFER_BIT);
      const pixel=new Uint8Array(4); gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);
      const debug=gl.getExtension('WEBGL_debug_renderer_info');
      return {image,pixel:Array.from(pixel),renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER)};
    })()`, returnByValue: true }, sessionId);
    assert(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    const rendered = result.result.value;
    assert.deepEqual(rendered.image, [255, 0, 0, 255]);
    assert.deepEqual(rendered.pixel, [0, 255, 0, 255]);
    if (process.env.WARDENONE_SOFTWARE_GL === '1') assert.match(rendered.renderer, /SwiftShader/i);
    console.log('[ok] ' + browser.Browser + ': Canvas and WebGL render correctly using ' + rendered.renderer);
  } finally {
    if (cdp) { await profile.killBrowser(cdp, port).catch(() => {}); cdp.close(); }
    const resolved = path.resolve(dir);
    if (path.dirname(resolved) === path.resolve(os.tmpdir()) && /^wo-runtime-smoke-/.test(path.basename(resolved))) {
      fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
}
profile.mustFinish(run, 'browser-runtime-smoke').catch(error => { console.error(error.stack || error); process.exitCode = 1; });

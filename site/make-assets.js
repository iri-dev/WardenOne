/* Derives two images from the real captures, using a local headless Chrome:
     public/images/hero-popup.webp  the popup capture's top section, at display size
     public/images/og-card.png      the 1200 × 630 social card drawn by src/og-card.html
   Usage: node make-assets.js   (set CHROME to override the browser path)
   Run it again after replacing 01-popup-overview-2026-10.webp or editing og-card.html. */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const chrome = process.env.CHROME || [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome'
].find(candidate => fs.existsSync(candidate));
if (!chrome) throw new Error('No Chrome or Edge found; set CHROME to a Chromium browser');

const images = path.join(__dirname, 'public', 'images');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'wardenone-assets-'));
const port = 9400 + Math.floor(Math.random() * 400);
const browser = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--allow-file-access-from-files',
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', 'about:blank'], { stdio: 'ignore' });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function connect() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find(target => target.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch { /* Chrome is still starting. */ }
    await sleep(150);
  }
  throw new Error('Chrome did not open a debugging port');
}

(async () => {
  const socket = new WebSocket(await connect());
  await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
  let nextId = 0;
  const pending = new Map();
  const waiting = [];
  socket.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); return; }
    const index = waiting.findIndex(entry => entry.method === message.method);
    if (index !== -1) waiting.splice(index, 1)[0].resolve(message);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, message => message.error ? reject(new Error(`${method}: ${message.error.message}`)) : resolve(message.result));
    socket.send(JSON.stringify({ id, method, params }));
  });
  const next = method => new Promise(resolve => waiting.push({ method, resolve }));
  const open = async url => { const loaded = next('Page.loadEventFired'); await send('Page.navigate', { url }); await loaded; };
  await send('Page.enable');

  /* Crop and scale in a canvas, then let Chrome's own encoder write the WebP. */
  await open(pathToFileURL(path.join(images, '01-popup-overview-2026-10.webp')).href);
  const crop = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
    const image = document.querySelector('img');
    await image.decode();
    const canvas = Object.assign(document.createElement('canvas'), { width: 696, height: 525 });
    canvas.getContext('2d').drawImage(image, 0, 0, 1392, 1050, 0, 0, 696, 525);
    return canvas.toDataURL('image/webp', 0.9);
  })()` });
  if (!String(crop.result.value).startsWith('data:image/webp')) throw new Error('This browser could not encode WebP');
  fs.writeFileSync(path.join(images, 'hero-popup.webp'), Buffer.from(crop.result.value.split(',')[1], 'base64'));

  await send('Emulation.setDeviceMetricsOverride', { width: 1200, height: 630, deviceScaleFactor: 1, mobile: false });
  await open(pathToFileURL(path.join(__dirname, 'src', 'og-card.html')).href);
  await send('Runtime.evaluate', { awaitPromise: true, expression: 'Promise.all([...document.images].map(image => image.decode()))' });
  await sleep(300);
  const card = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 1200, height: 630, scale: 1 } });
  fs.writeFileSync(path.join(images, 'og-card.png'), Buffer.from(card.data, 'base64'));

  socket.close();
  browser.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome may still hold a lock briefly. */ }
  console.log('Wrote public/images/hero-popup.webp and public/images/og-card.png');
})().catch(error => { browser.kill(); console.error(error); process.exit(1); });

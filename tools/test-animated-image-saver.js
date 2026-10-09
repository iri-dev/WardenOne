/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const source = read('animated-image-saver.js');
const manifest = JSON.parse(read('manifest.json'));
const entry = manifest.content_scripts.find((script) => (script.js || []).includes('animated-image-saver.js'));
assert(entry && entry.run_at === 'document_start' && entry.all_frames === true && entry.world !== 'MAIN');
assert(entry.match_about_blank && entry.match_origin_as_fallback);

const images = [];
const listeners = new Map();
const observers = [];
const intersections = [];
let stateReply;
let update;
let readbacks = 0;
function makeImage(src, options = {}) {
  const declarations = new Map();
  const image = {
    tagName: 'IMG', src, currentSrc: options.currentSrc || src, alt: options.alt || '', complete: options.complete !== false,
    naturalWidth: options.width || 300, naturalHeight: options.height || 200,
    isConnected: true, nextSibling: null,
    bounds: options.bounds || { width: 150, height: 100, top: 20, bottom: 120, left: 20, right: 170 },
    style: {
      getPropertyValue(name) { return declarations.get(name)?.value || ''; },
      getPropertyPriority(name) { return declarations.get(name)?.priority || ''; },
      setProperty(name, value, priority = '') { declarations.set(name, { value, priority }); },
      removeProperty(name) { declarations.delete(name); },
    },
    getAttribute(name) { return options.attributes?.[name] || null; },
    getBoundingClientRect() { return this.bounds; },
    after(node) { this.nextSibling = node; node.isConnected = true; node.original = this; },
  };
  images.push(image);
  return image;
}
function makeCanvas() {
  const events = new Map();
  return {
    tagName: 'CANVAS', isConnected: false, attrs: {}, events,
    style: { setProperty(name, value) { this[name] = value; } },
    getContext() { return { drawImage(image) { if (image.bad) throw Error('decode'); } }; },
    toDataURL() { readbacks++; throw Error('cross-origin readback'); },
    setAttribute(key, value) { this.attrs[key] = value; },
    addEventListener(key, callback) { events.set(key, callback); },
    remove() { this.isConnected = false; if (this.original?.nextSibling === this) this.original.nextSibling = null; },
  };
}
const document = {
  createElement(tag) { assert.equal(tag, 'canvas'); return makeCanvas(); },
  querySelectorAll(selector) { assert.equal(selector, 'img'); return images.filter((image) => image.isConnected); },
  addEventListener(type, callback) { listeners.set(type, callback); },
  removeEventListener(type) { listeners.delete(type); },
};
class MutationObserver {
  constructor(callback) { this.callback = callback; observers.push(this); }
  observe(_root, options) { this.options = options; this.active = true; }
  disconnect() { this.active = false; }
}
class IntersectionObserver {
  constructor(callback) { this.callback = callback; this.targets = new Set(); intersections.push(this); }
  observe(target) { this.targets.add(target); }
  unobserve(target) { this.targets.delete(target); }
  disconnect() { this.targets.clear(); }
}
const chrome = {
  runtime: {
    lastError: null,
    sendMessage(message, callback) {
      assert.equal(message.kind, 'resource-saver-state');
      stateReply = callback;
    },
    onMessage: { addListener(callback) { update = callback; } },
  },
};
const context = { chrome, document, MutationObserver, IntersectionObserver, URL, innerWidth: 800, innerHeight: 600,
  devicePixelRatio: 1, getComputedStyle: () => ({ getPropertyValue: () => '' }) };
const staticGif = makeImage('https://example.com/a.gif?size=small', { alt: 'Wave' });
const giphyWebp = makeImage('https://media2.giphy.com/media/abc/200.gif', {
  currentSrc: 'https://media2.giphy.com/media/abc/200.webp', alt: 'GIPHY animation',
});
const unrelatedWebp = makeImage('https://media2.giphy.com/media/abc/200.gif', {
  currentSrc: 'https://media2.giphy.com/media/other/200.webp',
});
const offsiteWebp = makeImage('https://media2.giphy.com/media/abc/200.gif', {
  currentSrc: 'https://media2.giphy.com.evil.example/media/abc/200.webp',
});
const photo = makeImage('https://example.com/photo.png');
const uncertainWebp = makeImage('https://example.com/clip.webp');
const inlineGif = makeImage('data:image/gif;base64,R0lGODlh', { width: 100, height: 100 });
const tinyGif = makeImage('https://example.com/loading.gif', { width: 1, height: 1 });
const offscreen = makeImage('https://example.com/offscreen.gif', {
  bounds: { width: 150, height: 100, top: 1000, bottom: 1100, left: 20, right: 170 },
});
vm.runInNewContext(source, context);
assert.equal(staticGif.isConnected, true, 'images remain untouched until enabled');
update({ kind: 'resource-saver-update', images: true });
stateReply({ ok: true, images: false });
assert.equal(observers.length, 1, 'a stale state reply does not disable the live setting');
assert.equal(staticGif.isConnected, true, 'the page keeps its original image element');
assert.equal(staticGif.style.getPropertyValue('display'), 'none');
assert.equal(staticGif.nextSibling.tagName, 'CANVAS', 'a still canvas appears beside the image');
assert.equal(staticGif.nextSibling.attrs['aria-label'], 'Play animated image: Wave');
assert.equal(giphyWebp.style.getPropertyValue('display'), 'none', 'GIPHY animated WebP is frozen when its GIF fallback matches');
assert.equal(unrelatedWebp.isConnected, true, 'a different GIPHY WebP is not assumed to be animated');
assert.equal(offsiteWebp.isConnected, true, 'a lookalike media host is not trusted');
assert.equal(photo.isConnected, true, 'static photos are left alone');
assert.equal(uncertainWebp.isConnected, true, 'unknown WebP images are left alone');
assert.equal(inlineGif.isConnected, true, 'embedded data GIFs can be page placeholders');
assert.equal(tinyGif.isConnected, true, 'a stretched one-pixel loading GIF is not captured');
assert.equal(tinyGif.nextSibling, null);
assert.equal(offscreen.nextSibling, null, 'offscreen GIFs do not consume a canvas');
assert.equal(readbacks, 0, 'cross-origin pixels are never read from the canvas');
update({ kind: 'resource-saver-update', images: true });
assert.equal(observers.length, 1, 'duplicate broadcasts do not stack observers');

const click = { prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
staticGif.nextSibling.events.get('click')(click);
assert(click.prevented && click.stopped, 'click-to-play does not activate an enclosing link');
assert.equal(staticGif.style.getPropertyValue('display'), '', 'click shows the original image');
assert.equal(staticGif.nextSibling, null, 'click removes the still canvas');
listeners.get('load')({ target: staticGif });
assert.equal(staticGif.nextSibling, null, 'an image played by the user stays playing');
staticGif.src = staticGif.currentSrc = 'https://example.com/next.gif';
observers[0].callback([{ type: 'attributes', target: staticGif }]);
assert.equal(staticGif.nextSibling?.tagName, 'CANVAS', 'a reused image element pauses its new GIF');

const dynamic = makeImage('https://media.example.com/asset?format=gif');
observers[0].callback([{ type: 'childList', addedNodes: [dynamic] }]);
assert.equal(dynamic.style.getPropertyValue('display'), 'none', 'a later SPA image is frozen');
const loading = makeImage('https://example.com/later.gif', { complete: false });
observers[0].callback([{ type: 'childList', addedNodes: [loading] }]);
assert.equal(loading.nextSibling, null, 'an unfinished image waits for load');
loading.complete = true;
listeners.get('load')({ target: loading });
assert.equal(loading.nextSibling?.tagName, 'CANVAS', 'load freezes a GIF after it has pixels');
tinyGif.src = tinyGif.currentSrc = 'https://example.com/thumbnail.jpg';
tinyGif.naturalWidth = 300;
tinyGif.naturalHeight = 200;
observers[0].callback([{ type: 'attributes', target: tinyGif }]);
assert.equal(tinyGif.isConnected, true, 'a page can replace its GIF placeholder with a real thumbnail');
const broken = makeImage('https://example.com/broken.gif');
broken.bad = true;
observers[0].callback([{ type: 'childList', addedNodes: [broken] }]);
assert.equal(broken.nextSibling, null, 'drawing failures leave the page image intact');

offscreen.bounds = { width: 150, height: 100, top: 20, bottom: 120, left: 20, right: 170 };
intersections[0].callback([{ target: offscreen, isIntersecting: true }]);
assert.equal(offscreen.nextSibling?.tagName, 'CANVAS', 'an image pauses on entering the viewport');
const offscreenCanvas = offscreen.nextSibling;
intersections[0].callback([{ target: offscreenCanvas, isIntersecting: false }]);
assert.equal(offscreen.nextSibling, null, 'an offscreen still releases its canvas');

const changing = makeImage('https://example.com/first.gif');
observers[0].callback([{ type: 'childList', addedNodes: [changing] }]);
const oldCanvas = changing.nextSibling;
changing.src = changing.currentSrc = 'https://example.com/second.gif';
observers[0].callback([{ type: 'attributes', target: changing }]);
assert.equal(oldCanvas.isConnected, false, 'a changed source releases its old frame');
assert.notEqual(changing.nextSibling, oldCanvas, 'a changed source receives a new frame');
const removedCanvas = changing.nextSibling;
removedCanvas.remove();
observers[0].callback([{ type: 'childList', addedNodes: [], removedNodes: [removedCanvas] }]);
assert.equal(changing.style.getPropertyValue('display'), '', 'page removal of the canvas restores its image');
observers[0].callback([{ type: 'childList', addedNodes: [changing] }]);
assert.equal(changing.nextSibling, null, 'a page that removes the canvas is left alone for that source');

const large = makeImage('https://example.com/large.gif', { width: 2000, height: 2000,
  bounds: { width: 1000, height: 1000, top: 0, bottom: 1000, left: 0, right: 1000 } });
observers[0].callback([{ type: 'childList', addedNodes: [large] }]);
assert(large.nextSibling.width * large.nextSibling.height <= 250000, 'per-image canvas memory is capped');
const crowded = Array.from({ length: 40 }, (_, index) => makeImage(`https://example.com/crowd-${index}.gif`, {
  width: 1000, height: 1000,
  bounds: { width: 500, height: 500, top: 0, bottom: 500, left: 0, right: 500 },
}));
observers[0].callback([{ type: 'childList', addedNodes: crowded }]);
assert(crowded.some((image) => !image.nextSibling), 'the page budget leaves excess images alone');
assert(images.reduce((pixels, image) => pixels + (image.nextSibling?.width || 0) *
  (image.nextSibling?.height || 0), 0) <= 8000000, 'the page-wide canvas budget is enforced');

update({ kind: 'resource-saver-update', images: false });
assert.equal(dynamic.isConnected, true, 'turning the setting off restores the source image');
assert.equal(giphyWebp.isConnected, true, 'turning the setting off restores the GIPHY source image');
assert.equal(loading.isConnected, true);
assert.equal(giphyWebp.style.getPropertyValue('display'), '', 'the original GIPHY image is visible again');
assert.equal(observers[0].active, false);
assert.equal(listeners.has('load'), false);

const background = read('background.js');
const popup = read('popup.html') + read('popup.js');
const settings = read('settings.js');
const profile = read('build-profile.js');
assert(background.includes('pauseAnimatedImages: false') && background.includes('cfg.pauseAnimatedImages === true'));
assert(background.includes('images: state.images'), 'live updates carry the image preference');
assert(popup.includes('data-key="pauseAnimatedImages"') && settings.includes("'pauseAnimatedImages'"));
assert(profile.includes("'animated-image-saver.js'") && profile.includes("'pauseAnimatedImages'"));
console.log('[ok] animated image replacement and restore tests passed');

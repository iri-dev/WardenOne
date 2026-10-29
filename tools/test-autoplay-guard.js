/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const sources = ['src/content.js', 'content.min.js'];
let checks = 0;

function load(source, options = {}) {
  const start = source.indexOf('if(WO.blockAutoplay&&!trustedMediaHost)try{');
  const end = source.indexOf('if(WO.lazyLoadMedia)try{', start);
  assert(start >= 0 && end > start, 'autoplay guard markers');
  let now = 0;
  let queries = 0;
  const timers = [];
  const listeners = new Map();
  const calls = [];
  const observers = [];
  const ids = new Map();
  const config = { blockAutoplay: options.enabled !== false };
  class Element {
    constructor(tagName = 'BUTTON', parentElement = null) {
      Object.assign(this, { tagName, parentElement, children: [], attrs: {} });
      if (parentElement) parentElement.children.push(this);
    }
    closest(selector) {
      for (let node = this; node; node = node.parentElement) {
        if (selector === 'video,audio' && /^(VIDEO|AUDIO)$/.test(node.tagName)) return node;
        if (selector === '[aria-controls]' && node.attrs['aria-controls']) return node;
      }
      return null;
    }
    getAttribute(name) { return this.attrs[name] || null; }
    querySelectorAll() {
      return this.children.flatMap(node => /^(VIDEO|AUDIO)$/.test(node.tagName) ? [node] : node.querySelectorAll());
    }
  }
  class Media extends Element {
    constructor(tag = 'VIDEO', muted = false) {
      super(tag);
      Object.assign(this, { tagName: tag, muted, autoplay: true, paused: true, pauses: 0 });
    }
    pause() { this.pauses++; this.paused = true; }
    play(...args) { calls.push({ media: this, args }); this.paused = false; return Promise.resolve('playing'); }
  }
  const nativePlay = Media.prototype.play;
  const existing = new Media();
  existing.paused = false;
  const document = {
    documentElement: {},
    querySelectorAll() { queries++; return [existing]; },
    getElementById(id) { return ids.get(id) || null; },
  };
  const sandbox = {
    WO: config, trustedMediaHost: !!options.trusted, document,
    window: {}, HTMLMediaElement: Media, Promise, DOMException,
    Date: { now: () => now },
    playerShellFor(target) {
      for (let node = target; node; node = node.parentElement) if (node.playerShell) return node;
      return null;
    },
    woOn(target, type, callback) { listeners.set(type, callback); },
    woObserve(callback) { observers.push(callback); },
    setTimeout(callback, delay) { timers.push({ callback, due: now + delay }); },
    log() {},
  };
  vm.runInNewContext(source.slice(start, end), sandbox);
  return {
    config, calls, existing, Media, Element, ids, nativePlay,
    gesture(type = 'click', isTrusted = true, target = existing, extra = {}) {
      listeners.get(type)?.({ type, isTrusted, target, key: 'Enter', button: 0, ...extra });
    },
    advance(milliseconds) {
      now += milliseconds;
      for (const timer of timers.splice(0)) {
        if (timer.due <= now) timer.callback(); else timers.push(timer);
      }
    },
    mutate(media) { for (const callback of observers) callback([], [media], []); },
    get queries() { return queries; },
  };
}

async function blocked(media) {
  await assert.rejects(media.play(), error => error.name === 'NotAllowedError'
    && error.message === 'Autoplay blocked by WardenOne');
}

async function run(source) {
  {
    const w = load(source);
    await blocked(new w.Media());
    await blocked(new w.Media('VIDEO', true));
    await blocked(new w.Media('AUDIO'));
    assert.equal(await new w.Media('AUDIO', true).play(), 'playing', 'muted audio stays exempt');
    assert.equal(w.existing.autoplay, false);
    assert.equal(w.existing.pauses, 1, 'unattended playing media is paused');
    checks++;
  }
  for (const type of ['click', 'keydown', 'pointerdown', 'touchstart']) {
    const w = load(source);
    const media = new w.Media();
    w.gesture(type, false, media);
    await blocked(media);
    w.gesture(type, true, media);
    w.advance(1600);
    assert.equal(await media.play('stream-ready'), 'playing', type + ' permits delayed playback');
    w.advance(20000);
    assert.equal(await media.play(), 'playing', 'stream retries retain user intent');
    const callsBefore = w.calls.length;
    const queriesBefore = w.queries;
    w.mutate(media);
    assert.equal(media.paused, false, 'new DOM mutations do not stop intentional playback');
    assert.equal(media.autoplay, true);
    assert.equal(w.calls.length, callsBefore);
    assert.equal(w.queries, queriesBefore, 'no media traversal after trusted input');
    assert.equal(w.calls[0].media, media);
    assert.deepEqual(w.calls[0].args, ['stream-ready']);
    const unrelated = new w.Media();
    await blocked(unrelated);
    unrelated.paused = false;
    w.mutate(unrelated);
    assert.equal(unrelated.paused, true, 'later unrelated media is still stopped');
    assert.equal(unrelated.autoplay, false);
    checks++;
  }
  {
    const w = load(source);
    w.gesture('click', true, new w.Element());
    await blocked(new w.Media());
    const media = new w.Media();
    w.gesture('keydown', true, media, { key: 'a' });
    await blocked(media);
    w.gesture('click', true, media, { button: 2 });
    await blocked(media);
    checks++;
  }
  {
    const w = load(source);
    const shell = new w.Element('DIV');
    shell.playerShell = true;
    const control = new w.Element('BUTTON', shell);
    const media = new w.Media();
    media.parentElement = shell;
    shell.children.push(media);
    w.gesture('click', true, control);
    w.advance(1600);
    assert.equal(await media.play(), 'playing', 'player controls authorize their existing media');
    const replacement = new w.Media();
    replacement.parentElement = shell;
    await blocked(replacement);
    checks++;
  }
  for (const delay of [1600, 31000]) {
    const w = load(source);
    const shell = new w.Element('DIV');
    shell.playerShell = true;
    w.gesture('click', true, new w.Element('BUTTON', shell));
    w.advance(delay);
    const media = new w.Media();
    media.parentElement = shell;
    if (delay > 30000) await blocked(media);
    else assert.equal(await media.play(), 'playing', 'an empty player may start its first stream');
    const other = new w.Media();
    other.parentElement = shell;
    await blocked(other);
    checks++;
  }
  {
    const w = load(source);
    const control = new w.Element();
    const media = new w.Media();
    control.attrs['aria-controls'] = 'stream';
    w.ids.set('stream', media);
    w.gesture('click', true, new w.Element(), { composedPath: () => [control] });
    w.advance(20000);
    assert.equal(await media.play(), 'playing', 'explicit controls and shadow event paths retain intent');
    await blocked(new w.Media());
    checks++;
  }
  {
    const w = load(source);
    const shell = new w.Element('DIV');
    shell.playerShell = true;
    const media = [new w.Media(), new w.Media()];
    shell.children.push(...media);
    w.gesture('click', true, new w.Element('BUTTON', shell));
    for (const item of media) await blocked(item);
    checks++;
  }
  {
    const w = load(source);
    const media = new w.Media();
    await blocked(media);
    w.config.blockAutoplay = false;
    assert.equal(await media.play(), 'playing', 'disabling the installed guard works without reload');
    const fresh = new w.Media();
    fresh.paused = false;
    const queries = w.queries;
    w.mutate(fresh);
    assert.equal(fresh.autoplay, true, 'disabled guard leaves author state intact');
    assert.equal(fresh.paused, false);
    assert.equal(w.queries, queries, 'disabled guard does not traverse media');
    w.config.blockAutoplay = true;
    await blocked(fresh);
    checks++;
  }
  for (const options of [{ enabled: false }, { trusted: true }]) {
    const w = load(source, options);
    assert.equal(w.Media.prototype.play, w.nativePlay, 'inactive and trusted hosts retain native playback');
    assert.equal(await new w.Media().play(), 'playing');
    assert.equal(w.queries, 0);
    checks++;
  }
}

(async () => {
  for (const file of sources) {
    await run(fs.readFileSync(path.join(root, file), 'utf8'));
    console.log('ok - autoplay guard: ' + file);
  }
  console.log('autoplay guard tests passed (' + checks + ')');
})().catch(error => { console.error(error); process.exitCode = 1; });

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const rules = JSON.parse(read('rules.json'));
const manifest = JSON.parse(read('manifest.json'));

const redirect = rules.find((rule) => rule.id === 168);
const blocks = rules.filter((rule) => rule.action.type === 'block'
  && rule.condition.requestDomains && rule.condition.resourceTypes.includes('main_frame'));
assert.equal(redirect.action.redirect.extensionPath, '/ip-logger-warning.html');
assert(redirect.priority > Math.max(...blocks.map((rule) => rule.priority)));
assert.deepEqual(redirect.condition.resourceTypes, ['main_frame']);
assert.deepEqual(new Set(redirect.condition.requestDomains),
  new Set(blocks.flatMap((rule) => rule.condition.requestDomains)));
assert(manifest.web_accessible_resources.some((entry) => entry.resources.includes('ip-logger-warning.html')
  && entry.resources.includes('ip-logger-warning.js') && entry.matches.includes('<all_urls>')));
assert(manifest.content_scripts.some((entry) => entry.js.includes('frame-image-logger.js')
  && entry.js.indexOf('bridge.js') < entry.js.indexOf('frame-image-logger.js')
  && entry.all_frames === true && entry.world === 'ISOLATED'),
'a small isolated frame detector loads after the bridge in every frame');

const bridge = read('bridge.js');
const frameGateStart = bridge.indexOf('  function bridgeFrameGrabberWarningAllowed() {');
const frameGateEnd = bridge.indexOf('\n  /* WebGL', frameGateStart);
assert(frameGateStart > 0 && frameGateEnd > frameGateStart, 'frame warning config gate changed');
const frameGate = bridge.slice(frameGateStart, frameGateEnd);
for (const test of [
  { name: 'enabled frame', want: true },
  { name: 'master off', enabled: false, want: false },
  { name: 'warning off', warnGrabberDomains: false, want: false },
  { name: 'own site paused', allowlist: ['widget.example'], want: false },
  { name: 'top site paused', allowlist: ['forum.example'], want: false },
  { name: 'top site override', topOff: { warnGrabberDomains: false }, want: false },
  { name: 'top site master override', topOff: { enabled: false }, want: false },
]) {
  const cfg = { enabled: test.enabled !== false, warnGrabberDomains: test.warnGrabberDomains !== false,
    allowlist: test.allowlist || [] };
  const sandbox = {
    bridgeConfigReady: true, bridgeConfig: cfg,
    bridgeOwnHost: () => 'widget.example', bridgeTopHost: () => 'forum.example',
    bridgeActiveAllowlist: (value) => value.allowlist,
    bridgeHostMatchesList: (host, list) => list.includes(host),
    bridgeSiteOverridesFor: (_value, host) => host === 'forum.example' ? (test.topOff || {}) : {},
  };
  vm.runInNewContext(frameGate + '\nthis.allowed = bridgeFrameGrabberWarningAllowed();', sandbox);
  assert.equal(sandbox.allowed, test.want, test.name);
}

const source = read('src/content.js');
const guardStart = source.indexOf('    if(WO.warnGrabberDomains){\n      const knownGrabbers=');
const guardEnd = source.indexOf('    {\n      const REDIRECT_PARAMS=', guardStart);
assert(guardStart > 0 && guardEnd > guardStart, 'image guard source changed');
const guard = source.slice(guardStart, guardEnd);
const toastStart = source.indexOf('warned_grabber_image:{');
const imageToast = source.slice(toastStart, source.indexOf('blocked_ip_lookup:{', toastStart));
assert(toastStart > 0 && /cannot confirm whether the browser sent a request/.test(imageToast),
  'the page warning does not call a URL reference a confirmed request');

function imageRig(blockKnown) {
  const events = [];
  const listeners = new Map();
  let observe;
  let observesImageSources = false;
  class ImageElement {
    constructor() { this.tagName = 'IMG'; this.attrs = {}; this.currentSrc = ''; }
    getAttribute(name) { return this.attrs[name] || null; }
    setAttribute(name, value) {
      this.attrs[name] = String(value);
      observe([{ type: 'attributes', attributeName: name, target: this }], [], []);
    }
  }
  Object.defineProperty(ImageElement.prototype, 'src', {
    configurable: true, get() { return this.value; }, set(value) { this.value = value; },
  });
  const sandbox = {
    WO: { warnGrabberDomains: true, blockGrabberResources: blockKnown, grabberDomains: ['grabify.link'] },
    location: { href: 'https://site.example/page', hostname: 'site.example' },
    regDomain(host) { return String(host).split('.').slice(-2).join('.'); },
    HTMLImageElement: ImageElement,
    document: { querySelectorAll: () => [] },
    woOn(_target, type, fn) { listeners.set(type, fn); },
    woObserve(fn, imageSources) { observe = fn; observesImageSources = !!imageSources; },
    log(type, detail) { events.push({ type, detail }); },
    URL, Set, Object,
  };
  vm.runInNewContext(guard, sandbox);
  return { events, ImageElement, observe, observesImageSources,
    settle(type, target) { listeners.get(type)({ target }); } };
}

{
  const r = imageRig(true);
  const image = new r.ImageElement();
  image.src = 'https://cdn.example.test/pixel.png?secret=ordinary';
  image.src = 'https://grabify.link/a?secret=known';
  image.src = 'https://site.example/iplogger/abc1234567';
  assert.equal(r.events.length, 1, 'known images are reported even when the blocking switch is on');
  image.src = 'https://iplogger.suspect.test/i?token=TOPSECRET';
  image.src = 'https://iplogger.suspect.test/again?token=OTHERSECRET';
  assert.equal(r.events.length, 2, 'one candidate per destination per page');
  assert.equal(r.events[0].type, 'detected_grabber_image_candidate');
  assert.equal(r.events[1].detail.matched, 'iplogger.suspect.test');
  assert.equal(r.events[1].detail.quiet, true);
  assert(!JSON.stringify(r.events).includes('TOPSECRET'), 'tokens never enter the event');
  r.observe([], [], [{ querySelectorAll: () => [{ tagName: 'IMG',
    getAttribute: (name) => name === 'src' ? 'https://other.test/iplogger/abc1234567' : null }] }]);
  assert.equal(r.events.length, 3, 'parser-inserted images are checked too');
  r.observe([], [], [{ querySelectorAll: () => [{ tagName: 'IMG',
    getAttribute: (name) => name === 'src' ? 'https://other.test/iplogger/explanation.jpg' : null }] }]);
  assert.equal(r.events.length, 3, 'ordinary explanatory image names do not trigger');
}
{
  const r = imageRig(true);
  assert(r.observesImageSources, 'the image guard requests source-attribute records from the shared observer');
  const existing = new r.ImageElement();
  existing.setAttribute('src', 'https://ordinary.test/pixel.gif');
  assert.equal(r.events.length, 0, 'an ordinary source change stays quiet');
  existing.setAttribute('src', 'https://iplogger.attribute.test/pixel.gif?token=PRIVATE');
  assert.equal(r.events.length, 1, 'an existing image source change is detected');
  existing.currentSrc = 'https://ordinary.test/one.png';
  existing.setAttribute('srcset', 'https://ordinary.test/one.png 1x, https://grabify.link/two.png 2x');
  assert.equal(r.events.length, 1, 'an unused 2x candidate stays quiet');
  existing.currentSrc = 'https://grabify.link/two.png';
  r.settle('load', existing);
  assert.equal(r.events.length, 2, 'a newly selected responsive image is detected');
  assert.equal(r.events[1].detail.selected, true, 'the selected candidate carries its evidence');
  assert(!JSON.stringify(r.events).includes('PRIVATE'), 'changed image URLs are redacted');
  const pictureImage = new r.ImageElement();
  pictureImage.currentSrc = 'https://iplogger.picture.test/asset.png';
  const picture = { tagName: 'PICTURE', querySelector: () => pictureImage };
  r.observe([{ type: 'attributes', attributeName: 'srcset', target: {
    tagName: 'SOURCE', parentElement: picture,
    getAttribute: () => 'https://iplogger.picture.test/asset.png 2x',
  } }], [], []);
  assert.equal(r.events.length, 3, 'a picture source change is detected');
  r.observe([{ type: 'attributes', attributeName: 'srcset', target: {
    tagName: 'SOURCE', parentElement: { tagName: 'VIDEO' },
    getAttribute: () => 'https://iplogger.video.test/asset.png 2x',
  } }], [], []);
  assert.equal(r.events.length, 3, 'video sources are outside the image guard');
}
{
  const r = imageRig(false);
  new r.ImageElement().src = 'https://grabify.link/pixel?token=PRIVATE';
  assert.equal(r.events.length, 1, 'a known image warns when page-side blocking is off');
}

function frameImageRig() {
  const events = [];
  const listeners = new Map();
  const observers = [];
  let parsedUrls = 0;
  class CountingURL extends URL {
    constructor(value, base) { super(value, base); parsedUrls++; }
  }
  let state = { enabled: false, site: 'widget.example' };
  const image = (tagName, attrs, parentElement, currentSrc = '') => ({
    nodeType: 1, tagName, parentElement, currentSrc,
    getAttribute(name) { return attrs[name] || null; },
    querySelectorAll() { return []; },
  });
  const initial = image('IMG', { src: 'https://iplogger.frame.test/a?token=PRIVATE' });
  const document = {
    baseURI: 'https://widget.example/',
    extraImages: [],
    addEventListener(name, fn) { listeners.set(name, fn); },
    removeEventListener(name, fn) { if (listeners.get(name) === fn) listeners.delete(name); },
    baseElements: [],
    baseQueries: 0,
    querySelectorAll(selector) {
      if (selector !== 'base') return [initial, ...this.extraImages];
      this.baseQueries++;
      return this.baseElements;
    },
  };
  class Observer {
    constructor(fn) { this.fn = fn; observers.push(this); this.active = false; }
    observe(target, options) { this.active = true; this.target = target; this.options = options; }
    disconnect() { this.active = false; }
  }
  vm.runInNewContext(read('frame-image-logger.js'), {
    window: { top: {}, __wardenOneFrameGrabberConfig: () => state },
    document, location: { href: document.baseURI }, MutationObserver: Observer,
    siteIdentity: (host) => String(host).split('.').slice(-2).join('.'),
    chrome: { runtime: { lastError: null, sendMessage(message, cb) { events.push(message); cb(); } } },
    URL: CountingURL, Set,
  });
  const refresh = () => listeners.get('wo-bridge-config-ready')();
  const mutate = (records) => { for (const observer of observers) if (observer.active) observer.fn(records); };
  return { document, events, observers, refresh, mutate, image,
    hasListener(type) { return listeners.has(type); },
    get parsedUrls() { return parsedUrls; },
    mutateBase(target) { for (const observer of observers) if (observer.active && observer.target === target) observer.fn(); },
    settle(type, target) { const fn = listeners.get(type); if (fn) fn({ target }); },
    setState(next) { state = next; refresh(); } };
}

{
  const r = frameImageRig();
  r.setState({ enabled: true, site: 'widget.example' });
  const parsed = r.parsedUrls;
  for (let i = 0; i < 12; i++) {
    const ordinary = r.image('IMG', { src: '/pixel.png?v=' + i });
    r.mutate([{ type: 'attributes', target: ordinary }]);
  }
  assert.equal(r.parsedUrls, parsed, 'ordinary changing images bypass URL parsing');
  r.settle('load', { tagName: 'IMG', currentSrc: 'https://images.example/photo.jpg',
    getAttribute() { throw new Error('ordinary image should not need attributes'); } });
  assert.equal(r.events.length, 1, 'ordinary image loads need no further inspection');
  for (const host of ['iplogger.encoded.test', 'iplogger.unicode.test']) {
    const value = host.includes('encoded') ? 'https://%69plogger.encoded.test/a'
      : 'https://ｉｐｌｏｇｇｅｒ.unicode.test/a';
    r.mutate([{ type: 'attributes', target: r.image('IMG', { src: value }) }]);
    assert.equal(r.events.at(-1).detail.matched, host, 'normalized logger host stays detectable');
  }
  const selectedImage = r.image('IMG', { srcset: 'https://%69plogger.selected.test/a 1x' }, null,
    'https://iplogger.selected.test/a');
  r.mutate([{ type: 'attributes', target: selectedImage }]);
  r.settle('load', selectedImage);
  assert.equal(r.events.at(-1).detail.matched, 'iplogger.selected.test',
    'a selected responsive logger still reaches the parser');
  r.document.baseURI = 'https://outside.example/iplogger/abc1234567/path';
  r.mutate([{ type: 'attributes', target: r.image('IMG', { src: '?v=1' }) }]);
  assert.equal(r.events.at(-1).detail.matched, 'outside.example',
    'a relative URL inherits a suspicious path from the base URL');
}
{
  const r = frameImageRig();
  r.setState({ enabled: true, site: 'widget.example' });
  assert.equal(r.hasListener('load'), false);
  const fallback = r.image('IMG', { srcset: '/ordinary.png 1x', src: 'https://iplogger.fallback.test/a' },
    null, 'https://widget.example/ordinary.png');
  r.mutate([{ type: 'attributes', target: fallback }]);
  assert.equal(r.hasListener('load'), true, 'a suspicious src fallback arms responsive selection');
  fallback.currentSrc = 'https://iplogger.fallback.test/a';
  r.settle('load', fallback);
  assert.equal(r.events.at(-1).detail.matched, 'iplogger.fallback.test',
    'a selected src fallback remains detectable');
}

{
  const r = frameImageRig();
  assert.equal(r.events.length, 0, 'the frame detector waits for an enabled config');
  r.setState({ enabled: true, site: 'widget.example' });
  assert.equal(r.events.length, 1, 'an existing frame image is checked after config arrives');
  assert.equal(r.hasListener('load'), false, 'ordinary frame images do not arm the load observer');
  assert.deepEqual(Object.keys(r.events[0].detail).sort(), ['matched', 'quiet']);
  assert.equal(r.events[0].detail.matched, 'iplogger.frame.test');
  assert(!JSON.stringify(r.events).includes('PRIVATE'), 'the frame sends only the hostname');
  const observer = r.observers[0];
  assert.deepEqual(Array.from(observer.options.attributeFilter), ['src', 'srcset']);
  const ordinary = r.image('IMG', { src: 'https://metrics.other.test/pixel.gif' });
  const sameSite = r.image('IMG', { src: 'https://cdn.widget.example/iplogger/abc1234567' });
  const changed = r.image('IMG', { srcset: 'https://metrics.other.test/one.png 1x, https://grabify.other.test/two.png 2x' },
    null, 'https://metrics.other.test/one.png');
  r.mutate([{ type: 'attributes', target: ordinary }, { type: 'attributes', target: sameSite },
    { type: 'attributes', target: changed }]);
  assert.equal(r.events.length, 1, 'unused srcset, ordinary and same-site images stay quiet');
  assert.equal(r.hasListener('load'), true, 'a candidate in srcset arms selection monitoring');
  changed.currentSrc = 'https://grabify.other.test/two.png';
  r.settle('load', changed);
  assert.equal(r.events.length, 2, 'a selected frame candidate is reported');
  assert.equal(r.events[1].detail.selected, true);
  const pictureImage = r.image('IMG', {}, null, 'https://iplogger.picture.test/pixel.gif');
  const picture = { tagName: 'PICTURE', querySelector: () => pictureImage };
  const source = r.image('SOURCE', { srcset: 'https://iplogger.picture.test/pixel.gif 1x' }, picture);
  r.mutate([{ type: 'childList', addedNodes: [source] }]);
  assert.equal(r.events.length, 3, 'new picture sources are checked');
  const relative = r.image('IMG', { src: '/iplogger/abc1234567' });
  r.mutate([{ type: 'attributes', target: relative }]);
  assert.equal(r.events.length, 3, 'a same-site relative image stays quiet');
  r.document.baseURI = 'https://outside.example/';
  r.mutate([{ type: 'attributes', target: relative }]);
  assert.equal(r.events.length, 4, 'a changed base URL invalidates the cached decision');
  assert.equal(r.events[3].detail.matched, 'outside.example');
  r.setState({ enabled: false, site: 'widget.example' });
  assert.equal(observer.active, false, 'turning the protection off disconnects the observer');
  assert.equal(r.hasListener('load'), false, 'turning the protection off removes selection monitoring');
  r.mutate([{ type: 'attributes', target: r.image('IMG', { src: 'https://iplogger.off.test/x' }) }]);
  assert.equal(r.events.length, 4, 'disabled frames stay quiet');
}
{
  const r = frameImageRig();
  const responsive = r.image('IMG', { srcset: '?v=1 1x' }, null, 'https://widget.example/pixel.png');
  r.document.extraImages.push(responsive);
  r.setState({ enabled: true, site: 'widget.example' });
  assert.equal(r.hasListener('load'), false, 'ordinary relative srcset does not arm a page-wide listener');
  r.document.baseURI = 'https://iplogger.base.test/a?x=1';
  r.mutate([{ type: 'childList', addedNodes: [] }]);
  assert.equal(r.hasListener('load'), true, 'a new base URL can arm selection monitoring');
  responsive.currentSrc = 'https://iplogger.base.test/a?v=1';
  r.settle('load', responsive);
  assert.equal(r.events.at(-1).detail.matched, 'iplogger.base.test',
    'responsive selection after a base change remains detectable');
}
{
  const r = frameImageRig();
  const firstBaseWithoutHref = { tagName: 'BASE' };
  const base = { tagName: 'BASE' };
  r.document.baseElements.push(firstBaseWithoutHref, base);
  r.document.extraImages.push(r.image('IMG', { srcset: '?v=1 1x' }, null,
    'https://widget.example/pixel.png'));
  r.setState({ enabled: true, site: 'widget.example' });
  assert.equal(r.hasListener('load'), false);
  r.document.baseURI = 'https://iplogger.updated-base.test/a';
  r.mutateBase(base);
  assert.equal(r.hasListener('load'), true, 'a later base href change arms selection monitoring');
}
{
  const r = frameImageRig();
  r.setState({ enabled: true, site: 'widget.example' });
  const picture = { tagName: 'PICTURE' };
  r.mutate([{ type: 'childList', addedNodes: [r.image('IMG', { src: '/photo.png' }, picture)] }]);
  assert.equal(r.hasListener('load'), true, 'picture images keep selection monitoring');
}
{
  const r = frameImageRig();
  r.setState({ enabled: true, site: 'widget.example' });
  for (const value of ['https://ip\tlogger.split.test/a', 'https://grab\nify.split.test/a']) {
    r.mutate([{ type: 'attributes', target: r.image('IMG', { src: value }) }]);
  }
  assert.deepEqual(r.events.slice(-2).map((event) => event.detail.matched),
    ['iplogger.split.test', 'grabify.split.test'],
    'a logger host split by a tab or newline is parsed, because the browser joins it');
}
{
  const r = frameImageRig();
  r.setState({ enabled: true, site: 'widget.example' });
  const queries = r.document.baseQueries;
  const body = { nodeType: 1, tagName: 'BODY', parentNode: null };
  let scans = 0;
  const element = (tagName, parentNode) => ({ nodeType: 1, tagName, parentNode, firstElementChild: {},
    getAttribute() { return null; }, querySelectorAll() { scans++; return []; } });
  const container = element('SECTION', body);
  const child = element('DIV', container);
  const grandchild = element('DIV', child);
  const sibling = element('ASIDE', body);
  r.mutate([{ type: 'childList', addedNodes: [child] }, { type: 'childList', addedNodes: [container] },
    { type: 'childList', addedNodes: [grandchild, sibling] }]);
  assert.equal(scans, 2, 'nested additions are covered by the outermost added node’s scan');
  assert.equal(r.document.baseQueries, queries, 'ordinary structural changes do not re-list base elements');
  const base = { nodeType: 1, tagName: 'BASE', parentNode: body, getAttribute() { return null; } };
  r.document.baseElements.push(base);
  r.mutate([{ type: 'childList', addedNodes: [base] }]);
  assert.equal(r.document.baseQueries, queries + 1, 'an added base element is listed and watched');
  r.document.extraImages.push(r.image('IMG', { srcset: '?v=1 1x' }, null, 'https://widget.example/pixel.png'));
  r.document.baseURI = 'https://iplogger.added-base.test/a';
  r.mutateBase(base);
  assert.equal(r.hasListener('load'), true, 'a later href change on an added base is seen');
  base.isConnected = false;
  r.document.baseElements.length = 0;
  r.mutate([{ type: 'childList', addedNodes: [] }]);
  assert.equal(r.document.baseQueries, queries + 2, 'a watched base that leaves the document is re-listed');
}

const bg = read('background.js');
const bgStart = bg.indexOf('const DNR_FEEDBACK_WINDOW_MS =');
const bgEnd = bg.indexOf('// ======================= User rules & custom filter lists', bgStart);
assert(bgStart > 0 && bgEnd > bgStart, 'background observer source changed');
const observer = bg.slice(bgStart, bgEnd);
const feedback = bg.slice(bgStart, bg.indexOf('const GRABBER_NAV_ATTEMPTS = new Map();', bgStart));

async function testSharedFeedback() {
  let now = 1000000;
  let calls = 0;
  const sandbox = {
    chrome: { declarativeNetRequest: { getMatchedRules: async () => {
      calls++;
      return { rulesMatchedInfo: [{ tabId: 3, timeStamp: now, rule: { ruleId: 1 } }] };
    } } },
    setTimeout: (fn) => setTimeout(fn, 0),
    Date: { now: () => now }, Math, Number,
  };
  vm.runInNewContext(feedback + '\nthis.readEvidence = readMatchedRuleEvidence;', sandbox);
  const first = await sandbox.readEvidence({ tabId: 3 }, 'background');
  assert.equal(first.matches.length, 1);
  assert.equal((await sandbox.readEvidence({ tabId: 4 }, 'background')).matches.length, 0);
  assert.equal(calls, 1, 'nearby callers share one Chrome feedback read');
  for (let i = 1; i < 10; i++) {
    now += 2000;
    assert.equal((await sandbox.readEvidence({}, 'background')).ok, true);
  }
  now += 2000;
  assert.equal((await sandbox.readEvidence({}, 'background')).reason, 'quota', 'periodic readers retain room for event checks');
  for (let i = 0; i < 5; i++) {
    now += 2000;
    assert.equal((await sandbox.readEvidence({}, 'dashboard')).ok, true);
  }
  now += 2000;
  assert.equal((await sandbox.readEvidence({}, 'dashboard')).reason, 'quota', 'dashboard reads retain room for logger evidence');
  for (let i = 0; i < 4; i++) {
    now += 2000;
    assert.equal((await sandbox.readEvidence({}, 'event')).ok, true);
  }
  now += 2000;
  assert.equal((await sandbox.readEvidence({}, 'event')).reason, 'quota', 'all consumers stay below Chrome’s 20-call allowance');
  assert.equal(calls, 19);
  now += 10 * 60 * 1000;
  for (let i = 0; i < 4; i++) {
    now += 2000;
    assert.equal((await sandbox.readEvidence({}, 'event')).ok, true);
  }
  now += 2000;
  assert.equal((await sandbox.readEvidence({}, 'event')).reason, 'quota',
    'event checks cannot spend reads reserved for the other categories');
  assert.equal(calls, 23);
  for (let i = 0; i < 10; i++) {
    now += 2000;
    assert.equal((await sandbox.readEvidence({}, 'background')).ok, true,
      'background reads remain available after an event burst');
  }
  for (let i = 0; i < 5; i++) {
    now += 2000;
    assert.equal((await sandbox.readEvidence({}, 'dashboard')).ok, true,
      'dashboard reads remain available after an event burst');
  }
  assert.equal(calls, 38, 'the category budgets add up to 19 reads per window');
  now += 2000;
  assert.equal((await sandbox.readEvidence({}, 'background')).reason, 'quota',
    'the shared headroom remains unused');
  now += 10 * 60 * 1000;
  assert.equal((await sandbox.readEvidence({}, 'background')).ok, true, 'budget recovers after the ten-minute window');
}

async function testEventBatch() {
  let now = 1000000;
  let calls = 0;
  const timers = [];
  const sandbox = {
    chrome: { declarativeNetRequest: { getMatchedRules: async () => {
      calls++;
      return { rulesMatchedInfo: [
        { tabId: 31, timeStamp: 1000000, rule: { ruleId: 1 } },
        { tabId: 32, timeStamp: 1000010, rule: { ruleId: 2 } },
      ] };
    } } },
    setTimeout(fn, delay) { assert.equal(delay, 120); timers.push(fn); },
    Date: { now: () => now }, Math, Number,
  };
  vm.runInNewContext(feedback + '\nthis.readEvidence = readMatchedRuleEvidence;', sandbox);
  const first = sandbox.readEvidence({ tabId: 31, minTimeStamp: now, requiredAt: now }, 'event');
  now += 10;
  const second = sandbox.readEvidence({ tabId: 32, minTimeStamp: now, requiredAt: now }, 'event');
  assert.equal(timers.length, 1, 'nearby events share a short batching timer');
  assert.equal(calls, 0, 'the evidence read waits until the burst is collected');
  timers.shift()();
  const [one, two] = await Promise.all([first, second]);
  assert.equal(calls, 1, 'both event checks spend one feedback read');
  assert.deepEqual(Array.from(one.matches, (item) => item.tabId), [31]);
  assert.deepEqual(Array.from(two.matches, (item) => item.tabId), [32]);
  assert(one.readStartedAt >= 1000010 && two.readStartedAt >= 1000010,
    'the shared read starts after both event timestamps');
  now += 2000;
  const later = sandbox.readEvidence({ tabId: 31, requiredAt: now }, 'event');
  timers.shift()();
  await later;
  assert.equal(calls, 2, 'a later event needs its own fresh evidence');
}

async function flush() {
  await new Promise((resolve) => setTimeout(resolve, 10));
  await new Promise((resolve) => setImmediate(resolve));
}

async function testBackground() {
  const history = [];
  const listeners = {};
  let matched = [];
  let enabled = ['grabbers'];
  let feedbackError = false;
  const timers = [];
  const sandbox = {
    chrome: {
      runtime: { getURL: (name) => 'chrome-extension://wo/' + name },
      webRequest: {
        onBeforeRequest: { addListener(fn) { listeners.before = fn; } },
        onErrorOccurred: { addListener(fn) { listeners.error = fn; } },
      },
      declarativeNetRequest: {
        getMatchedRules: async () => {
          if (feedbackError) throw new Error('quota');
          return { rulesMatchedInfo: matched };
        },
        getEnabledRulesets: async () => enabled,
      },
    },
    GRABBER_PACKAGED_DOMAINS: new Set(['grabify.link']),
    GRABBER_FEED_DOMAINS: new Set(['feedlogger.test']),
    GRABBER_PACKAGED_RULE_HOSTS: new Map([[1, 'grabify.link']]),
    GRABBER_FEED_RULE_HOSTS: new Map([[740000, 'feedlogger.test']]),
    GRABBER_STATIC_NAV_RULE_ID: 168,
    GRABBER_TRACKER_HOST: 'tracker.iplocation.net',
    GRABBER_TRACKER_IMAGE_RULE_ID: 170,
    GRABBER_TRACKER_NAV_RULE_ID: 171,
    GRABBER_TRACKER_ROUTE_RULE_ID: 172,
    GRABBER_NAV_RULE_ID: 741000,
    loadPackagedGrabberDomains: async () => {},
    queueHistory(entry) { history.push(entry); },
    setTimeout(fn, delay) {
      if (delay < 1000) return setTimeout(fn, 0);
      const timer = { fn, canceled: false }; timers.push(timer); return timer;
    },
    clearTimeout(timer) { timer.canceled = true; },
    URL, Date, Map, Set, Number, Math, String,
  };
  vm.runInNewContext(observer + '\nthis.navStatus = grabberNavigationStatus; this.noteCandidate = noteGrabberImageCandidate; this.resetEvidence = () => { DNR_FEEDBACK_SNAPSHOT = null; DNR_FEEDBACK_READS.length = 0; };', sandbox);
  async function runTimers() {
    for (const timer of timers.splice(0)) if (!timer.canceled) await timer.fn();
  }
  const sender = { tab: { id: 7 }, url: 'chrome-extension://wo/ip-logger-warning.html', frameId: 0 };
  const wrong = await sandbox.navStatus({ ...sender, url: 'https://site.example/' });
  assert.equal(wrong.status, 'observed_unconfirmed', 'only the extension warning page can request the verdict');
  listeners.before({ tabId: 7, url: 'https://grabify.link/x?token=NAVSECRET' });
  matched = [{ rule: { rulesetId: 'grabber_navigation', ruleId: 168 }, tabId: 7, timeStamp: Date.now() }];
  const result = await sandbox.navStatus(sender);
  assert.equal(result.status, 'blocked');
  assert.equal(result.host, 'grabify.link');
  assert.equal(history.length, 1);
  assert(!JSON.stringify(history).includes('NAVSECRET'));
  await sandbox.navStatus(sender);
  assert.equal(history.length, 1, 'reloading a warning does not duplicate Activity');

  listeners.before({ tabId: 9, url: 'https://tracker.iplocation.net/t/ABC12345?token=TRACKERSECRET' });
  matched = [{ rule: { rulesetId: 'grabber_navigation', ruleId: 171 }, tabId: 9, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  const trackerNav = await sandbox.navStatus({ ...sender, tab: { id: 9 } });
  assert.equal(trackerNav.status, 'blocked', 'a scoped tracker route confirms the redirect');
  assert.equal(trackerNav.host, 'tracker.iplocation.net');
  assert(!JSON.stringify(history).includes('TRACKERSECRET'));

  matched = [{ rule: { rulesetId: 'grabber_navigation', ruleId: 168 }, tabId: 11, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  assert.equal((await sandbox.navStatus({ ...sender, tab: { id: 11 } })).status, 'observed_unconfirmed',
    'a stale rule match does not prove that an unobserved navigation was blocked');

  matched = [{ rule: { rulesetId: 'grabbers', ruleId: 1 }, tabId: 7, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  listeners.error({ tabId: 7, url: 'https://grabify.link/i?token=IMAGESECRET',
    initiator: 'https://site.example/?account=SECRET', error: 'net::ERR_BLOCKED_BY_CLIENT', timeStamp: Date.now() });
  await flush();
  assert.equal(history.length, 3);
  assert.equal(history[2].type, 'blocked_grabber_network');
  assert.equal(history[2].detail.matched, 'grabify.link');
  assert.equal(history[2].detail.observation, undefined, 'a confirmed network block has separate evidence');
  assert(!JSON.stringify(history).includes('IMAGESECRET') && !JSON.stringify(history).includes('account=SECRET'));

  matched = [{ rule: { rulesetId: 'grabbers', ruleId: 170 }, tabId: 10, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  listeners.error({ tabId: 10, url: 'https://tracker.iplocation.net/p/ABC12345?token=PIXELSECRET',
    initiator: 'https://other.example/', error: 'net::ERR_BLOCKED_BY_CLIENT', timeStamp: Date.now() });
  await flush();
  assert.equal(history.length, 4, 'a scoped tracker image block reaches Activity');
  assert.equal(history[3].detail.matched, 'tracker.iplocation.net');
  assert(!JSON.stringify(history).includes('PIXELSECRET'));

  matched = [{ rule: { rulesetId: 'trackers', ruleId: 1 }, tabId: 8, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  listeners.error({ tabId: 8, url: 'https://grabify.link/i?token=UNCONFIRMED',
    initiator: 'https://other.example/', error: 'net::ERR_BLOCKED_BY_CLIENT', timeStamp: Date.now() });
  await flush();
  assert.equal(history.length, 4, 'a browser block without WardenOne rule evidence is not claimed');

  sandbox.noteCandidate({ matched: 'grabify.link' }, { tab: { id: 12, url: 'https://site.example/' } });
  matched = [{ rule: { rulesetId: 'grabbers', ruleId: 1 }, tabId: 12, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  listeners.error({ tabId: 12, url: 'https://grabify.link/i?token=PRIVATE',
    initiator: 'https://site.example/', error: 'net::ERR_BLOCKED_BY_CLIENT', timeStamp: Date.now() });
  await flush();
  await runTimers();
  assert.equal(history.at(-1).type, 'blocked_grabber_network', 'confirmed block suppresses candidate warning');

  sandbox.noteCandidate({ matched: 'grabify.link' }, { tab: { id: 13, url: 'https://site.example/' } });
  await runTimers();
  assert.equal(history.at(-1).type, 'warned_grabber_image', 'an enabled switch without a match remains unconfirmed');
  assert.equal(history.at(-1).detail.status, 'observed_unconfirmed');
  assert.equal(history.at(-1).detail.observation, 'image_url_reference');
  assert.match(history.at(-1).detail.why, /cannot confirm whether the browser sent a request/);

  sandbox.noteCandidate({ matched: 'iplogger.selected.test', selected: true },
    { tab: { id: 16, url: 'https://site.example/' } });
  await runTimers();
  assert.equal(history.at(-1).detail.observation, 'image_selected_reference',
    'currentSrc selection is recorded without claiming a network request');
  assert.match(history.at(-1).detail.why, /browser selected/);
  assert.match(history.at(-1).detail.why, /cannot confirm whether the browser sent a request/);

  enabled = [];
  sandbox.noteCandidate({ matched: 'grabify.link' }, { tab: { id: 14, url: 'https://site.example/' } });
  await runTimers();
  assert.equal(history.at(-1).detail.status, 'protection_unavailable', 'disabled DNR rules are reported as unavailable');
  assert.equal(history.at(-1).detail.observation, 'image_url_reference');

  enabled = ['grabbers'];
  feedbackError = true;
  sandbox.resetEvidence();
  listeners.before({ tabId: 15, url: 'https://grabify.link/?secret=PRIVATE' });
  const quota = await sandbox.navStatus({ ...sender, tab: { id: 15 } });
  assert.equal(quota.status, 'observed_unconfirmed', 'match-feedback errors never claim a block or disabled protection');
}

function warningPageRig(result) {
  const nodes = new Map();
  for (const id of ['back', 'activity', 'status', 'explanation', 'host', 'host-row']) {
    nodes.set(id, { textContent: '', hidden: id === 'host-row', addEventListener() {} });
  }
  const sandbox = {
    document: { getElementById: (id) => nodes.get(id) },
    chrome: { runtime: { lastError: null, getURL: (name) => 'chrome-extension://wo/' + name,
      sendMessage(message, callback) {
        assert.equal(message.kind, 'grabber-navigation-status');
        callback(result);
      } } },
    history: { length: 2, back() {} }, location: { href: '' },
  };
  vm.runInNewContext(read('ip-logger-warning.js'), sandbox);
  return nodes;
}

(async () => {
  await testSharedFeedback();
  await testEventBatch();
  await testBackground();
  const blocked = warningPageRig({ status: 'blocked', host: 'grabify.link' });
  assert.equal(blocked.get('status').textContent, 'Blocked before connecting');
  assert.equal(blocked.get('host').textContent, 'grabify.link');
  const uncertain = warningPageRig({ status: 'observed_unconfirmed' });
  assert.equal(uncertain.get('status').textContent, 'Block not confirmed');
  assert.match(uncertain.get('explanation').textContent, /may already have been exposed/);
  assert.equal(uncertain.get('host-row').hidden, true);
  const unavailable = warningPageRig({ status: 'protection_unavailable' });
  assert.equal(unavailable.get('status').textContent, 'Network protection unavailable');
  assert(!/your IP address has already been sent/i.test(source), 'fallback overlay must not claim exposure as fact');
  console.log('image-logger navigation, image warning, confirmation and privacy tests pass');
})().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });

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

const source = read('src/content.js');
const guardStart = source.indexOf('    if(WO.warnGrabberDomains){\n      const knownGrabbers=');
const guardEnd = source.indexOf('    {\n      const REDIRECT_PARAMS=', guardStart);
assert(guardStart > 0 && guardEnd > guardStart, 'image guard source changed');
const guard = source.slice(guardStart, guardEnd);

function imageRig(blockKnown) {
  const events = [];
  let observe;
  class ImageElement {}
  Object.defineProperty(ImageElement.prototype, 'src', {
    configurable: true, get() { return this.value; }, set(value) { this.value = value; },
  });
  const sandbox = {
    WO: { warnGrabberDomains: true, blockGrabberResources: blockKnown, grabberDomains: ['grabify.link'] },
    location: { href: 'https://site.example/page', hostname: 'site.example' },
    regDomain(host) { return String(host).split('.').slice(-2).join('.'); },
    HTMLImageElement: ImageElement,
    document: { querySelectorAll: () => [] },
    woObserve(fn) { observe = fn; },
    log(type, detail) { events.push({ type, detail }); },
    URL, Set, Object,
  };
  vm.runInNewContext(guard, sandbox);
  return { events, ImageElement, observe };
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
  r.observe([], [], [{ querySelectorAll: () => [{ getAttribute: () => 'https://other.test/iplogger/abc1234567' }] }]);
  assert.equal(r.events.length, 3, 'parser-inserted images are checked too');
  r.observe([], [], [{ querySelectorAll: () => [{ getAttribute: () => 'https://other.test/iplogger/explanation.jpg' }] }]);
  assert.equal(r.events.length, 3, 'ordinary explanatory image names do not trigger');
}
{
  const r = imageRig(false);
  new r.ImageElement().src = 'https://grabify.link/pixel?token=PRIVATE';
  assert.equal(r.events.length, 1, 'a known image warns when page-side blocking is off');
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
  assert.equal((await sandbox.readEvidence({}, 'background')).ok, true, 'budget recovers after the ten-minute window');
}

async function flush() {
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
    setTimeout(fn) { const timer = { fn, canceled: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.canceled = true; },
    URL, Date, Map, Set, Number, Math, String,
  };
  vm.runInNewContext(observer + '\nthis.navStatus = grabberNavigationStatus; this.noteCandidate = noteGrabberImageCandidate; this.resetEvidence = () => { DNR_FEEDBACK_SNAPSHOT = null; };', sandbox);
  async function runTimers() {
    for (const timer of timers.splice(0)) if (!timer.canceled) await timer.fn();
  }
  const sender = { tab: { id: 7 }, url: 'chrome-extension://wo/ip-logger-warning.html', frameId: 0 };
  const wrong = await sandbox.navStatus({ ...sender, url: 'https://site.example/' });
  assert.equal(wrong.status, 'observed_unconfirmed', 'only the extension warning page can request the verdict');
  listeners.before({ tabId: 7, url: 'https://grabify.link/x?token=NAVSECRET' });
  matched = [{ rule: { rulesetId: 'grabbers', ruleId: 168 }, tabId: 7, timeStamp: Date.now() }];
  const result = await sandbox.navStatus(sender);
  assert.equal(result.status, 'blocked');
  assert.equal(result.host, 'grabify.link');
  assert.equal(history.length, 1);
  assert(!JSON.stringify(history).includes('NAVSECRET'));
  await sandbox.navStatus(sender);
  assert.equal(history.length, 1, 'reloading a warning does not duplicate Activity');

  listeners.before({ tabId: 9, url: 'https://tracker.iplocation.net/t/ABC12345?token=TRACKERSECRET' });
  matched = [{ rule: { rulesetId: 'grabbers', ruleId: 171 }, tabId: 9, timeStamp: Date.now() }];
  sandbox.resetEvidence();
  const trackerNav = await sandbox.navStatus({ ...sender, tab: { id: 9 } });
  assert.equal(trackerNav.status, 'blocked', 'a scoped tracker route confirms the redirect');
  assert.equal(trackerNav.host, 'tracker.iplocation.net');
  assert(!JSON.stringify(history).includes('TRACKERSECRET'));

  matched = [{ rule: { rulesetId: 'grabbers', ruleId: 168 }, tabId: 11, timeStamp: Date.now() }];
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

  enabled = [];
  sandbox.noteCandidate({ matched: 'grabify.link' }, { tab: { id: 14, url: 'https://site.example/' } });
  await runTimers();
  assert.equal(history.at(-1).detail.status, 'protection_unavailable', 'disabled DNR rules are reported as unavailable');

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

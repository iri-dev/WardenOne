/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* $redirect and $csp: the resource table has to agree with the files on disk, the manifest and
   the package, and the rules the parser emits have to stay inside the bands and off navigations.
   Run: node tools/test-redirect-resources.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const generator = require('./build-redirect-resources.js');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const ALLOWLIST = new Set(JSON.parse(fs.readFileSync(path.join(ROOT, 'tools', 'package-allowlist.json'), 'utf8')));

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

function readNumber(name) {
  const found = Number((BG.match(new RegExp('const ' + name + ' = (\\d+)')) || [])[1]);
  check(name + ' is readable from background.js', Number.isFinite(found) && found > 0);
  return found;
}

const REDIRECT_RULE_BASE = readNumber('REDIRECT_RULE_BASE');
const REDIRECT_RULES_BUDGET = readNumber('REDIRECT_RULES_BUDGET');
const CSP_RULE_BASE = readNumber('CSP_RULE_BASE');
const CSP_RULES_BUDGET = readNumber('CSP_RULES_BUDGET');
const REDIRECT_RULE_PRIORITY = readNumber('REDIRECT_RULE_PRIORITY');
const CSP_RULE_PRIORITY = readNumber('CSP_RULE_PRIORITY');

// ---------------------------------------------------------------------------
// Lift the parser out of background.js.
// ---------------------------------------------------------------------------
const from = BG.indexOf('/* ======================= $redirect and $csp');
const to = BG.indexOf('function parseNetworkRules(');
check('the modifier region is where the slice expects it', from > 0 && to > from);
if (from < 0 || to < from) process.exit(1);

const ALL_TYPES = ['main_frame', 'sub_frame', 'stylesheet', 'script', 'image', 'font', 'object',
  'xmlhttprequest', 'ping', 'csp_report', 'media', 'websocket', 'webtransport', 'webbundle', 'other'];

const sandbox = {
  String, Number, Boolean, Array, Object, Set, Map, RegExp, JSON, console,
  ALL_DNR_RESOURCE_TYPES: ALL_TYPES,
  UBO_IGNORABLE: new Set(['all']),
  UBO_TYPE_MAP: {
    script: 'script', image: 'image', stylesheet: 'stylesheet', css: 'stylesheet',
    object: 'object', xmlhttprequest: 'xmlhttprequest', xhr: 'xmlhttprequest',
    subdocument: 'sub_frame', frame: 'sub_frame', document: 'main_frame', doc: 'main_frame',
    ping: 'ping', media: 'media', font: 'font', websocket: 'websocket', other: 'other',
  },
  validNetworkRuleScope: (host) => host.length <= 253 && host.split('.').every((label) =>
    label.length > 0 && label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)),
  networkRulePatternHost: (pattern) => {
    let p = String(pattern || '').trim().toLowerCase();
    if (!p) return '';
    p = p.replace(/^\|\|/, '').replace(/^\|/, '');
    p = p.replace(/^https?:\/\//, '').replace(/^https?:/, '').replace(/^\/\//, '');
    p = p.replace(/^\*\./, '').replace(/^www\./, '');
    p = p.replace(/[\^/?#:|].*$/, '').replace(/\.$/, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(p) ? p : '';
  },
  REDIRECT_RULE_PRIORITY,
  CSP_RULE_PRIORITY,
};
vm.createContext(sandbox);
vm.runInContext(BG.slice(from, to)
  + 'this.__api={parseModifierRules,finalizeModifierRule,redirectResourceFor,REDIRECT_RESOURCES,'
  + 'REDIRECT_SURROGATE_NAMES};',
  sandbox, { filename: 'background.js:modifiers' });
const api = sandbox.__api;

const trackers = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules-trackers.json'), 'utf8'));
{
  /* uBlock's googlesyndication_adsbygoogle.js redirects land on this stand in (tools/build-filter-lists-dnr.js). */
  const ubo = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules-ubo-filters.json'), 'utf8'));
  const adsbygoogle = ubo.filter(rule => rule.action.redirect?.extensionPath === '/surrogates/adsbygoogle.js');
  check('the ads queue replacement only answers scripts', adsbygoogle.length > 0 &&
    adsbygoogle.every(rule => rule.condition.resourceTypes.every(type => type === 'script' || type === 'xmlhttprequest')));
  check('ads queue replacement is packaged and web accessible', ALLOWLIST.has('surrogates/adsbygoogle.js') &&
    MANIFEST.web_accessible_resources.some(entry => entry.resources.includes('surrogates/adsbygoogle.js')));
  const jobs = [], attrs = {}, options = { enable_page_level_ads: true };
  const queue = [options];
  const slot = { setAttribute(name, value) { attrs[name] = value; } };
  const page = vm.createContext({ window: { adsbygoogle: queue }, queueMicrotask: callback => jobs.push(callback),
    document: { querySelector: () => attrs['data-adsbygoogle-status'] ? null : slot } });
  const surrogate = fs.readFileSync(path.join(ROOT, 'surrogates/adsbygoogle.js'), 'utf8');
  vm.runInContext(surrogate, page);
  check('ads queue replacement keeps the original queue and push contract', page.window.adsbygoogle === queue &&
    queue[0] === options && queue.loaded === true && queue.push({}) === 2);
  for (const job of jobs) job();
  check('the replacement marks the slot unfilled without requesting an ad', attrs['data-ad-status'] === 'unfilled' &&
    attrs['data-adsbygoogle-status'] === 'done');
}
for (const [file, host, endpoint] of [
  ['surrogates/analytics.js', 'www.google-analytics.com', '/analytics.js'],
  ['surrogates/facebook.js', 'connect.facebook.net', '/en_US/sdk.js'],
  ['surrogates/facebook.js', 'connect.facebook.net', '/en_US/fbevents.js'],
  ['surrogates/publisher-tag.js', 'securepubads.g.doubleclick.net', '/tag/js/gpt.js'],
  ['surrogates/publisher-tag.js', 'pagead2.googlesyndication.com', '/tag/js/gpt.js'],
  ['surrogates/tag-manager.js', 'www.googletagmanager.com', '/gtm.js'],
  ['surrogates/tag-manager.js', 'www.googletagmanager.com', '/gtag/js'],
  ['surrogates/segment.js', 'cdn.segment.com', '/analytics.js/v1/WRITEKEY123/analytics.min.js'],
  ['surrogates/adobe-launch.js', 'assets.adobedtm.com', '/a1b2c3/d4e5f6/launch-EN0123abcd.min.js'],
  ['surrogates/adobe-launch.js', 'assets.adobedtm.com', '/0123abcd/satelliteLib-4567ef.js'],
  ['surrogates/matomo.js', 'cdn.matomo.cloud', '/shop.matomo.cloud/matomo.js'],
  ['surrogates/apstag.js', 'c.amazon-adsystem.com', '/aax2/apstag.js'],
  ['surrogates/optimizely.js', 'cdn.optimizely.com', '/js/1234567890.js'],
  ['surrogates/urchin.js', 'ssl.google-analytics.com', '/ga.js'],
  ['surrogates/urchin.js', 'www.google-analytics.com', '/ga.js'],
]) {
  const library = 'https://' + host + endpoint;
  const rule = trackers.find(rule => rule.action.redirect?.extensionPath === '/' + file && new RegExp(rule.condition.regexFilter).test(library));
  check(file + ' is packaged', ALLOWLIST.has(file));
  check(file + ' has a dynamic resource URL', MANIFEST.web_accessible_resources.some(entry =>
    entry.use_dynamic_url === true && entry.resources.includes(file)));
  check(file + ' is third party script only', rule?.condition.domainType === 'thirdParty'
    && JSON.stringify(rule.condition.resourceTypes) === '["script"]'
    && JSON.stringify(rule.condition.requestMethods) === '["get"]');
  if (!rule) continue;
  const pixel = endpoint.endsWith('/fbevents.js');
  check(file + ' has the reviewed priority for ' + endpoint,
    pixel ? rule.priority > 1900 && rule.priority < 3000 : rule.priority > REDIRECT_RULE_PRIORITY && rule.priority < 1900);
  const filter = new RegExp(rule.condition.regexFilter);
  check(file + ' intercepts the library and its query variants', filter.test(library) && filter.test(library + '?v=1'));
  for (const url of ['https://' + host + '/collect', library + '.map', 'https://' + host + '.example.org' + endpoint,
    'https://' + (host.startsWith('www.') ? host.replace(/^www\./, 'region1.') : 'other.' + host) + endpoint]) {
    check(file + ' ignores ' + url, !filter.test(url));
  }
}

{
  const jobs = [], calls = [];
  let networkAttempts = 0;
  const network = () => { networkAttempts++; throw Error('the surrogate tried to contact the network'); };
  const page = vm.createContext({ queueMicrotask: callback => jobs.push(callback), calls,
    fetch: network, XMLHttpRequest: network, Image: network, navigator: { sendBeacon: network } });
  const surrogate = fs.readFileSync(path.join(ROOT, 'surrogates/analytics.js'), 'utf8');
  vm.runInContext(`window = globalThis; GoogleAnalyticsObject = 'siteAnalytics';
    siteAnalytics = function () { (siteAnalytics.q ||= []).push(arguments); };
    siteAnalytics('send', 'pageview', { hitCallback() { calls.push('queued'); } });
    siteAnalytics('send', { hitCallback() { throw Error('page callback failed'); } });
    siteAnalytics(() => { calls.push('ready'); });`, page);
  vm.runInContext(surrogate, page);
  vm.runInContext(surrogate, page);
  vm.runInContext(`siteAnalytics('checkout.send', 'event', 'cart', 'continue', { hitCallback() { calls.push('later'); } });
    siteAnalytics('set', { hitCallback() { calls.push('unexpected'); } });`, page);
  check('analytics callbacks run asynchronously', calls.length === 0);
  for (const job of jobs) job();
  check('analytics callbacks finish once, in order, without a collector', calls.join(',') === 'queued,ready,later');
  check('the analytics surrogate attempts no network requests', networkAttempts === 0);
}

{
  const jobs = [], calls = [];
  let networkAttempts = 0;
  const network = () => { networkAttempts++; throw Error('the surrogate tried to contact the network'); };
  const page = vm.createContext({ URL, queueMicrotask: callback => jobs.push(callback), calls,
    document: { currentScript: { src: 'https://www.googletagmanager.com/gtm.js?id=GTM-FIXTURE&l=checkoutLayer' } },
    fetch: network, XMLHttpRequest: network, Image: network, navigator: { sendBeacon: network } });
  const surrogate = fs.readFileSync(path.join(ROOT, 'surrogates/tag-manager.js'), 'utf8');
  vm.runInContext(`window = globalThis; dataLayer = [];
    original = checkoutLayer = [
      { event: 'ready', eventCallback(id) { calls.push('queued:' + id); } },
      { eventCallback() { calls.push('unexpected'); } },
      { event: 'broken', eventCallback() { throw Error('page callback failed'); } },
    ];`, page);
  vm.runInContext(surrogate, page);
  vm.runInContext('firstPush = checkoutLayer.push;', page);
  vm.runInContext(surrogate, page);
  check('Tag Manager retains a custom queue and installs once', vm.runInContext(
    'checkoutLayer === original && checkoutLayer.push === firstPush && dataLayer.push === Array.prototype.push', page));
  check('Tag Manager preserves the result of pushing multiple entries', vm.runInContext(`checkoutLayer.push(
    { event: 'checkout', eventTimeout: 1, eventCallback(id) { calls.push('paid:' + id); } },
    { event: 'next', eventCallback(id) { calls.push('next:' + id); } },
    { currency: 'GBP' }) === 6`, page));
  check('Tag Manager callbacks run asynchronously', calls.length === 0);
  for (const job of jobs) job();
  check('Tag Manager completes each event in order', calls.join(',') === 'queued:GTM-FIXTURE,paid:GTM-FIXTURE,next:GTM-FIXTURE');
  check('the Tag Manager surrogate attempts no network requests', networkAttempts === 0);
}

{
  const jobs = [], statuses = [];
  const document = { currentScript: { src: 'https://connect.facebook.net/en_GB/sdk.js' }, readyState: 'complete' };
  const page = vm.createContext({ queueMicrotask: callback => jobs.push(callback), statuses, document });
  const facebook = fs.readFileSync(path.join(ROOT, 'surrogates/facebook.js'), 'utf8');
  vm.runInContext(`window = globalThis;
    fbAsyncInit = () => { FB.init({ appId: '1' }); statuses.push('ready'); }`, page);
  vm.runInContext(facebook, page);
  vm.runInContext(facebook, page);
  vm.runInContext(`FB.login(result => statuses.push(result.status + ':' + result.authResponse));`, page);
  for (const job of jobs.splice(0)) job();
  check('Facebook startup completes once and an unavailable login returns no credentials', statuses.join(',') === 'ready,unknown:null');
  document.currentScript.src = 'https://connect.facebook.net/en_US/fbevents.js';
  vm.runInContext(facebook, page);
  check('Facebook Pixel commands are accepted locally', vm.runInContext(`fbq('track', 'Purchase'); fbq.loaded && fbq === _fbq`, page));
}

{
  const jobs = [], calls = [];
  let networkAttempts = 0;
  const network = () => { networkAttempts++; throw Error('the surrogate tried to contact the network'); };
  const page = vm.createContext({ queueMicrotask: callback => jobs.push(callback), calls,
    fetch: network, XMLHttpRequest: network, Image: network, navigator: { sendBeacon: network } });
  const surrogate = fs.readFileSync(path.join(ROOT, 'surrogates/publisher-tag.js'), 'utf8');
  const evaluate = code => vm.runInContext(code, page);
  evaluate(`window = globalThis; original = googletag = { cmd: [
    function () { if (this === window && googletag.apiReady) calls.push('first'); googletag.cmd.push(() => calls.push('nested')); },
    () => { throw Error('page command failed'); },
    () => calls.push('second'),
  ] };`);
  evaluate(surrogate);
  evaluate(surrogate);
  check('Publisher Tag drains its original queue once in order', calls.join(',') === 'first,second,nested');
  check('Publisher Tag keeps its namespace and counts processed commands', evaluate(`googletag === original
    && googletag.cmd.push(() => calls.push('later'), () => calls.push('last')) === 6`));
  check('Publisher Tag completes late commands immediately', calls.join(',') === 'first,second,nested,later,last');

  evaluate(`service = googletag.pubads();
    googletag.setConfig({ disableInitialLoad: true });
    slot = googletag.defineSlot('/123/placeholder', [300, 250], 'slot').setTargeting('page', 'news').addService(service);
    report = event => calls.push(event.isEmpty && event.size === null && event.slot === slot ? 'empty' : 'unexpected');
    service.addEventListener('slotRenderEnded', report);
    service.addEventListener('impressionViewable', () => calls.push('impression'));
    googletag.enableServices();
    googletag.display('slot');`);
  check('Publisher Tag honours disabled initial load', jobs.length === 0 && evaluate('googletag.pubadsReady && service.getSlots()[0] === slot'));
  evaluate('service.refresh(null);');
  for (const job of jobs.splice(0)) job();
  check('Publisher Tag reports an empty slot after refresh', calls.at(-1) === 'empty');
  evaluate('service.refresh([slot]); googletag.destroySlots([slot]);');
  for (const job of jobs.splice(0)) job();
  check('Publisher Tag cancels results for destroyed slots', calls.filter(call => call === 'empty').length === 1
    && evaluate('service.getSlots().length === 0'));
  check('Publisher Tag can define a slot before a page assigns an element ID', evaluate(`generated = googletag.defineSlot('/123/other', [1, 1]);
    generated.getSlotElementId() && generated.getSlotElementId() !== googletag.defineSlot('/123/next', [1, 1]).getSlotElementId()`));
  check('the Publisher Tag surrogate attempts no network requests', networkAttempts === 0);
}

/* Round 5b surrogates. Each one is run in a sandbox whose network calls throw, with the page's own queue in place first,
   loaded twice, then called again the way pages call it later. */
const offline = () => {
  const counter = { attempts: 0 };
  const network = () => { counter.attempts++; throw Error('the surrogate tried to contact the network'); };
  return { counter, globals: { fetch: network, XMLHttpRequest: network, Image: network, WebSocket: network, navigator: { sendBeacon: network } } };
};
const surrogateSource = file => fs.readFileSync(path.join(ROOT, 'surrogates', file), 'utf8');

{
  const jobs = [], calls = [];
  const { counter, globals } = offline();
  const page = vm.createContext(Object.assign({ queueMicrotask: callback => jobs.push(callback), calls }, globals));
  const surrogate = surrogateSource('segment.js');
  vm.runInContext(`window = globalThis; analytics = [];
    analytics.push(['page']);
    analytics.push(['track', 'Checkout Started', { step: 1 }, {}, () => calls.push('queued')]);
    analytics.push(['ready', () => calls.push('ready')]);
    analytics.push(['identify', 'user-1', () => { throw Error('page callback failed'); }]);
    analytics.push(['push', ['track', 'nested', () => calls.push('unexpected')]]);`, page);
  vm.runInContext(surrogate, page);
  const first = vm.runInContext('analytics', page);
  vm.runInContext(surrogate, page);
  check('Segment installs once', vm.runInContext('analytics', page) === first && first.initialized === true);
  check('Segment answers a later call with a promise', vm.runInContext(`typeof analytics.track('Later', {}, () => calls.push('later')).then === 'function'`, page));
  check('Segment callbacks run asynchronously', calls.length === 0);
  for (const job of jobs.splice(0)) job();
  check('Segment finishes queued and later callbacks in order', calls.join(',') === 'queued,ready,later');
  check('Segment reports no user identity', vm.runInContext('analytics.user().anonymousId() === null && analytics.user().id() === null', page));
  check('the Segment surrogate attempts no network requests', counter.attempts === 0);
}

{
  const surrogate = surrogateSource('adobe-launch.js');
  const pageWith = (styles, setup) => {
    const removed = [];
    const document = { readyState: 'complete', addEventListener() {},
      getElementById: id => styles.includes(id) ? { remove() { removed.push(id); } } : null };
    const { counter, globals } = offline();
    const page = vm.createContext(Object.assign({ document }, globals));
    vm.runInContext('window = globalThis;' + (setup || ''), page);
    vm.runInContext(surrogate, page);
    return { page, removed, counter };
  };
  const plain = pageWith(['at-body-style', 'alloy-prehiding']);
  check('Adobe Launch keeps page code that calls _satellite running', vm.runInContext(`_satellite.pageBottom(); _satellite.track('rule', {});
    _satellite.getVar('pageName').toLowerCase() === '' && _satellite.getVisitorId() === null && _satellite.cookie.get('x') === undefined`, plain.page));
  check('Adobe Launch lifts the Target and Web SDK pre-hiding styles', plain.removed.join(',') === 'at-body-style,alloy-prehiding');
  check('the Adobe Launch surrogate attempts no network requests', plain.counter.attempts === 0);
  const target = pageWith(['at-body-style', 'alloy-prehiding'], 'adobe = { target: {} }; alloy = function () {};');
  check('Adobe Launch leaves pre-hiding to a Target or Web SDK that is running', target.removed.length === 0);
  const real = pageWith([], '_satellite = { buildInfo: { turbineVersion: "27.5.0" }, real: true };');
  check('Adobe Launch never replaces a Launch that loaded', vm.runInContext('_satellite.real === true && _satellite.getVar === undefined', real.page));
}

{
  const jobs = [], calls = [];
  const { counter, globals } = offline();
  const page = vm.createContext(Object.assign({ queueMicrotask: callback => jobs.push(callback), calls, location: { href: 'https://shop.example/' } }, globals));
  const surrogate = surrogateSource('matomo.js');
  vm.runInContext(`window = globalThis; _paq = [['trackPageView'], ['enableLinkTracking'], ['setSiteId', '1'],
    [function () { calls.push(this.getVisitorId() === '' ? 'function' : 'unexpected'); }],
    ['trackEvent', 'cart', 'add', 'shoes', 1, {}, () => calls.push('event')],
    ['MediaAnalytics::scanForMedia'], ['unknownMethod', 1],
    ['trackLink', 'https://partner.example/', 'link', {}, () => { throw Error('page callback failed'); }]];
    matomoAsyncInit = () => calls.push('init');`, page);
  vm.runInContext(surrogate, page);
  vm.runInContext(surrogate, page);
  vm.runInContext(`_paq.push(['trackGoal', 1, 0, {}, () => calls.push('goal')]);
    _paq.push([function () { calls.push(this === Matomo.getAsyncTracker() ? 'tracker' : 'unexpected'); }]);`, page);
  check('Matomo runs function commands with its tracker as this, at once', calls.join(',') === 'function,tracker');
  for (const job of jobs.splice(0)) job();
  check('Matomo finishes tracking callbacks and its init hook once', calls.join(',') === 'function,tracker,event,init,goal');
  check('Matomo trackers are not mistaken for promises', vm.runInContext('Matomo.getAsyncTracker().then === undefined && Piwik === Matomo', page));
  check('the Matomo surrogate attempts no network requests', counter.attempts === 0);
}

{
  const jobs = [], bids = [];
  const { counter, globals } = offline();
  const page = vm.createContext(Object.assign({ queueMicrotask: callback => jobs.push(callback), bids }, globals));
  const surrogate = surrogateSource('apstag.js');
  vm.runInContext(`window = globalThis;
    apstag = { _Q: [], init() { apstag._Q.push(['i', arguments]); }, fetchBids() { apstag._Q.push(['f', arguments]); } };
    apstag.init({ pubID: 'lab', adServer: 'googletag' });
    apstag.fetchBids({ slots: [{ slotID: 'div-1', sizes: [[300, 250]] }, { slotID: 'div-2' }], timeout: 2000 }, result => bids.push(result));`, page);
  vm.runInContext(surrogate, page);
  const first = vm.runInContext('apstag', page);
  vm.runInContext(surrogate, page);
  check('apstag installs once', vm.runInContext('apstag', page) === first && !first._Q);
  vm.runInContext(`apstag.fetchBids({ slots: [{ slotID: 'late' }] }, result => bids.push(result));
    apstag.fetchBids({}, () => { throw Error('page callback failed'); });`, page);
  check('apstag answers bids asynchronously', bids.length === 0);
  for (const job of jobs.splice(0)) job();
  check('apstag returns no bid for every queued and later slot', bids.length === 2
    && bids[0].map(bid => bid.slotID).join(',') === 'div-1,div-2' && bids[0].every(bid => bid.amznbid === '' && bid.size === '0x0')
    && bids[1].length === 1 && bids[1][0].slotID === 'late');
  check('apstag has no targeting to add', vm.runInContext('apstag.targetingKeys().length === 0', page));
  check('the apstag surrogate attempts no network requests', counter.attempts === 0);
}

{
  const jobs = [], calls = [];
  const { counter, globals } = offline();
  const page = vm.createContext(Object.assign({ queueMicrotask: callback => jobs.push(callback), calls }, globals));
  const surrogate = surrogateSource('optimizely.js');
  vm.runInContext(`window = globalThis; optimizely = [];
    optimizely.push({ type: 'addListener', filter: { type: 'lifecycle', name: 'activated' }, handler: () => calls.push('activated') });
    optimizely.push({ type: 'addListener', filter: { type: 'lifecycle', name: 'campaignDecided' }, handler: () => calls.push('unexpected') });
    optimizely.push({ type: 'event', eventName: 'view' });`, page);
  vm.runInContext(surrogate, page);
  const first = vm.runInContext('optimizely', page);
  vm.runInContext(surrogate, page);
  check('Optimizely installs once', vm.runInContext('optimizely', page) === first);
  check('Optimizely reports no active experiment', vm.runInContext(`const state = optimizely.get('state');
    state.getActiveExperimentIds().length === 0 && Object.keys(state.getVariationMap()).length === 0
      && state.getDecisionString({ campaignId: '1' }) === null && state.isGlobalHoldback() === false`, page));
  check('Optimizely accepts commands', vm.runInContext(`optimizely.push({ type: 'event', eventName: 'buy' }) === true && optimizely.push(null) === true`, page));
  check('Optimizely Classic properties read as empty', vm.runInContext('optimizely.activeExperiments.length === 0 && Object.keys(optimizely.variationMap).length === 0', page));
  check('Optimizely lifecycle listeners run asynchronously', calls.length === 0);
  for (const job of jobs.splice(0)) job();
  check('Optimizely runs only its activation listener, once', calls.join(',') === 'activated');
  check('the Optimizely surrogate attempts no network requests', counter.attempts === 0);
}

{
  const jobs = [], calls = [], visits = [];
  const { counter, globals } = offline();
  const page = vm.createContext(Object.assign({ queueMicrotask: callback => jobs.push(callback), calls, location: { assign: url => visits.push(url) } }, globals));
  const surrogate = surrogateSource('urchin.js');
  vm.runInContext(`window = globalThis; _gaq = [['_setAccount', 'UA-1-1'], ['_trackPageview'],
    ['_set', 'hitCallback', () => calls.push('hit')], ['_trackEvent', 'outbound', 'click'],
    ['b._setAccount', 'UA-2-1'], ['b._trackPageview'], () => calls.push('function')];`, page);
  vm.runInContext(surrogate, page);
  vm.runInContext(surrogate, page);
  check('ga.js runs function commands at once', calls.join(',') === 'function');
  for (const job of jobs.splice(0)) job();
  check('ga.js runs hitCallback after a hit, on that tracker only', calls.join(',') === 'function,hit');
  check('ga.js trackers keep their own accounts', vm.runInContext(`_gat._getTrackerByName('b')._getAccount() === 'UA-2-1'
    && _gat._getTrackerByName('')._getAccount() === 'UA-1-1'`, page));
  vm.runInContext(`_gaq.push(['_link', 'https://partner.example/next']);`, page);
  check('ga.js _link still opens the link', visits.join(',') === 'https://partner.example/next');
  check('ga.js returns linker URLs unchanged', vm.runInContext(`_gat._getTrackerByName('')._getLinkerUrl('https://x.example/') === 'https://x.example/'`, page));
  check('ga.js trackers are not mistaken for promises', vm.runInContext(`_gat._getTrackerByName('').then === undefined`, page));
  check('the ga.js surrogate attempts no network requests', counter.attempts === 0);
}

{
  const tagManager = fs.readFileSync(path.join(ROOT, 'surrogates/tag-manager.js'), 'utf8');
  const page = vm.createContext({ URL, queueMicrotask: () => {}, document: { currentScript: { src: 'https://www.googletagmanager.com/gtm.js?id=GTM-OPT' } } });
  vm.runInContext(`window = globalThis; ended = 0; dataLayer = []; dataLayer.hide = { 'GTM-OPT': true, end() { ended++; } };`, page);
  vm.runInContext(tagManager, page);
  check('Tag Manager ends Google Optimize anti-flicker without waiting for its timeout', vm.runInContext('ended', page) === 1);
  const expired = vm.createContext({ URL, URLSearchParams, queueMicrotask: () => {}, document: { currentScript: null } });
  vm.runInContext(`window = globalThis; dataLayer = []; dataLayer.hide = { 'GTM-OPT': true, end: null };`, expired);
  vm.runInContext(tagManager, expired);
  check('Tag Manager accepts an anti-flicker hide that already timed out', vm.runInContext('typeof dataLayer.push === "function"', expired));
}

// ---------------------------------------------------------------------------
// The table, the files, the manifest and the package all name the same things.
// ---------------------------------------------------------------------------
{
  const generated = new Set(generator.RESOURCES.map((r) => 'redirect-resources/' + r.file));
  const referenced = new Set(Object.values(api.REDIRECT_RESOURCES).map((r) => r.path.replace(/^\//, '')));

  for (const file of referenced) {
    check('the table points at a file that exists: ' + file, fs.existsSync(path.join(ROOT, file)));
    check('the table points at a generated file: ' + file, generated.has(file),
      'tools/build-redirect-resources.js does not produce it');
  }
  for (const file of generated) {
    check('every generated file is reachable from a filter-list name: ' + file, referenced.has(file),
      'nothing in REDIRECT_RESOURCES serves it, so it would ship unused');
  }

  const war = (MANIFEST.web_accessible_resources || [])
    .flatMap((entry) => entry.resources || []);
  for (const file of referenced) {
    check('the browser may serve it to a page: ' + file, war.includes(file),
      'a DNR redirect to a resource that is not web accessible fails the request');
    check('the release package carries it: ' + file, ALLOWLIST.has(file));
  }

  /* A page can fetch a web-accessible resource to recognise the extension. A dynamic URL is the
     only thing that stops that being a reliable fingerprint. */
  const entry = (MANIFEST.web_accessible_resources || [])
    .find((e) => (e.resources || []).some((r) => r.startsWith('redirect-resources/')));
  check('the redirect resources are served from a dynamic URL', !!entry && entry.use_dynamic_url === true,
    'without use_dynamic_url any page can probe for WardenOne at a fixed path');
}

// ---------------------------------------------------------------------------
// Name resolution, including uBlock's trailing ":priority" form.
// ---------------------------------------------------------------------------
{
  check('a canonical name resolves', api.redirectResourceFor('noop.js').path === '/redirect-resources/noop.js');
  check('an alias resolves to the same file',
    api.redirectResourceFor('noopjs').path === '/redirect-resources/noop.js');
  check('a trailing rule priority is ignored',
    api.redirectResourceFor('noopjs:10').path === '/redirect-resources/noop.js');
  check('an unknown name resolves to nothing', api.redirectResourceFor('not-a-resource.js') === null);
  for (const name of ['google-ima.js', 'googlesyndication_adsbygoogle.js', 'fingerprint2.js']) {
    check('surrogate "' + name + '" is not served by a neutered file',
      api.redirectResourceFor(name) === null && api.REDIRECT_SURROGATE_NAMES.has(name),
      'a surrogate has to imitate an API; an empty file would break the page differently');
  }
  for (const [name, resource] of Object.entries(api.REDIRECT_RESOURCES)) {
    check('default types for "' + name + '" exclude main_frame', !resource.types.includes('main_frame'));
    check('default types for "' + name + '" are real DNR types',
      resource.types.every((t) => ALL_TYPES.includes(t)), resource.types.join(','));
  }
}

// ---------------------------------------------------------------------------
// $redirect.
// ---------------------------------------------------------------------------
{
  const out = api.parseModifierRules('||ads.example/banner.js$script,redirect=noopjs\n', 100, 100);
  check('a $redirect line compiles to one redirect rule', out.redirectRules.length === 1);
  const rule = api.finalizeModifierRule(out.redirectRules[0], REDIRECT_RULE_BASE);
  check('it redirects to the extension resource',
    rule.action.type === 'redirect' && rule.action.redirect.extensionPath === '/redirect-resources/noop.js');
  check('it keeps the declared request type',
    JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(['script']));
  check('it sits above the blocklist and below the compatibility allows',
    rule.priority === REDIRECT_RULE_PRIORITY && rule.priority > 1100 && rule.priority < 1900,
    String(rule.priority));

  const typeless = api.parseModifierRules('||ads.example/pixel$redirect=1x1.gif\n', 100, 100);
  check('a line with no request type takes the resource default',
    typeless.redirectRules.length === 1
    && JSON.stringify(typeless.redirectRules[0].condition.resourceTypes) === JSON.stringify(['image']));

  /* uBlock's $redirect-rule only fires when another rule already blocks the request. DNR cannot
     ask that, and emitting it as a plain redirect would stop requests uBlock lets through. */
  const conditional = api.parseModifierRules('||ads.example/a.js$script,redirect-rule=noopjs\n', 100, 100);
  check('$redirect-rule is dropped rather than turned into a block',
    conditional.redirectRules.length === 0);

  const navigation = api.parseModifierRules('||ads.example/page$document,redirect=noop.html\n', 100, 100);
  check('a $redirect on a document is refused', navigation.redirectRules.length === 0,
    'answering a navigation with a local file takes the reader somewhere they did not ask for');

  const unknown = api.parseModifierRules('||ads.example/ima.js$script,redirect=google-ima.js\n', 100, 100);
  check('a rule naming a surrogate we do not ship is dropped', unknown.redirectRules.length === 0);

  const exempted = api.parseModifierRules(
    '||ads.example/a.js$script,redirect=noopjs\n@@||ads.example^$redirect\n', 100, 100);
  check('a $redirect exception drops the redirect for that host', exempted.redirectRules.length === 0);

  const scoped = api.parseModifierRules(
    '||cdn.example/a.js$script,redirect=noopjs,domain=site.example|~sub.site.example\n', 100, 100);
  check('domain scoping becomes initiator domains',
    scoped.redirectRules.length === 1
    && JSON.stringify(scoped.redirectRules[0].condition.initiatorDomains) === JSON.stringify(['site.example'])
    && JSON.stringify(scoped.redirectRules[0].condition.excludedInitiatorDomains) === JSON.stringify(['sub.site.example']));

  const regex = api.parseModifierRules('/ads?\\d+/$script,redirect=noopjs\n', 100, 100);
  check('a regex filter is not approximated', regex.redirectRules.length === 0);

  const capped = api.parseModifierRules(
    Array.from({ length: 50 }, (_, i) => '||a' + i + '.example/x.js$script,redirect=noopjs').join('\n'), 7, 100);
  check('the per-source cap is honoured', capped.redirectRules.length === 7, String(capped.redirectRules.length));
}

// ---------------------------------------------------------------------------
// $csp. Narrower than uBlock on purpose: an appended policy can refuse a site's own scripts.
// ---------------------------------------------------------------------------
{
  const out = api.parseModifierRules("||site.example^$csp=script-src 'self'\n", 100, 100);
  check('a $csp line compiles to one rule', out.cspRules.length === 1);
  const rule = api.finalizeModifierRule(out.cspRules[0], CSP_RULE_BASE);
  check('it appends the header rather than replacing it',
    rule.action.type === 'modifyHeaders'
    && rule.action.responseHeaders[0].header === 'content-security-policy'
    && rule.action.responseHeaders[0].operation === 'append'
    && rule.action.responseHeaders[0].value === "script-src 'self'");
  check('it applies only to documents',
    JSON.stringify(rule.condition.resourceTypes) === JSON.stringify(['main_frame', 'sub_frame']));
  check('it sits below every block and allow band',
    rule.priority === CSP_RULE_PRIORITY && rule.priority < 1000, String(rule.priority));

  const exempted = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@||site.example^$csp\n", 100, 100);
  check('an exception for the host drops the injection', exempted.cspRules.length === 0);

  const otherPolicy = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@||site.example^$csp=worker-src 'none'\n", 100, 100);
  check('an exception naming a different policy still drops the injection',
    otherPolicy.cspRules.length === 0,
    'upstream writes a $csp exception because injection broke that site; policy-by-policy matching'
    + ' is not reproducible here, so the whole host is exempted');

  const pathExempt = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@||site.example/embed/$csp\n", 100, 100);
  check('a path-scoped exception exempts the whole host', pathExempt.cspRules.length === 0);

  const initiator = api.parseModifierRules(
    "||site.example^$csp=script-src 'self'\n@@*$csp,domain=host.example\n", 100, 100);
  check('a domain-scoped exception becomes an excluded initiator',
    initiator.cspRules.length === 1
    && (initiator.cspRules[0].condition.excludedInitiatorDomains || []).includes('host.example'));

  const pathPattern = api.parseModifierRules("||site.example/page$csp=script-src 'self'\n", 100, 100);
  check('a $csp rule with a path is refused', pathPattern.cspRules.length === 0,
    'only the document host is reproduced exactly');

  const scopedInjection = api.parseModifierRules(
    "||site.example^$csp=script-src 'self',domain=other.example\n", 100, 100);
  check('a domain-scoped $csp injection is refused', scopedInjection.cspRules.length === 0);

  for (const bad of ["||site.example^$csp=script-src 'self'\r\nX", '||site.example^$csp=']) {
    const parsed = api.parseModifierRules(bad.split('\r').join('\n'), 100, 100);
    check('a malformed policy is refused: ' + JSON.stringify(bad.slice(0, 40)),
      parsed.cspRules.every((r) => !/[\r\n]/.test(r.action.responseHeaders[0].value)));
  }

  const noPolicy = api.parseModifierRules('||site.example^$csp\n', 100, 100);
  check('a bare $csp with no policy injects nothing', noPolicy.cspRules.length === 0);
  const reporting = api.parseModifierRules("||site.example^$csp=script-src 'self'; report-uri https://sink.example/", 100, 100);
  check('downloaded policies cannot send violation reports', reporting.cspRules.length === 0);
}

// ---------------------------------------------------------------------------
// Budgets. Both actions count against Chrome's smaller unsafe dynamic quota.
// ---------------------------------------------------------------------------
{
  const CHROME_UNSAFE_DYNAMIC_MAX = 5000;
  const unsafeLine = BG.match(/const TOTAL_UNSAFE_DYNAMIC_BUDGET = ([^;]+);/);
  check('the unsafe budget is declared', !!unsafeLine);
  check('the unsafe budget counts the redirect band',
    !!unsafeLine && unsafeLine[1].includes('REDIRECT_RULES_BUDGET'),
    'a redirect is an unsafe DNR action and must be reserved');
  check('the unsafe budget counts the csp band',
    !!unsafeLine && unsafeLine[1].includes('CSP_RULES_BUDGET'));
  const firewall = readNumber('FIREWALL_RULES_BUDGET');
  const trackingRedirect = readNumber('TRACKING_REDIRECT_RULES_BUDGET');
  const unsafeTotal = firewall + trackingRedirect + REDIRECT_RULES_BUDGET + CSP_RULES_BUDGET + 1;
  check('the unsafe bands fit Chrome\'s guaranteed unsafe quota',
    unsafeTotal < CHROME_UNSAFE_DYNAMIC_MAX,
    unsafeTotal + ' reserved against ' + CHROME_UNSAFE_DYNAMIC_MAX);

  check('the redirect band does not overlap the csp band',
    REDIRECT_RULE_BASE + REDIRECT_RULES_BUDGET <= CSP_RULE_BASE);
  check('the redirect allocation fits the measured feed count',
    REDIRECT_RULES_BUDGET >= 838, '838 reviewed redirects need more than the former 400 slots');
  const optionBase = readNumber('OPTION_RULE_BASE');
  const optionMax = readNumber('OPTION_RULES_MAX');
  check('the redirect band starts above the option band',
    REDIRECT_RULE_BASE >= optionBase + optionMax);
  check('both bands are replaced with the rest of the remote lists',
    BG.includes('for (let i = 0; i < REDIRECT_RULES_BUDGET; i++) ids.push(REDIRECT_RULE_BASE + i)')
    && BG.includes('for (let i = 0; i < CSP_RULES_BUDGET; i++) ids.push(CSP_RULE_BASE + i)'),
    'a band left out of remoteListRuleIds is never cleared and goes stale');
  check('both bands are recognised as WardenOne rule ids',
    BG.includes('id >= REDIRECT_RULE_BASE && id < REDIRECT_RULE_BASE + REDIRECT_RULES_BUDGET')
    && BG.includes('id >= CSP_RULE_BASE && id < CSP_RULE_BASE + CSP_RULES_BUDGET'));
}

/* ---- WardenOne's own redirects (CNN's Brightline config retry loop) ---- */
{
  const m = /const PINNED_REDIRECT_RULES = (\[[\s\S]*?\n\]);/.exec(BG);
  check('PINNED_REDIRECT_RULES is present', !!m);
  const pinned = m ? vm.runInNewContext(m[1]) : [];
  const accessible = new Set(MANIFEST.web_accessible_resources.flatMap((entry) => entry.resources));
  for (const rule of pinned) {
    const target = rule.action && rule.action.redirect && rule.action.redirect.extensionPath;
    const file = String(target || '').replace(/^\//, '');
    check('pinned redirect ' + rule.condition.urlFilter + ' serves a shipped, page-reachable empty file',
      rule.__woModifier === 'redirect' && rule.action.type === 'redirect' && /^redirect-resources\/noop[^/]*$/.test(file)
      && accessible.has(file) && ALLOWLIST.has(file) && fs.existsSync(path.join(ROOT, file)));
    const types = rule.condition.resourceTypes || [];
    check('pinned redirect ' + rule.condition.urlFilter + ' never answers a page or frame navigation',
      types.length > 0 && !types.includes('main_frame') && !types.includes('sub_frame'));
    check('pinned redirect ' + rule.condition.urlFilter + ' is limited to the sites it was measured on',
      Array.isArray(rule.condition.initiatorDomains) && rule.condition.initiatorDomains.length > 0);
  }
  check('the Brightline config answer is CNN-only and XHR-only',
    pinned.some((r) => r.condition.urlFilter === '||cdn-media.brightline.tv/config/'
      && JSON.stringify(r.condition.initiatorDomains) === '["cnn.com"]' && JSON.stringify(r.condition.resourceTypes) === '["xmlhttprequest"]'
      && r.action.redirect.extensionPath === '/redirect-resources/noop.json'));
  check('pinned redirects go first in the band, ahead of any list line, so the band cap never drops them',
    /const modifierSeen = \{ redirect: new Set\(\), csp: new Set\(\) \};\n  for \(const r of PINNED_REDIRECT_RULES\) \{\n    modifierRuleBuckets\.redirect\.push\(r\);/.test(BG));
  check('they are numbered and prioritised like list redirects', /modifierRuleBuckets\[kind\]\.slice\(0, limit\)\.forEach\(\(rule, index\) =>\s*modifierRules\.push\(finalizeModifierRule\(rule, base \+ index\)\)\);/.test(BG));
}

if (failed) {
  console.error('[fail] ' + failed + ' redirect/csp check(s) failed');
  process.exit(1);
}
console.log('[ok] $redirect and $csp: resource table, manifest and package agree; navigations refused, '
  + 'exceptions honoured, bands and unsafe budget reserved');

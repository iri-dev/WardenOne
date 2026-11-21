/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
/* OneTrust answered locally (Round 5b follow up, 2026-11-21). Letting OneTrust load so consent-reject.js could press
   Reject cost 400+ consent-manager requests in the rematch crawl. surrogates/onetrust.js now stands in for its stub and
   saves the refusal itself. The surrogate, the worker's rule and consent-reject.js's report run here as they ship. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const SURROGATE = read('surrogates/onetrust.js');
const BG = read('background.js');
const REJECT = read('consent-reject.js');
const WOConsentState = require(path.join(ROOT, 'consent-state.js'));
let failed = 0, passed = 0;
function check(what, ok, detail) { if (ok) passed++; else { failed++; console.error('FAIL - ' + what + (detail ? ' :: ' + detail : '')); } }

/* A page with a cookie jar that refuses public suffixes and other sites' domains, as a browser does. */
function page({ host = 'www.example.co.uk', cookies = {}, activation = false, oneTrust = null, wrapper = true } = {}) {
  const jar = new Map(Object.entries(cookies).map(([k, v]) => [k, { value: v, domain: '' }]));
  const writes = [], events = [], timers = [], wrapperCalls = [], gtagCalls = [], inserted = [];
  const SUFFIXES = new Set(['uk', 'co.uk', 'com', 'org']);
  const document = {
    readyState: 'loading',
    listeners: {},
    get cookie() { return [...jar].map(([k, v]) => k + '=' + v.value).join('; '); },
    set cookie(text) {
      writes.push(text);
      const [pair, ...attrs] = String(text).split(';').map(s => s.trim());
      const at = pair.indexOf('=');
      const name = pair.slice(0, at), value = pair.slice(at + 1);
      const attr = Object.fromEntries(attrs.map(a => { const i = a.indexOf('='); return i < 0 ? [a.toLowerCase(), true] : [a.slice(0, i).toLowerCase(), a.slice(i + 1)]; }));
      const domain = attr.domain ? String(attr.domain).replace(/^\./, '') : '';
      if (domain && (SUFFIXES.has(domain) || !(host === domain || host.endsWith('.' + domain)))) return;
      if (attr['max-age'] === '0') { jar.delete(name); return; }
      jar.set(name, { value, domain, attr });
    },
    addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
    dispatchEvent(e) { events.push('document:' + e.type); return true; },
    createElement: (tag) => ({ tag }),
    querySelector: () => null,
    head: { appendChild: (el) => inserted.push(el.src) },
    documentElement: {},
  };
  const win = {
    document, location: { hostname: host, protocol: 'https:' },
    navigator: { globalPrivacyControl: true, userActivation: { isActive: activation } },
    setTimeout: (fn) => timers.push(fn),
    Event: function (type) { this.type = type; },
    CustomEvent: function (type, init) { this.type = type; this.detail = init && init.detail; },
    dispatchEvent(e) { events.push('window:' + e.type + ':' + JSON.stringify(e.detail)); return true; },
    gtag: (...args) => gtagCalls.push(args),
  };
  if (wrapper) win.OptanonWrapper = () => wrapperCalls.push(win.OnetrustActiveGroups);
  if (oneTrust) win.OneTrust = oneTrust;
  win.window = win;
  vm.createContext(win);
  vm.runInContext(SURROGATE, win, { filename: 'surrogates/onetrust.js' });
  const settle = () => {
    document.readyState = 'interactive';
    for (const fn of document.listeners.DOMContentLoaded || []) fn();
    while (timers.length) timers.shift()();
  };
  return { win, jar, writes, events, wrapperCalls, gtagCalls, inserted, settle,
    consent: () => WOConsentState.cookie(document.cookie, 'OptanonConsent') };
}

/* 1. A first visit saves OneTrust's own refusal. */
{
  const p = page();
  const ot = p.jar.get('OptanonConsent'), closed = p.jar.get('OptanonAlertBoxClosed');
  check('a first visit saves a refusal OneTrust itself reads', !!ot && WOConsentState.rejected('onetrust', p.consent()), p.consent());
  check('only the necessary group is on', /groups=C0001:1,C0002:0,C0003:0,C0004:0,C0005:0(&|$)/.test(p.consent()), p.consent());
  check('the banner counts as answered', !!closed && /^\d{4}-\d\d-\d\dT/.test(closed.value) && /interactionCount=1/.test(p.consent()));
  check('Global Privacy Control is recorded', /isGpcEnabled=1/.test(p.consent()));
  check('no consent id or other identifier is invented', !/consentId=/.test(p.consent()));
  check('both cookies sit on the site\'s own domain, not a public suffix', ot.domain === 'example.co.uk' && closed.domain === 'example.co.uk', ot.domain);
  check('they last a year, site wide', ot.attr['max-age'] === String(365 * 24 * 60 * 60) && ot.attr.path === '/' && ot.attr.secure === true);
  check('the domain probe cookie is cleaned up', !p.jar.has('__wo_ot_probe'));
  check('the page sees the necessary group only', p.win.OnetrustActiveGroups === ',C0001,' && p.win.OptanonActiveGroups === ',C0001,');
  check('OneTrust and Optanon answer as closed', p.win.OneTrust.IsAlertBoxClosed() === true && p.win.Optanon === p.win.OneTrust
    && p.win.OneTrust.IsAlertBoxClosedAndValid() === true);
  check('Google consent mode is told everything optional is denied', p.gtagCalls.length === 1 && p.gtagCalls[0][0] === 'consent'
    && p.gtagCalls[0][1] === 'update' && Object.values(p.gtagCalls[0][2]).every(v => v === 'denied'));
  check('consent-reject.js hears the answer', p.events.includes('document:wardenone-onetrust-answered'));
  check('OptanonWrapper waits for the page to parse', p.wrapperCalls.length === 0);
  p.settle();
  check('then it runs once, with the groups already set', p.wrapperCalls.length === 1 && p.wrapperCalls[0] === ',C0001,');
  check('tag managers hear OneTrustLoaded with the refusal', p.win.dataLayer.some(e => e.event === 'OneTrustLoaded' && e.OnetrustActiveGroups === ',C0001,'));
  check('OneTrustGroupsUpdated fires with the active groups', p.events.includes('window:OneTrustGroupsUpdated:["C0001"]'));
  check('GetDomainData lists the groups and their state', p.win.OneTrust.GetDomainData().Groups.map(g => g.CustomGroupId + ':' + g.Status).join(',')
    === 'C0001:active,C0002:inactive,C0003:inactive,C0004:inactive,C0005:inactive');
  p.win.OneTrust.InsertScript('https://example.co.uk/maps.js', 'head', null, null, 'C0003');
  p.win.OneTrust.InsertScript('https://example.co.uk/core.js', 'head', null, null, 'C0001');
  check('InsertScript only loads scripts for groups that are on', JSON.stringify(p.inserted) === '["https://example.co.uk/core.js"]', JSON.stringify(p.inserted));
}

/* 2. A choice the person already made is kept. */
{
  const accepted = 'isGpcEnabled=0&interactionCount=2&groups=' + encodeURIComponent('C0001:1,C0002:1,C0003:0');
  const p = page({ cookies: { OptanonConsent: accepted, OptanonAlertBoxClosed: '2026-10-01T10:00:00.000Z' } });
  check('an earlier choice is not overwritten', p.writes.length === 0 && p.jar.get('OptanonConsent').value === accepted);
  check('the page sees that choice', p.win.OnetrustActiveGroups === ',C0001,C0002,');
  check('no refusal is announced or sent to consent mode', !p.events.includes('document:wardenone-onetrust-answered') && p.gtagCalls.length === 0);
}

/* 3. An unanswered cookie from an earlier visit: the site's own groups. */
{
  const preChoice = 'groups=' + encodeURIComponent('s00:1,m03:1,f00:0,t00:0');
  const p = page({ cookies: { OptanonConsent: preChoice } });
  check('the site\'s always-active groups stay on, optional ones off', /groups=s00:1,m03:1,f00:0,t00:0(&|$)/.test(p.consent()), p.consent());
  const implied = 'groups=' + encodeURIComponent('C0001:1,C0002:1,C0004:1');
  const q = page({ cookies: { OptanonConsent: implied } });
  check('implied consent (every group on before a choice) is refused', /groups=C0001:1,C0002:0,C0004:0(&|$)/.test(q.consent()), q.consent());
}

/* 4. Accepting needs a person's click. */
{
  const p = page();
  let heard = 0;
  p.win.OneTrust.OnConsentChanged(() => heard++);
  p.win.OneTrust.AllowAll();
  check('a script calling AllowAll on its own changes nothing', p.win.OnetrustActiveGroups === ',C0001,' && WOConsentState.rejected('onetrust', p.consent()) && heard === 0);
  p.win.navigator.userActivation.isActive = true;
  p.win.OneTrust.AllowAll();
  check('a real click on the site\'s own accept is honoured', p.win.OnetrustActiveGroups === ',C0001,C0002,C0003,C0004,C0005,'
    && /groups=C0001:1,C0002:1/.test(p.consent()) && heard === 1);
  p.win.OneTrust.RejectAll(); p.win.OneTrust.ToggleInfoDisplay(); p.win.OneTrust.Close();
  check('the other calls a site makes are answered without throwing', true);
}

/* 5. OneTrust's real SDK already on the page is left alone. */
{
  const real = { IsAlertBoxClosed: () => false };
  const p = page({ oneTrust: real });
  check('a real OneTrust is not replaced', p.win.OneTrust === real && p.writes.length === 0 && p.win.OnetrustActiveGroups === undefined);
}

/* 6. A site on a plain domain and one on a host with no registrable parent. */
{
  const p = page({ host: 'stackoverflow.com' });
  check('a .com site gets the cookie on its own domain', p.jar.get('OptanonConsent').domain === 'stackoverflow.com');
  const q = page({ host: 'localhost' });
  check('a single-label host gets a host-only cookie', q.jar.get('OptanonConsent') && q.jar.get('OptanonConsent').domain === '');
}

/* 7. The worker's rule, as it ships. */
(async () => {
  const from = BG.indexOf('/* While automatic refusal is on'), to = BG.indexOf('let __headerShieldDesired', from);
  check('the worker rule is where the slice expects it', from > 0 && to > from);
  const lift = (start, endMarker) => { const a = BG.indexOf(start); const b = BG.indexOf(endMarker, a) + endMarker.length; return a > 0 && b > a ? BG.slice(a, b) : ''; };
  const excludeRe = lift('const CONSENT_REJECT_EXCLUDE_RE', ';\n');
  const hostedApps = lift('const FINGERPRINT_HOSTED_APP_MATCHES', "'/*')];");
  check('the consent-reject exclusions and hosted apps lift', !!excludeRe && !!hostedApps);
  const writes = [];
  const box = { ONETRUST_ANSWER_RULE_ID: 900013, console: { warn() {} },
    activeAllowlist: (cfg) => (cfg.allowlist || []).slice(),
    normalizeSiteHost: (v) => String(v || '').toLowerCase().replace(/^\*\./, '').replace(/^www\./, ''),
    writeSessionRules: async (change) => { writes.push(JSON.parse(JSON.stringify(change))); } };
  vm.createContext(box);
  vm.runInContext(excludeRe + hostedApps + BG.slice(from, to)
    + '\nthis.apply = applyOneTrustAnswerRule; this.excluded = oneTrustAnswerExcludedDomains; this.STUB = ONETRUST_STUB_RE;', box);

  const cfg = { allowlist: ['paused.example'], siteOverrides: {
    'reader-off.example': { autoRejectConsent: false }, 'site-off.example': { enabled: false }, 'other.example': { removeOverlays: false } } };
  const excluded = box.excluded(cfg);
  for (const host of ['accounts.google.com', 'login.microsoftonline.com', 'paypal.com', 'stripe.com', 'docs.google.com', 'okta.com',
    'shopify.com', 'ac.uk', 'edu', 'paused.example', 'reader-off.example', 'site-off.example']) {
    check('OneTrust loads as before on ' + host, excluded.includes(host));
  }
  check('a site with some other switch off still gets the answer', !excluded.includes('other.example'));

  await box.apply(excluded);
  const rule = writes[0] && writes[0].addRules[0];
  check('one session rule replaces only its own id', writes.length === 1 && JSON.stringify(writes[0].removeRuleIds) === '[900013]' && writes[0].addRules.length === 1);
  check('it redirects to the packaged stand-in', rule && rule.action.type === 'redirect' && rule.action.redirect.extensionPath === '/surrogates/onetrust.js');
  const neverBlock = Number((/action: \{ type: 'allow' \},\s*condition: \{ requestDomains: domains\.slice/.test(BG)
    && /priority: (\d+),\s*action: \{ type: 'allow' \},\s*condition: \{ requestDomains: domains\.slice/.exec(BG) || [])[1]);
  const policy = read('network-policy.js');
  const securityMin = Number((/securityMin = (\d+)/.exec(policy) || [])[1]);
  check('it outranks the consent-manager allow and stays under the security lists', rule && neverBlock === 1900
    && rule.priority > neverBlock && rule.priority < securityMin, rule && rule.priority + ' vs ' + neverBlock + '/' + securityMin);
  check('scripts fetched with GET only', rule && JSON.stringify(rule.condition.resourceTypes) === '["script"]'
    && JSON.stringify(rule.condition.requestMethods) === '["get"]');
  check('the paused sites ride on the rule', rule && JSON.stringify(rule.condition.excludedInitiatorDomains) === JSON.stringify(excluded));
  /* Chrome drops a regex rule that compiles past 2 KB; a counted repeat ({36}) did exactly that (2026-11-21, checked live
     with isRegexSupported). Keep the pattern free of counted repeats and short. */
  check('the pattern stays inside Chrome\'s regex budget', rule && !/\{\d/.test(rule.condition.regexFilter) && rule.condition.regexFilter.length < 140,
    rule && rule.condition.regexFilter);
  const re = new RegExp(rule.condition.regexFilter);
  for (const url of ['https://cdn.cookielaw.org/scripttemplates/otSDKStub.js',
    'https://cdn.cookielaw.org/consent/0190a3f4-1234-7abc-9def-0123456789ab/otSDKStub.js',
    'https://cookie-cdn.cookiepro.com/scripttemplates/otSDKStub.js?did=abc']) check('answers ' + url, re.test(url));
  for (const url of ['https://cdn.cookielaw.org/scripttemplates/202604.2.0/otBannerSdk.js',
    'https://cdn.cookielaw.org/consent/0190a3f4-1234-7abc-9def-0123456789ab/OtAutoBlock.js',
    'https://edition.cnn.com/wbdotp/scripttemplates/otSDKStub.js',
    'https://cdn.cookielaw.org.evil.example/scripttemplates/otSDKStub.js',
    'http://cdn.cookielaw.org/scripttemplates/otSDKStub.js']) check('leaves alone ' + url, !re.test(url));
  await box.apply(excluded);
  check('an unchanged state writes nothing', writes.length === 1);
  await box.apply(null);
  check('refusal off removes the rule', writes.length === 2 && writes[1].addRules.length === 0 && JSON.stringify(writes[1].removeRuleIds) === '[900013]');

  /* Wiring. */
  check('the settings pass applies it from the refusal switch',
    BG.includes("run('oneTrustAnswer', () => applyOneTrustAnswerRule(consentRejectActive(cfg) ? oneTrustAnswerExcludedDomains(cfg) : null));"));
  check('startup applies it too (session rules do not survive a restart)',
    BG.includes('applyOneTrustAnswerRule(consentRejectActive(cfg) ? oneTrustAnswerExcludedDomains(cfg) : null);\n      applyThirdPartyCookieRule'));
  const serialized = (BG.match(/const SERIALIZED_STATE_APPLIERS = \[([\s\S]*?)\];/) || [])[1] || '';
  check('its writes are serialized', serialized.includes("'applyOneTrustAnswerRule'"));
  const manifest = JSON.parse(read('manifest.json'));
  check('the stand-in is web accessible with a dynamic URL', manifest.web_accessible_resources.some(e => e.use_dynamic_url === true
    && e.resources.includes('surrogates/onetrust.js')));
  check('it is packaged', JSON.parse(read('tools/package-allowlist.json')).includes('surrogates/onetrust.js'));
  check('Repair counts it as a core file', /'surrogates\/urchin\.js', 'surrogates\/onetrust\.js'\)/.test(BG));

  /* consent-reject.js reports the local answer, verified against the saved cookie. */
  check('consent-reject.js listens for the local answer', REJECT.includes("woOn(document, 'wardenone-onetrust-answered'"));
  check('and verifies it with OneTrust\'s own state before calling it a refusal',
    /WOConsentState\.rejected\('onetrust', consentCookie\(profile\)\)/.test(REJECT) && /reportOutcome\(saved \? 'rejected' : 'dispatched'/.test(REJECT));

  console.log(`onetrust-answer: ${passed} passed, ${failed} failed`);
  if (failed) process.exit(1);
})();

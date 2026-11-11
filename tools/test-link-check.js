/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');
const source = fs.readFileSync('background-link-check.js', 'utf8');
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function harness(timeoutMs) {
  const opened = [], notices = [], requested = [];
  const context = { URL, URLSearchParams, crypto: webcrypto, setTimeout, clearTimeout,
    DEFAULT_CONFIG: { enabled: true }, SECURITY_DOMAINS: new Set(['listed.example.net']),
    GRABBER_PACKAGED_DOMAINS: new Set(), GRABBER_FEED_DOMAINS: new Set(), LEARNED: {},
    locallyBlockedReputationHost: async () => '',
    isLocalOrPrivateHost: host => host === 'localhost' || host === '127.0.0.1',
    localGet: async () => ({ wardenone_config: { enabled: true } }),
    urlReputationConfig: async () => ({ enabled: false }),
    normalizeSafeBrowsingUrl: value => value,
    urlReputationLookupUrl: async value => { requested.push(value); return { ok: true, results: [{ provider: 'Fixture provider', ok: true, hit: false }] }; },
    lookupDomainAge: async () => ({ ok: true, ageDays: 18, created: '2026-10-18T00:00:00Z' }),
    wardenManualNotice: async (...args) => notices.push(args),
    messageSenderIsExtensionPath: (sender, path) => sender?.id === 'fixture' && sender.url?.startsWith('chrome-extension://fixture/' + path),
    chrome: { runtime: { getURL: path => 'chrome-extension://fixture/' + path },
      tabs: { create: async options => { opened.push(options); return { id: 80 + opened.length }; } } },
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync('domain-utils.js', 'utf8'), context);
  context.registrableDomainBg = context.registrableDomain;
  vm.runInContext(timeoutMs ? source.replace(/const MANUAL_LINK_CHECK_TIMEOUT_MS = \d+;/,
    'const MANUAL_LINK_CHECK_TIMEOUT_MS = ' + timeoutMs + ';') : source, context);
  const record = id => vm.runInContext(`MANUAL_LINK_REPORTS.get(${JSON.stringify(id)})`, context);
  const sender = (index = opened.length - 1) => ({ id: 'fixture', url: opened[index].url, frameId: 0, tab: { id: 81 + index } });
  const current = () => { const s = sender(); return { id: new URL(s.url).searchParams.get('id'), sender: s }; };
  return { context, opened, notices, requested, record, sender, current };
}
async function run() {
  const h = harness(), api = h.context;
  const tab = { id: 7, windowId: 4, title: 'Source page', url: 'https://github.com/iri-dev/WardenOne?token=SOURCE_SECRET#PRIVATE' };
  let facts = api.manualLinkFacts({ linkUrl: 'https://nfsu2.xyz/?access_token=TARGET_SECRET#PRIVATE' }, tab);
  assert.equal(facts.model.host, 'nfsu2.xyz');
  assert.match(facts.model.relation, /leaves github.com and goes to nfsu2.xyz/);
  assert(!JSON.stringify(facts.model).includes('SECRET'));
  assert(!facts.model.facts.some(row => row.level === 'danger'), 'a .xyz address alone is not a malware verdict');
  assert.equal(api.manualLinkFacts({}, tab).model.selection, 'page');
  assert.equal(api.manualLinkFacts({}, tab).model.host, 'github.com');
  const navigated = api.manualLinkFacts({ pageUrl: 'https://original.example.net/', linkUrl: 'https://nfsu2.xyz/' }, tab);
  assert.equal(navigated.model.page, 'https://original.example.net/', 'the clicked page remains authoritative when its tab has navigated');
  assert.equal(navigated.model.pageTitle, '', 'a newer page title cannot relabel the captured source');
  facts = api.manualLinkFacts({ linkUrl: 'http://github.com:secret@other.example.net/setup.exe' }, tab);
  assert.equal(facts.model.host, 'other.example.net');
  assert(facts.model.facts.filter(row => row.level === 'caution').length >= 3);
  assert(!facts.model.target.includes('secret'));
  for (const linkUrl of ['javascript:alert(1)', 'mailto:someone@example.net', 'https://example.net/' + 'a'.repeat(8200)]) {
    assert.equal(api.manualLinkFacts({ linkUrl }, tab).model.state, 'unavailable');
  }
  assert.match(api.manualLinkFacts({ linkUrl: 'https://a.github.io/' }, { url: 'https://b.github.io/' }).model.relation, /leaves/,
    'different hosted tenants are separate sites');
  assert.match(api.manualLinkFacts({ linkUrl: 'https://shop.example.net/' }, { url: 'https://www.example.net/' }).model.relation, /same site/);
  assert.match(api.manualLinkFacts({ frameUrl: 'https://frame.example.net/', linkUrl: 'https://nfsu2.xyz/' }, tab).model.relation, /leaves frame.example.net/);
  assert.equal((await api.manualLinkLocalChecks('listed.example.net'))[0].level, 'danger');
  api.LEARNED['user.example.net'] = { userBlocked: true };
  api.locallyBlockedReputationHost = async () => 'user';
  assert(!(await api.manualLinkLocalChecks('user.example.net')).some(row => row.level === 'danger'));
  api.locallyBlockedReputationHost = async () => '';
  assert.equal((await api.manualLinkReputation('https://nfsu2.xyz/'))[0].level, 'unavailable');
  api.urlReputationConfig = async () => ({ enabled: true, key: 'PRIVATE_KEY' });
  assert.equal((await api.manualLinkReputation('http://127.0.0.1/'))[0].level, 'unavailable');
  assert.equal(h.requested.length, 0, 'local addresses do not reach reputation providers');
  api.urlReputationLookupUrl = async () => ({ results: [
    { provider: 'Answered', ok: true, hit: false }, { provider: 'Offline', ok: false },
  ] });
  const rows = await api.manualLinkReputation('https://nfsu2.xyz/');
  assert.deepEqual(Array.from(rows, row => row.level), ['info', 'unavailable']);
  assert.match(rows[0].detail, /No match/);
  assert.equal((await api.manualLinkDomainAge('nfsu2.xyz', {}))[0].title, 'Domain registered 18 days ago');
  const timed = await api.manualLinkWithin(() => new Promise(() => {}), 'unavailable', 3);
  assert.equal(timed, 'unavailable', 'a provider that never settles cannot leave the result pending');
  let release;
  api.urlReputationLookupUrl = async () => new Promise(resolve => { release = resolve; });
  const running = api.runWardenLinkCheck({ linkUrl: 'https://nfsu2.xyz/' }, tab);
  await tick();
  assert.equal(h.opened.length, 1, 'the result tab opens before lookup completion');
  assert(h.opened[0].url.startsWith('chrome-extension://fixture/link-check.html?id='));
  assert.equal(h.opened[0].windowId, 4, 'the report stays in the source window');
  const request = h.current();
  let response = api.manualLinkCheckRead(request.id, request.sender, false);
  assert.equal(response.report.checking, true);
  assert.equal(response.report.checks.some(row => row.level === 'pending'), true);
  release({ results: [{ provider: 'Flagged fixture', ok: true, hit: true, threats: ['MALWARE'] }] });
  await running;
  response = api.manualLinkCheckRead(request.id, request.sender, false);
  assert.equal(response.report.state, 'danger');
  assert.equal(response.report.checking, false);
  assert.equal(response.report.pageTitle, 'Source page');
  assert(!JSON.stringify(response).includes('PRIVATE_KEY'));
  for (const invalid of [
    { ...request.sender, id: 'foreign' }, { ...request.sender, url: 'https://nfsu2.xyz/' },
    { ...request.sender, url: 'chrome-extension://fixture/popup.html?id=' + request.id },
    { ...request.sender, frameId: 1 }, { ...request.sender, tab: { id: 99 } },
    { ...request.sender, url: request.sender.url.replace(request.id, 'a'.repeat(36)) },
  ]) assert.equal(api.manualLinkCheckRead(request.id, invalid, false).ok, false, 'the private result is scoped to its own view');
  api.urlReputationLookupUrl = async () => ({ results: [{ provider: 'Offline', ok: false }] });
  for (let i = 0; i < 3; i++) {
    assert.equal(api.manualLinkCheckRead(request.id, request.sender, true).ok, true);
    while (h.record(request.id).running) await tick();
  }
  assert.equal(api.manualLinkCheckRead(request.id, request.sender, true).ok, false, 'retries are bounded');
  api.manualLinkEraseReports('nfsu2.xyz');
  assert.equal(api.manualLinkCheckRead(request.id, request.sender, false).ok, false, 'site erasure removes the report');
  await api.runWardenLinkCheck({ linkUrl: 'mailto:test@example.net' }, tab);
  const expired = h.current(); h.record(expired.id).at = 0;
  assert.equal(api.manualLinkCheckRead(expired.id, expired.sender, false).ok, false);
  for (let i = 0; i < 23; i++) await api.runWardenLinkCheck({ linkUrl: 'mailto:test@example.net' }, tab);
  assert.equal(vm.runInContext('MANUAL_LINK_REPORTS.size', api), 20, 'transient reports have a hard count cap');
  api.manualLinkEraseReports();
  assert.equal(vm.runInContext('MANUAL_LINK_REPORTS.size', api), 0);
  const frontend = fs.readFileSync('link-check.js', 'utf8');
  assert(!/innerHTML|insertAdjacentHTML|document\.write|localStorage|sessionStorage/.test(frontend));
  const bg = fs.readFileSync('background.js', 'utf8');
  const tabAllowlist = bg.slice(bg.indexOf('const TAB_CONTEXT_ALLOWED_MESSAGES'), bg.indexOf('const TAB_CONTEXT_RATE_LIMITS'));
  assert(!tabAllowlist.includes('manual-link-check-read') && !tabAllowlist.includes('manual-link-check-retry'));
  await reliability(bg, tab);
  console.log('[ok] contextual link reports, redaction, provider failures, progress, private view authority, retries and erasure');
}

async function reliability(bg, tab) {
  const h = harness(65), api = h.context;
  const start = bg.indexOf('function reputationTransientFailure(');
  const end = bg.indexOf('\nfunction safeBrowsingThreatLabel', start);
  Object.assign(api, {
    isTrustedPolicyReputationUrl: () => false, reputationResultPublic: value => value,
    shouldUsePhishTankForContext: () => true, shouldUseWhoisXmlReputationForContext: () => true,
    ipFromUrl: () => '',
  });
  vm.runInContext(bg.slice(start, end), api);
  const state = { enabled: true, cfg: { enabled: true, downloadSafeBrowsing: false },
    safeBrowsingEnabled: true, openPhishEnabled: true };
  api.urlReputationConfig = async () => state;
  let late;
  api.safeBrowsingLookupUrl = async (_url, opts) => {
    assert.equal(opts.cfg.downloadSafeBrowsing, true, 'requested manual checks use saved keys even when automatic checks are disabled');
    return { provider: 'Fast provider', ok: true, hit: true };
  };
  api.openPhishLookupUrl = () => new Promise(resolve => { late = resolve; });
  const running = api.runWardenLinkCheck({ linkUrl: 'https://nfsu2.xyz/' }, tab);
  await tick(); await tick();
  const { id, sender } = h.current();
  const response = api.manualLinkCheckRead(id, sender, false);
  assert.equal(response.report.state, 'danger', 'a completed warning is visible before other providers finish');
  assert.equal(response.report.checking, true, 'polling continues after an early warning');
  assert(response.report.checks.some(row => row.title === 'Fast provider' && row.level === 'danger'));
  assert(response.report.checks.some(row => row.title === 'OpenPhish' && row.level === 'pending'));
  await running;
  const completed = JSON.stringify(response.report);
  assert.equal(response.report.checking, false);
  assert(response.report.checks.some(row => row.title === 'Fast provider' && row.level === 'danger'));
  assert(response.report.checks.some(row => row.title === 'OpenPhish unavailable'));
  late({ provider: 'Late provider', ok: true }); await tick();
  assert.equal(JSON.stringify(response.report), completed, 'late providers cannot rewrite a timed-out report');
  assert.equal(state.cfg.downloadSafeBrowsing, false, 'manual checks do not change saved configuration');
  for (const failure of [
    { status: 503 }, { status: 408 }, { error: 'TypeError: Failed to fetch' },
    { status: 401 }, { status: 403 }, { status: 429 }, { status: 404 }, { error: 'Invalid JSON' },
  ]) {
    let attempts = 0;
    api.safeBrowsingLookupUrl = async () => ++attempts === 1 ? { provider: 'Retry fixture', ok: false, ...failure }
      : { provider: 'Retry fixture', ok: true };
    const retryable = api.reputationTransientFailure({ ok: false, ...failure });
    const verdict = await api.urlReputationLookupUrl('https://nfsu2.xyz/', { ...state, openPhishEnabled: false,
      context: 'manual', retryTransient: true, onResult: () => { throw Error('UI callback failed'); } });
    assert.equal(attempts, retryable ? 2 : 1, JSON.stringify(failure));
    assert.equal(verdict.ok, retryable);
  }
  let attempts = 0;
  api.safeBrowsingLookupUrl = async () => { attempts++; return { provider: 'Auto', ok: false, status: 503 }; };
  await api.urlReputationLookupUrl('https://nfsu2.xyz/', { ...state, openPhishEnabled: false, context: 'page', retryTransient: true });
  assert.equal(attempts, 1, 'automatic reputation checks retain their request budget');
  for (const [status, detail] of [[401, /API key/], [429, /request limit/], [503, /temporarily unavailable/]]) {
    const row = api.manualLinkProviderRow({ provider: 'Fixture', ok: false, status, error: 'PRIVATE_KEY' });
    assert.match(row.detail, detail); assert(!JSON.stringify(row).includes('PRIVATE_KEY'));
  }
  console.log('[ok] independent live provider results, stalled-provider preservation, late response isolation, transient retries and actionable failures');
}
run().catch(error => { console.error(error); process.exitCode = 1; });

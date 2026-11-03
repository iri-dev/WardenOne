/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '../..');
const WOLearner = require('../../tracker-learner-utils.js');
function create(options = {}) {
  const source = fs.readFileSync(options.background || path.join(ROOT, 'background.js'), 'utf8');
  const data = options.data || require('../build-tracker-network-data.js').build();
  const state = { local: options.local || {}, session: {}, writes: [], history: [], rules: [], frames: {}, cookies: {}, scriptValues: {}, scriptCalls: [], ruleWrites: 0, now: Date.UTC(2026, 9, 26), listeners: {} };
  const event = name => ({
    addListener(fn, filter, spec) { state.listeners[name] = { fn, filter, spec }; },
    removeListener(fn) { if (state.listeners[name]?.fn === fn) delete state.listeners[name]; },
    hasListener: fn => state.listeners[name]?.fn === fn,
  });
  let saltSequence = 0;
  const context = vm.createContext({ URL, console: { warn() {} }, Uint8Array, TextEncoder,
    crypto: { subtle: require('crypto').webcrypto.subtle, getRandomValues(bytes) { for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 17 + saltSequence) & 255; saltSequence++; return bytes; } },
    WOLearner, WO_TRACKER_NETWORK_DATA: data,
    Date: Object.assign(function (...args) { return args.length ? new Date(...args) : new Date(state.now); }, { now: () => state.now, parse: Date.parse, UTC: Date.UTC }),
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true }, TRACKER_RULES_BUDGET: 1000,
    LOGIN_COMPAT_NEVER_BLOCK_DOMAINS: ['accounts.google.com', 'stripe.com', 'paypal.com'],
    localGet: async key => ({ [key]: state.local[key] }),
    localSet: async value => { if (state.rejectStorage) throw new Error('Storage unavailable'); state.writes.push(JSON.parse(JSON.stringify(value))); Object.assign(state.local, JSON.parse(JSON.stringify(value))); },
    queueHistory: entry => state.history.push(JSON.parse(JSON.stringify(entry))),
    activeAllowlist: cfg => cfg.allowlist || [], normalizeAllowlistHost: value => context.WOCname.normalizeHost(value),
    hostMatchesAllowlist: (host, list) => list.some(domain => host === domain || host.endsWith('.' + domain)),
    hostMatchesSite: (host, domain) => host === domain || host.endsWith('.' + domain),
    getDynamicRulesInBand: async () => state.rules,
    dnrBandUnchanged: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    writeDynamicRules: async change => { if (state.rejectNative) throw new Error('Native update rejected'); state.ruleWrites++; state.rules = change.addRules; },
    INCOGNITO_CONTEXT: false,
    trackerCookieCompatibility: cfg => ({ ...((cfg.allowlist || []).length ? { excludedInitiatorDomains: [...cfg.allowlist].sort() } : {}), excludedRequestDomains: ['accounts.google.com'] }),
    loadKnownAliases: async () => context.WOCname.validateData(JSON.parse(fs.readFileSync(path.join(ROOT, 'cname-trackers.json')))),
    resolveKnownAlias: host => context.WOCname.resolve(context.mapping, host, 'fixture'),
    isMediaCompatDomain: host => /(^|\.)(youtube\.com|googlevideo\.com|twitch\.tv|ttvnw\.net)$/.test(host),
    sessionMirror: (key, snapshot, restore) => {
      let ready;
      return { ready: () => (ready ||= Promise.resolve().then(() => restore(state.session[key]))),
        persist: () => { state.session[key] = JSON.parse(JSON.stringify(snapshot())); } };
    },
    chrome: { runtime: { getManifest: () => ({ host_permissions: ['<all_urls>'] }) },
      cookies: { getAll: async query => JSON.parse(JSON.stringify(state.cookies[query.domain || new URL(query.url).hostname] || [])) },
      scripting: { executeScript: async query => { state.scriptCalls.push(query); return state.executeScript ? state.executeScript(query) : state.scriptValues[query.target.documentIds[0]] || []; } },
      storage: { local: { get: (key, callback) => callback({ [key]: state.local[key] }) } },
      webNavigation: { getFrame: async query => state.frames[query.tabId + ':' + query.frameId], onCompleted: event('onCompleted') },
      webRequest: { onBeforeRequest: event('onBeforeRequest'), onHeadersReceived: event('onHeadersReceived') } },
  });
  for (const file of ['domain-utils.js', 'psl-private.js', 'cname-utils.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context);
  context.WOCname = vm.runInContext('WOCname', context);
  context.mapping = context.WOCname.validateData(JSON.parse(fs.readFileSync(path.join(ROOT, 'cname-trackers.json'))));
  const constants = source.slice(source.indexOf('const TRACKER_LEARNER_KEY ='), source.indexOf('let TRACKER_LEARNER ='));
  const code = source.slice(source.indexOf('function normalizeTrackerDomain('), source.indexOf('// In-memory set of known-bad domains'));
  vm.runInContext('function registrableDomainBg(host){return registrableDomain(host)};function siteIdentityBg(host){return siteIdentity(host)};\n'
    + constants + '\nlet TRACKER_LEARNER={domains:{},siteControls:{}};let __initTrackerLearner=null;\n' + code
    + '\nthis.api={note:noteTrackerObservation,load:loadTrackerLearner,proposals:trackerLearnerProposals,decide:decideTrackerProposal,'
    + 'learner:()=>TRACKER_LEARNER,shape:trackerStoreShape,network:typeof noteTrackerNetworkRequest===\'function\'?noteTrackerNetworkRequest:null,'
    + 'page:typeof noteTrackerPageObservation===\'function\'?noteTrackerPageObservation:null,status:trackerLearnerStatus,setMode:setTrackerLearnerSiteMode,clear:clearTrackerLearnerObservations,'
    + 'restart:()=>{__trackerSession=null;__initTrackerLearner=null;},'
    + 'cookieRequest:typeof noteTrackerCookieRequest===\'function\'?noteTrackerCookieRequest:null,rules:applyTrackerLearnerRules,'
    + 'setCookie:typeof trackerSetCookieEvidence===\'function\'?trackerSetCookieEvidence:null,'
    + 'storage:noteTrackerStorageFrame,canvas:noteTrackerCanvasObservation,identifierRequest:noteTrackerIdentifierRequest,'
    + 'observe:typeof reconcileTrackerCookieObserver===\'function\'?reconcileTrackerCookieObserver:null,'
    + 'listeners:{jar:typeof trackerCookieListener===\'function\'?trackerCookieListener:null,header:typeof trackerSetCookieListener===\'function\'?trackerSetCookieListener:null},'
    + 'decideAll:decideAllTrackerProposals,history:trackerLearnerHistory,save:saveTrackerLearner,forgetCookieVerdicts:()=>{TRACKER_COOKIE_SITES.clear();TRACKER_COOKIE_SEEN.clear();}};', context);
  return { state, context, api: context.api, browserRestart() { state.session = {}; context.api.restart(); },
    async cookieRequest(site, host, overrides = {}) {
      state.frames['1:0'] = { url: 'https://' + site + '/', documentId: 'doc-' + site, parentFrameId: -1, documentLifecycle: 'active' };
      return context.api.cookieRequest({ tabId: 1, frameId: 0, documentId: 'doc-' + site, initiator: 'https://' + site,
        url: 'https://' + host + '/pixel', type: 'image', ...overrides });
    },
    /* A response from `host` on `site` that carries these Set-Cookie headers; the jar is untouched,
       as it is when third-party cookie blocking strips them. */
    async setCookieResponse(site, host, headers, overrides = {}) {
      state.frames['1:0'] = { url: 'https://' + site + '/', documentId: 'doc-' + site, parentFrameId: -1, documentLifecycle: 'active' };
      return context.api.setCookie({ tabId: 1, frameId: 0, documentId: 'doc-' + site, initiator: 'https://' + site,
        url: 'https://' + host + '/pixel', type: 'image', responseHeaders: [].concat(headers).map(value => ({ name: 'Set-Cookie', value })), ...overrides });
    },
    async network(site, host, overrides = {}) {
      state.frames['1:0'] = { url: 'https://' + site + '/', documentId: 'doc-' + site, parentFrameId: -1, documentLifecycle: 'active' };
      return context.api.network({ tabId: 1, frameId: 0, documentId: 'doc-' + site, initiator: 'https://' + site,
        url: 'https://' + host + '/fixture', type: 'xmlhttprequest', ...overrides });
    } };
}
module.exports = { create };

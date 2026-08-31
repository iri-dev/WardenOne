/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Streaming-site compatibility regressions.
 *
 * The full MAIN-world engine is intentionally top-frame-only. Subframes keep
 * the lightweight redirect guard, while tracker learning, scriptlets and the
 * overlay cleaner must not turn player infrastructure into collateral damage.
 *
 * Run: node tools/test-streaming-compatibility.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const resourceTypes = require('./lib/resource-types.js');
// Lifted engine fragments can reference the engine's shared helpers (woOn and the
// observer/timer factories). A fragment only sees what its sandbox provides, so those are
// installed as shims before the slice runs -- see tools/lib/engine-ambient.js.
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sourceBetween(source, start, end) {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  assert(from !== -1, 'missing source marker: ' + start);
  assert(to !== -1, 'missing source marker: ' + end);
  return source.slice(from, to);
}

function loadPlayerCompatibility(pathname, pageMarker) {
  const sandbox = {
    location: { pathname: pathname || '/' },
    document: {
      querySelector(selector) {
        return pageMarker && String(selector).split(',').includes(pageMarker) ? {} : null;
      },
    },
  };
  const snippet = sourceBetween(CONTENT, 'const PLAYER_ROUTE_RE=', '\n    !function(){');
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    snippet
      + '\nthis.__playerCompatibility = {'
      + ' PLAYER_FRAMEWORK_SHELL_SELECTOR, PLAYER_SHELL_SELECTOR, PLAYER_PAGE_SELECTOR,'
      + ' playerShellFor, playerFrameworkShellFor, playerPageDetected'
      + ' };',
    sandbox,
  );
  return sandbox.__playerCompatibility;
}

function loadHiddenMediaBlockReason() {
  const media = sourceBetween(
    CONTENT,
    '!1!==WO.blockAutoplayMedia&&!trustedMediaHost&&window.HTMLMediaElement',
    'if(!0===WO.blockSuspiciousWebRTC',
  );
  const declarations = sourceBetween(media, 'isMediaElement=el=>', 'mediaDetail=')
    .trim()
    .replace(/,\s*$/, '');
  const player = loadPlayerCompatibility('/', '');
  const sandbox = {
    document: { readyState: 'complete' },
    getComputedStyle() {
      return { display: 'none', visibility: 'hidden', opacity: '0' };
    },
    playerShellFor: player.playerShellFor,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    'const ' + declarations + '; this.__playBlockReason = playBlockReason;',
    sandbox,
  );
  return sandbox.__playBlockReason;
}

function arrayConstant(source, name) {
  const match = source.match(new RegExp('const\\s+' + name + '\\s*=\\s*(\\[[\\s\\S]*?\\]);'));
  assert(match, 'missing array constant: ' + name);
  return Array.from(vm.runInNewContext(match[1]));
}

function loadCosmeticComputer() {
  const sandbox = {
    __cosmeticHostCache: new Map(),
    COSMETIC_HOST_CACHE_MAX: 256,
    normalizeAllowlistHost: (value) => String(value || '').toLowerCase(),
    hostMatchesAllowlist: () => false,
    isVideoPlatformHost: () => false,
    isXPlatformHost: () => false,
    hostMatchesCosmeticDomainList: () => false,
    isSafeVideoPlatformCosmeticSelector: () => true,
    scriptletMayRunOnHost: () => true,
    Set,
    Map,
    Array,
    Object,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween(BACKGROUND, 'function computeCosmeticForHost', '\n// Dynamic rule IDs')
      + '\nthis.__compute = computeCosmeticForHost;',
    sandbox,
  );
  return sandbox.__compute;
}

function mutationHeavyCosmeticMemory(host) {
  return {
    cfg: { adShield: true, scriptletEngine: true },
    allow: [],
    data: {
      generic: ['.generic-ad-slot'],
      specific: { [host]: ['.site-ad-slot'] },
      exceptions: {},
      genericHideExclusions: [],
      procedural: { [host]: ['#player-shell:remove()'] },
      scriptlets: {
        '*': [
          { name: 'no-window-open-if', args: ['popads'] },
          { name: 'no-fetch-if', args: ['ads'] },
        ],
        [host]: [
          { name: 'json-prune', args: ['adPlacements'] },
          { name: 'remove-class', args: ['jwplayer'] },
        ],
      },
    },
  };
}

function loadRemoteRulePriorityHelpers() {
  /* Was a pasted copy of the list, which went stale the moment the shipped
     list changed and kept passing anyway. Take the real declarations. */
  const sandbox = {};
  vm.runInNewContext(resourceTypes.prelude() + '; Object.assign(this, { ' + Object.keys(resourceTypes.resolveAll()).map((n) => n + ': ' + n).join(', ') + ' });', sandbox);
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween(BACKGROUND, 'function domainToRule', '\nfunction isWardenOneDynamicRuleId')
      + '\nthis.__priorityApi = {'
      + ' domainToRule,'
      + ' finalizeOptionRule: typeof finalizeOptionRule === "function" ? finalizeOptionRule : null'
      + ' };',
    sandbox,
  );
  return sandbox.__priorityApi;
}

function loadRemoteSourceKindHelper() {
  const sandbox = { Object };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween(BACKGROUND, 'const REMOTE_SOURCE_KIND_RANK', '\nfunction prioritizedDomainRuleDomains')
      + '\nthis.__strongestSourceKind = strongestRemoteListSourceKind;',
    sandbox,
  );
  return sandbox.__strongestSourceKind;
}

function loadRepairFileSelector() {
  const sandbox = {
    URL,
    String,
    Number,
    isYouTubeFrameUrl: () => false,
    isMainWorldRepairExcludedUrl: () => false,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween(BACKGROUND, 'function repairMainWorldFilesForUrl', '\nfunction getRepairFramesForTab')
      + '\nthis.__selectRepairFiles = repairMainWorldFilesForUrl;',
    sandbox,
  );
  return sandbox.__selectRepairFiles;
}

async function observeTracker(detail) {
  const state = {
    learner: { domains: {}, siteControls: {} },
    saves: 0,
    history: [],
  };
  const normalize = (value) => {
    let host = String(value || '').toLowerCase();
    try { if (host.includes('://')) host = new URL(host).hostname; } catch (_) {}
    host = host.replace(/^www\./, '');
    const labels = host.split('.').filter(Boolean);
    return labels.length > 2 ? labels.slice(-2).join('.') : labels.join('.');
  };
  const sandbox = {
    DEFAULT_CONFIG: { enabled: true, trackerLearner: true },
    TRACKER_LEARN_MIN_HITS: 3,
    TRACKER_LEARN_MIN_SITES: 3,
    TRACKER_LEARNER: state.learner,
    localGet: async () => ({ wardenone_config: { enabled: true, trackerLearner: true } }),
    normalizeTrackerDomain: normalize,
    isProtectedTrackerDomain: () => false,
    loadTrackerLearner: async () => state.learner,
    trackerDistinctSiteCount: (entry) => Object.keys((entry && entry.sites) || {}).length,
    looksLikeKnownTrackerHost: () => false,
    queueHistory: (entry) => state.history.push(entry),
    saveTrackerLearner: async () => { state.saves++; },
    Date,
    URL,
    Object,
    String,
    Number,
    Math,
  };
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(
    sourceBetween(BACKGROUND, 'async function noteTrackerObservation', '\nasync function trackerLearnerStatus')
      + '\nthis.__observe = noteTrackerObservation;',
    sandbox,
  );
  await sandbox.__observe('https://stream.example/watch/1', detail || {});
  return state;
}

function loadOverlayClassifier() {
  const player = loadPlayerCompatibility('/', '');
  const sandbox = {
    mediaRectState: null,
    mediaRects: null,
    mediaHitFor: null,
    fakeNotifyVisual: null,
    overlayCandidate: null,
    hasLoginUi: null,
    isOverlay: null,
    seen: new WeakSet(),
    PROTECT: /(password|sign[\s-]?in|checkout|payment)/i,
    AD_SIGNAL: /(advertisement|sponsored|ad\s*choices|skip ad)/i,
    NUISANCE: /(cookie|consent|subscribe|adblock)/i,
    BAIT_SIGNAL: /(notification|download now|watch now)/i,
    innerWidth: 1280,
    innerHeight: 720,
    Date,
    Math,
    Number,
    parseInt,
    parseFloat,
    Set,
    WeakSet,
    Array,
    PLAYER_SHELL_SELECTOR: player.PLAYER_SHELL_SELECTOR,
    playerShellFor: player.playerShellFor,
    playerFrameworkShellFor: player.playerFrameworkShellFor,
    document: {
      body: {},
      documentElement: {},
      querySelectorAll() { return []; },
    },
    getComputedStyle(node) {
      return node._style || {
        display: 'block',
        visibility: 'visible',
        opacity: '1',
        position: 'fixed',
        zIndex: '100',
        borderRadius: '0',
        backgroundColor: 'rgb(20,20,20)',
        cursor: 'pointer',
      };
    },
  };
  const snippet = sourceBetween(CONTENT, 'mediaRectState={', 'CONTINUE_TEXT=');
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(snippet + 'null; this.__classify = isOverlay;', sandbox);
  assert.strictEqual(typeof sandbox.__classify, 'function', 'overlay classifier was not exposed');
  return sandbox.__classify;
}

function overlayNode(tag) {
  return {
    nodeType: 1,
    tagName: String(tag || 'div').toUpperCase(),
    id: '',
    className: 'player-ad-overlay',
    innerText: 'Advertisement - skip ad',
    textContent: 'Advertisement - skip ad',
    onclick: null,
    parentElement: null,
    _style: {
      display: 'block',
      visibility: 'visible',
      opacity: '1',
      position: 'fixed',
      zIndex: '100',
      borderRadius: '0',
      borderTopLeftRadius: '0',
      borderTopRightRadius: '0',
      borderBottomLeftRadius: '0',
      borderBottomRightRadius: '0',
      backgroundColor: 'rgb(20,20,20)',
      cursor: 'pointer',
    },
    getAttribute(name) { return name === 'role' && this.tagName === 'BUTTON' ? 'button' : null; },
    getBoundingClientRect() {
      return { left: 450, top: 300, right: 830, bottom: 400, width: 380, height: 100 };
    },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    matches(selector) {
      const s = String(selector || '').toLowerCase();
      return s.split(',').some((part) => part.trim().replace(/\[.*$/, '').toUpperCase() === this.tagName)
        || (this.tagName === 'BUTTON' && s.includes('[role="button"]'));
    },
    closest() { return null; },
  };
}

function frameworkOverlayNode(frameworkSelector) {
  const node = overlayNode('div');
  node.className = String(frameworkSelector || '').replace(/^\./, '');
  node.closest = (selector) => String(selector || '').split(',').includes(frameworkSelector) ? node : null;
  return node;
}

function hiddenVideoNode(frameworkSelector) {
  const node = {
    tagName: 'VIDEO',
    hidden: true,
    controls: false,
    hasAttribute() { return false; },
    getBoundingClientRect() {
      return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 };
    },
    closest(selector) {
      return frameworkSelector && String(selector || '').split(',').includes(frameworkSelector)
        ? { className: frameworkSelector.replace(/^\./, '') }
        : null;
    },
  };
  return node;
}

test('manifest keeps the full engine top-frame-only and anti-redirect all-frames', () => {
  const scripts = Array.from(MANIFEST.content_scripts || []);
  const fullEntries = scripts.filter((entry) => Array.from(entry.js || []).includes('content.min.js'));
  assert(fullEntries.length > 0, 'manifest no longer registers content.min.js');
  assert(fullEntries.every((entry) => entry.all_frames === false),
    'content.min.js must never run in subframes');

  const redirectEntries = scripts.filter((entry) => Array.from(entry.js || []).includes('anti-redirect.js'));
  assert(redirectEntries.length > 0, 'manifest no longer registers anti-redirect.js');
  assert(redirectEntries.every((entry) => entry.all_frames === true),
    'anti-redirect.js must remain the lightweight all-frame guard');
  assert(!scripts.some((entry) => {
    const files = Array.from(entry.js || []);
    return files.includes('content.min.js') && files.includes('anti-redirect.js');
  }), 'full engine and all-frame redirect guard were coupled into one registration');
});

test('repair selects the full engine only for frame zero', () => {
  const selectRepairFiles = loadRepairFileSelector();
  const url = 'https://stream.example/embed/episode';
  const topFiles = Array.from(selectRepairFiles(url, 0) || []);
  const childFiles = Array.from(selectRepairFiles(url, 7) || []);
  assert(topFiles.includes('content.min.js'), 'top-frame repair no longer restores the full engine');
  assert.deepStrictEqual(childFiles, ['domain-utils.js', 'anti-redirect.js'],
    'child-frame repair must contain only the shared identity helper and lightweight redirect guard');

  const repair = sourceBetween(BACKGROUND, '// 5. re-inject', '\n      sendResponse(report);');
  assert(/repairMainWorldFilesForUrl\(frameUrl,\s*frameId\)/.test(repair),
    'repair loop does not pass the real frame id to its file selector');
});

test('ambiguous learned tracker rules cannot block player frames or scripts', () => {
  const types = arrayConstant(BACKGROUND, 'TRACKER_RESOURCE_TYPES');
  assert(!types.includes('sub_frame'), 'ambiguous tracker learning can block a player iframe');
  assert(!types.includes('script'), 'ambiguous tracker learning can block a player script bundle');
  assert(types.includes('image') || types.includes('ping') || types.includes('xmlhttprequest'),
    'tracker learner lost all bounded observation resource types');
});

test('scoped ad/tracker exceptions cannot outrank security blocks', () => {
  const api = loadRemoteRulePriorityHelpers();
  assert.strictEqual(typeof api.domainToRule, 'function', 'missing source-aware domain rule helper');
  assert.strictEqual(typeof api.finalizeOptionRule, 'function', 'missing source-aware option rule finalizer');

  const scopedAllow = {
    action: { type: 'allow' },
    condition: {
      urlFilter: '||player-assets.example^',
      initiatorDomains: ['stream.example'],
      resourceTypes: ['script'],
    },
  };
  const scopedBlock = {
    action: { type: 'block' },
    condition: {
      urlFilter: '||player-assets.example^',
      initiatorDomains: ['stream.example'],
      resourceTypes: ['script'],
    },
  };

  const adHostBlock = api.domainToRule('player-assets.example', 1, 'adshield');
  const trackerHostBlock = api.domainToRule('player-assets.example', 2, 'tracker');
  const securityHostBlock = api.domainToRule('player-assets.example', 3, 'security');
  const adAllow = api.finalizeOptionRule(scopedAllow, 4, 'adshield');
  const trackerAllow = api.finalizeOptionRule(scopedAllow, 5, 'tracker');
  const securityAllow = api.finalizeOptionRule(scopedAllow, 6, 'security');
  const adOptionBlock = api.finalizeOptionRule(scopedBlock, 7, 'adshield');
  const trackerOptionBlock = api.finalizeOptionRule(scopedBlock, 8, 'tracker');

  assert.deepStrictEqual(Array.from(adAllow.condition.initiatorDomains || []), ['stream.example'],
    'AdShield exception was broadened beyond its initiating streaming site');
  assert.deepStrictEqual(Array.from(trackerAllow.condition.initiatorDomains || []), ['stream.example'],
    'tracker exception was broadened beyond its initiating streaming site');

  assert(adAllow.priority > adHostBlock.priority,
    'scoped AdShield allow cannot rescue a host-level ad block');
  assert(trackerAllow.priority > trackerHostBlock.priority,
    'scoped tracker allow cannot rescue a host-level tracker block');
  assert(securityHostBlock.priority > adAllow.priority && securityHostBlock.priority > trackerAllow.priority,
    'ad/tracker exception can override a security or malware host block');
  assert(securityAllow.priority > securityHostBlock.priority,
    'explicit scoped security exception cannot override its security host block');
  assert(adOptionBlock.priority > adHostBlock.priority,
    'scoped ad option block lost precedence over a broad ad host block');
  assert(trackerOptionBlock.priority > trackerHostBlock.priority,
    'scoped tracker option block lost precedence over a broad tracker host block');
  assert(adAllow.priority > adOptionBlock.priority && trackerAllow.priority > trackerOptionBlock.priority,
    'scoped ad/tracker allow does not outrank a conflicting scoped option block');
});

test('remote-list duplicates keep their strongest security classification', () => {
  const trackingFeed = 'https://raw.githubusercontent.com/blocklistproject/Lists/master/tracking.txt';
  const malwareFeed = 'https://ublockorigin.github.io/uAssets/filters/badware.txt';
  const remoteLists = arrayConstant(BACKGROUND, 'REMOTE_LISTS');
  const trackerLists = arrayConstant(BACKGROUND, 'TRACKER_LISTS');
  const malwareLists = arrayConstant(BACKGROUND, 'MALWARE_LISTS');
  const adShieldLists = arrayConstant(BACKGROUND, 'ADSHIELD_NET_LISTS');
  const strongest = loadRemoteSourceKindHelper();

  assert(!remoteLists.includes(trackingFeed),
    'tracking-only feed is still classified as a security blocklist');
  assert(trackerLists.includes(trackingFeed),
    'tracking feed is missing from the tracker source bucket');
  assert(malwareLists.includes(malwareFeed) && adShieldLists.includes(malwareFeed),
    'the duplicate security/AdShield regression fixture disappeared');
  assert.strictEqual(strongest('security', 'adshield'), 'security',
    'an AdShield duplicate can downgrade a security source');
  assert.strictEqual(strongest('tracker', 'adshield'), 'tracker',
    'an AdShield duplicate can downgrade a tracker source');
  assert.strictEqual(strongest('adshield', 'tracker'), 'tracker',
    'a tracker duplicate does not upgrade an AdShield source');
  assert.strictEqual(strongest('', 'adshield'), 'adshield',
    'a first-seen AdShield source is classified incorrectly');

  const sourceCollection = sourceBetween(BACKGROUND, 'const sources = [];', '\n  const sourceSetId =');
  assert(/sourceKinds\.set\(url,\s*strongestRemoteListSourceKind\(sourceKinds\.get\(url\),\s*kind\)\)/.test(sourceCollection),
    'remote source collection no longer preserves the strongest duplicate classification');
});

test('generic DOM resource URLs are observations only and never auto-learned', async () => {
  const generic = await observeTracker({
    domain: 'assets.player-vendor.example',
    host: 'assets.player-vendor.example',
    kind: 'resource',
    signal: 'resource-url',
  });
  assert.deepStrictEqual(Object.keys(generic.learner.domains), [],
    'generic script/iframe/resource URL was added to the tracker learner');

  const specific = await observeTracker({
    domain: 'metrics.player-vendor.example',
    host: 'metrics.player-vendor.example',
    kind: 'fetch',
    signal: 'tracking-path',
  });
  assert(Object.keys(specific.learner.domains).length === 1,
    'specific tracker evidence no longer reaches the candidate learner');
});

test('scriptlet collection honors scriptletEngine=false', () => {
  const compute = loadCosmeticComputer();
  const data = {
    generic: [],
    specific: {},
    exceptions: {},
    genericHideExclusions: [],
    procedural: {},
    scriptlets: { '*': [{ name: 'no-window-open-if', args: ['ad'] }] },
  };
  const disabled = compute('stream.example', {
    cfg: { adShield: true, scriptletEngine: false },
    allow: [],
    data,
  });
  assert.deepStrictEqual(Array.from(disabled.scriptlets || []), [],
    'background still served scriptlets while the feature was disabled');
});

test('player-page cosmetic responses omit every list-driven mutation and popup scriptlet', () => {
  const compute = loadCosmeticComputer();
  const host = 'embed.player.example';
  const player = compute(host, mutationHeavyCosmeticMemory(host), true);

  assert.deepStrictEqual(Array.from(player.selectors || []), [],
    'player mode still returned generic or domain-specific cosmetic selectors');
  assert.deepStrictEqual(Array.from(player.procedural || []), [],
    'player mode still returned procedural DOM mutations');
  assert.deepStrictEqual(Array.from(player.scriptlets || [], (entry) => entry.name), [],
    'player mode still returned a list popup matcher that can alter player control flow');
});

test('ordinary pages retain generic, specific, procedural and scriptlet protection', () => {
  const compute = loadCosmeticComputer();
  const host = 'ordinary.example';
  const ordinary = compute(host, mutationHeavyCosmeticMemory(host), false);

  assert.deepStrictEqual(Array.from(ordinary.selectors || []), ['.generic-ad-slot', '.site-ad-slot'],
    'ordinary-page cosmetic selectors were weakened by player compatibility');
  assert.deepStrictEqual(Array.from(ordinary.procedural || []), ['#player-shell:remove()'],
    'ordinary-page procedural protection was weakened by player compatibility');
  assert.deepStrictEqual(
    Array.from(ordinary.scriptlets || [], (entry) => entry.name),
    ['no-window-open-if', 'no-fetch-if', 'json-prune', 'remove-class'],
    'ordinary-page scriptlet protection was weakened by player compatibility',
  );
});

test('cosmetic memoization distinguishes player and ordinary responses for one host', () => {
  const compute = loadCosmeticComputer();
  const host = 'dual-mode.example';
  const mem = mutationHeavyCosmeticMemory(host);

  const ordinary = compute(host, mem, false);
  const player = compute(host, mem, true);
  const ordinaryAgain = compute(host, mem, false);

  assert(ordinary.selectors.length > 0 && ordinaryAgain.selectors.length > 0,
    'ordinary response was replaced by a player-mode cache entry');
  assert.deepStrictEqual(Array.from(player.selectors || []), [],
    'ordinary cached selectors leaked into a player response');
  assert.deepStrictEqual(Array.from(player.procedural || []), [],
    'ordinary cached procedural rules leaked into a player response');
  assert.deepStrictEqual(Array.from(player.scriptlets || [], (entry) => entry.name), [],
    'ordinary cached scriptlets leaked into a player response');
});

test('content requests carry player mode through to background cosmetic computation', () => {
  const requestAt = CONTENT.indexOf('kind:"adshield-cosmetic"');
  assert(requestAt !== -1, 'content cosmetic request is missing');
  const request = CONTENT.slice(Math.max(0, requestAt - 240), requestAt + 360);
  assert(/playerPage\s*:\s*scriptletPlayerPage\(\)/.test(request),
    'content cosmetic request does not identify a detected player page');

  const handler = sourceBetween(
    BACKGROUND,
    "if (msg && msg.kind === 'adshield-cosmetic' && msg.hostname)",
    '\n  // ---- AdShield: per-site allowlist',
  );
  assert(/msg\.playerPage/.test(handler)
    && /computeCosmeticForHost\(\s*msg\.hostname\s*,\s*mem\s*,/.test(handler),
  'background cosmetic handler does not pass player mode into computation');
});

test('page runtime checks scriptletEngine before executing served scriptlets', () => {
  const directGate = /runScriptlets=list=>\{\s*if\(!WO\.scriptletEngine\)return/.test(CONTENT);
  const callGate = /WO\.scriptletEngine\s*&&\s*runScriptlets\(res\.scriptlets\)/.test(CONTENT)
    || /if\(WO\.scriptletEngine\)[\s\S]{0,80}runScriptlets\(res\.scriptlets\)/.test(CONTENT);
  assert(directGate || callGate, 'served scriptlets execute without a runtime scriptletEngine gate');
});

test('network-mutating scriptlets fail open on player pages', () => {
  const scriptlets = sourceBetween(CONTENT, 'const SCRIPTLET_RAN=', '\n      scSweepers=[];');
  assert(/scriptletPlayerPage=\(\)=>/.test(scriptlets),
    'scriptlet runtime has no bounded player-page detector');
  assert(/scNoFetchIf=arg=>\{\s*if\(scriptletPlayerPage\(\)\)return/.test(scriptlets),
    'no-fetch-if still installs on a detected player page');
  assert(/scNoXhrIf=arg=>\{\s*if\(scriptletPlayerPage\(\)\)return/.test(scriptlets),
    'no-xhr-if still installs on a detected player page');
  assert(/networkScriptletRuntimeOn=\(\)=>pageMutationScriptletRuntimeOn\(\)/.test(scriptlets)
    && /pageMutationScriptletRuntimeOn=\(\)=>scriptletRuntimeOn\(\)&&!scriptletPlayerPage\(\)/.test(scriptlets),
    'installed network scriptlets do not dynamically fail open when a player appears');
  assert(/scNoWindowOpen=arg=>[\s\S]*?registry\.register[\s\S]*?if\(!pageMutationScriptletRuntimeOn\(\)\)return!1;/.test(scriptlets),
    'installed popup matchers do not dynamically fail open on player pages');
});

test('installed mutation scriptlets dynamically fail open after an SPA enters a player', () => {
  const scriptlets = sourceBetween(CONTENT, 'const SCRIPTLET_RAN=', '\n      parseProcedural=raw=>');
  assert(/pageMutationScriptletRuntimeOn=\(\)=>scriptletRuntimeOn\(\)&&!scriptletPlayerPage\(\)/.test(scriptlets),
    'scriptlet mutations do not share a dynamic player-page gate');
  for (const marker of [
    'get:()=>pageMutationScriptletRuntimeOn()?val:real',
    'if(pageMutationScriptletRuntimeOn())boom()',
    'if(!pageMutationScriptletRuntimeOn())return obj',
    'if(!pageMutationScriptletRuntimeOn())return;',
    'if(scriptletPlayerPage())continue',
  ]) {
    assert(scriptlets.includes(marker), 'missing SPA player fail-open marker: ' + marker);
  }
  assert(/registry\.register[\s\S]*?if\(!pageMutationScriptletRuntimeOn\(\)\)return!1;/.test(scriptlets),
    'popup matcher can remain active after an SPA enters a player route');
});

test('risky-site mode preserves functional player traffic', () => {
  const risky = sourceBetween(CONTENT, 'if(publicPage())try{', '\n    if(WO.antiClickjacking)');
  assert(/riskyPlayerPage=\(\)=>/.test(risky),
    'risky-site mode has no bounded player-page compatibility detector');
  const kinds = risky.match(/RISKY_PLAYER_KINDS=\/\^\(([^)]+)\)\$\//);
  assert(kinds, 'risky-site player resource allow set is missing');
  const allowed = kinds[1].split('|');
  for (const kind of ['script', 'frame', 'media', 'fetch', 'xhr', 'websocket']) {
    assert(allowed.includes(kind), 'risky-site mode can still break player ' + kind + ' traffic');
  }
  assert(!allowed.includes('beacon'), 'player compatibility disabled the tracker-beacon guard');
  assert(/RISKY_PLAYER_KINDS\.test\(String\(kind\|\|""\)\)&&riskyPlayerPage\(\)/.test(risky),
    'blockRisk does not apply the player-only compatibility boundary');
});

test('bounded player detection covers common framework shells', () => {
  const frameworks = [
    '.jwplayer', '.video-js', '.plyr', '.shaka-video-container',
    '.dplayer', '.art-video-player', '.clappr-container',
  ];
  const base = loadPlayerCompatibility('/library', '');
  assert(!/\[class\*=/i.test(base.PLAYER_FRAMEWORK_SHELL_SELECTOR),
    'framework compatibility uses an unsafe broad class substring');
  assert(!/\[class\*=/i.test(base.PLAYER_SHELL_SELECTOR),
    'generic player-shell compatibility uses an unsafe broad class substring');

  for (const framework of frameworks) {
    const page = loadPlayerCompatibility('/library', framework);
    assert.strictEqual(page.playerPageDetected(), true,
      framework + ' was not recognized as a player page');
    const node = hiddenVideoNode(framework);
    assert(page.playerShellFor(node), framework + ' was not recognized as a player shell');
    assert(page.playerFrameworkShellFor(node), framework + ' lost its exact framework boundary');
  }

  for (const route of ['/watch/1', '/episode-4', '/streams/live', '/embed/source']) {
    assert.strictEqual(loadPlayerCompatibility(route, '').playerPageDetected(), true,
      route + ' was not recognized as a bounded playback route');
  }
  assert.strictEqual(loadPlayerCompatibility('/account/settings', '.display-player-card').playerPageDetected(), false,
    'ordinary page content was mistaken for a supported player framework');
});

test('AdShield and scriptlet toggle changes force a clean page runtime', () => {
  const match = POPUP.match(/const\s+ACTIVE_TAB_RELOAD_TOGGLES\s*=\s*new Set\((\[[\s\S]*?\])\);/);
  assert(match, 'popup reload-toggle policy is missing');
  const reloadToggles = Array.from(vm.runInNewContext(match[1]));
  assert(reloadToggles.includes('adShield'), 'AdShield can leave one-way page mutations after being disabled');
  assert(reloadToggles.includes('scriptletEngine'), 'scriptlets can remain installed after their toggle is disabled');
});

test('background-tab throttling leaves trusted media hosts untouched', () => {
  // The policy moved into the shared const list near the top of the runtime, because the scam-lock
  // scanner needs it too and the old position left it in the temporal dead zone for that earlier
  // caller. It is therefore a list member rather than its own `const` statement now, so match the
  // assignment and wrap it to evaluate. Still lifted from real source, not restated here.
  const TAIL = '.test(location.hostname)';
  const declarationStart = CONTENT.indexOf('trustedMediaHost=/');
  const tailAt = CONTENT.indexOf(TAIL, declarationStart);
  const declarationEnd = tailAt === -1 ? -1 : tailAt + TAIL.length - 1;
  const throttleStart = CONTENT.indexOf('if(WO.throttleBackgroundTabs');
  assert(declarationStart !== -1 && declarationEnd !== -1,
    'trusted-media host policy is missing');
  assert(throttleStart > declarationEnd,
    'trusted-media host policy is declared after background throttling');
  assert(CONTENT.includes('if(WO.throttleBackgroundTabs&&!trustedMediaHost)try{'),
    'background throttling can still pause or RAF-throttle a trusted media host');

  const declaration = 'const ' + CONTENT.slice(declarationStart, declarationEnd + 1) + ';';
  const trusted = (hostname) => {
    const sandbox = { location: { hostname } };
    vm.createContext(sandbox);
  installEngineAmbient(sandbox);
    vm.runInContext(declaration + 'this.__trustedMediaHost=trustedMediaHost;', sandbox);
    return sandbox.__trustedMediaHost;
  };
  for (const hostname of ['twitch.tv', 'www.twitch.tv', 'video-edge.ttvnw.net', 'youtube.com']) {
    assert.strictEqual(trusted(hostname), true,
      hostname + ' was not recognized as a trusted media host');
  }
  assert.strictEqual(trusted('example.com'), false,
    'ordinary sites were accidentally exempted from background throttling');
});

test('overlay classifier never removes media, iframe or control nodes', () => {
  const isOverlay = loadOverlayClassifier();
  for (const tag of ['video', 'audio', 'iframe', 'embed', 'object', 'button', 'input', 'select', 'textarea']) {
    assert.strictEqual(isOverlay(overlayNode(tag)), false,
      tag + ' was classified as a removable overlay');
  }
});

test('overlay cleanup never removes supported framework infrastructure', () => {
  const isOverlay = loadOverlayClassifier();
  for (const framework of [
    '.jwplayer', '.video-js', '.plyr', '.shaka-video-container',
    '.dplayer', '.art-video-player', '.clappr-container',
  ]) {
    assert.strictEqual(isOverlay(frameworkOverlayNode(framework)), false,
      framework + ' infrastructure was classified as a removable ad overlay');
  }
  assert.strictEqual(isOverlay(overlayNode('div')), true,
    'ordinary high-confidence ad overlays stopped being removable');
});

test('overlay cleanup never takes ownership of body/html overflow', () => {
  /* End marker is an address, not an assertion -- it moved when the engine routed its listeners
     through woOn for teardown. */
  const overlay = sourceBetween(CONTENT, 'if(WO.removeOverlays', '\n    try{\n      woOn(window,"keydown"');
  assert(!/(?:document\.body|document\.documentElement)[\s\S]{0,160}(?:setProperty|removeProperty)\("overflow"/.test(overlay),
    'overlay cleanup mutates a global overflow lock it does not own');
  assert(!/(?:prevBodyOverflow|prevHtmlOverflow|restoreBodyOverflow|releaseModalLocks)/.test(overlay),
    'overlay cleanup retained stale global lock or undo plumbing');
});

test('hidden-autoplay protection leaves recognized player media alone', () => {
  const media = sourceBetween(
    CONTENT,
    '!1!==WO.blockAutoplayMedia&&!trustedMediaHost&&window.HTMLMediaElement',
    'if(!0===WO.blockSuspiciousWebRTC',
  );
  assert(/mediaInsidePlayerShell=el=>/.test(media)
    && /return!!playerShellFor\(el\)/.test(media),
  'hidden-media protection has no player-shell compatibility boundary');
  assert(/playBlockReason=el=>isMediaElement\(el\)&&!mediaInsidePlayerShell\(el\)&&hiddenMedia\(el\)/.test(media),
    'hidden-media protection can still pause an initializing player video');

  const playBlockReason = loadHiddenMediaBlockReason();
  for (const framework of [
    '.jwplayer', '.video-js', '.plyr', '.shaka-video-container',
    '.dplayer', '.art-video-player', '.clappr-container',
  ]) {
    assert.strictEqual(playBlockReason(hiddenVideoNode(framework)), '',
      framework + ' hidden initialization media would still be paused');
  }
  assert.strictEqual(playBlockReason(hiddenVideoNode('')), 'Hidden media player',
    'ordinary hidden media no longer receives autoplay protection');
});

void (async () => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log('ok - ' + item.name);
    } catch (error) {
      failures++;
      console.error('not ok - ' + item.name);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures) {
    console.error(failures + ' streaming compatibility test(s) failed');
    process.exit(1);
  }
  console.log('all streaming compatibility tests passed (' + tests.length + ')');
})();

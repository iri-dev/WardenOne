/* The onboarding guide must explain shipped controls and keep security choices explicit. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const read = (name) => fs.readFileSync(path.join(root, name), 'utf8');
const script = read('onboarding.js');
const html = read('onboarding.html');
const settings = read('settings.js');
const data = vm.runInNewContext(read('settings-data.js') + ';SETTINGS_DATA');
const guideSource = script.slice(0, script.indexOf('(function () {'));
const context = { data };
vm.createContext(context);
vm.runInContext(guideSource + ';this.groups = onboardingFeatureGroups(data)', context);
const groups = JSON.parse(JSON.stringify(context.groups));
const items = groups.flatMap((group) => group.items);
assert(items.find((item) => item.id === 'twitchRewind').tag.includes('default: off'), 'carried utility defaults are included');
assert(items.find((item) => item.id === 'twitchVodRewind').tag.includes('default: on'), 'rewind modes retain their distinct defaults');
const storeData = Object.assign({}, data, { carried: [] });
const storeItems = vm.runInNewContext(guideSource + ';onboardingFeatureGroups(data)', { data: storeData }).flatMap((group) => group.items);
assert(!storeItems.some((item) => item.id === 'twitchRewind' || item.id === 'twitchVodRewind'), 'a package without the rewind utility does not advertise its controls');
const ids = items.map((item) => item.id);
assert.equal(new Set(ids).size, ids.length, 'each guide entry has one identity');

const pages = settings.slice(settings.indexOf('const PAGES = ['), settings.indexOf('const NAV_LABELS ='));
const pageIds = [...pages.matchAll(/^  \{ id: '([^']+)', title:/gm)].map((m) => m[1]);
const valueKeys = [...new Set([...pages.matchAll(/\b(?:choice|pick|flag|slider|num)\('([^']+)'/g)].map((m) => m[1]))];
const sourceKeys = [...new Set(data.sections.concat(data.carried).flatMap((group) => group.rows.map((row) => row.key)).concat(data.watchOnlyKeys))];
const covered = items.flatMap((item) => item.keys);
assert.deepEqual([...new Set(covered)].sort(), sourceKeys.concat(valueKeys).sort(), 'every popup, watch-only and Settings value control is explained');
assert.equal(new Set(covered).size, covered.length, 'controls are not counted twice in the guide');
const linkedPages = new Set();
for (const item of items) {
  assert(item.name && item.desc && item.links.length, item.id + ' has a name, explanation and destination');
  for (const [label, href] of item.links) {
    assert(label, item.id + ' link has a readable name');
    const url = new URL(href, 'https://extension.invalid/');
    assert.equal(url.origin, 'https://extension.invalid', 'guide destinations stay inside the extension');
    assert(fs.existsSync(path.join(root, url.pathname.slice(1))), 'guide destination exists: ' + href);
    if (url.pathname === '/settings.html') {
      const params = new URLSearchParams(url.hash.slice(1));
      const page = params.get('page');
      assert(pageIds.includes(page), 'Settings page exists: ' + page);
      linkedPages.add(page);
      if (params.has('inspect')) assert(sourceKeys.includes(params.get('inspect')), 'inspector control exists');
    }
  }
}
assert.deepEqual([...linkedPages].sort(), pageIds.sort(), 'every Settings page and subview is reachable');
for (const id of ['zapper-workflow', 'streaming', 'right-click', 'palette', 'arrangement', 'site-dashboard', 'webgl',
  'eyeshield-profiles', 'health', 'repair', 'privacy-self-test', 'network-logger', 'site-firewall', 'custom-rules',
  'file-shield', 'download-review', 'extension-security', 'permission-scanner', 'providers', 'url-scanner',
  'updates', 'privacy-cleaner', 'backup', 'session-tools', 'network-guide', 'help']) {
  assert(ids.includes(id), id + ' remains discoverable');
}

const providerBlock = settings.slice(settings.indexOf('const PROVIDERS = ['), settings.indexOf('let siteState ='));
const providerCount = [...providerBlock.matchAll(/\{ id: '/g)].length + 1;
assert(html.includes('<b>' + providerCount + '</b><span>optional reputation providers</span>'), 'provider total includes keyless OpenPhish');
for (const [id, value] of [['onboarding-total', data.shieldKeys.length + data.watchOnlyKeys.length],
  ['onboarding-total-stat', data.shieldKeys.length + data.watchOnlyKeys.length],
  ['onboarding-switchable', data.shieldKeys.length], ['onboarding-watch-only', data.watchOnlyKeys.length]]) {
  assert(html.includes('id="' + id + '">' + value + '<'), id + ' fallback matches the registry');
}
assert(html.indexOf('src="settings-data.js"') < html.indexOf('src="onboarding.js"'), 'guide data loads before the controller');
assert(!/40\+|always-on protections|active guards, always on|Scores files before they run|You're protected\./.test(html), 'retired counts and safety promises stay out');
const note = html.match(/id="maxprivacy-note"[^>]*>([\s\S]*?)<\/div>/)[1];
const maxCopy = {
  antiFingerprintNoise: /fingerprint noise/, blockFraudVendorScripts: /fraud and bot-check script/,
  blockFirstPartyTrackers: /first-party tracker/, breachCheck: /breach checks/,
  clipboardGuard: /clipboard protection/, blockSuspiciousWebRTC: /WebRTC hardening/,
  clientHintProtection: /Client Hint/, capReferrer: /referrer protection/,
  trackerCacheProtection: /tracker cache protection/, deAmp: /De-AMP/,
};
for (const key of Object.keys(data.maxAdds)) assert(maxCopy[key]?.test(note), key + ' is disclosed in the preset note');
assert(/calls, screen sharing/.test(note), 'WebRTC compatibility warning is explicit');
assert(/sign-ins or purchases/.test(note), 'fraud-script blocking warning is explicit');
assert(/Recommended preserves advanced choices/.test(note), 'Recommended is not presented as undoing the stronger preset');

class Element {
  constructor(tag) { this.tagName = tag; this.dataset = {}; this.children = []; this.hidden = false; this.open = false; this.value = ''; this.textContent = ''; this.listeners = {}; }
  appendChild(child) { this.children.push(child); return child; }
  setAttribute(key, value) { this[key] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
}
const elements = Object.fromEntries(['feature-groups', 'feature-search', 'feature-results', 'onboarding-total',
  'onboarding-total-stat', 'onboarding-switchable', 'onboarding-watch-only'].map((id) => [id, new Element('div')]));
Object.assign(context, { SETTINGS_DATA: data, $: (id) => elements[id], document: { createElement: (tag) => new Element(tag) } });
const renderer = script.slice(script.indexOf('  function renderFeatureGuide()'), script.indexOf('  // ---- wiring'));
vm.runInContext(renderer + ';renderFeatureGuide()', context);
const renderedGroups = elements['feature-groups'].children;
const renderedRows = renderedGroups.flatMap((group) => group.children[1].children);
assert.deepEqual(renderedRows.map((row) => row.dataset.guideFeature), ids, 'all guide entries reach the DOM');
assert(renderedGroups.every((group) => !group.open), 'the full tour does not expand every description at once');
renderedGroups[0].open = true;
function search(value) { elements['feature-search'].value = value; elements['feature-search'].listeners.input(); }
search('gif');
assert(renderedRows.find((row) => row.dataset.guideFeature === 'pauseAnimatedImages').hidden === false, 'GIF search exposes its real control');
assert(renderedGroups.filter((group) => !group.hidden).every((group) => group.open), 'matching groups open for search');
search('webgl');
assert(renderedRows.find((row) => row.dataset.guideFeature === 'webgl').hidden === false, 'WebGL modes remain discoverable');
search('no-such-wardenone-feature');
assert(renderedGroups.every((group) => group.hidden), 'an empty search result has no unrelated groups');
assert(elements['feature-results'].textContent.startsWith('0 matching'), 'no matches are announced');
search('');
assert(renderedGroups.every((group) => !group.hidden), 'clearing search restores every group');
assert(renderedGroups[0].open && renderedGroups.slice(1).every((group) => !group.open), 'clearing search restores the reader\'s earlier open groups');
console.log('[ok] onboarding guide: ' + sourceKeys.length + ' popup/watch entries, ' + valueKeys.length + ' Settings controls, ' + pageIds.length + ' Settings pages; search and security copy');

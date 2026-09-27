/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const popup = fs.readFileSync(path.join(root, 'popup.js'), 'utf8');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'popup.html'), 'utf8');
const privacy = fs.readFileSync(path.join(root, 'PRIVACY.md'), 'utf8');
let failures = 0;
let passed = 0;
function check(label, ok) {
  if (ok) { passed++; return; }
  failures++;
  console.error('FAIL - ' + label);
}
function between(src, start, end) {
  const a = src.indexOf(start), b = src.indexOf(end, a);
  if (a < 0 || b < 0) throw new Error('missing function boundary: ' + start);
  return src.slice(a, b);
}

const providers = [
  { key: 'urlHaus', keyField: 'urlHausKey' },
  { key: 'abuseIpDb', keyField: 'abuseIpDbKey' },
  { key: 'phishTank', keyField: 'phishTankKey' },
  { key: 'whoisXml', keyField: 'whoisXmlKey' },
  { key: 'whoisXmlReputation', keyField: 'whoisXmlKey' },
  { key: 'whoisXmlThreatIntel', keyField: 'whoisXmlKey' },
];
const popupCtx = { config: {
  downloadVirusTotalKey: 'vt-key', downloadSafeBrowsingKey: 'sb-key',
  urlHausKey: 'haus-key', abuseIpDbKey: 'abuse-key', phishTankKey: 'tank-key', whoisXmlKey: 'whois-key',
}, REPUTATION_PROVIDERS: providers, PROVIDER_KEY_FIELDS: {
  downloadSafeBrowsing: 'downloadSafeBrowsingKey', downloadVirusTotal: 'downloadVirusTotalKey',
  urlHaus: 'urlHausKey', abuseIpDb: 'abuseIpDbKey', phishTank: 'phishTankKey', whoisXml: 'whoisXmlKey',
}, String, Object };
vm.createContext(popupCtx);
vm.runInContext(between(popup, 'function normalizeProviderSettings(', '\nfunction syncVirusTotalStatus('), popupCtx);
vm.runInContext(between(popup, 'function normalizeStoredProviderKeys(', '\n// ===== Settings backup'), popupCtx);
popupCtx.normalizeProviderSettings({});
for (const key of ['downloadVirusTotal', 'downloadSafeBrowsing', ...providers.map((p) => p.key)]) {
  check('pasting a key leaves ' + key + ' off', popupCtx.config[key] !== true);
}
popupCtx.normalizeStoredProviderKeys(popupCtx.config);
check('disabled provider retains its key for manual checks', popupCtx.config.downloadSafeBrowsingKey === 'sb-key' && popupCtx.config.phishTankKey === 'tank-key');
popupCtx.config.downloadSafeBrowsingKey = '';
popupCtx.config.downloadSafeBrowsing = true;
popupCtx.normalizeProviderSettings({ downloadSafeBrowsingKey: 'old-key' });
check('erasing a key turns its automatic switch off', popupCtx.config.downloadSafeBrowsing === false);

const bgCtx = {
  localGet: async () => ({ wardenone_config: {
    enabled: true, downloadSafeBrowsing: false, downloadSafeBrowsingKey: 'sb-key',
    phishTank: false, phishTankKey: 'tank-key', urlHaus: false, urlHausKey: 'haus-key',
    abuseIpDb: false, abuseIpDbKey: 'abuse-key', whoisXml: false, whoisXmlKey: 'whois-key',
    whoisXmlReputation: false, whoisXmlThreatIntel: false, openPhish: false,
  } }),
  DEFAULT_CONFIG: {}, String, Object,
};
vm.createContext(bgCtx);
vm.runInContext(between(background, 'async function urlReputationConfig(', '\nfunction reputationResultPublic('), bgCtx);
(async () => {
  const automatic = await bgCtx.urlReputationConfig();
  const manual = await bgCtx.urlReputationConfig(true);
  check('saved keys alone authorize no automatic request', automatic.enabled === false);
  check('manual right-click check may use saved keys', manual.enabled === true && manual.safeBrowsingEnabled && manual.phishTankEnabled && manual.urlHausEnabled);
  const settings = await bgCtx.localGet();
  settings.wardenone_config.downloadSafeBrowsing = true;
  bgCtx.localGet = async () => settings;
  const enabled = await bgCtx.urlReputationConfig();
  check('separate automatic switch enables only its provider', enabled.safeBrowsingEnabled === true && enabled.phishTankEnabled === false);
  check('navigation uses automatic consent', /async function handleSafeBrowsingNavigation[\s\S]*?const state = await urlReputationConfig\(\);/.test(background));
  bgCtx.__initBlockedDomains = Promise.resolve();
  bgCtx.loadLearned = async () => {};
  bgCtx.registrableDomainBg = (host) => String(host).split('.').slice(-2).join('.');
  bgCtx.SECURITY_DOMAINS = new Set(['listed.example']);
  bgCtx.LEARNED = { 'blocked.example': { userBlocked: true } };
  check('local malware and user blocks need no keyed lookup',
    await bgCtx.locallyBlockedReputationHost('sub.listed.example') === 'security'
      && await bgCtx.locallyBlockedReputationHost('blocked.example') === 'user'
      && await bgCtx.locallyBlockedReputationHost('ordinary.example') === '');
  const nav = between(background, 'async function handleSafeBrowsingNavigation(', '\nasync function checkVirusTotalUrl(');
  check('navigation checks local blocks before constructing provider requests',
    nav.indexOf('await locallyBlockedReputationHost(host)') >= 0
      && nav.indexOf('await locallyBlockedReputationHost(host)') < nav.indexOf('await urlReputationLookupUrl(')
      && nav.includes("local === 'security'") && nav.includes("local === 'user'"));
  check('right-click uses manual consent', /async function wardenHostFindings[\s\S]*?const state = await urlReputationConfig\(true\);/.test(background));
  check('key test buttons do not turn providers on', !between(popup, 'function testVirusTotalKey(', '\nfunction scanUrlWithVirusTotal(').includes('config.downloadVirusTotal = true')
    && !between(popup, 'function testVirusTotalKey(', '\nfunction scanUrlWithVirusTotal(').includes('config.downloadSafeBrowsing = true')
    && !between(popup, 'function setupReputationProvider(', '\nfunction scanUrlWithVirusTotal(').includes('config[provider.key] = true'));
  check('popup discloses account linkage before the switches', html.indexOf('link every checked') > 0 && html.indexOf('link every checked') < html.indexOf('data-key="downloadSafeBrowsing"'));
  check('privacy policy discloses cross-session account linkage', /join the addresses WardenOne submits to your account across browser sessions/.test(privacy));
  if (failures) process.exit(1);
  console.log('keyed provider consent: ' + passed + ' checks passed');
})().catch((e) => { console.error(e); process.exit(1); });

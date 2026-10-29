/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { sha256 } = require('./lib/privacy-baseline.js');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/protection-contracts.json');
const groups = {
  'search-junk.js': 'warnSearchResults',
  'anti-redirect.js': 'storageAccessGuard blockAllStorageAccess blockPopupTricks',
  'background-cname.js': 'blockCnameTrackers',
  'background-downloads.js': 'downloadReputation forcedDownloadProtection downloadDomainAge downloadSafeBrowsing downloadVirusTotal downloadVirusTotalHash',
  'background-startup.js': 'startupCheck',
  'background-extension-watch.js': 'watchExtensionPermissions',
  'permission-chain.js': 'permissionChainGuard',
  'oauth-guard.js': 'oauthGuard',
  'twitch-adblock.js': 'twitchAdBlock',
  'consent-reject.js': 'autoRejectConsent',
  'consent-wall.js': 'removeConsentWalls',
  'mail-shield.js': 'mailTrackingShield',
  'src/content.js': 'capabilityGuard deviceAccessGuard blockForcedPopups strictPopupShield blockGesturelessNav detectRedirectChains blockMetaRefresh blockWebRTCLeak sessionShield blockTokenExfil continuousTokenScan detectSkimmers paymentCardGuard insecureLoginGuard clipboardGuard clipboardSwapDetect scamLockGuard commandPasteGuard pasteProtection formTrapDetector fakeUpdateDetector riskySiteMode antiClickjacking mediaShield fullscreenGuard fakeWindowGuard notificationAbuseGuard blockCameraMic blockScreenCapture blockGeolocation blockAutoplayMedia adultHeuristics warnRedirectParams warnShorteners monitorLoggerApi detectPhishing blockHighConfidencePhishing behavioralScan xssBehaviorGuard removeOverlays autoSkipDownloadAds unshimLinks stripTrackingParams cleanCopyLinks socialWidgetGuard blockSupercookies antiFingerprintNoise deAmp keystrokePressure honeytokenMode backTrapGuard fingerprintProbeDetection',
  'background.js': 'logThirdPartyBeacons cryptominerCpuWatch scriptDriftGuard blockGrabberResources warnGrabberDomains certificateGuard blockTrackers adShield scriptletEngine sendPrivacySignals clientHintProtection capReferrer trackerCacheProtection blockFingerprintScripts blockFraudVendorScripts blockThirdPartyCookies blockFirstPartyTrackers forceHttps loginAgeCheck urlHaus abuseIpDb openPhish phishTank whoisXml whoisXmlReputation whoisXmlThreatIntel intranetProtection intranetNetworkRules dnsRebindGuard gateAdultSites blockMalwareSites blockCryptominers autoUpdateLists trackerLearner clearCookiesOnLeave clearServiceWorkersOnLeave blockAllCookies breachCheck safeSearch',
};
function generate() {
  const read = file => fs.readFileSync(path.join(root, file), 'utf8');
  const settings = vm.runInNewContext(read('settings-data.js') + ';SETTINGS_DATA');
  const manifest = JSON.parse(read('manifest.json'));
  const sources = Object.fromEntries([...new Set(['src/content.js', ...fs.readdirSync(root).filter(f => f.endsWith('.js'))])].sort().map(file => [file, read(file)]));
  const owners = new Map();
  for (const [file, keys] of Object.entries(groups)) for (const key of keys.split(' ')) {
    if (owners.has(key)) throw Error('Duplicate owner: ' + key);
    owners.set(key, file);
  }
  const rows = [...settings.sections, ...settings.carried].flatMap(section => section.rows || []);
  const defaults = Object.assign({}, settings.defaults, ...settings.carried.map(section => section.defaults || {}));
  const keys = [...new Set([...settings.shieldKeys, ...settings.watchOnlyKeys])].sort();
  const protections = keys.map(key => {
    const owner = owners.get(key), row = rows.find(row => row.key === key);
    if (!owner || !sources[owner]?.includes(key)) throw Error('Missing reviewed owner/reference: ' + key);
    const references = Object.entries(sources).filter(([, source]) => new RegExp('\\b' + key + '\\b').test(source)).map(([file, source]) => ({file, line: source.slice(0, source.search(new RegExp('\\b' + key + '\\b'))).split('\n').length}));
    return { key, owner, name: row?.name || key, contract: row?.desc || 'Apply the named protection using its validated configuration and browser-owned context; see the owner and regression matrix.',
      default: defaults[key], siteOverride: Object.entries(settings.siteOverrideScope).filter(([, list]) => list.includes(key)).map(([scope]) => scope), references };
  });
  for (const key of owners.keys()) if (!keys.includes(key)) throw Error('Obsolete owner mapping: ' + key);
  const worker = sources['background.js'];
  const constants = {};
  for (const match of worker.matchAll(/const ([A-Z][A-Z_0-9]+) = ([^;]+);/g)) {
    if (!/^[\d\s+*()\-A-Z_0-9]+$/.test(match[2])) continue;
    try { const value = vm.runInNewContext(match[2], {...constants}, {timeout: 100}); if (Number.isSafeInteger(value)) constants[match[1]] = value; } catch (_) {}
  }
  const rules = Object.entries(constants).filter(([name]) => /RULE_(?:BASE|ID)$|RULES?_BUDGET$|RULE_MAX$|MAX_DYNAMIC$|OPTION_RULES_MAX$|TOTAL_.*BUDGET$/.test(name)).map(([name, value]) => ({name, value}));
  const logs = [];
  for (const [file, source] of Object.entries(sources)) for (const match of source.matchAll(/\btype:\s*['"]([a-z][a-z0-9_-]+)['"]/g)) logs.push({type: match[1], file, line: source.slice(0, match.index).split('\n').length});
  return { schemaVersion: 1, protections, configuration: Object.entries(defaults).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => ({ key, type: Array.isArray(value) ? 'array' : typeof value, default: value })),
    ruleAllocations: { owner: 'background.js', constants: rules, precedence: 'network-policy.js', regression: 'tools/test-dnr-budget.js' },
    manifest: { permissions: manifest.permissions, optionalPermissions: manifest.optional_permissions || [], hostPermissions: manifest.host_permissions,
      background: manifest.background, contentScripts: manifest.content_scripts, webAccessibleResources: manifest.web_accessible_resources },
    logTypeReferences: logs, logSchema: 'notification-schema.js', storageInventory: 'docs/storage-inventory.json', messageInventory: 'docs/message-boundaries.json',
    sourceHashes: Object.fromEntries(Object.entries(sources).map(([file, source]) => [file, sha256(source)])),
    scope: 'Owners are accountable enforcement modules, not exclusive consumers. Configuration is generated from canonical settings data. Log references are a lexical census, including non-incident type fields. Manifest permissions belong to the extension; this inventory does not assert each owner needs every permission.' };
}
if (require.main === module) {
  const data = generate(), json = JSON.stringify(data, null, 2) + '\n';
  if (process.argv.includes('--write')) fs.writeFileSync(output, json);
  else if (fs.readFileSync(output, 'utf8') !== json) throw Error('Protection inventory stale; run tools/audit-protection-contracts.js --write');
  console.log('[ok] ' + data.protections.length + ' protection owners and ' + data.configuration.length + ' configuration fields');
}
module.exports = {generate, output};

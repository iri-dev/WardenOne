/* Sync site data, captures and public documents from extension sources.
   Usage: node sync-data.js [path-to-extension-repo]
   In a Git checkout read HEAD so the site describes published, rather than local, changes. */
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');

const repo = path.resolve(process.argv.slice(2).find((arg) => arg !== '--working-tree') || path.join(__dirname, '..'));
const git = (args, encoding = 'utf8') => execFileSync('git', ['-C', repo, ...args], { encoding, maxBuffer: 256 * 1024 * 1024 });
let commit = null;
try { commit = git(['rev-parse', '--short', 'HEAD']).trim(); } catch { /* Not a checkout: read the files on disk. */ }
if (process.argv.includes('--working-tree')) commit = null;
const readBytes = file => commit ? git(['show', `HEAD:${file}`], 'buffer') : fs.readFileSync(path.join(repo, file));
const read = file => readBytes(file).toString('utf8');
const listTools = () => commit
  ? git(['ls-tree', '--name-only', 'HEAD', 'tools/']).split('\n').map(name => name.replace(/^tools\//, ''))
  : fs.readdirSync(path.join(repo, 'tools'));

const context = {};
vm.createContext(context);
vm.runInContext(`${read('settings-data.js')}\n;globalThis.settingsData = SETTINGS_DATA;`, context);
/* onboarding.js defines onboardingFeatureGroups() before its page-only IIFE; only that part is evaluated. */
const onboarding = read('onboarding.js');
const groupSource = onboarding.slice(0, onboarding.indexOf('\n(function () {'));
if (!groupSource.includes('function onboardingFeatureGroups')) throw new Error('onboardingFeatureGroups() not found in onboarding.js');
vm.runInContext(`${groupSource}\n;globalThis.featureGroups = onboardingFeatureGroups(settingsData);`, context);

const data = context.settingsData;
const categories = [
  { id: 'security', title: 'Scams and threats', icon: 'shield', intro: 'Warnings and blocks for phishing, scams, malicious sites, redirects and risky extensions.',
    groups: ['Site, script and network threat detection', 'Threat blocklists and cryptomining', 'Script Shield', 'Pop-ups, redirects and page clutter', 'Adult-site safety and SafeSearch', 'Extension and permission monitoring', 'Watch-only activity'] },
  { id: 'signin', title: 'Sign-ins and sessions', icon: 'key', intro: 'Guards for passwords, session tokens, payment forms, the clipboard and the login flows scams imitate.',
    groups: ['Sessions, forms, clipboard and scams', 'Forget Me and logins'] },
  { id: 'downloads', title: 'Downloads and files', icon: 'download', intro: 'A review before a suspicious download continues, a local file inspector, and optional reputation providers.',
    groups: ['Download Shield and optional reputation checks', 'Files, extensions, providers and updates'] },
  { id: 'privacy', title: 'Privacy and tracking', icon: 'eye-off', intro: 'Tracker, cookie and fingerprinting controls, IP and certificate protection, and device permissions.',
    groups: ['Tracking, cookies and fingerprinting', 'IP protection, HTTPS and certificates', 'Camera, microphone, location and media', 'Privacy cleanup, backup and help'] },
  { id: 'content', title: 'Ads, media and pages', icon: 'sparkle', intro: 'AdShield, player-specific handling for YouTube, Twitch and Spotify, search cleanup and Element Zapper.',
    groups: ['AdShield and search cleanup', 'Player tools', 'Page tools and streaming', 'Page notices, badges and Element Zapper'] },
  { id: 'control', title: 'Control and evidence', icon: 'sliders', intro: 'Activity, diagnostics, per-site control, your own rules, and tools for speed and memory.',
    groups: ['Activity, diagnostics and network tools', 'Settings, layout and site choices', 'Memory Shield and Resource Saver'] }
];

const used = new Set();
const catalogue = categories.map(category => {
  const groups = category.groups.map(title => {
    const group = context.featureGroups.find(candidate => candidate.title === title);
    if (!group) throw new Error(`Feature group "${title}" no longer exists; update the category map in sync-data.js`);
    used.add(title);
    return {
      title: group.title,
      items: group.items.map(item => ({ id: item.id, name: item.name, desc: item.desc || '', tag: item.tag || '' }))
    };
  });
  const { groups: _titles, ...rest } = category;
  return { ...rest, count: groups.reduce((total, group) => total + group.items.length, 0), groups };
});
const unplaced = context.featureGroups.filter(group => !used.has(group.title)).map(group => group.title);
if (unplaced.length) throw new Error(`Feature groups without a category: ${unplaced.join(', ')}`);

const manifest = JSON.parse(read('manifest.json'));
const networkRules = manifest.declarative_net_request.rule_resources
  .filter(resource => resource.enabled)
  .reduce((total, resource) => total + JSON.parse(read(resource.path)).length, 0);
const testSuites = listTools().filter(name => /^test-.+\.js$/.test(name)).length;

const stats = {
  protections: data.shieldKeys.length + data.watchOnlyKeys.length,
  switchable: data.shieldKeys.length,
  watchOnly: data.watchOnlyKeys.length,
  onByDefault: data.shieldKeys.filter(key => data.defaults[key] === true).length,
  feeds: data.feedTotal,
  networkRules,
  testSuites,
  catalogueEntries: catalogue.reduce((total, category) => total + category.count, 0),
  minimumChrome: Number(manifest.minimum_chrome_version)
};

const output = {
  source: { repository: 'https://github.com/iri-dev/WardenOne', commit: commit || 'working copy', version: manifest.version, syncedFrom: 'settings-data.js, onboarding.js, manifest.json, tools/' },
  stats,
  categories: catalogue
};
fs.mkdirSync(path.join(__dirname, 'src', 'data'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'src', 'data', 'catalogue.json'), `${JSON.stringify(output, null, 2)}\n`);

const captures = [
  '01-popup-overview-2026-10.webp', '02-protection-health-2026-10.webp', '03-activity-centre.webp', '03-activity-timeline.webp',
  '04-download-review-suspicious.webp', '04-download-shield.webp', '05-file-shield-result-preview.webp', '06-extension-centre.webp',
  '07-privacy-self-test-preview.webp', '08-site-firewall-preview.webp', '09-network-logger-requests.webp',
  '11-onboarding-feature-guide-2026-10.webp', '11-onboarding-welcome-2026-10.webp', '13-command-palette.webp',
  '14-clickfix-warning.webp', '15-settings-overview.webp', '15-settings-privacy.webp',
  '16-zapper-github-select-2026-10.webp', '16-zapper-github-removed-2026-10.webp'
];
fs.mkdirSync(path.join(__dirname, 'public', 'images'), { recursive: true });
for (const name of captures) {
  fs.writeFileSync(path.join(__dirname, 'public', 'images', name), readBytes(`docs/screenshots/${name}`));
}
fs.mkdirSync(path.join(__dirname, 'public', 'icons'), { recursive: true });
fs.writeFileSync(path.join(__dirname, 'public', 'icons', 'icon128.png'), readBytes('icons/icon128.png'));
const documents = ['PRIVACY.md', 'CREDITS.md', 'SUPPORT.md'];
for (const name of documents) fs.writeFileSync(path.join(__dirname, 'public', name), readBytes(name));
fs.rmSync(path.join(__dirname, 'public', 'CHANGELOG.md'), { force: true });
for (const name of ['THIRD_PARTY_NOTICES.html', 'LICENSE']) {
  fs.writeFileSync(path.join(__dirname, 'public', name), readBytes(name));
}
/* The web copy uses its embedded default theme and links home, without extension-only assets. */
const permissionsPage = read('permissions.html')
  .replace(/<link[^>]+href="theme.css"[^>]*>\s*/, '')
  .replace('<script src="theme.js"></script>', '')
  .replace('href="popup.html" aria-label="Back to WardenOne popup"', 'href="./index.html" aria-label="Back to WardenOne"');
fs.writeFileSync(path.join(__dirname, 'public', 'permissions.html'), permissionsPage);
console.log(`Synced ${stats.catalogueEntries} catalogue entries in ${catalogue.length} categories, ${captures.length} captures, the icon and ${documents.length} documents, from ${commit || 'the working copy'}`);
console.log(JSON.stringify(stats));

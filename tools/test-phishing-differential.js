/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Compare the worker's current phishing verdicts with a recorded pre-10eced2 corpus.
   --compare-ref reads the actual parent revision for a local audit; the normal gate
   uses recorded before verdicts because GitHub's checkout may be shallow. */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const { domainToASCII, domainToUnicode } = require('url');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const CURRENT = fs.readFileSync(path.join(ROOT, 'background-startup.js'), 'utf8');
const PAGE_SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const DOMAIN_SOURCE = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
const idnStart = DOMAIN_SOURCE.indexOf('const WARDENONE_IDN_CONFUSABLES');
const idnEnd = DOMAIN_SOURCE.indexOf('function regDomain(', idnStart);
assert(idnStart >= 0 && idnEnd > idnStart, 'shared IDN helper has moved');
const IDN_SCRIPT = new vm.Script(DOMAIN_SOURCE.slice(idnStart, idnEnd), { filename: 'domain-utils.js:idn' });
const CASES = [
  ['discord.com', '/channels/@me', 'official'],
  ['canary.discord.com', '/channels/@me', 'official'],
  ['discordapp.com', '/', 'official'],
  ['discord.gg', '/', 'official'],
  ['disboard.org', '/servers', 'directory'],
  ['disboard.org', '/login', 'directory-login'],
  ['discordbots.gg', '/', 'directory'],
  ['discordbotlist.com', '/', 'bot-directory'],
  ['discordbotlist.com', '/login', 'bot-directory-login'],
  ['discordservers.com', '/', 'server-directory'],
  ['discordservers.com', '/login', 'server-directory-login'],
  ['discord.me', '/', 'server-directory'],
  ['discord.me', '/login', 'server-directory-login'],
  ['thediscordlist.com', '/', 'bot-directory'],
  ['thediscordlist.com', '/login', 'bot-directory-login'],
  ['discords.example', '/', 'ordinary-suffix'],
  ['discordservers.example', '/account/login', 'directory-login'],
  ['steamrip.com', '/account/login', 'brand-in-name'],
  ['protondb.com', '/login', 'brand-in-name'],
  ['applebees.com', '/login', 'brand-in-name'],
  ['d1scord.example', '/login', 'visual-typo'],
  ['disc0rd.example', '/login', 'visual-typo'],
  ['d1sc0rd.example', '/login', 'visual-typo'],
  ['disccord.example', '/login', 'repeated-letter'],
  ['discordd.example', '/login', 'repeated-letter'],
  ['ddiscord.example', '/login', 'repeated-letter'],
  ['discorb.example', '/login', 'single-edit'],
  ['discrod.example', '/login', 'transposition'],
  ['dicsord.example', '/login', 'transposition'],
  ['discor.example', '/login', 'deletion'],
  ['discord-login.example', '/', 'host-login-lure'],
  ['login-discord.example', '/', 'host-login-lure'],
  ['discord-verify.example', '/', 'host-login-lure'],
  ['secure-discord.example', '/', 'host-login-lure'],
  ['discord.evil.example', '/', 'subdomain'],
  ['login.discord.evil.example', '/', 'nested-subdomain'],
  ['discord.com.evil.example', '/', 'official-domain-subdomain'],
  ['discord-login.evil.example', '/', 'host-login-subdomain'],
  ['rnicrosoft.example', '/login', 'rn-m-visual'],
  ['vvellsfargo.example', '/login', 'vv-w-visual'],
  ['stean.example', '/login', 'single-edit'],
  ['steamm.example', '/login', 'repeated-letter'],
  ['steamcommunity.ru', '/login', 'tld-swap'],
  ['steamcommunlty.com', '/login', 'derived-typo'],
  ['paypal-verify.example', '/', 'host-login-lure'],
  ['paypa1.example', '/login', 'visual-typo'],
  ['paypal.evil.example', '/', 'subdomain'],
];
const caseKey = (host, pathname) => host + pathname;
const BEFORE_CLEAN = new Set([
  'discord.com/channels/@me',
  'canary.discord.com/channels/@me',
  'discordapp.com/',
  'discord.gg/',
  'discordbots.gg/',
  'discordbotlist.com/',
  'discordservers.com/',
  'discord.me/',
  'thediscordlist.com/',
]);
const INTENTIONAL_DROPS = new Set([
  'disboard.org/servers',
  'disboard.org/login',
  'discordbotlist.com/login',
  'discordservers.com/login',
  'discord.me/login',
  'thediscordlist.com/login',
  'discords.example/',
  'discordservers.example/account/login',
  'steamrip.com/account/login',
  'protondb.com/login',
  'applebees.com/login',
]);
const RESTORED_TYPOS = new Set([
  'discrod.example/login',
  'dicsord.example/login',
]);
const LOST_AT_10ECED2 = new Set([...INTENTIONAL_DROPS, ...RESTORED_TYPOS]);
const PAGE_ABSTAINS = new Set([
  ...INTENTIONAL_DROPS,
  ...BEFORE_CLEAN,
  'discor.example/login',
  'steamcommunity.ru/login',
  'steamcommunlty.com/login',
]);
const STARTUP_ABSTAINS = new Set([
  ...BEFORE_CLEAN,
  ...INTENTIONAL_DROPS,
  'discord.evil.example/',
  'paypal.evil.example/',
]);

function regDomainBg(host) {
  const h = String(host || '').replace(/^www\./, '').toLowerCase();
  const parts = h.split('.').filter(Boolean);
  if (parts.length <= 2) return h;
  const lastTwo = parts.slice(-2).join('.');
  if (/^(co|com|org|net|gov|ac)\.[a-z]{2}$/i.test(lastTwo) && parts.length >= 3) return parts.slice(-3).join('.');
  return lastTwo;
}

function loadWorker(source) {
  const sandbox = {
    console,
    setTimeout() {},
    DEFAULT_CONFIG: {},
    BLOCKED_DOMAINS: new Set(),
    EXT_BASELINE_KEY: 'test-baseline',
    regDomainBg,
    localGet: async () => ({}),
    localSet: async () => {},
    snapshotExtensionBaseline: async () => {},
    chrome: {
      runtime: { onStartup: { addListener() {} } },
      tabs: { query: async () => [] },
      management: { getAll: async () => [] },
      action: { setBadgeText() {}, setBadgeBackgroundColor() {} },
      notifications: { create() {} },
    },
  };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  IDN_SCRIPT.runInContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(source + '\nglobalThis.__phishingTest = { loginBrandRiskForHost, loginRiskVerdict, looksLikeLookalikeHost, profiles: LOGIN_BRAND_PROFILES };', sandbox);
  const evaluate = (host, pathname) => {
    const url = 'https://' + host + pathname;
    const brand = sandbox.__phishingTest.loginBrandRiskForHost(host, url);
    const login = sandbox.__phishingTest.loginRiskVerdict(host, url, null, 14);
    const startup = sandbox.__phishingTest.looksLikeLookalikeHost(host);
    return { brand: brand ? brand.brand : '', kind: brand ? brand.kind : '', login: login.risky, startup };
  };
  evaluate.profiles = Array.from(sandbox.__phishingTest.profiles, (profile) => ({
    label: profile.label, token: profile.token, domains: Array.from(profile.domains),
  }));
  return evaluate;
}

function loadPageDetector(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((line) => line.includes('const BRANDS={'));
  const end = lines.findIndex((line, index) => index > start && line.includes('phishHit.confidence="high"),'));
  const boundaryStart = lines.findIndex((line) => line.includes('SITE_BOUNDARY=(()=>{'));
  const boundaryEnd = lines.findIndex((line, index) => index > boundaryStart && line.includes('VERIFICATION_FLOW_POLICY=(()=>{'));
  assert(start >= 0 && end > start && boundaryStart >= 0 && boundaryEnd > boundaryStart, 'page phishing detector has moved');
  const boundary = 'const ' + lines.slice(boundaryStart, boundaryEnd).join('\n').replace(/,\s*$/, ';');
  let body = boundary + '\n' + lines.slice(start, end + 1).join('\n');
  body = body.replace(/if\(phishHit&&isPuny&&\(phishHit\.kind="homograph",\s*phishHit\.confidence="high"\),\s*$/,
    'if(phishHit&&isPuny){phishHit.kind="homograph";phishHit.confidence="high";}');
  const evaluate = (host) => {
    const sandbox = { location: { hostname: host }, WO: {}, Object, Set, Math, String, Array, Number, JSON, __result: null };
    vm.createContext(sandbox);
    IDN_SCRIPT.runInContext(sandbox);
    vm.runInContext('(function(){' + body + '__result=phishHit;})();', sandbox, { timeout: 5000 });
    const hit = sandbox.__result;
    return { brand: hit ? hit.brand : '', kind: hit ? hit.kind : '', confidence: hit ? hit.confidence : '' };
  };
  const brandStart = source.indexOf('const BRANDS={');
  const brandEnd = source.indexOf('};\n      try{', brandStart);
  assert(brandStart >= 0 && brandEnd > brandStart, 'page brand table has moved');
  const brandTable = vm.runInNewContext(source.slice(brandStart, brandEnd + 2) + '\nBRANDS;');
  evaluate.brands = Object.fromEntries(Object.entries(brandTable).map(([key, domains]) => [key, Array.from(domains)]));
  return evaluate;
}

const current = loadWorker(CURRENT);
const page = loadPageDetector(PAGE_SOURCE);
function brandMatrixRows(token, domains) {
  const rows = [];
  for (const domain of domains) {
    rows.push(['official', domain, '/', false]);
    rows.push(['official-subdomain', 'help.' + domain, '/', false]);
  }
  rows.push(['adjacent-fans', token + 'fans.example', '/account/login', false]);
  rows.push(['adjacent-guides', token + 'guides.example', '/login', false]);
  rows.push(['suffix-login', token + '-login.example', '/', true]);
  rows.push(['prefix-login', 'login-' + token + '.example', '/', true]);
  rows.push(['brand-subdomain', token + '.attacker.example', '/', true]);
  rows.push(['nested-official', domains[0] + '.attacker.example', '/', true]);
  if (token.length >= 4) {
    let swapAt = -1;
    for (let i = token.length - 2; i >= 0; i--) if (token[i] !== token[i + 1]) { swapAt = i; break; }
    if (swapAt >= 0) rows.push(['adjacent-swap', token.slice(0, swapAt) + token[swapAt + 1]
      + token[swapAt] + token.slice(swapAt + 2) + '.example', '/login', true]);
  }
  if (token.length >= 5) rows.push(['repeated-letter', token + token[token.length - 1] + '.example', '/login', true]);
  if (token.includes('o')) rows.push(['digit-swap', token.replace('o', '0') + '.example', '/login', true]);
  return rows;
}

function runBrandMatrix() {
  assert(current.profiles.length >= 21, 'worker brand profiles unexpectedly shrank');
  assert(Object.keys(page.brands).length >= 100, 'page brand table unexpectedly shrank');
  for (const brand of ['discord', 'steam', 'microsoft', 'google', 'paypal', 'amazon']) {
    assert(current.profiles.some((profile) => profile.token === brand), brand + ' missing from worker matrix');
    assert(page.brands[brand], brand + ' missing from page matrix');
  }
  const mismatches = [];
  let checked = 0;
  const check = (surface, brand, shape, host, pathname, expected) => {
    checked++;
    const verdict = surface === 'worker' ? current(host, pathname) : page(host);
    const result = surface === 'worker' ? verdict.login : !!verdict.brand;
    const expectedBrand = brand.replace(/[^a-z0-9]/gi, '').toLowerCase();
    const actualBrand = String(verdict.brand || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
    const sharedOfficialAlias = surface === 'page' && brand === 'amex'
      && shape === 'nested-official' && actualBrand === 'americanexpress';
    if (result !== expected || (expected && actualBrand !== expectedBrand && !sharedOfficialAlias))
      mismatches.push({ surface, brand, shape, host, expected, verdict });
  };
  assert.deepStrictEqual(page.brands.twitch_tv, page.brands.twitch, 'twitch_tv must remain the Twitch alias');
  for (const profile of current.profiles) {
    for (const [shape, host, pathname, expected] of brandMatrixRows(profile.token, profile.domains)) {
      check('worker', profile.token, shape, host, pathname, expected);
    }
  }
  for (const [token, domains] of Object.entries(page.brands)) {
    if (token.includes('_')) continue;
    for (const [shape, host, pathname, expected] of brandMatrixRows(token, domains)) {
      check('page', token, shape, host, pathname, expected);
    }
  }
  assert.strictEqual(mismatches.length, 0, 'cross-brand matrix failures:\n' + mismatches.map((item) => JSON.stringify(item)).join('\n'));
  console.log('[ok] phishing brand matrix covers ' + checked + ' cases across ' + current.profiles.length
    + ' worker profiles and ' + Object.keys(page.brands).length + ' page entries');
}

function runHomographMatrix() {
  const helperWorld = {};
  vm.createContext(helperWorld);
  IDN_SCRIPT.runInContext(helperWorld);
  assert.strictEqual(vm.runInContext('wardenOneUts39AsciiMap === null', helperWorld), true,
    'the generated confusable table must start lazy');
  helperWorld.wardenOneIdnLabels('ordinary.example');
  assert.strictEqual(vm.runInContext('wardenOneUts39AsciiMap === null', helperWorld), true,
    'an ASCII hostname must not expand the generated confusable table');
  const ascii = [
    ['6oo6le.example', 'google'],
    ['9oo9le.example', 'google'],
    ['ama2on.example', 'amazon'],
    ['we11sfargo.example', 'wellsfargo'],
    ['8inance.example', 'binance'],
    ['m1cr0s0ft.example', 'microsoft', 'medium'],
    ['c0inba5e.example', 'coinbase'],
  ];
  for (const [host, brand, confidence = 'high'] of ascii) {
    const worker = current(host, '/login');
    const hit = page(host);
    assert.strictEqual(worker.kind, 'typosquat', host + ' worker missed visual substitution');
    assert.strictEqual(worker.brand.toLowerCase().replace(/[^a-z]/g, ''), brand, host + ' worker named wrong brand');
    assert.strictEqual(hit.brand, brand, host + ' page missed visual substitution');
    assert.strictEqual(hit.confidence, confidence, host + ' visual confidence drifted');
  }
  const idn = [
    ['pаypal.example', 'paypal'],
    ['аррӏе.example', 'apple'],
    ['gοοgle.example', 'google'],
    ['mіcrоsoft.example', 'microsoft'],
    ['steаmpowered.example', 'steam'],
    ['раураl.evil.example', 'paypal'],
    ['mıcrosoft.example', 'microsoft'],
    ['ɡoogle.example', 'google'],
    ['ցoogle.example', 'google'],
    ['ⲣaypal.example', 'paypal'],
    ['cσinbase.example', 'coinbase'],
    ['ꓐinance.example', 'binance'],
    ['Ꭰiscord.example', 'discord'],
  ];
  for (const [unicode, brand] of idn) {
    const host = domainToASCII(unicode);
    assert(host && host.includes('xn--') && domainToUnicode(host) !== host,
      unicode + ' must be a real encoded IDN test case');
    assert.strictEqual(helperWorld.wardenOnePunycodeDecode(host.split('.')[0]), unicode.split('.')[0],
      host + ' decoder disagrees with the platform IDN conversion');
    const worker = current(host, '/login');
    const hit = page(host);
    assert.strictEqual(worker.kind, 'homograph', host + ' worker must identify a brand confusable');
    assert.strictEqual(worker.brand.toLowerCase().replace(/[^a-z]/g, ''), brand, host + ' worker named wrong brand');
    assert(worker.login && worker.startup, host + ' must warn both on login and at startup');
    assert.strictEqual(hit.brand, brand, host + ' page detector missed an IDN lookalike');
    assert.strictEqual(hit.kind, 'homograph', host + ' page detector must explain its IDN finding');
    assert.strictEqual(hit.confidence, 'high', host + ' exact IDN skeleton must rate high');
  }
  helperWorld.wardenOneIdnLabels(domainToASCII('mıcrosoft.example'));
  assert.strictEqual(vm.runInContext('wardenOneUts39AsciiMap !== null', helperWorld), true,
    'an inspected IDN must expand the generated confusable table');
  for (const unicode of [
    'bücher.example',
    'münchen.example',
    'δοκιμή.example',
    'ցանկ.example',
    'σχολή.example',
    'ⲣⲱⲙⲉ.example',
    'kıtab.example',
  ]) {
    const host = domainToASCII(unicode);
    assert(host && host.includes('xn--'), unicode + ' must be an encoded IDN');
    assert.strictEqual(helperWorld.wardenOnePunycodeDecode(host.split('.')[0]), unicode.split('.')[0],
      host + ' decoder disagrees with the platform IDN conversion');
    const worker = current(host, '/login');
    assert.strictEqual(worker.login, false, host + ' must not be hard-blocked just for using IDN');
    assert.strictEqual(worker.startup, false, host + ' must not warn at startup just for using IDN');
    assert.strictEqual(page(host).brand, '', host + ' must not be called a protected-brand spoof');
  }
  assert.strictEqual(helperWorld.wardenOnePunycodeDecode('xn--'), '', 'empty ACE label must fail closed');
  const confusable = {
    a: 'а', c: 'с', e: 'е', i: 'і', l: 'ӏ', m: 'м', o: 'о',
    p: 'р', s: 'ѕ', t: 'т', y: 'у', x: 'х', d: 'ԁ', w: 'ԝ',
  };
  let broadCount = 0;
  for (const profile of current.profiles) {
    const position = Array.from(profile.token).findIndex((letter) => confusable[letter]);
    assert(position >= 0, profile.token + ' has no supported IDN substitution for the matrix');
    const unicode = profile.token.slice(0, position) + confusable[profile.token[position]]
      + profile.token.slice(position + 1) + '.example';
    const host = domainToASCII(unicode);
    assert(host.includes('xn--'), unicode + ' did not become an ACE hostname');
    const worker = current(host, '/login');
    assert.strictEqual(worker.kind, 'homograph', host + ' worker missed ' + profile.token);
    assert.strictEqual(worker.brand.toLowerCase().replace(/[^a-z0-9]/g, ''), profile.token,
      host + ' worker named the wrong brand');
    if (page.brands[profile.token]) {
      const hit = page(host);
      assert.strictEqual(hit.brand, profile.token, host + ' page missed ' + profile.token);
      assert.strictEqual(hit.confidence, 'high', host + ' page must rate an exact IDN skeleton high');
    }
    broadCount++;
  }
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  const mainScripts = manifest.content_scripts.filter((entry) => entry.world === 'MAIN');
  const helperAt = mainScripts.findIndex((entry) => entry.js.includes('domain-utils.js'));
  const engineAt = mainScripts.findIndex((entry) => entry.js.includes('content.min.js'));
  assert(helperAt >= 0 && engineAt > helperAt,
    'the shared IDN helper must load before the MAIN-world page detector');
  console.log('[ok] visual and IDN matrix: ' + ascii.length + ' ASCII lookalikes, '
    + idn.length + ' encoded brand spoofs, ' + broadCount + ' profile substitutions, '
    + 'seven ordinary IDNs');
}

if (process.argv.includes('--compare-ref')) {
  const previousSource = execFileSync('git', ['show', '10eced2^:background-startup.js'], { cwd: ROOT, encoding: 'utf8' });
  const changedSource = execFileSync('git', ['show', '10eced2:background-startup.js'], { cwd: ROOT, encoding: 'utf8' });
  const previous = loadWorker(previousSource);
  const changed = loadWorker(changedSource);
  const actualLosses = [];
  for (const [host, pathname, category] of CASES) {
    const key = caseKey(host, pathname);
    const before = previous(host, pathname);
    const atCommit = changed(host, pathname);
    const after = current(host, pathname);
    assert.strictEqual(before.login, !BEFORE_CLEAN.has(key), key + ' pre-10eced2 snapshot drifted');
    assert.strictEqual(atCommit.login, before.login && !LOST_AT_10ECED2.has(key), key + ' 10eced2 snapshot drifted');
    if (before.login && !atCommit.login) actualLosses.push(key);
    if (before.login && !atCommit.login) console.log(key + ' lost at 10eced2: ' + category
      + '; current worker=' + (after.login ? after.kind : 'none') + '; page=' + (page(host).kind || 'none'));
  }
  assert.deepStrictEqual(actualLosses.sort(), [...LOST_AT_10ECED2].sort(), 'unrecorded 10eced2 warning losses');
  console.log('[ok] ' + actualLosses.length + ' losses verified against 10eced2^ and 10eced2');
  for (const host of ['discord-help.example', 'steam-support.example']) {
    for (const pathname of ['/login', '/verify', '/account', '/oauth']) {
      assert(previous(host, pathname).login, host + pathname + ' must represent the old path-driven warning');
      assert.strictEqual(changed(host, pathname).login, false,
        host + pathname + ' must represent the path-driven warning removed by 10eced2');
      assert.strictEqual(current(host, pathname).login, false,
        host + pathname + ' must not regain a path-only hard block');
    }
  }
  console.log('[ok] eight additional brand-in-name path warnings removed; credential-form corroboration is tested separately');
  const matrixLosses = [];
  for (const profile of current.profiles) {
    for (const [shape, host, pathname, expected] of brandMatrixRows(profile.token, profile.domains)) {
      const before = previous(host, pathname);
      const atCommit = changed(host, pathname);
      if (before.login && !atCommit.login) {
        const now = current(host, pathname);
        matrixLosses.push({ brand: profile.token, shape, host, expected, restored: now.login });
        if (expected) assert(now.login, host + ' lost a phishing warning at 10eced2 and remains unprotected');
      }
    }
  }
  const lossKinds = Object.entries(matrixLosses.reduce((counts, row) => {
    counts[row.shape] = (counts[row.shape] || 0) + 1;
    return counts;
  }, {})).map(([shape, count]) => shape + '=' + count).join(', ');
  console.log('[ok] all-brand 10eced2 comparison: ' + matrixLosses.length + ' worker warning losses (' + lossKinds + ')');
} else {
  let protectedCount = 0;
  let allowedCount = 0;
  for (const [host, pathname] of CASES) {
    const key = caseKey(host, pathname);
    const worker = current(host, pathname);
    const pageHit = page(host);
    const shouldWarn = !BEFORE_CLEAN.has(key) && !INTENTIONAL_DROPS.has(key);
    assert.strictEqual(worker.login, shouldWarn, key + ' worker login verdict changed');
    assert.strictEqual(worker.startup, !STARTUP_ABSTAINS.has(key), key + ' startup verdict changed');
    if (shouldWarn) {
      protectedCount++;
      assert(worker.brand, key + ' lost its named brand');
    } else {
      allowedCount++;
    }
    if (!PAGE_ABSTAINS.has(key)) {
      assert(pageHit.brand, key + ' page detector no longer warns');
      assert(['high', 'medium'].includes(pageHit.confidence), key + ' page warning lost its confidence');
    } else {
      assert.strictEqual(pageHit.brand, '', key + ' page detector false positive returned');
    }
  }
  for (const host of ['apple.stackexchange.com', 'steam.oxfordjournals.org']) {
    assert.strictEqual(current(host, '/').startup, false, host + ' must not get a bare-subdomain startup warning');
  }
  console.log('[ok] phishing differential: ' + INTENTIONAL_DROPS.size
    + ' documented false-positive removals, ' + RESTORED_TYPOS.size + ' recovered transpositions, '
    + protectedCount + ' retained warnings, ' + allowedCount + ' allowed cases');
  runBrandMatrix();
  runHomographMatrix();
}

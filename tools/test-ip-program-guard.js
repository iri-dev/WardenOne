/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
/* Bare IP program guard: the DNR expressions must block exactly what ipProgramWarningTarget names,
   public addresses only, and "Continue anyway" may only open that one address in that one tab. */
const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const slice = (from, to) => {
  const start = source.indexOf(from), end = source.indexOf(to, start);
  assert(start > 0 && end > start, 'missing ' + from);
  return source.slice(start, end);
};
const ipHelpers = slice('function ipv4FromMappedIpv6(', 'function isLocalOrPrivateHost(');
const guard = slice('// ---- Bare IP program guard', '// ---- Certificate Guard');
const tabStill = slice('async function tabStillOnNavigation(', 'async function handleSafeBrowsingNavigation(');

function rig() {
  const state = { session: [], dynamic: [], cfg: { enabled: true }, alarms: [], history: [], updates: [], supported: true, rejectAlarm: false, tab: null, timers: [] };
  const change = (name, update) => {
    state[name] = state[name].filter((rule) => !(update.removeRuleIds || []).includes(rule.id)).concat(update.addRules || []);
  };
  const context = vm.createContext({
    URL, Date, Object, Set, Number, JSON, RegExp, String, Array, Promise, Error, console: { warn() {} },
    setTimeout: (fn, ms) => state.timers.push([fn, ms]),
    IP_PROGRAM_RULES_BUDGET: Number(/const IP_PROGRAM_RULES_BUDGET = (\d+);/.exec(source)[1]),
    IP_PROGRAM_ONCE_RULES_BUDGET: Number(/const IP_PROGRAM_ONCE_RULES_BUDGET = (\d+);/.exec(source)[1]), SAFE_BROWSING_BYPASS_TTL_MS: 60000,
    DEFAULT_CONFIG: { downloadReputation: true },
    serializeSubsystem: (_name, task) => task(), registerListener: (_name, register) => register(),
    activeAllowlist: (cfg) => cfg.allowlist || [],
    hostMatchesSite: (host, site) => host === site || host.endsWith('.' + site),
    localGet: async () => ({ wardenone_config: state.cfg }),
    getDynamicRulesInBand: async () => state.dynamic,
    dnrBandUnchanged: (a, b) => JSON.stringify(a) === JSON.stringify(b),
    writeDynamicRules: async (update) => change('dynamic', update),
    writeSessionRules: async (update) => change('session', update),
    normalizeSafeBrowsingUrl: (raw) => { try { const u = new URL(raw); u.hash = ''; return u.href; } catch (_) { return ''; } },
    tabsGet: async () => state.tab, tabsUpdate: async (id, props) => state.updates.push([id, props]),
    bumpBadge() {}, queueHistory: (entry) => state.history.push(entry),
    safeBrowsingBlockPageUrl: async (info) => 'chrome-extension://fixture/safe-browsing-block.html?w=' + JSON.stringify(info),
    chrome: {
      declarativeNetRequest: {
        getSessionRules: async () => state.session,
        isRegexSupported: async () => ({ isSupported: state.supported, reason: state.supported ? undefined : 'memoryLimitExceeded' }),
      },
      alarms: { create: async (...args) => { if (state.rejectAlarm) throw Error('alarm failed'); state.alarms.push(args); }, onAlarm: { addListener(fn) { state.expire = fn; } } },
      tabs: { onRemoved: { addListener(fn) { state.removed = fn; } } },
      webRequest: { onResponseStarted: { addListener(fn, filter) { state.responded = fn; state.respondedFilter = filter; } } },
      webNavigation: { onCommitted: { addListener(fn) { state.committed = fn; } } },
    },
  });
  vm.runInContext(ipHelpers + tabStill + guard + ';this.api={target:ipProgramWarningTarget,rules:ipProgramRules,apply:applyIpProgramRules,'
    + 'allow:allowIpProgramOnce,clear:clearIpProgramOnce,show:showIpProgramBlockPage,publicIp:normalizeIpLiteral,'
    + 'onceBase:IP_PROGRAM_ONCE_RULE_BASE,base:IP_PROGRAM_RULE_BASE,localBase:IP_PROGRAM_LOCAL_RULE_BASE,budget:IP_PROGRAM_RULES_BUDGET};', context);
  return { state, api: context.api };
}

let checks = 0;
const ok = (value, message) => { assert(value, message); checks++; };
const eq = (a, b, message) => { assert.equal(a, b, message); checks++; };

(async () => {
  const r = rig();
  const rules = r.api.rules(true);
  const blocks = rules.filter((rule) => rule.action.type === 'block');
  const allows = rules.filter((rule) => rule.action.type === 'allow');
  const compile = (list) => list.map((rule) => new RegExp(rule.condition.regexFilter, 'i'));
  const blockRes = compile(blocks), allowRes = compile(allows);
  const blockHit = (url) => blockRes.some((re) => re.test(url));
  const allowHit = (url) => allowRes.some((re) => re.test(url));
  /* Chrome's order: the higher-priority allow wins where both match. */
  const blocked = (url) => blockHit(url) && !allowHit(url);

  /* 1. Shape of the band. */
  ok(blocks.length >= 2 && blocks.length <= 30, 'a handful of small block rules, all before the allows');
  const repoBlocks = blocks.filter((rule) => /github/.test(rule.condition.regexFilter));
  ok(repoBlocks.length >= 2, 'GitHub repository program rules exist, one host per expression');
  ok(repoBlocks.every((rule) => !/githubusercontent[\s\S]*github\\\\\.com|github\\\\\.com[\s\S]*githubusercontent/.test(rule.condition.regexFilter)),
    'never both GitHub hosts in one expression: that compiled past Edge\'s limit');
  eq(allows.length, (blocks.length - repoBlocks.length) * 3, 'one allow per local range group for every bare address block, none for GitHub');
  eq(rules.length, new Set(rules.map((rule) => rule.id)).size, 'ids are unique');
  for (const rule of rules) {
    ok(rule.id >= r.api.base && rule.id < r.api.base + r.api.budget, 'rule stays in its band');
    ok(rule.condition.regexFilter.length <= 200, 'under 200 characters: Edge 157 compiled 192 and refused 215 in 2 KB');
    eq(JSON.stringify(rule.condition.resourceTypes), '["main_frame"]', 'top-level pages only');
    eq(JSON.stringify(rule.condition.requestMethods), '["get"]', 'GET only, so form posts keep their own rules');
  }
  for (const rule of blocks) {
    ok(rule.id < r.api.localBase, 'blocks come first');
    ok(rule.priority > 1900 && rule.priority < 2000, 'below threat feeds, above imported exceptions');
  }
  for (const rule of allows) {
    ok(rule.id >= r.api.localBase, 'allows after the blocks');
    eq(rule.priority, blocks[0].priority + 1, 'just above the blocks and nothing else');
  }
  eq(r.api.rules(false).length, 0, 'Download Shield off installs nothing');

  /* 1b. A local allow must never reach a page its block would not stop, or it would outrank Force HTTPS
     (priority 1) and link cleaning on ordinary local pages. */
  for (const url of ['http://192.168.1.1/', 'http://192.168.1.1/index.html', 'http://10.0.0.1/admin.php', 'http://127.0.0.1:8080/',
    'http://172.16.0.1/cgi-bin/luci', 'http://100.101.102.103/', 'http://169.254.1.1/setup', 'http://192.168.1.1/?page=status', 'http://192.168.1.1/cgi?x=a.exe.html']) {
    eq(allowHit(url), false, 'no allow for an ordinary local page: ' + url);
  }

  /* 2. Every public address, and only public ones, across all first and second octets. */
  let disagreements = 0, publicHits = 0, wideAllows = 0;
  for (let a = 0; a < 256; a++) for (let b = 0; b < 256; b++) for (const c of [0, 2, 99, 100, 113, 255]) {
    const ip = a + '.' + b + '.' + c + '.7';
    for (const path of c === 0 || c === 113 ? ['/setup.exe', '/bins/mips', '/dl?name=a.exe^'] : ['/setup.exe', '/bins/mips']) {
      const url = 'http://' + ip + path;
      const isPublic = !!r.api.publicIp(ip);
      const named = !!r.api.target(url);
      if (named !== isPublic || blocked(url) !== named) disagreements++;
      if (allowHit(url) && !blockHit(url)) wideAllows++;
      if (named) publicHits++;
    }
    if (allowHit('http://' + ip + '/index.html')) wideAllows++;
  }
  eq(disagreements, 0, 'rule expressions, ipProgramWarningTarget and normalizeIpLiteral agree on every address');
  eq(wideAllows, 0, 'no allow ever matches something its block does not');
  ok(publicHits > 600000, 'the public space really is covered');

  /* 3. Paths and names. The rule and the worker must agree on every one. */
  const cases = [
    ['http://93.184.216.34/setup.exe', true],
    ['http://93.184.216.34:5553/dva.exe', true],
    ['https://93.184.216.34/load/os1/a1b2.EXE', true],
    ['http://93.184.216.34/files/123/random.exe?x=1&y=2', true],
    ['http://93.184.216.34/bins/arm', true],
    ['http://93.184.216.34/mipsel', true],
    ['http://93.184.216.34/bins/skid.x86', true],
    ['http://93.184.216.34/frost.x86_64', true],
    ['http://93.184.216.34/g4za.arm7', true],
    ['http://93.184.216.34/tool.ps1', true],
    ['http://93.184.216.34/pack.zip', true],
    ['http://93.184.216.34:49697/Mozi.m', true],
    ['http://93.184.216.34/Mozi.a', true],
    ['http://93.184.216.34/dl?name=setup.exe', true],
    ['http://93.184.216.34/dl?name=mixthree.exe^', true],
    ['http://93.184.216.34/get.php?id=7&file=Setup.MSI&lang=en', true],
    ['http://93.184.216.34/d?f=pack.zip#top', true],
    ['http://93.184.216.34/mozilla', false],
    ['http://93.184.216.34/Mozi.mp4', false],
    ['http://93.184.216.34/search?q=setup.exe+download', false],
    ['http://93.184.216.34/view?file=report.pdf', false],
    ['http://93.184.216.34/page?x=a.exe.html', false],
    ['http://93.184.216.34/setup.exe?x=1', true],
    ['http://192.168.1.10/dl?name=setup.exe', false],
    ['http://198.51.100.23/dl?name=setup.exe', false],
    ['https://raw.githubusercontent.com/someone/tool/refs/heads/main/pdf.exe', true],
    ['https://raw.githubusercontent.com/someone/tool/main/XClient.exe', true],
    ['https://github.com/someone/tool/raw/refs/heads/main/hopeless_v4.exe', true],
    ['https://github.com/someone/tool/RAW/main/a.EXE', true],
    ['https://github.com/someone/tool/raw/x.msi?download=1', true],
    ['http://raw.githubusercontent.com/a/b/c/d.dll', true],
    ['https://github.com/someone/tool/releases/download/v1.0/setup.exe', false],
    ['https://github.com/someone/tool/blob/main/setup.exe', false],
    ['https://raw.githubusercontent.com/someone/tool/main/install.ps1', false],
    ['https://raw.githubusercontent.com/someone/tool/main/run.bat', false],
    ['https://raw.githubusercontent.com/someone/tool/main/README.md', false],
    ['https://raw.githubusercontent.com/someone/tool/main/', false],
    ['https://raw.githubusercontent.com/someone/tool.exe', false],
    ['https://objects.githubusercontent.com/github-production-release-asset/x.exe', false],
    ['https://gist.githubusercontent.com/u/abc/raw/x.exe', false],
    ['https://github.com/someone/raw/main/x.exe', false],
    ['https://www.github.com/someone/tool/raw/main/x.exe', false],
    ['https://raw.githubusercontent.com.evil.example/a/b/c/x.exe', false],
    ['http://93.184.216.34/', false],
    ['http://93.184.216.34/index.html', false],
    ['http://93.184.216.34/login', false],
    ['http://93.184.216.34/stub.txt', false],
    ['http://93.184.216.34/farm', false],
    ['http://93.184.216.34/setup.exe/', false],
    ['http://93.184.216.34/setup.exe.txt', false],
    ['http://93.184.216.34.nip.io/setup.exe', false],
    ['https://example.com/setup.exe', false],
    ['http://192.168.1.10/setup.exe', false],
    ['http://10.0.0.5/bins/arm', false],
    ['http://127.0.0.1/setup.exe', false],
    ['http://198.51.100.23:5553/setup.exe', false],
    ['http://203.0.113.9/build.exe', false],
    ['http://192.0.2.44/x86', false],
    ['http://100.64.1.1/setup.exe', false],
    ['http://169.254.1.1/setup.exe', false],
    ['http://172.20.0.1/setup.exe', false],
    ['http://224.0.0.1/setup.exe', false],
    ['http://user:pw@93.184.216.34/setup.exe', false],
    ['ftp://93.184.216.34/setup.exe', false],
  ];
  for (const [url, expected] of cases) {
    eq(!!r.api.target(url), expected, 'worker: ' + url);
    /* Chrome never puts the fragment in the address a rule sees. */
    if (!/@|^ftp:/.test(url)) eq(blocked(new URL(url).href.replace(/#.*$/, '')), expected, 'rule: ' + url);
  }
  eq(r.api.target('http://93.184.216.34/setup.exe#frag'), 'http://93.184.216.34/setup.exe', 'the hash never reaches the record');

  /* 3b. GitHub shapes: the rule and the worker agree on every combination. */
  let repoDisagree = 0, repoHits = 0;
  for (const host of ['raw.githubusercontent.com', 'github.com', 'www.github.com', 'gist.githubusercontent.com', 'githubusercontent.com']) {
    for (const path of ['/o/r/main/x.exe', '/o/r/raw/main/x.exe', '/o/r/raw/x.exe', '/o/r/x.exe', '/o/x.exe', '/o/r/main/x.js',
      '/o/r/releases/download/v1/x.exe', '/o/r/blob/main/x.exe', '/o/r/main/x.exe/', '/o/r/main/x.exe?raw=1', '//r/main/x.exe',
      '/o/r/Raw/main/x.APK', '/o/r/main/sub/dir/x.iso', '/o/r/main/x.exe.txt']) {
      const url = 'https://' + host + path;
      const named = !!r.api.target(url);
      if (named !== blocked(new URL(url).href)) repoDisagree++;
      if (named) repoHits++;
    }
  }
  eq(repoDisagree, 0, 'GitHub rules and ipProgramWarningTarget agree on every shape');
  ok(repoHits >= 8, 'and the repository shapes really are caught');

  /* 4. Applying and clearing the band. */
  ok(await r.api.apply(true), 'apply succeeds');
  eq(r.state.dynamic.length, rules.length, 'every rule installed');
  r.state.session.push({ id: r.api.onceBase, condition: { tabIds: [5] } });
  ok(await r.api.apply(false), 'switching off succeeds');
  eq(r.state.dynamic.length, 0, 'switching off removes the band');
  eq(r.state.session.length, 0, 'switching off also ends any continue grant');
  const r2 = rig();
  r2.state.supported = false;
  eq(await r2.api.apply(true), false, 'an expression Chrome refuses is reported, not half written');
  eq(r2.state.dynamic.length, 0, 'nothing written when an expression is unsupported');

  /* 5. Continue anyway: one exact address, one tab, under the ceiling, with an expiry. */
  const target = 'http://93.184.216.34:8000/files/a/build.exe?id=1';
  eq(await r.api.allow(3, 'https://example.com/setup.exe'), false, 'a named host cannot be granted through this path');
  eq(await r.api.allow(3, 'http://192.168.1.10/setup.exe'), false, 'a private address cannot be granted');
  eq(await r.api.allow(-1, target), false, 'no tab, no grant');
  eq(r.state.session.length, 0, 'refusals write nothing');
  ok(await r.api.allow(3, target), 'a guarded address can be continued once');
  eq(r.state.session.length, 1, 'one allow');
  const allow = r.state.session[0];
  eq(allow.action.type, 'allow', 'allow');
  ok(allow.priority > rules[0].priority && allow.priority < 2000, 'beats only the guard and stays an automatic exception');
  eq(JSON.stringify(allow.condition.tabIds), '[3]', 'that tab only');
  eq(JSON.stringify(allow.condition.resourceTypes), '["main_frame"]', 'documents only');
  eq(allow.condition.isUrlFilterCaseSensitive, true, 'exact case');
  const exact = new RegExp(allow.condition.regexFilter);
  ok(exact.test(target), 'matches the address');
  ok(exact.test(target.replace('http:', 'https:')), 'and the same address after the browser upgrades it to https');
  ok(!exact.test(target + '&more') && !exact.test(target.replace('build', 'other'))
    && !exact.test(target.replace('93.184.216.34', '93.184.216.35')) && !exact.test('ftp' + target.slice(4)), 'matches nothing else');
  eq(r.state.alarms.length, 1, 'expiry scheduled');
  ok(r.state.alarms[0][1].when - Date.now() <= 60000, 'expires within a minute');
  ok(await r.api.allow(3, 'http://93.184.216.34/other.exe'), 'a second grant for the same tab');
  eq(r.state.session.length, 1, 'replaces the first instead of stacking');
  ok(await r.api.allow(4, target), 'another tab');
  eq(r.state.session.length, 2, 'tabs are separate');
  await r.api.clear(3);
  eq(r.state.session.length, 1, 'clearing a tab leaves the others');
  eq(r.state.session[0].condition.tabIds[0], 4, 'tab 4 kept');
  r.state.expire({ name: 'wardenone-ip-program-once:4' }); await new Promise((resolve) => setImmediate(resolve));
  eq(r.state.session.length, 0, 'the alarm ends the grant');
  r.state.rejectAlarm = true;
  eq(await r.api.allow(6, target), false, 'without an expiry the grant is withdrawn');
  eq(r.state.session.length, 0, 'withdrawn');
  r.state.rejectAlarm = false;
  ok(await r.api.allow(7, target), 'grant for the commit check');
  r.state.committed({ frameId: 0, tabId: 7, url: target.replace('http:', 'https:') }); await new Promise((resolve) => setImmediate(resolve));
  eq(r.state.session.length, 1, 'the continued page committing (after Edge\'s https upgrade) keeps its allow for the recheck');
  r.state.committed({ frameId: 0, tabId: 7, url: 'https://example.com/' }); await new Promise((resolve) => setImmediate(resolve));
  eq(r.state.session.length, 0, 'the next real page in that tab ends the grant');
  ok(await r.api.allow(12, target), 'grant for the used check');
  eq(JSON.stringify(r.state.respondedFilter && r.state.respondedFilter.types), '["main_frame"]', 'only page answers are watched');
  r.state.responded({ tabId: 12, url: 'https://example.com/' });
  eq(r.state.timers.length, 0, 'an unrelated answer starts nothing');
  r.state.responded({ tabId: 12, url: target.replace('http:', 'https:') });
  eq(r.state.timers.length, 1, 'the continued visit getting its answer starts the countdown');
  ok(r.state.timers[0][1] >= 2000 && r.state.timers[0][1] <= 10000, 'a few seconds, enough for the https recheck');
  eq(r.state.session.length, 1, 'still allowed while the recheck runs');
  r.state.timers.shift()[0](); await new Promise((resolve) => setImmediate(resolve));
  eq(r.state.session.length, 0, 'then the grant is spent, so a second visit is stopped again');
  ok(await r.api.allow(8, target), 'grant for the close check');
  r.state.removed(8); await new Promise((resolve) => setImmediate(resolve));
  eq(r.state.session.length, 0, 'closing the tab ends the grant');
  ok(await r.api.allow(13, 'https://github.com/o/tool/raw/refs/heads/main/x.exe'), 'a GitHub program can be continued');
  const repoGrant = new RegExp(r.state.session[r.state.session.length - 1].condition.regexFilter);
  ok(repoGrant.test('https://github.com/o/tool/raw/refs/heads/main/x.exe'), 'the link itself');
  ok(repoGrant.test('https://raw.githubusercontent.com/o/tool/refs/heads/main/x.exe'), 'and where GitHub redirects it');
  ok(!repoGrant.test('https://raw.githubusercontent.com/o/tool/refs/heads/main/y.exe')
    && !repoGrant.test('https://raw.githubusercontent.com/other/tool/refs/heads/main/x.exe'), 'nothing else');
  await r.api.clear(13);
  const full = rig();
  for (let i = 0; i < 16; i++) full.state.session.push({ id: full.api.onceBase + i, condition: { tabIds: [100 + i] } });
  eq(await full.api.allow(1, target), false, 'a full band refuses rather than overwriting another tab');

  /* 6. The block page hand off. */
  const page = rig();
  page.state.tab = { pendingUrl: 'http://93.184.216.34/setup.exe' };
  ok(await page.api.show({ tabId: 9 }, 'http://93.184.216.34/setup.exe'), 'shows the page');
  eq(page.state.history[0].type, 'blocked_ip_program', 'logged under its own event');
  eq(page.state.updates.length, 1, 'tab sent to the block page');
  const info = JSON.parse(decodeURIComponent(page.state.updates[0][1].url.split('?w=')[1]));
  eq(info.ipProgram, true, 'the record marks it so Continue can open the network rule');
  eq(info.context, 'page', 'page context so Continue is offered');
  eq(info.provider, 'WardenOne program check', 'names its own check');
  eq(info.ipProgramKind, 'ip', 'a bare address is marked as one');
  const repoPage = rig();
  repoPage.state.tab = { pendingUrl: 'https://raw.githubusercontent.com/o/tool/main/x.exe' };
  ok(await repoPage.api.show({ tabId: 21 }, 'https://raw.githubusercontent.com/o/tool/main/x.exe'), 'GitHub program page shown');
  eq(repoPage.state.history[0].type, 'blocked_repo_program', 'logged under its own event');
  ok(/GitHub repository/.test(repoPage.state.history[0].detail.why), 'and says so');
  const repoInfo = JSON.parse(decodeURIComponent(repoPage.state.updates[0][1].url.split('?w=')[1]));
  eq(repoInfo.ipProgramKind, 'repo', 'the record tells the page which kind it is');
  eq(repoInfo.threats, 'PROGRAM_FROM_REPOSITORY', 'named threat');
  eq(info.ipProgramBeforeSending, false, 'with no network rules installed the page may not claim the request never left');
  eq(page.state.history[0].detail.beforeSending, false, 'and neither may the activity entry');
  ok(await page.api.apply(true), 'install the rules');
  ok(await page.api.show({ tabId: 9 }, 'http://93.184.216.34/setup.exe'), 'shows the page again');
  const installed = JSON.parse(decodeURIComponent(page.state.updates[1][1].url.split('?w=')[1]));
  eq(installed.ipProgramBeforeSending, true, 'with the rules in place it can say so');
  eq(await page.api.show({ tabId: 9 }, 'https://example.com/setup.exe'), false, 'other addresses fall through to reputation checks');
  page.state.tab = { url: 'https://93.184.216.34/setup.exe' };
  const before = page.state.updates.length;
  ok(await page.api.show({ tabId: 9 }, 'http://93.184.216.34/setup.exe'), 'handled');
  eq(page.state.updates.length, before + 1, 'Edge\'s own https upgrade of the visit still gets the page');
  page.state.tab = { url: 'https://example.com/elsewhere' };
  ok(await page.api.show({ tabId: 9 }, 'http://93.184.216.34/setup.exe'), 'handled');
  eq(page.state.updates.length, before + 1, 'a tab that has moved on is left alone');
  page.state.tab = { url: 'https://93.184.216.34/setup.exe' };
  ok(await page.api.allow(9, 'http://93.184.216.34/setup.exe'), 'the person continues');
  const continued = page.state.updates.length;
  ok(await page.api.show({ tabId: 9 }, 'https://93.184.216.34/setup.exe'), 'handled');
  eq(page.state.updates.length, continued, 'the upgraded second start of a continued visit is not sent back to the page');
  ok(await page.api.show({ tabId: 10 }, 'https://93.184.216.34/setup.exe'), 'handled');
  eq(page.state.updates.length, continued + 1, 'another tab still gets the page');
  await page.api.clear(9);
  page.state.tab = { pendingUrl: 'http://93.184.216.34/setup.exe' };
  page.state.cfg = { enabled: true, downloadReputation: false };
  eq(await page.api.show({ tabId: 9 }, 'http://93.184.216.34/setup.exe'), false, 'Download Shield off shows nothing');
  page.state.cfg = { enabled: true, allowlist: ['93.184.216.34'] };
  eq(await page.api.show({ tabId: 9 }, 'http://93.184.216.34/setup.exe'), false, 'an allowlisted address is left alone');

  /* 7. Wiring the slices cannot see. */
  const nav = slice('async function handleSafeBrowsingNavigation(', 'async function checkVirusTotalUrl(');
  ok(nav.indexOf('showIpProgramBlockPage(details, url, tabAtStart)') > 0
    && nav.indexOf('showIpProgramBlockPage(details, url, tabAtStart)') < nav.indexOf('await urlReputationConfig()'),
    'the page check runs before the keyed reputation gate, so it works with no API keys');
  ok(nav.indexOf('consumeSafeBrowsingBypass') < nav.indexOf('showIpProgramBlockPage'), 'a granted continue is consumed first');
  const bypass = slice('function addSafeBrowsingBypass(', 'async function handleSafeBrowsingNavigation(');
  ok(/rec\.ipProgram === true && !await allowIpProgramOnce\(tabId, rec\.url\)/.test(bypass), 'continue opens the network rule');
  ok(bypass.indexOf('allowIpProgramOnce') < bypass.indexOf('chrome.storage.session.remove(key)'), 'a failed grant keeps the warning usable');
  ok(/run\('ipProgramGuard', \(\) => applyIpProgramRules\(on && cfg\.downloadReputation !== false\)/.test(source), 'refresh applies the band from Download Shield');
  ok(/\[IP_PROGRAM_RULE_BASE, IP_PROGRAM_RULES_BUDGET\]/.test(slice('function ownDynamicRuleBands()', 'async function getDynamicRulesInBand(')), 'band is read back as WardenOne\'s own');
  ok(/IP_PROGRAM_RULE_BASE && id < IP_PROGRAM_RULE_BASE \+ IP_PROGRAM_RULES_BUDGET/.test(source), 'master off removes the band');
  ok(/const TOTAL_DYNAMIC_BUDGET = [^;]*\+ IP_PROGRAM_RULES_BUDGET\b/.test(source)
    && /const TOTAL_SESSION_BUDGET = [^;]*\+ IP_PROGRAM_ONCE_RULES_BUDGET\b/.test(source), 'both bands are in the rule budget');
  ok(/blocked_ip_program: '/.test(fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8'))
    && /blocked_repo_program: '/.test(fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8')), 'Activity Center labels');
  ok(/add\('blocked_ip_program blocked_repo_program', 'downloadReputation'\)/.test(fs.readFileSync(path.join(ROOT, 'protection-event-settings.js'), 'utf8')), 'events owned by Download Shield');

  /* 8. The block page copy, run against a small fake document. */
  async function renderPage(record) {
    const els = {};
    const el = (id) => els[id] || (els[id] = { id, textContent: '', hidden: false, attrs: {}, addEventListener() {}, setAttribute(k, v) { this.attrs[k] = v; }, removeAttribute(k) { delete this.attrs[k]; }, hasAttribute(k) { return k in this.attrs; }, focus() {} });
    const doc = { title: '', getElementById: el };
    const ctx = vm.createContext({
      document: doc, location: { search: '?w=' + 'a'.repeat(32), href: '' }, history: { length: 1, back() {} }, window: {},
      URL, URLSearchParams, String, Promise, setInterval() {}, clearInterval() {}, encodeURIComponent,
      chrome: { runtime: { lastError: null, getURL: (f) => f, sendMessage() {} }, tabs: { create() {} },
        storage: { session: { get: (key, cb) => cb({ [key]: record }) } } },
    });
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'safe-browsing-block.js'), 'utf8'), ctx);
    await new Promise((resolve) => setImmediate(resolve));
    return { els, doc };
  }
  const shown = await renderPage({ kind: 'safe-browsing', url: 'http://93.184.216.34/setup.exe', shown: '93.184.216.34/setup.exe',
    provider: 'WardenOne program check', threats: 'PROGRAM_FROM_BARE_IP', context: 'page', ipProgram: true, ipProgramBeforeSending: true });
  eq(shown.els.provider.textContent, 'Blocked by WardenOne program check', 'no doubled WardenOne badge');
  eq(shown.els.title.textContent, 'Program Download Stopped', 'program title');
  ok(/bare IP address/.test(shown.els.reason.textContent), 'plain reason');
  ok(/before it was sent/.test(shown.els.risk.textContent), 'says what did not happen');
  const late = await renderPage({ kind: 'safe-browsing', url: 'http://93.184.216.34/setup.exe', shown: '93.184.216.34/setup.exe',
    provider: 'WardenOne program check', threats: 'PROGRAM_FROM_BARE_IP', context: 'page', ipProgram: true, ipProgramBeforeSending: false });
  ok(!/before it was sent|never/.test(late.els.risk.textContent) && /Download Shield holds it/.test(late.els.risk.textContent),
    'without the network rules the page claims only what is true');
  ok(/Download Shield still checks/.test(shown.els['escape-text'].textContent), 'continuing is not the end of the checks');
  ok(!/reputation hit/.test(shown.els.foot.textContent), 'a local check is not called an external hit');
  const repoShown = await renderPage({ kind: 'safe-browsing', url: 'https://raw.githubusercontent.com/o/tool/main/x.exe', shown: 'raw.githubusercontent.com/o/tool/main/x.exe',
    provider: 'WardenOne program check', threats: 'PROGRAM_FROM_REPOSITORY', context: 'page', ipProgram: true, ipProgramBeforeSending: true, ipProgramKind: 'repo' });
  ok(/GitHub repository/.test(repoShown.els.reason.textContent) && /Releases/.test(repoShown.els.reason.textContent), 'GitHub reason');
  ok(/publish them as releases/.test(repoShown.els['escape-text'].textContent), 'GitHub continue text');
  ok(!/bare IP/.test(repoShown.els.reason.textContent), 'not the bare address wording');
  const local = await renderPage({ kind: 'safe-browsing', url: 'https://bad.example/', shown: 'bad.example/',
    provider: 'WardenOne local malware and scam list', threats: 'MALWARE_OR_SCAM', context: 'page' });
  eq(local.els.provider.textContent, 'Blocked by WardenOne local malware and scam list', 'the old doubled badge is fixed too');
  eq((local.els.title || { textContent: '' }).textContent, '', 'other blocks keep the page title');
  const external = await renderPage({ kind: 'safe-browsing', url: 'https://bad.example/', shown: 'bad.example/',
    provider: 'Google Safe Browsing', threats: 'MALWARE', context: 'page' });
  eq(external.els.provider.textContent, 'Blocked by WardenOne + Google Safe Browsing', 'external providers keep the pairing');
  eq(external.els.foot.textContent, '', 'external hits keep the page\'s own footnote');
  const pageCopy = fs.readFileSync(path.join(ROOT, 'safe-browsing-block.html'), 'utf8')
    + fs.readFileSync(path.join(ROOT, 'safe-browsing-block.js'), 'utf8').replace(/^\/\*[\s\S]*?\*\//, '');
  ok(!/&mdash;|—/.test(pageCopy), 'no em dashes in the page copy (the licence header keeps its own)');

  console.log('[ok] bare IP program guard: ' + checks + ' checks');
})().catch((error) => { console.error(error); process.exit(1); });

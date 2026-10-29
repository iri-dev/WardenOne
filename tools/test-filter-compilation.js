/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const { makeParser, sourceSnapshot } = require('./build-cosmetics.js');
const { loadNetworkParser } = require('./bench-filter-parsing.js');
const { fixtures } = require('./lib/filter-compilation-fixtures.js');
const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const api = makeParser(background);
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const counts = state => [state.count, state.procCount, state.scriptletCount];

async function run() {
  const paths = [
    ['passive', api.compilePassiveCosmeticRule, ['##.ad', 'site.example##.ad', 'site.example#@#.ad']],
    ['procedural', api.compileProceduralCosmeticRule, ['site.example#?#.ad:has-text(sponsor)', 'site.example#$#.ad { display: none; }']],
    ['scriptlet', api.compileScriptletRule, ['site.example##+js(aopr, key)', 'site.example#%#//scriptlet("set", "key", "true")']],
  ];
  for (const [kind, compile, inputs] of paths) {
    for (const input of inputs) {
      const state = api.createCosmeticCompilation(), rule = api.classifyCosmeticFilterLine(input);
      assert.strictEqual(rule.kind, kind, input);
      for (const [otherKind, otherCompile] of paths) {
        if (otherKind === kind) continue;
        assert.strictEqual(otherCompile(state, rule), false, 'wrong compiler accepted ' + input);
        assert.deepStrictEqual(counts(state), [0, 0, 0]);
      }
      assert.strictEqual(compile(state, rule), true, input);
      assert.strictEqual(counts(state)[paths.findIndex(([name]) => name === kind)], 1);
    }
  }
  for (const input of ['site.example#^#script', 'site.example#@?#.ad', 'site.example#$# log', 'site.example##<script>', 'site.example##',
    'site.example#^#script[data-label="##"]', 'site.example#@?#.ad:has-text("##")',
    'site.example#@$#.ad { content: "##"; }', 'site.example#@%#//scriptlet("aopr", "##")']) {
    const state = api.createCosmeticCompilation(), rule = api.classifyCosmeticFilterLine(input);
    assert.strictEqual(rule.kind, 'unsupported', input);
    for (const [, compile] of paths) assert.strictEqual(compile(state, rule), false, input);
    assert.deepStrictEqual(counts(state), [0, 0, 0]);
  }
  for (const input of ['site.example##+js(unknown-scriptlet, key)', 'site.example##+js(set-cookie, consent, yes)',
    'site.example##+js(set-local-storage-item, consent, yes)', 'site.example##+js(aopr, a, b, c, d, e, f, g)']) {
    const state = api.createCosmeticCompilation();
    assert.strictEqual(api.compileScriptletRule(state, api.classifyCosmeticFilterLine(input)), false, input);
    assert.deepStrictEqual(counts(state), [0, 0, 0]);
    assert.strictEqual(Object.keys(state.specific).length, 0, 'rejected scriptlet fell back to CSS');
  }
  const genericProcedural = api.createCosmeticCompilation();
  assert.strictEqual(api.compileProceduralCosmeticRule(genericProcedural, api.classifyCosmeticFilterLine('##.ad:remove()')), false);
  const aliases = api.createCosmeticCompilation();
  api.compileScriptletRule(aliases, api.classifyCosmeticFilterLine('site.example,~other.example##+js(aopr, key\\,value)'));
  assert.deepStrictEqual(plain(aliases.scriptlets), { 'site.example': [{ name: 'abort-on-property-read', args: ['key,value'] }] });

  const beforeHashes = {
    mixed: '812e46c723d4450ae195a3bc7ecb9a254a84fb1ad25631d39e6c32ea4fb35f3e',
    separators: '180e5d5a001a3c0cb14f06ccb4299c07b3b03ebff5a5b535c134cc1c067dd277',
    budgets: '64e3664df04fe53d6d75665fc979690abed95c9159ef9245ef5015f5557f6f9e',
    chunks: '4585cf4a11f42e9172630e06ce5e65893c8420f488b055fb5504ba95da5c3baa',
  };
  for (const fixture of fixtures()) {
    const parsed = api.parseCosmeticFilters(fixture.chunks);
    assert.strictEqual(hash(parsed), beforeHashes[fixture.name], 'compilation changed established ' + fixture.name + ' behavior');
    assert.deepStrictEqual(plain(api.compilePackagedCosmetics(fixture.chunks)), plain(api.packagedCosmeticRules(parsed)));
    const passive = api.passiveCosmeticRules(parsed);
    assert.deepStrictEqual(Object.keys(passive).sort(), ['exceptions', 'generic', 'genericHideExclusions', 'specific']);
    assert.deepStrictEqual(Object.keys(api.packagedCosmeticRules(parsed)).sort(), ['procedural', 'scriptlets']);
    if (fixture.name === 'budgets') assert(parsed.genericHideExclusions.includes('after-budgets.example'));
  }
  const snapshot = sourceSnapshot(), commands = api.compilePackagedCosmetics(snapshot.sources.map(source => source.text));
  const packaged = JSON.parse(fs.readFileSync(path.join(root, 'cosmetic-rules.json'), 'utf8'));
  assert.deepStrictEqual(plain(commands), { scriptlets: packaged.scriptlets, procedural: packaged.procedural });

  const network = loadNetworkParser(background);
  const input = ['plain.example', 'github.io', 'tenant.github.io', '||ads.example^$script,third-party',
    '@@||cdn.example^$xhr,domain=site.example', '@@||broad.example^$script',
    '||unsupported.example^$csp=script-src', '||overflow.example^$image',
    'site.example#^#script', 'site.example##+js(aopr, key)', 'site.example#?#.ad:remove()'].join('\n');
  const compiled = await network.compileRemoteNetworkSource(input, 2);
  assert.deepStrictEqual(plain(compiled.domains), ['plain.example', 'tenant.github.io']);
  assert.deepStrictEqual(plain(compiled.optionRules), plain(network.parseNetworkRules(input, 0, 2)));
  assert.deepStrictEqual(plain(compiled.optionRules.map(rule => rule.action.type)), ['block', 'allow']);
  assert.deepStrictEqual(Object.keys(compiled).sort(), ['domains', 'optionRules']);
  assert.deepStrictEqual(plain((await network.compileRemoteNetworkSource(input, 0)).optionRules), []);

  const hostile = [
    '/tracker[0-9]+/$script', '/another.+/$image', '/^tracker$/$script', '/tracking/i$script',
    '@@/allow.+/$xhr,domain=site.example',
    '||bad.example^$script,domain=bad..example', '||bad.example^$script,domain=*.example',
    '||bad.example^$script,domain=site.example|~', '||bad.example^$script,domain=site.example=other.example',
    '||bad.example^$script,domain=-site.example', '||bad.example^$script,redirect=payload',
    '||first.example^$script,domain=site.example|~other.example',
    '||second.example^$image', '||third.example^$xhr',
  ].join('\n');
  const hostileRules = plain(network.parseNetworkRules(hostile, 500, 2));
  assert.deepStrictEqual(hostileRules.map(rule => rule.id), [500, 501], 'rejected lines consume neither quota nor rule IDs');
  assert.deepStrictEqual(hostileRules.map(rule => rule.condition.urlFilter), ['||first.example^', '||second.example^']);
  assert.deepStrictEqual(hostileRules[0].condition.initiatorDomains, ['site.example']);
  assert.deepStrictEqual(hostileRules[0].condition.excludedInitiatorDomains, ['other.example']);
  assert.deepStrictEqual(plain(network.parseNetworkRules(hostile, 500, 1)).map(rule => rule.id), [500]);
  assert.deepStrictEqual(plain(network.parseNetworkRules('/asset.js$script', 700, 1)).map(rule => rule.condition.urlFilter), ['/asset.js']);

  const storage = {}, telemetry = [], lifecycle = { retain: 0, release: 0, invalidations: 0 };
  const remoteText = fixtures()[0].chunks.join('\n');
  const box = vm.createContext({
    ADSHIELD_COSMETIC_LISTS: ['https://lists.example/cosmetics.txt'],
    LIST_FETCH_TIMEOUT_MS: 1000,
    LIST_BROKER: { retain() { lifecycle.retain++; }, release() { lifecycle.release++; } },
    fetchValidatedRemoteListText: async () => ({ ok: true, text: remoteText }),
    localGet: async () => storage,
    localSet: async values => Object.assign(storage, plain(values)),
    parseListPublisherDate: () => null, listSourcePublications: () => [],
    sha256TextHex: async value => crypto.createHash('sha256').update(value).digest('hex'),
    writeStorageTelemetry: async event => telemetry.push(event), pruneStorageIfNeeded: async () => {},
    invalidateCosmeticCache() { lifecycle.invalidations++; }, console,
  });
  const start = background.indexOf('const ADSHIELD_COSMETIC_MAX');
  const end = background.indexOf('// ======================= Cosmetic serving cache', start);
  assert(start >= 0 && end > start);
  vm.runInContext(background.slice(start, end) + '\nthis.refresh = updateAdShieldCosmetics;', box);
  await box.refresh();
  assert.deepStrictEqual(storage.wardenone_adshield_cosmetic, plain(api.passiveCosmeticRules(api.parseCosmeticFilters(remoteText))));
  assert(!('scriptlets' in storage.wardenone_adshield_cosmetic) && !('procedural' in storage.wardenone_adshield_cosmetic));
  await box.refresh();
  assert(telemetry.includes('adshield-cosmetic-unchanged'));
  assert.deepStrictEqual(lifecycle, { retain: 2, release: 2, invalidations: 1 });
  console.log('[ok] independent compilation paths, unsupported syntax, source projections, limits, output parity and live-refresh authority');
}

run().catch(error => { console.error(error); process.exitCode = 1; });

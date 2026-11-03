/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';

/* 2026-10-31: Smart Script Shield left FileDitch blank by refusing fileditchassets.b-cdn.net, the site's own
   folder on BunnyCDN. A folder a site names after itself on a shared CDN is now recognised as the site's own. */
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const BG = fs.readFileSync('background.js', 'utf8');
const BRIDGE = fs.readFileSync('bridge.js', 'utf8');
const fn = (name) => {
  const at = BG.indexOf('\nfunction ' + name + '(') >= 0 ? BG.indexOf('\nfunction ' + name + '(') : BG.indexOf('\nasync function ' + name + '(');
  assert(at >= 0, name + ' not found');
  return BG.slice(at, BG.indexOf('\n}\n', at) + 3);
};
const literal = (name) => {
  const m = new RegExp('const ' + name + ' = (\\[[\\s\\S]*?\\]);').exec(BG);
  assert(m, name + ' not found');
  return 'const ' + name + ' = ' + m[1] + ';';
};

let pass = 0;
function check(name, run) {
  try { run(); pass++; console.log('  ok  - ' + name); } catch (e) { console.error('FAIL - ' + name + '\n' + (e.stack || e)); process.exit(1); }
}

const box = {
  // Registrable domain for the hosts used here; the worker's own uses the full suffix list.
  siteIdentityBg: (host) => String(host).split('.').slice(-2).join('.'),
  cleanSmartScriptExactHost: (host) => String(host || '').toLowerCase(),
  store: {}, applied: 0,
};
vm.createContext(box);
vm.runInContext(literal('SHARED_CDN_ZONE_SUFFIXES') + 'const SCRIPT_OWN_ZONES_KEY = "k"; const SCRIPT_OWN_ZONES_MAX = 100;'
  + 'async function localGet() { return { k: this.store.k }; }'
  + 'async function localSet(o) { Object.assign(this.store, o); return { persisted: true }; }'
  + 'async function applyScriptShieldRules() { this.applied++; return true; }'
  + fn('scriptShieldZoneOwnedBySite') + fn('scriptShieldOwnZoneEntries') + fn('rememberScriptShieldOwnZones')
  + 'this.owned = scriptShieldZoneOwnedBySite; this.remember = rememberScriptShieldOwnZones;', box);

check('a folder named after the site on a shared CDN is the site\'s own', () => {
  assert(box.owned('fileditchassets.b-cdn.net', 'fileditchfiles.st'));
  assert(box.owned('fileditchassets.b-cdn.net', 'www.fileditch.com'));
  assert(box.owned('myshop-static.netlify.app', 'myshop.com'));
});

check('a stranger on the same CDN, or a shared generic word, is not', () => {
  assert(!box.owned('adsterra.b-cdn.net', 'fileditchfiles.st'), 'an ad network folder on the same CDN');
  assert(!box.owned('video.b-cdn.net', 'videoplayer.com'), 'a short generic word');
  assert(!box.owned('d1234abcd.cloudfront.net', 'fileditchfiles.st'), 'a CDN whose folder names are not chosen by the site');
  assert(!box.owned('fileditchassets.example.net', 'fileditchfiles.st'), 'not a shared CDN at all');
});

(async () => {
  assert.strictEqual(await box.remember(['fileditchassets.b-cdn.net'], 'fileditchfiles.st'), true, 'a new folder applies the rules');
  assert.strictEqual(box.applied, 1);
  assert.deepStrictEqual(JSON.parse(JSON.stringify(box.store.k.map((e) => [e.site, e.zone]))), [['fileditchfiles.st', 'fileditchassets.b-cdn.net']], 'saved with the site it belongs to, so erasing the site erases it');
  assert.strictEqual(await box.remember(['fileditchassets.b-cdn.net'], 'fileditchfiles.st'), false, 'a known folder never asks for another reload');
  assert.strictEqual(box.applied, 1);
  box.store.k = [{ site: 'fileditchfiles.st', zone: 'adsterra.b-cdn.net' }];
  vm.runInContext('this.entries = scriptShieldOwnZoneEntries;', box);
  assert.deepStrictEqual(box.entries(box.store.k), [], 'a stored folder that does not belong to its site is ignored');
  check('a folder is remembered once, so the page reloads once', () => {});

  check('the worker skips remembered folders and tells the page to reload only for a new one', () => {
    assert(/SCRIPT_SHIELD_SISTER_HOSTS,\s*SCRIPT_SHIELD_OWN_ZONE_HOSTS\)/.test(fn('buildScriptShieldRulePlan')), 'remembered folders join Smart\'s exclusions');
    assert(/await loadScriptShieldOwnZones\(\);/.test(BG), 'the folders load before the rules are built');
    const status = fn('handleSmartScriptPageStatus');
    assert(/scriptShieldZoneOwnedBySite\(host, explain\.host\)/.test(status)
      && /await rememberScriptShieldOwnZones\(own, explain\.host\)\) return \{ ok: true, refused: 0, reload: true \}/.test(status),
    'only a newly remembered folder answers with a reload');
    assert(/res\.reload === true\) \{\s*try \{ location\.reload\(\); \} catch \(_\) \{\}\s*return;/.test(BRIDGE), 'the page reloads on that answer');
    assert(/'fileditchassets\.b-cdn\.net',/.test(literal('SCRIPT_SHIELD_FIRST_PARTY_APP_HOSTS')), 'FileDitch works on the first visit');
  });

  check('the folder store is registered for private windows and site erase', () => {
    assert(/INCOGNITO_EPHEMERAL_LOCAL_KEYS = new Set\(\[[\s\S]*?'wardenone_script_own_zones',[\s\S]*?\]\);/.test(BG));
    assert(/siteErase: 'prune', keys: \[\s*'wardenone_script_own_zones',\s*\]/.test(BG));
  });

  check('fingerprint-script blocking stands aside on ChatGPT', () => {
    const rules = fn('applyFingerprintScriptRules');
    assert(/excludedInitiatorDomains: LOGIN_COMPAT_NEVER_BLOCK_DOMAINS\.concat\(CHATGPT_COMPAT_DOMAINS\)/.test(rules), 'by initiator');
    // Its reply runner answers from an opaque-origin sandbox, whose initiator is null and matches no
    // initiator exclusion, so the hosts it loads code from have to be excluded by request domain too.
    assert(/excludedRequestDomains: CHATGPT_COMPAT_DOMAINS/.test(rules), 'and by request domain, for the sandboxed runner');
    const hosts = vm.runInNewContext('JSON.stringify(' + /const CHATGPT_COMPAT_DOMAINS = (\[[^\]]*\]);/.exec(BG)[1] + ')');
    assert.strictEqual(hosts, JSON.stringify(['chatgpt.com', 'openai.com', 'oaistatic.com', 'oaiusercontent.com']));
  });

  console.log('\n' + pass + ' passed, 0 failed');
})().catch((e) => { console.error(e.stack || e); process.exit(1); });

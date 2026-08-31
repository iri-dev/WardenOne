/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/*
 * Private-window persistence regression tests.
 * Run: node tools/test-incognito-isolation.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const DOWNLOADS = fs.readFileSync(path.join(ROOT, 'background-downloads.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

function grabFn(source, name) {
  const at = source.indexOf('function ' + name);
  assert(at >= 0, name + ' is missing');
  let depth = 0;
  let opened = false;
  for (let i = at; i < source.length; i++) {
    if (source[i] === '{') { depth++; opened = true; }
    if (source[i] === '}') {
      depth--;
      if (opened && depth === 0) return source.slice(at, i + 1);
    }
  }
  throw new Error(name + ' is unterminated');
}

function payloadApi(incognito) {
  const start = SOURCE.indexOf('const INCOGNITO_EPHEMERAL_LOCAL_KEYS');
  const end = SOURCE.indexOf('\nfunction localSet', start);
  assert(start >= 0 && end > start, 'incognito local-write policy markers moved');
  const sandbox = { Set, Object, String, INCOGNITO_CONTEXT: incognito };
  vm.createContext(sandbox);
  vm.runInContext(SOURCE.slice(start, end) + '\nthis.filter=persistentLocalPayload;', sandbox);
  return sandbox.filter;
}

assert.strictEqual(MANIFEST.incognito, 'split', 'incognito does not get a separately identifiable worker');
assert(/chrome\.extension\s*&&\s*chrome\.extension\.inIncognitoContext/.test(SOURCE),
  'worker does not derive private context from Chrome');

const filter = payloadApi(true);
const filtered = filter({
  wardenone_history: [{ url: 'https://private.example/' }],
  wardenone_learned: { 'private.example': {} },
  wardenone_tracker_learner: { domains: { 'tracker.example': {} } },
  wardenone_domain_age_cache: { 'private.example': {} },
  wardenone_whoisxml_cache: { 'private.example': {} },
  wardenone_safe_browsing_cache: { 'private.example': {} },
  wardenone_phishtank_cache: { 'private.example': {} },
  wardenone_abuseipdb_cache: { 'private.example': {} },
  wardenone_urlhaus_cache: { 'private.example': {} },
  wardenone_whoisxml_reputation_cache: { 'private.example': {} },
  wardenone_whoisxml_threat_cache: { 'private.example': {} },
  wardenone_breach_cache: { 'private.example': {} },
  wardenone_script_drift_baselines: { 'private.example': {} },
  wardenone_hidden_elements: { 'private.example': ['#secret'] },
  wardenone_script_trusted_hosts: ['private.example'],
  wardenone_js_allowlist: ['private.example'],
  wardenone_adshield_allowlist: ['private.example'],
  wardenone_pending_downloads: { 7: { url: 'https://private.example/file.exe' } },
  wardenone_download_handled: { 7: { decision: 'blocked' } },
  wardenone_download_trusted_sites: ['private.example'],
  wardenone_session_started_at: 123,
  wardenone_config: { enabled: true },
  wardenone_list_meta: { updatedAt: 1 },
  wardenone_blocked_domains: ['malware.example'],
});
assert.deepStrictEqual(Object.keys(filtered).sort(), [
  'wardenone_blocked_domains', 'wardenone_config', 'wardenone_list_meta',
]);
assert.deepStrictEqual(payloadApi(false)({ wardenone_history: [1], wardenone_config: { enabled: true } }),
  { wardenone_history: [1], wardenone_config: { enabled: true } });

assert(/function queueHistory\(entry\)\s*\{\s*if \(INCOGNITO_CONTEXT\) return;/.test(SOURCE),
  'private events still enter the history buffer');
assert(/function flushHistory\(\)\s*\{\s*__histTimer = null;\s*if \(INCOGNITO_CONTEXT\)/.test(SOURCE),
  'history has no second private-context barrier at the durable writer');
assert(/if \(INCOGNITO_CONTEXT\) \{\s*markHistRecoveryDone\(\);\s*\} else \{\s*try \{\s*chrome\.storage\.session\.get/.test(SOURCE),
  'private worker still recovers a previous history write-ahead buffer');

const queueSandbox = {
  INCOGNITO_CONTEXT: true,
  __histBuffer: [],
  safeUrlForLog() { throw new Error('private history was sanitised instead of refused'); },
};
vm.createContext(queueSandbox);
vm.runInContext(grabFn(SOURCE, 'queueHistory') + '\nqueueHistory({url:"https://private.example/"});', queueSandbox);
assert.deepStrictEqual(queueSandbox.__histBuffer, []);

assert(SOURCE.includes("const CONTENT_SETTING_SCOPE = INCOGNITO_CONTEXT ? 'incognito_session_only' : 'regular';"),
  'private site permissions are not session-scoped');
assert(!/\.set\(\{\s*primaryPattern,\s*setting/.test(SOURCE),
  'a content-setting write bypasses the context-aware scope helper');
assert(!/\.clear\(\{\s*scope:\s*'regular'/.test(SOURCE),
  'a content-setting clear still reaches the regular profile from a private worker');
assert(/async function publishRebindQuarantine\(\)\s*\{\s*try \{[\s\S]{0,260}if \(INCOGNITO_CONTEXT\) return;/.test(SOURCE),
  'private DNS-rebinding hostnames can still enter durable config');
assert(/async function pruneStorageIfNeeded\(reason\)\s*\{[\s\S]{0,240}if \(INCOGNITO_CONTEXT\) return/.test(SOURCE),
  'private activity can still prune or timestamp the regular storage profile');

const downloadPolicyStart = DOWNLOADS.indexOf('const DOWNLOAD_PENDING_KEY');
const downloadPolicyEnd = DOWNLOADS.indexOf('const DOWNLOAD_HASH_TIMEOUT_MS', downloadPolicyStart);
assert(downloadPolicyStart >= 0 && downloadPolicyEnd > downloadPolicyStart, 'download-state policy markers moved');
const downloadWrites = [];
const downloadSandbox = {
  Set, Object, Array, Promise,
  INCOGNITO_CONTEXT: true,
  localGet: async () => { throw new Error('private download state read durable storage'); },
  localSet: async () => { throw new Error('private download state wrote durable storage'); },
  chrome: {
    storage: {
      session: {
        get: async () => ({ wardenone_pending_downloads: { 7: { id: 7 } } }),
        set: async (obj) => { downloadWrites.push(obj); },
      },
    },
  },
};
vm.createContext(downloadSandbox);
vm.runInContext(DOWNLOADS.slice(downloadPolicyStart, downloadPolicyEnd)
  + '\nthis.api={downloadStateGet,downloadStateSet};', downloadSandbox);

Promise.all([
  downloadSandbox.api.downloadStateGet('wardenone_pending_downloads').then((value) => {
    assert(value.wardenone_pending_downloads[7], 'private pending review was not recovered from session storage');
  }),
  downloadSandbox.api.downloadStateSet({ wardenone_pending_downloads: { 8: { id: 8 } } }),
]).then(() => {
  assert.strictEqual(downloadWrites.length, 1, 'private pending review did not use session storage');
  console.log('incognito isolation tests passed');
}).catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

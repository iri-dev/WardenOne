/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE. */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'docs/message-boundaries.json');
const hash = text => crypto.createHash('sha256').update(text).digest('hex');
function generate() {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  const scripts = [...fs.readdirSync(root).filter(f => f.endsWith('.js')),
    ...fs.readdirSync(path.join(root, 'src')).filter(f => f.endsWith('.js')).map(f => 'src/' + f)].sort();
  const sources = new Map(scripts.map(file => [file, fs.readFileSync(path.join(root, file), 'utf8')]));
  const worker = sources.get('background.js');
  const allowedSource = worker.slice(worker.indexOf('const TAB_CONTEXT_ALLOWED_MESSAGES'), worker.indexOf('const TAB_CONTEXT_RATE_LIMITS'));
  const allowed = new Set([...allowedSource.matchAll(/'([a-z0-9-]+)'/g)].map(m => m[1]));
  const rates = {};
  for (const m of worker.slice(worker.indexOf('const TAB_CONTEXT_RATE_LIMITS'), worker.indexOf('function messageSenderIsExtensionPage')).matchAll(/'([a-z0-9-]+)':\s*\{\s*max:\s*(\d+),\s*windowMs:\s*(\d+)/g))
    rates[m[1]] = { max: Number(m[2]), windowMs: Number(m[3]) };
  const kinds = [...new Set([...worker.matchAll(/msg\.kind === '([a-z0-9-]+)'/g)].map(m => m[1]))].sort();
  const endpoints = [], files = [];
  const operations = [
    ['runtime-message', /(?:chrome\.)?runtime\.onMessage\.addListener\s*\(/g],
    ['runtime-connect', /(?:chrome\.)?runtime\.onConnect\.addListener\s*\(/g],
    ['external-message', /(?:chrome\.)?runtime\.onMessageExternal\.addListener\s*\(/g],
    ['external-connect', /(?:chrome\.)?runtime\.onConnectExternal\.addListener\s*\(/g],
    ['port-message', /(?<!runtime)\.onMessage\.addListener\s*\(/g],
    ['post-message', /\bpostMessage\s*\(/g],
    ['message-event', /(?:addEventListener|woOn|woOnMessage)\s*\(\s*(?:(?:window|document|self)\s*,\s*)?(?:['"]message['"]|\(?\s*(?:msg|m|message)\b)/g],
    ['dom-event', /(?:new\s+CustomEvent\s*\(|(?:addEventListener|woOn)\s*\(\s*(?:(?:window|document)\s*,\s*)?)['"]wo-[^'"]+['"]/g],
    ['worker-onmessage', /\bonmessage\s*=/g],
  ];
  const workerFiles = new Set(['background.js', ...[...worker.matchAll(/['"]((?:background-[^'"]+|notification-manager)\.js)['"]/g)].map(m => m[1])]);
  const worlds = new Map();
  for (const content of manifest.content_scripts || []) for (const file of content.js || []) worlds.set(file, content.world || 'ISOLATED');
  for (const file of ['animated-image-saver.js', 'consent-reject.js', 'consent-wall.js', 'eyeshield.js', 'mail-shield.js', 'resource-saver.js']) worlds.set(file, 'ISOLATED');
  for (const file of scripts) {
    const text = sources.get(file), sourceFile = file === 'content.min.js' ? 'src/content.js' : file === 'fingerprint-realm.js' ? 'src/fingerprint-realm.js' : file;
    let count = 0;
    for (const [operation, pattern] of operations) for (const m of text.matchAll(pattern)) {
      if (operation === 'port-message' && text.slice(Math.max(0, m.index - 7), m.index) === 'runtime') continue;
      const line = text.slice(0, m.index).split('\n').length;
      let policy = workerFiles.has(file) ? 'worker-router' : file === 'offscreen.js' ? 'offscreen' :
        file === 'logger.js' ? 'logger-client' : worlds.get(file) === 'ISOLATED' ? 'isolated-content' :
        worlds.get(file) === 'MAIN' || file.startsWith('src/') || /^(?:twitch-adblock|spotify-adblock|fingerprint-realm|content\.min)\.js$/.test(file) ? 'page-untrusted' : 'private-ui';
      if (file === 'background.js') {
        if (operation === 'runtime-message' && m.index < worker.indexOf('let __histBuffer')) policy = 'worker-activity';
        if (operation === 'runtime-connect' || operation === 'port-message') policy = 'logger-worker';
      }
      if (file === 'bridge.js') policy = operation === 'dom-event' || operation === 'message-event' ? 'bridge-untrusted' : 'isolated-content';
      endpoints.push({ file, line, operation, policy, sourceFile }); count++;
    }
    if (count) files.push({ file, sha256: hash(text), world: worlds.get(file) || (workerFiles.has(file) ? 'WORKER' : 'DOCUMENT'), endpoints: count });
  }
  const capability = kind => {
    if (/download|file-scan/.test(kind)) return 'download review, trust or explicit file lookup';
    if (/firewall|blocklist|user-rules|custom-list|learned|tracker-learner|script-trust|script-shield/.test(kind)) return 'persistent user policy or rule ownership';
    if (/cookie|site-data|browser|logout|exposed|privacy-data|forget-site/.test(kind)) return 'browser data, permissions or local erasure';
    if (/extension|startup/.test(kind)) return 'extension inventory, management or reputation';
    if (/permission|javascript|site-settings/.test(kind)) return 'site permission or browser setting';
    if (/safe-browsing-allow|palette-run|trust-site/.test(kind)) return 'single-use grant or scoped compatibility escape';
    if (/memory/.test(kind)) return 'tab inventory or tab action';
    return allowed.has(kind) ? 'bounded observation, scoped lookup or page UI' : 'private extension control or diagnostic';
  };
  const messages = kinds.map(kind => {
    const marker = "msg.kind === '" + kind + "'", at = worker.lastIndexOf(marker);
    const next = worker.indexOf('if (msg && msg.kind === ', at + marker.length);
    const branch = worker.slice(at, Math.min(next > at ? next : worker.length, at + (kind === 'rg-block' ? 5500 : 12000)));
    return { kind, line: worker.slice(0, at).split('\n').length,
      sender: allowed.has(kind) ? 'own isolated tab; handler scope and grants apply' : kind === 'set-site-permission' ?
        'private UI; top isolated same-origin tab only for cookies=allow' : kind === 'grabber-navigation-status' ?
        'own exact top-level IP-logger warning page and browser warning record' : 'own private extension origin; WAR denied',
      schema: { envelope: 'own kind string; control keys rejected', observedFields: [...new Set([...branch.matchAll(/\bmsg\.([A-Za-z_$][\w$]*)/g)].map(m => m[1]))].filter(k => k !== 'kind').sort(),
        validation: 'handler normalizers and limits; tab/WAR payload additionally <=512 nodes, depth 8, string 8192, total characters 65536' },
      capability: capability(kind), rate: rates[kind] || 'trusted UI operation; handler-specific concurrency/state limits',
      provenance: allowed.has(kind) ? 'browser sender metadata; message body remains untrusted page data' : 'packaged extension UI code and browser-owned state',
      failure: 'reject without capability; observations do not grant persistent blocks' };
  });
  return { schemaVersion: 1, sources: files, endpoints, messages,
    webAccessibleResources: manifest.web_accessible_resources, externallyConnectable: manifest.externally_connectable || null,
    generated: { 'content.min.js': 'src/content.js (byte-exact build gate)', 'fingerprint-realm.js': 'src/fingerprint-realm.js (byte-exact build gate)' },
    notes: ['Lexical census includes sender and receiver sites, including embedded worker text. Policy review and precise schemas are in docs/message-security-audit.md.',
      'Observed fields identify review locations, not an authorization allowlist. All branch-specific checks remain executable in the named handler.'] };
}
if (require.main === module) {
  const data = JSON.stringify(generate(), null, 2) + '\n';
  if (process.argv.includes('--write')) fs.writeFileSync(output, data);
  else if (fs.readFileSync(output, 'utf8') !== data) throw Error('Message inventory is stale; run tools/audit-message-boundaries.js --write');
  console.log('[ok] message endpoint and handler inventory');
}
module.exports = { generate, output };

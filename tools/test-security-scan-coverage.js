/* The dynamic-code scan in check-security-posture.js reads every script WardenOne ships, found
   where it is used rather than from a hand-kept list. A sink placed in each kind of script must be
   named: a packaged page's <script src>, a module the service worker imports, a content script,
   and a packaged file nothing references. And on the real tree, every packaged script is read. */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.resolve(__dirname, '..');
const posture = path.join(__dirname, 'check-security-posture.js');
let checks = 0;
const check = (ok, label) => { checks++; assert(ok, label); };

function runPosture(dir) {
  const env = Object.assign({}, process.env);
  if (dir) env.WARDENONE_POSTURE_ROOT = dir; else delete env.WARDENONE_POSTURE_ROOT;
  const r = spawnSync(process.execPath, [posture], { env, encoding: 'utf8' });
  return { status: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-scan-coverage-'));
try {
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  };
  write('manifest.json', JSON.stringify({
    manifest_version: 3,
    background: { service_worker: 'worker.js' },
    content_scripts: [{ matches: ['<all_urls>'], js: ['content.js'] }],
    content_security_policy: { extension_pages: "script-src 'self'; object-src 'none'; frame-ancestors 'none'" },
    permissions: ['declarativeNetRequest', 'storage', 'webRequest', 'webNavigation', 'downloads', 'tabs'],
    declarative_net_request: { rule_resources: [{ path: 'rules.json' }, { path: 'rules-adshield.json' }, { path: 'rules-trackers.json' }] },
  }));
  for (const file of ['rules.json', 'rules-adshield.json', 'rules-trackers.json']) write(file, '[]\n');
  write('background.js', "/* messageSenderIsExtensionPage messageSenderIsTab TAB_CONTEXT_ALLOWED_MESSAGES TAB_CONTEXT_RATE_LIMITS hardRemoveDownload downloadHardBlockCritical DOWNLOAD_HASH_SOURCE_KIND url-refetch */\nimportScripts('background-startup.js'); importScripts('background-memory.js'); importScripts('background-downloads.js');\n");
  write('bridge.js', '/* safeBrowsingIntentAllowed markTrustedSafeBrowsingEvent No recent user intent for this reputation check */\n');
  write('tools/package-allowlist.json', JSON.stringify(['manifest.json', 'worker.js', 'worker-module.js', 'content.js',
    'pages/panel.html', 'pages/panel.js', 'shared.js', 'stray.js', 'clean.js']));
  write('tools/reviewed-markup-sinks.json', '[]\n');
  write('pages/panel.html', '<!doctype html><script src="panel.js"></script><script src="../shared.js"></script>');
  write('pages/panel.js', 'eval("1");\n');
  write('shared.js', 'document.write("x");\n');
  write('worker.js', "importScripts('worker-module.js');\n");
  write('worker-module.js', 'new Function("return 1");\n');
  write('content.js', 'eval("2");\n');
  write('stray.js', 'eval("3");\n');
  write('clean.js', 'const x = 1;\n');
  write('src/content.js', 'const x = 1;\n');

  const { status, out } = runPosture(dir);
  const sinks = (out.match(/dynamic code sinks found: ([^\n]*)/) || [])[1] || '';
  check(status !== 0, 'a tree with dynamic-code sinks fails the posture check');
  check(sinks.includes('pages/panel.js: eval('), 'a script a packaged page loads is scanned, at its path beside the page');
  check(sinks.includes('shared.js: document.write('), 'a page script referenced with ../ is resolved and scanned');
  check(sinks.includes('worker-module.js: new Function('), 'a module the service worker imports is scanned');
  check(sinks.includes('content.js: eval('), 'a declared content script is scanned');
  check(sinks.includes('stray.js: eval('), 'a packaged script nothing references is still scanned');
  check(!sinks.includes('clean.js'), 'a clean file is not reported');

  write('pages/panel.js', 'const x = 1;\n');
  write('shared.js', 'const x = 1;\n');
  write('worker-module.js', 'const x = 1;\n');
  write('content.js', 'const x = 1;\n');
  write('stray.js', 'const x = 1;\n');
  const clean = runPosture(dir);
  check(clean.status === 0, 'the fixture passes when all severe and markup sinks are removed' + (clean.status ? ': ' + clean.out : ''));
  for (const [source, label] of [
    ['document.body.innerHTML = userControlledValue;', 'innerHTML assignment'],
    ['document.body.outerHTML = userControlledValue;', 'outerHTML assignment'],
    ['document.body.insertAdjacentHTML("beforeend", userControlledValue);', 'insertAdjacentHTML('],
    ['document.body["innerHTML"] += userControlledValue;', 'innerHTML assignment'],
  ]) {
    write('clean.js', source + '\n');
    const markup = runPosture(dir);
    check(markup.status !== 0 && markup.out.includes('unreviewed markup sink: clean.js:1: ' + label),
      'a new ' + label + ' sink fails the posture check in an unreferenced packaged script');
  }
  write('clean.js', 'const x = 1;\n');

  /* A page that loads a script the tree does not have is reported, not silently skipped. */
  write('pages/panel.html', '<!doctype html><script src="missing.js"></script><script src="https://cdn.example/x.js"></script>');
  const missing = runPosture(dir).out;
  check(/missing from disk, so unscanned: [^\n]*pages\/missing\.js/.test(missing), 'a page script missing from disk is named');
  check(missing.includes('loads a script from outside the package: https://cdn.example/x.js'), 'a remote page script is refused');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

/* The real tree: every packaged script, Settings included, is in the scan. */
const real = runPosture(null);
const covered = Number((real.out.match(/dynamic-code scan covers [^(]*\((\d+) files/) || [])[1]);
const packaged = JSON.parse(fs.readFileSync(path.join(root, 'tools/package-allowlist.json'), 'utf8'))
  .filter((f) => /\.js$/i.test(f) && f !== 'content.min.js');
check(real.status === 0, 'the real tree passes the posture check');
check(covered >= packaged.length + 1, 'the scan covers all ' + packaged.length + ' packaged scripts and src/content.js, not ' + covered);
check(packaged.includes('settings.js') && packaged.includes('settings-data.js'), 'Settings ships its scripts in the package list');

console.log('[ok] security scan coverage: ' + checks + ' checks');

/*
 * Behavioural scanner false positives on everyday sites.
 *
 * The scanner used to reach "Suspicious site behavior" from two signals that
 * every large site produces -- a cross-site asset fetched before the first
 * click, plus canvas/WebGL measurement -- so ordinary browsing (X, Reddit,
 * LinkedIn, a shop on its own CDN) raised a scam warning, and at score 60+ the
 * background LEARNS the domain and starts DNR-blocking it.
 *
 * These tests execute the scanner section of the shipped content.min.js bundle
 * against fake pages.
 *
 * Run with:
 *   node tools/test-behavioral-false-positives.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

function sourceBetween(startNeedle, endNeedle, includeStart) {
  const start = CONTENT.indexOf(startNeedle);
  assert(start >= 0, 'missing runtime marker: ' + startNeedle);
  const end = CONTENT.indexOf(endNeedle, start + startNeedle.length);
  assert(end > start, 'missing runtime marker after ' + startNeedle + ': ' + endNeedle);
  return CONTENT.slice(includeStart === false ? start + startNeedle.length : start, end);
}

// The real boundary/verification helpers, so host classification under test is
// the shipped one rather than a re-implementation.
const HELPERS = 'const ' + sourceBetween('SITE_BOUNDARY=(()=>{', 'isGoogleSearchResults=').replace(/,$/, '');
const SCANNER = sourceBetween(
  'if(WO.behavioralScan||WO.fingerprintProbeDetection)try{',
  'catch(e){log("behavioral_scan_failed"',
) + 'catch(e){this.__scanError=e}';

function runScan(options) {
  const opts = options || {};
  const url = new URL(opts.page);
  const clock = { t: 1700000000000 };
  const logs = [];
  const timers = [];
  const ageRequests = [];

  class HTMLCanvasElement {
    toDataURL() { return 'data:,'; }
    toBlob() {}
  }
  class CanvasRenderingContext2D {
    getImageData() { return { data: [] }; }
  }
  class WebGLRenderingContext {
    getParameter() { return ''; }
  }
  class HTMLImageElement {}
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true,
    get() { return this.__src || ''; },
    set(v) { this.__src = v; },
  });
  class XMLHttpRequest {
    open() {}
  }

  const sandbox = {
    URL,
    Set,
    Map,
    Array,
    Object,
    String,
    Number,
    Math,
    JSON,
    RegExp,
    Promise,
    Date: { now: () => clock.t },
    HTMLCanvasElement,
    CanvasRenderingContext2D,
    WebGLRenderingContext,
    WebGL2RenderingContext: null,
    HTMLImageElement,
    XMLHttpRequest,
    location: { href: url.href, hostname: url.hostname, pathname: url.pathname },
    navigator: { sendBeacon() { return true; } },
    performance: { getEntriesByType: () => [{ redirectCount: opts.redirectCount || 0 }] },
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '1' }; },
    document: {
      querySelectorAll() { return []; },
      addEventListener() {},
    },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
    fetch() { return Promise.resolve({ ok: true }); },
    regDomain: (h) => String(h || '').replace(/^www\./, '').toLowerCase(),
    log(type, detail) { logs.push({ type, detail }); },
    __woBackgroundRequest(msg, cb) { ageRequests.push({ msg, cb }); },
    WO: {
      behavioralScan: true,
      fingerprintProbeDetection: true,
      grabberDomains: opts.grabberDomains || [],
    },
  };
  sandbox.window = sandbox;
  sandbox.window.addEventListener = () => {};
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);
  vm.runInContext(HELPERS + ';' + SCANNER, sandbox, {
    filename: 'content.min.js:behavioral-scanner',
  });
  assert(!sandbox.__scanError, 'scanner threw: ' + (sandbox.__scanError && sandbox.__scanError.stack));

  // Ambient traffic every real site produces, before the visitor clicks anything.
  for (const request of (opts.requests || [])) sandbox.fetch(request);
  for (let i = 0; i < (opts.fingerprintProbes || 0); i++) {
    if (i === 0) new HTMLCanvasElement().toDataURL();
    else if (i === 1) new CanvasRenderingContext2D().getImageData();
    else new WebGLRenderingContext().getParameter(37445);
  }

  if (opts.ageDays != null) {
    for (const request of ageRequests) request.cb({ ok: true, ageDays: opts.ageDays });
  }

  // Past the domain-age grace window, then the scanner's own backstop timer.
  clock.t += 5000;
  while (timers.length) timers.shift()();

  return {
    logs,
    risk: sandbox.WO.__pageRisk || null,
    warnings: logs.filter((entry) => entry.type === 'behavioral_risk'),
    ageRequests,
  };
}

// A busy, entirely legitimate page: its own CDN plus canvas/WebGL measurement.
const BUSY_PAGE = {
  fingerprintProbes: 3,
  ageDays: 4000,
};

test('mainstream sites are not behaviourally scanned at all', () => {
  const sites = [
    ['https://x.com/home', 'https://abs.twimg.com/app.js'],
    ['https://twitter.com/home', 'https://pbs.twimg.com/media/a.jpg'],
    ['https://www.reddit.com/r/all', 'https://www.redditstatic.com/bundle.js'],
    ['https://www.linkedin.com/feed/', 'https://static.licdn.com/bundle.js'],
    ['https://discord.com/channels/@me', 'https://cdn.discordapp.com/asset.js'],
    ['https://www.netflix.com/browse', 'https://assets.nflxext.com/app.js'],
    ['https://www.instagram.com/', 'https://scontent.cdninstagram.com/a.jpg'],
    ['https://github.com/iri-dev/WardenOne', 'https://github.githubassets.com/app.js'],
    ['https://www.ebay.co.uk/', 'https://i.ebayimg.com/a.jpg'],
    ['https://open.spotify.com/', 'https://i.scdn.co/image/a.jpg'],
    ['https://www.bbc.co.uk/news', 'https://static.bbci.co.uk/bundle.js'],
    ['https://stackoverflow.com/questions', 'https://cdn.sstatic.net/bundle.js'],
  ];
  for (const [page, asset] of sites) {
    const result = runScan(Object.assign({ page, requests: [asset] }, BUSY_PAGE));
    assert.strictEqual(result.warnings.length, 0, page + ' raised a suspicious-behaviour warning');
    assert.strictEqual(result.risk, null, page + ' was behaviourally scored at all');
    assert.strictEqual(result.ageRequests.length, 0, page + ' spent a domain-age lookup');
  }
});

test('an ordinary site is never warned about on ambient signals alone', () => {
  const result = runScan(Object.assign({
    page: 'https://forum.example.org/thread/1',
    requests: ['https://cdn.jsdelivr.net/npm/lib.js', 'https://unrelated-cdn.example.net/app.js'],
  }, BUSY_PAGE));
  assert.strictEqual(result.warnings.length, 0,
    'a cross-site request plus fingerprinting warned on its own: '
      + JSON.stringify(result.risk && result.risk.behavioralReasons));
});

test("a site's own asset host is first-party, whatever its subdomain", () => {
  const sameSite = runScan({
    page: 'https://shop.example.co.uk/cart',
    requests: ['https://assets.example.co.uk/app.js', 'https://img.example.co.uk/a.jpg'],
    ageDays: 4000,
  });
  assert.strictEqual(sameSite.risk, null, 'a sibling asset host counted as phoning home');

  const reputableCdn = runScan({
    page: 'https://blog.example.org/post',
    requests: ['https://cdnjs.cloudflare.com/lib.js', 'https://fonts.gstatic.com/f.woff2'],
    ageDays: 4000,
  });
  assert.strictEqual(reputableCdn.risk, null, 'a mainstream CDN counted as phoning home');
});

test('a brand-new throwaway domain that phones home is still flagged', () => {
  const result = runScan({
    page: 'https://a8f31c9d0b2e.secure-login.cfd/verify',
    requests: ['https://collector.example.net/log?ip=1'],
    ageDays: 3,
    fingerprintProbes: 1,
  });
  assert.strictEqual(result.warnings.length, 1, 'a 3-day-old scam-shaped domain was not flagged');
  assert(/^(Caution|Suspicious|Dangerous)$/.test(result.warnings[0].detail.level),
    'unexpected level: ' + result.warnings[0].detail.level);
});

test('a known IP logger is flagged immediately, without waiting on domain age', () => {
  const result = runScan({
    page: 'https://grabify.example/track',
    grabberDomains: ['grabify.example'],
  });
  assert.strictEqual(result.warnings.length, 1, 'a known IP-logger page was not flagged');
  assert.strictEqual(result.warnings[0].detail.level, 'Dangerous',
    'known IP logger was downgraded to ' + result.warnings[0].detail.level);
});

test('a brand lookalike is not trusted just for containing the brand name', () => {
  const result = runScan({
    page: 'https://google.com.account-verify.cfd/signin',
    requests: ['https://collector.example.net/log'],
    ageDays: 2,
  });
  assert(result.risk, 'a google.com.<attacker>.cfd lookalike skipped the scan entirely');
  assert.strictEqual(result.warnings.length, 1, 'the lookalike was not flagged');
});

test('an established domain is not warned about below Suspicious', () => {
  const result = runScan({
    page: 'https://tools.example.xyz/app',
    requests: ['https://api.other-example.net/collect'],
    ageDays: 900,
    fingerprintProbes: 1,
  });
  assert.strictEqual(result.warnings.length, 0,
    'a 900-day-old domain warned at Caution: '
      + JSON.stringify(result.risk && result.risk.behavioralReasons));
});

void (async () => {
  let failures = 0;
  for (const item of tests) {
    try {
      await item.fn();
      console.log('ok - ' + item.name);
    } catch (error) {
      failures++;
      console.error('not ok - ' + item.name);
      console.error(error && error.stack ? error.stack : error);
    }
  }
  if (failures) process.exitCode = 1;
  else console.log('\n' + tests.length + ' behavioural false-positive tests passed.');
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
});

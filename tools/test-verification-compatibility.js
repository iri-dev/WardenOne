/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Regression coverage for embedded browser-verification compatibility.
 *
 * The shipped request guard is evaluated directly. Opaque request identifiers
 * are separated from credentials by their field label, while stored tokens and
 * JWTs remain protected. Visible challenge evidence only quiets matching
 * behavioral notices; it never grants a request exemption.
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
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

function assignedIife(startMarker) {
  const start = SOURCE.indexOf(startMarker);
  const tail = '\n    })(),';
  const end = SOURCE.indexOf(tail, start + startMarker.length);
  assert(start >= 0, 'missing runtime marker: ' + startMarker);
  assert(end > start, 'missing runtime IIFE boundary after: ' + startMarker);
  return SOURCE.slice(start + startMarker.length, end + tail.length - 1).trim();
}

const SITE_BOUNDARY = vm.runInNewContext(
  assignedIife('SITE_BOUNDARY='),
  { String, Object, Array },
  { filename: 'src/content.js:SITE_BOUNDARY' },
);

const FLOW_EXPRESSION = assignedIife('VERIFICATION_FLOW_POLICY=');

function makeFrame({
  src = 'https://widget.security.test/frame',
  title = 'Human verification challenge',
  width = 320,
  height = 90,
  display = 'block',
  visibility = 'visible',
  opacity = '1',
} = {}) {
  const attrs = { src, title, name: '', 'aria-label': '' };
  return {
    src,
    getAttribute(name) { return attrs[name] || ''; },
    getBoundingClientRect() { return { width, height }; },
    styleFixture: { display, visibility, opacity },
  };
}

function loadFlowPolicy(frames, pageUrl = 'https://portal.product.test/scan') {
  const location = new URL(pageUrl);
  return vm.runInNewContext(FLOW_EXPRESSION, {
    Array,
    URL,
    SITE_BOUNDARY,
    location,
    document: {
      querySelectorAll(selector) {
        assert.strictEqual(selector, 'iframe[src]');
        return frames;
      },
    },
    getComputedStyle(frame) { return frame.styleFixture; },
  }, { filename: 'src/content.js:VERIFICATION_FLOW_POLICY' });
}

function emptyStorage(values = []) {
  return {
    length: values.length,
    key(index) { return index < values.length ? 'entry-' + index : null; },
    getItem(key) {
      const index = Number(String(key).replace('entry-', ''));
      return Number.isInteger(index) ? values[index] : null;
    },
  };
}

function installRequestGuard({
  pageUrl = 'https://portal.product.test/scan',
  storedTokens = [],
} = {}) {
  const nativeFetchCalls = [];
  const logs = [];
  const location = new URL(pageUrl);
  const sandbox = {
    URL,
    URLSearchParams,
    Headers,
    FormData,
    ArrayBuffer,
    TextDecoder,
    Blob,
    Object,
    Array,
    Set,
    JSON,
    String,
    Date,
    Promise,
    DOMException,
    SITE_BOUNDARY,
    btoa(value) { return Buffer.from(String(value), 'binary').toString('base64'); },
    location,
    localStorage: emptyStorage(storedTokens),
    sessionStorage: emptyStorage(),
    document: { cookie: '' },
    navigator: { sendBeacon() { return true; } },
    WO: {
      blockTokenExfil: true,
      continuousTokenScan: false,
      detectSkimmers: false,
      paymentCardGuard: false,
    },
    regDomain(host) { return String(host || '').replace(/^www\./, '').toLowerCase(); },
    log(type, detail) { logs.push({ type, detail }); },
    fetch(input, init) {
      nativeFetchCalls.push({ input, init });
      return Promise.resolve({ ok: true, status: 200 });
    },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  installEngineAmbient(sandbox);

  const startMarker = 'if(WO.blockTokenExfil||WO.continuousTokenScan||WO.detectSkimmers||WO.paymentCardGuard)try{';
  const endMarker = 'if(WO.continuousTokenScan){';
  const start = SOURCE.indexOf(startMarker);
  const end = SOURCE.indexOf(endMarker, start + startMarker.length);
  assert(start >= 0 && end > start, 'request guard markers remain stable');
  const runtime = SOURCE.slice(start + startMarker.length, end);
  vm.runInContext('{' + runtime + '}', sandbox, {
    filename: 'src/content.js:verification-request-guard',
  });
  return { sandbox, nativeFetchCalls, logs };
}

async function expectBlocked(harness, url, init, message) {
  let error = null;
  try {
    await harness.sandbox.fetch(url, init);
  } catch (caught) {
    error = caught;
  }
  assert(error && error.name === 'SecurityError', message + ' was not rejected');
  assert.strictEqual(harness.nativeFetchCalls.length, 0, message + ' reached native fetch');
  assert(harness.logs.some((entry) => entry.type === 'blocked_token_exfil'), message + ' was not logged');
}

async function run() {
  assert.strictEqual(
    SITE_BOUNDARY.same('tenant.shared.test', 'other.shared.test'),
    false,
    'arbitrary sibling tenants must not be directly trusted',
  );
  assert.strictEqual(
    SITE_BOUNDARY.same('portal.product.test', 'assets.portal.product.test'),
    true,
    'an exact parent/child host relationship should remain same-site',
  );

  const visibleFlow = loadFlowPolicy([makeFrame()]);
  assert.strictEqual(visibleFlow.expectsNoticeUrl('https://api.security.test/verify'), true,
    'a visible challenge should correlate a sibling endpoint in its own service family');
  assert.strictEqual(visibleFlow.expectsNoticeUrl('https://api.product.test/verify'), false,
    'a top-page sibling unrelated to the challenge frame must remain foreign');
  assert.strictEqual(visibleFlow.expectsNoticeUrl('https://security.test.attacker.invalid/verify'), false,
    'a suffix-appended lookalike must not inherit frame trust');

  const tinyFlow = loadFlowPolicy([makeFrame({ width: 80, height: 30 })]);
  assert.strictEqual(tinyFlow.expectsNoticeUrl('https://api.security.test/verify'), false,
    'a tiny challenge-looking frame must not quiet a notice');
  const hiddenFlow = loadFlowPolicy([makeFrame({ display: 'none' })]);
  assert.strictEqual(hiddenFlow.expectsNoticeUrl('https://api.security.test/verify'), false,
    'a hidden challenge-looking frame must not quiet a notice');
  const expiredFrames = [makeFrame()];
  const expiringFlow = loadFlowPolicy(expiredFrames);
  assert.strictEqual(expiringFlow.expectsNoticeUrl('https://api.security.test/verify'), true,
    'visible evidence should be recognized while present');
  expiredFrames.length = 0;
  assert.strictEqual(expiringFlow.expectsNoticeUrl('https://api.security.test/verify'), false,
    'removed evidence must not leave reusable trust behind');
  const visibleFingerprintScore = [1, 2, 3]
    .reduce((sum, hit) => sum + visibleFlow.fingerprintNoticePoints(hit), 0);
  assert.strictEqual(visibleFingerprintScore, 0,
    'visible challenge fingerprint probes must not add behavioral-notice points');
  const ordinaryFlow = loadFlowPolicy([]);
  const ordinaryFingerprintScore = [1, 2, 3]
    .reduce((sum, hit) => sum + ordinaryFlow.fingerprintNoticePoints(hit), 0);
  assert(ordinaryFingerprintScore >= 30,
    'the same probes without visible challenge evidence must still reach the warning band');

  const opaqueResponse = 'A'.repeat(48);
  const requestUrl = 'https://api.product.test/verify';
  const allowed = installRequestGuard();
  const allowedInit = { method: 'POST', body: 'captcha_response=' + opaqueResponse };
  const response = await allowed.sandbox.fetch(requestUrl, allowedInit);
  assert.strictEqual(response.status, 200, 'correlated verification response did not pass through');
  assert.strictEqual(allowed.nativeFetchCalls.length, 1, 'correlated response did not reach native fetch once');
  assert.strictEqual(allowed.nativeFetchCalls[0].init, allowedInit, 'request options were rewritten');
  assert(!allowed.logs.some((entry) => entry.type === 'blocked_token_exfil'),
    'opaque challenge response was falsely logged as credential exfiltration');

  await expectBlocked(
    installRequestGuard(),
    requestUrl,
    { method: 'POST', headers: { authorization: 'Bearer ' + 'B'.repeat(48) }, body: allowedInit.body },
    'sensitive-header request',
  );
  await expectBlocked(
    installRequestGuard(),
    requestUrl,
    { method: 'POST', body: allowedInit.body + '&session=' + 'C'.repeat(48) },
    'sensitive-field request',
  );
  await expectBlocked(
    installRequestGuard({ storedTokens: [opaqueResponse] }),
    requestUrl,
    allowedInit,
    'stored-token request',
  );
  await expectBlocked(
    installRequestGuard(),
    requestUrl,
    { method: 'POST', body: 'captcha_response=eyHeader12345.payload.signature' },
    'JWT-shaped request',
  );

  const sensitiveBodies = [
    ['csrf_token', 'csrf token'],
    ['xsrfToken', 'camel-case anti-forgery token'],
    ['auth_token', 'authentication token'],
    ['session_id', 'session identifier'],
    ['sessionId', 'camel-case session identifier'],
    ['client_secret', 'client secret'],
    ['private_key', 'private key'],
    ['password', 'password field'],
    ['passwd', 'password alias'],
    ['authVerificationToken', 'credential-labelled verification field'],
  ];
  for (const [key, label] of sensitiveBodies) {
    await expectBlocked(
      installRequestGuard(),
      requestUrl,
      { method: 'POST', body: encodeURIComponent(key) + '=' + 'E'.repeat(48) },
      label,
    );
  }

  const sensitiveHeaders = [
    ['x-api-key', 'API-key header'],
    ['x-auth-token', 'authentication-token header'],
    ['x-csrf-token', 'anti-forgery-token header'],
    ['proxy-authorization', 'proxy authorization header'],
    ['cookie', 'cookie header'],
  ];
  for (const [key, label] of sensitiveHeaders) {
    await expectBlocked(
      installRequestGuard(),
      requestUrl,
      { method: 'POST', headers: { [key]: 'F'.repeat(48) } },
      label,
    );
  }

  for (const key of ['captcha_response', 'captchaToken', 'challenge_response', 'verificationToken']) {
    const challengeOpaque = installRequestGuard();
    await challengeOpaque.sandbox.fetch(requestUrl, {
      method: 'POST',
      body: encodeURIComponent(key) + '=' + 'G'.repeat(48),
    });
    assert.strictEqual(challengeOpaque.nativeFetchCalls.length, 1,
      key + ' opaque response was mistaken for a credential');
  }

  const unrelatedOpaque = installRequestGuard();
  const unrelatedInit = { method: 'POST', body: 'request_id=' + 'D'.repeat(48) };
  await unrelatedOpaque.sandbox.fetch('https://collector.other.test/ingest', unrelatedInit);
  assert.strictEqual(unrelatedOpaque.nativeFetchCalls.length, 1,
    'an unrelated opaque identifier was mistaken for a session credential');
  assert(!unrelatedOpaque.logs.some((entry) => entry.type === 'blocked_token_exfil'),
    'an unrelated opaque identifier was logged as credential exfiltration');

  assert(SOURCE.includes('if(VERIFICATION_FLOW_POLICY.expectsNoticeUrl(url))return!1;'),
    'behavioral scanner must ignore only structurally correlated verification calls');
  assert(SOURCE.includes('const here=regDomain(location.hostname),\n      TOKEN_EXFIL_TRUST_POLICY='),
    'token guard must retain the exact-host ancestry boundary');
  const guardSource = SOURCE.slice(
    SOURCE.indexOf('if(WO.blockTokenExfil||WO.continuousTokenScan||WO.detectSkimmers||WO.paymentCardGuard)try{'),
    SOURCE.indexOf('if(WO.continuousTokenScan){'),
  );
  assert(!guardSource.includes('VERIFICATION_FLOW_POLICY'),
    'visible challenge evidence must not grant a token-exfiltration exemption');

  console.log('verification compatibility tests passed (opaque classification, visible notice correlation, and credential boundaries)');
}

run().catch((error) => {
  console.error(error && error.stack || error);
  process.exitCode = 1;
});

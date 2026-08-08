'use strict';

// fetchJsonWithTimeout is the single door every reputation provider goes through
// (VirusTotal, PhishTank, AbuseIPDB, URLhaus, WhoisXML x3). It used to call
// res.clone() before res.json(): the clone was only consumed when parsing failed,
// so on the success path -- nearly every call -- the tee'd stream was never drained
// and the body stayed buffered twice. res.json() also had no size limit.
//
// The subtle part is bodySnippet. It must be populated ONLY when parsing fails,
// because phishTankChallengeText() regex-matches it for /cloudflare/i to spot a
// Cloudflare interstitial. Filling it on success would make any legitimate JSON
// answer that merely mentions a cloudflare-hosted URL read as a challenge page.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

function lift(name) {
  const re = new RegExp('^(?:async )?function ' + name + '\\(', 'm');
  const m = re.exec(BG);
  assert(m, 'background.js no longer declares ' + name);
  let depth = 0;
  let seen = false;
  for (let i = m.index; i < BG.length; i++) {
    const ch = BG[i];
    if (ch === '{') { depth++; seen = true; } else if (ch === '}') {
      depth--;
      if (seen && depth === 0) return BG.slice(m.index, i + 1);
    }
  }
  assert.fail('could not find the end of ' + name);
}

function liftConst(name) {
  const re = new RegExp('^const ' + name + '\\s*=.*$', 'm');
  const m = re.exec(BG);
  assert(m, 'background.js no longer declares ' + name);
  return m[0];
}

const SRC = [
  liftConst('EXTERNAL_REPUTATION_TIMEOUT_MS'),
  liftConst('REPUTATION_MAX_BYTES'),
  lift('utf8ByteLength'),
  lift('readResponseTextWithByteLimit'),
  lift('fetchJsonWithTimeout'),
  lift('phishTankChallengeText'),
].join('\n\n');

// ---------------------------------------------------------------------------
// A Response stand-in that records whether anything cloned it.
// ---------------------------------------------------------------------------
function makeResponse(opts) {
  const o = opts || {};
  const body = o.body === undefined ? '' : String(o.body);
  const bytes = Buffer.from(body, 'utf8');
  const headers = new Map();
  if (o.contentType) headers.set('content-type', o.contentType);
  if (o.declaredLength !== undefined) headers.set('content-length', String(o.declaredLength));
  else if (!o.chunked) headers.set('content-length', String(bytes.length));

  const state = { cloned: 0, textCalls: 0, cancelled: 0, chunksServed: 0 };
  let offset = 0;
  const CHUNK = 64 * 1024;

  const res = {
    ok: o.ok !== false,
    status: o.status || 200,
    headers: { get: (k) => (headers.has(String(k).toLowerCase()) ? headers.get(String(k).toLowerCase()) : null) },
    clone() { state.cloned++; return res; },
    async text() { state.textCalls++; return body; },
    async json() { return JSON.parse(body); },
    body: o.noBody ? null : {
      getReader() {
        return {
          async read() {
            if (o.streamError && state.chunksServed === 1) throw new Error('network truncated the stream');
            if (offset >= bytes.length) return { done: true };
            const slice = bytes.subarray(offset, offset + CHUNK);
            offset += slice.length;
            state.chunksServed++;
            return { done: false, value: new Uint8Array(slice) };
          },
          cancel() { state.cancelled++; },
          releaseLock() {},
        };
      },
    },
    _state: state,
  };
  return res;
}

function run(responseOpts) {
  const res = makeResponse(responseOpts);
  const sandbox = {
    console, JSON, Object, Number, Math, String, Boolean, Array, Error, Buffer,
    TextDecoder, TextEncoder, setTimeout, clearTimeout,
    AbortController: class { constructor() { this.signal = {}; } abort() { this.aborted = true; } },
    fetch: async () => res,
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(SRC, ctx);
  return vm.runInContext('fetchJsonWithTimeout("https://provider.example/api")', ctx)
    .then((out) => ({ out, res, ctx }));
}

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

(async () => {
  // -------------------------------------------------------------------------
  // 1. The fix itself: nothing clones the response any more.
  // -------------------------------------------------------------------------
  {
    const { out, res } = await run({ body: '{"a":1}', contentType: 'application/json' });
    check('valid JSON parses', out.data && out.data.a === 1, JSON.stringify(out.data));
    check('the response is never cloned', res._state.cloned === 0, 'clone() called ' + res._state.cloned + 'x');
    check('the body is read exactly once', res._state.textCalls <= 1, 'text() called ' + res._state.textCalls + 'x');
    check('bodySnippet stays empty on success', out.bodySnippet === '', JSON.stringify(out.bodySnippet));
    check('contentType is still returned', out.contentType === 'application/json', out.contentType);
    check('ok and status are still returned', out.ok === true && out.status === 200);
  }

  // -------------------------------------------------------------------------
  // 2. The semantic guard. A legitimate JSON answer ABOUT a cloudflare-hosted
  //    URL must not read as a Cloudflare challenge.
  // -------------------------------------------------------------------------
  {
    const body = JSON.stringify({ results: { url0: { url: 'https://phish.cloudflare.com/login', verified: 'y' } } });
    const { out, ctx } = await run({ body, contentType: 'application/json' });
    check('JSON mentioning cloudflare still parses', !!(out.data && out.data.results));
    check('...and leaves bodySnippet empty', out.bodySnippet === '', JSON.stringify(out.bodySnippet));
    const challenged = vm.runInContext('phishTankChallengeText', ctx)(out);
    check('...so it is NOT mistaken for a challenge page', challenged === false);
  }

  // -------------------------------------------------------------------------
  // 3. A real Cloudflare interstitial must still be detected.
  // -------------------------------------------------------------------------
  {
    const html = '<!doctype html><html><head><title>Just a moment...</title></head>'
      + '<body><div id="cf_chl_opt">Enable JavaScript and cookies to continue</div></body></html>';
    const { out, ctx } = await run({ body: html, contentType: 'text/html' });
    check('an HTML error page does not parse as JSON', out.data === null);
    check('bodySnippet is populated on parse failure', out.bodySnippet.length > 0);
    check('bodySnippet is capped at 500 chars', out.bodySnippet.length <= 500);
    const challenged = vm.runInContext('phishTankChallengeText', ctx)(out);
    check('a Cloudflare challenge is still detected', challenged === true);
  }

  // -------------------------------------------------------------------------
  // 4. Empty body, and a body with no stream at all.
  // -------------------------------------------------------------------------
  {
    const { out } = await run({ body: '', contentType: 'application/json' });
    check('an empty body yields data=null', out.data === null);
    check('an empty body yields an empty snippet', out.bodySnippet === '');
  }
  {
    const { out } = await run({ body: '{"a":2}', noBody: true });
    check('a response with no readable stream falls back to text()', out.data && out.data.a === 2);
  }
  {
    const { out } = await run({ body: '', status: 204, noBody: true });
    check('204 No Content does not throw', out.status === 204 && out.data === null);
  }

  // -------------------------------------------------------------------------
  // 5. Truncated / malformed JSON.
  // -------------------------------------------------------------------------
  {
    const { out } = await run({ body: '{"data":{"attributes":{"last_analysis_stats":{"malic', contentType: 'application/json' });
    check('truncated JSON yields data=null', out.data === null);
    check('truncated JSON populates the snippet', out.bodySnippet.startsWith('{"data"'));
  }
  {
    const { out } = await run({ body: 'not json at all', contentType: 'text/plain' });
    check('a non-JSON body yields data=null', out.data === null);
    check('a non-JSON body populates the snippet', out.bodySnippet === 'not json at all');
  }

  // -------------------------------------------------------------------------
  // 6. The new size cap, which is the other half of the fix.
  // -------------------------------------------------------------------------
  {
    // Declared oversize: refused from the content-length header, body never read.
    const { out, res } = await run({ body: 'x', declaredLength: 50 * 1024 * 1024 });
    check('a declared-oversize response is refused', out.data === null);
    check('...without reading the body', res._state.chunksServed === 0 && res._state.textCalls === 0);
    check('...and without cloning', res._state.cloned === 0);
  }
  {
    // Streamed oversize with no content-length: the reader must cancel mid-stream
    // rather than buffer the lot.
    const huge = 'a'.repeat(3 * 1024 * 1024);
    const { out, res } = await run({ body: huge, chunked: true });
    check('a streamed-oversize response is refused', out.data === null);
    check('...and the stream is cancelled early', res._state.cancelled === 1, 'cancelled ' + res._state.cancelled);
    check('...having read only part of it', res._state.chunksServed < 3 * 1024 * 1024 / (64 * 1024),
      'served ' + res._state.chunksServed + ' chunks');
  }
  {
    // A body just under the cap must still work.
    const big = '{"pad":"' + 'a'.repeat(900 * 1024) + '"}';
    const { out } = await run({ body: big, chunked: true });
    check('a large-but-legal body still parses', !!(out.data && typeof out.data.pad === 'string'));
  }
  {
    const { out } = await run({ body: '{"a":1}', chunked: true, streamError: true });
    check('a mid-stream failure yields data=null rather than throwing', out.data === null);
  }

  // -------------------------------------------------------------------------
  // 7. Shape stability: every caller reads these five fields.
  // -------------------------------------------------------------------------
  {
    const { out } = await run({ body: '{"a":1}' });
    const keys = Object.keys(out).sort().join(',');
    check('the return shape is unchanged', keys === 'bodySnippet,contentType,data,ok,status', keys);
  }
  {
    const { out } = await run({ body: 'nope', ok: false, status: 429 });
    check('a non-ok status is passed through', out.ok === false && out.status === 429);
  }

  // -------------------------------------------------------------------------
  // 8. Guard against the clone coming back.
  // -------------------------------------------------------------------------
  {
    const fn = lift('fetchJsonWithTimeout');
    check('fetchJsonWithTimeout no longer calls res.clone()', !/\.clone\(\)/.test(fn));
    check('fetchJsonWithTimeout no longer calls res.json()', !/res\.json\(\)/.test(fn));
    check('fetchJsonWithTimeout reads through the byte-limited reader',
      /readResponseTextWithByteLimit\(res, REPUTATION_MAX_BYTES\)/.test(fn));
    check('the cap is at most 2 MB', vm.runInNewContext(liftConst('REPUTATION_MAX_BYTES') + ';REPUTATION_MAX_BYTES', {}) <= 2 * 1024 * 1024);
  }

  if (failures) {
    console.error('[fail] reputation fetch tests: ' + failures + ' failure(s)');
    process.exit(1);
  }
  console.log('[ok] reputation fetch tests');
})().catch((e) => {
  console.error('[fail] reputation fetch tests threw: ' + (e && e.stack || e));
  process.exit(1);
});

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* Check full feed downloads against the extension’s actual byte/time limits, not just reachability.
   Network-dependent and excluded from the local gate.
   Run: node tools/check-feeds.js */
'use strict';

const fs = require('fs');
const vm = require('vm');

const SOURCE = fs.readFileSync('background.js', 'utf8');
const FEEDS = JSON.parse(fs.readFileSync('docs/source-inventory.json', 'utf8')).sources;

function constant(name, fallback) {
  const m = SOURCE.match(new RegExp('const ' + name + ' = ([^;]+);'));
  if (!m) return fallback;
  /* The declarations are arithmetic like `18 * 1024 * 1024`. */
  try { return Function('"use strict";return (' + m[1] + ')')(); } catch (_) { return fallback; }
}

/* Read the real limits out of background.js so this cannot drift from them. */
const MAX_BYTES = constant('LIST_SOURCE_MAX_BYTES', 18 * 1024 * 1024);
const COSMETIC_MAX_BYTES = constant('LIST_COSMETIC_SOURCE_MAX_BYTES', 12 * 1024 * 1024);
const SUPPLEMENTAL_MAX_BYTES = 8 * 1024 * 1024;
const DOWNLOAD_THREAT_MAX_BYTES = constant('DOWNLOAD_THREAT_SOURCE_MAX_BYTES', 9 * 1024 * 1024);
const OPENPHISH_MAX_BYTES = constant('OPENPHISH_FEED_MAX_BYTES', 6 * 1024 * 1024);
const TIMEOUT_MS = constant('LIST_FETCH_TIMEOUT_MS', 25000);
const OPENPHISH_TIMEOUT_MS = constant('EXTERNAL_REPUTATION_TIMEOUT_MS', 6500);
const reviewedMatch = SOURCE.match(/const LIST_REVIEWED_SOURCE_MAX_BYTES = Object\.freeze\(([\s\S]*?)\);/);
const reviewedLimits = reviewedMatch ? vm.runInNewContext('(' + reviewedMatch[1] + ')') : {};

/* The generated inventory names every runtime feed, including URLs with no filter-like
   words. A shared source uses its strictest cap, as listSourceByteLimit() does. */
const policyFor = (feed) => {
  const purposes = feed.purposes || [];
  if (Object.prototype.hasOwnProperty.call(reviewedLimits, feed.url)) return { url: feed.url, maxBytes: reviewedLimits[feed.url], timeoutMs: TIMEOUT_MS };
  if (feed.toggles.includes('openPhish')) return { url: feed.url, maxBytes: OPENPHISH_MAX_BYTES, timeoutMs: OPENPHISH_TIMEOUT_MS };
  if (purposes.includes('Download Guard payload URLs and file hashes')) return { url: feed.url, maxBytes: DOWNLOAD_THREAT_MAX_BYTES, timeoutMs: TIMEOUT_MS };
  if (purposes.includes('Supplemental domain lists')) return { url: feed.url, maxBytes: SUPPLEMENTAL_MAX_BYTES, timeoutMs: TIMEOUT_MS };
  if (purposes.includes('Cosmetic (element-hiding) filtering')) return { url: feed.url, maxBytes: COSMETIC_MAX_BYTES, timeoutMs: TIMEOUT_MS };
  return { url: feed.url, maxBytes: MAX_BYTES, timeoutMs: TIMEOUT_MS };
};

const policies = FEEDS.map(policyFor);
if (process.argv.includes('--list-json')) {
  console.log(JSON.stringify(policies));
  process.exit(0);
}

const mb = (n) => (n / (1024 * 1024)).toFixed(1) + ' MB';

/* Node fetch can emit an asynchronous HTTP-parser assertion when a large body is abandoned. Suppress only that known
   assertion; rethrow other failures. */
process.on('uncaughtException', (err) => {
  const undiciParserQuirk = err && err.code === 'ERR_ASSERTION'
    && /undici/.test(String(err.stack || ''));
  if (!undiciParserQuirk) throw err;
});

(async () => {
  const bad = [];
  console.log('Checking ' + policies.length + ' configured feeds against their per-source size and timeout limits.\n');

  for (const { url, maxBytes, timeoutMs } of policies) {
    const started = Date.now();
    let line = '';
    let timer;
    try {
      const controller = new AbortController();
      timer = setTimeout(() => controller.abort(), timeoutMs);
      const res = await fetch(url, { signal: controller.signal, redirect: 'manual', credentials: 'omit', cache: 'no-cache' });
      if (!res.ok) {
        bad.push({ url, why: 'HTTP ' + res.status });
        console.log('DEAD  HTTP ' + res.status + '  ' + url);
        continue;
      }
      /* Count streamed bytes rather than trusting Content-Length. Stop and cancel at the cap, including for chunked
         responses. */
      const cap = maxBytes;
      const reader = res.body.getReader();
      let bytes = 0;
      let over = false;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.length;
        if (bytes > cap) { over = true; break; }
      }
      try { await reader.cancel(); } catch (_) { /* already finished */ }
      const took = Date.now() - started;
      if (over) {
        bad.push({ url, why: 'over its cap: more than ' + mb(cap) });
        line = 'TOO BIG  > ' + mb(cap).padStart(8);
      } else {
        line = '  ok  ' + mb(bytes).padStart(9) + '  ' + String(took + 'ms').padStart(7);
        /* Comfortably inside the cap and the clock is what "fine" means here. */
        if (took > timeoutMs * 0.6) line += '  [slow — close to the timeout]';
      }
      console.log(line + '  ' + url);
    } catch (e) {
      const why = /abort/i.test(String(e && e.message)) ? 'timed out after ' + (timeoutMs / 1000) + 's'
        : String(e && e.message ? e.message : e).slice(0, 60);
      bad.push({ url, why });
      console.log('DEAD  ' + why + '  ' + url);
    } finally {
      clearTimeout(timer);
    }
  }

  console.log('');
  if (!bad.length) {
    console.log('All ' + policies.length + ' feeds download inside the extension\'s limits.');
    return;
  }
  console.error(bad.length + ' of ' + policies.length + ' feeds would be refused:');
  for (const d of bad) console.error('  ' + d.why + '  ' + d.url);
  console.error('\nA refused feed does not break WardenOne -- the others still load -- but the'
    + '\nblocked-domain count drops silently and the popup just says "N unreachable".'
    + '\nFor a list that is merely too big, upstream usually publishes a smaller'
    + '\nvariant (hagezi ships .medium and .mini); WardenOne caps active domains at'
    + '\nMAX_DYNAMIC anyway, so the giant edition buys nothing.');
  process.exit(1);
})();

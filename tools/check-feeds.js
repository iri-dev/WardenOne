/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Are the blocklist feeds still usable?
 *
 * NOT part of the maintainability gate, on purpose: it talks to the internet, so
 * it would fail on a train, and a network flake is not a broken build. Run it by
 * hand, and whenever the blocked-domain count in the popup looks wrong.
 *
 * THIS CHECKS WHAT THE EXTENSION ACTUALLY DOES, which the first version of this
 * script did not. That version sent a 400-byte range request and reported "all
 * 30 feeds reachable" — a result that says nothing at all, because the extension
 * downloads the WHOLE list under a byte cap and a wall-clock timeout. A feed can
 * answer a range request instantly and still be refused every single time:
 *
 *   - hagezi's adblock/tif.txt is 43 MB against an 18 MB cap. Swapping the dead
 *     hosts/tif.txt for it "fixed" a 404 into a silent too-large rejection, and
 *     the popup went on reporting feeds as unreachable.
 *
 * So: full download, the real cap, the real timeout. Slow is a finding.
 *
 * Run: node tools/check-feeds.js
 */
'use strict';

const fs = require('fs');

const SOURCE = fs.readFileSync('background.js', 'utf8');

function constant(name, fallback) {
  const m = SOURCE.match(new RegExp('const ' + name + ' = ([^;]+);'));
  if (!m) return fallback;
  /* The declarations are arithmetic like `18 * 1024 * 1024`. */
  try { return Function('"use strict";return (' + m[1] + ')')(); } catch (_) { return fallback; }
}

/* Read the real limits out of background.js so this cannot drift from them. */
const MAX_BYTES = constant('LIST_SOURCE_MAX_BYTES', 18 * 1024 * 1024);
const COSMETIC_MAX_BYTES = constant('LIST_COSMETIC_SOURCE_MAX_BYTES', 10 * 1024 * 1024);
const SUPPLEMENTAL_MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = constant('LIST_FETCH_TIMEOUT_MS', 12000);

/* The cap is PER URL, not one number -- listSourceByteLimit() gives cosmetic
   lists a smaller one. Checking everything against the largest cap hides the
   cosmetic list that is over its own: AdGuard's filters/3.txt is 10.4 MB against
   a 10 MB cosmetic cap and reads as fine under an 18 MB test. */
const listMembers = (name) => {
  const block = SOURCE.slice(SOURCE.indexOf('const ' + name + ' = ['));
  return new Set([...block.slice(0, block.indexOf('];')).matchAll(/'(https:\/\/[^']+)'/g)].map((m) => m[1]));
};
const COSMETIC = listMembers('ADSHIELD_COSMETIC_LISTS');
const SUPPLEMENTAL = listMembers('SUPPLEMENTAL_LIST_SOURCES');
const capFor = (url) => {
  if (SUPPLEMENTAL.has(url)) return SUPPLEMENTAL_MAX_BYTES;
  return COSMETIC.has(url) ? COSMETIC_MAX_BYTES : MAX_BYTES;
};

const urls = [...new Set(
  [...SOURCE.matchAll(/https:\/\/[^'"\s]+/g)].map((m) => m[0].replace(/[',;)]+$/, '')),
)]
  .filter((u) => /hosts|blocklist|filter|adserver|domains|malware|phish|serverlist/i.test(u))
  .filter((u) => !/checkurl/.test(u));

const mb = (n) => (n / (1024 * 1024)).toFixed(1) + ' MB';

/* Abandoning a large response part-way makes Node's own fetch throw an assertion
   out of its HTTP parser, asynchronously, where no try/catch around the read can
   reach it. It is a quirk of dropping the socket mid-body, not a fault in the
   feed -- and left unhandled it kills the run after the findings are gathered but
   before they are printed, which is the worst possible moment. Swallow only that
   one, and let anything else crash as it should. */
process.on('uncaughtException', (err) => {
  const undiciParserQuirk = err && err.code === 'ERR_ASSERTION'
    && /undici/.test(String(err.stack || ''));
  if (!undiciParserQuirk) throw err;
});

(async () => {
  const bad = [];
  console.log('Checking ' + urls.length + ' feeds against the extension\'s own limits: '
    + mb(MAX_BYTES) + ' cap, ' + (TIMEOUT_MS / 1000) + 's timeout.\n');

  for (const url of urls) {
    const started = Date.now();
    let line = '';
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        clearTimeout(timer);
        bad.push({ url, why: 'HTTP ' + res.status });
        console.log('DEAD  HTTP ' + res.status + '  ' + url);
        continue;
      }
      /* Streamed and counted, the way readResponseTextWithByteLimit does it in
         the extension. Counting beats trusting content-length -- several of these
         are chunked with no length at all, which is exactly the case a header
         check waves through. Reading to completion and THEN measuring also made
         Node's fetch assert when the timeout aborted a 25 MB download mid-body,
         so stop at the cap and cancel the stream rather than racing it. */
      const cap = capFor(url);
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
      clearTimeout(timer);
      const took = Date.now() - started;
      if (over) {
        bad.push({ url, why: 'over its cap: more than ' + mb(cap) });
        line = 'TOO BIG  > ' + mb(cap).padStart(8);
      } else {
        line = '  ok  ' + mb(bytes).padStart(9) + '  ' + String(took + 'ms').padStart(7);
        /* Comfortably inside the cap and the clock is what "fine" means here. */
        if (took > TIMEOUT_MS * 0.6) line += '  [slow — close to the timeout]';
      }
      console.log(line + '  ' + url);
    } catch (e) {
      const why = /abort/i.test(String(e && e.message)) ? 'timed out after ' + (TIMEOUT_MS / 1000) + 's'
        : String(e && e.message ? e.message : e).slice(0, 60);
      bad.push({ url, why });
      console.log('DEAD  ' + why + '  ' + url);
    }
  }

  console.log('');
  if (!bad.length) {
    console.log('All ' + urls.length + ' feeds download inside the extension\'s limits.');
    return;
  }
  console.error(bad.length + ' of ' + urls.length + ' feeds would be refused:');
  for (const d of bad) console.error('  ' + d.why + '  ' + d.url);
  console.error('\nA refused feed does not break WardenOne -- the others still load -- but the'
    + '\nblocked-domain count drops silently and the popup just says "N unreachable".'
    + '\nFor a list that is merely too big, upstream usually publishes a smaller'
    + '\nvariant (hagezi ships .medium and .mini); WardenOne caps active domains at'
    + '\nMAX_DYNAMIC anyway, so the giant edition buys nothing.');
  process.exit(1);
})();

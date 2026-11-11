/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* An address in the catalog that has moved is worse than no catalog: the reader picks a list and
   gets an error WardenOne put in front of them. This fetches every entry and checks it still
   answers with a filter list. It touches the network, so it is not part of the offline gate --
   tools/test-filter-catalog.js checks the shape, and this checks the addresses.

   Run: node tools/check-filter-catalog.js [--prune] */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const FILE = path.join(ROOT, 'filter-list-catalog.json');

/* A filter list opens with a "[Adblock...]" marker or a "!" comment header. Anything that comes
   back as HTML is a moved page or an error page dressed as a 200. */
function looksLikeFilterList(text) {
  const head = String(text || '').slice(0, 4000);
  if (/^\s*<(?:!doctype|html)/i.test(head)) return false;
  if (/^\s*\[\s*adblock/i.test(head)) return true;
  if (/^\s*!/m.test(head)) return true;
  /* A bare hosts or domain list is legitimate too. */
  return /^(?:\|\||0\.0\.0\.0\s|127\.0\.0\.1\s|[a-z0-9-]+\.[a-z]{2,})/im.test(head);
}

async function main() {
  const doc = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  const prune = process.argv.includes('--prune');
  const kept = [];
  const dropped = [];

  for (const entry of doc.lists) {
    process.stdout.write('  ' + entry.id.padEnd(28));
    try {
      /* Node's HTTP parser can assert its way out of a compressed response from inside the
         socket's end handler, where a try/catch around the await never sees it. Asking for an
         identity encoding keeps the whole run from dying on one list. */
      const res = await fetch(entry.url, {
        redirect: 'follow',
        headers: { 'accept-encoding': 'identity', accept: 'text/plain,*/*' },
        signal: AbortSignal.timeout(45000),
      });
      if (!res.ok) {
        console.log('HTTP ' + res.status);
        dropped.push({ id: entry.id, why: 'HTTP ' + res.status });
        continue;
      }
      const text = await res.text();
      if (!looksLikeFilterList(text)) {
        console.log('not a filter list (' + text.length + ' bytes)');
        dropped.push({ id: entry.id, why: 'not a filter list' });
        continue;
      }
      const lines = text.split(/\r?\n/).filter((l) => l.trim() && !l.trim().startsWith('!')).length;
      if (lines < 20) {
        console.log('only ' + lines + ' rules -- too thin to offer');
        dropped.push({ id: entry.id, why: 'only ' + lines + ' rules' });
        continue;
      }
      console.log(Math.round(text.length / 1024) + ' KB, ' + lines + ' rules');
      kept.push(entry);
    } catch (e) {
      console.log('failed: ' + String(e.message).slice(0, 48));
      dropped.push({ id: entry.id, why: String(e.message).slice(0, 48) });
    }
  }

  console.log('  ---------------------------------------------');
  console.log('  reachable: ' + kept.length + ' of ' + doc.lists.length);
  if (dropped.length) {
    for (const row of dropped) console.log('  [drop] ' + row.id + ': ' + row.why);
  }

  if (prune && dropped.length) {
    doc.lists = kept;
    doc.checkedAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
    console.log('  pruned ' + dropped.length + ' entry/entries and refreshed checkedAt');
    return;
  }
  if (dropped.length) {
    console.error('[fail] ' + dropped.length + ' catalog address(es) no longer serve a filter list.'
      + ' Fix them, or re-run with --prune to drop them.');
    process.exit(1);
  }
  if (prune) {
    doc.checkedAt = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(FILE, JSON.stringify(doc, null, 2) + '\n', 'utf8');
  }
  console.log('[ok] every catalog address serves a filter list');
}

module.exports = { looksLikeFilterList };

if (require.main === module) {
  main().catch((e) => {
    console.error('[fail] ' + (e && e.stack ? e.stack : e));
    process.exitCode = 1;
  });
}

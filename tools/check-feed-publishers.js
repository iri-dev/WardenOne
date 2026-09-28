/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* Read the first 16 KB of each configured remote feed to audit its publisher date.
   This is an optional online diagnostic, never part of the offline build gate.
   Run: node tools/check-feed-publishers.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'background.js'), 'utf8');
const inventory = JSON.parse(fs.readFileSync(path.join(root, 'docs/source-inventory.json'), 'utf8'));
const from = background.indexOf('function parseListPublisherDate');
const to = background.indexOf('function listSourcePublications', from);
if (from < 0 || to <= from) throw new Error('Publisher date parser not found in background.js');
const parseDate = vm.runInNewContext(background.slice(from, to) + '\nparseListPublisherDate', { Date, String, Number }, { timeout: 1000 });
const sources = (inventory.sources || []).filter((item) => item.kind === 'fetched' && /^https:\/\//.test(item.url || ''));
const maxHeader = 16384;
const maxWait = 18000;
let cursor = 0;

/* Some hosts ignore Range. Stop reading once the parser's entire header window is
   available, so this audit does not download tens of megabytes per source. */
async function inspect(source) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxWait);
  try {
    const response = await fetch(source.url, {
      headers: { Range: 'bytes=0-16383', 'Accept-Encoding': 'identity' },
      cache: 'no-cache',
      redirect: 'follow',
      signal: controller.signal,
    });
    if (!response.ok) return { source, error: 'HTTP ' + response.status };
    const reader = response.body.getReader();
    const chunks = [];
    let bytes = 0;
    while (bytes < maxHeader) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value.slice(0, maxHeader - bytes);
      chunks.push(chunk);
      bytes += chunk.length;
    }
    try { await reader.cancel(); } catch (_) {}
    const header = new TextDecoder().decode(Buffer.concat(chunks));
    return { source, publishedAt: parseDate(header), header: process.argv.includes('--show-unknown-headers') ? header : '' };
  } catch (error) {
    return { source, error: error && error.name === 'AbortError' ? 'timed out' : String(error && error.message || error) };
  } finally {
    clearTimeout(timer);
  }
}

async function worker(results) {
  while (cursor < sources.length) {
    const index = cursor++;
    results[index] = await inspect(sources[index]);
  }
}

async function main() {
  const results = new Array(sources.length);
  await Promise.all(Array.from({ length: Math.min(6, sources.length) }, () => worker(results)));
  let old = 0;
  let unknown = 0;
  let errors = 0;
  const staleAfter = 30 * 24 * 60 * 60 * 1000;
  for (const result of results) {
    const label = (result.source.owner || 'Unknown owner').padEnd(19);
    if (result.error) {
      errors++;
      console.log('ERROR    ' + label + ' ' + result.error + '  ' + result.source.url);
    } else if (!result.publishedAt) {
      unknown++;
      console.log('UNKNOWN  ' + label + ' publisher date unknown  ' + result.source.url);
      if (result.header) console.log('         ' + result.header.split(/\r?\n/).slice(0, 12).map((line) => line.slice(0, 140)).join(' | '));
    } else {
      const stale = Date.now() - result.publishedAt > staleAfter;
      if (stale) old++;
      console.log((stale ? 'OLD      ' : 'DATED    ') + label + ' '
        + new Date(result.publishedAt).toISOString().slice(0, 10) + '  ' + result.source.url);
    }
  }
  console.log('\n' + sources.length + ' feeds: ' + old + ' publisher dates over 30 days old, '
    + unknown + ' publisher dates unknown, ' + errors + ' fetch errors.');
  if (errors) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });

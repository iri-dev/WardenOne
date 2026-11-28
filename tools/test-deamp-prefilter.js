/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
/* The de AMP link cleaner skips new URL for links that cannot be AMP links (Wikipedia, 2026-11-27: thousands of links
   per load). Fuzzed against the same function without the string check, every link and page address gets the same
   answer, including escapes, tabs, backslashes, relative links and non ASCII hosts.
   Run: node tools/test-deamp-prefilter.js */
'use strict';

const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'src', 'content.js'), 'utf8');
const from = SRC.indexOf('const deAmpUrl=href=>{');
const to = SRC.indexOf('fixLinks=root=>{', from);
assert.ok(from >= 0 && to > from, 'deAmpUrl moved; update this test');
const fn = SRC.slice(from + 'const '.length, to).replace(/,\s*$/, '');
const PREFILTER = /\n\s*if\(!\/amp\/i\.test\(location\.href\)&&[^\n]*\)return null;/;
assert.ok(PREFILTER.test(fn), 'the string check is gone or reworded; update this test with it');

function load(source) {
  const box = { URL, decodeURIComponent, String, location: { href: '' } };
  vm.createContext(box);
  vm.runInContext('const ' + source + ';this.f=deAmpUrl;', box);
  return box;
}
const shipped = load(fn);
const reference = load(fn.replace(PREFILTER, ''));

/* mulberry32: successive picks of a plain LCG correlate and never paired some hosts with some paths. */
let seed = 61;
const rand = (n) => {
  seed = (seed + 0x6D2B79F5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return (((t ^ (t >>> 14)) >>> 0) % n);
};
const pick = (a) => a[rand(a.length)];
const HOSTS = ['www.google.com', 'google.co.uk', 'news.google.de', 'cdn.ampproject.org', 'www-example-com.cdn.ampproject.org',
  'AMPPROJECT.ORG', 'ampproject%2Eorg', '%61mpproject.org', 'xn--mpproject-4fa.org', 'ａｍｐproject.org', 'ampproject。org',
  'en.wikipedia.org', 'example.com', 'camp.example', 'gооgle.com'];
const PATHS = ['/amp/s/example.com/story', '/AMP/s/x', '/amp\\s\\example.com/a', '/am\tp/s/example.com', '/a%6Dp/s/x',
  '/c/s/example.com/page', '/c/s/https%3A%2F%2Fexample.com', '/wiki/Main_Page', '/', '', '/amp/', '/s/amp/s/q',
  '/c/s/', '/campaign/s/x', '/%2Famp%2Fs%2Fx'];
const PAGES = ['https://en.wikipedia.org/wiki/Manifest_V3', 'https://www.google.com/search?q=x', 'https://www.google.com/amp/s/example.com/',
  'https://cdn.ampproject.org/c/s/example.com/', 'https://example.com/camp/', 'https://news.example/'];
function href() {
  const kind = rand(6);
  if (kind === 0) return pick(PATHS).replace(/^\//, pick(['', './', '../', '/']));
  if (kind === 1) return '//' + pick(HOSTS) + pick(PATHS);
  if (kind === 2) return pick([null, undefined, '', '#', 'javascript:void(0)', 'mailto:a@b.c', '?amp=1', ' \n']);
  return pick(['https://', 'http://', 'HTTPS://', 'https:\\\\']) + pick(HOSTS) + pick(PATHS) + pick(['', '?x=1', '#amp', '%20']);
}
let same = 0, rewritten = 0;
for (let i = 0; i < 20000; i++) {
  const page = pick(PAGES), link = href();
  shipped.location.href = page; reference.location.href = page;
  const a = shipped.f(link), b = reference.f(link);
  assert.equal(a, b, 'link ' + JSON.stringify(link) + ' on ' + page + ': ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b));
  same++;
  if (b) rewritten++;
}
assert.ok(rewritten > 1000, 'the fuzz reached too few AMP links to mean anything: ' + rewritten);

/* The links the parser rewrites into AMP form without the plain letters, on a page whose address has none either. */
const TRICKY = {
  'https://ａｍｐproject.org/c/s/example.com/page': 'https://example.com/page',
  'https://%61mpproject.org/c/s/example.com/page': 'https://example.com/page',
  'https://www.google.com/am\tp/s/example.com/story': 'https://example.com/story',
  'https://www.google.com/a\nmp/s/example.com/story': 'https://example.com/story',
  '/amp/s/example.com/x': null,
};
for (const [link, want] of Object.entries(TRICKY)) {
  shipped.location.href = reference.location.href = 'https://en.wikipedia.org/wiki/Manifest_V3';
  assert.equal(reference.f(link), want, 'the reference itself changed for ' + JSON.stringify(link));
  assert.equal(shipped.f(link), want, 'the string check skipped a link the parser turns into an AMP link: ' + JSON.stringify(link));
}
shipped.location.href = 'https://www.google.com/amp/s/example.com/';
assert.equal(shipped.f('other/page'), 'https://example.com/other/page', 'a relative link on an AMP page must still resolve');
console.log('[ok] de AMP string check: ' + same + ' fuzzed links, same answers (' + rewritten + ' rewritten)');

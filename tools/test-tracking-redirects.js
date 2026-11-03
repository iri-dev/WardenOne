/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('assert/strict');
const redirect = require('../tracking-redirects.js');
const target = 'https://merchant.example.org/product?id=7&signature=KEEP%2FTHIS#section';
const publicHost = host => !/^(?:localhost|127\.|192\.168\.|10\.)/.test(host) && !/\.(?:test|local|invalid)$/.test(host);
const wrap = (base, key, value = target) => base + '?' + key + '=' + encodeURIComponent(value);
const examples = [
  wrap('https://www.google.com/url', 'q'), wrap('https://www.google.co.uk/url', 'url'),
  wrap('https://www.googleadservices.com/pagead/aclk', 'adurl'), wrap('https://www.youtube.com/redirect', 'q'),
  wrap('https://l.facebook.com/l.php', 'u'), wrap('https://out.reddit.com/t3_fixture', 'url'),
  wrap('https://www.linkedin.com/safety/go', 'url'), wrap('https://duckduckgo.com/l/', 'uddg'),
  'https://www.bing.com/ck/a?u=a1' + Buffer.from(target).toString('base64url'),
  wrap('https://www.awin1.com/cread.php', 'ued'), wrap('https://www.anrdoezrs.net/click-1-2', 'url'),
  wrap('https://click.linksynergy.com/deeplink', 'murl'), wrap('https://go.skimresources.com/', 'url'),
  wrap('https://redirect.viglink.com/', 'u'), wrap('https://go.redirectingat.com/', 'url'),
  wrap('https://www.shareasale.com/r.cfm', 'urllink'), wrap('https://clk.tradedoubler.com/click', 'url'),
  wrap('https://example.pxf.io/c/1/2/3', 'u'), wrap('https://clickserve.dartsearch.net/link/click', 'ds_dest_url'),
  'https://prf.hn/click/camref:fixture/destination:' + encodeURIComponent(target),
  'https://prf.hn/click/camref:fixture/destination:' + target,
  wrap('https://rover.ebay.com/rover/1/2/3', 'mpre'),
];
for (const source of examples) {
  const result = redirect.resolve(source, publicHost);
  assert.equal(result.status, 'resolved', source);
  assert.equal(result.url, target, 'signed destination and fragment must survive: ' + source);
}
assert.equal(redirect.resolve(wrap('https://www.awin1.com/cread.php', 'ued', examples[4]), publicHost).url, target);
assert.equal(redirect.resolve(wrap('https://www.awin1.com/cread.php', 'ued', encodeURIComponent(target)), publicHost).url, target);
const pathTarget = 'https://merchant.example.org/path/destination:https://other.example.org/item?signature=KEEP#section';
assert.equal(redirect.resolve('https://prf.hn/click/camref:fixture/destination:' + pathTarget, publicHost).url, pathTarget);
for (const value of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', 'http://127.0.0.1/admin',
  'http://localhost/admin', 'https://user:secret@merchant.example.org/', 'https://merchant.example.org/\nsecret']) {
  assert.equal(redirect.resolve(wrap('https://www.awin1.com/cread.php', 'ued', value), publicHost).status, 'unsafe', value);
}
for (const source of [
  'https://www.awin1.com/cread.php?awinmid=1',
  examples[9] + '&ued=' + encodeURIComponent('https://different.example.org/'),
  examples[9] + '&state=SIGNED', examples[9] + '&signature=SIGNED',
]) assert.equal(redirect.resolve(source, publicHost).status, 'unchanged', source);
for (const source of [
  wrap('https://www.awin1.com.attacker.example.org/cread.php', 'ued'),
  wrap('https://merchant.example.org/login', 'url'), wrap('https://www.awin1.com/checkout', 'ued'),
  'https://user:secret@www.awin1.com/cread.php?ued=' + encodeURIComponent(target),
  'x'.repeat(9000),
]) assert.equal(redirect.resolve(source, publicHost).status, 'unsupported', source);
let deep = target;
for (let i = 0; i < 7; i++) deep = wrap('https://www.awin1.com/cread.php', 'ued', deep);
assert.equal(redirect.resolve(deep, publicHost).status, 'unchanged', 'bounded nested chains');
console.log('[ok] tracking redirects: known paths/hosts, encoding, bounded chains, exact signed destinations, private targets, duplicate fields and opaque links');

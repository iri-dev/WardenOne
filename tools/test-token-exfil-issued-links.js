/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * SessionShield (top frame): a link carrying a token goes through only when a server handed
 * that link to the page.
 *
 * Video hosts sign playlist and segment links (master.m3u8?token=...) and players built on
 * hls.js, dash.js or Shaka load them with fetch/XHR. The token check refused the signed
 * playlist as "a token leaving the page" and the player died on its first file (JW Player
 * error 232011, reported on anichi.to). A first fix let any plain GET for a media file through,
 * which also let a script name its collector "x.m3u8" and send a token it held in memory. Now
 * what counts is provenance: the page read a response that contained that exact link. The
 * child-frame guard does the same (tools/test-frame-credential-guard.js).
 *
 * The detection block is lifted from src/content.js and run, not re-implemented.
 *
 * Run: node tools/test-token-exfil-issued-links.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

const FROM = 'looksLikeJWT2=';
const TO = ',\n      destIsForeign=';
const a = SRC.indexOf(FROM);
const b = SRC.indexOf(TO, a);
if (a < 0 || b < 0) throw new Error('token detection block not found in src/content.js');
const BLOCK = 'const ' + SRC.slice(a, b) + ';\nreturn { bodyHasToken, noteIssued, watchResponse, xhrDone };';

function engine(stored, media) {
  const store = (entries) => ({
    get length() { return entries.length; },
    key: (i) => (entries[i] ? entries[i][0] : null),
    getItem: (k) => { const e = entries.find((x) => x[0] === k); return e ? e[1] : null; },
  });
  const sandbox = {
    URL, URLSearchParams, Headers, TextDecoder, ArrayBuffer, Blob, JSON, String, Object, Array, Set, Map,
    btoa: (t) => Buffer.from(String(t), 'binary').toString('base64'),
    location: { href: 'https://player.stream.example/embed/31629', hostname: 'player.stream.example' },
    localStorage: store(stored || []),
    sessionStorage: store([]),
    document: { cookie: '', getElementsByTagName: (tag) => (media && tag === 'video' ? [{}] : []) },
    here: 'stream.example',
    regDomain: (host) => String(host || '').toLowerCase().split('.').slice(-2).join('.'),
  };
  vm.createContext(sandbox);
  return vm.runInContext('(() => {' + BLOCK + '})()', sandbox, { filename: 'src/content.js:token-detection' });
}

class FakeResponse {
  constructor(url, body, type) { this.url = url; this.body = body; this.type = type; this.headers = { get: () => type }; }
  text() { return Promise.resolve(this.body); }
  json() { return Promise.resolve(JSON.parse(this.body)); }
  arrayBuffer() { const x = Buffer.from(this.body); return Promise.resolve(x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength)); }
  clone() { return new FakeResponse(this.url, this.body, this.type); }
}

const hash = '55d46c8717ed1cb7ac23556df1745b4b/32e9d07dc186572aae7787a115f0cdbf';
const signed = 'MTc5MDM5MDU0OXw1NWQ0NmM4NzE3ZWQxY2I3YWMyMzU1NmRmMTc0NWI0Yi8zMmU5ZDA3ZGMxODY1NzJhYWU3Nzg3YTExNWYwY2RiZg.9551dXfuZlkYU-eUnfV3Db9GvaarzQNYuJIRTnUhiBw';
const master = 'https://fetch.cdn-example.top/anime/' + hash + '/master.m3u8?token=' + signed;
const variant = 'https://fetch.cdn-example.top/anime/' + hash + '/index-f1.m3u8?token=' + signed;
/* The top frame remembers stored values that are token-shaped (40+ url-safe characters, 32+ hex,
   or a JWT) -- a shorter opaque value is the child-frame guard's business, which remembers by key. */
const storedToken = 'sessAbcdefghijklmnopqrstu0123456789ABCDEFGH';
const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop';
const sources = 'https://player.stream.example/stream/getSources?id=31629';

(async () => {
  const e = engine([['blob', storedToken]]);
  const leaves = (url, body, headers) => e.bodyHasToken(body, url, headers || '');

  console.log('handed-out links');
  check('before any server has handed it out, a signed playlist link counts as a token leaving', leaves(master));
  /* PHP-style JSON: slashes escaped. */
  e.noteIssued(JSON.stringify({ sources: [{ file: master }] }).replace(/\//g, '\\/'), sources, { sameParty: true, url: sources, body: '' });
  check('once the player\'s own server has handed it out, it does not', !leaves(master));
  e.noteIssued('#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=800000\nindex-f1.m3u8?token=' + signed + '\n', master, { sameParty: false });
  check('nor does a playlist listed in it, relative to it', !leaves(variant));
  const mpdUrl = 'https://dash.cdn-example.net/v/manifest.mpd';
  e.noteIssued('<?xml version="1.0"?><MPD><Period><BaseURL>https://dash.cdn-example.net/v/</BaseURL><AdaptationSet>'
    + '<SegmentTemplate media="seg-$Number%05d$.m4s?token=' + signed + '" initialization="init.mp4?token=' + signed + '"/>'
    + '</AdaptationSet></Period></MPD>', mpdUrl, { sameParty: false });
  check('nor a DASH template\'s segments', !leaves('https://dash.cdn-example.net/v/seg-00042.m4s?token=' + signed));

  console.log('reading what the page reads');
  const viaJson = 'https://cdn2.example.org/live/playlist.m3u8?auth=' + signed;
  const r1 = new FakeResponse('https://player.stream.example/api/sources2', JSON.stringify({ hls: viaJson }), 'application/json');
  e.watchResponse(r1, 'https://player.stream.example/api/sources2', undefined);
  await r1.json();
  check('a link read out of fetch().json() counts as handed out', !leaves(viaJson));
  const shakaSeg = 'https://shaka.cdn-example.net/a/seg-7.m4s?token=' + signed;
  const r2 = new FakeResponse('https://shaka.cdn-example.net/a/m.mpd', '<MPD><Period><AdaptationSet><SegmentTemplate media="seg-$Number$.m4s?token=' + signed + '"/></AdaptationSet></Period></MPD>', 'application/dash+xml');
  e.watchResponse(r2, 'https://shaka.cdn-example.net/a/m.mpd', undefined);
  await r2.arrayBuffer();
  check('and one out of a manifest read as an arrayBuffer, the way Shaka reads it', !leaves(shakaSeg));
  const viaXhr = 'https://cdn3.example.org/v/master.m3u8?token=' + signed;
  e.xhrDone.call({ readyState: 4, status: 200, responseType: '', responseText: '{"file":"' + viaXhr + '"}', responseURL: 'https://player.stream.example/api/x', __wo_url: 'https://player.stream.example/api/x' });
  check('and one out of an XHR response', !leaves(viaXhr));

  console.log('what still counts');
  check('the handed-out path with a token it was not handed', leaves(master.replace(signed, 'Z' + signed.slice(1))));
  check('a JWT bolted onto a handed-out link', leaves(master + '&x=' + jwt));
  check('a stored token bolted onto a handed-out link', leaves(master + '&d=' + storedToken));
  check('a DASH template with something bolted on', leaves('https://dash.cdn-example.net/v/seg-00042.m4s?token=' + signed + '&session=' + storedToken));
  check('a token parameter to an unrelated URL', leaves('https://collector.evil.test/pixel?token=' + signed));
  check('dressed up as a playlist', leaves('https://collector.evil.test/live.m3u8?token=' + signed));
  check('a token in a body, whatever the URL', leaves('https://collector.evil.test/playlist.m3u8', 'token=' + signed));
  const laundered = 'https://collector.evil.test/c?token=' + signed + 'L';
  e.noteIssued('{"u":"' + laundered + '"}', 'https://player.stream.example/api/echo', { sameParty: true, url: 'https://player.stream.example/api/echo?u=' + laundered, body: '' });
  check('a link a same-site endpoint merely echoed back', leaves(laundered));
  const smuggled = 'https://collector.evil.test/d?token=' + signed + 'D';
  const r3 = new FakeResponse('data:text/plain;base64,' + Buffer.from(smuggled).toString('base64'), smuggled, 'text/plain');
  e.watchResponse(r3, r3.url, undefined);
  await r3.text();
  check('a link from a data: URL', leaves(smuggled));
  const streamed = 'https://collector.evil.test/s?token=' + signed + 'S';
  const r4 = new FakeResponse('https://player.stream.example/events', 'data: ' + streamed, 'text/event-stream');
  e.watchResponse(r4, r4.url, undefined);
  await r4.text();
  check('event streams are not read at all', leaves(streamed));

  console.log('a player that decrypts its own source list');
  /* No response ever holds the link (anichi.to's player gets {"enc":"..."}); the first
     PLAYLIST alone goes through, from a page that is showing a video, by a plain GET. */
  const p = engine([['blob', storedToken]], true);
  const enc = 'https://cdn.enc-example.top/v/' + hash + '/master.m3u8?token=' + signed;
  check('a playing page may load the playlist it decrypted', !p.bodyHasToken(undefined, enc, '', 'GET'));
  check('but not a segment by the same rule', p.bodyHasToken(undefined, 'https://cdn.enc-example.top/v/seg-1.ts?token=' + signed, '', 'GET'));
  check('nor a playlist request that is a POST', p.bodyHasToken(undefined, enc, '', 'POST'));
  check('nor one carrying a token the page stores', p.bodyHasToken(undefined, 'https://cdn.enc-example.top/v/x.m3u8?session=' + storedToken, '', 'GET'));
  check('and a page with no video gets no such exception', leaves(enc));

  console.log('wiring');
  check('fetch, XHR and sendBeacon pass the method',
    /method=init&&init\.method\|\|input&&"object"==typeof input&&input\.method\|\|"GET";/.test(SRC)
    && /this\.__wo_method=m,/.test(SRC) && /bodyHasToken\(data,\s*url,\s*null,\s*"POST"\)/.test(SRC));
  check('fetch watches what the page reads from the response',
    /const pending=rf\.apply\(this,\s*arguments\);/.test(SRC) && /pending\.then\(r=>watchResponse\(r,reqUrl,init&&init\.body\|\|input&&input\.body\),\(\)=>\{\}\)/.test(SRC));
  check('XHR listens, capturing, before the page\'s own handler', /this\.addEventListener\("readystatechange",xhrDone,!0\)/.test(SRC));
  check('and remembers what it sent, for the echo rule', /this\.__wo_body=body,!this\.__wo_dest/.test(SRC));
  check('the URL counts unless it was handed out', /url&&urlHasToken\(url\)&&!linkWasIssued\(url\)/.test(SRC));
  check('the looser media-path rule is gone', SRC.indexOf('MEDIA_LOAD_PATH') < 0 && SRC.indexOf('isMediaLoad') < 0);
  const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
  check('and the built engine carries it', MIN.indexOf('linkWasIssued=') >= 0 && MIN.indexOf('MEDIA_LOAD_PATH') < 0);

  if (failed) { console.error('\n' + failed + ' issued-link check(s) failed'); process.exit(1); }
  console.log('\nall issued-link checks passed');
})().catch((err) => { console.error(err && err.stack || err); process.exit(1); });

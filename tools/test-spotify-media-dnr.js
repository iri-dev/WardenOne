/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules-spotify-media.json'), 'utf8'));
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const asset = 'spotify-silent-1s.mp4';
const expected = [
  '||akamaized.net/audio/', '||scdn.co/audio/', '||scdn.co/mp3-ad/',
  '||scdn.co/mp3/', '||spotifycdn.com/audio/', '||amillionads.com^',
  '||2mdn.net^', '||adxcel.com^', '||adstudio-assets.scdn.co^',
  '||spotify.com/ad-logic/',
];

const entry = manifest.declarative_net_request.rule_resources.find((item) => item.id === 'spotify_media');
assert.deepStrictEqual(entry, { id: 'spotify_media', enabled: true, path: 'rules-spotify-media.json' });
const war = (manifest.web_accessible_resources || []).find((item) =>
  item.resources.length === 1 && item.resources[0] === asset);
assert(war && war.matches.length === 1 && war.matches[0] === 'https://open.spotify.com/*',
  'silent media must be accessible only from Spotify');
/* The last rule is the one uBlock Origin's list needed podcast exceptions for, generalised:
   media the web player loads is never cut off by a tracker or ad list. A podcast enclosure
   often travels through an analytics prefix host (chtbl.com, podscribe.com, mgln.ai) that
   the EasyPrivacy pack blocks for every type, and a blocked media request leaves the player
   stuck rather than silent. It sits above the 1000-point tracker packs and below both the
   ad-media redirects (1100) and the 2000-point malware blocks, so a redirect still wins and
   a malicious host is still refused. */
const redirects = rules.filter((rule) => rule.action.type === 'redirect');
const allows = rules.filter((rule) => rule.action.type === 'allow');
assert.strictEqual(rules.length, expected.length + 1);
assert.strictEqual(redirects.length, expected.length);
assert.strictEqual(allows.length, 1);
assert.deepStrictEqual(redirects.map((rule) => rule.condition.urlFilter), expected);
rules.forEach((rule, index) => {
  assert.strictEqual(rule.id, index + 1);
  assert.deepStrictEqual(rule.condition.initiatorDomains, ['open.spotify.com']);
  assert.deepStrictEqual(rule.condition.resourceTypes, ['media']);
});
redirects.forEach((rule) => {
  assert.deepStrictEqual(rule.action.redirect, { extensionPath: '/' + asset });
  /* Beat generic 1000-point ad/tracker blocks, but not 2000-point malware blocks
     or the much higher-priority user/site override rules. */
  assert.strictEqual(rule.priority, 1100);
});
const mediaAllow = allows[0];
assert.deepStrictEqual(mediaAllow.action, { type: 'allow' });
assert.deepStrictEqual(Object.keys(mediaAllow.condition).sort(), ['initiatorDomains', 'resourceTypes'],
  'the media allow is scoped by initiator and type only, never by host');
assert.strictEqual(mediaAllow.priority, 1050);
assert(mediaAllow.priority > 1000 && mediaAllow.priority < 1100 && mediaAllow.priority < 2000);
/* The packs it has to outrank really do block a podcast prefix host for media. */
const easyprivacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'rules-easyprivacy.json'), 'utf8'));
const prefixBlock = easyprivacy.find((rule) => rule.action.type === 'block' &&
  (rule.condition.requestDomains || []).includes('chtbl.com'));
assert(prefixBlock && prefixBlock.condition.resourceTypes.includes('media'),
  'expected the EasyPrivacy pack to block chtbl.com media (else this allow no longer needs to)');
assert(prefixBlock.priority < mediaAllow.priority);
for (const file of ['rules-trackers.json', 'rules-easyprivacy.json', 'rules-adshield.json']) {
  const pack = JSON.parse(fs.readFileSync(path.join(ROOT, file), 'utf8'));
  for (const rule of pack) {
    if (rule.action.type !== 'block') continue;
    const types = rule.condition.resourceTypes;
    const excluded = rule.condition.excludedResourceTypes || [];
    if ((types && !types.includes('media')) || excluded.includes('media')) continue;
    assert(rule.priority < mediaAllow.priority, file + ' rule ' + rule.id + ' would outrank the web-player media allow');
  }
}

/* The supported rules are host anchors with either a path prefix or a host boundary.
   Exercise representative player requests so broadening a rule into the DRM or
   track-playback path is caught before it reaches a browser. */
function matches(rule, url, initiator, type) {
  if (initiator !== 'open.spotify.com' || type !== 'media') return false;
  const filter = rule.condition.urlFilter.slice(2);
  const boundary = filter.endsWith('^');
  const hostAndPath = boundary ? filter.slice(0, -1) : filter;
  const slash = hostAndPath.indexOf('/');
  const host = slash < 0 ? hostAndPath : hostAndPath.slice(0, slash);
  const prefix = slash < 0 ? '' : hostAndPath.slice(slash);
  const parsed = new URL(url);
  const domain = parsed.hostname.toLowerCase();
  if (domain !== host && !domain.endsWith('.' + host)) return false;
  return !prefix || parsed.pathname.startsWith(prefix);
}
const redirected = (url, initiator = 'open.spotify.com', type = 'media') =>
  redirects.some((rule) => matches(rule, url, initiator, type));

assert(redirected('https://audio-fa.scdn.co/audio/ad.mp3'));
assert(redirected('https://adstudio-assets.scdn.co/creative.mp4'));
assert(redirected('https://audio.spotify.com/ad-logic/creative.mp4'));
assert(!redirected('https://gew1-spclient.spotify.com/widevine-license/v1/audio/license'));
assert(!redirected('https://gew1-spclient.spotify.com/track-playback/v1/state'));
assert(!redirected('https://audio-fa.scdn.co/audio/ad.mp3', 'example.com'));
assert(!redirected('https://audio-fa.scdn.co/audio/ad.mp3', 'open.spotify.com', 'xmlhttprequest'));
assert(!redirected('https://traffic.megaphone.fm/podcast.mp3'));
assert(!redirected('https://evilscdn.co/audio/ad.mp3'));
assert(fs.statSync(path.join(ROOT, asset)).size > 1000);
assert(bg.includes("const SPOTIFY_MEDIA_RULESET_ID = 'spotify_media';"));
assert(bg.includes('(adshieldOn ? enableRulesetIds : disableRulesetIds).push(SPOTIFY_MEDIA_RULESET_ID);'));
console.log('  ok  Spotify media redirects are scoped, packaged and AdShield-controlled');

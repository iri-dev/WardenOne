/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Regression tests for SessionShield's token-exfiltration destination policy.
 *
 * This evaluates the policy expression from src/content.js so the assertions
 * exercise the implementation that is shipped, rather than a test-only copy.
 *
 *   node tools/test-token-exfil-trust.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const startMarker = 'TOKEN_EXFIL_TRUST_POLICY=';
const endMarker = ',\n      suppressExpectedTokenLog=';
const start = source.indexOf(startMarker);
const end = source.indexOf(endMarker, start);

assert(start >= 0, 'token-exfil trust policy is present in src/content.js');
assert(end > start, 'token-exfil trust policy has a stable end marker');

const expression = source.slice(start + startMarker.length, end).trim();
const isTrustedDestination = vm.runInNewContext(expression, Object.create(null), {
  filename: 'src/content.js:TOKEN_EXFIL_TRUST_POLICY',
});

assert.strictEqual(typeof isTrustedDestination, 'function', 'policy evaluates to a function');

const officialDestinations = [
  ['app.example', 'accounts.google.com'],
  ['app.example', 'cdn.gstatic.com'],
  ['shop.example', 'api.paypal.com'],
  ['shop.example', 'js.stripe.com'],
  ['portal.example', 'login.microsoftonline.com'],
  ['portal.example', 'challenges.cloudflare.com'],
  /* AWS WAF bot check: refusing its token post left IMDb's first visit blank (Browser Guard 1v1). */
  ['www.imdb.com', 'fb423e1ef94f.d0a40594.us-east-1.token.awswaf.com'],
  /* A consent manager storing the visitor's refusal with its consent token (Bleacher Report, Round 5). */
  ['bleacherreport.com', 'privacyportal-eu.onetrust.com'],
  ['news.example', 'cdn.cookielaw.org'],
];

for (const [page, target] of officialDestinations) {
  assert.strictEqual(
    isTrustedDestination(page, target),
    true,
    `${target} should be trusted as an exact official domain or subdomain`,
  );
}

const spoofedDestinations = [
  'google.evil',
  'paypal.evil',
  'stripe.example',
  'microsoft.attacker.test',
  'cloudflare.invalid',
  'accounts.google.com.attacker.test',
  'secure-paypal.com',
  'evilgoogle.com',
  'awswaf.com.attacker.test',
  'token-awswaf.com',
  'onetrust.com.attacker.test',
  'my-onetrust.com',
];

for (const target of spoofedDestinations) {
  assert.strictEqual(
    isTrustedDestination('app.example', target),
    false,
    `${target} must not inherit trust from a brand-looking label`,
  );
}

const familyDestinations = [
  ['open.spotify.com', 'audio-fa.scdn.co'],
  ['download.scdn.co', 'cdn.spotifycdn.com'],
  ['www.spotifycdn.com', 'spotify.com'],
  ['www.youtube.com', 'lh3.googleusercontent.com'],
  ['youtubei.googleapis.com', 'lh3.googleusercontent.com'],
  ['www.netflix.com', 'ipv4-c004-lhr001-ix.nflxvideo.net'],
  ['auth.nflxso.net', 'assets.nflximg.net'],
  ['x.com', 'pbs.twimg.com'],
  ['twitter.com', 't.co'],
  ['www.tiktok.com', 'libraweb16-normal-useastred.tiktokw.eu'],
  ['www.tiktok.com', 'mcs16-normal-useastred.tiktokw.eu'],
  ['www.tiktok.com', 'mon16-normal-useastred.tiktokv.eu'],
  ['www.tiktok.com', 'mcs-va.tiktokv.com'],
  ['www.tiktok.com', 'mon.tiktokv.com'],
  /* Bleacher Report's sports data API and its owner's video platform (Round 5 false warning). */
  ['bleacherreport.com', 'fed-api.sportsplatform.io'],
  ['bleacherreport.com', 'atlas.ngtv.io'],
  ['discord.com', 'cdn.discordapp.net'],
  ['discordapp.com', 'discord.gg'],
  /* The originally reported case, kept as a regression even though it is now
     satisfied by the GLOBAL Spotify entry rather than by Discord's family. Observed
     in the audit trail as "api.spotify.com - discord.com/channels/*": linking Spotify
     makes the Discord page call Spotify's API with a Spotify token, and while that
     was refused "Listening to Spotify" simply never appeared. */
  ['discord.com', 'api.spotify.com'],
  ['discord.com', 'open.spotify.com'],
  ['discord.com', 'i.scdn.co'],
  ['app.slack.com', 'files.slack-edge.com'],
  ['www.figma.com', 's3-alpha.figmausercontent.com'],
  ['www.notion.so', 'static.notion-static.com'],
  ['www.naturalreaders.com', '2poo4vxwjc.execute-api.us-east-1.amazonaws.com'],
  ['www.naturalreaders.com', 'r0lk19wn54.execute-api.us-east-1.amazonaws.com'],
  ['ttsreader.com', 'us-central1-ttsreader.cloudfunctions.net'],
  ['www.dropbox.com', 'content.dropboxapi.com'],
  ['drive.google.com', 'lh3.googleusercontent.com'],
  ['accounts.google.com', 'oauth2.googleapis.com'],
  ['login.microsoftonline.com', 'aadcdn.msftauth.net'],
  ['outlook.office.com', 'tenant.sharepoint.com'],
  ['www.icloud.com', 'cdn.apple-cloudkit.com'],
];

for (const [page, target] of familyDestinations) {
  assert.strictEqual(
    isTrustedDestination(page, target),
    true,
    `${page} should trust its explicit service-family destination ${target}`,
  );
}

const sessionPages = [
  'open.spotify.com',
  'download.scdn.co',
  'www.spotifycdn.com',
  'www.youtube.com',
  'youtubei.googleapis.com',
  'www.netflix.com',
  'auth.nflxso.net',
  'www.twitch.tv',
  'x.com',
  'twitter.com',
  'www.tiktok.com',
  'discord.com',
  'discordapp.com',
  'app.slack.com',
  'www.figma.com',
  'www.notion.so',
  'www.naturalreaders.com',
  'ttsreader.com',
  'www.dropbox.com',
  'drive.google.com',
  'accounts.google.com',
  'login.microsoftonline.com',
  'outlook.office.com',
  'www.icloud.com',
];

for (const page of sessionPages) {
  assert.strictEqual(
    isTrustedDestination(page, 'collector.evil.example'),
    false,
    `${page} must not receive a blanket foreign-destination exemption`,
  );
}

for (const [page, destination] of [
  ['unrelated.example', 'mon.tiktokv.com'],
  ['tiktok.com.attacker.example', 'mon.tiktokv.com'],
  ['www.tiktok.com', 'mon.tiktokv.com.attacker.example'],
  ['www.tiktok.com', 'tiktokw.eu.attacker.example'],
]) assert.strictEqual(isTrustedDestination(page, destination), false, 'TikTok service trust must stay within the verified family');

assert.strictEqual(
  isTrustedDestination('app.slack.com', 's3-alpha.figmausercontent.com'),
  false,
  'one session-trusted family must not inherit another family\'s exemption',
);
assert.strictEqual(
  isTrustedDestination('figma.com.evil.example', 's3-alpha.figmausercontent.com'),
  false,
  'a spoofed page hostname must not activate a trusted family',
);
assert.strictEqual(
  isTrustedDestination('other-reader.example', '2poo4vxwjc.execute-api.us-east-1.amazonaws.com'),
  false,
  'NaturalReader speech service trust must stay on NaturalReader pages',
);
assert.strictEqual(
  isTrustedDestination('naturalreaders.com.evil.example', '2poo4vxwjc.execute-api.us-east-1.amazonaws.com'),
  false,
  'a spoofed NaturalReader page must not gain speech service trust',
);
assert.strictEqual(
  isTrustedDestination('www.naturalreaders.com', 'attacker.execute-api.us-east-1.amazonaws.com'),
  false,
  'other API Gateway projects must remain foreign to NaturalReader',
);
assert.strictEqual(
  isTrustedDestination('other-reader.example', 'us-central1-ttsreader.cloudfunctions.net'),
  false,
  'TTSReader speech service trust must stay on TTSReader pages',
);
assert.strictEqual(
  isTrustedDestination('ttsreader.com.evil.example', 'us-central1-ttsreader.cloudfunctions.net'),
  false,
  'a spoofed TTSReader page must not gain speech service trust',
);
assert.strictEqual(
  isTrustedDestination('ttsreader.com', 'us-central1-attacker.cloudfunctions.net'),
  false,
  'other Cloud Functions projects must remain foreign to TTSReader',
);
/* Spotify is a GLOBAL destination, not a per-app family entry: it is a public OAuth
   API that third-party apps are built on, exactly like YouTube and Google. Scoping it
   per-app fixed Discord and left every other Spotify app broken -- Exportify hung
   forever after login because its playlist fetch was dropped. Asserted from an
   unrelated page so the intent is explicit rather than incidental. */
assert.strictEqual(
  isTrustedDestination('exportify.net', 'api.spotify.com'),
  true,
  'any app built on the Spotify API may call it with the token it was granted',
);
assert.strictEqual(
  isTrustedDestination('some-other-app.example', 'i.scdn.co'),
  true,
  'including the artwork CDN those apps render from',
);
/* Vimeo showed "Rights issue" and never played when Edge fell back to PlayReady: the guard
   refused the playback licence token on its way to ExpressPlay's licence server. */
assert.strictEqual(
  isTrustedDestination('vimeo.com', 'pr.service.expressplay.com'),
  true,
  'a player may send its licence token to the DRM licence service',
);
assert.strictEqual(
  isTrustedDestination('vimeo.com', 'expressplay.com.evil.example'),
  false,
  'a lookalike of the licence service gains no trust',
);
/* The trust is one-directional and does not spread. */
assert.strictEqual(
  isTrustedDestination('open.spotify.com', 'discord.com'),
  false,
  'Spotify does not become a launchpad for tokens to unrelated hosts',
);
assert.strictEqual(
  isTrustedDestination('discord.com', 'collector.evil.example'),
  false,
  'Discord must not receive a blanket foreign-destination exemption',
);
/* Spoof check retargeted at a FAMILY-only destination. Aiming it at Spotify stopped
   testing anything the moment Spotify became global -- it would have passed on the
   spelling of the page name rather than on the suffix matching being sound. */
assert.strictEqual(
  isTrustedDestination('discord.com.evil.example', 'cdn.discordapp.net'),
  false,
  'a spoofed Discord hostname must not activate the Discord family',
);
assert(!/\bsessionTrusted\b/.test(source), 'blanket sessionTrusted bypass has been removed');
assert(!/\btrustedFamilyRe\b/.test(source), 'legacy partial family map has been removed');
assert(!/\bGOOD_DEST\s*=/.test(source), 'brand-prefix destination regex has been removed');

/* A page's own registrable site is never a foreign destination. regDomain only drops www, so on edition.cnn.com
   CNN's own API on default.any-any.prd.api.bolt.cnn.com counted as foreign and its video player could not start.
   The real destIsForeign runs here with the real domain-utils.js, so the public suffix list decides. */
let siteChecks = 0;
{
  const fnStart = source.indexOf('destIsForeign=url=>{');
  const fnEnd = source.indexOf('\n      };', fnStart);
  assert(fnStart > 0 && fnEnd > fnStart, 'destIsForeign is present in src/content.js');
  const fn = source.slice(fnStart + 'destIsForeign='.length, fnEnd + '\n      }'.length);
  const domainUtils = fs.readFileSync(path.join(ROOT, 'domain-utils.js'), 'utf8');
  const foreignFrom = (page) => {
    const ctx = vm.createContext({ URL, console });
    ctx.window = ctx; ctx.self = ctx; ctx.globalThis = ctx;
    vm.runInContext(domainUtils, ctx, { filename: 'domain-utils.js' });
    ctx.location = { href: 'https://' + page + '/', hostname: page };
    ctx.regDomain = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
    ctx.here = ctx.regDomain(page);
    ctx.TOKEN_EXFIL_TRUST_POLICY = () => false;
    return vm.runInContext('(' + fn + ')', ctx);
  };
  const cases = [
    ['edition.cnn.com', 'https://default.any-any.prd.api.bolt.cnn.com/labs/api/v1/sessions', false],
    ['edition.cnn.com', 'https://registry.api.cnn.io/bundles/fave/latest-4.x/js', 'registry.api.cnn.io'],
    ['en.wikipedia.org', 'https://login.wikimedia.org/x', 'login.wikimedia.org'],
    ['en.wikipedia.org', 'https://meta.wikipedia.org/x', false],
    ['shop.example.co.uk', 'https://api.example.co.uk/cart', false],
    ['shop.example.co.uk', 'https://api.other.co.uk/cart', 'api.other.co.uk'],
    ['alice.github.io', 'https://bob.github.io/steal', 'bob.github.io'],
    ['alice.github.io', 'https://alice.github.io/api', false],
    ['app.herokuapp.com', 'https://evil.herokuapp.com/collect', 'evil.herokuapp.com'],
    ['10.0.0.5', 'https://10.0.0.6/collect', '10.0.0.6'],
    ['www.example.com', 'https://cdn.example.com/x', false],
    ['www.example.com', 'https://example.net/x', 'example.net'],
  ];
  for (const [page, url, want] of cases) {
    const got = foreignFrom(page)(url);
    assert.strictEqual(got, want, 'destIsForeign from ' + page + ' to ' + url + ': got ' + JSON.stringify(got));
    siteChecks++;
  }
  /* Without domain-utils.js the old host check still applies, never a looser one. */
  const ctx = vm.createContext({ URL });
  ctx.location = { href: 'https://edition.cnn.com/', hostname: 'edition.cnn.com' };
  ctx.regDomain = (h) => String(h || '').replace(/^www\./, '').toLowerCase();
  ctx.here = 'edition.cnn.com';
  ctx.TOKEN_EXFIL_TRUST_POLICY = () => false;
  const bare = vm.runInContext('(' + fn + ')', ctx);
  assert.strictEqual(bare('https://api.bolt.cnn.com/x'), 'api.bolt.cnn.com', 'without the site helper a sibling stays foreign');
  assert.strictEqual(bare('https://edition.cnn.com/x'), false, 'and the page host itself is never foreign');
  siteChecks += 2;
}

/* The family covers Bleacher Report only, and its owner's data platform stays untrusted. */
for (const [page, target] of [['bleacherreport.com', 'receive.wmcdp.io'], ['news.example', 'fed-api.sportsplatform.io'],
  ['news.example', 'atlas.ngtv.io'], ['bleacherreport.com', 'sportsplatform.io.attacker.test']]) {
  assert.strictEqual(isTrustedDestination(page, target), false, `${page} must not trust ${target}`);
  siteChecks++;
}

console.log(`token-exfil destination trust tests passed (${officialDestinations.length + spoofedDestinations.length + familyDestinations.length + sessionPages.length + 19 + siteChecks} assertions)`);

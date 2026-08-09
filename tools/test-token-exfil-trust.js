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
  ['discord.com', 'cdn.discordapp.net'],
  ['discordapp.com', 'discord.gg'],
  ['app.slack.com', 'files.slack-edge.com'],
  ['www.figma.com', 's3-alpha.figmausercontent.com'],
  ['www.notion.so', 'static.notion-static.com'],
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
  'discord.com',
  'discordapp.com',
  'app.slack.com',
  'www.figma.com',
  'www.notion.so',
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
assert(!/\bsessionTrusted\b/.test(source), 'blanket sessionTrusted bypass has been removed');
assert(!/\btrustedFamilyRe\b/.test(source), 'legacy partial family map has been removed');
assert(!/\bGOOD_DEST\s*=/.test(source), 'brand-prefix destination regex has been removed');

console.log(`token-exfil destination trust tests passed (${officialDestinations.length + spoofedDestinations.length + familyDestinations.length + sessionPages.length + 6} assertions)`);

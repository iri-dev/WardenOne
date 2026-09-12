/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Disclosure contract (M13, PRIV-07).
 *
 * The privacy policy described a password k-anonymity lookup the shipped extension never
 * offered, and omitted the one network call its breach feature actually makes. Nobody noticed
 * because nothing compared the two: the policy was prose, the endpoints were code, and they
 * drifted independently for as long as they liked.
 *
 * So this enumerates the hosts WardenOne really reaches and asserts each is disclosed. It is
 * deliberately built from the code rather than from any list of strings, because a list would
 * be a second copy of the same knowledge and would drift the same way.
 *
 * The first version of that enumeration only looked at seven background files for two literal
 * patterns, which is how it came to pass while the policy was silent about the whole network
 * self-test -- a feature that fetches from two adult sites and a malware test host, from
 * network.js, a file this test never opened. It also missed gql.twitch.tv, which carries the
 * reader's own Twitch Authorization header. Discovery now covers EVERY shipped root script and
 * every URL literal in it, so a new destination cannot hide in a file nobody listed (PRIV-07).
 *
 * Two rules keep that honest rather than merely broad:
 *   - a host counts as disclosed only when the policy names it in a code span. "It appears
 *     somewhere in the prose" passed github.com purely because the policy links to the source
 *     repository.
 *   - a host that is NOT a destination has to say why, in NOT_A_DESTINATION below, and an
 *     entry there that no longer matches any code is itself a failure. A silent skip list is
 *     how the last gap stayed open.
 *
 * Run: node tools/test-privacy-disclosure.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const POLICY = fs.readFileSync(path.join(ROOT, 'PRIVACY.md'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

/* Every script that actually ships from the repository root. src/ and tools/ are
   export-ignored, and content.min.js is generated from src/content.js, so the built copy is
   the one read here. */
const SHIPPED = fs.readdirSync(ROOT).filter((f) => /\.js$/.test(f));

/* Hosts that appear as a URL in shipped code without WardenOne ever requesting them. Each
   needs a reason, and the reason is checked: see the stale-entry assertion below. */
const NOT_A_DESTINATION = {
  'myaccount.google.com': 'a link the OAuth guard offers so you can review that provider\'s authorised apps',
  'account.live.com': 'the same, for Microsoft',
  'github.com': 'the same for GitHub, and the source-repository link in every file header',
  'discord.com': 'the same, for Discord',
  'platform.twitter.com': 'the original src of an embed WardenOne replaced with a placeholder; the page loads it again only if you click through',
  'connect.facebook.net': 'the same, for Facebook embeds',
  'www.instagram.com': 'the same, for Instagram embeds',
  'www.tiktok.com': 'the same, for TikTok embeds',
  'www.twitch.tv': 'a Turbo link inside a blocked-ad overlay, and the page WardenOne is already on',
  'm.media-amazon.com': 'matched inside a CSS :has() selector that hides Twitch ad video, never requested',
  'www.w3.org': 'the SVG XML namespace, which is an identifier and not an address',
};

/* Placeholder and reserved names: documentation examples, not hosts. Any label spelled
   "example" counts, because the examples in this codebase are written as sub.example.co.uk
   as often as example.com. */
const RESERVED = /(^|\.)example(\.|$)|\.(invalid|test|local|localhost)$/;

/* Comments are deliberately NOT stripped before scanning. A URL quoted inside a comment is
   over-discovery, and over-discovery fails loudly -- it asks for a disclosure line or a reason
   here. Stripping would fail silently, and on content.min.js, which is one line, a "//" inside
   a regex literal would take the entire file's hosts with it. */

function runtimeHosts() {
  const hosts = new Map();            // host -> "file:line" of the first sighting
  for (const file of SHIPPED) {
    const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
    src.split('\n').forEach((line, i) => {
      for (const m of line.matchAll(/(["'`])(https?:\/\/[^"'`\s]+)\1/g)) {
        const url = m[2];
        /* A match pattern is permission syntax -- "https://okta.com/*" is a page WardenOne
           stays OUT of, and reading those as destinations buries the real ones in noise. */
        if (url.indexOf('*') !== -1) continue;
        const host = (url.match(/^https?:\/\/([a-z0-9.-]+)/i) || [])[1];
        /* 'https://www.' + domain concatenations leave a trailing dot; a host needs at least
           two labels and an alphabetic tail. */
        if (!host || !/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(host)) continue;
        const h = host.toLowerCase();
        if (RESERVED.test(h)) continue;
        if (!hosts.has(h)) hosts.set(h, file + ':' + (i + 1));
      }
    });
  }
  return hosts;
}

const discovered = runtimeHosts();
const hosts = [...discovered.keys()].filter((h) => !NOT_A_DESTINATION[h]).sort();

check('every shipped root script was searched', SHIPPED.length >= 40, 'found ' + SHIPPED.length
  + ' -- the version of this test that read seven files is how the network self-test went undisclosed');
check('runtime endpoints were discovered at all', hosts.length >= 15, 'found ' + hosts.length);

/* A host is disclosed when the policy NAMES it, in a code span. Substring matching against the
   whole document is not disclosure: the policy links to github.com/iri-dev in its own footer,
   which silently passed github.com as a documented endpoint. */
const policy = POLICY.toLowerCase();
function named(host) { return policy.includes('`' + host + '`'); }

for (const host of hosts) {
  check('PRIVACY.md names ' + host,
    named(host),
    'reached from ' + discovered.get(host) + ' and not named as an endpoint in the policy');
}

/* The skip list cannot outlive the code it excuses. */
const stale = Object.keys(NOT_A_DESTINATION).filter((h) => !discovered.has(h));
check('no NOT_A_DESTINATION entry is stale', stale.length === 0,
  stale.join(', ') + ' -- an excuse for a URL that is no longer there is an excuse waiting to '
  + 'cover a different one');

// The specific defect: the shipped breach feature and its data shape.
check('the site-breach endpoint is named',
  policy.includes('haveibeenpwned.com'));
check('the policy says a registrable domain is what is sent',
  /registrable domain/.test(policy));
check('the 12-hour cache is disclosed', /12 hours/.test(policy));
check('the 120-domain cap is disclosed', /120/.test(policy));
check('the policy says it checks the SITE, not the user account',
  /not your account/.test(policy));

/* The password check is back, deliberately, and the shape of the old mistake is
   what this now guards. Last time the handler existed in the worker and NOTHING
   could reach it, while the policy described it in detail -- a documented feature
   that did not exist. So the pairing runs both ways: the policy has to describe
   it, and the interface has to actually offer it. */
const bg = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const popupHtml = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const popupJs = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

check('the policy describes the password check', /pwnedpasswords\.com/.test(policy));
check('the policy says what actually leaves the device',
  /five hexadecimal characters|first five characters/i.test(policy));
check('the policy says the answer is not written down',
  /written nowhere/i.test(policy));

/* The reason the last one was removed: a documented feature with no way in. */
check('the interface actually offers it', /id="ss-pwned"/.test(popupHtml),
  'the policy would be describing something unreachable again');
check('and something is wired to that control', /ss-pwned/.test(popupJs));

/* It runs from the extension page. Re-adding it as a message kind would hand
   pages a channel to submit hash prefixes through, which is what the old
   'breach-check' kind was. */
check('the worker has no password message kind', !bg.includes("kind === 'breach-check'"),
  'a page-reachable channel for hash prefixes is back');
check('the lookup does not run in the worker', !bg.includes('api.pwnedpasswords.com'),
  'it belongs in the extension page, where no tab can reach it');

// OpenPhish was described as needing a key it has never needed.
check('the policy no longer claims every provider needs an API key',
  !/off by default, your own api key required/.test(policy));
check('OpenPhish is identified as the keyless exception',
  /openphish is the exception/.test(policy));

/* ---- PRIV-07: the recipients the policy used to leave out ------------------------- */

/* 1. Filter feeds. "for example EasyList, AdGuard..." named four of eight and let the rest
      through unnamed. The inventory is GENERATED from the list constants, so pinning the
      policy to it means adding a feed forces the disclosure to move with it. */
const INVENTORY = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs', 'source-inventory.json'), 'utf8'));
const feedHosts = [...new Set(INVENTORY.sources
  .map((s) => { try { return new URL(s.url).host.toLowerCase(); } catch (_) { return null; } })
  .filter(Boolean))].sort();
const unnamedFeeds = feedHosts.filter((h) => !named(h));
check('every filter-list host in the generated inventory is named in the policy',
  unnamedFeeds.length === 0, unnamedFeeds.join(', '));
const COUNT_WORD = { 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve' };
check('the policy states how many list hosts there are, and states the right number',
  policy.includes('reach ' + COUNT_WORD[feedHosts.length] + ' hosts'),
  'the inventory has ' + feedHosts.length + ' distinct hosts; if a feed was added or removed, '
  + 'the sentence claiming "this is all of them" has to move too');
check('the policy points at the generated inventory rather than a hand-written sample',
  /source-inventory\.json/.test(policy) && /generated from the/.test(policy));
check('the policy no longer names only a sample of the list hosts',
  !/for example easylist, adguard/.test(policy));

/* 2. The network filtering self-test. It fetches from two adult sites and a malware test
      host, on a click, and the policy said nothing at all -- the single worst omission in
      PRIV-07, because it is the one that can put an entry in someone else's log. */
const NETWORK_JS = fs.readFileSync(path.join(ROOT, 'network.js'), 'utf8');
const probeHosts = [...new Set([...NETWORK_JS.matchAll(/['"]https:\/\/([a-z0-9.-]+)\/[^'"]*['"]/g)]
  .map((m) => m[1].toLowerCase()))].sort();
check('the self-test probe list was read from network.js', probeHosts.length >= 5,
  probeHosts.join(', '));
for (const host of probeHosts) {
  check('the policy names self-test probe ' + host, named(host));
}
check('the policy warns the self-test is visible to whoever filters the network',
  /dns logs/.test(policy) && /(employer|school)/.test(policy),
  'someone on a monitored network has to be able to decide NOT to press it');
check('and says nothing starts it but the reader',
  /you\s+have to open that page and start the test/.test(policy));

/* 3. The extension checker asks the Web Store about a listing. */
check('the policy names the Web Store lookup', named('chromewebstore.google.com'));

/* 4. Twitch. Two features post to Twitch's GraphQL API, and the ad blocker forwards the
      page's own Authorization header -- which the README flatly denied happened. */
const usesGql = SHIPPED.some((f) => fs.readFileSync(path.join(ROOT, f), 'utf8').includes('https://gql.twitch.tv/gql'));
check('the Twitch GraphQL endpoint is still reached', usesGql,
  'if it is gone, the disclosure below should go with it');
check('the policy names the Twitch endpoint', named('gql.twitch.tv'));
check('the policy says the Twitch request carries the page\'s own Authorization header',
  /authorization/.test(policy) && /never stored or sent anywhere else/.test(policy));
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8').toLowerCase();
check('the README no longer claims no token is ever transmitted',
  !/login tokens and passwords are never stored or transmitted/.test(README),
  'the Twitch ad blocker transmits one, back to the site it came from');
check('the README says where the one token that moves goes', /gql\.twitch\.tv/.test(README));
check('the README admits the self-test is an exception to "only what you asked"',
  /network filtering self-test/.test(README));

/* 5. Enabled reputation providers. The policy said "the specific URL/domain/hash being
      evaluated is sent", which reads as something you asked about. In fact a navigation
      triggers the lookup. Safe Browsing and urlhaus used to get the full path and query;
      since PRIV-03 every provider gets scheme, host and path, and the policy must say
      exactly that -- neither the old "full address" nor anything vaguer. */
const BG_REP = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
check('a page navigation still drives a reputation lookup on its own',
  /urlReputationLookupUrl\(url, Object\.assign\(\{ context: 'page' \}/.test(BG_REP),
  'if lookups became click-only, this section can be softened -- but only then');
check('the engine still keeps a whole-address form for its own comparisons',
  /u\.hash = '';\s*\n\s*return u\.href\.slice\(0, 1500\);/.test(BG_REP),
  'normalizeSafeBrowsingUrl is what the warning pages and cooldown compare against');
check('but what leaves for a provider has no userinfo, query or fragment',
  /function reputationQueryUrl\(url\) \{[\s\S]*?u\.username = '';\s*\n\s*u\.password = '';\s*\n\s*u\.search = '';\s*\n\s*u\.hash = '';/.test(BG_REP),
  'reputationQueryUrl is what decides how much of the address leaves (PRIV-03)');
check('the policy says lookups happen as you navigate, not when you ask',
  /as you navigate to them/.test(policy) && /for the whole time it stays enabled/.test(policy));
check('the policy says providers get scheme, host and path, and no longer the whole address',
  /\*\*scheme, host and path\*\*/.test(policy) && !/receive the \*\*full address\*\*/.test(policy));
check('and admits the path is kept and why', /path is kept on purpose/.test(policy) && /secret carried \*in the path\*/.test(policy));
check('and states the 1,500-character cut the code actually applies',
  /1,500 characters/.test(policy));
check('the policy separates the providers that are held back on ordinary browsing',
  /held back during ordinary browsing/.test(policy));
check('the short version does not present reputation lookups as key-gated only',
  !/opt-in\*\* reputation look-ups that you must\s*\n?\s*switch on and supply your own api key for/.test(policy),
  'OpenPhish needs no key, and the key is not what decides whether your addresses are sent');

/* 6. Local storage that is browsing history in functional terms. PRIV-01 is about whether
      the learner should keep this at all; this is only about saying that it does. */
const BGJS = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
check('the tracker learner still records first-party sites per tracker',
  /Object\.keys\(rawSites\)\.slice\(0, 80\)/.test(BGJS),
  'if the cap moved, the number in the policy is now wrong');
check('the policy says the learner stores which of your sites a tracker appeared on',
  /which of your sites it appeared on/.test(policy) && /80 sites per tracker/.test(policy));
check('and calls that what it is rather than burying it',
  /browsing history in\s*\n?\s*everything but name/.test(policy));

/* 7. The summary at the top counted five ways data leaves and there were seven. */
check('the short version accounts for the button-pressed checks',
  /network filtering\s*\n?\s*self-test/.test(policy) && /\(7\)/.test(policy),
  'a summary that stops at (5) is where a reader forms their view');

// The Limited Use affirmation has to live on the hosted privacy page, because that is the page
// the dashboard points at. PRIVACY.md IS that page -- Pages serves it from main.
// Pin the affirmation SENTENCE, not the words "limited use". Checking for the phrase alone
// passes on a page that merely mentions it -- verified by mutation: deleting the section heading
// left that weaker assertion green, because the body still said the words.
check('the hosted policy carries the Limited Use affirmation',
  /use and transfer of information received from google apis/.test(policy)
    && /chrome web store user data policy/.test(policy)
    && /limited use/.test(policy));
check('the affirmation is a section a reviewer can find, not a buried clause',
  /## chrome web store limited use/.test(policy));
check('the affirmation states the no-advertising limb explicitly',
  /never.{0,40}transferred or used for advertising/.test(policy));
check('the policy date was refreshed alongside the content',
  /last updated: september 11, 2026/.test(policy));

if (failed) { console.error('\n' + failed + ' disclosure check(s) failed'); process.exit(1); }
console.log('\nprivacy disclosure contract holds (' + hosts.length + ' runtime endpoints checked)');

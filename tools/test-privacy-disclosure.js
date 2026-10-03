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
  'iri-dev.github.io': 'the project website, a link on the Settings page\'s About section that you open yourself',
  'discord.com': 'the same, for Discord',
  'platform.twitter.com': 'the original src of an embed WardenOne replaced with a placeholder; the page loads it again only if you click through',
  'connect.facebook.net': 'the same, for Facebook embeds',
  'www.instagram.com': 'the same, for Instagram embeds',
  'www.tiktok.com': 'the same, for TikTok embeds',
  'www.twitch.tv': 'a Turbo link inside a blocked-ad overlay, and the page WardenOne is already on',
  'm.media-amazon.com': 'matched inside a CSS :has() selector that hides Twitch ad video, never requested',
  'adclick.g.doubleclick.net': 'an href prefix in the selector that hides Spotify\'s ad links, never requested',
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
check('the lookup does not run in the worker', !bg.includes('https://api.pwnedpasswords.com'),
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
  /u\.hash = '';\s*\n\s*return u\.href;/.test(BG_REP),
  'normalizeSafeBrowsingUrl is what the warning pages and cooldown compare against');
check('but what leaves for a provider has no userinfo, query or fragment',
  /function reputationQueryUrl\(url\) \{[\s\S]*?u\.username = '';\s*\n\s*u\.password = '';\s*\n\s*u\.search = '';\s*\n\s*u\.hash = '';/.test(BG_REP),
  'reputationQueryUrl is what decides how much of the address leaves (PRIV-03)');
check('the policy says lookups happen as you navigate, not when you ask',
  /as you navigate to them/.test(policy) && /for the whole time it stays enabled/.test(policy));
check('the policy says providers get scheme, host and path, and no longer the whole address',
  /\*\*scheme, host and path\*\*/.test(policy) && !/receive the \*\*full address\*\*/.test(policy));
check('and admits the path is kept and why', /path is kept on purpose/.test(policy) && /secret carried \*in the path\*/.test(policy));
check('and states the 1,500-character provider limit without claiming truncation',
  /longer than 1,500 characters are skipped/.test(policy) && !/cut at 1,500 characters/.test(policy));
check('the policy separates the providers that are held back on ordinary browsing',
  /held back during ordinary browsing/.test(policy));
check('the short version does not present reputation lookups as key-gated only',
  !/opt-in\*\* reputation look-ups that you must\s*\n?\s*switch on and supply your own api key for/.test(policy),
  'OpenPhish needs no key, and the key is not what decides whether your addresses are sent');

/* 6. Local storage that is browsing history in functional terms. This used to pin the learner
      keeping up to 80 named first-party sites per tracker, and the policy saying so. PRIV-01
      then stopped the learner keeping names at all -- and nobody saw these checks go red,
      because the gate never ran this file (see check-maintainability.js). The contract is now
      the reverse: the store holds a count, and the policy says it is a count. */
const BGJS = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const learnerShape = (BGJS.match(/function trackerStoreShape\(raw\) \{[\s\S]*?\n\}\n/) || [''])[0];
check('the tracker learner stores a count of sites, not their names',
  /\n\s*sites: siteCount,\n/.test(learnerShape) && !/Object\.keys\(rawSites\)\.slice\(0, 80\)/.test(BGJS),
  'if names are stored again, the policy below is wrong and so is PRIV-01');
check('the policy says the learner keeps a count of sites and never their names',
  /a count of sites \(never their names\)/.test(policy));
check('and says what happened to the names an earlier build kept',
  /80 named sites per tracker/.test(policy) && /the names are gone/.test(policy));

/* 7. The summary at the top counted five ways data leaves and there were seven. */
check('the short version accounts for the button-pressed checks',
  /network filtering\s*\n?\s*self-test/.test(policy) && /\(7\)/.test(policy),
  'a summary that stops at (5) is where a reader forms their view');
/* And it said "the only times data leaves your device are" without the browser-release check,
   which runs on its own whenever the popup opens -- the detailed section named it, the summary a
   reader actually stops at did not. Scoped to the summary, because the detail passing is how it
   was missed. */
const shortVersion = policy.slice(policy.indexOf('## the short version'), policy.indexOf('\n---', policy.indexOf('## the short version')));
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const releaseCheckLive = /versionhistory\.googleapis\.com|edgeupdates\.microsoft\.com|versions\.brave\.com/.test(POPUP_JS);
check('the popup still checks browser releases, so the summary entry below still applies', releaseCheckLive);
check('the short version names the automatic browser-release check',
  /only times data leaves your device/.test(shortVersion) && /browser-release check when you open the\s*\n?\s*popup/.test(shortVersion)
    && /update\s*\n?\s*guardian/.test(shortVersion),
  'the summary claims to list every way data leaves; Update Guardian runs on every popup open');
check('and does not suggest it can be switched off', /it has no off switch/.test(shortVersion),
  'there is no setting for it; if one is added, say so instead');
/* The six-hour cache lives in storage.session, which Chrome clears on a browser restart and on
   an extension reload or update. "At most once every six hours" was therefore false: open the
   popup, restart, open it again, and that is two requests in minutes. The wording follows the
   storage area the code actually uses. */
const guardianSessionCache = /chrome\.storage\.session\.get\(key\)/.test(POPUP_JS) && /updateGuardian:/.test(POPUP_JS);
const PERMS_FILE = fs.readFileSync(path.join(ROOT, 'permissions.html'), 'utf8');
check('the release check still caches in session storage, so the wording below still applies', guardianSessionCache,
  'if the cache moves to storage.local, a hard six-hour limit becomes true and the policy may say so');
check('the summary does not promise a six-hour limit that a restart breaks',
  !/at most once every six hours/.test(shortVersion) && /up to six hours while the browser stays\s*\n?\s*open/.test(shortVersion));
check('and neither does the Permissions page',
  !/cached for six hours\./i.test(PERMS_FILE) && /up to six hours while the browser stays open/i.test(PERMS_FILE));

/* 7b. The website said "the few checks that contact an outside service are opt-in". The release
       check is automatic, as are the list downloads, so that sentence was false. */
const SITE_HTML = fs.readFileSync(path.join(ROOT, 'site', 'index.html'), 'utf8');
check('the website does not call every outside contact opt-in',
  !/contact an outside service are opt-in/i.test(SITE_HTML) && !/(checks|requests) that contact an outside service[^<.]{0,40}\bopt-in/i.test(SITE_HTML),
  'filter-list downloads and the browser-release check happen without a switch');
check('and names the automatic browser-release check beside the opt-in lookups',
  /browser-release check when you open the popup/.test(SITE_HTML) && /lookups that would are opt-in/.test(SITE_HTML));

/* 8. The Permissions page inside the extension has its own "What can leave the browser" list,
      and it is the one a reader actually opens from the popup. It listed only the opt-in
      reputation providers, under a banner calling everything there "opt-in checks" -- while
      the daily filter-list downloads, Script Drift's re-fetches and the Twitch requests, all
      of them on by default, went unmentioned, as did the Web Store lookup and the network
      self-test. An external audit caught it; nothing here compared the page to anything.
      Now it is held to the same host set as the policy: every destination discovered in the
      code, every list host in the generated inventory and every self-test probe must be named
      in a host line on that page, and the traffic that runs on its own must be filed as
      automatic rather than under the opt-in banner. */
const PERMS_HTML = fs.readFileSync(path.join(ROOT, 'permissions.html'), 'utf8');
const servicesAt = PERMS_HTML.indexOf('id="services"');
const servicesSection = servicesAt >= 0 ? PERMS_HTML.slice(servicesAt, PERMS_HTML.indexOf('</section>', servicesAt)) : '';
check('the Permissions page still has its "What can leave the browser" section',
  /What can leave the browser/.test(servicesSection));
const HOST_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/;
function hostlineHosts(html) {
  const out = new Set();
  for (const m of html.matchAll(/<div class="hostline">([\s\S]*?)<\/div>/g)) {
    for (const item of m[1].split(',')) {
      const host = item.trim().toLowerCase().split('/')[0];
      if (HOST_RE.test(host)) out.add(host);
    }
  }
  return out;
}
const pageHosts = hostlineHosts(servicesSection);
const mustBeOnPage = [...new Set([...hosts, ...feedHosts, ...probeHosts])].sort();
const offPage = mustBeOnPage.filter((h) => !pageHosts.has(h));
check('the Permissions page names every destination the code reaches', offPage.length === 0,
  offPage.join(', ') + ' -- reached by shipped code and missing from the page\'s host lines');
const unexplained = [...pageHosts].filter((h) => !mustBeOnPage.includes(h)).sort();
check('and names nothing the code does not reach', unexplained.length === 0,
  unexplained.join(', ') + ' -- a host line for a request that no longer exists');

const optInAt = servicesSection.indexOf('<span>Opt-in checks</span>');
const automatic = optInAt >= 0 ? servicesSection.slice(0, optInAt) : '';
check('the page separates automatic traffic from opt-in checks',
  optInAt > 0 && /<span>Automatic<\/span>/.test(automatic),
  'everything listed under one "opt-in" banner is how the default-on requests went unmentioned');
const automaticHosts = hostlineHosts(automatic);
const listHostsNotAutomatic = feedHosts.filter((h) => !automaticHosts.has(h));
check('every filter-list host is filed as automatic', listHostsNotAutomatic.length === 0,
  listHostsNotAutomatic.join(', ') + ' -- the lists download daily without a click');
check('the Twitch endpoint is filed as automatic', automaticHosts.has('gql.twitch.tv'),
  'ad blocking and rewind are on by default on Twitch');
const DEFAULTS = (BGJS.match(/const DEFAULT_CONFIG = \{[\s\S]*?\n\};/) || [''])[0];
check('Script Drift is still on by default and still re-fetches scripts',
  /\n\s*scriptDriftGuard: true,/.test(DEFAULTS) && /async function fetchScriptForDrift\(/.test(BGJS),
  'if either changed, the page\'s "automatic" row has to change with it');
check('and the page lists it with the automatic traffic, by the name the popup uses',
  /Script Drift Guard/.test(automatic) && /<strong>Script drift guard<\/strong>/.test(automatic));

/* 9. A published document may only link to something published beside it. SUPPORT.md linked
      to README.md and PRIVACY.md to docs/source-inventory.json, both relative -- fine on
      GitHub's repository view, but GitHub Pages publishes only what pages.yml copies, and it
      copies neither target, so both links were dead on the live pages (the privacy policy is
      the page the store listing points at). The release zip carried SUPPORT.md the same way
      until .gitattributes excluded it. Relative links are checked against what is actually
      staged; everything else has to be an absolute URL. */
const PAGES_YML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'pages.yml'), 'utf8');
const staged = new Set([...PAGES_YML.matchAll(/^\s*cp\s+(\S+)\s+_pages\/(\S*)\s*$/gm)]
  .map((m) => (m[2] && !m[2].endsWith('/') ? m[2] : m[2] + path.posix.basename(m[1]))));
const stagedDocs = [...staged].filter((f) => /\.md$/.test(f)).sort();
check('the Pages workflow was read and publishes the policy', stagedDocs.includes('PRIVACY.md'),
  'staged: ' + [...staged].join(', '));
for (const doc of stagedDocs) {
  const text = fs.readFileSync(path.join(ROOT, doc), 'utf8');
  const dead = [...text.matchAll(/\]\(([^)\s]+)\)/g)].map((m) => m[1])
    .filter((t) => !/^([a-z][a-z0-9+.-]*:|#|\/)/i.test(t))
    .filter((t) => !staged.has(t.split('#')[0]));
  check(doc + ' links only to what Pages publishes beside it', dead.length === 0,
    dead.join(', ') + ' -- relative link to a file pages.yml never copies; use an absolute URL');
}

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
  /last updated: october 1, 2026/.test(policy));

/* M52: "the complete list" has to be complete about what the reader adds themselves, too. A
   subscribed filter list is fetched from a host the reader chose, so it cannot be named -- it has
   to be described. And the stores the reader authors are data WardenOne keeps. */
const CUSTOM_LIST_FETCHED = /async function fetchCustomListText\(/.test(BGJS) && /credentials: 'omit'/.test(BGJS);
check('custom lists are still fetched, so their disclosure still applies', CUSTOM_LIST_FETCHED);
check('the policy describes fetching a filter list the reader added',
  /### 9\. filter lists you add yourself/.test(policy) && /never on its own/.test(policy)
    && /fetching a filter list you added\s*\n?\s*yourself/.test(policy));
check('the policy lists the notification history it keeps', /notification history behind the notification centre/.test(policy)
  && /up to 300 notices/.test(policy));
check('the policy lists the rules and lists the reader makes',
  ['my rules', 'filter lists\n  you subscribe to', 'per-site firewall', 'element zapper', 'blocked-site list']
    .every((s) => policy.includes(s)), 'every store a reader authors has to be named');
check('and the Permissions page lists the same button-pressed fetch',
  /Filter lists you add/.test(PERMS_HTML));

if (failed) { console.error('\n' + failed + ' disclosure check(s) failed'); process.exit(1); }
console.log('\nprivacy disclosure contract holds (' + hosts.length + ' runtime endpoints checked)');

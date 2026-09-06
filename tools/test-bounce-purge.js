/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Bounce-tracking storage purge, inside redirect-chain protection.
 *
 * A tracker is briefly a FIRST party during a redirect -- A -> tracker -> B -- and can
 * set cookies and storage in that moment, which is the state third-party cookie blocking
 * does not reach. This clears what such a hop left behind.
 *
 * ALMOST ALL OF THIS SUITE IS ABOUT WHAT MUST NOT BE PURGED. Deleting storage is not
 * recoverable and the flows that legitimately bounce you across domains are the ones
 * where the damage is worst: SSO, OAuth callbacks, 3-D Secure, checkout handoffs. A
 * tracker that keeps its cookies is a miss. A checkout wiped halfway through is a bug
 * report nobody can diagnose, because the evidence was the thing that got deleted.
 *
 * trackingBounceDomains is lifted out of background.js and run for real.
 *
 * Run: node tools/test-bounce-purge.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const HISTORY_JS = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

const start = BG.indexOf('const BOUNCE_PURGE_PAYMENT_DOMAINS = [');
const end = BG.indexOf('async function purgeTrackingBounces(', start);
const sliceable = start > 0 && end > start;
check('the selector is where the slice expects it', sliceable);
if (!sliceable) {
  console.error('bounce purge: ' + failed + ' failed');
  process.exit(1);
}
const BLOCK = BG.slice(start, end);

function makeSelector(world) {
  const o = world || {};
  const sandbox = {
    String, Number, Boolean, Object, Set, Array, URL, RegExp, console,
    BLOCKED_DOMAINS: new Set(o.blocked || []),
    GRABBER_FEED_DOMAINS: new Set(o.grabbers || []),
    registrableDomainBg: (h) => {
      const parts = String(h || '').split('.').filter(Boolean);
      if (parts.length <= 2) return parts.join('.');
      const last2 = parts.slice(-2).join('.');
      return /^(co|com|org|net|ac)\.[a-z]{2}$/.test(last2) ? parts.slice(-3).join('.') : last2;
    },
    isNeverBlockDomain: (d) => (o.neverBlock || []).includes(d),
    isLoginCompatibilityUrl: (u) => /accounts\.google\.com|login\.microsoftonline\.com|okta\.com|\/oauth2?\//i.test(String(u || '')),
    hostMatchesAllowlist: (d, list) => (list || []).some((a) => d === a || d.endsWith('.' + a)),
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [],
    /* The real one, so the auth exclusion under test is the shipped one rather than a
       stand-in that agrees with it by accident. */
    redirectChainContainsKnownAuth: null,
  };
  const authSrc = BG.slice(BG.indexOf('function redirectChainContainsKnownAuth('),
    BG.indexOf('function redirectChainShouldInterrupt('));
  vm.createContext(sandbox);
  vm.runInContext(authSrc + BLOCK + ';globalThis.__pick = trackingBounceDomains;'
    + 'globalThis.__excluded = bouncePurgeExcludedDomain;', sandbox, { filename: 'background.js:bounce' });
  return { pick: sandbox.__pick, excluded: sandbox.__excluded };
}

/* hops[i].to is the url redirected TO; the last hop's url is where you ended up. */
function chainOf(startDomain, hopHosts) {
  const hops = hopHosts.map((h) => ({ to: 'https://' + h + '/r', host: h, at: 1 }));
  const domains = [startDomain].concat(hopHosts.map((h) => h.split('.').slice(-2).join('.')));
  return { hops, domains, flagged: false };
}
const finalOf = (hopHosts) => 'https://' + hopHosts[hopHosts.length - 1] + '/r';

/* ---- the case this exists for --------------------------------------------- */
{
  const s = makeSelector({ blocked: ['tracker.example'] });
  const hops = ['tracker.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('a blocklisted hop passed through is purged', got.join(',') === 'tracker.example',
    'got [' + got.join(',') + ']');
}
{
  const s = makeSelector({ grabbers: ['grabify.example'] });
  const hops = ['grabify.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('an IP-logger hop counts too', got.join(',') === 'grabify.example');
}

/* ---- what must NEVER be purged --------------------------------------------- */
{
  const s = makeSelector({ blocked: ['news.example'] });
  const hops = ['news.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('the site the navigation started on is never purged', got.length === 0,
    'got [' + got.join(',') + ']; that is the site the reader was actually using');
}
{
  const s = makeSelector({ blocked: ['shop.example'] });
  const hops = ['tracker.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('the site landed on is never purged', got.length === 0,
    'got [' + got.join(',') + ']; the reader is sitting on it');
}
{
  const s = makeSelector({ blocked: ['tracker.example'] });
  const hops = ['tracker.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('a single hop is not a bounce', got.length === 0,
    'A -> B has no middle, whatever B is');
}
{
  /* The case where "not the last hop" and "not the landed site" stop being the same
     rule: the tracker bounces through ITSELF and the reader ends up on it. Only the
     landed check can see that, and without it WardenOne would wipe the site currently
     on screen. */
  const s = makeSelector({ blocked: ['tracker.example'] });
  const hops = ['tracker.example', 'tracker.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('a hop that is also where the reader ended up is not purged', got.length === 0,
    'got [' + got.join(',') + ']');
}
check('the walk stops one short of the end',
  /for \(let i = 0; i < hops\.length - 1; i\+\+\) \{/.test(BG),
  'the last hop is where the reader ended up, not somewhere they were sent on from');
{
  const s = makeSelector({});
  const hops = ['unknown.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('an intermediary on no list is left alone', got.length === 0,
    'a domain WardenOne would not refuse a request to is one the reader may have an '
    + 'account with; "it redirected me" is not evidence of anything');
}
for (const [what, chainHops, blocked] of [
  ['an SSO handoff', ['accounts.google.com', 'app.example'], ['accounts.google.com']],
  ['an OAuth callback further down the chain', ['ads.example', 'login.microsoftonline.com', 'app.example'], ['ads.example']],
  ['an identity provider in the middle', ['okta.com', 'app.example'], ['okta.com']],
]) {
  const s = makeSelector({ blocked });
  const got = s.pick(chainOf('start.example', chainHops), finalOf(chainHops), {});
  check(what + ' purges nothing at all', got.length === 0,
    'got [' + got.join(',') + ']; ONE login-shaped hop protects the WHOLE chain, because '
    + 'a sign-in routed through an ad network is still a sign-in');
}
{
  const s = makeSelector({ blocked: ['m.stripe.com'] });
  const hops = ['m.stripe.com', 'shop.example'];
  const got = s.pick(chainOf('shop.example', hops), finalOf(hops), {});
  check('payment plumbing is excluded even when a list carries it', got.length === 0,
    'got [' + got.join(',') + ']; Stripe\'s fraud host really is on tracker lists, which '
    + 'is exactly the combination that would wipe a card form mid-checkout');
}
for (const dom of ['adyen.com', 'braintree-api.com', 'klarna.com', 'cardinalcommerce.com',
  '3dsecure.io', 'paypal.com', 'checkout.com']) {
  const s = makeSelector({ blocked: [dom] });
  const hops = [dom, 'shop.example'];
  check(dom + ' is excluded', s.pick(chainOf('shop.example', hops), finalOf(hops), {}).length === 0);
}
{
  const s = makeSelector({ blocked: ['cdn.example'], neverBlock: ['cdn.example'] });
  const hops = ['cdn.example', 'shop.example'];
  check('a never-block domain is excluded',
    s.pick(chainOf('news.example', hops), finalOf(hops), {}).length === 0);
}
{
  const s = makeSelector({ blocked: ['ads.example'] });
  const hops = ['ads.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), { allowlist: ['ads.example'] });
  check('a site on the reader\'s allowlist is excluded', got.length === 0,
    'they have already said they want this site left alone');
}
{
  const s = makeSelector({ blocked: ['ads.example'] });
  const hops = ['ads.example', 'ads.example', 'shop.example'];
  const got = s.pick(chainOf('news.example', hops), finalOf(hops), {});
  check('the same domain is only listed once', got.join(',') === 'ads.example');
}
{
  const many = ['a.example', 'b.example', 'c.example', 'd.example', 'e.example', 'f.example'];
  const s = makeSelector({ blocked: many });
  const hops = many.concat(['shop.example']);
  check('the number purged per chain is capped',
    s.pick(chainOf('news.example', hops), finalOf(hops), {}).length <= 4);
}
check('an unanswerable question means no purge',
  /catch \(_\) \{\s*\/\*[\s\S]{0,140}\*\/\s*return true;/.test(BLOCK),
  'the exclusion test must fail CLOSED; a thrown error has to mean "leave it alone"');

/* ---- what is actually cleared ---------------------------------------------- */
check('it clears site storage, not browsing history',
  /wipeSiteData\(domain, \{ history: false \}, \[\]\)/.test(BG),
  'clearing what a tracker stored is not a licence to edit where the reader has been');
check('a failed wipe cannot stop the others',
  /try \{ await wipeSiteData\(domain[^\n]*\} catch \(_\) \{\}/.test(BG));
check('the purge cannot delay the interstitial',
  /void purgeTrackingBounces\(chain, finalUrl, cfg\);/.test(BG),
  'a redirect warning must not wait on a storage wipe');
check('and it runs before the logging thresholds',
  BG.indexOf('void purgeTrackingBounces(') < BG.indexOf('if (!longChain && !confirmedThreat) return;'),
  'the ordinary bounce is short and quiet and falls under every one of those bars');

/* ---- recorded ---------------------------------------------------------------- */
check('it is recorded', /type: 'purged_bounce_storage'/.test(BG));
check('with the domains that were cleared', /domains: domains\.slice\(0, 4\)/.test(BG));
check('Activity names it', /purged_bounce_storage: 'Redirect tracker/.test(HISTORY_JS));
check('and shows which sites were cleared',
  /e\.type === 'purged_bounce_storage'/.test(HISTORY_JS) && /'Cleared: ' \+ doms\.join/.test(HISTORY_JS));

/* ---- merged, not a new feature ---------------------------------------------- */
check('there is no toggle of its own',
  !/bounceStorage|bouncePurge(?!ExcludedDomain|PaymentDomains)|purgeBounce/i.test(
    BG.replace(/BOUNCE_PURGE_PAYMENT_DOMAINS|bouncePurgeExcludedDomain/g, '')),
  'it was asked for as part of redirect protection, not as its own shield');
check('and no popup switch', !/data-key="[a-zA-Z]*[Bb]ounce[a-zA-Z]*"/.test(POPUP_HTML));
check('and no entry in the protection count',
  !/'bouncePurge'|'bounceStorage'/.test(BG.match(/const HEALTH_SHIELD_KEYS = \[[\s\S]*?\];/)[0]));
check('it rides the redirect-chain switch that was already there',
  /cfg\.detectRedirectChains === false\) return;/.test(BG)
  && BG.indexOf('cfg.detectRedirectChains === false) return;') < BG.indexOf('void purgeTrackingBounces('),
  'turning redirect protection off has to turn this off too');

if (failed) {
  console.error('bounce purge: ' + failed + ' failed');
  process.exit(1);
}
console.log('bounce purge: all checks passed');

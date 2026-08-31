/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Frame-driven top navigation -- the redirect neither existing layer could see.
 *
 * A cross-origin iframe setting top.location goes through Chrome's cross-origin
 * path, which never runs a JS accessor the top frame installed, so no in-page
 * hook in any frame can observe it. It is also not an HTTP 30x, so it never
 * becomes a redirect-chain hop. The only place left is the service worker, which
 * sees the navigation but not who caused it -- so the content script supplies the
 * attribution and this file tests that the two halves agree.
 *
 * The risk here is a false positive cancelling ordinary navigation, so most of
 * these checks are about what must NOT fire.
 *
 * Run: node tools/test-frame-redirect-guard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const GUARD = fs.readFileSync(path.join(ROOT, 'anti-redirect.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');

const START = 'const PLAYER_GESTURE_AT = Object.create(null);';
const END = 'async function evaluateRedirectChain(details) {';
const from = BG.indexOf(START);
const to = BG.indexOf(END, from + START.length);
assert(from >= 0 && to > from, 'the frame-redirect guard moved in background.js');
const SLICE = BG.slice(from, to);

let passed = 0;
let failed = 0;
function check(name, condition, extra) {
  if (condition) { passed++; console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra === undefined ? '' : ' :: ' + JSON.stringify(extra)));
  process.exitCode = 1;
}

// ---------------------------------------------------------------------------
// A sandbox holding the shipped worker-side logic
// ---------------------------------------------------------------------------
function world(options) {
  const o = options || {};
  const history = [];
  const updates = [];
  const sandbox = {
    DEFAULT_CONFIG: { enabled: true, blockPopupTricks: true, allowlist: [] },
    localGet: () => Promise.resolve({ wardenone_config: o.config || {} }),
    activeAllowlist: (cfg) => (cfg && cfg.allowlist) || [],
    /* Both names are real in background.js -- registrableDomainBg is a thin wrapper
       -- and the two functions under test happen to use one each. Stubbing only one
       let a ReferenceError land in a catch that returns, so the guard silently did
       nothing and every behavioural check passed for the wrong reason. */
    registrableDomain: (host) => String(host || '').split('.').slice(-2).join('.'),
    registrableDomainBg: (host) => String(host || '').split('.').slice(-2).join('.'),
    queueHistory: (entry) => history.push(entry),
    redirectWarningPageUrl: (info) => 'chrome-extension://x/redirect-warning.html?to=' +
      encodeURIComponent(info.targetUrl) + '&why=' + encodeURIComponent(info.why),
    chrome: { tabs: { update: (id, props) => { updates.push({ id, props }); return Promise.resolve(); } } },
    isLoginCompatibilityUrl: (u) => /accounts\.google|login\.microsoftonline|\/oauth|\/saml/i.test(String(u || '')),
    URL, Object, Date, String, Number, Promise,
  };
  vm.createContext(sandbox);
  /* const/let at the top level of a vm script are lexical bindings, not
     properties of the contextified object, so the per-tab maps have to be handed
     out deliberately. Function declarations do land on it, which is why the two
     entry points below can be called straight off the sandbox. */
  vm.runInContext(SLICE + '\nglobalThis.__state = { PLAYER_GESTURE_AT, TOP_NAV_OWNED_AT, LAST_TOP_URL, LAST_GESTURE_AT };',
    sandbox, { filename: 'frame-redirect-slice.js' });
  const state = sandbox.__state;
  assert(state && state.LAST_TOP_URL, 'the guard no longer keeps the per-tab maps this suite drives');
  return {
    history,
    updates,
    sandbox,
    state,
    signal(tabId, kind) { sandbox.noteNavSignal(tabId, kind); },
    committed(tabId, url) { state.LAST_TOP_URL[tabId] = url; },
    age(tabId, ms) {
      if (state.PLAYER_GESTURE_AT[tabId]) state.PLAYER_GESTURE_AT[tabId] -= ms;
      if (state.TOP_NAV_OWNED_AT[tabId]) state.TOP_NAV_OWNED_AT[tabId] -= ms;
      if (state.LAST_GESTURE_AT[tabId]) state.LAST_GESTURE_AT[tabId] -= ms;
    },
    navigate(tabId, url) {
      return sandbox.maybeFlagFrameDrivenRedirect({ tabId, frameId: 0, url });
    },
    /* Every real forced redirect arrives as a client_redirect. Tests that want
       any OTHER transition pass it explicitly. */
    forced(tabId, url, qualifiers) {
      return sandbox.maybeBlockForcedTopRedirect({
        tabId, frameId: 0, url,
        transitionQualifiers: qualifiers === undefined ? ['client_redirect'] : qualifiers,
      });
    },
  };
}

/* The shape yomi.to used: a click that landed on the player and targeted nothing,
   then the tab leaves for another site with no top-frame hook claiming it. */
async function main() {
  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/something');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://fake-google.example/search?q=x');
    check('a frame sending the tab elsewhere after a player click is caught',
      w.updates.length === 1, w.updates);
    check('and it is an interstitial, never a silent cancel',
      /redirect-warning\.html/.test((w.updates[0] || {}).props?.url || ''), w.updates);
    check('it is recorded once', w.history.length === 1 &&
      w.history[0].type === 'blocked_frame_top_redirect', w.history);
    check('the record names both sides',
      w.history[0].detail.from === 'yomi.to' && w.history[0].detail.matched === 'fake-google.example',
      w.history[0].detail);
    check('the reason says the click did not go to that site',
      /did not click a link/i.test(decodeURIComponent(w.updates[0].props.url)), w.updates[0].props.url);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/x');
    await w.navigate(1, 'https://elsewhere.example/');
    check('a navigation with no player click behind it is ordinary browsing',
      w.updates.length === 0 && w.history.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    w.age(1, 4000);
    await w.navigate(1, 'https://elsewhere.example/');
    check('a click four seconds ago no longer explains a navigation',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    w.signal(1, 'top-nav-authorized');
    await w.navigate(1, 'https://elsewhere.example/');
    check('a navigation our own top-frame hooks let through is not a hijack',
      w.updates.length === 0 && w.history.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://cdn.yomi.to/watch/next');
    check('moving around the same site is never a hijack', w.updates.length === 0, w.updates);
  }

  {
    const w = world({ config: { blockPopupTricks: false } });
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://elsewhere.example/');
    check('turning the guard off silences it', w.updates.length === 0, w.updates);
  }

  /* Downloads. Reported from real use: a site sends you to another domain to hand you a file,
     and this guard threw an interstitial over it.

     The premise it rests on -- "this tab was sent somewhere you did not ask to go" -- is simply
     not true for a download. Chrome turns the navigation into a download and the page you were
     on stays put, so nothing was hijacked. What the interstitial actually stopped was the file,
     and whether a file is safe to have is Download Shield's call: it grades every one, blocks
     the known-bad and holds the risky for review, with a reason attached. Cancelling here took
     that judgement away and left someone with neither the file nor an explanation. */
  {
    const w = world();
    w.committed(1, 'https://videos.example/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://cdn.example.net/files/App-Setup-1.4.exe');
    check('a file handed over after a player click is not treated as a hijack',
      w.updates.length === 0 && w.history.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://videos.example/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://dl.example.org/get?token=abc&file=release-2.1.zip');
    check('and the same when the filename rides in the query, as release CDNs do',
      w.updates.length === 0, w.updates);
  }

  {
    /* The half that keeps it honest: this is an exemption for files, not for that destination.
       The same site sending the tab to an ordinary page is still caught. */
    const w = world();
    w.committed(1, 'https://videos.example/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://cdn.example.net/landing/win-a-prize');
    check('a page at the same host is still a hijack', w.updates.length === 1, w.updates);
  }

  {
    /* "download" in a path does not make something a file. A lander called /download is the
       oldest shape in this business. */
    const w = world();
    w.committed(1, 'https://videos.example/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://sketchy.example/download');
    check('a page merely called /download is not a file and is still caught',
      w.updates.length === 1, w.updates);
  }

  {
    /* The exemption hands the decision to Download Shield rather than dropping it, so with
       Download Shield off there is nothing to hand it to and the old behaviour stands. */
    const w = world({ config: { downloadReputation: false } });
    w.committed(1, 'https://videos.example/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://cdn.example.net/files/App-Setup-1.4.exe');
    check('with Download Shield off the file is not waved through',
      w.updates.length === 1, w.updates);
  }

  {
    /* One click buys one navigation. Without clearing the signals, a download followed by a
       real hijack would both be spent from the same gesture and the second would go unseen. */
    const w = world();
    w.committed(1, 'https://videos.example/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://cdn.example.net/files/App-Setup-1.4.exe');
    await w.navigate(1, 'https://elsewhere.example/');
    check('the click is spent by the download and cannot also excuse a later jump',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world({ config: { enabled: false } });
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://elsewhere.example/');
    check('the master switch silences it', w.updates.length === 0, w.updates);
  }

  {
    const w = world({ config: { allowlist: ['yomi.to'] } });
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://elsewhere.example/');
    check('"allow this site" is honoured here too', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://a.example/');
    await w.navigate(1, 'https://b.example/');
    check('a page that keeps trying cannot stack interstitials',
      w.updates.length === 1, w.updates.length);
  }

  {
    const w = world();
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'https://elsewhere.example/');
    check('with no page committed there is nothing to compare against',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/watch/x');
    w.signal(1, 'player-gesture');
    await w.navigate(1, 'about:blank');
    check('an unparseable destination is left alone', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.signal(-1, 'player-gesture');
    check('a signal from no real tab is dropped',
      Object.keys(w.state.PLAYER_GESTURE_AT).length === 0,
      w.state.PLAYER_GESTURE_AT);
  }

  // -------------------------------------------------------------------------
  // The content-script half has to raise the signal on exactly the right click
  // -------------------------------------------------------------------------
  check('the player signal needs a click that targeted no URL of its own',
    /if \(lastGestureTainted && !intentWasExplicit\) signal\('player-gesture'\);/.test(GUARD),
    'without !intentWasExplicit, a thumbnail that is genuinely a link would be flagged');
  /* The plain gesture beacon is the opposite: it must fire for ANY gesture, or the
     ad-tracker guard below cannot tell a click the user made from a forced jump. */
  /* It must fire for ordinary clicks, not only tainted ones -- otherwise the
     worker cannot tell a jump the user asked for from a forced one. The single
     exception is a harvested click, checked separately below. */
  check('the plain gesture beacon is not narrowed to player clicks',
    /if \(!overlay\) signal\('gesture'\);/.test(GUARD)
      && !/lastGestureTainted[^\n]*signal\('gesture'\)/.test(GUARD),
    'gating it on taint would leave every ordinary click unable to authorise anything');
  check('and it is throttled rather than sent on every click',
    /if \(kind === 'gesture'\)/.test(GUARD) && /lastGestureBeacon < 500/.test(GUARD));
  check('the gesture signal is top-frame only',
    /function frameTopRedirectEnabled\(\)\s*\{\s*return TOP_FRAME &&/.test(GUARD));
  check('it honours the master switch and the allowlist',
    /frameTopRedirectEnabled\(\)\s*\{\s*return TOP_FRAME && masterEnabled\(\)/.test(GUARD),
    'masterEnabled() is what folds in the user allowlist');
  check('it can be turned off on its own',
    /cfg\(\)\.blockPopupTricks !== false/.test(GUARD));
  /* Every path out of blockNavigation that lets a cross-site target through has
     to announce it, including the one where the guard is switched off -- or the
     worker sees an unattributed navigation and blames a frame for our own. */
  const nav = GUARD.slice(GUARD.indexOf('function blockNavigation('),
    GUARD.indexOf('function corePopupPolicy('));
  const announces = (nav.match(/signal\('top-nav-authorized'\)/g) || []).length;
  check('every path that allows a cross-site navigation announces it', announces === 2,
    announces + ' announcement(s); the disabled path and the allowed path both need one');
  check('the disabled path announces before returning',
    /if \(!navigationEnabled\(\)\) \{\s*if \(!sameSiteTarget\(rawTarget\)\) signal\('top-nav-authorized'\);/.test(nav),
    'with the guard off, our own redirects would otherwise look frame-driven');

  // -------------------------------------------------------------------------
  // The bridge must not turn these into findings
  // -------------------------------------------------------------------------
  const relay = BRIDGE.slice(BRIDGE.indexOf("woOn(document, 'wo-nav-signal'"),
    BRIDGE.indexOf('// 2. Pull any saved config overrides'));
  check('the bridge relays the signals', relay.length > 0);
  check('it checks the token like every other channel', /d\.token !== TOKEN/.test(relay));
  check('it accepts only the two known signals',
    /'player-gesture'|'top-nav-authorized'/.test(relay) && /if \(!kind\) return;/.test(relay),
    'an unknown kind must not reach the worker');
  check('it is rate limited', /bridgeRateOk\('wo-nav-signal'/.test(relay));
  check('the tab-context gate lets navigation signals reach the worker',
    /TAB_CONTEXT_ALLOWED_MESSAGES = new Set\(\[[\s\S]*?'wo-nav-signal'[\s\S]*?\]\);/.test(BG));
  check('a nav signal never becomes a history entry or a badge count',
    !/rg-block/.test(relay) && !/queueHistory/.test(relay),
    'these fire on ordinary clicks; they are attribution, not findings');

  // -------------------------------------------------------------------------
  // Wiring
  // -------------------------------------------------------------------------
  check('it ships on by default in the worker',
    (BG.match(/blockPopupTricks: true/g) || []).length === 2,
    'both config objects need it or the default depends on which one is read');
  check('it ships on by default in the popup',
    /blockPopupTricks: true/.test(POPUP_JS));
  check('the popup saves it', /'blockPopupTricks'/.test(POPUP_JS));
  /* One switch now covers all three of these tricks -- frame-driven redirects, fake confirm
     boxes and script-built ad frames. They arrived separately during the yomi.to popup work
     and read as three unrelated settings, when they are one behaviour: a page trying to take
     a click it can spend, or move the tab out from under you. */
  check('the popup has a switch for it',
    /data-key="blockPopupTricks"/.test(POPUP_HTML));
  check('the guard defaults to on if the config never arrives',
    /blockPopupTricks: true/.test(GUARD));
  check('Activity Center names it',
    /blocked_frame_top_redirect: '/.test(HISTORY));
  check('the worker clears the attribution when a page commits',
    /onCommitted\?\.addListener\(\(details\) => \{[\s\S]{0,900}?forgetNavSignals\(details\.tabId\)/.test(BG),
    'the previous page\'s click must not explain the next page\'s navigation');
  /* Order matters inside that listener and is not obvious from reading it: the
     guard needs the page being LEFT, so it has to run before LAST_TOP_URL moves on. */
  check('the guard runs before the previous page is forgotten', (() => {
    const body = BG.slice(BG.indexOf('onCommitted?.addListener'));
    const guardAt = body.indexOf('maybeBlockForcedTopRedirect(details)');
    const overwriteAt = body.indexOf('LAST_TOP_URL[details.tabId] =');
    return guardAt >= 0 && overwriteAt > guardAt;
  })(), 'running it after the overwrite would compare the new page against itself');
  check('per-tab state is dropped when the tab closes',
    /delete LAST_TOP_URL\[tabId\];\s*forgetNavSignals\(tabId\);/.test(BG));

  // -------------------------------------------------------------------------
  // Software-install funnels, and the encoding that hid them
  // -------------------------------------------------------------------------
  /* A forced redirect does not have to come from a frame or a click. A plain
     server-side 30x chain reaches no content script at all, and the funnel it
     lands on -- "install this browser to keep watching" -- is an ordinary .com on
     no blocklist, so the chain used to be logged and allowed. */
  const landerSrc = BG.slice(BG.indexOf('function chainFakeInstallLander'), BG.indexOf('function noteRedirectHop'));
  const lander = vm.runInNewContext(landerSrc + ';chainFakeInstallLander', { URL });
  const auctionSrc = BG.slice(BG.indexOf('function adAuctionClickUrl'),
    BG.indexOf('// Matching trackers was always going to lose'));
  const adAuction = vm.runInNewContext(auctionSrc + ';adAuctionClickUrl', { URL });
  const LANDERS = [
    ['https://boost-you-browser.com/preland/storage/sf/operaone/5/index.html?p1=x', true, 'the real one'],
    ['https://boost-you-browser.com/', true, 'a hostname that is a pitch for a browser'],
    ['https://ads.example/prelander/offer', true, 'an ad prelander path'],
    ['https://www.opera.com/download', false, 'the vendor being impersonated'],
    ['https://github.com/preloader/x', false, 'preloader is not prelander'],
    ['https://www.browserstack.com/live', false, 'a real product with browser in its name'],
    ['https://developer.mozilla.org/en-US/docs/Web/API', false, 'ordinary documentation'],
  ];
  for (const [url, want, why] of LANDERS) {
    check((want ? 'install funnel: flags ' : 'install funnel: allows ') + why,
      lander(url) === want, url);
  }
  check('an install funnel is enough to interrupt a chain on its own',
    /!chain\.blocklisted && !chain\.abuseTld && !chain\.fakeInstall/.test(BG),
    'it is never blocklisted and never an abuse TLD, so without this it stays log-only');
  check('and it counts as a confirmed threat, not just a long chain',
    /chain\.blocklisted \|\| chain\.abuseTld \|\| chain\.fakeInstall/.test(BG));
  check('the hop flags it', /chain\.fakeInstall = true;/.test(BG));

  /* The ad-marker test ran against the raw URL only. A redirect that carries its
     destination as a parameter arrives percent-encoded, which is the ordinary
     shape of an ad hop -- so every one of them slipped past. */
  const markerLine = GUARD.match(/if \(\/\(adurl\|popunder[^\n]*\n/);
  check('the ad-marker test still exists', !!markerLine);
  const markers = /(adurl|popunder|onclickad|campaign|aff_id|affiliate|clickid|utm_source=ad|doubleclick|adservice|taboola|outbrain)/i;
  const encoded = 'https://boost-you-browser.com/preland/storage/sf/operaone/5/index.html'
    + '?p1=https%3A%2F%2Fwww.opera.com%2Fpartner%2Fonegx_v1%3Futm_source%3Dads';
  check('the encoded ad marker really was invisible before', !markers.test(encoded),
    'if this passes, the raw test alone would have caught it and the fix is pointless');
  check('and the decoded form is what finds it', markers.test(decodeURIComponent(encoded)));
  check('the guard now tests the decoded form too',
    /decoded = decodeURIComponent\(raw\)/.test(GUARD) && /test\(raw \+ ' ' \+ decoded\)/.test(GUARD),
    'testing raw alone misses every wrapped destination');
  check('the guard treats an install funnel as a suspicious target',
    /if \(fakeInstallLander\(targetHost, raw\)\) return true;/.test(GUARD));

  /* The reason none of this could be diagnosed: a one-hop chain across two
     domains sat under the >= 4 logging bar and was discarded without a trace, so
     a navigation the user never asked for left the Activity Center completely
     empty. Landing off the requested site is now log-worthy on its own. */
  check('leaving the site you asked for is recorded even on a short clean chain',
    /const longChain = hops >= 4 \|\| distinctDomains >= 4 \|\| leftRequestedSite;/.test(BG),
    'one hop across two domains is below every other bar');
  check('it compares the landing domain against the one actually requested',
    /const requested = chain\.domains\[0\] \|\| '';/.test(BG) &&
    /requested !== landed/.test(BG),
    'chain.domains[0] is seeded by resetRedirectChain with the requested host');
  check('federated login is left out of it', /requested !== landed && !authChain/.test(BG),
    'SSO ends on a different domain every time; logging it would bury everything else');
  check('and it decides nothing on its own',
    !/leftRequestedSite/.test(BG.slice(BG.indexOf('function redirectChainShouldInterrupt'),
      BG.indexOf('function chainFakeInstallLander'))),
    'this is visibility only; interrupting on it would break every link shortener');
  check('the record says where you meant to go',
    /leftRequestedSite, requested,/.test(BG));

  // -------------------------------------------------------------------------
  // Unattributed cross-site jumps -- the rule that does not depend on the URL
  // -------------------------------------------------------------------------
  /* yomi.to handed out two entirely different trackers on two different days,
     sharing no parameters at all. Matching either one is describing yesterday, so
     what is matched here is the event: a page you were on sent the whole tab
     somewhere else and you never touched it. */
  const RM = 'https://rm358.com/4/11216888?var=1DAOHavM0yXS&ymid=6758418836141596673&var_3=1472204';
  const MIG = 'https://migullexte.com/click.php?COST_CPC=0.03&PUBLISHER_ID=75179&CAMPAIGN_ID=1&ZONE_ID=2';

  check('the second tracker shares no auction fields with the first',
    !lander(RM) && !adAuction(RM), 'if a signature matched it, the general rule would not be needed');

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, RM);
    check('a jump nobody asked for is caught whatever the destination looks like',
      w.updates.length === 1, w.updates);
    check('and recorded as a forced redirect',
      (w.history[0] || {}).type === 'blocked_forced_redirect', w.history);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, MIG);
    check('a recognised ad tracker is still named as one',
      (w.history[0] || {}).type === 'blocked_ad_auction_redirect', w.history);
    check('and the notice says so',
      /ad click tracker/.test(decodeURIComponent(w.updates[0].props.url)), w.updates[0].props.url);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    w.signal(1, 'gesture');
    await w.forced(1, RM);
    check('a click in the tab authorises the jump', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    w.signal(1, 'gesture');
    w.age(1, 20000);
    await w.forced(1, RM);
    check('a click twenty seconds ago does not', w.updates.length === 1, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://shop.example/cart');
    w.signal(1, 'top-nav-authorized');
    await w.forced(1, 'https://payments.example/checkout');
    check('a navigation our own hooks allowed is not forced', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://app.example.com/dashboard');
    await w.forced(1, 'https://cdn.example.com/page');
    check('moving within one site is not a jump', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://app.example/');
    await w.forced(1, 'https://accounts.google.com/oauth/authorize?client_id=x');
    check('federated login is left alone', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    await w.forced(1, RM);
    check('the first page in a tab cannot have been thrown off anything',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, 'chrome-extension://abc/redirect-warning.html');
    check('the interstitial itself is never treated as a jump',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world({ config: { allowlist: ['yomi.to'] } });
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, RM);
    check('an allowed site is still allowed', w.updates.length === 0, w.updates);
  }

  {
    const w = world({ config: { blockPopupTricks: false } });
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, RM);
    check('turning it off silences it', w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, RM);
    await w.forced(1, 'https://another.example/');
    check('a site that retries cannot stack interstitials',
      w.updates.length === 1, w.updates.length);
  }

  // -------------------------------------------------------------------------
  // The two false positives that made the browser unusable
  // -------------------------------------------------------------------------
  /* Both shipped. Both are here because "no gesture" turned out to be a terrible
     proxy for "forced": the omnibox is not a page, so nothing the user types can
     ever produce one. */
  {
    const w = world();
    w.committed(1, 'chrome://newtab/');
    await w.forced(1, 'https://www.google.com/search?q=yomi', ['from_address_bar']);
    check('typing a search from a new tab is not a forced redirect',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'chrome://newtab/');
    await w.forced(1, 'https://www.google.com/search?q=yomi');
    check('and not even if it somehow arrives marked as a redirect',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'chrome-extension://abc/redirect-warning.html?to=x');
    await w.forced(1, 'https://rm358.com/4/11216888?var=x');
    check('Continue on the interstitial is not a new forced redirect',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://news.example/article');
    await w.forced(1, 'https://other.example/', ['from_address_bar']);
    check('typing a new address on any page is the user navigating',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://news.example/article');
    await w.forced(1, 'https://other.example/', []);
    check('a plain link click carries no redirect qualifier and is left alone',
      w.updates.length === 0, w.updates);
  }

  {
    const w = world();
    w.committed(1, 'https://yomi.to/');
    await w.forced(1, RM, ['client_redirect']);
    check('and the real thing is still caught', w.updates.length === 1, w.updates);
  }

  // -------------------------------------------------------------------------
  // Harvested clicks: the fake "Please confirm to continue" dialog
  // -------------------------------------------------------------------------
  /* Once the automatic redirect stopped working, the site asked for the click
     instead. That click is the whole product: with it, the page can open a popup
     or move the tab and it all looks user-approved. So a bare overlay control with
     no destination of its own must not authorise anything. */
  check('a click with no destination, on an overlay, does not authorise a jump',
    /const overlay = intentWasExplicit \? null : gestureOnOverlay\(target\);\s*\n\s*if \(!overlay\) signal\('gesture'\);/.test(GUARD),
    'without this the bait walks straight past the forced-redirect check');
  check('a real link inside an overlay still authorises normally',
    /intentWasExplicit \? null :/.test(GUARD),
    'an overlay is not automatically hostile; a control that names where it goes is fine');
  check('the overlay test needs real size and stacking, not just a position',
    /z >= 1000/.test(GUARD) && /r\.width >= 160 && r\.height >= 80/.test(GUARD),
    'every tooltip and dropdown is positioned; that alone must not taint a click');

  /* The REAL shipped function, not a reconstruction of it. Rebuilding the logic
     in the test is how a suite ends up agreeing with itself instead of with the
     code -- and this one is judged on shape, so it has to be handed shapes. */
  const baitSrc = GUARD.slice(GUARD.indexOf('const BAIT_CONTROL'), GUARD.indexOf('function confirmBaitEnabled'));
  const isBaitBox = vm.runInNewContext(baitSrc + ';confirmBaitOverlay', {});
  const box = (text, buttons, opts) => ({
    innerText: text,
    querySelector: () => ((opts && opts.field) ? {} : null),
    querySelectorAll: () => (buttons || []).map((b) => ({
      innerText: typeof b === 'string' ? b : b.text,
      value: '',
      getAttribute: (k) => (k === 'href' && typeof b === 'object' ? (b.href || null) : null),
    })),
  });

  /* Every wording it has actually served, and the wordings it has not tried yet.
     The point of the list is that no entry in it is matched BY its wording -- the
     phrase list was dropped after three rewrites walked straight past it. */
  const DIALOGS = [
    ['Attention Please confirm to continue CANCEL CONTINUE', ['Cancel', 'Continue'], null, true, 'the first wording'],
    ['Please Confirm To Continue Continue now? OK', ['OK'], null, true, 'the second wording'],
    ['Attention The file is ready to download CANCEL DOWNLOAD', ['Cancel', 'Download'], null, true, 'the third wording'],
    ['Click allow to continue ALLOW', ['Allow'], null, true, 'a wording it has not tried yet'],
    ['Your stream is ready GET ACCESS', ['Get Access'], null, true, 'nor this one'],
    ['We use cookies to improve your experience ACCEPT DECLINE', ['Accept', 'Decline'], null, false, 'a cookie banner'],
    ['Are you 18 or older? YES NO', ['Yes', 'No'], null, false, 'an age gate'],
    ['Download report-2024.pdf (2.3 MB) CANCEL DOWNLOAD', ['Cancel', 'Download'], null, false, 'a real download that names the file'],
    ['Confirm payment of 12.00 CANCEL PAY', ['Cancel', 'Pay'], null, false, 'a payment'],
    ['Sign in to continue CONTINUE', ['Continue'], null, false, 'a sign-in step'],
    ['Delete this file? CANCEL DELETE', ['Cancel', 'Delete'], null, false, 'a destructive action'],
    ['Join our newsletter SUBSCRIBE', ['Subscribe'], { field: true }, false, 'a box with a field to fill in'],
    ['Watch the trailer now WATCH', [{ text: 'Watch', href: '/watch/44' }], null, false, 'a control that says where it goes'],
  ];
  for (const [text, buttons, opts, want, why] of DIALOGS) {
    check((want ? 'bait: removes ' : 'bait: allows  ') + why,
      isBaitBox(box(text, buttons, opts)) === want, text);
  }

  check('bait: nothing is matched on a confirmation phrase any more',
    !/BAIT_PROMPT/.test(GUARD),
    'three rewrites walked past a phrase list; a fourth would too');
  check('bait: a dialog with room to explain itself is left alone',
    isBaitBox(box('Please confirm to continue. Your session on this device will be '
      + 'signed out everywhere else and any unsaved drafts will be discarded before '
      + 'the transfer begins.', ['Continue'])) === false,
    'explaining takes room, and bait cannot afford to explain');
  check('bait: a crowded box is somebody real UI, not a click collector',
    isBaitBox(box('Pick one', ['One', 'Two', 'Three', 'Four', 'Five'])) === false);

  const subjectBlock = GUARD.slice(GUARD.indexOf('const BAIT_SUBJECT'), GUARD.indexOf('function overlayControls'));
  check('a real confirmation names its subject, and that is the exclusion',
    ['age', 'payment', 'cookie', 'password', 'consent'].every((w) => subjectBlock.includes(w))
      && subjectBlock.includes('kb|mb|gb')
      && subjectBlock.includes('pdf|zip'),
    'bait names nothing because the click IS the product, so the exclusions are the safety story');
  check('the notice explains the box is page content, not the browser',
    /warned_confirm_bait:\{/.test(SRC) && /part of the page, not your browser/.test(SRC));
  check('Activity Center names it', /warned_confirm_bait: '/.test(HISTORY));
  /* This used to assert the opposite -- that the box was only ever warned about.
     That was the right call while the detector was young and had only been seen
     against one wording; it was asked to go further once the box came back with a
     new one. So the assertion is retargeted rather than dropped, and what it
     guards now is that removal stays bounded and reversible. */
  const capValue = Number((GUARD.match(/const BAIT_REMOVE_CAP = (\d+);/) || [])[1]);
  check('removing it is capped, so a runaway page cannot loop forever',
    Number.isFinite(capValue) && capValue > 0 && capValue <= 100
      && (GUARD.match(/baitRemoved >= BAIT_REMOVE_CAP/g) || []).length
         >= (GUARD.match(/baitRemoved\+\+/g) || []).length,
    'every path that removes has to be behind the brake, or one of them runs uncapped');
  check('and every one of the timed sweeps is bounded, not an interval',
    /for \(const delay of \[[\d, ]+\]\)/.test(GUARD) && !/setInterval|woInterval/.test(
      GUARD.slice(GUARD.indexOf('function sweepConfirmBait'), GUARD.indexOf("woOn(window, 'message'"))),
    'an interval running for the life of the page costs more than the thing it looks for');
  check('what is in front is asked of the browser, not guessed from z-index',
    /elementFromPoint/.test(GUARD) && !/zIndex, 10\) >= 1000/.test(GUARD),
    'a page picks its own z-index, so a threshold is a number it can step around');
  const baitGate = (() => {
    const at = GUARD.indexOf('function confirmBaitEnabled');
    assert(at >= 0, 'confirmBaitEnabled moved in anti-redirect.js');
    const next = GUARD.indexOf('\n  function ', at + 1);
    assert(next > at, 'could not find the end of confirmBaitEnabled');
    return GUARD.slice(at, next)
      .split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
  })();
  check('removal can be turned off',
    /blockPopupTricks !== false/.test(baitGate) && /data-key="blockPopupTricks"/.test(POPUP_HTML));
  check('the master switch still turns it off',
    /enabled !== false/.test(baitGate));
  check('and an allowed site is still left alone',
    /hostAllowedByUser\(\)/.test(baitGate));
  check('taking the box away releases the page it was locking',
    /releaseBaitLock\(\)/.test(GUARD) && /function releaseBaitLock/.test(GUARD),
    'removing the box but leaving the scroll lock is a page nobody can use');
  /* This used to assert nothing more than an inline overflow being cleared, which is what
     the release actually did -- and a 101-site sweep of full-screen overlays found that is
     the one form the lock almost never takes. It is normally a CLASS on <html> or <body>,
     where there is no inline style to clear, or position:fixed on the body, which collapses
     the document to a single viewport and shrugs off an overflow change entirely. */
  check('and releases the form the lock actually takes',
    /BAIT_LOCK_CLASS_RE/.test(GUARD) && /classList\.remove\(cls\)/.test(GUARD),
    'clearing an inline overflow misses the class on <html> that holds most of them');
  check('and asks the page to scroll rather than trusting scrollHeight',
    /function baitPageStuck/.test(GUARD) && /window\.scrollTo\(0, 700\)/.test(GUARD),
    'scrollHeight keeps its full value while the page is frozen, so it cannot detect a lock');
  check('and only ever runs after a box was removed',
    !/^\s*releaseBaitLock\(\);/m.test(GUARD.slice(0, GUARD.indexOf('function sweepConfirmBait'))),
    'releasing a lock on a page that never had a box unlocks something the site meant to hold');
  check('only nodes the page adds are examined',
    /rec\.addedNodes/.test(GUARD) && !/querySelectorAll\('div/.test(GUARD),
    'sweeping the whole document on every mutation costs more than the thing it looks for');
  check('the notice says how to turn it off if it takes something real',
    /turn this off in WardenOne/.test(SRC));

  // -------------------------------------------------------------------------
  // "What is actually in front of you" -- run against a fake document
  // -------------------------------------------------------------------------
  /* This path had no behavioural test at all: a mutation that stopped it looking
     entirely was caught by nothing, because every other check drives the shape
     predicate directly. It needs a document, so it gets one. */
  const sweepBody = GUARD.slice(GUARD.indexOf('function sweepConfirmBait'), GUARD.indexOf('function isOverlayBox'));
  check('the sweep actually consults what is in front, not only what was added',
    /for \(const box of boxesInTheWay\(\)\)/.test(sweepBody),
    'the added-node path alone misses a box that was hidden and re-shown, and any box '
      + 'inserted before the config arrived');
  check('the sweep still consults the added nodes too',
    /for \(const node of nodes\)/.test(sweepBody),
    'what is in front is one sample; a box off-centre is still worth removing');

  const frontSrc = GUARD.slice(GUARD.indexOf('function isOverlayBox'), GUARD.indexOf('function frameTopRedirectEnabled'));
  function frontWorld(topmost, styles, opts) {
    const o = opts || {};
    const sandbox = {
      TOP_FRAME: o.topFrame !== false,
      window: { innerWidth: o.width || 1200, innerHeight: o.height || 800 },
      document: {
        elementFromPoint: (x, y) => (typeof topmost === 'function' ? topmost(x, y) : topmost),
      },
      getComputedStyle: (el) => ({ position: (styles.get(el) || {}).position || 'static' }),
      Math, Number,
    };
    vm.createContext(sandbox);
    vm.runInContext(frontSrc + ';globalThis.__front = boxesInTheWay;globalThis.__isBox = isOverlayBox;',
      sandbox, { filename: 'in-front.js' });
    return sandbox.__front;
  }
  function frontBoxTest(el, styles, opts) {
    frontWorld(el, styles, opts);
    return null;
  }
  const el = (rect) => ({ nodeType: 1, parentElement: null, getBoundingClientRect: () => rect });
  const BIG = { width: 420, height: 220 };
  const TINY = { width: 40, height: 20 };

  {
    const boxEl = el(BIG);
    const label = el(TINY);
    label.parentElement = boxEl;
    const styles = new Map([[boxEl, { position: 'fixed' }], [label, { position: 'static' }]]);
    const found = frontWorld(label, styles)();
    check('the box in front is found by walking up from whatever is painted on top',
      found.length === 1 && found[0] === boxEl,
      'elementFromPoint lands on the label inside the dialog, not the dialog');
    check('and it is returned once, not once per sample point', found.length === 1);
  }

  {
    const plain = el(BIG);
    const found = frontWorld(plain, new Map([[plain, { position: 'static' }]]))();
    check('ordinary page content in the middle of the screen is not a box in the way',
      found.length === 0, 'otherwise every article body would qualify');
  }

  {
    const small = el(TINY);
    const found = frontWorld(small, new Map([[small, { position: 'fixed' }]]))();
    check('a small fixed thing is a badge or a tooltip, not a dialog',
      found.length === 0);
  }

  {
    const sticky = el(BIG);
    const found = frontWorld(sticky, new Map([[sticky, { position: 'sticky' }]]))();
    check('sticky counts too, since it can sit over the page just as well',
      found.length === 1);
  }

  // -------------------------------------------------------------------------
  // The box is almost never in the page -- it is in a frame on top of it
  // -------------------------------------------------------------------------
  /* This is why nothing fired for so long. From the top frame elementFromPoint
     returns the <iframe> element, and an iframe has no innerText, so the shape test
     was reading an empty string and answering "not bait" every time. The guard has
     to run where the box is. */
  check('the bait guard is not restricted to the top frame',
    !/TOP_FRAME/.test(baitGate),
    'the box is injected into a third-party frame; a top-frame-only guard never sees it');
  /* The one asymmetry in this file, and the reason it is deliberate is written on
     it: the config arrives by message, and there is no reason to assume that
     handshake ever completes inside somebody else's ad frame. Waiting for it there
     means never running at all. */
  check('and it does not wait for a config that may never arrive',
    !/configReady\(\)/.test(baitGate) && !/masterEnabled\(\)/.test(baitGate),
    'every default here is already on, so acting early only does what the config would have said');
  check('and its observer installs in every frame too',
    !/if \(TOP_FRAME\) try \{\s*\n\s*const baitObserver/.test(GUARD),
    'the script already runs in every frame; only this check was refusing to');

  {
    /* Inside a frame the FRAME is what sits over the page, so the box in it has no
       reason to be positioned -- and requiring it to be was the other half of the
       miss. */
    const inner = { nodeType: 1, parentElement: null, getBoundingClientRect: () => ({ width: 380, height: 190 }) };
    const styles = new Map([[inner, { position: 'static' }]]);
    const inFrame = frontWorld(inner, styles, { topFrame: false, width: 420, height: 220 })();
    check('a static box filling a small frame counts as being in the way',
      inFrame.length === 1 && inFrame[0] === inner,
      'an ad frame IS the overlay; its contents do not need to be positioned');
    const inTop = frontWorld(inner, styles, { topFrame: true, width: 420, height: 220 })();
    check('but the same static box in the top frame is just page content',
      inTop.length === 0,
      'in a real page, unpositioned content in the middle of the screen is the article');
  }

  {
    const tiny = { nodeType: 1, parentElement: null, getBoundingClientRect: () => ({ width: 380, height: 190 }) };
    const found = frontWorld(tiny, new Map([[tiny, { position: 'static' }]]),
      { topFrame: false, width: 100, height: 60 })();
    check('a frame too small to hold a dialog is not sampled at all',
      found.length === 0, 'tracking pixels and 1x1 frames are not worth the work');
  }

  // -------------------------------------------------------------------------
  // The box that moved out of the middle
  // -------------------------------------------------------------------------
  /* Three points down the centre line found every centred dialog and missed the
     one that relocated to the top right corner. A box that can move is a box that
     will, so the sample has to cover the viewport rather than a stripe of it. */
  {
    const corner = { nodeType: 1, parentElement: null, getBoundingClientRect: () => ({ width: 320, height: 145 }) };
    const styles = new Map([[corner, { position: 'fixed' }]]);
    const W = 1362;
    const H = 727;
    // Answers only inside the top-right box, exactly where the real one sat.
    const at = (x, y) => ((x >= 800 && x <= 1120 && y >= 190 && y <= 335) ? corner : null);
    const found = frontWorld(at, styles, { width: W, height: H })();
    check('a box in the top right corner is found',
      found.length === 1 && found[0] === corner,
      'this is the one that got away; the centre line never passes through it');
  }

  {
    const middle = { nodeType: 1, parentElement: null, getBoundingClientRect: () => ({ width: 420, height: 220 }) };
    const styles = new Map([[middle, { position: 'fixed' }]]);
    const at = (x, y) => ((x > 500 && x < 900 && y > 250 && y < 500) ? middle : null);
    const found = frontWorld(at, styles, { width: 1362, height: 727 })();
    check('and a centred box is still found', found.length === 1 && found[0] === middle);
  }

  {
    const nothing = frontWorld(() => null, new Map(), { width: 1362, height: 727 })();
    check('a page with nothing over it yields nothing', nothing.length === 0);
  }

  check('the sample is a grid, not a line down the middle',
    /const fractions = \[[\d., ]+\];/.test(GUARD) && /fractions\[a\]/.test(GUARD) && /fractions\[b\]/.test(GUARD),
    'one axis of sample points cannot see a box that sits off that axis');
  check('and the grid is rate limited, because elementFromPoint forces layout',
    /now - lastGridAt < 500/.test(GUARD),
    'a churning page would otherwise run it several times a second for nothing');

  // -------------------------------------------------------------------------
  // Reading into the frames -- where the box turned out to actually be
  // -------------------------------------------------------------------------
  /* Reported live from the page: every frame was src=about:blank or had no src,
     and every one was position:static with z-index:auto. Static and unpositioned
     means no overlay test would ever call it an overlay; same-origin means its
     document can simply be read from the parent. */
  /* The slice has to start at watchedFrameDocs, not at sameOriginFrameBoxes: the
     watcher is defined above it and called from inside it, and leaving it out made
     every frame throw a ReferenceError into the outer catch, which returned an
     empty list and failed as though nothing were readable. */
  const frameSrc = GUARD.slice(GUARD.indexOf('const watchedFrameDocs'), GUARD.indexOf('function frameTopRedirectEnabled'));
  let framesWatched = 0;
  function frameWorld(frames) {
    framesWatched = 0;
    const sandbox = {
      document: { querySelectorAll: () => frames },
      WeakSet,
      woTimeout: () => 0,
      woObserver: () => ({ observe: () => { framesWatched++; } }),
    };
    vm.createContext(sandbox);
    vm.runInContext(frameSrc + ';globalThis.__frames = sameOriginFrameBoxes;', sandbox, { filename: 'frames.js' });
    return sandbox.__frames();
  }
  const frame = (w, h, doc, src) => ({
    isConnected: true,
    getAttribute: (k) => (k === 'src' ? (src || null) : null),
    getBoundingClientRect: () => ({ width: w, height: h }),
    get contentDocument() {
      if (doc === 'cross-origin') throw new Error('blocked by same-origin policy');
      return doc;
    },
  });

  {
    const body = { innerText: 'Please prove you are human Please confirm to continue OK' };
    const f = frame(300, 150, { body });
    const found = frameWorld([f]);
    check('a same-origin frame big enough to hold a dialog is read into',
      found.length === 1 && found[0].frame === f && found[0].body === body,
      'about:blank and src-less frames are same-origin, so the parent can look inside');
  }

  check('a cross-origin frame is skipped rather than throwing',
    frameWorld([frame(300, 150, 'cross-origin')]).length === 0,
    'that case belongs to the copy of the script running inside it');
  {
    const body = { innerText: 'Please confirm to continue OK' };
    const after = frameWorld([frame(300, 150, 'cross-origin'), frame(300, 150, { body })]);
    check('and it does not stop the frames after it being read',
      after.length === 1 && after[0].body === body,
      'the outer catch hides this: without a per-frame catch the first cross-origin '
        + 'frame ends the loop and every frame behind it goes unexamined');
  }
  check('a 0x0 frame is not worth reading',
    frameWorld([frame(0, 0, { body: {} })]).length === 0);
  check('a frame with no document yet is skipped',
    frameWorld([frame(300, 150, null)]).length === 0);
  check('a frame whose document has no body is skipped',
    frameWorld([frame(300, 150, {})]).length === 0);
  check('and the number of frames read is bounded',
    frameWorld(Array.from({ length: 30 }, () => frame(300, 150, { body: {} }))).length <= 8,
    'a page can have a great many frames');

  /* The box was visible for about a second before going, because these frames are
     inserted empty and filled a moment later: a sweep landing in between sees an
     empty body and does not look again until the next timer. Watching each frame's
     own document is what closes that gap, so a frame with no body yet must still
     be watched rather than skipped outright. */
  {
    const notFilledYet = frame(300, 150, {});
    const found = frameWorld([notFilledYet]);
    check('a frame that has not been filled in yet is watched, not written off',
      found.length === 0 && framesWatched === 1,
      'it yields nothing NOW, but the watcher is what catches it a moment later');
  }
  {
    frameWorld([frame(300, 150, { body: { innerText: 'x' } })]);
    check('and a frame that is already filled is watched too', framesWatched === 1);
  }
  {
    /* The one thing left on the page after all this was a 0x0 script-built frame.
       Harmless as it stands -- nothing renders, nothing is sent -- but it is a live
       document the page can grow and fill later. The size test used to run BEFORE
       the watch, so such a frame was never listened to at all, and growing it
       changes no childList in the parent for the outer observer to notice either. */
    const tiny = frameWorld([frame(0, 0, { body: { innerText: '' } })]);
    check('a 0x0 frame is watched even though it is not worth reading yet',
      tiny.length === 0 && framesWatched === 1,
      'it yields nothing now, but it can be grown and filled later');
  }
  {
    const both = frameWorld([frame(0, 0, { body: {} }), frame(300, 150, { body: { innerText: 'x' } })]);
    check('a 0x0 frame does not stop the ones after it being read',
      both.length === 1 && framesWatched === 2);
  }

  {
    const removals = GUARD.match(/emit\('blocked_(?:confirm_bait|overlay_ad_frame)'[^;]*\)/g) || [];
    check('there are removal events to check', removals.length >= 3, removals.length);
    check('every removal is marked quiet', removals.every((e) => /quiet: true/.test(e)),
      'something taken away before the user saw it is not worth interrupting them for');
  }
  // -------------------------------------------------------------------------
  // A bare ad creative, which is a different thing from a fake dialog
  // -------------------------------------------------------------------------
  /* No sentence, no confirmation, nothing impersonated -- just a graphic with a
     call to action, which the confirm-box rule reads no text from and correctly
     refuses to touch. What marks it is the frame: script built it, so it has no
     address for a filter list to match, and it is sandboxed with popups allowed. */
  const adSrc = GUARD.slice(GUARD.indexOf('function overlayAdFrame'), GUARD.indexOf('function overlayAdFramesEnabled'));
  const isAdFrame = vm.runInNewContext(adSrc + ';overlayAdFrame', { String, Boolean });
  const adFrame = (attrs) => ({ getAttribute: (k) => (k in attrs ? attrs[k] : null) });
  const adBody = (text, hasClickable) => ({
    innerText: text,
    querySelector: () => (hasClickable ? {} : null),
  });
  const SANDBOX = 'allow-same-origin allow-scripts allow-popups allow-modals';

  check('ad frame: flags the INSTALL badge from the page',
    isAdFrame(adFrame({ sandbox: SANDBOX }), adBody('INSTALL', true)) === true,
    'no src at all, sandboxed for popups, holding a clickable graphic');
  check('ad frame: flags it even with no text whatsoever',
    isAdFrame(adFrame({ sandbox: SANDBOX }), adBody('', true)) === true,
    'it reported text="" in the diagnostic, which is why the text rule cannot judge it');
  check('ad frame: about:blank counts as no address',
    isAdFrame(adFrame({ src: 'about:blank', sandbox: SANDBOX }), adBody('INSTALL', true)) === true);

  check('ad frame: a frame loaded from a real address is left alone',
    isAdFrame(adFrame({ src: 'https://js.stripe.com/v3/elements', sandbox: SANDBOX }), adBody('', true)) === false,
    'payment forms, captchas, players and maps all come from a real src');
  check('ad frame: an unsandboxed script-built frame is left alone',
    isAdFrame(adFrame({}), adBody('INSTALL', true)) === false,
    'the 300x150 frames on that same page had no sandbox and are not this');
  check('ad frame: a sandbox that does not allow popups is left alone',
    isAdFrame(adFrame({ sandbox: 'allow-scripts allow-same-origin' }), adBody('INSTALL', true)) === false,
    'allowing popups is an odd thing to want unless clicking is meant to open something');
  check('ad frame: anything that explains itself is left alone',
    isAdFrame(adFrame({ sandbox: SANDBOX }),
      adBody('Your session will end in 5 minutes unless you choose to extend it now', true)) === false,
    'a bare creative has nothing to say');
  check('ad frame: a frame with nothing to click is left alone',
    isAdFrame(adFrame({ sandbox: SANDBOX }), adBody('INSTALL', false)) === false);

  check('the ad frame rule answers to the same switch as the rest',
    /blockPopupTricks !== false/.test(GUARD) && /data-key="blockPopupTricks"/.test(POPUP_HTML),
    'it used to carry its own switch; all three popup tricks now share one, because to anyone '
      + 'reading the settings they were one thing described three times');
  check('and Activity Center names it',
    /blocked_overlay_ad_frame: '/.test(HISTORY));

  {
    const anon = frameWorld([frame(300, 150, { body: { innerText: 'x' } })]);
    check('a frame with no address of its own is marked anonymous',
      anon.length === 1 && anon[0].anonymous === true,
      'script built it, so there is nothing for a filter list to match on');
    const named = frameWorld([frame(300, 150, { body: { innerText: 'x' } }, 'https://js.stripe.com/v3')]);
    check('a frame loaded from a real address is not',
      named.length === 1 && named[0].anonymous === false);
    const blank = frameWorld([frame(300, 150, { body: { innerText: 'x' } }, 'about:blank')]);
    check('about:blank counts as having no address', blank.length === 1 && blank[0].anonymous === true);
  }

  // -------------------------------------------------------------------------
  // "I AM 18" -- indistinguishable by its words from a real age gate
  // -------------------------------------------------------------------------
  /* There is no wording that separates this from a genuine age gate, and inventing
     one would mean breaking real age gates to catch fake ones. The only honest
     difference is that a site draws its own age gate; it does not arrive in an
     anonymous injected frame. So the SAME box has to be judged differently
     depending on where it came from, and that pair is the test. */
  const ageBox = (text, leaves) => ({
    innerText: text,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '*'
      ? leaves.map((t) => ({ innerText: t, children: [], getAttribute: () => null }))
      : []),
  });
  const AGE = ['I AM 18', 'EXIT'];

  check('provenance: the box is removed when it arrives in an injected frame',
    isBaitBox(ageBox('I AM 18 EXIT', AGE), true) === true);
  check('provenance: and the very same box is left alone in the page itself',
    isBaitBox(ageBox('I AM 18 EXIT', AGE), false) === false,
    'a real age gate is drawn by the site, and must never be touched');
  check('provenance: "I AM 18" is recognised as an affirmative control',
    /i\\s\*am/.test(GUARD) || /i\\s\*am\|/.test(GUARD),
    'no label list had it, so the control check found nothing to judge');

  /* The split that stops provenance becoming a blank cheque. */
  check('provenance: money is protected even inside a frame',
    isBaitBox(ageBox('Confirm payment of 12.00 CANCEL PAY',
      ['Confirm payment of 12.00', 'CANCEL', 'PAY']), true) === false,
    'skipping every exclusion in a frame let a payment dialog become eligible');
  check('provenance: credentials are protected even inside a frame',
    isBaitBox(ageBox('Enter your password to continue OK',
      ['Enter your password to continue', 'OK']), true) === false);
  check('provenance: a deletion is protected even inside a frame',
    isBaitBox(ageBox('Delete this file? CANCEL DELETE',
      ['Delete this file?', 'CANCEL', 'DELETE']), true) === false);
  check('provenance: a named file is protected even inside a frame',
    isBaitBox(ageBox('Download report-2024.pdf CANCEL DOWNLOAD',
      ['Download report-2024.pdf', 'CANCEL', 'DOWNLOAD']), true) === false);
  check('the two subject lists are separate, and only one is conditional',
    /BAIT_SUBJECT_HARD\.test\(text\)\) return false;/.test(GUARD)
      && /!anonymousFrame && BAIT_SUBJECT_SOFT\.test\(text\)/.test(GUARD),
    'hard is what is being transacted; soft is what is being claimed as a reason');

  check('a bait frame is removed whole, not emptied',
    /entry\.frame\.remove\(\)/.test(GUARD),
    'removing only the contents leaves the frame to redraw them');
  check('the frames are swept alongside everything else',
    /for \(const entry of sameOriginFrameBoxes\(\)\)/.test(
      GUARD.slice(GUARD.indexOf('function sweepConfirmBait'), GUARD.indexOf('function isOverlayBox'))),
    'the box is in a frame; a sweep that never opens one never finds it');

  // -------------------------------------------------------------------------
  // Dialogs built out of divs, which is what the real one turned out to be
  // -------------------------------------------------------------------------
  /* The box that survived everything else was readable the whole time -- the shape
     test was running on it and rejecting it, because nothing inside called itself a
     button. There is no reason for that markup to be honest. The stub used above
     hands back buttons for any selector, so it could never have caught this: it
     never took the fallback path at all. */
  const divBox = (text, leaves) => ({
    innerText: text,
    querySelector: () => null,
    querySelectorAll: (sel) => (sel === '*'
      ? leaves.map((t) => ({ innerText: t, children: [], getAttribute: () => null }))
      : []),
  });

  check('a dialog whose buttons are plain divs is still read',
    isBaitBox(divBox('Attention The file is ready to download CANCEL DOWNLOAD',
      ['Attention', 'The file is ready to download', 'CANCEL', 'DOWNLOAD'])) === true,
    'this is the exact box, text and all, that got through eight rounds of this');

  check('and the same for the OK wording',
    isBaitBox(divBox('Please prove you are human Please confirm to continue OK',
      ['Please prove you are human', 'Please confirm to continue', 'OK'])) === true);

  check('a div-built dialog that names its subject is still left alone',
    isBaitBox(divBox('Delete this file? CANCEL DELETE',
      ['Delete this file?', 'CANCEL', 'DELETE'])) === false,
    'the subject exclusion does not care how the buttons are built');

  check('a div-built cookie banner is still left alone',
    isBaitBox(divBox('We use cookies to improve your experience ACCEPT DECLINE',
      ['We use cookies to improve your experience', 'ACCEPT', 'DECLINE'])) === false);

  check('a long label is prose, not a button',
    isBaitBox(divBox('Continue to the next step of the guided setup wizard now',
      ['Continue to the next step of the guided setup wizard now'])) === false,
    'without a length limit the body text itself would count as a control');

  /* And the honest path still wins when the markup IS honest, so the fallback
     cannot quietly become the only thing running. */
  check('real buttons are still preferred over the leaf fallback', (() => {
    let starCalls = 0;
    const mixed = {
      innerText: 'Please confirm to continue OK',
      querySelector: () => null,
      querySelectorAll: (sel) => {
        if (sel === '*') { starCalls++; return []; }
        return [{ innerText: 'OK', children: [], getAttribute: () => null }];
      },
    };
    const verdict = isBaitBox(mixed);
    return verdict === true && starCalls === 0;
  })(), 'the fallback should not run when something already calls itself a button');

  // -------------------------------------------------------------------------
  // "Confirm you are OVER 18 and then click ALLOW" -- the exclusion, weaponised
  // -------------------------------------------------------------------------
  /* This one got through by naming a subject the rules deliberately protect. The
     age exclusion exists so real age gates are never touched, and the box said
     "OVER 18" for exactly that reason. Its buttons were a red cross and a green
     tick with no text at all, so nothing label-based would have seen them either.
     What gives it away is that it makes the page conditional on clicking the
     BROWSER's own Allow button, which a real age gate has no reason to know about. */
  const coerceBox = (text, clickable) => ({
    innerText: text,
    querySelector: (sel) => (String(sel).indexOf('input[type="text"]') >= 0
      ? null : (clickable === false ? null : {})),
    querySelectorAll: () => [],
  });

  check('coercion: removes the over-18-then-Allow box, icon buttons and all',
    isBaitBox(coerceBox('Attention! Confirm that you\'re OVER 18 and then click "ALLOW" to view the site.')) === true,
    'the age exclusion would otherwise wave this straight through');
  check('coercion: and the same trick in other words',
    isBaitBox(coerceBox('Press allow to continue watching')) === true);
  check('coercion: a real age gate is still untouched',
    isBaitBox(divBox('Are you 18 or older? YES NO', ['Are you 18 or older?', 'YES', 'NO'])) === false,
    'the whole reason the age exclusion exists');
  check('coercion: adult verification is still untouched',
    isBaitBox(divBox('Verify you are an adult to continue', ['Verify you are an adult to continue'])) === false);
  check('coercion: a site asking for notifications honestly is untouched',
    isBaitBox(coerceBox('Click Allow to enable notifications about new episodes')) === false,
    'asking is fine; holding the content hostage to it is not');
  check('coercion: with nothing clickable there is nothing to remove',
    isBaitBox(coerceBox('Click allow to view the site', false)) === false);
  check('coercion: matching Allow alone would break the honest case above', (() => {
    const m = GUARD.match(/const BAIT_PERMISSION_COERCION = (\/.*\/i);/);
    if (!m) return false;
    const rule = eval(m[1]);
    return rule.test('click "ALLOW" to view the site')
      && !rule.test('Click Allow to enable notifications about new episodes');
  })(), 'the rule has to be the coupling of Allow to access, not the word Allow');


  if (failed) { console.error('\n' + failed + ' frame-redirect check(s) failed'); process.exit(1); }
  console.log('\n' + passed + ' frame-redirect guard checks passed.');
}

main().catch((err) => { console.error(err); process.exit(1); });

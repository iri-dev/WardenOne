/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Certificate Guard must not replace a newer navigation with a stale error page (M24).
 *
 * handleTrustError awaits the config before it badges, logs and calls tabs.update. A tab can move
 * during that await -- the user goes back, the site redirects, the tab is reused -- and everything
 * after it acts on whatever the tab holds NOW. So a handler for a navigation that is no longer
 * happening replaced a page the user had asked for, and logged it as blocked.
 *
 * The config read is deferred on purpose here, because the defect only exists inside that window.
 * A harness that resolves storage immediately cannot see it.
 *
 * Run: node tools/test-cert-guard-toctou.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKGROUND = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

function lift(startMarker, endMarker) {
  const from = BACKGROUND.indexOf(startMarker);
  const to = BACKGROUND.indexOf(endMarker, from + startMarker.length);
  if (from < 0 || to <= from) throw new Error('certificate guard source markers not found');
  return BACKGROUND.slice(from, to);
}

// The whole guard, lifted rather than restated: constants, classifier, page-URL builder and the
// handler. normalizeSafeBrowsingUrl comes across too, since the recheck compares through it.
const GUARD = lift("const CERT_ERROR_PAGE = 'cert-error.html';",
  '\ntry {\n  chrome.webRequest?.onErrorOccurred?.addListener(');
const NORMALIZE = lift('function normalizeSafeBrowsingUrl(url) {', '\n// ---- Shared per-provider');

function makeHarness(options = {}) {
  const state = {
    tab: options.tab === undefined ? { id: 7, url: 'https://broken.example/' } : options.tab,
    updates: [],
    badges: [],
    history: [],
    configGate: null,
  };
  const sandbox = {
    console: { warn() {} },
    URL,
    URLSearchParams,
    Date,
    Object,
    Number,
    String,
    Promise,
    DEFAULT_CONFIG: { enabled: true, certificateGuard: true, forceHttps: false },
    chrome: { runtime: { getURL: (p) => 'chrome-extension://wo/' + p } },
    isLocalOrPrivateHost(host) {
      const h = String(host || '').toLowerCase();
      return h === 'localhost' || h === '127.0.0.1' || /\.local$/.test(h) || h === '';
    },
    async localGet() {
      // Deferred on request: this is the window the whole finding lives in.
      if (state.configGate) {
        const gate = state.configGate;
        state.configGate = null;
        gate.entered();
        await gate.wait;
      }
      return { wardenone_config: options.config || { enabled: true, certificateGuard: true } };
    },
    bumpBadge(tabId) { state.badges.push(tabId); },
    queueHistory(entry) { state.history.push(entry); },
    async tabsUpdate(tabId, props) { state.updates.push({ tabId, props }); },
    async tabsGet() { return state.tab; },
  };
  if (options.tabsGetThrows) sandbox.tabsGet = async () => { throw new Error('tab gone'); };
  vm.createContext(sandbox);
  vm.runInContext(NORMALIZE + '\n' + GUARD + '\nthis.__handle = handleTrustError;', sandbox,
    { filename: 'background.js' });
  state.handle = sandbox.__handle;
  state.holdConfig = () => {
    let release;
    let entered;
    const wait = new Promise((resolve) => { release = resolve; });
    const enteredPromise = new Promise((resolve) => { entered = resolve; });
    state.configGate = { wait, release, entered };
    return { entered: enteredPromise, release };
  };
  return state;
}

const CERT_FAILURE = {
  tabId: 7,
  type: 'main_frame',
  url: 'https://broken.example/',
  error: 'net::ERR_CERT_DATE_INVALID',
};
const failure = (extra) => Object.assign({}, CERT_FAILURE, extra || {});
const showedCertPage = (state) => state.updates.some((u) => /cert-error\.html/.test(String(u.props && u.props.url)));

async function main() {
  // -------------------------------------------------------------------------
  // 1. The reproduction: the tab moves to a safe page while the config read is pending.
  // -------------------------------------------------------------------------
  {
    const state = makeHarness();
    const gate = state.holdConfig();
    const done = state.handle(failure());
    await gate.entered;
    state.tab = { id: 7, url: 'https://safe.example/' };
    gate.release();
    await done;
    check('a tab that navigated away is not replaced with the error page', !showedCertPage(state),
      JSON.stringify(state.updates));
    check('and the abandoned navigation is not logged as blocked', state.history.length === 0);
    check('and it does not count on the badge either', state.badges.length === 0);
  }

  // -------------------------------------------------------------------------
  // 2. The tab is still on the failed navigation: the guard must still fire. A fix that
  //    suppressed everything would pass case 1 and be worse than the defect.
  // -------------------------------------------------------------------------
  {
    const state = makeHarness();
    await state.handle(failure());
    check('a still-current failed navigation does get the error page', showedCertPage(state));
    check('and is recorded once', state.history.length === 1
      && state.history[0].type === 'blocked_certificate');
    check('and counts on the badge', state.badges.length === 1);
  }

  // -------------------------------------------------------------------------
  // 3. Pending navigation. At the instant the error fires the failed URL may not have committed
  //    yet, so the tab still reports the previous page in `url` and the target in `pendingUrl`.
  //    Reading only `url` would suppress the guard on every genuine failure.
  // -------------------------------------------------------------------------
  {
    const state = makeHarness({
      tab: { id: 7, url: 'https://previous.example/', pendingUrl: 'https://broken.example/' },
    });
    await state.handle(failure());
    check('a failure that has not committed yet is still handled', showedCertPage(state),
      'pendingUrl is the navigation in flight');
  }

  // -------------------------------------------------------------------------
  // 4. Harmless differences must not suppress a real block, and real ones must.
  // -------------------------------------------------------------------------
  {
    const same = makeHarness({ tab: { id: 7, url: 'https://broken.example/#section' } });
    await same.handle(failure());
    check('a fragment does not count as a different navigation', showedCertPage(same));

    const redirected = makeHarness({ tab: { id: 7, url: 'https://broken.example/elsewhere' } });
    await redirected.handle(failure());
    check('a different path on the same host is a different navigation', !showedCertPage(redirected));

    const reused = makeHarness({ tab: { id: 7, url: 'chrome://newtab/' } });
    await reused.handle(failure());
    check('a tab reused for a browser page is not hijacked', !showedCertPage(reused));
  }

  // -------------------------------------------------------------------------
  // 5. Unknown state fails open, as the Safe Browsing path does: a tab we cannot read is one we
  //    cannot prove has moved, and updating a tab that has gone away throws and is caught.
  // -------------------------------------------------------------------------
  {
    const closed = makeHarness({ tab: null });
    await closed.handle(failure());
    check('an unreadable tab does not silently disable the guard', showedCertPage(closed));

    const threw = makeHarness({ tabsGetThrows: true });
    await threw.handle(failure());
    check('a throwing tabs.get does not silently disable the guard', showedCertPage(threw));
  }

  // -------------------------------------------------------------------------
  // 6. Overlapping errors for the same navigation collapse to one page swap.
  // -------------------------------------------------------------------------
  {
    const state = makeHarness();
    await Promise.all([state.handle(failure()), state.handle(failure()), state.handle(failure())]);
    check('repeated errors for one navigation act once', state.updates.length === 1,
      state.updates.length + ' updates');
  }

  // -------------------------------------------------------------------------
  // 7. The settings that must still switch it off entirely.
  // -------------------------------------------------------------------------
  {
    const off = makeHarness({ config: { enabled: true, certificateGuard: false } });
    await off.handle(failure());
    check('the guard stays off when its own setting is off', !showedCertPage(off));

    const master = makeHarness({ config: { enabled: false, certificateGuard: true } });
    await master.handle(failure());
    check('the guard stays off when WardenOne is off', !showedCertPage(master));

    const local = makeHarness({ tab: { id: 7, url: 'https://localhost/' } });
    await local.handle(failure({ url: 'https://localhost/' }));
    check('a local development host is still exempt', !showedCertPage(local));
  }

  // -------------------------------------------------------------------------
  // 8. The recheck must sit after the cooldown claim and before the side effects, which is where
  //    the sibling path puts it -- earlier and concurrent errors stop collapsing, later and the
  //    badge and history entry are already written.
  // -------------------------------------------------------------------------
  {
    const body = GUARD.slice(GUARD.indexOf('async function handleTrustError'));
    const claim = body.indexOf('recentTrustErrors[cooldownKey] = Date.now()');
    const recheck = body.indexOf('await tabsGet(details.tabId)');
    const badge = body.indexOf('bumpBadge(details.tabId)');
    check('the recheck runs after the cooldown claim and before any side effect',
      claim >= 0 && recheck > claim && badge > recheck);
  }

  if (failed) { console.error('\n' + failed + ' certificate guard check(s) failed'); process.exit(1); }
  console.log('\nthe certificate guard only replaces the navigation that actually failed');
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});

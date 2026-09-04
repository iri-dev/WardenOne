/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * "Copy clean link", the right-click entry.
 *
 * The engine already cleans copies it can see -- a copy event, or a site's own
 * navigator.clipboard call. The one it cannot see is the browser's own "Copy
 * link address": that is drawn by Chrome, writes to the clipboard from the
 * browser process, and fires nothing in the page. This entry is the only way to
 * clean that, and it reuses the engine's cleaner rather than keeping a second
 * copy of the tracking lists that would drift from it.
 *
 * Reaching into the page for that means the answer is page-reachable, so these
 * run the real background code against a page that lies.
 *
 * Run: node tools/test-copy-clean-link.js
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const BG = fs.readFileSync('background.js', 'utf8');
const MIN = fs.readFileSync('content.min.js', 'utf8');
const POPUP = fs.readFileSync('popup.html', 'utf8');
const POPUP_JS = fs.readFileSync('popup.js', 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
let failed = 0;

function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

/* The engine's real cleaner, lifted the way tools/test-clean-copy.js lifts it. */
const cs = MIN.indexOf('const TRACKING_PARAMS=');
const ce = MIN.indexOf(',REAL=', cs);
check('the engine cleaner is still where it was', cs >= 0 && ce > cs);
if (cs < 0 || ce < cs) process.exit(2);
const engine = { URL, location: { href: 'https://current.example/page' } };
vm.createContext(engine);
installEngineAmbient(engine);
vm.runInContext(MIN.slice(cs, ce) + ';globalThis.__clean=cleanCopyUrl;', engine,
  { filename: 'content.min.js:cleaner' });
const realCleaner = engine.__clean;

/* The shipped menu code. */
const bs = BG.indexOf('/* Clean one URL using the engine\'s own cleaner');
const be = BG.indexOf('async function toggleWardenSiteBlock(');
check('the copy-clean helpers are still where they were', bs >= 0 && be > bs);
if (bs < 0 || be < bs) process.exit(2);

/* `pageCleaner` stands in for whatever the page exposes -- the real engine by
   default, something else when the test is about a page that lies. */
function run(opts) {
  const notices = [];
  const clipboard = [];
  const sandbox = {
    URL, String, Object, Set, Boolean, Number, console, Promise,
    wardenManualNotice: async (title, message) => { notices.push({ title, message }); return true; },
    WO_MENU_COPY_LINK: 'wardenone-copy-clean-link',
    tabsQuery: async () => opts.tabs || [],
    chrome: {
      runtime: { lastError: null },
      scripting: {
        executeScript: async ({ world, args, func }) => {
          if (world === 'MAIN') {
            const win = { __wardenOneCleanCopyUrl: opts.pageCleaner || realCleaner };
            const saved = sandbox.window;
            sandbox.window = win;
            const r = func.apply({ window: win }, args);
            sandbox.window = saved;
            return [{ result: r }];
          }
          if (opts.clipboardFails) return [{ result: false }];
          clipboard.push(args[0]);
          return [{ result: true }];
        },
      },
    },
  };
  /* The MAIN-world stub calls func with `window` read from this context. */
  sandbox.window = {};
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(bs, be), sandbox, { filename: 'background.js:copy-clean' });
  return {
    notices, clipboard,
    copy: (info, tab) => vm.runInContext(
      'copyWardenCleanLink(' + JSON.stringify(info) + ',' + JSON.stringify(tab) + ')', sandbox),
    currentAddress: () => vm.runInContext('wardenCleanCurrentAddress()', sandbox),
  };
}

const TAB = { id: 1, url: 'https://example.com/page' };

(async () => {
  /* The thing that was asked for: a link with tracking on it lands clean. */
  const dirty = 'https://example.com/thing?utm_source=newsletter&utm_medium=email&fbclid=abc&id=7';
  let r = run({});
  await r.copy({ linkUrl: dirty }, TAB);
  check('a tracked link is cleaned before it reaches the clipboard',
    r.clipboard[0] === 'https://example.com/thing?id=7',
    'got ' + r.clipboard[0]);
  check('and the useful parameter survives', String(r.clipboard[0]).indexOf('id=7') >= 0);
  check('the notice counts what went',
    /Removed 3 tracking parameters/.test(r.notices[0].message), r.notices[0] && r.notices[0].message);

  /* A right-click that was not on a link still has a page worth copying. */
  r = run({});
  await r.copy({ pageUrl: 'https://example.com/read?utm_campaign=x&p=2' }, TAB);
  check('a right-click on no link falls back to the page',
    r.clipboard[0] === 'https://example.com/read?p=2', 'got ' + r.clipboard[0]);

  /* Chrome never sends a page copy event for its top address bar. The explicit
     browser command therefore has to start from the active tab URL itself. */
  r = run({ tabs: [{ id: 7, url: dirty }] });
  const current = await r.currentAddress();
  check('the current-address route starts from the active tab URL',
    current && current.ok && current.raw === dirty);
  check('and returns the cleaned active-tab address',
    current && current.cleaned === 'https://example.com/thing?id=7',
    'got ' + (current && current.cleaned));

  /* Nothing to strip is said plainly rather than claimed as a clean. */
  r = run({});
  await r.copy({ linkUrl: 'https://example.com/plain' }, TAB);
  check('a clean link is copied and reported honestly',
    r.clipboard[0] === 'https://example.com/plain'
      && /nothing to strip/i.test(r.notices[0].message));

  /* Pages the engine does not run on. */
  r = run({});
  await r.copy({ pageUrl: 'chrome://extensions' }, { id: 2, url: 'chrome://extensions' });
  check('a page with no web address says so', r.clipboard.length === 0
    && /no web address/i.test(r.notices[0].message));

  /* The clipboard is the one part that can fail on its own. */
  r = run({ clipboardFails: true });
  await r.copy({ linkUrl: dirty }, TAB);
  check('a refused clipboard is reported, not claimed as success',
    /would not let it be copied/i.test(r.notices[0].message)
      && /id=7/.test(r.notices[0].message),
    'and the cleaned link is still shown so it is not simply lost');

  /* A page can overwrite the handle. It must not be able to choose what lands
     on the clipboard. */
  r = run({ pageCleaner: () => 'https://phishing.example/login' });
  await r.copy({ linkUrl: dirty }, TAB);
  check('a page cannot swap in a destination of its own',
    r.clipboard[0] === dirty, 'got ' + r.clipboard[0]);

  r = run({ pageCleaner: (u) => u + '&ref=injected' });
  await r.copy({ linkUrl: dirty }, TAB);
  check('and cannot add parameters under cover of cleaning',
    r.clipboard[0] === dirty, 'got ' + r.clipboard[0]);

  r = run({ pageCleaner: () => 'not a url at all' });
  await r.copy({ linkUrl: dirty }, TAB);
  check('a nonsense answer falls back to the original', r.clipboard[0] === dirty);

  /* Unwrapping is the one case where the host legitimately changes, so it has
     to keep working -- the destination was spelled out in the link already. */
  r = run({});
  await r.copy({ linkUrl: 'https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fdoc%3Futm_source%3Dg&sa=D' }, TAB);
  check('a redirector is unwrapped to the destination it named',
    r.clipboard[0] === 'https://example.org/doc', 'got ' + r.clipboard[0]);

  r = run({ pageCleaner: () => 'https://evil.example/x' });
  await r.copy({ linkUrl: 'https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fdoc' }, TAB);
  check('but a host that was never in the link is refused',
    r.clipboard[0] === 'https://www.google.com/url?q=https%3A%2F%2Fexample.org%2Fdoc');

  /* The engine also has to still be reachable and still be capture-phase. */
  check('the engine exposes the cleaner for this entry',
    /window\.__wardenOneCleanCopyUrl=raw=>cleanCopyUrl\(String\(raw\|\|""\)\)/.test(MIN),
    'without it the menu entry has nothing to call');
  /* Bounded to the handler's own region. A lazy scan from the listener ran on
     past it and matched the next `},!0);` anywhere in the minified file, so it
     passed with the listener back on the bubble phase. */
  const hs = MIN.indexOf('woOn(window,"copy",');
  const he = MIN.indexOf('if(navigator.clipboard&&navigator.clipboard.writeText)', hs);
  check('the copy handler is still bounded by its clipboard sibling', hs >= 0 && he > hs);
  check('the copy listener runs in the capture phase',
    hs >= 0 && he > hs && /\},!0\);\s*$/.test(MIN.slice(hs, he).trim()),
    'a page calling stopPropagation on copy reaches the bubble phase first');
  check('the menu entry is registered',
    /item\(WO_MENU_COPY_LINK, 'Copy clean link'\);/.test(BG)
      && /info\.menuItemId === WO_MENU_COPY_LINK/.test(BG));
  const command = MANIFEST.commands && MANIFEST.commands['copy-clean-current-address'];
  check('the browser-level current-address command is declared',
    command && command.suggested_key && command.suggested_key.default === 'Alt+Shift+C');
  check('the command routes to the current-address copy operation',
    /command === WO_COMMAND_COPY_CLEAN_ADDRESS\) void copyWardenCleanCurrentAddress\(\)/.test(BG));
  check('the popup offers the same current-address action',
    /id="copy-clean-current-address"/.test(POPUP)
      && /kind: 'clean-current-address'/.test(POPUP_JS));
  /* The description must be honest about what the automatic path cannot do:
     Chrome's own "Copy link address" and the address bar are browser-drawn, so
     no extension sees them -- the reason the right-click "Copy clean link" and
     this current-address action exist. The old copy claimed it could not
     intercept "ordinary Ctrl+C", which is wrong (selected-text Ctrl+C IS
     cleaned) and made a working feature look broken. */
  check('the popup is honest about the address-bar / Copy-link-address limit',
    /the address bar are browser-level/.test(POPUP)
      && /Copy link address/.test(POPUP),
    'the description should name what it cannot do, not overclaim');
  check('and does not repeat the inaccurate "ordinary Ctrl+C" claim',
    !/does not let extensions intercept ordinary Ctrl\+C/.test(POPUP),
    'selected-text Ctrl+C is in fact cleaned; saying otherwise undersells it');
  check('address-bar support does not add clipboard-reading permission',
    !((MANIFEST.permissions || []).includes('clipboardRead')));

  if (failed) {
    console.error('copy clean link: ' + failed + ' failed');
    process.exit(1);
  }
  console.log('copy clean link: all checks passed');
})();

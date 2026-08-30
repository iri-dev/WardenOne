/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * WardenOne's warnings and its one privileged control used to be ordinary elements in the page's
 * DOM, identified again by id or CSS selector. Both halves of that were page-owned data:
 *
 *   M3: the cookie escape hatch matched closest('#rg-reload-loop [data-wo-cookie-allow="1"]'), so
 *       a page could plant that exact structure, label the button "Play video", and turn one
 *       genuine user click into contentSettings.cookies -> allow for itself. The isTrusted check
 *       passed, because the click really was the user's -- the forgery was the element.
 *   M8: the interstitials were divs with known ids appended to document.body, so the site a
 *       warning accused could delete the warning about it.
 *
 * The fix is ownership rather than description: a closed shadow root whose handle exists only in
 * the isolated world. This file drives that against a fake DOM, because the property being
 * asserted is behavioural -- a decoy must produce no permission change, and a removed warning
 * must come back. Source-text checks alone would not have caught the original bug either.
 *
 * Run with:
 *   node tools/test-owned-ui.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const ENGINE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failures = 0;
function check(name, cond, detail) {
  if (cond) { console.log('  [ok] ' + name); return; }
  failures++;
  console.error('  [FAIL] ' + name + (detail ? '  -> ' + detail : ''));
}

function sourceBetween(src, startNeedle, endNeedle) {
  const start = src.indexOf(startNeedle);
  if (start < 0) throw new Error('missing marker: ' + startNeedle);
  const end = src.indexOf(endNeedle, start + startNeedle.length);
  if (end < 0) throw new Error('missing marker after ' + startNeedle + ': ' + endNeedle);
  return src.slice(start, end);
}

// ---------------------------------------------------------------------------
// A fake DOM. Only what the overlay code touches, but with the one rule that matters
// faithfully implemented: a CLOSED shadow root is not reachable from its host, and a node inside
// it reports that root from getRootNode(). That is the entire basis of the fix, so the fake must
// not be more permissive than the real thing.
// ---------------------------------------------------------------------------
function makeDom() {
  const listeners = [];

  function makeNode(tag) {
    const node = {
      tagName: String(tag || 'div').toUpperCase(),
      children: [],
      attrs: {},
      textContent: '',
      disabled: false,
      parentNode: null,
      id: '',
      __shadow: null,
      // The public accessor a page would use. Closed roots must never be exposed here.
      shadowRoot: null,
      setAttribute(k, v) { this.attrs[k] = String(v); },
      getAttribute(k) { return this.attrs[k] == null ? null : this.attrs[k]; },
      appendChild(child) {
        this.children.push(child);
        child.parentNode = this;
        return child;
      },
      remove() {
        if (!this.parentNode) return;
        const i = this.parentNode.children.indexOf(this);
        if (i >= 0) this.parentNode.children.splice(i, 1);
        this.parentNode = null;
      },
      attachShadow(init) {
        const root = makeNode('#shadow-root');
        root.__isShadowRoot = true;
        root.host = this;
        this.__shadow = root;
        // mode: 'closed' means shadowRoot stays null to everyone outside.
        if (init && init.mode === 'open') this.shadowRoot = root;
        return root;
      },
      getRootNode() {
        let n = this;
        while (n.parentNode) n = n.parentNode;
        // A node inside a shadow tree walks up to the shadow root, not past it.
        return n;
      },
      addEventListener(type, fn) { listeners.push({ node: this, type, fn }); },
      querySelector() { return null; },
      closest(sel) {
        // Enough to model the OLD matching rule, so the decoy test is a fair one.
        let n = this;
        while (n) {
          if (sel.includes('[data-wo-cookie-allow="1"]') && n.attrs['data-wo-cookie-allow'] === '1') {
            let p = n.parentNode;
            while (p) { if (p.id === 'rg-reload-loop') return n; p = p.parentNode; }
          }
          n = n.parentNode;
        }
        return null;
      },
    };
    Object.defineProperty(node, 'isConnected', {
      get() {
        let n = this;
        while (n.parentNode) n = n.parentNode;
        return n === document.documentElement || n === document.body || n.__isDocRoot === true;
      },
    });
    return node;
  }

  const documentElement = makeNode('html');
  documentElement.__isDocRoot = true;
  const body = makeNode('body');
  documentElement.appendChild(body);

  const document = {
    documentElement,
    body,
    readyState: 'complete',
    createElement: (tag) => makeNode(tag),
    getElementById(id) {
      const walk = (n) => {
        if (n.id === id) return n;
        for (const c of n.children) { const hit = walk(c); if (hit) return hit; }
        return null;
      };
      return walk(documentElement);
    },
    addEventListener(type, fn) { listeners.push({ node: document, type, fn }); },
  };

  function fire(node, type, isTrusted) {
    const event = { type, target: node, isTrusted: isTrusted !== false };
    // Node-bound listeners first, then document-level ones (the old arrangement).
    for (const l of listeners.slice()) {
      if (l.type !== type) continue;
      if (l.node === node || l.node === document) {
        try { l.fn(event); } catch (e) { void e; }
      }
    }
    return event;
  }

  return { document, makeNode, fire, listeners };
}

// ---------------------------------------------------------------------------
// 1. The forgeable identity is gone from live code, and the engine no longer builds the button.
// ---------------------------------------------------------------------------
{
  const liveBridge = BRIDGE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  check('no selector-based identification of the privileged button remains',
    !liveBridge.includes("closest('#rg-reload-loop"));
  check('the forgeable attribute is gone from live bridge code',
    !liveBridge.includes('data-wo-cookie-allow'));
  check('the engine no longer builds the allow button',
    !ENGINE.includes('data-wo-cookie-allow') && !MIN.includes('data-wo-cookie-allow'));
  check('the engine asks the bridge to show the notice instead',
    ENGINE.includes('source:"wardenone-reload-loop"') && MIN.includes('wardenone-reload-loop'));
  check('the shipped runtime carries the change', !MIN.includes('rg-reload-loop"),wrap.setAttribute'));
  check('the overlay helper uses a closed shadow root',
    BRIDGE.includes("attachShadow({ mode: 'closed' })"));
  check('ownership is decided by getRootNode identity, not by a selector',
    /return node\.getRootNode\(\) === shadow;/.test(BRIDGE));
}

// ---------------------------------------------------------------------------
// 2. Behaviour: a decoy gets nothing, the real button works.
// ---------------------------------------------------------------------------
function loadCookieEscape() {
  const dom = makeDom();
  const sent = [];
  const healers = [];
  const sandbox = {
    document: dom.document,
    location: { href: 'https://example.com/x', hostname: 'example.com', reload() { sandbox.__reloaded = true; } },
    sessionStorage: { removeItem() {}, getItem: () => null, setItem() {} },
    chrome: { runtime: { lastError: null, sendMessage: (msg, cb) => { sent.push(msg); if (cb) cb({ ok: true }); } } },
    TOKEN: 'tok-123',
    // The shared observer registry, stubbed so the test can trigger a heal on demand.
    domWatch: (fn) => { healers.push(fn); return () => { const i = healers.indexOf(fn); if (i >= 0) healers.splice(i, 1); }; },
    console,
    Object,
    Array,
    String,
    Set,
    AbortController,
    MutationObserver: class { disconnect() {} },
    setTimeout: (fn, ms) => { void fn; void ms; return 1; },
    clearTimeout() {},
    setInterval: () => 2,
    clearInterval() {},
  };
  sandbox.window = sandbox;
  // The bridge listens on window for the engine's request. Without this the registration throws
  // into the surrounding try/catch and the whole feature silently does nothing -- which is worth
  // stating, because that is exactly how a missing harness method fakes a passing test.
  sandbox.addEventListener = (type, fn) => { dom.listeners.push({ node: sandbox, type, fn }); };
  vm.createContext(sandbox);
  // The bridge requires e.source === window, which is how a real page distinguishes its own
  // postMessage from a frame's. Inside a vm context the global is not the same object as the
  // sandbox we handed in, so `window` has to be pointed at the context's own global and events
  // must be fired with that same reference -- otherwise the guard rejects everything and the
  // suite would pass by never reaching the code under test.
  vm.runInContext('this.window = this;', sandbox);
  const winRef = vm.runInContext('this', sandbox);

  // The bridge routes its listeners and timers through its teardown registry, so the lifted code
  // needs the real thing. Lifting it beats shimming it: the registry is small, self-contained, and
  // is what actually runs in the browser -- a shim could agree with a broken implementation.
  const registry = sourceBetween(BRIDGE,
    '  /* Everything this copy holds',
    '  // A per-page-load routing token.');

  const helper = sourceBetween(BRIDGE,
    "  const WO_OWNED_HOST_STYLE = 'all:initial!important;",
    '  // Smart Script Shield recovery is deliberately driven');
  const escape = sourceBetween(BRIDGE,
    '  // Cookie reload-loop escape.',
    '  // ---- Memory Shield: form-dirty + active-media tracking ----');
  // One script, so the registry's const bindings are in scope for the rest.
  vm.runInContext(registry + '\n' + helper + '\n' + escape, sandbox,
    { filename: 'bridge.js:cookie-escape' });

  return { dom, sent, healers, sandbox, winRef };
}

{
  // A page plants the exact old structure and a real user clicks it.
  const { dom, sent } = loadCookieEscape();
  const decoyWrap = dom.makeNode('div');
  decoyWrap.id = 'rg-reload-loop';
  const decoyBtn = dom.makeNode('button');
  decoyBtn.setAttribute('data-wo-cookie-allow', '1');
  decoyBtn.textContent = 'Play video';
  decoyWrap.appendChild(decoyBtn);
  dom.document.body.appendChild(decoyWrap);

  // Sanity: the decoy really would have matched the old rule, or this proves nothing.
  check('the decoy does match the old selector rule (so the test is fair)',
    decoyBtn.closest('#rg-reload-loop [data-wo-cookie-allow="1"]') === decoyBtn);

  dom.fire(decoyBtn, 'click', true);
  check('a decoy button gets no permission change from a genuine click',
    sent.length === 0, JSON.stringify(sent));
}

{
  // The real flow: the engine asks, the bridge builds, the user clicks the bridge's own button.
  const { dom, sent, sandbox, winRef } = loadCookieEscape();
  dom.fire(winRef, 'message', true); // wrong shape -- should be ignored
  check('a message without the token does not build the notice',
    dom.document.getElementById('rg-reload-loop') === null);

  // Deliver the real request the way the engine sends it.
  for (const l of dom.listeners) {
    if (l.type === 'message') l.fn({ source: winRef, data: { source: 'wardenone-reload-loop', token: 'tok-123' } });
  }
  const host = dom.document.getElementById('rg-reload-loop');
  check('the notice is mounted on request', !!host);
  check('the page cannot reach into it: host.shadowRoot is null', host && host.shadowRoot === null);
  check('the host is labelled as WardenOne UI so the cleaner skips it',
    !!host && host.getAttribute('data-wo-ui') === '1');

  // Find the real button through the shadow root, which only the owner has.
  const shadow = host.__shadow;
  const buttons = [];
  const walk = (n) => { if (n.tagName === 'BUTTON') buttons.push(n); n.children.forEach(walk); };
  walk(shadow);
  check('the notice has an allow and a keep-blocked button', buttons.length === 2,
    buttons.map((b) => b.textContent).join(' | '));

  const allow = buttons.find((b) => b.textContent === 'Allow cookies here');
  check('the allow button is inside the closed shadow root',
    !!allow && allow.getRootNode() === shadow);

  dom.fire(allow, 'click', false); // synthetic
  check('a synthetic click on the real button is refused', sent.length === 0, JSON.stringify(sent));

  dom.fire(allow, 'click', true);
  check('a trusted click on the real button changes the cookie setting',
    sent.length === 1 && sent[0].kind === 'set-site-permission'
      && sent[0].key === 'cookies' && sent[0].setting === 'allow',
    JSON.stringify(sent));
}

// ---------------------------------------------------------------------------
// 3. Self-healing: the page removing the overlay must not stick (M8).
// ---------------------------------------------------------------------------
{
  const { dom, healers, sandbox, winRef } = loadCookieEscape();
  for (const l of dom.listeners) {
    if (l.type === 'message') l.fn({ source: winRef, data: { source: 'wardenone-reload-loop', token: 'tok-123' } });
  }
  check('a healer was registered on mount', healers.length === 1);

  const host = dom.document.getElementById('rg-reload-loop');
  host.remove();
  check('the page can remove the node from the tree',
    dom.document.getElementById('rg-reload-loop') === null);

  healers.forEach((fn) => fn([]));
  check('the overlay puts itself back', dom.document.getElementById('rg-reload-loop') !== null);

  // And the same node comes back -- not a rebuild, so the shadow tree and listeners survive.
  check('the restored node is the same one, so its contents are intact',
    dom.document.getElementById('rg-reload-loop') === host);
}

{
  // Dismiss must stop the healing, or "Keep blocked" would be unusable.
  const { dom, healers, sandbox, winRef } = loadCookieEscape();
  for (const l of dom.listeners) {
    if (l.type === 'message') l.fn({ source: winRef, data: { source: 'wardenone-reload-loop', token: 'tok-123' } });
  }
  const host = dom.document.getElementById('rg-reload-loop');
  const buttons = [];
  const walk = (n) => { if (n.tagName === 'BUTTON') buttons.push(n); n.children.forEach(walk); };
  walk(host.__shadow);
  const dismiss = buttons.find((b) => b.textContent === 'Keep blocked');
  dom.fire(dismiss, 'click', true);
  check('dismiss removes the notice', dom.document.getElementById('rg-reload-loop') === null);
  healers.forEach((fn) => fn([]));
  check('dismiss also stops the self-healing',
    dom.document.getElementById('rg-reload-loop') === null);
}

// ---------------------------------------------------------------------------
// 4. The three interstitials (M8). Each is a warning about the page it is sitting in, so the page
//    must not be able to find it, reach into it, or delete it.
// ---------------------------------------------------------------------------
{
  const liveBridge = BRIDGE.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  for (const id of ['wo-script-drift', 'wo-permission-chain', 'wo-login-age']) {
    check(id + ': rendered into an owned overlay',
      liveBridge.includes("woOwnedOverlay('" + id + "')"));
    check(id + ': no longer found again by getElementById',
      !liveBridge.includes("document.getElementById('" + id + "')"));
  }
  check('no interstitial is appended straight to the page body',
    !liveBridge.includes('(document.body || document.documentElement).appendChild(wrap)'));
  check('replacing a warning destroys our own overlay, not a page element',
    /scriptDriftOverlay\.destroy\(\)/.test(liveBridge) && /permChainOverlay\.destroy\(\)/.test(liveBridge));
  check('all three overlays are mounted after their contents exist',
    (liveBridge.match(/\.mount\(\);/g) || []).length >= 4);
}

// ---------------------------------------------------------------------------
// 5. WardenOne's own overlay cleaner must not remove WardenOne's own warnings. The exemption
//    covered the engine's rg- widgets but not the bridge's wo- interstitials, so the cleaner
//    could have deleted the phishing warning itself.
// ---------------------------------------------------------------------------
{
  const exemption = /if\("rg-undo-chip"===el\.id\|\|el\.id&&\(el\.id\.startsWith\("rg-"\)\|\|el\.id\.startsWith\("wo-"\)\)\|\|el\.getAttribute&&"1"===el\.getAttribute\("data-wo-ui"\)\)return!1;/;
  check('the engine cleaner exempts wo- ids and the data-wo-ui marker', exemption.test(ENGINE));
  check('...and it survived the build', exemption.test(MIN));

  // Prove it behaviourally by running the real guard statement, not by trusting the regex above.
  const guardMatch = ENGINE.match(/if\("rg-undo-chip"===el\.id[^\n]*?return!1;/);
  check('the guard statement is liftable', !!guardMatch);
  const idGuard = guardMatch ? guardMatch[0] : 'return!1;';
  const sandbox = { results: {} };
  vm.createContext(sandbox);
  vm.runInContext('this.skips = function (el) {' + idGuard.replace('return!1;', 'return true;')
    + ' return false; };', sandbox, { filename: 'content.js:cleaner-exemption' });
  const cases = [
    ['wo-login-age', {}, true],
    ['wo-script-drift', {}, true],
    ['rg-reload-loop', {}, true],
    ['', { 'data-wo-ui': '1' }, true],
    ['some-page-banner', {}, false],
  ];
  for (const [id, attrs, expected] of cases) {
    const el = { id, getAttribute: (k) => (attrs[k] == null ? null : attrs[k]) };
    const skipped = vm.runInContext('skips', sandbox)(el);
    check('cleaner ' + (expected ? 'skips' : 'still inspects') + ' ' + (id || 'data-wo-ui element'),
      skipped === expected, 'got ' + skipped);
  }
}

// ---------------------------------------------------------------------------
// 5. The OAuth grant warning (M8, remaining half). Same reasoning as the three above: the warning
//    says "this app is asking for powerful access", and the page it is warning about shared the DOM
//    with it. It was the last interstitial still built as a plain div on document.body.
// ---------------------------------------------------------------------------
{
  const OAUTH = fs.readFileSync(path.join(ROOT, 'oauth-guard.js'), 'utf8');
  const live = OAUTH.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');

  check('oauth warning: rendered into an owned overlay',
    live.includes("woOwnedOverlay('wo-oauth-guard')"));
  check('oauth warning: no longer found again by getElementById',
    !live.includes("document.getElementById('wo-oauth-guard')"));
  check('oauth warning: not appended straight to the page body',
    !/root\.appendChild\(wrap\)/.test(live));
  check('oauth warning: replacing destroys our own overlay',
    /oauthOverlay\.destroy\(\)/.test(live));
  // Every button takes a real action -- navigating away, opening a window, dismissing the warning.
  // isTrusted proves the gesture; owns() proves the element was not planted by the page.
  check('oauth warning: all three buttons check node ownership',
    (live.match(/oauthOverlay\.owns\(/g) || []).length >= 3);
  // The shared dispose is meant to be byte-identical across nine files, so the overlay has to hook
  // into it rather than be edited into it. If this regresses, so does that assertion.
  check('oauth warning: teardown registers with the shared registry, not by editing it',
    /woHold\(\{ disconnect\(\)/.test(live));

  // Runtime: the closed-shadow guarantee itself, against the same fake DOM the bridge tests use.
  const dom = makeDom();
  const healers = [];
  const sandbox = {
    document: dom.document,
    domWatch: (fn) => { healers.push(fn); return () => { const i = healers.indexOf(fn); if (i >= 0) healers.splice(i, 1); }; },
  };
  vm.createContext(sandbox);
  vm.runInContext(
    sourceBetween(OAUTH, '  const WO_OWNED_HOST_STYLE', '\n  /* The handle for the OAuth warning')
      + '\n; this.make = woOwnedOverlay;',
    sandbox,
    { filename: 'oauth-guard.js' }
  );

  const ov = sandbox.make('wo-oauth-guard');
  const root = ov.root();
  ov.mount();
  const host = ov.hostNode();

  check('oauth warning: the page cannot reach the shadow root through the host',
    host.shadowRoot === null, 'shadowRoot was ' + host.shadowRoot);
  const ours = dom.makeNode('div');
  root.appendChild(ours);
  check('oauth warning: a node we built is recognised as ours', ov.owns(ours) === true);
  const decoy = dom.makeNode('button');
  decoy.id = 'wo-oauth-guard';
  dom.document.body.appendChild(decoy);
  check('oauth warning: a page-planted lookalike is not ours', ov.owns(decoy) === false);

  // Self-healing: the page it accuses is the party that would remove it.
  host.remove();
  check('oauth warning: the page can detach the host', host.isConnected === false);
  healers.forEach((fn) => fn());
  check('oauth warning: a removed host is put straight back', host.isConnected === true);
  check('oauth warning: the same node returns, so contents and listeners survive',
    ov.owns(ours) === true);

  ov.destroy();
  check('oauth warning: destroy() stops the self-healing', healers.length === 0);
}

// ---------------------------------------------------------------------------
// 6. The badge host (M12, remaining half). Repair reinstalls the engine into a frame that may
//    already be showing a badge. The new copy's badgeHost is null while the old copy's host is
//    still in the DOM, so it used to mount a second one and leave the first, listener and all.
// ---------------------------------------------------------------------------
{
  const ADOPT = 'const stale=document.getElementById("rg-badge-host");stale&&stale!==badgeHost&&stale.remove()';
  // Whitespace is stripped from both sides, not normalised: the source splits these two statements
  // across indented lines, while the build has them adjacent.
  const bare = (t) => t.replace(/\s+/g, '');
  check('engine adopts a stale badge host instead of mounting a second one',
    bare(ENGINE).includes(bare(ADOPT)));
  // The packaged engine is what actually ships, and it is generated -- a source-only fix that never
  // reached the build would be invisible everywhere except here.
  check('the packaged engine carries the same adoption',
    MIN.includes(ADOPT));
  check('the adoption runs before the new host is built',
    ENGINE.indexOf(ADOPT.slice(0, 40)) < ENGINE.indexOf('const host=badgeHost=document.createElement("div")'));
}

// ---------------------------------------------------------------------------
// 7. The badge host itself. The shadow root protects what is inside it; nothing
//    was protecting the host, which carried no styles at all. A page rule
//    matching div or #rg-badge-host could reach it, and transform, filter,
//    contain, perspective or backdrop-filter on the host makes it the containing
//    block for the fixed-position badge inside its own shadow tree -- moving the
//    badge to the host's corner instead of the window's.
//
//    Measured in a real engine against a page rule of
//    "#rg-badge-host{transform:translateX(-120px) translateY(-80px)}":
//    an unstyled host put the badge 136px/96px from the corner instead of 16/16.
//    With all:initial it stayed at 16/16.
// ---------------------------------------------------------------------------
{
  const hostStyle = (ENGINE.match(/host\.id="rg-badge-host",[\s\S]{0,900}?host\.setAttribute\("style",\s*"([^"]+)"/) || [])[1] || '';
  check('the badge host is styled at all', !!hostStyle);
  check('page CSS cannot reach the badge host', /all:initial!important/.test(hostStyle),
    'without all:initial a page rule can move the badge by capturing its containing block');
  for (const [name, re] of [
    ['it is out of the page layout', /position:fixed!important/],
    ['it takes up no space', /width:0!important[\s\S]*height:0!important/],
    ['it does not swallow clicks meant for the page', /pointer-events:none!important/],
  ]) check('badge host: ' + name, re.test(hostStyle), hostStyle);

  // all:initial resets pointer-events too, so the badge and its panel have to
  // take their own back or the button stops responding.
  const shadowCss = (ENGINE.match(/:host\{all:initial\}[\s\S]{0,4000}?';/) || [''])[0];
  check('the badge itself still receives clicks',
    /\.b\{[^}]*pointer-events:auto/.test(shadowCss), 'the badge would be unclickable');
  check('the panel still receives clicks',
    /\.panel\{[^}]*pointer-events:auto/.test(shadowCss), 'the panel would be unclickable');

  // Source-only fixes that never reach the build are invisible everywhere but here.
  check('the packaged engine carries the hardened host',
    MIN.includes('all:initial!important;position:fixed!important;top:0!important;left:0!important'));
}

// ---------------------------------------------------------------------------
// 8. Where the badge sits, on a page that scrolls and one that does not.
//
//    A fixed element is placed against the viewport's CONTENT edge and cannot
//    cross a classic scrollbar. So the same 16px inset leaves a scrollbar's width
//    of chrome beyond the badge on a scrolling page, and nothing at all on a page
//    that does not scroll -- where it then hugs the window and reads as too tight.
//
//    The correction pads by whatever a classic scrollbar would have taken. It has
//    to be a no-op in the two cases where the page is already right: a page that
//    genuinely has the scrollbar, and a browser that draws overlay scrollbars and
//    therefore never reserves the width at all.
// ---------------------------------------------------------------------------
{
  check('the badge offset is driven by a measured gutter, not a constant',
    /\.b\{[^}]*right:calc\(16px \+ var\(--rg-gutter,0px\)\)/.test(ENGINE),
    'the badge went back to a fixed inset');
  check('the panel follows the badge',
    /\.panel\{[^}]*right:calc\(16px \+ var\(--rg-gutter,0px\)\)/.test(ENGINE),
    'the panel would drift away from the badge it belongs to');

  const align = (ENGINE.match(/alignBadge=\(\)=>\{[\s\S]*?\n      \},/) || [''])[0];
  check('the padding is the shortfall against a real scrollbar, never a sum',
    /pad=Math\.max\(0,\s*measureScrollbarWidth\(\)-gutter\)/.test(align.replace(/\s+/g, ' ')),
    'padding a page that already has a scrollbar would push the badge inwards twice');
  check('the page gutter is read from the document, not assumed',
    /window\.innerWidth\|\|0\)-\(doc&&doc\.clientWidth\|\|0\)/.test(align.replace(/\s+/g, ' ')));

  const measure = (ENGINE.match(/measureScrollbarWidth=\(\)=>\{[\s\S]*?\n      \},/) || [''])[0];
  check('the scrollbar width is measured once and remembered',
    /if\(null!==badgeScrollbarWidth\)return badgeScrollbarWidth/.test(measure.replace(/\s+/g, ' ')),
    'probing on every refresh would touch the DOM for a number that cannot change');
  check('the measurement probe is always taken back out', /probe\.remove\(\)/.test(measure),
    'a hidden probe left in the page is a node the site did not ask for');
  check('a wild measurement cannot move the badge off screen',
    /Math\.min\(\s*40,/.test(measure.replace(/\s+/g, ' ')));
  check('measurement failure leaves the badge where it was',
    /catch\(_\)\{\s*badgeScrollbarWidth=0\s*\}/.test(measure.replace(/\s+/g, ' ')),
    'a throwing probe must fall back to no padding, not to NaN');

  check('the badge is aligned when it is built', /\(\)=>pEl\.classList\.toggle\("open"\)\),\s*alignBadge\(\)/
    .test(ENGINE.replace(/\s+/g, ' ').replace(/ \)/g, ')').replace(/\( /g, '(')) ||
    /alignBadge\(\),/.test(ENGINE), 'the first paint would use the wrong inset');
  check('the badge is realigned when the window changes shape',
    /woOn\(\s*window,\s*"resize",\s*alignBadge\)/.test(ENGINE.replace(/\s+/g, ' ')),
    'a scrollbar appearing later would leave the badge at the old inset');
  check('the resize listener is bound once, not on every repair',
    ENGINE.indexOf('"resize",') > ENGINE.indexOf('badgeEventsBound=!0'),
    'each engine repair would stack another listener');

  check('the packaged engine carries the correction',
    MIN.includes('right:calc(16px + var(--rg-gutter,0px))') && MIN.includes('measureScrollbarWidth'));
}

// ---------------------------------------------------------------------------
// 9. How long the badge stays legible.
//
//    It announces itself once and then settles back to a hint. The dwell is
//    restarted every time the badge is brightened, so the value exists in two
//    places -- and two copies of a number that must agree is how a badge ends up
//    fading at one speed on load and another after something happens.
// ---------------------------------------------------------------------------
{
  const declared = ENGINE.match(/BADGE_FADE_MS=(\d+)/);
  check('the fade dwell is named once, not written out twice', !!declared,
    'two literal timeouts can drift apart silently');
  if (declared) {
    const ms = Number(declared[1]);
    check('the badge does not sit there being read twice', ms <= 2000, ms + 'ms');
    check('the badge is still legible before it fades', ms >= 800,
      ms + 'ms is too brief to notice the badge appeared at all');

    const uses = (ENGINE.match(/BADGE_FADE_MS/g) || []).length;
    check('both fade timers use the named dwell', uses >= 3,
      'found ' + uses + ' references; expected the declaration plus both timers');
    check('no literal fade timeout survives alongside it',
      !/remove\("show"\)\s*\}\s*,\s*\d+e?\d*\)/.test(ENGINE.replace(/\s+/g, '')),
      'a hardcoded timeout is still racing the named one');

    check('the packaged engine carries the same dwell',
      MIN.includes('BADGE_FADE_MS=' + ms) && (MIN.match(/BADGE_FADE_MS/g) || []).length >= 3);
  }
}

if (failures) {
  console.error('[fail] owned-UI tests: ' + failures + ' failure(s)');
  process.exit(1);
}
console.log('[ok] owned-UI tests passed');

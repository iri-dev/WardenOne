/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Hiding something by hand, and getting it back.
 * Run: node tools/test-element-picker.js
 *
 * Three things have to hold, and they fail in different ways.
 *
 * THE SELECTOR IS PASTED INTO A STYLESHEET. Selectors are joined with commas and
 * dropped into a rule, so a value carrying a brace closes that rule and starts
 * writing CSS of its own. Nothing can put an arbitrary string in there today --
 * they come from the picker, built out of the DOM -- but that is a property of
 * today's callers, not of the store, so the store checks.
 *
 * THE RULE HAS TO STILL WORK NEXT WEEK. A selector built from a class name that
 * the site's build tool generated matches beautifully until the next deploy and
 * then silently stops. Silent is the problem: the reader has no reason to look,
 * so the feature appears to work while doing nothing.
 *
 * IT HAS TO BE REVERSIBLE. Something hidden with no way back is worse than the
 * thing it hid. Same lesson as the silenced notifications, and the same answer:
 * a list, per site, in the popup.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const PICKER = fs.readFileSync(path.join(ROOT, 'element-picker.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');
const MANAGER_JS = fs.readFileSync(path.join(ROOT, 'hidden-elements.js'), 'utf8');
const MANAGER_HTML = fs.readFileSync(path.join(ROOT, 'hidden-elements.html'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const MANIFEST = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* ---- the real validator, lifted ------------------------------------------ */

function loadIsSafeSelector() {
  const at = BG.indexOf('function isSafeSelector(');
  assert(at > 0, 'isSafeSelector is not in background.js');
  const end = BG.indexOf('\n}', at) + 2;
  const sandbox = { HIDDEN_MAX_SELECTOR_LEN: 400, __fn: null };
  vm.createContext(sandbox);
  vm.runInContext(BG.slice(at, end) + '\n__fn = isSafeSelector;', sandbox);
  return sandbox.__fn;
}
const isSafeSelector = loadIsSafeSelector();

(function nothingCanBreakOutOfTheRule() {
  /* Each of these is a way to end the display:none rule and begin another. */
  const attacks = [
    'div{} body{display:none}',
    'div}body{display:none',
    'div;color:red',
    'div/*x*/,body',
    '@import url(http://evil)',
    'div<script>',
    'div\\65 ',
    'div\nbody',
  ];
  attacks.forEach((sel) => {
    check('rejected: ' + JSON.stringify(sel).slice(0, 40), isSafeSelector(sel) === false);
  });

  /* Hiding the page is not a cosmetic rule, it is a blank tab and no obvious
     way back. */
  ['html', 'body', ':root', '*', '  body  '].forEach((sel) => {
    check('refuses to hide the page itself: ' + JSON.stringify(sel), isSafeSelector(sel) === false);
  });

  /* And the ordinary ones still work, or the feature does nothing. */
  [
    '#cookie-banner',
    'div.promo-bar',
    'aside[data-testid="sidebar-ads"]',
    'section.wrapper > div.banner',
    'div[aria-label="Sponsored"]',
  ].forEach((sel) => {
    check('accepted: ' + sel, isSafeSelector(sel) === true);
  });

  check('an over-long selector is refused', isSafeSelector('a'.repeat(401)) === false);
  check('an empty selector is refused', isSafeSelector('') === false);
}());

/* ---- selector quality ----------------------------------------------------- */

function loadLooksGenerated() {
  const at = PICKER.indexOf('const GENERATED = [');
  assert(at > 0, 'the generated-name table is not in element-picker.js');
  const end = PICKER.indexOf('\n  }', PICKER.indexOf('function looksGenerated', at)) + 4;
  const sandbox = { __fn: null };
  vm.createContext(sandbox);
  vm.runInContext(PICKER.slice(at, end) + '\n__fn = looksGenerated;', sandbox);
  return sandbox.__fn;
}
const looksGenerated = loadLooksGenerated();

(function buildGeneratedNamesAreRefused() {
  /* Every one of these is a real shape produced by a real toolchain. A selector
     built on one works today and stops on the site's next deploy, without ever
     saying so. */
  const generated = [
    'css-1x2y3z',
    'sc-bdVaJa',
    'emotion-9f8a7b',
    'jss-1a2b3c4d',
    '_ngcontent-a7',
    '_nghost-serverapp-c12',
    'v-7ba5bd90',
    'a1b2c3d4e5f6',
    'styled-4kj29d',
  ];
  generated.forEach((n) => check('treated as generated: ' + n, looksGenerated(n) === true));

  /* And the hand-written ones survive, or the picker falls back to fragile
     positional selectors on sites that were perfectly describable. */
  const human = [
    'cookie-banner', 'promo', 'sidebar', 'nav-main', 'btn-primary',
    'col-6', 'h1', 'site-header', 'ad_slot', 'newsletter-signup',
  ];
  human.forEach((n) => check('kept as human-written: ' + n, looksGenerated(n) === false));
}());

(function theSelectorIsBuiltFromMeaningFirst() {
  const order = PICKER.slice(PICKER.indexOf('function ownSelector'), PICKER.indexOf('function matchCount'));
  check('a stable id wins', order.indexOf('stableId') < order.indexOf('MEANINGFUL_ATTRS'));
  check('meaning beats class names', order.indexOf('MEANINGFUL_ATTRS') < order.indexOf('stableClasses'),
    'data-testid and aria-label outlive redesigns that class names do not');
  check('the tag alone is the last resort', order.lastIndexOf('return tag;') > order.indexOf('stableClasses'));
  check('positional selectors are flagged to the reader',
    /isFragile/.test(PICKER) && /may stop working/.test(PICKER),
    'a fragile rule that says nothing is a rule that fails silently');
}());

/* ---- it cannot be started by a page --------------------------------------- */

(function onlyTheReaderCanStartIt() {
  const declared = (MANIFEST.content_scripts || []).some((cs) => (cs.js || []).indexOf('element-picker.js') >= 0);
  check('the picker is not a declared content script', !declared,
    'it would then run on every page, and be present for a page to find');
  check('it is injected on demand from the popup',
    /files: \['element-picker\.js'\]/.test(POPUP_JS));

  /* bridge.js may send hidden-list itself from its isolated world, but its
     forgeable MAIN-world relay must never accept any hidden-rule operation. */
  const relayAt = BRIDGE.indexOf('const relayAllowedMessage');
  const relayEnd = BRIDGE.indexOf("woOn(document, 'wo-background-message'", relayAt);
  const pageRelay = relayAt < 0 || relayEnd < 0 ? '' : BRIDGE.slice(relayAt, relayEnd);
  ['hidden-add', 'hidden-remove', 'hidden-list'].forEach((kind) => {
    check(kind + ' is not relayed from the page world', pageRelay.indexOf(kind) < 0);
  });

  /* They are still tab-sent, because the picker is a content script, so the
     allowlist and the ceilings both have to name them. */
  const allow = BG.slice(BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES = new Set(['), BG.indexOf(']);', BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES = new Set([')));
  const limits = BG.slice(BG.indexOf('const TAB_CONTEXT_RATE_LIMITS'), BG.indexOf('\n};', BG.indexOf('const TAB_CONTEXT_RATE_LIMITS')));
  ['hidden-add', 'hidden-remove', 'hidden-list'].forEach((kind) => {
    check(kind + ' is allowed from a tab', allow.indexOf("'" + kind + "'") >= 0,
      'it would be rejected before reaching its handler');
    check(kind + ' has a ceiling', limits.indexOf("'" + kind + "'") >= 0);
  });

  check('every one is pinned to the sender\'s own host',
    /\^hidden-\(add\|remove\|list\)\$[\s\S]{0,160}messageSenderMatchesHost/.test(BG),
    'a tab could otherwise write rules for a site it is not on');
}());

(function rightClickOffersTheTool() {
  /* One tool. There were two -- Zap, which saved on click, and Pick, which
     showed the selector and its match count first -- but both ended in the same
     saved rule, so the only real difference was whether the confirmation came
     before or after the thing vanished. Pick's two useful facts moved into the
     Zap confirmation and the mode went away with its menu entry. */
  assert(MANIFEST.permissions.indexOf('contextMenus') >= 0, 'the context menu permission is missing');
  check('there is a WardenOne submenu', /WO_MENU_ROOT/.test(BG) && /title: 'WardenOne'/.test(BG));
  check('it offers Zap', /WO_MENU_ZAP[\s\S]{0,200}Zap this element/.test(BG));
  check('there is no second element tool', !/WO_MENU_PICK/.test(BG) && !/Pick element/.test(BG));
  check('the menu entry contains no emoji',
    !/\p{Extended_Pictographic}/u.test((BG.match(/title: 'Zap this element[^']*'/) || [''])[0]));

  check('the menu starts the tool', /startElementTool\(tab, info\.frameId\)/.test(BG));
  /* The mode flag existed only to choose between the two tools. With one tool it
     is a value nothing reads, delivered by an injection nothing needs. */
  check('no mode is plumbed through any more',
    !/__wardenOnePickerMode/.test(BG) && !/__wardenOnePickerMode/.test(POPUP_JS)
      && !/__wardenOnePickerMode/.test(PICKER),
    'the removed mode is still being set somewhere');
  check('the popup starts the tool in one injection',
    /files: \['element-picker\.js'\]/.test(POPUP_JS) && !/func: \(mode\)/.test(POPUP_JS));
  /* The two things the review panel existed to say have to survive it. */
  check('the confirmation says how much the rule catches',
    /const n = matchCount\(rule\)/.test(PICKER) && /matches ' \+ n \+ ' things/.test(PICKER));
  check('the confirmation warns when the rule is positional',
    /if \(isFragile\(rule\)\)/.test(PICKER));
  check('Verify & Repair treats the injected picker as a core file',
    /CORE_FILES = \[[^\]]*'element-picker\.js'/.test(BG));
  check('Verify & Repair includes the full zap manager',
    /CORE_FILES = \[[^\]]*'hidden-elements\.html'[^\]]*'hidden-elements\.js'/.test(BG));

  /* A worker that was evicted and restarted rebuilds its menus. Without
     removeAll first, every restart stacks another copy of every entry. */
  check('the menu is rebuilt rather than duplicated',
    /removeAll\([\s\S]{0,400}contextMenus\.create|removeAll\([\s\S]{0,400}add\(\{/.test(BG),
    'a restarted worker would add a second copy of each entry');
  ['onInstalled', 'onStartup'].forEach((hook) => {
    check('the menu is (re)created on ' + hook,
      new RegExp(hook + '[\\s\\S]{0,120}installWardenContextMenu').test(BG));
  });

  /* The patterns live in a const, so this checks the const and the use of it
     rather than expecting the literal to sit next to the key. */
  check('the menu is limited to http(s) pages',
    /const pages = \['http:\/\/\*\/\*', 'https:\/\/\*\/\*'\]/.test(BG)
      && /documentUrlPatterns: pages/.test(BG));
  check('and the injector refuses anything else',
    /\^https\?:/.test(BG),
    'chrome:// and the store reject injection; failing there silently reads as broken');
  /* Removed: it sent a reputation lookup whose answer went nowhere, so the
     entry did nothing a reader could see. A menu item that appears to work and
     does not is worse than no menu item. */
  check('the dead scan-link entry is gone', BG.indexOf('WO_MENU_SCAN') < 0);

  /* The tools answer to a switch, and it is on, because they cost nothing until
     an entry is clicked. */
  check('there is a switch for it', /elementZapper: true/.test(BG));
  check('the menu honours the switch', /cfg\.elementZapper !== false/.test(BG));
  check('and reacts to it changing without a restart',
    /storage\.onChanged[\s\S]{0,200}installWardenContextMenu/.test(BG),
    'turning it off would look broken until the next browser start');
}());

(function theZapperIsPersistentOneShotAndReversible() {
  /* The zapper must not mutilate the DOM. It marks the element, saves a stable
     selector, and closes after reporting whether the save actually worked. */
  /* Matched inside the zap function itself. Checking only that the attribute
     NAME appears somewhere passes even if nothing ever sets it. */
  const zapFn = PICKER.slice(PICKER.indexOf('function zap('), PICKER.indexOf('function unzapLast'));
  check('it hides by attribute, not by removing the node',
    /setAttribute\(ZAP_ATTR, 'true'\)/.test(zapFn) && !/remove\(\)/.test(zapFn));
  check('one stylesheet does the hiding',
    /\[' \+ ZAP_ATTR \+ '="true"\]\{display:none!important;\}/.test(PICKER)
      || /ZAP_ATTR[\s\S]{0,200}display:none!important/.test(PICKER));
  check('zapping writes a persistent rule',
    /kind: 'hidden-add'[\s\S]{0,160}selector: sel/.test(PICKER));

  const zapBlock = PICKER.slice(PICKER.indexOf('const ZAP_ATTR'), PICKER.indexOf('---- what a stable name'));
  check('undo removes the attribute rather than restoring a node',
    /removeAttribute\(ZAP_ATTR\)/.test(zapBlock));
  /* One undo path, not two. There used to be a local stack and a page-lifetime
     stack popped by different callers, which went out of step the moment more
     than one thing was hidden -- the next undo then retracted the saved rule for
     something still on screen. undoOne pops all three together. */
  check('there is an undo for the last one', /function undoOne\(\) \{/.test(PICKER));
  check('undo pops every stack a zap pushed to',
    /undoOne\(\) \{[\s\S]{0,320}zapped\.pop\(\);[\s\S]{0,80}lastSaved\.pop\(\);/.test(PICKER));
  check('there is no second, competing undo path', !/function unzapLast\(/.test(PICKER));
  check('Ctrl+Z is wired to it',
    /ctrlKey \|\| e\.metaKey[\s\S]{0,240}undoOne\(\)/.test(PICKER));
  /* Escape LEAVES. It used to undo everything on the way out, which made the
     obvious exit the destructive one: you press it to stop pointing at things,
     not to get the adverts back. */
  check('Escape leaves without undoing the work',
    /Escape'\)?\s*\{[\s\S]{0,300}stop\(\)/.test(PICKER)
      && !/Escape'[\s\S]{0,80}unzapAll/.test(PICKER));
  check('and there is a visible way out, not only a key',
    /const done = el\('button', 'keep', 'Done'\)/.test(PICKER) && /'Cancel'/.test(PICKER),
    'the tool felt like something you could not get out of');
  /* The exemption is shared now, because the click handler is no longer the only
     thing swallowing events -- the whole pointer gesture is. Both have to honour
     it or Done, Undo and Cancel stop working. */
  check('our own controls are exempt from interception',
    /function ours\(e\) \{/.test(PICKER)
      && /if \(e\.target === ui\) return true;/.test(PICKER)
      && /composedPath\(\)\.indexOf\(ui\) >= 0\) return true;/.test(PICKER),
    'Keep, Undo, Done and Cancel were swallowed before their handlers ran');
  check('both interceptors use that exemption',
    /function swallow\(e\) \{\s*if \(ours\(e\)\) return;/.test(PICKER)
      && /function onClick\(e\) \{\s*if \(ours\(e\)\) return;/.test(PICKER));

  /* Cancelling only the click is too late: a player starts on pointerdown and a
     link can be followed from mouseup, so on YouTube the video was already
     playing by the time the click was cancelled. */
  check('the whole pointer gesture is swallowed, not just the click',
    /const SWALLOWED = \['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'auxclick', 'dblclick'\]/.test(PICKER)
      && /SWALLOWED\.forEach\(\(type\) => \{\s*window\.addEventListener\(type, swallow, \{ capture: true, passive: false \}\);/.test(PICKER));
  /* Capture runs outermost-first, so a listener the page registered on document
     before the zapper was injected would otherwise see the event first. */
  check('interception happens on window, ahead of any document listener',
    /window\.addEventListener\('click', onClick, true\)/.test(PICKER)
      && !/document\.addEventListener\('click', onClick/.test(PICKER));
  check('stopping is immediate, so same-node listeners do not still run',
    !/e\.stopPropagation\(\);/.test(PICKER) && /e\.stopImmediatePropagation\(\);/.test(PICKER));
  check('every swallowed listener is removed again on the way out',
    /SWALLOWED\.forEach\(\(type\) => \{\s*try \{ window\.removeEventListener\(type, swallow, true\); \} catch/.test(PICKER));
  check('large selections offer explicit Hide anyway and Cancel buttons',
    /Hide it anyway/.test(PICKER) && /hide\.addEventListener\('click'/.test(PICKER));
  check('the large-element warning means almost the whole visible viewport',
    /const HUGE = 0\.85/.test(PICKER) && /visibleWidth \* visibleHeight/.test(PICKER));

  /* The selection has to be walkable or the first click lands on the close
     button inside the popup rather than the popup. */
  check('the wheel widens and narrows',
    /function onWheel\([\s\S]{0,220}widen\(\)/.test(PICKER)
      && /addEventListener\('wheel'/.test(PICKER));
  check('so do the arrow keys', /ArrowUp[\s\S]{0,40}widen/.test(PICKER) && /ArrowDown[\s\S]{0,40}narrow/.test(PICKER));
  check('the keys are shown to the reader', /Esc'\)/.test(PICKER) && /Ctrl\+Z/.test(PICKER));

  /* The tool says what is running, so a page that suddenly follows the cursor
     is explained rather than alarming. */
  /* The highlight follows the cursor, so its cost is paid on every mouse move --
     and a mouse reports far more often than the screen redraws. Measured on a
     1200-element page: 2000 events cost 126.6ms doing the work per event, and
     1.6ms coalesced to one update per frame. Three separate causes, so three
     separate checks. */
  /* Matched as a declaration -- with a duration -- not as the bare words, which
     also appear in the comment above the rule explaining why they are gone. */
  check('the highlight transitions only transform',
    /transition:transform [\d.]+s linear/.test(PICKER) && !/transition:all [\d.]+s/.test(PICKER),
    'transition:all animates left/top/width/height, which lays out on every move');
  check('the highlight is positioned by transform, not by layout properties',
    /box\.style\.transform = 'translate3d\(/.test(PICKER)
      && !/box\.style\.left =/.test(PICKER) && !/box\.style\.top =/.test(PICKER));
  check('the box size is only written when it changes',
    /if \(r\.width !== boxW\)/.test(PICKER) && /if \(r\.height !== boxH\)/.test(PICKER));
  check('pointer tracking is coalesced to one update per frame',
    /if \(!moveRaf\) moveRaf = requestAnimationFrame\(trackPointer\)/.test(PICKER)
      && /function trackPointer\(\)/.test(PICKER),
    'elementFromPoint and getBoundingClientRect would run per event, each forcing layout');
  check('the queued frame is cancelled when the tool closes',
    /if \(moveRaf\) \{ try \{ cancelAnimationFrame\(moveRaf\); \} catch \(_\) \{\} moveRaf = 0; \}/.test(PICKER));

  /* The panel says what it is and that it is WardenOne. Something unexplained
     that follows your cursor is alarming rather than helpful, and a plain dark
     box on someone else's page could be anything. */
  check('the zapper names itself', /panelHead\('Element Zapper'/.test(PICKER));
  check('and says whose it is', /el\('span', 'brand', 'WardenOne'\)/.test(PICKER));
  check('both states share one header',
    (PICKER.match(/panelHead\(/g) || []).length >= 3);
  check('the count only appears once there is one',
    /if \(zapCount > 0\) head\.appendChild\(el\('span', 'tally'/.test(PICKER));
  check('it carries the house edge rather than a plain box',
    /\.bar::before\{[^']*linear-gradient\(90deg,#b06fd6,#df6ca9\)/.test(PICKER));
  check('the removed picker does not still name itself', !/Element Picker active/.test(PICKER));
  check('the in-page tool contains no emoji', !/[\u{1F300}-\u{1FAFF}\u2600-\u27BF]/u.test(PICKER));
  /* A zap that vanishes on reload is one you have to do again on every visit,
     which is most of the annoyance back. It is written straight away -- the
     click is the confirmation -- and retracted by undo. */
  check('a zap is saved, not just hidden', /kind: 'hidden-add'[\s\S]{0,120}selector: sel/.test(PICKER));
  check('undoing a zap retracts the saved rule', /kind: 'hidden-remove'/.test(PICKER));
  check('and it says it is remembered', /saved for this site|stay gone after a reload/i.test(PICKER));
  /* Zapping does not end after one thing. The tool used to set a flag on the
     first selection that stood every listener down, so hiding a second banner
     meant starting the whole tool again. Done is the only thing that ends it. */
  check('the tool keeps zapping until Done',
    !/chosen/.test(PICKER) && !/stopSoon\(/.test(PICKER)
      && /done\.addEventListener\('click', stop\)/.test(PICKER));
  check('each zap is counted and the count is what the panel leads with',
    /zapCount\+\+;/.test(PICKER)
      && /zapCount === 1 \? 'One thing hidden' : zapCount \+ ' things hidden'/.test(PICKER));
  check('the panel says the tool is still live',
    /Still zapping/.test(PICKER));
  check('and the opening copy does not promise a single pick',
    /Keep going for as long as you like/.test(PICKER)
      && !/Click one thing you do not want to see/.test(PICKER));
  /* Zap three things quickly and three saves are in flight. Whichever answers
     last must not repaint the panel with its own one-item confirmation. */
  check('a late save cannot repaint a newer zap panel',
    /const seq = \+\+latestSeq;/.test(PICKER)
      && /if \(seq !== latestSeq \|\| !ui\.isConnected\) return;/.test(PICKER));
  check('undo steps back one and stays in the tool',
    /if \(!undoOne\(\)\) return;[\s\S]{0,160}say\(zapCount \? zapPanel/.test(PICKER)
      && !/undoOne\(\)[\s\S]{0,120}stop\(\);/.test(PICKER));
  check('Ctrl+Z remains armed after Done closes the picker UI',
    /UNDO_STATE_KEY/.test(PICKER) && /armGlobalUndo\(\)/.test(PICKER)
      && /document\.addEventListener\('keydown', undoState\.listener, true\)/.test(PICKER));
  check('the post-Done undo stack retracts both the element and its saved rule',
    /entry\.element\.removeAttribute\(ZAP_ATTR\)/.test(PICKER)
      && /entry\.undoRequested/.test(PICKER)
      && /removeSavedSelector\(entry\.hostname, entry\.selector\)/.test(PICKER));
  check('post-Done Ctrl+Z leaves editors alone',
    /undoTargetIsEditable/.test(PICKER) && /input\|textarea\|select/.test(PICKER)
      && /contenteditable/.test(PICKER));
  check('a failed save is reported instead of claiming persistence',
    /hidden only until this page reloads/.test(PICKER));
}());

/* ---- the rules survive AdShield being off --------------------------------- */

(function hidingIsNotAdBlocking() {
  /* "Do not block ads here" and "do not show me that box" are different
     sentences. The engine empties the AdShield stylesheet when a site is
     allowlisted; these must not be in it. */
  check('the worker sends them in a field of their own', /userSelectors/.test(BG));
  check('the isolated bridge loads them directly',
    /kind: 'hidden-list', hostname: location\.hostname/.test(BRIDGE)
      && /data-wardenone-user-hidden/.test(BRIDGE),
    'loading only inside WO.adShield makes saved rules disappear when it is off');
  const at = CONTENT.indexOf('wo-user-hidden');
  check('the engine gives them their own style element', at > 0);
  const applyAt = CONTENT.indexOf('userSelectors');
  const clearAt = CONTENT.indexOf('res.allowlisted||res.disabled');
  check('they are applied before the allowlist exit', applyAt > 0 && clearAt > 0 && applyAt < clearAt,
    'allowlisting a site for ads would silently bring back things hidden by hand');
  check('the engine re-checks the selectors it is handed',
    CONTENT.indexOf('"{}<;@".split("")') > 0,
    'a stylesheet is built from these; the worker checking on write is one half');
}());

/* ---- and they can be undone ----------------------------------------------- */

(function everythingHiddenIsListedAndReversible() {
  check('the popup has somewhere to list them', /id="hidden-list"/.test(POPUP_HTML));
  check('the saved list remains visible when it is empty',
    /id="hidden-list-wrap"[^>]*display:block/.test(POPUP_HTML)
      && /Nothing is saved for this site yet/.test(POPUP_JS));
  check('the popup list is a collapsed dropdown',
    /<details id="hidden-list-wrap"/.test(POPUP_HTML)
      && !/<details id="hidden-list-wrap"[^>]*\bopen\b/.test(POPUP_HTML));
  check('each entry offers a way back', /Show again/.test(POPUP_JS));
  check('undoing removes the stored rule', /kind: 'hidden-remove'/.test(POPUP_JS));
  /* Sliced rather than measured by distance: a comment growing by a line should
     not decide whether this passes. */
  const undoAt = POPUP_JS.indexOf("kind: 'hidden-remove'");
  const undoBlock = undoAt < 0 ? '' : POPUP_JS.slice(undoAt, undoAt + 600);
  /* This used to require a reload, on the reasoning that the list would
     otherwise claim an element was back while the stylesheet still hid it. True
     at the time -- but the fix was one reload PER undo, so undoing a few things
     on one site was a burst of reloads that WardenOne's own reload-loop detector
     flagged. The refresh now drops the Zapper's mark as well as rewriting the
     stylesheet, so the element returns in place and nothing reloads. */
  check('undoing one hidden element does not reload the tab',
    undoBlock.length > 0 && undoBlock.indexOf('tabs.reload') < 0,
    'one reload per undo reads as a reload loop to our own detector');
  check('the list is drawn when the popup opens', /renderHiddenList\(\)/.test(POPUP_JS));
  check('inherited rules keep the hostname they were saved under',
    /entries: hiddenEntriesForHost/.test(BG) && /hostname: savedHost/.test(POPUP_JS),
    'removing a parent-domain rule under the current subdomain leaves it stored');
  check('the Zapper is a searchable popup setting',
    /data-key="elementZapper"/.test(POPUP_HTML) && /Element Zapper for this page/.test(POPUP_HTML));
  check('the popup opens a manager for every saved zap',
    /Manage all zapped elements/.test(POPUP_HTML)
      && /getURL\('hidden-elements\.html'\)/.test(POPUP_JS));
  check('the manager reads the bounded local hidden-element store',
    /wardenone_hidden_elements/.test(MANAGER_JS) && /safeSelector/.test(MANAGER_JS)
      && /slice\(0, 100\)/.test(MANAGER_JS));
  check('the manager groups sites into clean dropdowns and supports search',
    /className = 'site'/.test(MANAGER_JS) && /createElement\('details'\)/.test(MANAGER_JS)
      && /id="zap-search"/.test(MANAGER_HTML));
  check('every manager entry has its own Undo action',
    /kind: 'hidden-remove'/.test(MANAGER_JS) && /undo\.textContent = 'Undo'/.test(MANAGER_JS));
  check('undo refreshes matching open pages without forcing a reload',
    /function refreshHiddenRulesForHost/.test(BG) && /kind: 'hidden-rules-refresh'/.test(BG)
      && /msg\.kind !== 'hidden-rules-refresh'/.test(BRIDGE)
      && /bridgeLoadUserHidden\(\)/.test(BRIDGE));

  const store = BG.slice(BG.indexOf('const HIDDEN_STORE_KEY'), BG.indexOf('async function addHiddenElement'));
  check('there is a per-site ceiling', /HIDDEN_MAX_PER_HOST/.test(store));
  check('and a ceiling on how many sites', /HIDDEN_MAX_HOSTS/.test(store));
}());

/* ---- a rule must hide only the thing you pointed at ---------------------- *
 * The positional fallback used to be gated on the descriptive selector matching
 * NOTHING or MORE THAN EIGHT things, so everything in between was saved as-is.
 * On a column of avatars that selector matches every avatar: at zap time only the
 * clicked one carried the attribute, so it looked right -- and then on the next
 * page load the saved rule hid all of them. Same for a category tile or a title. */
(function selectorPinsToOneElement() {
  const build = PICKER.slice(PICKER.indexOf('function buildSelector(el)'),
    PICKER.indexOf('function isFragile('));
  check('a non-unique selector always falls back to position',
    !/matchCount\(sel\) > 8/.test(build) && /const positional = positionalSelector\(el\);/.test(build),
    'a rule matching 2-8 elements would still be saved, hiding all of them');
  check('the positional fallback is only accepted when it is unique',
    /if \(positional && matchCount\(positional\) === 1\) return positional;/.test(build));
  check('and when neither is unique the narrower one wins',
    /matchCount\(positional\) < matchCount\(sel\)/.test(build));
  check('the positional builder walks up until it identifies one element',
    /function positionalSelector\(el\) \{/.test(PICKER)
      && /parts\.unshift\(node\.tagName\.toLowerCase\(\) \+ ':nth-child\('/.test(PICKER)
      && /if \(matchCount\(candidate\) === 1\) return candidate;/.test(PICKER));
  /* body is always nameable, so the walk cannot run off the top without an answer. */
  check('the walk always terminates with something',
    /return parts\.length \? 'body > ' \+ parts\.join\(' > '\) : '';/.test(PICKER));
})();

/* ---- reset all ----------------------------------------------------------- */
(function resetAll() {
  const MANAGER_HTML = fs.readFileSync(path.join(ROOT, 'hidden-elements.html'), 'utf8');
  const MANAGER_JS = fs.readFileSync(path.join(ROOT, 'hidden-elements.js'), 'utf8');
  check('the manager offers a reset', /id="zap-reset"/.test(MANAGER_HTML));
  /* Irreversible, so it takes two presses rather than one. */
  check('reset asks before it does it',
    /data-armed/.test(MANAGER_JS) && /Press again/.test(MANAGER_JS));
  check('the armed state expires on its own',
    /button\.dataset\.armTimer = String\(setTimeout\(\(\) => disarmAll\(\), \d+\)\);/.test(MANAGER_JS));
  check('the confirmation is written after the re-render, not before',
    /loadHiddenSites\(\)\.then\(\(\) => setStatus\(info\.done\)\);/.test(MANAGER_JS),
    'renderHiddenSites writes the status last, so an earlier message is lost');

  /* Clearing every site has no host to be pinned to, so unlike add/remove it must
     not be reachable from a page. Leaving it out of the tab allowlist is what
     enforces that -- the generic sender gate refuses any kind missing from it. */
  /* One site as well as all of them: a single site collecting thirty rules is the
     normal case, and "all of them" is the wrong tool for tidying one of them. */
  check('a site can be reset on its own',
    /clearSite\.className = 'reset small';/.test(MANAGER_JS)
      && /kind: 'hidden-clear', hostname: site\.hostname/.test(MANAGER_JS));
  check('the per-site button does not toggle the group it sits in',
    /event\.preventDefault\(\);\s*event\.stopPropagation\(\);/.test(MANAGER_JS));
  /* One helper, not two copies -- the per-site button arrived later, and a second
     copy is how the two end up asking differently. */
  check('both resets share one arm-and-confirm path',
    /function wireReset\(button, describe, request\)/.test(MANAGER_JS)
      && (MANAGER_JS.match(/wireReset\(/g) || []).length >= 3);
  check('arming one button disarms the others',
    /disarmAll\(\);\s*button\.setAttribute\('data-armed', 'true'\)/.test(MANAGER_JS),
    'two loaded questions could sit on screen at once');
  check('the worker can clear every saved rule', /async function clearHiddenElements\(hostname\)/.test(BG));
  check('and can clear just one site, normalised the way add and remove do',
    /const host = normalizeAllowlistHost\(hostname\);[\s\S]{0,200}delete all\[host\];/.test(BG));
  check('clearing tells every affected host, not just one',
    /for \(const host of hosts\) void refreshHiddenRulesForHost\(host\);/.test(BG));
  check('a web page cannot ask for everything to be cleared',
    !/'hidden-clear'/.test(BG.slice(BG.indexOf('TAB_CONTEXT_ALLOWED_MESSAGES'),
      BG.indexOf('const TAB_CONTEXT_RATE_LIMITS'))),
    'hidden-clear in the tab allowlist would let any site wipe every saved rule');
  check('and it is handled at all', /msg\.kind === 'hidden-clear'/.test(BG));

  /* ---- undo must not reload the page ------------------------------------- *
   * "Show again" in the popup reloaded the tab after EVERY item, so undoing a
   * few things on one site was a few full reloads in a row -- which WardenOne's
   * own reload-loop detector then flagged. The reload was there because the
   * Zapper marks what it hides with an attribute as well as with the shared
   * stylesheet, and the attribute outlived the rule. Clearing the mark on
   * refresh makes undo take effect in place, so nothing has to reload. */
  {
    const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
    check('the refresh drops the mark from anything no longer covered',
      /\[data-wardenone-zapped="true"\]/.test(BRIDGE)
        && /if \(!stillHidden\) node\.removeAttribute\('data-wardenone-zapped'\);/.test(BRIDGE));
    check('and keeps it on anything a remaining rule still matches',
      /if \(node\.matches\(selectors\[j\]\)\) \{ stillHidden = true; break; \}/.test(BRIDGE));
  }
})();

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('element picker: ' + pass + ' checks passed');

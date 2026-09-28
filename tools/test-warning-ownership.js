/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Can a page suppress a warning by planting an element with its id (M44)?
 *
 * Four high-stakes warnings decided whether they were already showing by asking the document:
 *
 *     if (document.getElementById('wo-cmd-warn')) return;
 *
 * content.min.js is world:MAIN, so the page answers that question. A page shipping
 * <div id="wo-cmd-warn" hidden></div> in its own markup silently suppressed the warning entirely,
 * and none of the four has a toast or badge fallback -- so nothing at all reached the user.
 *
 * The one that matters most is commandPasteGuard: a ClickFix / fake-CAPTCHA page talks the user
 * into pasting `powershell -w hidden -c iwr ...|iex` into the Run dialog, and the guard that is
 * meant to interrupt that is turned off by one line of the attacker's own HTML.
 *
 * Same defect as the full-page blockers (H15, tools/test-blocker-durability.js), so the same
 * answer: hold the node we built and ask it, not the document. __woWarn is a private registry the
 * page has no reference to, so a decoy carrying our id is simply not in it.
 *
 * Run: node tools/test-warning-ownership.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');

const WARNINGS = ['wo-scam-lock', 'wo-cmd-warn', 'wo-formtrap-warn', 'wo-clip-swap'];
const OWNED_WARNINGS = WARNINGS.concat(['wo-sb-block', 'wo-paste-warn', 'wo-insecure-login', 'wo-fake-window', 'wo-fullscreen-spoof']);

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// ---------------------------------------------------------------------------
// 1. The registry itself, lifted from the engine rather than re-described here.
// ---------------------------------------------------------------------------
const decl = /const __woWarn=\{[\s\S]*?\n  \};/.exec(SRC);
if (!decl) throw new Error('__woWarn declaration not found in src/content.js');

const emitted = [];
const sandbox = { Map, console, __woEmit: (event) => emitted.push(event) };
vm.createContext(sandbox);
vm.runInContext(decl[0].replace(/^const /, 'var ') + '\nglobalThis.__W=__woWarn;', sandbox);
const W = sandbox.__W;

{
  const ours = { isConnected: true };
  check('a warning that has never been shown is not "up"', W.up('wo-cmd-warn') === false);

  W.mark('wo-cmd-warn', ours);
  check('after marking, the warning reports itself up', W.up('wo-cmd-warn') === true);
  W.mark('wo-paste-warn', { isConnected: true, textContent: 'A secret is about to be pasted' });
  check('marking a panel sends only its ID over the signed engine event bus',
    emitted.some((event) => event.type === 'warning_panel' && event.detail.id === 'wo-paste-warn'
      && Object.keys(event.detail).length === 1));
  W.mark('wo-paste-warn', { isConnected: true }, 7);
  check('a paste warning binds its isolated choice to one pending request',
    emitted.some((event) => event.type === 'warning_panel' && event.detail.id === 'wo-paste-warn'
      && event.detail.decisionId === 7));

  ours.isConnected = false;
  check('a warning removed from the page is no longer up, so it can be re-shown',
    W.up('wo-cmd-warn') === false, 'a removed warning would never reappear');

  // The decoy: an element the page created. It is not in the registry, so it cannot answer for us.
  check('a page-planted element carrying our id does not count as our warning',
    W.up('wo-formtrap-warn') === false, 'a decoy still suppresses the warning');

  check('warnings are tracked independently', W.up('wo-scam-lock') === false && W.up('wo-clip-swap') === false);
}

{
  const src = SRC.replace(/\/\*[\s\S]*?\*\//g, '');
  for (const id of OWNED_WARNINGS) {
    check(id + ' is registered for isolated warning ownership',
      BRIDGE.includes("'" + id + "'") && src.includes('__woWarn.mark("' + id + '"'));
  }
  check('bridge requires an engine signature before creating the isolated copy',
    /type === 'warning_panel'[\s\S]*?d\.src === 'engine' && eventSigned\(d\)[\s\S]*?showOwnedMainWarning/.test(BRIDGE));
  check('isolated warning uses a closed-shadow owned overlay and trusted dismissal',
    BRIDGE.includes("woOwnedOverlay('wo-owned-main-warning')")
      && BRIDGE.includes('if (!e.isTrusted || mainWarningOverlay !== overlay || !overlay.owns(button)) return;'));
  check('isolated warning copy is fixed in bridge and checks for occlusion',
    BRIDGE.includes('const message = mainWarningCopy[id];')
      && BRIDGE.includes("kind: 'warning-ui-compromised'"));
  check('paste continuation belongs to the isolated overlay, not the page-owned panel',
    !/go\.textContent="Paste anyway"/.test(src)
      && BRIDGE.includes("continuePaste.textContent = 'Paste anyway'")
      && BRIDGE.includes('if (!e.isTrusted || mainWarningOverlay !== overlay || !overlay.owns(continuePaste)) return;'));
  check('the isolated choice is signed and the engine rejects replayed decisions',
    BRIDGE.includes("const type = 'warning_decision'")
      && BRIDGE.includes('if (!dispatchWarningDecision(id, decisionId)) return;')
      && src.includes('"warning_decision"!==d.type||"bridge"!==d.src||!__woEventTrusted(d)')
      && src.includes('seq<=pasteDecisionSeq')
      && src.includes('d.detail.decisionId!==pasteDecisionId'));
}

{
  const start = SRC.indexOf('let pasteWarned=!1,');
  const end = SRC.indexOf('const showPastePanel=', start);
  if (start < 0 || end < start) throw new Error('paste decision listener was not found');
  let listener = null;
  let accepted = 0;
  const context = {
    document: {}, Number,
    woOn: (_target, type, fn) => { if (type === 'wo-event') listener = fn; },
    __woEventTrusted: (detail) => detail.emac === 'valid',
  };
  vm.createContext(context);
  vm.runInContext(SRC.slice(start, end)
    + '\nglobalThis.setPasteDecision=(id,fn)=>{pasteDecisionId=id;pasteDecision=fn};'
    + '\nglobalThis.pasteDecisionSequence=()=>pasteDecisionSeq;', context);
  if (!listener) throw new Error('paste decision listener was not installed');
  const decision = (seq, id, mac = 'valid') => ({ detail: {
    type: 'warning_decision', src: 'bridge', eseq: seq, emac: mac,
    detail: { id: 'wo-paste-warn', decisionId: id },
  } });
  context.setPasteDecision(8, () => { accepted++; });
  listener(decision(1, 8, 'forged'));
  listener(decision(2, 7));
  check('forged and old-request decisions cannot continue a paste', accepted === 0);
  listener(decision(3, 8));
  check('a signed choice continues its own pending paste once', accepted === 1);
  listener(decision(3, 8));
  context.setPasteDecision(9, () => { accepted++; });
  listener(decision(4, 8));
  check('replay of a previous paste choice cannot authorize the next request', accepted === 1);
  listener(decision(5, 9));
  check('a new signed choice can authorize the new request', accepted === 2 && context.pasteDecisionSequence() === 5);
}

// ---------------------------------------------------------------------------
// 2. Every one of the four asks the registry, and none of them asks the document.
//    Checked in the shipped build, because that is the file the browser loads.
// ---------------------------------------------------------------------------
{
  const codeOnly = (t) => t.replace(/\/\*[\s\S]*?\*\//g, '');
  const src = codeOnly(SRC);
  const min = codeOnly(MIN);

  for (const id of WARNINGS) {
    check(id + ' no longer asks the document whether it is showing',
      !src.includes('getElementById("' + id + '")'),
      'the decoy suppression is back');
    check(id + ' asks the private registry instead',
      src.includes('__woWarn.up("' + id + '")'));
    check(id + ' records the node it built',
      src.includes('__woWarn.mark("' + id + '"'));
    check(id + ' carries the same arrangement into the shipped build',
      min.includes('__woWarn.up("' + id + '")') && !min.includes('getElementById("' + id + '")'));
  }
}

if (failed) { console.error('\n' + failed + ' warning-ownership check(s) failed'); process.exit(1); }
console.log('\nthe warned-about page cannot suppress its own warning with a decoy');

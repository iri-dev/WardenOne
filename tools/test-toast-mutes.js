/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Silencing a kind of notification, and getting it back.
 * Run: node tools/test-toast-mutes.js
 *
 * A warning with no way to turn it off is one people learn to close without
 * reading, so the card now offers an hour, two hours, the working day, or never
 * again. The half that matters more is the other one: a "never show this again"
 * that cannot be found afterwards is a trap, so every mute is listed and
 * reversible in the popup, and the list only shows what is actually in force.
 *
 * The channel is deliberately narrow. A page can name a warning TYPE and a
 * duration and nothing else -- no host, no setting -- so the worst a hostile
 * page can do is quieten a card about itself, which it could already achieve by
 * not triggering one.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const BRIDGE = fs.readFileSync(path.join(ROOT, 'bridge.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const POPUP_HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

// --- the engine honours a mute ---------------------------------------------

/* The real quieting rule, lifted rather than restated. */
function loadQuietRule() {
  const at = CONTENT.indexOf('const mutes=WO.toastMutes;');
  assert(at > 0, 'the mute check is not in the built engine');
  const end = CONTENT.indexOf('}', CONTENT.indexOf('return!0', at));
  const body = CONTENT.slice(at, end + 1);
  const sandbox = { WO: {}, Object, Number, Date, __muted: null };
  vm.createContext(sandbox);
  return (mutes, type) => {
    sandbox.WO = { toastMutes: mutes };
    sandbox.__type = type;
    vm.runInContext('__muted=(function(type){' + body + 'return!1})(__type);', sandbox);
    return sandbox.__muted;
  };
}

const isMuted = loadQuietRule();

/* The whole of shouldQuietToast, so the "nothing happened" clause is exercised where it
   really sits rather than asserted about as text. */
function loadWholeQuietRule() {
  const at = CONTENT.indexOf('shouldQuietToast=(type,detail)=>{');
  assert(at > 0, 'shouldQuietToast is not in the built engine');
  const open = CONTENT.indexOf('{', CONTENT.indexOf('=>', at));
  let depth = 0;
  let end = open;
  for (; end < CONTENT.length; end++) {
    if (CONTENT[end] === '{') depth++;
    else if (CONTENT[end] === '}') { depth--; if (!depth) break; }
  }
  const body = CONTENT.slice(open + 1, end);
  const sandbox = { WO: {}, Object, Number, Date, String, location: { hostname: 'example.com' }, __quiet: null };
  vm.createContext(sandbox);
  return (type, detail, wo) => {
    sandbox.WO = wo || {};
    sandbox.__type = type;
    sandbox.__detail = detail;
    vm.runInContext('__quiet=(function(type,detail){' + body + 'return!1})(__type,__detail);', sandbox);
    return sandbox.__quiet;
  };
}

(function anEventAboutNothingDrawsNoCard() {
  /* Reported as "twitch, github and challengermode installed a service worker — surely
     this is false firing". It was, for a precise reason: the documented way to use a
     service worker is to call register() on EVERY page load, and when a registration
     already exists that call does nothing. Both sites came back with one registration and
     the page already controlled, so nothing was installed on the visit that warned.
     The event still has to go out -- clear-on-leave reads the worker's list of sites that
     have one -- so the card is what gets suppressed, not the message. */
  const quiet = loadWholeQuietRule();
  check('an event marked as nothing-happened draws no card',
    quiet('warned_service_worker', { existing: true }) === true);
  check('the same event without that mark still draws one',
    quiet('warned_service_worker', { existing: false }) !== true);
  check('and a missing detail is not treated as nothing-happened',
    quiet('warned_service_worker', null) !== true,
    'the absence of a flag must not silence a card');
}());

(function mutesAreHonoured() {
  const future = Date.now() + 15 * 60000;
  const past = Date.now() - 60000;
  check('a type muted until later is silenced', isMuted({ warned_service_worker: future }, 'warned_service_worker') === true);
  check('a type muted forever is silenced', isMuted({ warned_service_worker: 0 }, 'warned_service_worker') === true);
  /* An expired mute must not keep silencing. A warning that never comes back is
     the failure mode this whole feature has to avoid producing by accident. */
  check('an expired mute stops silencing', isMuted({ warned_service_worker: past }, 'warned_service_worker') !== true);
  check('an unrelated type is unaffected', isMuted({ warned_service_worker: 0 }, 'blocked_popup') !== true);
  check('no mutes at all is not an error', isMuted(undefined, 'blocked_popup') !== true);
}());

// --- what a page is allowed to ask for --------------------------------------

(function theChannelIsNarrow() {
  const relay = BRIDGE.slice(BRIDGE.indexOf("if (msg.kind === 'mute-toast')"), BRIDGE.indexOf("if (msg.kind === 'domain-age')"));
  check('the relay accepts mute-toast', relay.length > 0);
  check('it validates the type shape', /\[a-z_\]\{3,60\}/.test(relay.replace(/\\/g, '')));
  /* Only these four. An arbitrary number would let a page mute something for a
     decade, which is "never" wearing a disguise. */
  check('only the offered durations are accepted', /\[60, 120, 480, 0\]/.test(relay), relay.slice(0, 200));
  check('it returns only the type and the duration',
    /return \{ kind: 'mute-toast', type, minutes \}/.test(relay),
    'the page must not be able to smuggle other fields through');

  const handler = BG.slice(BG.indexOf('async function muteToastType'), BG.indexOf('async function maybeClearOnLeave'));
  check('the worker re-validates rather than trusting the relay',
    /\[a-z_\]\{3,60\}/.test(handler.replace(/\\/g, '')) && /\[60, 120, 480, 0\]/.test(handler));
  check('the worker sweeps expired entries when it writes',
    /!== 0 && Number\(mutes\[key\]\) <= now/.test(handler),
    'the popup would list mutes that are no longer in force');
}());

// --- the way back -----------------------------------------------------------

(function everyMuteIsReversible() {
  check('the popup has somewhere to list them', POPUP_HTML.indexOf('muted-toasts-list') >= 0);
  check('the row has a discoverable empty state when nothing is muted',
    /Nothing silenced right now\./.test(POPUP_JS));
  check('each entry offers a way back', /Show again/.test(POPUP_JS));
  check('expired entries are swept on render too, not just on write',
    /mutes\[type\] === 0 \|\| Number\(mutes\[type\]\) > now/.test(POPUP_JS));

  /* The rule this broke first time: exactly one place may write the config, or
     two panels race and a setting silently reverts. */
  check('undo goes through persistConfig rather than writing storage itself',
    /persistConfig\(\(\) => renderMutedToasts\(config\)/.test(POPUP_JS));
  const undoBlock = POPUP_JS.slice(POPUP_JS.indexOf('function renderMutedToasts'), POPUP_JS.indexOf('function syncBreachVisibility'));
  check('the muted panel never calls storage.set directly',
    undoBlock.indexOf('chrome.storage.local.set') < 0);

  /* "Never" has to be undoable or it is a trap, not a choice. */
  check('a forever mute is listed as such, not hidden',
    /Always hidden/.test(POPUP_JS));
}());

// --- the card offers it -----------------------------------------------------

(function theCardOffersTheChoice() {
  const row = SOURCE.slice(SOURCE.indexOf('Hide this:') - 2000, SOURCE.indexOf('Hide this:') + 2000);
  check('the card asks plainly', row.indexOf('Hide this:') >= 0);
  ['1h', '2h', 'Today', 'Always'].forEach((label) => {
    check('the card offers ' + label, row.indexOf('"' + label + '"') >= 0);
  });
  check('choosing one tells the reader where to undo it',
    /Undo it in WardenOne/.test(row));
  check('it uses the existing background request channel',
    /__woBackgroundRequest\(\{kind:"mute-toast"/.test(row));
  check('the built engine carries it', CONTENT.indexOf('Hide this:') > 0);
}());

// --- the hour-long memory ---------------------------------------------------

(function reloadingDoesNotRepeatTheNotice() {
  /* A notice is a statement about a thing that happened, not about a page load.
     Repeated on every refresh it stops being information and becomes weather. */
  const rule = loadQuietRule();
  void rule;
  const quiet = CONTENT.slice(CONTENT.indexOf("const memory=WO.toastMemory"), CONTENT.indexOf("const memory=WO.toastMemory") + 400);
  check("the engine consults a shown-recently memory", quiet.length > 0);
  check("it is keyed on the site as well as the type",
    quiet.indexOf('type+"|"+host') >= 0,
    "the same notice about a different site is a different statement");
  check('the window is half an hour', /18e5|1800000/.test(quiet), quiet.slice(0, 200));

  const bg = BG.slice(BG.indexOf("const TOAST_MEMORY_WINDOW_MS"), BG.indexOf("async function muteToastType"));
  check('the worker agrees on the window', bg.indexOf('30 * 60 * 1000') >= 0);
  check("the host is taken from the sending tab, not the page",
    BG.indexOf('recordToastShown(msg.type, sender.tab && sender.tab.url)') >= 0,
    "a page could otherwise silence a notice about someone else's site");
  check("a repeat inside the window writes nothing",
    bg.indexOf('now - Number(memory[key]) < TOAST_MEMORY_WINDOW_MS) return') >= 0,
    "a busy page would turn every notice into a storage write");
  check('expired entries are swept', bg.indexOf('>= TOAST_MEMORY_WINDOW_MS) delete memory') >= 0);
  check("the memory is bounded", /TOAST_MEMORY_MAX/.test(bg));

  /* Reported where the decision to show is final. Reporting at render would
     double-count a card the stagger deferred and never drew. */
  check("the engine reports a shown toast once, at the decision point",
    SOURCE.indexOf('__woBackgroundRequest({kind:"toast-shown"') >= 0);
  const rel = BRIDGE.slice(BRIDGE.indexOf("if (msg.kind === 'toast-shown')"), BRIDGE.indexOf("if (msg.kind === 'mute-toast')"));
  check("the relay accepts only the type for a shown report",
    /return { kind: .toast-shown., type }/.test(rel), rel.slice(0, 160));
}());
(function noMuteIsShorterThanTheMemory() {
  /* 15 minutes had become dead space: the shown-recently memory already keeps a
     notice quiet for thirty, so the button could not do anything the memory was
     not already doing. Whatever these two numbers become, the shortest mute has
     to outlast the memory or it is a control that appears to work and does not. */
  const bg = BG.slice(BG.indexOf('const TOAST_MEMORY_WINDOW_MS'), BG.indexOf('async function muteToastType'));
  const windowMs = (() => {
    const m = /TOAST_MEMORY_WINDOW_MS = (\d+) \* (\d+) \* (\d+)/.exec(bg);
    return m ? Number(m[1]) * Number(m[2]) * Number(m[3]) : 0;
  })();
  check('the memory window is findable', windowMs > 0, bg.slice(0, 120));
  const durations = (() => {
    const muteBlock = BG.slice(BG.indexOf('async function muteToastType'), BG.indexOf('async function maybeClearOnLeave'));
    const m = /\[([0-9, ]+)\]\.includes\(minutes\)/.exec(muteBlock);
    return m ? m[1].split(',').map((n) => Number(n.trim())).filter((n) => n > 0) : [];
  })();
  check('the offered durations are findable', durations.length > 0, JSON.stringify(durations));
  const shortest = Math.min.apply(null, durations) * 60000;
  check('the shortest mute outlasts the memory window',
    shortest >= windowMs,
    'shortest mute ' + (shortest / 60000) + 'm vs memory ' + (windowMs / 60000) + 'm');
}());

(function everyRelayableKindIsAlsoAllowedFromATab() {
  /* The bug that made both features silently do nothing.

     The bridge will relay a message kind, and a handler exists for it, and in
     between sits TAB_CONTEXT_ALLOWED_MESSAGES -- a defence-in-depth allowlist of
     what a tab may send at all. An unregistered kind is answered with "Not
     allowed from this context" and never reaches its handler. Nothing throws,
     nothing logs, the card just quietly has no effect.

     Every piece was individually correct, which is why reading them one at a
     time found nothing. This checks the pair instead: anything the bridge is
     willing to relay from a page must also be a kind a tab is allowed to send. */
  const relayBlock = BRIDGE.slice(BRIDGE.indexOf("const relayAllowedMessage"), BRIDGE.indexOf("woOn(document, 'wo-background-message'"));
  const relayable = Array.from(new Set((relayBlock.match(/msg.kind === .([a-z-]+)./g) || [])
    .map((m) => m.replace(/.*=== .([a-z-]+)./, "$1"))));
  check("the relay declares at least the kinds we added",
    relayable.indexOf("mute-toast") >= 0 && relayable.indexOf("toast-shown") >= 0,
    relayable.join(", "));

  const setBlock = BG.slice(BG.indexOf("TAB_CONTEXT_ALLOWED_MESSAGES = new Set(["),
    BG.indexOf("]);", BG.indexOf("TAB_CONTEXT_ALLOWED_MESSAGES = new Set([")));
  const missing = relayable.filter((kind) => setBlock.indexOf("'" + kind + "'") < 0);
  check("every relayable kind is allowed from a tab", missing.length === 0,
    "rejected before reaching its handler: " + missing.join(", "));
}());
(function everyKeyTheEngineReadsIsOneBuildConfigProduces() {
  /* The second whitelist to swallow this feature whole.

     buildConfig does not copy the config -- it returns an explicit object naming
     every key the engine is allowed to see. A key the worker writes and the
     engine reads is simply absent until it is named there, and nothing throws,
     logs or warns. The mute was written correctly and the page was never told.

     So rather than pin two names, this compares the two sides: every WO.<key>
     the engine reads must be a key buildConfig emits. */
  const bcAt = SOURCE.indexOf("function buildConfig(overrides)");
  assert(bcAt >= 0, "buildConfig is gone");
  let depth = 0, i = SOURCE.indexOf("{", bcAt), end = i;
  for (; i < SOURCE.length; i++) {
    if (SOURCE[i] === "{") depth++;
    else if (SOURCE[i] === "}") { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = SOURCE.slice(bcAt, end + 1);
  const produced = new Set(body.split('\n')
    .map((line) => /^ {6}([A-Za-z_][A-Za-z0-9_]*)\s*:/.exec(line))
    .filter(Boolean).map((m) => m[1]));
  check("buildConfig still emits a named key list", produced.size > 50, produced.size + " keys");

  /* Keys the engine sets or derives itself rather than receiving. */
  const NOT_FROM_CONFIG = new Set(["__amazonCompatibilityMode", "__youtubeRecoveryMode", "__configReady"]);
  const read = new Set([...SOURCE.matchAll(/WO.([A-Za-z_][A-Za-z0-9_]*)/g)].map((m) => m[1]));
  const missing = [...read].filter((k) => !produced.has(k) && !NOT_FROM_CONFIG.has(k));
  check("every config key the engine reads is one buildConfig emits",
    missing.length === 0,
    "silently always undefined in the page: " + missing.join(", "));

  check("the mute map is among them", produced.has("toastMutes"));
  check("the shown-recently memory is among them", produced.has("toastMemory"));
}());
(function theChoicesSitOnOneLine() {
  /* The last choice wrapped onto its own line, which made it read as a separate
     and heavier decision than the other three rather than the last item in a row
     of four. Shorter label, tighter pills, and no wrapping. */
  const row = SOURCE.slice(SOURCE.indexOf('Hide this:') - 2600, SOURCE.indexOf('Hide this:') + 2600);
  check('the label is short enough to leave room', row.indexOf('"Hide this:"') >= 0);
  check('the row does not wrap', row.indexOf('flex-wrap:nowrap!important') >= 0,
    'the last choice drops to a second line again');
  check('the pills refuse to shrink or wrap their text',
    row.indexOf('flex:0 0 auto!important') >= 0 && row.indexOf('white-space:nowrap!important') >= 0);
  check('the label yields space before the pills do',
    row.indexOf('flex:0 1 auto!important') >= 0);
  check('all four choices are still offered',
    ['1h', '2h', 'Today', 'Always'].every((l) => row.indexOf('"' + l + '"') >= 0));

  /* Every other answer in this row is a length of time, so the permanent one has
     to be a length of time too. "Never" answers a different question -- read
     against the label it promises "never hide this", which is the opposite of
     what pressing it does. */
  /* Read off the built engine, where the comments explaining this are gone --
     against the source the check matches its own rationale and never fails. */
  const built = /\[\["1h",60\],\["2h",120\],\["Today",480\],\["(\w+)",0\]\]/.exec(CONTENT);
  check('the four choices reach the built engine intact', !!built,
    'the label list changed shape');
  check('the permanent choice is a duration, not a frequency',
    !!built && built[1] === 'Always',
    built ? '"Hide this: ... ' + built[1] + '" reads as "' + built[1].toLowerCase() + ' hide this"' : '');
  check('the popup describes the same four choices as the card',
    ['1h', '2h', 'Today', 'Always'].every((l) => POPUP_HTML.indexOf(l) >= 0)
      && POPUP_HTML.indexOf('Today or Never') < 0,
    'the popup would be naming a button that is not on the card');
}());

(function theRowDoesNotShoutOverTheWarning() {
  /* Four filled chips read as a button bar and carried the same weight as the
     warning above them. They are plain text now and only fill under the pointer,
     with a hairline to mark the row as being about the card rather than part of
     it. Checked because "make it quieter" is the kind of change that gets
     undone by the next person adding a state to these buttons. */
  const row = SOURCE.slice(SOURCE.indexOf('Hide this:') - 2600, SOURCE.indexOf('Hide this:') + 2600);
  check('the row is separated from the message', row.indexOf('border-top:1px solid rgba(157,84,201,.16)!important') >= 0);
  check('a button is transparent at rest',
    /muteRest\s*=\s*muteFace\s*\+\s*"[^"]*background:transparent!important;/.test(row),
    'at rest it should read as text, not as a control competing with the warning');
  check('it fills only under the pointer',
    /muteHover\s*=\s*muteFace\s*\+\s*"[^"]*background:#f2e9f9!important;/.test(row));
  check('the hover state is reachable from the keyboard too',
    row.indexOf('"focus"') >= 0 && row.indexOf('"blur"') >= 0,
    'a control that only appears under a mouse is not a control for everyone');
  check('leaving the button puts it back', row.indexOf('"mouseleave"') >= 0);
}());

(function thePanelNamesEachNoticeTheWayTheCardDid() {
  /* A silenced notice has to be recognisable by the words someone actually
     read. The popup cannot import the engine's TOAST_INFO, so it carries its
     own copy of the titles, and a second copy of anything is a copy that
     drifts. This is the thing that stops it: every card the engine can draw
     needs a title in the popup, spelled the same, and the popup may not invent
     titles for cards that no longer exist. */
  const infoAt = CONTENT.indexOf('const TOAST_INFO={');
  const info = CONTENT.slice(infoAt, CONTENT.indexOf('};', infoAt));
  const engine = new Map();
  const rx = /([a-z0-9_]+):\{title:"([^"]*)"/g;
  let m;
  while ((m = rx.exec(info))) engine.set(m[1], m[2]);
  check('the engine still declares its toast titles', engine.size > 40, 'found ' + engine.size);

  const mapAt = POPUP_JS.indexOf('const TOAST_TITLES = {');
  check('the popup carries titles of its own', mapAt > 0);
  const popupMap = new Map();
  const prx = /^\s{2}([a-z0-9_]+): '(.*)',$/gm;
  const mapBlock = POPUP_JS.slice(mapAt, POPUP_JS.indexOf('\n};', mapAt));
  while ((m = prx.exec(mapBlock))) popupMap.set(m[1], m[2].split("\\'").join("'"));
  check('the popup titles parse', popupMap.size === engine.size,
    'popup ' + popupMap.size + ' vs engine ' + engine.size);

  const missing = Array.from(engine.keys()).filter((k) => !popupMap.has(k));
  check('every card the engine draws can be named in the popup', missing.length === 0,
    'shown as a de-prefixed key instead: ' + missing.join(', '));
  const extra = Array.from(popupMap.keys()).filter((k) => !engine.has(k));
  check('the popup invents no cards', extra.length === 0,
    'named in the popup but never drawn: ' + extra.join(', '));
  const differ = Array.from(engine.keys())
    .filter((k) => popupMap.has(k) && popupMap.get(k) !== engine.get(k))
    .map((k) => k + ' (card "' + engine.get(k) + '" vs popup "' + popupMap.get(k) + '")');
  check('the popup uses the card\'s own wording', differ.length === 0, differ.join('; '));

  /* The specific ugliness this replaced. De-prefixing the key reads as fine
     until a key was never meant to be read: "Abuseipdb server", "Honeytoken
     read", "Token exfil". Compared against what the old rule actually produced
     rather than against a guess at what jargon looks like -- a good title and
     a bad one can have the same shape. */
  const deprefixed = (k) => {
    const l = k.replace(/^(blocked|warned|detected|gated|cleaned)_/, '').replace(/_/g, ' ');
    return l ? l.charAt(0).toUpperCase() + l.slice(1) : k;
  };
  ['warned_abuseipdb_server', 'warned_honeytoken_read', 'blocked_token_exfil']
    .forEach((k) => {
      if (!engine.has(k)) return;
      check('"' + k + '" is named, not de-prefixed',
        popupMap.get(k) !== deprefixed(k),
        'still shown as "' + deprefixed(k) + '"');
    });
  const stillRaw = Array.from(engine.keys()).filter((k) => engine.get(k) === deprefixed(k));
  check('the map earns its keep', stillRaw.length < engine.size,
    'every title equals its de-prefixed key -- the map is doing nothing');
}());

(function thePanelIsWhereSomeoneWouldLookForIt() {
  /* Pinned next to the notification switch so it is where someone turning
     notifications down would already be looking. */
  const rowAt = POPUP_HTML.indexOf('id="muted-toasts-row"');
  check('the panel exists', rowAt > 0);
  const before = POPUP_HTML.slice(0, rowAt);
  /* It used to hide itself whenever nothing was muted. Tidier, and it meant
     that the one time someone goes looking for this -- right after silencing a
     notice they now regret -- an empty panel and a missing feature looked
     exactly alike. The row stays; an empty state carries the explanation.

     Two ways to lose that. Hidden in the markup, or hidden at render. */
  const tag = POPUP_HTML.slice(POPUP_HTML.lastIndexOf('<div', rowAt),
    POPUP_HTML.indexOf('>', rowAt) + 1);
  check('the panel is not hidden in the markup',
    tag.indexOf('display:none') < 0 && tag.indexOf('hidden') < 0, tag);
  const render = POPUP_JS.slice(POPUP_JS.indexOf('function renderMutedToasts'),
    POPUP_JS.indexOf('function syncBreachVisibility'));
  check('nothing hides the panel at render time',
    !/row\.(style\.display|hidden|classList)/.test(render),
    'the empty state is the point -- an empty panel must still be a visible panel');
  check('it sits directly under the notifications switch',
    before.lastIndexOf('data-key="showToasts"') > before.lastIndexOf('<h2'),
    'it drifted away from the setting it belongs to');
  const heading = before.lastIndexOf('<h2');
  check('it is in the Interface section',
    POPUP_HTML.slice(heading, heading + 60).indexOf('Interface') >= 0,
    POPUP_HTML.slice(heading, heading + 60));
  check('it names itself plainly', POPUP_HTML.indexOf('Notifications you silenced') > 0);
}());

// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('toast mutes: ' + pass + ' checks passed');

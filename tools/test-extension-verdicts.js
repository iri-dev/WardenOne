/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * What the Security Centre says about an extension, and when it says nothing.
 * Run: node tools/test-extension-verdicts.js
 *
 * The bug this suite exists for: an exactly-matched official Bitwarden was
 * labelled REVIEW ACCESS and put in "Needs attention". The verdict chain tested
 * for powerful access ABOVE recognised identity, and every extension worth
 * recognising is powerful — a password manager that cannot read the page cannot
 * fill anything in. So recognition bought nothing, and the attention list filled
 * with entries nobody should act on. A warning everybody dismisses protects
 * nobody, which makes a false alarm a security bug and not a cosmetic one.
 *
 * The fix is not "trust recognised extensions". It is that the catalogue now
 * records what each exact, verified extension is for, so the question stops being "is
 * this powerful" and becomes "is this powerful in the way this kind of thing is
 * powerful". A password manager reaching its desktop app is a password manager.
 * A password manager that can route your traffic through a proxy is a story, and
 * that case must still fire — which is most of what is checked below.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'background-extension-reputation.js'), 'utf8');
const DB = JSON.parse(fs.readFileSync(path.join(ROOT, 'extension-reputation.json'), 'utf8'));

const BITWARDEN = 'nngceckbapebfimnlniiiahkandclblb';
const UBLOCK = Object.keys(DB.entries).find((id) => /uBlock/i.test(DB.entries[id].name));
const NORDVPN = Object.keys(DB.entries).find((id) => /NordVPN/i.test(DB.entries[id].name));
const GREAT_SUSPENDER = Object.keys(DB.entries).find((id) => /Great Suspender/i.test(DB.entries[id].name));

let pass = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  failures.push(name + (detail ? ' — ' + detail : ''));
}

/* The real assessment, with only Chrome stubbed. The point is what the shipped
   chain decides, not what a paraphrase of it would decide. */
function loadEngine() {
  const context = {
    console, Set, Map, Array, Object, String, Number, Boolean, JSON, Math, Date, Promise, RegExp,
    chrome: { runtime: { id: 'self', getURL: (p) => 'chrome-extension://self/' + p } },
    localGet: async () => ({}),
    localSet: async () => {},
    localRemove: async () => {},
    queueHistory: () => {},
  };
  context.globalThis = context;
  vm.createContext(context);
  /* The reputation module leans on helpers the watch module defines. Loading it
     alone would throw on the first reference. */
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'background-extension-watch.js'), 'utf8'), context,
    { filename: 'background-extension-watch.js' });
  vm.runInContext(SOURCE, context, { filename: 'background-extension-reputation.js' });
  return context.__woExtensionReputationTest;
}

const engine = loadEngine();

/* The database as the engine sees it: sanitised, with each entry carrying its
   own id, which is what lookupExtensionReputation expects. */
function database() {
  const result = engine.validateExtensionReputationDatabase(DB, { origin: 'bundled' });
  assert(result.ok, 'the bundled database no longer validates: ' + (result.errors || []).join('; '));
  return result.database;
}

const DB_READY = database();

function assess(id, overrides) {
  const extension = Object.assign({
    id,
    type: 'extension',
    name: (DB.entries[id] && DB.entries[id].name) || 'Unknown extension',
    description: '',
    version: '2.0.0',
    enabled: true,
    mayDisable: true,
    installType: 'normal',
    permissions: ['storage'],
    hostPermissions: [],
  }, overrides || {});
  return engine.buildExtensionAssessment(extension, DB_READY, {}, [], []);
}

// --- the complaint ----------------------------------------------------------

(function bitwardenIsNotAnAlarm() {
  /* Exactly what a password manager holds: read and fill any sign-in form, and
     talk to the desktop app. Both are high-severity capability signatures, and
     both are the reason the extension exists. */
  const a = assess(BITWARDEN, {
    permissions: ['storage', 'scripting', 'nativeMessaging', 'idle', 'clipboardWrite'],
    hostPermissions: ['<all_urls>'],
  });
  check('an official password manager is not put in Needs attention',
    a.verdict.needsAttention === false, a.verdict.label + ' / ' + a.recommendedAction);
  check('it is not labelled REVIEW ACCESS', a.verdict.label !== 'REVIEW ACCESS', a.verdict.label);
  check('it reads as recognised', a.verdict.code === 'recognized_expected', a.verdict.code);
  check('its tone is calm, so the card is not styled as a problem',
    a.verdict.tone === 'calm', a.verdict.tone);
  /* And it explains WHY it is fine, rather than just going quiet. */
  check('it says what a password manager needs',
    /password manager/i.test(a.recommendedAction) && /fill/i.test(a.recommendedAction),
    a.recommendedAction);
  check('the powerful access is still listed, just not as a warning',
    a.capabilities.expected.length >= 2, JSON.stringify(a.capabilities.expected.map((s) => s.id)));
}());

(function theOtherRecognisedKindsAreAlsoQuiet() {
  const cases = [
    [UBLOCK, { permissions: ['storage', 'webRequest', 'scripting'], hostPermissions: ['<all_urls>'] }, 'a content blocker'],
    [NORDVPN, { permissions: ['storage', 'proxy', 'webRequest'], hostPermissions: ['<all_urls>'] }, 'a VPN'],
  ];
  cases.forEach((entry) => {
    if (!entry[0]) { failures.push('missing catalogue entry for ' + entry[2]); return; }
    const a = assess(entry[0], entry[1]);
    check(entry[2] + ' doing its job is not an alarm',
      a.verdict.needsAttention === false, entry[2] + ': ' + a.verdict.label + ' / ' + a.recommendedAction);
  });
}());

// --- the part that must still fire ------------------------------------------

(function unexpectedAccessOnARecognisedExtensionStillFires() {
  /* The whole point of a profile: not "recognised means quiet", but "recognised
     means we know what it should need". A password manager has no business
     routing traffic through a proxy, and this is the case the naive fix
     ("trust recognised extensions") would have silently swallowed. */
  const a = assess(BITWARDEN, {
    permissions: ['storage', 'scripting', 'nativeMessaging', 'proxy'],
    hostPermissions: ['<all_urls>'],
  });
  check('a recognised extension with capability outside its profile still warns',
    a.verdict.needsAttention === true, a.verdict.label + ' / ' + a.recommendedAction);
  check('it is labelled as unexpected rather than merely powerful',
    a.verdict.code === 'unexpected_capability', a.verdict.code);
  check('the advice names the specific capability, not "review access"',
    /proxy/i.test(a.recommendedAction), a.recommendedAction);
  check('the expected capabilities are not counted against it',
    a.capabilities.unexpected.length === 1, JSON.stringify(a.capabilities.unexpected.map((s) => s.id)));
  check('a critical unexpected capability reads as danger',
    a.verdict.tone === 'danger', a.verdict.tone);
}());

(function debuggerOnAPasswordManagerFires() {
  const a = assess(BITWARDEN, {
    permissions: ['storage', 'scripting', 'debugger'],
    hostPermissions: ['<all_urls>'],
  });
  check('a password manager gaining debugger access warns', a.verdict.needsAttention === true, a.verdict.label);
  check('and names it', /debugger/i.test(a.recommendedAction), a.recommendedAction);
}());

(function aDeveloperToolMayUseTheDebugger() {
  /* The same capability, judged against a different purpose. This is the test
     that proves the profile is doing real work rather than a global allowlist. */
  const devTools = Object.keys(DB.entries).find((id) => /React Developer Tools/i.test(DB.entries[id].name));
  const a = assess(devTools, { permissions: ['storage', 'scripting', 'debugger'], hostPermissions: ['<all_urls>'] });
  check('a developer tool using the debugger is not an alarm',
    a.verdict.needsAttention === false, a.verdict.label + ' / ' + a.recommendedAction);
}());

// --- evidence still outranks everything -------------------------------------

(function documentedCompromisesStillWin() {
  const a = assess(GREAT_SUSPENDER, { permissions: ['storage', 'scripting'], hostPermissions: ['<all_urls>'] });
  check('a documented compromise is still flagged', a.verdict.needsAttention === true, a.verdict.label);
  check('it is still styled as danger', a.verdict.tone === 'danger', a.verdict.tone);
  check('and it still says remove', /remove/i.test(a.recommendedAction), a.recommendedAction);
}());

(function anUnknownPowerfulExtensionStillGetsALook() {
  /* What REVIEW ACCESS was always trying to say, and could not, while it also
     fired on everything known. Powerful AND unidentified is the combination
     that deserves someone's attention. */
  const a = assess('abcdefghijklmnopabcdefghijklmnop', {
    name: 'Some new tab thing',
    permissions: ['storage', 'scripting', 'webRequest'],
    hostPermissions: ['<all_urls>'],
  });
  check('an unrecognised powerful extension is still surfaced',
    a.verdict.needsAttention === true, a.verdict.label);
  check('and the advice says it is unknown rather than merely powerful',
    /not in the local catalogue/i.test(a.recommendedAction), a.recommendedAction);
}());

(function anOrdinaryUnknownExtensionIsLeftAlone() {
  const a = assess('bcdefghijklmnopabcdefghijklmnopa', {
    name: 'A small utility',
    permissions: ['storage'],
    hostPermissions: [],
  });
  check('a small unknown extension is not made into a warning',
    a.verdict.needsAttention === false, a.verdict.label + ' / ' + a.recommendedAction);
}());

// --- the catalogue itself ---------------------------------------------------

(function everyRecognisedKindHasAProfile() {
  /* A recognised entry whose category has no profile falls through to being
     judged as an unknown — which is the original bug, arriving one category
     later. This is the check that stops it coming back when someone adds the
     twenty-second entry. */
  const profiles = DB.capabilityProfiles || {};
  const orphans = [];
  Object.entries(DB.entries).forEach(([id, entry]) => {
    if (entry.status !== 'recognized_identity') return;
    if (!entry.capabilityProfile || !profiles[entry.capabilityProfile]) orphans.push(entry.name);
  });
  check('every recognised entry has a capability profile', orphans.length === 0, orphans.join(', '));

  Object.entries(profiles).forEach(([name, profile]) => {
    check('profile ' + name + ' says what it is', !!profile.label);
    check('profile ' + name + ' says why it needs what it needs', !!profile.needs);
    check('profile ' + name + ' lists expected capabilities', Array.isArray(profile.expected) && profile.expected.length > 0);
    const known = new Set((DB.capabilitySignatures || []).map((s) => s.id).concat([
      'all-site-data', 'tab-metadata', 'history-access', 'cookie-access', 'network-observation',
      'blocking-web-request', 'declarative-network-control', 'clipboard-read', 'downloads-control',
      'script-injection', 'wide-finite-host-set', 'nonstandard-install',
    ]));
    const unknown = (profile.expected || []).filter((c) => !known.has(c));
    /* A typo here would silently mark a real capability unexpected, putting a
       trusted extension back in the attention list — the exact bug, spelled
       differently. */
    check('profile ' + name + ' names only real capability signatures', unknown.length === 0, unknown.join(', '));
  });
}());

(function recognitionNeverImpliesSafety() {
  /* The honesty boundary. Chrome exposes no "this contains malware" signal and
     none is invented here: only an exact evidence match ever says harmful. */
  const statuses = new Set(Object.values(DB.entries).map((e) => e.status));
  statuses.forEach((s) => {
    check('status "' + s + '" is one the engine understands',
      ['known_harmful', 'reported_harmful', 'historical_incident', 'recognized_identity', 'catalogued_listing'].indexOf(s) >= 0);
  });
  check('the catalogue says recognition is not a guarantee',
    /not a safety guarantee/i.test(JSON.stringify(DB.description) + JSON.stringify(DB.entries[BITWARDEN])));
}());

(function theSummaryCountsWhatTheUiShows() {
  /* The popup reads summary.recognized to say something reassuring when the
     attention list is empty. A missing field would render as "undefined" in
     front of the user, which is how a fix for an ugly panel becomes a new ugly
     panel. */
  const report = engine.buildExtensionSecurityReport
    ? null
    : null;
  void report;
  check("the report exposes a recognised count for the panel",
    /recognized: assessments.filter/.test(SOURCE), "summary.recognized is missing");
  check("it counts the calm recognised verdict, not merely a database hit",
    /verdict.code === .recognized_expected./.test(SOURCE));
  const POPUP = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  check("the panel no longer prints a Reputation/Access/Change debug dump",
    POPUP.indexOf("'Reputation: ' + item.reputation.label") < 0);
  check("the panel leads with the specific advice instead",
    /item.recommendedAction || item.reputation.label/.test(POPUP));
}());
(function aWrongIdFailsClosedRatherThanFalselyRecognising() {
  /* The catalogue is hand-recorded, so it will eventually contain a wrong ID.
     In the RECOGNISED direction that is the dangerous kind of mistake: it would
     tell someone an unknown extension is the official Bitwarden. Recognition
     therefore also requires the installed name to corroborate the record, so a
     bad ID costs a missing reassurance instead of a false one. */
  const a = assess(BITWARDEN, { name: "Totally Unrelated Toolbar", permissions: ["storage", "scripting"], hostPermissions: ["<all_urls>"] });
  check("a mismatched name withholds recognition", a.reputation.status === "no_record", a.reputation.status);
  check("and says why, rather than going silent", /calls itself something else/i.test(a.reputation.reason), a.reputation.reason);
  check("the extension is then treated as unknown and powerful", a.verdict.needsAttention === true, a.verdict.label);

  /* Loose on purpose: publishers shorten and localise their own names, and
     demanding an exact string would withhold recognition from the very
     extensions this exists to reassure people about. */
  const short = assess(BITWARDEN, { name: "Bitwarden", permissions: ["storage", "scripting", "nativeMessaging"], hostPermissions: ["<all_urls>"] });
  check("a shortened publisher name still recognises", short.verdict.code === "recognized_expected", short.verdict.label);

  /* A documented compromise applies on ID alone. An attacker renaming their
     copy must not be able to shed its history. */
  const renamedBad = assess(GREAT_SUSPENDER, { name: "Totally Different Name", permissions: ["storage", "scripting"], hostPermissions: ["<all_urls>"] });
  check("a renamed compromised extension keeps its incident record",
    renamedBad.verdict.needsAttention === true && renamedBad.verdict.tone === "danger", renamedBad.verdict.label);
}());

(function aRoutineUpdateDoesNotRefillTheAttentionList() {
  /* What the screenshot actually showed: three REVIEW UPDATE cards, one of them
     for an extension with no meaningful access, because the review snapshot
     compared the version string and Chrome updates extensions constantly. */
  const declared = SOURCE.match(/EXT_REVIEW_MATERIAL_FIELDS = \[([^\]]*)\]/);
  check('the material field list is findable', !!declared);
  const fields = declared ? declared[1].split(',').map((f) => f.trim().replace(/^'|'$/g, '')).filter(Boolean) : [];
  check('the version is not compared when deciding staleness',
    fields.indexOf('version') < 0, 'version is back in the material fields: ' + fields.join(', '));
  check('the name is still compared, because a quiet rename is a hijack shape',
    fields.indexOf('name') >= 0, fields.join(', '));
  check('permissions are still compared', fields.indexOf('permissions') >= 0, fields.join(', '));
  check('the evidence record is still compared, so a new incident re-opens review',
    fields.indexOf('reputationRecord') >= 0, fields.join(', '));
}());

(function theCatalogueIsSubstantialAndInternallyConsistent() {
  const ids = Object.keys(DB.entries);
  check("the catalogue is no longer a token list", ids.length >= 60, ids.length + " entries");
  check("every id is a valid Chrome extension id",
    ids.every((id) => /^[a-p]{32}$/.test(id)), ids.filter((id) => !/^[a-p]{32}$/.test(id)).join(", "));
  const names = {};
  const dupes = [];
  Object.values(DB.entries).forEach((e) => { if (names[e.name]) dupes.push(e.name); names[e.name] = 1; });
  check("no duplicated display names", dupes.length === 0, dupes.join(", "));
  check("every entry cites a source",
    Object.values(DB.entries).every((e) => e.source && DB.sources[e.source]));
  check("every source has a reference",
    Object.values(DB.sources).every((s) => s.label && s.reference));
  /* Recognition must never be the thing that hides an incident. */
  check("documented incidents survived the expansion",
    Object.values(DB.entries).filter((e) => e.status === "historical_incident").length >= 4);
}());
(function theCardIsNotDressedAsAnEmergency() {
  const POPUP = fs.readFileSync(path.join(ROOT, "popup.js"), "utf8");
  const card = POPUP.slice(POPUP.indexOf("Neutral card, coloured edge"), POPUP.indexOf("listEl.appendChild(card)"));
  check("the card no longer fills itself with the warning wash",
    card.indexOf("--wo-warning-bg") < 0 && card.indexOf("--wo-danger-bg") < 0,
    "a saturated background is back");
  check("severity is carried by an accent edge instead", /border-left:3px solid/.test(card));
  check('the card sits on the ordinary popup surface', card.indexOf('background:var(--wo-surface)') >= 0);
  check('the badge is not shouted in capitals', card.indexOf('.toLowerCase()') >= 0);
  check("a long extension name cannot break the row", /text-overflow:ellipsis/.test(card));
  check("the evidence line is skipped when the advice already said it",
    /alreadySaid/.test(card));
}());

(function nothingOfNoteIsAFloorUnderTheList() {
  /* Twice now a branch found a way to put a harmless extension in the warning
     list: once through a version bump, once through the database learning its
     name. This is the floor under both. */
  check("a backstop verdict exists", /nothing_of_note/.test(SOURCE));
  const guard = SOURCE.slice(SOURCE.indexOf("Last word: an extension with no adverse record"), SOURCE.indexOf("if (!extension.enabled"));
  check("it requires no ADVERSE record, not merely no record at all",
    /reputationRank < EXT_REPUTATION_STATUS_RANK.historical_incident/.test(guard),
    'a recognised extension with no reach could not reach the floor');
  check("it requires no meaningful reach", /accessRank <= EXT_ACCESS_RANK.low/.test(guard));
  check("it requires no unreviewed change", /!unreadChange/.test(guard));
  check("it requires no unexpected capability", /!capabilities.unexpected.length/.test(guard));
}());

(function learningAnExtensionsNameDoesNotReopenReview() {
  /* Adding entries to the catalogue moved every newly recognised extension's
     reputation digest, which re-armed review on things people had already
     looked at. Learning something good about an extension is not a change in
     the extension. */
  const stored = { id: BITWARDEN, name: "Bitwarden", installType: "normal", permissions: ["storage"], reputationRecord: "", reputationStatus: "no_record" };
  const nowKnown = { id: BITWARDEN, name: "Bitwarden", installType: "normal", permissions: ["storage"], reputationRecord: "abc123", reputationStatus: "recognized_identity" };
  check("becoming recognised does not invalidate a review",
    engine.sameExtensionReviewSnapshot(stored, nowKnown) === true);
  const nowBad = { id: BITWARDEN, name: "Bitwarden", installType: "normal", permissions: ["storage"], reputationRecord: "def456", reputationStatus: "known_harmful" };
  check("but new adverse evidence does",
    engine.sameExtensionReviewSnapshot(stored, nowBad) === false);
  const permsChanged = { id: BITWARDEN, name: "Bitwarden", installType: "normal", permissions: ["storage", "debugger"], reputationRecord: "", reputationStatus: "no_record" };
  check("and so does a permission change",
    engine.sameExtensionReviewSnapshot(stored, permsChanged) === false);
}());
(function theFloorActuallyCatchesSomething() {
  /* Source checks proved the floor exists; this proves it fires. The path that
     reaches it: a low-access extension that was reviewed and then renamed. The
     rename makes the review stale, staleness demands attention, and there is
     nothing an extension with no permissions could do with a new name. */
  const ID = "abcdefghijklmnopabcdefghijklmnop";
  const tiny = (name) => ({ id: ID, type: "extension", name, description: "", version: "1.0.0",
    enabled: true, mayDisable: true, installType: "normal", permissions: ["storage"], hostPermissions: [] });
  const first = engine.buildExtensionAssessment(tiny("Tiny Utility"), DB_READY, {}, [], []);
  const reviews = { [ID]: { reviewedAt: 1, snapshot: first.review.snapshot } };
  const renamed = engine.buildExtensionAssessment(tiny("Tiny Utility Deluxe"), DB_READY, reviews, [], []);
  check("the review does go stale on a rename", renamed.review.stale === true);
  check("but a harmless extension is still kept out of the attention list",
    renamed.verdict.needsAttention === false, renamed.verdict.label);
  check("and it is labelled as such", renamed.verdict.code === "nothing_of_note", renamed.verdict.code);
  /* The wording has to stay true: something DID change here. */
  check("the advice does not claim nothing changed",
    !/nothing has changed/i.test(renamed.recommendedAction), renamed.recommendedAction);

  /* And the floor must not swallow anything that matters. */
  const withReach = engine.buildExtensionAssessment(Object.assign(tiny("Tiny Utility Deluxe"),
    { permissions: ["storage", "scripting"], hostPermissions: ["<all_urls>"] }), DB_READY, reviews, [], []);
  check("an extension that can reach every site is not floored",
    withReach.verdict.needsAttention === true, withReach.verdict.label);
}());
(function theSecurityCentreCardWasFixedToo() {
  /* The popup was fixed first and this page was left rendering the old three-row
     Reputation / Access / Change dump plus every Chrome permission string. Two
     surfaces show these verdicts; fixing one is not fixing it. */
  const PAGE = fs.readFileSync(path.join(ROOT, "extensions.js"), "utf8");
  check("the Security Centre no longer builds labelled signal rows",
    PAGE.indexOf("makeSignal(") < 0, "the old signal rows are back");
  check("it leads with the answer", /class=.*ext-answer|.ext-answer./.test(PAGE));
  check("capabilities are grouped by whether they are expected",
    /cap-unexpected/.test(PAGE) && /cap-expected/.test(PAGE));
  check("the evidence is folded away rather than printed on every card",
    PAGE.indexOf("createElement('details')") >= 0 && PAGE.indexOf('evidence-summary') >= 0);

  /* Two bugs that only showed up once the page was actually rendered. */
  check("capability groups are split by id, not object identity",
    PAGE.indexOf('claimed.has(s.id)') >= 0,
    "an identity check lists every expected capability twice");
  check("the advice is not repeated above the buttons",
    (PAGE.match(/item.recommendedAction/g) || []).length === 1,
    "the same sentence is printed twice per card");
  check("the fallback heading is not 'Also has' when there is nothing before it",
    PAGE.indexOf("'Also has' : 'What it can reach'") >= 0);

  const STYLES = fs.readFileSync(path.join(ROOT, "extensions.html"), "utf8");
  ["ext-answer", "cap-heading", "cap-unexpected", "cap-expected", "evidence-summary"].forEach((cls) => {
    check("the page styles ." + cls, STYLES.indexOf("." + cls) >= 0);
  });
  check("the collapsed evidence control is keyboard focusable",
    /evidence-summary:focus-visible/.test(STYLES));
}());
(function claudeIsRecognisedWithoutPretendingItIsHarmless() {
  const CLAUDE = "fcoeoabgfenejglbffodgkkbkcdhcgfn";
  check("the official Claude identity is in the catalogue", !!DB.entries[CLAUDE], "missing");
  const a = assess(CLAUDE, { name: "Claude",
    permissions: ["storage", "scripting", "debugger", "tabs", "cookies"], hostPermissions: ["<all_urls>"] });
  check("it is recognised rather than flagged", a.verdict.needsAttention === false, a.verdict.label);
  check("the debugger is expected for a browser agent, not unexpected",
    a.capabilities.expected.some((c) => c.id === "debugger-control")
      && !a.capabilities.unexpected.length, JSON.stringify(a.capabilities.unexpected));
  /* The honesty that has to survive being recognised: this is the most access
     on the list and the card should say so rather than quietly bless it. */
  check("the copy says plainly how much access this is",
    /most access on this list/i.test(a.recommendedAction), a.recommendedAction);
  check("the record does not claim an update is harmless",
    /does not prove that any particular update is harmless/i.test(DB.entries[CLAUDE].reason));
  check("its identity evidence links the exact Chrome Web Store id",
    String((DB.sources[DB.entries[CLAUDE].source] || {}).reference || "").indexOf(CLAUDE) >= 0);
  check("its capability contract cites Anthropic's own documentation",
    /support.claude.com/.test((DB.capabilityProfiles.browser_agent || {}).reference || ""));

  /* And the name check still contains a wrong or reused ID. */
  const impostor = assess(CLAUDE, { name: "Free Coupon Helper",
    permissions: ["storage", "scripting", "debugger"], hostPermissions: ["<all_urls>"] });
  check("something else at that ID is not blessed as Claude",
    impostor.reputation.status === "no_record" && impostor.verdict.needsAttention === true,
    impostor.verdict.label);
}());

(function theChromeOfTheCentreIsCalmerNow() {
  const STYLES = fs.readFileSync(path.join(ROOT, "extensions.html"), "utf8");
  const POPUP_HTML = fs.readFileSync(path.join(ROOT, "popup.html"), "utf8");
  /* A whole phrase set in capitals reads as shouting and wraps badly, and these
     headings carry phrases rather than tags. */
  check("capability headings are not set in capitals",
    !/.cap-heading[^}]*text-transform: uppercase/.test(STYLES));
  /* The long boundary panel is gone; the honest sentence inside it is not. */
  check("the boundary box was removed", STYLES.indexOf('class="boundary"') < 0);
  const PAGE = fs.readFileSync(path.join(ROOT, "extensions.js"), "utf8");
  check("but the point it made survives in the database panel",
    /not that it is safe/i.test(PAGE), "the no-record-is-not-safe wording was lost with the box");
  /* The LOCAL tag inherited a bold heading and a brand colour, so it read as
     part of the title instead of a label about it. */
  check("the LOCAL tag is no longer brand-purple heading text",
    !/>LOCAL</.test(POPUP_HTML) || POPUP_HTML.indexOf('letter-spacing:.05em;">LOCAL') < 0);
  /* Plain text, not a pill. A one-word aside does not need a border and a
     radius to announce itself as an aside; it needs to stop competing with the
     heading beside it. */
  check("it is plain soft text rather than styled furniture",
    POPUP_HTML.indexOf('font-weight:400;color:var(--wo-text-soft);">Local<') >= 0);
  check("it no longer inherits the heading weight",
    POPUP_HTML.indexOf('letter-spacing:.05em;">LOCAL') < 0);
}());
(function theWorstThingsAreShownFirst() {
  /* The old ordering multiplied reputation rank by 100, and recognized_identity
     is rank 1 -- so a recognised, entirely quiet extension outranked an
     unrecognised one that needed attention. Knowing what something is should
     decide how it is JUDGED, never whether it is shown first. */
  const score = engine.extensionAssessmentSortScore;
  check("the sort scorer is exposed for testing", typeof score === "function");
  if (typeof score !== "function") return;

  const incident = assess(GREAT_SUSPENDER, { permissions: ["storage", "scripting"], hostPermissions: ["<all_urls>"] });
  const unknownPowerful = assess("abcdefghijklmnopabcdefghijklmnop", { name: "Shiny New Tab",
    permissions: ["storage", "scripting", "webRequest"], hostPermissions: ["<all_urls>"] });
  const recognised = assess(BITWARDEN, { permissions: ["scripting", "storage", "webRequest"], hostPermissions: ["<all_urls>"] });
  const unexpected = assess(BITWARDEN, { permissions: ["scripting", "storage", "proxy"], hostPermissions: ["<all_urls>"] });

  check("a documented incident sorts above everything",
    score(incident) > score(unexpected) && score(incident) > score(unknownPowerful));
  check("an unexpected capability sorts above an unidentified extension",
    score(unexpected) > score(unknownPowerful));
  /* The exact regression: a powerful recognised extension must not outrank a
     finding just for being in the catalogue. */
  check("an unidentified extension sorts above a recognised quiet one",
    score(unknownPowerful) > score(recognised),
    "recognition is outweighing the finding again");
  check("a disabled extension sinks within its band",
    score(Object.assign({}, recognised, { enabled: false })) < score(recognised));
}());

(function theSummaryTilesSayWhatTheNumberMeans() {
  const PAGE = fs.readFileSync(path.join(ROOT, "extensions.js"), "utf8");
  const HTML = fs.readFileSync(path.join(ROOT, "extensions.html"), "utf8");
  check("each tile has somewhere to explain itself",
    (HTML.match(/-why"/g) || []).length >= 5);
  check("the explanations are computed from the assessments, not the counts",
    PAGE.indexOf("function summaryWhy") >= 0);
  check("an unexpected capability is described as one",
    PAGE.indexOf("can do something its kind normally does not") >= 0);
  check("an empty attention list says so plainly",
    PAGE.indexOf("Nothing is asking anything of you") >= 0);
}());

(function theQuietOnesFoldAway() {
  const PAGE = fs.readFileSync(path.join(ROOT, "extensions.js"), "utf8");
  const HTML = fs.readFileSync(path.join(ROOT, "extensions.html"), "utf8");
  check("recognised-and-expected extensions collapse into one row",
    PAGE.indexOf("quiet-fold") >= 0 && PAGE.indexOf("publisher-verified, expected access") >= 0);
  /* An extension that changed is not quiet, however well recognised it is. */
  check("an unreviewed change keeps an extension out of the fold",
    PAGE.indexOf("!(item.latestChange && !item.latestChange.reviewed)") >= 0);
  /* If the reader filtered or searched, they asked for these specifically. */
  check("folding is skipped once the reader narrows the list",
    PAGE.indexOf("centreState.filter === 'all' && !centreState.query") >= 0);
  check("the folded names are listed without expanding",
    PAGE.indexOf("quiet-names") >= 0);
  check("the fold is styled and keyboard focusable",
    HTML.indexOf(".quiet-summary") >= 0 && HTML.indexOf(".quiet-summary:focus-visible") >= 0);
}());

(function everyIdentityCitesItsOwnListing() {
  /* Checked against a 111,933-extension reference snapshot; six IDs were simply
     wrong, pointing at unrelated real extensions, and three more could not be
     corroborated at all and were removed. This pins the shape that made the
     check possible: every record cites the store listing for its OWN id, so a
     future entry can be verified the same way. */
  let mismatched = [];
  Object.entries(DB.entries).forEach(([id, entry]) => {
    const source = DB.sources[entry.source] || {};
    const ref = String(source.reference || "");
    if (/chromewebstore.google.com/.test(ref) && ref.indexOf(id) < 0) mismatched.push(entry.name);
  });
  check("no record cites a store listing for a different extension",
    mismatched.length === 0, mismatched.join(", "));
}());
(function nativeMessagingIsExpectedForABrowserAgent() {
  /* Reported as a false alarm on a real install. Anthropic documents a native
     messaging host (com.anthropic.claude_code_browser_extension.json) as how
     Claude Code reaches the extension, so it is core to the product, not an
     anomaly. Third profile in a row written from imagination rather than
     evidence -- which is why profiles now carry the evidence they rest on. */
  const CLAUDE = "fcoeoabgfenejglbffodgkkbkcdhcgfn";
  const a = assess(CLAUDE, { name: "Claude",
    permissions: ["debugger", "scripting", "notifications", "downloads", "nativeMessaging", "tabGroups", "tabs", "cookies"],
    hostPermissions: ["<all_urls>"] });
  check("talking to its desktop app is not flagged as unexpected",
    a.capabilities.unexpected.length === 0, JSON.stringify(a.capabilities.unexpected.map((c) => c.id)));
  check("the official Claude install is not put in Needs attention",
    a.verdict.needsAttention === false, a.verdict.label);
  const profile = DB.capabilityProfiles.browser_agent || {};
  check("the browser-agent profile cites where its expectations came from",
    /support.claude.com/.test(profile.reference || ""), profile.reference);
  check("the password-manager profile cites its manifest too",
    /manifest/i.test((DB.capabilityProfiles.password_manager || {}).evidence || ""));
}());

(function nonLatinNamesAreActuallyChecked() {
  /* The corroboration check split names on [^a-z0-9] and returned true when
     nothing survived -- so for every Chinese, Korean, Japanese or Russian name
     in the catalogue it silently did nothing, and a wrong ID there would have
     been recognised instead of withheld. Found by verifying the catalogue. */
  const entry = Object.entries(DB.entries).find(([, e]) => !/[a-z]/i.test(e.name));
  check("the catalogue contains a non-Latin name to test with", !!entry);
  if (!entry) return;
  const [id, record] = entry;
  const right = assess(id, { name: record.name, permissions: ["storage", "scripting"], hostPermissions: ["<all_urls>"] });
  const wrong = assess(id, { name: "Totally Unrelated Toolbar", permissions: ["storage", "scripting"], hostPermissions: ["<all_urls>"] });
  check("the real non-Latin name still matches its catalogue entry", right.reputation.status === "catalogued_listing", right.reputation.status);
  check("a different name at that id is withheld", wrong.reputation.status === "no_record", wrong.reputation.status);
}());

(function theCatalogueIsActuallyLarge() {
  const ids = Object.keys(DB.entries);
  check("the catalogue is a real database, not a sample", ids.length >= 400, ids.length + " entries");
  check("every id is a valid Chrome extension id", ids.every((id) => /^[a-p]{32}$/.test(id)));
  /* The bug this prevents: a recognised entry with no profile falls through to
     being judged as an unknown, so a powerful one lands back in the warning
     list. At 400+ entries that has to be structural, not remembered. */
  const orphans = Object.values(DB.entries).filter((e) => e.status === "recognized_identity"
    && (!e.capabilityProfile || !DB.capabilityProfiles[e.capabilityProfile]));
  check("every recognised entry has a capability profile", orphans.length === 0,
    orphans.slice(0, 3).map((e) => e.name).join(", "));
  /* Bulk entries are judged by a deliberately plain profile, so reaching
     outside the browser is still surfaced on them. */
  const cataloguedWithProfiles = Object.values(DB.entries).filter((e) => e.status === 'catalogued_listing' && e.capabilityProfile);
  check("catalogue-only entries cannot inherit a generic capability profile",
    cataloguedWithProfiles.length === 0, cataloguedWithProfiles.slice(0, 3).map((e) => e.name).join(', '));
}());

(function everyPowerfulChromeFactMustFitTheExactContract() {
  const blocking = assess(BITWARDEN, {
    permissions: ['storage', 'scripting', 'nativeMessaging', 'webRequestBlocking'],
    hostPermissions: ['<all_urls>'],
  });
  check('Bitwarden cannot hide a newly modelled blocking-web-request permission',
    blocking.verdict.code === 'unexpected_capability', blocking.verdict.code);
  check('the unexpected result names the blocking capability',
    blocking.capabilities.unexpected.some((c) => c.id === 'blocking-web-request'),
    JSON.stringify(blocking.capabilities.unexpected));

  const clipboard = assess(BITWARDEN, {
    permissions: ['storage', 'scripting', 'nativeMessaging', 'clipboardRead'],
    hostPermissions: ['<all_urls>'],
  });
  check('Bitwarden gaining clipboard-read access is not silently recognised',
    clipboard.verdict.code === 'unexpected_capability', clipboard.verdict.code);

  const CLAUDE = 'fcoeoabgfenejglbffodgkkbkcdhcgfn';
  const normalClaude = assess(CLAUDE, {
    name: 'Claude',
    permissions: ['storage', 'scripting', 'debugger', 'nativeMessaging', 'declarativeNetRequestWithHostAccess'],
    hostPermissions: ['<all_urls>'],
  });
  check('Claude declarative network control is covered by its exact contract',
    normalClaude.verdict.code === 'recognized_expected', normalClaude.verdict.code);
  const blockingClaude = assess(CLAUDE, {
    name: 'Claude',
    permissions: ['storage', 'scripting', 'debugger', 'nativeMessaging', 'webRequestBlocking'],
    hostPermissions: ['<all_urls>'],
  });
  check('Claude gaining the stronger blocking webRequest API is surfaced',
    blockingClaude.verdict.code === 'unexpected_capability', blockingClaude.verdict.code);
}());

(function installSourceAndImportsCannotBorrowOfficialTrust() {
  ['development', 'sideload', 'other'].forEach((installType) => {
    const a = assess(BITWARDEN, {
      installType,
      permissions: ['storage', 'scripting', 'nativeMessaging'],
      hostPermissions: ['<all_urls>'],
    });
    check('a ' + installType + ' copy of an official id gets a source warning',
      a.verdict.code === 'identity_source_mismatch' && a.verdict.needsAttention, a.verdict.code);
  });

  const id = 'abcdefghijklmnopabcdefghijklmnop';
  const raw = {
    schema: 1,
    datasetVersion: 'test-import',
    generatedAt: '2026-08-30',
    sources: { local: { label: 'Local test', reference: 'https://example.invalid/test', retrievedAt: '2026-08-30' } },
    entries: { [id]: {
      name: 'Imported browser agent', status: 'recognized_identity',
      reason: 'A deliberately untrusted imported identity record for the regression test.',
      categories: ['browser_agent'], capabilityProfile: 'browser_agent',
      affected: { kind: 'all_versions' }, source: 'local', reviewedAt: '2026-08-30',
    } },
  };
  const checked = engine.validateExtensionReputationDatabase(raw, { origin: 'custom' });
  const customDb = {
    available: true,
    entries: checked.database.entries,
    capabilitySignatures: DB_READY.capabilitySignatures,
    capabilityProfiles: DB_READY.capabilityProfiles,
  };
  const imported = engine.buildExtensionAssessment({
    id, type: 'extension', name: 'Imported browser agent', version: '1', enabled: true,
    mayDisable: true, installType: 'normal', permissions: ['debugger', 'nativeMessaging', 'scripting'],
    hostPermissions: ['<all_urls>'],
  }, customDb, {}, [], []);
  check('an imported category cannot select a bundled allow-profile',
    imported.capabilities.profile === null, JSON.stringify(imported.capabilities.profile));
  check('the imported browser-agent claim does not suppress powerful access',
    imported.verdict.needsAttention === true, imported.verdict.code);
}());

(function changeEventsArePurposeAwareWithoutLosingOlderWarnings() {
  const installed = [{
    id: BITWARDEN, eventId: 'install', kind: 'installed', severity: 'critical', reviewedAt: null,
    when: 20, summary: 'New extension installed', reasons: ['Powerful existing access'],
    gainedPermissions: ['scripting', 'nativeMessaging', '<all_urls>'],
  }];
  const expectedInstall = engine.buildExtensionAssessment({
    id: BITWARDEN, type: 'extension', name: 'Bitwarden', version: '1', enabled: true,
    mayDisable: true, installType: 'normal', permissions: ['storage', 'scripting', 'nativeMessaging'],
    hostPermissions: ['<all_urls>'],
  }, DB_READY, {}, installed, []);
  check('a verified expected install stays in the timeline without becoming an alarm',
    expectedInstall.verdict.code === 'expected_install_change' && !expectedInstall.verdict.needsAttention,
    expectedInstall.verdict.code);

  const id = 'bcdefghijklmnopabcdefghijklmnopa';
  const alerts = [
    { id, eventId: 'new-low', kind: 'updated', severity: 'low', reviewedAt: 30, when: 30, summary: 'Version updated' },
    { id, eventId: 'old-critical', kind: 'permissions_changed', severity: 'critical', reviewedAt: null,
      when: 10, summary: 'Debugger access added', gainedPermissions: ['debugger'] },
  ];
  const pending = engine.buildExtensionAssessment({
    id, type: 'extension', name: 'Unknown helper', version: '2', enabled: true, mayDisable: true,
    installType: 'normal', permissions: ['debugger'], hostPermissions: [],
  }, DB_READY, {}, alerts, []);
  check('a newer quiet event does not hide an older unread critical change',
    pending.pendingChange && pending.pendingChange.eventId === 'old-critical', JSON.stringify(pending.pendingChange));
  check('the older critical change still drives the verdict', pending.verdict.code === 'access_changed', pending.verdict.code);
}());

(function profilePolicyAndRecognitionLossInvalidateSavedAccessDecisions() {
  const base = assess(BITWARDEN, {
    permissions: ['storage', 'scripting', 'nativeMessaging'], hostPermissions: ['<all_urls>'],
  });
  const changedRaw = JSON.parse(JSON.stringify(DB));
  changedRaw.capabilityProfiles.password_manager.needs += ' (policy revision)';
  const changedDb = engine.validateExtensionReputationDatabase(changedRaw, { origin: 'bundled' }).database;
  const changed = engine.buildExtensionAssessment({
    id: BITWARDEN, type: 'extension', name: 'Bitwarden', version: '2', enabled: true, mayDisable: true,
    installType: 'normal', permissions: ['storage', 'scripting', 'nativeMessaging'], hostPermissions: ['<all_urls>'],
  }, changedDb, {}, [], []);
  check('changing a capability contract changes the review digest',
    base.review.snapshot.reputationRecord !== changed.review.snapshot.reputationRecord);
  check('a changed capability contract invalidates a saved access decision',
    engine.sameExtensionReviewSnapshot(base.review.snapshot, changed.review.snapshot) === false);

  const lost = Object.assign({}, base.review.snapshot, { reputationRecord: '', reputationStatus: 'no_record' });
  check('losing a recognized identity invalidates a saved access decision',
    engine.sameExtensionReviewSnapshot(base.review.snapshot, lost) === false);
  check('sanitized capability evidence reaches the assessment',
    /Anthropic documents/i.test(DB_READY.capabilityProfiles.browser_agent.evidence)
      && /support\.claude\.com/.test(DB_READY.capabilityProfiles.browser_agent.reference));
}());

(function catalogueIdentityIsNotPublisherVerification() {
  const entry = Object.entries(DB.entries).find(([, e]) => e.status === 'catalogued_listing');
  check('the expanded database contains catalogue-only listings', !!entry);
  if (!entry) return;
  const [id, record] = entry;
  const low = assess(id, { name: record.name, permissions: ['storage'], hostPermissions: [] });
  check('a quiet catalogue match is informative rather than alarming',
    low.verdict.code === 'catalogued_listing' && !low.verdict.needsAttention, low.verdict.code);
  const powerful = assess(id, { name: record.name, permissions: ['scripting'], hostPermissions: ['<all_urls>'] });
  check('a catalogue listing alone cannot excuse powerful access',
    powerful.verdict.code === 'catalogued_powerful' && powerful.verdict.needsAttention, powerful.verdict.code);
}());
// ---------------------------------------------------------------------------

if (failures.length) {
  console.error('FAIL (' + failures.length + ')');
  failures.forEach((f) => console.error('  - ' + f));
  process.exit(1);
}
console.log('extension verdicts: ' + pass + ' checks passed');

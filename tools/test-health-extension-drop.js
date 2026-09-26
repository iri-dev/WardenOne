/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The popup's "N important extension changes need review" note opens into the changes.
 *
 * It used to be a sentence and nothing else: no way to see WHICH extension, or what changed,
 * without leaving the card for the Security Centre. The worker now sends the changes with the
 * note, and the popup draws the note as a dropdown with the two things the reader can do.
 *
 * Both halves are lifted from the shipped files and run: the worker's block with real alert
 * records, and the popup's builder against a small fake DOM, down to pressing "Mark reviewed".
 *
 * Run: node tools/test-health-extension-drop.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
const HTML = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}
function between(src, from, to, what) {
  const a = src.indexOf(from);
  const b = src.indexOf(to, a + 1);
  if (a < 0 || b < 0) throw new Error(what + ' not found');
  return src.slice(a, b);
}

/* ---- the worker: the note carries the changes ------------------------------------------- */

console.log('worker');
const WORKER_BLOCK = between(BG, '  const alerts = Array.isArray(store && store[EXT_ALERTS_KEY])',
  '  const extensionWatchStatusValue', 'the extension-alert block');
const ADD_ISSUE = between(BG, '  const addIssue = (severity, text, topLevel, extra) => {', '\n\n', 'addIssue');
function summarise(alerts) {
  const issues = [];
  // eslint-disable-next-line no-new-func
  new Function('store', 'EXT_ALERTS_KEY', 'issues', ADD_ISSUE + '\n' + WORKER_BLOCK)({ k: alerts }, 'k', issues);
  return issues;
}
const now = Date.now();
const alert = (n, fields) => Object.assign({
  id: 'a'.repeat(32), name: 'Extension ' + n, kind: 'permissions', severity: 'medium', summary: 'Gained access ' + n,
  reasons: ['one', 'two', 'three', 'four'], fromVersion: '1.0', toVersion: '1.1', enabled: true, when: now - n * 1000,
  reviewedAt: null, gainedPermissions: ['tabs'],
}, fields || {});

{
  const issues = summarise([alert(1, { severity: 'high' }), alert(2, { reviewedAt: now }), alert(3, { severity: 'low' })]);
  const note = issues.find((i) => i.kind === 'extension-alerts');
  check('one unread important change gives a note that carries it', !!note && note.total === 1 && note.alerts.length === 1, JSON.stringify(issues));
  check('the sentence is unchanged', note && note.text === '1 important extension change needs review.');
  check('a high change still makes it a danger note', note && note.severity === 'danger');
  check('reviewed and low changes are not in it', note && note.alerts[0].name === 'Extension 1');
  const a = note && note.alerts[0];
  check('it carries what the card shows: name, level, what changed, versions, when',
    a && a.severity === 'high' && a.summary === 'Gained access 1' && a.fromVersion === '1.0' && a.toVersion === '1.1' && a.when === now - 1000);
  check('and up to three reasons', a && a.reasons.length === 3 && a.reasons[2] === 'three');
  check('and nothing it does not show (ids, permission lists)', a && !('id' in a) && !('gainedPermissions' in a));
}
{
  const many = [];
  for (let i = 1; i <= 8; i++) many.push(alert(i));
  const note = summarise(many).find((i) => i.kind === 'extension-alerts');
  check('eight changes: the count is all eight, the newest five travel', note && note.total === 8 && note.alerts.length === 5
    && note.text === '8 important extension changes need review.');
  check('medium-only changes make a warning, not a danger', note && note.severity === 'warn');
  const long = summarise([alert(1, { name: 'x'.repeat(500), summary: 'y'.repeat(900), reasons: ['z'.repeat(900)] })])[0];
  check('long text from an extension\'s manifest is cut short',
    long.alerts[0].name.length <= 80 && long.alerts[0].summary.length <= 160 && long.alerts[0].reasons[0].length <= 200);
}
check('no unread changes, no note', !summarise([alert(1, { reviewedAt: now })]).length);

/* ---- the popup: the note opens into them ------------------------------------------------ */

console.log('popup');
class El {
  constructor(tag) { this.tagName = tag.toUpperCase(); this.children = []; this.attrs = {}; this.listeners = {}; this.className = ''; this._text = ''; this.disabled = false; }
  appendChild(c) { this.children.push(c); return c; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  addEventListener(type, fn) { (this.listeners[type] = this.listeners[type] || []).push(fn); }
  click() { (this.listeners.click || []).forEach((fn) => fn({})); }
  fire(type) { (this.listeners[type] || []).forEach((fn) => fn({})); }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(' '); }
  all(pred, out) { out = out || []; this.children.forEach((c) => { if (pred(c)) out.push(c); c.all(pred, out); }); return out; }
}
const sent = [];
let rerendered = 0;
let reloadedList = 0;
let opened = 0;
let answer = { ok: true };
const document = { createElement: (tag) => new El(tag) };
const chrome = { runtime: { lastError: undefined, sendMessage: (msg, cb) => { sent.push(msg); cb(answer); } } };
const BUILDER = between(POPUP, 'let healthExtensionDropOpen = false;', '\nfunction renderProtectionHealth() {', 'healthExtensionDrop');
// eslint-disable-next-line no-new-func
const build = new Function('document', 'chrome', 'fmtAlertAge', 'openExtensionSecurityCentre', 'renderProtectionHealth', 'loadExtensionAlerts',
  BUILDER + '\nreturn healthExtensionDrop;')(document, chrome, () => '42m ago', () => { opened++; }, () => { rerendered++; }, () => { reloadedList++; });

const item = {
  severity: 'danger', text: '2 important extension changes need review.', kind: 'extension-alerts', total: 3,
  alerts: [
    { name: 'Tab Saver Pro', severity: 'high', summary: 'Gained access to all websites', fromVersion: '2.4.1', toVersion: '2.5.0', enabled: true, when: now, reasons: ['New permission: all websites'] },
    { name: 'Colour Picker', severity: 'medium', summary: 'Turned back on', fromVersion: '1.0', toVersion: '1.0', enabled: false, when: now, reasons: [] },
  ],
};
const first = build(item);
check('the dropdown starts closed', first.open === false);
first.open = true;
first.fire('toggle');
/* The card is redrawn whenever the activity log changes -- every few seconds on a busy page. */
const drop = build(item);
check('an opened dropdown stays open when the card is redrawn under it', drop.open === true,
  'it would snap shut while the reader was reading it');
const byClass = (cls) => drop.all((e) => (' ' + e.className + ' ').indexOf(' ' + cls + ' ') >= 0);
check('the note is a dropdown', drop.tagName === 'DETAILS' && / health-drop /.test(' ' + drop.className + ' '));
check('its summary row is the note\'s own sentence', drop.children[0].tagName === 'SUMMARY'
  && byClass('health-drop-text')[0].textContent === item.text);
check('it keeps the note\'s severity colour', / is-danger /.test(' ' + drop.className + ' '));
const cards = byClass('health-drop-card');
check('one card per change', cards.length === 2);
check('a card names the extension and says what changed', /Tab Saver Pro/.test(cards[0].textContent) && /Gained access to all websites/.test(cards[0].textContent));
check('with its level and when', /High · 42m ago/.test(cards[0].textContent));
check('a high change has the danger edge, a medium one does not', / is-danger /.test(' ' + cards[0].className + ' ') && !/ is-danger /.test(' ' + cards[1].className + ' '));
check('a version change is shown, an unchanged version is not', /2\.4\.1 → 2\.5\.0/.test(cards[0].textContent) && !/Version/.test(cards[1].textContent));
check('a disabled extension says so', /Colour Picker \(disabled\)/.test(cards[1].textContent));
check('changes beyond the ones sent are counted, not dropped', /\+ 1 more in the Security Centre/.test(drop.textContent));
const buttons = drop.all((e) => e.tagName === 'BUTTON');
const ack = buttons.find((b) => /reviewed/i.test(b.textContent));
const open = buttons.find((b) => /Security Centre/.test(b.textContent));
check('it offers "Mark all reviewed" when there is more than one', ack && ack.textContent === 'Mark all reviewed');
check('and the Security Centre', !!open);
open.click();
check('the Security Centre button opens it', opened === 1);
ack.click();
check('marking reviewed sends the same acknowledgement as the Security Centre section',
  sent.length === 1 && sent[0].kind === 'ack-extension-alerts');
check('and then re-reads the card and the extension list', rerendered === 1 && reloadedList === 1);
check('a new note after that starts closed again', build(item).open === false);
answer = { ok: false };
const failing = build(Object.assign({}, item, { total: 1, alerts: [item.alerts[0]] }));
const ack2 = failing.all((e) => e.tagName === 'BUTTON').find((b) => /reviewed/i.test(b.textContent));
check('one change says "Mark reviewed"', ack2.textContent === 'Mark reviewed');
ack2.click();
check('a failed save says so and can be pressed again, the card is not re-read',
  /Try again/.test(ack2.textContent) && ack2.disabled === false && rerendered === 1);
check('text from an extension goes in as text, never as markup', !/innerHTML/.test(BUILDER));

check('the popup draws the extension note as the dropdown',
  /item\.kind === 'extension-alerts'[\s\S]{0,120}healthExtensionDrop\(item\)/.test(POPUP));
check('the dropdown has its own styles, and hides the default marker',
  /\.health-note\.health-drop\s*\{/.test(HTML) && /\.health-drop-summary::-webkit-details-marker\s*\{\s*display:\s*none/.test(HTML));

if (failed) { console.error('\n' + failed + ' extension-note check(s) failed'); process.exit(1); }
console.log('\nall extension-note checks passed');

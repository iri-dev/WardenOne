/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * The privacy self-test.
 *
 * This page exists to answer "what can a website actually learn about me right now", and
 * its entire worth rests on one property: THE VERDICT COMES FROM THE MEASUREMENT, NEVER
 * FROM THE SETTING. A page that printed a tick because a switch was on would keep
 * printing it after a browser update quietly broke the shield underneath -- which is
 * worse than having no test, because it would be evidence pointing the wrong way.
 *
 * So most of this suite is adversarial about that one thing: settings are fed in that
 * disagree with the readings, and the verdict has to follow the readings every time.
 *
 * The rest is about the two ways a test like this cheats:
 *   - grading itself on things it never measured (untestable ones must stay untestable);
 *   - counting deliberate choices as failures, which turns a report into fearware.
 *
 * compare() and buildChecks() are lifted out of privacy-test.js and run for real.
 *
 * Run: node tools/test-privacy-test.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const PAGE_JS = fs.readFileSync(path.join(ROOT, 'privacy-test.js'), 'utf8');
const PAGE_HTML = fs.readFileSync(path.join(ROOT, 'privacy-test.html'), 'utf8');
const PROBE = fs.readFileSync(path.join(ROOT, 'privacy-probe.js'), 'utf8');
const BG = fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8');
const POPUP_JS = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why === undefined ? '' : ' -- ' + why));
}

/* The verdict logic, run for real. Sliced from the first helper to the renderer, so the
   scoring and every per-surface rule come from the shipped file. */
const start = PAGE_JS.indexOf('function same(a, b) {');
const end = PAGE_JS.indexOf('function render(rows, data) {');
const sliceable = start > 0 && end > start;
check('the verdict logic is where the slice expects it', sliceable);
if (!sliceable) { console.error('privacy test: ' + failed + ' failed'); process.exit(1); }
const sandbox = { JSON, Object, String, Number, Boolean, Array, Math, console };
vm.createContext(sandbox);
vm.runInContext(PAGE_JS.slice(start, end)
  + ';globalThis.__compare = compare;globalThis.__build = buildChecks;globalThis.__score = score;',
  sandbox, { filename: 'privacy-test.js:verdicts' });
const compare = sandbox.__compare;
const build = sandbox.__build;
const scoreOf = sandbox.__score;

/* ---- the verdict follows the reading, never the setting -------------------- */
{
  check('different readings are protected, whatever the setting says',
    compare('aaa', 'bbb', false).verdict === 'protected',
    'the switch being off cannot unmake a difference that was measured');
  check('identical readings are never protected',
    compare('aaa', 'aaa', true).verdict !== 'protected');
}
{
  /* The distinction the settings exist for, and the only thing they are allowed to do. */
  check('unchanged with the shield ON is exposed', compare('x', 'x', true).verdict === 'exposed');
  check('unchanged with the shield OFF is allowed by design',
    compare('x', 'x', false).verdict === 'design',
    'crying wolf over a choice somebody made is how a report becomes fearware');
}
{
  check('absent on both sides is not a failure',
    compare(null, null, true).verdict === 'design',
    'a browser that does not offer a surface has exposed nothing');
  check('a probe that answered in neither run is untested',
    compare(undefined, undefined, true).verdict === 'untested');
}
check('no verdict is derived from a setting alone',
  !/settings\.[a-zA-Z]+ \?\s*'protected'/.test(PAGE_JS)
  && !/verdict: 'protected'[^\n]*settings/.test(PAGE_JS),
  'reading a switch and printing a tick is the thing this page argues against');

/* ---- whole reports, built from readings that disagree with the settings ----- */
function report(shielded, bare, settings) {
  return build({ shielded: shielded || {}, bare: bare || {}, settings: settings || {} });
}
function verdictOf(rows, name) {
  const row = rows.find((r) => r.name === name);
  return row ? row.verdict : '(missing)';
}
{
  const rows = report(
    { canvas2d: 'shielded-hash', webgl: { vendor: 'X', renderer: 'Y', version: 'v' } },
    { canvas2d: 'real-hash', webgl: { vendor: 'NVIDIA', renderer: 'RTX', version: 'v' } },
    { antiFingerprintNoise: false },
  );
  check('a canvas that really was changed reads protected even with the shield reported off',
    verdictOf(rows, 'Canvas fingerprinting') === 'protected',
    'the measurement is the evidence; the setting is only a label');
  check('and so does the GPU', verdictOf(rows, 'GPU identity (WebGL)') === 'protected');
}
{
  const same = { canvas2d: 'real-hash' };
  const on = report(same, { canvas2d: 'real-hash' }, { antiFingerprintNoise: true });
  const off = report(same, { canvas2d: 'real-hash' }, { antiFingerprintNoise: false });
  check('an unchanged canvas with the shield on is exposed',
    verdictOf(on, 'Canvas fingerprinting') === 'exposed');
  check('the same reading with the shield off is not',
    verdictOf(off, 'Canvas fingerprinting') === 'design');
}

/* ---- the probes that measure what WardenOne does TO the page ---------------- */
{
  const rows = report({ linkPing: { pingSurvived: false, hrefIntact: true } }, {}, { unshimLinks: true });
  check('a stripped ping reads protected', verdictOf(rows, 'Hyperlink auditing (a ping)') === 'protected');
}
{
  const rows = report({ linkPing: { pingSurvived: true, hrefIntact: true } }, {}, { unshimLinks: true });
  check('a surviving ping with cleaning on reads exposed',
    verdictOf(rows, 'Hyperlink auditing (a ping)') === 'exposed');
}
{
  const rows = report({ linkPing: { pingSurvived: false, hrefIntact: false } }, {}, { unshimLinks: true });
  check('a link whose destination was altered is a failure, not a success',
    verdictOf(rows, 'Hyperlink auditing (a ping)') === 'exposed',
    'removing the beacon is the job; changing where the link goes is damage');
}
{
  const rows = report({ linkParams: { utmGone: true, fbclidGone: true, idKept: true, href: 'x' } },
    {}, { stripTrackingParams: true });
  check('both tracking parameters gone and the site\'s own kept reads protected',
    verdictOf(rows, 'Tracking parameters on links') === 'protected');
}
{
  const rows = report({ linkParams: { utmGone: true, fbclidGone: false, idKept: true, href: 'x' } },
    {}, { stripTrackingParams: true });
  check('one of two removed reads partly protected, not protected',
    verdictOf(rows, 'Tracking parameters on links') === 'partial');
}
{
  const rows = report({ linkParams: { utmGone: true, fbclidGone: true, idKept: false, href: 'x' } },
    {}, { stripTrackingParams: true });
  check("taking the site's OWN parameter is reported as exposed",
    verdictOf(rows, 'Tracking parameters on links') === 'exposed',
    'a cleaner that breaks the link is not a stronger cleaner');
}
{
  const rows = report({ historyParams: { utmGone: true, ownParamKept: false } }, {}, { stripTrackingParams: true });
  check('a history cleaner that eats the app\'s own parameter is a failure',
    verdictOf(rows, 'Tracking parameters added by the site (pushState)') === 'exposed');
}

/* ---- local addresses -------------------------------------------------------- */
{
  const rows = report({ webrtcLocalIps: { available: true, ips: [] } },
    { webrtcLocalIps: { available: true, ips: ['192.168.1.5'] } }, { blockWebRTCLeak: true });
  check('no addresses reaching the page while the bare run found some is protected',
    verdictOf(rows, 'Local network addresses (WebRTC)') === 'protected');
}
{
  const rows = report({ webrtcLocalIps: { available: true, ips: ['192.168.1.5'] } },
    { webrtcLocalIps: { available: true, ips: ['192.168.1.5'] } }, { blockWebRTCLeak: true });
  check('addresses reaching the page with the guard on is exposed',
    verdictOf(rows, 'Local network addresses (WebRTC)') === 'exposed');
}
{
  const rows = report({ webrtcLocalIps: { available: true, ips: ['192.168.1.5'] } },
    { webrtcLocalIps: { available: true, ips: ['192.168.1.5'] } }, { blockWebRTCLeak: false });
  check('the same reading with the guard off is a choice, not a failure',
    verdictOf(rows, 'Local network addresses (WebRTC)') === 'design');
}

/* ---- what must stay untestable ---------------------------------------------- */
{
  const rows = report({}, {}, {});
  check('the referrer a third party sees is never graded',
    verdictOf(rows, 'Referrer sent to another site') === 'untested',
    'it can only be measured by a third party, and inventing a result is the dishonesty '
    + 'this whole page exists to argue against');
  check('third-party trackers are never graded either',
    verdictOf(rows, 'Third-party trackers and cookies') === 'untested',
    'finding out whether a tracker is blocked by contacting one does the thing it checks');
}
check('the page says what it deliberately cannot measure',
  /deliberately not here/i.test(PAGE_HTML) && /no server/i.test(PAGE_HTML));

/* ---- the score is honest ----------------------------------------------------- */
{
  const rows = [
    { verdict: 'protected' }, { verdict: 'protected' }, { verdict: 'exposed' },
    { verdict: 'design' }, { verdict: 'design' }, { verdict: 'untested' }, { verdict: 'minimal' },
  ];
  const s = scoreOf(rows);
  check('only measurable checks are counted', s.total === 3, JSON.stringify(s),
    'a score dragged down by a setting somebody chose is a score telling them to undo it');
  check('and the percentage is of those', s.percent === 67, JSON.stringify(s));
}
{
  check('a report with nothing measurable scores nothing rather than 100%',
    scoreOf([{ verdict: 'design' }, { verdict: 'untested' }]) === null,
    'an empty measurement is not a perfect one');
}
{
  const s = scoreOf([{ verdict: 'partial' }, { verdict: 'protected' }]);
  check('a partial counts as half', s.percent === 75, JSON.stringify(s));
}

/* ---- the probe itself --------------------------------------------------------- */
const probeCode = PROBE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
for (const forbidden of ['fetch(', 'XMLHttpRequest', 'sendBeacon', 'importScripts', 'WebSocket']) {
  check('the probe never reaches the network with ' + forbidden, probeCode.indexOf(forbidden) < 0,
    'a privacy test that phones out has failed its own subject');
}
check('the WebRTC probe uses no STUN server', /iceServers: \[\]/.test(PROBE),
  'a STUN lookup contacts a third party to find out whether you are leaking to third parties');
check('the probe puts the address bar back',
  /finally \{[\s\S]{0,400}history\.replaceState\(history\.state, '', original\)/.test(PROBE),
  'a test that leaves its own tracking parameters in the reader\'s address bar has failed '
  + 'at the one thing it was measuring');
check('and removes the nodes it added',
  (PROBE.match(/a\.remove\(\)/g) || []).length >= 2);
check('it never reads controller model names',
  !/\.id\b/.test(probeCode.slice(probeCode.indexOf("safe('gamepads'"), probeCode.indexOf("safe('mediaCapabilities'"))),
  'copying the fingerprint into the report is not a way to warn about the fingerprint');
check('it does not raise a permission prompt for fonts',
  /called: false/.test(PROBE) && !/queryLocalFonts\(\)/.test(probeCode),
  'a test that makes the browser ask for something is a test nobody runs twice');

/* ---- it measures a real page, not this one ------------------------------------ */
check('the probe is injected into a tab, in both worlds',
  /files: \['privacy-probe\.js'\], world: world/.test(BG)
  && /runIn\('MAIN'\)/.test(BG) && /runIn\('ISOLATED'\)/.test(BG),
  'content scripts do not run on extension pages, so measuring this page would report '
  + 'every shield missing -- truthfully and uselessly');
check('the two runs are sequential, not overlapped',
  /const shielded = await runIn\('MAIN'\);\s*const bare = await runIn\('ISOLATED'\);/.test(BG),
  'both copies write into the same document and one restores the address bar');
check('it refuses a tab that is not an ordinary web page',
  /not an ordinary web page/.test(BG));
check('the handler is extension-page only',
  /kind === 'privacy-test-run'[\s\S]{0,220}messageSenderIsExtensionPage\(sender\)/.test(BG),
  'a web page able to ask for this would get a survey of the reader\'s machine');
check('the popup passes the tab it was opened from',
  /privacy-test\.html'\)\s*\+ '\?tab='/.test(POPUP_JS));
check('the page tells the reader which tab it measured',
  /Measured on /.test(PAGE_JS) && /Will measure the page in your other tab/.test(PAGE_JS));
check('an allowlisted site is explained rather than scored as broken',
  /allowlisted/.test(PAGE_JS) && /That is the allowlist working, not a fault/.test(PAGE_JS));
check('a failure offers Verify & repair',
  /Verify & repair/.test(PAGE_JS),
  'the self-test finds it from outside, Verify & repair looks inside -- they are halves '
  + 'of the same answer');
check('and only when something actually failed',
  /if \(exposed\.length\) \{/.test(PAGE_JS),
  'offering to repair a working extension is noise');

if (failed) {
  console.error('privacy test: ' + failed + ' failed');
  process.exit(1);
}
console.log('privacy test: all checks passed');

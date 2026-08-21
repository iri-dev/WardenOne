/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * How often may the same warning appear, and which warnings should not appear at all?
 *
 * Two separate problems, both reported from a real build.
 *
 * 1. The toast guard remembered only the LAST key, for 1200ms. So a page beaconing on a timer
 *    produced the same popup every 1.2 seconds for as long as it kept going, and an A,B,A sequence
 *    showed A twice. A stream of identical warnings is how someone learns to dismiss WardenOne
 *    without reading it -- which costs more than the warning ever bought.
 *
 *    The rule now: one toast per distinct thing per page. Different things each still get one.
 *    Navigating or reloading starts fresh, because a set that never cleared would go on suppressing
 *    warnings for a page the user left minutes ago.
 *
 * 2. "Possible tracker" was firing for region1.google-analytics.com -- a host the network rules
 *    already block. The detector hooks fetch/XHR in the page and sees the ATTEMPT;
 *    declarativeNetRequest kills the request itself, and the two never talk. So the popup described
 *    something that had not happened, on a page where WardenOne had already done its job silently.
 *
 * Run: node tools/test-toast-dedupe.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const SRC = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const MIN = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(name, condition, extra) {
  if (condition) { console.log('  ok  - ' + name); return; }
  failed++;
  console.error('  FAIL - ' + name + (extra ? ' :: ' + extra : ''));
}

// ---------------------------------------------------------------------------
// 1. The dedupe rule, modelled exactly as showToast applies it.
// ---------------------------------------------------------------------------
{
  function makePage() {
    const seen = new Set();
    let recentKey = '';
    let lastAt = -99999;
    let clock = 0;
    const shown = [];
    return {
      tick(ms) { clock += ms; },
      navigate() { seen.clear(); recentKey = ''; },
      toast(type, matched) {
        const key = type + '|' + (matched || '');
        if (seen.has(key)) return false;
        if (key === recentKey && clock - lastAt < 1200) return false;
        seen.add(key); recentKey = key; lastAt = clock;
        shown.push(key);
        return true;
      },
      shown,
    };
  }

  {
    const p = makePage();
    const results = [];
    for (let i = 0; i < 20; i++) { p.tick(3000); results.push(p.toast('warned_logger_api', 'google-analytics.com')); }
    check('the same warning appears once, not twenty times',
      results.filter(Boolean).length === 1, 'shown ' + results.filter(Boolean).length + ' times');
  }

  {
    const p = makePage();
    p.tick(3000); p.toast('warned_logger_api', 'analytics.example');
    p.tick(3000); p.toast('warned_logger_api', 'beacons.example');
    p.tick(3000); p.toast('warned_shortener', '');
    check('different things each get their own toast', p.shown.length === 3, p.shown.join(', '));
  }

  {
    // The A,B,A case the old single-slot guard got wrong.
    const p = makePage();
    p.tick(3000); p.toast('warned_logger_api', 'a.example');
    p.tick(3000); p.toast('warned_logger_api', 'b.example');
    p.tick(3000); const again = p.toast('warned_logger_api', 'a.example');
    check('a repeat after an interruption is still suppressed', again === false);
  }

  {
    const p = makePage();
    p.tick(3000); p.toast('warned_logger_api', 'analytics.example');
    p.navigate();
    p.tick(3000); const after = p.toast('warned_logger_api', 'analytics.example');
    check('navigating or reloading starts fresh', after === true,
      'the user would never see this warning again on any page');
  }
}

// ---------------------------------------------------------------------------
// 2. Warnings for destinations the network rules already block.
// ---------------------------------------------------------------------------
{
  const decl = /ALREADY_BLOCKED_TRACKERS=(\/[\s\S]*?\/i),/.exec(SRC);
  check('the already-blocked list exists', !!decl);
  if (decl) {
    // eslint-disable-next-line no-eval
    const RE = (0, eval)(decl[1]);
    const suppressed = (host) => RE.test(host + '.');

    for (const host of [
      'region1.google-analytics.com', 'www.google-analytics.com', 'analytics.google.com',
      'www.googletagmanager.com', 'stats.g.doubleclick.net', 'heapanalytics.com',
      'in.hotjar.com', 'cdn.mouseflow.com', 'www.clarity.ms', 'bat.bing.com',
      'ingest.sentry.io', 'mc.yandex.ru',
    ]) {
      check('no warning for an already-blocked tracker: ' + host, suppressed(host) === true);
    }

    // The other half: a genuinely unknown logging endpoint must STILL warn, or the fix would have
    // quietly turned the feature off.
    for (const host of [
      'telemetry.some-startup.example', 'logs.internal-tool.example',
      'collect.unknown-vendor.io', 'beacon.tiny-analytics-co.net',
      // These four sat in the suppression list until it was checked against the shipped rules, and
      // none of them is actually blocked. Silencing a warning for something nothing stops is worse
      // than the noise it replaces, so they stay noisy.
      'piwik.pro', 'rest.iad-01.braze.com', 'onesignal.com', 'logs-01.loggly.com',
    ]) {
      check('still warns about an unrecognised endpoint: ' + host, suppressed(host) === false,
        'the tracker warning has been switched off wholesale');
    }
  }
}

// ---------------------------------------------------------------------------
// 3. The shipped build carries both, not just the source.
// ---------------------------------------------------------------------------
{
  check('the dedupe set is in the shipped build', /toastSeen=new Set\(\)/.test(MIN));
  check('the dedupe is actually consulted', /toastSeen\.has\(key\)/.test(MIN));
  check('navigation clears it in the shipped build', /resetToastMemory/.test(MIN));
  check('the suppression is in the shipped build', /ALREADY_BLOCKED_TRACKERS/.test(MIN));
  check('suppression respects the tracker-blocking toggle',
    /!1!==WO\.blockTrackers&&ALREADY_BLOCKED_TRACKERS/.test(MIN),
    'with tracker blocking off the warning is the only thing the user would get');
}

if (failed) { console.error('\n' + failed + ' toast-dedupe check(s) failed'); process.exit(1); }
console.log('\nwarnings appear once per thing per page, and not at all for trackers already blocked');

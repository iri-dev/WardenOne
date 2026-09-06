/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Turning two sets of readings into sentences.
 *
 * THE MEASUREMENT IS NEVER THE SETTING. Every verdict below is decided from what the two
 * probe runs actually returned. The settings arrive alongside them and are used for one
 * thing only: telling "you switched this off" apart from "this should have worked and did
 * not". Those are the same number and completely different news, and a page that could
 * not tell them apart would either cry wolf about deliberate choices or quietly excuse a
 * broken shield.
 *
 * Five verdicts, because "failed" is the wrong word for most of what a browser exposes:
 *   protected  the page got a different answer than the browser would have given
 *   minimal    readable, but there is nothing identifying in it
 *   partial    changed, but not everything that could have been
 *   design     available on purpose, or switched off on purpose -- counts for nothing
 *   exposed    the shield is on, and the page got the real value anyway
 *   untested   cannot be answered from inside a page without a server, and is not guessed
 */
'use strict';

const params = new URLSearchParams(location.search);
const TAB_ID = Number(params.get('tab'));

let LAST = null;
let ADVANCED = false;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined) n.textContent = text;
  return n;
}

const MARK = {
  protected: '✅', minimal: '🟢', partial: '🟡',
  design: 'ℹ️', exposed: '🔴', untested: '—',
};
const WORD = {
  protected: 'Protected', minimal: 'Minimal exposure', partial: 'Partly protected',
  design: 'Allowed by design', exposed: 'Exposed', untested: 'Not testable here',
};
const CLASS = {
  protected: 'v-protected', minimal: 'v-minimal', partial: 'v-partial',
  design: 'v-design', exposed: 'v-exposed', untested: 'v-untested',
};

function same(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == null && b == null;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  try { return JSON.stringify(a) === JSON.stringify(b); } catch (_) { return false; }
}

/* The one decision every fingerprint check shares. `on` says whether the shield that
   would have changed this reading is switched on -- it never decides whether the values
   differ, only what an unchanged value MEANS. */
function compare(shielded, bare, on, opts) {
  const o = opts || {};
  if (shielded === undefined && bare === undefined) return { verdict: 'untested', why: o.missing || 'The browser did not answer this probe in either run.' };
  if (bare == null && shielded == null) return { verdict: 'design', why: o.absent || 'This browser does not offer this surface at all, so there is nothing to read.' };
  if (!same(shielded, bare)) {
    return { verdict: 'protected', why: o.differs || 'The page received a different answer than the browser would have given it.' };
  }
  if (!on) {
    return { verdict: 'design', why: (o.off || 'The shield for this is switched off, so the page received the real value. That is what off means, not a failure.') };
  }
  return { verdict: 'exposed', why: o.exposed || 'The shield for this is on, and the page still received the real value.' };
}

function buildChecks(data) {
  const s = (data && data.shielded) || {};
  const b = (data && data.bare) || {};
  const set = (data && data.settings) || {};
  const fp = set.antiFingerprintNoise;
  const rows = [];

  const add = (name, result, detail) => rows.push({
    name: name,
    verdict: result.verdict,
    why: result.why,
    detail: detail || null,
  });

  /* ---- the shields that rewrite an answer -------------------------------- */
  add('Canvas fingerprinting', compare(s.canvas2d, b.canvas2d, fp, {
    differs: 'The image this page read back is not the one the browser drew, so a canvas fingerprint taken here will not match the real one.',
  }), { 'reading with WardenOne': s.canvas2d, 'reading without': b.canvas2d });

  add('Canvas pixel readback', compare(s.canvasImageData, b.canvasImageData, fp), {
    'with WardenOne': s.canvasImageData, 'without': b.canvasImageData,
  });

  add('Audio fingerprinting', compare(s.audio, b.audio, fp), {
    'with WardenOne': s.audio, 'without': b.audio,
  });

  add('GPU identity (WebGL)', compare(s.webgl, b.webgl, fp, {
    differs: 'The page was given a different graphics vendor and renderer than the machine actually has.',
    exposed: 'The page read your real graphics vendor and renderer.',
  }), {
    'with WardenOne': s.webgl && (s.webgl.vendor + ' / ' + s.webgl.renderer),
    'without': b.webgl && (b.webgl.vendor + ' / ' + b.webgl.renderer),
  });

  add('GPU identity (WebGPU)', compare(s.webgpu, b.webgpu, fp, {
    absent: 'This browser did not give either run a WebGPU adapter, so there was nothing to read.',
  }), {
    'with WardenOne': s.webgpu && JSON.stringify(s.webgpu),
    'without': b.webgpu && JSON.stringify(b.webgpu),
  });

  add('Machine details', compare(s.hardware, b.hardware, fp, {
    differs: 'The core count, memory and platform the page read are not this machine’s.',
  }), { 'with WardenOne': JSON.stringify(s.hardware), 'without': JSON.stringify(b.hardware) });

  add('Screen and monitors', compare(s.screenInfo, b.screenInfo, fp, {
    differs: 'The screen geometry the page read is not this display’s.',
  }), { 'with WardenOne': JSON.stringify(s.screenInfo), 'without': JSON.stringify(b.screenInfo) });

  add('Detailed platform (UA client hints)', compare(s.uaHighEntropy, b.uaHighEntropy, fp, {
    absent: 'This browser does not offer high-entropy client hints to either run.',
  }), { 'with WardenOne': JSON.stringify(s.uaHighEntropy), 'without': JSON.stringify(b.uaHighEntropy) });

  add('Text-to-speech voices', compare(s.voices, b.voices, fp, {
    differs: 'The voice list a page can read has been changed, so it no longer names your operating system and its language packs.',
  }), { 'with WardenOne': JSON.stringify(s.voices), 'without': JSON.stringify(b.voices) });

  add('Keyboard layout', compare(s.keyboardLayout, b.keyboardLayout, fp), {
    'with WardenOne': JSON.stringify(s.keyboardLayout), 'without': JSON.stringify(b.keyboardLayout),
  });

  add('Media codec capabilities', compare(s.mediaCapabilities, b.mediaCapabilities, fp, {
    differs: 'The smoothness and power-efficiency answers were flattened. Whether the codec is supported is passed through untouched, because faking that is what stops video playing.',
  }), { 'with WardenOne': JSON.stringify(s.mediaCapabilities), 'without': JSON.stringify(b.mediaCapabilities) });

  /* ---- surfaces where being readable at all is the finding ---------------- */
  const localIps = ((s.webrtcLocalIps && s.webrtcLocalIps.ips) || []);
  const bareIps = ((b.webrtcLocalIps && b.webrtcLocalIps.ips) || []);
  add('Local network addresses (WebRTC)', (function () {
    if (!s.webrtcLocalIps || s.webrtcLocalIps.available === false) {
      return { verdict: 'protected', why: 'WebRTC was not reachable from the page at all, so it could not ask for your local addresses.' };
    }
    if (!localIps.length && bareIps.length) {
      return { verdict: 'protected', why: 'The page was given no local addresses, while the same probe without WardenOne found ' + bareIps.length + '.' };
    }
    if (!localIps.length) return { verdict: 'minimal', why: 'No local address reached the page. Nothing without WardenOne either, so this browser was not offering them here.' };
    if (!set.blockWebRTCLeak) return { verdict: 'design', why: 'The page read ' + localIps.length + ' local address(es). WebRTC leak protection is switched off.' };
    return { verdict: 'exposed', why: 'The page read ' + localIps.length + ' local address(es) with WebRTC leak protection on.' };
  })(), { 'addresses the page saw': localIps.length, 'without WardenOne': bareIps.length });

  add('Battery level', (function () {
    if (!b.battery || b.battery.available === false) return { verdict: 'design', why: 'This browser does not expose the battery API to a page.' };
    if (!same(s.battery, b.battery)) return { verdict: 'protected', why: 'The battery reading the page received is not this machine’s.' };
    return { verdict: 'minimal', why: 'The page can read the battery level. On its own that is weak and short-lived, but it joins up with everything else on this list.' };
  })(), { 'with WardenOne': JSON.stringify(s.battery), 'without': JSON.stringify(b.battery) });

  add('Connection type', (function () {
    if (!b.network || b.network.available === false) return { verdict: 'design', why: 'This browser does not expose network information to a page.' };
    if (!same(s.network, b.network)) return { verdict: 'protected', why: 'The connection details the page received are not this machine’s.' };
    return { verdict: 'minimal', why: 'The page can read a rough connection type. Low on its own.' };
  })(), { 'with WardenOne': JSON.stringify(s.network), 'without': JSON.stringify(b.network) });

  add('Installed fonts', (function () {
    const avail = s.fonts && s.fonts.available;
    if (!avail) return { verdict: 'protected', why: 'The local font API was not reachable from the page, so it cannot enumerate what is installed.' };
    return { verdict: 'design', why: 'The local font API exists here, but it cannot be used without a permission prompt. This test does not raise one — a test that makes the browser ask for something is a test nobody runs twice.' };
  })(), { 'queryLocalFonts reachable': String(!!(s.fonts && s.fonts.available)) });

  add('Game controllers', (function () {
    const n = (s.gamepads && s.gamepads.connected) || 0;
    if (!navigatorHadGamepads(b)) return { verdict: 'design', why: 'This browser does not offer the gamepad API to a page.' };
    if (!n) return { verdict: 'minimal', why: 'No controller was readable. Chrome answers nothing here until a button has been pressed.' };
    return { verdict: 'minimal', why: n + ' controller(s) readable. Using one is not a problem; the model string is a small amount of extra entropy, and WardenOne records that it was read rather than blocking it.' };
  })(), { 'controllers readable': String((s.gamepads && s.gamepads.connected) || 0) });

  /* ---- things WardenOne does TO the page ---------------------------------- */
  add('Hyperlink auditing (a ping)', (function () {
    if (!s.linkPing) return { verdict: 'untested', why: 'The probe link could not be created on this page.' };
    if (!s.linkPing.hrefIntact) return { verdict: 'exposed', why: 'The probe link’s destination was altered, which it never should be.' };
    if (!s.linkPing.pingSurvived) return { verdict: 'protected', why: 'The ping attribute was removed and the destination left alone, so a click here notifies nobody.' };
    if (!set.unshimLinks && !set.stripTrackingParams) return { verdict: 'design', why: 'Link cleaning is switched off, so the ping attribute was left in place.' };
    return { verdict: 'exposed', why: 'The ping attribute survived on a page where link cleaning is on.' };
  })(), { 'ping attribute survived': String(!!(s.linkPing && s.linkPing.pingSurvived)) });

  add('Tracking parameters on links', (function () {
    const r = s.linkParams;
    if (!r) return { verdict: 'untested', why: 'The probe link could not be created on this page.' };
    if (!r.idKept) return { verdict: 'exposed', why: 'The site’s own parameter was removed along with the tracking ones. That is a broken link, not stronger protection.' };
    if (r.utmGone && r.fbclidGone) return { verdict: 'protected', why: 'utm_source and fbclid were removed and the link’s own parameter was left alone.' };
    if (r.utmGone || r.fbclidGone) return { verdict: 'partial', why: 'Some tracking parameters were removed and some survived.' };
    if (!set.stripTrackingParams) return { verdict: 'design', why: 'Parameter stripping is switched off.' };
    return { verdict: 'exposed', why: 'Both tracking parameters survived on a page where stripping is on.' };
  })(), { 'link after cleaning': s.linkParams && s.linkParams.href });

  add('Tracking parameters added by the site (pushState)', (function () {
    const r = s.historyParams;
    if (!r) return { verdict: 'untested', why: 'This page did not allow a history probe.' };
    if (!r.ownParamKept) return { verdict: 'exposed', why: 'The page’s own parameter was removed, which would break a single-page app.' };
    if (r.utmGone) return { verdict: 'protected', why: 'A tracking parameter written straight into the address bar was removed, and the page’s own parameter was kept.' };
    if (!set.stripTrackingParams) return { verdict: 'design', why: 'Parameter stripping is switched off.' };
    return { verdict: 'exposed', why: 'A tracking parameter written into the address bar survived.' };
  })(), { 'utm removed': String(!!(s.historyParams && s.historyParams.utmGone)) });

  /* ---- honestly out of reach ---------------------------------------------- */
  add('Referrer sent to another site', { verdict: 'untested',
    why: 'What a third party receives can only be measured by a third party. WardenOne has no server to ask, and reporting a result from what this page can see would be describing something else entirely.' },
  { 'referrer visible to this page': String(!!(s.page && s.page.referrerPresent)) });

  add('Third-party trackers and cookies', { verdict: 'untested',
    why: 'Answering this means making a real request to a real tracker. A privacy test that quietly contacts a tracking company to find out whether it is blocked has done the thing it was checking for, so this page does not.' }, null);

  return rows;
}

function navigatorHadGamepads(bare) {
  return !!(bare && bare.gamepads);
}

/* Only checks with a right answer are counted. Anything allowed on purpose, switched off
   on purpose, or not answerable from inside a page counts for neither side -- a score
   dragged down by a setting somebody chose is a score that tells them to change it. */
function score(rows) {
  const counted = rows.filter((r) => r.verdict === 'protected' || r.verdict === 'exposed' || r.verdict === 'partial');
  if (!counted.length) return null;
  const good = counted.filter((r) => r.verdict === 'protected').length;
  const half = counted.filter((r) => r.verdict === 'partial').length * 0.5;
  return { good: good, half: half, total: counted.length,
    percent: Math.round(((good + half) / counted.length) * 100) };
}

function render(rows, data) {
  const list = document.getElementById('results');
  list.textContent = '';
  for (const row of rows) {
    const wrap = el('div', 'pt-row ' + (CLASS[row.verdict] || ''));
    const head = el('button', 'pt-head');
    head.type = 'button';
    head.setAttribute('aria-expanded', 'false');
    head.appendChild(el('span', 'pt-mark', MARK[row.verdict] || ''));
    head.appendChild(el('span', 'pt-name', row.name));
    head.appendChild(el('span', 'pt-verdict', WORD[row.verdict] || row.verdict));
    const body = el('div', 'pt-body');
    body.hidden = true;
    body.appendChild(el('p', null, row.why));
    if (row.detail) {
      const dl = el('dl', 'pt-values');
      for (const key of Object.keys(row.detail)) {
        const value = row.detail[key];
        if (value === undefined || value === null || value === '') continue;
        dl.appendChild(el('dt', null, key));
        dl.appendChild(el('dd', null, String(value).slice(0, 300)));
      }
      if (dl.childNodes.length) body.appendChild(dl);
    }
    head.addEventListener('click', () => {
      body.hidden = !body.hidden;
      head.setAttribute('aria-expanded', String(!body.hidden));
    });
    if (ADVANCED) { body.hidden = false; head.setAttribute('aria-expanded', 'true'); }
    wrap.appendChild(head);
    wrap.appendChild(body);
    list.appendChild(wrap);
  }

  const s = score(rows);
  document.getElementById('score').textContent = s ? s.percent + '%' : '—';
  const exposed = rows.filter((r) => r.verdict === 'exposed');
  document.getElementById('score-note').textContent = s
    ? (s.good + (s.half ? ' and a half' : '') + ' of ' + s.total + ' measurable checks came back protected'
      + (exposed.length ? ' — ' + exposed.length + ' came back exposed.' : '.'))
    : 'Nothing measurable came back.';

  /* Verify & Repair is the other half of this: the self-test finds a problem from the
     outside, Verify & Repair looks inside and tries to fix it. Offered only when
     something actually failed -- an offer to repair a working extension is noise. */
  const offer = document.getElementById('repair-offer');
  offer.textContent = '';
  if (exposed.length) {
    const box = el('div', 'pt-fail');
    box.appendChild(el('h3', null, exposed.length + ' shield reported on, but the page got the real value'));
    box.appendChild(el('p', 'pt-note', 'That is the combination worth looking into: the setting says one thing and the measurement says another. Verify & Repair checks WardenOne from the inside and re-injects anything missing on this tab; run it, reload the page, then run this test again.'));
    const btn = el('button', 'guide-btn primary', 'Open WardenOne to run Verify & repair');
    btn.type = 'button';
    btn.addEventListener('click', () => { chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }); });
    box.appendChild(btn);
    offer.appendChild(box);
  }
  if (data && data.settings && data.settings.allowlisted) {
    const box = el('div', 'pt-fail');
    box.appendChild(el('h3', null, 'This site is on your allowlist'));
    box.appendChild(el('p', 'pt-note', 'WardenOne is deliberately standing down here, so most of the readings above are the browser’s real ones. That is the allowlist working, not a fault — test a site you have not allowlisted to see the shields.'));
    offer.appendChild(box);
  }
}

function run() {
  const button = document.getElementById('run');
  button.disabled = true;
  button.textContent = 'Measuring…';
  const list = document.getElementById('results');
  list.textContent = '';
  list.appendChild(el('div', 'pt-empty', 'Running both probes on the page…'));
  chrome.runtime.sendMessage({ kind: 'privacy-test-run', tabId: TAB_ID }, (res) => {
    try { void chrome.runtime.lastError; } catch (_) {}
    button.disabled = false;
    button.textContent = 'Run the test again';
    if (chrome.runtime.lastError || !res || !res.ok) {
      list.textContent = '';
      list.appendChild(el('div', 'pt-empty',
        (res && res.error) || 'The test could not run. Open this page from the WardenOne popup while an ordinary web page is open.'));
      return;
    }
    LAST = res;
    document.getElementById('target').textContent = '';
    document.getElementById('target').appendChild(document.createTextNode('Measured on '));
    document.getElementById('target').appendChild(el('strong', null, res.host || res.url));
    render(buildChecks(res), res);
  });
}

document.getElementById('run').addEventListener('click', run);
document.getElementById('toggle-advanced').addEventListener('click', () => {
  ADVANCED = !ADVANCED;
  const b = document.getElementById('toggle-advanced');
  b.setAttribute('aria-pressed', String(ADVANCED));
  b.textContent = ADVANCED ? 'Hide the raw readings' : 'Show the raw readings';
  if (LAST) render(buildChecks(LAST), LAST);
});

(function start() {
  const target = document.getElementById('target');
  if (!Number.isFinite(TAB_ID) || TAB_ID < 0) {
    target.textContent = 'Open this page from the WardenOne popup so it knows which tab to measure.';
    return;
  }
  chrome.tabs.get(TAB_ID, (tab) => {
    try { void chrome.runtime.lastError; } catch (_) {}
    if (chrome.runtime.lastError || !tab) { target.textContent = 'That tab is gone. Open this page again from the popup.'; return; }
    target.textContent = '';
    target.appendChild(document.createTextNode('Will measure the page in your other tab: '));
    let host = '';
    try { host = new URL(tab.url).hostname; } catch (_) { host = String(tab.url || ''); }
    target.appendChild(el('strong', null, host));
  });
})();

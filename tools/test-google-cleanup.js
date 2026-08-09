/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Node harness for the "Hide Google AI & sponsored results" feature
 * (googleSearchResultCleanup). Slices the const-chain between
 * "const GOOGLE_CLEANUP_SELECTORS=" and "const startGoogleCleanup=" out of the
 * SHIPPED content.min.js, runs it in a vm sandbox against a minimal fake DOM,
 * emulates the injected stylesheet (the browser applies it BEFORE the sweep),
 * and asserts the structural invariants that broke in v36/v39/v40/v41/v42:
 *   - the top AI Overview module (incl. its "Show more" button + shell) is gone
 *   - nothing inside .related-question-pair is ever hidden
 *   - nothing containing organic results (#rso/#search/#res/#center_col or
 *     >=5 .MjjYud) is ever hidden or collapsed, at any viewport width
 * Run: node tools/test-google-cleanup.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const MIN = fs.readFileSync(path.join(__dirname, '..', 'content.min.js'), 'utf8');
const START = MIN.indexOf('const GOOGLE_CLEANUP_SELECTORS=');
const END = MIN.indexOf('const startGoogleCleanup=');
if (START < 0 || END < 0 || END <= START) {
  console.error('FATAL: google cleanup markers not found in content.min.js');
  process.exit(1);
}
const SLICE = MIN.slice(START, END) +
  ';globalThis.__t={googleCleanupSweep,googleModuleFor,inPaa,containsResults,collapseShell,googleHide,installGoogleCleanupCss,searchRememberSponsoredLinks,searchIsSponsoredUrl,searchSponsoredDestinations,GOOGLE_CLEANUP_SELECTORS,GOOGLE_AI_TARGET_SEL,BRAVE_AI_SELECTORS,BRAVE_SPONSORED_SELECTORS,SEARCH_AI_ON,SEARCH_ADS_ON};';

/* ------------------------------------------------------------------ *
 * Minimal fake DOM.
 * Extracted code uses only: children, parentElement, tagName, id,
 * className, get/setAttribute, closest, matches, querySelector(All),
 * textContent, getBoundingClientRect, style.setProperty;
 * document.{getElementById,createElement,head.appendChild,
 * documentElement,body,querySelectorAll}; globals innerWidth/innerHeight/log.
 * Selector subset: comma lists of compound [tag][#id][.class]*[[attr(='v')]]
 * (no combinators/spaces ever appear on the JS path).
 * ------------------------------------------------------------------ */

const compoundCache = Object.create(null);
function parseCompound(c) {
  if (compoundCache[c]) return compoundCache[c];
  const m = /^([a-zA-Z][a-zA-Z0-9-]*)?((?:#[-\w]+|\.[-\w]+|\[[^\]]+\])*)$/.exec(c.trim());
  if (!m || (!m[1] && !m[2])) throw new Error('harness: unsupported selector "' + c + '"');
  const parts = { tag: m[1] ? m[1].toUpperCase() : null, id: null, classes: [], attrs: [] };
  const re = /#([-\w]+)|\.([-\w]+)|\[([^\]=]+?)(?:=(?:'([^']*)'|"([^"]*)"))?\]/g;
  let t;
  while ((t = re.exec(m[2] || ''))) {
    if (t[1]) parts.id = t[1];
    else if (t[2]) parts.classes.push(t[2]);
    else parts.attrs.push({ name: t[3], value: t[4] != null ? t[4] : (t[5] != null ? t[5] : null) });
  }
  compoundCache[c] = parts;
  return parts;
}

class E {
  constructor(tag, props) {
    props = props || {};
    this.tagName = String(tag).toUpperCase();
    this.id = props.id || '';
    this.className = props.className || '';
    this.attrs = Object.assign({}, props.attrs || {});
    this._text = props.text || '';
    this._rect = props.rect || { width: 300, height: 40 }; // leaf default
    this._style = {};
    this.parentElement = null;
    this.children = [];
    const self = this;
    this.style = { setProperty(n, v) { self._style[n] = String(v); } };
  }
  append() { for (const c of arguments) { c.parentElement = this; this.children.push(c); } return this; }
  get textContent() {
    let t = this._text;
    for (const c of this.children) t += ' ' + c.textContent;
    return t;
  }
  getAttribute(n) {
    if (n === 'id') return this.id || null;
    if (n === 'class') return this.className || null;
    return this.attrs[n] != null ? this.attrs[n] : null;
  }
  setAttribute(n, v) {
    if (n === 'id') this.id = String(v);
    else if (n === 'class') this.className = String(v);
    else this.attrs[n] = String(v);
  }
  _matchesCompound(p) {
    if (p.tag && this.tagName !== p.tag) return false;
    if (p.id && this.id !== p.id) return false;
    if (p.classes.length) {
      const cls = String(this.className).split(/\s+/);
      for (const c of p.classes) if (cls.indexOf(c) < 0) return false;
    }
    for (const a of p.attrs) {
      const v = this.getAttribute(a.name);
      if (v == null) return false;
      if (a.value != null && v !== a.value) return false;
    }
    return true;
  }
  matches(sel) {
    return String(sel).split(',').some((c) => this._matchesCompound(parseCompound(c)));
  }
  closest(sel) {
    for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n;
    return null;
  }
  querySelector(sel) {
    for (const c of this.children) {
      if (c.matches(sel)) return c;
      const d = c.querySelector(sel);
      if (d) return d;
    }
    return null;
  }
  querySelectorAll(sel) {
    const out = [];
    (function walk(node) {
      for (const c of node.children) {
        if (c.matches(sel)) out.push(c);
        walk(c);
      }
    })(this);
    return out;
  }
  // {0,0} if this node OR ANY ANCESTOR is display:none, or has height 0
  // with overflow hidden (i.e. collapsed by collapseShell); else declared rect.
  getBoundingClientRect() {
    for (let n = this; n; n = n.parentElement) {
      const st = n._style;
      if (st.display === 'none') return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
      if ((st.height === '0' || st.height === '0px') && st.overflow === 'hidden')
        return { width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 };
    }
    const r = this._rect;
    return { width: r.width, height: r.height, top: 0, left: 0, right: r.width, bottom: r.height };
  }
}

function makeDocument(html, body) {
  const styles = [];
  return {
    documentElement: html,
    body: body,
    head: { appendChild(n) { styles.push(n); } },
    createElement(tag) { return { tagName: String(tag).toUpperCase(), id: '', textContent: '' }; },
    getElementById(id) {
      for (const n of subtree(html)) if (n.id === id) return n;
      for (const s of styles) if (s.id === id) return s;
      return null;
    },
    querySelector(sel) { return html.matches(sel) ? html : html.querySelector(sel); },
    querySelectorAll(sel) {
      const out = html.matches(sel) ? [html] : [];
      return out.concat(html.querySelectorAll(sel));
    },
  };
}

function subtree(el) { // pre-order, includes el
  const out = [el];
  for (const c of el.children) out.push.apply(out, subtree(c));
  return out;
}

/* ------------------------------------------------------------------ *
 * CSS emulation: the injected stylesheet applies BEFORE the sweep runs.
 * (a) every GOOGLE_CLEANUP_SELECTORS match is hidden;
 * (b) #m-x-content/.uEierd/[data-google-query-id] hidden UNLESS the element
 *     contains #rso/#search/#res/#center_col (the :not(:has()) guard);
 * (c) matches inside .related-question-pair are UN-hidden (skip them).
 * ------------------------------------------------------------------ */
function applyCssEmulation(doc, t) {
  const selectors = [];
  if (t.SEARCH_ADS_ON) selectors.push.apply(selectors, t.GOOGLE_CLEANUP_SELECTORS || []);
  if (t.SEARCH_AI_ON) selectors.push('#m-x-content');
  if (selectors.length) {
    const sel = selectors.join(',');
    for (const n of subtree(doc.documentElement)) {
      if (!n.matches(sel)) continue;
      if (n.closest('.related-question-pair')) continue; // rule (c)
      if (n.querySelector('#rso,#search,#res,#center_col')) continue; // rule (b) guard
      n.style.setProperty('display', 'none', 'important');
    }
  }
  if (t.SEARCH_AI_ON) {
    for (const n of subtree(doc.documentElement)) {
      const shellish = /\bMjjYud\b/.test(String(n.className || '')) ||
        n.getAttribute('data-hveid') != null ||
        n.getAttribute('jscontroller') != null ||
        n.getAttribute('jsname') != null ||
        /^(G-SECTION-WITH-HEADER|SECTION|ASIDE)$/i.test(n.tagName || '');
      if (!shellish) continue;
      if (!n.querySelector('#m-x-content')) continue;
      if (n.querySelector('#rso,#search,#res,#center_col,.related-question-pair')) continue;
      n.style.setProperty('display', 'none', 'important');
    }
  }
}

function makeContext(doc, w, h, opts) {
  opts = opts || {};
  const host = opts.host || 'www.google.com';
  const path = opts.path || '/search';
  const wo = Object.assign({
    blockSearchAiAnswers: opts.ai !== false,
    blockSponsoredSearchResults: opts.ads !== false,
    googleSearchResultCleanup: false,
  }, opts.WO || {});
  const ctx = vm.createContext({
    document: doc,
    innerWidth: w == null ? 1830 : w,
    innerHeight: h == null ? 900 : h,
    location: { hostname: host, pathname: path, origin: 'https://' + host, href: 'https://' + host + path + '?q=test' },
    URL: URL,
    WO: wo,
    isGoogleSearchResults: function () { return /(^|\.)google\.[a-z.]+$/i.test(host) && /^\/(search|webhp)?$/i.test(path || '/'); },
    isBraveSearchResults: function () { return host === 'search.brave.com' && path === '/search'; },
    log: function () {},
  });
  vm.runInContext(SLICE, ctx);
  return ctx.__t;
}

/* ------------------------------------------------------------------ *
 * Scenario building blocks
 * ------------------------------------------------------------------ */
function organicResults() {
  const out = [];
  for (let i = 1; i <= 6; i++) {
    out.push(new E('div', { className: 'MjjYud', rect: { width: 652, height: 120 } })
      .append(new E('h3', { text: 'Organic result number ' + i, rect: { width: 300, height: 24 } })));
  }
  return out;
}

// html > body > #search > #rso; returns handles
function scaffold(rsoChildren, opts) {
  opts = opts || {};
  const html = new E('html', { rect: { width: 1830, height: 3000 } });
  const body = new E('body', { rect: { width: 1830, height: 3000 } });
  html.append(body);
  const search = new E('div', { id: 'search', rect: opts.searchRect || { width: 1200, height: 2600 } });
  const rso = new E('div', { id: 'rso', rect: opts.rsoRect || { width: 652, height: 2400 } });
  search.append(rso);
  if (opts.outer) { opts.outer.append(search); body.append(opts.outer); }
  else body.append(search);
  rso.append.apply(rso, rsoChildren);
  return { html, body, search, rso, doc: makeDocument(html, body) };
}

// Top AI Overview module (S1/S5/S6 content)
function aiOverviewModule(withShell) {
  const headingDiv = new E('div', { attrs: { role: 'heading' }, text: 'AI Overview', rect: { width: 120, height: 24 } });
  const paras = [1, 2, 3].map((i) => new E('div', {
    text: 'Generated answer paragraph ' + i + ' with a fairly long run of explanatory prose about the query so the module has body text.',
    rect: { width: 652, height: 150 },
  }));
  const contentDiv = new E('div', { id: 'm-x-content', rect: { width: 652, height: 600 } });
  contentDiv.append.apply(contentDiv, [headingDiv].concat(paras));
  const showMore = new E('div', { attrs: { role: 'button' }, text: 'Show more', rect: { width: 400, height: 48 } });
  const aiWrap = new E('div', { className: 'MjjYud', attrs: { 'data-hveid': 'x' }, rect: { width: 652, height: 700 } });
  let shellDiv = null;
  if (withShell) {
    // static declared rect conveniently simulates a min-height shell
    shellDiv = new E('div', { rect: { width: 652, height: 700 } }).append(contentDiv, showMore);
    aiWrap.append(shellDiv);
  } else {
    aiWrap.append(contentDiv, showMore);
  }
  return { aiWrap, shellDiv, contentDiv, headingDiv, showMore };
}

/* ------------------------------------------------------------------ *
 * Assertion helpers
 * ------------------------------------------------------------------ */
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  ok  - ' + name); }
  else { fail++; console.log('  FAIL - ' + name + (extra !== undefined ? ' :: ' + JSON.stringify(extra) : '')); }
}

function gone(el) { const r = el.getBoundingClientRect(); return r.width === 0 && r.height === 0; }
function visible(el) { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; }
function hiddenOrCollapsed(el) {
  return el._style.display === 'none' || el._style.height === '0' || el._style.height === '0px' ||
    el.attrs['data-wo-google-search-collapsed'] != null;
}
function describe(el) {
  return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') +
    (el.className ? '.' + String(el.className).split(/\s+/).join('.') : '');
}

// Global invariant: nothing that IS or CONTAINS the results column
// (#rso/#search/#res/#center_col or >=5 .MjjYud) is ever hidden/collapsed.
function invariantViolations(doc) {
  const errs = [];
  for (const n of subtree(doc.documentElement)) {
    const isColumn = /^(rso|search|res|center_col)$/i.test(n.id || '');
    const holdsResults = !!n.querySelector('#rso,#search,#res,#center_col') ||
      n.querySelectorAll('.MjjYud').length >= 5;
    if ((isColumn || holdsResults) && hiddenOrCollapsed(n)) errs.push(describe(n));
  }
  return errs;
}

function paaViolations(doc) {
  const errs = [];
  for (const pairEl of doc.documentElement.querySelectorAll('.related-question-pair')) {
    for (const n of subtree(pairEl)) {
      if (n._style.display === 'none' || n.attrs['data-wo-google-search-cleaned'] != null ||
        n.attrs['data-wo-google-search-collapsed'] != null || n._style.height === '0')
        errs.push(describe(n));
    }
  }
  return errs;
}

function runFeature(doc, t, w, h) {
  applyCssEmulation(doc, t);
  t.googleCleanupSweep(doc);
  applyCssEmulation(doc, t); // stylesheet keeps applying
  t.googleCleanupSweep(doc); // observer re-run must be idempotent-safe
}

/* ================================================================== *
 * S0 -- pre-paint CSS hides the top AI module before JS sweep/collapse.
 * ================================================================== */
{
  const ai = aiOverviewModule(false);
  const organics = organicResults();
  const s = scaffold([ai.aiWrap].concat(organics));
  const t = makeContext(s.doc);
  applyCssEmulation(s.doc, t);

  check('S0 instant CSS hides top AI wrapper before JS sweep', gone(ai.aiWrap), ai.aiWrap._style);
  check('S0 instant CSS keeps organic results visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S0 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S1 — top AI Overview module fully removed, organics intact
 * ================================================================== */
{
  const ai = aiOverviewModule(false);
  const organics = organicResults();
  const s = scaffold([ai.aiWrap].concat(organics));
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  check('S1 "Show more" button is gone (self-or-ancestor hidden)', gone(ai.showMore), ai.showMore._style);
  check('S1 AI module content (#m-x-content) is gone', gone(ai.contentDiv), ai.contentDiv._style);
  check('S1 aiWrap is display:none or collapsed to height 0',
    ai.aiWrap._style.display === 'none' || ai.aiWrap._style.height === '0', ai.aiWrap._style);
  check('S1 no visible leftover inside aiWrap', subtree(ai.aiWrap).every((n) => n === ai.aiWrap || gone(n)));
  check('S1 all 6 organic results still visible', organics.every(visible),
    organics.map((o) => o.getBoundingClientRect().height));
  check('S1 #rso and #search not hidden/collapsed',
    !hiddenOrCollapsed(s.rso) && !hiddenOrCollapsed(s.search), { rso: s.rso._style, search: s.search._style });
  const inv = invariantViolations(s.doc);
  check('S1 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S2 — People-also-ask stays fully interactive (v36 regression)
 * ================================================================== */
{
  const organics = organicResults();
  const pairs = [];
  for (let i = 1; i <= 4; i++) {
    const pair = new E('div', { className: 'related-question-pair', rect: { width: 628, height: 60 } })
      .append(new E('div', { text: 'Question number ' + i + '?', rect: { width: 600, height: 20 } }));
    pairs.push(pair);
  }
  // one expanded pair carries an AI answer block (#m-x-content + "AI Overview" heading)
  const paaAnswerHeading = new E('div', { attrs: { role: 'heading' }, text: 'AI Overview', rect: { width: 120, height: 24 } });
  const paaAnswer = new E('div', { id: 'm-x-content', rect: { width: 628, height: 300 } })
    .append(paaAnswerHeading,
      new E('div', { text: 'The answer to the expanded question, written out at length.', rect: { width: 628, height: 200 } }));
  pairs[0].append(paaAnswer);
  const paaSection = new E('div', { rect: { width: 652, height: 500 } })
    .append(new E('div', { attrs: { role: 'heading' }, text: 'People also ask', rect: { width: 200, height: 24 } }));
  paaSection.append.apply(paaSection, pairs);

  const s = scaffold(organics.concat([paaSection]));
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  const paaErrs = paaViolations(s.doc);
  check('S2 nothing inside any .related-question-pair hidden/collapsed', paaErrs.length === 0, paaErrs);
  check('S2 expanded PAA answer (#m-x-content) still visible', visible(paaAnswer), paaAnswer._style);
  check('S2 PAA section itself not hidden/collapsed', !hiddenOrCollapsed(paaSection), paaSection._style);
  check('S2 all 6 organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S2 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S3 — sponsored blocks removed (#tads via CSS, label-module via sweep)
 * ================================================================== */
{
  const adBlock = new E('div', { id: 'tads', rect: { width: 652, height: 300 } })
    .append(new E('h3', { text: 'Buy widgets today', rect: { width: 300, height: 24 } }),
      new E('h3', { text: 'Cheap widgets outlet', rect: { width: 300, height: 24 } }));
  const labelDiv = new E('div', { attrs: { 'aria-label': 'Sponsored' }, text: 'Sponsored', rect: { width: 80, height: 16 } });
  const sponsoredModule = new E('div', { attrs: { 'data-hveid': 'y' }, rect: { width: 652, height: 200 } })
    .append(labelDiv,
      new E('div', { text: 'Great deal site with a very good offer', rect: { width: 300, height: 40 } }),
      new E('div', { text: 'Another storefront link description', rect: { width: 300, height: 40 } }));
  const organics = organicResults();
  const s = scaffold([adBlock, sponsoredModule].concat(organics));
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  check('S3 #tads ad block hidden', gone(adBlock), adBlock._style);
  check('S3 sponsored module hidden by label sweep', gone(sponsoredModule), sponsoredModule._style);
  check('S3 all 6 organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S3 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S4 — hidden template label must NOT trigger anything (v43 safety:
 * invisible labels only count when hidden BY US)
 * ================================================================== */
{
  const organics = organicResults();
  const s = scaffold(organics);
  const template = new E('div', { text: 'AI Overview', rect: { width: 0, height: 0 } });
  s.body.append(template);
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  const touched = subtree(s.html).filter((n) =>
    n._style.display === 'none' || n.attrs['data-wo-google-search-cleaned'] != null ||
    n.attrs['data-wo-google-search-collapsed'] != null);
  check('S4 hidden template label hides nothing at all', touched.length === 0, touched.map(describe));
  check('S4 all 6 organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S4 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S5 — narrow viewport (v40 regression: whole column vanished ~1047px)
 * ================================================================== */
{
  const ai = aiOverviewModule(false);
  const organics = organicResults();
  const outer = new E('div', { rect: { width: 1000, height: 2200 } });
  const s = scaffold([ai.aiWrap].concat(organics), {
    outer: outer,
    searchRect: { width: 1000, height: 2100 },
    rsoRect: { width: 1000, height: 2000 },
  });
  const t = makeContext(s.doc, 1047, 800);
  runFeature(s.doc, t, 1047, 800);

  check('S5 narrow: AI module gone', gone(ai.contentDiv) && gone(ai.showMore) &&
    (ai.aiWrap._style.display === 'none' || ai.aiWrap._style.height === '0'), ai.aiWrap._style);
  check('S5 narrow: all 6 organic results still visible', organics.every(visible));
  check('S5 narrow: outer wrapper div not hidden/collapsed', !hiddenOrCollapsed(outer), outer._style);
  check('S5 narrow: #search not hidden/collapsed', !hiddenOrCollapsed(s.search), s.search._style);
  check('S5 narrow: #rso not hidden/collapsed', !hiddenOrCollapsed(s.rso), s.rso._style);
  const inv = invariantViolations(s.doc);
  check('S5 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S6 — min-height shell around the AI module collapses (v42/v43:
 * blank space-holding shell + orphan "Show more")
 * ================================================================== */
{
  const ai = aiOverviewModule(true); // extra shellDiv wrapper with static rect
  const organics = organicResults();
  const s = scaffold([ai.aiWrap].concat(organics));
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  check('S6 shellDiv collapsed (display:none or height 0 + collapsed attr)',
    gone(ai.shellDiv) ||
    ai.shellDiv._style.display === 'none' ||
    (ai.shellDiv._style.height === '0' && ai.shellDiv.attrs['data-wo-google-search-collapsed'] === '1'),
    ai.shellDiv._style);
  check('S6 "Show more" button is gone', gone(ai.showMore), ai.showMore._style);
  check('S6 no visible leftover inside aiWrap', subtree(ai.aiWrap).every((n) => n === ai.aiWrap || gone(n)));
  check('S6 all 6 organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S6 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S7 -- Google can render the AI body first, then add shell chrome later.
 * Already-hidden AI content must still trigger another shell collapse.
 * ================================================================== */
{
  const headingDiv = new E('div', { attrs: { role: 'heading' }, text: 'AI Overview', rect: { width: 120, height: 24 } });
  const contentDiv = new E('div', { id: 'm-x-content', rect: { width: 652, height: 540 } })
    .append(headingDiv,
      new E('div', { text: 'Generated answer body that arrives before the button.', rect: { width: 652, height: 240 } }));
  const spacer = new E('div', { rect: { width: 652, height: 340 } });
  const shellDiv = new E('div', { rect: { width: 652, height: 720 } }).append(contentDiv, spacer);
  const aiWrap = new E('div', { className: 'MjjYud', attrs: { 'data-hveid': 'late' }, rect: { width: 652, height: 760 } })
    .append(shellDiv);
  const organics = organicResults();
  const s = scaffold([aiWrap].concat(organics));
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  const lateShowMore = new E('div', { attrs: { role: 'button' }, text: 'Show more', rect: { width: 400, height: 48 } });
  shellDiv.append(lateShowMore);
  runFeature(s.doc, t);

  check('S7 late "Show more" button is gone after an already-hidden AI body is swept again',
    gone(lateShowMore), lateShowMore._style);
  check('S7 spacer shell collapsed, not left as blank page space',
    gone(shellDiv) || shellDiv.attrs['data-wo-google-search-collapsed'] === '1', shellDiv._style);
  check('S7 all 6 organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S7 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S8 -- If Google groups an AI card next to a real organic result, the
 * organic result must stop ancestor collapse.
 * ================================================================== */
{
  const headingDiv = new E('div', { attrs: { role: 'heading' }, text: 'AI Overview', rect: { width: 120, height: 24 } });
  const contentDiv = new E('div', { id: 'm-x-content', rect: { width: 652, height: 500 } })
    .append(headingDiv,
      new E('div', { text: 'Generated answer body inside a grouped container.', rect: { width: 652, height: 240 } }));
  const showMore = new E('div', { attrs: { role: 'button' }, text: 'Show more', rect: { width: 400, height: 48 } });
  const aiShell = new E('div', { rect: { width: 652, height: 620 } }).append(contentDiv, showMore);
  const groupedOrganic = new E('div', { className: 'MjjYud', rect: { width: 652, height: 130 } })
    .append(new E('h3', { text: 'Grouped organic result', rect: { width: 300, height: 24 } }));
  const group = new E('div', { rect: { width: 652, height: 820 } }).append(aiShell, groupedOrganic);
  const organics = organicResults();
  const s = scaffold([group].concat(organics));
  const t = makeContext(s.doc);
  runFeature(s.doc, t);

  check('S8 AI shell hidden inside grouped container', gone(showMore) && hiddenOrCollapsed(aiShell), aiShell._style);
  check('S8 grouped organic result remains visible', visible(groupedOrganic), groupedOrganic._style);
  check('S8 group remains visible because it contains a real result', visible(group), group._style);
  check('S8 all 6 other organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S8 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S9 -- split mode: AI-only blocks AI, leaves sponsored results alone.
 * ================================================================== */
{
  const ai = aiOverviewModule(false);
  const sponsored = new E('div', { attrs: { 'data-hveid': 'sponsor' }, rect: { width: 652, height: 180 } })
    .append(new E('div', { attrs: { 'aria-label': 'Sponsored' }, text: 'Sponsored', rect: { width: 80, height: 16 } }),
      new E('h3', { text: 'Sponsored result should remain visible in AI-only mode', rect: { width: 460, height: 24 } }));
  const organics = organicResults();
  const s = scaffold([ai.aiWrap, sponsored].concat(organics));
  const t = makeContext(s.doc, null, null, { ai: true, ads: false });
  runFeature(s.doc, t);

  check('S9 AI-only: AI module hidden', gone(ai.contentDiv) && gone(ai.showMore), ai.aiWrap._style);
  check('S9 AI-only: sponsored module remains visible', visible(sponsored), sponsored._style);
  check('S9 AI-only: organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S9 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S10 -- split mode: sponsored-only blocks ads, leaves AI answer alone.
 * ================================================================== */
{
  const ai = aiOverviewModule(false);
  const sponsored = new E('div', { attrs: { 'data-google-query-id': 'adquery' }, rect: { width: 652, height: 180 } })
    .append(new E('div', { attrs: { 'aria-label': 'Sponsored' }, text: 'Sponsored', rect: { width: 80, height: 16 } }),
      new E('h3', { text: 'Sponsored result should be hidden in sponsored-only mode', rect: { width: 460, height: 24 } }));
  const organics = organicResults();
  const s = scaffold([ai.aiWrap, sponsored].concat(organics));
  const t = makeContext(s.doc, null, null, { ai: false, ads: true });
  runFeature(s.doc, t);

  check('S10 sponsored-only: AI module remains visible', visible(ai.contentDiv) && visible(ai.showMore), ai.aiWrap._style);
  check('S10 sponsored-only: sponsored module hidden', gone(sponsored), sponsored._style);
  check('S10 sponsored-only: organic results still visible', organics.every(visible));
  const inv = invariantViolations(s.doc);
  check('S10 invariant: results containers untouched', inv.length === 0, inv);
}

/* ================================================================== *
 * S11 -- Brave Search: AI answer and sponsored result can be removed.
 * ================================================================== */
{
  const braveAi = new E('section', { attrs: { 'data-testid': 'llm-answer' }, text: 'Answer with AI Brave generated answer', rect: { width: 720, height: 360 } });
  const braveAd = new E('div', { attrs: { 'data-testid': 'ad-result' }, text: 'Sponsored Brave result', rect: { width: 720, height: 120 } });
  const organics = [
    new E('article', { className: 'result', rect: { width: 720, height: 110 } })
      .append(new E('h3', { text: 'Brave organic result one', rect: { width: 320, height: 24 } })),
    new E('article', { className: 'result', rect: { width: 720, height: 110 } })
      .append(new E('h3', { text: 'Brave organic result two', rect: { width: 320, height: 24 } })),
  ];
  const s = scaffold([braveAi, braveAd].concat(organics));
  const t = makeContext(s.doc, null, null, { host: 'search.brave.com', path: '/search', ai: true, ads: true });
  runFeature(s.doc, t);

  check('S11 Brave: AI answer hidden', gone(braveAi), braveAi._style);
  check('S11 Brave: sponsored result hidden', gone(braveAd), braveAd._style);
  check('S11 Brave: organic results remain visible', organics.every(visible));
}

/* ================================================================== *
 * S12 -- sponsored-site blocking: hidden ad modules record advertiser
 * destinations and ad-click wrappers are classified as sponsored.
 * ================================================================== */
{
  const adLink = new E('a', { attrs: { href: 'https://sponsor.example/landing?utm_source=google' }, text: 'Sponsored destination', rect: { width: 420, height: 24 } });
  const adWrapper = new E('a', { attrs: { href: '/aclk?sa=L&adurl=https%3A%2F%2Fwrapped-sponsor.example%2Fdeal' }, text: 'Wrapped sponsored destination', rect: { width: 420, height: 24 } });
  const sponsored = new E('div', { attrs: { 'data-google-query-id': 'adquery' }, rect: { width: 652, height: 210 } })
    .append(new E('div', { attrs: { 'aria-label': 'Sponsored' }, text: 'Sponsored', rect: { width: 80, height: 16 } }),
      adLink,
      adWrapper);
  const organicLink = new E('a', { attrs: { href: 'https://organic.example/article' }, text: 'Organic destination', rect: { width: 420, height: 24 } });
  const organic = new E('div', { className: 'MjjYud', rect: { width: 652, height: 130 } })
    .append(new E('h3', { text: 'Organic result', rect: { width: 300, height: 24 } }), organicLink);
  const s = scaffold([sponsored, organic].concat(organicResults()));
  const t = makeContext(s.doc, null, null, { ai: false, ads: true });
  runFeature(s.doc, t);

  check('S12 sponsored module hidden', gone(sponsored), sponsored._style);
  check('S12 direct advertiser destination is blocked', t.searchIsSponsoredUrl('https://sponsor.example/landing'));
  check('S12 Google ad-click wrapper is blocked', t.searchIsSponsoredUrl('/aclk?sa=L&adurl=https%3A%2F%2Fwrapped-sponsor.example%2Fdeal'));
  check('S12 unlisted organic destination is not blocked', !t.searchIsSponsoredUrl('https://organic.example/article'));
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

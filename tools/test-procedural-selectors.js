/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/* The procedural cosmetic evaluator: where the base selector ends, and that operators run as a
   pipeline rather than as a conjunction over the element that matched first.
   Run: node tools/test-procedural-selectors.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { h, makeDocument } = require('./lib/mini-dom.js');

const ROOT = path.resolve(__dirname, '..');
/* The newline-free runtime is what the browser loads, and the gate already proves it equals
   src/content.js byte for byte. Slicing it avoids the generated line breaks inside regexes. */
const RUNTIME = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');

let failed = 0;
function check(what, ok, why) {
  if (ok) return;
  failed++;
  console.error('[fail] ' + what + (why ? ' -- ' + why : ''));
}

const start = RUNTIME.indexOf('PROC_OP_RE=/^:(');
const end = RUNTIME.indexOf('requestAndApply=()=>{', start);
check('the evaluator block is where the slice expects it', start > 0 && end > start);
if (start < 0 || end < start) process.exit(1);
const BLOCK = 'const ' + RUNTIME.slice(start, end) + '__end=0;';

/* Only "..", "../.." and so on appear as a chained XPath in the public lists; resolving just those
   is enough to prove the node travels into the expression as the context rather than the rule
   being thrown away. */
function makeEvaluate(document) {
  return (expr, context) => {
    const steps = String(expr).split('/').filter(Boolean);
    let node = context;
    for (const step of steps) {
      if (step !== '..' || !node) return { snapshotLength: 0, snapshotItem: () => null };
      node = node.parentElement;
    }
    const hits = node && node.nodeType === 1 ? [node] : [];
    return { snapshotLength: hits.length, snapshotItem: (i) => hits[i] || null };
  };
}

function makeEngine(opts) {
  const o = opts || {};
  const document = o.document || makeDocument('https://example.test/', []);
  const styles = o.styles || new Map();
  const sandbox = {
    String, Number, Boolean, Array, Object, Set, Map, WeakSet, RegExp, Math, URL, Error,
    isFinite, parseInt, console,
    document,
    location: o.location || { pathname: '/', search: '', href: 'https://example.test/' },
    matchMedia: o.matchMedia || (() => ({ matches: false })),
    XPathResult: { ORDERED_NODE_SNAPSHOT_TYPE: 7 },
    getComputedStyle: (el, pseudo) => ({
      getPropertyValue: (prop) => {
        const key = (pseudo || '') + '|' + prop;
        if (styles.has(key)) return styles.get(key);
        return (el && el.style && el.style[prop]) || '';
      },
    }),
    PROC_BUDGET: 400,
    procRules: [],
    scriptletPlayerPage: () => false,
  };
  document.evaluate = makeEvaluate(document);
  /* mini-dom elements carry no CSSStyleDeclaration, so give the actions somewhere to land. */
  const withStyle = (el) => {
    if (!el.style) {
      el.style = { setProperty(prop, value, prio) { this[prop] = value; this.__prio = prio; } };
    }
    for (const child of el.children) withStyle(child);
  };
  withStyle(document.documentElement);
  vm.createContext(sandbox);
  vm.runInContext(BLOCK + 'this.__api={compileProcedural,procSelect,runProcedural,procPatternTest,procSplitTop,procScoped,procUnquote,setRules(r){procRules=r}};',
    sandbox, { filename: 'content.min.js:procedural' });
  return { api: sandbox.__api, document, styles, sandbox };
}

// ---------------------------------------------------------------------------
// Where the base selector ends.
// ---------------------------------------------------------------------------
{
  const { api } = makeEngine();
  const parse = (sel) => api.compileProcedural(sel);

  const simple = parse('div:has-text(ad)');
  check('a trailing operator leaves the native part as the base', simple && simple.base === 'div',
    simple ? 'base was ' + JSON.stringify(simple.base) : 'did not parse');
  check('the operator and its argument survive parsing',
    simple && simple.ops.length === 1 && simple.ops[0].op === 'has-text' && simple.ops[0].arg === 'ad');

  /* The old parser cut the base at the first ":<op>(" anywhere in the string, so a ":not(" nested
     inside ":is()" truncated the selector and the rule matched the wrong elements. */
  const nested = parse(':is(a,:not(b)) .c:has-text(d)');
  check('an operator name nested inside :is() does not end the base',
    nested && nested.base === ':is(a,:not(b)) .c',
    nested ? 'base was ' + JSON.stringify(nested.base) : 'did not parse');

  const nth = parse('div:nth-child(2):has-text(x)');
  check('a native functional pseudo-class stays in the base',
    nth && nth.base === 'div:nth-child(2)', nth ? 'base was ' + JSON.stringify(nth.base) : 'did not parse');

  const bracket = parse('[data-x=":has("]:has-text(y)');
  check('an operator name inside an attribute value does not end the base',
    bracket && bracket.base === '[data-x=":has("]',
    bracket ? 'base was ' + JSON.stringify(bracket.base) : 'did not parse');

  const relative = parse('.a:has(> .b)');
  check('a relative :has() argument is kept whole',
    relative && relative.base === '.a' && relative.ops[0].arg === '> .b');

  const chain = parse('.a:upward(2):has(.b)');
  check('operator order is preserved',
    chain && chain.ops.map((o) => o.op).join(',') === 'upward,has');

  const leading = parse(':xpath(//div)');
  check('a leading :xpath() is marked as document scoped',
    leading && leading.leading === true && leading.base === '*');

  const notProcedural = parse('.a:not(:has-text(b))');
  check(':not() wrapping an operator is itself an operator',
    notProcedural && notProcedural.base === '.a' && notProcedural.ops[0].op === 'not'
    && notProcedural.ops[0].arg === ':has-text(b)');

  check('a plain selector is not procedural', parse('.ad > .banner') === null);
  check('an unterminated operator is rejected', parse('.a:has-text(') === null);
}

// ---------------------------------------------------------------------------
// ":has()" with a relative argument -- the shape that dominates the public lists.
// ---------------------------------------------------------------------------
{
  const direct = h('div', { id: 'direct' }, [h('span', { class: 'ad' })]);
  const nestedDeeper = h('div', { id: 'deep' }, [h('section', {}, [h('span', { class: 'ad' })])]);
  const { api, document } = makeEngine({ document: makeDocument('https://example.test/', [direct, nestedDeeper]) });

  const hits = api.procSelect(api.compileProcedural('div:has(> .ad)'), null).map((el) => el.id);
  check('a relative :has() argument matches a direct child', hits.includes('direct'),
    'matched ' + JSON.stringify(hits));
  check('a relative :has() argument does not match a grandchild', !hits.includes('deep'),
    'matched ' + JSON.stringify(hits));
  check('the document still has both nodes', document.querySelectorAll('div').length === 2);

  const descendant = api.procSelect(api.compileProcedural('div:has(.ad)'), null).map((el) => el.id);
  check('a non-relative :has() argument still matches any descendant',
    descendant.length === 2, 'matched ' + JSON.stringify(descendant));
}

// ---------------------------------------------------------------------------
// Operators are a pipeline.
// ---------------------------------------------------------------------------
{
  const inner = h('span', { class: 'target' }, ['sponsored']);
  const middle = h('div', { class: 'row' }, [inner]);
  const outer = h('div', { id: 'wrap', class: 'wrap' }, [middle, h('i', { class: 'keep' })]);
  const lonely = h('div', { class: 'wrap' }, [h('div', { class: 'row' }, [h('span', { class: 'target' }, ['sponsored'])])]);
  const { api } = makeEngine({ document: makeDocument('https://example.test/', [outer, lonely]) });

  const parent = api.procSelect(api.compileProcedural('.target:upward(1)'), null);
  check(':upward(1) resolves to the parent, never the element itself',
    parent.length === 2 && parent.every((el) => el.className.includes('row')),
    parent.map((el) => el.outerTag).join(' '));

  /* ":upward(2):has(.keep)" asks for ".keep" inside the ancestor. Evaluating the operators as a
     conjunction over the original node instead tests ".keep" inside the span and matches nothing. */
  const piped = api.procSelect(api.compileProcedural('.target:upward(2):has(.keep)'), null);
  check('a filter after :upward() applies to the ancestor',
    piped.length === 1 && piped[0].id === 'wrap', piped.map((el) => el.outerTag).join(' '));

  const tooFar = api.procSelect(api.compileProcedural('.target:upward(9)'), null);
  check(':upward() past the root drops the candidate instead of clamping',
    tooFar.length === 0, tooFar.map((el) => el.outerTag).join(' '));

  const bySelector = api.procSelect(api.compileProcedural('.wrap:upward(.wrap)'), null);
  check(':upward(selector) never resolves to the element itself',
    bySelector.length === 0, bySelector.map((el) => el.outerTag).join(' '));

  const relativeXpath = api.procSelect(api.compileProcedural('.target:xpath(../..)'), null);
  check('a chained :xpath() is evaluated with the candidate as its context',
    relativeXpath.length === 2 && relativeXpath.some((el) => el.id === 'wrap'),
    relativeXpath.map((el) => el.outerTag).join(' '));
}

// ---------------------------------------------------------------------------
// Text, attribute, path and style matching.
// ---------------------------------------------------------------------------
{
  const shout = h('p', { id: 'shout' }, ['ADVERTISEMENT']);
  const quiet = h('p', { id: 'quiet' }, ['news']);
  const long = h('p', { id: 'long' }, ['a sponsored message of some length']);
  const tagged = h('a', { id: 'tagged', 'data-slot': 'ad', onclick: 'trackEvent()' }, ['x']);
  const { api } = makeEngine({ document: makeDocument('https://example.test/', [shout, quiet, long, tagged]) });

  const re = api.procSelect(api.compileProcedural('p:has-text(/^advertisement$/i)'), null);
  check('a /regex/ text argument is honoured with its flags',
    re.length === 1 && re[0].id === 'shout', re.map((el) => el.id).join(' '));

  const negated = api.procSelect(api.compileProcedural('p:not(:has-text(ADVERTISEMENT))'), null);
  check(':not() around an operator excludes the matching nodes',
    negated.length === 2 && !negated.some((el) => el.id === 'shout'), negated.map((el) => el.id).join(' '));

  const byLength = api.procSelect(api.compileProcedural('p:min-text-length(20)'), null);
  check(':min-text-length() measures the trimmed text',
    byLength.length === 1 && byLength[0].id === 'long', byLength.map((el) => el.id).join(' '));

  const wildcard = api.procSelect(api.compileProcedural('a:matches-attr("data-*"="ad")'), null);
  check('a quoted wildcard attribute name is anchored and matched',
    wildcard.length === 1 && wildcard[0].id === 'tagged', wildcard.map((el) => el.id).join(' '));

  const byRegex = api.procSelect(api.compileProcedural('a:matches-attr(/^on/=/Event/)'), null);
  check('a /regex/ on both sides of :matches-attr() is honoured',
    byRegex.length === 1 && byRegex[0].id === 'tagged', byRegex.map((el) => el.id).join(' '));

  const missing = api.procSelect(api.compileProcedural('a:matches-attr("data-*"="banner")'), null);
  check('a wildcard attribute name with the wrong value does not match', missing.length === 0);

  check('an unanchored wildcard does not match a longer name',
    api.procPatternTest('"data-*"', 'x-data-slot') === false);
  check('a quoted /regex/ is recognised after unquoting',
    api.procPatternTest('"/^R-A-/"', 'R-A-1') === true);
}

// ---------------------------------------------------------------------------
// ":matches-path()" including the "~" negation the lists use.
// ---------------------------------------------------------------------------
{
  const node = h('div', { id: 'only' });
  const onShop = makeEngine({
    document: makeDocument('https://example.test/shop', [node]),
    location: { pathname: '/shop', search: '', href: 'https://example.test/shop' },
  });
  check(':matches-path() matches a path substring',
    onShop.api.procSelect(onShop.api.compileProcedural('div:matches-path(/shop)'), null).length === 1);
  check(':matches-path(~) excludes the paths it names',
    onShop.api.procSelect(onShop.api.compileProcedural('div:matches-path(~/shop)'), null).length === 0);

  const elsewhere = makeEngine({
    document: makeDocument('https://example.test/news', [h('div', { id: 'only' })]),
    location: { pathname: '/news', search: '', href: 'https://example.test/news' },
  });
  check(':matches-path(~) keeps the other paths',
    elsewhere.api.procSelect(elsewhere.api.compileProcedural('div:matches-path(~/shop)'), null).length === 1);
}

// ---------------------------------------------------------------------------
// ":matches-css()" in both the legacy and the current spelling.
// ---------------------------------------------------------------------------
{
  const node = h('div', { id: 'labelled' });
  const styles = new Map([['::before|content', 'REKLAMA'], ['|background-image', 'url(https://cdn.test/ad.png)']]);
  const { api } = makeEngine({ document: makeDocument('https://example.test/', [node]), styles });

  check(':matches-css(before, prop: value) reads the pseudo-element',
    api.procSelect(api.compileProcedural('div:matches-css(before, content: REKLAMA)'), null).length === 1);
  check(':matches-css-before(prop: value) is the same test',
    api.procSelect(api.compileProcedural('div:matches-css-before(content: REKLAMA)'), null).length === 1);
  check(':matches-css() reads the element itself without a pseudo-element',
    api.procSelect(api.compileProcedural('div:matches-css(background-image: /cdn\\.test/)'), null).length === 1);
  check(':matches-css() does not match a value it was not given',
    api.procSelect(api.compileProcedural('div:matches-css(before, content: Advertisement)'), null).length === 0);

  /* The lists carry base64 data URLs whose "regex" holds both commas and unescaped slashes. Only an
     exact leading "before," or "after," may be read as a pseudo-element, or the pattern is cut. */
  const dataUrl = h('div', { id: 'baited' });
  const dataStyles = new Map([['|background-image', 'url(data:image/png;base64,iVBORw0KGgo=)']]);
  const baited = makeEngine({ document: makeDocument('https://example.test/', [dataUrl]), styles: dataStyles });
  check(':matches-css() keeps a pattern that contains a comma and a slash',
    baited.api.procSelect(baited.api.compileProcedural(
      'div:matches-css(background-image: /^url\\(data:image/png;base64,iVBOR/)'), null).length === 1);
}

// ---------------------------------------------------------------------------
// Actions, ":others()" and the action budget.
// ---------------------------------------------------------------------------
{
  const doomed = h('div', { class: 'ad' }, ['buy']);
  const kept = h('div', { class: 'ad' }, ['news']);
  const { api, document } = makeEngine({ document: makeDocument('https://example.test/', [doomed, kept]) });

  api.setRules([api.compileProcedural('.ad:has-text(buy):remove()')]);
  api.runProcedural();
  check(':remove() detaches only the matching node',
    document.querySelectorAll('.ad').length === 1 && document.querySelectorAll('.ad')[0] === kept);

  const styled = h('div', { id: 'styled', class: 'promo' });
  const engine = makeEngine({ document: makeDocument('https://example.test/', [styled]) });
  engine.api.setRules([engine.api.compileProcedural('.promo:style(visibility: hidden !important)')]);
  engine.api.runProcedural();
  check(':style() applies the declaration it was given', styled.style.visibility === 'hidden');
  check(':style() keeps the !important priority', styled.style.__prio === 'important');

  const first = h('li', { id: 'a', class: 'row' }, ['sponsored']);
  const second = h('li', { id: 'b', class: 'row' }, ['news']);
  const third = h('li', { id: 'c', class: 'row' }, ['news']);
  const others = makeEngine({ document: makeDocument('https://example.test/', [first, second, third]) });
  const rest = others.api.procSelect(others.api.compileProcedural('.row:has-text(sponsored):others()'), null);
  check(':others() returns the base matches the pipeline excluded',
    rest.length === 2 && !rest.some((el) => el.id === 'a'), rest.map((el) => el.id).join(' '));

  const hidden = h('div', { id: 'hide', class: 'ad' });
  const def = makeEngine({ document: makeDocument('https://example.test/', [hidden]) });
  def.api.setRules([def.api.compileProcedural('.ad:has-text()')]);
  def.api.runProcedural();
  check('a rule with no action op falls back to hiding', hidden.style.display === 'none');
}

// ---------------------------------------------------------------------------
// Argument splitting keeps regular expressions intact.
// ---------------------------------------------------------------------------
{
  const { api } = makeEngine();
  check('a quoted comma does not split the argument',
    api.procSplitTop('"a,b"=c', '=')[0] === '"a,b"');
  check('the first top-level "=" splits a :matches-attr() argument',
    api.procSplitTop('href="/__cft__\\[0\\]=[-\\w]{290,}/', '=')[0] === 'href');
  check('a relative argument is scoped', api.procScoped('> .ad') === ':scope > .ad');
  check('an absolute argument is left alone', api.procScoped('.ad') === '.ad');
  check('a quoted argument is unquoted once', api.procUnquote('"data-*"') === 'data-*');
}

if (failed) {
  console.error('[fail] ' + failed + ' procedural selector check(s) failed');
  process.exit(1);
}
console.log('[ok] procedural cosmetic evaluator: base boundary, relative :has(), pipeline order, matchers and actions');

/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Runs the shipped content.min.js clean-link helpers and asserts that copied
 * URLs are cleaned aggressively without stripping useful destination params.
 *
 * Run: node tools/test-clean-copy.js
 */
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
/* This suite lifts a region of the engine and runs it in a hand-built sandbox, so it has to be
 * given the helpers the engine declares in its teardown preamble -- a lifted fragment cannot see
 * them otherwise. Only those helpers are supplied, not the whole preamble, so a fragment that
 * reaches for anything else it should not see still fails. */
const { installEngineAmbient } = require('./lib/engine-ambient.js');

const MIN = fs.readFileSync('content.min.js', 'utf8');
const START = MIN.indexOf('const TRACKING_PARAMS=');
const END = MIN.indexOf(',REAL=', START);
if (START < 0 || END < START) {
  console.error('FATAL: clean-copy helper markers not found in content.min.js');
  process.exit(2);
}
const HOOK_START = MIN.indexOf('try{let cleanCopyLogCount=0;');
const HOOK_END = MIN.indexOf('let lastGestureAt=0', HOOK_START);
if (HOOK_START < 0 || HOOK_END < HOOK_START) {
  console.error('FATAL: clean-copy hook markers not found in content.min.js');
  process.exit(2);
}

const code = MIN.slice(START, END) + ';globalThis.__cleanCopyTest={cleanCopyUrl,cleanCopyText};';
const sandbox = {
  URL,
  location: { href: 'https://current.example/page' },
};
vm.createContext(sandbox);
  installEngineAmbient(sandbox);
vm.runInContext(code, sandbox, { filename: 'clean-copy-slice.js' });

const { cleanCopyUrl, cleanCopyText } = sandbox.__cleanCopyTest;

function installCopyHook(opts = {}) {
  const listeners = Object.create(null);
  const writes = [];
  const logs = [];
  const runtime = {
    URL,
    location: { href: 'https://current.example/page' },
    WO: { cleanCopyLinks: opts.enabled !== false },
    log(type, detail) {
      logs.push({ type, detail });
    },
    window: {
      addEventListener(type, fn) {
        listeners[type] = fn;
      },
    },
    document: {
      activeElement: opts.activeElement || null,
      getSelection() {
        return opts.selection || '';
      },
    },
    navigator: {
      clipboard: {
        writeText(text) {
          writes.push(text);
          return Promise.resolve(text);
        },
      },
    },
    __listeners: listeners,
    __writes: writes,
    __logs: logs,
  };
  vm.createContext(runtime);
  installEngineAmbient(runtime);
  vm.runInContext(
    MIN.slice(START, END) + ';' + MIN.slice(HOOK_START, HOOK_END),
    runtime,
    { filename: 'clean-copy-hook-slice.js' }
  );
  return runtime;
}

function makeClipboardEvent(initialText = '', defaultPrevented = false) {
  const data = Object.create(null);
  data['text/plain'] = initialText;
  return {
    defaultPrevented,
    prevented: false,
    clipboardData: {
      getData(type) {
        return data[type] || '';
      },
      setData(type, value) {
        data[type] = String(value);
      },
    },
    preventDefault() {
      this.prevented = true;
      this.defaultPrevented = true;
    },
    data,
  };
}

function check(name, fn) {
  try {
    fn();
    console.log('  ok  - ' + name);
    check.pass++;
  } catch (e) {
    console.error('FAIL - ' + name);
    console.error(e && e.stack || e);
    check.fail++;
  }
}
check.pass = 0;
check.fail = 0;

check('removes global tracking params but preserves useful params', () => {
  assert.strictEqual(
    cleanCopyUrl('https://example.com/item?utm_source=news&fbclid=abc&id=123&gclid=xyz'),
    'https://example.com/item?id=123'
  );
  assert.strictEqual(
    cleanCopyUrl('https://example.com/search?q=privacy&ref=docs'),
    'https://example.com/search?q=privacy&ref=docs'
  );
});

check('cleans YouTube share links without removing playback position', () => {
  assert.strictEqual(
    cleanCopyUrl('https://youtu.be/abc123?si=sharetoken&feature=shared&t=42'),
    'https://youtu.be/abc123?t=42'
  );
});

check('unwraps Google redirect URLs and then cleans the destination', () => {
  assert.strictEqual(
    cleanCopyUrl('https://www.google.com/url?q=https%3A%2F%2Fexample.com%2Fpath%3Futm_source%3Dg%26id%3D1&sa=U&ved=abc'),
    'https://example.com/path?id=1'
  );
});

check('leaves Google redirect URLs alone when q is not a URL', () => {
  assert.strictEqual(
    cleanCopyUrl('https://www.google.com/url?q=weather&sa=U&ved=abc'),
    'https://www.google.com/url?q=weather&sa=U&ved=abc'
  );
});

check('unwraps social and discussion-site redirectors', () => {
  assert.strictEqual(
    cleanCopyUrl('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.org%2F%3Ffbclid%3D1%26ok%3D2&h=abc'),
    'https://example.org/?ok=2'
  );
  assert.strictEqual(
    cleanCopyUrl('https://out.reddit.com/t3_abc?url=https%3A%2F%2Fexample.net%2Fpost%3Futm_campaign%3Dshare%26p%3D9&token=abc'),
    'https://example.net/post?p=9'
  );
  assert.strictEqual(
    cleanCopyUrl('https://www.linkedin.com/safety/go?url=https%3A%2F%2Fexample.io%2F%3Fli_fat_id%3Dabc%26x%3D1'),
    'https://example.io/?x=1'
  );
});

check('unwraps privacy and mail redirectors', () => {
  assert.strictEqual(
    cleanCopyUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2F%3Futm_medium%3Dduck%26ok%3Dyes'),
    'https://example.com/?ok=yes'
  );
  assert.strictEqual(
    cleanCopyUrl('https://safelinks.protection.outlook.com/?url=https%3A%2F%2Fexample.com%2Fdoc%3Fmc_eid%3Dabc%26keep%3D1&data=tracking'),
    'https://example.com/doc?keep=1'
  );
});

check('canonicalizes Amazon product links while preserving useful variant params', () => {
  assert.strictEqual(
    cleanCopyUrl('https://www.amazon.com/Some-Product-Name/dp/B08ABC1234/ref=sxin_15?tag=affiliate-20&pd_rd_w=abc&psc=1&th=1'),
    'https://www.amazon.com/dp/B08ABC1234?th=1'
  );
});

check('cleans multiple copied URLs and preserves punctuation', () => {
  assert.strictEqual(
    cleanCopyText('Read https://example.com/?utm_source=x&id=1, then watch https://youtu.be/abc?si=nope&t=5.'),
    'Read https://example.com/?id=1, then watch https://youtu.be/abc?t=5.'
  );
});

check('cleans URLs containing HTML ampersands', () => {
  assert.strictEqual(
    cleanCopyUrl('https://example.com/?id=1&amp;utm_source=news'),
    'https://example.com/?id=1'
  );
});

check('copy event cleans selected text before it reaches the clipboard', () => {
  const runtime = installCopyHook({
    selection: 'https://example.com/?utm_source=copy&id=7',
  });
  const event = makeClipboardEvent();
  runtime.__listeners.copy(event);
  assert.strictEqual(event.prevented, true);
  assert.strictEqual(event.data['text/plain'], 'https://example.com/?id=7');
  assert.strictEqual(runtime.__logs.some((x) => x.type === 'cleaned_copied_link'), true);
});

check('copy event cleans site-provided clipboard text', () => {
  const runtime = installCopyHook();
  const event = makeClipboardEvent('https://youtu.be/abc?si=dirty&t=9', true);
  runtime.__listeners.copy(event);
  assert.strictEqual(event.prevented, true);
  assert.strictEqual(event.data['text/plain'], 'https://youtu.be/abc?t=9');
});

check('navigator.clipboard.writeText is cleaned for Copy-link buttons', () => {
  const runtime = installCopyHook();
  runtime.navigator.clipboard.writeText('https://l.facebook.com/l.php?u=https%3A%2F%2Fexample.com%2F%3Ffbclid%3D1%26keep%3Dyes');
  assert.deepStrictEqual(runtime.__writes, ['https://example.com/?keep=yes']);
});

if (check.fail) {
  console.error('\n' + check.pass + ' passed, ' + check.fail + ' failed');
  process.exit(1);
}
console.log('\n' + check.pass + ' passed, 0 failed');

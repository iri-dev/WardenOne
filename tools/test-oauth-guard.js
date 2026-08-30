/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
/*
 * Focused VM regression harness for oauth-guard.js.
 * Run: node tools/test-oauth-guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
/* This suite lifts a guard's source and runs it in a hand-built sandbox. The guards now use
 * AbortController to release their listeners on teardown, which a bare vm context does not have. */
const { installPlatformGlobals } = require('./lib/engine-ambient.js');

const SRC = fs.readFileSync(path.join(__dirname, '..', 'oauth-guard.js'), 'utf8');

function element(text) {
  return {
    id: '',
    textContent: String(text || ''),
    innerText: String(text || ''),
    value: '',
    children: [],
    attrs: {},
    setAttribute(name, value) { this.attrs[name] = String(value); },
    getAttribute(name) { return this.attrs[name] || null; },
    addEventListener() {},
    appendChild(child) { this.children.push(child); return child; },
    remove() { this.removed = true; },
  };
}

function runCase(options) {
  const state = { modals: [], reports: [] };
  const actions = (options.actions || []).map((label) => element(label));
  const headings = (options.headings || []).map((label) => element(label));
  const body = element(options.body || '');
  const documentElement = element('');
  let modal = null;
  const document = {
    readyState: 'complete',
    body,
    documentElement,
    querySelectorAll(selector) {
      selector = String(selector || '');
      if (selector.indexOf('button') >= 0 || selector.indexOf('input[type="submit"]') >= 0) return actions;
      if (selector.indexOf('h1') >= 0 || selector.indexOf('[role="heading"]') >= 0) return headings;
      return [];
    },
    createElement() { return element(''); },
    getElementById(id) { return id === 'wo-oauth-guard' ? modal : null; },
    addEventListener() {},
  };
  body.appendChild = function (child) {
    this.children.push(child);
    if (child && child.id === 'wo-oauth-guard') {
      modal = child;
      state.modals.push(child);
    }
    return child;
  };

  const sandbox = {
    window: null,
    document,
    location: new URL(options.url),
    history: { length: 1, back() {} },
    chrome: {
      storage: {
        local: { get(_key, callback) { callback({ wardenone_config: { enabled: true, oauthGuard: true, silentMode: false } }); } },
        onChanged: { addListener() {} },
      },
      runtime: {
        lastError: null,
        sendMessage(message, callback) {
          state.reports.push(message);
          if (callback) callback();
        },
      },
    },
    MutationObserver: class MutationObserver { observe() {} disconnect() {} },
    URL,
    BigInt,
    Date,
    Math,
    Number,
    Object,
    Set,
    String,
    Array,
    RegExp,
    setTimeout(fn) { fn(); return 1; },
    clearTimeout() {},
  };
  sandbox.window = sandbox;
  sandbox.window.open = () => ({});
  installPlatformGlobals(sandbox);
  vm.createContext(sandbox);
  vm.runInContext(SRC, sandbox);
  return state;
}

let pass = 0;
let fail = 0;
function check(name, condition, extra) {
  if (condition) {
    pass++;
    console.log('  ok  - ' + name);
  } else {
    fail++;
    console.log('  FAIL - ' + name + (extra ? ' :: ' + JSON.stringify(extra) : ''));
  }
}

const googleUrl = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=client&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&response_type=code&scope=https%3A%2F%2Fwww.googleapis.com%2Fauth%2Fdrive';

{
  const state = runCase({
    url: googleUrl,
    body: 'Choose an account to continue to Example App Use another account',
    actions: ['Continue', 'Use another account'],
    headings: ['Choose an account'],
  });
  check('G1 Drive scope on Google account chooser never warns', state.modals.length === 0 && state.reports.length === 0, state);
}

{
  const state = runCase({
    url: googleUrl,
    body: 'Sign in with Google Use your Google Account Email or phone Forgot email?',
    actions: ['Next'],
    headings: ['Sign in'],
  });
  check('G2 Google credential/sign-in surface never warns', state.modals.length === 0 && state.reports.length === 0, state);
}

{
  const state = runCase({
    url: googleUrl,
    body: 'Example App wants to access your Google Account Select what Example App can access See, edit, create, and delete your Google Drive files',
    actions: ['Cancel', 'Continue'],
    headings: ['Example App wants to access your Google Account'],
  });
  check('G3 actual Google grant surface warns', state.modals.length === 1 && state.reports.length > 0, state);
}

const microsoftUrl = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=client&redirect_uri=https%3A%2F%2Fapp.example%2Fcallback&response_type=code&scope=Mail.Read';

{
  const state = runCase({
    url: microsoftUrl,
    body: 'Pick an account Use another account',
    actions: ['Continue'],
    headings: ['Pick an account'],
  });
  check('M1 Microsoft account chooser never warns', state.modals.length === 0 && state.reports.length === 0, state);
}

{
  const state = runCase({
    url: microsoftUrl,
    body: 'Permissions requested Example App would like to: Read your mail Accepting these permissions allows this app to use your data',
    actions: ['Cancel', 'Accept'],
    headings: ['Permissions requested'],
  });
  check('M2 actual Microsoft consent surface warns', state.modals.length === 1 && state.reports.length > 0, state);
}

/*
 * Signing in to GitHub with GitHub's own tooling was warned about as a risky
 * third-party OAuth grant. GitHub CLI, GitHub Desktop, GitHub Mobile and
 * Codespaces all land on the same /login/oauth/authorize page as any other app,
 * and `repo` there scored High -- so the guard fired every time, on a grant
 * with no third party in it.
 *
 * The exemption has to survive someone trying to wear it. The publisher line is
 * rendered by the provider, but the app supplies the name printed after "by",
 * so the phrase is anchored to the sentence that asks for access and refuses a
 * second "by" in between.
 */
const githubRepoUrl = 'https://github.com/login/oauth/authorize?client_id=xyz&scope=repo%20delete_repo';
const githubGrantTail = ' wants to access your iri account Repositories Public and private '
  + 'read and write all public and private repository data Authorize Cancel';

{
  const state = runCase({
    url: 'https://github.com/login?client_id=abc&return_to=%2Flogin%2Foauth%2Fauthorize%3Fscope%3Drepo',
    body: 'Sign in to GitHub to continue to Example App Username or email address Password Forgot password? Sign in New to GitHub? Create an account',
    actions: ['Sign in', 'Create an account'],
    headings: ['Sign in to GitHub'],
  });
  check('H1 GitHub credential page during an OAuth hand-off never warns',
    state.modals.length === 0 && state.reports.length === 0, state);
}

{
  const state = runCase({
    url: 'https://github.com/login/oauth/authorize?client_id=abc&scope=repo%20read%3Aorg',
    body: 'Authorize GitHub CLI GitHub CLI by GitHub' + githubGrantTail,
    actions: ['Authorize GitHub CLI', 'Cancel'],
    headings: ['Authorize GitHub CLI'],
  });
  check('H2 GitHub authorising its own app is not a third-party grant',
    state.modals.length === 0 && state.reports.length === 0, state);
}

{
  const state = runCase({
    url: 'https://github.com/login/oauth/authorize?client_id=abc&scope=repo&redirect_uri=https%3A%2F%2Fgithub.com%2Fcodespaces%2Fauth',
    body: 'Authorize Codespaces Codespaces' + githubGrantTail,
    actions: ['Authorize', 'Cancel'],
    headings: ['Authorize Codespaces'],
  });
  check('H3 a redirect back to the provider itself is first-party',
    state.modals.length === 0 && state.reports.length === 0, state);
}

{
  const state = runCase({
    url: githubRepoUrl,
    body: 'Authorize Sketchy Deploy Sketchy Deploy by evil-corp' + githubGrantTail,
    actions: ['Authorize Sketchy Deploy', 'Cancel'],
    headings: ['Authorize Sketchy Deploy'],
  });
  check('H4 a real third-party repo grant still warns',
    state.modals.length === 1 && state.reports.length > 0, state);
}

for (const impostor of [
  { what: 'a hyphenated lookalike publisher', publisher: 'GitHub-Support' },
  { what: 'a typosquatted publisher', publisher: 'GitHubb' },
  { what: 'a domain-shaped publisher', publisher: 'github.io' },
]) {
  const state = runCase({
    url: githubRepoUrl,
    body: 'Authorize Repo Sync Repo Sync by ' + impostor.publisher + githubGrantTail,
    actions: ['Authorize Repo Sync', 'Cancel'],
    headings: ['Authorize Repo Sync'],
  });
  check('H5 ' + impostor.what + ' cannot pass as first-party',
    state.modals.length === 1 && state.reports.length > 0, { publisher: impostor.publisher, state });
}

{
  const state = runCase({
    url: githubRepoUrl,
    body: 'Authorize Deploy by GitHub Deploy by GitHub by evil-corp' + githubGrantTail,
    actions: ['Authorize', 'Cancel'],
    headings: ['Authorize Deploy by GitHub'],
  });
  check('H6 an app NAMED "... by GitHub" cannot borrow the publisher line',
    state.modals.length === 1 && state.reports.length > 0, state);
}

{
  const state = runCase({
    url: githubRepoUrl,
    body: 'Authorize Sketchy Deploy Sketchy Deploy by evil-corp' + githubGrantTail
      + ' Terms Privacy Docs Blog This site is powered by GitHub',
    actions: ['Authorize Sketchy Deploy', 'Cancel'],
    headings: ['Authorize Sketchy Deploy'],
  });
  check('H7 a "powered by GitHub" footer does not exempt the page',
    state.modals.length === 1 && state.reports.length > 0, state);
}

{
  const state = runCase({
    url: 'https://github.com/login/oauth/authorize?client_id=xyz&scope=repo&redirect_uri=https%3A%2F%2Fgithub.com.evil.tld%2Fcb',
    body: 'Authorize Repo Sync Repo Sync by evil-corp' + githubGrantTail,
    actions: ['Authorize Repo Sync', 'Cancel'],
    headings: ['Authorize Repo Sync'],
  });
  check('H8 a redirect to a lookalike domain is not the provider',
    state.modals.length === 1 && state.reports.length > 0, state);
}

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

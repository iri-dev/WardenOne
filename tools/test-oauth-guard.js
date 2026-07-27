/*
 * Focused VM regression harness for oauth-guard.js.
 * Run: node tools/test-oauth-guard.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

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

console.log('');
console.log(pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);

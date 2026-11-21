'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf("const LOGIN_AGE_CHOICE_KEY = 'wardenone_age_prompt_dismissed';");
const end = source.indexOf('chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {', start);
assert(start > 0 && end > start);
const stored = { wardenone_config: { loginAgeCheck: true } };
const writes = [];
const context = {
  URL, Date, Number, Object, Array, Promise,
  messageSenderIsTab: sender => !!sender.tab,
  messageCleanHost: host => /^[a-z0-9.-]+$/.test(host) ? host : '',
  messageSenderMatchesHost: (sender, host) => new URL(sender.tab.url).hostname === host,
  localGet: async key => ({ [key]: stored[key] }),
  localSet: async value => { Object.assign(stored, value); writes.push(value); },
};
const choice = vm.runInNewContext(source.slice(start, end) + ';loginAgeChoice', context);
const sender = (host, incognito = false, frameId = 0, tabHost = host) => ({
  url: 'https://' + host + '/login', frameId,
  tab: { url: 'https://' + tabHost + '/login', incognito },
});

(async () => {
  assert.equal((await choice({ action: 'status' }, sender('gamebanana.com'))).dismissed, false);
  assert.equal(writes.length, 0, 'status only reads local choice');
  assert.equal((await choice({ action: 'dismiss' }, sender('gamebanana.com'))).dismissed, true);
  assert(Number.isFinite(stored.wardenone_age_prompt_dismissed['gamebanana.com']));
  assert.equal((await choice({ action: 'status' }, sender('gamebanana.com'))).dismissed, true);
  assert.equal((await choice({ action: 'status' }, sender('login.gamebanana.com'))).dismissed, false);
  assert.equal((await choice({ action: 'dismiss' }, sender('gamebanana.com', true))).dismissed, false);
  assert.equal((await choice({ action: 'dismiss' }, sender('gamebanana.com', false, 2))).ok, false);
  assert.equal((await choice({ action: 'dismiss' }, sender('gamebanana.com', false, 0, 'other.example'))).ok, false);
  assert.equal((await choice({ action: 'erase' }, sender('gamebanana.com'))).ok, false);
  assert.equal(writes.length, 1, 'rejected or private requests never write');
  stored.wardenone_config = { loginAgeCheck: false };
  assert.equal((await choice({ action: 'dismiss' }, sender('other.example'))).ok, false);
  assert.equal(writes.length, 1);
  console.log('[ok] login age choice is exact host, local and sender scoped');
})().catch(error => { console.error(error); process.exitCode = 1; });

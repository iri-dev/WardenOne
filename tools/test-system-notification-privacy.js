/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'notification-manager.js'), 'utf8');
const page = fs.readFileSync(path.join(root, 'notifications.html'), 'utf8');
const start = source.indexOf('async function showWardenSystemNotification(');
const end = source.indexOf('\ntry {\n  if (chrome.storage', start);
if (start < 0 || end < start) throw new Error('system notification function not found');
const calls = [];
const ctx = {
  chrome: { runtime: { lastError: null }, notifications: { create(id, options, callback) { calls.push({ id, options }); callback(); } } },
  loadWardenNotificationState: async () => ({ settings: {} }),
  wardenNotificationResolvedPreference: () => ({ mode: 'persistent', duration: 'persistent', settings: {}, definition: {}, rule: {} }),
  wardenNotificationSoundAllowed: () => false,
  playWardenNotificationSound: async () => {},
  Object, String, Number, Math, Date, Promise, Error,
};
vm.createContext(ctx);
vm.runInContext(source.slice(start, end), ctx);

(async () => {
  const secret = 'private-account.example/reset/token-file.pdf';
  const names = ['tab_limit_closed', 'download_review', 'extension_change', 'manual_check', 'startup_review', 'unknown'];
  for (const type of names) {
    await ctx.showWardenSystemNotification('wo-test-' + type, {
      type: 'basic', title: secret, message: secret, contextMessage: secret,
      buttons: [{ title: secret }], priority: 2,
    }, type);
  }
  if (calls.length !== names.length) throw new Error('system notifications were not created');
  for (const { options } of calls) {
    const serialized = JSON.stringify(options);
    if (serialized.includes(secret) || serialized.includes('private-account.example') || serialized.includes('token-file.pdf')) {
      throw new Error('private detail escaped to the OS: ' + serialized);
    }
    if (!options.requireInteraction || options.type !== 'basic' || !options.title || !options.message) {
      throw new Error('persistent system notice lost its safe shape');
    }
  }
  if (!page.includes('may be visible on a lock screen') || !page.includes('site names, download filenames and extension names stay inside WardenOne')) {
    throw new Error('notification settings omit the OS disclosure');
  }
  console.log('system notification privacy: ' + calls.length + ' categories checked');
})().catch((e) => { console.error(e); process.exit(1); });

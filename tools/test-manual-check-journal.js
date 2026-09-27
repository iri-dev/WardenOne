/* A context-menu lookup must leave a bounded receipt if MV3 evicts its worker.
   Run: node tools/test-manual-check-journal.js */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { createHash, webcrypto } = require('crypto');

const source = fs.readFileSync(path.join(__dirname, '..', 'background.js'), 'utf8');
const noticeSource = source.slice(source.indexOf('async function wardenManualNotice('),
  source.indexOf('/* What WardenOne can say about a host'));
const journalSource = source.slice(source.indexOf('const MANUAL_CHECK_JOURNAL_KEY ='),
  source.indexOf('async function runWardenManualCheck('));
const key = 'wardenone_manual_check_jobs';
const failures = [];
let passed = 0;
function check(name, ok) {
  if (ok) passed++;
  else failures.push(name);
}

function worker(session, tabs, notices, opts) {
  const sb = {
    Date, Math, Number, String, Array, Object, Promise, crypto: webcrypto,
    reputationCacheKey: async (value) => createHash('sha256').update(String(value)).digest('hex'),
    chrome: {
      storage: { session: {
        get: async (name) => ({ [name]: session[name] }),
        set: async (values) => { Object.assign(session, values); },
      } },
      tabs: { get: async (id) => tabs.get(id) || null },
      webNavigation: { getFrame: async ({ tabId }) => {
        const tab = tabs.get(tabId);
        return tab ? { documentId: tab.documentId } : null;
      } },
      scripting: { executeScript: async ({ target, args }) => {
        if (opts && opts.navigateAtInject) {
          const tab = tabs.get(target.tabId);
          tab.documentId = 'next-document';
          opts.navigateAtInject = false;
        }
        const tab = tabs.get(target.tabId);
        if (!tab || target.documentIds && !target.documentIds.includes(tab.documentId)) {
          throw new Error('Document changed');
        }
        notices.push({ via: 'toast', target, text: args[0] });
        return [{ result: true }];
      } },
    },
    showWardenSystemNotification: async (id, options) => {
      notices.push({ via: 'tray', id, text: options.title + ' ' + options.message });
      return true;
    },
  };
  vm.createContext(sb);
  vm.runInContext(noticeSource + '\n' + journalSource, sb);
  return { sb, ready: () => vm.runInContext('manualCheckRecoveryReady', sb),
    start: (kind, tab) => sb.startManualCheckJob(kind, tab),
    notice: (job, title, message) => sb.manualCheckNotice(job, title, message) };
}

(async () => {
  const session = {};
  const tabs = new Map([[7, { id: 7, url: 'https://news.example/private?q=secret', documentId: 'doc-1' }]]);
  const notices = [];
  let w = worker(session, tabs, notices);
  await w.ready();
  const job = await w.start('url', tabs.get(7));
  check('pending job is saved before lookup', session[key].length === 1);
  const serialized = JSON.stringify(session[key]);
  check('journal omits raw target, URL, query, and credentials',
    !serialized.includes('news.example') && !serialized.includes('secret')
      && !serialized.includes('apiKey') && /^[a-f0-9]{64}$/.test(job.tabUrlHash));
  check('journal binds to the originating document', job.tabId === 7 && job.documentId === 'doc-1');

  /* A fresh VM is a new service worker: the old promise never resumes. */
  w = worker(session, tabs, notices);
  await w.ready();
  check('cold worker reports interrupted scan on the original document',
    notices.length === 1 && notices[0].via === 'toast'
      && /Check interrupted/.test(notices[0].text)
      && notices[0].target.documentIds[0] === 'doc-1');
  check('delivered receipt clears the journal', session[key].length === 0);
  w = worker(session, tabs, notices);
  await w.ready();
  check('next worker does not repeat a delivered receipt', notices.length === 1);

  await w.start('domain', tabs.get(7));
  tabs.get(7).documentId = 'doc-2';
  w = worker(session, tabs, notices);
  await w.ready();
  check('same URL in a new document gets only a generic interruption',
    notices.length === 2 && notices[1].via === 'tray'
      && /Check interrupted/.test(notices[1].text)
      && !notices[1].text.includes('news.example'));

  const active = await w.start('url', tabs.get(7));
  tabs.get(7).url = 'https://other.example/';
  await w.notice(active, 'Sensitive verdict', 'Flagged URL details');
  check('navigated tab never receives stale verdict',
    notices.length === 3 && notices[2].via === 'tray'
      && /Check interrupted/.test(notices[2].text)
      && !notices[2].text.includes('Sensitive verdict'));
  await w.sb.finishManualCheckJob(active.id);

  tabs.get(7).url = 'https://news.example/private?q=secret';
  tabs.get(7).documentId = 'doc-3';
  const race = worker(session, tabs, notices, { navigateAtInject: true });
  await race.ready();
  const raced = await race.start('url', tabs.get(7));
  await race.notice(raced, 'Sensitive verdict', 'Flagged URL details');
  check('navigation during toast injection falls back to generic interruption',
    notices.length === 4 && notices[3].via === 'tray'
      && /Check interrupted/.test(notices[3].text)
      && !notices[3].text.includes('Sensitive verdict'));

  if (failures.length) {
    console.error('FAIL (' + failures.length + ')\n  - ' + failures.join('\n  - '));
    process.exitCode = 1;
  } else console.log('PASS ' + passed + ' manual-check journal checks');
})().catch((error) => { console.error(error); process.exitCode = 1; });

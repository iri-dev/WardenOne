/* Test support, not a suite. Every write of wardenone_config now goes through the config lock
   (config-lock.js), and in the worker through updateStoredConfig() in background.js. Tests that run
   worker or page code in a vm sandbox, with localGet and localSet mocked, need both. They get the
   shipped source, sliced rather than rewritten, so they exercise what ships; only the strict read
   is mapped onto the sandbox's own localGet. There is no Web Lock in a vm, so the lock just runs
   the task, which is what it does in a browser without one. */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

function sliceFunction(src, name) {
  const at = src.indexOf('function ' + name + '(');
  if (at < 0) throw new Error('config-write-harness: background.js has no function ' + name);
  const end = src.indexOf('\n}\n', at);
  if (end < 0) throw new Error('config-write-harness: cannot find the end of ' + name);
  return src.slice(at, end + 3);
}

const background = read('background.js');
const LOCK_SOURCE = read('config-lock.js');
const LOCAL_GET_STRICT_FROM_MOCK = 'function localGetStrict(key) { return Promise.resolve(localGet(key)).then((r) => r || {}); }\n';
/* withConfigLock, plus the worker's updateStoredConfig and the clone it uses. */
const WORKER_WRITE_SOURCE = LOCK_SOURCE + '\n' + sliceFunction(background, '__cfgClone') + sliceFunction(background, 'updateStoredConfig');

module.exports = {
  LOCK_SOURCE,
  WORKER_WRITE_SOURCE,
  /* For a sandbox that mocks localGet but has no localGetStrict of its own. */
  WORKER_WRITE_WITH_MOCK_READ: WORKER_WRITE_SOURCE + LOCAL_GET_STRICT_FROM_MOCK,
};

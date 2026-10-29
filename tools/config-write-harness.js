/* Lift shipped config-lock/updateStoredConfig code for VM suites. Map strict reads to the sandbox's localGet; without Web
   Locks, use the browser's unlocked fallback. */
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
const WORKER_WRITE_SOURCE = LOCK_SOURCE + '\n' + sliceFunction(background, '__cfgClone')
  + sliceFunction(background, 'storedConfigChangedKeys') + sliceFunction(background, 'updateStoredConfig');

module.exports = {
  LOCK_SOURCE,
  WORKER_WRITE_SOURCE,
  /* For a sandbox that mocks localGet but has no localGetStrict of its own. */
  WORKER_WRITE_WITH_MOCK_READ: WORKER_WRITE_SOURCE + LOCAL_GET_STRICT_FROM_MOCK,
};

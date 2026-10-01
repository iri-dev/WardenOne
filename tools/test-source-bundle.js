'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { zipEntries } = require('./check-package-archive.js');
const { assertClean, parseArgs, buildSourceBundle } = require('./build-source-bundle.js');

assert.throws(() => assertClean(' M README.md', false), /Local changes would be omitted/);
assert.doesNotThrow(() => assertClean(' M README.md', true));
assert.deepStrictEqual(parseArgs(['--committed', '--output', 'review.zip']),
  { committed: true, output: 'review.zip' });
assert.throws(() => parseArgs(['--unknown']), /Usage:/);

const output = path.join(os.tmpdir(), 'wardenone-source-test-' + process.pid + '.zip');
try {
  const result = buildSourceBundle({ output, committed: true });
  const entries = zipEntries(fs.readFileSync(output));
  for (const required of ['.gitattributes', '.node-version', 'README.md', 'PRIVACY.md',
    'docs/feed-freshness-review.md', 'src/content.js', 'tools/check-maintainability.js', 'manifest.json']) {
    assert(entries.includes(required), 'missing tracked source: ' + required);
  }
  assert(!entries.some((name) => /^(?:\.git|\.claude|\.publish|\.store-candidates)\//.test(name)));
  assert.strictEqual(result.files, entries.length);
  assert.throws(() => buildSourceBundle({ output, committed: true }), /Output already exists/);
} finally {
  if (fs.existsSync(output)) fs.unlinkSync(output);
}

console.log('source bundle tests passed');

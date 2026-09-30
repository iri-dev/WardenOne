/* README links must resolve to files already staged for the repository. */
'use strict';
const assert = require('assert');
const { linkedDocs, missingLinkedDocs, check } = require('./check-readme-doc-links.js');

const sample = '[review](docs/fresh.md#sources) [folder](docs/perf/)\n'
  + '<img src="docs/screenshots/popup.webp">\n'
  + '[remote](https://example.test/docs/other.md)';
assert.deepStrictEqual(linkedDocs(sample),
  ['docs/fresh.md', 'docs/perf/', 'docs/screenshots/popup.webp']);
const tracked = new Set(['docs/perf/README.md', 'docs/screenshots/popup.webp']);
assert.deepStrictEqual(missingLinkedDocs(sample, tracked, () => true), ['docs/fresh.md']);
tracked.add('docs/fresh.md');
assert.deepStrictEqual(missingLinkedDocs(sample, tracked, (target) => target !== 'docs/fresh.md'),
  ['docs/fresh.md']);
check();
console.log('README link staging tests passed');

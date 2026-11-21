/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { cleanupProfile } = require('./lib/browser-profile-cleanup.js');

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'wo-r5-'));
fs.writeFileSync(path.join(directory, 'probe'), 'test');
cleanupProfile(directory, 'wo-r5-');
assert(!fs.existsSync(directory), 'numeric lab prefixes must be cleaned after browser tests');
assert.throws(() => cleanupProfile(path.join(os.tmpdir(), 'ordinary-data'), 'wo-r5-'));
assert.throws(() => cleanupProfile(path.join(os.tmpdir(), 'wo-r5-parent', 'child'), 'wo-r5-'));
assert.throws(() => cleanupProfile(path.join(os.tmpdir(), 'wo-r5-child'), 'wo-../'));
console.log('[ok] browser profile cleanup removes only its exact temporary profile');

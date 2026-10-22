/* WardenOne — Copyright (C) 2026 iri · GNU GPL v3 or later, see LICENSE.
   Official source: https://github.com/iri-dev/WardenOne */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const root = path.resolve(__dirname, '../..');
const box = vm.createContext({ URL });
vm.runInContext(['domain-utils.js', 'network-policy.js'].map(file => fs.readFileSync(path.join(root, file), 'utf8')).join('\n'), box);
module.exports = vm.runInContext('WONetworkPolicy', box);

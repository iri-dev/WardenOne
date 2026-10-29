/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {build}=require('./lib/outbound-inventory.js');
const root=path.resolve(__dirname,'..'),file=path.join(root,'docs/outbound-destinations.json');
const expected=JSON.stringify(build(root),null,2)+'\n';
if(process.argv[2]==='--write'){fs.writeFileSync(file,expected);console.log('[ok] outbound inventory written');}
else if(process.argv[2]==='--check'){assert.equal(fs.readFileSync(file,'utf8'),expected,'Regenerate docs/outbound-destinations.json');console.log('[ok] outbound inventory matches shipped code');}
else throw Error('Use --write or --check');

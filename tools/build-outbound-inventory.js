/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {build}=require('./lib/outbound-inventory.js');
const root=path.resolve(__dirname,'..'),file=path.join(root,'tools/contracts/outbound-destinations.json');
const inventory=JSON.stringify(build(root),null,2)+'\n';
const expected=JSON.stringify({schemaVersion:1,sha256:crypto.createHash('sha256').update(inventory).digest('hex')},null,2)+'\n';
if(process.argv.includes('--report')){
  const directory=path.join(root,'.private-review/reports');fs.mkdirSync(directory,{recursive:true});
  fs.writeFileSync(path.join(directory,'outbound-destinations.json'),inventory);
}
if(process.argv[2]==='--write'){fs.writeFileSync(file,expected);console.log('[ok] outbound inventory written');}
else if(process.argv[2]==='--check'){assert.equal(fs.readFileSync(file,'utf8'),expected,'Regenerate tools/contracts/outbound-destinations.json');console.log('[ok] outbound inventory matches shipped code');}
else throw Error('Use --write or --check');

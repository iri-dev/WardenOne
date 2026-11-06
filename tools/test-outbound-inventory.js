/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict'),crypto=require('crypto');
const {build}=require('./lib/outbound-inventory.js');
const root=path.resolve(__dirname,'..'),expected=JSON.parse(fs.readFileSync(path.join(root,'tools/contracts/outbound-destinations.json'))),actual=build(root);
assert.deepEqual(expected,{schemaVersion:1,sha256:crypto.createHash('sha256').update(JSON.stringify(actual,null,2)+'\n').digest('hex')},'Outbound inventory must be regenerated from shipped code');
assert.equal(actual.entries.length,31);assert.equal(actual.dynamic.length,5);
const byHost=new Map(actual.entries.map(x=>[x.host,x]));
for(const host of ['api.github.com','safebrowsing.googleapis.com','www.virustotal.com','gql.twitch.tv','raw.githubusercontent.com'])assert(byHost.has(host));
assert(byHost.get('threatview.io').uses.some(use=>use.trigger==='automatic filter update'&&use.data==='fixed public list request'&&use.sources===1));
assert(!byHost.has('iri-dev.github.io'),'Project website must not become a reporting endpoint');
assert(byHost.get('brave.com').uses.some(x=>x.trigger==='automatic popup browser update check'));
assert(byHost.get('api.github.com').uses.some(x=>x.trigger==='automatic popup browser update check'));
assert(actual.dynamic.some(x=>x.id==='download-hash'));
console.log('[ok] classified outbound hosts and dynamic destinations match shipped code');

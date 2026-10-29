/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm');
function load(extra={}) {
  const context=vm.createContext({URL,TextEncoder,TextDecoder,AbortController,setTimeout,clearTimeout,console,...extra});
  for(const file of ['domain-utils.js','psl-private.js','tracker-attribution.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../..',file),'utf8'),context,{filename:file});
  return vm.runInContext('WOTrackerAttribution',context);
}
module.exports={load};

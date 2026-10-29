/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),vm=require('vm'),assert=require('assert/strict');
const source=fs.readFileSync(path.join(__dirname,'perf-real-sites.js'),'utf8');
const from=source.indexOf('function siteReady('),end=source.indexOf('async function waitForSite(',from);
assert(from>=0&&end>from);
const successful=vm.runInNewContext(source.slice(from,end)+'\nsampleSuccessful');
const state={host:'www.twitch.tv',readyVersion:'fixture',videos:1,videoReadyState:4,textLength:2000,videoTime:1,videoPaused:false};
const make=(first={},last={})=>({site:'twitch',readiness:{ready:true},samples:[{state:{...state,...first}},{state:{...state,videoTime:16,...last}}]});
assert(successful(make()));
for(const change of [{videoTime:1},{videoTime:null},{videoPaused:true},{videoReadyState:0},{browserError:true},{readyVersion:null}])assert(!successful(make({},change)),JSON.stringify(change));
assert(!successful({...make(),readiness:{ready:false}}),'an elapsed measurement window is not proof of ready playback');
assert(!successful({...make(),error:'browser failed'}));
assert(!successful({...make(),samples:[]}));
assert(successful(make({},{videoPaused:true,videoEnded:true})),'a video that actually reached its end counts as playback');
console.log('[ok] live-site validation rejects stalled, paused, unready and failed playback instead of returning a false pass');

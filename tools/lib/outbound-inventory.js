/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),assert=require('assert/strict');
const {runtimeHosts,NOT_A_DESTINATION}=require('./outbound-hosts.js');
const CLASSIFICATION=Object.freeze({
  'api.abuseipdb.com':['opt-in reputation','raw public IP and user API key'],
  'api.github.com':['automatic popup build check','public release and commit identifiers'],
  'api.pwnedpasswords.com':['user-started password check','five SHA-1 prefix characters'],
  'brave.com':['automatic popup browser update check','public Brave release notes'],
  'checkurl.phishtank.com':['opt-in reputation','public URL without credentials, query or fragment; user API key'],
  'chromewebstore.google.com':['user-started extension listing check','public extension ID'],
  'domain-reputation.whoisxmlapi.com':['opt-in reputation','public domain and user API key'],
  'edgeupdates.microsoft.com':['automatic popup browser update check','browser release channel'],
  'gql.twitch.tv':['Twitch page feature','Twitch page query and its own authorization header'],
  'haveibeenpwned.com':['user-started site breach check','registrable domain'],
  'rdap.org':['user-started or enabled age check','registrable domain'],
  'safebrowsing.googleapis.com':['opt-in reputation','public URL without credentials, query or fragment; user API key'],
  'threat-intelligence.whoisxmlapi.com':['opt-in reputation','public URL or domain without credentials, query or fragment; user API key'],
  'urlhaus-api.abuse.ch':['opt-in reputation','public URL without credentials, query or fragment; user Auth-Key'],
  'versionhistory.googleapis.com':['automatic popup browser update check','browser platform and channel'],
  'versions.brave.com':['automatic popup browser update check','browser platform and channel'],
  'www.virustotal.com':['opt-in or user-started reputation','public URL, file hash or selected manual URL; user API key'],
  'www.whoisxmlapi.com':['opt-in age check','public domain and user API key'],
});
const DYNAMIC=Object.freeze([
  {id:'user-filter-list',source:'background.js',anchor:'async function fetchCustomListText(',destination:'user-selected HTTPS list host',trigger:'user subscription',data:'list URL; no visited page address'},
  {id:'script-drift',source:'background.js',anchor:'async function fetchScriptForDrift(',destination:'site script host',trigger:'script on a visited page; on by default',data:'script address re-fetched without cookies'},
  {id:'download-hash',source:'background-downloads.js',anchor:'async function fetchBytesForHash(',destination:'selected download host',trigger:'small risky download; on by default',data:'download address re-fetched without cookies'},
  {id:'page-resource',source:'eyeshield.js',anchor:'fetch(href,',destination:'resource host on the visited page',trigger:'page feature',data:'resource address'},
  {id:'cryptominer-resource',source:'cryptominer-detect.js',anchor:'fetch(href,',destination:'resource host on the visited page',trigger:'page feature',data:'resource address'},
]);
function build(root){
  const {hosts,contactHosts}=runtimeHosts(root),sourceInventory=JSON.parse(fs.readFileSync(path.join(root,'docs/source-inventory.json')));
  const feeds=new Map();for(const source of sourceInventory.sources){const host=new URL(source.url).hostname;feeds.set(host,(feeds.get(host)||0)+1);}
  const probes=new Set([...fs.readFileSync(path.join(root,'network.js'),'utf8').matchAll(/['"](https:\/\/[^'"]+)['"]/g)].map(match=>new URL(match[1]).hostname));
  const entries=contactHosts.map(host=>{
    const uses=[];if(feeds.has(host))uses.push({trigger:'automatic filter update',data:'fixed public list request',sources:feeds.get(host)});
    if(probes.has(host))uses.push({trigger:'user-started network self-test',data:'favicon probe'});
    if(host==='raw.githubusercontent.com')uses.push({trigger:'opt-in OpenPhish feed',data:'fixed public feed request'});
    if(CLASSIFICATION[host])uses.push({trigger:CLASSIFICATION[host][0],data:CLASSIFICATION[host][1]});
    assert(uses.length,'Unclassified outbound host: '+host+' at '+hosts.get(host));
    return{host,source:hosts.get(host).split(':')[0],uses};
  });
  for(const host of Object.keys(CLASSIFICATION))assert(hosts.has(host),'Stale outbound classification: '+host);
  for(const host of feeds.keys())assert(hosts.has(host),'Configured feed host absent from shipped scripts: '+host);
  for(const host of probes)assert(hosts.has(host),'Self-test host absent from shipped scripts: '+host);
  for(const host of Object.keys(NOT_A_DESTINATION))assert(hosts.has(host),'Stale non-destination: '+host);
  for(const item of DYNAMIC)assert(fs.readFileSync(path.join(root,item.source),'utf8').includes(item.anchor),'Missing dynamic source: '+item.id);
  assert(!entries.some(e=>e.host==='iri-dev.github.io'),'Project website is a link, not a reporting endpoint');
  return{schemaVersion:1,source:'shipped root JavaScript literals and configured feed inventory',entries,dynamic:DYNAMIC};
}
module.exports={build,CLASSIFICATION,DYNAMIC};

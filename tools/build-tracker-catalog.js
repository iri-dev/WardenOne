/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),zlib=require('zlib'),crypto=require('crypto'),vm=require('vm');
const {load}=require('./lib/tracker-attribution-harness.js');
const ROOT=path.resolve(__dirname,'..');
const TRACKERS_SOURCE_URL = 'https://raw.githubusercontent.com/AdguardTeam/companiesdb/8d845040224a0e3ea9cbba5df68ceb6a988235d2/dist/trackers.json';
const COMPANIES_SOURCE_URL = 'https://raw.githubusercontent.com/AdguardTeam/companiesdb/8d845040224a0e3ea9cbba5df68ceb6a988235d2/dist/companies.json';
const REVISION='8d845040224a0e3ea9cbba5df68ceb6a988235d2';
const HASHES={'dist/trackers.json':'f923b02432be27276860d87e38181707e61eaf66c9407106ddd5e33302efdb7c',
  'dist/companies.json':'ea7e6de9b67e66ab3d4da833d63de68640ea275b81d644672928297e73202a3e',
  LICENSE:'187442db4df3afd21f2f0525739fd4beac28a62daaba3ee8d3533f60e7c33ec7'};
const hash=text=>crypto.createHash('sha256').update(text).digest('hex');
function build(snapshot,roots) {
  const api=load();
  if(snapshot?.schema!==1||snapshot.revision!==REVISION||!Array.isArray(snapshot.files)||snapshot.files.length!==3)throw Error('Invalid catalog input snapshot');
  const inputs={};
  for(const file of snapshot.files) {
    if(!HASHES[file.path]||inputs[file.path]||typeof file.text!=='string'||Buffer.byteLength(file.text)>2*1024*1024||hash(file.text)!==HASHES[file.path]||file.sha256!==HASHES[file.path])throw Error('Catalog source integrity mismatch');
    inputs[file.path]=file.text;
  }
  if(inputs.LICENSE!==fs.readFileSync(path.join(ROOT,'licenses/CC-BY-SA-4.0.txt'),'utf8'))throw Error('Catalog license differs from pinned text');
  const upstream=JSON.parse(inputs['dist/trackers.json']),companies=JSON.parse(inputs['dist/companies.json']).companies;
  if(!roots) {
    roots=JSON.parse(fs.readFileSync(path.join(ROOT,'rules-trackers.json'))).flatMap(r=>r.condition?.requestDomains||[]);
    const source=fs.readFileSync(path.join(ROOT,'background.js'),'utf8');
    const match=source.match(/const FINGERPRINT_LIBRARY_DOMAIN_FILTERS = (\[[\s\S]*?\]);/);if(!match)throw Error('Fingerprint inventory missing');
    roots.push(...vm.runInNewContext(match[1]),'googletagmanager.com','etracker.com','eulerian.net','webtrekk.net');
  }
  const selected=new Map();
  for(const [domain,tracker] of Object.entries(upstream.trackerDomains)) {
    if(api.host(domain)!==domain||!roots.some(root=>domain===root||domain.endsWith('.'+root)||root.endsWith('.'+domain)))continue;
    const record=upstream.trackers[tracker];if(!record||!companies[record.companyId])throw Error('Dangling tracker identity');
    if(!selected.has(tracker))selected.set(tracker,{id:tracker,name:record.name,organization:record.companyId,category:upstream.categories[record.categoryId],domains:[]});
    selected.get(tracker).domains.push(domain);
  }
  const trackers=[...selected.values()].sort((a,b)=>a.id.localeCompare(b.id));for(const tracker of trackers)tracker.domains.sort();
  const labels={site_analytics:'Site analytics',advertising:'Advertising',essential:'Essential services',social_media:'Social media',audio_video_player:'Audio/video',mobile_analytics:'Mobile analytics',misc:'Other services',cdn:'Content delivery',hosting:'Hosting',customer_interaction:'Customer interaction',unknown:'Unclassified',consent:'Consent management',pornvertising:'Adult advertising',telemetry:'Telemetry',extensions:'Extensions',email:'Email',comments:'Comments'};
  const categories=[...new Set(trackers.map(t=>t.category))].sort().map(id=>({id,name:labels[id]||id}));
  const organizations=[...new Set(trackers.map(t=>t.organization))].sort().map(id=>({id,name:companies[id].name}));
  const data={schema:1,source:{name:'AdGuard Companies DB',revision:REVISION,updatedAt:upstream.timeUpdated,license:'CC-BY-SA-4.0',inputSha256:[HASHES['dist/trackers.json'],HASHES['dist/companies.json']]},categories,organizations,trackers};
  api.validate(data,Date.parse(upstream.timeUpdated));
  if(Buffer.byteLength(JSON.stringify(data))>api.MAX_BYTES)throw Error('Compiled metadata exceeds UI budget');
  return data;
}
function main() {
  const file=path.join(ROOT,'tracker-catalog.json'),snapshot=JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT,'docs/tracker-catalog-source.json.gz')),{maxOutputLength:4*1024*1024}));
  const data=build(snapshot),text=JSON.stringify(data)+'\n';
  if(process.argv.includes('--build'))fs.writeFileSync(file,text);
  else if(fs.readFileSync(file,'utf8')!==text)throw Error('Tracker catalog drift; rebuild reviewed inputs');
  console.log('[ok] '+data.trackers.length+' product identities, '+data.organizations.length+' organizations, '+data.trackers.reduce((n,t)=>n+t.domains.length,0)+' local domains');
}
module.exports={build,REVISION,TRACKERS_SOURCE_URL,COMPANIES_SOURCE_URL};
if(require.main===module)try{main();}catch(error){console.error(error.stack||error);process.exitCode=1;}

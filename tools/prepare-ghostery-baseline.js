/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path'),os=require('os'),crypto=require('crypto'),vm=require('vm');
const {spawnSync}=require('child_process');
const {readZip,extract}=require('./lib/review-archive.js');
const {fingerprint,sha256}=require('./lib/privacy-baseline.js');
const {compareArchives}=require('./prepare-release-review.js');
const {validateEntries}=require('./check-package-archive.js');
const ROOT=path.resolve(__dirname,'..');
function gitTreeHash(entries) {
  const root=new Map();
  for(const entry of entries) {
    const parts=entry.path.split('/');let node=root;
    for(const name of parts.slice(0,-1)){if(!node.has(name))node.set(name,new Map());node=node.get(name);if(!(node instanceof Map))throw Error('Source tree path collision');}
    const name=parts.at(-1);if(node.has(name))throw Error('Duplicate source path');node.set(name,entry);
  }
  const hash=node=>{
    const rows=[...node].map(([name,value])=>({name,dir:value instanceof Map,value}));
    rows.sort((a,b)=>Buffer.compare(Buffer.from(a.name+(a.dir?'/':'')),Buffer.from(b.name+(b.dir?'/':''))));
    const body=Buffer.concat(rows.map(r=>Buffer.concat([Buffer.from((r.dir?'40000':r.value.mode)+' '+r.name+'\0'),Buffer.from(r.dir?hash(r.value):r.value.sha,'hex')])));
    return crypto.createHash('sha1').update(Buffer.from('tree '+body.length+'\0')).update(body).digest('hex');
  };
  return hash(root);
}
function verifyVendor(files,pin,runtimeBytes,runtimeManifest) {
  if(pin.schemaVersion!==1||!/^v\d+\.\d+\.\d+$/.test(pin.tag)||!pin.commit||!/^[a-f0-9]{40}$/.test(pin.commit.sha)
      ||pin.ref?.object?.sha!==pin.commit.sha||pin.ref?.ref!=='refs/tags/'+pin.tag||pin.release?.tag!==pin.tag||pin.tree?.truncated!==false)throw Error('Invalid immutable vendor pin');
  const version=pin.tag.slice(1),asset=pin.release.assets.find(a=>a.name==='ghostery-chromium-'+version+'.zip');
  if(!asset||asset.url!=='https://github.com/ghostery/ghostery-extension/releases/download/'+pin.tag+'/'+asset.name||asset.sha256!==sha256(runtimeBytes))throw Error('Published runtime digest mismatch');
  if(runtimeManifest.version!==version||runtimeManifest.manifest_version!==3)throw Error('Vendor runtime version mismatch');
  const expected=pin.tree.tree.filter(e=>e.type==='blob');
  if(expected.length!==files.size)throw Error('Vendor source inventory mismatch');
  for(const entry of expected) {
    if(!['100644','100755'].includes(entry.mode))throw Error('Unsupported source file mode');
    const bytes=files.get(entry.path);
    if(!bytes||crypto.createHash('sha1').update(Buffer.from('blob '+bytes.length+'\0')).update(bytes).digest('hex')!==entry.sha)throw Error('Vendor source blob mismatch: '+entry.path);
  }
  if(!/^[a-f0-9]{40}$/.test(pin.commit.tree||'')||gitTreeHash(expected)!==pin.commit.tree)throw Error('Vendor source tree identity mismatch');
  if(JSON.parse(files.get('package.json')).version!==version)throw Error('Vendor source version mismatch');
  return{version,commit:pin.commit.sha,sourceFiles:files.size,publishedDigestVerified:true,gitBlobsVerified:true,
    correspondence:'Official release asset and matching tagged source; vendor association verified, reproducible vendor build not established.'};
}
function safeSettings(value) {
  if(Array.isArray(value))return value.map(safeSettings);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([k])=>!['__proto__','prototype','constructor'].includes(k)).map(([k,v])=>[k,typeof v==='string'&&v&&/(?:key|token|secret|password|salt|seed|nonce)/i.test(k)?'[redacted]':safeSettings(v)]));
  return value;
}
function rulesets(directory) {
  const manifest=JSON.parse(fs.readFileSync(path.join(directory,'manifest.json')));
  return(manifest.declarative_net_request?.rule_resources||[]).map(r=>{const file=path.resolve(directory,String(r.path).replace(/^\//,''));
    if(!file.startsWith(path.resolve(directory)+path.sep))throw Error('Ruleset path escaped snapshot');
    const bytes=fs.readFileSync(file),rules=JSON.parse(bytes);if(!Array.isArray(rules))throw Error('Invalid ruleset shape');
    return{...r,bytes:bytes.length,sha256:sha256(bytes),count:rules.length};});
}
function prepare({out,pinFile,sourceZip,runtimeZip,browser}) {
  out=path.resolve(out);
  const relative=path.relative(path.join(ROOT,'tmp'),out);
  if(!relative||relative.startsWith('..')||path.isAbsolute(relative)||fs.existsSync(out))throw Error('Choose a new snapshot directory below tmp/');
  const pin=JSON.parse(fs.readFileSync(pinFile)),sourceBytes=fs.readFileSync(sourceZip),runtimeBytes=fs.readFileSync(runtimeZip);
  const raw=readZip(sourceBytes),prefix=[...raw.keys()][0].split('/')[0]+'/';
  if([...raw.keys()].some(f=>!f.startsWith(prefix)))throw Error('Vendor source has multiple roots');
  const vendorSource=new Map([...raw].map(([file,bytes])=>[file.slice(prefix.length),bytes])),vendorRuntime=readZip(runtimeBytes);
  const vendor=verifyVendor(vendorSource,pin,runtimeBytes,JSON.parse(vendorRuntime.get('manifest.json')));
  const git=(args,env=process.env)=>{const r=spawnSync('git',args,{cwd:ROOT,env,encoding:'utf8',maxBuffer:32*1024*1024});if(r.status!==0)throw Error('git '+args[0]+': '+r.stderr);return r.stdout.trim();};
  fs.mkdirSync(out,{recursive:true});
  const env={...process.env,GIT_INDEX_FILE:path.join(out,'baseline.index')};
  git(['read-tree','HEAD'],env);git(['add','-A','--','.'],env);
  const tree=git(['write-tree'],env),baseCommit=git(['rev-parse','HEAD']);
  const archive=path.join(out,'wardenone-runtime.zip'),sourceArchive=path.join(out,'wardenone-source.zip');
  git(['archive','--format=zip','--output='+archive,tree]);
  const bare=path.join(out,'source-repo.git');git(['init','--bare',bare]);
  fs.writeFileSync(path.join(bare,'objects/info/alternates'),path.resolve(ROOT,git(['rev-parse','--git-path','objects'])).replace(/\\/g,'/')+'\n');
  fs.writeFileSync(path.join(bare,'info/attributes'),'* -export-ignore\n');
  git(['--git-dir='+bare,'archive','--format=zip','--output='+sourceArchive,tree]);
  const runtime=readZip(fs.readFileSync(archive)),source=readZip(fs.readFileSync(sourceArchive)),review=compareArchives(source,runtime);
  review.errors.push(...validateEntries([...runtime.keys()]));if(review.errors.length)throw Error(review.errors.join('\n'));
  const wardenDir=path.join(out,'wardenone'),wardenSource=path.join(out,'wardenone-source'),ghosteryDir=path.join(out,'ghostery'),ghosterySource=path.join(out,'ghostery-source');
  extract(runtime,wardenDir);extract(source,wardenSource);extract(vendorRuntime,ghosteryDir);extract(vendorSource,ghosterySource);
  for(const args of [['tools/build-content.js','--check'],['tools/build-settings-data.js','--check']]) {
    const r=spawnSync(process.execPath,args,{cwd:wardenSource,encoding:'utf8'});if(r.status!==0)throw Error('Generated baseline drift: '+r.stdout+r.stderr);
  }
  const settings=vm.runInNewContext(fs.readFileSync(path.join(wardenDir,'settings-data.js'),'utf8')+';SETTINGS_DATA');
  const defaults=Object.assign({},settings.defaults,...settings.carried.map(g=>g.defaults||{}));
  const keys=[...new Set([...settings.shieldKeys,...settings.watchOnlyKeys])];
  const builds=[{label:'wardenone',product:'wardenone',directory:wardenDir,baseCommit,tree,revisionKind:'uncommitted-tree',archiveSha256:sha256(fs.readFileSync(archive)),sourceArchiveSha256:sha256(fs.readFileSync(sourceArchive)),review},
    {label:'ghostery',product:'ghostery',directory:ghosteryDir,tag:pin.tag,commit:vendor.commit,archiveSha256:sha256(runtimeBytes),sourceArchiveSha256:sha256(sourceBytes),verification:vendor}];
  for(const build of builds) {
    const identity=fingerprint(build.directory),manifest=JSON.parse(fs.readFileSync(path.join(build.directory,'manifest.json')));
    Object.assign(build,{fingerprint:identity.sha256,fileCount:identity.files.length,version:manifest.version,manifestVersion:manifest.manifest_version,background:manifest.background,rulesets:rulesets(build.directory)});
    fs.writeFileSync(path.join(out,build.label+'-files.json'),JSON.stringify(identity,null,2)+'\n');
  }
  const result={schemaVersion:1,date:new Date().toISOString(),browserPath:path.resolve(browser),browserSha256:sha256(fs.readFileSync(browser)),
    environment:{node:process.version,os:os.version(),release:os.release(),arch:os.arch(),cpu:os.cpus()[0].model,logicalCpus:os.cpus().length,ramBytes:os.totalmem(),profile:'Fresh disposable profiles; no personal data',updates:'Offline packaged-data baseline; updated-list comparison deferred to G-05'},builds,
    wardenSettings:{defaults:safeSettings(defaults),recommended:safeSettings(settings.recommended),protectionKeys:keys,defaultOn:keys.filter(k=>defaults[k]===true),defaultOff:keys.filter(k=>defaults[k]===false)},
    vendorDataDependencies:JSON.parse(vendorSource.get('package.json')).dataDependencies,sourcePinSha256:sha256(fs.readFileSync(pinFile)),
    limitations:['Baseline preparation does not establish a performance, anonymity or exploit advantage.','No vendor source is installed as a runnable comparator. Only the digest-verified release package is loaded.']};
  fs.writeFileSync(path.join(out,'snapshots.json'),JSON.stringify(result,null,2)+'\n');return result;
}
module.exports={gitTreeHash,verifyVendor,safeSettings,rulesets,prepare};
if(require.main===module) {
  try{const[out,pinFile,sourceZip,runtimeZip,browser]=process.argv.slice(2);if(!browser)throw Error('Usage: prepare-ghostery-baseline.js tmp/new-snapshot pin.json source.zip runtime.zip browser.exe');
    const result=prepare({out,pinFile,sourceZip,runtimeZip,browser});console.log(JSON.stringify(result.builds.map(({label,version,fingerprint,fileCount})=>({label,version,fingerprint,fileCount})),null,2));
  }catch(error){console.error(error.stack||error);process.exitCode=1;}
}

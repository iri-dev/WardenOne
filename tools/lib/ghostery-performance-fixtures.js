/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const https=require('https'),fs=require('fs'),path=require('path');
const {tls}=require('../browser-media-security.js'),{PAGES}=require('../perf-profile.js'),{hash}=require('./ghostery-performance.js');
const HOST='article.g05-benchmark.test',IDP='identity.g05-provider.test',MEDIA='fixture.googlevideo.com';
function pages(port){return {
  article:PAGES['/article-neutral.html']().replace('<script>window.__done = true;</script>','<input id="interaction" aria-label="Article search"><script src="/interaction.js"></script><script>window.__done=true</script>'),
  churn:PAGES['/churn.html']().replace('<div id="app">','<input id="interaction" aria-label="Application search"><script src="/interaction.js"></script><div id="app">'),
  frames8:PAGES['/frames.html']().replace(/<body[^>]*>/,'$&<input id="interaction" aria-label="Frame search"><script src="/interaction.js"></script>'),
  frames30:PAGES['/frames-heavy.html']().replace(/<body[^>]*>/,'$&<input id="interaction" aria-label="Frame search"><script src="/interaction.js"></script>'),
  media:'<!doctype html><title>Native media benchmark</title><video id="player" controls muted loop style="position:fixed;top:10px;left:10px;width:320px;height:180px" src="https://'+MEDIA+':'+port+'/movie.mp4"></video><input id="interaction" aria-label="Video title"><script src="/interaction.js"></script><script>window.__done=true;</script>',
  auth:'<!doctype html><title>Account application</title><main><h1>Sign in</h1><form method="post" action="/session"><label>User <input id="interaction" name="user" autocomplete="username"></label><label>Password <input id="password" name="password" type="password" autocomplete="current-password"></label><button>Sign in</button></form>'+Array.from({length:3},(_,i)=>'<iframe src="https://'+IDP+':'+port+'/identity?i='+i+'"></iframe>').join('')+'<div id="dashboard"></div></main><script src="/interaction.js"></script><script src="/auth.js"></script>',
};}
async function serve(){let bodies;const video=fs.readFileSync(path.join(__dirname,'../../spotify-silent-1s.mp4'));
  const server=https.createServer(tls,(req,res)=>{const u=new URL(req.url,'https://'+req.headers.host);res.setHeader('Cache-Control','max-age=300');
    if(u.pathname==='/session'){req.resume();req.on('end',()=>{res.writeHead(303,{'Set-Cookie':'g05_session=synthetic; HttpOnly; Secure; SameSite=Lax','Location':'/account'});res.end();});return;}
    if(u.pathname==='/account'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Account</title><h1 id="session">'+(req.headers.cookie?.includes('g05_session=synthetic')?'signed-in':'missing')+'</h1>');return;}
    if(u.pathname==='/movie.mp4'){res.setHeader('Content-Type','video/mp4');res.setHeader('Content-Length',video.length);res.end(video);return;}
    if(u.pathname==='/interaction.js'){res.setHeader('Content-Type','text/javascript');res.end('window.__inputLatency=null;document.getElementById("interaction").addEventListener("input",e=>{if(!e.isTrusted)return;const t=performance.now();requestAnimationFrame(()=>requestAnimationFrame(()=>{window.__inputLatency=performance.now()-t;}));});');return;}
    if(u.pathname==='/auth.js'){res.setHeader('Content-Type','text/javascript');res.end('(async()=>{const db=await new Promise((resolve,reject)=>{const q=indexedDB.open("account-fixture",1);q.onupgradeneeded=()=>q.result.createObjectStore("state");q.onsuccess=()=>resolve(q.result);q.onerror=()=>reject(q.error);});await new Promise(r=>{const tx=db.transaction("state","readwrite");tx.objectStore("state").put({theme:"system",synthetic:true},"preferences");tx.oncomplete=r;});db.close();const root=document.querySelector("#dashboard");for(let i=0;i<250;i++){const e=document.createElement("p");e.textContent="Account application row "+i;root.append(e);}window.__done=true;})();');return;}
    const key=u.pathname.slice(1),body=bodies[key]||(u.pathname==='/frame.html'?PAGES['/frame.html']():u.pathname==='/identity'?'<!doctype html><title>Identity provider</title><p>Passive identity frame</p>':null);
    if(!body){res.writeHead(404);res.end('missing');return;}res.setHeader('Content-Type','text/html;charset=utf-8');res.setHeader('ETag','"'+hash(body)+'"');res.end(body);
  });await new Promise(r=>server.listen(0,'127.0.0.1',r));bodies=pages(server.address().port);
  return{server,origin:'https://'+HOST+':'+server.address().port,hosts:[HOST,IDP,MEDIA],bodyHashes:Object.fromEntries(Object.entries(bodies).map(([k,v])=>[k,hash(v)]))};
}
module.exports={pages,serve,HOST,IDP,MEDIA};

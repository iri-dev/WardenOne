/* WardenOne — Copyright (C) 2026 iri; GPL-3.0-or-later. See LICENSE. */
'use strict';
const fs=require('fs'),path=require('path');
const NOT_A_DESTINATION=Object.freeze({
  'myaccount.google.com':'OAuth review link','account.live.com':'OAuth review link',
  'github.com':'repository and release links','iri-dev.github.io':'project website link',
  'discord.com':'OAuth review link','appleid.apple.com':'OAuth review link',
  'www.facebook.com':'OAuth review link','www.spotify.com':'OAuth review link',
  'slack.com':'OAuth review link','www.dropbox.com':'OAuth review link',
  'gitlab.com':'OAuth review link','id.atlassian.com':'OAuth review link',
  'www.linkedin.com':'OAuth review link','platform.twitter.com':'embed restored on click',
  'connect.facebook.net':'embed restored on click','www.instagram.com':'embed restored on click',
  'www.tiktok.com':'embed restored on click','www.twitch.tv':'existing site or account link',
  'm.media-amazon.com':'CSS selector','adclick.g.doubleclick.net':'CSS selector',
  'www.w3.org':'SVG namespace',
});
const RESERVED=/(^|\.)example(\.|$)|\.(invalid|test|local|localhost)$/;
function runtimeHosts(root){
  const shipped=fs.readdirSync(root).filter(f=>f.endsWith('.js'));
  const hosts=new Map();
  for(const file of shipped){
    const source=fs.readFileSync(path.join(root,file),'utf8');
    source.split('\n').forEach((line,index)=>{
      for(const match of line.matchAll(/(["'`])(https?:\/\/[^"'`\s]+)\1/g)){
        const url=match[2];if(url.includes('*'))continue;
        const host=(url.match(/^https?:\/\/([a-z0-9.-]+)/i)||[])[1];
        if(!host||!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i.test(host))continue;
        const normalized=host.toLowerCase();
        if(!RESERVED.test(normalized)&&!hosts.has(normalized))hosts.set(normalized,file+':'+(index+1));
      }
    });
  }
  return{shipped,hosts,contactHosts:[...hosts.keys()].filter(h=>!NOT_A_DESTINATION[h]).sort()};
}
module.exports={NOT_A_DESTINATION,runtimeHosts};

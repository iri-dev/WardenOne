/* WardenOne — Copyright (C) 2026 iri
   Licensed under the GNU General Public License v3 or later. See LICENSE.
   Official source: https://github.com/iri-dev/WardenOne
   Upstream filter-list attribution: CREDITS.md
   Redistributing a modified copy? GPLv3 section 5(a) requires you to mark it as changed,
   with the date, and to keep these notices intact. */
;(function(){
  var inp=document.getElementById('wo-settings-search');
  if(inp){
    var nores=document.getElementById('wo-noresult');
    var clearBtn=document.getElementById('wo-search-clear');
    var countEl=document.getElementById('wo-search-count');

    // Expand search terms by related concepts.
    var SYN=[
      ['ad','ads','adblock','adblocker','adblocking','adshield','advert','adverts','advertise','advertising','advertisement','advertisements','commercial','commercials','sponsor','sponsored','preroll','midroll','banner','banners','easylist','ublock','cosmetic'],
      ['track','tracker','trackers','tracking','analytics','telemetry','beacon','beacons','pixel','pixels','spy','spyware','snoop','snooping'],
      ['cookie','cookies','consent','gdpr','ccpa','supercookie','supercookies'],
      ['popup','popups','popunder','popunders','overlay','overlays','nag','nags','tidy','remover','interstitial','interstitials','modal','modals','dismiss','cleaner'],
      ['youtube','yt','video','playback','player'],
      ['twitch','ttv','stream','streamer','streaming'],
      ['fingerprint','fingerprinting','canvas','webgl'],
      ['ip','webrtc','grabber','grabbers','logger','iplogger','grabify','geolocation'],
      ['malware','virus','viruses','malicious','trojan','infected'],
      ['phish','phishing','scam','scams','fake','spoof','spoofing','lookalike','impersonate','homograph'],
      ['download','downloads','file','files','installer','installers'],
      ['video','media','autoplay','audio','sound','playback'],
      ['redirect','redirects','redirection','bounce','bounces','hop','hops'],
      ['js','javascript','script','scripts','scriptlet','noscript','webassembly','wasm'],
      ['cert','certs','certificate','certificates','ssl','tls','https','secure'],
      ['token','tokens','session','sessions','exfil','exfiltration','hijack','hijacking','credential','credentials','password','passwords'],
      ['camera','webcam','mic','microphone','capture','screenshare','screencapture'],
      ['social','embed','embeds','facebook','instagram','tiktok','twitter','widget'],
      ['storage','localstorage'],
      ['prefetch','preload','preconnect'],
      ['clipboard','paste','copy','clickfix'],
      ['memory','ram','tab','tabs','sleep','throttle','battery','cpu','performance'],
      ['notification','notifications','toast','toasts','badge','alert','alerts'],
      ['breach','breached','pwned','leak','leaked','haveibeenpwned'],
      ['skimmer','skimmers','magecart','card','cards','payment','payments','checkout'],
      ['referrer','referer'],
      ['adult','nsfw','porn','xxx'],
      ['techsupport','support','locker','scareware'],
      ['update','updates','outdated','version'],
      ['form','forms','login','signin'],
      ['keylogger','keystroke','keylogging'],
      ['silent','silence','quiet','noiseless','notification-free','stealth','stealthy','distraction','distraction-free'],
      ['eye','eyeshield','vision','brightness','contrast','saturation','warmth','grayscale','dim','readability','tint','comfort'],
      ['master','switch','toggle','all','everything'],
      ['media','camera','mic','microphone','screen','capture','audio','video','webcam'],
      ['review','extension','extensions','permission','permissions','manage','management','reviewer'],
      ['scan','scanner','scanning','check','audit','inspect'],
      ['panic','emergency','logout','clear','clean','cleanup','wipe','reset'],
      ['forget','forgetme','leave','wipe','clean','clear','history','login','logins','remember','remembered','stay','logged','signin','session'],
      ['badge','indicator','icon','toolbar','action'],
      ['search','query','filter','find','explore']
    ];
    function toks(s){return (String(s).toLowerCase().match(/[a-z0-9]+/g))||[];}

    function buildKeywords(el){
      var base=el.textContent||'';
      var attrs='';
      var dk=el.getAttribute('data-key');
      if(dk)attrs+=' '+dk.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
      var em=el.getAttribute('data-eyeshield-mode');
      if(em)attrs+=' '+em;
      var dm=el.getAttribute('data-mode');
      if(dm)attrs+=' '+dm;
      var sp=el.getAttribute('data-search-preset');
      if(sp)attrs+=' '+sp;
      var dp=el.getAttribute('data-perm');
      if(dp)attrs+=' '+dp;
      var id=el.id;
      var parentIds='';
      if(id)parentIds+=' '+id.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
      var p=el.parentElement;
      for(var pi=0;pi<3&&p;p=p.parentElement,pi++){
        if(p.id)parentIds+=' '+p.id.replace(/([a-z0-9])([A-Z])/g,'$1 $2');
      }
      var full=base+attrs+parentIds;
      var rawLower=full.toLowerCase();
      var set=Object.create(null);
      toks(full).forEach(function(t){set[t]=1;});
      for(var i=0;i<SYN.length;i++){
        var g=SYN[i],hit=false;
        for(var j=0;j<g.length;j++){if(set[g[j]]){hit=true;break;}}
        if(hit){for(var k=0;k<g.length;k++)set[g[k]]=1;}
      }
      var words=Object.keys(set);
      return {el:el,words:words,text:' '+words.join(' ')+' ',raw:rawLower,attrs:attrs,parentIds:parentIds};
    }

    // Index controls and section headings once.
    var rows=[];
    // The site dashboard's own controls live in a separate view; search is for the settings list.
    document.querySelectorAll('.row').forEach(function(row){if(row.closest&&row.closest('#site-dash'))return;rows.push(buildKeywords(row));});
    // EyeShield is one control; hiding its children separately breaks the mode selector.
    var eyePanel=$('eyeshield-panel');
    if(eyePanel)rows.push(buildKeywords(eyePanel));
    var masterEl=$('master-state');
    if(masterEl)rows.push(buildKeywords(masterEl));
    var allOn=$('all-on');
    if(allOn)rows.push(buildKeywords(allOn));
    ['js-global','js-smart','js-site','js-privacy-limits','js-shield-desc','script-trust-list','script-trust-add-current'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });
    document.querySelectorAll('.wo-search-chip').forEach(function(el){rows.push(buildKeywords(el));});
    ['ss-scan','ss-sitebreach','ss-domage','ss-clear','ss-panic','cl-run','ext-review','ext-review-open','verify-repair','startup-run','mem-free','mem-dupes','mem-tab-usage','mem-zombies','perm-scan','perm-reset','ug-btn'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });
    document.querySelectorAll('.mem-mode').forEach(function(el){rows.push(buildKeywords(el));});
    ['tl-guard','tl-max','tl-idle','tl-close','tl-warn'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });
    var dtBtn=$('download-trust-add-current');
    if(dtBtn)rows.push(buildKeywords(dtBtn));
    var alBtn=$('allowlist');
    if(alBtn)rows.push(buildKeywords(alBtn));
    document.querySelectorAll('.group>h2, .eyeshield-panel+h2, #js-shield+h2').forEach(function(h3){
      if(h3.id==='eyeshield-title'||h3.id==='site-controls-title')return;
      rows.push(buildKeywords(h3));
    });
    ['open-activity','open-notifications','open-network'].forEach(function(id){
      var el=$(id);
      if(el)rows.push(buildKeywords(el));
    });

    var seenSearchEls=[];
    rows=rows.filter(function(row){
      if(!row||!row.el)return false;
      if(seenSearchEls.indexOf(row.el)>=0)return false;
      seenSearchEls.push(row.el);
      return true;
    });

    function dist(a,b){
      var al=a.length,bl=b.length;
      if(!al)return bl;if(!bl)return al;
      if(al-bl>2||bl-al>2)return 3;
      var d=[],i,j;
      for(i=0;i<=al;i++){d[i]=[];d[i][0]=i;}
      for(j=0;j<=bl;j++)d[0][j]=j;
      for(i=1;i<=al;i++)for(j=1;j<=bl;j++){
        var cost=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;
        d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+cost);
        if(i>1&&j>1&&a.charCodeAt(i-1)===b.charCodeAt(j-2)&&a.charCodeAt(i-2)===b.charCodeAt(j-1))
          d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);
      }
      return d[al][bl];
    }

    function scoreMatch(qt,r){
      var baseLower=(r.el.textContent||'').toLowerCase();
      if(baseLower.indexOf(qt)>=0)return 100;
      if(r.raw.indexOf(qt)>=0)return 80;
      if(r.attrs.indexOf(qt)>=0)return 70;
      if(r.parentIds.indexOf(qt)>=0)return 50;
      if(r.text.indexOf(qt)>=0)return 40;
      // Allow two edits only in longer words; "speech" must not match "speed".
      if(qt.length>=4){
        var th=qt.length<=7?1:2,c0=qt.charCodeAt(0);
        for(var i=0;i<r.words.length;i++){
          var w=r.words[i];
          if(w.charCodeAt(0)!==c0)continue;
          if(w.length-qt.length>th||qt.length-w.length>th)continue;
          if(dist(qt,w)<=th)return 20;
        }
      }
      return 0;
    }

    function run(){
      var raw=(inp.value||'').trim();
      var q=raw.toLowerCase();
      var qts=toks(q);
      var shown=0;
      for(var i=0;i<rows.length;i++){
        var row=rows[i];
        var ok=true;
        for(var t=0;t<qts.length;t++){
          var sc=scoreMatch(qts[t],row);
          if(sc===0){ok=false;break;}
        }
        row.el.classList.toggle('wo-hidden',!ok);
        if(ok)shown++;
      }
      document.querySelectorAll('.card-group').forEach(function(g){
        if(g.closest&&g.closest('#site-dash'))return;
        var hide=!!q&&!g.querySelector('.row:not(.wo-hidden)');
        g.classList.toggle('wo-hidden',hide);
        var hh=g.previousElementSibling;
        if(hh&&/^H[1-6]$/.test(hh.tagName))hh.classList.toggle('wo-hidden',hide);
        var foldout=g.parentElement;
        if(foldout&&foldout.classList.contains('rewind-drop')){
          var foldoutOpenAttr='data-wo-search-was-open';
          if(q){
            if(!foldout.hasAttribute(foldoutOpenAttr))foldout.setAttribute(foldoutOpenAttr,foldout.open?'true':'false');
            foldout.classList.toggle('wo-hidden',hide);
            if(!hide)foldout.open=true;
          }else{
            foldout.classList.remove('wo-hidden');
            if(foldout.hasAttribute(foldoutOpenAttr)){
              foldout.open=foldout.getAttribute(foldoutOpenAttr)==='true';
              foldout.removeAttribute(foldoutOpenAttr);
            }
          }
        }
      });
      // Keep EyeShield's heading in sync with its compound control.
      if(eyePanel){
        var eyeVisible=!eyePanel.classList.contains('wo-hidden');
        var eyeH3=eyePanel.previousElementSibling;
        if(eyeH3&&/^H[1-6]$/.test(eyeH3.tagName))eyeH3.classList.toggle('wo-hidden',!eyeVisible);
      }
      var masterArea=document.querySelector('.master');
      if(masterArea){
        var masterVisible=!q||!masterArea.querySelector('.wo-hidden');
        masterArea.classList.toggle('wo-hidden',!masterVisible);
      }
      var topQuick=document.querySelector('.top-quick');
      if(topQuick){
        var tqVisible=!q||!topQuick.querySelector('.wo-hidden');
        topQuick.classList.toggle('wo-hidden',!tqVisible);
      }
      if(nores)nores.style.display=(q&&shown===0)?'block':'none';
      if(clearBtn)clearBtn.style.display=raw?'flex':'none';
      if(countEl){
        countEl.textContent=q?(shown+' result'+(shown===1?'':'s')):'';
        countEl.classList.toggle('has-results',!!q);
      }
      saveSearchSoon();
    }

    inp.addEventListener('input',run);
    inp.addEventListener('search',run);
    if(clearBtn)clearBtn.addEventListener('click',function(){inp.value='';run();inp.focus();});
    document.querySelectorAll('[data-search-preset]').forEach(function(btn){
      btn.addEventListener('click',function(){
        inp.value=btn.getAttribute('data-search-preset')||btn.textContent||'';
        run();
        inp.focus();
      });
    });

    var searchSaveTimer=0, restoringSearch=false;
    function persistSearch(){
      var raw=(inp.value||'').trim();
      var store=popupScrollStore();
      if(raw)store.set({[POPUP_SEARCH_KEY]:{q:raw,at:Date.now()}});
      else store.remove(POPUP_SEARCH_KEY);
    }
    function saveSearchSoon(){
      if(restoringSearch)return;
      clearTimeout(searchSaveTimer);
      searchSaveTimer=setTimeout(persistSearch,120);
    }
    function flushSearch(){ if(restoringSearch)return; clearTimeout(searchSaveTimer); persistSearch(); }
    restorePopupSearch=function(done){
      popupScrollStore().get(POPUP_SEARCH_KEY,function(res){
        var e=res&&res[POPUP_SEARCH_KEY];
        var saved=String((e&&typeof e==='object'?e.q:e)||'');
        if(saved){ restoringSearch=true; inp.value=saved; run(); restoringSearch=false; }
        if(typeof done==='function')done();
      });
    };
    window.addEventListener('pagehide',flushSearch);
    document.addEventListener('visibilitychange',function(){ if(document.visibilityState==='hidden')flushSearch(); });
  }
})();
